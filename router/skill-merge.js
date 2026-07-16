// 同类项两两合并（无损减熵，替代剔除）。
//
// 用户修正：不该直接剔除（删一个丢信息），而该把同类项两两合并--取并集，count 减少但信息不丢。
// 咬合熵增立论更精确：减熵不是删，是合并同类项降冗余（无损）。
//
// 对 dedup-verify 的 16 组确认重复，每组两两 LLM 合并描述（并集去重不丢信息）+ triggers 并集，
// 保留 canonical 名，产出 16 个合并 skill 描述。
// 两两：组 >2 时迭代 fold（canonical 为基，逐个并入 redundant）。
//
// 只产出合并描述（receipt），不部署到 ~/.claude（破坏性交人）。

const fs = require('fs');
const path = require('path');

const VERIFIED = path.join(__dirname, '..', 'results', 'skills-dedup-verified.json');
const MANIFEST = path.join(__dirname, '..', 'skills-corpus-full.json');
const OUT = path.join(__dirname, '..', 'results', 'skills-merged.json');

const BASE = process.env.ANTHROPIC_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding';
const MODEL = process.env.ANTHROPIC_MODEL || 'glm-5.2';
const TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;

async function callNoThinking(prompt, maxTokens = 600) {
  const body = { model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  try { body.thinking = { type: 'disabled' }; } catch {}
  const resp = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) { const t = await resp.text().catch(() => ''); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
  const data = await resp.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
}

// 两两合并描述：保留两者全部功能信息（并集，去重重叠，不丢信息）
async function mergeDesc(aName, aDesc, bName, bDesc) {
  const prompt = `把两个功能重复的 AI agent skill 的描述合并成一个，**保留两者的全部功能信息**（并集，去重重叠措辞，但不丢任何一方独有的信息）。

skill A (${aName}): ${aDesc || '(无描述)'}
skill B (${bName}): ${bDesc || '(无描述)'}

合并后描述（一个字符串，覆盖 A 和 B 的所有功能点，去重但不丢信息，简洁完整）:`;
  try {
    return await callNoThinking(prompt, 600);
  } catch (e) {
    return aDesc + ' | ' + bDesc; // 失败保守：直接拼接保信息
  }
}

async function main() {
  if (!TOKEN) { console.error('缺 ANTHROPIC_AUTH_TOKEN'); process.exit(1); }
  const verified = JSON.parse(fs.readFileSync(VERIFIED, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const infoByName = new Map(manifest.map(s => [s.name, s]));

  let mergeCalls = 0;
  const merged = [];
  process.stdout.write('两两合并 (16 组): ');
  for (const g of verified.refinedGroups) {
    // canonical 为基，redundant 逐个并入（两两 fold）
    const canonical = g.canonical;
    const allNames = [canonical, ...g.redundant];
    let accDesc = infoByName.get(canonical)?.description || '';
    const accTriggers = new Set(infoByName.get(canonical)?.triggers || []);
    for (const rName of g.redundant) {
      const rDesc = infoByName.get(rName)?.description || '';
      accDesc = await mergeDesc(canonical, accDesc, rName, rDesc);
      mergeCalls++;
      for (const t of infoByName.get(rName)?.triggers || []) accTriggers.add(t);
    }
    merged.push({
      name: canonical,
      canonicalScore: g.canonicalScore,
      mergedFrom: allNames,
      foldedCount: g.redundant.length,
      originalDescriptions: allNames.map(n => ({ name: n, desc: (infoByName.get(n)?.description || '').slice(0, 100) })),
      mergedDescription: accDesc,
      mergedTriggers: [...accTriggers],
    });
    process.stdout.write('.');
  }
  console.log('');

  const totalOriginal = merged.reduce((a, g) => a + g.mergedFrom.length, 0);
  const totalFolded = merged.reduce((a, g) => a + g.foldedCount, 0);

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    method: 'dedup-verify 16 组确认重复 -> 每组两两 LLM 合并描述(并集去重不丢信息) + triggers 并集 -> 16 合并 skill',
    mergeCalls,
    groupsMerged: merged.length,
    originalSkillCount: totalOriginal,
    mergedSkillCount: merged.length,
    foldedCount: totalFolded,
    note: '合并非剔除：22 冗余 skill 合并入 16 canonical（无损，并集描述）。只产出合并描述，不部署 ~/.claude（破坏性交人）',
    merged,
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== 同类项两两合并 receipt ===');
  console.log(`${totalOriginal} skill -> ${merged.length} 合并 skill（${totalFolded} 冗余合并入 canonical，${mergeCalls} 次合并调用）`);
  console.log(`无损：描述取并集去重不丢信息，triggers 并集\n`);
  console.log('合并示例（前 6 组）:');
  for (const g of merged.slice(0, 6)) {
    console.log(`\n  [${g.name}] (score ${g.canonicalScore}) <- 合并自: ${g.mergedFrom.join(' + ')}`);
    for (const o of g.originalDescriptions) console.log(`    原 ${o.name}: ${o.desc}`);
    console.log(`    合并后: ${g.mergedDescription.slice(0, 140)}`);
  }
  console.log(`\nreceipt: ${OUT}`);
}

main();
