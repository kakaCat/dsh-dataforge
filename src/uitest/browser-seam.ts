/**
 * 共享浏览器 seam 的最小结构契约（duck typing，不 import 第三方包）。
 *
 * 对应 `dsh-builtin-browser` 注册的 Cordis 服务 `ctx.browser`（`BrowserRuntime`）：
 * 它对外暴露高层操作 + `execute`（页面内 JS）+ `screenshot` + `waitFor`，**不暴露 CDP 端点**。
 *
 * 为什么这里自己声明而不 import `dsh-builtin-browser` 的类型：
 *   - dataforge 不硬依赖这个第三方插件（没装时面板/工具照常，回退 Playwright 引擎）；
 *   - 只声明真正用到的方法，类型面最小；升级插件时不会因为它的类型迁移而编译失败。
 *
 * @module dsh-dataforge/uitest/browser-seam
 */

/** 元素定位（与 seam 的 BrowserElementTarget 同形）。 */
export type SeamTarget = {
  by: 'css' | 'text' | 'xpath'
  value: string
  index?: number
}

export type SeamTab = {
  id: string
  url: string
  title?: string
  active: boolean
}

export type SeamExecuteResult =
  | { ok: true; value: unknown }
  | { ok: false; exception: string }

export type SeamScreenshot = {
  dataUrl: string
  width?: number
  height?: number
}

export type SeamWaitResult = { ready: boolean; reason: string }

/** 共享浏览器 seam（只列 dataforge 用到的能力）。 */
export interface BrowserSeam {
  open(label?: string): Promise<string>
  openUrl(session: string, request: { url: string; newTab?: boolean }): Promise<void>
  navigate(session: string, request: { url: string }): Promise<void>
  listTabs(session: string): Promise<readonly SeamTab[]>
  waitFor(session: string, request: { url?: string; selector?: string; loaded?: boolean; timeoutMs?: number }): Promise<SeamWaitResult>
  execute(session: string, request: { script: string; args?: readonly unknown[]; timeoutMs?: number }): Promise<SeamExecuteResult>
  /** 语义定位点击，或按视口坐标点击（canvas 图表用）。 */
  click(session: string, request: { target: SeamTarget } | { x: number; y: number }): Promise<void>
  setValue(session: string, request: { target: SeamTarget; value: string | number | boolean; timeoutMs?: number }): Promise<unknown>
  type(session: string, request: { target: SeamTarget; text: string }): Promise<void>
  key(session: string, request: { key: string }): Promise<void>
  selectOption(session: string, request: { target: SeamTarget; optionValue?: string; optionText?: string; optionIndex?: number }): Promise<unknown>
  scroll(session: string, request: { deltaX?: number; deltaY?: number; selector?: string; toTop?: boolean; toBottom?: boolean }): Promise<void>
  screenshot(session: string, request?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<SeamScreenshot>
  close(session: string): Promise<void>
}
