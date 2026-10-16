# 诊断本地件与指标上仓

诊断在工程师自己的机器上跑。一次诊断会留下轨迹、报告、证据、缓存和执行流水，其中多数不进版本库，少数作为仓库资产提交。本文列清这批本地件、谁写谁读、锚在哪里，并给出进仓库那一部分的形态。

读者是要改轨迹字段、改指标脚本、改知识库整理流程或周批的人。读之前需要知道诊断的六步各写什么（[skills/diagnose/references/diagnosis-trace.md](../../skills/diagnose/references/diagnosis-trace.md)），以及现有指标怎么算（[docs/guide/metrics.md](../guide/metrics.md)）。只想拿到一次诊断结论的工程师不必读。

## 1 解决什么问题

一次诊断留下的文件散在两张面上。一张是仓库资产：进 git、走 PR、所有人共享。另一张是本地件，只在这台机器的这份检出里有意义。两张面之间的边界没有一处写全，它散在多个 skill 的正文、脚本注释和面板代码里。边界散着写，带来三类事故。

第一类是记录写错位置。在 worktree 里按正文写的相对路径写轨迹，文件落进 worktree 的忽略目录。主检出的面板与周批读不到它，而 `git worktree remove` 对忽略件不报错、也不提示，记录随 worktree 一起消失（[docs/guide/git-workflow.md](../guide/git-workflow.md) 第 3 条）。

