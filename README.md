# Rule Entropy: How many of your CLAUDE.md rules are just faith?

> 中文文档见 [README.zh.md](README.zh.md)
>
> Every session your agent stuffs the entire CLAUDE.md / skills into context. Rules pile up, the agent gets dumber, and nobody knows which rule is actually helping vs. which is just "feels right" faith. The author turned the tool on his own rules: scanned 167 rule blocks - **87% are behavior rules that state no metric at all; of the 22 that claim some effect, 5 have ever been tested**. The tool is included; clone and run it on your own rules.

## 30 seconds: scan your own rules, see how many are "faith"

```bash
git clone https://github.com/gkw77/rule-entropy.git && cd rule-entropy
node reproducible/rule-evidence-audit.js corpus .                          # scan the repo's 13 rule snapshots, zero deps
node reproducible/rule-evidence-audit.js ~/.claude/rules "common,python"   # scan your own rules
```

Real output on this repo's own 13 rule snapshots (trimmed to the summary block; the full run also lists every flagged block):

```json
{
  "summary": { "total": 167, "behavior_NA": 145, "behaviorPct": 87,
               "claimNoMetric": 12, "selftested_partial": 5,
               "secondhand_needsRepro": 4, "faith_unmeasured": 1 },
  "gate": { "errors": 0, "warnings": 1, "info": 2 }
}
```

