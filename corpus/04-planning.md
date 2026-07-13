<!-- middleware: stage-4 -->

# Stage 4: Planning

> 触发时机: 开始新任务、复杂功能、用户要求规划
> 职责: 调研复用、制定计划、写测试、初始化 TodoList

## Step 0: Web Research（强制，任何新实现前）

**Web Research 是一等公民**——在写方案前，先做充分搜索。
不搜就写方案 ≈ 闭着眼开车。

### 搜索清单（按顺序）

1. **GitHub 搜索**：`gh search repos` 和 `gh search code` 找现有实现
2. **库文档**：Context7 或官方文档确认 API 行为
3. **WebSearch**：搜最佳实践、踩坑记录、社区讨论
4. **包注册表**：npm、PyPI、crates.io，优先用成熟库
5. **可适配实现**：找能解决 80%+ 问题的开源项目

### Docs-first 自检（来自 BuilderIO/read-the-damn-docs）

**抓到自己写"usually/probably/I think/from memory"或从模型记忆抄外部 API 代码 → 停，去查官方文档。** 外部 API/SDK 快变，模型记忆过期。

文档源层级（高→低）：
1. 本地 repo 文档 / spec / ADR / 生成 schema / OpenAPI / package README
2. 官方产品文档 / API reference / migration guide / changelog
3. 包注册表元数据（npm/PyPI/crates 版本）——加依赖前先查目标大版本
4. 源码 / 类型定义（官方文档不全时）
5. 社区源（StackOverflow/博客）——**仅用于 debug 症状**，不当权威

触发场景：用户要"latest/current/official/supported"、加/升级/配置包或 SDK、AI SDK 这类快变 API、涉及 auth/OAuth scope、错误提到 deprecation/unknown option/missing export、选择昂贵难逆（公开 wire format、DB schema）。

### 知识层 CI 再生 + 自动注入指针（来自 langchain-ai/openwiki）

> docs-first（上面）是“读 damn docs”的纪律；openwiki 做成**持续运营**——agent 可读知识层由 CI 再生，drift 开 PR，agent 被自动指过去。

- **CI 再生**：`openwiki/` 文档从 repo diff 刷新，GitHub Actions/GitLab CI 检测代码变更 → 自动开 PR 更新文档。文档 drift = PR，不是“忘了更新”
- **自动注入指针**：往 `CLAUDE.md`/`AGENTS.md` 追加提示，指示 agent 搜上下文时**先引 openwiki**。咬合 A2 skill-as-pointer-to-local-docs（eve）——openwiki 是该模式的**生成版**：指针指向的权威副本本身也自动维护
- **drift-as-PR = Plan Handoff drift check 的文档版**：Handoff 用 `git diff --stat <SHA>..HEAD` 查代码 drift；openwiki 用 CI PR 查文档 drift。代码 drift 阻执行，文档 drift 阻 agent 读过期知识

### 搜索深度指南

| 任务类型 | 最少搜索次数 | 搜索范围 |
|---------|-------------|---------|
| Bug 修复 | 3-5 | 错误信息 + 相关 issue + StackOverflow |
| 新功能 | 10-15 | GitHub + 文档 + 社区 + 竞品实现 |
| 架构决策 | 15-25 | 论文 + 技术博客 + 开源项目 + 性能对比 |
| 未知领域 | 20-30 | 全方位调研，建立领域知识图谱 |

## Step 0.5: 前置估算门（来自 calesthio/OpenMontage）

> OpenMontage 生成视频前先回答"at your target duration, before asset generation starts"——成本和可行性在动手前估，不是跑到一半发现超预算。

调研完成后、动手前，对**生成类任务**（写作/设计/视频/大批量代码生成）必须先报：

