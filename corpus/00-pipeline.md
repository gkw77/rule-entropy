<!-- middleware: pipeline-overview -->

# Middleware Pipeline

> 受 DeerFlow 2.0 + ECC + claude-code-best-practice 启发，7 阶段管道 + 4 辅助模块。

## 执行顺序

```
消息进入
  ↓
[01] security       — 安全前置：secret 检测、输入验证、权限控制
  ↓
[02] context        — 上下文：窗口管理、压缩策略、防重放、handoff
  ↓
[03] routing        — 路由：agent 选择、模型选择、skill 激活、MCP 审计
  ↓
[04] planning       — 规划：web 调研、垂直切片、TDD、TodoList
  ↓
[05] execute        — 执行：编码规范、GateGuard、设计模式、并行调度
  ↓
[06] verify         — 验证：质量门、测试、代码审查、安全审查
  ↓
[07] output         — 输出：git 提交、PR、记忆更新
  ↓
结果返回
```

## 辅助模块（按需加载）

| 模块 | 文件 | 用途 |
|------|------|------|
| 记忆系统 | `A1-memory.md` | 置信度记忆、写作连续性、instincts |
| Skill 设计 | `A2-skill-design.md` | 渐进披露、目录结构、编排模式 |
| 规则编写 | `A3-rule-craft.md` | important if、paths 懒加载、CLAUDE.md 技巧 |
| 规则度量 | `A4-rule-measurement.md` | 测量规则是否真省 token/成本/safety |

## 快速参考

| 阶段 | 何时激活 | 关键动作 |
|------|----------|----------|
| 01 | 收到用户消息时 | 检查 secret、验证输入、权限控制 |
| 02 | 涉及长对话/压缩时 | 管理窗口、建议 compact、防重放 |
| 03 | 需要选择工具/agent 时 | 路由到正确 agent、审计 MCP 工具数 |
| 04 | 开始新任务时 | 搜索调研、垂直切片、写测试(RED) |
| 05 | 写代码时 | GateGuard 守卫、编码规范、并行执行 |
| 06 | 代码写完后 | 质量门、测试运行、代码审查 |
| 07 | 一切就绪后 | git 提交、PR、更新记忆 |

## 文件索引

```
00-pipeline.md        — 总览（本文件）
01-security.md        — 安全前置
02-context.md         — 上下文管理
03-routing.md         — 路由与工具
04-planning.md        — 规划与调研
05-execute.md         — 执行与守卫
06-verify.md          — 验证与质量门
06a-security-audit.md — 安全审计 pipeline（stage-06 辅助，来自 cloudflare）
07-output.md          — 输出与记忆
A1-memory.md          — 记忆系统（辅助）
A2-skill-design.md    — Skill 设计（辅助）
A3-rule-craft.md      — 规则编写（辅助）
A4-rule-measurement.md — 规则度量（辅助，来自 ponytail benchmarks/）
```

## 语言专属规则

`rules/python/`（coding-style/hooks/patterns/security/testing）— Python 专属编码规范，`paths: **/*.py` 懒加载（触碰 .py 才激活）。`common/` 是 agent pipeline 规则不含语言规范，`python/` 补语言层（PEP8/black/ruff/pytest/bandit），每个文件指向 `common/` 里最相关的通用规则。
