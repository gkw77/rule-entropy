# 规则系统的熵：给 AI agent 的规则装一个会自测的路由器

> **这不是又一篇文章，是一个能跑的东西。** 一个规则路由器（输入问题 -> 输出该用哪些规则 + 置信度 + 理由），加上它**给自己的 receipt**：一个测试集，跑出真实的 precision / recall。
>
> 状态：MVP（L0 关键词 + L1 语义判定，rule & skill 双语料已验，含 70->325 规模效应 + 规模悬崖修法 receipt）。clone 即跑。L0 零依赖；L1 复用终端 LLM 环境变量。

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
# L0 路由一个单题（零依赖）
node router/router.js "我的代码有SQL注入风险，怎么防"

# L1 语义路由单题（需终端 LLM 环境变量）
node router/l1.js "提交代码前要做哪些质量检查"

# 跑全测试集，出 L0 precision/recall receipt
node router/eval.js

# 跑 L1 评估，出 L1 receipt（对比 L0）
node router/eval-l1.js
```

L0 零依赖纯 Node。L1 需 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` 环境变量（火山方舟 ARK glm-5.2），key 不进代码。

## 第一个 receipt：L0 关键词层（真实数字，不 game）

L0 关键词路由器，18 题测试集，macro 指标（v2 multilabel 标注）：

| 阈值 | Precision | Recall | F1 |
|------|-----------|--------|------|
| 0.05 | 0.208 | **0.972** | 0.334 |
| **0.10** | **0.511** | **0.917** | **0.631** |
| 0.15 | 0.491 | 0.500 | 0.476 |
| 0.20 | 0.306 | 0.278 | 0.287 |
| 0.30 | 0.056 | 0.056 | 0.056 |

最佳 F1 在阈值 0.10：**P=0.511, R=0.917, F1=0.631**。

**诚实解读**（这本身就是 receipt 三分的示范--先测，不预设有效）：

- **Recall 91.7%**：正确的规则文件几乎总在候选集里。L0 关键词做"召回"很便宜。
- **Precision 51.1%**：每题多载 2-4 个交叉引用文件。`04-planning` 和 `06-verify` 是"什么都提一句"的枢纽文件，成为慢性误报；同形词（"提交"=质量门 vs =commit 格式）关键词层分不开。
- **1 题完全漏召回**："规则怎么验证有效"期望 `A4-rule-measurement`，但 query 词汇没命中 A4 的"度量/receipt"术语 -> L0 关键词层的天花板，语义判别要靠 L1。
- v1 single-label 标注时 P=0.451；重标成 multilabel（一到多合理多载）后 P=0.511--**标注低估了一到多**，这本身是个 receipt 发现。

这 51% 不是失败，是**测量本身**：它精确指出 L0 关键词层的边界--recall 便宜、precision 贵，同形词/枢纽文件是天花板。下一片切片（L1 语义判定）就该冲这个 precision 缺口。**没测之前不知道缺口在这**--这就是为什么路由需要 receipt。

## 第二个 receipt：L1 语义判定（冲 precision 缺口）

L1 在 L0 候选上逐条调便宜 LLM 判 yes/no（白盒带理由），过滤误报。复用终端环境变量（`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`，火山方舟 ARK glm-5.2），key 不进代码。

同测试集 18 题，L0 候选阈值 0.05（保 recall 让 L1 滤）：

| 层 | Precision | Recall | F1 |
|---|---|---|---|
| L0 baseline | 0.511 | 0.917 | 0.631 |
| **L1 LLM judge** | **0.620** | **0.944** | **0.700** |
| Δ | +0.109 | +0.027 | +0.069 |

**诚实解读**：

