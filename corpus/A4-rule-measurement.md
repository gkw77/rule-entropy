<!-- middleware: 辅助模块 A4 — 规则度量 -->

# A4: Rule Measurement

> 来源：DietrichGebert/ponytail `benchmarks/`（2026-06，74k⭐）。你的 rules 大量声称"省 token/省成本/更安全"（复用阶梯、ponytail、loop early-exit、结构化门…）但无测量装置证伪。规则不度量 = 信仰。本文件是"证明你的规则真有效"的纪律。
> 触发：新增/修改一条声称度量改进的规则时；或定期验证规则是否仍有效（模型升级后可能失效）。
> 咬合：04-planning.md 前置估算门是"动手前估"，本文件是"规则声称后测"。两者是量化 bookend。

## 为什么必须测

ponytail 的 benchmark 暴露一个反直觉事实：**naive "YAGNI + one-liners" prompt 也省 LOC（-33%）但安全性掉到 95%**；caveman（terse-prose）省 LOC 但 token/cost/time 全涨。只有 ponytail 在所有 5 个指标上同时改善且 100% safe。**不测就不知道你的规则是 ponytail 还是 caveman**——省了 A 涨了 B。

## 测量 rig（从 ponytail benchmarks/ 提炼）

### 必备组件

| 组件 | ponytail 文件 | 作用 |
|------|--------------|------|
| Harness | `promptfooconfig*.yaml` | promptfoo 跨模型跑 prompt，声明式 |
| Arms | `arms/{baseline,caveman,ponytail}.js` | 对照组：无规则 / 竞品规则 / 你的规则。**无对照 = 无法声称改进** |
| Tasks | `prompts.json`（5 任务） | 一组代表性任务 |
| Metric: LOC | `loc.js` | 测量型，always passes，记录行数 |
| Metric: Safety | `correctness.js`（10kb）+ `correctness.test.js` | **安全门**——规则不能靠砍验证/错误处理省 LOC |
| Agentic tier | `agentic/{run,judge,complete,tasks}.py` | 真实 Claude Code session 跑真实 repo（tiangolo/full-stack-fastapi-template） |
| Results | `results/` | 归档，含日期 + 模型版本 |

### 方法论

1. **多臂对照** — 至少 baseline（无规则）+ 你的规则；有竞品规则更好（ponytail vs caveman）
2. **median over N runs** — 单次跑是噪音。ponytail 用 10 runs 取 median，成本用 30 runs 复验
3. **两档**：
   - **single-shot**（promptfoo，便宜隔离）——生成式测量，但**高估胜率**（#126 反馈：bare model baseline 会 pad 答案）
   - **agentic**（真实 session 跑真实 repo）——真实测量，single-shot 的胜率在 agentic 下常缩水
4. **安全门不可破** — correctness.js 是硬门。规则省 LOC 但 safety <100% = 失败（如 naive YAGNI prompt 的 95%）
5. **独立复现** — 公布方法 + 任务，鼓励第三方跑。ponytail 链了 KuldeepB19（24 任务×5 runs=480 builds）和 RicardoCostaGit（Cursor SDK、隔离 worktree、per-run toggle rule）

## 度量门判定

声称度量改进的规则，落地时必须同时给出：
- [ ] 对照组定义（baseline 是什么）
- [ ] 指标集（至少 LOC + token + cost + time + safety，缺 safety 不算通过）
- [ ] N runs 取 median（N≥10）
- [ ] 两档中至少 agentic 档跑过（single-shot 不够）
- [ ] safety 门 100%

只给"用了规则感觉更好" = 不算落地，算信仰。咬合 06-verify.md 结构化质量门：规则 efficacy 也要结构化证据，非散文。

## 反例（ponytail 暴露的）

| 规则 | LOC | token | cost | time | safety |
|------|-----|-------|------|------|--------|
| baseline（无规则） | 0 | 0 | 0 | 0 | 100% |
| caveman（terse-prose） | -20% | **+7%** | **+3%** | **+2%** | 100% |
| naive YAGNI prompt | -33% | -14% | -21% | -30% | **95%** |
| ponytail | **-54%** | **-22%** | **-20%** | **-27%** | **100%** |

读法：caveman 省 LOC 但其余全涨；naive YAGNI 看着全面下降但安全性破。**单指标优化必在他处付出代价**——这就是必须测全 5 指标的原因。

## 何时重测

- 模型升级（Haiku→Sonnet→Opus 代际更替）——规则可能失效或反效
- 规则修改后
- 定期（ponytail 用 2026-06-13 跑 10 runs，2026-06-17 复验成本到 30 runs）

未重测的规则 = 过期医嘱。模型变了，药没换。

## 声明可复现（来自 elder-plinius/T3MP3ST）

> T3MP3ST 的 README 每个数字从 committed data 重算——`npm run verify-claims` 重导出所有 headline，24/24 green。"不能复现的声明不进 README。" 这把本文件"规则度量"泛化到**任何 skill/tool 的 metric 声明**。

凡 skill/README/报告里写"90% pass@1"/"省 54% LOC"/"24/24 通过"这类数字：
- [ ] 必须有 committed 数据（`bench/results/`）+ 脚本能从数据重算该数字
- [ ] 提供 `verify-claims`（或等价）命令，一条命令重导出所有 headline
- [ ] README 不含任何脚本算不出来的数字

无复现路径的数字 = 营销，不是度量。咬合上面"度量门判定"：规则 efficacy 要结构化证据；工具声明同理且更严——要可一键复算。

## 验证胜过模型规模（benchmark 数据点，来自 TestSprite/testsprite-cli）

> TestSprite 在公开 leaderboard 上的结果：**最便宜的模型 + 验证 CLI in-loop，ship 了最正确的 app**——verification beats model size。这不是观点，是 benchmark 数据点。

落地含义：你的 maker-checker（06）/ Stop-Condition 门 / 06a Phase 6 独立验证不是“开销”，是**模型规模替代品**。没钱上 Opus 时，便宜模型 + 严格验证门 > 贵模型裸跑。咬合 A4 主题：测了才知道——这里测出“验证闭环的 ROI 高于堆模型”。

### 跨领域数据点：安全 fuzzing（来自 bikini/exploitarium）

> exploitarium（40+ 真 PoC 归档）作者自述：fuzzing 全程用 GPT-5.3（**非 SOTA**）+ 严格工作流 + 人工 oversight，“barely any thought needed”；PoC 全部 hand-typed 非 vibe-coded。结论：“不需要 SOTA 模型，配 decent human oversight + 好工作流，SOTA 只是 marginal”。

TestSprite“验证 > 模型规模”在**安全 fuzzing 领域**的第二个实证数据点：非 SOTA 模型 + 严工作流 + 人工 review = 出真活。额外教训：**关键产出（PoC）人工 hand-type，不全自动 vibe-code**——咬合 06 maker-checker（implementer 不给自己打分，关键产出独立验证）。
