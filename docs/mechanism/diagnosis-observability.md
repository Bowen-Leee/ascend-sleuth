# 一次诊断记录什么、怎么上仓

诊断在本机跑，记录也留在本机；只有汇总后的读数会提交进仓库，下文把这件事叫上仓。本文说明一次诊断产出哪些文件与字段、这些记录怎么攒成可以提交的形式、以及在多人、多 worktree、多次回报的条件下怎么不出冲突。

读者是要改轨迹字段、上仓脚本、面板或知识整理流程的人。前置有三件：诊断六步各写什么，见 [diagnosis-trace.md](../../skills/diagnose/references/diagnosis-trace.md)；指标怎么算，见 [metrics.md](../guide/metrics.md)；机制层怎么演化，见 [rsi-mechanism.md](rsi-mechanism.md)。只想拿到一次诊断结论的工程师不必读。

取舍与被否决的方案在 [ADR-0011](../adr/0011-diagnosis-observability-data-plane.md)。

## 1 解决什么问题

这套记录要回答五个问题。

1. 一次诊断产出什么数据、什么产物、记哪些字段。
2. 本机跑了十次诊断，怎么变成仓库里的一份读数。
3. 观测数据与案例库、先验库是否解耦，加观测要不要动知识条目。
4. 多人提 PR 时，同一条案例的读数变化会不会撞车，改动面有多大。
5. 工程师回报「解决 / 没解决」时，读数能不能跟着准确更新。

现状有五个缺口，每条都能在本机复算。

1. 轨迹里有事件，但没有脚本把它汇总成一次诊断的成本与用到的知识（`scripts/settle_trace_feedback.py:16` 记着「数据都在 traces 里，但没有任何脚本产出它」）。
2. 仓库里的汇总只到条目级一处：期文件的 `metrics.reference_detail`（某条先验被引用几次），案例侧没有对应数据。
3. 有十个指标有产出、也在字段白名单里，8 期期文件一次都没写过（复算：见 3.6 的说明；白名单在 `scripts/verify_metrics.py:35-58`）。
4. 归因比读错了键，恒为 0（读端 `scripts/trace_metrics.py:240` 读 `verdict`，生产端写 `attribution_kind`）。
5. 三期现场快照的反馈捕获都是 0（`metrics/timeline.d/` 的三条 live 期），命中率与误诊率因此没有分母。

本文不解决四件事。诊断流程内部的执行规则在 `skills/diagnose/` 正文里。检索不上向量库（见 [ADR-0002](../adr/0002-retrieval-no-rag-lightweight-index.md)）。指标算法与评分定义只有人能改。读数不做跨部署合并。

## 2 最小可执行模型

记录分三层，只有后两层进仓库。

| 层 | 内容 | 键 | 谁写 | 进 git |
|---|---|---|---|---|
| 一次诊断 | 这次诊断的路由、行为、成本、结局、碰到的知识条目（下文叫触达） | `session_id` | 收尾时由脚本从轨迹与会话日志汇总 | 否，含客户现场信息 |
| 条目使用记录 | 某个案例或先验在一期内的使用增量 | 条目 id 与运行号 | 知识整理时由脚本追加 | 是 |
| 期 | 一个部署在一期内的全部读数，部署身份写在期文件的 `sources` 里 | 期号（一期一个文件） | 组装脚本产出，维护者复核分母 | 是 |

```mermaid
%%{init: {'themeVariables':{'fontSize':'14px'},'flowchart':{'curve':'basis','nodeSpacing':40,'rankSpacing':50,'padding':10}}}%%
flowchart LR
    TR["轨迹 traces/&lt;session_id&gt;.yaml"] --> EP["一次诊断的记录<br/>一行，留在本机"]
    LG["harness 会话日志<br/>token 与工具耗时"] --> EP
    EP -->|"知识整理时汇总"| PF["metrics/entry-activity.d/&lt;周&gt;.yaml<br/>源，进 git"]
    PF --> EA["metrics/entry-activity.yaml<br/>生成物"]
    EP -->|"周界那一次"| TD["metrics/timeline.d/&lt;期号&gt;.yaml<br/>源，进 git"]
    TD --> TI["metrics/timeline.yaml<br/>生成物"]
    TI --> V1["单次诊断的面板"]
    EA --> V1
    EA --> V2["累计读数的面板"]
    TI --> V2
    EA --> GR["知识整理：复审、退休"]

    classDef store fill:#f1f3f5,stroke:#868e96,stroke-width:1.5px,color:#343a40
    classDef gen fill:#fff4e6,stroke:#e8590c,stroke-width:1.5px,color:#7a2e00
    classDef view fill:#e7f5ff,stroke:#1971c2,stroke-width:1.5px,color:#0b3d66
    class EP,PF,TD store
    class EA,TI gen
    class V1,V2,GR view
```

图 1　一次诊断的记录与上仓（类型：数据流图；范围：从本机记录到面板与知识整理，省略结构侧与评测侧指标）

图例：灰色是本机记录与源文件，橙色是生成物，蓝色是消费方。图里「知识整理时汇总」是一个动作，不是第四层记录。

两块面板取同一份数据。单次诊断的面板摊开这一次：走对了没有、成本落在哪一步、哪些动作没有推进。累计读数的面板合并多期：被用得最多的案例与先验、最花成本的过程动作、正在变差的读数。

## 3 完整机制

### 3.1 一次诊断产出什么

一次诊断在本地留下四样东西，第五样是本设计要补的。

| 产物 | 路径 | 内容 |
|---|---|---|
| 轨迹 | `traces/<session_id>.yaml` | 顶层字段加事件列表，每步一条 |
| 报告 | `traces/<session_id>.report.md` | 人读结论，与轨迹同目录 |
| 证据原件 | `traces/evidence/<session_id>/` | 工程师贴回的日志、截图 |
| 会话账单 | DSH 会话日志 | 提供方用量与工具耗时，按 `session_id` 关联 |
| 诊断记录（待补） | 本机派生，不落轨迹 | 上面四样汇总成一行，供汇总脚本读 |

其余本地件（源码缓存、上游文档缓存、回放产物、调研物料等）的路径见 [git-workflow.md](../guide/git-workflow.md) 的目录归属表，本文不重复。

这一行的字段如下。明细留本机，上仓只放聚合值；标「待接」的需要新增汇总代码。

