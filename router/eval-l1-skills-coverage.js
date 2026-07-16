// 覆盖度评估：8 题 query 目标 marketplace/cache skill（70-corpus 不存在），
// 验扩到 325 后能路由到原本索引不到的 skill -- 平衡规模 receipt 的价值面。
// 70-corpus 上这些 expected skill 根本不在索引里 -> recall=0 by definition。

const fs = require('fs');
const path = require('path');
const { buildSkillIndex } = require('./router');
const { routeL1Skills, buildSkillDescriptors, loadAllSkills } = require('./l1-skills');
const { cacheStats } = require('./llm');

const MANIFEST = path.join(__dirname, '..', 'skills-corpus-full.json');
const TESTSET = path.join(__dirname, '..', 'testset-skills-scale.json');
const OUT = path.join(__dirname, '..', 'results', 'l1-skills-coverage.json');
const L0_THRESHOLD = 0.05;

function prf(predicted, expected) {
  const P = new Set(predicted);
  const E = new Set(expected);
  let tp = 0;
  for (const e of E) if (P.has(e)) tp++;
  const precision = P.size === 0 ? 0 : tp / P.size;
  const recall = E.size === 0 ? 1 : tp / E.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp: P.size - tp, fn: E.size - tp };
}

async function main() {
  const index = buildSkillIndex(MANIFEST);
  const descriptors = buildSkillDescriptors(MANIFEST);
  const allSkills = loadAllSkills(MANIFEST);
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));

  // 70-corpus 对照：expected 是否存在于 70-skill 索引
  const manifest70 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'skills-corpus.json'), 'utf8'));
  const names70 = new Set(manifest70.map(s => s.name));

  const detail = [];
  process.stdout.write('跑覆盖度 L1 评估 (8 marketplace 题, 325 skill): ');
  for (const c of cases) {
    const r = await routeL1Skills(c.query, index, descriptors, allSkills, L0_THRESHOLD);
    const m = prf(r.l1Loaded, c.expected);
    detail.push({
      query: c.query,
      expected: c.expected,
      in70Corpus: names70.has(c.expected[0]),
      predicted: r.l1Loaded,
      mode: r.mode,
      precision: +m.precision.toFixed(3),
      recall: +m.recall.toFixed(3),
      f1: +m.f1.toFixed(3),
    });
    process.stdout.write(m.recall === 1 ? '✓' : '✗');
  }
  console.log('');

  const found = detail.filter(d => d.recall === 1).length;
  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'skills-corpus-full.json (325 unique skills)',
    testsetSize: cases.length,
    llmCalls: cacheStats().size,
    coverageFound: found,
    coverageRecall: +(found / cases.length).toFixed(3),
    note: '8 题 expected 都是 marketplace/cache skill，70-corpus 不索引 -> 70 上 recall=0 by definition。325 上能找到几个 = 扩展的覆盖价值',
    detail,
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n=== 覆盖度评估 ===`);
  console.log(`8 题 marketplace/cache skill，325-corpus 找回 ${found} 个 (recall=${result.coverageRecall})`);
  console.log(`LLM 调用: ${cacheStats().size}`);
  console.log('\n每题:');
  for (const d of detail) {
    const flag = d.recall === 1 ? '✓' : '✗';
    const in70 = d.in70Corpus ? '(在70)' : '(不在70)';
    console.log(`  ${flag} ${in70} [${d.mode}] [pred: ${d.predicted.join(',') || '-'}] [exp: ${d.expected[0]}]  ${d.query}`);
  }
  console.log(`\nreceipt: ${OUT}`);
}

main();
