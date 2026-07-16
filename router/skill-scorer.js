// skill 评分器（零 LLM，便宜可观测白盒）。
// 片 1：给 325 个 skill 评三维分，识别低质/赘余剪枝候选。
// 咬合项目立论：路由=结构性减熵（不全载）；评分+去重=赘余性减熵（剪重复低质）。两条做功。
//
// 三维（全 frontmatter + file stat 可观测，不需加载全文/LLM）：
//   完整性 completeness: 有 description(0.5) + 描述够长>=30字(0.3) + 有 triggers(0.2)
//   新鲜度 freshness:    mtime 距今天数（<30d=1.0 线性衰减到 365d=0.1）-- 熵增信号
//   独特性 distinctiveness: 描述 token 的 avg IDF（稀有=独特=高；泛泛/重叠=低=赘余候选）
// 复合 = 0.45*完整性 + 0.40*独特性 + 0.15*新鲜度（新鲜度权重低：本快照里全 recently-installed，不区分）

const fs = require('fs');
const path = require('path');
const { tokenize } = require('./router');

const MANIFEST = path.join(__dirname, '..', 'skills-corpus-full.json');
const OUT = path.join(__dirname, '..', 'results', 'skills-scored.json');
const NOW = Date.now();
const DAY = 86400000;

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const N = manifest.length;

  // 建 DF（description + triggers + name），复用路由器 IDF 思路
  const df = {};
  for (const s of manifest) {
    const tokens = new Set();
    if (s.description) for (const t of tokenize(s.description)) tokens.add(t);
    for (const tr of s.triggers || []) for (const t of tokenize(tr)) tokens.add(t);
    if (s.name) for (const t of tokenize(s.name)) tokens.add(t);
    for (const t of tokens) df[t] = (df[t] || 0) + 1;
  }
  const idf = {};
  for (const t of Object.keys(df)) idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
  const idfMax = Math.max(...Object.values(idf));

  const scored = manifest.map(s => {
    // 完整性
    const desc = s.description || '';
    const hasDesc = desc && desc !== '|' && desc.trim().length > 0 ? 1 : 0;
    const descLen = desc.replace(/\s/g, '').length;
    const lenAdequate = descLen >= 30 ? 1 : descLen / 30;
    const hasTriggers = (s.triggers || []).length > 0 ? 1 : 0;
    const completeness = clamp01(hasDesc * 0.5 + lenAdequate * 0.3 + hasTriggers * 0.2);

    // 新鲜度
    let freshness = 0;
    if (s.mtime) {
      const daysOld = (NOW - new Date(s.mtime).getTime()) / DAY;
      // <30d -> 1.0, 线性衰减到 365d -> 0.1, 更旧封顶 0.1
      freshness = clamp01(daysOld <= 30 ? 1.0 : 1.0 - 0.9 * Math.min((daysOld - 30) / 335, 1));
    }

    // 独特性：描述 token 的 avg IDF（归一到 [0,1]）
    let distinctiveness = 0;
    const descTokens = s.description ? tokenize(s.description) : [];
    if (descTokens.length) {
      const sum = descTokens.reduce((a, t) => a + (idf[t] || idfMax), 0); // OOV 给 idfMax（视为最稀有）
      distinctiveness = clamp01((sum / descTokens.length - 1) / (idfMax - 1));
    }

    const composite = +(0.45 * completeness + 0.40 * distinctiveness + 0.15 * freshness).toFixed(3);

    return {
      name: s.name,
      source: s.source,
      completeness: +completeness.toFixed(3),
      freshness: +freshness.toFixed(3),
      distinctiveness: +distinctiveness.toFixed(3),
      composite,
      descLen,
      hasTriggers: hasTriggers === 1,
      mtime: s.mtime,
    };
  });

  scored.sort((a, b) => b.composite - a.composite);

  // 分布
  const buckets = { '0.0-0.2': 0, '0.2-0.4': 0, '0.4-0.6': 0, '0.6-0.8': 0, '0.8-1.0': 0 };
  for (const s of scored) {
    const b = Math.min(Math.floor(s.composite / 0.2), 4);
    buckets[Object.keys(buckets)[b]]++;
  }
  const freshnessOld = scored.filter(s => s.freshness < 0.5).length;
  const lowCompleteness = scored.filter(s => s.completeness < 0.5).length;
  const lowDistinctiveness = scored.filter(s => s.distinctiveness < 0.3).length;

  // 按 source 对比
  const bySource = {};
  for (const s of scored) {
    if (!bySource[s.source]) bySource[s.source] = { n: 0, comp: 0, dist: 0, fresh: 0, comp_ok: 0 };
    const b = bySource[s.source];
    b.n++; b.comp += s.completeness; b.dist += s.distinctiveness; b.fresh += s.freshness;
    if (s.completeness === 1) b.comp_ok++;
  }
  const sourceSummary = Object.fromEntries(
    Object.entries(bySource).map(([k, v]) => [k, {
      n: v.n,
      avgCompleteness: +(v.comp / v.n).toFixed(3),
      avgDistinctiveness: +(v.dist / v.n).toFixed(3),
      avgFreshness: +(v.fresh / v.n).toFixed(3),
      completeRate: +(v.comp_ok / v.n).toFixed(3),
    }])
  );

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    corpus: `skills-corpus-full.json (${N} skills)`,
    dimensions: 'completeness(0.45) + distinctiveness(0.40) + freshness(0.15) -> composite [0,1]',
    N,
    distribution: buckets,
    lowCompleteness_count: lowCompleteness,
    lowDistinctiveness_count: lowDistinctiveness, // 赘余候选（重叠度高）
    freshnessOld_count: freshnessOld, // mtime > ~180d
    sourceSummary,
    note: 'freshness 在本快照不区分（全 2026-04~06 安装，反映 install 时间非维护时间）；区分靠 completeness（空/|描述）+ distinctiveness（IDF 重叠）',
    bottom15: scored.slice(-15).reverse(), // 剪枝候选（低分）
    top15: scored.slice(0, 15),
    all: scored,
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('=== skill 评分 receipt ===');
  console.log(`语料: ${N} 个 skill\n`);
  console.log('复合分分布:', JSON.stringify(buckets));
  console.log(`低完整性(<0.5): ${lowCompleteness}  低独特性(<0.3, 赘余候选): ${lowDistinctiveness}  陈旧(<0.5): ${freshnessOld}`);
  console.log('\n按 source 对比:');
  console.log('  source        n   完整性  独特性  新鲜度  完整率');
  for (const [k, v] of Object.entries(sourceSummary)) {
    console.log(`  ${k.padEnd(12)} ${String(v.n).padStart(3)}  ${v.avgCompleteness.toFixed(3)}  ${v.avgDistinctiveness.toFixed(3)}  ${v.avgFreshness.toFixed(3)}  ${v.completeRate.toFixed(2)}`);
  }
  console.log('\n低分 bottom 10（剪枝候选）:');
  for (const s of scored.slice(-10).reverse()) {
    console.log(`  ${s.composite.toFixed(3)} [${s.source.padEnd(8)}] 完${s.completeness.toFixed(2)} 独${s.distinctiveness.toFixed(2)} 新${s.freshness.toFixed(2)}  ${s.name}`);
  }
  console.log('\n高分 top 5:');
  for (const s of scored.slice(0, 5)) {
    console.log(`  ${s.composite.toFixed(3)} [${s.source.padEnd(8)}] 完${s.completeness.toFixed(2)} 独${s.distinctiveness.toFixed(2)}  ${s.name}`);
  }
  console.log(`\nreceipt: ${OUT}`);
}

main();
