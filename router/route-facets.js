// facets 横切标签路由 -- L0 matched ∪ facets 命中（第二个 receipt 的路由器）。
//
// 设计（见 README「路由架构」+ plans/rule-entropy-facets-backoff.md 切片 1）：
//   - spine（L0，文件自身关键词）治"文件内有什么"；facets（横切标签）治"横跨多阶段的主题"。
//   - 纯层级会漏横切题（如"并行 push 撞 DB"该命中 05+06，spine 可能只命中 05）。
//   - facets 命中 = query 子串命中某 tag 的 keyword -> 拉该 tag 全部文件，给固定 confidence（facetConf）。
//   - 并集：同 path 取 max(L0 conf, facetConf)，合并 hits。白盒可解释。
//
// claim（可证伪）：facets 补 spine 漏的横切题 -> recall 升、precision 可控。receipt = eval-facets.js 跑 L0 vs L0∪facets。

const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');

const FACETS_PATH = path.join(__dirname, 'facets-index.json');

function loadFacets(p = FACETS_PATH) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// query 命中哪些 tag（子串匹配，白盒；返回 {tag: 命中的 keyword}）
function matchTags(query, facets) {
  const hits = {};
  for (const [tag, def] of Object.entries(facets.tags)) {
    const kw = (def.keywords || []).find(k => query.includes(k));
    if (kw) hits[tag] = kw;
  }
  return hits;
}

// L0 ∪ facets 并集路由
function routeWithFacets(query, index, facets, threshold = 0) {
  const base = route(query, index, 0); // L0 全 matched（threshold=0 拿全候选）
  const facetConf = facets.facetConf != null ? facets.facetConf : 0.5;

  // byPath 并集：L0 命中 + facets 命中
  const byPath = new Map();
  for (const m of base.matched) byPath.set(m.path, { path: m.path, confidence: m.confidence, hits: m.hits, facetHits: [] });

  const tagHits = matchTags(query, facets);
  for (const [tag, kw] of Object.entries(tagHits)) {
    for (const file of facets.tags[tag].files) {
      if (!byPath.has(file)) byPath.set(file, { path: file, confidence: 0, hits: [], facetHits: [] });
      const e = byPath.get(file);
      e.facetHits.push(`${tag}:${kw}`);
      // facets 命中提升到 facetConf（L0 已更高则保留）
      if (e.confidence < facetConf) e.confidence = facetConf;
    }
  }

  const matched = [...byPath.values()]
    .filter(m => m.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
  const loaded = matched.filter(m => m.confidence >= threshold);
  return { query, threshold, matched, loaded, tagHits: Object.keys(tagHits) };
}

module.exports = { loadFacets, matchTags, routeWithFacets };

// CLI: node router/route-facets.js "你的问题"
if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('用法: node router/route-facets.js "问题"');
    process.exit(1);
  }
  const index = buildIndex();
  const facets = loadFacets();
  const { matched, loaded, tagHits } = routeWithFacets(query, index, facets);
  console.log('查询:', query);
  console.log('命中 facets:', tagHits.join(', ') || '(无)');
  console.log('\n全部匹配 (confidence 降序, facets 命中=0.5):');
  for (const m of matched) {
    const fh = m.facetHits.length ? `  [facet: ${m.facetHits.join('; ')}]` : '';
    console.log(`  ${m.confidence.toFixed(3)}  ${m.path}  [${(m.hits || []).join(', ')}]${fh}`);
  }
}
