//#region src/client/page-panel.d.ts
/** slots 服务的最小投影（官方形状；只声明本 helper 用到的两个方法）。 */
interface SlotRegistrar {
  /** 把注册推迟到目标插槽存在时执行；返回官方给的撤销句柄（形状未定义，宽容处理）。 */
  inject(slot: string, thunk: () => unknown): unknown;
  /** 注册一个占用者；options.name 必须等于 slot。 */
  register(options: Record<string, unknown>, occupant: unknown): unknown;
}
/** 一个页面在两端注册时需要的全部信息。 */
interface PagePanelSpec {
  /** 主列 key 与侧栏条目 id 的同源身份（MainPanelId）。 */
  id: string;
  /** 侧栏条目文案（同时作为 accessible name）。 */
  label: string;
  /** 侧栏条目排序（升序，并列保持注册顺序），默认 0。 */
  order?: number;
  /** 主列占用者：React 组件，收 main 插槽标准 props（含 usePanelInfo）。 */
  Component: unknown;
  /** 侧栏图标占用者：React 组件，收 { size, active }；缺省为不渲染任何内容的占位。 */
  Icon?: unknown;
}
/**
 * 注册一个页面：main（key = spec.id）与 sidebar.panellist（id = spec.id）。
 *
 * @param ctx - 插件 apply 收到的 client ctx（只需 slots）。
 * @param spec - 页面的 id / label / 组件。
 * @returns 幂等 disposer：撤销两次注册，重复调用无副作用。
 * @throws 当 ctx.slots 缺失时抛错——响亮失败，不静默降级为「页面不存在」。
 */
declare function registerPagePanel(ctx: {
  slots?: SlotRegistrar;
}, spec: PagePanelSpec): () => void;
//#endregion
//#region src/client/index.d.ts
declare const name = "dsh-dataforge/client";
/** 权限最小化：本客户端只读 slots（sidebarRight/layout 等官方服务按需再加）。 */
declare const inject: string[];
interface ApplyContext {
  slots?: Parameters<typeof registerPagePanel>[0]['slots'];
  /** cordis 的惰性服务查询（sidebarRight 等服务按需取，不扩大 inject 依赖）。 */
  get?: (name: string) => unknown;
}
declare function apply(ctx: ApplyContext): void;
//#endregion
export { apply, inject, name };