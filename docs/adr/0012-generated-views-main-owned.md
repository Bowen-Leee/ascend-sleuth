# 生成物归主干：PR 只交源文件

## 状态

提议（原型分支已验证，待合入）。取代 `0002-retrieval-no-rag-lightweight-index.md` 中“索引随 PR 提交、`--check` 校验新鲜度”的提交面约定，以及 `0004-capacity-governance.md` 中依赖提交者重建生成物的部分；检索形态与容量政策不变。

## 背景

生成物（`knowledge/_index*`、`triage-tree.yaml`、`references/_summary-index.yaml`、`references/_procedure-index*`、`references/errors/_code-gaps.yaml`、`metrics/timeline.yaml`、`metrics/entry-activity/`）原先随每个 PR 提交。单人或少数人时这没有问题：改完 case 跑一次生成器，评审能看到生成物 diff，合入后主干就是新鲜的。

人数上来后，代价变成协调成本：N 个在途 PR 里每合一个，其余 N-1 个分支的生成物就落后一次；平台要求分支最新时，每个人都要 rebase、重建、push、等 CI。生成器本身约 5 秒，重复的是“每个提交者都要对齐同一份派生数据”。同一个 namespace × category 的并发还会在总表上真冲突。

根因不是生成器慢，是所有权：生成物被当成了每个提交者的责任，而它其实是脚本从源文件算出来的结果。

## 决定

生成物由**合入后的主干 job** 重建并提交，PR 只交源文件。

- 核心是一条平台无关的命令：`python3 scripts/rebuild_generated.py --check`。它按顺序跑全部生成器，再跑各自的覆盖/一致性检查。
- GitHub 上由 `.github/workflows/rebuild-generated.yml` 在 push 到 main 后调用它，有 diff 就提交 `chore: rebuild generated views`；用 concurrency 串行，失败重试时从最新 main 重新生成，不在旧结果上 rebase。
- PR 上的 `generated-guard` 拒绝修改生成物；各 CI job 在读生成物之前先调用同一个重建步骤，门从“提交面与重新生成逐字节相同”改成“能从这棵树产出齐全的生成物”。
- 生成物里不写数字（条数 / 容量 / 日期现算）仍是前提；否则每次重建都会在同一行产生无意义 diff 与冲突。
- **没有 CI 的部署**（内网 CodeHub 等）二选一，并写进部署说明：
  - 保留旧纪律：PR 带生成物，提交前跑 `rebuild_generated.py --check`；
  - 合入后由人跑同一条命令并提交。
  没有这个 job 又没人跑时，新 case 不进索引、新路由词不生效；这个失败形态不报错，比 CI 变红更难发现。

## 被否决的替代方案

- **按 namespace × category 拆总表**：只减少不同格子的碰撞，同格并发仍要重建；工作量更大，且不解决“生成物属于提交者”这个所有权问题。
- **合并队列 + 自动 rebase**：能去掉“更新分支”点击，但每个分支仍要重建生成物；平台绑定更强，fork 不适用。可作为“零点击合入”的补强，不替代本决定。
- **生成物不进 git、读时生成**：能彻底消掉这一类冲突，也不需要写主干权限；代价是诊断、面板、fork 每个读端都要接生成步骤，并新增 Python/PyYAML 运行时依赖。当前读端直接读已提交文件，本决定改动更小；若将来读端都愿意接生成步骤，可再评估。
- **本地 hook / merge driver 自动重建**：只在本地生效，GitHub 服务端合并不执行；仍然要人 push，没消掉协调。
- **机器人直接更新每个 PR 分支**：每合一个 PR 要更新其余 N-1 个分支，自动化的动作数仍随在途 PR 数增长，比主干一次重建更复杂。

## 影响

- PR 评审不再看生成物 diff（它的评审价值本来就低）；源文件与生成器的 diff 仍是评审面。
- 主干会有几秒到几分钟的“生成物稍旧”窗口；bot 失败时窗口拉长，需要一条主干漂移检查或告警。
- GitHub 需要允许 Actions 写 main（或允许 bot 开只改生成物的 PR + auto-merge）。当前 main 未开分支保护；若之后开启，要单独配。
- fork 部署不再需要合并上游生成物；但要在自己的平台配同一个 job，或走人工重建。
- 无 CI 部署的强度降为约定：没有 `generated-guard`，也拦不住手改生成物；这条必须在部署说明里如实写。