- **成本预估**：目标产出规模 → 大致 token / 时长 / 调用次数 / 钱。咬合 loop token 三档预算（stage-04 运维层），超预算先和用户对齐目标规模再开跑
- **可行性**：当前可用工具/依赖能否产出目标？缺什么？
- **退化路径**：主力工具/依赖挂了用什么 fallback（Piper TTS 代替付费 TTS、Archive.org 代替付费素材、stdlib 代替依赖）。每个外部依赖记一个零成本 fallback——这延伸复用阶梯"已装依赖"横档：依赖不可用时不阻塞，降级而非停摆

**门判定**：估算超预算或可行性不足 → 不开跑，回 Step 0 调研替代方案或与用户缩范围。非生成类任务（单文件编辑、bug 修复）可跳过，但多文件重构/新功能仍需粗估。

> **量化 bookend**：本门是"动手前估"；"规则声称省度量后测"见辅助模块 **A4-rule-measurement.md**——任何声称省 token/cost/LOC 的规则必须用 ponytail 式 rig（多臂对照 + median over N + safety 门）证伪，否则是信仰。

## Step 1: Plan First

- 使用 **planner** agent 创建实现计划
- 生成规划文档：PRD、架构、system_design、tech_doc、task_list
- 识别依赖和风险
- 分解为多个阶段

### 垂直切片（Vertical Slices）

**AI 默认水平分层**（先 DB → 再 API → 再前端），这会延迟端到端反馈。

**正确做法：垂直切片**，每个切片横跨所有层：
```
切片 1: DB 表 + API 端点 + UI 组件 → 可运行可测试
切片 2: DB 表 + API 端点 + UI 组件 → 可运行可测试
```

每个切片完成后的状态：**能跑、能测、能演示**。

### 任务依赖图 + 每节点 evidence（来自 withmarbleapp/os-taxonomy，未自测-架构模式）

> os-taxonomy 把儿童课程建模成 1590 micro-topics + 3221 prerequisite edges 的 DAG：每节点带 type(conceptual/procedural/representational/language/meta)、centrality(优先级)、**evidence**(掌握证据数组)、assessmentPrompt(评估提示词)；每条依赖边带 hard/soft 标签 + reason。知识不是 flat list，是"X depends on Y"的有向无环图。pure data + schema + manifest(含 SHA-256 校验和) + PROVENANCE.md。

**落到任务规划**：垂直切片的"切片1->切片2"线性序是简化；真实任务有 prerequisite DAG：
- **节点 = 可独立验证的 micro-task**，不是粗粒度阶段。带 type（概念/流程/产物/验证）+ centrality（优先级排序，咬合 A2 eli-labz 认知 type 分类）
- **边 = 真实依赖**：hard 依赖未满足则下游 blocked，soft 是建议序。Plan Handoff 的 Consumes/Produces 是边的契约化；这里把**整张依赖图**显式画出（不只是相邻 task 的契约）
- **每节点带 evidence**：不只"做完了"，带"怎么证明完成"的可观测证据数组。无 evidence 的 task = 无法验收。咬合 06 Stop-Condition 门、06a assessment
- **assessmentPrompt**：一句自然语言验收检查，比 Done criteria 更可执行

咬合 04 垂直切片（切片 = DAG 的拓扑序子集）+ Plan Handoff Consumes/Produces（边契约）+ 06 Stop-Condition（evidence）+ 06 产物溯源链（manifest checksum + PROVENANCE）。flat TodoList 升级为**带证据的 DAG**。

## 实现路径决策：复用阶梯（Ladder）

> 来自 ponytail。阶梯在理解问题**之后**跑，不替代理解。
> "一个你不理解的小 diff，只是伪装成效率的懒惰。"

写新代码前，按优先级取**第一个承重的横档**；两档都行就取更高的：

1. **skip** — 这代码本就不该写（YAGNI）
2. **复用现有** — 代码库里已有
3. **stdlib** — 标准库自带
4. **native/platform** — 平台原生能力
5. **已装的依赖** — package.json / requirements 里已有
6. **one-liner** — 一行能搞定
7. **最小新代码** — 才写

