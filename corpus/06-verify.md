<!-- middleware: stage-6 -->

# Stage 6: Verify

> 触发时机: 代码写完后、提交前、会话结束时
> 职责: 质量门、测试、代码审查、安全审查

## 质量门（Quality Gates）

每个阶段结束前必须通过对应的质量门，不通过不进入下一阶段。

| 阶段 | 质量门 | 验证方式 |
|------|--------|---------|
| 规划 | 方案完整性 | 搜索记录、技术选型理由、风险识别 |
| 编译 | 零错误零警告 | 构建通过 |
| 测试 | 全部通过 + 覆盖率 | 测试运行结果 |
| 审查 | 无 CRITICAL/HIGH | Review checklist |
| 提交 | 干净 diff | git diff 检查 |

**执行规则：**
1. **不跳过**：即使用户说"快点"，质量门也要过
2. **快速失败**：发现问题立即报告，不继续往下做
3. **阻断传播**：上一阶段质量门未通过，下一阶段不开始

### 结构化质量门（来自 google-labs-code/design.md）

> 上面的 checklist 是给人读的；自动化门要给 agent 消费，必须输出**结构化 JSON**而非终端散文。

任何 lint/审查/检查工具，若结果要进 agent 决策循环，输出须为 findings 数组 + summary，每个 finding 带 `severity` + `path` + `message`：

```json
{
  "findings": [
    {"severity":"error","path":"src/auth.ts:42","message":"硬编码 token"},
    {"severity":"warning","path":"components/button-primary","message":"对比度 3.1:1 未过 WCAG AA"}
  ],
  "summary": {"errors":1,"warnings":1,"info":0}
}
```

**门判定规则（机器可查，非"感觉好了"）：**
- `summary.errors > 0` → BLOCK（映射下方 CRITICAL）
- `summary.warnings > 0` → WARN，需显式 acknowledge 才放行
- 全 0 → 通过

无现成 JSON linter 时，用脚本把 checklist 项转成同结构（grep 出违规行 → severity/path/message）。**禁止用"通过了"/"看起来没问题"作为门结果**——要么是结构化 findings，要么没跑这门。这补 stage-06 验证层的机器可读缺口，咬合 Stop-Condition 门（agent 喊完成时 judge 查的是这个 JSON，不是散文）。

### 产物溯源链（来自 ai4s-research/open-science）

> 06a 的 trace（entrypoint→propagation→sink）是安全 finding 专用；open-science 把溯源泛化到**所有 agent 产物**——每个图/表/报告/代码反链到产生它的 source code + data + environment + 对话。

- 每个 agent 产物（报告/文档/图/生成的代码）带**溯源链**：反链到源码位置 + 输入数据 + 运行环境 + 产生它的对话/prompt。产物脱离溯源链 = 六个月后无法复现（咬合 kage 教训：依赖外部的产物会坏）
- 验证产物时验**溯源链完整性**，不只验产物本身——链断 = 产物不可信
- 咬合 06a trace（安全 finding 溯源）+ A4 复现（committed data + 可重算）+ A1 receipts——同一溯源原则落到所有产物层

### run 层可审计：DAG-over-chat + per-run scorecard（来自 xiaotianfotos/homerail，未自测-行为规则）

> 补 06 产物溯源链（产物层反链）+ 06a trace（安全 finding 层）的**工作流 run 层**--不只产物带溯源，整个 agent run 是可 inspect/replay/improve 的 DAG，每次 run 产 scorecard。咬合 06 Stop-Condition（scorecard 作验收信号）+ 05 并行（DAG 节点 worktree 隔离）+ 04 活规格 slice（slice=DAG 节点，显式 handoff）+ A4（per-run scorecard=可度量）。

homerail 核心哲学：**chat 是黑盒，DAG 是可审查/重放/改进的图**。多步 agent 工作默认 DAG 化（节点+边+handoff trace+replay+scorecard），非线性 chat。倒漏斗：人对接口窄（语音/生成 UI），机器侧宽（多 agent 多环境 DAG）。