- **Precision +10.9 点**：语义过滤有效。典型案例--"commit message 格式" L0 同时命中 06-verify（提交质量门）和 07-output（commit 格式），L1 只留 07-output（reason：06-verify 核心是质量检查非格式）。同形词被语义判定分开。
- **Recall 不降反升 +2.7 点**：失败 fallback=yes（保守不滤，漏比多严重）起效；L1 没伤召回。
- **116 次 LLM 调用**，glm-5.2，成本可忽略。
- **但只有 5/18 全对**：precision 仍非 1.0，两个原因交织--(a) expected 标注偏窄（如"API key 硬编码" L1 载 01-security+06-verify+06a-security-audit 都沾边，但 expected 只标 01，这是一到多被低估，和 v2 同理）；(b) L1 部分真过载（LLM 对沾边即判 yes）。
- **设计限制**：L1 只在 L0 候选上判，无法补 L0 漏召回（那 1 题语义漏 L1 救不了）。这是"先 precision 过滤"切片；recall 补充（LLM 提名 L0 漏的）留后续。

L1 把 precision 从关键词层天花板（51%）推进到 62%，recall 不降反升--**语义层确实冲了缺口**。但 precision 的"真"天花板被 expected 标注宽度卡住：要公平评 L1 的"一到多"，测试集可能需再重标（像 v1->v2 那样）。这本身又是下一个 receipt 要回答的。

## 第三个 receipt：skill 语料 L1（跨语言，规模验证）

rule 语料（13 文件，中英混合标题）L0 缺口主要在 precision。但真实规模语料--作者的 70 个个人 skill（`~/.claude/` 下 1181 个 SKILL.md 文件、去重后 325 个真 skill 的子集，见第五个 receipt），description 多为英文--L0 撞上**语言墙**：中文 query 与英文 description 关键词零重叠，20 题里 10 题零匹配，L0 skill baseline 只有 P=0.304 / R=0.500 / F1=0.349。这是关键词层的天花板，正是 L1 跨语言该治的。

L1 skill 用**两阶段**：L0 有候选时逐个 judge（滤共享词误报，如 "PR review" L0 匹配 13 个含 review 的 skill）；L0 零匹配 / judge 滤完空时，单次 LLM 语义检索补召回（跨语言，给所有 skill 的 name+description 让 LLM 选）。同 20 题测试集：

| 层 | Precision | Recall | F1 |
|---|---|---|---|
| L0 skill baseline | 0.304 | 0.500 | 0.349 |
| **L1 skill（两阶段）** | **0.785** | **1.000** | **0.842** |
| Δ | +0.481 | +0.500 | +0.493 |

**诚实解读**：

- **Recall 0.500 -> 1.000**：L0 的 10 题跨语言零匹配被语义检索全救回。典型案例--"用无头浏览器打开网页" L0 零匹配（中文 vs 英文 description），L1 检索到 `browse`。**语言墙被 L1 跨语言彻底解决**，这是 L1 最大收益点。
- **Precision 0.304 -> 0.785**：共享词误报被 judge 过滤。如 "PR review" L0 匹配 13 个含 review 的 skill，L1 judge 只留核心相关的。
- **55 次 LLM 调用**（46 judge + 9 retrieve），成本极低。
- **14/20 全对**；6 题 precision<1 仍是"一到多多载沾边"（如 "写小说" L1 载 novel-writing+continuity-check，后者沾边）--recall 全 1.0，问题在 expected 标注偏窄（同一到多低估，和 rule 语料 v2 同理）。
- **两阶段是关键**：纯 precision 过滤（像 L1 rule 那样）救不了零匹配题；纯语义检索（每题全量判）太贵。两阶段--L0 候选先 judge，空了才检索--用 9 次检索救回 10 题零匹配，成本可控。

L1 在 skill 语料的收益（F1 +0.493）比 rule 语料（+0.069）大一个量级--因为 skill 语料的 L0 缺口（跨语言）正是 L1 语义层的强项。**这验证了 L1 的价值随语料规模 + 跨语言程度放大**：rule 语料（13 文件、中英标题）L0 还撑得住，skill 语料（70 个、英文 description）L0 撞墙，L1 才显出不可替代。

## 第四个 receipt：L1+recall 提名（证伪--此路不通）

L1 rule 只在 L0 候选上判，补不了 L0 漏召回（那 1 题"规则怎么验证有效"->A4 语义漏）。recall 切片试"LLM 看全部规则 descriptor 提名 L0 漏的，合并后再 L1 judge"。同 18 题：

