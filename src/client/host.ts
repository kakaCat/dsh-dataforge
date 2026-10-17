/**
 * 面板宿主（main 插槽占用者工厂）—— 薄 React 组件：只提供容器与生命周期，
 * 视图本身是命令式 attach 函数（PM 同款：attach on mount / dispose on unmount）。
 *
 * keyed 插槽切 key 会卸载占用者，轮询/DOM 监听随 disposer 一并释放；
 * usePanelInfo 做可见性门闩（!== 本面板 id 时跳过本轮刷新）。
 *
 * @module dsh-dataforge/client/host
 */
import { createElement, useEffect, useRef, type ReactNode } from 'react'
import { injectStyles } from './styles.js'

/** 命令式渲染器：容器挂上即 attach，返回清理函数。 */
export type BoardActivator = (el: HTMLElement, opts: { isActive: () => boolean }) => () => void

/** 槽位运行时注入的面板信息（GlobalStandardProps.usePanelInfo 的选择器投影）。 */
export interface PanelInfoLike {
  /** 当前选中的全局主面板 id；null = 显示当前对话。 */
  readonly activePanelId: string | null
}

/** usePanelInfo 选择器 hook 的最小契约（由 main 插槽运行时注入）。 */
export type UsePanelInfo = <S>(selector: (info: PanelInfoLike) => S) => S

/** main 插槽占用者收到的 props（本宿主只消费 usePanelInfo）。 */
export interface PanelHostProps {
  usePanelInfo?: UsePanelInfo
}

/** 装配一个面板宿主组件（每页一个实例；panelId 与插槽 key 同源）。 */
export function createPanelHost(activator: BoardActivator, panelId: string): (props?: PanelHostProps) => ReactNode {
  // 兜底 hook：槽位未注入 usePanelInfo 时恒判「本面板在看」。真实运行时
  // activePanelId=null = 显示当前对话 = 本面板**不在看**（跳过刷新），不做 null→panel 补全。
  const ALWAYS_ACTIVE: UsePanelInfo = <S,>(selector: (info: PanelInfoLike) => S): S =>
    selector({ activePanelId: panelId })

  return function DataforgePanelHost(props: PanelHostProps = {}): ReactNode {
    const usePanelInfo: UsePanelInfo = typeof props.usePanelInfo === 'function' ? props.usePanelInfo : ALWAYS_ACTIVE
    const activePanelId = usePanelInfo((info) => info.activePanelId)
    const hostRef = useRef<HTMLElement | null>(null)
    // 可见性门闩走 ref：轮询 tick 每次读最新值，不必因面板切换重挂容器
    const activeRef = useRef<boolean>(activePanelId === panelId)
    activeRef.current = activePanelId === panelId

    useEffect(() => {
      const host = hostRef.current
      if (host === null) return undefined
      injectStyles()
      return activator(host, { isActive: () => activeRef.current })
    }, [])

    return createElement('div', {
      ref: hostRef,
      className: 'dsh-df-view',
      'data-dsh-df-view': '',
    })
  }
}
