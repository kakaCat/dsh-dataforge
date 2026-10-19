/**
 * 右侧 Sidebar 浏览器（DSH 桌面端内置 `dsh-client-ui-sidebar-browser`）的打开缝。
 *
 * 能力边界（重要）：
 *   - 该浏览器是 Electron `<webview>`（Web profile 是 sandbox iframe），官方明确
 *     **不向被访问页面注入 Electron/Node 能力**，也没有暴露 DOM/事件/CDP 自动化接口；
 *   - 所以它只能当"人工查看面"：打开目标 URL 让用户盯着看，不能作为录制/回放的执行面；
 *   - 我们通过 client 服务 `sidebarRight.openResource(url)` 打开它（与 chat 打开 HTTP 链接同款）。
 *
 * 为什么用「注册函数」而不是直接 import 服务：dataforge 的 client 半边只声明 slots
 * 依赖（权限最小化）；sidebarRight 在点击时才惰性取，服务缺席（Web profile 未启用
 * 浏览器 tab）就回落到系统浏览器新标签页，绝不阻塞整个面板挂载。
 *
 * @module dsh-dataforge/client/sidebar-browser
 */

type Opener = (url: string) => void

let opener: Opener | undefined

/** 由 client 入口在 apply 时注册（拿到 sidebarRight 服务后）。 */
export function setSidebarBrowserOpener(fn: Opener | undefined): void {
  opener = fn
}

/** 打开一个 http(s) 地址：优先右侧 Sidebar 浏览器；没有就回落到新标签页。 */
export function openInSidebarBrowser(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  if (opener !== undefined) {
    try {
      opener(url)
      return
    } catch {
      // 侧栏服务异常时回落，不让按钮点了没反应
    }
  }
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
}