**落地**：
- 多步 agent 任务（>3 步或跨 agent）显式成 DAG：节点=step，边=handoff，每个 handoff traced（咬合 06a trace 但泛化到工作流层）
- 每次 run 可 replay（不只产物带溯源链，run 本身可重放--把 06 产物溯源从静态反链升到动态 replay）
- per-run scorecard：每次 run 产评估，长任务用 scorecard 作停止/验收信号（咬合 06 Stop-Condition 可观测证据 + A4 度量）
- README/文档写成 agent-readable runbook（命令自描述+每步说期望），咬合 A2 skill-as-pointer + openwiki + 04 Plan Handoff 自包含

注：homerail 与 agent-chief 共享"attention is scarcest resource"前提（旁证非孤证）。未自测-行为规则，待跨 session rig 验 scorecard/replay 的 efficacy（见 E:/cc/cross-session-rig-skeleton.md P1）。

## 测试要求

### 最低覆盖率：80%

测试类型（全部必需）：
1. **Unit Tests** — 单个函数、工具、组件
2. **Integration Tests** — API 端点、数据库操作
3. **E2E Tests** — 关键用户流程

### 覆盖率豁免（YAGNI 适用于测试）

80% 严门保留给真实项目。吸收 ponytail 的 ONE-check 为豁免，而非替换严门：

- **无需测试**：trivial one-liner、一次性脚本、纯文档/注释改动
- **非平凡逻辑**：至少留**一个** assert 自检（`demo()`/`__main__` 或一个 `test_*`），断言会在逻辑破坏时失败

### TDD — 运行测试（GREEN）

1. 运行测试 — 应该 PASS
2. 重构（IMPROVE）
3. 验证覆盖率（80%+）

## 代码审查

### 触发条件（强制审查）

- 写完或修改代码后
- 提交到共享分支前
- 安全敏感代码变更时
- 架构变更时

### Review Checklist

- [ ] 代码可读、命名清晰
- [ ] 函数聚焦（<50 行）
- [ ] 文件内聚（<800 行）
- [ ] 无深层嵌套（>4 层）
- [ ] 错误显式处理
- [ ] 无硬编码 secret
- [ ] 无 console.log 或调试语句
- [ ] 新功能有测试
- [ ] 测试覆盖率 ≥ 80%

### 分级审查体系（三趟职责分离）

> 来自 ponytail + shadcn + omnigent。三趟审查互不稀释，正确性/删除/独立性各管一摊。

1. **Deletion-only review**（ponytail）— 只猎过度工程，固定 tag `delete/stdlib/native/yagni/shrink`（映射 stage-04 阶梯），每条一行，终止信号 `net: -<N> lines possible` / `Lean already. Ship.`。正确性/安全/性能明确排除到其他趟。
2. **Handoff review**（shadcn）— 审 cheaper executor 的 diff 时：(a) 自己重跑每条 Done criteria，不信报告；(b) `git diff --stat` 查越界，越界即 fail；(c) **读新测试断言了什么，不是是否通过**（"断言空气的测试也过 `pnpm test`"）。裁决：文档化的偏离按情理论，未文档化的偏离 = 审查失败。最多 2 轪返工再 BLOCK。
3. **Cross-model review**（omnigent）— 非平凡 diff，写的人和理解的人必须不同模型：reviewer subagent 跑不同 model 或走 `/codex` 第二意见。writer 提议，独立模型 reviewer 对照验收契约 diff，只报不改。
4. **Maker-checker 独立上下文**（loop-engineering）— 无人值守/自动修复循环，或触及 auth/支付/安全的变更：implementer **绝不给自己打分**。verifier 跑在**独立子上下文**，在 worktree 跑测试，查**根因不是症状**+无无关改动。只有 verifier 能放行。失败模式之首是"修症状循环"——这扇门是解药。

   > **成本重定义（来自 tigicion/dao-code）**：独立上下文 ≠ 全量重发。让 verifier **fork 共享缓存前缀**再分叉，独立性几乎零成本（95.8% 缓存命中实测）。“独立”是逻辑隔离，不是字节隔离。

### Agent-work 审查分类法（来自 BuilderIO/agent-watchdog）

审另一个 agent 的活时，每条发现归入五类之一（结构化，非散文）：

| 类别 | 含义 | 动作 |
|------|------|------|
| **Gap** | 请求的行为缺失或不完整 | 必修 |
| **Bug** | 实现可能失败或回归行为 | 必修 |
| **Verification miss** | 活可能对，但证据弱（没跑测试/没截图/claim 与实际输出不符） | 补证据 |
| **Scope drift** | 改了无关的东西或跳过约束 | 回滚越界部分 |
| **No issue** | 担忧已被处理，有证据 | 关闭 |