| 字段 | 明细（本机，每会话） | 上仓形态 | 来源 | 状态 |
|---|---|---|---|---|
| `session_id` | 会话号 | 只做关联键 | 轨迹顶层 | 现成 |
| `window` | 起止时间 | 会话时长分布 | `created_at`、`updated_at` | 现成 |
| `detected` | 框架、平台、类别 | 按类别的会话数 | 轨迹顶层 | 现成 |
| `route` | 路由到的命名空间、候选数量、加载条数、命中案例 | 路由准确率、漏检类别、候选数与候选超出预算的比例（这些指标的定义见 3.6） | `triage`、`load_index`、`load_full`、`hit` | 现成 |
| `steps` | 步骤序列与各动作次数 | 各动作次数分布、步数中位数与 P90 | 事件计数 | 现成 |
| `tool_calls` | 每次工具调用一条：工具名、耗时、成功与否、命令摘要 | 按工具的次数、耗时中位数与 P90、失败与超时数 | 会话日志 | 待接 |
| `touched` | 触达的案例 id 与先验 id，各带触达方式 | 条目使用记录 | `hit`、`load_full`、`reference_lookup`、`excluded_cases` | 现成 |
| `outcome` | 最终状态、是否给出 fix、反馈结果 | 反馈捕获、误诊率、归因比 | 顶层 `status`、`resolved_at`、`feedback` | 现成 |
| `sedimented` | 沉淀状态与案例 id | 沉淀漏斗 | 顶层 `sedimented` | 现成 |
| `cost.tokens` | 未缓存输入、缓存读、缓存写、输出 | 会话成本中位数与 P90、按动作占比 | 会话日志按 `(turn, step)` 去重 | 待接 |
| `cost.index_read_tok` | 一次诊断读进来的 token 账，四个分项 | 命名空间 × 类别格子的读入成本 | `scripts/index_read_cost.py` 按视图现算；按会话归属还没有产出方 | 待接 |
| `strength` | 结论强度档 | 强度分布 | 见下表 | 待接 |

字段取值如下表。枚举值照原样写，改中文读者对不上数据。

| 字段 | 类型 | 取值 | 说明 |
|---|---|---|---|
| `strength` | 枚举 | `upstream-fix-merged`、`upstream-official-doc`、`upstream-maintainer-confirmed`、`engineer-report`、`investigation`，以及本文新增的 `self-report` | 结论靠什么证据站住。命中案例时取该案例的 `verification.source`；无案例、靠源码分析或现场推理得出结论取 `investigation`；来源会话自报解决取 `self-report`（这一档是本文新增的，现有三处出处都还没有它）。前五档的来源与判据见 `examples/sample-case.yaml:49`、`skills/knowledge-groom/SKILL.md:81-91`、`skills/to-postmortem/SKILL.md:85` |
| `route.routed` | 字符串 | 命名空间，如 `inference/vllm-ascend` | 路由判定结果，空表示没判出来 |
| `route.hit_case` | 字符串或空 | 案例 id | 阶段一命中的案例，与最终沉淀的案例可以不同 |
| `touched.cases` | 列表 | 案例 id | 含命中、被加载、被排除三种触达方式 |
| `touched.references` | 列表 | 先验词条 id | 来自 `reference_lookup` |
| `outcome.status` | 枚举 | `in_progress`、`resolved`、`escalated`、`archived`、`unknown` | 词表在 `trace-status.yaml:16-53`。`abandoned` 不在这里，它是顶层 `stop_reason` 的取值 |
| `outcome.feedback.outcome` | 枚举 | `pending`、`resolved`、`not_resolved`、`partial` | 现场回报结果，`pending` 表示还没回报 |
| `sedimented.state` | 枚举 | `none`、`submitted`、`knowledge`、`archived` | 未沉淀、草稿待审、已进知识库、转历史资料兜底检索（Tier 3） |
| `tool_calls[].tool` | 字符串 | 工具名，如 `Grep`、`Read`、`Bash` | harness 侧的工具标识 |
| `tool_calls[].ms` | 整数 | 毫秒 | 单次调用耗时 |
| `tool_calls[].ok` | 布尔 | `true` / `false` | 失败或超时记 `false`，原因写 `error` |
| `cost.tokens` | 映射 | `uncached`、`cache_read`、`cache_write`、`out` | 四类 token 数，按 `(turn, step)` 去重后统计 |

条目使用记录里的计数各自只回答一个问题，口径如下。

| 计数 | 含义 | 什么事件算一次 |
|---|---|---|
| `selected` | 这个条目进了候选集 | 案例出现在 `considered_candidates`、`load_index` 或 `load_full` 的候选里 |
| `loaded` | 读了它的正文 | `load_full` 的 `candidates` 含它 |
| `resolved` | 用它解决了问题 | 该案例收到 `feedback.outcome: resolved` |
| `misdiagnosed` | 用了它但没解决 | `feedback.outcome` 是 `not_resolved` 或 `partial` |
| `self_resolved` | 来源会话自己回报解决 | 来源会话的 resolve，与 `resolved` 分开计 |
| `lookups` | 查了一条先验 | 一次 `reference_lookup` 事件 |
| `hit` / `miss` / `skipped` | 查到 / 查了没命中 / 没查并写了理由 | `reference_lookup.outcome` 的三种取值 |
| `excluded` | 候选被排除 | 出现在 `excluded_cases` 或 `miss` 的 `excluded_cases` 里 |
| `purpose` | 为什么查这条先验 | `reference_lookup.purpose`：`collect`、`signature`、`background`、`fix`、`procedure` |

工具调用按次记，不合成一个总耗时。一次诊断里的工具调用几十次，单次耗时从几十毫秒到几万毫秒都有，失败与重试也各占一部分。要判「哪个工具该设硬超时」「失败集中在哪一步」「哪些调用读了却没被引用」，只用总耗时答不了。

```yaml
tool_calls:
  - {step: 5, tool: Grep, ms: 1820, ok: true,  args: "hidden in should be|smaller|lora"}
  - {step: 5, tool: Read, ms: 240,  ok: true,  file: references/tools/msprobe-compare.yaml}
  - {step: 6, tool: Bash, ms: 9200, ok: false, args: "gh api repos/vllm-project/vllm-ascend/issues/12430", error: timeout}
```

明细不上仓，原因是命令原文与文件路径含现场信息。上仓的是按工具聚合后的分布（形态见 3.3）。

明细不上仓不等于演进看不到它们。演进信号的读法分两层。第一层看仓库里的读数：哪些条目被选中却长期不解决、哪类漏检集中、哪个动作的成本占比在涨。第二层回本机明细：要判断某一类问题为什么贵、探索策略该改哪一处时，读本地记录里的步骤、工具调用与源码检索过程，这些细节只在产生它的那台机器上。

两层都能定位到具体对象：上仓读数带部署、期号与运行号，本机记录带 `session_id` 与 `kb_rev`。跨机要复现细节时走交接包（[handoff.md](../guide/handoff.md)）。

一条真实轨迹折出来的样子（取自 `traces/2026-09-16-12430-dsv4pro-mc2.yaml`，`cost` 段为待接字段，未填数值）。