KISS/DRY/YAGNI 不是并列 bullet，是上面这条有序过程。

### 积木库原则（来自 xt4d/GameBlocks）

> 自然语言是精确 spatial / 物理 / 领域逻辑的弱接口——prompt 必须把变换压进 token，脆弱且不可检。

对 agent 反复重写同类复杂逻辑的领域（3D 变换、游戏物理、DSP、金融计算），**主动维护一个可组合、可 inspect、语义清晰的积木代码库**，agent compose/adapt 而非每次从 prompt 推导。这是复用阶梯 rung 2（复用现有）的**主动策展版**——不是等 agent 发现代码库里有啥，而是专门建模块化积木库让它优先 grep。游戏开发（Godot `res://lib/` 或 `addons/`）是典型场景。

### Bug 修复的根因门

修 bug 前先 grep 所有调用方；在共享节点修一次。最小 diff 与正确修复同向——共享函数里一个 guard < 每个调用方各一个 guard；只补 ticket 那条路径会留下兄弟调用方带病。

## 设计签核门 + 计划质量门（来自 obra/superpowers）

> 补 Plan Handoff Contract 的"机器可查"维度——这层补**人读**维度。计划过两道门：人能读完+签核，机器能验证。

### 设计必须分段签核，不是整体抛给用户

- **分段呈现**：设计按 section 给，每 section 按复杂度定长（简单的几句，复杂的 200-300 字），**每段后问"这部分对吗"**再继续下一段。绝不把整个设计一次性甩出来要用户 review
- **一次一个问题**：brainstorm 阶段每条消息只问一个澄清问题，需要深挖就拆成多条
- **"太简单不用设计"是反模式**：todo list、单函数工具、改个配置——都过设计流程。"简单"项目正是未审视的假设浪费最多工时的地方
- **未签核不实现**：brainstorming 的终态是 writing-plans，**绝不**在用户批准设计前调任何实现 skill / 写代码
  > **read-only 强制（来自 synthetic-sciences/openscience）**：plan mode 应**只读**——agent 在签核前无写文件/执行变更权限，靠 harness 强制而非自觉。openscience 的 read-only plan mode = 本条"未签核不实现"的机制版。咬合 01 deny-by-default——让越界不可能，不是劝阻

### Task right-sizing：在哪切 task

- **只在 reviewer 能有意义地拒绝一个 task 而批准其邻居时才切**。setup 能被某个 deliverable 复用就折进那个 task，不单独切
- 每 task 以"fresh reviewer 的 gate"收尾——独立可审
- **Bite-sized 粒度**：写失败测试 / 跑确认失败 / 写最小实现 / 跑确认通过 / commit，各是独立 step
- **Task 间显式契约**：每 task 标 Consumes（用前面什么，精确签名）+ Produces（后面靠什么，精确函数名 / 参数）

### No Placeholders（plan 失败清单）

计划里出现以下 = plan 失败，必须返工填实：
- `TBD` / `TODO` / `implement later` / `fill in details`
- `add appropriate error handling` / `add validation` / `handle edge cases`

> 咬合 Plan Handoff Contract 的"自包含"——但 Handoff Contract 是给便宜 executor 的零上下文门槛，这里是给**任何**执行者（含人）的可执行性门槛。计划假设工程师零上下文 + 品味差。

## Fog-of-war 规划 + 活规格（来自 dzhng/skills）

> 把未知当**战争迷雾**：先勘探地形，切成能独立验证的领地，对"藏着更多迷雾"的部分递归再切。规格是**活文档**，不是固定契约——实现过程中代码教会你计划过时了，就再切，更新规格 handoff。

