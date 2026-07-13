# 规则系统的熵：给 AI agent 的规则装一个会自测的路由器

> **这不是又一篇文章，是一个能跑的东西。** 一个规则路由器（输入问题 -> 输出该用哪些规则 + 置信度 + 理由），加上它**给自己的 receipt**：一个测试集，跑出真实的 precision / recall。
>
> 状态：MVP（L0 关键词路由器 + 18 题测试集 + 阈值扫描）。clone 即跑，一条命令出数字。

## 一句话核心

给 AI agent 写的规则（CLAUDE.md / AGENTS.md / skills）会**自发熵增**：只增不减、互相抄袭、模型升级后过期失效、蚕食 context 窗口。减熵需要做功。这个 repo 做的做功是**路由**--问题来了，筛出相关规则不全量载入；而路由规则本身也是规则，按下面的立场它**必须被验证**，所以路由器自带测试集跑 P/R = 它的 receipt。

## 自指：路由器拿自己开刀

这个项目最核心的亮点是**自指**：

1. 文章立论：规则不验证 = 信仰。
2. 路由规则（"什么问题用什么规则"）也是规则。
3. 按文章立场，路由规则必须验证。
4. 所以建测试集跑 precision / recall = **给路由装 receipt**。
5. 验证**不是和路由并列的另一根支柱**，是**路由自身必须配备的 receipt**。

于是项目从"路由 + 验证双做功"收敛为**单核路由 + 其 receipt**--更聚焦，不瘸腿。路由是核心交付物，receipt 是它不能缺的配件。

仪器测仪器自身：路由器扫的语料是作者自己的 13 个规则文件（`corpus/`，快照自 `~/.claude/rules/common/`），测的是"我自己的规则能不能被正确路由"。建仪器 -> 测仪器自身。

## 跑起来（30 秒）

```bash
git clone <this-repo>
cd <repo>
# 路由一个单题
node router/router.js "我的代码有SQL注入风险，怎么防"

# 跑全测试集，出 precision / recall receipt
node router/eval.js
```

零依赖，纯 Node。输出一个阈值扫描表 + 每题明细 + `results/l0-baseline.json`。

## 第一个 receipt（真实数字，不 game）

L0 关键词路由器，18 题测试集，macro 指标：

| 阈值 | Precision | Recall | F1 |
|------|-----------|--------|------|
| 0.05 | 0.179 | **0.972** | 0.293 |
| **0.10** | **0.451** | **0.917** | **0.570** |
| 0.15 | 0.491 | 0.611 | 0.528 |
| 0.20 | 0.306 | 0.333 | 0.315 |
| 0.30 | 0.056 | 0.056 | 0.056 |

最佳 F1 在阈值 0.10：**P=0.451, R=0.917, F1=0.570**。

**诚实解读**（这本身就是 receipt 三分的示范--先测，不预设有效）：

- **Recall 91.7%**：正确的规则文件几乎总在候选集里。L0 关键词做"召回"很便宜。
- **Precision 45.1%**：每题多载 2-4 个交叉引用文件。`04-planning` 和 `06-verify` 是"什么都提一句"的枢纽文件，成为慢性误报。
- **1 题完全漏召回**："规则怎么验证有效"期望 `A4-rule-measurement`，但 query 词汇没命中 A4 的"度量/receipt"术语 -> L0 关键词层的天花板，语义判别要靠 L1。
- 阈值扫描呈典型 P/R 权衡：低阈值全召回但 precision 崩；高阈值 precision 升但 recall 断崖。**没有"再加一条规则"式的免费午餐**。

这 45% 不是失败，是**测量本身**：它精确指出了 L0 关键词层的边界在哪--recall 便宜、precision 贵。下一片切片（L1 便宜 LLM 按描述分类，或给枢纽文件加 ownership 标签）就该冲这个 precision 缺口。**没测之前不知道缺口在这**--这就是为什么路由需要 receipt。

## 熵增定律（核心类比）

热力学第二定律：孤立系统熵自发增不减。agent 规则系统正是"孤立"的--没人验、没人删、没人重测，于是只增不减越来越乱。**减熵必须从外部做功。**

表现（大家都有的痛点）：

- 人人写 agent 规则（CLAUDE.md / AGENTS.md / SKILL.md / cursor rules / .clinerules），人人往里堆，没人测
- 规则吃 context（每条 ~500 token，30 条吃 7.5% 窗口）+ 上下文腐烂（40% 使用率进笨区）+ 规则互相冲突
- **死循环**：规则越多 -> context 越挤 -> agent 越笨 -> 你加更多规则补救 -> 更挤。且没人能定位是哪条规则在帮忙、哪条在添乱

三个面：

