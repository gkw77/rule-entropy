// 扩测试集 receipt：18 -> 44 题，重跑 L0 / L1-lenient / L1-strict，验单-shot 高估。
//
// 方法（对齐项目一贯纪律）：
//   - 44 题全部走同一管线（L0 确定性 + lenient judge + strict 重判），不混旧端点预测。
//   - expected 为多标签直接 govern 规则（annotation 独立于预测，新题无预测可抄）。
//   - full(44) vs base(18，即原 testset.json 那 18 题子集) 同管线对比，量化 N 扩大后数字是否 hold。
//   - 含 1 题 no-rule 空 expected（测过载 precision），recall 按项目惯例空集=1。
//
// 用法：
//   node router/eval-expand.js l0   # 只跑 L0（确定性，无 LLM）
//   node router/eval-expand.js       # L0 + L1（LLM judge，需 ANTHROPIC_AUTH_TOKEN）
const fs = require('fs');
const path = require('path');
const { buildIndex, route } = require('./router');
const { buildDescriptors, routeL1 } = require('./l1');
const { cacheStats } = require('./llm');

const ROOT = path.join(__dirname, '..');
const TESTSET = path.join(ROOT, 'testset-expanded.json');
const BASE_TESTSET = path.join(ROOT, 'testset.json'); // 原 18 题 v3
const OUT = path.join(ROOT, 'results', 'expand-receipt.json');

const THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7];
const L0_THR = 0.05; // L1 候选阈值，保 recall（与 l1.js 默认一致）

const L0ONLY = process.argv[2] === 'l0';

// ---- LLM 端点（与 llm.js / eval-l1-strictjudge.js 同源）----
const BASE = process.env.ANTHROPIC_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding';
const MODEL = process.env.ANTHROPIC_MODEL || 'glm-5.2';
const TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;

async function callNoThinking(prompt, maxTokens = 300) {
  const resp = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
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
// 严 judge：只"直接要用 / 近义重复"才 yes（receipt 16 标准）
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
    return { verdict: 'no', reason: `error: ${e.message.slice(0, 80)}` };
  }
}

// ---- 指标（与 eval-relabel.js 同源）----
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
const r3 = x => +Number(x).toFixed(3);

