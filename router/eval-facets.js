// facets receipt 评估器 -- L0 vs L0∪facets 对比（第二个 receipt 的度量）。
//
// claim（可证伪）：facets 横切标签补 spine 漏的横切题 -> recall 升、precision 可控。
// receipt = 同测试集上 L0-only vs L0∪facets 的 macro P/R/F1，阈值扫描 + 每题明细。
// 正 receipt（recall 升 precision 可控）或负 receipt（过载 precision 崩 / 没补召回）都诚实记录。

const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');
const { loadFacets, routeWithFacets } = require('./route-facets');

const TESTSET = path.join(__dirname, '..', 'testset-facets.json');
const OUT = path.join(__dirname, '..', 'results', 'facets.json');
const THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7];

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
    (acc, row) => ({ p: acc.p + row.precision, r: acc.r + row.recall, f: acc.f + row.f1 }),
    { p: 0, r: 0, f: 0 }
  );
  return { precision: sum.p / rows.length, recall: sum.r / rows.length, f1: sum.f / rows.length };
}

function main() {
  const index = buildIndex();
  const facets = loadFacets();
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));

  const perQuery = cases.map(c => {
    const l0 = route(c.query, index, 0);
    const fc = routeWithFacets(c.query, index, facets, 0);
    return { query: c.query, expected: c.expected, l0Matched: l0.matched, fcMatched: fc.matched, tagHits: fc.tagHits };
  });

  // 阈值扫描：L0 vs L0∪facets
  const sweep = THRESHOLDS.map(t => {
    const l0Rows = perQuery.map(q => prf(q.l0Matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
    const fcRows = perQuery.map(q => prf(q.fcMatched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
    return { threshold: t, l0: macro(l0Rows), facets: macro(fcRows) };
  });

  // 各自最佳 F1（独立选阈值，公平比上界）
  const l0Best = sweep.reduce((b, s) => (s.l0.f1 > b.l0.f1 ? s : b), sweep[0]);
  const fcBest = sweep.reduce((b, s) => (s.facets.f1 > b.facets.f1 ? s : b), sweep[0]);

  const detail = perQuery.map(q => {
    const l0p = q.l0Matched.filter(m => m.confidence >= l0Best.threshold).map(m => m.path);
    const fcp = q.fcMatched.filter(m => m.confidence >= fcBest.threshold).map(m => m.path);
    return {
      query: q.query,
      expected: q.expected,
      tagHits: q.tagHits,
      l0Predicted: l0p,
      facetsPredicted: fcp,
      l0: prf(l0p, q.expected),
      facets: prf(fcp, q.expected),
    };
  });

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'corpus/*.md (13 files)',
    claim: 'facets 横切标签补 spine 漏的横切题 -> recall 升、precision 可控',
    facetConf: facets.facetConf,
    testsetSize: cases.length,
    sweep,
    l0Best: { threshold: l0Best.threshold, precision: +l0Best.l0.precision.toFixed(3), recall: +l0Best.l0.recall.toFixed(3), f1: +l0Best.l0.f1.toFixed(3) },
    facetsBest: { threshold: fcBest.threshold, precision: +fcBest.facets.precision.toFixed(3), recall: +fcBest.facets.recall.toFixed(3), f1: +fcBest.facets.f1.toFixed(3) },
    delta: {
      precision: +(fcBest.facets.precision - l0Best.l0.precision).toFixed(3),
      recall: +(fcBest.facets.recall - l0Best.l0.recall).toFixed(3),
      f1: +(fcBest.facets.f1 - l0Best.l0.f1).toFixed(3),
    },
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('=== facets receipt: L0 vs L0∪facets ===');
  console.log(`测试集: ${cases.length} 题  facetConf: ${facets.facetConf}  (各路由独立选最佳阈值)`);
  console.log('\n阈值扫描 (macro):');
  console.log('  thr    L0-P   L0-R   L0-F1   FC-P   FC-R   FC-F1');
  for (const s of sweep) {
    console.log(
      `  ${s.threshold.toFixed(2)}  ${s.l0.precision.toFixed(3)} ${s.l0.recall.toFixed(3)} ${s.l0.f1.toFixed(3)}  ${s.facets.precision.toFixed(3)} ${s.facets.recall.toFixed(3)} ${s.facets.f1.toFixed(3)}`
    );
  }
  console.log(`\nL0 best:     thr=${l0Best.threshold}  P=${result.l0Best.precision} R=${result.l0Best.recall} F1=${result.l0Best.f1}`);
  console.log(`facets best: thr=${fcBest.threshold}  P=${result.facetsBest.precision} R=${result.facetsBest.recall} F1=${result.facetsBest.f1}`);
  console.log(`Δ  P=${result.delta.precision}  R=${result.delta.recall}  F1=${result.delta.f1}`);
  console.log('\n每题明细 (各最佳阈值):');
  for (const d of detail) {
    const flag = d.facets.f1 > d.l0.f1 ? '↑' : d.facets.f1 < d.l0.f1 ? '↓' : '=';
    console.log(`  ${flag} L0[P${d.l0.precision.toFixed(2)}/R${d.l0.recall.toFixed(2)}] FC[P${d.facets.precision.toFixed(2)}/R${d.facets.recall.toFixed(2)}] [tag:${d.tagHits.join(',') || '-'}]  ${d.query}`);
    console.log(`      exp:[${d.expected.join(',')}]  L0:[${d.l0Predicted.join(',')}]  FC:[${d.facetsPredicted.join(',')}]`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
