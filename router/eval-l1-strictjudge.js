// rule 语料严 judge 治 precision（重标证伪后的唯一 precision 杠杆）。
//
// 第 22 个 receipt。重标（receipt 15）证伪了"precision 低是标注 artifact"--
// precision 天花板 ~0.65 是真的，病因是 judge"沾边即 yes"。skill 语料已验严 judge
//（P 0.577->0.650，receipt 8），rule 语料还没做。本切片补上，闭环 precision 真病因。
//
// 省成本：l1-llm.json 已存 predicted（lenient judgeYes），对其用严 judge 重判，
// 只留 strict-yes，不重跑 L0 候选 + lenient judge。复用 buildDescriptors() 喂 descriptor。
//
// baseline = L1-only v3（relabel-v3.json l1.v3 = 0.648/0.944/0.719，v3 标签）。

const fs = require('fs');
const path = require('path');
const { buildDescriptors } = require('./l1');

const L1 = path.join(__dirname, '..', 'results', 'l1-llm.json');
const RELABEL = path.join(__dirname, '..', 'results', 'relabel-v3.json');
const TESTSET = path.join(__dirname, '..', 'testset.json'); // v3
const OUT = path.join(__dirname, '..', 'results', 'l1-strictjudge.json');

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

// 严 judge：只"直接要用 / 近义重复"才 yes
async function judgeStrict(query, ruleName, descriptor) {
  const prompt = `你是严格的规则路由器。判断「这个问题」是否**直接需要**「这条规则」来回答。

问题: ${query}
候选规则: ${ruleName}
规则内容摘要（标题 + 关键术语）:
${descriptor}

严格判断标准：
- "yes" = 这条规则的核心内容是回答该问题**直接要用 / 应遵循**的，或近义重复
- "no" = merely 相关/相邻/沾边/同领域但功能不同，或只是"提到相关词但规则核心不适用"

例：问题"API key硬编码了" -> 候选"01-security"=yes，候选"06a-security-audit"=no（审计 pipeline ≠ 已知 key 的 Secret 管理）；问题"规则怎么验证有效" -> 候选"A4-rule-measurement"=yes，候选"06-verify"=no（验代码质量 ≠ 验规则有效）；问题"commit message 格式" -> 候选"07-output"=yes，候选"06-verify"=no（质量门含'提交'但 ≠ commit 格式）。

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
  const l1 = JSON.parse(fs.readFileSync(L1, 'utf8'));
  const relabel = JSON.parse(fs.readFileSync(RELABEL, 'utf8'));
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8')); // v3
  const descriptors = buildDescriptors();
  const v3byQuery = new Map(cases.map(c => [c.query, c.expected]));

  const baseline = relabel.l1.v3; // 0.648/0.944/0.719

  let calls = 0;
  const detail = [];
  process.stdout.write('严 judge 重判 predicted: ');
  for (const d of l1.detail) {
    const expected = v3byQuery.get(d.query) || d.expected;
    const judged = [];
    for (const p of d.predicted) {
      const r = await judgeStrict(d.query, p, descriptors[p] || p);
      calls++;
      judged.push({ path: p, verdict: r.verdict, reason: r.reason });
    }
    const strictYes = judged.filter(j => j.verdict === 'yes').map(j => j.path);
    const m = prf(strictYes, expected);
    detail.push({
      query: d.query, expected, lenientPredicted: d.predicted, strictYes, judged,
      precision: +m.precision.toFixed(3), recall: +m.recall.toFixed(3), f1: +m.f1.toFixed(3),
      tp: m.tp, fp: m.fp, fn: m.fn,
    });
    process.stdout.write(m.precision === 1 && m.recall === 1 ? '✓' : '✗');
  }
  console.log('');

  const M = macro(detail);
  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    method: 'L1-only predicted（lenient judgeYes）-> 严 judge 重判（只直接要用/近义重复 yes）-> strict-yes',
    baseline: 'L1-only v3（relabel-v3.json，v3 标签）',
    llmCalls: calls,
    macro: { precision: +M.precision.toFixed(3), recall: +M.recall.toFixed(3), f1: +M.f1.toFixed(3) },
    baselineMacro: baseline,
    delta: {
      precision: +(M.precision - baseline.precision).toFixed(3),
      recall: +(M.recall - baseline.recall).toFixed(3),
      f1: +(M.f1 - baseline.f1).toFixed(3),
    },
    note: '严 judge 治 precision（重标证伪后的真病因）。失败保守判 no（不载）。参照 skill 语料严 judge P 0.577->0.650',
    detail,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== rule 严 judge receipt ===');
  console.log(`重判 ${calls} 个 predicted 成员`);
  console.log(`\nL1-only v3(baseline) P=${baseline.precision}  R=${baseline.recall}  F1=${baseline.f1}`);
  console.log(`严 judge            P=${M.precision.toFixed(3)}  R=${M.recall.toFixed(3)}  F1=${M.f1.toFixed(3)}`);
  console.log(`Δ                   P=${result.delta.precision >= 0 ? '+' : ''}${result.delta.precision}  R=${result.delta.recall >= 0 ? '+' : ''}${result.delta.recall}  F1=${result.delta.f1 >= 0 ? '+' : ''}${result.delta.f1}`);
  console.log('\n每题:');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${flag} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [strict: ${d.strictYes.join(',') || '-'}] [exp: ${d.expected.join(',')}]  ${d.query.slice(0, 20)}`);
  }
  console.log(`\nreceipt: ${OUT}`);
}
main();
