// 全量 skill L0 评估器：在 325 个去重 skill（personal+gstack+marketplace+cache）上跑测试集，
// 对比 70-skill baseline(results/skills-l0-baseline.json P=.304/R=.500/F1=.349)。
// 零 LLM 成本，确定性。receipt 问题：distractor 从 70 涨到 325，L0 关键词路由 precision 如何退化（共享词碰撞）。

const fs = require('fs');
const path = require('path');
const { buildSkillIndex, route } = require('./router');

const MANIFEST = path.join(__dirname, '..', 'skills-corpus-full.json');
const TESTSET = path.join(__dirname, '..', 'testset-skills.json');
const BASELINE = path.join(__dirname, '..', 'results', 'skills-l0-baseline.json');
const OUT = path.join(__dirname, '..', 'results', 'skills-l0-full.json');
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
  const index = buildSkillIndex(MANIFEST);
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  const perQuery = cases.map(c => {
    const { matched } = route(c.query, index, 0);
    return { query: c.query, expected: c.expected, matched };
  });

  const sweep = THRESHOLDS.map(t => {
    const rows = perQuery.map(q => {
      const predicted = q.matched.filter(m => m.confidence >= t).map(m => m.path);
      return prf(predicted, q.expected);
    });
    return { threshold: t, ...macro(rows) };
  });

  const best = sweep.reduce((b, s) => (s.f1 > b.f1 ? s : b), sweep[0]);

  const detail = perQuery.map(q => {
    const predicted = q.matched.filter(m => m.confidence >= best.threshold).map(m => m.path);
    const r = prf(predicted, q.expected);
    return {
      query: q.query,
      expected: q.expected,
      predicted,
      ...r,
      matchedTop: q.matched.slice(0, 8).map(m => ({ path: m.path, conf: +m.confidence.toFixed(3), hits: m.hits })),
    };
  });

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'skills-corpus-full.json (325 unique skills: 108 personal + 7 gstack + 193 marketplace + 17 cache, frontmatter descriptor)',
    corpusNote: '1181 raw SKILL.md files -> 325 unique after name-dedup (agent-format copies in .agents/.cursor/.factory etc collapsed)',
    router: 'L0 keyword, weighted-coverage + idf, CJK bigram, descriptor=description+triggers+name (与 70-skill baseline 同路由器)',
    testsetSize: cases.length,
    corpusSize: index.N,
    sweep,
    bestThreshold: best.threshold,
    macroAtBest: { precision: +best.precision.toFixed(3), recall: +best.recall.toFixed(3), f1: +best.f1.toFixed(3) },
    baseline70: baseline.macroAtBest,
    delta: {
      precision: +(best.precision - baseline.macroAtBest.precision).toFixed(3),
      recall: +(best.recall - baseline.macroAtBest.recall).toFixed(3),
      f1: +(best.f1 - baseline.macroAtBest.f1).toFixed(3),
    },
    detail,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  const b = baseline.macroAtBest;
  console.log('=== 全量 skill L0 路由器评估 ===');
  console.log(`语料: ${result.corpusSize} 个 skill (vs baseline 70)`);
  console.log(`测试集: ${result.testsetSize} 题\n`);
  console.log('阈值扫描 (macro):');
  console.log('  thr    P      R      F1');
  for (const s of sweep) {
    console.log(`  ${s.threshold.toFixed(2)}  ${s.precision.toFixed(3)}  ${s.recall.toFixed(3)}  ${s.f1.toFixed(3)}`);
  }
  console.log(`\n最佳阈值: ${best.threshold}  ->  P=${best.precision.toFixed(3)}  R=${best.recall.toFixed(3)}  F1=${best.f1.toFixed(3)}`);
  console.log(`\n70-skill baseline:  P=${b.precision}  R=${b.recall}  F1=${b.f1}`);
  console.log(`325-skill full:    P=${best.precision.toFixed(3)}  R=${best.recall.toFixed(3)}  F1=${best.f1.toFixed(3)}`);
  console.log(`Δ                   P=${result.delta.precision >= 0 ? '+' : ''}${result.delta.precision}  R=${result.delta.recall >= 0 ? '+' : ''}${result.delta.recall}  F1=${result.delta.f1 >= 0 ? '+' : ''}${result.delta.f1}`);
  console.log('\n每题明细 (最佳阈值):');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${flag} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [pred: ${d.predicted.join(',').slice(0,60) || '-'}] [exp: ${d.expected.join(',')}]  ${d.query}`);
  }
  console.log(`\nreceipt 已写入: ${OUT}`);
}

main();