UI 工作**优先截图 / browser 检查而非 prose claim**。修只修有明确证据的 gap，保留无关本地改动，每次修后跑最小验证。

### Primed-eyes + 反 gate 削弱 + 委托泄露（来自 dzhng/skills）

> 补 maker-checker 的**为什么**和**操作纪律**——独立审查不是教条，是有具体失效模式的。

- **Primed-eyes 反模式**：视觉/行为变更的验证，implementer 的眼睛**被修复 primed 了**，反复放过 fresh eyes 能抓的错。dzhng 实例：一个 palette pass 曾 ship "verified" 而生产帧 byte-identical（静态检查 + re-anchored 断言在 no-op 上全过）。→ 视觉变更带两份额外证据：(a) 对生产路由做 pre-change baseline 的 **byte/pixel diff**（静态检查必须在 no-op 上也过）；(b) **unprimed screenshot-critique**——在用户报告的 framing 下由**没看过修复的人/agent** 审。咬合 maker-checker 独立上下文 + 06a Phase 6 独立验证——primed-eyes 是"为什么独立"的具体理由，dao-code fork 缓存让它便宜

  > **实测（2026-07-08，2 case single-shot）**：rig 001（明显 bug：空列表崩溃，`primed-eyes-rig-001.md`）+ rig 002（微妙 bug：None 语义歧义，`primed-eyes-rig-002.md`）。两次 spawn primed（被告知原 bug+已修复）vs unprimed（只审）LLM reviewer，**两次两者都抓到 bug B**，primed reviewer 反而更详尽且给修法。2 case 一致**不支持**"primed 放过"假设 -> **LLM 很可能无人类 priming 心理**（primed-eyes 源自人心理，LLM 仍全面审），规则"primed"部分对 LLM 不适用；但"独立 verifier"价值仍在（两 reviewer 措辞/深浅不同）。**限制：每 case single-shot，需 N runs 取 median 复验**（A4 两档）。结论：保留"独立 verifier"机制，"primed 心理"对 LLM 降级为不适用
- **反 gate 削弱**：**永不削弱既有默认 gate 或 repin 失败契约，除非证明旧契约是错的**。门红了就修代码，不是改门。咬合质量门"不跳过"+ A4 safety 门不可破
- **委托泄露 scratch**：delegated agent 会泄漏——一次性 probe、shot script、scratch 文件、`nohup.out`、临时截图目录、SPIKE/debug 笔记**永不进 commit**（scratch 不入树，review 证据进 spec `assets/`，其余删）。"说不出耐久用途的文件不 ship。" integrating reviewer 必须**对合并后的树重跑同一只眼**。咬合 agent-watchdog Scope drift + 05 并行 landing 门

### 并行下的 flaky 多半是共享资源碰撞（来自 funador/claude-code-merge-queue）

并行 agent 跑测试时，“flaky” 常是**诚实**的共享资源碰撞，非真 flaky：并发都 hit 同一 DB reset、同一端口、同一临时文件。失败看着随机，实则确定。

- 追 flaky 前**先查并发共享资源**（DB/端口/文件/锁），不是先重跑碰运气
- 根因修法是**序列化 landing 阶段**（见 05 并行 landing 门），不是给测试加 retry
- 咬合 05：--worktree 隔离了执行，但 push/build/test 的共享 mutable 资源仍撞——序列化它，别 retry 它

## Stop-Condition 门（来自 MiMo-Code）

> 针对 glm-5.2 等"乐观停止"倾向更强的模型。agent 喊"完成"≠ 真完成。

长任务/自主任务（/goal 式或 >N 步）先设**显式停止条件**（可观测证据，非"感觉好了"）。agent 提议停止时，跑**独立 judge 判定**（同模型新上下文，或更便宜模型）："停止条件是否真满足？" 才接受停止。短任务不必每轮触发。

## Human-gate 分类法（来自 loop-engineering）

> 补 stage-01 只有安全触发器，缺运维性"何时停循环交人"。

任一命中即 STOP，不自动 merge/fix，带全上下文（状态/尝试次数/证据）交人：
- 安全/auth/支付代码
- 改动 >5 文件 或 核心架构
- 同一失败 max-attempts 用尽（默认 3）
- infra 失败（OOM/secrets/registry）
- 歧义/不可逆动作

