/**
 * 换票单飞节流（R-4 M3）：同 key 并发只跑一次、结果共享、settle 后清理、不同 key 并行。
 *
 * 这一组全用 deferred promise 精确控制时序：不靠 sleep 猜并发，直接断言「fn 被调几次」
 * 与「谁先开始」。抛错路径单独验：错误共享给所有等待者，且失败不被缓存复用。
 *
 * @module dsh-dataforge/test/execute/throttle
 */
import { describe, expect, it } from 'vitest'
import { createReloginThrottle } from '../../src/execute/throttle.js'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createReloginThrottle：单飞', () => {
  it('同 key 并发只执行一次 fn，所有调用者拿到同一结果', async () => {
    const throttle = createReloginThrottle()
    let calls = 0
    const gate = deferred<string>()
    const fn = (): Promise<string> => {
      calls += 1
      return gate.promise
    }

    const first = throttle.run('origin+login', fn)
    const second = throttle.run('origin+login', fn)
    expect(calls).toBe(1)

    gate.resolve('fresh-cookie')

    await expect(first).resolves.toBe('fresh-cookie')
    await expect(second).resolves.toBe('fresh-cookie')
    expect(calls).toBe(1)
  })

  it('settle 后清理：下一次同 key 调用重新执行 fn（不缓存上一次结果）', async () => {
    const throttle = createReloginThrottle()
    let calls = 0
    const run = (): Promise<number> => {
      calls += 1
      return Promise.resolve(calls)
    }

    expect(await throttle.run('k', run)).toBe(1)
    expect(await throttle.run('k', run)).toBe(2)
    expect(calls).toBe(2)
  })

  it('不同 key 真正并行，互不阻塞', async () => {
    const throttle = createReloginThrottle()
    const started: string[] = []
    const a = deferred<string>()
    const b = deferred<string>()

    const first = throttle.run('site-a', () => {
      started.push('a')
      return a.promise
    })
    const second = throttle.run('site-b', () => {
      started.push('b')
      return b.promise
    })

    // 两个 fn 都已经开始（没有等待第一个完成才启动第二个）。
    expect(started).toEqual(['a', 'b'])

    a.resolve('A')
    b.resolve('B')
    await expect(first).resolves.toBe('A')
    await expect(second).resolves.toBe('B')
  })
})

describe('createReloginThrottle：错误语义', () => {
  it('fn 抛错时所有等待者收到同一个错误，且失败不被缓存', async () => {
    const throttle = createReloginThrottle()
    let calls = 0
    const fn = async (): Promise<string> => {
      calls += 1
      throw new Error('relogin-failed：账号被锁')
    }

    const first = throttle.run('origin+login', fn)
    const second = throttle.run('origin+login', fn)
    expect(calls).toBe(1)

    const settled = await Promise.allSettled([first, second])
    expect(settled.map((entry) => entry.status)).toEqual(['rejected', 'rejected'])
    for (const entry of settled) {
      if (entry.status === 'rejected') expect(String(entry.reason)).toContain('relogin-failed')
    }

    // 失败已清理：下一次调用重新执行 fn，并拿到新结果。
    const recovered = await throttle.run('origin+login', async () => 'retry-ok')
    expect(recovered).toBe('retry-ok')
  })

  it('fn 同步抛异常也折成 rejected Promise；其它等待者共享；之后可重试', async () => {
    const throttle = createReloginThrottle()
    let calls = 0
    const boom = (): Promise<never> => {
      calls += 1
      throw new Error('sync-boom')
    }

    const first = throttle.run('sync-key', boom)
    const second = throttle.run('sync-key', boom)
    expect(calls).toBe(1)

    const settled = await Promise.allSettled([first, second])
    expect(settled.every((entry) => entry.status === 'rejected')).toBe(true)
    for (const entry of settled) {
      if (entry.status === 'rejected') expect(String(entry.reason)).toContain('sync-boom')
    }

    const recovered = await throttle.run('sync-key', async () => 'next-ok')
    expect(recovered).toBe('next-ok')
  })

  it('一个 key 失败不影响另一个 key 的在飞任务', async () => {
    const throttle = createReloginThrottle()
    const failed = throttle.run('bad', async () => {
      throw new Error('bad-login')
    })
    const ok = deferred<string>()
    const good = throttle.run('good', () => ok.promise)

    ok.resolve('good-cookie')
    await expect(good).resolves.toBe('good-cookie')
    await expect(failed).rejects.toThrow('bad-login')
  })
})
