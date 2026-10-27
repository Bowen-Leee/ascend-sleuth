# VLLM-ASC-16447：DSV4-Flash + DSpark 的 IndexCheck 越界（507035）

## 元信息

| 项 | 值 |
|---|---|
| 来源 | 交接报告 `traces/2026-09-18-dsv4flash-dspark-indexcheck.report.md`；现场 dump 由姊妹 session 定案 |
| 修复 | [PR #16712](https://github.com/vllm-project/vllm-ascend/pull/16712)（merged 2026-09-16，v0.26.0rc2 backport） |
| 版本 | vllm-ascend 0.25.1rc1（触发） / ≥ v0.26.0rc2（修复） |
| 状态 | resolved（根因已定案；现场修复结果待回报） |
| severity | service-affecting（decode 实例退出，RL rollout 断供） |

## 现象

DSV4-Flash-0731 + DSpark（`num_speculative_tokens=7`）+ PD 分离 + Mooncake，`enforce_eager=true`。单节点 8 卡 decode 运行约 8 小时、第 3 次权重同步后 74 秒，8 卡同一秒崩：

- 设备侧 `IndexCheck_int64_high_performance_0`：索引 `1064304640` 超过上界 `1048576`
- host 侧 `507035` vector core exception → `EngineDead`

dump 的 224 个值（32 请求 × 7 draft 位）呈 `base+1..+7` 连续序列，其余 217 槽两 rank 相同且合法。

## 根因

`vllm_ascend/ops/triton/spec_decode/utils.py:120`（v0.25.1rc1）的 dspark 输入展开内核：

```python
last_pos = tl.load(target_positions_ptr + valid_ctx_end - 1)
query_pos = last_pos + 1 + q_idx
```

`valid_ctx_end - 1` 化简后等于 `ctx_start + valid_count - 1`；当该行本步 `valid_count == 0`（被判“不采样”）时，batch 第 0 行取到 -1，读到 positions 缓冲之前的相邻浮点数据当 `last_pos`；随后 `query_pos` 无 clamp，写出 7 个约 1.06e9 的位置，查 RoPE 表（65536 × 16 = 1048576 行）越界，被 CANN 插入的 IndexCheck 拦下，报 507035。

Python 侧同类“无有效 token”状态在 `llm_base_proposer.py` 里用 `torch.clamp(min=0)` 兜底，triton 内核没有，二者不一致。

## 修复

升级到含 PR #16712 / ≥ v0.26.0rc2 的 vllm-ascend。升级前规避：去掉整个 `--speculative-config`（等价于关投机解码；不要只写 `num_speculative_tokens=0`）。本体制下草稿头冻结，关掉没有吞吐损失。

## 证据

- 现场 dump：224 个值、float 位模式、`base+1..+7` 序列、`224 = 32×7`。
- 源码：v0.25.1rc1 的 `utils.py:120-123` 无守卫；Python 侧同状态有 clamp。
- 上游：PR #16712 在 v0.26.0rc2 加 `has_valid_context` 守卫与回归测试；本地 `src-code` 的 v0.26.0rc2 已含该守卫。
- 排除：关掉投机解码后内核不被调用，问题消失。

## 未闭环项

- 现场修复结果未回报（升版本或回移守卫后的长时间稳定性）。
- 平台型号未在交接文档中确认；A5 与非 A5 走不同分支，若后续确认平台可补 `platforms`。
