// L1 + 直接语义检索 评估器（rule 语料，第 20 个 receipt）。
//
// 省成本 + 隔离增量：复用 results/l1-llm.json 已存的 judge verdict（每题 judgeYes = predicted），
// 只新跑 18 次 semanticRetrieveRules，union 后算 P/R/F1。不重跑 116 次 judge。
// 这样测的是「直接语义检索」相对 L1-only 的纯增量，judge 部分零变动可复现（咬合 scalefix/strictjudge
// 的「复用已存 verdict」省成本模式）。
//
// 对比：L0 baseline(results/l0-v2-multilabel.json macroAtBest) + L1-only(results/l1-llm.json macro)。

const fs = require('fs');
const path = require('path');
const { buildDescriptors } = require('./l1');
const { semanticRetrieveRules, loadAllRules } = require('./l1-semantic');

const TESTSET = path.join(__dirname, '..', 'testset.json');
const L1_ONLY = path.join(__dirname, '..', 'results', 'l1-llm.json');
const L0_BASELINE = path.join(__dirname, '..', 'results', 'l0-v2-multilabel.json');
const OUT = path.join(__dirname, '..', 'results', 'l1-semantic.json');

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
  const descriptors = buildDescriptors();
  const allRules = loadAllRules(descriptors);
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));
  const l1only = JSON.parse(fs.readFileSync(L1_ONLY, 'utf8'));
  const l0baseline = JSON.parse(fs.readFileSync(L0_BASELINE, 'utf8'));

  // L1-only detail 按 query 索引（复用其 judgeYes = predicted）
  const l1ByQuery = {};
  for (const d of l1only.detail) l1ByQuery[d.query] = d;

  const detail = [];
  let retrieveCalls = 0;
  process.stdout.write('跑 L1+semantic-retrieve 评估 (复用 judge verdict, 只跑 retrieve): ');
  for (const c of cases) {
    const prev = l1ByQuery[c.query];
    const judgeYes = prev ? prev.predicted : []; // L1-only 的 judge-yes
    const retrieved = await semanticRetrieveRules(c.query, allRules);
    retrieveCalls++;
    const union = [...new Set([...judgeYes, ...retrieved])];
    const m = prf(union, c.expected);
    detail.push({
      query: c.query,
      expected: c.expected,
      judgeYes,
      retrieved,
      predicted: union,
      precision: +m.precision.toFixed(3),
      recall: +m.recall.toFixed(3),
      f1: +m.f1.toFixed(3),
      tp: m.tp, fp: m.fp, fn: m.fn,
    });
    const flag = m.precision === 1 && m.recall === 1 ? '✓' : '✗';
    process.stdout.write(flag);
  }
  console.log('');

  const M = macro(detail);
  const l1 = l1only.macro;
  const l0 = l0baseline.macroAtBest;

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'corpus/*.md (13 files)',
    router: 'L1 judge ∪ 直接语义检索（retrieve 不再 judge），复用 l1-llm.json judge verdict',
    testsetSize: cases.length,
    macro: { precision: +M.precision.toFixed(3), recall: +M.recall.toFixed(3), f1: +M.f1.toFixed(3) },
    l1OnlyMacro: l1,
    l0BaselineMacro: l0,
    deltaVsL1: {
      precision: +(M.precision - l1.precision).toFixed(3),
      recall: +(M.recall - l1.recall).toFixed(3),
      f1: +(M.f1 - l1.f1).toFixed(3),
    },
    llmCalls: retrieveCalls,
    note: '复用 l1-llm.json 的 judge verdict（116 次），只新跑 18 次 semanticRetrieve；测直接语义检索相对 L1-only 的纯增量',
    detail,
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== L1 + 直接语义检索 评估 ===');
  console.log(`语料: ${result.corpus}  测试集: ${result.testsetSize} 题`);
  console.log(`LLM 调用: ${result.llmCalls} 次（仅 retrieve，judge verdict 复用）`);
  console.log('\nL0 baseline vs L1-only vs L1+semantic-retrieve (macro):');
  console.log(`  L0              P=${l0.precision}  R=${l0.recall}  F1=${l0.f1}`);
  console.log(`  L1-only         P=${l1.precision}  R=${l1.recall}  F1=${l1.f1}`);
  console.log(`  L1+sem-retrieve P=${M.precision.toFixed(3)}  R=${M.recall.toFixed(3)}  F1=${M.f1.toFixed(3)}`);
  console.log(`  Δ vs L1-only    P=${result.deltaVsL1.precision>=0?'+':''}${result.deltaVsL1.precision}  R=${result.deltaVsL1.recall>=0?'+':''}${result.deltaVsL1.recall}  F1=${result.deltaVsL1.f1>=0?'+':''}${result.deltaVsL1.f1}`);
  console.log('\n每题明细 ([judge:..] [+retr:..新增检索] [exp:..]):');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    const newRetr = d.retrieved.filter(r => !d.judgeYes.includes(r));
    console.log(`  ${flag} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [judge:${d.judgeYes.join(',')||'-'}] [+retr:${newRetr.join(',')||'-'}] [exp:${d.expected.join(',')}]  ${d.query}`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
