<!-- auxiliary: skill design patterns -->

# A2: Skill Design Patterns

> 参考来源: ECC、Anthropic-Cybersecurity-Skills、claude-code-best-practice
> 职责: Skill 设计的最佳实践参考

## 渐进披露（Progressive Disclosure）

Frontmatter 优先扫描：每个 skill 的 frontmatter 约 30 tokens，完整内容 500-2000 tokens。
扫描全部 frontmatter 找到最相关的，再加载完整内容。

817 个 skill 的 frontmatter 扫描 ≈ 24K tokens，完全可接受。

## 目录即 Skill

```
skills/my-skill/
  SKILL.md           # YAML frontmatter + Markdown body
  references/        # 参考文档、标准映射
  scripts/           # 辅助脚本
  examples/          # 示例
```

## SKILL.md 结构

### Frontmatter
```yaml
---
name: my-skill
description: 触发描述（这是给模型看的触发器，不是摘要）
metadata:
  origin: project-name
  version: 1.0.0
---
```

### Body 四段式
1. **When to Use** — 触发条件
2. **Prerequisites** — 前置工具和权限
3. **Workflow** — 分步执行流程
4. **Verification** — 成功确认标准

### Gotchas 段

每个 skill 必须包含 Gotchas 段，记录 Claude 在该领域的已知失败点。

## Command → Agent → Skill 编排

```
用户输入 /command
  ↓
Command 解析参数，设置上下文
  ↓
Command 启动 Agent（带特定 persona）
  ↓
Agent 加载相关 Skills
  ↓
Skill 执行具体工作流
  ↓
Agent 汇总结果返回
```

## `context: fork` 隔离

Skill 在隔离子 agent 中运行，主上下文只看到最终结果。
20 次文件读取 + 12 次 grep + 3 次死胡同留在子上下文。

## Skill 设计原则

- **description 是触发器**：写给模型看"什么时候该激活我"
- **不给步骤式指令**：给目标和约束，不给死板的 1-2-3
- **嵌入 `!command`**：在 SKILL.md 中注入动态 shell 输出
- **Gotchas 必须写**：记录 Claude 在该领域的已知失败点

## 来自 BuilderIO/skills + vercel/eve 的增强

### description 穷举触发面（BuilderIO）

description 不摘要 skill，而**枚举触发面**。金标准（read-the-damn-docs）：一句话列 ~15 个触发场景——"implementing, integrating, upgrading, debugging… 第三方 API、库、框架、CLI、云服务、SDK… auth、安全、计费、迁移、部署…"。写不出这么多触发面，说明 skill 边界不清。

### Slot 语义表（eve）——内容放哪的显式决策

| 内容性质 | 位置 | 对应 eve |
|---|---|---|
| always-on 规则 | `CLAUDE.md` / `rules/common/0X-*.md` | instructions.md |
| 按需流程 | `skills/<name>/SKILL.md` | skills/ |
| 带类型/参数的操作 | `scripts/` 或 MCP 工具 | tools/ |

identity 来自路径，不是 frontmatter 的 name——`skills/summarize/SKILL.md` 就是 skill `summarize`。

### Skill-as-pointer-to-local-docs（eve）

包裹**快变框架/库/工具**的 skill，**不内联 API 细节、选项名、版本行为**——这些会漂移。改为指本地 pinned 权威副本（`node_modules/<pkg>/docs`、pinned `references/` 文件、或 `!command` 打印已装版本），指示 agent 先读它。skill 是薄指针，权威内容在不会漂移的本地副本。

### Skill + companion-rule 配对（BuilderIO）

需要 always-on 行为的 skill，声明 `companion-rule:` 指针指向 stage 文件（如某 recap skill ↔ `07-output.md` 的托管块）。让每个 always-on 行为可追溯到 skill 或标记为 standalone，可审计。

### README + SKILL.md 双文件（BuilderIO，团队共享时才用）

- `README.md`：给人看——做什么、何时用、怎么装
- `SKILL.md`：给模型看——frontmatter + body

个人 skill 是开销，跳过；要分享给团队时才采用。

### 三文件 + 组合 seam + 生成前 grounding（来自 op7418/guizang-material-illustration）