```yaml
session_id: 2026-09-16-12430-dsv4pro-mc2
window: {start: '2026-09-16T16:00:00+08:00', end: '2026-09-16T18:20:00+08:00'}
detected: {framework: vllm-ascend, platform: A2-910B, category: interrupt}
route:
  routed: inference/vllm-ascend
  hit_case: VLLM-ASC-9005          # 检索命中的是 9005
steps: {count: 32, reference_lookup: 7, report: 6, attribution: 4, quickly_check: 3, ...}
touched:
  cases: [VLLM-ASC-9005, VLLM-ASC-12430, VLLM-ASC-12461, VLLM-ASC-7635, VLLM-ASC-9887, VLLM-ASC-13688, VLLM-ASC-10944]
  references: [cann-runtime-error-codes, cann-hdk, ascend-moe-comm-triage, aicore-error-fault-patterns, operator-exec-fault-patterns]
outcome: {status: resolved, fix_emitted: true, feedback: {case: VLLM-ASC-12430, outcome: resolved, confirmed_at: '2026-09-16'}}
sedimented: {state: knowledge, case_id: VLLM-ASC-12430}
cost: {tokens: {uncached: -, cache_read: -, cache_write: -, out: -}, index_read_tok: -}
tool_calls:                        # 逐次，见上表
strength: self-report              # 来源 session 自证，见 3.5
```

改汇总脚本时要处理两件事。检索命中的案例（9005）与最终沉淀的案例（12430）不是同一个，两个 id 各算一次触达。被排除的五个案例（`excluded_cases`）也算触达，它们是「检索到但被排除」，与「命中」分开计数。

### 3.2 什么时候汇总、谁触发

三个动作、两个 PR 流，顺序固定。

```mermaid
%%{init: {'themeVariables':{'fontSize':'14px'},'flowchart':{'curve':'basis','nodeSpacing':40,'rankSpacing':50,'padding':10}}}%%
flowchart TB
    D1["工程师：出问题时跑一次诊断"] --> L[("本机记录<br/>轨迹、账单")]
    L -->|"每次知识整理，追加记录"| G1["知识整理（groom）：升格草稿 → 结算回报 → 汇总记录 → 算分 → 复审与退休 → 索引"]
    G1 -->|"周界那一次"| G2["组装本期读数"]
    G1 --> P1["PR 1：知识变更 + 记录 + 本期读数"]
    G2 --> P1
    L -->|"内容流程收尾 / 深度轮"| V1["收尾评估（evolve-check）或深度轮（self-evolve）<br/>读上仓读数，需要时回本机明细"]
    P1 --> V1
    V1 -->|"有信号"| V2["改进项卡片 → 执行 → 验证"]
    V2 --> P2["PR 2：机制改动<br/>skill 正文、脚本、流程"]
    P2 -.->|"下一轮生效"| D1
    P2 -.->|"下一轮生效"| G1

    classDef human fill:#e7f5ff,stroke:#1971c2,stroke-width:1.5px,color:#0b3d66
    classDef store fill:#fff4e6,stroke:#e8590c,stroke-width:1.5px,color:#7a2e00
    classDef pr fill:#f1f3f5,stroke:#868e96,stroke-width:1.5px,color:#343a40
    class D1,G1,G2,V1,V2 human
    class L store
    class P1,P2 pr
```

图 2　三个触发点与两个 PR 流（类型：数据流图；范围：诊断、知识整理、机制演进三条时间线）

图例：蓝色是动作，橙色是本机记录，灰色是 PR。实线传数据，虚线是下一轮生效。

三件事。诊断只在本机留记录，不进仓库。知识面的动作都在同一次知识整理里，一次运行追加一次记录，不重写已经写下的内容；本期读数只在周界那一次组装，一周一期。机制面的动作走另一条线：收尾评估（`evolve-check`）在内容流程收尾时自动跑，深度轮（`self-evolve`）在人要求做深度轮时跑。两者都先读上仓读数，要定位原因时回本机明细；有信号才产改进项卡片（`proposals/ideas/` 下的 EV 卡），卡攒批进一个 PR。

三类动作的边界如下。判据强度、失败代价与节律都不同，因此不合并。

| | 知识整理（groom） | 收尾评估（evolve-check） | 深度轮（self-evolve） |
|---|---|---|---|
| 触发 | 维护者每周跑，一天多次也行 | 知识整理收尾自动跑 | 人显式要求 |
| 做什么 | 按规则处理：升格、结算、汇总、算分、复审与退休、索引与本期读数 | 读本轮数据对照触发条件表，判断有没有机制面信号 | 跨轮聚合观察，提出并执行机制改动 |
| 判据 | 规则与记录，不需要假设 | 触发条件表（`skills/evolve-check/SKILL.md`） | 假设加前后对照与判据 |
| 产出 | 案例变更 + 条目使用记录 + 本期读数 | 有信号才产改进项卡片，不直接改机制 | 卡片执行、验证、攒批 |
| 进哪个 PR | PR 1：知识变更 | 攒批后 PR 2：机制改动 | 同 PR 2 |
| 并行度 | 一个主 agent 顺序跑完，不并行，因为改的是同一批文件 | 轻量，同会话或另起都行 | 卡片之间可并行，撞同一批文件的串行；合入判断留给人 |

分开的三条理由。判据不同：知识整理照规则处理，机制演进提出假设并验证，评审者不该在同一个 diff 里同时判这两类事。失败代价不同：知识整理错了是知识库错，能软退休、能 revert；机制错了会影响之后每一次诊断，要对照集与回滚路径。节律不同：知识整理每周必做，机制演进有信号才做，可以跨周攒批。

两条不做的事：不在知识整理里跑实验，那会把未验证的机制改动混进知识 PR，也拖长整理的时间；不把两个 PR 合成一个，它们的模板、评审人与回退粒度都不同。

一次知识整理内部的顺序如下。本文的步骤编号自成一套，与 `skills/knowledge-groom/SKILL.md` 正文的编号不同名也不同数；那边的「软退休」对应本文第 5 步「复审与退休」。

```mermaid
%%{init: {'themeVariables':{'fontSize':'14px'},'flowchart':{'curve':'basis','nodeSpacing':30,'rankSpacing':46,'padding':10}}}%%
flowchart TB
    S1["1 处理 inbox<br/>草稿升格为 case"] --> S2["2 结算现场回报"]
    S2 --> S2B["2b S2 验证结算"]
    S2B --> S3["3 汇总本机诊断记录"]
    S3 --> R[("metrics/entry-activity.d/&lt;周&gt;.yaml<br/>追加一行行记录")]
    R --> S4["4 算分<br/>记录计数 + 冷启动先验"]
    S4 --> S5["5 复审与退休"]
    S5 --> S6["6 索引重建<br/>分数落在索引生成物"]
    S4 --> S6
    S5 --> C2[("案例内容或 _archive/")]
    S6 --> S7["7 周界：组装本期读数"]
    S6 --> PR["同一个 PR<br/>知识变更 + 记录 + 本期读数"]
    S7 --> PR

    classDef step fill:#e7f5ff,stroke:#1971c2,stroke-width:1.5px,color:#0b3d66
    classDef store fill:#fff4e6,stroke:#e8590c,stroke-width:1.5px,color:#7a2e00
    classDef pr fill:#f1f3f5,stroke:#868e96,stroke-width:1.5px,color:#343a40
    class S1,S2,S2B,S3,S4,S5,S6,S7 step
    class R,C2 store
    class PR pr
```

