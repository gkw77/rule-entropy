// facets precision 修法评估器 -- 降权 + 条件触发（第 16 个 receipt）。
//
// 原 facets（固定 0.5 + 无条件并集）precision 崩（P-0.228）。修法两轴：
//   1. 降权：facets 命中给低分（0.12/0.15 而非 0.5），高阈值时不干扰 L0 强匹配
//   2. 条件触发：L0 top conf >= lowConfTrigger 时不启用 facets（强题纯 L0 保 precision），弱题才 facets 补召回
// 扫 (lowConfTrigger × facetConf) 组合，找最佳，对比 L0 baseline + 原 facets。

const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');
const { loadFacets, routeWithFacets } = require('./route-facets');

const TESTSET = path.join(__dirname, '..', 'testset-facets.json');
const OUT = path.join(__dirname, '..', 'results', 'facets-fix.json');
const THRESHOLDS = [0.05, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];

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
  const facets = loadFacets();
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));

  // L0 baseline
  const l0PerQuery = cases.map(c => ({ expected: c.expected, matched: route(c.query, index, 0).matched }));
  const l0Sweep = THRESHOLDS.map(t => {
    const rows = l0PerQuery.map(q => prf(q.matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
    return { threshold: t, ...macro(rows) };
  });
  const l0Best = l0Sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), l0Sweep[0]);

  // 扫组合
  const lctVals = [0, 0.15, 0.2, 0.25];
  const fcVals = [0.5, 0.12, 0.15];
  const combos = [];
  for (const lct of lctVals) {
    for (const fc of fcVals) {
      const perQuery = cases.map(c => {
        const r = routeWithFacets(c.query, index, facets, 0, { facetConf: fc, lowConfTrigger: lct });
        return { expected: c.expected, matched: r.matched, facetsEnabled: r.facetsEnabled };
      });
      const sweep = THRESHOLDS.map(t => {
        const rows = perQuery.map(q => prf(q.matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
        return { threshold: t, ...macro(rows) };
      });
      const best = sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), sweep[0]);
      combos.push({ lowConfTrigger: lct, facetConf: fc, bestThreshold: best.threshold, precision: best.precision, recall: best.recall, f1: best.f1 });
    }
  }

  const origFacets = combos[0]; // lct=0, fc=0.5 = 原 facets
  const fixBest = combos.slice(1).reduce((b, c) => (c.f1 > b.f1 ? c : b), combos[1]);

  // 修法最佳每题明细
  const fixPerQuery = cases.map(c => {
    const r = routeWithFacets(c.query, index, facets, 0, { facetConf: fixBest.facetConf, lowConfTrigger: fixBest.lowConfTrigger });
    return { query: c.query, expected: c.expected, matched: r.matched, facetsEnabled: r.facetsEnabled, tagHits: r.tagHits };
  });
  const detail = fixPerQuery.map(q => {
    const pred = q.matched.filter(m => m.confidence >= fixBest.bestThreshold).map(m => m.path);
    return { query: q.query, expected: q.expected, facetsEnabled: q.facetsEnabled, tagHits: q.tagHits, predicted: pred, ...prf(pred, q.expected) };
  });

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    claim: 'facets 修法（降权+条件触发）保 recall 收 precision',
    testsetSize: cases.length,
    l0Baseline: { threshold: l0Best.threshold, precision: +l0Best.precision.toFixed(3), recall: +l0Best.recall.toFixed(3), f1: +l0Best.f1.toFixed(3) },
    origFacets: { lowConfTrigger: origFacets.lowConfTrigger, facetConf: origFacets.facetConf, threshold: origFacets.bestThreshold, precision: +origFacets.precision.toFixed(3), recall: +origFacets.recall.toFixed(3), f1: +origFacets.f1.toFixed(3) },
    fixBest: { lowConfTrigger: fixBest.lowConfTrigger, facetConf: fixBest.facetConf, threshold: fixBest.bestThreshold, precision: +fixBest.precision.toFixed(3), recall: +fixBest.recall.toFixed(3), f1: +fixBest.f1.toFixed(3) },
    deltaFixVsL0: { precision: +(fixBest.precision - l0Best.precision).toFixed(3), recall: +(fixBest.recall - l0Best.recall).toFixed(3), f1: +(fixBest.f1 - l0Best.f1).toFixed(3) },
    allCombos: combos.map(c => ({ lowConfTrigger: c.lowConfTrigger, facetConf: c.facetConf, threshold: c.bestThreshold, P: +c.precision.toFixed(3), R: +c.recall.toFixed(3), F1: +c.f1.toFixed(3) })),
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('=== facets precision 修法（降权+条件触发）===');
  console.log(`L0 baseline:           thr=${l0Best.threshold}  P=${result.l0Baseline.precision} R=${result.l0Baseline.recall} F1=${result.l0Baseline.f1}`);
  console.log(`原 facets(0.5,无条件):  thr=${origFacets.bestThreshold}  P=${result.origFacets.precision} R=${result.origFacets.recall} F1=${result.origFacets.f1}`);
  console.log(`修法最佳(lct=${fixBest.lowConfTrigger},fc=${fixBest.facetConf}): thr=${fixBest.bestThreshold}  P=${result.fixBest.precision} R=${result.fixBest.recall} F1=${result.fixBest.f1}`);
  console.log(`Δ(修法 vs L0):  P=${result.deltaFixVsL0.precision}  R=${result.deltaFixVsL0.recall}  F1=${result.deltaFixVsL0.f1}`);
  console.log('\n所有组合 (lct=lowConfTrigger, fc=facetConf):');
  console.log('  lct   fc    thr   P      R      F1');
  for (const c of result.allCombos) console.log(`  ${c.lowConfTrigger.toFixed(2)}  ${c.facetConf.toFixed(2)}  ${c.threshold.toFixed(2)}  ${c.P}  ${c.R}  ${c.F1}`);
  console.log('\n修法最佳每题:');
  for (const d of detail) {
    const ok = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  [${d.facetsEnabled ? 'FAC' : 'l0 '}] ${ok} P${d.precision.toFixed(2)}/R${d.recall.toFixed(2)}  ${d.query}  pred:[${d.predicted.join(',')}]`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
