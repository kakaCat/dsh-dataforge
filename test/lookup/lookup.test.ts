/**
 * S5.1 lookup：运行时从接口取值 + 缓存/来源；不写死业务映射。
 *
 * @module dsh-dataforge/test/lookup/lookup
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lookupForTool } from '../../src/lookup/lookup.js'
import { defineLookupTool } from '../../src/tools.js'

let dir: string
let dataRoot: string
let server: Server
let baseUrl: string
let requests: number

function writeLookup(name: string, body: string): void {
  const lookupDir = join(dir, '.dsh', 'dataforge', 'lookups')
  mkdirSync(lookupDir, { recursive: true })
  writeFileSync(join(lookupDir, `${name}.yaml`), body, 'utf8')
}

beforeEach(async () => {
  requests = 0
  server = createServer((req, res) => {
    requests += 1
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    if (parsed.pathname === '/api/orgs') {
      res.end(JSON.stringify({
        data: [
          { orgName: '生态链事业部', shortName: 'ECO', stockOrg: 'MI_IOT', purchaseOrg: '2120' },
          { orgName: '手机事业部', shortName: 'PHONE', stockOrg: 'MI_PHONE', purchaseOrg: '1110' },
        ],
      }))
    } else {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server 未监听')
  baseUrl = `http://127.0.0.1:${address.port}`
  dir = mkdtempSync(join(tmpdir(), 'df-lookup-'))
  dataRoot = join(dir, 'data')
  writeLookup('org', `kind: data-lookup
name: org
site: test
source:
  kind: api
  baseUrl: ${baseUrl}
  path: /api/orgs
  query: { q: "{{query}}" }
  items: $.data
  match: [$.orgName, $.shortName]
  map: { stockOrg: $.stockOrg, purchaseOrg: $.purchaseOrg }
cache: { ttlSeconds: 3600 }
`)
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

function deps() {
  return { dataRoot, resolveWorkspaceRoot: async () => dir }
}

describe('lookupForTool', () => {
  it('接口取值 + 缓存 + 来源；第二次命中缓存不再请求', async () => {
    const first = await lookupForTool(deps(), undefined, { name: 'org', query: '生态链' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.cache).toBe('miss')
    expect(first.candidates).toEqual([{ label: '生态链事业部', values: { stockOrg: 'MI_IOT', purchaseOrg: '2120' } }])
    expect(first.source.description).toContain('/api/orgs')
    expect(requests).toBe(1)
    const second = await lookupForTool(deps(), undefined, { name: 'org', query: '手机' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.cache).toBe('hit')
    expect(second.candidates[0]?.values.stockOrg).toBe('MI_PHONE')
    expect(requests).toBe(1)
  })

  it('refresh=true 强制刷新；页面来源如实 unavailable', async () => {
    await lookupForTool(deps(), undefined, { name: 'org', query: '生态链' })
    const refreshed = await lookupForTool(deps(), undefined, { name: 'org', query: '生态链', refresh: true })
    expect(refreshed.ok).toBe(true)
    expect(requests).toBe(2)
    writeLookup('page-only', `kind: data-lookup
name: page-only
source:
  kind: page
  url: https://example.test/
  items: "select option"
  label: text
  map: { id: "attr:data-id" }
`)
    const page = await lookupForTool(deps(), undefined, { name: 'page-only', query: 'x' })
    expect(page.ok).toBe(false)
    if (page.ok) return
    expect(page.code).toBe('page-lookup-unavailable')
  })

  it('page 来源：注入 pageReader 后取值；缓存命中不再读页面', async () => {
    writeLookup('page-org', `kind: data-lookup
name: page-org
site: test
source:
  kind: page
  url: https://example.test/orgs
  items: "select#org option"
  label: text
  map: { stockOrg: "attr:data-stock", purchaseOrg: "attr:data-purchase" }
cache: { ttlSeconds: 3600 }
`)
    let reads = 0
    const pageDeps = {
      ...deps(),
      pageReader: async (source: { items: string }) => {
        reads += 1
        expect(source.items).toBe('select#org option')
        return [{ label: '生态链事业部', values: { stockOrg: 'MI_IOT', purchaseOrg: '2120' } }]
      },
    }
    const first = await lookupForTool(pageDeps, undefined, { name: 'page-org', query: '生态链' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.source.kind).toBe('page')
    expect(first.candidates[0]?.values.stockOrg).toBe('MI_IOT')
    expect(reads).toBe(1)
    const second = await lookupForTool(pageDeps, undefined, { name: 'page-org', query: '生态链' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.cache).toBe('hit')
    expect(reads).toBe(1)
  })

  it('缺配置 / 非法配置结构化报错', async () => {
    const missing = await lookupForTool(deps(), undefined, { name: 'missing', query: 'x' })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.code).toBe('lookup-not-found')
    writeLookup('bad', 'kind: data-lookup\nsource: {}\n')
    const bad = await lookupForTool(deps(), undefined, { name: 'bad', query: 'x' })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.code).toBe('lookup-invalid')
  })

  it('工具壳 execute：schema 通过并返回候选', async () => {
    const tool = defineLookupTool(deps()) as unknown as {
      execute: (args: { name: string; query: string }, exec?: unknown) => Promise<{ ok: boolean; candidates?: Array<{ label: string }> }>
    }
    const value = await tool.execute({ name: 'org', query: '生态链' }, undefined)
    expect(value.ok).toBe(true)
    expect(value.candidates?.[0]?.label).toBe('生态链事业部')
  })
})
