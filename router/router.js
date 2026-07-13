// L0 关键词路由器 —— 纯 Node，零依赖。
//
// 设计思想（见仓库 README 的「单核路由 + receipt」）：
//   - 描述符从文件自身抽（H1/H2/H3 标题 + **bold** 术语），不靠人手标 spine/facets。
//   - 谓词必须便宜、可观测：标题/bold 是结构性 token，扫一次即得，不需加载全文判语义。
//   - 打分 = 带 IDF 的查询覆盖率：query 的信息质量有多少被该文件覆盖。白盒可解释。
//   - CJK 友好：ASCII 走词边界，CJK 走 bigram，不依赖分词库。
//
// 这是 L0（µs 秒配，确定性）。L1（便宜 LLM 按描述分类，仅歧义时）留后续切片。

const fs = require('fs');
const path = require('path');

const CORPUS_DIR = path.join(__dirname, '..', 'corpus');
const DEFAULT_THRESHOLD = 0.3; // 评估时做阈值扫描，这里只是默认值

// ---- 分词 ----

function tokenize(text) {
  const tokens = [];
  // ASCII 词（含 - _ 数字后缀），小写化
  const ascii = text.match(/[A-Za-z][A-Za-z0-9_-]*/g) || [];
  for (const w of ascii) tokens.push(w.toLowerCase());
  // CJK 连续段切 bigram（单字则保留单字）
  const cjkRuns = text.match(/[一-鿿]+/g) || [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

// ---- 描述符抽取：标题 + bold + 正文，位置加权建 per-file token 袋 ----
// 权重：H1=3, H2=2, H3=1.5, bold=1.5, 正文=1。打分时归一到 [0,1]，标题命中满权、正文命中 1/3。
// 只抽标题会太稀疏（"SQL 注入"在 01-security 的正文 checklist，不在标题）-> 纳入正文，靠 IDF 抑噪。

function extractDescriptors(content) {
  const bag = {}; // token -> max weight seen
  const lines = content.split(/\r?\n/);

  const add = (text, weight) => {
    for (const t of tokenize(text)) {
      if (!bag[t] || bag[t] < weight) bag[t] = weight;
    }
  };

  for (const raw of lines) {
    const line = raw;
    let bodyWeight = 1;
    let headingText = null;

    if (/^###\s+/.test(line)) { headingText = line.replace(/^###\s+/, '').trim(); bodyWeight = 1.5; }
    else if (/^##\s+/.test(line)) { headingText = line.replace(/^##\s+/, '').trim(); bodyWeight = 2; }
    else if (/^#\s+/.test(line)) { headingText = line.replace(/^#\s+/, '').trim(); bodyWeight = 3; }

    if (headingText) add(headingText, bodyWeight);

    // bold 术语（行内，可能多个），先抽出再加权
    const bolds = line.match(/\*\*([^*]+)\*\*/g) || [];
    for (const b of bolds) add(b.replace(/\*\*/g, ''), 1.5);

    // 正文：去掉 heading 标记和 bold 标记后的剩余文本
    const body = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim();
    if (body) add(body, 1);
  }
  return bag;
}

// ---- 建索引 ----

function buildIndex(corpusDir = CORPUS_DIR) {
  const files = fs.readdirSync(corpusDir).filter(f => f.endsWith('.md')).sort();
  const docs = []; // { name, path, bag }
  const df = {}; // token -> 出现在多少文件

  for (const f of files) {
    const full = path.join(corpusDir, f);
    const content = fs.readFileSync(full, 'utf8');
    const bag = extractDescriptors(content);
    const name = f.replace(/\.md$/, '');
    docs.push({ name, path: full, bag });
    for (const t of Object.keys(bag)) df[t] = (df[t] || 0) + 1;
  }

  const N = docs.length;
  const idf = {};
  for (const t of Object.keys(df)) idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1; // +1 平滑

  // per-file token 的 idf 加权分（用于打分时取交集）
  for (const doc of docs) {
    doc.weighted = {};
    for (const t of Object.keys(doc.bag)) doc.weighted[t] = doc.bag[t] * idf[t];
  }

  return { docs, idf, N };
}

// ---- 打分：带 IDF 的加权查询覆盖率 ----
// score = sum(idf[t] * (bag[t]/3) for t in query∩doc) / sum(idf[t] for t in query)
// 标题命中 bag=3 -> 满权 1.0；正文命中 bag=1 -> 0.33。含义：query 的信息质量里，该文件（按结构强度）覆盖了多少。
// 有界 [0,1]，白盒可解释。

function score(doc, queryTokens, idf, N) {
  let covered = 0;
  let total = 0;
  const hits = [];
  const defaultIdf = Math.log((N + 1) / 2) + 1; // OOV token 的默认 idf（当作只出现在一半文件）
  for (const t of queryTokens) {
    const w = idf[t] || defaultIdf;
    total += w;
    if (doc.bag[t] !== undefined) {
      const structural = Math.min(doc.bag[t] / 3, 1);
      covered += w * structural;
      hits.push(t);
    }
  }
  if (total === 0) return { confidence: 0, hits: [] };
  return { confidence: covered / total, hits };
}

// ---- 路由 ----

function route(query, index, threshold = DEFAULT_THRESHOLD) {
  const queryTokens = tokenize(query);
  const matched = index.docs
    .map(doc => {
      const { confidence, hits } = score(doc, queryTokens, index.idf, index.N);
      return { path: doc.name, confidence, hits };
    })
    .filter(m => m.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  const loaded = matched.filter(m => m.confidence >= threshold);
  return { query, threshold, matched, loaded };
}

module.exports = { buildIndex, buildSkillIndex, route, tokenize, extractDescriptors, DEFAULT_THRESHOLD };

// ---- skill 索引：从 manifest 的 description + triggers + name 建 ----
// frontmatter 本就是触发面，比从正文硬抽干净。description/triggers 权重 3，name 权重 2。

function buildSkillIndex(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const docs = [];
  const df = {};
  for (const s of manifest) {
    const bag = {};
    const add = (text, weight) => {
      for (const t of tokenize(text)) {
        if (!bag[t] || bag[t] < weight) bag[t] = weight;
      }
    };
    if (s.description) add(s.description, 3);
    for (const tr of s.triggers || []) add(tr, 3);
    if (s.name) add(s.name, 2);
    docs.push({ name: s.name, path: s.name, bag });
    for (const t of Object.keys(bag)) df[t] = (df[t] || 0) + 1;
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

// CLI 直接跑：node router.js "你的问题"
if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('用法: node router/router.js "你的问题"');
    process.exit(1);
  }
  const index = buildIndex();
  const { matched, loaded } = route(query, index);
  console.log('查询:', query);
  console.log('\n全部匹配 (confidence 降序):');
  for (const m of matched) {
    console.log(`  ${m.confidence.toFixed(3)}  ${m.path}  [${m.hits.join(', ')}]`);
  }
  console.log(`\n载入 (>= ${DEFAULT_THRESHOLD}):`);
  for (const m of loaded) console.log(`  -> ${m.path}`);
}
