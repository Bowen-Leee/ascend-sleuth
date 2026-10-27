# VLLM-ASC-18178：EPLB 在 expandable_segments 下 HIXL 注册失败（103900）

## 元信息

| 项 | 值 |
|---|---|
| 来源 | [vllm-ascend issue #18178](https://github.com/vllm-project/vllm-ascend/issues/18178) |
| 修复 | [PR #18217](https://github.com/vllm-project/vllm-ascend/pull/18217)（merged 2026-10-12） |
| 平台 | A3（910C） |
| 状态 | issue closed；根因面由修复 PR 的设计文档确认，现场绕过未逐项回报 |
| severity | service-affecting（EPLB 初始化失败，服务起不来） |

## 现象

A3 + EPLB + 投机解码 draft 模型，且 PyTorch 分配器开了 `expandable_segments:True` 时，EPLB 初始化报：

```
HIXL EPLB register memory failed with status 103900
```

103900 是 HIXL 的 `PARAM_INVALID`：注册时给的地址范围不合法。关闭 `expandable_segments`，或本次先不启用 EPLB，可绕过。

## 根因

修复前 EPLB 在启动时按 **PyTorch 分配器段**整段注册 HIXL 内存。`expandable_segments` 或 draft 模型会让分配器段增长/变化，已注册的地址区间随之失效，HIXL 以 `PARAM_INVALID` 拒绝。

PR #18217 把注册改成 **aligned、merged live tensor ranges**：只注册活张量所在的区间，后续无关的分配器增长不会改变注册。

## 修复

升级到含 PR #18217 的 vllm-ascend。升级前：

- 关闭 `expandable_segments:True`；或
- 本次先不启用 EPLB。

## 证据

- issue #18178 原文（含错误码与配置）。
- PR #18217 的设计文档：修复前 “whole allocator segments at a time”；修复后 “aligned, merged live tensor ranges … unrelated allocator growth does not change these registrations”。
- 本单未拿到现场逐步 A/B 回报；根因面按修复 PR 的设计说明记录，不把绕过方式写成已现场验证。

## 未闭环项

- 现场是否按“关 expandable_segments / 暂不开 EPLB”恢复，未逐项回报。
- 若后续拿到现场回报，补进验证记录；不改变本条的修复方向。
