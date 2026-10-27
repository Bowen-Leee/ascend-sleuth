// vllm-kb 客户端的纯逻辑：配置读写、source_id 解析、HTTP 调用、输出裁剪。
//
// 这一层不 import 任何 DSH 包，也不注册工具与路由——那些在 index.js。
// 只要一个端点就能用：不再要求用户提供 client.py。请求形状照 vllm-kb 的只读接口：
//   GET  /health           探测
//   GET  /graph/chain?doc= 修复链（source_id）
//   POST /code/search      按版本/镜像查源码 {keyword, version, repo, path, per_version, kind, limit}
//   GET  /doc/{id}         手册整篇
//   POST /tags/match       手册篇目匹配 {text}
//   POST /ocr              截图转文字 {image: base64}

import { mkdir, readFile, rename, stat as statFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const CONTENT_LIMIT = 8000
export const OCR_MAX_BYTES = 6 * 1024 * 1024

export const DEFAULTS = {
  endpoints: [],
  active: '',
  probe_timeout_ms: 1000,
  probe_ttl_ms: 30000,
  request_timeout_ms: 15000,
}

const REPO_ALIAS = {
  vllm: 'vllm-project/vllm',
  'vllm-ascend': 'vllm-project/vllm-ascend',
  ascend: 'vllm-project/vllm-ascend',
}

export function configPath() {
  const override = process.env.KB_EVIDENCE_CONFIG
  if (typeof override === 'string' && override !== '') return override
  return join(homedir(), '.dsh', 'vllm-kb.json')
}

// 首尾保留、中间省略：用于枚举型 detail（版本清单之类），尾部信息不能丢。
export function clipMiddle(text, head, tail) {
  const value = typeof text === 'string' ? text : ''
  if (value.length <= head + tail) return { text: value, truncated: false }
  const omitted = value.length - head - tail
  return { text: `${value.slice(0, head)}\n……（省略 ${omitted} 字符）……\n${value.slice(value.length - tail)}`, truncated: true }
}

export function clip(text, limit) {
  const value = typeof text === 'string' ? text : ''
  if (value.length <= limit) return { text: value, truncated: false }
  return { text: value.slice(0, limit), truncated: true }
}

export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const endpoints = Array.isArray(source.endpoints) ? source.endpoints : []
  const cleaned = []
  for (const item of endpoints) {
    if (!item || typeof item !== 'object') continue
    const base = typeof item.base_url === 'string' ? item.base_url.trim() : ''
    if (base === '') continue
    cleaned.push({
      id: typeof item.id === 'string' && item.id !== '' ? item.id : `ep-${cleaned.length + 1}`,
      label: typeof item.label === 'string' && item.label !== '' ? item.label : base,
      base_url: base.replace(/\/+$/, ''),
    })
  }
  const active = typeof source.active === 'string' ? source.active : ''
  const number = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback)
  return {
    endpoints: cleaned,
    active: cleaned.some((item) => item.id === active) ? active : (cleaned[0] ? cleaned[0].id : ''),
    probe_timeout_ms: number(source.probe_timeout_ms, DEFAULTS.probe_timeout_ms),
    probe_ttl_ms: number(source.probe_ttl_ms, DEFAULTS.probe_ttl_ms),
    request_timeout_ms: number(source.request_timeout_ms, DEFAULTS.request_timeout_ms),
  }
}

export async function readConfig() {
  try {
    const text = await readFile(configPath(), 'utf8')
    return { config: normalizeConfig(JSON.parse(text)), error: null }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      // 从旧路径迁一次：改名前的配置在 ~/.dsh/sleuth-kb.json，读到就沿用（不主动写，等用户保存时落新路径）。
      try {
        const legacy = join(dirname(configPath()), 'sleuth-kb.json')
        const text = await readFile(legacy, 'utf8')
        return { config: normalizeConfig(JSON.parse(text)), error: null }
      } catch (inner) {
        return { config: normalizeConfig(null), error: null }
      }
    }
    return { config: normalizeConfig(null), error: `配置文件读取失败：${String((error && error.message) || error)}` }
  }
}

export async function writeConfig(next) {
  const target = configPath()
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(tmp, target)
}

