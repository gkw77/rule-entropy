// L1 + 直接语义检索（rule 语料）：L0 候选 judge 过滤 ∪ LLM 直接语义检索。
//
// 0714 旧账：skill 的 semanticRetrieve（直接检索、不再 judge、union 合并）成功救跨语言
// 零匹配(R 0.500->1.000)；但 rule 的 l1-recall（先「提名」再 judge）证伪(R 不涨 P 降)。
// 两个失败点：① nominate 的「除已有候选外」被已有锚定 ② retrieve 结果再过 judge 被滤。
// 本切片把 skill 的直接语义检索原样挪到 rule 语料，验能否救 L0 那 1 题语义漏
// （「规则怎么验证有效」没命中 A4 的「度量/receipt」术语，L0 R=0.917 的唯一漏召回）。
//
// 关键设计（对齐 skill semanticRetrieve，l1-skills.js）：
//   - 直接检索：给 LLM 全部规则 name+descriptor，问「明确需要哪些」，无「除已有外」锚定
//   - retrieve 结果直接进 union 不再 judge（judge 是 precision 工具，retrieve 是 recall 工具；
//     nominate 失败部分因「再 judge」把提名滤掉）
//   - union = judgeYes ∪ retrieved

const path = require('path');
const { buildIndex, route } = require('./router');
const { judgeRelevance, callMessages, cacheStats } = require('./llm');
const { buildDescriptors } = require('./l1');

const L0_THRESHOLD = 0.05;

// 全部规则 name+descriptor（给 LLM 直接检索）
function loadAllRules(descriptors) {
  return Object.keys(descriptors).sort().map(name => ({
    name,
    desc: descriptors[name] || '',
  }));
}

// 直接语义检索：给全部规则，问「明确需要哪些」，返回 name 数组（不再 judge）。
// prompt 对齐 skill semanticRetrieve（l1-skills.js），无「除已有外」锚定，直接选。
async function semanticRetrieveRules(query, allRules) {
  const list = allRules.map(r => `${r.name}: ${r.desc}`).join('\n');
  const prompt = `用户问题: ${query}

以下是全部可用规则（每行 规则名: 内容摘要）:
${list}

选出这个问题回答「明确需要」用到的规则（一到多个，只选核心相关的，别选仅沾边的）。
只返回 JSON 数组，不要任何其它内容: ["规则名1", "规则名2"]`;
  try {
    const { text } = await callMessages(prompt, 1000);
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.filter(x => typeof x === 'string');
    } catch {}
    // 容错：正则提取 "name"
    const matches = text.match(/"([^"]+)"/g) || [];
    return [...new Set(matches.map(m => m.replace(/"/g, '')))];
  } catch (e) {
    return [];
  }
}

async function routeL1Semantic(query, index, descriptors, l0Threshold = L0_THRESHOLD) {
  const { matched } = route(query, index, 0);
  const candidates = matched.filter(m => m.confidence >= l0Threshold);

  // 1. L0 候选 judge 过滤（precision，复用 l1.js 的 judgeRelevance）
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
      source: 'l0',
    });
  }
  const judgeYes = judged.filter(j => j.verdict === 'yes').map(j => j.path);

  // 2. 直接语义检索（recall，不再 judge）
  const allRules = loadAllRules(descriptors);
  const retrieved = await semanticRetrieveRules(query, allRules);

  // 3. union = judgeYes ∪ retrieved
  const union = [...new Set([...judgeYes, ...retrieved])];
  const sources = union.map(p => ({
    path: p,
    fromJudge: judgeYes.includes(p),
    fromRetrieve: retrieved.includes(p),
  }));

  return {
    query,
    l0Threshold,
    l0Candidates: candidates.map(c => c.path),
    judged,
    retrieved,
    judgeYes,
    l1Loaded: union,
    sources,
    mode: 'judge+semantic-retrieve-union',
    reason: `${judgeYes.length} judge-yes ∪ ${retrieved.length} retrieved = ${union.length}`,
  };
}

module.exports = { routeL1Semantic, semanticRetrieveRules, loadAllRules };

// CLI smoke: node router/l1-semantic.js "问题"
if (require.main === module) {
  (async () => {
    const query = process.argv.slice(2).join(' ');
    if (!query) { console.error('用法: node router/l1-semantic.js "你的问题"'); process.exit(1); }
    const index = buildIndex();
    const descriptors = buildDescriptors();
    const r = await routeL1Semantic(query, index, descriptors);

    console.log('查询:', query);
    console.log(`模式: ${r.mode}  (${r.reason})`);
    console.log(`\nL0 候选 (>= ${r.l0Threshold}): ${r.l0Candidates.length} 条`);
    for (const j of r.judged) {
      const flag = j.verdict === 'yes' ? '✓载' : '✗滤';
      console.log(`  ${flag} ${j.confidence.toFixed(3)}  ${j.path}  [${j.verdict}] ${j.reason}`);
    }
    console.log(`\nLLM 直接检索: ${r.retrieved.join(', ') || '(空)'}`);
    console.log(`\nL1 载入 (union ${r.l1Loaded.length} 条):`);
    for (const s of r.sources) {
      const tags = [s.fromJudge ? 'judge' : '', s.fromRetrieve ? 'retrieve' : ''].filter(Boolean).join('+');
      console.log(`  [${tags}] ${s.path}`);
    }
    console.log('LLM 调用:', cacheStats());
  })();
}