1. **信仰传递**：A 引 B 的数字，B 引 C，C 引某 README，源头从不验。一个错误的"最佳实践"能传遍全网
2. **过期医嘱**：规则针对某模型版本写，模型升级（Haiku->Sonnet->Opus 代际更替）后失效甚至反效，没人重测
3. **投入错位**：社区拼命换更强模型、堆更多规则，却很少投验证门。但 TestSprite 公开 leaderboard：**最便宜模型 + 验证 CLI in-loop > 贵模型裸跑**

## 减熵做功：路由（这个 repo 做的）

> 治组合爆炸 + context-bloat。问题来了，用树 + 标签筛出相关规则，不全量载入。

**现状审计**（查了作者自己的实际文件）：

- `common/`（13 文件 ~60KB）：**零筛选**，harness 每 session 全量自动载入（无 paths、无 @import）。最大最熵高。← 问题所在
- `python/`（5 文件）：`paths:` 文件 glob 懒载。唯一真在筛的层，但触发是文件类型非语义
- skills：frontmatter 渐进披露，最精
- **缺口**：`common/` 上没有语义路由原语（paths 是文件 glob，不是"问题语义"）

**路由架构**（设计，部分已验）：

- **spine**（主干树）：MECE，一任务一个主轴。已有 = 阶段（01-07），`00-pipeline.md` 是树根
- **facets/tags**（横切）：正交、可多个。security / parallel / subagent / ctx-stress。spine+tags 并集 = 不漏
- **名**：分面分类（faceted classification），图书馆学主分类 + 正交分面
- **谓词必须便宜、可观测**（frontmatter/路径/关键词），不能要加载全文才判（循环）
- **准确率瓶颈在描述符**（非分类器）。机制 = 值得性级联：L0 关键词 µs 秒配 -> L1 便宜 LLM 按描述分类（仅歧义时）-> 白盒输出匹配理由 + log
- **过载边界**："拿不准就多载"无界，修正为"退一格载粗的"（叶子拿不准载父节点），树 ~3 层封顶，硬天花板 token/占比上限

> **诚实：这个架构只验了最底层。** 别读成"spine / facets / 退一格 都验过了"——那是设计，不是 receipt。

| 层 | 状态 |
|---|---|
| L0 关键词（spine 文件级） | **已验**（P=0.451 / R=0.917，18 题） |
| L1 便宜 LLM 按描述分类 | 待验（冲 precision 缺口） |
| facets 横切标签（security / parallel / ...） | 待验（设计，未建索引） |
| 退一格（叶子拿不准载父节点） | 待验（设计，未实现） |

按本项目立论"规则不验证 = 信仰"——上表"待验"三行目前是**设计信仰**，不是已验规则。L1 / 标签 / 退一格任一切片落地后，必须像 L0 一样配测试集跑 P/R 才算 receipt。**这是自指诚实：项目自己不能写得像验了却没验。**

## receipt 三分（复现 ≠ 证明有效）

最易被忽略、最易自欺。一个"验证了"分三种：

- **独立 rig**：你设计实验测规则的 claim -> 真 efficacy
- **复现 receipt**：你跑别人 demo 验引用数字为真 -> 验 citation，**不证明你的规则有效**
- **二手**：只引别人数字，没验 -> 信仰

举例：作者复现 agent-chief 的 96%/75%/70%（逐字吻合），但这只证明"agent-chief 的 demo 跑得出这些数"，**不证明**"我的 pipeline 用了值得性升级门就削减 75% LLM 调用"。后者需独立测。社区大量"我验证了 X 规则有效"实际只是复现了 X 的来源数字--**citation 验证被误当 efficacy 验证**。

**本 repo 的 P=0.451/R=0.917 是哪种？** 是第一种（独立 rig）--作者自己设计的测试集、自己跑自己的路由器、测的是"我的路由规则"的 efficacy，不是复现别人的数字。所以它是真 receipt，不是 citation 验证。这是本项目相对"复现别人 demo"的进阶：测的是自己的规则，不是别人的。

## claim × receipt 框架（让"该测哪些"可机器判定）

不是所有规则都需度量。分五类：

- `behavior`（方法论散文，N/A）--"先调研""分切片"，无需度量
- `secondhand`（引别人数字，需复现）--"dao-code 报 95.8% cache-hit"
- `selftested`（自测，需 N runs）--你自己跑过 rig
- `faith`（声称度量零 receipt）--"compact 在 40% 触发"但无来源无实测
- `claimNoMetric`（声称效果但无数字）--"防漂移"但没说降多少

只有 claim（声称度量改进）的规则才欠 evidence；behavior 不要求。这是"evidence 覆盖率"--像代码测试覆盖率，但针对规则。

**自指示范**：作者审自己的 177 个规则块，89% behavior（N/A），剩 ~19 metric-adjacent **全部 secondhand/faith，0 真自测**。建仪器后破 2 个 P0（gzh 双关卡独立 rig、agent-chief 数字复现），现在这个路由器是**第 3 个 receipt**--且是唯一测"自己规则"而非"别人数字"的那个。

