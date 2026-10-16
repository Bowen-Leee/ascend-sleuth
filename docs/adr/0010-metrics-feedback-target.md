# 诊断数据面：只修静默失败与口径不一致，不扩充进仓库的指标

## 状态

提议

## 背景

本地件锚定已经覆盖一部分：跨检出复用的目录与游标收在 `scripts/exec_log_path.py:168-180` 的 `CHECKOUT_DIRS`，源码缓存与上游文档缓存走 `resolve_src_code`、`resolve_ref_docs`。

验证回放产物 `.s2-replay/` 不在表里，`docs/guide/git-workflow.md` 的运行时件一节把它归为 dev 期产物、留在检出内。

验证回放的四个读端按当前工作目录解析 `.s2-replay/`：`scripts/settle_s2_feedback.py:130`、`scripts/component_tally.py:68`、`scripts/ev_board_data.py:843`、`scripts/evolution_health.py:88`。

目录不存在时 `scripts/settle_s2_feedback.py:136` 的 glob 返回空，脚本报 0 条结算并正常退出。读的人分不出「样本都没有结论」与「结果文件在另一个检出」。

事件列表的键名不是 `trace` 时按空处理（`scripts/trace_metrics.py:186`）。实测一份轨迹用 `events` 键，它的事件数读成 0，却仍计入会话总数，稀释了快照里所有比例的分母。

误诊归因比只读 `verdict`（`scripts/trace_metrics.py:240-243`）。仓内两处拼法不一致：权威写入点写 `verdict`（`skills/diagnose/references/diagnosis-procedure.md:331`），而 `scripts/component_tally.py:56-57` 的注释记着实测「4 条归因事件、0 条含 verdict」，并说明只认一套会让整条读数静默为零。本机现在没有归因事件，所以这是潜在不一致。

判定层没有数据。三期 live 快照的反馈捕获都是 0（`metrics/timeline.d/2026-W37-live.yaml:12`、`:33-36`；`docs/plan/roadmap.md:138`）。追问与清债的机制已经写在正文里：给完 fix 立刻写 `feedback` 与一条可复制的回报指令（`skills/diagnose/SKILL.md:65`），由续接按三种情形清债（`skills/resume-diagnosis/SKILL.md:26-34`）。缺口不在机制侧。

案例级选中次数没有统计。`scripts/trace_metrics.py:285-296` 只按会话累计 `hit` 计数；`scripts/settle_trace_feedback.py:16-19` 记着「数据都在 traces 里，但没有任何脚本产出它」。

改进项的实测记录 `metrics/ev-measure-log.yaml` 有实测数据，有演进看板与体检器两个消费者，没有进期文件的落点（`.gitignore:108`）。

时序数据按部署分家，两种部署各自的读数为各自所有、不参与合并（`docs/guide/git-workflow.md` 的部署形态一节）。

设计与规格在 `docs/mechanism/diagnosis-artifacts-and-metrics.md`，本文承载取舍。

## 决定

我们决定只修本地件与读数里的静默失败与口径不一致，并把案例选中次数留在本地由知识库整理流程消费，不扩充进仓库的指标字段。

## 被否决的替代方案