| 层 | P | R | F1 |
|---|---|---|---|
| L1-only | 0.620 | 0.944 | 0.700 |
| L1+recall（提名） | 0.557 | 0.944 | 0.647 |
| Δ | -0.063 | 0 | -0.053 |

**证伪**：

- **recall 没涨**（0.944 不变）--LLM 提名没补回那 1 题语义漏（A4"度量/receipt"术语，LLM 提名也没提名 A4，或提名了被 judge 滤）。语义漏连 LLM 提名也难救。
- **precision 反降 0.063**--LLM 提名引入沾边规则，judge 没全滤掉。
- 134 调用（比 L1-only 116 多），F1 反降。

这是诚实的负 receipt：**recall 提名此路不通**。L0 的语义漏（关键词没命中的术语）不是"LLM 提名"能补的--提名依赖 LLM 理解 query 与规则 descriptor 的语义关联，而那 1 题的漏召回本质是 query 词汇与 A4 术语不重叠。对比 skill 语料的 semanticRetrieve（直接语义检索）成功了--rule 语料的 recall 或许也该用直接语义检索而非"先提名再 judge"。留后续。负 receipt 和正 receipt 一样重要：它划掉了死路。

## 第五个 receipt：规模效应（70 -> 325 skill，退化与覆盖）

前四个 receipt 都在 70 个个人 skill 上跑。真实环境是 `~/.claude/` 下 **1181 个 SKILL.md 文件**（记忆里记的"1143"是 `find` 原始计数）。但路由器按 skill **name** 索引，副本没用--扫全部 4 个源（个人 + gstack + marketplaces + cache，跟随符号链接）后按 name 去重，**真实唯一 skill = 325 个**（108 personal + 7 gstack + 193 marketplace + 17 cache）。"1181 -> 325"本身是 finding：gstack 的 `.agents`/`.cursor`/`.factory`/`.kiro`/`.openclaw` 等 8 套 agent 格式副本把同一些 skill 灌水了 3.6 倍。**顺手修了原 manifest 的 bug**：`isDirectory()` 漏掉符号链接 skill（caveman/diagnose 等 39 个），跟随符号链接后才收全。

**同一个 20 题测试集，语料从 70 涨到 325（4.6x distractor），路由器一行不改，看规模效应：**

| 语料\层 | L0 P | L0 R | L0 F1 | L1 P | L1 R | L1 F1 | L1 调用 |
|---|---|---|---|---|---|---|---|
| 70 skill | 0.304 | 0.500 | 0.349 | 0.785 | 1.000 | 0.842 | 55 |
| 325 skill | 0.250 | 0.250 | 0.250 | 0.497 | 0.850 | 0.580 | 208 |

**三段故事，都是 receipt：**

1. **L0 不 scale**（F1 0.349 -> 0.250，双降）。机制：distractor 涨 4.6x，共享词碰撞爆--"保存上下文"误中 `blueprint`/`architecture-decision-records`，"安全审查"误中 `flutter-dart-code-review`/`cpp-coding-standards`。precision 崩；为救 precision 提阈值到 0.25，又把真阳性滤掉，recall 跟着崩。低阈值 0.05 时 recall 其实 0.550（比 70 还高），但 precision 只剩 0.089--**L0 关键词层在规模下找不到可用的操作点**。

2. **L1 在规模下仍救 L0**（F1 0.250 -> 0.580，Δ+0.33），且 **L1-325(0.580) 仍 > L0-70(0.349)**--语义层的价值在 4.6x 规模仍存，没被规模抹平。

3. **但 L1 自身随规模退化**（0.842 -> 0.580，F1 -0.262）。两个 scale-sensitive 失效模式：
   - **precision 崩**：325 里有更多"堂兄弟"skill 被 judge 判 yes--`review` 多带 `springboot-verification`/`django-verification`，`QA` 多带 `ai-regression-testing`/`diagnose`，`make-pdf` 多带 `nutrient-document-processing`。judge"沾边即 yes"在小规模无伤（没那么多堂兄），大规模就放大。
   - **recall 漏 3 题**：`context-restore`/`benchmark` 被 judge 误判 yes 短路了 retrieve 兜底；`health` 的 retrieve 返回空。

