// L1+facets receipt 评估器 -- L1-only vs L1+facets 对比（第 18 个 receipt）。
//
// claim：facets 补 L0 漏的候选 + LLM judge 滤沾边 -> 比 L1-only recall 升、precision 可控。
// 同 testset-facets（10 题横切题）。judgeRelevance 带 cache，L0 候选部分共享，L1+facets 只多 judge facets 新加的。

const fs = require('fs');
const path = require('path');
const { buildIndex } = require('./router');
const { routeL1, buildDescriptors } = require('./l1');
const { loadFacets } = require('./route-facets');
const { routeL1Facets } = require('./route-l1-facets');
const { cacheStats } = require('./llm');

const TESTSET = path.join(__dirname, '..', 'testset-facets.json');
const OUT = path.join(__dirname, '..', 'results', 'l1-facets.json');

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
    (acc, r) => ({ p: acc.p + r.precision, r: acc.r + r.recall, f: acc.f + r.f1 }),
    { p: 0, r: 0, f: 0 }
  );
  return { precision: sum.p / rows.length, recall: sum.r / rows.length, f1: sum.f / rows.length };
}

async function main() {
  const index = buildIndex();
  const descriptors = buildDescriptors();
  const facets = loadFacets();
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));

  const detail = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.query.slice(0, 24)}... `);
    const t0 = Date.now();
    const l1 = await routeL1(c.query, index, descriptors, 0.05);
    const l1f = await routeL1Facets(c.query, index, descriptors, facets, 0.05);
    process.stdout.write(`L1:${l1.l1Loaded.length} L1F:${l1f.l1Loaded.length} cache:${cacheStats().size} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    detail.push({
      query: c.query,
      expected: c.expected,
      tagHits: l1f.tagHits,
      l1Predicted: l1.l1Loaded,
      l1FacetsPredicted: l1f.l1Loaded,
      l1: prf(l1.l1Loaded, c.expected),
      l1f: prf(l1f.l1Loaded, c.expected),
      facetsAdded: l1f.facetsAdded,
    });
  }

  const l1Macro = macro(detail.map(d => d.l1));
  const l1fMacro = macro(detail.map(d => d.l1f));

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    claim: 'L1+facets: facets 补 L0 漏的候选 + LLM judge 滤沾边 -> 比 L1-only recall 升、precision 可控',
    testsetSize: cases.length,
    l1only: { precision: +l1Macro.precision.toFixed(3), recall: +l1Macro.recall.toFixed(3), f1: +l1Macro.f1.toFixed(3) },
    l1facets: { precision: +l1fMacro.precision.toFixed(3), recall: +l1fMacro.recall.toFixed(3), f1: +l1fMacro.f1.toFixed(3) },
    delta: { precision: +(l1fMacro.precision - l1Macro.precision).toFixed(3), recall: +(l1fMacro.recall - l1Macro.recall).toFixed(3), f1: +(l1fMacro.f1 - l1Macro.f1).toFixed(3) },
    llmCalls: cacheStats(),
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('=== L1+facets receipt: L1-only vs L1+facets ===');
  console.log(`L1-only:    P=${result.l1only.precision} R=${result.l1only.recall} F1=${result.l1only.f1}`);
  console.log(`L1+facets:  P=${result.l1facets.precision} R=${result.l1facets.recall} F1=${result.l1facets.f1}`);
  console.log(`Δ:  P=${result.delta.precision}  R=${result.delta.recall}  F1=${result.delta.f1}`);
  console.log(`LLM 调用 (cache size): ${result.llmCalls.size}`);
  console.log('\n每题:');
  for (const d of detail) {
    const flag = d.l1f.f1 > d.l1.f1 ? '↑' : d.l1f.f1 < d.l1.f1 ? '↓' : '=';
    console.log(`  ${flag} L1[P${d.l1.precision.toFixed(2)}/R${d.l1.recall.toFixed(2)}] L1F[P${d.l1f.precision.toFixed(2)}/R${d.l1f.recall.toFixed(2)}] [tag:${d.tagHits.join(',') || '-'}]  ${d.query}`);
    console.log(`      exp:[${d.expected.join(',')}]  L1:[${d.l1Predicted.join(',') || '-'}]  L1F:[${d.l1FacetsPredicted.join(',') || '-'}]  facets加:[${d.facetsAdded.join(',') || '-'}]`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
