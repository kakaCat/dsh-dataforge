/**
 * 录制器：事件 → 步骤（去重/脱敏/候选校验/计数）。
 *
 * 用假 Page 驱动：只覆盖录制器用到的原语（exposeBinding / evaluate / locator / on），
 * 不起真浏览器——真链路在 `test/uitest/e2e-local.test.ts`（默认跳过）。
 *
 * @module dsh-dataforge/test/uitest/recorder
 */
import { describe, expect, it } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import { RECORDER_SOURCE, UiRecorder, forgetRecorder } from '../../src/uitest/recorder.js'

type Binding = (source: unknown, payload: unknown) => void

type FakePage = {
  page: Page
  /** 模拟页面回传事件。 */
  emit: (payload: unknown) => void
  /** 模拟文件选择（录制器只计数）。 */
  filechooser: () => void
  /** 各 selector 的命中数；缺省 1。 */
  counts: Map<string, number>
  evaluateCalls: string[]
}

function fakePage(options: { url?: string; counts?: Record<string, number> } = {}): FakePage {
  let binding: Binding | undefined
  const counts = new Map(Object.entries(options.counts ?? {}))
  const evaluateCalls: string[] = []
  const listeners = new Map<string, Array<() => void>>()
  const context = {
    addInitScript: async (): Promise<void> => undefined,
    cookies: async (): Promise<unknown[]> => [],
  } as unknown as BrowserContext
  const page = {
    url: (): string => options.url ?? 'https://example.com/start',
    viewportSize: (): { width: number; height: number } => ({ width: 1440, height: 900 }),
    context: (): BrowserContext => context,
    exposeBinding: async (_name: string, callback: Binding): Promise<void> => {
      binding = callback
    },
    evaluate: async (script: unknown): Promise<unknown> => {
      evaluateCalls.push(String(script))
      return undefined
    },
    locator: (selector: string) => ({
      count: async (): Promise<number> => counts.get(selector) ?? 1,
    }),
    on: (event: string, callback: () => void): void => {
      listeners.set(event, [...(listeners.get(event) ?? []), callback])
    },
  } as unknown as Page
  return {
    page,
    emit: (payload) => {
      if (binding === undefined) throw new Error('recorder binding 未注册')
      binding(undefined, payload)
    },
    filechooser: () => {
      for (const callback of listeners.get('filechooser') ?? []) callback()
    },
    counts,
    evaluateCalls,
  }
}

async function startRecorder(fake: FakePage): Promise<UiRecorder> {
  return UiRecorder.start(fake.page)
}

describe('页面脚本', () => {
  it('RECORDER_SOURCE 是合法 JS（能编译）', () => {
    expect(() => new Function(RECORDER_SOURCE)).not.toThrow()
  })
})

describe('UiRecorder', () => {
  it('点击/输入/选择 → 步骤；连续输入合并为最后一次值', async () => {
    const fake = fakePage()
    const recorder = await startRecorder(fake)
    fake.emit({ kind: 'fill', candidates: ['#kw'], value: '键', at: 'https://example.com/start' })
    fake.emit({ kind: 'fill', candidates: ['#kw'], value: '键盘精灵', at: 'https://example.com/start' })
    fake.emit({ kind: 'click', candidates: ['button:has-text("搜索")'], isSubmitter: true, at: 'https://example.com/start' })
    fake.emit({ kind: 'select', candidates: ['select[name="type"]'], value: 'b', at: 'https://example.com/start' })
    const result = await recorder.stop()
    expect(result.startUrl).toBe('https://example.com/start')
    expect(result.viewport).toEqual({ width: 1440, height: 900 })
    expect(result.steps.map((step) => step.kind)).toEqual(['fill', 'click', 'select'])
    expect(result.steps[0]?.value).toBe('键盘精灵')
    expect(result.steps[0]?.selector).toBe('#kw')
    expect(result.steps.map((step) => step.id)).toEqual(['s1', 's2', 's3'])
  })

  it('点提交按钮后的 submit 事件不再录成第二步', async () => {
    const fake = fakePage()
    const recorder = await startRecorder(fake)
    fake.emit({ kind: 'click', candidates: ['#go'], isSubmitter: true })
    fake.emit({ kind: 'submit', candidates: ['#form'], submitter: ['#go'] })
    const result = await recorder.stop()
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]?.kind).toBe('click')
  })

  it('Enter 触发（没有 click 前置）的 submit 保留为 submit 步骤', async () => {
    const fake = fakePage()
    const recorder = await startRecorder(fake)
    fake.emit({ kind: 'submit', candidates: ['#form'], submitter: [] })
    const result = await recorder.stop()
    expect(result.steps[0]?.kind).toBe('submit')
  })

  it('密码输入不落步骤，只计数（连打多个事件算一次）', async () => {
    const fake = fakePage()
    const recorder = await startRecorder(fake)
    fake.emit({ kind: 'skip-secret' })
    fake.emit({ kind: 'skip-secret' })
    fake.emit({ kind: 'skip-secret' })
    fake.emit({ kind: 'click', candidates: ['#login'] })
    const result = await recorder.stop()
    expect(result.skippedSecrets).toBe(1)
    expect(result.steps.map((step) => step.kind)).toEqual(['click'])
    expect(result.notice).toContain('密码')
  })

  it('候选唯一性校验：只留当前页面唯一命中的候选', async () => {
    const fake = fakePage({ counts: { '[data-testid="x"]': 2, '#x': 1 } })
    const recorder = await startRecorder(fake)
    fake.emit({ kind: 'click', candidates: ['[data-testid="x"]', '#x'] })
    const result = await recorder.stop()
    expect(result.steps[0]?.candidates).toEqual(['#x'])
    expect(result.steps[0]?.selector).toBe('#x')
  })

  it('全候选都失效时保留原样（回放阶段再失败并留证据，不静默丢步）', async () => {
    const fake = fakePage({ counts: { '[data-testid="x"]': 0 } })
    const recorder = await startRecorder(fake)
    fake.emit({ kind: 'click', candidates: ['[data-testid="x"]'] })
    const result = await recorder.stop()
    expect(result.steps[0]?.candidates).toEqual(['[data-testid="x"]'])
  })

  it('文件选择只计数不录路径', async () => {
    const fake = fakePage()
    const recorder = await startRecorder(fake)
    fake.filechooser()
    fake.emit({ kind: 'click', candidates: ['#upload'] })
    const result = await recorder.stop()
    expect(result.skippedUploads).toBe(1)
    expect(result.notice).toContain('upload')
    expect(result.steps).toHaveLength(1)
  })

  it('同一页面重复 start 返回同一实例；停止后可重新开始且仍能录到事件', async () => {
    const fake = fakePage()
    const first = await startRecorder(fake)
    const second = await startRecorder(fake)
    expect(second).toBe(first)
    fake.emit({ kind: 'click', candidates: ['#a'] })
    expect((await first.stop()).steps).toHaveLength(1)

    forgetRecorder(fake.page)
    const third = await startRecorder(fake)
    expect(third).not.toBe(first)
    // 页面里的监听器是复用的：重新 start 必须重新激活，否则换流程录不到事件。
    fake.emit({ kind: 'click', candidates: ['#b'] })
    const restarted = await third.stop()
    expect(restarted.steps).toHaveLength(1)
    expect(restarted.steps[0]?.selector).toBe('#b')
  })
})