第二类是把读不到当成没有。在 worktree 里跑周批，`traces/` 是空的，`trace_metrics.py` 报「未找到任何 traces/*.yaml」，周批产出一期没有诊断侧数据的快照。

同一种静默出现在验证回放通道。`scripts/settle_s2_feedback.py:136` 用 `replay_dir.glob("*.result.yaml")` 取结果，目录不存在时返回空，脚本报 0 条结算、退出码 0，读的人分不出「这批样本都没结论」和「结果文件在另一个检出」。

第三类是同一个量各算一遍。会话成本有四个来源：提供方账单、skill 执行流水的 `cost` 字段、改进项卡的 `actual_cost.tokens`、skill 常驻上下文的审计值。四个值含义不同，哪一个都没进时序数据。

三类事故指向同一个缺口：本地件的边界、锚点和消费者没有单一定义。

## 2 最小可执行模型

本地件与仓库资产的分界只有一条判据：这份文件换到另一份检出、另一台机器上还有没有意义。有意义的是仓库资产，没有意义的是本地件。

本地件的落点分两种，3.1 的清单逐行标出：要被同一克隆的多个检出共读的锚在主检出；一次批次用完即弃的留在检出内（验证回放产物、交互回放产物、回放输入与报告、自动抓取候选、调研物料）。

同一份检出可能同时开着多个 worktree（同一个仓库的第二份检出）在并发处理任务，而周批与结算脚本读的是主检出那一份。锚定之后，记录落在哪个目录不再取决于当时人在哪个目录。这条保证的适用范围是「同一克隆且能取到 git」：`scripts/exec_log_path.py:110-123` 在没有 git 环境时退化为检出内，多份克隆之间也互不可见，两种情况都在输出里标出退化形态。

锚定由三部分组成，缺任何一部分都会重新出现第一类事故。

1. 一张本地件路径表：`scripts/exec_log_path.py` 的 `CHECKOUT_DIRS` 与三个 `resolve_*` 函数。
2. 一个给 agent 用的命令行入口：`python3 scripts/shared_dir.py <名字>`。
3. 一条写作纪律：skill 正文里的本地件路径一律用解析后的绝对路径。

仓库资产进 git 的条件有两条，两条都要满足。一条是读数连同分母与来源一起写，让读者知道这个数覆盖了哪一批会话、哪个部署。另一条是它的定义在样本不完整时仍然成立。第二条挡住一类常见错误：把「这台机器没遇到过」写成「全库没人用」。

三层数据分开采集，靠 `session_id` 关联：诊断事件由 agent 当场写，修复结果由工程师回报，成本由 harness 记账。三层里只有修复结果需要人，另外两层在诊断过程中自动产生。

## 3 完整机制

### 3.1 本地件清单

锚定一列写「主检出」的走 `CHECKOUT_DIRS` 或对应的 `resolve_*` 函数。写「检出内」的不锚主检出，解析路径的基准有两种：多数读端按当前工作目录解析，`scripts/evolution_health.py` 按脚本所在检出解析（`--root` 默认 `Path(__file__).resolve().parents[1]`，`:558`）。

| 本地件 | 路径 | 谁写 | 谁读 | 锚定 | 进 git |
|---|---|---|---|---|---|
| 诊断轨迹 | `traces/<session_id>.yaml` | diagnose 每步 | 见 3.2 | 主检出 | 否 |
| 定位报告 | `traces/<session_id>.report.md` | diagnose 收尾 | 人、诊断面板 | 主检出 | 否 |
| 证据原件 | `traces/evidence/<session_id>/` | diagnose | `verify_evidence.py`、报告 | 主检出 | 否 |
| 交接单 | `traces/handoff/<sid>.yaml` | `import_trace.py` | `resume-diagnosis`、诊断面板 | 主检出 | 否 |
| 交接导出 | `traces/exports/` | `export_trace.py`、诊断面板 | 人（拷到另一台机器） | 主检出 | 否 |
| 沉淀草稿 | `postmortems/inbox/<case-id>.md`、`.case.yaml` | `to-postmortem`、`issue-ingest` | `knowledge-groom` | 主检出 | 否 |
| 源码缓存 | `src-code/<version>/` | `src_fetch.py` | diagnose 的源码分析 | 主检出 | 否 |
| 上游文档缓存 | `ref-docs/` | `reference-ingest`、`gc_docs.py` | `to-reference` | 主检出 | 否 |
| 结算游标 | `.settle-state.json` | 两个结算脚本 | 两个结算脚本 | 主检出 | 否 |
| skill 执行流水 | `metrics/skill-exec-log.yaml` | `log_skill_exec.py` | 见 3.2 | 主检出 | 否 |
| 改进项实测记录 | `metrics/ev-measure-log.yaml` | `ev_measure.py --run` | 演进看板、`evolution_health.py` | 主检出 | 否 |
| 演进会话与评审 | `proposals/{sessions,tasks,reviews,experiments}/` | `self-evolve` | `self-evolve`、演进看板 | 主检出 | 否 |
| 摄取台账 | `ingest-state.json`、`reference-ingest-state.json` | `issue-ingest`、`reference-ingest` | 同左 | 仓根 | 是 |
| 验证回放产物 | `.s2-replay/` | `s2_replay.py`、`eval_arena.py` | `settle_s2_feedback.py`、`component_tally.py`、`ev_board_data.py`、`evolution_health.py` | 检出内 | 否 |
| 交互回放产物 | `.ixn-replay/` | `ixn_replay.py` | `ixn_replay.py` 的评分 | 检出内 | 否 |
| 回放输入与报告 | `.replay-input/`、`.replay-report.md`、`.flow-replay/` | `replay_golden.py`、`flow_pool.py` | 人 | 检出内 | 否 |
| 自动抓取候选 | `.auto-fetch/` | `auto_fetch.py` | `issue-ingest` | 检出内 | 否 |
| 调研物料 | `research/` | 人 | 人 | 检出内 | 否 |

`traces/` 与 `diagnosis_state*.yaml` 在 `.gitignore:7-8`，其余见 `.gitignore` 里各自的注释行。

### 3.2 谁在什么时候读哪份本地件

本地件被消费有两种模式。脚本读的读法确定、输入确定、输出确定，可以配门；agent 读的读法随现场变化，只能靠正文约束。这条区分决定哪些改动能进 CI：`scripts/` 下的确定性读端可以，skill 正文里的读法只能靠评审。

| 消费方 | 时点 | 读什么 | 入口 |
|---|---|---|---|
| diagnose | 步骤 3 相似检测 | 历史轨迹 | `shared_dir.py traces` |
| to-postmortem | 收尾 | 来源轨迹 | 草稿头的 `source_session` |
| 各内容 skill | 收尾 | 无（只写执行流水） | `log_skill_exec.py` |
| knowledge-groom | 反馈结算 | 轨迹里的 `feedback` 事件 | `settle_trace_feedback.py`、`.settle-state.json` |
| knowledge-groom | 验证结算 | `.s2-replay/*.result.yaml` | `settle_s2_feedback.py` |
| knowledge-groom | 引用可观测性 | 轨迹里的 `reference_lookup` | `trace_metrics.py` |
| knowledge-groom | 夹具预核 | 轨迹 | `replay_trace.py --emit-fixtures` |
| evolve-check | 内容流程收尾 | 执行流水 | `tail_exec_log.py` |
| evolve-check | 内容流程收尾 | 归因事件与容量判据 | `component_tally.py`、`metrics_health.py` |
| self-evolve | 深度轮 | 时序数据、执行流水、归因、验证待办、会话状态 | `metrics_health.py --json`、`component_tally.py`、`s2_replay.py --todo` |
| skill-review | 显式触发 | 执行流水、skill 上下文成本 | `audit_skill_cost.py`、`tail_exec_log.py` |
| resume-diagnosis | 开屏 | 自己的轨迹与交接单 | `shared_dir.py traces` |
| 诊断面板 | 打开 | 轨迹、报告、证据 | 面板自身的 `fs.resolve('traces', {cwd})` |
| 演进看板 | 打开 | 改进项卡、执行流水、实测记录、容量 | `ev_board_data.py`、`evolution_health.py --json` |

面板那一行与其余各行不同。它不调用 `shared_dir.py`，读的是当前会话的工作目录（`dsh-plugins/ascend-panel/panel-host.js:58-65`）。在 worktree 里开面板，看到的是 worktree 的 `traces/`。锚定是脚本侧的保证，不覆盖面板的轨迹读，第 5.2 节把这条列为蓝图。

### 3.3 场景：跑一次诊断

诊断期间不要求工程师多做动作，只把已经能写的信息写全。

开始前解析一次轨迹目录。`python3 scripts/shared_dir.py traces` 打印的绝对路径就是本次读写的位置，此后本会话所有轨迹读写都用它（`skills/diagnose/SKILL.md:184`）。建会话时把当时的知识库版本写进顶层 `kb_rev`（`scripts/kb_rev.py` 的末行），之后不改。

每步往轨迹追加一条事件。检索候选写在 `reason` 里，保持散文形态。改成结构化字段能让检索质量在线可算，代价是这些值由 agent 自报，事后无法复算。排序质量的可复算观测在离线回放侧，那里有冻结的对照样本。取舍的完整论证在 [ADR-0010](../adr/0010-metrics-feedback-target.md)。

收尾时写顶层 `stop_reason`、`feedback_pending_since` 和一条待回报的反馈项。报告落在轨迹同目录，证据落在 `traces/evidence/<session_id>/`。

轨迹的顶层字段如下。完整清单与取值词表见 `diagnosis_state.yaml.example` 与仓库根的 `trace-status.yaml`。

```yaml
session_id, status, current_step, summary, created_at, updated_at
kb_rev                       # 建会话时的知识库版本，之后不改
stop_reason                  # 取值见 trace-status.yaml
detected_framework, detected_platform, detected_category
report_file                  # 只写文件名，不写目录前缀
sedimented{state, case_id, inbox_path}
sediment_candidates[]        # {kind, summary, evidence, suggested_skill, status}
feedback{case, outcome, confirmed_at}
feedback_pending_since
excluded_cases[], active_case, last_action
trace[]                      # 事件列表，user 与 agent 两种 role
```

### 3.4 场景：换个 worktree 干活

改 tracked 文件的活进 worktree，本地件仍然读写主检出那一份。

worktree 里没有主检出那份 `traces/`、`postmortems/inbox/` 和 `proposals/{sessions,tasks,reviews,experiments}/`，忽略件不随 worktree 创建而复制。在 worktree 里写相对路径，记录进的是 worktree 那一份，主检出的周批与结算脚本读不到。清理 worktree 时这些记录一起消失，没有任何提示。

`scripts/exec_log_path.py:168-180` 把跨检出复用的目录与游标收进 `CHECKOUT_DIRS`，`main_checkout()` 通过 `git rev-parse --git-common-dir` 找到主检出根。agent 侧入口是 `python3 scripts/shared_dir.py <名字>`，`--list` 列出表里的名字。两个缓存根由脚本自己解析：`resolve_src_code`、`resolve_ref_docs`。

### 3.5 场景：跨机器接手

一台机器上做到一半的诊断可以换到另一台继续。`export_trace.py` 在 `traces/exports/` 下产出压缩包与单文件说明，拷到另一台后由 `import_trace.py` 落位，并在 `traces/handoff/<sid>.yaml` 留一份交接单。诊断面板据此在卡片上标出这一单是从别的机器接手来的。

跨机比对的锚点是 `kb_rev`。两台的 `kb_rev` 不一致，被排除的 case 可能在对方库里不存在、同一条 case 的置信度排序不同、甚至那条 case 当时还没沉淀出来。接手方会复现出一套与上家不同的候选集。口径与工具见 [docs/guide/handoff.md](../guide/handoff.md)。

### 3.6 场景：跑一次周批

周批读主检出的本地件，算出一期读数，写成仓库资产。

周批由任何人跑，产物落 `metrics/timeline.d/<期号>.yaml`，一期一个文件，各写各的不互相覆盖。聚合文件 `metrics/timeline.yaml` 由 `scripts/build_timeline.py` 重建，读侧只读它。这样冲突从「留哪一份读数」变成「重跑一次重建命令」。

组装的入口是 `python3 scripts/metrics_snapshot.py --kind live`。它拼三块：诊断侧读 `traces/*.yaml`，并在 `sources.diagnose_side` 里标明读的是哪一份、多少个会话；结构侧现算条数与读入成本；内容流程侧读执行流水的汇总值。拿不到的块不写。

期文件的 `metrics` 段受 `scripts/verify_metrics.py:40-60` 的字段白名单约束，未登记的字段会让校验失败。骨架如下。

```yaml
period: 2026-W41-live-1007      # YYYY-Www-live-MMDD，同天第二期加 -2
kind: live                       # live | replay | example，只有 live 参与趋势
title: "本期诊断指标"
recorded_at: '2026-10-07'        # 人复核日期
source: "metrics_snapshot.py 组装"
sources:                         # 逐块出处，组装命令写入
  diagnose_side: "trace_metrics.py（traces/*.yaml ← 主检出，N 个 session）"
  structural_side: "index_counts.py + index_read_cost.py + verify_references.py"
  content_flow_side: "log_skill_exec.py → tail_exec_log.py"
metrics:                         # 字段名受 verify_metrics.py 的 LIVE_FIELDS 约束
  sessions_total: N
  tier2_hit: N
  routed_accuracy: {ok: N, total: N}
  misdiagnosis_rate: {ok: N, total: N}
  attribution_ratio: {case_error: N, execution_error: N}
  feedback_capture: {resolved: N, not_resolved: N, partial: N}
  reference: {hits: N, refs: N}
  case_total: N
  capacity_by_ns: {...}
notes: |
  人复核时补的分母说明与异常解释
```

### 3.7 上仓形态

进仓库的指标按下表处理，判据是第 2 节那两条：读数带分母与来源，定义在样本不完整时成立。

| 形态 | 落点 | 内容 | 更新方式 |
|---|---|---|---|
| 单条知识的持久状态 | case 的 `confidence` 与 `validation_record` | 现场解决计数、外部验证计数、随时间衰减的分数 | 周批结算，走知识修改 PR |
| 周期聚合读数 | `metrics/timeline.d/<期号>.yaml` 与 `metrics/timeline.yaml` | 3.6 节的 `metrics` 段 | 一期一文件，聚合是生成物 |
| 判据数值 | `metrics/gates.yaml`、`proposals/gates.yaml` | 阈值与可解读性下限 | 机制变更时改 |
| 蒸馏结论 | `knowledge/`、`references/`、`postmortems/`、`proposals/ideas/` | 人的判断 | 各自的沉淀流程 |

每次诊断的指标不单独开一个 PR。轨迹含客户现场信息，进 git 要先逐单脱敏；生成物里不写数字是本仓库的约束，指标数值进文件会在并发合并时撞行；PR 量从每周一次变成每单一次，而每周一次是当前能维持的门控节律。

时序数据按部署分家，两种部署各自的读数为各自所有、不参与合并（[docs/guide/git-workflow.md](../guide/git-workflow.md) 的部署形态一节）。因此 `sources` 要写明这一期是在哪份检出上算的，否则读的人无法判断这个数覆盖了谁。

## 4 边界与失败模式

数据源缺席时报「不可解读」，不写 0。

| 情形 | 行为 |
|---|---|
| 没有人回报修复结果 | 命中率、误诊率、校准标为不可解读；诊断事件与成本仍会产出 |
| 事件列表键名不是 `trace` | 报该会话事件未记录，并在比例读数旁标出分母里有几个不可读会话 |
| 归因事件用了另一种字段拼法 | 两种拼法都收，并记下见到的是哪一种 |
| 验证回放结果文件在本检出不存在 | 报本检出没有结果文件，不报 0 条结算 |
| 成本日志缺失 | 该会话的成本缺席，不补估值 |
| 在 worktree 里跑周批 | 报数据源不可达，不产出空指标 |
| 无 git 环境 | 路径退化为检出内，输出里标出退化形态 |
| 案例在本机从没被选中 | 记为未被选中，不据此判定它无用 |

## 5 现状

### 5.1 已落地

本地件锚定表与两个缓存根的解析。`python3 scripts/shared_dir.py --list` 列出表里的名字，`python3 scripts/shared_dir.py traces` 打印主检出下的绝对路径。

确定性读端的消费点。`python3 scripts/settle_trace_feedback.py --audit` 复核轨迹结算的链路完整；`python3 scripts/component_tally.py` 复核归因聚合；`python3 scripts/check_handoff.py` 复核交接包往返；`node scripts/session_cost.mjs --all` 读会话账单。

周批链路与判据三态。`python3 scripts/metrics_health.py --check` 的退出码：0 无越界，1 有违反，2 有判据未被评估。

无 git 环境下的退化路径与标签。`scripts/exec_log_path.py:110-123`。

### 5.2 蓝图

| 蓝图项 | 落点 | 确认方式 | 闸门 |
|---|---|---|---|
| 事件列表键名不可读时单列计数 | `scripts/trace_metrics.py:186` | 对使用 `events` 键的那份轨迹跑 `python3 scripts/trace_metrics.py`，输出里出现未记录计数，比例读数旁标出分母构成 | 无 |
| 归因比接受两种字段拼法，只映射 `execution` | `scripts/trace_metrics.py:240-243` | 用四份合成轨迹跑单测：`verdict: execution_error` 与 `verdict: case_error` 各进一桶，`attribution_kind: execution` 同样进 `execution_error`，`attribution_kind: improvement` 不进比值 | 无 |
| 验证回放结果文件缺席时单列报出 | `scripts/settle_s2_feedback.py:130`、`scripts/component_tally.py:68`、`scripts/ev_board_data.py:843`、`scripts/evolution_health.py:88` | 在 worktree 里跑 `python3 scripts/settle_s2_feedback.py`，输出里出现本检出没有结果文件；另三个读端同法各确认一次 | 无 |
| 诊断结局的两个新读数 | 新脚本，输入轨迹事件。`no_solution` = `miss` 事件且顶层 `stop_reason` 为 `escalated_tier3` 或 `abandoned`；`conflicting_evidence` = `procedure_follow.conflict` 非空 | 对现有轨迹跑一次，输出两个计数，各自对上一个触发动作 | 计数非零前按不可解读报 |
| 案例选中次数的本地读数 | 新脚本，输入轨迹的候选相关事件，由 knowledge-groom 在运行期读 | 对现有轨迹跑一次，输出每个案例的选中次数 | 无 |
| 期文件的 `sources` 写明部署身份 | `scripts/metrics_snapshot.py` 的 `sources.diagnose_side` 文案 | 组一期骨架，该字段出现检出根 | 无 |
| 面板的轨迹读跟随会话工作目录 | `dsh-plugins/ascend-panel/panel-host.js:58-65` 的 `resolveCwd` | 在 worktree 里开面板，看读到的是哪一份 `traces/` | 先定面板服务哪个读者 |
| `confidence.partials` 拆分 | 见下段 | 结算 diff 里 `partials` 单独计数，`misdiagnoses` 不再增加 | 反馈捕获大于 0 |
| 新增期文件字段时的同步面 | 见下段 | 下次加字段时逐处核对 | 无待加字段 |

归因比的两种拼法现在没有数据可以区分。权威写入点写的是 `verdict`（`skills/diagnose/references/diagnosis-procedure.md:331`），而 `scripts/component_tally.py:56-57` 的注释记着实测「4 条归因事件、0 条含 verdict」，并说明只认一套会让整条读数静默为零。本机现在没有归因事件，所以这条缺陷是潜在的，不是正在生效的。

案例选中次数留本地、由 knowledge-groom 在运行期读，不进期文件。退休决定是全局的，而选中历史只属于这台机器；把单机的沉默写进共享读数，会让「本机没遇到过」变成「全库没人用」。`skills/knowledge-groom/SKILL.md:92-94` 已经定义了两个类别：从未被选中的不退休，被选中而近期未解决的入档。本条让第一个类别可算，并新增一类复审候选：被选中过、现场未解决、且没有反馈的案例进复审。它与入档的区别是入档需要反馈数据，复审不需要。

`confidence.partials` 的改动面比一行大。现在 `partial` 与 `not_resolved` 都记进 `misdiagnoses`（`scripts/settle_trace_feedback.py:382-383`），而「内容对但不完整」与「这条知识错了」对排序的含义相反。

改动涉及四处既有实现：回写函数 `scripts/settle_trace_feedback.py:211-216` 只改已存在的键，存量案例拿不到新字段；复核函数 `:474-476` 会把每个 `partial` 误报为「已结算但无效果」；`tests/test_settle_trace_feedback.py:105-109` 断言现状；`trace-status.yaml:68-71` 的 `counts_as` 与其余文档站点写着旧口径。

闸门是反馈捕获大于 0。没有反馈数据时，改动的是一个还没被使用过的评分规则。

新增期文件字段的同步面留给下一次。一个字段要落地，需要同时改产出脚本、`scripts/verify_metrics.py:40-60` 的白名单、`scripts/metrics_snapshot.py` 的组装与 `sources`、`docs/guide/metrics.md` 的来源表与定义表、面板的 `METRIC_LABELS` 与重建后的面板包。

若该字段带判据，另加 `metrics/gates.yaml` 与 `scripts/metrics_health.py` 的实现面。`scripts/build_timeline.py` 按结构透传，不需要改。

### 5.3 已否决

各自的代价与不选的理由在 [ADR-0010](../adr/0010-metrics-feedback-target.md)：每次诊断的指标单独上仓；把检索的查询串、topK 与分数写进轨迹；把诊断标签扩成多个人工枚举；给 case 加 `status` 字段表达生命周期；把 token 与耗时写进轨迹事件；把 `.s2-replay/` 收进主检出锚定表。

## 6 代码与文档入口

| 用途 | 入口 |
|---|---|
| 本地件锚定表 | `scripts/exec_log_path.py` 的 `CHECKOUT_DIRS`、`resolve_src_code`、`resolve_ref_docs`；agent 入口 `scripts/shared_dir.py` |
| 轨迹字段 | `skills/diagnose/references/diagnosis-trace.md`、`diagnosis_state.yaml.example`、`trace-status.yaml` |
| 轨迹读数 | `scripts/trace_metrics.py` |
| 反馈结算 | `scripts/settle_trace_feedback.py` |
| 验证回放结算 | `scripts/settle_s2_feedback.py` |
| 归因聚合 | `scripts/component_tally.py` |
| 执行流水 | `scripts/log_skill_exec.py`、`scripts/tail_exec_log.py` |
| 周批组装 | `scripts/metrics_snapshot.py` |
| 期文件校验 | `scripts/verify_metrics.py`、`scripts/build_timeline.py` |
| 体检与判据 | `scripts/metrics_health.py`、`metrics/gates.yaml` |
| 指标定义 | `docs/guide/metrics.md` |
| 成本账单 | `scripts/session_cost.mjs` |
| 跨机交接 | `docs/guide/handoff.md`、`scripts/export_trace.py`、`scripts/import_trace.py` |
| 看板 | `dsh-plugins/ascend-panel/README.md`、`dsh-plugins/ev-panel/README.md` |

## 7 外部参考

无。本文的判据都在仓库内：原则二（不变量写进结构，锚定表是它的实例）、原则八（可观测先于改进）、原则十（诚实退化）。原则原文见 [design-principles.md](../spec/design-principles.md)。外部研究的适用性判断见 [rsi-mechanism.md](rsi-mechanism.md) 最后一节。
