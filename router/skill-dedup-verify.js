// 去重两阶段验证（修片 2 的过并）。
// 片 2 的 LLM 粗分组会过并（office-hours 把 retro/investigate/plan-ceo-review 4 个不同 skill 并成 8 元组）。
// 修法：每组内每对 skill 跑 pairwise dup-judge（关 thinking），确认的对取连通分量重组成组。
// 项目一贯模式：L0 粗候选(高召回) -> L1 judge(过滤)。这里粗分组(高召回) -> 逐对 judge(过滤过并)。
//
// receipt：过并是否被修、多少对确认/拒绝、18 组/32 冗余 -> 精炼后 N 组/M 冗余。

const fs = require('fs');
const path = require('path');

const DEDUP = path.join(__dirname, '..', 'results', 'skills-dedup.json');
const MANIFEST = path.join(__dirname, '..', 'skills-corpus-full.json');
const SCORED = path.join(__dirname, '..', 'results', 'skills-scored.json');
const OUT = path.join(__dirname, '..', 'results', 'skills-dedup-verified.json');

const BASE = process.env.ANTHROPIC_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding';
const MODEL = process.env.ANTHROPIC_MODEL || 'glm-5.2';
const TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;

async function callNoThinking(prompt, maxTokens = 300) {
  const body = { model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  try { body.thinking = { type: 'disabled' }; } catch {}
  const resp = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
}

// 逐对判：dup=功能重复(留着赘余) / distinct=相关但不同(都该留)
function parseVerdict(raw) {
  try {
    const j = JSON.parse(raw);
    if (j.verdict === 'dup' || j.verdict === 'distinct') return { verdict: j.verdict, reason: j.reason || '' };
  } catch {}
  const m = raw.match(/"verdict"\s*:\s*"(dup|distinct)"/i);
  if (m) return { verdict: m[1].toLowerCase(), reason: '' };
  return null;
}

async function judgePair(a, b) {
  const prompt = `判断两个 AI agent skill 是否功能重复（留着两个是赘余）。

A: ${a.name}: ${a.description || '(无描述)'}
B: ${b.name}: ${b.description || '(无描述)'}

判断标准：
- "dup" = 核心功能相同，删一个不影响覆盖（如同一功能的改名版/版本变体/拆分副本）
- "distinct" = 相关但功能不同，都该留（如"写测试" vs "跑测试"，"office-hours 头脑风暴" vs "retro 回顾"）

只输出 JSON，不要任何其它内容: {"verdict":"dup 或 distinct","reason":"一句话"}`;
  try {
    const text = await callNoThinking(prompt, 300);
    return parseVerdict(text) || { verdict: 'distinct', reason: `parse fail: ${text.slice(0, 80)}` };
  } catch (e) {
    return { verdict: 'distinct', reason: `error: ${e.message.slice(0, 80)}` }; // 失败保守判 distinct（不过并）
  }
}

// 连通分量（基于确认的 dup 对）
function connectedComponents(nodes, edges) {
  const adj = new Map();
  for (const n of nodes) adj.set(n, new Set());
  for (const [a, b] of edges) { adj.get(a).add(b); adj.get(b).add(a); }
  const visited = new Set();
  const comps = [];
  for (const n of nodes) {
    if (visited.has(n)) continue;
    const comp = [];
    const stack = [n];
    while (stack.length) {
      const x = stack.pop();
      if (visited.has(x)) continue;
      visited.add(x);
      comp.push(x);
      for (const y of adj.get(x)) if (!visited.has(y)) stack.push(y);
    }
    comps.push(comp);
  }
  return comps;
}

async function main() {
  if (!TOKEN) { console.error('缺 ANTHROPIC_AUTH_TOKEN'); process.exit(1); }
  const dedup = JSON.parse(fs.readFileSync(DEDUP, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const scored = JSON.parse(fs.readFileSync(SCORED, 'utf8'));
  const descByName = new Map(manifest.map(s => [s.name, s.description || '']));
  const scoreByName = new Map(scored.all.map(s => [s.name, s]));

  const candidateGroups = dedup.groups.map(g => g.all.map(m => m.name)); // 每组 name 数组

  let pairsJudged = 0, pairsDup = 0, pairsDistinct = 0;
  const pairResults = [];
  const refinedGroups = [];

  process.stdout.write('逐对确认 (关 thinking): ');
  for (let gi = 0; gi < candidateGroups.length; gi++) {
    const members = candidateGroups[gi];
    const edges = []; // 确认 dup 的对
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = { name: members[i], description: descByName.get(members[i]) };
        const b = { name: members[j], description: descByName.get(members[j]) };
        const r = await judgePair(a, b);
        pairsJudged++;
        if (r.verdict === 'dup') { pairsDup++; edges.push([members[i], members[j]]); }
        else pairsDistinct++;
        pairResults.push({ group: gi, a: members[i], b: members[j], verdict: r.verdict, reason: r.reason });
      }
    }
    // 连通分量
    const comps = connectedComponents(members, edges);
    for (const comp of comps) {
      if (comp.length >= 2) refinedGroups.push(comp);
    }
    process.stdout.write('.');
  }
  console.log('');

  // 精炼组内按 composite 选 canonical
  const refinedDetailed = refinedGroups.map(g => {
    const members = g.map(n => ({ name: n, composite: scoreByName.get(n).composite }))
      .sort((a, b) => b.composite - a.composite);
    return { canonical: members[0].name, canonicalScore: members[0].composite, redundant: members.slice(1).map(m => m.name) };
  });
  const totalRedundant = refinedDetailed.reduce((a, g) => a + g.redundant.length, 0);

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    method: '片2 粗分组 -> 逐对 pairwise dup-judge (关 thinking) -> 确认的对取连通分量重组成组',
    inputGroups: candidateGroups.length,
    inputRedundant: dedup.totalRedundantSkills,
    pairsJudged,
    pairsDup,
    pairsDistinct,
    refinedGroupCount: refinedDetailed.length,
    refinedRedundant: totalRedundant,
    refinedRate: +(totalRedundant / manifest.length).toFixed(3),
    note: '逐对确认修过并：失败保守判 distinct（不过并）。连通分量=确认 dup 对的传递闭包',
    refinedGroups: refinedDetailed,
    pairResults,
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== 去重逐对确认 receipt ===');
  console.log(`输入: ${candidateGroups.length} 组 / ${dedup.totalRedundantSkills} 冗余（片2 粗分组）`);
  console.log(`逐对: ${pairsJudged} 对（${pairsDup} dup / ${pairsDistinct} distinct）`);
  console.log(`精炼: ${refinedDetailed.length} 组 / ${totalRedundant} 冗余 (${(result.refinedRate * 100).toFixed(1)}%)`);
  console.log(`过并修正: ${candidateGroups.length} 组 -> ${refinedDetailed.length} 组（过并的跨功能对被拒，组散开）\n`);
  for (const g of refinedDetailed) {
    console.log(`  [canonical: ${g.canonical} (${g.canonicalScore})] 冗余: ${g.redundant.join(', ')}`);
  }
  console.log(`\nreceipt: ${OUT}`);
}

main();
