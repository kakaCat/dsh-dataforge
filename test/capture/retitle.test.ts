/**
 * TitleBackfillService：旧页面标题补抓的闸、身份校验、计数与单飞。
 *
 * 用假 openPage 注入（不真起 Chrome）：验证「身份不符绝不落标题」这条红线与状态计数。
 *
 * @module test/capture/retitle
 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { CaptureStore } from '../../src/capture/store.js'
import { TitleBackfillService } from '../../src/capture/retitle.js'
import type { CapturingPage } from '../../src/capture/browser.js'

const dirs: string[] = []
const stores: CaptureStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function newStore(): CaptureStore {
  const dir = mkdtempSync(join(tmpdir(), 'df-retitle-'))
  dirs.push(dir)
  const store = new CaptureStore(join(dir, 'capture.sqlite'), join(dir, 'samples'), join(dir, 'events.ndjson'))
  stores.push(store)
  return store
}

function seedRun(store: CaptureStore, id: string, entryUrl: string, status: 'done' | 'running' = 'done'): void {
  store.upsertRun({
    id, taskType: 'single_page', entryUrl, status, startedAt: Date.now(),
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
}

type FakePageBehavior = {
  /** goto 后 page.url() 返回的最终地址（默认就是目标地址；可模拟重定向到登录页）。 */
  finalUrl?: (target: string) => string
  /** 读取到的标题/站点名（默认两者都有）。 */
  meta?: { title?: string; siteName?: string }
}

/** 假浏览器工厂：记录 goto/addCookies，page.url() 与 evaluate 按行为返回。 */
function fakeOpenPage(behavior: FakePageBehavior = {}): {
  openPage: typeof import('../../src/capture/browser.js').openCapturingPage
  visited: string[]
  addedCookies: Array<Array<{ name: string }>>
  closed: number
} {
  const visited: string[] = []
  const addedCookies: Array<Array<{ name: string }>> = []
  const state = { closed: 0 }
  const openPage = async (): Promise<CapturingPage> => {
    let current = ''
    const page = {
      goto: async (url: string) => {
        visited.push(url)
        current = behavior.finalUrl === undefined ? url : behavior.finalUrl(url)
      },
      waitForLoadState: async () => undefined,
      url: () => current,
      evaluate: async () => ({
        title: behavior.meta?.title ?? '页面标题',
        siteTags: [behavior.meta?.siteName ?? '站点名'],
      }),
    } as unknown as Page
    return {
      browser: { close: async () => { state.closed += 1 } } as never,
      context: {
        clearCookies: async () => undefined,
        addCookies: async (cookies: Array<{ name: string }>) => { addedCookies.push(cookies) },
      } as never,
      page,
    }
  }
  return {
    openPage: openPage as unknown as typeof import('../../src/capture/browser.js').openCapturingPage,
    visited,
    addedCookies,
    get closed() { return state.closed },
  }
}

function serviceOf(store: CaptureStore, fake: ReturnType<typeof fakeOpenPage>): TitleBackfillService {
  return new TitleBackfillService({ store, openPage: fake.openPage, channel: 'chrome' })
}

it('无目标：accepted=false reason=no-targets，不启动浏览器', () => {
  const store = newStore()
  const fake = fakeOpenPage()
  const service = serviceOf(store, fake)
  expect(service.start()).toEqual({ accepted: false, targets: 0, hosts: 0, reason: 'no-targets' })
  expect(fake.visited).toEqual([])
  expect(service.status()).toMatchObject({ running: false, targets: 0, tried: 0 })
})

it('有 running 采集：accepted=false reason=capture-running（不与采集抢浏览器）', () => {
  const store = newStore()
  seedRun(store, 'cap_running', 'https://x.test/', 'running')
  const service = serviceOf(store, fakeOpenPage())
  expect(service.start()).toEqual({ accepted: false, targets: 0, hosts: 0, reason: 'capture-running' })
})

it('单飞：第一轮在跑时第二次 start → busy', async () => {
  const store = newStore()
  seedRun(store, 'cap_1', 'https://x.test/a')
  const fake = fakeOpenPage()
  const service = serviceOf(store, fake)
  const first = service.start()
  const second = service.start()
  expect(first.accepted).toBe(true)
  expect(second).toEqual({ accepted: false, targets: 0, hosts: 0, reason: 'busy' })
  await vi.waitFor(() => { expect(service.status().running).toBe(false) }, { timeout: 5_000 })
})