图 3　一次知识整理内部的顺序（类型：数据流图；范围：八个步骤与每步写的文件）

图例：蓝色是步骤，橙色是被写的文件，灰色是最终 PR。分数不在源文件里，只由第 6 步写进索引生成物。

| 步骤 | 做什么 | 入口 | 写哪里 |
|---|---|---|---|
| 1 处理 inbox | 草稿升格为 case | `knowledge-groom` 的 intake 步骤 | `knowledge/<ns>/…yaml` |
| 2 结算现场回报 | 把 `feedback` 事件折成计数 | `scripts/settle_trace_feedback.py --apply` | 追加进条目使用记录 |
| 2b S2 验证结算 | 把回放结果折成外部验证记录 | `scripts/settle_s2_feedback.py --apply` | 案例的 `validation_record` |
| 3 汇总本机记录 | 按 id 折算本次增量与工具分布 | 新增汇总脚本 | 追加进条目使用记录 |
| 4 算分 | 读记录计数与冷启动先验（条目还没有现场记录时用的初始分），算出每个条目的分数 | 新增算分脚本 | 不落盘，作为第 5、6 步的输入 |
| 5 复审与退休 | 按记录与分数改内容或存续 | `knowledge-groom` 的复审步骤 | 案例文件或 `_archive/` |
| 6 容量与索引 | 容量表、重建索引并把分数写进生成物 | `scripts/index_read_cost.py`、`scripts/build_index.py` | `knowledge/_index*` 生成物 |
| 7 组装本期读数 | 只做本期读数，周界那一次 | `scripts/metrics_snapshot.py` | `metrics/timeline.d/<期号>.yaml` |

「降置信」不是单独一步。分数由第 4 步算出来，低分就是降置信的结果；第 5 步做的是内容层的事：复审、合并、退休、补样例。

### 3.3 记录与生成物

条目使用记录与本期读数分开放，因为粒度不同：前者每次运行都增长，后者按周看趋势。`metrics/` 下因此有五份文件，两份是源、两份是生成物、一份是判据。

| 文件 | 角色 | 谁写 | 进 git | 谁读 |
|---|---|---|---|---|
| `metrics/entry-activity.d/<周>.yaml` | 源：条目使用记录，一周一个文件，每次运行追加若干行 | 汇总与结算脚本 | 是 | 聚合脚本 |
| `metrics/timeline.d/<期号>.yaml` | 源：本期读数，一周一期 | 组装脚本产出，维护者复核分母 | 是 | 聚合脚本 |
| `metrics/entry-activity.yaml` | 生成物：按 id 汇总 | `scripts/build_entry_activity.py` | 是 | 面板、知识整理 |
| `metrics/timeline.yaml` | 生成物：全部期文件合成一条时间线 | `scripts/build_timeline.py` | 是 | 面板、体检器、演进看板 |
| `metrics/gates.yaml` | 判据数值，不是指标 | 人 | 是 | 体检器（`scripts/metrics_health.py`） |

记录必须一行一条。`merge=union` 是行级合并：嵌套结构里两人在同一处各插一段，会拼出非法 YAML。这条教训仓库里已经记过（`.gitattributes` 里对 `knowledge/_index.yaml` 为什么不配 union 的注释）。所以源文件压成一行一条自包含的记录，每行带 `run`、`kind` 与 `id`：

```yaml
# metrics/entry-activity.d/2026-W42.yaml（一周一个文件，每次知识整理追加若干行）
- {run: 2026-10-16-0920, deployment: local-a2, checkout: a1b2c3d, kb_rev: 2a931ee, sessions: 3, kind: case, id: VLLM-ASC-12430, selected: 3, loaded: 2, resolved: 1, misdiagnosed: 0}
- {run: 2026-10-16-0920, deployment: local-a2, checkout: a1b2c3d, kb_rev: 2a931ee, sessions: 3, kind: ref,  id: cann-runtime-error-codes, lookups: 6, hit: 5, miss: 1, skipped: 0}
- {run: 2026-10-16-0920, deployment: local-a2, kind: tool, tool: Grep, calls: 41, p50_ms: 900, p90_ms: 9200, errors: 2, timeouts: 1}
- {run: 2026-10-17-1005, deployment: local-a2, checkout: a1b2c3d, kb_rev: 2a931ee, sessions: 2, kind: case, id: VLLM-ASC-12430, selected: 2, loaded: 1, resolved: 0, misdiagnosed: 0}
```

`run` 是本次运行的时间戳（`YYYY-MM-DD-HHMM`），与期号无关：记录在第 3 步写，期文件在周界那一次的第 7 步才写，两者不是一回事。`deployment` 是部署标识，脚本取环境变量 `ASCEND_SLEUTH_DEPLOYMENT`，缺省取检出根目录名。同一周的多次运行共用一个文件，各写各的行。

读侧是生成物，按 `(deployment, id)` 汇总，并保留每个 id 最近几次运行的结果，供面板显示本期增量与「连续未解决」：

```yaml
# metrics/entry-activity.yaml（生成物，面板与知识整理只读它）
covered: {deployment: local-a2, runs: 2, weeks: ['2026-W42'], checkouts: [a1b2c3d]}
cases:
  VLLM-ASC-12430:
    totals: {selected: 5, loaded: 3, resolved: 1, misdiagnosed: 0}
    by_week: {2026-W42: {selected: 5, loaded: 3, resolved: 1, misdiagnosed: 0}}
    recent: [{run: 2026-10-16-0920, resolved: 1, misdiagnosed: 0}, {run: 2026-10-17-1005, resolved: 0, misdiagnosed: 0}]
references:
  cann-runtime-error-codes:
    totals: {lookups: 6, hit: 5, miss: 1, skipped: 0}
    by_week: {2026-W42: {lookups: 6, hit: 5, miss: 1, skipped: 0}}
cold: {cases: 96, references: 12}     # 期内零活动的条目数 = 库总量减本表条目
```

一天跑一次甚至多次知识整理时，每次运行往 `metrics/entry-activity.d/<周>.yaml` 追加若干行，不改已经写下的行；一周七次运行就是同一个文件里的七组行。读侧按 `(deployment, id)` 求和，一个 id 在本周被选中几次就是各行之和。本期读数不跟着每次运行写进期文件：它一周一期，在周界那一次由第 7 步组装，维护者复核分母后写进 `metrics/timeline.d/<期号>.yaml`。理由是趋势要的是周粒度，日粒度里每次运行只有一两次诊断，比例读数全是 0/1 与 1/1，噪声盖过信号；而分母复核是人每周做一次的动作，不该跟着运行次数翻倍。

多人同时跑时，各人往自己那一周的源文件里加行，不编辑别人写过的行。`metrics/entry-activity.d/` 计划配 `merge=union`（与 `triage-tree.d/` 同一种做法，该行尚未加进 `.gitattributes`）。两人同周各自追加时，两侧的行都保留；读侧按 `(deployment, id)` 求和，行序不影响结果。

