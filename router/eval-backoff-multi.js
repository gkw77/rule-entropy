// 多层退一格 receipt 评估器 -- L0 vs 单层退(退根) vs 多层退(逐层退)，三者在同一 18 文件联合 index 上对比。
//
// claim（可证伪）：针对子主题的模糊 query（L0 top1 是子叶子、conf 低），多层退到阶段父比单层退树根
//   更精准。探针预示可能证伪（触发题 top1 全是阶段文件，多层退退根=单层退），但用数字确认。
//
// corpus-l2/ 是新增 L2 子叶子（01-security-* / 06-verify-*），corpus/ 13 文件不动，现有 receipt 零影响。

const fs = require('fs');
const path = require('path');
const { route } = require('./router');
const { loadTree, routeWithBackoff } = require('./route-backoff');
const { buildIndexMulti, routeWithBackoffMulti } = require('./route-backoff-multi');

const TESTSET = path.join(__dirname, '..', 'testset-backoff-multi.json');
const OUT = path.join(__dirname, '..', 'results', 'backoff-multi.json');
const THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
const LCT_VALS = [0.15, 0.2, 0.25];

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

// 对一个退一格方法扫 (lct × threshold)，返回最佳组合 + 每题明细
function sweepBackoff(cases, index, tree, fn) {
  const combos = [];
  for (const lct of LCT_VALS) {
    const perQuery = cases.map(c => {
      const r = fn(c.query, index, tree, 0, { lowConfThreshold: lct, backoffConf: 0.3 });
      return { expected: c.expected, matched: r.matched, backoffTriggered: r.backoffTriggered, backoffAdded: r.backoffAdded, top1: r.matched[0] };
    });
    const sweep = THRESHOLDS.map(t => {
      const rows = perQuery.map(q => prf(q.matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
      return { threshold: t, ...macro(rows) };
    });
    const best = sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), sweep[0]);
    combos.push({ lct, bestThreshold: best.threshold, precision: best.precision, recall: best.recall, f1: best.f1, perQuery });
  }
  return combos.reduce((b, c) => (c.f1 > b.f1 ? c : b), combos[0]);
}