it('成功：身份一致 → applyPageMeta 回填标题/站点名；cookie 从采集库注入；计数与时间戳如实', async () => {
  const store = newStore()
  seedRun(store, 'cap_1', 'https://x.test/a')
  store.upsertPage('cap_1', 'https://x.test/a', 0, 'ok') // 旧页面：无标题
  store.upsertCredential('cap_1', 'cookie', '.x.test', 'SID', 1, { name: 'SID', value: 'v', domain: '.x.test', path: '/' })
  const fake = fakeOpenPage()
  const service = serviceOf(store, fake)

  const result = service.start()
  expect(result).toMatchObject({ accepted: true, targets: 1, hosts: 1 })
  await vi.waitFor(() => { expect(service.status().running).toBe(false) }, { timeout: 5_000 })

  expect(fake.visited).toEqual(['https://x.test/a'])
  expect(fake.addedCookies.flat().map((cookie) => cookie.name)).toContain('SID')
  expect(fake.closed).toBe(1)
  expect(store.listPages('cap_1')[0]).toMatchObject({ title: '页面标题', siteName: '站点名' })
  const status = service.status()
  expect(status).toMatchObject({ running: false, targets: 1, tried: 1, updated: 1, failed: 0, skipped: 0 })
  expect(status.startedAt).toBeGreaterThan(0)
  expect(status.finishedAt).toBeGreaterThanOrEqual(status.startedAt ?? 0)
  expect(status.error).toBeUndefined()
})

it('身份不符（被重定向到登录页）：记 failed，绝不把登录页标题写到目标页', async () => {
  const store = newStore()
  seedRun(store, 'cap_1', 'https://x.test/a')
  store.upsertPage('cap_1', 'https://x.test/a', 0, 'ok')
  const fake = fakeOpenPage({
    finalUrl: () => 'https://x.test/login',
    meta: { title: '请登录', siteName: '登录站点' },
  })
  const service = serviceOf(store, fake)
  expect(service.start().accepted).toBe(true)
  await vi.waitFor(() => { expect(service.status().running).toBe(false) }, { timeout: 5_000 })

  expect(service.status()).toMatchObject({ targets: 1, tried: 1, updated: 0, failed: 1, skipped: 0 })
  // 红线：目标页的标题仍为空 —— 登录页的标题没有串写到目标身份上
  expect(store.listPages('cap_1')[0]?.title).toBeUndefined()
  expect(store.listPageMeta().find((row) => row.url === 'https://x.test/a')?.title).toBeUndefined()
})

it('目标不在 pages 表（只在卡上被引用）：用该 host 最近 run 的 captureId 补行', async () => {
  const store = newStore()
  seedRun(store, 'cap_1', 'https://x.test/b')
  store.upsertCard('cap_1', {
    mergeKey: 'GET /b', method: 'GET', urlTemplate: '/b', relatedPageUrls: ['https://x.test/b'],
  })
  const fake = fakeOpenPage()
  const service = serviceOf(store, fake)
  expect(service.start()).toMatchObject({ accepted: true, targets: 1, hosts: 1 })
  await vi.waitFor(() => { expect(service.status().running).toBe(false) }, { timeout: 5_000 })

  expect(service.status()).toMatchObject({ tried: 1, updated: 1, failed: 0 })
  expect(store.listPageMeta()).toEqual([
    expect.objectContaining({ url: 'https://x.test/b', title: '页面标题', siteName: '站点名' }),
  ])
})

it('已有标题且站点名齐全的页面不再补抓；非 http(s) 目标跳过', () => {
  const store = newStore()
  seedRun(store, 'cap_1', 'ftp://x.test/file')
  store.upsertPage('cap_1', 'https://x.test/a', 0, 'ok', { title: '已有标题', siteName: '站点名' })
  // 再塞一条非 http 的页面行：不该成为目标
  store.upsertPage('cap_1', 'about:blank', 0, 'ok')
  const fake = fakeOpenPage()
  const service = serviceOf(store, fake)
  expect(service.start()).toEqual({ accepted: false, targets: 0, hosts: 0, reason: 'no-targets' })
  expect(fake.visited).toEqual([])
})

it('浏览器起不来：error 如实写、running 收口、未尝试目标记 skipped', async () => {
  const store = newStore()
  seedRun(store, 'cap_1', 'https://x.test/a')
  const service = new TitleBackfillService({
    store,
    openPage: (async () => { throw new Error('chrome 起不来') }) as never,
    channel: 'chrome',
  })
  expect(service.start()).toMatchObject({ accepted: true, targets: 1, hosts: 1 })
  await vi.waitFor(() => { expect(service.status().running).toBe(false) }, { timeout: 5_000 })
  const status = service.status()
  expect(status.error).toContain('chrome 起不来')
  expect(status).toMatchObject({ tried: 0, updated: 0, skipped: 1 })
})

it('running 采集只挡同 host：别的 host 的目标照常补抓（不全局拒绝）', async () => {
  const store = newStore()
  seedRun(store, 'cap_running', 'https://busy.test/', 'running')
  seedRun(store, 'cap_done', 'https://free.test/a')
  const fake = fakeOpenPage()
  const service = serviceOf(store, fake)

  const result = service.start()
  expect(result).toEqual({ accepted: true, targets: 1, hosts: 1 })
  await vi.waitFor(() => { expect(service.status().running).toBe(false) }, { timeout: 5_000 })
  // busy.test 的目标被 host 闸跳过；free.test/a 正常重访
  expect(fake.visited).toEqual(['https://free.test/a'])
  expect(store.listPageMeta().find((row) => row.url === 'https://free.test')?.title).toBeUndefined()
  expect(store.listPageMeta().find((row) => row.url === 'https://free.test/a')?.title).toBe('页面标题')
})
