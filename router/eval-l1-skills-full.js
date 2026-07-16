// 全量 skill L1 评估器：在 325 个去重 skill 上跑两阶段 L1，对比 L0-full baseline。
// 复用 routeL1Skills（路由逻辑不变，只换语料）-- 纯粹测规模效应。
// receipt 问题：325-scale 下 L0 零匹配消失（每题都有候选），L1 两阶段（judge+retrieve 兜底）能否守住 P/R。

const fs = require('fs');
const path = require('path');
const { buildSkillIndex } = require('./router');
const { routeL1Skills, buildSkillDescriptors, loadAllSkills } = require('./l1-skills');
const { cacheStats } = require('./llm');

const MANIFEST = path.join(__dirname, '..', 'skills-corpus-full.json');
const TESTSET = path.join(__dirname, '..', 'testset-skills.json');
const L0_FULL = path.join(__dirname, '..', 'results', 'skills-l0-full.json');
const OUT = path.join(__dirname, '..', 'results', 'l1-skills-full.json');
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

function macro(rows) {
  if (rows.length === 0) return { precision: 0, recall: 0, f1: 0 };
  const sum = rows.reduce(
    (a, r) => ({ p: a.p + r.precision, r: a.r + r.recall, f: a.f + r.f1 }),
    { p: 0, r: 0, f: 0 }
  );
  return { precision: sum.p / rows.length, recall: sum.r / rows.length, f1: sum.f / rows.length };
}

async function main() {
  const index = buildSkillIndex(MANIFEST);
  const descriptors = buildSkillDescriptors(MANIFEST);
  const allSkills = loadAllSkills(MANIFEST);
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));
  const l0f = JSON.parse(fs.readFileSync(L0_FULL, 'utf8'));

  const detail = [];
  let retrieveCount = 0;
  let zeroL0 = 0;
  process.stdout.write('跑 L1 全量 skill 评估 (两阶段, 325 skill): ');
  for (const c of cases) {
    const r = await routeL1Skills(c.query, index, descriptors, allSkills, L0_THRESHOLD);
    if (r.l0Candidates.length === 0) zeroL0++;
    const predicted = r.l1Loaded;
    const m = prf(predicted, c.expected);
    if (r.mode.includes('retrieve')) retrieveCount++;
    detail.push({
      query: c.query,
      expected: c.expected,
      predicted,
      mode: r.mode,
      reason: r.reason,
      l0CandidateCount: r.l0Candidates.length,
      judged: r.judged.map(j => ({
        path: j.path,
        conf: +j.confidence.toFixed(3),
        verdict: j.verdict,
        reason: j.reason,
      })),
      precision: +m.precision.toFixed(3),
      recall: +m.recall.toFixed(3),
      f1: +m.f1.toFixed(3),
      tp: m.tp,
      fp: m.fp,
      fn: m.fn,
    });
    const flag = m.precision === 1 && m.recall === 1 ? '✓' : '✗';
    process.stdout.write(flag);
  }
  console.log('');

  const M = macro(detail);
  const l0 = l0f.macroAtBest;

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'skills-corpus-full.json (325 unique skills: 108 personal + 7 gstack + 193 marketplace + 17 cache)',
    router: 'L1 two-stage (judge + semantic-retrieve), glm-5.2 via ARK -- 路由逻辑与 70-skill L1 完全相同',
    testsetSize: cases.length,
    corpusSize: index.N,
    l0Threshold: L0_THRESHOLD,
    l0ZeroMatchQueries: zeroL0,
    macro: { precision: +M.precision.toFixed(3), recall: +M.recall.toFixed(3), f1: +M.f1.toFixed(3) },
    l0FullBaselineMacro: l0,
    delta: {
      precision: +(M.precision - l0.precision).toFixed(3),
      recall: +(M.recall - l0.recall).toFixed(3),
      f1: +(M.f1 - l0.f1).toFixed(3),
    },
    llmJudgeCalls: cacheStats().size,
    llmRetrieveCalls: retrieveCount,
    note: `325-scale: L0 零匹配题=${zeroL0}（70-skill 时=10）。每题都有候选 -> 走 judge；跨语言题候选全被滤 -> judge+retrieve 兜底`,
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== L1 全量 skill 路由器评估 ===');
  console.log(`语料: ${result.corpusSize} skill  测试集: ${result.testsetSize} 题`);
  console.log(`L0 零匹配题: ${zeroL0}/20 (70-skill baseline 时 10/20)`);
  console.log(`LLM 调用: ${result.llmJudgeCalls} judge + ${result.llmRetrieveCalls} retrieve = ${result.llmJudgeCalls + result.llmRetrieveCalls} 次`);
  console.log('\nL0-full baseline vs L1-full (macro):');
  console.log(`  L0   P=${l0.precision}  R=${l0.recall}  F1=${l0.f1}`);
  console.log(`  L1   P=${M.precision.toFixed(3)}  R=${M.recall.toFixed(3)}  F1=${M.f1.toFixed(3)}`);
  console.log(`  Δ    P=${result.delta.precision >= 0 ? '+' : ''}${result.delta.precision}  R=${result.delta.recall >= 0 ? '+' : ''}${result.delta.recall}  F1=${result.delta.f1 >= 0 ? '+' : ''}${result.delta.f1}`);
  console.log('\n每题明细:');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${flag} [${d.mode}] P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [pred: ${d.predicted.join(',').slice(0,50) || '-'}] [exp: ${d.expected.join(',')}]  ${d.query}`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
