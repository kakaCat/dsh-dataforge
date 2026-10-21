import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { startCapture, captureStatus, captureResult, captureCancel, cookiesFromCapture } from '../../src/capture/application.js'
import type { CaptureDeps } from '../../src/capture/application.js'
import type { PagePageMeta, WireSample } from '../../src/capture/browser.js'
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

type FakeSink = { onSample: (w: WireSample) => void; onPageMeta?: (meta: PagePageMeta) => void }

function fixture(): {
  deps: CaptureDeps
  jobs: { start: ReturnType<typeof vi.fn>; dones: Promise<unknown>[] }
  lastBoundSink(): FakeSink | undefined
  lastBrowserOptions(): Record<string, unknown> | undefined
} {
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
    chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true, uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright', uiAgentCredentials: {},
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
  let lastBoundSink: FakeSink | undefined
  let lastBrowserOptions: Record<string, unknown> | undefined
  const fakeRegistry = {
    open: vi.fn().mockResolvedValue({ sessionId: 'bs_x', pageUrl: 'https://x.test/' }),
    bindSink: vi.fn((_id: string, sink: FakeSink | ((w: WireSample) => void)) => {
      lastBoundSink = typeof sink === 'function' ? { onSample: sink } : sink
    }),
  }
  const maker = async (_channel: string, onWire: (w: WireSample) => void, options?: Record<string, unknown>) => {
    lastBrowserOptions = options
    return {
      page: {
        goto: async (target: string) => {
          onWire(WIRE)
          // 模拟真实 browser 层：导航后按页面标题上报（单页/爬取的 onPageMeta 通路）
          const onPageMeta = options?.['onPageMeta'] as ((meta: PagePageMeta) => void) | undefined
          onPageMeta?.({
            url: String(target),
            title: '示例站点 · 页面标题',
            siteName: '示例站点',
          })
        },
        waitForLoadState: async () => undefined,
        content: async () => '<a href="/next"></a>',
      } as never,
      browser: { close: async () => undefined } as never,
      context: { cookies: async () => [{ domain: 'x.test', name: 'UID', value: 'v' }] as never } as never,
    }
  }
  const deps: CaptureDeps = {
    config,
    resolveJobs: () => jobs,
    store,
    registry: fakeRegistry as never,
    openCapturingPage: maker as never,
  }
  return {
    deps,
    jobs,
    lastBoundSink: () => lastBoundSink,
    lastBrowserOptions: () => lastBrowserOptions,
  }
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
  expect(cards[0]?.urlTemplate).toBe('/api/list?page=1')
  expect(cards[0]?.responseTemplate?.codePath).toBe('err_no')
  expect(f.deps.store.listCredentials(a.captureId as string)).toHaveLength(1)
})

it('single_page：导航后 onPageMeta 落页面标题/站点名（名称数据面）', async () => {
  const f = fixture()
  const a = await startCapture(f.deps, { taskType: 'single_page', entryUrl: 'https://x.test/' })
  await Promise.all(f.jobs.dones)
  const entry = f.deps.store.listPages(a.captureId as string).find((p) => p.url === 'https://x.test/')
  expect(entry).toMatchObject({ title: '示例站点 · 页面标题', siteName: '示例站点' })
})

it('action：sink.onPageMeta 落页面标题（url 归一到 pageIdentityOf 后再写）', async () => {
  const f = fixture()
  const a = await startCapture(f.deps, { taskType: 'action', entryUrl: 'https://pan.baidu.com/disk/main', confirm: true })
  f.lastBoundSink()?.onPageMeta?.({
    url: 'https://pan.baidu.com/disk/main?_at_=1#/index?category=all',
    title: '百度网盘',
    siteName: '百度网盘',
  })
  const entry = f.deps.store.listPages(a.captureId as string)[0]
  expect(entry).toMatchObject({ url: 'https://pan.baidu.com/disk/main#/index', title: '百度网盘', siteName: '百度网盘' })
})

