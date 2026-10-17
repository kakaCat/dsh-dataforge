/**
 * dsh-dataforge client half —— DSH 侧栏单入口页（顶级标签页：采集运行 / 快速采集 / 接口库 / 采集网站）。
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

export const name = 'dsh-dataforge/client'

/** 权限最小化：本客户端只读 slots（sidebarRight/layout 等官方服务按需再加）。 */
export const inject: string[] = ['slots']

interface ApplyContext {
  slots?: Parameters<typeof registerPagePanel>[0]['slots']
}

export function apply(ctx: ApplyContext): void {
  registerPagePanel(ctx, {
    id: PANEL_ID,
    label: PANEL_LABEL,
    order: PANEL_ORDER,
    Component: DataforgePanelApp,
    Icon: DataforgeIcon,
  })
}
