# 诊断数据面：本地件锚定与指标上仓

## Status

提议

## Date

2026-10-08

## Tags

metrics, trace, local-artifacts, feedback-loop, knowledge-lifecycle

## Replaces

无

## Context

诊断在每台机器上本地跑，产物一半不进版本库。这批本地件现在有几处结构与实现不一致，逐条如下。

**两处读数错误，都不报错。** 误诊归因比只读 `verdict`（`scripts/trace_metrics.py:240-243`），而 diagnose 实际写的是 `attribution_kind`（`scripts/component_tally.py:52-58`）。同一份注释里记着实测结果：4 条归因事件、0 条含 `verdict`，合计恒为零。

事件列表的键名不是 `trace` 时按空处理（`scripts/trace_metrics.py:186`）：实测一份轨迹用 `events`，事件数读成 0，却仍计入会话总数，稀释了快照里所有比例的分母。

**本地件锚定只做了一半。** `traces/`、`postmortems/inbox/`、`proposals/{sessions,tasks,reviews,experiments}/`、`ref-docs/`、`.settle-state.json` 收进了 `CHECKOUT_DIRS`（`scripts/exec_log_path.py:168-180`），`src-code/` 与执行流水走对应的 `resolve_*`。

`.s2-replay/` 没有：`scripts/settle_s2_feedback.py:48` 按当前工作目录解析，`scripts/component_tally.py:68` 与 `scripts/evolution_health.py:77` 同。在 worktree 里跑 S2 回放，主检出的 groom 读不到结果。

**判定层没有数据。** 三期 live 快照的反馈捕获全为 0（`metrics/timeline.d/2026-W37-live.yaml:33-36` 记 12 个会话无一人回报；`docs/plan/roadmap.md:138` 记前两期同样为 0）。

后果沿链条传下去：`confidence.hits` 不累积，候选排序不学习；误诊归因比的分母为 0；groom 的软退休判据没有输入；夹具自动生成与零执行评估的闸门都卡在「首个已回报的会话」。追问的时点是下一次诊断开屏，而修复是否生效只有现场知道。

**案例级的选中次数没有统计。** `scripts/trace_metrics.py:285-296` 只累计 `hit` 计数，不按案例聚合。groom 需要区分的 `cold` 与 `tried-and-failed`（`skills/knowledge-groom/SKILL.md:92-94`）因此算不出来。

**成本数据四处分离，一处都不进时序数据。** 真实账单读取器（`scripts/session_cost.mjs`）、skill 执行流水（`metrics/skill-exec-log.yaml`，成本字段允许标 `estimate`）、改进项卡的估算成本、上下文成本审计。

而 `skills/self-evolve/SKILL.md:50` 让深度轮读 `metrics/timeline.yaml` 的「token 趋势」，那个字段不在字段白名单里（`scripts/verify_metrics.py:40-60`）。

**有实测数据没有落点。** `metrics/ev-measure-log.yaml` 记录「声明了可复现判据的卡到底跑没跑过」，有演进看板与体检器两个消费者，没有进期文件的落点。

**改进项的结局分布几乎没有拒绝。** 绝大多数卡判为采纳（现算：数 `proposals/ideas/*.yaml` 里 `status` 的取值分布）。`docs/mechanism/rsi-mechanism.md:143` 已经写明这个形态的判据：「不采纳一次都没有出现过，那么采纳记录不能单独用作质量结论」。提出方案、执行、判定有效由同一个 agent 完成，CI 只验结构，复核工具自述「证明效果、不证明价值」（`scripts/ev_measure.py:11-15`）。

设计与规格在 `docs/mechanism/diagnosis-artifacts-and-metrics.md`，本文承载取舍。

## Decision

