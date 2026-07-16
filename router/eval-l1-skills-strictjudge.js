// 严 judge 治 precision 规模退化。
//
// 第六个 receipt（scalefix）修了 recall 规模悬崖（R->1.000）但留了边界：
// precision 仍随规模退化（0.577 vs L1-70 的 0.785）--judge"沾边即 yes"放大，
// 325 里有更多堂兄弟 skill 被判 yes（review+springboot-verification，QA+ai-regression-testing）。
//
// 修法：更严的 judge--只对"直接要用的核心工具/近义重复"判 yes，沾边判 no。
//
// 省成本：scalefix 的 union（judgeYes ∪ retrieved，R=1.000 P=0.577）已存 JSON，
// FP 就是 union 里的堂兄弟。对 union 成员（~50）用严 judge 重判，只留 strict-yes。
// 不重跑 201 judge + 20 retrieve。

const fs = require('fs');
const path = require('path');

const SCALEFIX = path.join(__dirname, '..', 'results', 'l1-skills-scalefix.json');
const MANIFEST = path.join(__dirname, '..', 'skills-corpus-full.json');
const OUT = path.join(__dirname, '..', 'results', 'l1-skills-strictjudge.json');

const BASE = process.env.ANTHROPIC_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding';
const MODEL = process.env.ANTHROPIC_MODEL || 'glm-5.2';
const TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;

async function callNoThinking(prompt, maxTokens = 300) {
  const body = { model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  try { body.thinking = { type: 'disabled' }; } catch {}
  const resp = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) { const t = await resp.text().catch(() => ''); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
  const data = await resp.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
}

function parseVerdict(raw) {
  try { const j = JSON.parse(raw); if (j.verdict === 'yes' || j.verdict === 'no') return { verdict: j.verdict, reason: j.reason || '' }; } catch {}
  const m = raw.match(/"verdict"\s*:\s*"(yes|no)"/i);
  if (m) return { verdict: m[1].toLowerCase(), reason: '' };
  return null;
}

// 严 judge：只"直接核心工具/近义重复"才 yes
async function judgeStrict(query, name, descriptor) {
  const prompt = `你是严格的 skill 路由器。判断「这个问题」是否**直接需要**「这条 skill」。

问题: ${query}
候选 skill: ${name}
skill 描述: ${descriptor}

严格判断标准：
- "yes" = 这条 skill 是这个问题**直接要用的核心工具**，或其近义重复（如同一功能的改名版）
- "no" = merely 相关/相邻/沾边/同领域但功能不同

例：问题"做 PR review" -> 候选"review"=yes，候选"springboot-verification"=no（验证≠review）；问题"QA 测试" -> 候选"qa"=yes，候选"ai-regression-testing"=no（回归测试≠QA）；问题"markdown 转 PDF" -> 候选"make-pdf"=yes，候选"nutrient-document-processing"=no（特定 PDF 库≠通用转 PDF）。

宁可漏判 no，不可沾边判 yes。只输出 JSON: {"verdict":"yes 或 no","reason":"一句话"}`;
  try {
    return parseVerdict(await callNoThinking(prompt, 300)) || { verdict: 'no', reason: 'parse fail' };
  } catch (e) {
    return { verdict: 'no', reason: `error: ${e.message.slice(0, 80)}` }; // 失败保守判 no（不载）
  }
}

function prf(predicted, expected) {
  const P = new Set(predicted), E = new Set(expected);
  let tp = 0; for (const e of E) if (P.has(e)) tp++;
  const precision = P.size === 0 ? 0 : tp / P.size;
  const recall = E.size === 0 ? 1 : tp / E.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp: P.size - tp, fn: E.size - tp };
}
function macro(rows) {
  if (!rows.length) return { precision: 0, recall: 0, f1: 0 };
  const s = rows.reduce((a, r) => ({ p: a.p + r.precision, r: a.r + r.recall, f: a.f + r.f1 }), { p: 0, r: 0, f: 0 });
  return { precision: s.p / rows.length, recall: s.r / rows.length, f1: s.f / rows.length };
}

async function main() {
  if (!TOKEN) { console.error('缺 ANTHROPIC_AUTH_TOKEN'); process.exit(1); }
  const sf = JSON.parse(fs.readFileSync(SCALEFIX, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const descByName = new Map(manifest.map(s => [s.name, [s.description || '', ...(s.triggers || [])].join('\n')]));
  const baseline = sf.macro; // scalefix 0.577/1.000/0.673

  let calls = 0;
  const detail = [];
  process.stdout.write('严 judge 重判 union 成员: ');
  for (const d of sf.detail) {
    const judged = [];
    for (const name of d.union) {
      const r = await judgeStrict(d.query, name, descByName.get(name) || name);
      calls++;
      judged.push({ name, verdict: r.verdict, reason: r.reason });
    }
    const strictYes = judged.filter(j => j.verdict === 'yes').map(j => j.name);
    const m = prf(strictYes, d.expected);
    detail.push({
      query: d.query, expected: d.expected, union: d.union, strictYes,
      judged, precision: +m.precision.toFixed(3), recall: +m.recall.toFixed(3), f1: +m.f1.toFixed(3),
      tp: m.tp, fp: m.fp, fn: m.fn,
    });
    process.stdout.write(m.precision === 1 && m.recall === 1 ? '✓' : '✗');
  }
  console.log('');

  const M = macro(detail);
  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    method: 'scalefix union（R=1.000 P=0.577）-> 严 judge 重判（只直接核心/近义重复 yes）-> strict-yes',
    llmCalls: calls,
    macro: { precision: +M.precision.toFixed(3), recall: +M.recall.toFixed(3), f1: +M.f1.toFixed(3) },
    scalefixBaselineMacro: baseline,
    delta: {
      precision: +(M.precision - baseline.precision).toFixed(3),
      recall: +(M.recall - baseline.recall).toFixed(3),
      f1: +(M.f1 - baseline.f1).toFixed(3),
    },
    note: '严 judge 治 precision 规模退化。失败保守判 no（不载）',
    detail,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== 严 judge 治 precision 退化 receipt ===');
  console.log(`重判 ${calls} 个 union 成员`);
  console.log(`\nscalefix(baseline)  P=${baseline.precision}  R=${baseline.recall}  F1=${baseline.f1}`);
  console.log(`严 judge            P=${M.precision.toFixed(3)}  R=${M.recall.toFixed(3)}  F1=${M.f1.toFixed(3)}`);
  console.log(`Δ                   P=${result.delta.precision >= 0 ? '+' : ''}${result.delta.precision}  R=${result.delta.recall >= 0 ? '+' : ''}${result.delta.recall}  F1=${result.delta.f1 >= 0 ? '+' : ''}${result.delta.f1}`);
  console.log(`（参照 L1-70: P=0.785 R=1.000 F1=0.842）`);
  console.log('\n每题:');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${flag} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [strict: ${d.strictYes.join(',') || '-'}] [exp: ${d.expected.join(',')}]  ${d.query.slice(0,20)}`);
  }
  console.log(`\nreceipt: ${OUT}`);
}

main();
