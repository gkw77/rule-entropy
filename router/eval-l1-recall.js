// L1+recall 评估器：跑 testset，L0候选+LLM提名 -> L1 judge -> P/R/F1，对比 L1-only。
// 输出 = 路由器 receipt（recall 切片：能否补 L0 漏召回且不伤 precision）。
//
// predicted = l1Loaded（合并集 judge=yes 的）。对比 L1-only(results/l1-llm.json) macro。

const fs = require('fs');
const path = require('path');
const { buildIndex } = require('./router');
const { routeL1Recall } = require('./l1-recall');
const { buildDescriptors } = require('./l1');
const { cacheStats } = require('./llm');

const TESTSET = path.join(__dirname, '..', 'testset.json');
const L1_ONLY = path.join(__dirname, '..', 'results', 'l1-llm.json');
const OUT = path.join(__dirname, '..', 'results', 'l1-recall.json');

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
  const l1only = JSON.parse(fs.readFileSync(L1_ONLY, 'utf8'));

  const detail = [];
  process.stdout.write('跑 L1+recall 评估 (每题: 1 提名 + 候选 judge): ');
  for (const c of cases) {
    const r = await routeL1Recall(c.query, index, descriptors);
    const m = prf(r.l1Loaded, c.expected);
    detail.push({
      query: c.query, expected: c.expected, predicted: r.l1Loaded,
      l0Candidates: r.l0Candidates, nominated: r.nominated,
      judged: r.judged.map(j => ({ path: j.path, verdict: j.verdict, source: j.source, reason: j.reason })),
      precision: +m.precision.toFixed(3), recall: +m.recall.toFixed(3), f1: +m.f1.toFixed(3),
      tp: m.tp, fp: m.fp, fn: m.fn,
    });
    process.stdout.write(m.precision === 1 && m.recall === 1 ? '✓' : '✗');
  }
  console.log('');

  const M = macro(detail);
  const l1 = l1only.macro;
  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'corpus/*.md (13 files)',
    router: 'L1+recall (LLM 提名 L0 漏的 + L1 judge), glm-5.2 via ARK coding',
    testsetSize: cases.length,
    macro: { precision: +M.precision.toFixed(3), recall: +M.recall.toFixed(3), f1: +M.f1.toFixed(3) },
    l1OnlyMacro: l1,
    delta: {
      precision: +(M.precision - l1.precision).toFixed(3),
      recall: +(M.recall - l1.recall).toFixed(3),
      f1: +(M.f1 - l1.f1).toFixed(3),
    },
    llmCalls: cacheStats().size,
    note: 'recall 切片：LLM 提名补 L0 漏召回，再 L1 judge 滤 precision',
    detail,
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log('\n=== L1+recall 路由器评估 ===');
  console.log(`L1-only : P=${l1.precision}  R=${l1.recall}  F1=${l1.f1}`);
  console.log(`L1+recall: P=${M.precision.toFixed(3)}  R=${M.recall.toFixed(3)}  F1=${M.f1.toFixed(3)}`);
  console.log(`Δ        : P=${result.delta.precision >= 0 ? '+' : ''}${result.delta.precision}  R=${result.delta.recall >= 0 ? '+' : ''}${result.delta.recall}  F1=${result.delta.f1 >= 0 ? '+' : ''}${result.delta.f1}`);
  console.log(`LLM 调用: ${result.llmCalls} 次`);
  console.log('\n每题明细 (✓=全对):');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${flag} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [pred:${d.predicted.join(',') || '-'}] [nom:${d.nominated.join(',') || '-'}]  ${d.query}`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