**最关键的规模失效机制**：第三个 receipt 里 L1-70 的召回奇迹（R 0.500->1.000）靠的是 semanticRetrieve--而它只在 **L0 零匹配**时触发。70 skill 时 10/20 题零匹配（跨语言，中文 query vs 英文 description），全靠 retrieve 救回。**325 skill 时零匹配题 = 0**--更多 skill = 更多关键词重叠 = 每题都有（错误的）候选。于是跨语言题拿到错误候选走 judge，若 judge 对任一错候选判 yes，retrieve 兜底**永不触发**，真目标漏召回。**两阶段设计的救援路径依赖"零匹配"信号，而这个信号随规模消失**--这是规模悬崖。修法见下方第六个 receipt（已验证有效）。

**覆盖度 receipt（扩展的价值面）**：规模 receipt 多为负（退化），但扩展不是白做--325 能路由到 70-corpus 根本不索引的 marketplace skill。8 题中文 query 目标 marketplace/cache skill（claude-md-improver / build-mcp-server / accessibility / agent-eval / android-clean-architecture / architecture-decision-records / agent-payment-x402 / article-writing），70-corpus 上 recall=0 by definition（skill 不在索引），325 上 **L0 命中 7/8（recall 0.875）**，其中 5 个是 L0 rank=1 命中（accessibility / agent-eval / android-clean-architecture / architecture-decision-records / agent-payment-x402）。详见 `results/skills-l0-coverage.json`。

规模 receipt 的诚实结论：**两阶段 L1 在 4.6x 规模下优雅退化（仍胜 L0）但明显退化；零匹配救援路径是规模敏感的设计弱点。** 这不是"scale 就行"，是"scale 暴露了救援触发器的设计缺陷"--又一个没测之前不知道的 receipt 发现。

## 第六个 receipt：规模悬崖修法（always-retrieve-union，三轴全升）

第五个 receipt 发现规模悬崖：retrieve 只在 L0 零匹配时触发，325-scale 下零匹配消失 -> 救援不触发 -> 漏召回。先验证"低置信触发"假设--**证伪**：3 个漏召回题的 top confidence 是 0.310/0.212/0.458，不低，和成功题混在一起（browse 0.091 反而成功）。没有干净的置信阈值能分开它们。真正失效是 **judge 对错候选判 yes**（context-restore 被 continuous-agent-loop、benchmark 被 flutter-dart-code-review 拦下），retrieve 没机会触发。但 retrieve 在 325-scale 其实可靠（7 次触发 6 次找到目标）。

**修法**：retrieve 与零匹配信号**解耦**--每题都跑 retrieve，与 judge-yes 取并集。保证语义救援在规模下不死于"零匹配消失"。

| | P | R | F1 |
|---|---|---|---|
| L1-325（原，规模悬崖） | 0.497 | 0.850 | 0.580 |
| L1-325 always-retrieve-union（修法） | **0.577** | **1.000** | **0.673** |
| Δ | +0.080 | +0.150 | +0.093 |

**三轴全升**：
- **recall 完全恢复到 1.000**（追平 L1-70 的 1.000）--3 个漏召回题全救回：context-restore / benchmark / health 的 retrieve 都找到了目标（health 在第五个 receipt 里 retrieve 返回空，这里找到了--LLM 非确定性，但修法让它有第二次机会）。
- **precision 也升**（0.497->0.577）：retrieve prompt 要求"只选核心相关，别选仅沾边"，没加多少堂兄弟；而救回的 3 题各加 1 个 TP 拉高 precision。
- **F1 0.580->0.673**。

