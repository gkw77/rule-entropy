// 退一格路由 -- L0 top conf 低时载树根（00-pipeline）补总览召回（第三个 receipt 的路由器）。
//
// 设计（见 README「过载边界」+ plans/rule-entropy-facets-backoff.md 切片 2）：
//   - 过载边界"退一格载粗的"：叶子拿不准时退父节点。当前 corpus 扁平，退一格 = top conf 低时载树根 00-pipeline。
//   - 信号：模糊/总览 query（"规则整体怎么走"）L0 top conf 低（<0.2）且 top1 跑偏；明确 query top conf 高（>0.3）top1 对。
//   - 触发：top conf < lowConfThreshold -> 载树根（backoffConf），补总览召回；明确题不触发，不污染。
//
// claim（可证伪，受 corpus 扁平限制收窄）：模糊题退总览 recall 升、明确题不污染。
// corpus 限制：多层树（叶子->阶段父）价值未验，当前只退树根，留后续 corpus 扩 L2。

const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');

const TREE_PATH = path.join(__dirname, 'tree.json');

function loadTree(p = TREE_PATH) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// L0 + 退一格：top conf < lowConfThreshold 时载树根
function routeWithBackoff(query, index, tree, threshold = 0, opts = {}) {
  const lowConf = opts.lowConfThreshold != null ? opts.lowConfThreshold : 0.2;
  const backoffConf = opts.backoffConf != null ? opts.backoffConf : 0.3;

  const base = route(query, index, 0);
  const topConf = base.matched.length > 0 ? base.matched[0].confidence : 0;
  const triggered = topConf < lowConf;

  const matched = base.matched.map(m => ({ ...m, backoff: false }));
  let backoffAdded = null;
  if (triggered) {
    const root = tree.root;
    const existing = matched.find(m => m.path === root);
    if (existing) {
      if (existing.confidence < backoffConf) existing.confidence = backoffConf;
      existing.backoff = true;
    } else {
      matched.push({ path: root, confidence: backoffConf, hits: [], backoff: true });
      matched.sort((a, b) => b.confidence - a.confidence);
    }
    backoffAdded = root;
  }

  const loaded = matched.filter(m => m.confidence >= threshold);
  return { query, threshold, matched, loaded, backoffTriggered: triggered, topConf, backoffAdded };
}

module.exports = { loadTree, routeWithBackoff };

// CLI: node router/route-backoff.js "问题"
if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('用法: node router/route-backoff.js "问题"');
    process.exit(1);
  }
  const index = buildIndex();
  const tree = loadTree();
  const { loaded, backoffTriggered, topConf, backoffAdded } = routeWithBackoff(query, index, tree, 0.15);
  console.log('查询:', query);
  console.log(`top conf: ${topConf.toFixed(3)}  退一格触发: ${backoffTriggered}  补: ${backoffAdded || '-'}`);
  console.log('loaded (>=0.15):');
  for (const m of loaded) console.log(`  ${m.confidence.toFixed(3)}  ${m.path}${m.backoff ? '  [backoff]' : ''}`);
}