function main() {
  const index = buildIndexMulti();
  const tree = loadTree();
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));

  // L0 baseline（18 文件联合 index）
  const l0PerQuery = cases.map(c => ({ expected: c.expected, matched: route(c.query, index, 0).matched }));
  const l0Sweep = THRESHOLDS.map(t => {
    const rows = l0PerQuery.map(q => prf(q.matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
    return { threshold: t, ...macro(rows) };
  });
  const l0Best = l0Sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), l0Sweep[0]);

  // 单层退（退根 routeWithBackoff）vs 多层退（逐层退 routeWithBackoffMulti）
  const singleBest = sweepBackoff(cases, index, tree, routeWithBackoff);
  const multiBest = sweepBackoff(cases, index, tree, routeWithBackoffMulti);

  // 每题明细（各自最佳阈值）
  const detail = cases.map((c, i) => {
    const l0pred = l0PerQuery[i].matched.filter(m => m.confidence >= l0Best.threshold).map(m => m.path);
    const spred = singleBest.perQuery[i].matched.filter(m => m.confidence >= singleBest.bestThreshold).map(m => m.path);
    const mpred = multiBest.perQuery[i].matched.filter(m => m.confidence >= multiBest.bestThreshold).map(m => m.path);
    const mTop1 = multiBest.perQuery[i].top1;
    const mTop1Path = mTop1 ? mTop1.path : '(无)';
    const mTop1Parent = mTop1 ? (tree.parent[mTop1.path] || '-') : '-';
    return {
      query: c.query,
      expected: c.expected,
      l0Top1: l0PerQuery[i].matched[0] ? l0PerQuery[i].matched[0].path : '(无)',
      l0Top1Conf: l0PerQuery[i].matched[0] ? +l0PerQuery[i].matched[0].confidence.toFixed(3) : 0,
      multiTriggered: multiBest.perQuery[i].backoffTriggered,
      multiBackoffTo: multiBest.perQuery[i].backoffAdded,
      top1IsLeaf: mTop1 ? (mTop1Parent !== '-' && mTop1Parent !== '00-pipeline') : false,
      l0Predicted: l0pred,
      singlePredicted: spred,
      multiPredicted: mpred,
      l0: prf(l0pred, c.expected),
      single: prf(spred, c.expected),
      multi: prf(mpred, c.expected),
    };
  });

  // 多层退 vs 单层退：有几题 predicted 不同
  const diffCount = detail.filter(d => JSON.stringify(d.singlePredicted) !== JSON.stringify(d.multiPredicted)).length;
  const leafTriggerCount = detail.filter(d => d.multiTriggered && d.top1IsLeaf).length;

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    claim: '多层退一格：子主题模糊题（top1 是子叶子 conf 低）逐层退到阶段父，比单层退树根更精准',
    corpus: 'corpus/(13 阶段) + corpus-l2/(5 L2 子叶子) = 18 文件联合 index；corpus/ 不动，现有 receipt 零影响',
    testsetSize: cases.length,
    l0Baseline: { threshold: l0Best.threshold, precision: +l0Best.precision.toFixed(3), recall: +l0Best.recall.toFixed(3), f1: +l0Best.f1.toFixed(3) },
    singleBackoff: { lct: singleBest.lct, threshold: singleBest.bestThreshold, precision: +singleBest.precision.toFixed(3), recall: +singleBest.recall.toFixed(3), f1: +singleBest.f1.toFixed(3) },
    multiBackoff: { lct: multiBest.lct, threshold: multiBest.bestThreshold, precision: +multiBest.precision.toFixed(3), recall: +multiBest.recall.toFixed(3), f1: +multiBest.f1.toFixed(3) },
    deltaMultiVsSingle: {
      precision: +(multiBest.precision - singleBest.precision).toFixed(3),
      recall: +(multiBest.recall - singleBest.recall).toFixed(3),
      f1: +(multiBest.f1 - singleBest.f1).toFixed(3),
    },
    mechanism: {
      diffPredictedCount: diffCount,
      leafTriggerCount,
      hint: leafTriggerCount === 0 ? '触发题 top1 全是阶段文件（非子叶子）-> 多层退退根=单层退，增益场景未触发' : '有触发题 top1 是子叶子，多层退退阶段父',
    },
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('=== 多层退一格 receipt: L0 vs 单层退(退根) vs 多层退(逐层退) ===');
  console.log(`N=${index.N} 文件联合 index，${cases.length} 题\n`);
  console.log(`L0 baseline:        thr=${l0Best.threshold}  P=${result.l0Baseline.precision} R=${result.l0Baseline.recall} F1=${result.l0Baseline.f1}`);
  console.log(`单层退(退根):        lct=${singleBest.lct} thr=${singleBest.bestThreshold}  P=${result.singleBackoff.precision} R=${result.singleBackoff.recall} F1=${result.singleBackoff.f1}`);
  console.log(`多层退(逐层退):      lct=${multiBest.lct} thr=${multiBest.bestThreshold}  P=${result.multiBackoff.precision} R=${result.multiBackoff.recall} F1=${result.multiBackoff.f1}`);
  console.log(`Δ(多层 vs 单层):     P=${result.deltaMultiVsSingle.precision}  R=${result.deltaMultiVsSingle.recall}  F1=${result.deltaMultiVsSingle.f1}`);
  console.log(`\n机制: 多层退 vs 单层退 predicted 不同的题数 = ${diffCount}；触发且 top1 是子叶子的题数 = ${leafTriggerCount}`);
  console.log(`  -> ${result.mechanism.hint}`);
  console.log('\n每题 (L0 / 单层退 / 多层退 各最佳阈值):');
  console.log('  query                    | L0top1(conf)        | 触发 | top1叶子? | 多层退到    | L0F1  单F1  多F1');
  console.log('  ' + '-'.repeat(115));
  for (const d of detail) {
    const trig = d.multiTriggered ? '是' : '否';
    const leaf = d.top1IsLeaf ? '是' : '否';
    const to = d.multiBackoffTo || '-';
    console.log(`  ${d.query.padEnd(25)} | ${(d.l0Top1 + '(' + d.l0Top1Conf + ')').padEnd(20)} | ${trig.padEnd(4)} | ${leaf.padEnd(9)} | ${to.padEnd(11)} | ${d.l0.f1.toFixed(2)}   ${d.single.f1.toFixed(2)}   ${d.multi.f1.toFixed(2)}`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
