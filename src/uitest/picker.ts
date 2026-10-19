/**
 * 页面点选：让用户在可见 Chrome 里点一个元素，拿回它的选择器候选。
 *
 * 与录制的关系：点选用于「录制后补断言/改步骤」时挑元素，不产生录制步骤。
 * 实现是 `page.evaluate(PICKER_SCRIPT)` + Promise，超时由 Node 侧主动取消（否则 evaluate 会永远挂着）。
 *
 * @module dsh-dataforge/uitest/picker
 */
import type { Page } from 'playwright-core'
import { PICKER_SCRIPT, type PickedElement } from './selector-script.js'

/** 缺省点选等待（用户手动点，给足时间）。 */
export const PICKER_TIMEOUT_MS = 120_000

/**
 * 在页面上等待用户点选一个元素，返回候选选择器。
 *
 * - 页面里按 Esc / 超时 → `{ ok:false, cancelled/error }`；
 * - 页面脚本缺失（页面未打开/重定向到无 helper 的文档）→ 返回 error，不抛；
 * - 点选期间页面点击被捕获阶段吞掉（不会触发业务导航/提交）。
 */
export async function pickOnPage(page: Page, timeoutMs = PICKER_TIMEOUT_MS): Promise<PickedElement> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<PickedElement>((resolve) => {
    timer = setTimeout(() => {
      // 主动取消页面里的 Promise，避免 evaluate 永远悬着（后续脚本执行会卡住）。
      void page.evaluate(`(() => { if (typeof window.__dfUiPickerCancel === 'function') window.__dfUiPickerCancel() })()`).catch(() => undefined)
      resolve({ ok: false, error: `点选超时（${Math.round(timeoutMs / 1000)}s）：请在浏览器里点一个元素，或按 Esc 取消` })
    }, timeoutMs)
  })
  try {
    const picked = await Promise.race([
      page.evaluate(PICKER_SCRIPT) as Promise<PickedElement>,
      timeout,
    ])
    return picked ?? { ok: false, error: '点选没有返回值' }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error).slice(0, 500) }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
