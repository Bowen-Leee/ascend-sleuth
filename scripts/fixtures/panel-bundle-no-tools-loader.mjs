// panel-bundle-no-tools-loader.mjs —— check_panel_bundle.js 的兜底回归用解析钩子
//
// 只做一件事：让 `@deepseek-ai/dsh-tools` 解析失败，模拟「包装进 profile、模块解析从仓库路径
// 出发到不了安装处 node_modules」那种机器。产物应当仍然加载得起来（包内有最小实现兜底）。
// 其余 specifier 一律交回默认解析。
export function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    const error = new Error("Cannot find package '@deepseek-ai/dsh-tools'")
    error.code = 'ERR_MODULE_NOT_FOUND'
    throw error
  }
  return nextResolve(specifier, context)
}
