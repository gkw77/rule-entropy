// L0 覆盖度评估（零 LLM 成本，即时）：8 题 query 目标 marketplace/cache skill，
// 看 L0 在 325 语料上能否检索到 expected（任意阈值命中即算可索引）。
// 70-corpus 上这些 skill 不存在 -> 检索不到。325 上能检索到 = 扩展的覆盖价值。

const fs = require('fs');
const path = require('path');
const { buildSkillIndex, route } = require('./router');

const MANIFEST_FULL = path.join(__dirname, '..', 'skills-corpus-full.json');
const MANIFEST_70 = path.join(__dirname, '..', 'skills-corpus.json');
const TESTSET = path.join(__dirname, '..', 'testset-skills-scale.json');
const OUT = path.join(__dirname, '..', 'results', 'skills-l0-coverage.json');

function main() {
  const idxFull = buildSkillIndex(MANIFEST_FULL);
  const idx70 = buildSkillIndex(MANIFEST_70);
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));

  const detail = cases.map(c => {
    const exp = c.expected[0];
    const rFull = route(c.query, idxFull, 0);
    const r70 = route(c.query, idx70, 0);
    // 任意 confidence 命中即算 L0 可检索到（不设阈值门槛，看是否进候选）
    const fullHit = rFull.matched.find(m => m.path === exp);
    const fullRank = fullHit ? rFull.matched.indexOf(fullHit) + 1 : null;
    const fullTopConf = rFull.matched[0] ? rFull.matched[0].path : null;
    return {
      query: c.query,
      expected: exp,
      in70Corpus: idx70.docs.some(d => d.name === exp),
      l0FullHit: !!fullHit,
      l0FullRank: fullRank,
      l0FullConf: fullHit ? +fullHit.confidence.toFixed(3) : 0,
      l0FullTop: fullTopConf,
      l070Hit: r70.matched.some(m => m.path === exp), // 70 上不可能命中（skill 不在索引）
    };
  });

  const foundFull = detail.filter(d => d.l0FullHit).length;
  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: 'skills-corpus-full.json (325 unique skills)',
    testsetSize: cases.length,
    l0CoverageFound: foundFull,
    l0CoverageRecall: +(foundFull / cases.length).toFixed(3),
    note: 'L0 任意 confidence 命中即算可检索。8 题 expected 都是 marketplace/cache skill，70-corpus 不索引 -> l070Hit 全 false。325 上 l0FullHit = 扩展覆盖价值',
    detail,
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log('=== L0 覆盖度评估（325 vs 70）===');
  console.log(`8 题 marketplace/cache skill，325-corpus L0 命中 ${foundFull} 个 (recall=${result.l0CoverageRecall})\n`);
  for (const d of detail) {
    const flag = d.l0FullHit ? '✓' : '✗';
    const in70 = d.in70Corpus ? '(在70)' : '(不在70)';
    console.log(`  ${flag} ${in70} 325-rank=${d.l0FullRank || '-'} conf=${d.l0FullConf} top=${d.l0FullTop}  [exp: ${d.expected}]  ${d.query}`);
  }
  console.log(`\nreceipt: ${OUT}`);
}

main();
