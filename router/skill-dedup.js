// skill 语义去重（片 2，LLM 批量分组）。
// 片 1 的 IDF-独特性只抓到破损 skill，抓不到语义重复（不同名但同功能的 skill）。
// 把 325 个 skill 喂 LLM 分组"做同一件事的"，簇内按片 1 评分选 canonical，余为剔除候选。
// receipt：多少重复簇、多少剪枝候选。咬合"剔除重复赘余"。
//
// 只识别候选，不自动剪 ~/.claude（破坏性，交人拍板）-- augment-not-automate。

const fs = require('fs');
const path = require('path');
const { callMessages } = require('./llm');

const MANIFEST = path.join(__dirname, '..', 'skills-corpus-full.json');
const SCORED = path.join(__dirname, '..', 'results', 'skills-scored.json');
const OUT = path.join(__dirname, '..', 'results', 'skills-dedup.json');

// glm-5.2 是 thinking 模型，325 skill 去重若开 thinking 会吃光 token 预算没产出 text。
// 直接 fetch 关闭 thinking（去重只要 JSON 不用推理过程）+ 大 max_tokens。
const BASE = process.env.ANTHROPIC_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding';
const MODEL = process.env.ANTHROPIC_MODEL || 'glm-5.2';
const TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;

async function callNoThinking(prompt, maxTokens = 8000) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  // 尝试关 thinking（ARK glm-5.2 支持则生效，不支持则忽略不报错）
  try { body.thinking = { type: 'disabled' }; } catch {}
  const resp = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
  return { text, usage: data.usage };
}

async function groupDuplicates(manifest) {
  // 325 skill 塞一个 prompt（~9K tokens，glm-5.2 128K 扛得住）
  const list = manifest
    .map(s => `${s.name}: ${s.description || '(无描述)'}`)
    .join('\n');
  const prompt = `以下是 ${manifest.length} 个 AI agent skill（每行 name: description）:

${list}

找出其中**功能重复**的 skill 组--即两个或多个 skill 做的是同一件事，留着多个是赘余。
判断标准：核心功能相同（如多个"代码审查"skill、多个"建 MCP"skill）才算重复； merely 相关/互补（如"写测试"vs"跑测试"）不算重复，不要并组。

只返回 JSON 数组，每个元素是一个重复组的 skill name 数组（>=2 个）。没有重复就返回 []。不要任何其它内容、不要解释。
示例: [["review","code-review-and-quality","pre-landing-review"],["build-mcp-server","build-mcp-app","build-mcpb"]]`;

  const { text, usage } = await callNoThinking(prompt, 8000);
  let groups = [];
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) groups = arr.filter(g => Array.isArray(g) && g.length >= 2);
  } catch {}
  // 容错：正则提 JSON 数组
  if (groups.length === 0) {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      try { groups = JSON.parse(m[0]).filter(g => Array.isArray(g) && g.length >= 2); } catch {}
    }
  }
  return { groups, raw: text, usage };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const scored = JSON.parse(fs.readFileSync(SCORED, 'utf8'));
  const scoreByName = new Map(scored.all.map(s => [s.name, s]));

  if (!process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error('缺 ANTHROPIC_AUTH_TOKEN'); process.exit(1);
  }

  console.log(`跑语义去重: ${manifest.length} skill 喂 LLM 分组...`);
  const { groups, raw, usage } = await groupDuplicates(manifest);
  console.log(`LLM 返回 ${groups.length} 个重复组，usage:`, usage);

  // 校验组内 name 都存在，簇内按 composite 选 canonical
  const validGroups = groups
    .map(g => g.filter(n => scoreByName.has(n)))
    .filter(g => g.length >= 2);

  const detailed = validGroups.map(g => {
    const members = g.map(n => ({ name: n, composite: scoreByName.get(n).composite, source: scoreByName.get(n).source }))
      .sort((a, b) => b.composite - a.composite);
    const canonical = members[0];
    const redundant = members.slice(1);
    return { canonical: canonical.name, canonicalScore: canonical.composite, redundant: redundant.map(m => m.name), redundantScores: redundant.map(m => m.composite), all: members };
  });

  const totalRedundant = detailed.reduce((a, g) => a + g.redundant.length, 0);

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: `skills-corpus-full.json (${manifest.length} skills)`,
    method: 'LLM (glm-5.2) 一次性分组 325 skill，找功能重复组；簇内按片1 composite 分选 canonical',
    dupGroupCount: detailed.length,
    totalRedundantSkills: totalRedundant,
    pruneCandidateRate: +(totalRedundant / manifest.length).toFixed(3),
    note: '只识别剪枝候选，不自动剪。canonical=簇内最高分，redundant=其余（剔除候选）。LLM 分组可能有漏召/误并，作参考非权威',
    groups: detailed,
    rawLLMResponse: raw.slice(0, 2000),
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== skill 语义去重 receipt ===');
  console.log(`重复组: ${detailed.length}  剔除候选(冗余 skill): ${totalRedundant} / ${manifest.length} = ${result.pruneCandidateRate * 100}%\n`);
  for (const g of detailed) {
    console.log(`  [canonical: ${g.canonical} (${g.canonicalScore})] 冗余: ${g.redundant.map((n, i) => `${n}(${g.redundantScores[i]})`).join(', ')}`);
  }
  console.log(`\nreceipt: ${OUT}`);
}

main();