## 验证 > 模型规模（投入重定向）

- TestSprite 数据点 + exploitarium 安全 fuzzing 实证：非 SOTA 模型 + 严工作流 + 验证门 = 出真活
- ROI：加一道验证门的收益 > 换更强模型
- 落地：没钱上 Opus 时，便宜模型 + 严格 maker-checker / Stop-Condition 门 > 贵模型裸跑
- 这把"规则度量"从"锦上添花"重定位为"模型规模替代品"

## 给读者的可迁移 take

1. 扫一眼你的 CLAUDE.md：多少条是"引别人数字"或"纯行为纪律"？跑 claim×receipt 分类
2. 只有声称度量改进的规则才欠 evidence，方法论散文不欠
3. **复现别人数字 ≠ 证明你的规则有效**，分清 citation 验证 vs efficacy 验证（最易自欺）
4. 加验证门的 ROI > 换更强模型；规则度量是模型规模替代品
5. 规则越多越笨时，先别加规则--先路由（筛掉不相关的）再验证（判剩下的真假）
6. 任何路由 / 分类器都是规则，都该配测试集。没测过的路由 = 信仰路由

## 仓库结构

```
corpus/              13 个规则文件（快照自 ~/.claude/rules/common/，被路由的语料）
router/router.js     L0 关键词路由器：建带权倒排索引，route(query) -> matched + loaded
router/eval.js       评估器：跑测试集 + 阈值扫描，输出 precision/recall receipt
testset.json         18 题 (query, expected) 测试集
results/             receipt 归档（l0-baseline.json）
```

路由器设计：描述符从 H1/H2/H3 标题 + `**bold**` 术语 + 正文抽（位置加权 H1=3/H2=2/正文=1），CJK 走 bigram 不依赖分词库，打分 = 带 IDF 的加权查询覆盖率，白盒可解释（每题明细打印命中 token）。

## 待续

- [ ] **L1 切片**：便宜 LLM 按穷举触发面 description 分类，仅歧义时介入，冲 precision 缺口（L0 留下的 45% -> ?）
- [ ] **ownership 标签**：给枢纽文件（04-planning / 06-verify）标" owns X / references X"，让"提到"和"拥有"可区分
- [ ] **facets 标签**：security / parallel / subagent / ctx-stress 横切索引，测横跨多阶段 query
- [ ] **退一格**：叶子拿不准载父节点（00-pipeline 作树根）
- [ ] **security tag 写穷触发面**（BuilderIO 金标准 ~15 场景），验 L0 秒配的具体起手
- [ ] 扩测试集到 30-50 题，跨 session 复验（single-shot 高估，agentic 下常缩水）
- [ ] 全文展开 3000-5000 字 / 发布形式（repo README / Gist / Pages）

## 可复现素材（reproducible/）

不是"可附"——已经附在 repo 里，clone 即跑。立论说"可复现"，素材就得在 repo，否则自打脸。

| 路径 | 是什么 | 怎么跑 |
|---|---|---|
| `reproducible/rule-evidence-audit.js` | claim×receipt 五分类器，扫规则出 evidence 分布 | `node reproducible/rule-evidence-audit.js corpus .`（扫本 repo 的 13 个规则快照）；扫你自己的规则：`node reproducible/rule-evidence-audit.js ~/.claude/rules "common,python"` |
| `reproducible/gzh-rig/` | 独立 rig 示范，19 缺陷测双关卡 vs 单关卡 | `cd reproducible/gzh-rig && python rig.py`（纯 stdlib，自包含，无需外部依赖） |
| `reproducible/dao-cache-rig.py` | 跨 session 骨架示范（缓存稳定性 A/B） | 需 `pip install anthropic` + `ANTHROPIC_API_KEY`——**跨 session receipt 单对话跑不了，附骨架供有 key 时跑** |

数据点：177 块 / 0 自测 -> 3 receipt（gzh 独立 rig + agent-chief 复现 + 本路由器）。注：177 块是作者完整 `rules/{common,python}` 的数；`corpus/` 是 13 个 common 文件快照（被路由的语料子集），扫它出的分布是 repo 语料的，非 177 全量。

---

## 与早期大纲的区别

- v2：「我做了 A4 度量闭环」（操作复盘，个人化）+「agent 规则系统处于前科学阶段，claim×receipt 让它可证伪」
- v3（旧）：核心升维到「减熵」--双做功两柱（结构性路由 + 证据性验证并列）
- **本版（v4）**：自指论证后收敛为**单核路由 + 其 receipt**--验证不是并列另一柱，是路由自身必须配的 receipt。路由器已建，P=0.451/R=0.917 是真实测出来的第一个 receipt，不是框架空谈。