async function main() {
  const cases = JSON.parse(fs.readFileSync(TESTSET, 'utf8'));
  const baseQueries = new Set(JSON.parse(fs.readFileSync(BASE_TESTSET, 'utf8')).map(c => c.query));
  const isBase = c => baseQueries.has(c.query);

  const index = buildIndex();
  const descriptors = buildDescriptors();

  // ---- L0（确定性，无 LLM）----
  const l0Matched = cases.map(c => ({ query: c.query, expected: c.expected, matched: route(c.query, index, 0).matched }));
  const sweepAll = THRESHOLDS.map(t => {
    const rows = l0Matched.map(q => prf(q.matched.filter(m => m.confidence >= t).map(m => m.path), q.expected));
    return { threshold: t, ...macro(rows) };
  });
  const bestAll = sweepAll.reduce((b, s) => (s.f1 > b.f1 ? s : b), sweepAll[0]);
  const rowsBase = l0Matched.filter(q => isBase(q)).map(q =>
    prf(q.matched.filter(m => m.confidence >= bestAll.threshold).map(m => m.path), q.expected));
  const l0base = macro(rowsBase);

  console.log(`=== L0 (corpus/13, 确定性, N=${cases.length}) ===`);
  console.log(`best thr=${bestAll.threshold} full P=${r3(bestAll.precision)} R=${r3(bestAll.recall)} F1=${r3(bestAll.f1)}`);
  console.log(`           base(N=18) @ 同 thr: P=${r3(l0base.precision)} R=${r3(l0base.recall)} F1=${r3(l0base.f1)}`);

  if (L0ONLY) {
    const result = {
      timestamp: new Date().toISOString().slice(0, 10),
      mode: 'L0 only',
      note: 'N=18->44 扩测试集 L0 receipt（确定性，无 LLM）',
      n: cases.length,
      sweep: sweepAll.map(s => ({ threshold: s.threshold, precision: r3(s.precision), recall: r3(s.recall), f1: r3(s.f1) })),
      best: { threshold: bestAll.threshold, ...{ precision: r3(bestAll.precision), recall: r3(bestAll.recall), f1: r3(bestAll.f1) } },
      base18: { precision: r3(l0base.precision), recall: r3(l0base.recall), f1: r3(l0base.f1) },
    };
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    console.log('L0-only receipt ->', OUT);
    return;
  }

  if (!TOKEN) { console.error('缺 ANTHROPIC_AUTH_TOKEN（L1 需要）'); process.exit(1); }

  // ---- L1（lenient judge 全 44 题 -> strict 重判 predicted）----
  let lenientCalls = 0;
  let strictCalls = 0;
  const detail = [];
  process.stdout.write('L1 judge: ');
  for (const c of cases) {
    const r1 = await routeL1(c.query, index, descriptors, L0_THR);
    lenientCalls += r1.judged.length;
    const predicted = r1.l1Loaded; // lenient judgeYes
    const strictYes = [];
    const strictJudged = [];
    for (const p of predicted) {
      const r = await judgeStrict(c.query, p, descriptors[p] || p);
      strictCalls++;
      strictJudged.push({ path: p, verdict: r.verdict, reason: r.reason });
      if (r.verdict === 'yes') strictYes.push(p);
    }
    const m = prf(strictYes, c.expected);
    detail.push({
      query: c.query, expected: c.expected, base: isBase(c),
      l0Candidates: r1.l0Candidates,
      lenientPredicted: predicted,
      strictYes, strictJudged,
      precision: r3(m.precision), recall: r3(m.recall), f1: r3(m.f1), tp: m.tp, fp: m.fp, fn: m.fn,
    });
    process.stdout.write(m.precision === 1 && m.recall === 1 ? '✓' : '✗');
  }
  console.log('');

  const Mfull = macro(detail);
  const Mbase = macro(detail.filter(d => d.base));
  const Mnew = macro(detail.filter(d => !d.base));

  // lenient-only 也报（与 receipt 16 baseline 对齐：L1-only v3 = 0.648/0.944/0.719）
  const lenientRows = detail.map(d => prf(d.lenientPredicted, d.expected));
  const Lfull = macro(lenientRows);
  const Lbase = macro(detail.filter(d => d.base).map(d => prf(d.lenientPredicted, d.expected)));

  const result = {
    timestamp: new Date().toISOString().slice(0, 10),
    receipt: 'expand test set 18->44, re-verify L0/L1 (single-shot overestimate check)',
    method: '44 queries through one pipeline (L0 deterministic + lenient judge + strict re-judge); expected multi-label directly-governing rules, annotated independent of predictions',
    endpoint: `${BASE} (model ${MODEL})`,
    n: { total: cases.length, base: detail.filter(d => d.base).length, new: detail.filter(d => !d.base).length },
    llmCalls: { lenient: lenientCalls, strict: strictCalls, total: lenientCalls + strictCalls },
    l0: {
      best: { threshold: bestAll.threshold, ...{ precision: r3(bestAll.precision), recall: r3(bestAll.recall), f1: r3(bestAll.f1) } },
      base18: { precision: r3(l0base.precision), recall: r3(l0base.recall), f1: r3(l0base.f1) },
      sweep: sweepAll.map(s => ({ threshold: s.threshold, precision: r3(s.precision), recall: r3(s.recall), f1: r3(s.f1) })),
    },
    l1: {
      lenientFull: { precision: r3(Lfull.precision), recall: r3(Lfull.recall), f1: r3(Lfull.f1) },
      lenientBase18: { precision: r3(Lbase.precision), recall: r3(Lbase.recall), f1: r3(Lbase.f1) },
      strictFull: { precision: r3(Mfull.precision), recall: r3(Mfull.recall), f1: r3(Mfull.f1) },
      strictBase18: { precision: r3(Mbase.precision), recall: r3(Mbase.recall), f1: r3(Mbase.f1) },
      strictNewOnly: { precision: r3(Mnew.precision), recall: r3(Mnew.recall), f1: r3(Mnew.f1) },
    },
    delta: {
      l0fullVsBase: {
        precision: r3(bestAll.precision - l0base.precision),
        recall: r3(bestAll.recall - l0base.recall),
        f1: r3(bestAll.f1 - l0base.f1),
      },
      strictFullVsBase: {
        precision: r3(Mfull.precision - Mbase.precision),
        recall: r3(Mfull.recall - Mbase.recall),
        f1: r3(Mfull.f1 - Mbase.f1),
      },
    },
    detail,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== 扩测试集 receipt (N=18 -> 44) ===');
  console.log(`LLM 调用: lenient ${lenientCalls} + strict ${strictCalls} = ${lenientCalls + strictCalls}`);
  console.log(`\nL0:     base18 P=${r3(l0base.precision)} R=${r3(l0base.recall)} F1=${r3(l0base.f1)} | full P=${r3(bestAll.precision)} R=${r3(bestAll.recall)} F1=${r3(bestAll.f1)} @thr=${bestAll.threshold}`);
  console.log(`L1 len: base18 P=${r3(Lbase.precision)} R=${r3(Lbase.recall)} F1=${r3(Lbase.f1)} | full P=${r3(Lfull.precision)} R=${r3(Lfull.recall)} F1=${r3(Lfull.f1)}`);
  console.log(`L1 str: base18 P=${r3(Mbase.precision)} R=${r3(Mbase.recall)} F1=${r3(Mbase.f1)} | full P=${r3(Mfull.precision)} R=${r3(Mfull.recall)} F1=${r3(Mfull.f1)}`);
  console.log(`        new-only(N=26) P=${r3(Mnew.precision)} R=${r3(Mnew.recall)} F1=${r3(Mnew.f1)}`);
  console.log(`\ndelta full-vs-base: L0 ${r3(bestAll.f1 - l0base.f1)} F1 | L1-strict ${r3(Mfull.f1 - Mbase.f1)} F1`);
  console.log('\n每题 (strict):');
  for (const d of detail) {
    const flag = d.precision === 1 && d.recall === 1 ? '✓' : '✗';
    console.log(`  ${flag} ${d.base ? 'base' : 'new '} P=${d.precision.toFixed(2)} R=${d.recall.toFixed(2)}  [strict: ${d.strictYes.join(',') || '-'}] [exp: ${d.expected.join(',') || '∅'}]  ${d.query.slice(0, 24)}`);
  }
  console.log(`\nreceipt -> ${OUT} | cache size: ${cacheStats().size}`);
}
main();
