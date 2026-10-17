/**
 * HTTP 出口（IF-4）：真起一个本地 http server 打真网络，不 mock fetch。
 *
 * 这里验的是**分类与边界**——超时/取消/重试/截断/重定向/脱敏，每一条都是执行期真会遇到的。
 *
 * @module dsh-dataforge/test/execute/http
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { httpRequest, redactHeaders } from '../../src/execute/http.js'

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url.startsWith('/json')) {
      res.writeHead(200, { 'content-type': 'application/json', 'x-total': '1' })
      res.end(JSON.stringify({ items: [{ internalId: 'M-1' }] }))
      return
    }
    if (url.startsWith('/echo-headers')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ cookie: req.headers['cookie'] ?? null, accept: req.headers['accept'] ?? null }))
      return
    }
    if (url.startsWith('/set-cookie')) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': ['sid=fresh; Path=/; HttpOnly', 'locale=zh; Path=/'],
      })
      res.end('{"ok":true}')
      return
    }
    if (url.startsWith('/fail500')) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('boom')
      return
    }
    if (url.startsWith('/slow')) {
      setTimeout(() => {
        res.writeHead(200)
        res.end('late')
      }, 300)
      return
    }
    if (url.startsWith('/big')) {
      res.writeHead(200)
      res.end('x'.repeat(5000))
      return
    }
    if (url.startsWith('/redirect')) {
      res.writeHead(302, { location: '/json' })
      res.end()
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('正常路径', () => {
  it('200 JSON：解析出 json、小写化响应头、记 attempts 与字节数', async () => {
    const outcome = await httpRequest({ method: 'GET', url: `${base}/json` })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.status).toBe(200)
    expect(outcome.response.json).toEqual({ items: [{ internalId: 'M-1' }] })
    expect(outcome.response.headers['content-type']).toContain('application/json')
    expect(outcome.response.headers['x-total']).toBe('1')
    expect(outcome.response.bytes).toBeGreaterThan(0)
    expect(outcome.response.truncated).toBe(false)
    expect(outcome.response.attempts).toBe(1)
  })

  it('保留原始 Set-Cookie 多行（换票要用），不被合并成一个头', async () => {
    const outcome = await httpRequest({ method: 'GET', url: `${base}/set-cookie` })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.setCookies).toEqual(['sid=fresh; Path=/; HttpOnly', 'locale=zh; Path=/'])
  })

  it('不继承 cookie：没有 cookie jar，credentials: omit 生效', async () => {
    const outcome = await httpRequest({ method: 'GET', url: `${base}/echo-headers` })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.json).toMatchObject({ cookie: null })
  })
})

describe('失败分类', () => {
  it('5xx 会重试，最后一次把响应原样返回（不把 500 变成异常）', async () => {
    const outcome = await httpRequest({ method: 'GET', url: `${base}/fail500`, retry: 1 })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.status).toBe(500)
    expect(outcome.response.attempts).toBe(2)
  })

  it('超时归到 timeout，不混成网络错', async () => {
    const outcome = await httpRequest({ method: 'GET', url: `${base}/slow`, timeoutMs: 60 })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('timeout')
  })

  it('调用方取消归到 aborted（优先于 timeout 判定）', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    const outcome = await httpRequest({ method: 'GET', url: `${base}/slow`, timeoutMs: 5000, signal: controller.signal })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('aborted')
  })

  it('非法 URL 归到 bad-url，不发请求', async () => {
    const outcome = await httpRequest({ method: 'GET', url: 'ftp://example.com/x' })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('bad-url')
    expect(outcome.attempts).toBe(1)
  })
})

describe('正文上限与重定向', () => {
  it('超过上限即截断，且不算错误', async () => {
    const outcome = await httpRequest({ method: 'GET', url: `${base}/big`, limitBytes: 100 })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.truncated).toBe(true)
    expect(outcome.response.bodyText).toHaveLength(100)
    expect(outcome.response.bytes).toBe(100)
  })

  it('跟随重定向并回报 finalUrl', async () => {
    const outcome = await httpRequest({ method: 'GET', url: `${base}/redirect` })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.status).toBe(200)
    expect(outcome.response.finalUrl).toBe(`${base}/json`)
    expect(outcome.response.json).toEqual({ items: [{ internalId: 'M-1' }] })
  })

  it('跳数超限即中止，不无限跟', async () => {
    const outcome = await httpRequest({ method: 'GET', url: `${base}/redirect`, maxRedirects: 0 })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('redirect-limit')
  })
})

describe('头脱敏', () => {
  it('凭证类头名只留名字，值替换成 ***', () => {
    const redacted = redactHeaders({
      cookie: 'JSESSIONID=abc',
      Authorization: 'Bearer secret',
      accept: 'application/json',
    })
    expect(redacted['cookie']).toBe('***')
    expect(redacted['Authorization']).toBe('***')
    expect(redacted['accept']).toBe('application/json')
  })
})
