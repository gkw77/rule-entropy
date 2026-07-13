<!-- auxiliary: memory system -->

# A1: Memory System

> 触发时机: session 开始、写入/读取记忆、写作连续性检查
> 职责: 置信度记忆、写作连续性、instincts 自动学习

## 记忆格式（增强版）

所有 feedback 类记忆增加 `confidence` 和 `evidence` 字段：

```markdown
---
name: prefer-edit-over-write
description: 修改已有代码用 Edit 而不是 Write 全覆盖
metadata:
  type: feedback
  confidence: 0.8        # 0.3-0.9
  domain: code-style
  evidence: 3            # 观察到的次数
  scope: global          # global | project
---

修改已有代码必须用 Edit 工具，不能用 Write 全覆盖。

**Why:** Write 全覆盖会丢失未读取的代码段，导致文件损坏。
**How to apply:** 每次修改前先 Read 确认内容，再用 Edit 精确替换。
```

## 置信度评分规则

| 分值 | 含义 | 行为 |
|------|------|------|
| 0.3 | 试探性 | 仅建议，不强制 |
| 0.5 | 中等 | 相关时自动应用 |
| 0.7 | 强 | 自动应用，不需确认 |
| 0.9 | 近乎确定 | 核心行为，始终执行 |

### 升降规则

**升高（+0.1）：** 每 3 次重复观察、用户未纠正、相似 instinct 一致
**降低（-0.2）：** 用户纠正、>10 个 session 未观察、矛盾证据
**边界：** 上限 0.9，下限 0.1，低于 0.2 自动删除

## 自动提取模式

session 结束时检查：
1. **用户纠正** → 创建 feedback instinct（confidence: 0.5）
2. **重复错误** → 创建修复 instinct（confidence: 0.5）
3. **重复工作流** → 创建流程 instinct（confidence: 0.5）

## 记忆读取过滤

- confidence >= 0.7：自动应用
- 0.3-0.7：提示用户确认
- < 0.3：仅在用户询问时展示

## Instinct 进化

同 domain 3+ instinct 且平均 confidence >= 0.7 时，考虑合并为规则写入对应 stage。

## 行为策略蒸馏 + 人工覆盖优先（来自 SmileLikeYe/agent-chief）

> 补 A1 instinct 进化（learned -> rule）+ 02 post-compact 重注入（机械重发）的**人读 + 可编辑 + 人工优先**层。咬合 A3 settings vs CLAUDE.md（可编辑策略位置）+ openwiki（drift-as-PR 自动维护）+ 01 严格层胜出（但方向反转：人工 > learned）。

agent-chief 每晚把学到的行为**蒸馏成人读 `POLICY.md`**（不是二进权重/隐藏 config），且**人工编辑立即生效、优先于学到的**。学到的会 drift，人工的是 ground truth。

**落地到 instinct/规则治理**：
- instinct 进化不止"合并 confidence≥0.7 的进 stage 文件"--定期把高频 instinct 蒸馏成一段**人读策略**（"本会拦截 X / 放行 Y 的理由"），可审可改（咬合 A1 receipts：每条带证据）
- **人工覆盖优先**：用户纠正过 / 显式写下的规则，confidence 锚定高于自动学到的，冲突时人工胜（补 A1 升降规则缺"人工 vs 自动"方向--当前只有 +/- 分值，无"人工不可被自动覆盖"）
- POLICY 蒸馏是 openwiki drift-as-PR 的**行为版**：openwiki 文档 drift 开 PR，行为策略 drift 蒸馏进 POLICY.md 供人审

## 遗忘曲线调度 + 独立考官 with receipts（来自 nagisanzenin/engram）

> A1 只有 confidence 升降，缺**再浮现**——记忆写了不复习 = 等于没写。engram 补这层（FSRS-4.5 调度）。

- **next-review date**：高 stakes 记忆（关键 feedback/project 决策）带 FSRS 式 next-review 日期，到点提醒再审，非写一次永不再看。低 confidence + 到期 = 强制重验
- **独立考官盲改，非 self-assess**：验"还记得/还成立"时考官**独立于写记忆的上下文**（盲改、书面判定），不许"嗯应该还对"。咬合 06 maker-checker 独立上下文 + 06a Phase 6 独立验证——同一独立性原则落到记忆层
- **receipts**：每次验证留证据条（验了什么/对不对/何时），不只改 confidence。咬合 A4 复现——"还成立"可溯源，非信仰

## 项目级失败考古 register（来自 tomicz/fable-5-train-opus-skills-after-it-retires）

> 02 防重放是 **session 级**（压缩摘要不自动执行）；tomicz 泛化到 **项目级**——持久"别再打这场旧仗"账本。

- 每个被否决方案记 `symptom → root_cause → evidence → status`，**从 git history + docs 硬挖**（rejected fix / revert / dead branch 都是素材）
- 放项目级 `FAILURE-ARCHAEOLOGY.md`（非 session 内存），新方案动手前先 grep——咬合 02 防重放 + 06a 跨 run 累加"跳过已知"
- 比 session 防重放更强：防"整个项目级别重试已知会失败的路径"

## 写作连续性

**写新章节前，先回顾已有章节。**

### 查章节记录
- 上一章结束时主角在哪、什么状态
- 最近 3-5 章出现了哪些角色
- 有没有未收尾的线索

### 查关键信息一致性
- **角色当前状态**：以最新一次描写为准
- **地点距离**：不能跟之前矛盾
- **已发生的事件**：写前搜原文确认

### 易错清单
- 角色名字/称呼：写前搜一下是否重复或遗忘
- 物品去向：用完放哪了、给谁了、丢了？
- 伤痕位置：哪道疤是哪一章留下的？
- 人物关系：谁认识谁、谁欠谁人情？
