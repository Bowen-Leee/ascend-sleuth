// panel-bundle-stub-loader.mjs —— check_panel_bundle.js 用的解析钩子
//
// 生成物 `dsh-plugins/dsh-sleuth-panels/lib/index.js` 里有一句动态 import
// `await import('@deepseek-ai/dsh-tools')`：真实运行时它可能解析不到（包装进 profile 后，
// 模块解析从仓库路径出发，到不了安装处的 node_modules；发行版的 resources/ 下也没有模块回退
// 文件），包内因此留了最小实现兜底。在仓库里裸跑 node 同样解析不到，这里给它一条可解析的路。
//
// 这里优先用**真品**：check_panel_bundle.js 探到已安装的 DSH 时会把根目录写进
// `DSH_SLEUTH_TOOLS_ROOT`，于是冒烟测试用真的 `defineTool` 校验工具定义——参数写法不对会当场红
// （实测踩过：面板用 JSON-Schema 包装写法、真品只认 DSL，装进 profile 后整个 host 半挂不上）。
// 找不到 DSH 时退回本地 stub，调用侧会如实说明这一次校验的强度。
// 兜底分支本身由 check_panel_bundle.js 的「解析不到 dsh-tools 时仍能加载」一例覆盖。
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stubUrl = pathToFileURL(join(here, 'panel-bundle-dsh-tools-stub.mjs')).href

function realToolsUrl() {
  const root = process.env.DSH_SLEUTH_TOOLS_ROOT
  if (root === undefined || root === '') return null
  const entry = join(root, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
  return existsSync(entry) ? pathToFileURL(entry).href : null
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    const real = realToolsUrl()
    return { url: real === null ? stubUrl : real, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