汇总时按 `(run, kind, id)` 去重。同一行被重复保留只算一次，重复的 `run` 号在汇总时报出来。

两份生成物进 git、也进 PR，但它们由脚本重建，人不手改，`--check` 与源比对（要接进 CI，见 5.2）。生成物存在的理由有三条。读侧只有一个入口，面板与体检器不必知道源分了几个文件、怎么追加。源可以换形状（这次就把条目使用记录从期文件里的一个段换成了独立的追加文件族，读端没改）。合并时重跑一次重建命令就够，不需要人工判断留哪一份。这套写法仓库里已有先例：`metrics/timeline.d/*` 合成 `timeline.yaml`，`knowledge/*.yaml` 合成 `_index.yaml`。

读数的部署边界：记录里带 `deployment`，汇总按它分组，不同部署的数字不合并，面板默认显示本部署，跨部署只看各自的行。这样 `merge=union` 只解决同部署的并发，不会把两份部署的计数加成一条排行。

### 3.4 与知识库解耦

观测数据写 `metrics/` 下的记录文件；知识条目只写内容与存续，不写计数、也不写分数。分数是派生值，只出现在索引生成物里。案例里原有的 `confidence` 块整体迁出：三个计数进记录，分数进索引，自证计数进记录。

| 数据 | 写在哪 | 写入方（知识整理里的步骤） | 何时写 |
|---|---|---|---|
| 被选中、被加载、检索三态、被排除 | `metrics/entry-activity.d/<周>.yaml` 的追加行 | 3 汇总 | 每次运行 |
| 现场确认解决、自证解决 | 同一份记录 | 2 结算 | 每次运行，按游标（已结算位置的记录）只结算新事件 |
| 外部验证记录 | 案例的 `validation_record` | 2b S2 验证结算 | 每次运行 |
| 排序分数 | `knowledge/_index.yaml` 生成物 | 6 索引重建（第 4 步算出来） | 随知识变更 |
| 案例内容与存续 | `knowledge/` 下的案例文件或 `_archive/` | 5 复审与退休 | 每周一次，只改有信号的条目 |
| 人工覆盖分数 | 案例的可选字段 `score_override` | 人，两人复核 | 罕见 |

三条规则。

1. 计数只进记录。案例文件里不再有 `hits`、`misdiagnoses`、`last_hit`、`self_resolved`。这些字段跟着结算走，结算一次就改一次知识文件，并与记录重复定义同一个量。
2. 分数是派生值，不落案例。输入是记录里的计数与案例的冷启动先验，算出来的分数写进索引生成物。冷启动先验取自案例的 `verification`（内容被外部验证的强度）与 `investigation_quality`（调查质量）；后者在 `skills/knowledge-groom/SKILL.md:81` 的正文里写作「confidence（调查质量）」，是同一个判据。案例文件因此只为内容层的决定而改，不因观测而改。
3. 人工覆盖优先于算分，走显式字段。`score_override` 写 `{score, reason, by}`，按高风险改动的两人复核走。第 4 步算完后用覆盖值替换该条目的分数，第 5 步的退休判断用替换后的值。条目退休或改 id 时覆盖随条目失效，重新启用要重写。

索引构建因此多了一条对使用记录的依赖。缺记录或记录过期时，分数退回该条目的冷启动先验值，构建脚本与索引头注写明这一次用的是先验值。这个退化的代价可测：阶段一排序的主键是字面量命中与 token 交集，分数只用于并列时的排序（破平）。要对照退化前后的名次，用 `python3 scripts/rank_candidates.py --write-baseline` 与 `--compare-baseline`（`--eval` 是同一份索引内的排序键对照，不能做前后对比）。

现状与目标的差别有三处。分数现在写在案例的 `confidence.score` 里，多数条目有、也有条目没有（`build_index.py:183` 读的是这个键），由知识整理的 agent 判断重算，「按时间衰减」没有公式也没有脚本。结算脚本写回 `confidence` 块时会连带重写 `score`，值取自原值。人工覆盖现在没有专门字段。

记录里的键取条目自己的 `id` 字段，不取文件名：先验侧两者常不一致，案例侧目前一致但没有门保证。两库的 id 目前互不重复，同样是实测结果。因此记录分 `cases` / `references` 两种 `kind`，并加一条门：全库 id 唯一，案例侧文件名与 id 一致。

id 本身可读。案例侧是 `VLLM-ASC-12430` 这类短标识，先验侧是 `cann-runtime-error-codes` 这类英文短语，面板一行放得下；个别长的行内截断，悬停给全名。

### 3.5 反馈联动

回报只改一处，不存在两处读数对不上的问题。

1. 工程师回报时，轨迹记一条 `feedback{case, outcome, confirmed_at}`。渠道是续接时的追问，不改诊断流程。
2. 知识整理收尾跑 `settle_trace_feedback.py --apply`。它按 `.settle-state.json` 的游标，把事件折进当期条目使用记录的对应 id，写 `resolved`、`misdiagnosed`、`self_resolved` 三列。
3. 同一次整理里算分并重建索引，分数落在索引生成物里，案例文件不动。
4. 记录与索引都在 git 里，反馈照样入库；改变下次排序的是第 3 步。

```mermaid
%%{init: {'themeVariables':{'fontSize':'14px'},'flowchart':{'curve':'basis','nodeSpacing':40,'rankSpacing':50,'padding':10}}}%%
flowchart LR
    R1["工程师回报<br/>解决 / 没解决"] --> T["轨迹<br/>feedback 事件"]
    T --> S["结算脚本<br/>按游标折算，事件哈希幂等"]
    S --> L["使用记录<br/>resolved / misdiagnosed / self_resolved"]
    L --> C["算分并重建索引<br/>分数落在索引生成物"]
    C --> O["下一轮候选排序"]

    classDef step fill:#e7f5ff,stroke:#1971c2,stroke-width:1.5px,color:#0b3d66
    classDef store fill:#fff4e6,stroke:#e8590c,stroke-width:1.5px,color:#7a2e00
    class R1,S,C step
    class T,L store
    class O step
```

图 4　一次回报的去向（类型：数据流图；范围：从回报到下次排序，不含跨机与迟到回报的处置）

图例：蓝色是动作与下游消费，橙色是记录。回报只写记录一处，分数由记录派生。

准确性靠三点。事件按哈希结算一次，重跑不重复计数。回报迟到的，跟着它实际落盘的那一周走，不回填历史期：表现为该条目下一周才出现解决计数。跨机器时记录按部署分组，另一台的回报由那一台的游标处理，两边不合并、各自算分。

案例 id 查不到时报错并计入清理清单，不改写历史。样例里还有一个边界情况：本次命中 9005，最终沉淀成 12430，回报落在 12430 上。记录按事件里的 id 各记一行：9005 记被选中，12430 记被选中与解决。

### 3.6 指标清单

