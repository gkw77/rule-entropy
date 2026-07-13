<!-- middleware: stage-3 -->

# Stage 3: Routing

> 触发时机: 需要选择 agent、模型、或激活 skill 时
> 职责: 路由到正确的执行者，审计工具负载

## Agent 路由表

| Agent | 用途 | 何时自动触发 |
|-------|------|-------------|
| planner | 实现规划 | 复杂功能、重构 |
| architect | 系统设计 | 架构决策 |
| tdd-guide | 测试驱动开发 | 新功能、bug 修复 |
| code-reviewer | 代码审查 | 写完代码后 |
| security-reviewer | 安全分析 | 提交前、安全敏感代码 |
| build-error-resolver | 修复构建错误 | 构建失败时 |
| e2e-runner | E2E 测试 | 关键用户流程 |
| refactor-cleaner | 死代码清理 | 代码维护 |
| doc-updater | 文档更新 | 更新文档时 |

## 自动触发规则（无需用户提示）

1. 复杂功能请求 → **planner** agent
2. 代码刚写完/修改 → **code-reviewer** agent
3. Bug 修复或新功能 → **tdd-guide** agent
4. 架构决策 → **architect** agent

## 模型选择策略

**Haiku**：高频调用的轻量 agent、结对编程、worker agent
**Sonnet**：主要开发工作、编排多 agent 工作流
**Opus**：复杂架构决策、最大推理需求、研究分析

## 值得性升级门：cheap-first, smart-last（来自 SmileLikeYe/agent-chief）

> 补 03 模型选择"按复杂度选 tier"的**前一层**--在路由到任何贵模型前，先用极便宜的门 cheap-reject。咬合 01 五层门（policy µs block 在 capability/approval 前）、02 token-diet no-op 短路 + 缓存稳定、06 Stop-Condition。

不是所有事件/输入都配进 LLM。agent-chief 的三层值得性级联（cost 递增，只有上档没拦住才落到下档）：

1. **硬规则（µs，免费）** - 正则/关键词/阈值秒拒。最吵的 25% 事件死在这一层，**永不 reach LLM**，零成本。
2. **相似度分类器（ms，便宜）** - 轻量 classifier（embedding 相似度/规则树）判 batch/dispatch/remember。
3. **LLM judge（仅当需要）** - 只剩"值得费脑子"的才进 LLM，且 judge prompt 用**稳定前缀**（system + context blocks 不变）-> 70% input token cache-hit（咬合 02 dao-code 缓存稳定）。

**量化（agent-chief 实测，`make readme-metrics` 从确定性 replay 重算，咬合 A4 声明可复现）**：24 事件入 -> 1 次中断（96% 拦截：14 直接 block，其余 batch/dispatch/remember）；仅 75% 事件 reach LLM；judge 成本 $0.104/1k 事件。


> **自测 receipt（2026-07-09, A4, 复现型）**：本地复现 agent-chief `make readme-metrics`（`E:/cc/agent-chief-rig/`，纯 offline 无 key，FixtureJudge 重放 24 事件 + 价格表算成本）-> 输出 **24 事件入->1 中断(96% 拦截, 14 blocked)/75% reach LLM/70% cache-hit/$0.104 per 1k**，与上文引用数字逐字吻合。诚实限定：这是**复现 agent-chief 的 demo**（验证我引用的数字为真且可复现，vet-before-present），非我 pipeline 独立测 worthiness gate 的 efficacy。复现：`cd /e/cc/agent-chief-rig && python scripts/readme_metrics.py`

**落地到 agent 循环**：
- 写循环/路由前先问"这步真要进贵模型吗？"--能硬规则判的（done/no-op/已知模式）先短路（咬合 04 loop-until-* 的 no-op 必须短路）
- judge/verifier 调用用稳定前缀，volatile 状态放前缀之后（咬合 02 缓存稳定）
- 报"拦截率/reach-LLM 比/cache-hit 比"而非"感觉很省"--省不省要量（咬合 A4，caveman 省 LOC 但 token 涨的反例）

