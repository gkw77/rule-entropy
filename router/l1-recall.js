// L1 + recall 路由：L0 候选 + LLM 提名 L0 漏的 -> 合并 -> L1 judge。
//
// 解决 L1-only 的 recall 上限：L1 只在 L0 候选上判，L0 漏召回的题（如"规则怎么验证有效"
// 没命中 A4 的"度量/receipt"术语）L1 救不了。recall 切片让 LLM 看全部规则 descriptor，
// 提名 L0 漏的，合并后再 L1 judge（precision 仍由 judge 守）。
//
// 不动 l1.js（L1-only 代码冻结，receipt 可复现）；l1-recall.js 独立切片。

const { buildIndex, route } = require('./router');
const { judgeRelevance, callMessages, cacheStats } = require('./llm');
const { buildDescriptors } = require('./l1');

const L0_THRESHOLD = 0.05;

// LLM 提名：给全部规则 descriptor，问除已有候选外还有哪些相关。返回规则名数组。
async function nominate(query, l0Candidates, descriptors) {
  const allRules = Object.keys(descriptors).sort().map(name => ({
    name,
    desc: (descriptors[name] || '').slice(0, 200),
  }));
  const prompt = `你是规则路由器。判断「这个问题」除已有候选外，还需要哪些规则。

问题: ${query}

已有候选(关键词命中): ${l0Candidates.join(', ') || '(无)'}

全部规则库(规则名 + 内容摘要):
${allRules.map(r => `- ${r.name}: ${r.desc}`).join('\n')}

判断标准: 除已有候选外，还有哪些规则的核心内容，是这个问题的回答应当遵循/用到的？
- 只提名核心确实适用的，不要凑数，不要重复已有候选
- 没有额外的就返回空数组

只输出 JSON，不要任何其它内容: {"nominate":["规则名1","规则名2"]}`;

  const { text } = await callMessages(prompt, 1500);
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      if (Array.isArray(j.nominate)) {
        return j.nominate.filter(n => descriptors[n] && !l0Candidates.includes(n));
      }
    }
  } catch {}
  return [];
}

async function routeL1Recall(query, index, descriptors, l0Threshold = L0_THRESHOLD) {
  const { matched } = route(query, index, 0);
  const l0Candidates = matched.filter(m => m.confidence >= l0Threshold).map(m => m.path);

  const nominated = await nominate(query, l0Candidates, descriptors);

  // 合并去重：L0 候选 + LLM 提名
  const merged = [...new Set([...l0Candidates, ...nominated])];

  const judged = [];
  for (const p of merged) {
    const desc = descriptors[p] || p;
    const r = await judgeRelevance(query, p, desc);
    judged.push({
      path: p,
      confidence: matched.find(m => m.path === p)?.confidence || 0,
      verdict: r.verdict,
      reason: r.reason,
      source: l0Candidates.includes(p) ? 'l0' : 'nominate',
    });
  }

  const l1Loaded = judged.filter(j => j.verdict === 'yes').map(j => j.path);
  return { query, l0Threshold, l0Candidates, nominated, merged, judged, l1Loaded };
}

module.exports = { routeL1Recall, nominate };

// CLI smoke: node router/l1-recall.js "问题"
if (require.main === module) {
  (async () => {
    const query = process.argv.slice(2).join(' ');
    if (!query) { console.error('用法: node router/l1-recall.js "问题"'); process.exit(1); }
    const index = buildIndex();
    const descriptors = buildDescriptors();
    const r = await routeL1Recall(query, index, descriptors);
    console.log('查询:', query);
    console.log(`L0候选: ${r.l0Candidates.join(', ') || '(无)'}`);
    console.log(`LLM提名: ${r.nominated.join(', ') || '(无)'}`);
    console.log(`合并: ${r.merged.join(', ')}`);
    for (const j of r.judged) {
      const flag = j.verdict === 'yes' ? '✓载' : '✗滤';
      console.log(`  ${flag} [${j.source}] ${j.path}  ${j.reason}`);
    }
    console.log(`载入: ${r.l1Loaded.join(', ')}`);
    console.log('LLM调用:', cacheStats());
  })();
}
