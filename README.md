# 规则系统的熵：给 AI agent 的规则装一个会自测的路由器

> 输入问题 -> 输出该用哪些规则 + 置信度 + 理由，加上它**给自己的 receipt**：一个测试集，跑出真实的 precision / recall。clone 即跑，L0 零依赖。

## TL;DR

```bash
git clone https://github.com/gkw77/rule-entropy.git && cd rule-entropy
node router/router.js "我的代码有SQL注入风险，怎么防"   # -> 输出该用哪些规则 + 置信度 + 理由
```

## 用它能干什么

1. **路由**--问题来了只载相关规则，不全量载入。作者自己的 13 个规则文件 ~60KB 默认每 session 全塞进 context，路由后只载相关的 1-3 个。治 context-bloat。
2. **自测**--路由准不准有 P/R 数字，不是"感觉对"。L0 关键词层 P=0.51 / R=0.92，L1 语义层 P=0.62 / R=0.94。路由规则也是规则，按"规则不验证 = 信仰"的立场它必须被测。
3. **去重**--给 skill 评分 + 找语义重复，识别赘余该合并。325 个 skill 里 22 个冗余该合并、3 个破损该删。

三个都配 receipt（真实数字），不是框架空谈。

## 跑起来（30 秒）

```bash
git clone https://github.com/gkw77/rule-entropy.git
cd rule-entropy
node router/router.js "我的代码有SQL注入风险，怎么防"        # L0 路由单题（零依赖）
node router/l1.js "提交代码前要做哪些质量检查"                # L1 语义路由（需 LLM env）
node router/eval.js                                           # 跑全测试集出 L0 P/R receipt
node router/eval-l1.js                                        # L1 receipt（对比 L0）
```