1. 修两处读数错误：归因比同时接受 `verdict` 与 `attribution_kind`；事件列表键名不认识时报「未记录」并单列计数，不按 0 事件静默收下。
2. 把 `.s2-replay/` 收进 `CHECKOUT_DIRS`，与 `traces/` 同一条锚定语义。
3. 反馈的出口放到报告尾部与诊断对话末尾，入口收成一行预填确认；没有回答就保持 `pending`，聚合成不可解读。
4. 加四个不需要工程师多做动作的期文件字段：案例被选中次数、导出标签计数、改进项实测计数、改进项结局分布。
5. 成本靠 `session_id` 与 step 号关联事件层与计费层，不把 token 写进轨迹事件。
6. 给 case 的 `confidence` 加 `partials` 计数，`partial` 不再并进 `misdiagnoses`；不回填历史，`score` 公式本季度不动。
7. 上仓保持在四种形态：单条知识的持久状态、周期聚合读数、判据数值、蒸馏结论。每次诊断的指标不单独开 PR。
8. 拒绝域只做观测：连续若干轮不采纳为 0 就报「拒绝域为空」，不设配额。

## Alternatives Considered

**每次诊断的指标随知识修改 PR 一起上仓。** 好处是证据与结论同行，评审一次看完。代价是轨迹含客户现场信息，进 git 要先逐单脱敏；生成物里不写数字是本仓库的硬约束，指标数值进文件会在并发合并时撞行；PR 量从每周一次变成每单一次，而每周一次是当前能维持的门控节律。前两条各自足以否掉它。

**把检索的查询串、topK 与分数写进轨迹。** 好处是检索质量在线可算，不依赖回放。代价是这些值由 agent 自报，事后无法复算：同一次检索换一台机器跑不出同一串分数。强观测在离线侧，那里的对照是冻结的（`scripts/rank_candidates.py --eval`、`scripts/eval_arena.py --gate`）。按原则十的强度标注纪律，弱观测不顶替强观测。

**把诊断标签扩成五个人工枚举。** 好处是语义完整，评审一眼看懂结局。代价是单次回报的选择成本上升，而反馈捕获在三期 live 快照里都是 0（见上文）：在一个捕获率为零的通道上增加单次成本，收效为负。五个标签里有四个能从已写下的数据导出：`miss` 加停止原因、流程冲突字段、归因二分、反馈三态。缺的是导出这一步的脚本。

**给 case 加 `status` 字段表达生命周期。** 好处是与先验层对称，`references/` 有 `status: active | pending-review | deprecated | draft`（`references/README.md:38`）。代价是同一件事在案例层有两个表达：目录位置（移入 `_archive/`）与字段值，两者不一致时没有判据。案例层缺的是降级信号的数据源，而那个数据源是本文第 1 条与第 2 条要修的东西。

**把 token 与耗时写进轨迹事件。** 好处是轨迹一份文件自足，不必 join。代价是复制而非关联：账单在会话日志里，轨迹里那份是自报值，两者不一致时以哪个为准没有判据。耗时的可用面更窄，它跨机器、跨负载、跨并发度都不可比，写进事件后唯一站得住的用法是判断「是否逼近硬超时」，而那个量现在连采集面都没有。

**给「不采纳」设配额或硬性要求。** 好处是拒绝率立刻变成非零读数。代价是配额会诱导编造拒绝理由，一条编造的拒绝记录让拒绝域看起来存在，比没有拒绝更坏。`rsi-mechanism.md:143` 要的是「缺少拒绝路径」被看见。

**把 groom 变更摘要落成仓库文件。** 好处是摘要不再只活在会话里，季度回顾可以直接回溯。代价是它不满足检查准入的第三条：复发证据还没有。记为待定项，闸门写在设计文档第 5.2 节。

## Consequences