留下的指标都要先答出五个问题，答不出来的删掉。面板上现有约三十个指标标签（`dsh-plugins/ascend-panel/panel-client.js` 的 `METRIC_LABELS`），其中三个有决定在读（`scripts/metrics_health.py`、`scripts/evolution_health.py`、`skills/self-evolve/SKILL.md` 的漂移判读），其余只在面板上占位。

五个问题是：谁读它；他据此做什么决定；读数为坏时下一步做什么；分子分母各是什么、覆盖哪些会话与哪份检出；这个数怎么来的。

最后一问的答案只有四种，写进数据里，不写在注释里。脚本或账单直接产出的是`确定性`。用可计算的量代替真量的标`代理`，例如用展开量之差代表无效探索。agent 自己记下来的标`自报`。只有现场能给的是`人工`。

| 指标 | 读它的人、决定 | 读数为坏时的下一步 | 分母与覆盖 | 强度（这个数怎么来的） | 现状 |
|---|---|---|---|---|---|
| 路由准确率 | 维护者每周整理时，改 triage 词法与命名空间归属 | 看漏检类别，补路由词或挪分类 | 已判定路由的会话 | 确定性 | 已落地 |
| 候选召回、命中位次 | 维护者，补案例或改排序键 | 看漏检样本落在哪个格子 | 有预期答案的回放样本 | 确定性 | 已落地 |
| 兜底使用与挽救 | 维护者，判是覆盖缺口还是要新先验 | 缺口补案例，流程问题改正文 | 全部诊断会话 | 确定性 | 已落地 |
| 先验读取三态与消费点 | 词条作者，该查没查改流程、查了没用改词条 | 按三态分流 | 走先验读取步骤的会话 | 确定性 | 部分落地 |
| 漏检类别 | 维护者，补词法或挪类别 | 按类别补 triage 词 | 未路由命中的会话 | 确定性 | 部分落地 |
| 步数与动作分布 | skill 维护者，改哪一步的正文 | 出现最多又不推进的动作优先改 | 全部诊断会话 | 确定性 | 已落地 |
| 分步成本 | 维护者，裁最贵的步骤 | 定位最贵步骤，看能否合并或跳过 | 有会话日志的会话 | 确定性 | 蓝图：待接会话日志 |
| 一次诊断的读入账 | 维护者，治超预算的读路径 | 按四个分项定位该治哪条 | 全部诊断会话 | 确定性 | 蓝图：需按会话归属 |
| 停止原因 | 维护者，判断该不该停在这里 | 未记录的会话先补记录 | 全部诊断会话 | 确定性 | 部分落地 |
| 无效探索 | 维护者，换探索策略 | 在历史决策树上离线打分，见下段 | 历史决策树，同策略对照 | 代理 | 蓝图：缺打分代码 |
| 词表合规 | 维护者，补词表或改记法 | 违规事件逐条看 | 全部事件 | 确定性 | 已落地 |
| 反馈捕获 | 维护者，判学习环有没有输入 | 为 0 时命中率、误诊率标不可解读 | 给出结论的会话 | 确定性 | 已落地 |
| 现场解决计数 | 排序与退休，降置信或退休 | 连续两次未解决转人工 | 已回报的会话 | 人工 | 部分落地 |
| 外部对照闭环 | 维护者，确认内容是否正确 | 没有上游 issue 或 PR 关联的案例标不可对照 | 有上游关联的案例 | 确定性 | 蓝图：缺锚点字段与查证脚本 |
| 归因比 | 维护者，误诊修复前先读 | 先补归因事件再修 | 已归因的误诊 | 人工 | 部分落地 |
| 结论强度分布 | 维护者与面板读者，判哪些结论不能当依据 | 弱强度结论不得升格 | 给出结论的会话 | 自报 | 蓝图：字段待接 |
| 条目使用增量 | 知识整理，退休、降置信、合并、补样例 | 高选中低解决时复审该条 | 该条目的当期被选中数，覆盖本部署 | 确定性 | 蓝图：本次新增 |
| 长期零命中条目 | 知识整理，决定补词面还是不动 | 复查症状词面与标签 | 全库条目 | 确定性 | 蓝图：本次新增 |
| 格子读入成本 | 维护者，拆分、瘦身、按平台切 | 看格子的实读 token | 无分母，绝对量 | 确定性 | 已落地 |
| 草稿校验通过率 | 维护者，草稿质量门 | 补齐草稿缺的节 | 待审草稿 | 确定性 | 已落地 |
| 相似条目对 | 知识整理，合并压缩 | 逐对判 | 整理流程检出的对数 | 代理 | 蓝图：本次新增 |
| 改进项积压 | 维护者，超限量即停产新项 | 先补合入指针 | 无分母，绝对量 | 确定性 | 已落地 |
| 预测实测三态 | 评审者，判卡可不可信 | 补跑判据或补预期 | 卡片数 | 确定性 | 已落地 |
| 采纳与拒绝比 | 维护者，判系统有没有拒绝路径 | 拒绝为 0 时质疑采纳记录 | 终态卡片 | 确定性 | 已落地 |

「现状」一列只取三个值：已落地、部分落地、蓝图。部分落地的具体差别是：先验三态、漏检类别等十项有产出、在字段白名单里，但 8 期期文件一次都没写过；停止原因的覆盖面不足；现场解决计数样本少；归因比读错键、恒为 0；反馈捕获当前为 0。

其中「有产出、在字段白名单里、8 期没写过」的那十项，是 `scripts/verify_metrics.py` 的白名单里有、`scripts/trace_metrics.py` 也产出、但 8 期期文件一次都没写过的十项：漏检类别、漏检会话、先验三态、先验消费点、停止原因分布、停止原因未记录、同批并发标记、候选全集事件、字段违规明细、字段违规总数。

复算：

```bash
python3 - <<'EOF'
import glob, yaml, importlib.util
spec = importlib.util.spec_from_file_location('vm', 'scripts/verify_metrics.py')
vm = importlib.util.module_from_spec(spec); spec.loader.exec_module(vm)
written = set()
for f in glob.glob('metrics/timeline.d/*.yaml'):
    written |= set((yaml.safe_load(open(f, encoding='utf-8')).get('metrics') or {}))
print('白名单', len(vm.LIVE_FIELDS), '从没写过', sorted(vm.LIVE_FIELDS - written))
EOF
```

同一个量只允许一处定义。加新指标前先看它是表里哪一行的另一个说法，是同一个就改那一行，不新增一行。

「无效探索」是表里需要新算法的指标，分两半做。可以离线重算的一半是探索策略本身：展开几个候选、按什么顺序、哪些同批并行、在哪里停。原料是轨迹顶层的 `stop_reason` 与事件里的 `parallel_group`、`considered_candidates`。读数是同一棵历史决策树上，两种策略到达命中各需要展开多少。另一半只能在线判断，即哪个假设被哪条证据推翻，记在事件或 `reason` 里，不参与上面那个差值。打分代码等闸门（判据阈值）满足：任一部署的轨迹到 30 条且反馈捕获率大于 0（[ADR-0009](../adr/0009-counterfactual-replay-exploration-policy.md) 的重评条件，当前不满足）。