## 多模型 split：Orchestrator vs Advisor + 官方量化（来自 Nanako0129/pilotfish）

> 补 03 模型选择"按复杂度选 tier" + 04 Plan Handoff"强模型写 plan 便宜模型执行"的**架构命名 + 量化对比**层。两套 split 不是同一回事，选错轴白烧钱。咬合 03 值得性升级门（smart-last）、06 maker-checker（独立上下文）、A4 验证>模型规模。

frontier 模型（Fable 5 / Opus）配额贵--Fable 5 消耗订阅限额 ~2× Opus。但多数 token 非判断（搜索/机械编辑/跑测试/文档），便宜模型做得一样好。两种 split：

1. **Orchestrator split**（pilotfish 用的，默认）- frontier 在主 session 规划+决策+审查，便宜模型（Sonnet/Haiku）经 global subagent 执行 volume work。质量靠 **fresh-context verifier subagent** 守，不靠处处用最贵。frontier 不可用时整栈优雅降级。
2. **Inverse advisor split** - 便宜模型执行，遇判断点咨询 frontier（advisor），frontier 不主导全程。

**官方量化（Anthropic 2026-07-08 benchmark，pilotfish README 引，未独立核实原文）**：
- Orchestrator（Fable 5 orchestrator + Sonnet 5 workers）：BrowseComp **96% of all-Fable 性能 @ 46% 成本**（86.8% vs 90.8% accuracy，$18.53 vs $40.56/题）
- Advisor（Sonnet executor consulting Fable）：SWE-bench Pro **~92% @ ~63% 成本**
- 结论：**orchestrator split 两轴都赢**（更高准确率 + 更低成本）

**落地**：
- 默认 orchestrator split：主 session 留 frontier 规划/审查，volume work 委托便宜 subagent（咬合 03 值得性升级门、04 Plan Handoff、05 并行 Task）
- 验证用 **fresh-context verifier**（独立子上下文）不用 self-critique--Fable 5 prompting guide 官方："independent fresh-context verifier subagents outperform self-critique"（咬合 06 maker-checker、06a Phase 6、dao-code fork 缓存让独立便宜）
- frontier 配额耗尽/不可用 -> 降级 advisor 或全便宜模型，不阻塞（咬合 04 前置估算门退化路径）
- 报准确率×成本比，不报"感觉差不多"--96%@46% 是可引用 benchmark（咬合 A4 TestSprite"验证>模型规模"+ 声明可复现）

## Thinking 模型协议（来自 MiMo-Code）

> 针对 glm-5.2 等非 agentic-RL 模型补强——它们在工具循环里比 Claude/MiMo 这类 RL 调过的模型更容易漂移。

- **采样温度分轴**：工具调用/agent 循环轮次 → 低温度（~0.3，确定性选工具）；开放生成/写作 → 较高（~0.7–0.8）。模型无关，任何非 agentic-RL 模型都受益。
- **reasoning 持久化**：若代理暴露 `reasoning_content`/scratch 字段，**跨工具轮持久化到消息历史**，不 strip。MiMo 实测：thinking 模型跨轮丢 reasoning 会失相干。
- **便宜 executor 门槛**：见 stage-04 Plan Handoff——只有 plan 过三性质门（自包含/验证门/硬边界）才配降级到便宜模型执行，否则只能 Sonnet。

## MCP 工具数量审计

**每个 MCP 工具的 schema 约占 ~500 tokens。**

| 工具数 | 占用 tokens | 占 200K 窗口 |
|--------|-------------|-------------|
| 10 | ~5,000 | 2.5% |
| 20 | ~10,000 | 5% |
| 30 | ~15,000 | 7.5% |
| 50 | ~25,000 | 12.5% |

**黄线（20 工具）**：提醒用户检查未使用的 MCP server
**红线（30+ 工具）**：强烈建议精简

精简策略：
1. 长期未用的 server 禁用
2. 功能重叠的工具保留一个
3. 非当前项目需要的工具移除

## Skill 激活

当用户消息匹配 skill 的触发描述时，通过 Auto-Invoke Rules 自动加载对应 skill。
