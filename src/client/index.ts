/**
 * dsh-dataforge client half —— DSH 侧栏单入口页（顶级标签页：快速采集 / 接口库 / 采集网站 / 编排）。
 *
 * DSH dual-half contract：package.json 声明 dsh.client + exports["./client"]；
 * shell 在 /plugins/??dsh-dataforge/client.js 提供本模块（wrap-client 产物）。
 *
 * 侧栏纪律：本插件在 DSH 侧栏只占**一个**条目（未来插件多了会挤爆侧栏）；
 * 后续新增视图一律往 app.tsx 的 TABS 数组里加组件，不再注册侧栏条目。
 *
 * @module dsh-dataforge/client
 */
import { DataforgePanelApp } from './app.js'
import { PANEL_ID, PANEL_LABEL, PANEL_ORDER } from './dom.js'
import { DataforgeIcon } from './icons.js'
import { registerPagePanel } from './page-panel.js'
import { setSidebarBrowserOpener } from './sidebar-browser.js'
import { installRecorderTab } from './sidebar-recorder.js'

export const name = 'dsh-dataforge/client'

/** 权限最小化：本客户端只读 slots（sidebarRight/layout 等官方服务按需再加）。 */
export const inject: string[] = ['slots']

interface ApplyContext {
  slots?: Parameters<typeof registerPagePanel>[0]['slots']
  /** cordis 的惰性服务查询（sidebarRight 等服务按需取，不扩大 inject 依赖）。 */
  get?: (name: string) => unknown
}

/** 右侧 Sidebar 浏览器服务的最小投影（DSH 桌面端内置插件提供）。 */
type SidebarRightService = { openResource?: (url: string) => void }

export function apply(ctx: ApplyContext): void {
  // 只读"查看面"：把目标 URL 丢给侧栏浏览器；不参与录制/回放（该 webview 不暴露自动化能力）。
  setSidebarBrowserOpener((url) => {
    const service = ctx.get?.('sidebarRight') as SidebarRightService | undefined
    if (service !== undefined && typeof service.openResource === 'function') {
      service.openResource(url)
      return
    }
    throw new Error('sidebarRight 服务不可用')
  })
  // 右侧栏「录制控制」tab：浏览器旁边直接开始/停止录制（宿主没有 sidebar-right 时静默跳过）。
  installRecorderTab(ctx)
  registerPagePanel(ctx, {
    id: PANEL_ID,
    label: PANEL_LABEL,
    order: PANEL_ORDER,
    Component: DataforgePanelApp,
    Icon: DataforgeIcon,
  })
}