- 误诊归因比从结构上恒为零变成有事件就有读数，因为两套写法都收。
- 案例被选中次数不需要任何人回报，因为它的输入全部来自诊断自动写下的事件。
- 软退休判据拿到 `cold` 与 `hot_unresolved` 的区分，因为窗口计数可算；`cold` 不退休，避免删掉罕见但正确的知识。
- 拒绝域从看不见变成可观测。不设配额，所以这个读数不会被填满。
- 成本与事件靠 `session_id` 关联，不新增写侧纪律，因为关联键在两侧都已经写了。
- S2 与元层评测台的产物跨 worktree 可见，因为锚定语义与 `traces/` 统一。
- 新增脚本与期文件字段，维护面增加。缓解是新增产物只到计数级，不含原文。
- `partial` 拆开会改变 `confidence.score` 的历史可比性，因为 score 由 `hits` 与 `misdiagnoses` 重算。缓解是不回填、公式本季度不动，先攒数据。
- 反馈改问法要动两处 skill 正文与报告模板，短期读数不会立刻变好，它取决于人的习惯。
- 归因比的分母构成变复杂，读的人要先看构成再看比例。

## Open Questions

本节不构成实现依据。

- `partials` 何时进入 `score` 公式，以及进入后是否需要重新校准全部案例的初始先验。
- 成本是否要做趋势通道。它要进字段白名单，按检查准入三条缺复发证据。
- 反馈出口放几个入口（报告尾部、对话末尾、面板）既不漏也不烦。
- 案例窗口是否要与软退休同步调整。现在是沿用 12 周，没有实测支撑。
- `.ixn-replay/`、`.replay-input/`、`.auto-fetch/` 是否与 `.s2-replay/` 一并锚定。它们的生命周期更短，锚定的收益要单独算。

## Implementation Plan

按依赖顺序，每步给出可执行的确认方式。

| # | 改什么 | 位置 | 确认方式 |
|---|---|---|---|
| 1 | 归因比接受两种写法 | `scripts/trace_metrics.py:240-243` | 存在归因事件时归因比非全 0 |
| 2 | 事件键名不认识时报未记录 | `scripts/trace_metrics.py:186` | 对使用 `events` 键的轨迹，输出出现未记录计数，比例读数旁标出分母构成 |
| 3 | 流程加载与跟随补实现 | `scripts/trace_metrics.py` 的指标表 | 指标表出现该字段，与 `docs/guide/metrics.md:63` 的定义对上 |
| 4 | `.s2-replay/` 收进锚定表 | `scripts/exec_log_path.py:168-180`、`scripts/settle_s2_feedback.py:48`、`scripts/component_tally.py:68`、`scripts/evolution_health.py:77` | 在 worktree 里跑结算，读到主检出的 `.s2-replay/` |
| 5 | 案例被选中次数聚合 | 新脚本，输入轨迹的候选相关事件 | 对现有轨迹跑一次，输出每个案例的选中、看过未取、排除三个计数 |
| 6 | 诊断标签导出 | 新脚本，输入事件与反馈 | 输出五类标签的计数与各自对应的动作 |
| 7 | `confidence` 加 `partials` | `scripts/settle_trace_feedback.py:12`、`docs/spec/case-schema.md:34` | 结算前后 diff 显示 `partials` 单独计数，`misdiagnoses` 不再增加 |
| 8 | 四个期文件字段进白名单 | `scripts/verify_metrics.py:40-60`、`scripts/metrics_snapshot.py`、`docs/guide/metrics.md` | 组一期骨架，四个字段出现且 `verify_metrics.py --check` 通过 |
| 9 | 反馈问法 | `skills/diagnose/SKILL.md` 追问节、`skills/resume-diagnosis/SKILL.md` 开屏节、报告模板尾部 | 产出一次报告，尾部出现回报指令；带 `feedback_pending_since` 的会话开屏出现一行预填确认 |
| 10 | 拒绝率读数 | `scripts/evolution_health.py`、`proposals/gates.yaml` | 跑一次体检，输出采纳、换方向、不采纳三个计数 |
| 11 | 两条流程间接上 | `skills/knowledge-groom/SKILL.md` 开头、`docs/guide/metrics.md` 周批收尾 | 两处各出现一行指向对方的命令 |

第 1、2、4 步不动 schema，可以独立合入。第 3、5、6、7、8 步改脚本与一处 schema，按知识修改流程走。第 9 步改 skill 正文与报告模板，按方法论流程走。第 10、11 步改体检与周批，不碰知识内容。每一步独立提交，可以单独撤回。
