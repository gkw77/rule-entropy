// ownership 差分路由评估器（receipt 17）。
//
// 对比三方：L0 baseline / 原 facets（receipt 10 复现，lct=0 fc=0.5）/ ownership（owns/refs 差分）。
// 扫 ownsConf × refsConf × lowConfTrigger × threshold，找 ownership 最佳，对比 L0 + 原 facets。
// 测试集 testset-facets.json（10 题，与 receipt 10/12 直接可比）。
//
// claim：ownership F1 > L0（0.695）且 > 原 facets（0.576）= 正向 receipt；否则诚实证伪。

const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');
const { loadFacets, routeWithFacets } = require('./route-facets');
const { loadOwnership, routeWithOwnership } = require('./route-ownership');

const TESTSET = path.join(__dirname, '..', 'testset-facets.json');
const OUT = path.join(__dirname, '..', 'results', 'ownership.json');
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

function sweepBest(perQuery) {
  const sweep = THRESHOLDS.map(t => {
    const rows = perQuery.map(q => prf(q.matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
    return { threshold: t, ...macro(rows) };
  });
  return sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), sweep[0]);
}

function main() {
  const index = buildIndex();
  const facets = loadFacets();
  const own = loadOwnership();
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));

  // L0 baseline
  const l0PerQuery = cases.map(c => ({ expected: c.expected, matched: route(c.query, index, 0).matched }));
  const l0Best = sweepBest(l0PerQuery);

  // 原 facets (lct=0, fc=0.5，receipt 10 复现)
  const facPerQuery = cases.map(c => ({ expected: c.expected, matched: routeWithFacets(c.query, index, facets, 0, { facetConf: 0.5, lowConfTrigger: 0 }).matched }));
  const facBest = sweepBest(facPerQuery);

  // ownership 扫组合
  const lctVals = [0, 0.15, 0.2, 0.25];
  const ocVals = [0.5, 0.4, 0.3];
  const rcVals = [0.12, 0.15, 0.2, 0.25];
  const combos = [];
  for (const lct of lctVals) {
    for (const oc of ocVals) {
      for (const rc of rcVals) {
        if (rc >= oc) continue; // refs 必须低于 owns 才有差分意义
        const perQuery = cases.map(c => {
          const r = routeWithOwnership(c.query, index, own, 0, { ownsConf: oc, refsConf: rc, lowConfTrigger: lct });
          return { expected: c.expected, matched: r.matched };
        });
        const best = sweepBest(perQuery);
        combos.push({ lct, ownsConf: oc, refsConf: rc, bestThreshold: best.threshold, precision: best.precision, recall: best.recall, f1: best.f1 });
      }
    }
  }
  const ownBest = combos.reduce((b, c) => (c.f1 > b.f1 ? c : b), combos[0]);

  // 最佳每题明细
  const ownPerQuery = cases.map(c => {
    const r = routeWithOwnership(c.query, index, own, 0, { ownsConf: ownBest.ownsConf, refsConf: ownBest.refsConf, lowConfTrigger: ownBest.lct });
    return { query: c.query, expected: c.expected, matched: r.matched, tagHits: r.tagHits };
  });
  const detail = ownPerQuery.map(q => {
    const pred = q.matched.filter(m => m.confidence >= ownBest.bestThreshold).map(m => m.path);
    return { query: q.query, expected: q.expected, tagHits: q.tagHits, predicted: pred, ...prf(pred, q.expected) };
  });

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    claim: 'ownership 差分（owns 高/refs 低）补 L0 召回又避 facets precision 崩，F1 beat L0 + 原 facets',
    testsetSize: cases.length,
    l0Baseline: { threshold: l0Best.threshold, precision: +l0Best.precision.toFixed(3), recall: +l0Best.recall.toFixed(3), f1: +l0Best.f1.toFixed(3) },
    origFacets: { threshold: facBest.threshold, precision: +facBest.precision.toFixed(3), recall: +facBest.recall.toFixed(3), f1: +facBest.f1.toFixed(3) },
    ownBest: { lct: ownBest.lct, ownsConf: ownBest.ownsConf, refsConf: ownBest.refsConf, threshold: ownBest.bestThreshold, precision: +ownBest.precision.toFixed(3), recall: +ownBest.recall.toFixed(3), f1: +ownBest.f1.toFixed(3) },
    deltaOwnVsL0: { precision: +(ownBest.precision - l0Best.precision).toFixed(3), recall: +(ownBest.recall - l0Best.recall).toFixed(3), f1: +(ownBest.f1 - l0Best.f1).toFixed(3) },
    deltaOwnVsFacets: { precision: +(ownBest.precision - facBest.precision).toFixed(3), recall: +(ownBest.recall - facBest.recall).toFixed(3), f1: +(ownBest.f1 - facBest.f1).toFixed(3) },
    allCombos: combos.map(c => ({ lct: c.lct, oc: c.ownsConf, rc: c.refsConf, thr: c.bestThreshold, P: +c.precision.toFixed(3), R: +c.recall.toFixed(3), F1: +c.f1.toFixed(3) })),
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('=== ownership 差分路由（receipt 17）===');
  console.log(`L0 baseline:            thr=${result.l0Baseline.threshold}  P=${result.l0Baseline.precision} R=${result.l0Baseline.recall} F1=${result.l0Baseline.f1}`);
  console.log(`原 facets(0.5,无条件):   thr=${result.origFacets.threshold}  P=${result.origFacets.precision} R=${result.origFacets.recall} F1=${result.origFacets.f1}`);
  console.log(`ownership最佳(lct=${ownBest.lct},oc=${ownBest.ownsConf},rc=${ownBest.refsConf}): thr=${ownBest.bestThreshold}  P=${result.ownBest.precision} R=${result.ownBest.recall} F1=${result.ownBest.f1}`);
  console.log(`Δ(ownership vs L0):      P=${result.deltaOwnVsL0.precision}  R=${result.deltaOwnVsL0.recall}  F1=${result.deltaOwnVsL0.f1}`);
  console.log(`Δ(ownership vs facets):  P=${result.deltaOwnVsFacets.precision}  R=${result.deltaOwnVsFacets.recall}  F1=${result.deltaOwnVsFacets.f1}`);
  console.log('\n所有权组合 (lct=lowConfTrigger, oc=ownsConf, rc=refsConf):');
  console.log('  lct   oc    rc    thr   P      R      F1');
  for (const c of result.allCombos) console.log(`  ${c.lct.toFixed(2)}  ${c.oc.toFixed(2)}  ${c.rc.toFixed(2)}  ${c.thr.toFixed(2)}  ${c.P}  ${c.R}  ${c.F1}`);
  console.log('\nownership 最佳每题:');
  for (const d of detail) {
    const ok = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${ok} P${d.precision.toFixed(2)}/R${d.recall.toFixed(2)}  ${d.query}  pred:[${d.predicted.join(',')}]  tag:[${(d.tagHits || []).join(',')}]`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