**省成本验证**：judge verdict 已存在 `l1-skills-full.json`（每题 judged 数组带 verdict），复用之，只新跑 20 次 retrieve（9K-token prompt 各一），不重跑 201 次 judge。诚实计数：完整跑 always-retrieve-union = 201 judge + 20 retrieve = 221 调用（vs L1-full 208，+13 调用、+~180K tokens）。325 规模下可接受；更大语料下 retrieve-every-query 本身有规模问题（每题塞全量 skill 进 prompt），那是下一个规模悬崖，留后续。

**修法的边界（诚实）**：修法修好 **recall 的规模悬崖**（R 1.000 追平 L1-70），但 **precision 仍随规模退化**（0.577 vs L1-70 的 0.785）--这是独立问题：325 里有更多堂兄弟 skill，judge"沾边即 yes"放大。修 recall 不修 precision。precision 的规模退化要靠更严的 judge（留后续）。详见 `results/l1-skills-scalefix.json`。

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
| L0 关键词（spine 文件级） | **已验**（P=0.511 / R=0.917，18 题） |
| L1 便宜 LLM 按描述分类 | **已验**（P=0.620 / R=0.944，18 题；冲 precision 缺口 +10.9 点，recall 不降反升） |
| facets 横切标签（security / parallel / ...） | 待验（设计，未建索引） |
| 退一格（叶子拿不准载父节点） | 待验（设计，未实现） |

按本项目立论"规则不验证 = 信仰"——上表"待验"三行目前是**设计信仰**，不是已验规则。L1 / 标签 / 退一格任一切片落地后，必须像 L0 一样配测试集跑 P/R 才算 receipt。**这是自指诚实：项目自己不能写得像验了却没验。**

## receipt 三分（复现 ≠ 证明有效）

最易被忽略、最易自欺。一个"验证了"分三种：

- **独立 rig**：你设计实验测规则的 claim -> 真 efficacy
- **复现 receipt**：你跑别人 demo 验引用数字为真 -> 验 citation，**不证明你的规则有效**
- **二手**：只引别人数字，没验 -> 信仰

举例：作者复现 agent-chief 的 96%/75%/70%（逐字吻合），但这只证明"agent-chief 的 demo 跑得出这些数"，**不证明**"我的 pipeline 用了值得性升级门就削减 75% LLM 调用"。后者需独立测。社区大量"我验证了 X 规则有效"实际只是复现了 X 的来源数字--**citation 验证被误当 efficacy 验证**。

**本 repo 的 L0 P=0.511/R=0.917、L1 P=0.620/R=0.944 是哪种？** 是第一种（独立 rig）--作者自己设计的测试集、自己跑自己的路由器、测的是"我的路由规则"的 efficacy，不是复现别人的数字。所以它是真 receipt，不是 citation 验证。这是本项目相对"复现别人 demo"的进阶：测的是自己的规则，不是别人的。

## claim × receipt 框架（让"该测哪些"可机器判定）

不是所有规则都需度量。分五类：

- `behavior`（方法论散文，N/A）--"先调研""分切片"，无需度量
- `secondhand`（引别人数字，需复现）--"dao-code 报 95.8% cache-hit"
- `selftested`（自测，需 N runs）--你自己跑过 rig
- `faith`（声称度量零 receipt）--"compact 在 40% 触发"但无来源无实测
- `claimNoMetric`（声称效果但无数字）--"防漂移"但没说降多少

只有 claim（声称度量改进）的规则才欠 evidence；behavior 不要求。这是"evidence 覆盖率"--像代码测试覆盖率，但针对规则。

