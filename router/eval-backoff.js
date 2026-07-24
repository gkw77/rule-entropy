// 退一格 receipt 评估器 -- L0 vs L0+退一格 对比（第 17 个 receipt）。
//
// claim（可证伪，受 corpus 扁平限制收窄）：模糊/总览题（L0 top conf 低）退树根 00-pipeline 补召回，
// 明确题（top conf 高）不触发不污染。扫 lowConfThreshold，对比 L0 baseline。
// corpus 限制：当前扁平，只退树根；多层树价值留后续。

const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');
const { loadTree, routeWithBackoff } = require('./route-backoff');

const TESTSET = path.join(__dirname, '..', 'testset-backoff.json');
const OUT = path.join(__dirname, '..', 'results', 'backoff.json');
const THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];

function prf(predicted, expected) {
  const P = new Set(predicted);
  const E = new Set(expected);
  let tp = 0;
  for (const e of E) if (P.has(e)) tp++;
  const precision = P.size === 0 ? 0 : tp / P.size;
  const recall = E.size === 0 ? 1 : tp / E.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function macro(rows) {
  if (rows.length === 0) return { precision: 0, recall: 0, f1: 0 };
  const sum = rows.reduce(
    (acc, row) => ({ p: acc.p + row.precision, r: acc.r + row.recall, f: acc.f + row.f1 }),
    { p: 0, r: 0, f: 0 }
  );
  return { precision: sum.p / rows.length, recall: sum.r / rows.length, f1: sum.f / rows.length };
}

function main() {
  const index = buildIndex();
  const tree = loadTree();
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));

  // L0 baseline
  const l0PerQuery = cases.map(c => ({ expected: c.expected, matched: route(c.query, index, 0).matched }));
  const l0Sweep = THRESHOLDS.map(t => {
    const rows = l0PerQuery.map(q => prf(q.matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
    return { threshold: t, ...macro(rows) };
  });
  const l0Best = l0Sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), l0Sweep[0]);

  // 退一格扫 lowConfThreshold
  const lctVals = [0.15, 0.2, 0.25];
  const boCombos = [];
  for (const lct of lctVals) {
    const perQuery = cases.map(c => {
      const r = routeWithBackoff(c.query, index, tree, 0, { lowConfThreshold: lct, backoffConf: 0.3 });
      return { expected: c.expected, matched: r.matched, backoffTriggered: r.backoffTriggered };
    });
    const sweep = THRESHOLDS.map(t => {
      const rows = perQuery.map(q => prf(q.matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
      return { threshold: t, ...macro(rows) };
    });
    const best = sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), sweep[0]);
    boCombos.push({ lowConfThreshold: lct, bestThreshold: best.threshold, precision: best.precision, recall: best.recall, f1: best.f1, perQuery });
  }
  const boBest = boCombos.reduce((b, c) => (c.f1 > b.f1 ? c : b), boCombos[0]);

  // 每题明细（boBest + L0 各自最佳阈值）
  const detail = cases.map((c, i) => {
    const l0pred = l0PerQuery[i].matched.filter(m => m.confidence >= l0Best.threshold).map(m => m.path);
    const bopred = boBest.perQuery[i].matched.filter(m => m.confidence >= boBest.bestThreshold).map(m => m.path);
    return {
      query: c.query,
      expected: c.expected,
      backoffTriggered: boBest.perQuery[i].backoffTriggered,
      l0Predicted: l0pred,
      boPredicted: bopred,
      l0: prf(l0pred, c.expected),
      bo: prf(bopred, c.expected),
    };
  });

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    claim: '退一格：模糊题(top conf 低)退树根 00-pipeline 补召回，明确题(top 高)不触发不污染',
    corpusLimit: '当前 corpus 扁平，退一格只退树根；多层树（叶子->阶段父）价值未验，留后续 corpus 扩 L2',
    testsetSize: cases.length,
    l0Baseline: { threshold: l0Best.threshold, precision: +l0Best.precision.toFixed(3), recall: +l0Best.recall.toFixed(3), f1: +l0Best.f1.toFixed(3) },
    backoffBest: { lowConfThreshold: boBest.lowConfThreshold, threshold: boBest.bestThreshold, precision: +boBest.precision.toFixed(3), recall: +boBest.recall.toFixed(3), f1: +boBest.f1.toFixed(3) },
    delta: { precision: +(boBest.precision - l0Best.precision).toFixed(3), recall: +(boBest.recall - l0Best.recall).toFixed(3), f1: +(boBest.f1 - l0Best.f1).toFixed(3) },
    allCombos: boCombos.map(c => ({ lowConfThreshold: c.lowConfThreshold, threshold: c.bestThreshold, P: +c.precision.toFixed(3), R: +c.recall.toFixed(3), F1: +c.f1.toFixed(3) })),
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('=== 退一格 receipt: L0 vs L0+退一格 ===');
  console.log(`L0 baseline:        thr=${l0Best.threshold}  P=${result.l0Baseline.precision} R=${result.l0Baseline.recall} F1=${result.l0Baseline.f1}`);
  console.log(`退一格最佳(lct=${boBest.lowConfThreshold}): thr=${boBest.bestThreshold}  P=${result.backoffBest.precision} R=${result.backoffBest.recall} F1=${result.backoffBest.f1}`);
  console.log(`Δ:  P=${result.delta.precision}  R=${result.delta.recall}  F1=${result.delta.f1}`);
  console.log('\n组合 (lct=lowConfThreshold):');
  console.log('  lct   thr   P      R      F1');
  for (const c of result.allCombos) console.log(`  ${c.lowConfThreshold.toFixed(2)}  ${c.threshold.toFixed(2)}  ${c.P}  ${c.R}  ${c.F1}`);
  console.log('\n每题 (L0 与 退一格 各最佳阈值):');
  for (const d of detail) {
    const flag = d.bo.f1 > d.l0.f1 ? '↑' : d.bo.f1 < d.l0.f1 ? '↓' : '=';
    const trig = d.backoffTriggered ? '退' : '--';
    console.log(`  ${flag} [${trig}] L0[P${d.l0.precision.toFixed(2)}/R${d.l0.recall.toFixed(2)}] BO[P${d.bo.precision.toFixed(2)}/R${d.bo.recall.toFixed(2)}]  ${d.query}`);
    console.log(`        exp:[${d.expected.join(',')}]  L0:[${d.l0Predicted.join(',')}]  BO:[${d.boPredicted.join(',')}]`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
