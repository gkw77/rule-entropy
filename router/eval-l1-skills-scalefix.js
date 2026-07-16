// 规模悬崖修法实验：always-retrieve-union。
//
// 第五个 receipt 发现规模悬崖：L1 的 semanticRetrieve 只在 L0 零匹配时触发，
// 325-scale 下零匹配题=0 -> 跨语言题拿错候选走 judge，judge 对错候选判 yes 则
// retrieve 永不触发 -> 真目标漏召回（context-restore/benchmark）。
//
// 修法：retrieve 与零匹配信号解耦--每题都跑 retrieve，与 judge-yes 取并集。
// 这样 retrieve 必触发（保证语义救援在规模下不死于"零匹配消失"）。
//
// 省成本：judge verdict 已存在 results/l1-skills-full.json（每题 judged 数组带 verdict），
// 复用之，只跑 20 次新 retrieve 调用，不重跑 201 次 judge。
//
// receipt 问题：解耦后能否救回 3 题漏召回？precision 守不守（retrieve 会否加堂兄弟）？

const fs = require('fs');
const path = require('path');
const { loadAllSkills, semanticRetrieve } = require('./l1-skills');
const { cacheStats } = require('./llm');

const MANIFEST = path.join(__dirname, '..', 'skills-corpus-full.json');
const L1_FULL = path.join(__dirname, '..', 'results', 'l1-skills-full.json');
const OUT = path.join(__dirname, '..', 'results', 'l1-skills-scalefix.json');

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
  const allSkills = loadAllSkills(MANIFEST);
  const l1full = JSON.parse(fs.readFileSync(L1_FULL, 'utf8'));
  const baseline = l1full.macro; // {precision, recall, f1}

  const detail = [];
  let retrieveCalls = 0;
  process.stdout.write('跑 always-retrieve-union (20 题各跑 retrieve): ');
  for (const d of l1full.detail) {
    // 复用已存的 judge verdict：judge-yes = judged 里 verdict=yes 的 path
    const judgeYes = (d.judged || []).filter(j => j.verdict === 'yes').map(j => j.path);
    // 新跑 retrieve（与零匹配解耦，每题都跑）
    const retrieved = await semanticRetrieve(d.query, allSkills);
    retrieveCalls++;
    // 并集
    const union = [...new Set([...judgeYes, ...retrieved])];
    const m = prf(union, d.expected);
    detail.push({
      query: d.query,
      expected: d.expected,
      judgeYes,
      retrieved,
      union,
      precision: +m.precision.toFixed(3),
      recall: +m.recall.toFixed(3),
      f1: +m.f1.toFixed(3),
      tp: m.tp,
      fp: m.fp,
      fn: m.fn,
    });
    const flag = m.precision === 1 && m.recall === 1 ? '✓' : '✗';
    process.stdout.write(flag);
  }
  console.log('');

  const M = macro(detail);
  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'skills-corpus-full.json (325 unique skills)',
    router: 'always-retrieve-union: 每题跑 semanticRetrieve + 复用 L1-full 的 judge-yes 取并集',
    testsetSize: l1full.detail.length,
    newRetrieveCalls: retrieveCalls,
    reusedJudgeCalls: l1full.llmJudgeCalls,
    macro: { precision: +M.precision.toFixed(3), recall: +M.recall.toFixed(3), f1: +M.f1.toFixed(3) },
    l1FullBaselineMacro: baseline,
    delta: {
      precision: +(M.precision - baseline.precision).toFixed(3),
      recall: +(M.recall - baseline.recall).toFixed(3),
      f1: +(M.f1 - baseline.f1).toFixed(3),
    },
    note: '规模悬崖修法：retrieve 与零匹配信号解耦，每题必跑。复用 L1-full judge verdict，只新跑 20 次 retrieve',
    detail,
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log('\n=== always-retrieve-union 修法评估 ===');
  console.log(`新 retrieve 调用: ${retrieveCalls}（复用 ${l1full.llmJudgeCalls} judge verdict 不重跑）`);
  console.log('\nL1-full baseline vs always-retrieve-union (macro):');
  console.log(`  L1-full           P=${baseline.precision}  R=${baseline.recall}  F1=${baseline.f1}`);
  console.log(`  always-retrieve   P=${M.precision.toFixed(3)}  R=${M.recall.toFixed(3)}  F1=${M.f1.toFixed(3)}`);
  console.log(`  Δ                 P=${result.delta.precision >= 0 ? '+' : ''}${result.delta.precision}  R=${result.delta.recall >= 0 ? '+' : ''}${result.delta.recall}  F1=${result.delta.f1 >= 0 ? '+' : ''}${result.delta.f1}`);
  console.log('\n每题明细 (judgeYes ∪ retrieved):');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${flag} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [∪: ${d.union.join(',').slice(0,50) || '-'}] [exp: ${d.expected.join(',')}]  ${d.query.slice(0,22)}`);
  }
  console.log(`\nreceipt: ${OUT}`);
}

main();
