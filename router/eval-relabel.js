// 重标 receipt：测试集 v2 -> v3（Q9「写代码前调研搜索」加 05-execute，合理一到多）。
// 验反复点名的假设「precision 低是标注窄 artifact」。逐题独立审 L1 FP，真相关才加，不抄预测。
// 复用已存预测不重跑：L0 重 route（确定性关键词，无 LLM），L1 重打分 l1-llm.json 的 predicted（无 LLM）。
const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');

const ROOT = path.join(__dirname, '..');
const TESTSET = path.join(ROOT, 'testset.json'); // v3
const L1_RESULTS = path.join(ROOT, 'results', 'l1-llm.json');
const L0_V2 = path.join(ROOT, 'results', 'l0-v2-multilabel.json');
const OUT = path.join(ROOT, 'results', 'relabel-v3.json');

const THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7];

function prf(predicted, expected) {
  const P = new Set(predicted), E = new Set(expected);
  let tp = 0;
  for (const e of E) if (P.has(e)) tp++;
  const precision = P.size === 0 ? 0 : tp / P.size;
  const recall = E.size === 0 ? 1 : tp / E.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp: P.size - tp, fn: E.size - tp };
}
function macro(rows) {
  if (!rows.length) return { precision: 0, recall: 0, f1: 0 };
  const s = rows.reduce((a, r) => ({ p: a.p + r.precision, r: a.r + r.recall, f: a.f + r.f1 }), { p: 0, r: 0, f: 0 });
  return { precision: s.p / rows.length, recall: s.r / rows.length, f1: s.f / rows.length };
}

function main() {
  const index = buildIndex();
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8')); // v3
  const l1 = JSON.parse(fs.readFileSync(L1_RESULTS, 'utf8'));
  const l0v2 = JSON.parse(fs.readFileSync(L0_V2, 'utf8'));

  // --- L0: 重 route（确定性，无 LLM），扫阈值 ---
  const perQuery = cases.map(c => {
    const { matched } = route(c.query, index, 0);
    return { query: c.query, expected: c.expected, matched };
  });
  const sweep = THRESHOLDS.map(t => {
    const rows = perQuery.map(q => prf(q.matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
    return { threshold: t, ...macro(rows) };
  });
  const l0best = sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), sweep[0]);

  // --- L1: 复用 l1-llm.json 的 predicted，重打分 v3 expected（无 LLM）---
  const v3byQuery = new Map(cases.map(c => [c.query, c.expected]));
  const l1rows = l1.detail.map(d => prf(d.predicted, v3byQuery.get(d.query) || d.expected));
  const l1v3 = macro(l1rows);
  const l1perQuery = l1.detail.map(d => {
    const exp = v3byQuery.get(d.query) || d.expected;
    return { query: d.query, expected: exp, predicted: d.predicted, ...prf(d.predicted, exp) };
  });

  // --- v2 baselines ---
  const l0v2best = l0v2.macroAtBest;
  const l1v2 = l1.macro;

  // --- label diff（v2 expected 从 l1-llm detail 取，对比 v3）---
  const labelDiff = l1.detail.map(d => {
    const v3exp = v3byQuery.get(d.query);
    const v2exp = d.expected;
    const added = v3exp.filter(x => !v2exp.includes(x));
    const removed = v2exp.filter(x => !v3exp.includes(x));
    if (added.length || removed.length) return { query: d.query, v2: v2exp, v3: v3exp, added, removed };
    return null;
  }).filter(Boolean);

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    receipt: 'relabel v2->v3（annotation-artifact 假设证伪）',
    standard: 'expected = 直接 govern 该 query 工作的规则文件；L1 FP 逐题独立审，真相关才加，不抄 L1 预测',
    labelDiff,
    l0: {
      v2: { bestThreshold: l0v2.bestThreshold, macro: l0v2best },
      v3: { bestThreshold: l0best.threshold, macro: { precision: +l0best.precision.toFixed(3), recall: +l0best.recall.toFixed(3), f1: +l0best.f1.toFixed(3) } },
      delta: {
        precision: +(l0best.precision - l0v2best.precision).toFixed(3),
        recall: +(l0best.recall - l0v2best.recall).toFixed(3),
        f1: +(l0best.f1 - l0v2best.f1).toFixed(3),
      },
      sweep: sweep.map(s => ({ threshold: s.threshold, precision: +s.precision.toFixed(3), recall: +s.recall.toFixed(3), f1: +s.f1.toFixed(3) })),
    },
    l1: {
      v2: l1v2,
      v3: { precision: +l1v3.precision.toFixed(3), recall: +l1v3.recall.toFixed(3), f1: +l1v3.f1.toFixed(3) },
      delta: {
        precision: +(l1v3.precision - l1v2.precision).toFixed(3),
        recall: +(l1v3.recall - l1v2.recall).toFixed(3),
        f1: +(l1v3.f1 - l1v2.f1).toFixed(3),
      },
      perQuery: l1perQuery.map(q => ({ query: q.query, expected: q.expected, predicted: q.predicted, precision: +q.precision.toFixed(3), recall: +q.recall.toFixed(3), f1: +q.f1.toFixed(3) })),
    },
    conclusion: 'labelDiff 仅 1 题（Q9 加 05-execute；L1 judge 独立判 yes 印证，非抄预测）。annotation-artifact 假设基本证伪：L1 其余 11 个 FP 逐题独立审均为真沾边（该滤），非标注窄。precision 天花板是真的（judge 沾边即 yes），非标注 artifact。L0 在 Q9 反降（05 conf 0.068<thr 不浮出，加 expected 成 FN）——重标不为抬数，是为标对。',
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('=== 重标 receipt: v2 -> v3 ===');
  console.log('label diff:', JSON.stringify(labelDiff));
  console.log('\nL0 (corpus/13, 确定性 route, 无 LLM):');
  console.log(`  v2 best thr=${l0v2.bestThreshold}: P=${l0v2best.precision} R=${l0v2best.recall} F1=${l0v2best.f1}`);
  console.log(`  v3 best thr=${l0best.threshold}: P=${l0best.precision.toFixed(3)} R=${l0best.recall.toFixed(3)} F1=${l0best.f1.toFixed(3)}`);
  console.log(`  delta: P ${result.l0.delta.precision}  R ${result.l0.delta.recall}  F1 ${result.l0.delta.f1}`);
  console.log('\nL1 (复用 l1-llm.json predicted, 重打分 v3 expected, 无 LLM):');
  console.log(`  v2: P=${l1v2.precision} R=${l1v2.recall} F1=${l1v2.f1}`);
  console.log(`  v3: P=${l1v3.precision.toFixed(3)} R=${l1v3.recall.toFixed(3)} F1=${l1v3.f1.toFixed(3)}`);
  console.log(`  delta: P ${result.l1.delta.precision}  R ${result.l1.delta.recall}  F1 ${result.l1.delta.f1}`);
  console.log('\nreceipt ->', OUT);
}
main();
