/**
 * 侧栏条目图标（插件单入口）：SVG 走 createElement 拼装，react 是宿主 seed 提供的 external。
 * 签名对齐官方约定：收 { size, active }，不读它们时参数省略。
 *
 * @module dsh-dataforge/client/icons
 */
import { createElement, type ReactNode } from 'react'

const SVG_ATTRS: Record<string, string | number> = {
  viewBox: '0 0 24 24',
  width: '1.1em',
  height: '1.1em',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': '',
}

/** 插件入口图标：目标站窗口 + 采集入库的下载箭头。 */
export function DataforgeIcon(): ReactNode {
  return createElement('svg', SVG_ATTRS,
    createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
    createElement('path', { d: 'M3 9h18' }),
    createElement('path', { d: 'M12 11v6' }),
    createElement('path', { d: 'M9.5 14.5L12 17l2.5-2.5' }),
  )
}
