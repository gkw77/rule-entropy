// L1 路由：L0 关键词给候选 -> L1 LLM 逐个判 yes/no -> 过滤误报。
//
// 流程：route(query) 拿 L0 matched（confidence >= l0Threshold，低阈值保 recall）
//   -> 对每个候抽取「规则名 + 标题 + bold 术语」作 descriptor（不送全文，省 token 够判语义）
//   -> judgeRelevance 判 verdict
//   -> l1Loaded = verdict=yes 的
//
// 不动 router.js（L0 代码冻结，receipt 可复现）；l1.js 独立读 corpus 抽 descriptor。

const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');
const { judgeRelevance, cacheStats } = require('./llm');

const CORPUS_DIR = path.join(__dirname, '..', 'corpus');

// 抽 descriptor 文本：H1/H2/H3 标题 + **bold** 术语（去重，bold 已在标题里的不重复）。
// 这是给 LLM 看的「规则核心是什么」，比 token 袋可读，比全文省 token。
function extractDescriptor(content) {
  const lines = content.split(/\r?\n/);
  const headings = [];
  const bolds = new Set();
  for (const raw of lines) {
    if (/^(#{1,3})\s+/.test(raw)) headings.push(raw.replace(/^#{1,3}\s+/, '').trim());
    for (const b of raw.match(/\*\*([^*]+)\*\*/g) || []) bolds.add(b.replace(/\*\*/g, ''));
  }
  const parts = [...headings];
  for (const b of bolds) {
    if (!headings.some(h => h.includes(b))) parts.push(b);
  }
  return parts.join('\n');
}

// 建 name -> descriptor 映射
function buildDescriptors(corpusDir = CORPUS_DIR) {
  const map = {};
  for (const f of fs.readdirSync(corpusDir).filter(f => f.endsWith('.md')).sort()) {
    const name = f.replace(/\.md$/, '');
    map[name] = extractDescriptor(fs.readFileSync(path.join(corpusDir, f), 'utf8'));
  }
  return map;
}

// L1 路由。l0Threshold 低（0.05）保 recall，让 L1 来滤 precision。
async function routeL1(query, index, descriptors, l0Threshold = 0.05) {
  const { matched } = route(query, index, 0); // 拿全 matched（confidence>0）
  const candidates = matched.filter(m => m.confidence >= l0Threshold);

  const judged = [];
  for (const m of candidates) {
    const desc = descriptors[m.path] || m.path;
    const r = await judgeRelevance(query, m.path, desc);
    judged.push({
      path: m.path,
      confidence: m.confidence,
      hits: m.hits,
      verdict: r.verdict,
      reason: r.reason,
    });
  }

  const l1Loaded = judged.filter(j => j.verdict === 'yes').map(j => j.path);
  return { query, l0Threshold, l0Candidates: candidates.map(c => c.path), judged, l1Loaded };
}

module.exports = { routeL1, buildDescriptors, extractDescriptor };

// CLI: node router/l1.js "你的问题"
if (require.main === module) {
  (async () => {
    const query = process.argv.slice(2).join(' ');
    if (!query) {
      console.error('用法: node router/l1.js "你的问题"');
      process.exit(1);
    }
    const index = buildIndex();
    const descriptors = buildDescriptors();
    const r = await routeL1(query, index, descriptors);

    console.log('查询:', query);
    console.log(`\nL0 候选 (>= ${r.l0Threshold}): ${r.l0Candidates.length} 条`);
    for (const j of r.judged) {
      const flag = j.verdict === 'yes' ? '✓载' : '✗滤';
      console.log(`  ${flag} ${j.confidence.toFixed(3)}  ${j.path}  [${j.verdict}] ${j.reason}`);
    }
    console.log(`\nL1 载入 (${r.l1Loaded.length} 条): ${r.l1Loaded.join(', ') || '(空)'}`);
    console.log('LLM 调用:', cacheStats());
  })();
}