Each rule block gets an evidence verdict: `behavior_NA` (behavior rule, no metric claimed) / `claimNoMetric` (states an effect, never says by how much) / `faith` (asserts a number, no source) / `secondhand_needsRepro` (cites someone else's number, never reproduced) / `selftested_partial` (has a self-test). Most of your blocks will land in the first two - that's rule entropy: unverified, it only grows.

## What it does

1. **Routing** - on a query, load only the relevant rules, not all of them. The author's own 13 rule files (~60KB) get auto-loaded in full every session by default; after routing, only the 1-3 relevant ones load. Fixes context bloat.
2. **Self-testing** - routing accuracy has real P/R numbers, not "feels right". Rule corpus: L0 P=0.511 -> L1 P=0.648 -> strict-judge P=0.861; skill corpus: L0 P=0.30 -> L1 P=0.785 / R=1.0 (cross-language rescue). Routing rules are rules too - by "unverified rule = faith" they must be tested.
3. **Dedup** - score skills + find semantic duplicates, flag redundancy to merge. Of 325 skills, 22 are redundant (should merge), 3 are broken (should delete).

All three come with receipts (real numbers), not framework hand-waving.

## Run the router

```bash
git clone https://github.com/gkw77/rule-entropy.git
cd rule-entropy
node router/router.js "首次编辑文件前要先调查什么"        # L0 single-query routing (zero deps) -> loads 05-execute
node router/l1.js "提交代码前要做哪些质量检查"                # L1 semantic routing (needs LLM env)
node router/eval.js                                           # full test set -> L0 P/R receipt
node router/eval-l1.js                                        # L1 receipt (vs L0)
```

L0 is zero-dependency pure Node. L1 needs `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` (Volcano Ark ARK glm-5.2); the key never enters code.

## Core thesis

Rules written for AI agents (CLAUDE.md / AGENTS.md / skills) **spontaneously increase in entropy**: they only grow, copy each other, expire after model upgrades, and eat the context window. Reducing entropy takes work. This repo's work is **routing** - on a query, filter to the relevant rules instead of loading everything. And the routing rules are themselves rules - by the thesis they **must be verified** - so the router ships with a test set and reports P/R = its receipt.

## The entropy law (core analogy)

Second law of thermodynamics: an isolated system's entropy increases spontaneously. An agent ruleset is exactly "isolated" - nobody verifies, nobody deletes, nobody re-tests - so it only grows and rots. **Reducing entropy requires work from outside.**

Symptoms (pain points everyone has): everyone writes rules and piles them in, nobody tests; rules eat context (~500 tokens each, 30 rules eat 7.5% of the window) + context rot (above 40% usage you enter the "dumb zone") + mutual conflict; a death spiral (more rules -> tighter context -> dumber agent -> add more rules to compensate -> tighter still), and nobody can locate which rule is helping vs. hurting.

Three faces: **faith transmission** (A cites B's number, B cites C, the source is never verified, one wrong "best practice" spreads across the net), **expired prescriptions** (rules written for a model version expire or backfire after an upgrade, nobody re-tests), **misallocated investment** (the community scrambles for stronger models and more rules, rarely invests in verification gates; but TestSprite's public leaderboard: cheapest model + verification CLI in-loop > expensive model raw).

## Entropy reduction via routing (what this repo does)

> Fixes combinatorial explosion + context bloat. On a query, use a tree + tags to filter relevant rules, not load all.

**Status audit** (author's own files): `common/` (13 files, ~60KB) has **zero filtering** - the harness auto-loads it in full every session (no paths, no @import), the biggest, highest-entropy layer; `python/` (5 files) uses `paths:` file-glob lazy loading - the only layer actually filtering, but triggered by file type not semantics; skills use frontmatter progressive disclosure, the leanest. Gap: no semantic routing primitive over `common/`.

**Routing architecture** (design, partially verified): spine (a tree, MECE, stages 01-07, `00-pipeline.md` is the root) + facets (cross-cutting tags security/parallel/...) union so nothing is missed; predicates must be cheap observable (frontmatter/path/keyword), not require loading full text; the accuracy bottleneck is the descriptor (not the classifier), the mechanism = L0 keyword instant match -> L1 cheap LLM classifies by description (only when ambiguous); overload boundary "back off one level to the coarser" (if a leaf is uncertain, load the parent), tree capped at ~3 levels.

| Layer | Status |
|---|---|
| L0 keyword (file-level) | **verified** (P=0.511 / R=0.917, 18 queries) |
| L1 cheap LLM by description | **verified** (P=0.620 / R=0.944, +10.9 pts precision, recall up not down) |
| facets cross-cutting tags | **verified·falsified** (triple: naive L0 F1≤L0 / downweighted L0 F1≤L0 / L1+facets Δ≈0; mechanism right but tag-coarse + judge-misjudge double-bind) |
| ownership (owns/refs differential) | **verified·holds** (facets variant that beats L0: F1 0.695->0.820, owns high/refs low breaks the all-pass-or-all-filter trap; see receipt 17) |
| backoff | **verified·holds** (single-level: fuzzy queries back off to root F1 0.347->0.931; multi-level: corpus extended with L2, back off to stage-parent, see receipt 13) |

Note: facets / backoff were **design faith**, now landed with test sets and P/R (see receipts 10/11). facets naive impl falsified (tag substring matching coarsely pulls tangential files); backoff holds (top-conf signal is clean + backs off to only the root file). ownership (receipt 17) is the facets variant that holds: owns/refs differential beats L0 where uniform facets was net-negative. By the thesis "unverified rule = faith", they got upgraded from faith to receipt (two positive, one negative).

## Self-reference: the router turns on itself

1. Thesis: unverified rule = faith.
2. Routing rules ("which rule for which query") are rules.
3. By the thesis, routing rules must be verified.
4. Build a test set, run P/R = **give the router a receipt**.

The project converged from "routing + verification, two kinds of work" to **single-core routing + its receipt** - verification isn't a parallel pillar, it's the receipt routing itself must carry. The corpus the router scans is the author's own 13 rule files (`corpus/`, snapshotted from `~/.claude/rules/common/`) - building an instrument to measure the instrument.

## receipts (real numbers)

### 1. L0 keyword layer (rule corpus, 18 queries)

| threshold | P | R | F1 |
|---|---|---|---|
| **0.10** | **0.511** | **0.917** | **0.631** |

Recall is cheap (91.7%), precision is expensive (51.1%) - hub files (`04-planning` / `06-verify` mention everything once) + homographs ("提交" = quality gate vs = commit format) are the keyword-layer ceiling. 1 query missed on semantics ("how to verify a rule is effective" didn't hit A4's "metric/receipt" terms). **Before testing, I didn't know the gap was here** - that's why routing needs a receipt.

### 2. L1 semantic judgment (attacks the precision gap)

| Layer | P | R | F1 |
|---|---|---|---|
| L0 baseline | 0.511 | 0.917 | 0.631 |
| **L1 LLM judge** | **0.620** | **0.944** | **0.700** |

On L0 candidates, call a cheap LLM per rule for yes/no (white-box, with reason). Precision +10.9 pts - homographs separated by semantics (commit format: L0 hits 06+07, L1 keeps only 07). Recall up not down (failure fallback = yes, conservative, don't filter). 116 LLM calls. Limitation: L1 only judges L0 candidates, can't fix L0's recall misses.

### 3. Skill corpus L1 (cross-language, scale test)

Real-scale skill corpus (author's 70 personal skills, descriptions mostly English) - L0 hits the **language wall**: Chinese query vs English description, zero keyword overlap, 10 of 20 queries get zero matches, L0 skill baseline only P=0.304 / R=0.500 / F1=0.349. L1 two-stage (L0 candidates judge-filtered for shared words + LLM semantic retrieval to fill recall when zero-match):

| Layer | P | R | F1 |
|---|---|---|---|
| L0 skill | 0.304 | 0.500 | 0.349 |
| **L1 skill (two-stage)** | **0.785** | **1.000** | **0.842** |

Recall 0.500 -> 1.000 (all 10 cross-language zero-match queries rescued, language wall broken by L1 - L1's biggest gain); precision 0.304 -> 0.785 ("PR review" L0 matches 13 skills containing "review", L1 judge keeps only core-relevant). 55 calls. **L1's value scales with corpus size + cross-language degree**: rule corpus L0 still holds up, skill corpus L0 hits the wall, only then L1 is irreplaceable.

### 4. L1 + recall nomination (falsified - dead end)

| Layer | P | R | F1 |
|---|---|---|---|
| L1-only | 0.620 | 0.944 | 0.700 |
| L1 + recall (nomination) | 0.557 | 0.944 | 0.647 |

LLM nominates L0-missed candidates then judges them, trying to fix recall. Result: recall didn't rise (that 1 semantic miss, LLM nomination didn't rescue either), precision dropped (nomination pulls in tangential, judge doesn't fully filter). **Recall nomination is a dead end.** A negative receipt matters as much as a positive one: it strikes a path. Contrast the skill corpus's direct semantic retrieval succeeding - rule corpus recall probably also needs direct semantic retrieval, not "nominate then judge".

### 5. Scale effect (70 -> 325 skills, degradation and coverage)

Under `~/.claude/`, 1181 SKILL.md files deduped by name = **325 real skills** (gstack's `.agents` / `.cursor` / `.factory` etc. - 8 agent-format copies inflate the same skills 3.6x; the earlier "1143" was a raw `find` count). Fixed a manifest bug along the way: `isDirectory()` missed 39 symlinked skills. Same 20 queries, corpus 4.6x distractors, router unchanged:

| Corpus \ Layer | L0 F1 | L1 F1 | L1 calls |
|---|---|---|---|
| 70 skills | 0.349 | 0.842 | 55 |
| 325 skills | 0.250 | 0.580 | 208 |

- **L0 doesn't scale** (F1 0.349 -> 0.250, both drop): distractors up 4.6x, shared-word collisions explode ("保存上下文" wrongly hits `blueprint`, "安全审查" hits `flutter-dart-code-review`). Raising threshold saves precision but kills recall - no usable operating point.
- **L1 still rescues L0 at scale** (0.250 -> 0.580), and L1-325(0.580) > L0-70(0.349) - the semantic layer's value persists at scale.
- **But L1 itself degrades with scale** (0.842 -> 0.580): judge's "say yes to anything adjacent" amplifies (325 has more cousins), and recall misses 3 queries.
- **Scale cliff (core failure mechanism)**: L1-70's recall miracle relied on retrieve firing only on L0 zero-match; at 325, zero-match queries = 0 (more skills = more keyword overlap = every query has wrong candidates), cross-language queries take wrong candidates to judge, if judge says yes to any wrong candidate retrieve never fires -> the true target is missed. **The two-stage rescue path depends on the "zero-match" signal, which vanishes with scale.**
- **Coverage receipt (positive)**: 325 routes to marketplace skills the 70-corpus doesn't index at all. 8 Chinese queries targeting marketplace/cache skills, 325 L0 hits 7/8 (5 rank=1).

### 6. Scale-cliff fix (always-retrieve-union, all three axes up)

Decouple retrieve from the zero-match signal - run retrieve on every query, union with judge-yes, so semantic rescue doesn't die at scale from "zero-match vanishing".

| | P | R | F1 |
|---|---|---|---|
| L1-325 (scale cliff) | 0.497 | 0.850 | 0.580 |
| + always-retrieve-union | **0.577** | **1.000** | **0.673** |

Recall catches L1-70 (1.000), all 3 missed queries rescued; precision also up (retrieve prompt asks "only core-relevant"). Cost saved: reuse stored judge verdicts, only 20 new retrieve calls. Boundary: fixes the recall cliff, but precision still degrades with scale (separate problem, see 8).

### 7. Skill scoring + semantic dedup (redundancy entropy reduction)

Routing is **structural entropy reduction** (don't load all); scoring + dedup is **redundancy entropy reduction** (prune duplicate low-quality). The second kind of work.

- **Scoring (zero LLM)**: 325 skills scored on 3 dims (0.45 completeness + 0.40 uniqueness + 0.15 freshness). Only 3/325 truly broken (no description), rest 0.6-1.0. IDF-uniqueness only catches broken, not semantic duplicates -> need dedup. Freshness doesn't distinguish in this snapshot (all installed 2026-04~06).
- **Semantic dedup (LLM, thinking off, one-shot grouping)**: 18 groups / 32 redundant (9.8%). But LLM over-merges (office-hours group merged 4 distinct skills + openclaw variants into an 8-tuple, should be 4 pairs) - receipt is non-authoritative, needs human review.
- **Pairwise confirmation (pairwise dup-judge)**: coarse grouping + per-pair judge fixes over-merging -> 16 groups / 22 redundant (6.8%). office-hours 8-tuple correctly splits into 4 pairs. The 22 redundant are now high-confidence pruning candidates.

Boundary (augment-not-automate): only identify candidates (receipt), don't auto-prune `~/.claude` (destructive, human call).

### 8. Precision scale-degradation fix (strict judge)

| | P | R | F1 |
|---|---|---|---|
| scalefix (after recall fix, precision unfixed) | 0.577 | 1.000 | 0.673 |
| + strict judge | **0.650** | **1.000** | **0.736** |
| (ref L1-70) | 0.785 | 1.000 | 0.842 |

A stricter judge - only "directly-needed core tool / near-duplicate" gets yes, tangential gets no (prefer false no over tangential yes). Recall fully held, precision +7.3 pts. **Partial fix**: review-query strict judge still says yes to 7 (close kin hard to separate). The remaining gap (0.650 vs 0.785) is an **irreducible penalty** of more cousins at scale, hard for the judge to fully separate.

**Full 325-scale story**: scalefix fixes the recall cliff (0.850 -> 1.000) + strict judge fixes precision (0.497 -> 0.650), F1 0.580 -> 0.736, approaching but not reaching L1-70's 0.842. Both halves of scale degradation have a fix and a boundary.

### 9. Pairwise merging of like terms (lossless entropy reduction, replaces pruning)

Direct pruning loses info (the deleted one might have content the canonical doesn't). Instead **pairwise merge** (take union, count drops, no info lost) - entropy reduction isn't deletion, it's merging like terms to cut redundancy (lossless). For 16 confirmed-duplicate groups, each pair LLM-merged description + triggers union, keeping the canonical name:

**38 skills -> 16 merged skills** (22 redundant losslessly folded into canonical, 22 merge calls). The 3 truly broken (no description) are the only ones to delete. Boundary: only frontmatter merged (description + triggers), body merge not done (long structured text, needs human judgment); deployment (writing merged SKILL.md to `~/.claude`) is destructive, human call.

### 10. facets cross-cutting tags (design faith landed, falsified)

facets (cross-cutting tags security/parallel/subagent/ctx-stress) were long "unverified design faith" in the routing architecture. Landing: tag the 13 corpus files + keywords, query substring hits a tag -> pull all files under that tag, union with L0. 10-query cross-cut test set (expected judged strictly by core relevance):

| | P | R | F1 |
|---|---|---|---|
| L0 baseline | 0.664 | 0.800 | 0.695 |
| L0 ∪ facets (fixed 0.5) | 0.436 | **1.000** | 0.576 |

The claim "recall up, precision controlled" is **partially falsified**: recall did rise (0.80->1.00, query 5 "delegate subagent overreach" L0 totally missed P0/R0, facets rescued 03+05), but precision crashed (fixed 0.5 + substring matching overloads, query 6 pulled 8). Net F1 -0.119.

**The fix is also falsified** (downweight 0.12 + conditional trigger): 12 combos F1 ≤ L0(0.695), none won. Root cause: tag substring matching coarsely pulls ("并行" pulls 4 files), can't distinguish true-relevant-in-tag vs tangential. Downweighting just makes facets choose between "filtered out (=L0)" or "overloaded (F1 drops)". **Naive facets top out; to work needs LLM judge of files within a tag (L1+facets, left for later).** Same shape as the L1-recall falsification: a dead path.

### 11. Backoff (design faith landed, holds)

The overload boundary "back off one level to the coarser" (uncertain leaf -> load parent) is also design faith. Landing: build a parent tree (00-pipeline root), when L0 top conf < 0.2 load the tree root to fill overview recall. 12-query test set (8 fuzzy/overview expected=00-pipeline + 4 sharp queries testing no-contamination):

| | P | R | F1 |
|---|---|---|---|
| L0 baseline | 0.319 | 0.417 | 0.347 |
| L0 + backoff (lct=0.2) | **0.903** | **1.000** | **0.931** |

Claim **holds** (all three axes up, F1 +0.583, largest gain ever). 7 fuzzy queries (top conf 0.08-0.16) L0 all wrong (loaded empty P0/R0), backoff fills 00-pipeline all correct; 4 sharp queries (top 0.33-0.54) don't trigger, zero contamination.

**Why backoff works and facets don't**: backoff's signal is clean (fuzzy top 0.08-0.16 vs sharp 0.33-0.54, 0.2 boundary clear) + action precise (backs off to only the root file, doesn't pull tangential); facets' signal is coarse (one tag pulls 4-5 files). **Corpus limitation (honest)**: current corpus is flat (01-security.md is itself a stage file, no L2 leaves), backoff only goes to root; multi-level tree (leaf -> stage-parent) see receipt 13 (verified·holds).

### 12. L1+facets (facets triple-falsified)

The follow-up left by facets' falsification: facets fill L0-missed candidates + LLM judge filters tangential, see if it turns around. L0 candidates ∪ facets-hit files -> judge -> yes loaded. Same 10-query cross-cut set:

| | P | R | F1 |
|---|---|---|---|
| L1-only | 0.639 | 0.900 | 0.698 |
| L1+facets | 0.634 | 0.900 | 0.692 |

Δ ≈ 0 (-0.007), 80 LLM calls. facets is marginally ≈0 under L1's wide candidates: L0 candidates at thr=0.05 already cover most targets; facets add to candidates but judge misjudges (query 5 added 05-execute, should be yes, judged no); facets introduce new FPs (query 8 added A1 tangential, judge yes). **facets triple-falsified** (naive L0 / downweighted L0 / L1 judge) all don't work. Mechanism right (fills L0-missed candidates) but double-blocked by tag-coarse + judge-misjudge. To work needs finer tags + more accurate judge, big rework left for later. facets is truly dead under the current corpus + tag design.

### 13. Multi-level backoff (corpus extended with L2, holds)

Closes the corpus limitation of receipt 11's backoff: then the corpus was flat (stage file = leaf, no L2 sub-leaves), backoff only went to root, multi-level tree (leaf -> stage-parent) was unverified. This slice adds L2 sub-leaves to the corpus (`corpus-l2/`, 3 under 01-security + 2 under 06-verify), testing whether "back off level-by-level" (top1 is sub-leaf -> back off to stage-parent; top1 is stage file -> back off to root) is more precise than "one step to root". `corpus/` 13 files unchanged, existing 18 receipts unaffected.

15-query test set (6 gain scenarios + 3 sub-topic tangential + 2 overview + 4 sharp), all three compared on the same 18-file joint index:

| | lct | thr | P | R | F1 |
|---|---|---|---|---|---|
| L0 baseline | - | 0.1 | 0.354 | 0.667 | 0.410 |
| Single-level backoff (to root) | 0.15 | 0.1 | 0.293 | 0.733 | 0.399 |
| Multi-level backoff (level-by-level) | 0.25 | 0.3 | **0.778** | 0.600 | **0.653** |

Δ (multi vs single) F1 **+0.254** (P +0.485, R -0.133). Claim **holds**.

**Gain scenarios** (6/15 queries trigger): fuzzy long queries containing sub-topic words ("注入的防护措施有哪些方面" / "what aspects of injection defense"), L0 top1 is a sub-leaf (sql-injection conf 0.146) with low conf -> multi-level backs off to stage-parent 01-security (correct), single-level backs off to root 00-pipeline (wrong). 14 of 15 queries differ in prediction.

**Mechanism (long queries trigger, short don't)**: sub-leaf titles are focused ("SQL 注入防护"), a short query ("注入怎么防" / "how to defend injection") - "怎么防" doesn't hit the sub-leaf title -> sub-leaf isn't top1 (out-competed by stage file) -> multi = single; a long query has more sub-topic words ("防护/措施") -> sub-leaf title hits more -> sub-leaf is top1 with low conf -> multi backs off to stage-parent and wins. Sub-leaf conf polarizes: precise queries hit titles with high conf, don't trigger; fuzzy queries don't hit titles, top1 is the stage file; only fuzzy long queries with sub-topic words land in the middle zone and trigger the gain.

**Honest boundary**: recall -0.133. Multi-level best thr=0.3 filters low-conf sub-leaves (e.g. supply-chain 0.14), keeping only stage-parents (0.3 backoff), precision up but misses sub-leaves. The gain is in precision, recall is the cost. If expected contains a sub-leaf and the sub-leaf conf is low, multi-level backs off to the stage-parent but the sub-leaf gets filtered by thr -> R<1 ("恶意包怎么检测和防范" multi F1=0.67 < L0 F1=1.0).

**Single-level backoff F1<L0 on this test set** (0.399<0.410): single-level backing off to root is wrong for sub-topic queries (expected=stage-parent), 6 queries all wrong, dragging it down. This isn't single-level degradation, it's that the test set contains sub-topic queries (receipt 11's test set had 8 queries expected=00-pipeline, backing off to root was right, F1=0.931). Multi-level fixes exactly single-level's flaw on sub-topic queries.

---

### 14. Rule direct semantic retrieval to fill recall (closes the 0714 debt, marginally positive)

The foreshadowing from receipt 4 (L1 recall nomination) falsification: "contrast the skill corpus's direct semantic retrieval succeeding - rule corpus recall probably also needs direct semantic retrieval, not 'nominate then judge'". This slice closes it: port skill `semanticRetrieve` (direct retrieval, no re-judge, union merge) to the rule corpus as-is. L0 candidates judge-filtered to judgeYes ∪ LLM direct semantic retrieval retrieved (retrieve result not re-judged, aligned with the skill version, fixing nominate's two failure points: ① "besides existing" gets anchored ② re-judge filters it out).

Cost saved: reuse the 116 judge verdicts stored in `l1-llm.json`, only 18 new retrieve calls, retrieve isolated as pure increment (same "reuse stored verdicts" pattern as scalefix / strictjudge).

| | P | R | F1 |
|---|---|---|---|
| L0 baseline | 0.511 | 0.917 | 0.631 |
| L1-only | 0.620 | 0.944 | 0.700 |
| L1+sem-retrieve | 0.620 | 0.972 | 0.719 |

Δ vs L1-only: P +0 / R +0.028 / F1 +0.019, 18 retrieve calls. **Marginally positive**.

**Mechanism (why rule corpus gains far less than skill)**: 17 of 18 queries retrieve adds nothing (returns empty or overlaps judgeYes), the only rescue is query 1 (SQL injection) retrieve added `06a-security-audit` (judge only loaded 01-security, missed 06a) - the entire source of R +0.028. Skill corpus same method F1 +0.493, rule corpus only +0.019, about 25x difference. Root cause: skill is Chinese query vs English description, L0 cross-language zero-match, retrieve rescues cross-language (R 0.500->1.000); rule is Chinese query vs Chinese corpus, **no language wall**, L0 recall already 0.917, retrieve can add little.

**Unresolved**: L1-only's missed query 12 ("质量门和审查" / "quality gates and review", expected includes 04-planning, judge only loaded 06-verify + 00-pipeline) retrieve also didn't rescue - a semantic-near-synonym gap ("quality gates" should include planning but didn't) that cross-language retrieval can't fill.

**Self-referential insight**: the semantic layer's (L1) gain scales with the corpus's **cross-representation gap** - cross-language (skill English) +0.493 vs same-language (rule Chinese) +0.019. The semantic layer's value is at the cross-representation wall (language/representation gap); under same representation the keyword layer is already near ceiling. Another self-referential verification of "routing rules are rules, verify them": without testing you don't know retrieve is only worth +0.019 on the rule corpus (vs +0.493 on skill); extrapolating from skill's success overestimates ~25x.

---

### 15. Test-set relabeling (annotation-artifact hypothesis falsified)

A repeatedly-flagged honesty gap: L1 precision 0.62 (rule) might be the test set's single-label annotation underestimating "one-to-many reasonable multi-load" - and "one-to-many" is exactly the project's goal. Measuring against the wrong target, the precision ceiling isn't real. This slice fully relabels the 18 queries as multi-label, fairly evaluating the true ceiling.

**Relabeling standard (anti-gaming)**: expected = rule files that directly govern the query's work; per query, independently audit each of L1's FPs (predicted-but-not-expected), only add to expected if genuinely relevant, **don't copy L1's predictions** (copying makes precision=1.0, self-deception). Judge from corpus content independently; L1 predictions are only diagnostic clues.

**Result**: of 18 queries, **only 1** (Q9 "写代码前调研搜索" / "what research/search before coding") was truly under-labeled - 04's Web Research + 05's GateGuard checklist both directly govern "research before coding", a reasonable one-to-many, add `05-execute`. L1's judge independently said yes to 05 (reason "the rule's core is exactly investigate before coding"), matching the independent judgment - not copying predictions, two paths to the same conclusion. **The other 11 L1 FPs, independently audited, are all genuinely tangential** (Q5's A1 failure-archaeology ≠ post-compact anti-replay; Q15's 06-verify verify-code ≠ verify-rule; Q2's 06a audit ≠ known-key Secret management...), not narrow annotation.

Reuse stored predictions, no re-run (zero LLM): L0 re-route (deterministic keyword), L1 re-score `l1-llm.json`'s predicted.

| | P | R | F1 |
|---|---|---|---|
| L1 v2 (original labels) | 0.620 | 0.944 | 0.700 |
| L1 v3 (relabeled) | 0.648 | 0.944 | 0.719 |
| L0 v2 (original labels) | 0.511 | 0.917 | 0.631 |
| L0 v3 (relabeled) | 0.511 | 0.889 | 0.613 |

Δ L1: P +0.028 / R 0 / F1 +0.019. **L0 actually drops** (Q9's 05 conf 0.068 < thr 0.1 doesn't surface, adding it to expected makes it a FN, R -0.028) - exactly proving relabeling isn't to inflate numbers, it's to label correctly: L0 genuinely can't surface 05, that's L0's true miss, not annotation being unfair to it.

**Conclusion (falsified)**: the annotation-artifact hypothesis is mostly falsified. Of 12 L1 FPs, only 1 was under-labeling; the precision ceiling (~0.65) is real, the remaining gap to 1.0 is the judge's "say yes to tangential" problem (skill corpus partially fixed with strict judge, rule corpus left for later), not an annotation artifact. A negative receipt: closes the "low precision is unfair annotation" self-comfort, forces the next fix to target the true cause (loose judge) not relabeling.

---

### 16. Rule strict judge fixes precision (the true cause after relabel falsification, big positive receipt)

Relabeling (receipt 15) falsified "low precision is annotation artifact", locating the true cause: judge "says yes to tangential". Skill corpus already verified strict judge (receipt 8, P 0.577->0.650); rule corpus hadn't. This slice does it, closing the precision true-cause loop.

Cost saved: `l1-llm.json` already stores predicted (lenient judgeYes); re-judge its 41 members with strict judge (no-thinking, only "directly-needed / near-duplicate" yes, tangential no, prefer false no), keep only strict-yes. Don't re-run L0 candidates + lenient judge.

| | P | R | F1 |
|---|---|---|---|
| L1-only v3 (baseline) | 0.648 | 0.944 | 0.719 |
| strict judge | 0.861 | 0.917 | 0.859 |

Δ P +0.213 / R -0.027 / F1 +0.14, 41 calls. **Rule corpus precision ceiling raised from ~0.65 to ~0.86**, the rule line's biggest precision gain.

**Bigger gain than skill strict judge** (rule +0.213 vs skill +0.073): rule corpus has 13 stage-distinct files, strict judge separates tangential more cleanly; skill's 325 cousins are harder to fully separate.

**Honest boundary**:
- **Small recall cost (-0.027)**: strict judge over-filtered 1 true TP (Q13 "安全审计" / "security audit" filtered out 01-security, kept only 06a - strict judge thought "audit" only needs the audit pipeline, not the security checklist, too strict) + 2 pre-existing recall misses (Q1 06a, Q12 04 weren't in lenient predicted to begin with, strict judge can't add them back).
- **Still leaves some FPs** (Q5's A1/05, Q7's 02, Q11's 04, Q17's A2): strict judge still says yes to some tangential, not reaching 1.0. The judge's precision ceiling isn't fully fixable by a single prompt.

**Both precision levers done**: relabeling (+0.028, annotation fix) + strict judge (+0.213, judge fix). Relabeling falsified annotation as the cause; strict judge confirmed loose judge is the true cause. Rule L1 precision 0.511 (L0) -> 0.648 (L1) -> 0.861 (strict judge).

---

### 17. Ownership tags (owns/refs differential, fixes facets' coarse-pull)

facets (receipt 10) failed because hitting a tag pulled ALL its files at uniform confidence - downweighting (receipt 10 fix) was also falsified: a uniform low weight is still "all pass the threshold or all get filtered", can't distinguish true-relevant from tangential. The roadmap item "tag hub files with owns/references" tests the direct fix: split each tag's files into **owns** (heading-level primary topic, grep-verified) and **refs** (mentioned in passing), give owns high confidence and refs low - **differential, not uniform**.

owns/refs assignment is content-based (heading grep, not testset-fit, to avoid receipt 15's annotation-artifact criticism):
- security: owns=[01, 06a], refs=[]
- parallel: owns=[05 (`## 并行执行` / `### 并行 landing 门`), 06 (`### 并行下的 flaky`)], refs=[03, 04]
- subagent: owns=[03 (agent routing core), 05 (delegation), 06 (maker-checker)], refs=[04, A2]
- ctx-stress: owns=[02 (`## 双信号压缩` / `## 上下文敏感任务调度` / `## Post-compact`)], refs=[A1, A3]

| | P | R | F1 |
|---|---|---|---|
| L0 baseline | 0.664 | 0.800 | 0.695 |
| original facets (0.5, unconditional) | 0.436 | 1.000 | 0.576 |
| ownership (owns=0.5, refs=0.12, thr=0.3) | **0.742** | **1.000** | **0.820** |

Δ vs L0: P +0.077 / R +0.2 / F1 +0.125 (all three axes up). Δ vs original facets: F1 +0.244. **Claim holds - the first facets variant to beat L0**, and decisively.

**Why differential beats uniform (the mechanism receipt 10 couldn't access)**: at threshold 0.3, owns (0.5) survive, refs (≤0.25) get filtered. The owns/refs split + threshold separates true-relevant (owns) from tangential (refs) - exactly the distinction receipt 10's uniform downweight couldn't make ("all filtered = L0" or "all pass = overload"). refsConf's exact value barely matters (0.12-0.25 all give 0.82 at lct=0) because threshold 0.3 filters all refs regardless - the win is the split, not the tuning.

**Recall gap filled**: query "委托subagent干活怎么不让它越界" (expected 03+05) was an L0 total miss (R0, per receipt 10); ownership's subagent-tag owns pulls 03+05, R=1.0. lct=0 (unconditional) is best - unlike facets' fix which needed a conditional trigger, ownership's differential is enough, no gating on L0 confidence.

**Honest boundary (owns-level FPs remain)**:
- 5/10 queries perfect; 5 have owns-level FPs but all R=1.0. ownership reduces FPs vs facets (refs filtered) but doesn't eliminate tag-coarseness at the owns level.
- Query "maker-checker要独立上下文验证" (expected 06) is worst (P=0.25): fires both subagent + ctx-stress tags, their owns (03/05/06 + 02) pile up. A single owns/refs split per tag can't distinguish "delegate subagent" (wants 03+05) from "maker-checker verify" (wants 06) - both are subagent-tag queries wanting different subsets. Inherent tag coarseness, honestly recorded.
- This is a lighter rework than receipt 12's "needs finer tags + more accurate judge" - same 4 tags, just an owns/refs split, and that alone beats L0. Doesn't fully solve tag coarseness, but it's net-positive where naive facets was net-negative.

Reproduce: `node router/eval-ownership.js` (L0 vs original facets vs ownership, 10-query facets testset, sweeps ownsConf × refsConf × lowConfTrigger × threshold).

---

### 18. Expanded test set (18 -> 44 queries, single-shot overestimate check)

Roadmap item "expand test set to 30-50 queries, cross-session re-verify". 26 harder new queries added (fuzzy/backoff/synonym-gap, one-to-many TDD/调研上线, 同形词 审查, 1 empty no-rule), all 44 through one pipeline (L0 deterministic + lenient + strict judge, deepseek-chat), 307 LLM calls. Purpose: check whether receipt 16's small-N numbers hold at larger N.

| | P | R | F1 |
|---|---|---|---|
| L0 base18 @thr 0.1 | 0.511 | 0.889 | 0.613 |
| L0 full N=44 | 0.366 | 0.614 | 0.424 |
| L1-strict base18 | 0.861 | 0.75 | 0.778 |
| L1-strict full | 0.614 | 0.591 | 0.576 |
| L1-strict new-only (N=26) | 0.442 | 0.481 | 0.436 |

Δ full-vs-base18: L0 F1 -0.189, L1-strict F1 -0.202. **Single-shot overestimate confirmed: every number drops at N=44.** The 26 harder new queries (long-query dilution, synonym gaps, backoff) drag all axes down; 8/26 have an expected rule below L0's 0.05 candidate cut (L1-unreachable, needs the rule-corpus semanticRetrieve port from receipt 14's skill line).

**Judge-model dependence (the bigger finding)**: judge endpoint changed glm-5.2(ARK) -> deepseek-chat; base18 strict recall 0.917 -> 0.75 while precision held 0.861. Attribution of the 7 lost base18 expected rules: **6 are judge-layer rejections** (4 lenient FN - Q9 05, Q11 06, Q12 04, Q14 07 were in L0 candidates but lenient dropped them; 2 strict FN - Q4 02, Q16 A3), **1 true L0 candidate gap** (Q1 06a not in candidates). Receipt 16's own claim ("judge-model dependence, recall is judge-sensitive") re-confirmed at N=44: precision ceiling is judge-model-stable, recall is not.

**Honest boundary**: base18 drop is confounded (judge swap + N growth, can't cleanly separate the two effects); new-query labels are single-annotator author labels (same criticism class as receipt 15); 1 empty no-rule query tests overload precision only.

Reproduce: `node router/eval-expand.js l0` (deterministic) / `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic ANTHROPIC_MODEL=deepseek-chat node router/eval-expand.js` (L1, needs token).

---

The router has accumulated **24 independent rig receipts** (L0 baseline / v2 / v3 falsified, L1 rule, L1 skill, L1 recall falsified, L0+L1 scale effect, coverage, scale-cliff fix, skill scoring, skill semantic dedup, dedup pairwise confirmation, precision scale-degradation fix, pairwise merge of like terms, facets falsified, facets-fix falsified, backoff holds, L1+facets falsified, multi-level backoff holds, rule direct semantic retrieval, test-set relabeling falsified, rule strict judge, ownership tags holds, expanded test set - single-shot overestimate confirmed), positive and negative.

## Receipt triage (reproduction ≠ proof of efficacy)

The easiest to miss, the easiest to self-deceive. A "verified" splits three ways:

- **Independent rig**: you design an experiment testing the rule's claim -> real efficacy
- **Reproduction receipt**: you run someone else's demo verifying their cited numbers are real -> verifies citation, **does not prove your rule is effective**
- **Secondhand**: just cite someone's number, don't verify -> faith

Example: the author reproduced agent-chief's 96%/75%/70% (verbatim match), but that only proves "agent-chief's demo produces these numbers", **not** "my pipeline using a worthiness-gate cuts 75% of LLM calls". The latter needs independent testing. Much community "I verified rule X is effective" is actually reproducing X's source numbers - **citation verification mistaken for efficacy verification**.

This repo's L0 / L1 P/R is the first kind (independent rig) - the author designs the test set, runs his own router, tests the efficacy of "my routing rules", not reproducing someone else's numbers. That's a step beyond "reproducing someone's demo": testing your own rules, not someone else's.

## claim × receipt framework (makes "what to test" machine-decidable)

Not every rule needs a metric. Five classes:

- `behavior` (methodology prose, N/A) - "research first", "slice it", no metric needed
- `secondhand` (cites someone's number, needs reproduction) - "dao-code reports 95.8% cache-hit"
- `selftested` (self-tested, needs N runs) - you ran the rig
- `faith` (claims a metric, zero receipt) - "compact triggers at 40%" but no source, no test
- `claimNoMetric` (claims an effect, no number) - "prevents drift" but doesn't say by how much

Only rules with a claim (claimed metric improvement) owe evidence; behavior doesn't. This is "evidence coverage" - like code test coverage, but for rules.

**Demo**: the author audited his own 177 rule blocks, 89% behavior (N/A), the remaining ~19 metric-adjacent **all secondhand/faith, 0 truly self-tested**. After building the instrument, broke 2 P0s (gzh dual-gate independent rig, agent-chief number reproduction); the router is the 3rd - and the only one testing "its own rules" not "someone else's numbers".

## Verification > model size (investment redirection)

TestSprite data point + exploitarium security fuzzing evidence: non-SOTA model + strict workflow + verification gate = real output. ROI: adding a verification gate > switching to a stronger model. When you can't afford Opus, a cheap model + strict maker-checker / Stop-Condition gate > an expensive model raw. This repositions "rule measurement" from "icing on the cake" to "a substitute for model scale".

## Transferable takeaways for the reader

1. Scan your CLAUDE.md: how many rules are "citing someone's number" or "pure behavior discipline"? Run the claim × receipt classification.
2. Only rules claiming a metric improvement owe evidence; methodology prose doesn't.
3. **Reproducing someone's number ≠ proving your rule is effective**; separate citation verification from efficacy verification (easiest self-deception).
4. The ROI of adding a verification gate > a stronger model; rule measurement is a model-scale substitute.
5. When more rules make the agent dumber, don't add rules first - route first (filter out irrelevant) then verify (judge the rest true/false).
6. Any router / classifier is a rule and should ship with a test set. An untested router = a faith router.

## Repo structure

```
corpus/              13 rule files (snapshotted from ~/.claude/rules/common/, the routed corpus)
corpus-l2/           5 L2 sub-leaves (01-security-* / 06-verify-*, for multi-level backoff; corpus/ unchanged)
router/router.js     L0 keyword router: builds weighted inverted index, route(query) -> matched + loaded
router/llm.js        L1 LLM judge: reuses terminal env vars, judgeRelevance(query,rule) -> {verdict,reason}
router/l1.js         L1 routing: L0 candidates -> per-rule LLM judge -> filter false positives
router/eval.js       L0 evaluator: test set + threshold sweep -> P/R receipt
router/eval-l1.js    L1 evaluator: vs L0
router/eval-expand.js  expanded-testset evaluator (18->44, L0 + lenient + strict, receipt 18)
testset.json         original 18-query v3 relabeled test set
testset-expanded.json  44-query expanded test set (18 base + 26 new, receipt 18)
results/             receipt archive (l0-v2-multilabel.json / l1-llm.json / skills-l0-full.json / expand-receipt.json / ...)
reproducible/        reproducible artifacts (see below)
```

The rest of `router/*.js` are evaluators / scripts for each receipt (`l1-skills` / `eval-skills-full` / `skill-scorer` / `skill-dedup` / `skill-merge` etc.), corresponding to the receipt sections above, see `results/`.

Router design: descriptors extracted from H1/H2/H3 headings + `**bold**` terms + body (position-weighted H1=3 / H2=2 / body=1), CJK via bigram with no tokenizer dependency, scoring = IDF-weighted query coverage, white-box explainable (each query prints hit tokens).

## Roadmap

- [ ] **body merge + deploy**: frontmatter merge done, SKILL.md body merge + write to `~/.claude` replacing original skills (destructive, needs human judgment)
- [x] **ownership tags**: tag hub files (04-planning / 06-verify) with "owns X / references X", so "mentions" and "owns" are distinguishable (receipt 17, holds: owns/refs differential F1 0.695->0.820, the first facets variant to beat L0; owns-level FPs remain, inherent tag coarseness)
- [x] **facets tags**: security / parallel / subagent / ctx-stress cross-cutting index, test cross-stage queries (receipt 10, falsified, needs LLM judge, left for later)
- [x] **backoff**: uncertain leaf loads parent (receipt 11 single-level to root F1 +0.583; receipt 13 multi-level to stage-parent F1 +0.254, corpus extended with L2 verified)
- [x] **rule direct semantic retrieval to fill recall** (receipt 14, closes the 0714 debt): port skill `semanticRetrieve` to rule corpus, R +0.028 / F1 +0.019 marginally positive; rule Chinese corpus has no language wall, gain ~25x smaller than skill (+0.493), semantic-layer value scales with cross-representation gap
- [x] **test-set relabeling to fairly evaluate L1 precision true ceiling** (receipt 15, annotation-artifact hypothesis falsified): all 18 queries independently relabeled multi-label, only 1 truly under-labeled, precision ceiling ~0.65 is real not annotation artifact; L1 P +0.028 / F1 +0.019, L0 dropped (relabeling isn't to inflate, it's to label correctly)
- [x] **rule strict judge fixes precision** (receipt 16, the true cause after relabel falsification): re-judge L1 predicted with strict judge (only directly-needed yes), P 0.648->0.861 (+0.213), F1 0.719->0.859, rule line's biggest precision gain; small recall cost -0.027 (over-filtered 1 TP + pre-existing miss), still leaves some FPs
- [ ] **security tag exhaustive trigger surface** (BuilderIO gold standard ~15 scenarios), verify L0 instant-match specifics
- [x] **expand test set to 30-50 queries, cross-session re-verify** (receipt 18, single-shot overestimate confirmed): 18 -> 44 queries, one pipeline, 307 LLM calls; L0 F1 0.613->0.424, L1-strict 0.778->0.576 at N=44; judge-model dependence re-confirmed (base18 strict recall 0.917->0.75 on deepseek-chat, precision held; 6/7 lost rules are judge rejections not L0 gaps)

## Reproducible artifacts (reproducible/)

Not "attachable" - already in the repo, clone and run. The thesis says "reproducible", so the artifacts must be in the repo, otherwise self-contradiction.

| Path | What | How to run |
|---|---|---|
| `reproducible/rule-evidence-audit.js` | claim × receipt 5-class classifier, scans rules for evidence distribution | `node reproducible/rule-evidence-audit.js corpus .` (scan the repo's 13 rule snapshots); scan your own: `node reproducible/rule-evidence-audit.js ~/.claude/rules "common,python"` |
| `reproducible/gzh-rig/` | independent rig demo, 19 defects testing dual-gate vs single-gate | `cd reproducible/gzh-rig && python rig.py` (pure stdlib, self-contained, no external deps) |
| `reproducible/dao-cache-rig.py` | cross-session skeleton demo (cache stability A/B) | needs `pip install anthropic` + `ANTHROPIC_API_KEY` - cross-session receipt can't run in one conversation, skeleton attached for when you have a key |

Data point: 177 blocks / 0 self-tested -> 3 P0 receipts (gzh independent rig + agent-chief reproduction + this router initial; the router has since accumulated to 24 verified rigs, see the receipts section above). Note: 177 blocks is the author's full `rules/{common,python}`; `corpus/` is the 13 common-files snapshot (the routed subset), scanning it gives the repo-corpus distribution, not the full 177.
