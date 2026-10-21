/**
 * 共享浏览器引擎（seam 适配）：录制队列轮询 / 步骤回放 / 断言 / 失败证据 / 引擎边界。
 *
 * 用假 seam 驱动（不启动真浏览器，真链路需宿主装 dsh-builtin-browser 后按 e2e 清单验）。
 *
 * @module dsh-dataforge/test/uitest/shared-engine
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BrowserSeam, SeamExecuteResult, SeamScreenshot, SeamTarget, SeamWaitResult } from '../../src/uitest/browser-seam.js'
import { SharedBrowserEngine } from '../../src/uitest/engines/shared.js'
import type { UiScriptDoc } from '../../src/uitest/schema.js'
import { readUiRunEvents, readUiRunRecord } from '../../src/uitest/run-store.js'
import { PICKER_SCRIPT } from '../../src/uitest/selector-script.js'
import { parseUiScriptDoc } from '../../src/uitest/schema.js'

type FakeElement = { count?: number; visible?: boolean; text?: string; value?: string }

class FakeSeam implements BrowserSeam {
  readonly sessions = new Map<string, { url: string; installed: boolean }>()
  readonly queue: unknown[] = []
  readonly actions: Array<{ kind: string; target?: SeamTarget; value?: unknown }> = []
  elements = new Map<string, FakeElement>([
    ['#result', { count: 1, visible: true, text: '结果' }],
    ['#echo', { count: 1, visible: true, text: '键盘精灵' }],
  ])
  closed: string[] = []
  openedLabels: string[] = []
  private seq = 0

  async open(label?: string): Promise<string> {
    const id = `seam_${++this.seq}`
    this.openedLabels.push(label ?? '')
    this.sessions.set(id, { url: '', installed: false })
    return id
  }
  async openUrl(session: string, request: { url: string }): Promise<void> { this.goto(session, request.url) }
  async navigate(session: string, request: { url: string }): Promise<void> { this.goto(session, request.url) }
  private goto(session: string, url: string): void {
    const state = this.sessions.get(session)
    if (state !== undefined) state.url = url
  }
  async listTabs(session: string) { return [{ id: 'tab1', url: this.sessions.get(session)?.url ?? '', active: true }] }
  async waitFor(): Promise<SeamWaitResult> { return { ready: true, reason: 'condition met' } }
  async click(_session: string, request: { target: SeamTarget } | { x: number; y: number }): Promise<void> {
    if ('target' in request) this.actions.push({ kind: 'click', target: request.target })
    else this.actions.push({ kind: 'click', value: { x: request.x, y: request.y } })
  }
  async setValue(_session: string, request: { target: SeamTarget; value: string | number | boolean }): Promise<unknown> {
    this.actions.push({ kind: 'setValue', target: request.target, value: request.value })
    return { value: String(request.value) }
  }
  async type(_session: string, request: { target: SeamTarget; text: string }): Promise<void> { this.actions.push({ kind: 'type', target: request.target, value: request.text }) }
  async key(_session: string, request: { key: string }): Promise<void> { this.actions.push({ kind: 'key', value: request.key }) }
  async selectOption(_session: string, request: { target: SeamTarget; optionValue?: string }): Promise<unknown> {
    this.actions.push({ kind: 'select', target: request.target, value: request.optionValue })
    return { value: request.optionValue }
  }
  async scroll(_session: string, request: { deltaX?: number; deltaY?: number; selector?: string; toTop?: boolean; toBottom?: boolean }): Promise<void> {
    this.actions.push({ kind: 'scroll', value: { deltaY: request.deltaY, selector: request.selector } })
  }
  async screenshot(): Promise<SeamScreenshot> { return { dataUrl: 'data:image/png;base64,AAAA' } }
  async close(session: string): Promise<void> { this.closed.push(session); this.sessions.delete(session) }

  emit(payload: unknown): void { this.queue.push(payload) }

  async execute(session: string, request: { script: string; args?: readonly unknown[]; timeoutMs?: number }): Promise<SeamExecuteResult> {
    const state = this.sessions.get(session)
    if (state === undefined) return { ok: false, exception: 'session not found' }
    const script = request.script
    if (script.includes('events: Array.isArray(queue)')) {
      const events = this.queue.splice(0, this.queue.length)
      return { ok: true, value: { installed: state.installed, events, url: state.url } }
    }
    if (script.includes('apple-mobile-web-app-title')) {
      return { ok: true, value: { url: state.url, title: '示例页 - 示例站', siteName: '示例站' } }
    }
    if (script.includes('document.querySelectorAll(f.tag')) {
      const features = (request.args?.[0] ?? {}) as { tag?: string }
      if (features.tag !== 'canvas') return { ok: true, value: null }
      // 模拟"元素在回放时被移动/缩放"：几何与录制时不同，必须用当前 rect 重算。
      return { ok: true, value: { tag: 'CANVAS', x: 300, y: 200, w: 200, h: 100, vw: 1280, vh: 720 } }
    }
    if (script.includes('w: r.width, h: r.height')) {
      const selector = String(request.args?.[0] ?? '')
      if (selector.includes('#missing')) return { ok: true, value: null }
      return { ok: true, value: { tag: 'CANVAS', x: 100, y: 50, w: 200, h: 100, vw: 1280, vh: 720 } }
    }
    if (script.includes('innerWidth, vh')) {
      return { ok: true, value: { vw: 1280, vh: 720 } }
    }
    if (script === PICKER_SCRIPT) {
      return { ok: true, value: { ok: true, pageUrl: state.url, selector: '#kw', candidates: ['#kw'], element: { tag: 'INPUT', id: 'kw', text: '' } } }
    }
    if (script.startsWith('return (function (candidates)')) {
      const candidates = (request.args?.[0] as string[] | undefined) ?? []
      const kept = candidates.filter((candidate) => (this.elements.get(candidate)?.count ?? 1) === 1)
      return { ok: true, value: kept.length > 0 ? kept : candidates }
    }
    if (script.startsWith('return (function (kind, selector, equals, contains)')) {
      const [kind, selector, equals, contains] = request.args ?? []
      const element = this.elements.get(String(selector ?? ''))
      if (kind === 'url') {
        const ok = equals !== undefined && equals !== null && equals !== '' ? state.url === String(equals) : state.url.includes(String(contains ?? ''))
        return { ok: true, value: { ok, actual: state.url } }
      }
      if (kind === 'count') return { ok: true, value: { ok: (element?.count ?? 0) === Number(equals), actual: String(element?.count ?? 0) } }
      if (kind === 'visible') return { ok: true, value: { ok: element?.visible === true, actual: element?.visible === true ? 'visible' : 'hidden' } }
      if (kind === 'hidden') return { ok: true, value: { ok: element?.visible !== true, actual: element?.visible === true ? 'visible' : 'hidden' } }
      if (kind === 'value') {
        const value = element?.value ?? ''
        return { ok: true, value: { ok: equals !== undefined && equals !== null ? value === String(equals) : value.includes(String(contains ?? '')), actual: value } }
      }
      const text = element?.text ?? ''
      return { ok: true, value: { ok: equals !== undefined && equals !== null ? text === String(equals) : text.includes(String(contains ?? '')), actual: text } }
    }
    if (script.includes('requestSubmit')) return { ok: true, value: 'ok' }
    if (script.includes('outerHTML')) return { ok: true, value: '<html>failure</html>' }
    if (script.includes('__dfUiRecorder')) { state.installed = true; return { ok: true, value: undefined } }
    if (script.includes('__dfUiSelectorCandidates')) return { ok: true, value: undefined }
    return { ok: true, value: undefined }
  }
}

function script(overrides: Partial<UiScriptDoc> = {}): UiScriptDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'ui-script',
    meta: {
      site: '示例站', flow: '搜索', version: 1, created: '2026-10-18T00:00:00+08:00',
      startUrl: 'https://example.com/',
    },
    inputs: [],
    steps: [
      { id: 's1', kind: 'goto', url: 'https://example.com/' },
      { id: 's2', kind: 'fill', selector: '#kw', value: '键盘精灵' },
      { id: 's3', kind: 'click', selector: 'button:has-text("搜索")' },
      { id: 's4', kind: 'click', selector: '#echo', expect: [{ kind: 'text', selector: '#echo', equals: '键盘精灵' }] },
    ],
    ...overrides,
  }
}

let dir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-ui-shared-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function engine(seam: FakeSeam = new FakeSeam(), owner: string | undefined = 'session-test'): { engine: SharedBrowserEngine; seam: FakeSeam } {
  return {
    engine: new SharedBrowserEngine({
      resolveSeam: () => seam,
      resolveOwner: () => owner,
      dataRoot: join(dir as string, 'data'),
      stepTimeoutMs: 500,
      pollIntervalMs: 10,
    }),
    seam,
  }
}

describe('SharedBrowserEngine 录制', () => {
  it('open → start → 轮询队列 → stop 生成步骤（候选校验走页面内 CSS）', async () => {
    const { engine: e, seam } = engine()
    const opened = await e.open({ startUrl: 'https://example.com/' })
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.sessionId === undefined) return
    expect(e.available()).toBe(true)
    expect(e.pageUrlOf(opened.sessionId)).toBe('https://example.com/')
    // 会话 id 必须作为 owner 传给共享浏览器（否则右侧栏面板定位不到）。
    expect(seam.openedLabels).toEqual(['session-test'])

    const started = await e.start(opened.sessionId)
    expect(started.ok).toBe(true)
    seam.emit({ kind: 'fill', candidates: ['#kw'], value: '键盘精灵', at: 'https://example.com/' })
    seam.emit({ kind: 'click', candidates: ['button:has-text("搜索")'], isSubmitter: true })
    seam.emit({ kind: 'skip-secret' })
    await new Promise((resolve) => setTimeout(resolve, 40))

    const stopped = await e.stop(opened.sessionId)
    expect(stopped.ok).toBe(true)
    const result = stopped.result
    expect(result?.steps.map((step) => step.kind)).toEqual(['fill', 'click'])
    expect(result?.steps[0]?.value).toBe('键盘精灵')
    expect(result?.skippedSecrets).toBe(1)
    expect(e.list()).toHaveLength(1)
  })

  it('显式 owner 优先于进程级会话：页面才会挂到指定对话的侧栏', async () => {
    const { engine: e, seam } = engine()
    const opened = await e.open({ startUrl: 'https://example.com/', owner: 'session-explicit' })
    expect(opened.ok).toBe(true)
    expect(seam.openedLabels).toContain('session-explicit')
  })

  it('拿不到对话 id：如实拒绝（不能拿固定标签硬开）', async () => {
    const { engine: e } = engine(new FakeSeam(), '')
    const opened = await e.open({ startUrl: 'https://example.com/' })
    expect(opened.ok).toBe(false)
    expect(opened.error).toContain('对话 id')
  })

  it('未开始录制就 stop：如实报错；close 后不可用', async () => {
    const { engine: e } = engine()
    const opened = await e.open({ startUrl: 'https://example.com/' })
    if (!opened.ok || opened.sessionId === undefined) return
    const stopped = await e.stop(opened.sessionId)
    expect(stopped.ok).toBe(false)
    await e.close(opened.sessionId)
    expect(e.has(opened.sessionId)).toBe(false)
  })

  it('页面元信息：返回 URL/标题/站点名（自动命名用）', async () => {
    const { engine: e } = engine()
    const opened = await e.open({ startUrl: 'https://example.com/' })
    if (!opened.ok || opened.sessionId === undefined) return
    const meta = await e.pageMeta(opened.sessionId)
    expect(meta).toEqual({ url: 'https://example.com/', title: '示例页 - 示例站', siteName: '示例站' })
  })

  it('点选：走 seam execute 的 Promise 形态', async () => {
    const { engine: e } = engine()
    const opened = await e.open({ startUrl: 'https://example.com/' })
    if (!opened.ok || opened.sessionId === undefined) return
    const picked = await e.pickSelector(opened.sessionId)
    expect(picked.ok).toBe(true)
    expect(picked.selector).toBe('#kw')
  })
})

describe('SharedBrowserEngine 回放', () => {
  it('全部步骤 + 断言通过：run 留痕 + 动作经 seam 发出', async () => {
    const { engine: e, seam } = engine()
    const result = await e.run(script(), {})
    expect(result.success, result.error).toBe(true)
    expect(result.failedStep).toBeUndefined()
    expect(seam.actions.some((action) => action.kind === 'click')).toBe(true)
    expect(seam.actions.some((action) => action.kind === 'setValue')).toBe(true)

    const record = readUiRunRecord(join(dir as string, 'data'), result.runId)
    expect(record?.status).toBe('success')
    expect(record?.engine).toBe('shared')
    const events = readUiRunEvents(join(dir as string, 'data'), result.runId)
    expect(events.some((event) => event.event === 'terminal' && event.success === true)).toBe(true)
  })

  it('scroll 步骤：deltaY 窗口滚动 / selector 滚到元素，都经 seam.scroll 发出', async () => {
    const { engine: e, seam } = engine()
    const doc = script({
      steps: [
        { id: 's1', kind: 'goto', url: 'https://example.com/' },
        { id: 's2', kind: 'scroll', deltaY: 600 },
        { id: 's3', kind: 'scroll', selector: '#more' },
      ],
    })
    const result = await e.run(doc, {})
    expect(result.success, result.error).toBe(true)
    const scrolls = seam.actions.filter((action) => action.kind === 'scroll')
    expect(scrolls).toHaveLength(2)
    expect(scrolls[0]?.value).toEqual({ deltaY: 600, selector: undefined })
    expect(scrolls[1]?.value).toEqual({ deltaY: undefined, selector: '#more' })
  })

  it('原元素位置尺寸未变：直接用录制坐标，不重算', async () => {
    const { engine: e, seam } = engine()
    const opened = await e.open({ startUrl: 'https://example.com/' })
    if (!opened.ok) throw new Error(opened.error)
    const doc = parseUiScriptDoc({
      apiVersion: 'dataforge/v1',
      kind: 'ui-script',
      meta: { site: '示例站', flow: '图表', version: 1, created: new Date().toISOString(), startUrl: 'https://example.com/' },
      inputs: [],
      steps: [{
        id: 's1',
        kind: 'click',
        selector: '#chart',
        clickPoint: { fx: 0.25, fy: 0.5, x: 222, y: 111, vw: 1280, vh: 720, tag: 'CANVAS', bx: 100, by: 50, bw: 200, bh: 100 },
        features: { tag: 'canvas' },
      }],
    })
    if (!doc.ok) throw new Error(JSON.stringify(doc.issues))
    const result = await e.run(doc.doc, {})
    expect(result.success, result.error).toBe(true)
    const click = seam.actions.find((action) => action.kind === 'click')
    expect(click?.value).toEqual({ x: 222, y: 111 })
  })

  it('原元素移动/缩放：按当前 rect 重算坐标', async () => {
    const { engine: e, seam } = engine()
    const opened = await e.open({ startUrl: 'https://example.com/' })
    if (!opened.ok) throw new Error(opened.error)
    const doc = parseUiScriptDoc({
      apiVersion: 'dataforge/v1',
      kind: 'ui-script',
      meta: { site: '示例站', flow: '图表', version: 1, created: new Date().toISOString(), startUrl: 'https://example.com/' },
      inputs: [],
      steps: [{
        id: 's1',
        kind: 'click',
        selector: '#chart',
        clickPoint: { fx: 0.25, fy: 0.5, x: 222, y: 111, vw: 1280, vh: 720, tag: 'CANVAS', bx: 0, by: 0, bw: 100, bh: 50 },
        features: { tag: 'canvas' },
      }],
    })
    if (!doc.ok) throw new Error(JSON.stringify(doc.issues))
    const result = await e.run(doc.doc, {})
    expect(result.success, result.error).toBe(true)
    const click = seam.actions.find((action) => action.kind === 'click')
    // 当前 rect = 100,50,200,100 → fx=.25/fy=.5 → 150,100
    expect(click?.value).toEqual({ x: 150, y: 100 })
  })

  it('canvas 点击：选择器失效时用 features 找回元素，并按当前 rect 重新计算坐标', async () => {
    const { engine: e, seam } = engine()
    const opened = await e.open({ startUrl: 'https://example.com/' })
    if (!opened.ok) throw new Error(opened.error)
    const doc = parseUiScriptDoc({
      apiVersion: 'dataforge/v1',
      kind: 'ui-script',
      meta: { site: '示例站', flow: '图表', version: 1, created: new Date().toISOString(), startUrl: 'https://example.com/' },
      inputs: [],
      steps: [{
        id: 's1',
        kind: 'click',
        selector: '#missing',
        clickPoint: { fx: 0.25, fy: 0.5, x: 150, y: 100, vw: 1280, vh: 720, tag: 'CANVAS' },
        features: { tag: 'canvas', canvasIndex: 0 },
      }],
    })
    if (!doc.ok) throw new Error(JSON.stringify(doc.issues))
    const result = await e.run(doc.doc, {})
    expect(result.success, result.error).toBe(true)
    const click = seam.actions.find((action) => action.kind === 'click')
    expect(click?.value).toEqual({ x: 350, y: 250 })
  })

  it('canvas 点击：按 clickPoint 换算坐标，不用元素中心', async () => {
    const { engine: e, seam } = engine()
    const opened = await e.open({ startUrl: 'https://example.com/' })
    if (!opened.ok) throw new Error(opened.error)
    const doc = parseUiScriptDoc({
      apiVersion: 'dataforge/v1',
      kind: 'ui-script',
      meta: { site: '示例站', flow: '图表', version: 1, created: new Date().toISOString(), startUrl: 'https://example.com/' },
      inputs: [],
      steps: [{
        id: 's1',
        kind: 'click',
        selector: '#chart',
        clickPoint: { fx: 0.25, fy: 0.5, x: 150, y: 100, vw: 1280, vh: 720, tag: 'CANVAS' },
      }],
    })
    if (!doc.ok) throw new Error(JSON.stringify(doc.issues))
    const result = await e.run(doc.doc, {})
    expect(result.success).toBe(true)
    const click = seam.actions.find((action) => action.kind === 'click')
    expect(click?.value).toEqual({ x: 150, y: 100 })
  })

  it('断言失败：截图落盘 + failedStep', async () => {
    const { engine: e } = engine()
    const result = await e.run(script({
      steps: [
        { id: 's1', kind: 'goto', url: 'https://example.com/' },
        { id: 's2', kind: 'click', selector: '#echo', expect: [{ kind: 'text', selector: '#echo', equals: '别的文案' }] },
      ],
    }), {})
    expect(result.success).toBe(false)
    expect(result.failedStep?.id).toBe('s2')
    expect(result.screenshot).toContain('failure.png')
    expect(existsSync(join(dir as string, 'data', result.screenshot as string))).toBe(true)
    expect(result.dom).toContain('failure.html')
  })

  it('upload 步骤：共享引擎如实拒绝（指回 Playwright 引擎）', async () => {
    const { engine: e } = engine()
    const result = await e.run(script({
      steps: [{ id: 's1', kind: 'upload', selector: '#file', files: ['/tmp/a.txt'] }],
    }), {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('不支持 upload')
  })
})
