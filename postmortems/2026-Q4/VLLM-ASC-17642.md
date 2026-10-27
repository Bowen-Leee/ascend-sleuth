# VLLM-ASC-17642：DeepSeek-V4 在 A2 启动崩于 aclnnScatterNdUpdateSk（EZ1001）

## 元信息

| 项 | 值 |
|---|---|
| 来源 | [vllm-ascend issue #17642](https://github.com/vllm-project/vllm-ascend/issues/17642) |
| 修复 | [PR #17635](https://github.com/vllm-project/vllm-ascend/pull/17635)（merged 2026-10-08） |
| 平台 | A2（910B），非 A5 |
| 状态 | issue closed；修复 PR 已合入 |
| severity | service-affecting（服务启动失败） |

## 现象

DeepSeek-V4 W4A8/W8A8 在 A2（910B）默认配置拉起，ACL graph capture 阶段报：

```
aclnnScatterNdUpdateSk
AclNN_Parameter_Error(EZ1001): updates dtype DT_INT8 should be same with varRef dtype DT_BFLOAT16
```

显式传 `--attention-config '{"indexer_kv_dtype":"int8"}'` 可启动。A5 默认不走这条路径。

## 根因

indexer KV dtype 的 `auto` 没有被解析成平台默认。非 A5 平台默认应为 `int8`，但修复前 `auto` 原样透传到 ACLNN；`ScatterNdUpdate` 的 `updates`（int8）与 `varRef`（bf16）dtype 不一致，参数校验以 `EZ1001` 拒绝启动。

PR #17635 新增 `resolve_indexer_kv_dtype` / `get_indexer_k_dtype`，在进算子前按平台解析 `auto`。

## 修复

升级到含 PR #17635 的 vllm-ascend。升级前显式传：

```bash
--attention-config '{"indexer_kv_dtype":"int8"}'
```

不要靠改算子或关闭精度模式绕过。

## 证据

- issue #17642 原文：报错文本、默认配置、显式 int8 可启动。
- PR #17635 diff：`resolve_indexer_kv_dtype` / `get_indexer_k_dtype` 的平台默认解析。
- 与 VLLM-ASC-10322 同算子但不同签名：10322 是 507015 MTE 越界，本条是 EZ1001 dtype；不要合并。

## 未闭环项

- 修复前的根因是“auto 未解析”，由修复 diff 与“显式 int8 可启动”共同印证；原始 issue 未给出逐行源码复现。
