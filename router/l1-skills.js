// L1 skill 路由（两阶段）：
//   - L0 有候选 -> 逐个 LLM judge yes/no（precision 过滤，治共享词误报如 "PR review" 匹配 13 个）
//   - L0 零匹配 -> 单次 LLM 语义检索补召回（跨语言，治中文 query vs 英文 description 零重叠）
// skill descriptor = frontmatter 的 description + triggers + name（比正文干净）。
//
// skill 语料 L0 的主缺口是 recall（跨语言零匹配 R=0.500），不是 precision。
// 所以 L1 skill 比 L1 rule 多一阶段（语义检索补召回）--这才是 L1 跨语言的真正价值。

const fs = require('fs');
const path = require('path');
const { buildSkillIndex, route } = require('./router');
const { judgeRelevance, callMessages, cacheStats } = require('./llm');

const MANIFEST = path.join(__dirname, '..', 'skills-corpus.json');

// name -> descriptor 文本（description + triggers + name）
function buildSkillDescriptors(manifestPath = MANIFEST) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const map = {};
  for (const s of manifest) {
    const parts = [];
    if (s.name) parts.push(s.name);
    if (s.description) parts.push(s.description);
    if (s.triggers && s.triggers.length) parts.push(s.triggers.join('\n'));
    map[s.name] = parts.join('\n');
  }
  return map;
}

function loadAllSkills(manifestPath = MANIFEST) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).map(s => ({
    name: s.name,
    description: s.description || '',
  }));
}

// 零匹配时：单次 LLM 调用，给所有 skill name+description，返回相关 name 数组（跨语言语义检索）
async function semanticRetrieve(query, allSkills) {
  const list = allSkills.map(s => `${s.name}: ${s.description}`).join('\n');
  const prompt = `用户问题: ${query}

以下是所有可用 skill（每行 name: description）:
${list}

选出这个问题回答「明确需要」用到的 skill（一到多个，只选核心相关的，别选仅沾边的）。
只返回 JSON 数组，不要任何其它内容: ["skill-name1", "skill-name2"]`;
  try {
    const { text } = await callMessages(prompt, 1000);
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.filter(x => typeof x === 'string');
    } catch {}
    // 容错：正则提取 "name"
    const matches = text.match(/"([a-z0-9-]+)"/gi) || [];
    return [...new Set(matches.map(m => m.replace(/"/g, '')))];
  } catch (e) {
    return [];
  }
}

async function routeL1Skills(query, skillIndex, descriptors, allSkills, l0Threshold = 0.05) {
  const { matched } = route(query, skillIndex, 0);
  const candidates = matched.filter(m => m.confidence >= l0Threshold);

  if (candidates.length === 0) {
    // 零匹配：LLM 语义检索补召回（跨语言）
    const retrieved = await semanticRetrieve(query, allSkills);
    return {
      query,
      l0Threshold,
      l0Candidates: [],
      judged: [],
      l1Loaded: retrieved,
      mode: 'semantic-retrieve',
      reason: `L0 零匹配，LLM 检索 ${retrieved.length} 个`,
    };
  }

  // 有候选：逐个 judge（precision 过滤）
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
  const yesLoaded = judged.filter(j => j.verdict === 'yes').map(j => j.path);

  // judge 滤完空：L0 候选都是误报，真目标可能漏召回 -> 语义检索补
  if (yesLoaded.length === 0) {
    const retrieved = await semanticRetrieve(query, allSkills);
    return {
      query,
      l0Threshold,
      l0Candidates: candidates.map(c => c.path),
      judged,
      l1Loaded: retrieved,
      mode: 'judge+retrieve',
      reason: `${candidates.length} 候选全被 LLM 滤，检索补 ${retrieved.length} 个`,
    };
  }

  return {
    query,
    l0Threshold,
    l0Candidates: candidates.map(c => c.path),
    judged,
    l1Loaded: yesLoaded,
    mode: 'judge',
    reason: `${candidates.length} 候选 -> ${yesLoaded.length} 载`,
  };
}

module.exports = { routeL1Skills, buildSkillDescriptors, loadAllSkills, semanticRetrieve };

// CLI: node router/l1-skills.js "你的问题"
if (require.main === module) {
  (async () => {
    const query = process.argv.slice(2).join(' ');
    if (!query) {
      console.error('用法: node router/l1-skills.js "你的问题"');
      process.exit(1);
    }
    const index = buildSkillIndex(MANIFEST);
    const descriptors = buildSkillDescriptors();
    const allSkills = loadAllSkills();
    const r = await routeL1Skills(query, index, descriptors, allSkills);

    console.log('查询:', query);
    console.log(`模式: ${r.mode}  (${r.reason})`);
    if (r.judged.length) {
      console.log(`\nL0 候选 (>= ${r.l0Threshold}): ${r.l0Candidates.length} 条`);
      for (const j of r.judged) {
        const flag = j.verdict === 'yes' ? '✓载' : '✗滤';
        console.log(`  ${flag} ${j.confidence.toFixed(3)}  ${j.path}  [${j.verdict}] ${j.reason}`);
      }
    } else {
      console.log('\n(L0 零匹配，走 LLM 语义检索)');
    }
    console.log(`\nL1 载入 (${r.l1Loaded.length} 条): ${r.l1Loaded.join(', ') || '(空)'}`);
    console.log('LLM 调用:', cacheStats());
  })();
}