> 补上面"README+SKILL.md 双文件"的**第三槽 + 组合 + 生成纪律**。归藏的材质插画 skill 用 `SKILL.md`（触发+workflow）+ `HANDOFF.md`（安装/更新/checkout 的**可复制 prompt 文本块**）+ `PRODUCT.md`（定位）三文件分离。咬合 Slot 语义表（加第四槽）+ 04 fog-of-war "slice at API seams"。

- **HANDOFF.md 是机器可执行交接产物**：不是人读文档，是"帮我安装/更新 X，克隆到 ~/.claude/skills/X，检查 SKILL.md/assets/references 是否存在"这类**可直接粘给 agent 的 prompt 文本**。BuilderIO 双文件是"人读 vs 模型读"；HANDOFF.md 是"安装/维护动作的可复制指令"--第三槽。个人 skill 可省，需安装/分享的 skill 该有
- **skill 组合走 crisp seam**：归藏 social-card-skill 管卡片框（标题/正文/主题色/尺寸），material-illustration 管中心插画--两 skill 边界 crisp，可串"先生成中心配图，再交给卡片 skill 排成 3:4"。多 skill 协作靠**显式 seam 契约**（输入/输出类型），不隐式耦合。咬合 04 积木库 + Plan Handoff Consumes/Produces
- **生成前 grounding（unfamiliar entity）**：遇冷门概念/品牌/模型/科学装置/历史物件，**先查参考信息+参考图，再统一转风格**，不从模型记忆直生成。咬合 04 docs-first + 05 Perception-before-action 的**生成版**--image gen 也要 grounding，不只代码/claim 要
- **保真 preserve/discard 清单**：重画糟糕截图时，**只保留图表类型/标题/数据/坐标/单位/误差线/结论，不复刻原图排版**。显式列"保什么、弃什么"是 06 rnskill 保真度分层的实例--re-render 任务先列 preserve 集合，不凭感觉重画

### 设计类 skill 双层 frontmatter（来自 google-labs-code/design.md）

> design.md 的核心：**frontmatter 放机器可读 token（精确值），body 放 rationale（为什么）**。token 是 normative 值，prose 解释 *why*。同构映射到设计类 skill——生成 UI/视觉的 skill，其设计约束应可被 lint/diff 机器校验，而非埋在散文里。

个人或自建设计 skill 的 frontmatter，除了 `name/description` 触发器，再加一层 `design` token：

```yaml
---
name: design-html
description: "finalize this design, turn mockup into HTML, build me a page..."  # 触发面（见 BuilderIO 节）
design:
  colors:
    primary: "#1A1C1E"
    accent: "#B8422E"
  typography:
    h1: { fontFamily: Public Sans, fontSize: 3rem }
  rounded: { sm: 4px, md: 8px }
  spacing: { sm: 8px, md: 16px }
---
## Rationale
Deep ink headlines + warm limestone bg + single Boston Clay CTA.
accent 只用于交互驱动，不铺面——视觉锚点唯一。
```

**规则：**
1. **token 是 normative**：agent 生成 UI 时取这些精确值，禁止"差不多的色"
2. **prose 解释 why**：为什么是这个 palette、accent 怎么用、何时破例——给 agent 判断依据
3. **可 lint/diff**：token 层结构化，能被 `npx @google/design.md lint` 类工具校验（对比度/引用完整性/版本回归），咬合 `06-verify.md` 结构化质量门
4. **gstack 自动生成的 design-* skill 不动**：它们 frontmatter 由 `.tmpl` 生成，改了被覆盖。此规范用于自建/个人设计 skill

token + rationale 双层是 `description 穷举触发面` 的姊妹模式：触发面解决“何时激活”，token 解决“激活后用什么精确值”。

### 双关卡校验 + 平台约束硬编码（来自 isjiamu/gzh-design-skill）

> 设计 skill 的 token 层（上面）是**源关卡**（lint 组件库/设计变量）；gzh 加**产物关卡**（validate 最终渲染 HTML）→ 可复现的 改→验→修 闭环。两关非一关。