**自指示范**：作者审自己的 177 个规则块，89% behavior（N/A），剩 ~19 metric-adjacent **全部 secondhand/faith，0 真自测**。建仪器后破 2 个 P0（gzh 双关卡独立 rig、agent-chief 数字复现），路由器是**第 3 个 receipt**--且是唯一测"自己规则"而非"别人数字"的那个。路由器自身现已积累 10 个独立 rig receipt（L0 baseline/v2/v3证伪、L1 rule、L1 skill、L1 recall证伪、L0+L1 规模效应、覆盖度、规模悬崖修法），正负皆有。

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
router/llm.js        L1 LLM judge：复用终端 env vars，judgeRelevance(query,rule) -> {verdict,reason}
router/l1.js         L1 路由：L0 候选 -> 逐个 LLM 判 -> 过滤误报
router/eval.js       L0 评估器：跑测试集 + 阈值扫描，输出 precision/recall receipt
router/eval-l1.js    L1 评估器：跑测试集，L0 候选 -> LLM 判 -> P/R/F1 对比 L0
router/l1-skills.js  L1 skill 路由（两阶段）：judge + 零匹配语义检索补召回
router/eval-l1-skills.js  L1 skill 评估器：两阶段对比 L0 skill baseline
router/l1-recall.js  L1+recall 路由（证伪切片）：LLM 提名 L0 漏的 + judge
router/eval-l1-recall.js  L1+recall 评估器：对比 L1-only（证伪）
router/gen-skills-manifest-full.js  扫全量 4 源（personal+gstack+marketplaces+cache，跟随符号链接）-> skills-corpus-full.json
router/eval-skills-full.js    L0 全量评估器：325 skill 上跑 L0（规模退化 receipt）
router/eval-l1-skills-full.js L1 全量评估器：325 skill 上跑两阶段 L1（规模效应 receipt）
router/eval-skills-coverage.js  L0 覆盖度评估器：8 题找 70-corpus 不存在的 marketplace skill（即时零成本，已跑）
router/eval-l1-skills-coverage.js  L1 覆盖度评估器（同上但走 L1；325 规模下 CLAUDE.md 类题候选过多，慢，未跑完）
router/eval-l1-skills-scalefix.js  规模悬崖修法评估器：always-retrieve-union（复用 L1-full judge verdict，只新跑 20 次 retrieve）
skills-corpus.json       70 个个人 skill manifest（baseline）
skills-corpus-full.json  325 个去重 skill manifest（1181 raw -> 325 unique，带 source 字段）
testset.json         18 题 (query, expected) 测试集（rule 语料）
testset-skills.json  20 题 skill 测试集
testset-skills-scale.json  8 题覆盖度测试集（目标 marketplace skill）
results/             receipt 归档（l0-v2-multilabel.json / l1-llm.json / skills-l0-full.json / l1-skills-full.json / ...）
```

路由器设计：描述符从 H1/H2/H3 标题 + `**bold**` 术语 + 正文抽（位置加权 H1=3/H2=2/正文=1），CJK 走 bigram 不依赖分词库，打分 = 带 IDF 的加权查询覆盖率，白盒可解释（每题明细打印命中 token）。

## 待续

- [x] **L1 切片**：LLM 语义判定过滤 L0 候选，冲 precision 缺口（51% -> 62%，recall 不降反升 92% -> 94%）。见上方第二个 receipt
- [x] **L1 skill 语料切片**：两阶段（judge + 语义检索）在 70 skill 上验跨语言，F1 0.349 -> 0.842（recall 0.500 -> 1.000）。见上方第三个 receipt
- [x] **L1+recall 提名切片（证伪）**：LLM 提名补 L0 漏召回，recall 没涨（0.944 不变）precision 反降，此路不通。见上方第四个 receipt
- [x] **规模效应切片**：skill 语料 70 -> 325（4.6x），L0 不 scale（F1 0.349->0.250），L1 仍救 L0（0.250->0.580）但自身退化（0.842->0.580）；零匹配救援路径随规模消失是规模悬崖。见上方第五个 receipt
- [x] **规模救援触发器重设计**：retrieve 与零匹配解耦（always-retrieve-union），R 0.850->1.000 追平 L1-70，P 也升 0.497->0.577。见上方第六个 receipt
- [ ] **judge 沾边问题**：试更严的 judge prompt 或两段 judge（先沾边再核心）治规模下 precision 退化（0.577 vs L1-70 的 0.785，独立于 recall 悬崖）
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
- **本版（v4）**：自指论证后收敛为**单核路由 + 其 receipt**--验证不是并列另一柱，是路由自身必须配的 receipt。路由器已建，L0 P=0.511/R=0.917、L1 P=0.620/R=0.944 是真实测出来的 receipt，不是框架空谈。
