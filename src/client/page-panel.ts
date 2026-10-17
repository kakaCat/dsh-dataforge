/**
 * 页面插槽注册 helper —— 一次注册 `main` 与 `sidebar.panellist` 两端，保证 id 同源。
 *
 * 背景：DSH 的 MainPanelId 契约要求「侧栏条目」与「主列占用者」共享同一个 id
 * （官方 plugin-manager 样板即同一次 apply 注册两处）。分两处手写 id 必然漂移，故收敛成一个调用。
 * 契约照抄 dsh-pmboard/page-panel（REQ-260928185112-e20d），仅去掉了本项目用不到的分支。
 *
 * 依赖纪律：本包 client 半自包含（client 构建里必须零 bare import）；
 * 本模块**零 import**，包含 react（图标由调用方传入占用者组件）。
 *
 * @module dsh-dataforge/client/page-panel
 */

/** main 插槽名（keyed；conversation 键由框架占用，插件不注册 conversation）。 */
export const PAGE_PANEL_MAIN_SLOT = 'main'
/** 侧栏全局面板条目插槽名（list / root 作用域）。 */
export const PAGE_PANEL_SIDEBAR_SLOT = 'sidebar.panellist'

/** slots 服务的最小投影（官方形状；只声明本 helper 用到的两个方法）。 */
export interface SlotRegistrar {
  /** 把注册推迟到目标插槽存在时执行；返回官方给的撤销句柄（形状未定义，宽容处理）。 */
  inject(slot: string, thunk: () => unknown): unknown
  /** 注册一个占用者；options.name 必须等于 slot。 */
  register(options: Record<string, unknown>, occupant: unknown): unknown
}

/** 一个页面在两端注册时需要的全部信息。 */
export interface PagePanelSpec {
  /** 主列 key 与侧栏条目 id 的同源身份（MainPanelId）。 */
  id: string
  /** 侧栏条目文案（同时作为 accessible name）。 */
  label: string
  /** 侧栏条目排序（升序，并列保持注册顺序），默认 0。 */
  order?: number
  /** 主列占用者：React 组件，收 main 插槽标准 props（含 usePanelInfo）。 */
  Component: unknown
  /** 侧栏图标占用者：React 组件，收 { size, active }；缺省为不渲染任何内容的占位。 */
  Icon?: unknown
}

/** 缺省图标：合法的 React 组件（返回 null），不引入 react。 */
const NO_GLYPH = (): null => null

/** 把官方返回的任意形状当成 disposer（函数才调，其余忽略）。 */
function asDisposer(handle: unknown): () => void {
  return typeof handle === 'function' ? (handle as () => void) : () => { /* 无句柄可撤 */ }
}

/**
 * 注册一个页面：main（key = spec.id）与 sidebar.panellist（id = spec.id）。
 *
 * @param ctx - 插件 apply 收到的 client ctx（只需 slots）。
 * @param spec - 页面的 id / label / 组件。
 * @returns 幂等 disposer：撤销两次注册，重复调用无副作用。
 * @throws 当 ctx.slots 缺失时抛错——响亮失败，不静默降级为「页面不存在」。
 */
export function registerPagePanel(ctx: { slots?: SlotRegistrar }, spec: PagePanelSpec): () => void {
  const slots = ctx === undefined || ctx === null ? undefined : ctx.slots
  if (slots === undefined || slots === null) {
    throw new Error('[page-panel] ctx.slots unavailable（inject 缺 "slots"）')
  }
  const id = spec.id

  // 两端都用 inject 包一层：插槽声明可能晚于本插件的 apply（官方样板同款）。
  const disposers: Array<() => void> = [
    asDisposer(slots.inject(PAGE_PANEL_MAIN_SLOT, () =>
      slots.register({ name: PAGE_PANEL_MAIN_SLOT, key: id }, spec.Component))),
    asDisposer(slots.inject(PAGE_PANEL_SIDEBAR_SLOT, () =>
      slots.register({
        name: PAGE_PANEL_SIDEBAR_SLOT,
        id,
        order: spec.order ?? 0,
        label: spec.label,
      }, spec.Icon ?? NO_GLYPH))),
  ]

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const dispose of disposers) {
      try { dispose() } catch { /* 单个撤销失败不阻塞其余清理 */ }
    }
  }
}