export function activeEndpoint(config) {
  return config.endpoints.find((item) => item.id === config.active) || null
}

// `vllm-ascend#10700` → `github:vllm-project-vllm-ascend:issue:10700`；完整 source_id 原样透传。
export function resolveSourceId(target, kind = 'issue') {
  const value = String(target || '').trim()
  if (value.startsWith('github:')) return value
  if (!value.includes('#')) return value
  const [repo, number] = [value.slice(0, value.lastIndexOf('#')), value.slice(value.lastIndexOf('#') + 1)]
  const full = REPO_ALIAS[repo] || repo
  return `github:${full.replace(/\//g, '-')}:${kind}:${number}`
}

async function httpJson(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs || DEFAULTS.request_timeout_ms))
  const started = Date.now()
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
    const text = await response.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch (error) {
      data = null
    }
    return { ok: response.ok, status: response.status, data, text, elapsed_ms: Date.now() - started }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: '',
      elapsed_ms: Date.now() - started,
      detail: error && error.name === 'AbortError' ? `超时（${options.timeoutMs} ms）` : String((error && error.message) || error),
    }
  } finally {
    clearTimeout(timer)
  }
}

// 探测：只判 HTTP 200 与往返耗时，顺带把 /health 里 embedding 与 ocr 两个状态带出来。
export async function probe(baseUrl, timeoutMs) {
  const result = await httpJson(new URL('/health', baseUrl).toString(), { timeoutMs })
  const health = result.data && typeof result.data === 'object' ? result.data : null
  return {
    ok: result.ok,
    status: result.status,
    elapsed_ms: result.elapsed_ms,
    embedding: health ? String(health.embedding || '') : '',
    ocr: health && health.ocr && typeof health.ocr === 'object' ? String(health.ocr.status || health.ocr.state || '') : '',
    detail: result.ok ? '' : result.detail || clip(result.text.replace(/\s+/g, ' ').trim(), 200).text,
  }
}

export function createProbeCache() {
  return new Map()
}

export async function availability(config, cache, probeImpl = probe) {
  const endpoint = activeEndpoint(config)
  if (endpoint === null) {
    return { ok: false, reason: 'not-configured', detail: '还没有配置端点：到设置页左侧栏「vllm-kb」添加一条并启用。' }
  }
  const cached = cache.get(endpoint.id)
  if (cached && Date.now() - cached.at < config.probe_ttl_ms) {
    return cached.result.ok ? { ok: true, endpoint } : cached.result
  }
  const result = await probeImpl(endpoint.base_url, config.probe_timeout_ms)
  cache.set(endpoint.id, { at: Date.now(), result })
  if (!result.ok) {
    return { ok: false, reason: 'unreachable', detail: `端点 ${endpoint.label}（${endpoint.base_url}）不可用：${result.detail || `HTTP ${result.status}`}` }
  }
  return { ok: true, endpoint }
}

function present(result, label) {
  if (result.ok && result.data !== null) {
    const body = JSON.stringify(result.data, null, 2)
    const clipped = clip(body, CONTENT_LIMIT)
    return { ok: true, content: clipped.text, truncated: clipped.truncated, endpoint: label, elapsed_ms: result.elapsed_ms }
  }
  if (result.ok) {
    const clipped = clip(result.text, CONTENT_LIMIT)
    return { ok: true, content: clipped.text, truncated: clipped.truncated, endpoint: label, elapsed_ms: result.elapsed_ms }
  }
  const raw = result.detail || String(result.text || '')
  const detail = (result.detail && result.detail.length > 0)
    ? result.detail
    : clipMiddle(raw.trim(), 900, 500).text || `HTTP ${result.status}`
  return { ok: false, reason: result.status === 0 ? 'unreachable' : `http-${result.status}`, detail, endpoint: label, elapsed_ms: result.elapsed_ms }
}

async function call(config, path, options, post) {
  const endpoint = activeEndpoint(config)
  const base = endpoint.base_url.replace(/\/+$/, '')
  const result = await httpJson(`${base}${path}`, Object.assign({ timeoutMs: config.request_timeout_ms }, options))
  const presented = present(result, endpoint.label)
  if (post && presented.ok && result.data && typeof result.data === 'object') {
    const note = post(result.data)
    if (note) presented.content = `${presented.content}\n\n${note}`
  }
  return presented
}

