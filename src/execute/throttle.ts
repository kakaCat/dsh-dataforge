/**
 * 换票单飞节流（R-4 M3）：同一 key 的并发换票只执行一次，其它等待者共享结果。
 *
 * 为什么需要：M2 的单飞只在一个 run 内部（一个 `reloginTask` Promise）。M3 要把
 * 节流提到「跨运行 / 跨会话」——同一站点同一登录链同时被多个运行触发时，不该并发
 * 打登录接口（账号锁定与请求风暴风险）。节流器本身不认识链、不认识凭证，只回答
 * 「这个 key 有没有正在飞的换票」。
 *
 * 语义（测试逐条覆盖）：
 *   - 同 key 并发：只有第一个 `fn` 真正执行，其余调用拿到同一个 Promise（结果共享）；
 *   - settle（成功或失败）后清理占位：下一次调用会重新执行 `fn`；
 *   - 不同 key 互不阻塞，真正并行；
 *   - `fn` 同步抛异常也折成 rejected Promise；所有等待者收到同一个错误。
 *
 * 边界：只做进程内节流（单进程工具），不做跨进程锁；key 由调用方定（如
 * `origin + 登录链 site/flow`），本模块不解释 key 的语义。
 *
 * @module dsh-dataforge/execute/throttle
 */

export type ReloginThrottle = {
  /**
   * 在 key 上执行一次 `fn`：同 key 并发共享结果，settle 后清理。
   * `fn` 抛错时所有等待者收到同一个错误（不吞错、不重试）。
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T>
}

/**
 * 创建进程内单飞节流器。
 *
 * 在飞表只存 Promise：settle 后从表中删除，因此不会缓存「上一次的失败」——
 * 下一次触发换票必须重新执行 `fn`（失败不该被静默复用）。
 */
export function createReloginThrottle(): ReloginThrottle {
  const inflight = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key)
      if (existing !== undefined) return existing as Promise<T>

      let task: Promise<T>
      try {
        task = Promise.resolve(fn())
      } catch (error) {
        // 同步抛异常也折成 rejected Promise，让调用方只有一种错误通道。
        task = Promise.reject(error)
      }
      // finally 在 settle 后清占位；无论成功失败都清，下一次调用重新执行 fn。
      const shared = task.finally(() => {
        if (inflight.get(key) === shared) inflight.delete(key)
      })
      inflight.set(key, shared)
      return shared
    },
  }
}
