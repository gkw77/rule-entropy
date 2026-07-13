// rule-evidence-audit.js - A4 证据状态审计：按 claim×receipt 给规则分类
// 用法:
//   扫本 repo 语料:  node reproducible/rule-evidence-audit.js corpus .
//   扫你自己的规则:  node reproducible/rule-evidence-audit.js ~/.claude/rules "common,python"
//   不带参数(原作者环境): node reproducible/rule-evidence-audit.js   -> 扫 ~/.claude/rules/{common,python}
// A4 核心：只有"声称度量改进"的规则才需 evidence；方法论散文 N/A。
// 分类：selftested(自测,partial) / secondhand(引用来源repo数字,需复现) / faith(声称度量零receipt) / claimNoMetric / behavior(N/A)
const fs = require('fs'), path = require('path');
const base = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'rules');
const dirs = process.argv[3] ? process.argv[3].split(',') : ['common', 'python'];

function stripCode(t){ return t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' '); }

// 声称"度量/效果改进"（窄：效果动词，不含 scope 词如"扩到"）
const CLAIM = /省|降低|减少|提升|提高|缩短|加速|拦截率|命中率|缓存命中|cache-?hit|reach.{0,4}LLM|误判率|零成本|cost|防.{0,6}漂移|防.{0,6}乐观|early-?exit|单调增长|no-op.{0,4}短路|短路|多抓|优于|捕获率|缺陷率|比.{0,6}(?:多|高|低|少|快)/i;
// 数字带单位（排除裸行数如"200-400 行"）。无尾 \b（% 是非词符，\b 后误断）；\$\d 处理 $0.104 形式
const NUMBER = /\$\d|\d+(?:\.\d+)?\s*(?:%|x|倍|k\b|runs?|t\/s|ms)/i;
// 强自测（仅无歧义的"我跑过"标志：primed-eyes rig / 显式我跑 / 自测(unambiguous, 区别于二手"实测") / promptfoo / N≥10 / median over）
// 注意 v1 已知不精确：二手"X 实测"偶发误匹配，靠人工 triage 兜底（A4：单脚本 rig 是 single-shot，需 N runs 复验）
const SELF_STRONG = /single-shot|自测|我.{0,3}跑过|我.{0,3}跑了|promptfoo|N\s*runs|N≥\s*10|median\s+over|rig\s*00[12]/i;
// 弱"实测"（几乎都是引用来源 repo 的"X 实测"，非我跑）-> 归 secondhand
const SELF_WEAK = /实测|自测|复算|reproduc|verify-claims|make .{0,8}metrics|agentic|benchmark/i;
// 二手 receipt（引用来源 repo）
const SOURCE = /来自\s|（来自|agent-chief|dao-code|ponytail|engram|gzh|merge-queue|openwiki|loopy|fable|openscience|T3MP3ST|TestSprite|exploitarium|dzhng|can1357|ronskill|rnskill|Cognitive-Core|MiMo-Code|cloudflare|BuilderIO|vercel\/eve|Kulaxyz|nagisanzenin|Forward-Future|mukul975|funador|synthetic-sciences|ai4s-research|elder-plinius|bikini|obra|affaan/i;

let rows = [];
let counts = { behavior:0, secondhand:0, selftested:0, faith:0, claimNoMetric:0, total:0 };

for (const d of dirs) {
  const dir = path.join(base, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.md'))) {
    const lines = fs.readFileSync(path.join(dir,f),'utf8').split('\n');
    let cur=null; const blocks=[];
    for (const ln of lines) {
      if (/^#{2,3}\s/.test(ln)) { if(cur)blocks.push(cur); cur={h:ln.trim(),body:[]}; }
      else if(cur) cur.body.push(ln);
    }
    if(cur)blocks.push(cur);
    for (const b of blocks) {
      const raw = b.h+'\n'+b.body.join('\n');
      if (raw.trim().length<40) continue;
      const c = stripCode(raw);
      counts.total++;
      const claim = CLAIM.test(c);
      const num = NUMBER.test(c);
      const selfStrong = SELF_STRONG.test(c);
      const selfWeak = SELF_WEAK.test(c);
      const src = SOURCE.test(c);
      let verdict;
      if (claim && num) {
        if (selfStrong) { verdict='selftested'; counts.selftested++; }          // 我真跑过（partial，需 N runs）
        else if (src || selfWeak) { verdict='secondhand'; counts.secondhand++; } // 引用来源 repo 数字（可复现但我没复现）
        else { verdict='faith'; counts.faith++; }                                // 声称度量零 receipt
      } else if (claim && !num) { verdict='claimNoMetric'; counts.claimNoMetric++; }
      else { verdict='behavior'; counts.behavior++; }
      if (verdict !== 'behavior') {
        rows.push({ dir:d, file:f, block:b.h.replace(/^#+\s/,'').slice(0,55), verdict, selfStrong, selfWeak, src });
      }
    }
  }
}

const t = counts.total;
const summary = {
  total: t,
  behavior_NA: counts.behavior, behaviorPct: +(counts.behavior/t*100).toFixed(0),
  secondhand_needsRepro: counts.secondhand,
  selftested_partial: counts.selftested,
  faith_unmeasured: counts.faith,
  claimNoMetric: counts.claimNoMetric,
};
// 门：faith>0 = WARN（声称度量零 receipt，纯信仰）；secondhand>0 = INFO（需自测复现）；selftested>0 = INFO（partial，需 N runs）
const gate = { errors:0, warnings: counts.faith>0?1:0, info: (counts.secondhand>0?1:0)+(counts.selftested>0?1:0) };
console.log(JSON.stringify({ summary, gate, claimedRules: rows }, null, 2));
