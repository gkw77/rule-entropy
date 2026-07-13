<!-- middleware: stage-5 -->

# Stage 5: Execute

> 触发时机: 实际写代码、调用工具、执行任务
> 职责: GateGuard 守卫、编码规范、设计模式、并行执行

## GateGuard：先调查再编辑

**每个文件首次 Edit/Write 前，必须先完成调查。**

### 调查清单（首次编辑前）

- [ ] **Read 目标文件**：了解当前结构和内容
- [ ] **检查被谁导入/引用**：Grep 搜索文件名或函数名
- [ ] **理解数据模式**：文件的类型定义、接口、返回值
- [ ] **确认用户意图**：编辑目标与用户要求一致

### 豁免条件

- 用户明确说"直接改"或"快速修复"
- 文件是本轮 session 刚创建的
- 测试文件（test_*.py, *.test.ts 等）
- 只修改注释或文档

### 执行流程

```
用户要求编辑文件 X
  ↓
X 在本轮 session 中编辑过？
  ├─ 是 → 直接编辑（已调查）
  └─ 否 → 执行调查清单 → Read + Grep → 确认后 Edit/Write
```

## Perception-before-action：感知先于行动（来自 eli-labz/Cognitive-Core-Skills，未自测-行为规则）

> 补 GateGuard"首次编辑前调查"的**频率维度**--perception 不是只首次，是**每个状态变更动作前**确认当前状态。咬合 04 Step0/fog-of-war 勘探、05 GateGuard、06a Phase1 Recon、06 Stop-Condition/vet-before-present、04 docs-first（grounding）。

eli-labz 认知 taxonomy 定义 **Perception = "行动前识别当前在发生什么"**（评估问："系统能否在行动前正确识别任务状态？"）。架构环：`Goal -> Plan -> Action -> Observation -> Verification -> Replan`--Observation 是 Action 与 Verification 之间的显式步。Human-action token 模型更硬：`Intent -> Perception -> Action -> Outcome -> Memory`，**每个 Action token 前都有一个 Perception token**（如 `OBSERVE(CRM_RECORD_OPEN)`）。

**GateGuard 的缺口**：只"首次编辑前"调查。但状态会漂移--子 agent 改过、并行的另一支 land 过、rewind/compact 后、长任务中段。perception 纪律要求**每个状态变更动作前**重确认，非仅首编辑：

- **重复编辑同一文件**：若该文件被 subagent / 并行支 / 用户外部改过，重 Read（咬合 04 Plan Handoff drift check `git diff --stat`、06 vet-before-present"子 agent 行号是线索不是事实"）
- **长任务/compact 后**：重跑 `git status`/`git diff` 确认工作区状态再动（咬合 02 compact 后从 Read 重新验证）
- **跑测试/部署前**：先确认当前在正确分支、无未提交冲突改动（咬合 05 并行 landing 门）
- **claim 任何状态前**：先 OBSERVE 取证，不凭记忆断言"已修复/已通过"（咬合 06 Stop-Condition 可观测证据、06 反过度声称）

**Grounding（独立维度，别和 perception 混）**：把 claim/action 锚到**外部 source-of-truth**，按权威层级（repo 文档/spec > 官方文档 > 包注册表 > 源码 > 社区）。咬合 04 docs-first 层级 + 06a Phase 6 回源码核对 + 06 产物溯源链--grounding 是"claim 不凭空"的纪律，perception 是"行动前看清"的纪律，两者互补。

## Immutability（CRITICAL）

ALWAYS 创建新对象，NEVER 修改已有对象：
```
WRONG:  modify(original, field, value) → 直接修改原对象
CORRECT: update(original, field, value) → 返回新副本
```

## 核心原则

**实现路径决策见 [stage-04 复用阶梯]**——KISS/DRY/YAGNI 不是并列 bullet，是有序过程：skip > 复用 > stdlib > native > 已装依赖 > one-liner > 最小新代码，停在第一个承重的横档。

**删除优于新增**：编辑默认偏向删代码而非加。review 的成功指标之一是 `net: -<N> lines possible`。

**`ponytail:` 注释约定**：有意简化（带已知天花板）的地方，内联注释命名天花板 + 升级路径，如 `# ponytail: 全局锁，吞吐敏感时改 per-account`。让技术债可 grep、带逃生口，而不是隐形无知。

## 文件组织

多小文件 > 少大文件：
- 高内聚，低耦合
- 200-400 行典型，800 行上限
- 按功能/领域组织，不按类型

## 命名规范

