import { expect, it, vi } from 'vitest'
import { SessionRegistry } from '../../src/capture/session.js'

const cookiesTotal = (closed: { cookies: unknown[] }): number => closed.cookies.length

it('session: open 登记 → act click 分派 → close 释放并交出 raw cookie 总结', async () => {
  const fakePage = {
    on: vi.fn(),
    url: () => 'https://x.test/a',
    click: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
  }
  const plastic = { close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }
  const fakeMaker = async () => ({
    page: fakePage as never,
    browser: { close: () => plastic.close() } as never,
    context: {
      cookies: async () => [{ name: 'UID', domain: 'x.test', value: 'secret', httpOnly: false }] as never[],
    } as never,
  })
  const reg = new SessionRegistry({ openCapturingPage: fakeMaker as never, bodyLimit: 100 })
  const { sessionId } = await reg.open({ entryUrl: 'https://x.test' })
  const res = await reg.act(sessionId, { kind: 'click', selector: '#kw' })
  expect(res.ok).toBe(true)
  const closed = await reg.close(sessionId)
  expect(closed.ok).toBe(true)
  expect(cookiesTotal(closed)).toBe(1)
  expect(closed.cookies[0]).toEqual({ name: 'UID', domain: 'x.test', value: 'secret', httpOnly: false })
  // close 后复用应失败（释放干净）
  expect((await reg.act(sessionId, { kind: 'click', selector: '#kw' })).ok).toBe(false)
})

it('session: upload 分派 setInputFiles；cookies/headless 传给浏览器工厂', async () => {
  let options: unknown
  const fakePage = {
    on: vi.fn(),
    url: () => 'https://pan.baidu.com/',
    setInputFiles: vi.fn().mockResolvedValue(undefined),
  }
  const fakeMaker = async (_channel: string, _onSample: (w: unknown) => void, opts: unknown) => {
    options = opts
    return {
      page: fakePage as never,
      browser: { close: vi.fn().mockResolvedValue(undefined) } as never,
      context: { cookies: async () => [] as never[] } as never,
    }
  }
  const reg = new SessionRegistry({ openCapturingPage: fakeMaker as never, bodyLimit: 100 })
  const cookies = [{ name: 'BDUSS', value: 'v', domain: '.baidu.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const }]
  const { sessionId } = await reg.open({ headless: false, cookies })
  expect(options).toEqual({ headless: false, cookies })

  const uploaded = await reg.act(sessionId, { kind: 'upload', selector: 'input[name=html5uploader]', files: ['/tmp/dsh-upload-test.txt'] })
  expect(uploaded.ok).toBe(true)
  expect(fakePage.setInputFiles).toHaveBeenCalledWith('input[name=html5uploader]', ['/tmp/dsh-upload-test.txt'], { timeout: 20_000 })
})

it('session: 自带 captureId 桥接 → sink 收到 wire 样本 → close 交回 captureId', async () => {
  let push: ((w: unknown) => void) | undefined
  const fakePage = { on: vi.fn(), url: () => 'https://x.test/a' }
  const fakeMaker = async (_channel: string, onSample: (w: unknown) => void) => {
    push = onSample
    return {
      page: fakePage as never,
      browser: { close: vi.fn().mockResolvedValue(undefined) } as never,
      context: { cookies: async () => [] as never[] } as never,
    }
  }
  const samples: unknown[] = []
  const reg = new SessionRegistry({ openCapturingPage: fakeMaker as never, bodyLimit: 100 })
  const { sessionId } = await reg.open({ captureId: 'cap_x' })
  reg.bindSink(sessionId, (w) => samples.push(w))
  push?.({ url: 'https://x.api/a', method: 'GET', resourceType: 'xhr', contentType: 'application/json' })
  expect(samples).toHaveLength(1)
  const closed = await reg.close(sessionId)
  expect(closed.captureId).toBe('cap_x')
})