// 0 命中时补一句“可能是索引没覆盖”，并带上服务端预存的版本范围（拿不到就只给前半句）。
async function codeZeroHitNote(config, data) {
  const lines = ['0 命中不等于「这版本没有这段代码」：较新的文件可能还没进索引，或查询串与源码不逐字一致。']
  try {
    const endpoint = activeEndpoint(config)
    const result = await httpJson(`${endpoint.base_url.replace(/\/+$/, '')}/code/versions`, { timeoutMs: config.request_timeout_ms })
    const versions = result && result.data && Array.isArray(result.data.versions) ? result.data.versions : null
    if (versions && versions.length) {
      const head = versions.slice(0, 4).join(' / ')
      const tail = versions.length > 8 ? ` … ${versions.slice(-3).join(' / ')}` : ''
      lines.push(`服务端已预存 ${versions.length} 个版本（${head}${tail}）；超出这个范围就是没索引。版本号要带 v 前缀。`)
    }
  } catch (error) { /* 版本清单拿不到就不补这一句 */ }
  return lines.join('\n')
}


// ---- 四个能力 -----------------------------------------------------------
export async function lookupCode(config, args) {
  const payload = {
    keyword: String(args.query),
    limit: Number.isFinite(args.limit) ? args.limit : 10,
  }
  if (args.version) payload.version = String(args.version)
  if (args.repo) payload.repo = String(args.repo)
  if (args.in_file) payload.path = String(args.in_file)
  if (args.per_version) payload.per_version = true
  if (args.kind) payload.kind = String(args.kind)
  return call(config, '/code/search', { method: 'POST', body: payload }, (data) => {
    const hits = Array.isArray(data.hits) ? data.hits : null
    if (hits !== null && hits.length === 0) return codeZeroHitNote(config, data)
    return ''
  })
}

export async function lookupFix(config, args) {
  const doc = resolveSourceId(args.target, 'issue')
  return call(config, `/graph/chain?doc=${encodeURIComponent(doc)}`, undefined, (data) => (
    data.found === false
      ? '图里没有这条 issue：可能是图数据还没构建，也可能是确无修复。用 gh search 核对上游，别据此判「未修复」。'
      : ''
  ))
}

export async function lookupDoc(config, args) {
  if (args.catalog) return call(config, '/tags', undefined, (data) => (
    data && data.groups ? '' : ''
  ))
  if (args.doc_id) {
    return call(config, `/doc/${encodeURIComponent(String(args.doc_id))}`, undefined, (data) => (
      !data.body || String(data.body).trim() === ''
        ? '这篇没有返回正文（body 为空）：结论写「无原文 / 未核对」，不要当成「手册里没有这项内容」。'
        : ''
    ))
  }
  if (!args.query || String(args.query).trim() === '') {
    return { ok: false, reason: 'bad-argument', detail: '给 query（问题描述）、doc_id（文档编号）或 catalog: true（列出知识库有哪些文档类别）之一' }
  }
  return call(config, '/tags/match', { method: 'POST', body: { text: String(args.query) } }, (data) => {
    const matched = Array.isArray(data.matched) ? data.matched : null
    if (matched !== null && matched.length === 0) {
      return '没有命中任何文档标签：这个主题可能没收录（不是「肯定没有」）。可以换词再 match 一次，或用 vllm_kb_code 从源码侧查。'
    }
    return ''
  })
}

export async function lookupOcr(config, args) {
  const path = String(args.path)
  // 先 stat 再读：先整读再判大小会让一张超大图把进程内存顶起来。
  const info = await statFile(path).catch(() => null)
  if (info === null || !info.isFile()) return { ok: false, reason: 'file-missing', detail: `读不到图片：${path}` }
  if (info.size > OCR_MAX_BYTES) {
    return { ok: false, reason: 'file-too-large', detail: `图片 ${Math.round(info.size / 1024 / 1024)} MB，超过 ${OCR_MAX_BYTES / 1024 / 1024} MB 上限` }
  }
  const bytes = await readFile(path).catch(() => null)
  if (bytes === null) return { ok: false, reason: 'file-missing', detail: `读不到图片：${path}` }
  return call(config, '/ocr', { method: 'POST', body: { image: bytes.toString('base64') }, timeoutMs: Math.max(config.request_timeout_ms, 30000) })
}