- **源关卡**：`component_lint.py` 校验组件库/token 本身合规（对比度/引用完整性，咬合 06 结构化门）
- **产物关卡**：`validate_gzh_html.py` 校验每次生成的最终产物（每 generation 一 gate，不只验源头）
- **平台约束硬编码为生成器硬规则**：把目标平台的**有损过滤**写成生成器不可违反的约束。公众号 strip `<style>/<div>/class/grid/position` → 生成器全内联样式、`<span leaf="">` 包裹、禁 class。**这对 Godot/抖音 导出是金矿**——把“抖音 strip X / 拒绝 Y”（见 tantiaowang douyin pitfalls 记忆）编码成导出 skill 硬约束，而非每次踩坑
- 咬合 06 结构化门：两关（源+产物）都输出 findings JSON

> **自测 receipt（2026-07-09, A4）**：rig `E:/cc/gzh-rig/rig.py` 种 19 缺陷跑对照--源单关卡 12/19(63%)、产物单关卡 17/19(89%)、**双关卡 19/19(100%)**，0 期望偏差。双关卡比最佳单关卡多抓 +2/19(11%)：`white-space:pre`+四周虚线框这 2 个产物关卡不查的源级反模式。确定性 regex lint -> N=1 有效(无采样方差)；诚实限制：测结构支配性(union⊃each)非真实文章逃逸率。复现：`cd /e/cc/gzh-rig && python rig.py`

### Skill 作时序蒸馏 + CORE 起手 taxonomy（来自 tomicz/fable-5-train-opus-skills-after-it-retires）

> shadcn/improve 是“强模型写 plan，便宜模型执行”（单任务）；tomicz 加**时序维度**：退役/将不可用的强模型建**永久 skill 库**让便宜模型接班——skill 是机构记忆 / bus-factor 保险，非单任务 plan。

- **5 问发现上限**：先像新任 principal eng 挖 repo（README/build/test/CI/docs/git history/TODO 热点/memory），**最多再问 5 个**，只问 repo 答不了的（最难现实问题/未成文纪律/受众不知道什么/最费时过往失败/“超越 SOTA”对此项目意味什么）。咬合 04 设计签核门“一次一问” + 02 token-diet——先穷尽 repo 再问
- **CORE 起手 taxonomy**（按 Phase 1 发现裁剪/合并/扩域，目标 10–16 skills）：
  - `<project>-change-control` — 变更分类/门控/审查 + 非协商项的**理由和历史事故**
  - `<project>-debugging-playbook` — 本项目失败模式 symptom→triage 表 + 烧过时间的坑 + 判别实验
  - `<project>-failure-archaeology` — 失败考古（见 A1 项目级失败考古 register）
  - `<project>-architecture-contract` — 承重设计决策 + WHY + 必须成立的不变量 + 已知弱点
  - `<domain>-reference` — mid-level 缺的领域理论包（本项目的数学/协议/标准，非教科书）
- 咬合 04 Plan Handoff 便宜 executor + A1 instinct 进化——skill 是“已进化到可交接”的规则形态


### 认知能力覆盖审计（来自 eli-labz/Cognitive-Core-Skills）

> 补 06 覆盖度门（威胁类别覆盖比）+ 测试 80% 门（代码路径覆盖）的 **agent 认知能力覆盖**维度--审/建 skill 集时，覆盖的是 agent 该有的认知能力面，不是单条 skill。咬合 06 覆盖度门 + A2 渐进披露。

eli-labz/Cognitive-Core-Skills 给 8 类认知核心能力 taxonomy（159 skill card + JSON schema + CI）：**感知 perception / 记忆 memory / 推理 reasoning / 规划 planning / 行动 action / 验证 verification / 学习 learning / 治理 governance**。

映射到本 pipeline：01-security≈governance、02-context≈memory、03-routing≈planning、04-planning≈planning、05-execute≈action+**perception**（Perception-before-action，每动作前确认状态）、06-verify≈verification、A1≈learning。**自审**：原"感知偏弱"已由 05 命名补强（GateGuard 从首编辑扩到每动作）；剩余 **Grounding**（claim 锚 source-of-truth 层级）在 05 同段命名。覆盖度 8/8（仅命名映射，perception 未测 efficacy，见 05 段）。

参考实现（taxonomy + schema + CI）见该 repo；本条是覆盖审计纪律，不内联 159 卡。
