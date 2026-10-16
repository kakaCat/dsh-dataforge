import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { startCapture, captureStatus, captureResult, captureCancel } from '../../src/capture/application.js'
import type { CaptureDeps } from '../../src/capture/application.js'
import type { WireSample } from '../../src/capture/browser.js'
import type { Config } from '../../src/config.js'

const WIRE: WireSample = {
  url: 'https://x.test/api/list?page=1',
  method: 'GET',
  status: 200,
  resourceType: 'xhr',
  contentType: 'application/json',
  requestHeaders: { accept: 'application/json' },
  requestPostData: undefined,
  responseText: '{"err_no":0,"items":[1,2]}',
  pageUrl: 'https://x.test/',
  ts: 42,
}

function fixture(): { deps: CaptureDeps; jobs: { start: ReturnType<typeof vi.fn>; dones: Promise<unknown>[] } } {
  const dir = mkdtempSync(join(tmpdir(), 'cap-app-'))
  const store = new CaptureStore(join(dir, 'c.sqlite'), join(dir, 'samples'), join(dir, 'events.ndjson'))
  const config: Required<Config> = {
    engineRoot: dir,
    pythonBin: 'python3',
    dataRoot: join(dir, 'data'),
    timeoutSeconds: 600,
    injectPolicy: false,
    captureMaxDepth: 3,
    captureMaxPages: 50,
    captureStabilityWindowMs: 1500,
    captureBodyLimitBytes: 262_144,
    captureChromeChannel: 'chrome',
  }
  const dones: Promise<unknown>[] = []
  const jobs = {
    start: vi.fn((spec: { run: (h: { id: string; append: (t: string) => void; updateProgress: (t: string) => void }) => { done: Promise<unknown> } }) => {
      const hooks = spec.run({ id: 'jobX', append: vi.fn(), updateProgress: vi.fn() })
      dones.push(hooks.done)
      return { id: 'jobX' }
    }),
    dones,
  }
  const fakeRegistry = { open: vi.fn().mockResolvedValue({ sessionId: 'bs_x', pageUrl: 'https://x.test/' }) }
  const maker = async (_channel: string, onWire: (w: WireSample) => void) => ({
    page: {
      goto: async () => { onWire(WIRE) },
      waitForLoadState: async () => undefined,
      content: async () => '<a href="/next"></a>',
    } as never,
    browser: { close: async () => undefined } as never,
    context: { cookies: async () => [{ domain: 'x.test', name: 'UID', value: 'v' }] as never } as never,
  })
  const deps: CaptureDeps = {
    config,
    resolveJobs: () => jobs,
    store,
    registry: fakeRegistry as never,
    openCapturingPage: maker as never,
  }
  return { deps, jobs }
}

it('single_page：闸放行 → job 跑完 → 样本/卡/cookie 落库，run=done', async () => {
  const f = fixture()
  const a = await startCapture(f.deps, { taskType: 'single_page', entryUrl: 'https://x.test/' })
  expect(a.accepted).toBe(true)
  expect(a.gate).toBe('started')
  expect(a.captureId).toBeDefined()
  await Promise.all(f.jobs.dones)
  const run = f.deps.store.getRun(a.captureId as string)
  expect(run?.status).toBe('done')
  expect(f.deps.store.countSamples(a.captureId as string)).toBe(1)
  const cards = f.deps.store.listCards(a.captureId as string)
  expect(cards).toHaveLength(1)
  expect(cards[0]?.urlTemplate).toBe('/api/list:page=1')
  expect(cards[0]?.responseTemplate?.codePath).toBe('err_no')
  expect(f.deps.store.listCredentials(a.captureId as string)).toHaveLength(1)
})

it('site_crawl：BFS 发现页入 pages，run=done', async () => {
  const f = fixture()
  const a = await startCapture(f.deps, { taskType: 'site_crawl', entryUrl: 'https://x.test/' })
  await Promise.all(f.jobs.dones)
  expect(f.deps.store.getRun(a.captureId as string)?.status).toBe('done')
  expect(f.deps.store.listPages(a.captureId as string).map((p) => p.url)).toContain('https://x.test/next')
})

it('action：未 confirm → gate=action-confirm-required 不启动；confirm=true → 会话化', async () => {
  const f = fixture()
  const b = await startCapture(f.deps, { taskType: 'action', entryUrl: 'https://x.test/' })
  expect(b.accepted).toBe(false)
  expect(b.gate).toBe('action-confirm-required')
  expect(f.jobs.start).not.toHaveBeenCalled()
  const c = await startCapture(f.deps, { taskType: 'action', entryUrl: 'https://x.test/', confirm: true })
  expect(c.accepted).toBe(true)
  expect(c.sessionId).toBe('bs_x')
})

it('闸：bad-url / bad-task 如实拒绝', async () => {
  const f = fixture()
  expect((await startCapture(f.deps, { taskType: 'single_page', entryUrl: 'not-a-url' })).gate).toBe('bad-url')
  expect((await startCapture(f.deps, { taskType: 'cron' as never, entryUrl: 'https://x.test/' })).gate).toBe('bad-task')
})

it('status/result/cancel 投影', async () => {
  const f = fixture()
  const a = await startCapture(f.deps, { taskType: 'single_page', entryUrl: 'https://x.test/' })
  const id = a.captureId as string
  await Promise.all(f.jobs.dones)
  expect(captureStatus(f.deps, id).ok).toBe(true)
  expect(captureStatus(f.deps, undefined).runs).toHaveLength(1)
  expect((captureStatus(f.deps, 'cap_none').ok)).toBe(false)
  expect((captureResult(f.deps, id, 'cards') as { items: unknown[] }).items).toHaveLength(1)
  expect((captureResult(f.deps, id, 'credentials') as { items: unknown[] }).items).toHaveLength(1)
  expect(captureResult(f.deps, 'cap_none', 'cards').notice).toContain('无记录')
  expect(captureCancel(f.deps, id).ok).toBe(true)
  expect(f.deps.store.getRun(id)?.status).toBe('cancelled')
})