### 3.7 面板

面板是给人做判断用的，所以每一块都要能落到一个动作上。下面两张是版式示意，数字为示意值；可以打开的版本在 [panel-observability-demo.html](../diagrams/panel-observability-demo.html)。

单次诊断的面板展开一张卡，补齐五块。缺数据的块显示「本次没记」，不显示 0。

```
2026-09-16-12430-dsv4pro-mc2   已解决   结论强度 自证
根因  HDK 24.1.0.3 低于 CANN 9.0.1 配套要求，多节点 MC2 卡死
命中 VLLM-ASC-9005（0.55）   沉淀为 VLLM-ASC-12430   待回报 无
------------------------------------------------------------------
各步   每格的宽度 = 成本占比，‖ = 同批并行，↺ = 返工
       路由 索引 核验 加载 先验×7 源码 结论 报告 回报
       ██  █   ███  ██  ████████ ███  █   ██   ▉
------------------------------------------------------------------
检索   展开 4 条 · 排除 5 条 · 命中 1 条
       命中  VLLM-ASC-9005                                          ↺
       排除  VLLM-ASC-12461  VLLM-ASC-7635  VLLM-ASC-9887 …
       先验  命中 6 · 未命中 1 · 未查 0    消费点 签名 3 / 流程 2 / 背景 1
------------------------------------------------------------------
成本   未缓存 12.4k · 缓存读 216k · 缓存写 38k · 输出 9.1k tok
       工具 42.6s（最慢 源码检索 18.2s）   读入账 类视图（按类别切好的索引文件）5.1k tok
------------------------------------------------------------------
本次没记   归因事件 0 条 · 停止原因未记 · 分步工具耗时空
```

累计读数的面板首屏先答四个问题：覆盖了哪些会话、哪个读数不可解读、哪些条目在变差、本周该做什么。

```
覆盖 local-a2 · 2026-W42-live-1016 · 本机 12 个会话 · 3 期
不可解读 2 项  命中率、误诊率（反馈捕获 0）
需处理 4 项    判据 5/5 已评估
------------------------------------------------------------------
条目使用（本周增量）              条目使用（跨周累计）
VLLM-ASC-12430  选 3 · 解 1       VLLM-ASC-12430  累计 11 · 解 4 · W42
cann-runtime-error-codes  6 次    VLLM-ASC-9005   累计 6 · 解 1 · W41
VLLM-ASC-9005   选 1 · 解 0       cann-hdk        累计 5 · 解 2 · W42
长期零选中 96 条（不退休）        高选中低解决 2 条 → 复审
------------------------------------------------------------------
过程动作成本   先验读取 38% · 源码分析 31% · 候选核验 12% · 其余 19%
------------------------------------------------------------------
变差的读数
  inference/vllm-ascend interrupt 读入 16.4k tok（软上限 8k） → 拆分评估
  期文件断档 3 天（阈值 7）                                  → 跑一次知识整理
  条目 VLLM-ASC-7635 连续 2 次未解决                          → 转人工
------------------------------------------------------------------
本周该做   ① 复审 2 条高选中低解决  ② 补 507014 错误码词条  ③ 跑一次知识整理
```

排行每行显示 `id`（等宽）+ 条目标题 + 计数。id 是记录的键，点一行回到条目本体。每张卡右上角带 3.6 的五格，展开可见。

## 4 边界与失败模式

| 情形 | 行为 |
|---|---|
| 反馈捕获为 0 | 命中率、误诊率标不可解读，不写 0；面板写明是没数据，不是零问题 |
| 某个指标本期没有数据 | 不写该键，面板显示本期未采集 |
| 某一周没有记录文件 | 该周不参与累计，聚合脚本报出缺哪几周，不按 0 计 |
| 某个 id 在知识库里查不到 | 报出该 id 与所在的运行，不计入排行，列入清理清单 |
| 记录文件被手改 | 改动无法用重建命令修（重建只把错值搬进生成物）。处置：删掉被改的那些行，用同一批本机记录重跑该 `run` 的汇总 |
| 记录里的周号与文件名不符 | `--check` 报出；按文件名归周，同时提示修源 |
| 跨时区部署 | 记录按写入机器的本地 ISO 周归周。不同时区的两台可能在同一天落进不同周文件，这是预期行为：汇总按 `deployment` 分组，不跨部署合并 |
| 面板读不到生成物 | 显示缺哪个生成物与重建命令，不回退到原始记录自行求和 |
| 无 git 环境或在 worktree 里跑整理 | 路径退化为检出内并在输出里标出，不产出空指标 |
| 两个 worktree 同时写一期 | 期号冲突按现有后缀机制处理，不同期落在不同文件 |
| 结论强度是 agent 自报 | 强度档写进数据，面板标明自报，不与确定性读数同权 |

## 5 现状

### 5.1 已落地

- 轨迹、报告、证据的写入与词表校验：`skills/diagnose/references/diagnosis-trace.md`。
- 三块组装与每周一次的指标产出：`scripts/metrics_snapshot.py`、`scripts/metrics_health.py`，算法见 [metrics.md](../guide/metrics.md)。
- 期文件与生成物分离、期号命名与撞号后缀、字段白名单：`scripts/build_timeline.py`、`scripts/verify_metrics.py`。
- 一次诊断读入账的四个分项与格子读入成本线：`scripts/index_read_cost.py`、`metrics/gates.yaml`。
- 先验按 id 的明细：期文件的 `metrics.reference_detail`。
- 现场回报写回案例的 `confidence` 与其幂等游标：`scripts/settle_trace_feedback.py`、`.settle-state.json`。
- 会话账单：`node scripts/session_cost.mjs --all`。
- 本地件路径解析：`scripts/exec_log_path.py`、`python3 scripts/shared_dir.py`。

### 5.2 蓝图

先做迁移，再做新口径。`confidence` 在库里现有四种形态（四个键 / 只有 `hits` 与 `misdiagnoses` / 三个键 / 带 `self_resolved`），一部分条目没有 `score`，因此迁移要跨三个 PR，按「加记录与新聚合 → 切换算分与读端 → 删除旧字段」的顺序走，每个 PR 一个阶段。

阶段之间是共存期：加记录那一步之后，案例与记录各有一份计数，读端仍从案例取分；切换之后案例不再有分数，记录成为唯一来源，面板取分改读索引。共存期超过两周就应当把删字段排上前。

