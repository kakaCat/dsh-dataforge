/**
 * 面板内标签页容器 —— 侧栏单入口设计下承载多个视图。
 *
 * 挂载策略：同一时刻只挂当前激活 tab 的 board；切换即「卸旧挂新」，
 * 切换天然拿到新数据，后台 tab 不驻留 DOM、不轮询。
 * isActive 直接透传外层可见性门闩——board 挂载时就意味着它的 tab 已激活。
 *
 * @module dsh-dataforge/client/tabs
 */
import type { BoardActivator } from './host.js'
import { el } from './el.js'

/** 一个标签页 = 内部身份 + 文案 + 命令式视图挂载器。 */
export interface TabSpec {
  /** tab 内部 key（aria / DOM 标记用，不进 DSH 侧栏）。 */
  id: string
  /** tab 按钮文案。 */
  label: string
  /** 挂载器：pane 容器挂上即取数，返回 disposer。 */
  attach: BoardActivator
}

/** 内容型标签页：同步构建器给一块静态内容（详情/分组块用，无生命周期）。 */
export interface BlockTabSpec {
  /** tab 内部 key（DOM 标记用）。 */
  id: string
  /** tab 按钮文案（建议带计数，如 `页面 12`）。 */
  label: string
  /** 同步内容构建器：装配时各构建一次，内容随外层重渲染整体重建。 */
  build: () => HTMLElement
}

/**
 * 内容型标签页组：详情块内多板块切换（如 页面/凭据/样本）。
 * 与 createTabsActivator 的差异：内容同步、全驻留 DOM（hidden 切换），无生命周期。
 * role 语义照 tablist/tab/tabpanel；data-* 加 subtab 后缀与顶级 tab 区分。
 */
export function createBlockTabs(tabs: readonly BlockTabSpec[]): HTMLElement {
  if (tabs.length === 0) throw new Error('[tabs] 至少需要一个 BlockTabSpec')

  const bar = el('div', { class: 'dsh-df-tabs dsh-df-subtabs', role: 'tablist' })
  const buttons: HTMLButtonElement[] = []
  const panes: HTMLElement[] = []

  function setActive(idx: number): void {
    for (const [i, btn] of buttons.entries()) {
      btn.setAttribute('aria-selected', i === idx ? 'true' : 'false')
      panes[i].hidden = i !== idx
    }
  }

  tabs.forEach((tab, idx) => {
    const btn = el('button', {
      class: 'dsh-df-tab',
      type: 'button',
      role: 'tab',
      'aria-selected': idx === 0,
      'data-dsh-df-subtab': tab.id,
    }, tab.label)
    btn.addEventListener('click', () => { if (panes[idx].hidden) setActive(idx) })
    bar.append(btn)
    buttons.push(btn)
    panes.push(el('div', {
      class: 'dsh-df-tabpane',
      role: 'tabpanel',
      'data-dsh-df-subtabpane': tab.id,
    }, tab.build()))
  })

  const root = el('div', { class: 'dsh-df-blocktabs' })
  root.append(bar, ...panes)
  setActive(0)
  return root
}

/**
 * 装配标签页容器：宿主组件把本函数的返回值当 activator 用
 * （host.ts 的 createPanelHost(activator, panelId)）。
 */
export function createTabsActivator(tabs: readonly TabSpec[]): BoardActivator {
  if (tabs.length === 0) {
    throw new Error('[tabs] 至少需要一个 TabSpec')
  }

  return function attachTabbedViews(
    container: HTMLElement,
    opts: { isActive: () => boolean },
  ): () => void {
    let activeIdx = 0
    let disposeBoard: (() => void) | null = null

    const bar = el('div', { class: 'dsh-df-tabs', role: 'tablist' })
    const paneStack = el('div', {})
    const buttons: HTMLButtonElement[] = []
    const panes: HTMLElement[] = []

    tabs.forEach((tab, idx) => {
      const btn = el('button', {
        class: 'dsh-df-tab',
        type: 'button',
        role: 'tab',
        'aria-selected': idx === 0,
        'data-dsh-df-tab': tab.id,
      }, tab.label)
      btn.addEventListener('click', () => { if (idx !== activeIdx) setActive(idx) })
      bar.append(btn)
      buttons.push(btn)
      panes.push(el('div', {
        class: 'dsh-df-tabpane',
        role: 'tabpanel',
        'data-dsh-df-tabpane': tab.id,
      }))
    })
    paneStack.append(...panes)

    container.replaceChildren()
    container.append(bar, paneStack)

    function setActive(idx: number): void {
      activeIdx = idx
      disposeBoard?.()
      disposeBoard = null
      for (const [i, btn] of buttons.entries()) {
        btn.setAttribute('aria-selected', i === idx ? 'true' : 'false')
      }
      // 卸旧挂新：pane 此前为空，attacher 自带 replaceChildren，重挂幂等
      disposeBoard = tabs[idx].attach(panes[idx], { isActive: opts.isActive })
    }

    setActive(0)
    return () => {
      disposeBoard?.()
      disposeBoard = null
    }
  }
}
