// 多层退一格路由 -- L0 top conf 低时逐层退父（子叶子->阶段父->树根），而非一步退树根。
//
// 设计（见 README「过载边界」+ 退一格 receipt 11 的 corpus 限制收尾）：
//   - 退一格 receipt 11 成立但受 corpus 扁平限制：只退树根 00-pipeline，多层树（叶子->阶段父）价值未验。
//   - 本切片给 corpus 加 L2 子叶子（corpus-l2/），验"逐层退"是否比"一步退树根"更精准。
//   - 逐层退：top1 是子叶子 -> 退阶段父；top1 是阶段文件 -> 退树根；top1 是根 -> 不退。
//   - 对比单层退（route-backoff.js，永远退树根）：同在 18 文件联合 index 上跑，公平对比。
//
// claim（可证伪）：针对子主题的模糊 query（L0 top1 是子叶子、conf 低），多层退到阶段父比单层退树根
//   更精准（recall 升且明确题不污染）。可能成立也可能证伪。

const fs = require('fs');
const path = require('path');
const { route, extractDescriptors } = require('./router');

const CORPUS_DIRS = [
  path.join(__dirname, '..', 'corpus'),
  path.join(__dirname, '..', 'corpus-l2'),
];
const TREE_PATH = path.join(__dirname, 'tree.json');

function loadTree(p = TREE_PATH) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// 联合 index：扫 corpus/ + corpus-l2/，合并 docs + df（与 router.buildIndex 同构，只是多目录）
function buildIndexMulti(dirs = CORPUS_DIRS) {
  const docs = [];
  const df = {};
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      const bag = extractDescriptors(content);
      const name = f.replace(/\.md$/, '');
      docs.push({ name, path: name, bag });
      for (const t of Object.keys(bag)) df[t] = (df[t] || 0) + 1;
    }
  }
  const N = docs.length;
  const idf = {};
  for (const t of Object.keys(df)) idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
  for (const doc of docs) {
    doc.weighted = {};
    for (const t of Object.keys(doc.bag)) doc.weighted[t] = doc.bag[t] * idf[t];
  }
  return { docs, idf, N };
}

// 多层退一格：top conf < lowConfThreshold 时退到 top1 的 parent（逐层退）
function routeWithBackoffMulti(query, index, tree, threshold = 0, opts = {}) {
  const lowConf = opts.lowConfThreshold != null ? opts.lowConfThreshold : 0.2;
  const backoffConf = opts.backoffConf != null ? opts.backoffConf : 0.3;

  const base = route(query, index, 0);
  const topConf = base.matched.length > 0 ? base.matched[0].confidence : 0;
  const triggered = topConf < lowConf;

  const matched = base.matched.map(m => ({ ...m, backoff: false }));
  let backoffAdded = null;
  if (triggered) {
    const top1 = base.matched[0];
    const parent = top1 ? tree.parent[top1.path] : null;
    const target = parent || tree.root; // top1 无 parent（=根）则退根（=自己，无操作）
    const existing = matched.find(m => m.path === target);
    if (existing) {
      if (existing.confidence < backoffConf) existing.confidence = backoffConf;
      existing.backoff = true;
    } else if (top1 && top1.path !== target) {
      matched.push({ path: target, confidence: backoffConf, hits: [], backoff: true });
      matched.sort((a, b) => b.confidence - a.confidence);
    }
    backoffAdded = top1 && top1.path !== target ? target : null;
  }

  const loaded = matched.filter(m => m.confidence >= threshold);
  return { query, threshold, matched, loaded, backoffTriggered: triggered, topConf, backoffAdded };
}

module.exports = { loadTree, buildIndexMulti, routeWithBackoffMulti, CORPUS_DIRS };

// CLI 探针: node router/route-backoff-multi.js "问题"
// 看 L0 top1/top conf + 逐层退会退到哪
if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('用法: node router/route-backoff-multi.js "问题"');
    process.exit(1);
  }
  const index = buildIndexMulti();
  const tree = loadTree();
  const { matched, topConf, backoffTriggered, backoffAdded } = routeWithBackoffMulti(query, index, tree, 0, { lowConfThreshold: 0.2 });
  console.log('查询:', query);
  console.log(`N=${index.N} 文件  top conf: ${topConf.toFixed(3)}  逐层退触发: ${backoffTriggered}  退到: ${backoffAdded || '-'}`);
  console.log('L0 全部匹配 (confidence 降序, 前 8):');
  for (const m of matched.slice(0, 8)) {
    const parent = tree.parent[m.path] || '-';
    console.log(`  ${m.confidence.toFixed(3)}  ${m.path}  (parent: ${parent})${m.backoff ? '  [backoff]' : ''}`);
  }
}