it('site_crawl：BFS 发现页入 pages，run=done', async () => {
  const f = fixture()
  const a = await startCapture(f.deps, { taskType: 'site_crawl', entryUrl: 'https://x.test/' })
  await Promise.all(f.jobs.dones)
  const id = a.captureId as string
  expect(f.deps.store.getRun(id)?.status).toBe('done')
  expect(f.deps.store.listPages(id).map((p) => p.url)).toContain('https://x.test/next')
  // 入口页：请求先到 + 爬行 page 事件后到，同一页面身份只计一页（stats.pages 不虚高）
  expect(f.deps.store.getRun(id)?.stats.pages).toBe(2)
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

it('action：reuseCookiesFrom 把旧 capture 的 cookie 注入新会话', async () => {
  const f = fixture()
  f.deps.store.upsertRun({
    id: 'cap_old', taskType: 'action', entryUrl: 'https://x.test/', status: 'done', startedAt: 1,
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  f.deps.store.upsertCredential('cap_old', 'cookie', '.x.test', 'BDUSS', 1, {
    name: 'BDUSS', value: 'v', domain: '.x.test', path: '/',
    expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: true, secure: true, sameSite: 'Lax',
  })
  expect(cookiesFromCapture(f.deps.store, 'cap_old')).toEqual([
    expect.objectContaining({ name: 'BDUSS', value: 'v', domain: '.x.test', path: '/', httpOnly: true, secure: true }),
  ])

  const c = await startCapture(f.deps, {
    taskType: 'action', entryUrl: 'https://x.test/', confirm: true, reuseCookiesFrom: 'cap_old',
  })
  expect(c.cookiesReused).toBe(1)
  const open = (f.deps.registry as unknown as { open: ReturnType<typeof vi.fn> }).open
  expect(open).toHaveBeenCalledWith(expect.objectContaining({
    cookies: expect.arrayContaining([expect.objectContaining({ name: 'BDUSS', value: 'v' })]),
  }))
})

it('action：headless=false 透传到 registry.open（可见 Chrome，用户手动登录）', async () => {
  const f = fixture()
  await startCapture(f.deps, { taskType: 'action', entryUrl: 'https://x.test/', confirm: true, headless: false })
  const open = (f.deps.registry as unknown as { open: ReturnType<typeof vi.fn> }).open
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ headless: false }))
})

it('action：open 后绑 sink，wire 样本经桥落库成卡（回归：会话样本曾静默丢弃）', async () => {
  const f = fixture()
  const c = await startCapture(f.deps, { taskType: 'action', entryUrl: 'https://x.test/', confirm: true })
  expect(f.deps.registry.bindSink).toHaveBeenCalledWith('bs_x', expect.objectContaining({
    onSample: expect.any(Function), onPageMeta: expect.any(Function),
  }))
  expect((c.captureId as string | undefined) !== undefined).toBe(true)
  f.lastBoundSink()?.onSample(WIRE)
  const cards = f.deps.store.listCards(c.captureId as string)
  expect(cards).toHaveLength(1)
  expect(cards[0]?.method).toBe('GET')
  expect(f.deps.store.countSamples(c.captureId as string)).toBe(1)
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

it('A7：wire 样本落关系行（page×card×入参指纹），pageId 关联采集页', async () => {
  const f = fixture()
  const a = await startCapture(f.deps, { taskType: 'single_page', entryUrl: 'https://x.test/' })
  await Promise.all(f.jobs.dones)
  const rels = f.deps.store.listRelations(a.captureId as string)
  expect(rels).toHaveLength(1)
  expect(rels[0]?.pageUrl).toBe('https://x.test/')
  expect(rels[0]?.pageId).toBeDefined()
  expect(rels[0]?.paramsFingerprint).toMatch(/^[0-9a-f]{16}$/)
  const page = f.deps.store.listPages(a.captureId as string)
  expect(page.map((p) => p.url)).toContain('https://x.test/')
  // 样本回指关系行：一条请求能回答「哪个页面 × 哪个接口 × 哪种形态」
  const samples = f.deps.store.listSamples(a.captureId as string)
  expect(samples[0]?.relationId).toBe(rels[0]?.id)
  expect(f.deps.store.listRelationsByCard(rels[0]?.cardId ?? 'x').map((r) => r.id)).toContain(rels[0]?.id)
})

it('A7+：同一 SPA 页面的 hash/反缓存戳变体落成一页（页面/关系归一到身份；卡引用与样本留原始 URL）', async () => {
  const f = fixture()
  const bound = startCapture(f.deps, {
    taskType: 'action', entryUrl: 'https://pan.baidu.com/disk/main', confirm: true,
  })
  const a: Awaited<typeof bound> = await bound
  const id = a.captureId as string
  const sink = f.lastBoundSink()?.onSample
  expect(sink).toBeDefined()
  const pageVariants = [
    'https://pan.baidu.com/disk/main#/index?category=all',
    'https://pan.baidu.com/disk/main#/index',
    'https://pan.baidu.com/disk/main?_at_=1792240465584#/index?category=all',
  ]
  for (const pageUrl of pageVariants) sink?.({ ...WIRE, pageUrl })

  // 页面表：三变体 = 一页（page.url 就是页面身份）
  expect(f.deps.store.listPages(id).map((p) => p.url)).toEqual(['https://pan.baidu.com/disk/main#/index'])
  // 关系表：同卡同页同指纹 → 幂等聚一行，样本计数累加
  const rels = f.deps.store.listRelations(id)
  expect(rels).toHaveLength(1)
  expect(rels[0]?.pageUrl).toBe('https://pan.baidu.com/disk/main#/index')
  expect(rels[0]?.sampleCount).toBe(3)
  // 卡上的页面引用保留首次观测到的原始 URL（展示/打开/重采要真实可打开的地址）
  const cards = f.deps.store.listCards(id)
  expect(cards).toHaveLength(1)
  expect(cards[0]?.relatedPageUrls).toEqual([pageVariants[0]])
  // 原始 pageUrl 仍是逐请求证据，保留在样本行
  expect(f.deps.store.listSamples(id).map((s) => s.pageUrl)).toEqual(pageVariants)
})

it('A8：卡带语义名 + 位置标注模板 + 鉴权标志（token 头探测到，值不入卡）', async () => {
  const f = fixture()
  const bound = startCapture(f.deps, { taskType: 'action', entryUrl: 'https://x.test/', confirm: true })
  const a: Awaited<typeof bound> = await bound
  f.lastBoundSink()?.onSample({
    ...WIRE,
    requestHeaders: { authorization: 'Bearer sk-secret', 'content-type': 'application/json' },
    requestPostData: '{"sku":"A1","ts":9}',
    responseText: '{"err_no":0}',
  })
  f.lastBoundSink()?.onSample({
    ...WIRE,
    url: 'https://x.test/api/list?page=2',
    requestHeaders: { authorization: 'Bearer sk-secret', 'content-type': 'application/json' },
    requestPostData: '{"sku":"A2","ts":9}',
  })
  const cards = f.deps.store.listCards(a.captureId as string)
  expect(cards).toHaveLength(1)
  const card = cards[0]
  expect(card?.name).toBe('list')
  expect(card?.authType).toBe('token-header')
  expect(card?.authEvidence).toBe('header:authorization')
  expect(JSON.stringify(card)).not.toContain('sk-secret')
  const reqFields = card?.requestTemplate?.fields ?? []
  const byField = new Map(reqFields.map((x) => [x.field, x]))
  expect(byField.get('page')?.location).toBe('query')
  expect(byField.get('sku')?.location).toBe('body')
  expect(byField.get('sku')?.role).toBe('input')
  expect(byField.get('content-type')?.location).toBe('header')
  expect(byField.get('ts')).toBeUndefined()
  const rels = f.deps.store.listRelations(a.captureId as string)
  expect(rels).toHaveLength(2)
  expect(rels[0]?.paramsFingerprint).not.toBe(rels[1]?.paramsFingerprint)
})

it('A9：样本超上限如实弃采并在 run 上附 notice', async () => {
  const f = fixture()
  const { SAMPLE_LIMIT_PER_RUN } = await import('../../src/capture/application.js')
  const bound = startCapture(f.deps, { taskType: 'action', entryUrl: 'https://x.test/', confirm: true })
  const a: Awaited<typeof bound> = await bound
  const sink = f.lastBoundSink()?.onSample
  expect(sink).toBeDefined()
  for (let i = 0; i < SAMPLE_LIMIT_PER_RUN + 5; i += 1) sink?.({ ...WIRE, url: `https://x.test/api/list?page=${i}` })
  expect(f.deps.store.countSamples(a.captureId as string)).toBe(SAMPLE_LIMIT_PER_RUN)
  const run = f.deps.store.getRun(a.captureId as string)
  expect(run?.notice).toContain(`${SAMPLE_LIMIT_PER_RUN}`)
  expect(run?.status).toBe('running')
})

it('FR-1.5：jobs 服务缺席 → 前台降级执行，回执附 degradedNotice，run 照常 done', async () => {
  const f = fixture()
  const deps: CaptureDeps = { ...f.deps, resolveJobs: () => undefined }
  const a = await startCapture(deps, { taskType: 'single_page', entryUrl: 'https://x.test/' })
  expect(a.accepted).toBe(true)
  expect(a.degradedNotice).toContain('前台降级')
  await vi.waitFor(() => {
    expect(deps.store.getRun(a.captureId as string)?.status).toBe('done')
  }, { timeout: 5_000 })
  expect(deps.store.countSamples(a.captureId as string)).toBe(1)
})

it('回归：jobs 服务在但 start 抛错（无 agent 归属）→ 同样前台降级，绝不留僵尸 running 行', async () => {
  const f = fixture()
  const deps: CaptureDeps = {
    ...f.deps,
    resolveJobs: () => ({
      start: () => { throw new Error('background jobs unavailable: no job controller serves this agent') },
    }),
  }
  const a = await startCapture(deps, { taskType: 'single_page', entryUrl: 'https://x.test/' })
  // 关键：面板路由没有 agent，这种「服务在但拒绝」正是线上形态；不能把异常冒给调用方
  expect(a.accepted).toBe(true)
  expect(a.degradedNotice).toContain('前台降级')
  expect(a.degradedNotice).toContain('no job controller')
  await vi.waitFor(() => {
    expect(deps.store.getRun(a.captureId as string)?.status).toBe('done')
  }, { timeout: 5_000 })
  expect(deps.store.countSamples(a.captureId as string)).toBe(1)
  expect(deps.store.getRun(a.captureId as string)?.notice).toContain('前台降级')
})

it('回归：前台执行本身失败 → run 收口为 failed（不留 running）', async () => {
  const f = fixture()
  const deps: CaptureDeps = {
    ...f.deps,
    resolveJobs: () => ({ start: () => { throw new Error('rejected') } }),
    openCapturingPage: (async () => { throw new Error('chrome 起不来') }) as never,
  }
  const a = await startCapture(deps, { taskType: 'single_page', entryUrl: 'https://x.test/' })
  await vi.waitFor(() => {
    expect(deps.store.getRun(a.captureId as string)?.status).toBe('failed')
  }, { timeout: 5_000 })
  expect(deps.store.getRun(a.captureId as string)?.error).toContain('chrome 起不来')
})