## Augment-not-automate：高风险领域默认建"决策支持面"而非"自主执行体"（来自 simonlin1212/Vibe-Research + shy3130/tickflow-stock-panel，未自测-行为规则）

> 补 Human-gate（运行时停）+ Shadow mode（信任期不动手）的**设计时**维度--不是"跑起来后交人"或"N 天后放权"，是**建系统时就决定不自动化决策层**。咬合 01 hard-policy（合规红线硬编码）+ 04 Plan Handoff Out-of-scope。

两个金融开源项目同型设计：Vibe-Research "把数据和功能配齐，由**你自己的 AI** 驱动，**永不荐股**"；tickflow-stock-panel README 顶部硬声明 "明确不做：不内置 AI 荐股/涨停预测"。数据/工具/复盘层全自动化，**决策层永久留给人**。

**落地**：
- 高风险/不可逆领域（金融/医疗/法律/部署/删除）规划时先问"哪层可自动化、哪层必须留人"--数据采集/监控/复盘/候选生成可自动化，**最终决策/执行**留人。咬合 04 垂直切片：每切片想清"决策点在哪、谁拍板"
- **可观测信号**：若系统 README 顶部能写出"明确不做 X"，说明决策边界够硬（公开契约）；写不出 = 决策层在偷偷自动化，补 Out-of-scope
- 别和 Shadow mode 混：Shadow 是"自主系统先观察 N 天再放权"（信任坡道）；本条是"决策层根本不放权"（永久边界）。前者临时，后者永久

## Shadow mode：先观察后行动，挣得干预权（来自 SmileLikeYe/agent-chief，未自测-行为规则）

> 补 06 Stop-Condition 门（per-action 验证）+ human-gate（何时交人）的**时间维度**--自主通知/分发/干预系统在**头 N 天**只显示"我会怎么做"，**不真动手**，用观察期挣得行动权。咬合 06a Phase 6 独立验证 + A4（golden set 验过才上线）。

agent-chief 前 7 天**永不真中断**--它把"本会中断/分发/归档"的决策影子化展示给人审，校准够了才真正响铃。这是对 glm-5.2 类"乐观行动"倾向的**时间版**解药：Stop-Condition 门管"这次喊完成该不该信"，shadow mode 管"这系统头几天该不该让它真动手"。

**落地**：
- 任何新上线的自主循环（自动 fix/自动通知/自动 dispatch）先跑 shadow：记录"本会做的动作"但不执行，跑 N 轮 / 过 golden set 人工审，误判率达标才切 live（咬合 06a Phase 3 DISPROVE + A4 100-user benchmark）
- shadow 期发现的误判优先加更准的硬规则/阈值拦截（咬合 06 反 gate 削弱：不是改门让旧误判通过，是加准拦截；门本身不削弱）
- 与 Human-gate 互补：human-gate 是"单次动作太险交人"，shadow 是"整系统还没挣得信任前全交人审"

## 审查严重级别

| 级别 | 含义 | 动作 |
|------|------|------|
| CRITICAL | 安全漏洞或数据丢失风险 | **BLOCK** — 必须修复 |
| HIGH | Bug 或重大质量问题 | **WARN** — 应该修复 |
| MEDIUM | 可维护性问题 | **INFO** — 考虑修复 |
| LOW | 风格或小建议 | **NOTE** — 可选 |

## 安全检查清单（提交前）

- [ ] 无硬编码 secret
- [ ] 所有输入已验证
- [ ] SQL 注入防护
- [ ] XSS 防护
- [ ] CSRF 保护
- [ ] 认证/授权已验证
- [ ] 错误消息不泄露敏感数据

### 覆盖度门（来自 mukul975/Anthropic-Cybersecurity-Skills）

> 上面的 checklist 是"逐项打勾"；mukul975 把 817 skills 映射到 ATT&CK v19.1 的 **754/754 techniques**——审查的完备性可量化。checklist 打勾 ≠ 覆盖全威胁面。

安全审查（`/cso`、security-reviewer）结束时，除了 findings JSON，还报**覆盖度**：