// ---- 配置与探测路由的处理（纯函数，index.js 负责接 webServer）------------
// 返回 { status, payload }。鉴权：所有方法都要求自定义头；这是同源页面能设、
// 跨源页面（不带预检）设不了的最低门槛。部署上仍应只绑回环地址。
export async function handleApiRequest(request, deps = {}) {
  const read = deps.readConfig || readConfig
  const write = deps.writeConfig || writeConfig
  const probeImpl = deps.probe || probe
  const headers = request.headers || {}
  const method = String(request.method || 'GET').toUpperCase()
  const suffix = String(request.pathname || '')

  if (headers['x-vllm-kb'] !== '1') return { status: 403, payload: { error: '缺少请求头' } }

  if (method === 'GET' && suffix === '/config') {
    const { config, error } = await read()
    return { status: 200, payload: { config, error } }
  }

  let payload = {}
  if (typeof request.body === 'string' && request.body !== '') {
    try {
      payload = JSON.parse(request.body)
    } catch (error) {
      return { status: 400, payload: { error: '请求体不是合法 JSON' } }
    }
  }

  if (method === 'POST' && suffix === '/config') {
    const next = normalizeConfig(payload)
    await write(next)
    if (deps.cache && typeof deps.cache.clear === 'function') deps.cache.clear()
    return { status: 200, payload: { config: next } }
  }

  if (method === 'POST' && suffix === '/probe') {
    const { config } = await read()
    const endpoint = (payload.endpoint_id
      ? config.endpoints.find((item) => item.id === payload.endpoint_id)
      : activeEndpoint(config)) || null
    // 探的是页面上的那条地址，不是配置文件里存着的那条：请求带了 base_url 就用它。
    // 否则「填地址 → 点测试」会去探上次保存的地址（新加的端点还没有地址，必失败），
    // 非先点一次保存不可。超时同理，高级里改完不保存也要生效。
    const typed = typeof payload.base_url === 'string' ? payload.base_url.trim().replace(/\/+$/, '') : ''
    const baseUrl = typed !== '' ? typed : (endpoint ? endpoint.base_url : '')
    if (baseUrl === '') {
      return { status: 200, payload: { ok: false, status: 0, elapsed_ms: 0, endpoint_id: endpoint ? endpoint.id : '', detail: '这个端点还没有地址：填上再点「测试」（新加的端点、地址为空的那条，都还没进配置文件）' } }
    }
    const timeoutMs = Number.isFinite(payload.probe_timeout_ms) && payload.probe_timeout_ms > 0
      ? payload.probe_timeout_ms
      : config.probe_timeout_ms
    const result = await probeImpl(baseUrl, timeoutMs)
    // 只有探的就是配置文件里那条地址，才写进缓存：拿没保存的地址写缓存，会让工具侧的
    // 可用性判断跟着变（那时保存还没发生，地址随时可能再改）。
    const isSaved = endpoint !== null && endpoint.base_url === baseUrl
    if (isSaved && deps.cache && typeof deps.cache.set === 'function') deps.cache.set(endpoint.id, { at: Date.now(), result })
    return {
      status: 200,
      payload: {
        ...result,
        endpoint_id: endpoint ? endpoint.id : '',
        label: endpoint ? endpoint.label : baseUrl,
        base_url: baseUrl,
        saved: isSaved,
        checked_at: new Date().toISOString(),
      },
    }
  }

  return { status: 404, payload: { error: '未知路径' } }
}

// ---- 入口：读配置 → 探测 → 执行 -----------------------------------------
export async function lookup(capability, args, deps = {}) {
  const cache = deps.cache || createProbeCache()
  const { config } = await readConfig()
  const gate = await availability(config, cache, deps.probeImpl)
  if (!gate.ok) return gate
  switch (capability) {
    case 'code': return lookupCode(config, args)
    case 'fix': return lookupFix(config, args)
    case 'doc': return lookupDoc(config, args)
    case 'ocr': return lookupOcr(config, args)
    default: return { ok: false, reason: 'bad-argument', detail: `未知能力：${capability}` }
  }
}