L0 零依赖纯 Node。L1 需 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`（火山方舟 ARK glm-5.2），key 不进代码。

## 一句话核心

给 AI agent 写的规则（CLAUDE.md / AGENTS.md / skills）会**自发熵增**：只增不减、互相抄、模型升级后过期、蚕食 context 窗口。减熵要做功。这个 repo 的做功是**路由**--问题来了筛相关规则不全量载入；而路由规则本身也是规则，按立场它**必须被验证**，所以路由器自带测试集跑 P/R = 它的 receipt。

## 熵增定律（核心类比）

热力学第二定律：孤立系统熵自发增不减。agent 规则系统正是"孤立"的--没人验、没人删、没人重测，只增不减越来越乱。**减熵必须从外部做功。**

表现（大家都有的痛点）：人人写规则往里堆没人测；规则吃 context（每条 ~500 token，30 条吃 7.5% 窗口）+ 上下文腐烂（40% 使用率进笨区）+ 互相冲突；死循环（规则越多 -> context 越挤 -> agent 越笨 -> 加更多规则补救 -> 更挤），且没人能定位哪条规则在帮忙、哪条在添乱。

三个面：**信仰传递**（A 引 B 数字，B 引 C，源头不验，一个错误"最佳实践"传遍全网）、**过期医嘱**（规则针对某模型版本写，升级后失效甚至反效，没人重测）、**投入错位**（社区拼命换更强模型堆更多规则，却很少投验证门；但 TestSprite 公开 leaderboard：最便宜模型 + 验证 CLI in-loop > 贵模型裸跑）。

## 减熵做功：路由（这个 repo 做的）

> 治组合爆炸 + context-bloat。问题来了，用树 + 标签筛出相关规则，不全量载入。

**现状审计**（作者自己的文件）：`common/`（13 文件 ~60KB）**零筛选**，harness 每 session 全量自动载入（无 paths、无 @import），最大最熵高；`python/`（5 文件）`paths:` 文件 glob 懒载，唯一真在筛的层但触发是文件类型非语义；skills frontmatter 渐进披露最精。缺口：`common/` 上没有语义路由原语。

**路由架构**（设计，部分已验）：spine（主干树，MECE，阶段 01-07，`00-pipeline.md` 是树根）+ facets（横切标签 security/parallel/...）并集不漏；谓词必须便宜可观测（frontmatter/路径/关键词），不能要加载全文才判；准确率瓶颈在描述符（非分类器），机制 = L0 关键词秒配 -> L1 便宜 LLM 按描述分类（仅歧义时）；过载边界"退一格载粗的"（叶子拿不准载父节点），树 ~3 层封顶。

| 层 | 状态 |
|---|---|
| L0 关键词（文件级） | **已验**（P=0.511 / R=0.917，18 题） |
| L1 便宜 LLM 按描述分类 | **已验**（P=0.620 / R=0.944，冲 precision +10.9 点，recall 不降反升） |
| facets 横切标签 | 待验（设计，未建索引） |
| 退一格 | 待验（设计，未实现） |

诚实：facets / 退一格是**设计信仰**，不是已验规则。按立论"规则不验证 = 信仰"，它们落地后必须像 L0 一样配测试集跑 P/R 才算 receipt。

## 自指：路由器拿自己开刀

1. 文章立论：规则不验证 = 信仰。
2. 路由规则（"什么问题用什么规则"）也是规则。
3. 按立场，路由规则必须验证。
4. 建测试集跑 P/R = **给路由装 receipt**。

项目从"路由 + 验证双做功"收敛为**单核路由 + 其 receipt**--验证不是并列另一柱，是路由自身必须配的 receipt。路由器扫的语料是作者自己的 13 个规则文件（`corpus/`，快照自 `~/.claude/rules/common/`）--建仪器测仪器自身。

## receipts（真实数字，不 game）

### 1. L0 关键词层（rule 语料，18 题）

| 阈值 | P | R | F1 |
|---|---|---|---|
| **0.10** | **0.511** | **0.917** | **0.631** |

recall 便宜（91.7%），precision 贵（51.1%）--枢纽文件（`04-planning`/`06-verify` 什么都提一句）+ 同形词（"提交"= 质量门 vs = commit 格式）是关键词层天花板。1 题语义漏（"规则怎么验证有效"没命中 A4 的"度量/receipt"术语）。**没测之前不知道缺口在这**--这就是路由需要 receipt。

### 2. L1 语义判定（冲 precision 缺口）

| 层 | P | R | F1 |
|---|---|---|---|
| L0 baseline | 0.511 | 0.917 | 0.631 |
| **L1 LLM judge** | **0.620** | **0.944** | **0.700** |

L0 候选上逐条调便宜 LLM 判 yes/no（白盒带理由）。precision +10.9 点--同形词被语义分开（commit 格式 L0 命中 06+07，L1 只留 07）。recall 不降反升（失败 fallback=yes，保守不滤）。116 次 LLM 调用。限制：L1 只在 L0 候选上判，补不了 L0 漏召回。

### 3. skill 语料 L1（跨语言，规模验证）

真实规模 skill 语料（作者 70 个个人 skill，description 多为英文）L0 撞**语言墙**：中文 query vs 英文 description 关键词零重叠，20 题里 10 题零匹配，L0 skill baseline 只有 P=0.304 / R=0.500 / F1=0.349。L1 两阶段（L0 候选 judge 滤共享词 + 零匹配时 LLM 语义检索补召回）：

| 层 | P | R | F1 |
|---|---|---|---|
| L0 skill | 0.304 | 0.500 | 0.349 |
| **L1 skill（两阶段）** | **0.785** | **1.000** | **0.842** |

recall 0.500 -> 1.000（10 题跨语言零匹配全救回，语言墙被 L1 彻底解决--L1 最大收益点）；precision 0.304 -> 0.785（"PR review" L0 匹配 13 个含 review 的 skill，L1 judge 只留核心相关）。55 调用。**L1 价值随语料规模 + 跨语言程度放大**：rule 语料 L0 还撑得住，skill 语料 L0 撞墙，L1 才显不可替代。

### 4. L1 + recall 提名（证伪--此路不通）

| 层 | P | R | F1 |
|---|---|---|---|
| L1-only | 0.620 | 0.944 | 0.700 |
| L1 + recall（提名） | 0.557 | 0.944 | 0.647 |

LLM 提名 L0 漏的候选再 judge，想补 recall。结果 recall 没涨（那 1 题语义漏 LLM 提名也没救回），precision 反降（提名引入沾边 judge 没全滤）。**recall 提名此路不通**。负 receipt 和正 receipt 一样重要：它划掉死路。对比 skill 语料的直接语义检索成功--rule 语料的 recall 或许也该用直接语义检索而非"先提名再 judge"。

### 5. 规模效应（70 -> 325 skill，退化与覆盖）

`~/.claude/` 下 1181 个 SKILL.md 按 name 去重 = **325 个真 skill**（gstack 的 `.agents`/`.cursor`/`.factory` 等 8 套 agent 格式副本把同一些 skill 灌水 3.6x；早期记的"1143"是 `find` 原始计数）。顺手修了 manifest bug：`isDirectory()` 漏掉符号链接 skill 39 个。同 20 题，语料 4.6x distractor，路由器一行不改：

| 语料 \ 层 | L0 F1 | L1 F1 | L1 调用 |
|---|---|---|---|
| 70 skill | 0.349 | 0.842 | 55 |
| 325 skill | 0.250 | 0.580 | 208 |

- **L0 不 scale**（F1 0.349 -> 0.250，双降）：distractor 涨 4.6x，共享词碰撞爆（"保存上下文"误中 `blueprint`，"安全审查"误中 `flutter-dart-code-review`）。提阈值救 precision 又杀 recall，找不到可用操作点。
- **L1 在规模下仍救 L0**（0.250 -> 0.580），且 L1-325(0.580) > L0-70(0.349)--语义层价值在规模仍存。
- **但 L1 自身随规模退化**（0.842 -> 0.580）：judge"沾边即 yes"放大（325 堂兄弟多），且 recall 漏 3 题。
- **规模悬崖（核心失效机制）**：L1-70 召回奇迹靠 retrieve 只在 L0 零匹配时触发；325 时零匹配题 = 0（更多 skill = 更多关键词重叠 = 每题都有错候选），跨语言题拿错候选走 judge，judge 对任一错候选判 yes 则 retrieve 永不触发 -> 真目标漏。**两阶段救援路径依赖"零匹配"信号，该信号随规模消失**。
- **覆盖度 receipt（正面）**：325 能路由到 70-corpus 根本不索引的 marketplace skill。8 题中文 query 目标 marketplace/cache skill，325 上 L0 命中 7/8（5 个 rank=1）。

### 6. 规模悬崖修法（always-retrieve-union，三轴全升）

retrieve 与零匹配信号**解耦**--每题都跑 retrieve，与 judge-yes 取并集，保证语义救援在规模下不死于"零匹配消失"。

| | P | R | F1 |
|---|---|---|---|
| L1-325（规模悬崖） | 0.497 | 0.850 | 0.580 |
| + always-retrieve-union | **0.577** | **1.000** | **0.673** |

recall 追平 L1-70（1.000），3 个漏召回题全救回；precision 也升（retrieve prompt 要求"只选核心相关"）。省成本：复用已存的 judge verdict，只新跑 20 次 retrieve。边界：修好 recall 悬崖，但 precision 仍随规模退化（独立问题，见 8）。

### 7. skill 评分 + 语义去重（赘余性减熵）

路由是**结构性减熵**（不全载）；评分 + 去重是**赘余性减熵**（剪重复低质）。第二条做功。

- **评分（零 LLM）**：325 skill 三维分（0.45 完整性 + 0.40 独特性 + 0.15 新鲜度）。只 3/325 真·破损（无描述），其余 0.6-1.0。IDF-独特性只抓破损，抓不到语义重复 -> 需去重。freshness 本快照不区分（全 2026-04~06 安装时间）。
- **语义去重（LLM 关 thinking 一次性分组）**：18 组 / 32 冗余(9.8%)。但 LLM 会过并（office-hours 组把 4 个不同 skill + openclaw 变体并成 8 元组，应 4 个二元组）--receipt 非权威需人审。
- **逐对确认（pairwise dup-judge）**：粗分组 + 每对 judge 修过并 -> 16 组 / 22 冗余(6.8%)。office-hours 8 元组正确散成 4 二元组。22 个冗余现在是高置信剪枝候选。

边界（augment-not-automate）：只识别候选（receipt），不自动剪 `~/.claude`（破坏性交人拍板）。

### 8. precision 规模退化修法（严 judge）

| | P | R | F1 |
|---|---|---|---|
| scalefix（recall 修后，precision 未修） | 0.577 | 1.000 | 0.673 |
| + 严 judge | **0.650** | **1.000** | **0.736** |
| （参照 L1-70） | 0.785 | 1.000 | 0.842 |

更严的 judge--只对"直接要用的核心工具 / 近义重复"判 yes，沾边判 no（宁可漏判 no，不可沾边 yes）。recall 全守，precision +7.3 点。**部分修复**：review 题严 judge 仍对 7 个判 yes（近亲难分）。剩余 gap（0.650 vs 0.785）是规模下堂兄弟更多、judge 难全分的**不可消惩罚**。

**325-scale 完整故事**：scalefix 修 recall 悬崖（0.850 -> 1.000）+ 严 judge 修 precision（0.497 -> 0.650），F1 0.580 -> 0.736，逼近但未达 L1-70 的 0.842。规模退化两半各有修法、各有边界。

### 9. 同类项两两合并（无损减熵，替代剔除）

直接剔丢信息（被删的可能有 canonical 没的内容）。改**两两合并**（取并集，count 减少信息不丢）--减熵不是删，是合并同类项降冗余（无损）。对 16 组确认重复，每组两两 LLM 合并 description + triggers 并集，保留 canonical 名：

**38 skill -> 16 合并 skill**（22 冗余无损并入 canonical，22 次合并调用）。3 个真·破损（无描述）才该删。边界：只合并 frontmatter（description + triggers），body 合并未做（正文长且结构化，需人判），部署（写合并 SKILL.md 到 `~/.claude`）破坏性交人。

---

路由器自身现已积累 **14 个独立 rig receipt**（L0 baseline / v2 / v3 证伪、L1 rule、L1 skill、L1 recall 证伪、L0+L1 规模效应、覆盖度、规模悬崖修法、skill 评分、skill 语义去重、去重逐对确认、precision 规模退化修法、同类项两两合并），正负皆有。

## receipt 三分（复现 ≠ 证明有效）

最易被忽略、最易自欺。一个"验证了"分三种：

- **独立 rig**：你设计实验测规则的 claim -> 真 efficacy
- **复现 receipt**：你跑别人 demo 验引用数字为真 -> 验 citation，**不证明你的规则有效**
- **二手**：只引别人数字，没验 -> 信仰

举例：作者复现 agent-chief 的 96%/75%/70%（逐字吻合），但这只证明"agent-chief 的 demo 跑得出这些数"，**不证明**"我的 pipeline 用了值得性升级门就削减 75% LLM 调用"。后者需独立测。社区大量"我验证了 X 规则有效"实际只是复现了 X 的来源数字--**citation 验证被误当 efficacy 验证**。

本 repo 的 L0 / L1 P/R 是第一种（独立 rig）--作者自己设计测试集、自己跑自己的路由器、测的是"我的路由规则"的 efficacy，不是复现别人的数字。这是相对"复现别人 demo"的进阶：测的是自己的规则，不是别人的。

## claim × receipt 框架（让"该测哪些"可机器判定）

不是所有规则都需度量。分五类：

- `behavior`（方法论散文，N/A）--"先调研""分切片"，无需度量
- `secondhand`（引别人数字，需复现）--"dao-code 报 95.8% cache-hit"
- `selftested`（自测，需 N runs）--你自己跑过 rig
- `faith`（声称度量零 receipt）--"compact 在 40% 触发"但无来源无实测
- `claimNoMetric`（声称效果但无数字）--"防漂移"但没说降多少

只有 claim（声称度量改进）的规则才欠 evidence；behavior 不要求。这是"evidence 覆盖率"--像代码测试覆盖率，但针对规则。

**自指示范**：作者审自己的 177 个规则块，89% behavior（N/A），剩 ~19 metric-adjacent **全部 secondhand/faith，0 真自测**。建仪器后破 2 个 P0（gzh 双关卡独立 rig、agent-chief 数字复现），路由器是第 3 个--且是唯一测"自己规则"而非"别人数字"的那个。

## 验证 > 模型规模（投入重定向）

TestSprite 数据点 + exploitarium 安全 fuzzing 实证：非 SOTA 模型 + 严工作流 + 验证门 = 出真活。ROI：加一道验证门的收益 > 换更强模型。没钱上 Opus 时，便宜模型 + 严格 maker-checker / Stop-Condition 门 > 贵模型裸跑。这把"规则度量"从"锦上添花"重定位为"模型规模替代品"。

## 给读者的可迁移 take

1. 扫一眼你的 CLAUDE.md：多少条是"引别人数字"或"纯行为纪律"？跑 claim × receipt 分类
2. 只有声称度量改进的规则才欠 evidence，方法论散文不欠
3. **复现别人数字 ≠ 证明你的规则有效**，分清 citation 验证 vs efficacy 验证（最易自欺）
4. 加验证门的 ROI > 换更强模型；规则度量是模型规模替代品
5. 规则越多越笨时，先别加规则--先路由（筛掉不相关的）再验证（判剩下的真假）
6. 任何路由 / 分类器都是规则，都该配测试集。没测过的路由 = 信仰路由

## 仓库结构

```
corpus/              13 个规则文件（快照自 ~/.claude/rules/common/，被路由的语料）
router/router.js     L0 关键词路由器：建带权倒排索引，route(query) -> matched + loaded
router/llm.js        L1 LLM judge：复用终端 env vars，judgeRelevance(query,rule) -> {verdict,reason}
router/l1.js         L1 路由：L0 候选 -> 逐个 LLM 判 -> 过滤误报
router/eval.js       L0 评估器：测试集 + 阈值扫描 -> P/R receipt
router/eval-l1.js    L1 评估器：对比 L0
results/             receipt 归档（l0-v2-multilabel.json / l1-llm.json / skills-l0-full.json / ...）
reproducible/        可复现素材（见下）
```

其余 `router/*.js` 是各 receipt 的评估器 / 脚本（`l1-skills` / `eval-skills-full` / `skill-scorer` / `skill-dedup` / `skill-merge` 等），对应上方 receipt 段，详见 `results/`。

路由器设计：描述符从 H1/H2/H3 标题 + `**bold**` 术语 + 正文抽（位置加权 H1=3 / H2=2 / 正文=1），CJK 走 bigram 不依赖分词库，打分 = 带 IDF 的加权查询覆盖率，白盒可解释（每题明细打印命中 token）。

## 待续

- [ ] **body 合并 + 部署**：frontmatter 合并已做，SKILL.md 正文合并 + 写入 `~/.claude` 替换原 skill（破坏性，需人判）
- [ ] **ownership 标签**：给枢纽文件（04-planning / 06-verify）标"owns X / references X"，让"提到"和"拥有"可区分
- [ ] **facets 标签**：security / parallel / subagent / ctx-stress 横切索引，测横跨多阶段 query
- [ ] **退一格**：叶子拿不准载父节点（00-pipeline 作树根）
- [ ] **security tag 写穷触发面**（BuilderIO 金标准 ~15 场景），验 L0 秒配的具体起手
- [ ] 扩测试集到 30-50 题，跨 session 复验（single-shot 高估，agentic 下常缩水）

## 可复现素材（reproducible/）

不是"可附"--已经附在 repo 里，clone 即跑。立论说"可复现"，素材就得在 repo，否则自打脸。

| 路径 | 是什么 | 怎么跑 |
|---|---|---|
| `reproducible/rule-evidence-audit.js` | claim × receipt 五分类器，扫规则出 evidence 分布 | `node reproducible/rule-evidence-audit.js corpus .`（扫本 repo 的 13 个规则快照）；扫你自己的规则：`node reproducible/rule-evidence-audit.js ~/.claude/rules "common,python"` |
| `reproducible/gzh-rig/` | 独立 rig 示范，19 缺陷测双关卡 vs 单关卡 | `cd reproducible/gzh-rig && python rig.py`（纯 stdlib，自包含，无需外部依赖） |
| `reproducible/dao-cache-rig.py` | 跨 session 骨架示范（缓存稳定性 A/B） | 需 `pip install anthropic` + `ANTHROPIC_API_KEY`--跨 session receipt 单对话跑不了，附骨架供有 key 时跑 |

数据点：177 块 / 0 自测 -> 3 个 P0 receipt（gzh 独立 rig + agent-chief 复现 + 本路由器初始；路由器后续累积到 14 个，见上 receipts 段）。注：177 块是作者完整 `rules/{common,python}` 的数；`corpus/` 是 13 个 common 文件快照（被路由的语料子集），扫它出的分布是 repo 语料的，非 177 全量。