- 变量和函数：`camelCase`，描述性名称
- 布尔值：优先 `is`、`has`、`should`、`can` 前缀
- 接口、类型、组件：`PascalCase`
- 常量：`UPPER_SNAKE_CASE`

## 并行执行

ALWAYS 对独立操作使用并行 Task：
```
# 好：同时启动 3 个 agent
Agent 1: auth 模块安全分析
Agent 2: cache 系统性能审查
Agent 3: utilities 类型检查
```

### 并行 landing 门：序列化共享 mutable 阶段（来自 funador/claude-code-merge-queue）

> --worktree / `isolation:"worktree"` 解决了**执行隔离**（每 agent 自己 worktree）。但 landing 阶段——push 同分支、跑全量 build、跑共享 DB 测试——仍共享一个 mutable 东西，无交通管制就撞。

并行 agent 三类碰撞：
1. **push 竞态**：都推同分支，输的 rebase，rebase 又触发再输——恶性循环
2. **并发重 build**：N 个全量 build 同时跑 = 笔记本变暖气
3. **共享资源测试竞态**：并发 hit 同一 DB reset → 假 flaky（见 06：flaky 多半是碰撞不是随机）

**原则：别叫 agent 协调，让碰撞不可能。** agent 会违反文档化约定，恰在最坏时机。咬合 01 deny-by-default——结构上序列化共享 mutable 阶段（本地 merge queue：一个绿了才让下一个 land），而非"请协调"。

落地：merge queue 序列化 landing；CLAUDE.md 指示 agent 绿了自己 land（hands-off）；WorktreeCreate hook 自动建隔离。**执行可全并行，landing 必须排队。**

### 共享文档的 revision 乐观并发 + compact-first 编辑（来自 ronak-create/FableCut，未自测-架构模式）

> 补并行 landing 门（landing 阶段序列化）的**非 landing 场景**--多个 writer（agent + 人 + 另一 agent）持续编辑同一份 mutable 文档（project.json / 状态文件 / 协作文档），又不值得上 merge queue 全序列化时，用乐观并发 + 紧凑规划。

FableCut 的"项目文件即接口"：project.json 是唯一 source of truth，MCP / REST / UI 三套等价控制面都编辑它，SSE ~150ms 热重载。并发靠 **revision 号 + 乐观锁**：get 记 revision -> 改 -> set 时若被别人写过则 CONFLICT 拒绝（不覆盖），重读再改。patch ops 是 merge-safe（内部重读最新，只发变更，永不 whole-document round-trip）。

**落地到 agent 编辑共享状态**：
- **revision 乐观锁优先于裸"读后写"**：agent 写共享文档（非自己 worktree）时带 revision 号；冲突即拒绝重读，不盲目覆盖。咬合 05 并行 landing 门"让碰撞不可能"--revision 检测是"碰撞发生时安全失败"，介于"请协调"和"merge queue 序列化"之间，适合中频并发
- **compact-first 编辑**：规划用 compact summary（≈10× 小于全文档）+ status，只在要看精确字段时取全量；编辑用 patch ops 只发变更，不 get->改全量->set。咬合 02 token-diet（batch 进一轮、不 re-read 刚编辑的、minimize turns）--FableCut 是该纪律的工具化：`get_project {compact:true}` 规划 + `patch_project` 执行
- **三套等价控制面**：同一 source of truth 暴露 MCP / REST / UI，任一可驱动且行为等价。agent 工具设计不绑死单一接口；人用 UI、agent 用 MCP，同时编辑同源
- **docs 按需取 section**：master manual 支持 `docs {section:"..."}` 只取相关段，已 in context 则跳过。咬合 A2 渐进披露 + 02 缓存稳定

**与 landing 门分工**：landing 门管"push/build/test 共享 mutable"（高频硬碰撞，必须排队）；本段管"文档/状态共享编辑"（中频，乐观锁够）。前者序列化，后者乐观并发。咬合 05 Immutability--patch 内部重读再写新副本是 immutability 的并发版。

## 测试代码写法（AAA Pattern）

```typescript
test('calculates similarity correctly', () => {
  // Arrange
  const vector1 = [1, 0, 0]
  const vector2 = [0, 1, 0]
  // Act
  const similarity = calculateCosineSimilarity(vector1, vector2)
  // Assert
  expect(similarity).toBe(0)
})
```

## 构建故障排除

构建失败时：
1. 使用 **build-error-resolver** agent
2. 分析错误消息
3. 增量修复
4. 每次修复后验证
