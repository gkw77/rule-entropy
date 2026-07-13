// 评估器：跑测试集，算 precision/recall/F1 + 阈值扫描。
// 输出 = 路由器的第一个 receipt（按文章立场，路由规则也是规则，必须有 receipt）。
//
// 不 game 单一数字：扫多个阈值，报曲线 + 最佳 F1 点 + 每题明细（错例反哺描述符）。

const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');

const TESTSET = path.join(__dirname, '..', 'testset.json');
const OUT = path.join(__dirname, '..', 'results', 'l0-v2-multilabel.json');

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
  const precision = sum.p / rows.length;
  const recall = sum.r / rows.length;
  const f1 = sum.f / rows.length;
  return { precision, recall, f1 };
}

function main() {
  const index = buildIndex();
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));

  // 每题的完整 matched（带 confidence），供阈值扫描 + 错例诊断
  const perQuery = cases.map(c => {
    const { matched } = route(c.query, index, 0);
    return { query: c.query, expected: c.expected, matched };
  });

  // 阈值扫描
  const sweep = THRESHOLDS.map(t => {
    const rows = perQuery.map(q => {
      const predicted = q.matched.filter(m => m.confidence >= t).map(m => m.path);
      return prf(predicted, q.expected);
    });
    const m = macro(rows);
    return { threshold: t, ...m };
  });

  const best = sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), sweep[0]);

  // 最佳阈值下的每题明细
  const detail = perQuery.map(q => {
    const predicted = q.matched.filter(m => m.confidence >= best.threshold).map(m => m.path);
    const r = prf(predicted, q.expected);
    return {
      query: q.query,
      expected: q.expected,
      predicted,
      ...r,
      matchedTop: q.matched.slice(0, 5).map(m => ({ path: m.path, conf: +m.confidence.toFixed(3), hits: m.hits })),
    };
  });

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'corpus/*.md (13 files)',
    router: 'L0 keyword, weighted-coverage + idf, CJK bigram',
    testsetSize: cases.length,
    sweep,
    bestThreshold: best.threshold,
    macroAtBest: { precision: +best.precision.toFixed(3), recall: +best.recall.toFixed(3), f1: +best.f1.toFixed(3) },
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  // 控制台摘要
  console.log('=== L0 路由器评估 ===');
  console.log(`语料: ${result.corpus}  测试集: ${result.testsetSize} 题`);
  console.log('\n阈值扫描 (macro):');
  console.log('  thr    P      R      F1');
  for (const s of sweep) {
    console.log(
      `  ${s.threshold.toFixed(2)}  ${s.precision.toFixed(3)}  ${s.recall.toFixed(3)}  ${s.f1.toFixed(3)}`
    );
  }
  console.log(`\n最佳阈值: ${best.threshold}  ->  P=${best.precision.toFixed(3)}  R=${best.recall.toFixed(3)}  F1=${best.f1.toFixed(3)}`);
  console.log('\n每题明细 (最佳阈值):');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${flag} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [pred: ${d.predicted.join(',') || '—'}] [exp: ${d.expected.join(',')}]  ${d.query}`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