- **已覆盖**：本次审查触及的威胁类别（对应 ATT&CK 战术/OWASP 类别等）
- **未覆盖**：目标范围内**应查但没查**的类别（如审了 SQL 注入/XSS，但没查 SSRF/反序列化）
- **覆盖比**：已覆盖 / 应覆盖。低于阈值（默认 80%，咬合测试覆盖率门）→ WARN，列明缺口再补

无现成框架映射时，用项目类型推导应覆盖集（Web app → OWASP Top 10；API → OWASP API Top 10；ML → ATLAS）。**禁止用"已检查安全"作为审查结论**——要么是覆盖度 + findings，要么没审到位。这把测试 80% 门的精神延伸到威胁面：测试覆盖代码路径，覆盖度门覆盖威胁类别。

### 差分 oracle + 平价地板（来自 can1357/pon）

> 重写/移植/重实现项目的验证门——不信任重写自己的测试，信任**对规范实现的 byte/behavior-exact 差分**。

- **差分 oracle**：定义一个规范参考实现作 oracle，让重写的输出与 oracle **逐字节/逐行为**一致，把"一致"作**出口门**（pon 对 CPython v3.14.0：两路径打印相同字节是 conformance suite 的 exit gate，不是 aspirational）
- **平价地板（parity floor）**：commit 一份**版本钉死的地板**——当前已通过的模块清单（pin 到 oracle 版本，如 `cpython_tag: v3.14.0` + `passing_modules: [...]`）。地板 = **必须保持绿**的子集（回归即 fail），full floor = aspirational。地板随进展**单调增长**
- **AGENTS.md 作机器可查的 workspace 结构契约**：把"依赖在哪声明/怎么继承/lint 怎么继承"写成 agent 不得违反的结构不变量（pon 的 Golden Rule：所有依赖只在 root `[workspace.dependencies]`，成员 `workspace=true` 继承，禁 inline version）。咬合 A3 settings.json vs CLAUDE.md——结构不变量进 AGENTS.md 作机器可查契约，不是建议

咬合 A4 声明可复现（地板 = committed 可重算 baseline）+ 06 结构化门（地板是 JSON findings 的 reimplementation 版）+ 覆盖度门（地板 = 已覆盖子集，full = 应覆盖）。任何重写/移植先立 oracle + 地板，否则"能跑了"= 信仰。

### 保真度分层 + 硬指标 + 反过度声称（来自 Pluviobyte/rnskill · rn-replica-qc）

> "复刻/匹配参考"类任务的验证——先**分类要求的保真度**，每层挂**硬指标**，没过硬指标**永不声称**达到该层。

三档保真度（每档硬指标）：
- **Pixel-level**：精确解码像素 / 精确源流复用。硬证据：SHA-256/`cmp` 匹配、PSNR=∞、SSIM=1.0
- **Visual-level**：手作复刻，场景时序/布局/动作/排版/色**足够接近**供人审
- **Style-level**：参考作设计语言，不作帧目标

- **反过度声称**："Never describe a rebuild as pixel-level unless it passes the hard metrics."——没过硬指标别说达到该层。咬合 Stop-Condition 门（"感觉好了"反模式）+ A4 声明可复现（硬指标可复算）
- **Replica-loop = loop-until-metric-passes**：持持久目标，同时间戳对比参考与候选，编辑实现，重跑证据直到达标或**剩余 mismatch 显式记录**。咬合 04 loop-until-metric-passes
- **Component-capture**：动作对齐后**描述成可复用组件**（purpose/inputs/timing/stack/evidence/limits），建成组件库供未来复用——咬合 04 积木库原则（GameBlocks）+ gzh 双关卡（这是产物关卡带分层）

### 安全审计 pipeline（详见 06a-security-audit.md）

`/cso` / security-reviewer 执行的不是上面这个 checklist，而是 06a 的 6 阶段 pipeline（recon→hunt→validate→report→structured→independent-verify）+ 严格 schema（trace/conditions/execution）+ 对抗式 DISPROVE + Phase 6 独立验证 + 跨 run 累加。checklist 是快速预检；06a 是完整审计。来源 cloudflare/security-audit-skill。

## 安全响应协议

发现安全问题时：
1. 立即 STOP
2. 使用 **security-reviewer** agent
3. 修复 CRITICAL 问题后再继续
4. 轮换已泄露的 secret
5. 审查整个代码库是否有类似问题
