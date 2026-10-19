// @local/vllm-kb —— 客户端半：设置页左侧栏「vllm-kb」那一项。
//
// 只做三件事：读配置、改配置、点探测。真正的请求在宿主半（index.js）。
// 页面产物格式与 dsh-plugins/dsh-sleuth-panels/lib/client.js 一致（__ModuleLoader__.load + require('react')）。

window.__ModuleLoader__.load({
  id: 'dsh-sleuth-vllm-kb',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    const API = '/vllm-kb/api'
    const PKG = 'dsh-sleuth-vllm-kb'

    const CSS = `
      .vk-root{--vk-bg:var(--c-bg,#fff);--vk-fg:var(--c-text,#1f2328);--vk-mut:var(--c-text-2,#57606a);
        --vk-line:color-mix(in srgb,var(--vk-fg) 14%,transparent);--vk-soft:color-mix(in srgb,var(--vk-fg) 4%,transparent);
        --vk-acc:var(--acc-primary,#0969da);--vk-ok:#1a7f37;--vk-bad:#cf222e;
        color:var(--vk-fg);font-size:13px;line-height:1.6;max-width:760px;padding:4px 0 8px;
        font-family:var(--font-ui,-apple-system,"PingFang SC","Segoe UI",sans-serif)}
      .vk-head{display:flex;align-items:baseline;gap:10px;margin:0 0 4px}
      .vk-title{font-size:15px;font-weight:650;letter-spacing:.2px}
      .vk-sub{color:var(--vk-mut);font-size:12px}
      .vk-card{border:1px solid var(--vk-line);border-radius:12px;background:var(--vk-soft);
        padding:14px 16px;margin-top:12px;transition:border-color .18s ease,background .18s ease}
      .vk-card:hover{border-color:color-mix(in srgb,var(--vk-fg) 26%,transparent)}
      .vk-row{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1.4fr) auto auto;
        align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--vk-line);border-radius:10px;
        background:var(--vk-bg);margin-top:8px;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
      .vk-row:hover{transform:translateY(-1px);box-shadow:0 4px 14px color-mix(in srgb,var(--vk-fg) 8%,transparent)}
      .vk-row[data-on="1"]{border-color:color-mix(in srgb,var(--vk-acc) 55%,transparent);
        box-shadow:0 0 0 1px color-mix(in srgb,var(--vk-acc) 25%,transparent)}
      .vk-dot{appearance:none;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--vk-line);
        cursor:pointer;position:relative;background:transparent;transition:border-color .18s ease}
      .vk-dot:hover{border-color:var(--vk-acc)}
      .vk-dot:checked{border-color:var(--vk-acc)}
      .vk-dot:checked::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--vk-acc);
        animation:vk-pop .22s cubic-bezier(.2,.9,.3,1.4)}
      @keyframes vk-pop{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}
      .vk-in{width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid transparent;border-radius:7px;
        background:transparent;color:var(--vk-fg);font:inherit;font-size:12.5px;outline:none;
        transition:background .16s ease,border-color .16s ease}
      .vk-in::placeholder{color:color-mix(in srgb,var(--vk-mut) 70%,transparent)}
      .vk-in:hover{background:color-mix(in srgb,var(--vk-fg) 5%,transparent)}
      .vk-in:focus{border-color:var(--vk-acc);background:var(--vk-bg);
        box-shadow:0 0 0 3px color-mix(in srgb,var(--vk-acc) 18%,transparent)}
      .vk-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;
        font-size:11.5px;border:1px solid var(--vk-line);color:var(--vk-mut);background:transparent;
        white-space:nowrap;transition:all .18s ease}
      .vk-pill[data-s="ok"]{color:var(--vk-ok);border-color:color-mix(in srgb,var(--vk-ok) 45%,transparent);
        background:color-mix(in srgb,var(--vk-ok) 10%,transparent)}
      .vk-pill[data-s="bad"]{color:var(--vk-bad);border-color:color-mix(in srgb,var(--vk-bad) 45%,transparent);
        background:color-mix(in srgb,var(--vk-bad) 8%,transparent)}
      .vk-pill i{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
      .vk-pill[data-s="testing"] i{animation:vk-blink 1s ease-in-out infinite}
      @keyframes vk-blink{0%,100%{opacity:.25}50%{opacity:1}}
      .vk-btn{appearance:none;border:1px solid var(--vk-line);background:var(--vk-bg);color:var(--vk-fg);
        font:inherit;font-size:12.5px;padding:5px 12px;border-radius:8px;cursor:pointer;
        transition:transform .14s ease,border-color .16s ease,background .16s ease,color .16s ease}
      .vk-btn:hover:not(:disabled){border-color:color-mix(in srgb,var(--vk-fg) 34%,transparent);transform:translateY(-1px)}
      .vk-btn:active:not(:disabled){transform:translateY(0)}
      .vk-btn:disabled{opacity:.5;cursor:default}
      .vk-btn:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--vk-acc) 22%,transparent)}
      .vk-btn-primary{background:var(--vk-acc);border-color:var(--vk-acc);color:#fff}
      .vk-btn-primary:hover:not(:disabled){filter:brightness(1.05)}
      .vk-btn-ghost{border-style:dashed;color:var(--vk-mut);width:100%;margin-top:10px;padding:9px 12px}
      .vk-btn-ghost:hover:not(:disabled){color:var(--vk-fg);border-color:var(--vk-acc)}
      .vk-x{appearance:none;border:0;background:transparent;color:var(--vk-mut);width:26px;height:26px;
        border-radius:7px;cursor:pointer;font-size:15px;line-height:1;transition:all .16s ease}
      .vk-x:hover{color:var(--vk-bad);background:color-mix(in srgb,var(--vk-bad) 10%,transparent)}
      .vk-eq{grid-column:1/-1;font-size:11.5px;color:var(--vk-mut);margin-top:2px;
        animation:vk-slide .2s ease}
      @keyframes vk-slide{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
      .vk-eq[data-s="bad"]{color:var(--vk-bad)}
      .vk-foot{display:flex;align-items:center;gap:10px;margin-top:14px}
      .vk-toast{font-size:12px;color:var(--vk-ok);opacity:0;transform:translateX(-4px);
        transition:opacity .2s ease,transform .2s ease}
      .vk-toast[data-on="1"]{opacity:1;transform:none}
      .vk-adv{margin-top:14px;border-top:1px dashed var(--vk-line);padding-top:10px}
      .vk-adv summary{cursor:pointer;color:var(--vk-mut);font-size:12px;list-style:none;
        display:flex;align-items:center;gap:6px;transition:color .16s ease}
      .vk-adv summary:hover{color:var(--vk-fg)}
      .vk-adv summary::-webkit-details-marker{display:none}
      .vk-adv summary::before{content:"›";display:inline-block;transition:transform .18s ease}
      .vk-adv[open] summary::before{transform:rotate(90deg)}
      .vk-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}
      .vk-field{display:flex;flex-direction:column;gap:4px}
      .vk-field span{font-size:11.5px;color:var(--vk-mut)}
      .vk-err{color:var(--vk-bad);font-size:12px;margin-top:10px}
      .vk-empty{color:var(--vk-mut);font-size:12.5px;padding:8px 2px}
    `

    const EMPTY = { endpoints: [], active: '', probe_timeout_ms: 1000, probe_ttl_ms: 30000, request_timeout_ms: 15000 }

    function request(path, options) {
      const init = options || {}
      const headers = Object.assign({ 'x-vllm-kb': '1' }, init.headers || {})
      if (init.body !== undefined) headers['Content-Type'] = 'application/json'
      return fetch(`${API}${path}`, Object.assign({}, init, { headers })).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
    }

    function Style() {
      return h('style', { dangerouslySetInnerHTML: { __html: CSS } })
    }

    function EndpointRow(props) {
      const { endpoint, active, state, busy, onRename, onUrl, onActivate, onProbe, onRemove } = props
      const status = busy ? 'testing' : state ? (state.ok ? 'ok' : 'bad') : 'idle'
      const pillText = busy ? '探测中' : state ? (state.ok ? `${state.elapsed_ms} ms` : '不可用') : '未探测'
      const eq = state && !state.ok ? (state.detail || `HTTP ${state.status}`) : (state && state.ok ? `HTTP ${state.status}${state.embedding ? `｜embedding ${state.embedding}` : ''}${state.ocr ? `｜ocr ${state.ocr}` : ''}` : '')
      return h('div', { className: 'vk-row', 'data-on': active ? '1' : '0' },
        h('input', { className: 'vk-dot', type: 'radio', name: 'vk-active', checked: active, onChange: onActivate, 'aria-label': '启用这个端点' }),
        h('input', { className: 'vk-in', value: endpoint.label, placeholder: '名称，如内网测试', onChange: (e) => onRename(e.target.value) }),
        h('input', { className: 'vk-in', value: endpoint.base_url, placeholder: 'http://host:8000', spellCheck: false, onChange: (e) => onUrl(e.target.value) }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { className: 'vk-pill', 'data-s': status }, h('i'), pillText),
          h('button', { className: 'vk-btn', disabled: busy, onClick: onProbe, title: '调 GET /health 试一次' }, '测试'),
        ),
        h('button', { className: 'vk-x', onClick: onRemove, title: '删除这个端点', 'aria-label': '删除' }, '×'),
        eq ? h('div', { className: 'vk-eq', 'data-s': state && state.ok ? 'ok' : 'bad' }, eq) : null,
      )
    }

    function Panel() {
      const [config, setConfig] = React.useState(null)
      const [error, setError] = React.useState('')
      const [saved, setSaved] = React.useState(false)
      const [busy, setBusy] = React.useState('')
      const [probes, setProbes] = React.useState({})

      // 函数声明而不是 const：首次渲染在 config===null 处提前返回，const 定义不会执行，
      // 而上面的 effect 已经排进队列，回调再调用它就会报 "Cannot access before initialization"。
      function probeOne(endpoint) {
        setBusy(endpoint.id)
        request('/probe', { method: 'POST', body: JSON.stringify({ endpoint_id: endpoint.id }) })
          .then((result) => setProbes((prev) => Object.assign({}, prev, { [endpoint.id]: result })))
          .catch((e) => setProbes((prev) => Object.assign({}, prev, {
            [endpoint.id]: {
              ok: false,
              status: 0,
              detail: `连不上 ${endpoint.base_url || '（地址还没填）'}：${String((e && e.message) || e)}。确认内网地址与端口，改完再点一次「测试」。`,
            },
          })))
          .finally(() => setBusy(''))
      }

      React.useEffect(() => {
        let alive = true
        request('/config')
          .then((payload) => {
            if (!alive) return
            setConfig(payload.config || EMPTY)
            if (payload.error) setError(payload.error)
          })
          .catch((e) => { if (alive) setError(String((e && e.message) || e)) })
        // 打开页面不自动探测：探测是显式动作（点「测试」），
        // 否则端点还没填好时一进来就是一片红。
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      if (config === null) {
        return h('div', { className: 'vk-root' }, h(Style),
          h('div', { className: 'vk-head' }, h('div', { className: 'vk-title' }, 'vllm-kb')),
          error ? h('div', { className: 'vk-err' }, `配置读不到：${error}`) : h('div', { className: 'vk-empty' }, '读取配置…'))
      }

      const patch = (next) => setConfig(Object.assign({}, config, next))

      const save = () => {
        setBusy('save')
        setError('')
        request('/config', { method: 'POST', body: JSON.stringify(config) })
          .then((payload) => {
            setConfig(payload.config || config)
            setSaved(true)
            setTimeout(() => setSaved(false), 1800)
          })
          .catch((e) => setError(String((e && e.message) || e)))
          .finally(() => setBusy(''))
      }

      const rows = config.endpoints.map((endpoint, index) => h(EndpointRow, {
        key: endpoint.id,
        endpoint,
        active: config.active === endpoint.id,
        state: probes[endpoint.id],
        busy: busy === endpoint.id,
        onRename: (value) => {
          const endpoints = config.endpoints.map((item, i) => (i === index ? Object.assign({}, item, { label: value }) : item))
          patch({ endpoints })
        },
        onUrl: (value) => {
          const endpoints = config.endpoints.map((item, i) => (i === index ? Object.assign({}, item, { base_url: value }) : item))
          patch({ endpoints })
        },
        onActivate: () => patch({ active: endpoint.id }),
        onProbe: () => probeOne(endpoint),
        onRemove: () => {
          const endpoints = config.endpoints.filter((_item, i) => i !== index)
          patch({ endpoints, active: config.active === endpoint.id ? (endpoints[0] ? endpoints[0].id : '') : config.active })
        },
      }))

      return h('div', { className: 'vk-root' }, h(Style),
        h('div', { className: 'vk-head' },
          h('div', { className: 'vk-title' }, 'vllm-kb'),
          h('div', { className: 'vk-sub' }, '外部只读知识库：按版本查源码、修复链、手册原文、截图转文字'),
        ),
        h('div', { className: 'vk-card' },
          rows,
          h('button', {
            className: 'vk-btn vk-btn-ghost',
            onClick: () => {
              const endpoints = config.endpoints.concat([{ id: `ep-${Date.now().toString(36)}`, label: '', base_url: '' }])
              patch({ endpoints })
            },
          }, '+ 添加端点'),
          h('div', { className: 'vk-foot' },
            h('button', { className: 'vk-btn vk-btn-primary', disabled: busy !== '', onClick: save }, busy === 'save' ? '保存中…' : '保存'),
            h('span', { className: 'vk-toast', 'data-on': saved ? '1' : '0' }, '已保存，工具下次调用即生效'),
          ),
          h('details', { className: 'vk-adv' },
            h('summary', null, '高级'),
            h('div', { className: 'vk-grid' },
              h('label', { className: 'vk-field' }, h('span', null, '探测超时（毫秒）'),
                h('input', { className: 'vk-in', type: 'number', value: config.probe_timeout_ms,
                  onChange: (e) => patch({ probe_timeout_ms: Number(e.target.value) || 1000 }) })),
              h('label', { className: 'vk-field' }, h('span', null, '查询超时（毫秒）'),
                h('input', { className: 'vk-in', type: 'number', value: config.request_timeout_ms,
                  onChange: (e) => patch({ request_timeout_ms: Number(e.target.value) || 15000 }) })),
            ),
          ),
          error ? h('div', { className: 'vk-err' }, error) : null,
        ),
        h('div', { className: 'vk-empty' }, '打开这个页面不会自动探测；点每行的「测试」才发请求。工具行（vllm-kb-tools）默认关闭，在插件页单独打开；配置改完不用重启。'),
      )
    }

    exports.name = PKG
    exports.inject = ['slots']
    exports.apply = function apply(ctx) {
      const dispose = ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-sleuth-vllm-kb',
        order: 120,
        label: 'vllm-kb',
      }, () => h(Panel, null)))

      return () => {
        try {
          if (typeof dispose === 'function') dispose()
        } catch (e) { /* 卸载失败不影响其余插件 */ }
      }
    }

    return module.exports
  },
})