**与 Plan Handoff Contract 的关系（关键，别混淆）**：Handoff 把 plan 当**固定契约**交给便宜 executor，drift → STOP（零上下文门槛）；Fog-of-war 把 spec 当**活文档**留给**留在 loop 里的编排 agent**，drift → 再切（架构允许改进）。两套不同 regime：**委托给弱模型用 Handoff 固定契约；自己全程编排用活规格。** 同一项目可并存——编排 agent 持活规格，每个切片 handoff 给 executor 时冻结成固定契约。

write-spec 原则（节选可落地的）：
- **Grill before planning**：一次一问，每问附推荐答案（accept/reject/edit）；repo 能答的不问人。咬合上方"设计签核门·一次一问"+ tomicz 5 问上限
- **Slice at API seams**：每切片像一个**微型库**——命名模块边界 + 类型化 I/O + 确定性 fixture + seam 处测试。"若一个切片要启动三个无关系统才能验，磨尖 seam"。比 task right-sizing 的 Consumes/Produces 更硬：切片必须**不启动整个世界就能独立验**
- **Research the fog**：依赖陌生领域/参考实现/基准时，**先做 replication spike 再翻译或近似**——别直接近似一个参考。咬合 Step 0 Web Research + Docs-first
- **Demos expose taste, tests expose contracts**：每个切片产出一个**可运行可截图**的东西（route/fixture/harness/CLI probe/HTML 可视化）。测试证契约，demo 暴露品味和意图——两个不同 review 面
- **Do not block on missing inputs**：缺素材/数据/凭证 → 生成 placeholder + **替换契约**，功能带 placeholder 前进，替换由单独契约治理

implement-spec 纪律（活规格的执行侧）：
- **Pass = commit checkpoint，不是 stopping point**：一个 pass（典型为一切片）是提交检查点，工作是**整个 spec**（每切片 + 每 global TODO），不是第一个 green commit。完成一个 pass = 启动下一个，不是交还用户。咬合 07 next-action 门——spec 内的 pass 串是显式授权的连续 scope，不违反"完成不自动推导继续"
- **Wavefront 并行**：读 spec 的依赖图作**波前**，独立 pass 委托给 subagent 并发，只序列化真正依赖前序的工作。咬合 05 并行执行 + Workflow pipeline() 默认
- **Drift = 简化信号**：若切片会保留 dev-only shim/重复类型/弱包装/过期路径，**换成更简架构并更新 spec handoff**——drift 不只是 STOP，是"计划过时了，改进它"。这是对 Plan Handoff drift→STOP 的**编排侧反转**

## Plan Handoff Contract（跨模型 / 零上下文执行）

> 来自 shadcn/improve。计划是"产品"——写得好才配用便宜模型执行。

凡是要交给 executor（尤其 Haiku）的计划，必须满足三性质，否则只能用 Sonnet 执行（执行器会自己补洞）：

1. **自包含** — 内联所有摘录，禁止"如上所述"
2. **验证门** — 每步带 `Verify: <cmd> → <期望输出>`，Done criteria 机器可查
3. **硬边界 + 逃生口** — 显式 Out of scope + STOP conditions

计划模板关键字段：Status（含 `Planned at` commit SHA）、Why、Current state（内联摘录 + exemplar 文件指针 + 引用 CONTEXT.md/DESIGN.md 词汇）、Commands 表、Scope、Steps（带 Verify）、Test plan、Done criteria、STOP conditions。

**Drift check**：executor 第一步跑 `git diff --stat <SHA>..HEAD -- <in-scope paths>`，不匹配则 STOP。计划因此抗 compact / rewind / session 断档（咬合 stage-02）。

**Vet before present**：并行 agent 返回的发现，主控必须**自己重读每个引用位置**再呈现——过滤三类：设计如此被误报、证据错位、重复。摘录必须来自主控自己的读取，子 agent 的行号只是线索不是事实。

### 竞争 plan 仲裁（来自 BuilderIO/plan-arbiter）

多 agent 产出多个 plan 时（Codex + Claude Code 各写一份），不是挑"看着好的"：

