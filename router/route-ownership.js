// ownership 差分路由 -- facets 的 owns/refs 区分版（receipt 17）。
//
// 设计（见 README receipt 17 + receipt 10 的失败根因）：
//   - facets（receipt 10 falsified）命中 tag 后所有文件一律 facetConf，均匀下拉 ->
//     要么被阈值滤掉（退回 L0）要么全放过（过载）。receipt 10 修法（均匀降权 0.12）
//     仍 falsified：均匀降权还是"全过或全滤"，分不清真相关 vs 顺带提及。
//   - ownership：tag 内区分 owns（标题级主营，grep 验证）与 refs（顺带提及）。
//     owns 给 ownsConf（高），refs 给 refsConf（低）-> 差分打破阈值二选一：
//     owns 文件过阈值，refs 文件被滤，不再同生共死。
//   - 并集：同 path 取 max(L0 conf, ownsConf/refsConf)，合并 hits。白盒可解释。
//
// claim（可证伪）：owns/refs 差分补 L0 召回空缺（如 query "委托subagent越界" L0 全漏）
// 又不引入 facets 的 precision 崩溃（refs 被滤）-> F1 beat L0 + 原 facets。
// receipt = eval-ownership.js 跑 L0 vs 原 facets vs ownership。

const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');

const OWNERSHIP_PATH = path.join(__dirname, 'ownership-index.json');

function loadOwnership(p = OWNERSHIP_PATH) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// query 命中哪些 tag（子串匹配，白盒；返回 {tag: 命中的 keyword}）
function matchTags(query, own) {
  const hits = {};
  for (const [tag, def] of Object.entries(own.tags)) {
    const kw = (def.keywords || []).find(k => query.includes(k));
    if (kw) hits[tag] = kw;
  }
  return hits;
}

// L0 ∪ ownership 差分路由
// opts.ownsConf: owns 命中给的 confidence（默认 own.ownsConf 或 0.5）
// opts.refsConf: refs 命中给的 confidence（默认 own.refsConf 或 0.15）
// opts.lowConfTrigger: >0 时仅当 L0 top conf < 该值才启用 ownership（强 L0 题不扰）
function routeWithOwnership(query, index, own, threshold = 0, opts = {}) {
  const base = route(query, index, 0); // L0 全 matched（threshold=0 拿全候选）
  const ownsConf = opts.ownsConf != null ? opts.ownsConf : (own.ownsConf != null ? own.ownsConf : 0.5);
  const refsConf = opts.refsConf != null ? opts.refsConf : (own.refsConf != null ? own.refsConf : 0.15);
  const lowConfTrigger = opts.lowConfTrigger != null ? opts.lowConfTrigger : 0;

  // byPath 并集：L0 命中 + ownership 命中
  const byPath = new Map();
  for (const m of base.matched) byPath.set(m.path, { path: m.path, confidence: m.confidence, hits: m.hits, ownHits: [], refHits: [] });

  // 条件触发：lowConfTrigger>0 时，仅当 L0 top conf < lowConfTrigger 才启用 ownership
  const topConf = base.matched.length > 0 ? base.matched[0].confidence : 0;
  const enable = lowConfTrigger <= 0 || topConf < lowConfTrigger;

  const tagHits = enable ? matchTags(query, own) : {};
  for (const [tag, kw] of Object.entries(tagHits)) {
    const def = own.tags[tag];
    // owns：高分
    for (const file of (def.owns || [])) {
      if (!byPath.has(file)) byPath.set(file, { path: file, confidence: 0, hits: [], ownHits: [], refHits: [] });
      const e = byPath.get(file);
      e.ownHits.push(`${tag}:${kw}`);
      if (e.confidence < ownsConf) e.confidence = ownsConf;
    }
    // refs：低分（差分关键：refs 不和 owns 同分）
    for (const file of (def.refs || [])) {
      if (!byPath.has(file)) byPath.set(file, { path: file, confidence: 0, hits: [], ownHits: [], refHits: [] });
      const e = byPath.get(file);
      e.refHits.push(`${tag}:${kw}`);
      if (e.confidence < refsConf) e.confidence = refsConf;
    }
  }

  const matched = [...byPath.values()]
    .filter(m => m.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
  const loaded = matched.filter(m => m.confidence >= threshold);
  return { query, threshold, matched, loaded, tagHits: Object.keys(tagHits), ownershipEnabled: enable };
}

module.exports = { loadOwnership, matchTags, routeWithOwnership };

// CLI: node router/route-ownership.js "你的问题"
if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('用法: node router/route-ownership.js "问题"');
    process.exit(1);
  }
  const index = buildIndex();
  const own = loadOwnership();
  const { matched, loaded, tagHits } = routeWithOwnership(query, index, own);
  console.log('查询:', query);
  console.log('命中 tags:', tagHits.join(', ') || '(无)');
  console.log('\n全部匹配 (confidence 降序, owns=0.5 / refs=0.15):');
  for (const m of matched) {
    const oh = m.ownHits.length ? `  [owns: ${m.ownHits.join('; ')}]` : '';
    const rh = m.refHits.length ? `  [refs: ${m.refHits.join('; ')}]` : '';
    console.log(`  ${m.confidence.toFixed(3)}  ${m.path}  [${(m.hits || []).join(', ')}]${oh}${rh}`);
  }
}
