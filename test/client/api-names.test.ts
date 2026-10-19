/**
 * 面板名称接口的 URL/信封契约（与并行实现的服务端对齐，冻结契约见任务）：
 *
 *   GET  /page-meta?limit=N  → { pages: PageMetaRow[] }
 *   GET  /names              → NameMaps
 *   POST /names              → { kind, key, name? }
 *   POST /retitle            → { accepted, targets, hosts, reason? }
 *   GET  /retitle/status     → RetitleStatus
 *
 * 这里用假 fetch 只验「客户端发出的请求长什么样」与「错误信封是否抛出」——
 * 服务端语义在服务端测试里覆盖，客户端只对契约负责。
 *
 * @module test/client/api-names
 */
import { afterEach, expect, it, vi } from 'vitest'
import {
  PanelApiError, fetchNames, fetchPageMeta, fetchRetitleStatus, postName, setPanelWorkspace, startRetitle,
} from '../../src/client/api.js'

type Call = { url: string; init?: RequestInit }

function stubFetch(data: unknown, status = 200): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ success: true, data }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  setPanelWorkspace(undefined)
})

it('fetchPageMeta: GET /page-meta?limit=...（缺省 500）', async () => {
  const calls = stubFetch({ pages: [] })
  await fetchPageMeta()
  expect(calls[0]?.url).toBe('/dashboard/api/dataforge/page-meta?limit=500')
  await fetchPageMeta(10)
  expect(calls[1]?.url).toBe('/dashboard/api/dataforge/page-meta?limit=10')
})

it('fetchNames: GET /names', async () => {
  const calls = stubFetch({ sites: {}, pages: {}, interfaces: {} })
  const names = await fetchNames()
  expect(calls[0]?.url).toBe('/dashboard/api/dataforge/names')
  expect(names).toEqual({ sites: {}, pages: {}, interfaces: {} })
})

it('postName: POST /names，body 为 {kind,key,name}（空 name = 删除覆盖）', async () => {
  const calls = stubFetch({ kind: 'interface', key: 'GET /a', name: '订单列表' })
  await postName('interface', 'GET /a', '订单列表')
  expect(calls[0]?.url).toBe('/dashboard/api/dataforge/names')
  expect(calls[0]?.init?.method).toBe('POST')
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ kind: 'interface', key: 'GET /a', name: '订单列表' })

  await postName('site', 'x.test', '')
  expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ kind: 'site', key: 'x.test', name: '' })
})

it('startRetitle: POST /retitle；fetchRetitleStatus: GET /retitle/status', async () => {
  const calls = stubFetch({ accepted: true, targets: 3, hosts: 1 })
  const started = await startRetitle()
  expect(started).toEqual({ accepted: true, targets: 3, hosts: 1 })
  expect(calls[0]?.url).toBe('/dashboard/api/dataforge/retitle')
  expect(calls[0]?.init?.method).toBe('POST')

  stubFetch({ running: false, targets: 3, tried: 3, updated: 2, failed: 1, skipped: 0 })
  const status = await fetchRetitleStatus()
  expect(status.running).toBe(false)
})

it('新接口在旧服务端上的错误信封：抛 PanelApiError（调用方据此降级/提示重启）', async () => {
  vi.stubGlobal('fetch', async () => new Response(
    JSON.stringify({ success: false, error: '未知接口' }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  ))
  const err = await fetchPageMeta().catch((error: unknown) => error)
  expect(err).toBeInstanceOf(PanelApiError)
  expect((err as PanelApiError).status).toBe(404)
})
