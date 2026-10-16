import { expect, it, vi } from 'vitest'
import { SessionRegistry } from '../../src/capture/session.js'

const cookiesTotal = (closed: { cookies: unknown[] }): number => closed.cookies.length

it('session: open 登记 → act click 分派 → close 释放并交出 cookie 总结', async () => {
  const fakePage = {
    on: vi.fn(),
    url: () => 'https://x.test/a',
    click: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
  }
  const plastic = { close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }
  const fakeMaker = async () => ({
    page: fakePage as never,
    browser: { close: () => plastic.close() } as never,
    context: { cookies: async () => [1, 2] as never[] } as never,
  })
  const reg = new SessionRegistry({ openCapturingPage: fakeMaker as never, bodyLimit: 100 })
  const { sessionId } = await reg.open({ entryUrl: 'https://x.test' })
  const res = await reg.act(sessionId, { kind: 'click', selector: '#kw' })
  expect(res.ok).toBe(true)
  const closed = await reg.close(sessionId)
  expect(closed.ok).toBe(true)
  expect(cookiesTotal(closed)).toBe(2)
  // close 后复用应失败（释放干净）
  expect((await reg.act(sessionId, { kind: 'click', selector: '#kw' })).ok).toBe(false)
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
