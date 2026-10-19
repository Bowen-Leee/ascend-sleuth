#!/usr/bin/env node
// 外部查证配置的命令行入口：不改配置文件格式，直接读写 ~/.dsh/sleuth-kb.json。
// 用途：设置页那一项万一没渲染出来时，端点照样可以配，工具侧每次调用都重读这个文件。
//
// 用法：
//   node scripts/vllm_kb_config.mjs show
//   node scripts/vllm_kb_config.mjs add-endpoint <名称> <地址>      # 追加并设为启用
//   node scripts/vllm_kb_config.mjs use <名称或 id>                 # 切换启用的端点
//   node scripts/vllm_kb_config.mjs remove <名称或 id>
//   node scripts/vllm_kb_config.mjs probe                           # 探一次当前启用的端点

import { readConfig, writeConfig, normalizeConfig, activeEndpoint, probe, configPath } from '../dsh-plugins/vllm-kb/lib/core.js'

const [cmd, a, b] = process.argv.slice(2)

function usage() {
  console.log(`配置文件：${configPath()}
用法：
  show
  add-endpoint <名称> <地址>
  use <名称或 id>
  remove <名称或 id>
  probe`)
}

async function save(next) {
  await writeConfig(normalizeConfig(next))
  console.log(`已写入 ${configPath()}`)
}

async function main() {
  const { config } = await readConfig()
  switch (cmd) {
    case 'show': {
      console.log(JSON.stringify(config, null, 2))
      if (config.endpoints.length === 0) console.log('（还没有端点；用 add-endpoint 加一条）')
      return
    }
    case 'add-endpoint': {
      if (!a || !b) return usage()
      const endpoints = config.endpoints.concat([{ id: `ep-${Date.now().toString(36)}`, label: a, base_url: b }])
      await save(Object.assign({}, config, { endpoints, active: endpoints[endpoints.length - 1].id }))
      return
    }
    case 'use': {
      const hit = config.endpoints.find((item) => item.id === a || item.label === a)
      if (!hit) return console.log(`没有这个端点：${a}`)
      await save(Object.assign({}, config, { active: hit.id }))
      console.log(`已启用：${hit.label} ${hit.base_url}`)
      return
    }
    case 'remove': {
      const hit = config.endpoints.find((item) => item.id === a || item.label === a)
      if (!hit) return console.log(`没有这个端点：${a}`)
      const endpoints = config.endpoints.filter((item) => item.id !== hit.id)
      await save(Object.assign({}, config, { endpoints, active: endpoints[0] ? endpoints[0].id : '' }))
      return
    }
    case 'probe': {
      const endpoint = activeEndpoint(config)
      if (!endpoint) return console.log('还没有启用的端点')
      const result = await probe(endpoint.base_url, config.probe_timeout_ms)
      console.log(`${endpoint.label} ${endpoint.base_url}`)
      console.log(result.ok ? `可用：HTTP ${result.status}，${result.elapsed_ms} ms` : `不可用：${result.detail}`)
      if (result.detail) console.log(`响应：${result.detail}`)
      process.exitCode = result.ok ? 0 : 1
      return
    }
    default:
      return usage()
  }
}

main().catch((error) => {
  console.error(String((error && error.message) || error))
  process.exitCode = 1
})