1. **Normalize 到可比 claims**：每 plan 提取 objective/scope、assumptions、proposed files/APIs/data shapes、sequence、validation、rollback、cost/complexity/executor fit。**不奖励啰嗦**——偏好具体、grounded in real code 的
2. **Cross-review**：把每 plan 当另一个 capable agent 写的来审——是否满足用户真实请求、claim 对不对得上 repo、隐藏依赖 / 缺测试 / 风险排序、互补优势（一个架构好一个 sequence 好）
3. **分离 plan 质量与 executor 偏好**——便宜/快的 executor 可能是正确选择，即使另一个模型写了"更好"的 plan。plan 质量 ≠ executor fit
4. **裁决**：Adopt（基本照采纳）/ Hybrid（拼出更强混合）/ Revise first（两个都漏关键 → 打回重写）

## Loop 运维层（来自 loop-library + loop-engineering）

> Loop = harness（stage 01-07 本身）+ schedule + 持久状态 + 验证链。这是**运维纪律不是新算法**——你的 loop-until-dry / adversarial verify / judge panel 已覆盖控制流，这层补的是 schedule/state/budget/gate。

### 任何 loop-until-* 的强制四问表头（来自 loop-library）

写循环规则/Workflow 前先答：
1. **要达成什么**（accomplish）
2. **怎么知道这次成功了**（verify — 可观测证据）
3. **学到的东西怎么用**（learn）
4. **何时结束或求助**（stop — 显式终止谓词）

无终止谓词的循环 = token 火。

### Loop-until-metric-passes（不同于 loop-until-dry）

- **触发**：任务有客观可测指标（覆盖率%、延迟ms、lint 错误数、失败测试数）
- **结构**：改一处 → 同一基准测 → 只在变好时保留 → checkpoint commit → 重复
- **终止**：指标达标 / max-attempts（默认3）/ **连续 2 轮无改进即 early-exit**（防无限抛光）
- 与 loop-until-dry 区别：dry 终止于"没活干了"，这个终止于"阈值达标"

### Token 三档预算 + early-exit（补 stage-02 的 context 预算）

任何 loop-until-* 前声明：`noop`/`report`/`action` 三档 token 成本 + 日上限 + `early_exit_required` 标志。**no-op 路径必须短路**——门已绿就别跑完整 implementer。

### 持久状态作脊柱

run 是无状态的，`STATE.md`/`loop-run-log.md`/`loop-budget.md` 跨 run 携带意图。循环跨越 session 边界靠状态文件，不靠模型记忆。

### Meta-loop：终止后复盘并版本化 loop 模板本身（来自 Forward-Future/loopy）

> 四问表头（上面）覆盖 loop 的**运行**；loopy 补 loop 的**自我改进**——loop 终止后审计/复盘/修复/保存 loop 模板本身，loop 是可版本化产物。

- loop 跑完不只看产物，还看**这个 loop 设计得对不对**：终止条件太松/太紧？验证信号信噪比？learn 步骤真用上了吗？
- 失败的 loop 模板进失败考古（A1），改进的版本化保存（loopy 的 audit/repair/debrief/save）
- 咬合 A1 instinct 进化——“3+ 观察合并为规则”的自我改进模式落到 loop 模板：跑 N 次的复盘合并为 loop v2

## Step 2: TDD — 写测试（RED）

- 使用 **tdd-guide** agent
- 先写测试（RED）
- 测试应该 FAIL（确认测试有效）
- 写最小实现使其通过（GREEN）→ 见 stage-6 verify

## Skeleton Projects

实现新功能时：
1. 搜索成熟的骨架项目
2. 用并行 agent 评估选项
3. 克隆最佳匹配作为基础
4. 在已验证的结构内迭代

## TodoWrite 进度跟踪

使用 TodoWrite 工具：
- 跟踪多步骤任务进度
- 验证对指令的理解
- 实时调整方向
- 显示粒度化的实现步骤