- 把四个新读数写进期文件（否决）。好处是闭环有了周期读端。代价是三个重复：`ev_outcomes` 与 `proposals/gates.yaml:32-39` 的 `negative_terminal` 维度重复，`ev_measure` 与 `:49-55` 重复，同一个数写进第三处会让两处定义先腐烂（ADR-0004）；`outcome_labels` 的五项里，反馈三态已经在 `feedback_capture` 里，归因二分已经在 `attribution_ratio` 里。
- 给归因比加 `improvement` 与 `design` 两个桶（否决）。好处是归因分类完整。代价是仓内没有 skill 或文档定义这两个值，而 `skills/diagnose/SKILL.md:194` 要求流程改进走改进项卡、不写成轨迹事件。桶会一直是 0；一旦非 0，`metrics/gates.yaml:74-76` 的 `attribution_ratio: any_gt_0` 会被非误诊事件点亮，把「全 0 表示没有数据」这条可解读性规则弄坏。
- 把 `.s2-replay/` 收进主检出锚定表（否决）。好处是跨 worktree 可见。代价是写入侧分散在 `scripts/s2_replay.py:54`、`scripts/eval_arena.py:102-104`、`scripts/rank_candidates.py:66` 与 `scripts/gate_diff.py` 的散文路径。只锚读侧会得到写进 worktree、读主检出、报 0 条结算，比现在各检出自洽更坏。改进项卡 EV-2026-066 也记过不接入 dev 期产物。
- 把「任何机器都能用同一份输入重算」作为进 git 的判据（否决）。好处是读数可复核。代价是现行 live 字段没有一个合格：它们都由本地轨迹派生（`scripts/trace_metrics.py:336-347`），而部署形态一节规定读数按部署分家、不参与合并。改用两条判据：读数连同分母与来源一起写，以及定义在样本不完整时成立。
- 每次诊断的指标单独开一个 PR 上仓（否决）。好处是证据与结论同行。代价是轨迹含客户现场信息、进 git 要先逐单脱敏；生成物里不写数字是本仓库的约束，指标数值进文件会在并发合并时撞行；PR 量从每周一次变成每单一次。
- 把检索的查询串、topK 与分数写进轨迹（否决）。好处是检索质量在线可算。代价是这些值由 agent 自报，事后无法复算。可复算的观测在离线回放侧，那里有冻结的对照样本（`scripts/rank_candidates.py --eval`、`scripts/eval_arena.py --gate`）。
- 把诊断标签扩成多个人工枚举（否决）。好处是语义完整。代价是单次回报的选择成本上升，而反馈捕获在三期 live 快照里都是 0。五个候选标签里有四个能从已写下的数据导出。
- 给 case 加 `status` 字段表达生命周期（否决）。好处是与先验层对称，`references/` 有 `status` 字段（`references/README.md:38`）。代价是同一件事在案例层有两个表达：目录位置与字段值，不一致时没有判据。
- 把 token 与耗时写进轨迹事件（否决）。好处是轨迹自足、不必关联。代价是复制而非关联：账单在会话日志里，轨迹里那份是自报值，不一致时以哪个为准没有判据。耗时跨机器、跨负载、跨并发度都不可比，写进事件后能站住的用法只剩判断是否逼近硬超时。
- 重写反馈追问的时点（否决）。好处是捕获率可能上升。代价是与已有规则冲突：`skills/diagnose/SKILL.md:57` 明确不在开屏追旧单的反馈，`skills/resume-diagnosis/SKILL.md:26-34` 已经把清债放在续接里。机制已经完整，改动只会让两处规则互相矛盾。
- 现在拆分 `confidence.partials`（推迟）。好处是「内容对但不完整」与「这条知识错了」不再混算。代价是涉及四处既有实现：回写函数 `scripts/settle_trace_feedback.py:211-216` 只改已存在的键，存量案例拿不到新字段；复核函数 `:474-476` 会把每个 `partial` 误报为「已结算但无效果」；`tests/test_settle_trace_feedback.py:105-109` 断言现状；`trace-status.yaml:68-71` 的 `counts_as` 与其余文档站点写着旧口径。闸门是反馈捕获大于 0。
- 把知识库整理的变更摘要落成仓库文件（推迟）。好处是摘要不再只存在于会话里。代价是它不满足检查准入的第三条，复发证据还没有。

## 后果

- 好，因为误诊归因比不再依赖单一拼法，两套写法都能计数，且改动由合成轨迹的单测固定。
- 好，因为事件键名不认识时会报未记录并标出分母构成，不再静默稀释比例。
- 好，因为验证回放的缺席与空结果分开了，读的人知道该去哪个检出找结果。
- 好，因为案例选中次数不需要工程师回报，它的输入由诊断自动写下的事件提供。
- 好，因为知识库整理的退休判断只读本机的选中历史，单机沉默不会变成全局结论。
- 好，因为 `sources` 写明检出后，读时序数据的人知道这个数覆盖了谁。
- 坏，因为归因比的两种拼法没有数据可区分，这条修复在出现归因事件之前无法在真实数据上验证。
- 坏，因为两个新结局读数在计数非零之前只能报不可解读，短期看不到收益。
- 坏，因为面板的轨迹读仍跟随会话工作目录，锚定不覆盖它，这一类事故对面板读没有关闭。
- 坏，因为 `.s2-replay/` 的跨 worktree 可见性没有解决，只把静默改成了显式报错。

## 关联

取代无，不被取代。

依赖的设计与规格：`docs/mechanism/diagnosis-artifacts-and-metrics.md`，其中 5.2 节按蓝图项列出每个改动的落点与确认方式。

相关既有决定：改进项卡 EV-2026-066 决定不把 dev 期产物接入主检出锚定，本文与之一致；`docs/adr/0004` 的参数治理条款（同一个量不写两处）是本文否掉三个重复字段的依据；`docs/adr/0009` 关于单机历史不是完整样本的结论，是本文把案例选中次数留在本地的依据。

主要代码入口：`scripts/exec_log_path.py`、`scripts/shared_dir.py`、`scripts/trace_metrics.py`、`scripts/settle_s2_feedback.py`、`scripts/component_tally.py`、`scripts/ev_board_data.py`、`scripts/evolution_health.py`、`scripts/metrics_snapshot.py`。