| 蓝图项 | 改哪里 | 确认方式 |
|---|---|---|
| 一次诊断的记录汇总成一行 | 新增汇总脚本 | 对最近一次诊断跑一次，字段与 3.1 的表对齐 |
| 记录文件族（源） | 新增 `metrics/entry-activity.d/<周>.yaml`，由汇总与结算脚本追加 | 跑两次汇总，文件里出现两组 `run`，前一组内容不变 |
| 记录的生成物 | `scripts/build_entry_activity.py` 产出 `metrics/entry-activity.yaml` | 排行与各行增量逐条对得上；`recent` 能给出「连续未解决」 |
| 记录的校验 | 新增校验脚本并接进 CI 的 `metrics-validation` job | 源与生成物一致；`(run,kind,id)` 重复、孤儿 id、周号与文件名不符都报红 |
| `.gitattributes` 加 union | `metrics/entry-activity.d/* merge=union` | 构造两侧同时追加，合并后两侧的行都在 |
| 记录格式改成一行一条 | 汇总脚本的输出格式 | 造两段并发追加，合并后的文件能被 YAML 解析 |
| 分数的算分脚本 | 新增算分脚本；替换 `skills/knowledge-groom/SKILL.md` 第 4 步的 agent 判断 | 全库跑一次，结果与逐条手算一致；与索引里的 score 一致 |
| `confidence` 块迁出案例 | 迁移三步（见上） | 第 1 步后计数两处一致；第 3 步后全库不再出现 `confidence` |
| 人工覆盖字段 | `docs/spec/case-schema.md` 加可选 `score_override{score, reason, by}` | 造一条覆盖，索引用覆盖值；不带理由时校验报错 |
| 条目 id 的唯一性门 | `scripts/build_index.py --check` 或新校验脚本 | 全库 id 唯一；案例侧文件名与 id 一致；造一条重名条目，门报红 |
| 工具调用明细与按工具的分布 | 汇总脚本与记录里的 `tool_profile` | 对最近一次诊断跑一次，明细逐次列出，聚合里出现按工具的 p50/p90 与失败数 |
| 期文件的产出并入知识整理收尾 | `skills/knowledge-groom/SKILL.md` 加一步，复用 `scripts/metrics_snapshot.py` | 跑一次整理，期文件出现在同一个 PR 里；不跑整理时仓库不新增期 |
| 面板读记录生成物与五块 | `dsh-plugins/ascend-panel/` 前端与 host | 排行与计数正确显示；期文件的手写解析器不再经手条目 |
| 面板的轨迹读跟随会话工作目录 | `panel-host.js` 的 `resolveCwd` | 在 worktree 里开面板，看读到的是哪一份 `traces/` |
| 案例加上游关联字段 | `docs/spec/case-schema.md` 加 `upstream[{repo, issue|pr, url}]`；沉淀流程写它 | 造一条带锚点的案例，外部对照脚本能读到它 |
| 外部对照自动查证 | 新增脚本，复用 `gh api` 外壳与结算回写通道 | 对一个有上游关联的案例跑一次，写出结局并留在 `validation_record` |
| 指标强度档写进数据 | 期文件与面板 | 每个指标能读出强度档，面板标明自报 |
| 无效探索的离线打分 | 尚未立项，闸门见 3.6 | 闸门满足后另行起卡 |

其他文档的同步面。

| 文档 | 改什么 |
|---|---|
| `docs/guide/metrics.md` | 来源表加条目使用记录与工具分布两行；「周批」表述改为知识整理收尾；命令链加聚合与校验脚本 |
| `docs/spec/case-schema.md` | 删掉 `confidence` 一节，新增可选 `score_override` 与 `upstream` |
| `docs/mechanism/rsi-mechanism.md` | 第 4.4 节的四个写入点里，「知识条目」换成「条目使用记录」（净额仍是四条）；第 11 节把落期归入知识整理 |
| `docs/guide/git-workflow.md` | 目录归属表加两条新路径（该表的规则是「没列到的路径按只接收处理」） |
| `docs/mechanism/status.md` | 加条目使用记录与工具分布两行状态 |
| `docs/guide/handoff.md` | 交接时说明接手方看不到上家的本机明细 |

### 5.3 已否决

以下每一条的理由与代价见 [ADR-0011](../adr/0011-diagnosis-observability-data-plane.md)。

1. 把条目使用增量直接写进案例文件、不建记录。
2. 把计数继续留在案例文件里，只把记录当副本。
3. 按条目一个文件。
4. 做成仓根状态文件。
5. 把使用记录放进期文件的 `metrics` 段。
6. 把排序分数继续留在案例文件里。
7. 把排序分数放进一个按 id 的独立文件。
8. 保留知识整理里由 agent 判断算分。
9. 每次诊断的指标单独开一个 PR。
10. 只保留周期节律。
11. 只保留事件驱动。
12. 把语义与机械两半合成一个「无效探索次数」。
13. 让 agent 自动判定现场结局。
14. 在面板里自行求和期文件。
15. 把 `.s2-replay/` 收进主检出的共享路径表。
16. 把检索的查询串、topK 与分数写进轨迹。
17. 把 token 与耗时写进轨迹事件。
18. 给案例加状态字段表达生命周期。
19. 把诊断标签扩成多个人工枚举。

## 6 代码与文档入口

| 用途 | 入口 |
|---|---|
| 轨迹字段与事件词表 | `skills/diagnose/references/diagnosis-trace.md`、`diagnosis_state.yaml.example`、`trace-status.yaml` |
| 诊断记录的汇总（新增） | `scripts/trace_entry_activity.py` |
| 记录与生成物（新增） | `metrics/entry-activity.d/<周>.yaml`、`scripts/build_entry_activity.py`、`metrics/entry-activity.yaml` |
| 期文件组装、体检与白名单 | `scripts/metrics_snapshot.py`、`scripts/metrics_health.py`、`scripts/verify_metrics.py`、`metrics/gates.yaml` |
| 期文件与生成物重建 | `scripts/build_timeline.py` |
| 一次诊断读入账 | `scripts/index_read_cost.py` |
| 算分与索引 | `scripts/build_index.py` |
| 反馈与验证结算 | `scripts/settle_trace_feedback.py`、`scripts/settle_s2_feedback.py` |
| 会话账单 | `scripts/session_cost.mjs` |
| 本地件路径解析 | `scripts/exec_log_path.py`、`scripts/shared_dir.py` |
| 面板 | `dsh-plugins/ascend-panel/README.md`、`dsh-plugins/ev-panel/README.md` |
| 路径归属 | `docs/guide/git-workflow.md` 的目录归属表 |
| 演进消费点 | `skills/evolve-check/SKILL.md`、`skills/self-evolve/SKILL.md`、`skills/knowledge-groom/SKILL.md` |

## 7 外部参考

适用性判断与全表见 [rsi-mechanism.md](rsi-mechanism.md) 第 12 节。与本文直接相关的三条：

- Dream-RSI（arXiv 2609.14858）：历史树离线重放、策略须可重算；把历史抽象成洞见注入提示词不如不注入。3.6 只做机械化一半的依据。
- Library Drift（arXiv 2605.19576）：不维护的知识库会漂移到注入反而更差，过早退休同样有害。累计面板不把零选中读成没用的依据。
- Falsifiable Release Gates（arXiv 2607.13070）：不能报错的检查与没有检查在观测上无法区分。每个读数要求写出坏时下一步的依据。
