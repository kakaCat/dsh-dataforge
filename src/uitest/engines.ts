/**
 * UI 测试的浏览器引擎契约。
 *
 * 为什么要这层：录制/回放的数据语义（ui-script、断言、run 留痕、批量报告）不该绑定在
 * 某一种"怎么拿到页面"上。当前两种实现：
 *   - `playwright`：dataforge 自己拉起系统 Chrome（可见窗口录制 / 无头回放；上传可用）；
 *   - `shared`：`dsh-builtin-browser` 的 seam（人机同页、可人工接管；上传不可用）。
 * 未来接 CDP 引擎时，只需新增一个实现本接口的类（`kind: 'cdp'`），配置切换即可，
 * 上层 application / tools / panel / batch 不动。
 *
 * 接口刻意分两段：会话/录制生命周期 + 单次回放。批量回归由上层固定选用
 * `UiTestDeps.batchEngine`（默认 playwright 无头），不在这里表达。
 *
 * @module dsh-dataforge/uitest/engines
 */
import type { UiRecordingResult } from './recorder.js'
import type { UiRecordingSessionView } from './sessions.js'
import type { PickedElement } from './selector-script.js'
import type { UiCookie, UiRunResult } from './run.js'
import type { UiScriptDoc } from './schema.js'
import type { UiPageMeta } from './naming.js'

/** 引擎身份词表；`cdp` 为未来接入预留。 */
export type UiBrowserEngineKind = 'playwright' | 'shared' | 'cdp'

/** 打开会话的参数（与现有 UiRecordingSessions.open 同形）。 */
export type UiEngineOpenArgs = {
  startUrl: string
  headless?: boolean
  viewport?: { width: number; height: number }
  /** 仅 Playwright 引擎消费；共享浏览器用自己的持久 profile。 */
  cookies?: UiCookie[]
  navigationTimeoutMs?: number
  /**
   * 共享浏览器需要的「对话身份」（owner，`session-…`）：页面会挂到该对话的右侧栏面板。
   * agent 工具传 `exec.agent.id`；面板请求传 `?session=`（客户端 `useSessions.current`）。
   */
  owner?: string
}

export type UiEngineOpenResult = {
  ok: boolean
  sessionId?: string
  pageUrl?: string
  error?: string
}

export type UiEngineStartResult = {
  ok: boolean
  pageUrl?: string
  error?: string
  alreadyRecording?: boolean
}

export type UiEngineStopResult = {
  ok: boolean
  result?: UiRecordingResult
  error?: string
}

export type UiEngineRunOptions = {
  headless?: boolean
  /** 每步之间的慢放延迟（毫秒，0..10000）。 */
  slowMoMs?: number
  /** 点击时在落点画脉冲光圈（缺省 true）。 */
  highlightClicks?: boolean
  /** 回放结束后停留多久再关浏览器（毫秒，0..30000）。 */
  holdMs?: number
  /** 共享引擎回放时开会话用的对话身份；Playwright 引擎忽略。 */
  owner?: string
}

/**
 * 一个浏览器引擎：同一套方法，两种（未来三种）承载。
 *
 * 语义约定：
 *   - `open/start/stop/pickSelector/close/list` 是**录制**链路，会话 id 由引擎自己分配；
 *   - `run` 是**单次回放**链路，内部自己开会话、跑完关闭，语义与 `runUiScript` 一致；
 *   - `managesCookies` 表示引擎自己管理登录态（共享浏览器用插件 profile），
 *     此时上层**不要**把 dataforge 的 cookie jar 写回/注入。
 */
export interface UiBrowserEngine {
  readonly kind: UiBrowserEngineKind
  /** 展示名（回执/日志/面板提示用）。 */
  readonly label: string
  /** 引擎自己管理登录态（共享浏览器为 true；Playwright/CDP 用 dataforge jar 为 false）。 */
  readonly managesCookies: boolean
  /** 运行时可用性（'shared' 需要宿主注册了 ctx.browser 服务）。 */
  available(): boolean

  open(args: UiEngineOpenArgs): Promise<UiEngineOpenResult>
  start(sessionId: string): Promise<UiEngineStartResult>
  stop(sessionId: string): Promise<UiEngineStopResult>
  /** 在已打开会话里点选元素（补断言/改步骤用）。 */
  pickSelector(sessionId: string, timeoutMs?: number): Promise<PickedElement>
  /** 读当前页面元信息（URL/标题/站点名），用于落盘时自动命名；读不到返回空对象。 */
  pageMeta(sessionId: string): Promise<UiPageMeta>
  cookiesOf(sessionId: string): Promise<UiCookie[]>
  close(sessionId: string): Promise<{ ok: boolean; error?: string }>
  list(): UiRecordingSessionView[]
  pageUrlOf(sessionId: string): string | undefined
  has(sessionId: string): boolean
  closeAll(): Promise<void>

  /** 回放一份脚本（内部自开会话并关闭）。 */
  run(doc: UiScriptDoc, inputs: Record<string, string>, options?: UiEngineRunOptions): Promise<UiRunResult>
}

/** 引擎选择结果：`degraded` 非空表示"显式选择不可用后的回退说明"。 */
export type UiEngineSelection = {
  engine: UiBrowserEngine
  degraded?: string
}
