<!-- auxiliary: rule writing techniques -->

# A3: Rule Writing Techniques

> 参考来源: claude-code-best-practice
> 职责: CLAUDE.md 和 rules 文件的编写技巧

## 文件大小

- CLAUDE.md 每个文件控制在 200 行以内
- 过长时拆分为多个文件或使用 paths 懒加载

## `important if` 标签

关键规则用 `important if` 标签包裹，防止文件变长后被忽略：

```markdown
<important if="涉及认证/授权代码">
所有认证相关变更必须经过 security-reviewer agent 审查。
</important>
```

## `paths:` frontmatter 规则懒加载

项目级规则文件用 `paths:` 限定触发范围，避免无关文件加载：

```yaml
---
paths:
  - "src/api/**"
  - "src/auth/**"
---
# API 和认证规则
只在触碰 src/api/ 或 src/auth/ 时加载
```

## settings.json vs CLAUDE.md

**settings.json** 放确定性行为（harness 强制）：
- 权限配置
- 模型选择
- attribution 设置

**CLAUDE.md** 放指导性规则（模型遵循）：
- 编码规范
- 工作流程
- 项目特定约束

## Skill description 是触发器

Skill 的 description 字段写给模型看，不是写给人看：
- ❌ "This skill helps with code review"
- ✅ "When the user finishes writing code or asks for a review, activate this skill"
