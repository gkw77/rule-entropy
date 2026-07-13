<!-- middleware: stage-2 -->

# Stage 2: Context Management

> 触发时机: 长对话、上下文紧张、compact/rewind 时
> 职责: 窗口管理、压缩策略、防重放、session 交接

## 核心数据

来自 Claude Code 团队实测：
- 1M 模型在 300-400k tokens 开始上下文腐烂
- "笨区"从 ~40% 使用率开始
- 自动 compact 时模型智力最低，手动带 hint 的 compact 效果好得多

## 双信号压缩建议

当以下**任一**条件满足时，提醒用户考虑 `/compact`：

**信号 1：上下文使用率（主要）**
- 30%+：新手安全区
- 40%+：进入"笨区"，建议 compact + hint
- 50%+：强烈建议 compact
- 60%+：必须 compact

**信号 2：工具调用次数（次要）**
- 30+ 次：建议 compact
- 50+ 次：强烈建议

两个信号同时触发时，优先级提升一级。

**compact 时必须带 hint：**
```
/compact 重点在[当前任务]，丢弃[已完成/无关部分]
```

## Rewind 优先于修正

当实现失败或方向错误时：
1. **首选**：双击 Esc 或 `/rewind` 回退到失败前，重新提示
2. **次选**：`/compact` 带 hint 丢弃失败尝试
3. **避免**：在污染上下文里反复纠错（越纠越差）

## Session Handoff（交接模式）

Rewind 或 compact 前，让 Claude 写一段交接消息给"未来的自己"：

```
请总结当前状态：
1. 已完成什么
2. 正在做什么
3. 下一步要做什么
4. 遇到了什么问题
5. 关键决策和原因
```

这段交接消息保留关键上下文，不会在压缩/回退中丢失。

### Handoff 纪律（来自 davidondrej/skills）

> 上面模板 1/2/4/5 是**状态**，3"下一步"是**指令**——按下面纪律，3 应表述为"待办状态"（"logout 未开始"）而非 action item（"实现 logout"），且不自动执行（咬合下方防重放 + 07 next-action 门）。

- **State, not instructions**：交接写**状态**（what is true），不写**指令**（next agent should do）。fresh agent 决定动作，你给 ground truth。"Auth 端点已实现；logout 未开始" > "下一步实现 logout"
- **Reference, don't duplicate**：已存在 PRD/plan/ADR/commit/diff/design doc 里的内容**指向**它们（path/URL），不重贴。handoff 只装 session-specific，重贴会 bloated + stale
- **Capture the why**：决策 + **被拒方案**最有价值且最难恢复。code 显示 what，只有你记得 why 和 what failed。咬合 A1 项目级失败考古
- **Be ruthless**：每行必须是 next agent **不能从 code/config 轻易得到**的。砍掉显而易见/冗余/解释性。咬合 02 token-diet
- **Trust nothing blindly**：所有 claim 是 to-verify context，非 to-accept facts。咬合 04 vet before present + 06a Phase 6
- **Redact secrets**：剥 key/token/密码/PII，指向位置不写值。咬合 01 + 06a 审计纪律

## Session 摘要防重放

压缩后的摘要必须标记为历史参考：

```
[以下为压缩前的历史摘要，仅供参考，不代表当前待办]
- 已完成: ...
- 待确认: ...
[历史摘要结束]
```

**防重放规则：**
1. 压缩后的摘要中的任务不自动执行
2. 需要用户明确确认才继续
3. 如果摘要中有"下一步"，先问用户是否继续
4. 压缩前正在执行的编辑操作，从 Read 文件开始重新验证

## 上下文敏感任务调度

避免在上下文窗口最后 20% 做：
- 大规模重构
- 跨多文件的功能实现
- 复杂交互调试

低上下文敏感度任务（可在窗口较满时做）：
- 单文件编辑
- 独立工具函数创建
- 文档更新
- 简单 bug 修复

## Post-compact 规则重注入（机械，非手动）

> 来自 ponytail。把"警告 compact 会丢上下文"升级为"解决"。

