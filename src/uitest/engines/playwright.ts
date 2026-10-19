/**
 * Playwright 引擎：dataforge 自己拉起的系统 Chrome（现有实现，行为不变）。
 *
 * 会话生命周期直接委托 `UiRecordingSessions`；回放委托 `runUiScript`（可见/无头由参数控制）。
 * 未来 CDP 引擎可以复用这两块，只把"怎么连浏览器"换成 `connectOverCDP` 的工厂——
 * 这也是这层接口存在的意义：上层 application 永远只见 `UiBrowserEngine`。
 *
 * @module dsh-dataforge/uitest/engines/playwright
 */
import type { UiBrowserEngine, UiEngineOpenArgs, UiEngineOpenResult, UiEngineRunOptions, UiEngineStartResult, UiEngineStopResult } from '../engines.js'
import type { PickedElement } from '../selector-script.js'
import type { UiRecordingSessionView, UiRecordingSessions } from '../sessions.js'
import type { UiCookie, UiRunResult } from '../run.js'
import type { UiScriptDoc } from '../schema.js'
import type { UiPageMeta } from '../naming.js'

export type PlaywrightEngineIo = {
  sessions: UiRecordingSessions
  /** 系统 Chrome 通道（'chrome'）。 */
  channel: string
  /** 回放缝：测试可注入假实现；生产接 runUiScript。 */
  run: (doc: UiScriptDoc, inputs: Record<string, string>, options?: UiEngineRunOptions) => Promise<UiRunResult>
}

export class PlaywrightBrowserEngine implements UiBrowserEngine {
  readonly kind = 'playwright' as const
  readonly label = '独立 Chrome（Playwright）'
  readonly managesCookies = false

  constructor(private readonly io: PlaywrightEngineIo) {}

  available(): boolean {
    return true
  }

  open(args: UiEngineOpenArgs): Promise<UiEngineOpenResult> {
    return this.io.sessions.open({ ...args, channel: this.io.channel })
  }

  start(sessionId: string): Promise<UiEngineStartResult> {
    return this.io.sessions.start(sessionId)
  }

  stop(sessionId: string): Promise<UiEngineStopResult> {
    return this.io.sessions.stop(sessionId)
  }

  pickSelector(sessionId: string, timeoutMs?: number): Promise<PickedElement> {
    return this.io.sessions.pickSelector(sessionId, timeoutMs)
  }

  pageMeta(sessionId: string): Promise<UiPageMeta> {
    return this.io.sessions.pageMetaOf(sessionId)
  }

  cookiesOf(sessionId: string): Promise<UiCookie[]> {
    return this.io.sessions.cookiesOf(sessionId)
  }

  close(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    return this.io.sessions.close(sessionId)
  }

  list(): UiRecordingSessionView[] {
    return this.io.sessions.list()
  }

  pageUrlOf(sessionId: string): string | undefined {
    return this.io.sessions.pageUrlOf(sessionId)
  }

  has(sessionId: string): boolean {
    return this.io.sessions.has(sessionId)
  }

  closeAll(): Promise<void> {
    return this.io.sessions.closeAll()
  }

  run(doc: UiScriptDoc, inputs: Record<string, string>, options?: UiEngineRunOptions): Promise<UiRunResult> {
    return this.io.run(doc, inputs, options)
  }
}
