// L1 评估器：跑 testset，L0 候选 -> L1 LLM 判 -> 算 P/R/F1，对比 L0 baseline。
// 输出 = 路由器第 2 个 receipt（L0 三个 receipt 之后的语义层 receipt）。
//
// L1 是 yes/no 二值判定（无阈值扫描）；L0 候选门槛 l0Threshold 固定 0.05（保 recall 让 L1 滤）。
// predicted = l1Loaded（verdict=yes 的）。对比 L0 baseline(results/l0-v2-multilabel.json) 的 macroAtBest。
//
// 诚实限制：L1 只在 L0 候选上判，无法补 L0 漏召回（L0 recall 92% 的 2 题语义漏，L1 救不了）。
// 这是「先 precision 过滤」切片；recall 补充（LLM 提名 L0 漏的）留后续。

const fs = require('fs');
const path = require('path');
const { buildIndex } = require('./router');
const { routeL1, buildDescriptors } = require('./l1');
const { cacheStats } = require('./llm');

const TESTSET = path.join(__dirname, '..', 'testset.json');
const L0_BASELINE = path.join(__dirname, '..', 'results', 'l0-v2-multilabel.json');
const OUT = path.join(__dirname, '..', 'results', 'l1-llm.json');
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
  const index = buildIndex();
  const descriptors = buildDescriptors();
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));
  const l0baseline = JSON.parse(fs.readFileSync(L0_BASELINE, 'utf8'));

  const detail = [];
  process.stdout.write('跑 L1 评估 (每题调 LLM 判候选): ');
  for (const c of cases) {
    const r = await routeL1(c.query, index, descriptors, L0_THRESHOLD);
    const predicted = r.l1Loaded;
    const m = prf(predicted, c.expected);
    detail.push({
      query: c.query,
      expected: c.expected,
      predicted,
      l0Candidates: r.l0Candidates,
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
  const l0 = l0baseline.macroAtBest;

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'corpus/*.md (13 files)',
    router: 'L1 LLM judge (glm-5.2 via ARK coding), L0 candidates @ thr 0.05',
    testsetSize: cases.length,
    l0Threshold: L0_THRESHOLD,
    macro: { precision: +M.precision.toFixed(3), recall: +M.recall.toFixed(3), f1: +M.f1.toFixed(3) },
    l0BaselineMacro: l0,
    delta: {
      precision: +(M.precision - l0.precision).toFixed(3),
      recall: +(M.recall - l0.recall).toFixed(3),
      f1: +(M.f1 - l0.f1).toFixed(3),
    },
    llmCalls: cacheStats().size,
    note: 'L1 只在 L0 候选上判，无法补 L0 漏召回；先 precision 过滤切片',
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== L1 路由器评估 ===');
  console.log(`语料: ${result.corpus}  测试集: ${result.testsetSize} 题  L0候选阈值: ${L0_THRESHOLD}`);
  console.log(`LLM 调用: ${result.llmCalls} 次`);
  console.log('\nL0 baseline vs L1 (macro):');
  console.log(`  L0   P=${l0.precision}  R=${l0.recall}  F1=${l0.f1}`);
  console.log(`  L1   P=${M.precision.toFixed(3)}  R=${M.recall.toFixed(3)}  F1=${M.f1.toFixed(3)}`);
  console.log(`  Δ    P=${result.delta.precision >= 0 ? '+' : ''}${result.delta.precision}  R=${result.delta.recall >= 0 ? '+' : ''}${result.delta.recall}  F1=${result.delta.f1 >= 0 ? '+' : ''}${result.delta.f1}`);
  console.log('\n每题明细:');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${flag} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [pred: ${d.predicted.join(',') || '-'}] [exp: ${d.expected.join(',')}]  ${d.query}`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
