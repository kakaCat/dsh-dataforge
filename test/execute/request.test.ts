/**
 * 请求构造（IF-3 `buildRequest`）：值来源、URL 占位符、query 覆盖、body 骨架、缺参报错。
 *
 * 纯函数测试，不起服务、不碰盘。
 *
 * @module dsh-dataforge/test/execute/request
 */
import { describe, expect, it } from 'vitest'
import type { InterfaceCardDoc } from '../../src/chains/schema.js'
import type { PlanNode } from '../../src/execute/plan.js'
import { buildRequest } from '../../src/execute/request.js'

const BASE = 'https://scm.example.com'

function card(overrides: Partial<InterfaceCardDoc> & { urlTemplate: string }): InterfaceCardDoc {
  const { urlTemplate, ...rest } = overrides
  return {
    cardId: 'card_000001',
    kind: 'interface-card',
    identity: { mergeKey: `GET ${urlTemplate}`, method: 'GET', urlTemplate },
    inputs: [],
    outputs: [],
    ...rest,
  }
}

function node(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    nodeId: 'query-material',
    cardId: 'card_000001',
    method: 'GET',
    urlTemplate: '/api/materials',
    dependsOn: [],
    constants: {},
    gaps: [],
    ...overrides,
  }
}

describe('query 与 URL 模板', () => {
  it('query 入参覆盖模板里的同名键，模板其余键原样保留', () => {
    const result = buildRequest({
      node: node(),
      card: card({
        urlTemplate: '/api/materials?q=empty&page=1',
        inputs: [{ path: 'query.q', type: 'string' }],
      }),
      baseUrl: BASE,
      provided: { 'query.q': '螺丝' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.url).toBe(`${BASE}/api/materials?q=${encodeURIComponent('螺丝')}&page=1`)
  })

  it('模板里的 {q} 占位符由 query.q 覆盖', () => {
    const result = buildRequest({
      node: node(),
      card: card({ urlTemplate: '/api/materials?q={q}', inputs: [{ path: 'query.q', type: 'string' }] }),
      baseUrl: BASE,
      inputs: { keyword: 'abc' },
    })
    // 没给 query.q → 必须报错，不能把 {q} 原样发出去
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('param-missing')
    expect(result.path).toBe('query.q')
  })

  it('空值写成裸键（与采集期一致，不发 market=）', () => {
    const result = buildRequest({
      node: node(),
      card: card({ urlTemplate: '/api/getbanner?finClientType=pc&market', inputs: [] }),
      baseUrl: BASE,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.url).toBe(`${BASE}/api/getbanner?finClientType=pc&market`)
  })

  it('baseUrl 末尾的斜杠不会拼出双斜杠', () => {
    const result = buildRequest({
      node: node(),
      card: card({ urlTemplate: '/api/x', inputs: [] }),
      baseUrl: `${BASE}/`,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.url).toBe(`${BASE}/api/x`)
  })
})

describe('path 参数（{p} 位置语义）', () => {
  it('匿名 {p} 按次序取 path.p1/p2，具名占位符取同名', () => {
    const result = buildRequest({
      node: node(),
      card: card({
        urlTemplate: '/api/orders/{orderId}/items/{p}',
        inputs: [
          { path: 'path.orderId', type: 'string', required: true, role: 'input' },
          { path: 'path.p1', type: 'string', required: true, role: 'input' },
        ],
      }),
      baseUrl: BASE,
      provided: { 'path.orderId': 'SO-1', 'path.p1': '42' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.url).toBe(`${BASE}/api/orders/SO-1/items/42`)
  })

  it('占位符没值 → param-missing，并指到 path.<name>', () => {
    const result = buildRequest({
      node: node(),
      card: card({
        urlTemplate: '/api/orders/{p}/items',
        inputs: [{ path: 'path.p1', type: 'string', required: true, role: 'input' }],
      }),
      baseUrl: BASE,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('param-missing')
    expect(result.path).toBe('path.p1')
    expect(result.message).toContain('path.p1')
  })
})

describe('值来源优先级', () => {
  it('绑定值优先于节点常量', () => {
    const result = buildRequest({
      node: node({ constants: { 'query.q': 'from-constant' } }),
      card: card({ urlTemplate: '/api/materials?q=x', inputs: [{ path: 'query.q', type: 'string' }] }),
      baseUrl: BASE,
      provided: { 'query.q': 'from-binding' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.url).toContain('from-binding')
  })

  it('常量里的 $inputs.x 从运行值取；槽位没值 → 缺参', () => {
    const base = {
      node: node({ constants: { 'query.q': '$inputs.keyword' } }),
      card: card({ urlTemplate: '/api/materials?q=x', inputs: [{ path: 'query.q', type: 'string' }] }),
      baseUrl: BASE,
    }
    const ok = buildRequest({ ...base, inputs: { keyword: '螺丝' } })
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.request.url).toContain(encodeURIComponent('螺丝'))

    const missing = buildRequest({ ...base, inputs: {} })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.code).toBe('param-missing')
  })

  it('凭证角色字段既不去取、也不报缺参', () => {
    const result = buildRequest({
      node: node(),
      card: card({
        urlTemplate: '/api/x',
        inputs: [
          { path: 'header.authorization', type: 'string', role: 'credential' },
          { path: 'query.q', type: 'string' },
        ],
      }),
      baseUrl: BASE,
      provided: { 'query.q': 'v' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.headers['authorization']).toBeUndefined()
  })
})

describe('body 构造', () => {
  it('嵌套对象 + 显式下标数组拼成正确的 JSON', () => {
    const result = buildRequest({
      node: node({ method: 'POST' }),
      card: card({
        urlTemplate: '/api/orders',
        inputs: [
          { path: 'body.lines[0].materialId', type: 'string' },
          { path: 'body.lines[0].quantity', type: 'number' },
          { path: 'body.orgId', type: 'string' },
        ],
      }),
      baseUrl: BASE,
      provided: { 'body.lines[*].materialId': 'M-1', 'body.lines[*].quantity': 3, 'body.orgId': '2120' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.headers['content-type']).toBe('application/json')
    const body = result.request.body
    expect(typeof body).toBe('string')
    if (typeof body !== 'string') return
    expect(JSON.parse(body)).toEqual({
      lines: [{ materialId: 'M-1', quantity: 3 }],
      orgId: '2120',
    })
  })

  it('[*] 落到第 0 行（卡里没有行模板，不凭空展开）', () => {
    const result = buildRequest({
      node: node({ method: 'POST' }),
      card: card({ urlTemplate: '/api/orders', inputs: [{ path: 'body.lines[*].materialId', type: 'string' }] }),
      baseUrl: BASE,
      provided: { 'body.lines[*].materialId': 'M-9' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const body = result.request.body
    expect(typeof body).toBe('string')
    if (typeof body !== 'string') return
    expect(JSON.parse(body)).toEqual({ lines: [{ materialId: 'M-9' }] })
  })

  it('给 [*] 字段喂数组 → 明确报错，让人改成显式下标', () => {
    const result = buildRequest({
      node: node({ method: 'POST' }),
      card: card({ urlTemplate: '/api/orders', inputs: [{ path: 'body.lines[*].materialId', type: 'string' }] }),
      baseUrl: BASE,
      provided: { 'body.lines[*].materialId': ['M-1', 'M-2'] },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('param-type-mismatch')
    expect(result.message).toContain('[0]')
  })

  it('GET 不带正文，也不补 content-type', () => {
    const result = buildRequest({
      node: node({ method: 'GET' }),
      card: card({ urlTemplate: '/api/x', inputs: [{ path: 'body.ignored', type: 'string' }] }),
      baseUrl: BASE,
      provided: { 'body.ignored': 'v' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.body).toBeUndefined()
    expect(result.request.headers['content-type']).toBeUndefined()
  })

  it('content-type=application/x-www-form-urlencoded → 表单正文，而不是 JSON', () => {
    const result = buildRequest({
      node: node({ method: 'POST' }),
      card: card({
        urlTemplate: '/share/pset',
        inputs: [
          { path: 'header.content-type', type: 'string' },
          { path: 'body.fid_list', type: 'string' },
          { path: 'body.pwd', type: 'string' },
        ],
      }),
      baseUrl: BASE,
      provided: {
        'header.content-type': 'application/x-www-form-urlencoded',
        'body.fid_list': '[123]',
        'body.pwd': 'feav',
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(result.request.body).toBe('fid_list=%5B123%5D&pwd=feav')
  })

  it('multipart/form-data + fileParts → 带边界/文件名/内容的二进制正文', () => {
    const result = buildRequest({
      node: node({ method: 'POST' }),
      card: card({
        urlTemplate: '/rest/2.0/pcs/superfile2',
        inputs: [
          { path: 'header.content-type', type: 'string' },
          { path: 'body.path', type: 'string' },
          { path: 'body.file', type: 'string' },
        ],
      }),
      baseUrl: BASE,
      provided: { 'header.content-type': 'multipart/form-data', 'body.path': '/dsh-test.txt' },
      fileParts: [{ field: 'body.file', filename: 'dsh-test.txt', contentType: 'text/plain', data: new TextEncoder().encode('hello-upload') }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(result.request.body).toBeInstanceOf(Uint8Array)
    const text = Buffer.from(result.request.body as Uint8Array).toString('utf8')
    expect(text).toContain('Content-Disposition: form-data; name="path"')
    expect(text).toContain('Content-Disposition: form-data; name="file"; filename="dsh-test.txt"')
    expect(text).toContain('hello-upload')
  })

  it('卡上显式给了 content-type 就用它，不被覆盖', () => {
    const result = buildRequest({
      node: node({ method: 'POST' }),
      card: card({
        urlTemplate: '/api/orders',
        inputs: [
          { path: 'header.content-type', type: 'string' },
          { path: 'body.orgId', type: 'string' },
        ],
      }),
      baseUrl: BASE,
      provided: { 'header.content-type': 'application/xml', 'body.orgId': '2120' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.headers['content-type']).toBe('application/xml')
  })
})
