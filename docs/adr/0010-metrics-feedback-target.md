# 指标与反馈闭环：只加零人工成本的读数，判定层问在修复生效那一刻

## Status

提议

## Date

2026-10-08

## Tags

metrics, feedback-loop, trace, observability, knowledge-lifecycle

## Replaces

无

## Context

- 这条闭环的承诺是「越用越准」，但校验它的数据现在有两处结构性错误，都不报错。误诊归因比只读 `verdict`（`scripts/trace_metrics.py:240-243`），而生产端实际写的是 `attribution_kind`（`scripts/component_tally.py:52-58`）；同一份注释里记着实测结果：4 条归因事件、0 条含 `verdict`，合计恒为零。另一处是事件列表键名不是 `trace` 时按空处理（`scripts/trace_metrics.py:186`）：实测一份 trace 用 `events`，它的事件数读成 0，却被计入会话总数，于是静默稀释快照里所有比例的分母。
- 判定层没有数据。三期 live 快照的反馈捕获全为 0（`metrics/timeline.d/2026-W37-live.yaml:33-36` 记 12 个会话无一人回报；`docs/plan/roadmap.md:138` 记前两期同样为 0）。下游因此集体停摆：`confidence.hits` 永不累积，候选排序不学习；误诊归因比的分母为 0；groom 的软退休判据拿不到输入；fixture 自动生成与零执行评估的闸门都卡在"首个已回报的会话"。
- 案例级「被选中次数」没有统计。`scripts/trace_metrics.py:285-296` 只累计 `hit` 计数，从不按案例聚合；groom 需要区分的 `cold` 与 `tried-and-failed`（`skills/knowledge-groom/SKILL.md:92-94`）因此算不出来。
- 成本数据有三份，都不进时序数据：真实账单读取器（`scripts/session_cost.mjs`）、skill 级执行流水（`metrics/skill-exec-log.yaml`，成本字段允许标 `estimate`）、改进项卡的估算成本。而 `skills/self-evolve/SKILL.md:50` 让深度轮去读 `metrics/timeline.yaml` 的"token 趋势"，那个字段不在时序数据的字段白名单里（`scripts/verify_metrics.py:40-60`）。
- 改进项的实测记录 `metrics/ev-measure-log.yaml` 有实测数据，有面板与体检器两个消费者，却没有任何进仓库的落点。它证明"声明了可复现判据的卡到底跑没跑过"，这条证据留在本地。
- 改进项的结局分布几乎没有拒绝：绝大多数卡判为采纳（现算：数 `proposals/ideas/*.yaml` 里 `status` 的取值分布）。`docs/mechanism/rsi-mechanism.md:143` 已写明这个形态的判据："不采纳一次都没有出现过，那么采纳记录不能单独用作质量结论"。提出方案、执行、判定有效都是同一个 agent，CI 只验结构，复核工具自述"证明效果、不证明价值"（`scripts/ev_measure.py:11-15`）。
- 目标态设计的正文在 `docs/mechanism/metrics-feedback-target.md`，本文只承载取舍。

## Decision

1. 修两处读数缺陷：归因比同时接受 `verdict` 与 `attribution_kind`（后者的 `improvement`、`design` 不并进误诊，单列一桶）；事件列表键名不认识时报"该会话事件未记录"并单列计数，不按 0 事件静默收下。
2. 判定层只改问法，不改 schema：报告尾部与诊断对话末尾各留一行可复制的回报指令；下一次诊断开屏只显示一行预填确认，默认值取该会话最后一次给出的结果；没有回答就保持 `pending`，聚合成不可解读，不按 `resolved` 计。
3. 只加三个不需要人多做动作的读数：案例被选中次数（窗口沿用 groom 已有的近 12 周）、从已记录事件导出的诊断标签、改进项结局里的拒绝率。
4. 成本靠 `session_id` 与 step 号把计费层与事件层关联，不把 token 写进 trace 事件。
5. 给 `confidence` 加 `partials` 计数，`partial` 不再并进 `misdiagnoses`；不回填历史，`score` 公式本季度不动。
6. 落点按"能不能跨机复算"分两份：可复算的计数进 `metrics/timeline.d/<期号>.yaml`，明细与窗口留本地；每次诊断的指标不单独开 PR。
7. 拒绝域只做观测：连续若干轮不采纳为 0 就报"拒绝域为空"，不设配额。

## Alternatives Considered

**每次诊断的指标随知识修改 PR 一起上仓（否决）。** 好在证据与结论同行，评审一次看完。代价有三条：`traces/` 含客户现场信息，进 git 要先逐单脱敏；生成物里不写数字是本仓库的硬约束，指标数值进文件会在并发合并时撞行；PR 量从每周一次变成每单一次，而每周一次正是当前能维持的门控节律。前两条里任何一条都足以否决它。

**把检索的查询串、topK、分数写进 trace（否决）。** 好在能让在线检索质量可算，且不依赖回放。代价是这些值由 agent 自报，事后无法复算：同一次检索换一台机器跑不出同一串分数。仓库已有的强观测在离线侧（`scripts/rank_candidates.py --eval`、`scripts/eval_arena.py --gate`），那边的对照是冻结的。按原则十的强度标注纪律，弱观测不该顶替强观测。

**把诊断标签扩成五个人工枚举（否决）。** 好在语义完整，评审一眼看懂结局。代价是每次回报的选择成本上升，而反馈捕获在三期 live 快照里都是 0（见上文）：在一个捕获率为零的通道上增加单次成本，方向是反的。五个标签里有四个能从已写下的数据导出（`miss` 加停止原因、流程冲突字段、归因二分、反馈三态），导出这一步缺的是脚本，不是字段。

