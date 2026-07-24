// L1+facets 路由 -- facets 补 L0 漏的候选 + LLM judge 滤沾边（第 18 个 receipt 的路由器）。
//
// facets 朴素实现证伪（固定 0.5 + 子串匹配 precision 崩，见 receipt 10/12）。根因：tag 拉沾边没过滤。
// 修法：facets 命中文件并入候选池，由 LLM judge 逐个判 yes/no，只留真相关的。
// - L1-only: L0 候选（conf>=l0Threshold）-> judge
// - L1+facets: L0 候选 ∪ facets 命中文件 -> judge（facets 补 L0 conf 太低漏的，judge 滤沾边）
//
// claim（可证伪）：L1+facets 比 L1-only recall 升（facets 救 L0 漏的）+ precision 可控（judge 滤沾边）。
// 若成立 -> facets 配 LLM judge 翻盘；若不成立 -> facets 这条路真死。

const { route } = require('./router');
const { judgeRelevance } = require('./llm');
const { matchTags } = require('./route-facets');

async function routeL1Facets(query, index, descriptors, facets, l0Threshold = 0.05) {
  const { matched } = route(query, index, 0);
  const l0Candidates = matched.filter(m => m.confidence >= l0Threshold).map(m => m.path);

  // facets 命中文件（补 L0 漏的）
  const tagHits = matchTags(query, facets);
  const facetFiles = new Set();
  for (const tag of Object.keys(tagHits)) for (const f of facets.tags[tag].files) facetFiles.add(f);

  // 并集候选：L0 候选 ∪ facets 命中
  const candidates = [...new Set([...l0Candidates, ...facetFiles])];

  const judged = [];
  for (const p of candidates) {
    const l0m = matched.find(m => m.path === p);
    const desc = descriptors[p] || p;
    const r = await judgeRelevance(query, p, desc);
    judged.push({
      path: p,
      confidence: l0m ? l0m.confidence : 0,
      fromFacets: !l0m || l0m.confidence < l0Threshold,
      verdict: r.verdict,
      reason: r.reason,
    });
  }

  const l1Loaded = judged.filter(j => j.verdict === 'yes').map(j => j.path);
  const facetsAdded = candidates.filter(p => !l0Candidates.includes(p));
  return { query, l0Threshold, l0Candidates, facetFiles: [...facetFiles], candidates, judged, l1Loaded, facetsAdded, tagHits: Object.keys(tagHits) };
}

module.exports = { routeL1Facets };