compact/clear/rewind 后，核心 ruleset 应被**机械地**重新注入，而非靠手动 hint。机制：`SessionStart` hook matcher 覆盖 `startup|resume|clear|compact`，在每次触发时重发最高优先级规则。

- 当前 `02-context.md` 只警告、依赖手动 `/compact` + hint——这是缺口
- **已落地**：`~/.claude/settings.json` 配 `SessionStart` hook，matcher `startup|resume|clear|compact`，command `cat "$HOME/.claude/scripts/core-rules.md"`。速查文件 `~/.claude/scripts/core-rules.md` 是各 stage 高优先级项的精炼版，改规则改此文件即可
- 速查文件控制行数（每次 session/compact 都注入吃 token）；详细规则仍在 `01-07*.md`

## Token 效率操作层（来自 Kulaxyz/token-diet）

> 上面是"窗口满了怎么办"；这层是"别把窗口搞满"——操作级节流，compact 之前的防线。input tokens 每轮重发（transcript + 工具输出都重送），所以读和搜的杠杆最大。

### Context & search（最高杠杆——cache read+write 主导账单）

- **grep before read** — 永不盲开文件，先 `grep -rn` 定位
- **batch 进一轮** — 所有独立的 grep/read 放一个 turn 跑，不要串行 ping-pong
- **minimize total turns** — scout 一次 → 规划整个改动 → 一次应用 + 验证。绝不 read→edit→read 跨轮来回
- **复用上下文里的** — 永不 re-read 或 re-grep 已在上下文的；**绝不 re-read 刚编辑过的文件"来验证"**（Edit 失配会大声报错，不需要肉眼确认）
- **能动手就停** — 不为"确认"或"探索相邻"多读一眼
- **广搜委托 subagent** — 广而边界清晰的搜索/探索丢给子 agent，死胡同留在子上下文，per-token 更便宜。**但 correctness-sensitive 验证（调用点安全、跨文件影响）绝不交给弱模型**——它过度探索反而更贵，留主上下文

### 表面分级（ultra 模式）

低风险面（用户聊天、进度/状态笔记）→ 电报体；高风险面（代码、命令、文件路径、标识符）→ **永不电报**。

### 档位

- **on**（默认）— 全部规则
- **lite** — 仅沟通 + 产物，工具不动
- **ultra** — on + 低风险面电报体
- **off** — 暂停（"normal mode"/"verbose mode"）

### 其他桶（摘要）

- **对用户**：答先行，无 preamble/postamble，不复述请求，报 delta 不报叙述
- **产物**（docs/memory/handoff/plans/comments）：最少词但不丢实质；plans = steps + decisions only；注释只写非显然的 why
- **测试**：只覆盖关键行为 + 临界/边缘，合并相关 case，**≤10 tests/session 上限**；money/auth/data-loss 覆盖永不降（G1）
- **代码**：YAGNI、简洁但地道、无死代码 / 注释掉的代码

### 缓存稳定性：前缀字节稳定 + 复用 fork 的验证器（来自 tigicion/dao-code）

> 上面管"读/搜什么"；这层管**提示词前缀本身的结构稳定**——prefix-cache 命中比任何节流都省（DeepSeek 命中价 ≈ miss 的 1/120）。dao-code 实测 95.8% 命中、真 SWE-bench 任务每特性 ¥0.07–0.21。

- **前缀字节稳定**：system prompt / tool schema 表 / memory 区**跨轮字节不变**。任何重排、改写、注入时间戳到前缀 = 缓存全碎。volatile 内容（日期/计数器/本轮状态）放**前缀之后**的 body，绝不混进稳定前缀
- **验证器跑在复用缓存的 fork 上**：06 maker-checker 要"独立上下文"——dao-code 让独立验证器 **fork 共享缓存前缀**再分叉，独立性不靠"全量重发"买单。咬合 06：把"独立上下文"从"贵的必要"重定义为"fork 缓存就便宜"
- **量化**：缓存命中率是真 agentic 数字（咬合 A4——single-shot 高估胜率，dao-code 报真 session 跑真 repo 的命中率）
