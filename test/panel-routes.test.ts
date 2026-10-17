import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CaptureStore } from '../src/capture/store.js'
import { createCapturePanelHandler, registerCapturePanelRoutes, type CapturePanelDeps } from '../src/capture/panel-routes.js'

let dir: string | undefined
let store: CaptureStore | undefined

afterEach(() => {
  store?.close()
  store = undefined
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true })
    dir = undefined
  }
})

function seededStore(): CaptureStore {
  dir = mkdtempSync(join(tmpdir(), 'df-panel-'))
  store = new CaptureStore(
    join(dir, 'capture.sqlite'),
    join(dir, 'samples'),
    join(dir, 'events.ndjson'),
  )
  store.upsertRun({
    id: 'cap_t1', taskType: 'single_page', entryUrl: 'https://example.com/',
    status: 'running', startedAt: 1700000000000, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  store.upsertPage('cap_t1', 'https://example.com/', 0, 'ok')
  store.upsertSample('cap_t1', undefined, {
    url: 'https://example.com/api/list', method: 'GET', status: 200,
    requestHeaders: { cookie: 'session_id=SECRET_VALUE' }, responseHeaders: {},
    responseBody: '{"rows":"ok"}', bodyLimit: 1_000_000,
  })
  store.upsertCredential('cap_t1', 'cookie', 'https://example.com/', 'session_id', 1700000000001, { value: 'SECRET_VALUE' })
  store.upsertCard('cap_t1', {
    mergeKey: 'GET example.com/api/list', method: 'GET', urlTemplate: 'https://example.com/api/list',
    relatedPageUrls: ['https://example.com/'],
  })
  store.finishRun('cap_t1', 'done')
  return store
}

interface FakeResponse {
  status: number
  headers: Record<string, string>
  body: string
}

function serve(current: CaptureStore, method: string, url: string): FakeResponse {
  const captured: FakeResponse = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead: (status: number, headers: Record<string, string>) => {
      captured.status = status
      captured.headers = headers
    },
    end: (body: string) => { captured.body = body },
  }
  createCapturePanelHandler({ store: current })(
    { method, url } as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  )
  return captured
}

function servePost(
  current: CaptureStore,
  url: string,
  body: unknown,
  startCapture?: CapturePanelDeps['startCapture'],
): FakeResponse {
  const captured: FakeResponse = { status: 0, headers: {}, body: '' }
  const chunks = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  const res = {
    writeHead: (status: number, headers: Record<string, string>) => {
      captured.status = status
      captured.headers = headers
    },
    end: (body: string) => { captured.body = body },
  }
  const req = {
    method: 'POST',
    url,
    on: (event: string, cb: (arg?: Buffer) => void) => {
      if (event === 'data') setTimeout(() => cb(chunks), 0)
      if (event === 'end') setTimeout(cb, 0)
    },
  }
  createCapturePanelHandler({ store: current, ...(startCapture === undefined ? {} : { startCapture }) })(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  )
  return captured
}

describe('createCapturePanelHandler（/dashboard/api/dataforge）', () => {
  it('GET /runs：稳定信封 + 运行行投影', () => {
    const res = serve(seededStore(), 'GET', '/dashboard/api/dataforge/runs')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    const parsed = JSON.parse(res.body) as { success: true; data: { runs: Array<{ id: string; status: string }> } }
    expect(parsed.success).toBe(true)
    expect(parsed.data.runs).toHaveLength(1)
    expect(parsed.data.runs[0]).toMatchObject({ id: 'cap_t1', status: 'done', entryUrl: 'https://example.com/' })
  })

  it('GET /runs/<id> 详情：pages/samples 在场，凭据原文永不离开服务端', () => {
    const res = serve(seededStore(), 'GET', '/runs/cap_t1')
    expect(res.status).toBe(200)
    expect(res.body).not.toContain('SECRET_VALUE')
    expect(res.body).not.toContain('requestHeaders')
    expect(res.body).not.toContain('requestBodyPath')
    expect(res.body).not.toContain('valueJson')
    const parsed = JSON.parse(res.body) as {
      success: true
      data: {
        run: { id: string; status: string }
        pages: Array<{ url: string }>
        samples: Array<{ method: string; status: number; responsePreview?: string }>
        credentials: Array<{ kind: string; name: string }>
        cards: Array<{ urlTemplate: string }>
        relations: Array<{ cardId: string; pageUrl: string }>
      }
    }
    expect(parsed.data.run.status).toBe('done')
    expect(parsed.data.pages[0]?.url).toBe('https://example.com/')
    expect(parsed.data.samples[0]).toMatchObject({ method: 'GET', status: 200 })
    expect(parsed.data.credentials[0]).toMatchObject({ kind: 'cookie', name: 'session_id' })
    expect(parsed.data.cards).toHaveLength(1)
    expect(parsed.data.cards[0]).toMatchObject({ urlTemplate: 'https://example.com/api/list' })
    expect(parsed.data.relations).toEqual([])
  })

  it('GET /runs/<id> 详情：关系行投影（A7）', () => {
    const current = seededStore()
    const cardId = current.upsertCard('cap_t1', {
      mergeKey: 'GET example.com/api/list', method: 'GET', urlTemplate: 'https://example.com/api/list',
      relatedPageUrls: ['https://example.com/'],
    })
    current.upsertRelation('cap_t1', cardId, 'https://example.com/', 'fp_abc', undefined)
    const parsed = JSON.parse(serve(current, 'GET', '/runs/cap_t1').body) as {
      data: { relations: Array<{ cardId: string; pageUrl: string; paramsFingerprint: string; sampleCount: number }> }
    }
    expect(parsed.data.relations).toHaveLength(1)
    expect(parsed.data.relations[0]).toMatchObject({
      cardId, pageUrl: 'https://example.com/', paramsFingerprint: 'fp_abc', sampleCount: 1,
    })
  })

  it('GET /cards：跨 run 列卡（接口库视角）+ total 总数', () => {
    const res = serve(seededStore(), 'GET', '/dashboard/api/dataforge/cards')
    const parsed = JSON.parse(res.body) as {
      success: true
      data: { cards: Array<{ urlTemplate: string; sampleCount: number }>; total: number }
    }
    expect(parsed.success).toBe(true)
    expect(parsed.data.cards).toHaveLength(1)
    expect(parsed.data.cards[0]).toMatchObject({ urlTemplate: 'https://example.com/api/list', sampleCount: 1 })
    expect(parsed.data.total).toBe(1)
  })

  it('GET /cards 分页：limit/offset 切页 + offset 负数/非法回落 0', () => {
    const current = seededStore()
    store?.upsertCard('cap_t1', {
      mergeKey: 'POST /api/alpha', method: 'POST', urlTemplate: '/api/alpha', relatedPageUrls: [],
    })
    store?.upsertCard('cap_t1', {
      mergeKey: 'POST /api/beta', method: 'POST', urlTemplate: '/api/beta', relatedPageUrls: [],
    })
    const page1 = JSON.parse(serve(current, 'GET', '/dashboard/api/dataforge/cards?limit=2&offset=0').body) as {
      data: { cards: Array<{ urlTemplate: string }>; total: number }
    }
    expect(page1.data.total).toBe(3)
    expect(page1.data.cards).toHaveLength(2)
    const page2 = JSON.parse(serve(current, 'GET', '/dashboard/api/dataforge/cards?limit=2&offset=2').body) as {
      data: { cards: Array<{ urlTemplate: string }>; total: number }
    }
    expect(page2.data.total).toBe(3)
    expect(page2.data.cards).toHaveLength(1)
    expect(new Set([...page1.data.cards, ...page2.data.cards].map((c) => c.urlTemplate))).toEqual(
      new Set(['https://example.com/api/list', '/api/alpha', '/api/beta']),
    )
    for (const offset of ['-1', 'abc', '']) {
      expect((JSON.parse(serve(current, 'GET', `/dashboard/api/dataforge/cards?limit=999&offset=${offset}`).body) as { data: { cards: unknown[] } }).data.cards).toHaveLength(3)
    }
  })

  it('limit 越界/非法回落缺省，不炸', () => {
    const current = seededStore()
    for (const limit of ['0', '-5', '99999999', 'abc', '']) {
      const res = serve(current, 'GET', `/dashboard/api/dataforge/runs?limit=${limit}`)
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toHaveProperty('data.runs')
    }
  })

  it('非 GET（除 POST /captures）一律 405 + code', () => {
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      const res = serve(seededStore(), method, '/dashboard/api/dataforge/runs')
      expect(res.status).toBe(405)
      const parsed = JSON.parse(res.body) as { success: false; code: string }
      expect(parsed.success).toBe(false)
      expect(parsed.code).toBe('method-not-allowed')
    }
    expect(serve(seededStore(), 'POST', '/dashboard/api/dataforge/runs').status).toBe(405)
  })

  it('未知路径 404；不存在的 run 404 not-found', () => {
    const current = seededStore()
    expect(serve(current, 'GET', '/dashboard/api/dataforge/other').status).toBe(404)
    expect(serve(current, 'GET', '/runs/cap_missing').status).toBe(404)
    expect(JSON.parse(serve(current, 'GET', '/runs/cap_missing').body)).toMatchObject({ code: 'not-found' })
  })

  it('runId 解码后含内嵌斜杠 → 404，不透传 store 查询', () => {
    const res = serve(seededStore(), 'GET', '/runs/cap_t1%2F..%2Fcards')
    expect(res.status).toBe(404)
  })

  it('空库：/runs 与 /cards 返回空数组（不 500）', () => {
    dir = mkdtempSync(join(tmpdir(), 'df-panel-empty-'))
    store = new CaptureStore(join(dir, 'capture.sqlite'), join(dir, 'samples'))
    const runs = serve(store, 'GET', '/runs')
    const cards = serve(store, 'GET', '/cards')
    expect(runs.status).toBe(200)
    expect(cards.status).toBe(200)
    expect(JSON.parse(runs.body).data.runs).toEqual([])
    expect(JSON.parse(cards.body).data.cards).toEqual([])
  })

  describe('POST /captures（A6：面板发起单页采集）', () => {
    it('startCapture 未注入 → 503 capture-not-wired', async () => {
      const res = servePost(seededStore(), '/captures', { entryUrl: 'https://x.test/' })
      await waitForPromise()
      expect(res.status).toBe(503)
      expect(JSON.parse(res.body)).toMatchObject({ success: false, code: 'capture-not-wired' })
    })

    it('taskType 非 single_page → 400（FR-7.6：写操作不进面板）', async () => {
      const store = seededStore()
      const res = servePost(store, '/captures', { entryUrl: 'https://x.test/', taskType: 'action' })
      await waitForPromise()
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body)).toMatchObject({ success: false, code: 'bad-task-type' })
      expect(JSON.parse(res.body).error).toContain('single_page')
    })

    it('缺 entryUrl / 坏 JSON → 400', async () => {
      const store = seededStore()
      const noEntry = servePost(store, '/captures', {})
      await waitForPromise()
      expect(noEntry.status).toBe(400)
      expect(JSON.parse(noEntry.body)).toMatchObject({ code: 'bad-entry-url' })
      const bad = servePost(store, '/captures', '{oops')
      await waitForPromise()
      expect(bad.status).toBe(400)
      expect(JSON.parse(bad.body)).toMatchObject({ code: 'bad-json' })
    })

    it('合法请求 → 200 信封：accepted/gate/captureId/degradedNotice 透传，sessionId 剥除', async () => {
      const store = seededStore()
      const calls: unknown[] = []
      const start = async (args: unknown): Promise<never> => {
        calls.push(args)
        return {
          accepted: true,
          gate: 'started',
          captureId: 'cap_new',
          sessionId: 'bs_secret',
          degradedNotice: 'jobs 服务缺席，本次采集已前台降级执行',
        } as never
      }
      const res = servePost(store, '/captures', { entryUrl: 'https://x.test/' }, start as CapturePanelDeps['startCapture'])
      await waitForPromise()
      expect(calls).toEqual([{ taskType: 'single_page', entryUrl: 'https://x.test/' }])
      expect(res.status).toBe(200)
      const parsed = JSON.parse(res.body) as Record<string, unknown> & { data: Record<string, unknown> }
      expect(parsed.success).toBe(true)
      expect(parsed.data).toMatchObject({ accepted: true, gate: 'started', captureId: 'cap_new', degradedNotice: 'jobs 服务缺席，本次采集已前台降级执行' })
      expect(res.body).not.toContain('bs_secret')
      expect(res.body).not.toContain('sessionId')
    })

    it('startCapture 内部异常 → 500', async () => {
      const store = seededStore()
      const res = servePost(
        store,
        '/captures',
        { entryUrl: 'https://x.test/' },
        async () => { throw new Error('boom') },
      )
      await waitForPromise()
      expect(res.status).toBe(500)
    })

    it('同 host 已有 running 采集 → 409 host-busy；不同 host 放行', async () => {
      const store = seededStore() // seeded 的 cap_t1 已 done
      store.upsertRun({
        id: 'cap_running', taskType: 'single_page', entryUrl: 'https://example.com/running',
        status: 'running', startedAt: Date.now(), stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
      })
      const busy = servePost(store, '/captures', { entryUrl: 'https://example.com/other' },
        async () => ({ accepted: true, gate: 'started', captureId: 'cap_x' }) as never)
      await waitForPromise()
      expect(busy.status).toBe(409)
      expect(JSON.parse(busy.body)).toMatchObject({ success: false, code: 'host-busy' })
      expect(JSON.parse(busy.body).error).toContain('cap_running')

      const other = servePost(store, '/captures', { entryUrl: 'https://other.test/' },
        async () => ({ accepted: true, gate: 'started', captureId: 'cap_y' }) as never)
      await waitForPromise()
      expect(other.status).toBe(200)
    })

    it('请求体超过 8KB → 413 body-too-large（不再笼统 400）', async () => {
      const store = seededStore()
      const res = servePost(store, '/captures', { entryUrl: 'https://x.test/', pad: 'x'.repeat(9_000) })
      await waitForPromise()
      expect(res.status).toBe(413)
      expect(JSON.parse(res.body)).toMatchObject({ success: false, code: 'body-too-large' })
    })

    it('SSRF 收敛：只收 http/https，本机回环与链路本地一律 400', async () => {
      const store = seededStore()
      const cases: Array<[string, string]> = [
        ['ftp://example.com/file', 'bad-entry-url'],
        ['file:///etc/passwd', 'bad-entry-url'],
        ['http://127.0.0.1:8080/admin', 'blocked-target'],
        ['http://localhost/admin', 'blocked-target'],
        ['http://169.254.169.254/latest/meta-data', 'blocked-target'],
        ['http://[::1]/admin', 'blocked-target'],
      ]
      for (const [entryUrl, code] of cases) {
        const res = servePost(store, '/captures', { entryUrl },
          async () => ({ accepted: true, gate: 'started', captureId: 'should_not_happen' }) as never)
        await waitForPromise()
        expect([entryUrl, res.status, JSON.parse(res.body).code]).toEqual([entryUrl, 400, code])
      }
    })
  })
})

async function waitForPromise(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('registerCapturePanelRoutes', () => {
  it('注册返回幂等 disposer；重复调用无副作用', () => {
    const registered: Array<{ kind: string; path: string; handler: unknown }> = []
    const disposers: Array<() => void> = []
    const registrar = {
      register: (route: { kind: string; path: string; handler: unknown }) => {
        registered.push(route)
        return (): void => { disposers.pop() }
      },
    }
    const dispose = registerCapturePanelRoutes(registrar, { store: seededStore() })
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ kind: 'prefix', path: '/dashboard/api/dataforge' })
    expect(typeof registered[0]?.handler).toBe('function')
    expect(typeof dispose).toBe('function')
    dispose()
    dispose()
    expect(disposers).toHaveLength(0)
  })
})
