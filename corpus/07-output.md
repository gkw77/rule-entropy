<!-- middleware: stage-7 -->

# Stage 7: Output

> 触发时机: 一切就绪，准备提交/输出结果
> 职责: git 提交、PR、记忆更新

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution 已通过 ~/.claude/settings.json 全局禁用。

## Pull Request Workflow

创建 PR 时：
1. 分析完整 commit 历史（不只是最新 commit）
2. 使用 `git diff [base-branch]...HEAD` 查看所有变更
3. 起草全面的 PR 摘要
4. 包含测试计划和 TODO
5. 新分支用 `-u` flag push

## 记忆更新

任务完成后，更新相关记忆文件：
- 项目进度记录
- 修复记录
- 踩坑记录
- 连续性记录

## core-rules.md 同步纪律

落 `rules/common/*.md` 后**必须同步** `scripts/core-rules.md`（post-compact 机械重注入速查）。否则 compact 后新规则丢失——recurrent 缺口（2026-07-08 审计发现 0708 落地未同步）。core-rules.md 控制行数（每次注入吃 token），只放最易丢的高优先级项，详细规则仍在 `01-07*.md`。咬合 02 post-compact 重注入。

## Next-action 置信度门（防越界）

> 来自 loop-library #051。agent 完成"被要求的任务"后，常因还有可见的后续动作而自动继续——越界。

完成判断与继续许可**分两问**，不混为一谈：
1. **任务完成了吗？** — 给一个有证据的状态（done/blocked/partial）
2. **可以继续下一步吗？** — 独立的 next-action 门，默认不自动越过用户原始请求

输出格式：一条任务状态 + 一条 next-action 门（"要做 X 吗？说一声"）。禁止把"完成"默认推导成"继续 scope"。

## 章节记录维护（写作场景）

每写完一章，立即更新章节记录：
- 章节号 + 标题
- 一句话概括发生了什么
- 本章出现的关键信息（新角色、新地点、事件节点）
- 主角状态变化
- 伏笔用 ★ 标记
