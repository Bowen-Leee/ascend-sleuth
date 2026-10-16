# 诊断本地产物与指标上仓

本文写清三件事：一台机器上跑完一次诊断会留下哪些文件、每个文件谁写谁读、其中哪一部分最终进仓库。它是一张产物与消费的地图，也是一份目标态规格。哪些已经落地、哪些还是蓝图，第 5 节逐块标出。

改本地产物的路径、字段或落点之前要读它。路径改错一处，另一个 skill 会静默读到空数据：实测在 worktree 里跑周批，`traces/` 不存在，诊断指标被算成空，脚本不报错（`scripts/exec_log_path.py:96-99`）。

范围是产物的清单、字段、路径、消费关系与上仓形态。不含两件事：诊断流程内部的判断规则（在 `skills/diagnose/` 正文），诊断结论怎么写（在 `docs/spec/writing-norms.md`）。

读者是要改 trace 字段、改指标脚本、改周批或 groom 的人。前置是 [docs/guide/metrics.md](../guide/metrics.md)（指标怎么算）与 [skills/diagnose/references/diagnosis-trace.md](../../skills/diagnose/references/diagnosis-trace.md)（trace 写什么）。只看一次诊断结论的工程师不必读。

## 1 解决什么问题

一个工程师在自己的机器上装一份 ascend-sleuth，跑一次诊断，agent 写下轨迹与报告。一周后他跑 groom，把结论升格成 case。一个月后他在另一台机器上接着做那单没做完的诊断。这条链上每一步都要读上一步留下的文件，而其中一半文件不进版本库。

「谁读谁」这件事现在没有一处写全。它散在十几个 skill 的正文、脚本注释和面板代码里。散着写的代价是三类事故，每一类都发生过：

**写到别处。** 在 worktree 里按正文写的相对路径写记录，落进 worktree 的 gitignore 目录。主检出的面板与周批读不到它，`git worktree remove` 对 gitignore 件不报错、也不需 `--force`，记录随之消失（`docs/guide/git-workflow.md:34-35`）。