**给 case 加 `status` 字段表达生命周期（否决）。** 好在与先验层对称：`references/` 有 `status: active | pending-review | deprecated | draft`（`references/README.md:38`）。代价是同一件事在案例层有两个表达：目录位置（移入 `_archive/`）与字段值，两者不一致时无人知道以哪个为准。案例层真正缺的不是状态字段，是降级信号的数据源，那个数据源就是第 1、2 条要修的东西。

**把 token 与耗时写进 trace 事件（否决）。** 好在 trace 一份文件自足，不必 join。代价是复制而非关联：账单在会话日志里，trace 里那份是自报值，两者不一致时要以哪个为准没有判据。耗时另有一条：它跨机器、跨负载、跨并发度都不可比，写进事件后唯一可靠的用法是"是否逼近硬超时"这个布尔量，而那个量现在连采集面都没有。

**给"不采纳"设配额或硬性要求（否决）。** 好在能立刻把拒绝率变成非零读数。代价是配额会诱导编造拒绝理由，而一条编造的拒绝记录比没有拒绝更坏，因为它让拒绝域看起来存在。`rsi-mechanism.md:143` 的原文要求的正是"缺少拒绝路径"这件事被看见，而不是被填满。

**把 groom 变更摘要落成仓库文件（推迟）。** 好在摘要就不再只活在会话里，季度回顾可以直接回溯。代价是它不满足检查准入的第三条：现在复发 0 次。记为待定项，闸门写在目标态文档第 5.2 节。

## Consequences

- 好：误诊归因比从"结构上恒为零"变成"有事件就有读数"，因为两套写法都收。
- 好：案例被选中次数不需要任何人回报，因为它的输入全部来自诊断自动写下的事件。
- 好：软退休判据拿到 `cold` 与 `hot_unresolved` 的区分，因为窗口计数可算，且 `cold` 不退休防止删掉罕见但正确的知识。
- 好：拒绝域从"看不见"变成"可观测"，因为拒绝率进了读数，且不设配额所以不会被填满。
- 好：成本与事件靠 `session_id` 关联，不新增写侧纪律，因为关联的键已经在两侧都写了。
- 坏：新增脚本与落点，维护面增加。缓解是新增的只有计数级产物，不含原文。
- 坏：`partial` 拆分会改变 `confidence.score` 的历史可比性，因为 score 由 `hits` 与 `misdiagnoses` 重算。缓解是不回填、公式本季度不动，先攒数据。
- 坏：反馈改问法需要改两处 skill 正文与报告模板，且效果依赖人的习惯，短期读数不会立刻变好。
- 坏：`improvement` 与 `design` 两类归因单列一桶后，归因比的分母构成变复杂，读的人要先看构成再看比例。

## Open Questions

本节不构成实现依据。

- `partials` 何时进入 `score` 公式，以及进入后是否需要重新校准全部案例的初始先验。
- 成本是否要做趋势通道。它要进时序数据的字段白名单，按检查准入三条缺复发证据。
- 反馈出口那一行放几个入口（报告尾部、对话末尾、面板）才既不漏也不烦。
- 案例被选中次数的窗口是否要与软退休同步调整；现在是沿用 12 周，没有实测支撑。

## Implementation Plan

改动按依赖顺序，每一步都给出可执行的确认方式。

| # | 改什么 | 位置 | 确认方式 |
|---|---|---|---|
| 1 | 归因比同时接受两种写法 | `scripts/trace_metrics.py:240-243` | `python3 scripts/trace_metrics.py --traces-dir traces` 在存在归因事件时归因比非全 0 |
| 2 | 事件键名不认识时报未记录并单列计数 | `scripts/trace_metrics.py:186` | 对使用 `events` 键的 trace，输出里出现"未记录"计数，且比例读数旁标注分母构成 |
| 3 | `procedure_follow` 读数补实现 | `scripts/trace_metrics.py` 的指标表 | 输出的指标表里出现该字段；`docs/guide/metrics.md:63` 的定义与实现对上 |
| 4 | 案例被选中次数聚合 | 新脚本，输入 `traces/*.yaml` 的候选相关事件 | 对现有 trace 跑一次，输出每个案例的 `selected`、`considered`、`excluded` |
| 5 | 诊断标签导出 | 新脚本，输入事件与反馈 | 对现有 trace 跑一次，输出五类标签的计数与各自触发的动作 |
| 6 | `confidence` 加 `partials` | `scripts/settle_trace_feedback.py:12`、`docs/spec/case-schema.md:34` | 结算前后 diff 显示 `partials` 单独计数，`misdiagnoses` 不再增加 |
| 7 | 反馈问法 | `skills/diagnose/SKILL.md` 的追问节、`skills/resume-diagnosis/SKILL.md` 的开屏节、`skills/diagnose/references/report-template.md` 尾部 | 产出一次报告，尾部出现回报指令；带 `feedback_pending_since` 的会话开屏出现一行预填确认 |
| 8 | 改进项实测记录进期文件 | `scripts/metrics_snapshot.py`、`metrics/timeline.d/` 模板 | 组一期骨架，骨架里出现实测次数与从未实测的卡数 |
| 9 | 拒绝率读数 | `scripts/evolution_health.py`、`proposals/gates.yaml` | 跑一次体检，输出采纳、换方向、不采纳三个计数 |
| 10 | 越界清单在两条流程间接上 | `skills/knowledge-groom/SKILL.md` 开头、`docs/guide/metrics.md` 周批收尾 | 两处各出现一行指向对方的命令 |

第 1、2 步不改任何 schema，可以独立合入。第 3 到第 6 步改脚本与一处 schema，按知识修改流程走。第 7 步改 skill 正文与报告模板，按方法论流程走。第 8 到第 10 步改周批与体检，不碰知识内容。每一步独立提交，可以单独撤回。