**读到空数据。** 在 worktree 里跑周批，`traces/` 是空的，`trace_metrics.py` 报「未找到任何 traces/*.yaml」，周批照常产出一期没有诊断侧数据的快照（`scripts/exec_log_path.py:96-99`）。

**同一份数据各算一遍。** 成本数据现在有四处来源：真实账单、skill 执行流水、改进项卡的估算、上下文成本审计。四处的值不同，进仓库的时序数据一个都没有。

三类事故的共同原因是同一件事没有单一定义：**哪些文件是本地件、本地件锚在哪、谁在读它**。

## 2 最小可执行模型

一次工作的产物按一条判据分成两类：**换一台机器还能不能读到。** 能读到的进仓库，读不到的是本地件。

| 类别 | 例子 | 进 git |
|---|---|---|
| 本地件 | 诊断轨迹、报告、证据、交接包、源码缓存、执行流水 | 否 |
| 仓库资产 | case、reference、改进项卡、指标期文件 | 是 |

本地件里只有一种落点被允许：**锚在同一个克隆的主检出。** 理由是同一份检出可能有多个 worktree 在并发干活，而面板、周批、结算脚本读的始终是主检出那一份。锚定之后，"记录落在哪"从"看当时人在哪个目录"变成结构保证。

锚定的三个组成：一张路径表（`scripts/exec_log_path.py` 的 `CHECKOUT_DIRS` 与三个 `resolve_*` 函数）、一个给 agent 用的命令行入口（`python3 scripts/shared_dir.py <名字>`）、一条写作纪律（skill 正文里所有本地件路径都写成解析后的绝对路径）。

三层数据仍然分开：诊断事件由 agent 当场写，修复结果由工程师回报，成本由 harness 记账。三者靠 `session_id` 关联，聚合时才合成读数。

## 3 完整机制

### 3.1 本地产物清单

下表是本地件的全集。锚定一列写「主检出」的走 `CHECKOUT_DIRS` 或对应的 `resolve_*`；写「检出内」的按当前工作目录解析，这是现存的口径差异，第 5.2 节把它列为蓝图。

| 产物 | 路径 | 谁写 | 谁读 | 锚定 | 进 git |
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
| 摄取台账 | `ingest-state.json`、`reference-ingest-state.json` | `issue-ingest`、`reference-ingest` | 同左 | 仓根（tracked） | 是 |
| skill 执行流水 | `metrics/skill-exec-log.yaml` | `log_skill_exec.py`（各内容 skill 收尾） | 见 3.2 | 主检出 | 否 |
| 改进项实测记录 | `metrics/ev-measure-log.yaml` | `ev_measure.py --run` | 演进看板、`evolution_health.py` | 主检出 | 否 |
| 演进会话与评审 | `proposals/{sessions,tasks,reviews,experiments}/` | `self-evolve` | `self-evolve`、演进看板 | 主检出 | 否 |
| S2 回放产物 | `.s2-replay/` | `s2_replay.py`、`eval_arena.py` | `settle_s2_feedback.py`、`component_tally.py`、`evolution_health.py` | 检出内 | 否 |
| 交互回放产物 | `.ixn-replay/` | `ixn_replay.py` | `ixn_replay.py` 的评分 | 检出内 | 否 |
| 回放输入与报告 | `.replay-input/`、`.replay-report.md`、`.flow-replay/` | `replay_golden.py`、`flow_pool.py` | 人 | 检出内 | 否 |
| 自动抓取候选 | `.auto-fetch/` | `auto_fetch.py` | `issue-ingest` | 检出内 | 否 |
| 调研物料 | `research/` | 人 | 人 | 检出内 | 否 |

`traces/` 与 `diagnosis_state*.yaml` 在 `.gitignore:7-8`，其余按各自的注释行。

### 3.2 消费关系

本地件被消费有两种模式，这条区分决定了一个改动能不能进 CI。

**脚本读。** 读法确定、输入确定、输出确定，可以配门。这类消费者有：`trace_metrics.py`、`settle_trace_feedback.py`、`settle_s2_feedback.py`、`component_tally.py`、`tail_exec_log.py`、`replay_trace.py`、`verify_evidence.py`、`ev_board_data.py`、`evolution_health.py`。

**agent 读。** 读法随现场变化，只能靠纪律与正文约束。`resume-diagnosis` 读自己的轨迹、diagnose 做相似检测、groom 做语义预核都属于这类。

下表是全部消费点，按触发时点排。

| 消费方 | 时点 | 读什么 | 入口 |
|---|---|---|---|
| diagnose | 步骤 3 相似检测 | 历史轨迹 | `shared_dir.py traces` |
| diagnose | 开屏 | 未回报的反馈债 | 顶层 `feedback_pending_since`、诊断面板 |
| diagnose 收尾 | 收尾 | 无（只写） | — |
| resume-diagnosis | 开屏 | 自己的轨迹与交接单 | `shared_dir.py traces` |
| to-postmortem | 收尾 | 来源轨迹 | 草稿头的 `source_session` 指向 `traces/<id>.yaml` |
| to-postmortem / to-reference / issue-ingest / knowledge-groom | 收尾 | 无（只写执行流水） | `log_skill_exec.py` |
| knowledge-groom | 反馈结算 | 轨迹里的 `feedback` 事件 | `settle_trace_feedback.py`，游标 `.settle-state.json` |
| knowledge-groom | S2 结算 | `.s2-replay/*.result.yaml` | `settle_s2_feedback.py` |
| knowledge-groom | 引用可观测性 | 轨迹里的 `reference_lookup` | `trace_metrics.py` |
| knowledge-groom | 夹具预核 | 轨迹 | `replay_trace.py --emit-fixtures` |
| evolve-check | 内容流程收尾 | 执行流水 | `tail_exec_log.py` |
| evolve-check | 内容流程收尾 | 归因事件、容量判据 | `component_tally.py`、`metrics_health.py` |
| self-evolve | 深度轮 | 时序数据、执行流水、归因、S2 待办、会话状态 | `metrics_health.py --json`、`component_tally.py`、`s2_replay.py --todo` |
| skill-review | 显式触发 | 执行流水、skill 上下文成本 | `audit_skill_cost.py`、`tail_exec_log.py` |
| 诊断面板 | 打开 | 轨迹、报告、证据、时序数据、判据 | 面板 RPC 与 `shared_dir.py traces` |
| 演进看板 | 打开 | 改进项卡、执行流水、实测记录、容量 | `ev_board_data.py`、`evolution_health.py --json` |

### 3.3 场景：跑一次诊断

结论：诊断期间不新增人工动作，只把已经能写的信息写全。

诊断开始时先解析一次轨迹目录，`python3 scripts/shared_dir.py traces` 打印的绝对路径就是本次读写的位置，此后本会话所有轨迹读写都用它（`skills/diagnose/SKILL.md:184`）。建会话时把当时的知识库版本写进顶层 `kb_rev`（`scripts/kb_rev.py` 的末行），之后不改。

每步往轨迹追加一条事件。检索候选写在 `reason` 里，保持散文形态。这里有一个取舍：把候选清单改成结构化字段，能让检索质量在线可算；保留散文，能让 agent 把判断依据写完整，而排序质量的强观测在离线回放侧（`scripts/rank_candidates.py --eval`、`scripts/eval_arena.py` 的门控）。ADR-0010 记了这条取舍。

收尾时写三样：顶层 `stop_reason`、`feedback_pending_since`、以及待回报的反馈项。报告落在轨迹同目录，证据落在 `traces/evidence/<session_id>/`。

产物规格：

```yaml
# traces/<session_id>.yaml（顶层关键字段，完整清单见 diagnosis_state.yaml.example）
session_id, status, current_step, summary, created_at, updated_at
kb_rev                       # 建会话时的知识库版本，之后不改
stop_reason                  # 六值词表，见 trace-status.yaml
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

结论：改 tracked 文件的活进 worktree，本地件仍然读写主检出那一份。

一个 worktree 是同一个仓库的第二份检出。它的 `traces/`、`postmortems/inbox/`、`proposals/{sessions,tasks,reviews,experiments}/` 都是空的，因为 gitignore 件不随 worktree 创建而复制。在 worktree 里写相对路径，记录进的是 worktree 那一份，主检出的面板、周批、结算脚本都读不到；清理 worktree 时这些记录消失且没有任何提示。

`scripts/exec_log_path.py` 的 `CHECKOUT_DIRS` 把七类目录与一个游标文件收进同一张表，`main_checkout()` 通过 `git rev-parse --git-common-dir` 找到主检出根。`python3 scripts/shared_dir.py <名字>` 是 agent 侧的命令入口。表里的名字：

```
traces | inbox | proposals-sessions | proposals-tasks | proposals-reviews
proposals-experiments | ref-docs | settle-state
```

三个由脚本自己解析的本地件根走另一组函数：`resolve_src_code`、`resolve_ref_docs`、`resolve`（执行流水）。语义与上表相同。

### 3.5 场景：跨机器接手

一台机器上做到一半的诊断可以换到另一台继续。做法是导出一个交接包，`traces/exports/` 下的压缩包与单文件说明，拷到另一台后由 `import_trace.py` 落位，并在 `traces/handoff/<sid>.yaml` 留一份交接单。诊断面板据此在卡片上标出「从另一台机器接手来的」。

跨机比对的锚点是 `kb_rev`。两台的 `kb_rev` 不一致，意味着被排除的 case 可能在对方库里不存在、同一条 case 的置信度排序不同、甚至那条 case 当时还没沉淀。接手方会复现出一套与上家不同的候选集而不自知。口径在 [docs/guide/handoff.md](../guide/handoff.md)。

### 3.6 场景：跑一次周批

结论：周批读主检出的本地件，算出一期读数，写成仓库资产。

周批由任何人跑，产物落 `metrics/timeline.d/<期号>.yaml`，一期一个文件，各写各的不互相覆盖；聚合文件 `metrics/timeline.yaml` 由 `scripts/build_timeline.py` 重建。这样冲突从「留哪一份读数」变成「重跑一次重建命令」。

组装的入口是 `python3 scripts/metrics_snapshot.py --kind live`，它把三块拼成骨架：诊断侧读 `traces/*.yaml`（自动解析该读哪一份并在 `sources.diagnose_side` 标明）、结构侧现算条数与读入成本、内容流程侧读执行流水的汇总值。拿不到的块不写，不补零。

期文件规格：

```yaml
period: 2026-W41-live-1007      # YYYY-Www-live-MMDD，同天第二期加 -2
kind: live                       # live | replay | example，只有 live 参与趋势
title: "本期诊断指标"
recorded_at: '2026-10-07'        # 人复核日期，脚本预填的当天不算已复核
source: "metrics_snapshot.py 组装"
sources:                         # 逐块出处，组装命令写入
  diagnose_side: "trace_metrics.py（traces/*.yaml ← 主检出，N 个 session）"
  structural_side: "index_counts.py + index_read_cost.py + verify_references.py"
  content_flow_side: "log_skill_exec.py → tail_exec_log.py"
metrics:                         # 字段名受 scripts/verify_metrics.py 的 LIVE_FIELDS 白名单约束
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

进仓库的指标只有四种形态，判据都是「换一台机器能不能用同一份输入重算出来」。

| 形态 | 落点 | 内容 | 更新方式 |
|---|---|---|---|
| 单条知识的持久状态 | case 的 `confidence` 与 `validation_record` | 现场解决计数、外部验证计数、随时间衰减的分数 | 周批结算，走知识修改 PR |
| 周期聚合读数 | `metrics/timeline.d/<期号>.yaml` + `metrics/timeline.yaml` | 3.6 节的 metrics 段 | 一期一文件，聚合是生成物 |
| 判据数值 | `metrics/gates.yaml`、`proposals/gates.yaml` | 阈值与可解读性下限 | 机制变更时改 |
| 蒸馏结论 | `knowledge/`、`references/`、`postmortems/`、`proposals/ideas/` | 人的判断 | 各自的沉淀流程 |

每次诊断的指标不单独开一个 PR。三条理由按份量排：轨迹含客户现场信息，进 git 要先逐单脱敏；生成物里不写数字是本仓库的硬约束，指标数值进文件会在并发合并时撞行；PR 量会从每周一次变成每单一次，而每周一次是当前能维持的门控节律。

**目标态新增的四个计时字段。** 它们都满足两个条件：不需要工程师多做动作，且各自触发一个不同的修复动作。

```yaml
# 加进 metrics.timeline.d/<期号>.yaml 的 metrics 段，须同步 verify_metrics.py 的 LIVE_FIELDS
case_exposure:                   # 案例被选中次数，窗口 12 周
  cold: N                        # 窗口内没被选中过 → 不退休
  hot_unresolved: N              # 选中多而现场未解决 → 进复审
outcome_labels:                  # 从已记录事件导出，不新增人工枚举
  no_solution: N
  conflicting_evidence: N
  misdiagnose_case: N
  misdiagnose_execution: N
  partial: N
ev_measure:                      # 改进项的实测执行情况
  runs: N
  passed: N
  never_run_cards: N
ev_outcomes:                     # 改进项的结局分布，用于看拒绝域是否为空
  validated: N
  superseded: N
  rejected: N
```

`attribution_ratio` 增加第三个桶 `improvement_or_design`，对应生产端写的 `attribution_kind` 里 `improvement` 与 `design` 两个值。它们不是误诊归因，混进 `case_error` 或 `execution_error` 会让那条读数失去含义。

新增一个期文件字段要同时改四处，缺一处下一期快照会被 CI 拦下或字段静默丢失：

1. `scripts/verify_metrics.py` 的 `LIVE_FIELDS`
2. `scripts/metrics_snapshot.py` 的组装逻辑
3. `scripts/trace_metrics.py` 或对应产出脚本的计算
4. `docs/guide/metrics.md` 的定义表

## 4 边界与失败模式

数据源缺席时报「不可解读」，不写 0。

| 情形 | 行为 |
|---|---|
| 没有人回报反馈 | 命中率、误诊率、校准标为不可解读；诊断事件与成本照常产出 |
| 事件列表键名不是 `trace` | 报「该会话事件未记录」并单列计数，比例读数旁标出分母里有几个不可读会话 |
| 归因事件写的是 `attribution_kind` | 两种写法都收，`improvement` 与 `design` 单列一桶 |
| 成本日志缺失 | 该会话的成本缺席，不补估值 |
| 在 worktree 里跑周批 | 报「数据源不可达」，不产出空指标 |
| 案例窗口内从没被选中 | 记为 `cold` 且不退休 |
| 改进项从没跑过自己的判据 | 报「声明了可复现判据却未实测」 |

## 5 现状

### 5.1 已落地

本地产物的锚定：七类目录与一个游标文件收进 `CHECKOUT_DIRS`，`shared_dir.py` 是 agent 入口，`resolve_src_code` 与 `resolve_ref_docs` 覆盖两个缓存根。核对方式：`python3 scripts/shared_dir.py traces` 打印主检出下的绝对路径。

消费关系里的脚本读那一半全部可用：轨迹结算、S2 结算、归因聚合、执行流水聚合、夹具派生、证据核对、看板组装。核对方式：`python3 scripts/settle_trace_feedback.py --audit`。

周批链路：期文件与生成物分离、字段白名单、三态退出码的体检器、读入成本现算。核对方式：`python3 scripts/metrics_health.py --check`。

跨机器接手：交接包导出与导入、交接单、`kb_rev` 比对。核对方式：`python3 scripts/check_handoff.py`。

### 5.2 蓝图

**本地件的锚定补齐。** `.s2-replay/` 按当前工作目录解析而不是锚主检出（`scripts/settle_s2_feedback.py:48`、`scripts/component_tally.py:68`、`scripts/evolution_health.py:77`）。同一条问题在 `traces/` 上已经解决，S2 与元层评测台的产物还没收进那张表。后果一样：在 worktree 里跑 S2 回放，主检出的 groom 读不到结果。

**上仓不足的部分。** 改进项的实测记录 `metrics/ev-measure-log.yaml` 有实测数据，有演进看板与体检器两个消费者，却没有进期文件的落点。成本数据同理：四处来源，一处都不进时序数据，而 `skills/self-evolve/SKILL.md:50` 已经让深度轮去读时序数据里的「token 趋势」，那个字段不在白名单里。

**3.7 节的四个计时字段与其配套改动。**

**反馈的采样时点。** 追问发生在下一次诊断开屏时，而修复是否生效只有工程师知道。目标态把反馈出口放到报告尾部与诊断对话末尾，入口收成一行预填确认。这一条不改 trace schema，改动落在 `skills/diagnose/SKILL.md` 的追问节、`skills/resume-diagnosis/SKILL.md` 的开屏节与报告模板的尾部。

**声明了没有实现的指标。** `docs/guide/metrics.md:63` 定义了流程加载率与跟随深度，`scripts/trace_metrics.py` 的指标表里没有该字段。要么补实现，要么删定义。

**待定，附闸门。** groom 变更摘要的仓库落点：摘要现在只存在于会话文本里，载体是 PR 描述加一个 groom 报告。按检查准入三条（机械可查、后果确定、复发至少两次）缺第三条，复发证据还没有，暂不立。

### 5.3 已否决

六条，各自的代价与不选的理由在 [ADR-0010](../adr/0010-metrics-feedback-target.md)：

每次诊断的指标单独上仓；把检索的查询串、topK 与分数写进轨迹；把诊断标签扩成五个人工枚举；给 case 加 `status` 字段表达生命周期；把 token 与耗时写进轨迹事件；给「不采纳」设配额。

## 6 代码与文档入口

| 用途 | 入口 |
|---|---|
| 本地件锚定表与解析 | `scripts/exec_log_path.py`（`CHECKOUT_DIRS` 在 `:168-180`）、`scripts/shared_dir.py` |
| 轨迹写什么 | `skills/diagnose/references/diagnosis-trace.md`、`diagnosis_state.yaml.example` |
| 轨迹读数 | `scripts/trace_metrics.py` |
| 反馈结算 | `scripts/settle_trace_feedback.py` |
| S2 结算 | `scripts/settle_s2_feedback.py` |
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

无。本文的判据都在仓库内：原则二（不变量写进结构，锚定表是它的实例）、原则八（可观测先于改进）、原则十（诚实退化）。外部研究的适用性判断见 [rsi-mechanism.md](rsi-mechanism.md) 最后一节。
