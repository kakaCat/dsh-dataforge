/**
 * UI 回放引擎：把 ui-script 的步骤在真浏览器里按顺序执行，并在每步后做页面断言。
 *
 * 与接口链执行（src/execute）的关系：
 *   - 两者都是「执行面」，但依赖图互不相交：本模块只依赖 playwright-core + uitest 自己的
 *     store，**不 import src/execute/**、不 import src/capture/**（浏览器只在这里起）；
 *   - 共用的是运行留痕习惯（run.json + events.ndjson）与凭证纪律（cookie 只进 context，
 *     不进事件/摘要）。
 *
 * 回放语义（刻意保守）：
 *   - 选择器候选按顺序找「当前页面唯一命中」的那个；候选全失效 = 该步失败（带截图）；
 *   - 动作后用 Playwright 的自动等待收口（点击后导航、列表渲染）；断言独立轮询到步骤超时；
 *   - 失败即停（fail-fast），不猜测修复、不重试写操作（重试写可能造成重复提交）。
 *
 * @module dsh-dataforge/uitest/run
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core'
import {
  substituteInputs, type UiExpect, type UiScriptDoc, type UiStep,
} from './schema.js'
import {
  appendUiRunEvent, finishUiRun, startUiRun, uiRunDir,
  type UiRunEvent,
} from './run-store.js'
import { highlightClickExpression } from './highlight.js'
import { featureCandidates } from './features.js'

/** 浏览器工厂缝：真实现用系统 Chrome，测试可注入假页面。 */
export type UiBrowserFactory = (options: {
  headless: boolean
  viewport: { width: number; height: number }
  channel: string
}) => Promise<{ browser: Browser; context: BrowserContext; page: Page }>

/** 默认工厂：playwright-core + 系统 Chrome（与本插件采集同款，免下载浏览器）。 */
export const openUiBrowser: UiBrowserFactory = async ({ headless, viewport, channel }) => {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel, headless })
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  return { browser, context, page }
}

/** 回放期可注入的 cookie（Playwright 形状；值只进 context）。 */
export type UiCookie = {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean
  expires?: number
}

/** 回放依赖（应用层装配）。 */
export type UiRunDeps = {
  dataRoot: string
  channel: string
  stepTimeoutMs: number
  /** 浏览器工厂（缺省 openUiBrowser）。 */
  openBrowser?: UiBrowserFactory
  /** 按起点加载 cookie（缺省不加载）。 */
  loadCookies?: (startUrl: string) => Promise<UiCookie[]>
}

export type UiRunArgs = {
  doc: UiScriptDoc
  /** 入参槽位值（`{{name}}` 替换）；缺省空对象。 */
  inputs?: Record<string, string>
  /** true = 可见 Chrome（联调首跑用）；缺省无头。 */
  headless?: boolean
  /** 每步之间的慢放延迟（毫秒，0..10000）；用于人工观察回放过程。 */
  slowMoMs?: number
  /** 点击时在落点画脉冲光圈（缺省 true）；批量回归可关掉。 */
  highlightClicks?: boolean
  /** 回放结束后停留多久再关浏览器（毫秒，0..30000；缺省 1200）。 */
  holdMs?: number
}

/** 单条断言的结果。 */
export type UiExpectResult = {
  kind: UiExpect['kind']
  selector?: string
  ok: boolean
  expected?: string
  actual?: string
  elapsedMs: number
  error?: string
}

/** 单步结果。 */
export type UiStepResult = {
  id: string
  kind: UiStep['kind']
  ok: boolean
  /** 实际使用的选择器（候选解析结果）。 */
  target?: string
  elapsedMs: number
  error?: string
  assertions: UiExpectResult[]
}

/** 一次回放的结果。 */
export type UiRunResult = {
  runId: string
  site: string
  flow: string
  version: number
  startUrl: string
  success: boolean
  totalSteps: number
  stepsDone: number
  steps: UiStepResult[]
  failedStep?: UiStepResult
  /** 失败截图（相对 dataRoot 的路径，面板/工具回执用；不含 base64）。 */
  screenshot?: string
  /** 失败现场 HTML（相对 dataRoot）。 */
  dom?: string
  error?: string
  elapsedMs: number
  /** 回放前注入的 cookie 条数（不含值）。 */
  cookiesApplied: number
  notice?: string
}

/** 计划卡：确认前给用户看的拓扑（不回放、不建运行）。 */
export type UiRunPlan = {
  site: string
  flow: string
  version: number
  startUrl: string
  stepCount: number
  /** 可能产生写操作的步骤数（click/submit/upload）。 */
  writeSteps: number
  steps: Array<{ id: string; kind: UiStep['kind']; target?: string; value?: string }>
  inputs: Record<string, string>
}

/** 步骤执行后的目标描述（回执/事件用，不含值）。 */
function targetOf(step: UiStep): string | undefined {
  return step.selector ?? step.candidates?.[0] ?? step.url
}

/** 计划：替换入参后的步骤摘要 + 写操作计数。 */
export function planUiRun(doc: UiScriptDoc, inputs: Record<string, string> = {}): UiRunPlan {
  return {
    site: doc.meta.site,
    flow: doc.meta.flow,
    version: doc.meta.version,
    startUrl: substituteInputs(doc.meta.startUrl, inputs),
    stepCount: doc.steps.length,
    writeSteps: doc.steps.filter((step) => step.kind === 'click' || step.kind === 'submit' || step.kind === 'upload').length,
    steps: doc.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      ...(targetOf(step) === undefined ? {} : { target: targetOf(step) }),
      ...(step.value === undefined ? {} : { value: substituteInputs(step.value, inputs) }),
    })),
    inputs,
  }
}

/** 跑一次 ui-script：建留痕 → 起浏览器 → 逐步执行 + 断言 → 写终态。 */
export async function runUiScript(deps: UiRunDeps, args: UiRunArgs): Promise<UiRunResult> {
  const { doc } = args
  const inputs = args.inputs ?? {}
  const runId = `uir_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const startUrl = substituteInputs(doc.meta.startUrl, inputs)
  const headless = args.headless ?? true
  // 慢放只影响观察节奏，不影响超时预算（超时仍是单步动作/断言的预算）。
  const slowMoMs = Math.min(Math.max(Math.floor(args.slowMoMs ?? 0), 0), 10_000)
  const highlightClicks = args.highlightClicks ?? true
  const holdMs = Math.min(Math.max(Math.floor(args.holdMs ?? 0), 0), 30_000)
  const startedAt = Date.now()
  const viewport = doc.meta.viewport ?? { width: 1280, height: 720 }
  startUiRun(deps.dataRoot, runId, {
    site: doc.meta.site,
    flow: doc.meta.flow,
    version: doc.meta.version,
    startUrl,
    headless,
    totalSteps: doc.steps.length,
  })
  emit(deps.dataRoot, runId, { event: 'meta', site: doc.meta.site, flow: doc.meta.flow, version: doc.meta.version, startUrl })

  const stepResults: UiStepResult[] = []
  let cookiesApplied = 0
  let browser: Browser | undefined
  try {
    const factory = deps.openBrowser ?? openUiBrowser
    const opened = await factory({ headless, viewport, channel: deps.channel })
    browser = opened.browser
    const { page, context } = opened
    if (deps.loadCookies !== undefined) {
      const cookies = await deps.loadCookies(startUrl).catch(() => [])
      if (cookies.length > 0) {
        await context.addCookies(cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path ?? '/',
          secure: cookie.secure ?? startUrl.startsWith('https:'),
          ...(cookie.expires === undefined ? {} : { expires: cookie.expires }),
        }))).catch(() => undefined)
        cookiesApplied = cookies.length
      }
    }
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: deps.stepTimeoutMs })

    const emitStepEvent = (event: UiRunEvent): void => appendUiRunEvent(deps.dataRoot, runId, event)
    for (const step of doc.steps) {
      if (slowMoMs > 0) await sleep(slowMoMs)
      const result = await runStep(page, step, inputs, deps.stepTimeoutMs, emitStepEvent, highlightClicks)
      stepResults.push(result)
      if (!result.ok) {
        const evidence = await captureFailure(page, deps.dataRoot, runId)
        const elapsedMs = Date.now() - startedAt
        appendUiRunEvent(deps.dataRoot, runId, {
          event: 'terminal', success: false, message: result.error,
          ...(evidence.screenshot === undefined ? {} : { screenshot: evidence.screenshot }),
          ...(evidence.dom === undefined ? {} : { dom: evidence.dom }),
          elapsed: elapsedMs,
        })
        finishUiRun(deps.dataRoot, runId, {
          status: 'failed',
          finishedAt: Date.now(),
          stepsDone: stepResults.length - 1,
          failedStep: result.id,
          ...(result.error === undefined ? {} : { error: result.error }),
          ...(evidence.screenshot === undefined ? {} : { screenshot: evidence.screenshot }),
          elapsedMs,
        })
        return {
          runId,
          site: doc.meta.site,
          flow: doc.meta.flow,
          version: doc.meta.version,
          startUrl,
          success: false,
          totalSteps: doc.steps.length,
          stepsDone: stepResults.length - 1,
          steps: stepResults,
          failedStep: result,
          ...(evidence.screenshot === undefined ? {} : { screenshot: evidence.screenshot }),
          ...(evidence.dom === undefined ? {} : { dom: evidence.dom }),
          ...(result.error === undefined ? {} : { error: result.error }),
          elapsedMs,
          cookiesApplied,
        }
      }
    }

    const elapsedMs = Date.now() - startedAt
    const evidence = await captureSuccess(page, deps.dataRoot, runId)
    appendUiRunEvent(deps.dataRoot, runId, {
      event: 'terminal', success: true, message: `全部 ${doc.steps.length} 步通过`, elapsed: elapsedMs,
      ...(evidence.screenshot === undefined ? {} : { screenshot: evidence.screenshot }),
    })
    finishUiRun(deps.dataRoot, runId, {
      status: 'success',
      finishedAt: Date.now(),
      stepsDone: stepResults.length,
      ...(evidence.screenshot === undefined ? {} : { screenshot: evidence.screenshot }),
      elapsedMs,
    })
    return {
      runId,
      site: doc.meta.site,
      flow: doc.meta.flow,
      version: doc.meta.version,
      startUrl,
      success: true,
      totalSteps: doc.steps.length,
      stepsDone: stepResults.length,
      steps: stepResults,
      ...(evidence.screenshot === undefined ? {} : { screenshot: evidence.screenshot }),
      elapsedMs,
      cookiesApplied,
    }
  } catch (error) {
    const message = String((error as Error)?.message ?? error).slice(0, 1_000)
    const elapsedMs = Date.now() - startedAt
    appendUiRunEvent(deps.dataRoot, runId, { event: 'terminal', success: false, message, elapsed: elapsedMs })
    finishUiRun(deps.dataRoot, runId, {
      status: 'failed',
      finishedAt: Date.now(),
      stepsDone: stepResults.length,
      error: message,
      elapsedMs,
    })
    return {
      runId,
      site: doc.meta.site,
      flow: doc.meta.flow,
      version: doc.meta.version,
      startUrl,
      success: false,
      totalSteps: doc.steps.length,
      stepsDone: stepResults.length,
      steps: stepResults,
      error: message,
      elapsedMs,
      cookiesApplied,
    }
  } finally {
    // 末尾停留：让最后一步的点击动画/页面状态在关闭前可见。
    if (browser !== undefined && holdMs > 0) await sleep(holdMs)
    await browser?.close().catch(() => undefined)
  }
}

/** 点击前在元素中心画光圈（best-effort：无 boundingBox/evaluate 时跳过）。 */
async function highlightLocator(page: Page, locator: Locator, enabled: boolean): Promise<void> {
  if (!enabled) return
  try {
    const box = await locator.boundingBox()
    if (box === null || box.width <= 0 || box.height <= 0) return
    if (typeof page.evaluate !== 'function') return
    await page.evaluate(highlightClickExpression(box.x + box.width / 2, box.y + box.height / 2))
  } catch {
    // 提示动画永远不能影响真实点击
  }
}

/** 按元素内比例坐标点击（clickPoint.fx/fy）；元素不可见/无尺寸时抛错。 */
async function clickLocatorPoint(
  page: Page,
  locator: Locator,
  point: NonNullable<UiStep['clickPoint']>,
  highlightClicks: boolean,
): Promise<void> {
  const box = await locator.boundingBox()
  if (box === null || box.width <= 0 || box.height <= 0) throw new Error('元素没有可点击的尺寸（无法按坐标点击）')
  const near = (left: number, right: number): boolean => Math.abs(left - right) <= 1.5
  const unchanged = point.bx !== undefined && point.by !== undefined && point.bw !== undefined && point.bh !== undefined
    && near(point.bx, box.x) && near(point.by, box.y) && near(point.bw, box.width) && near(point.bh, box.height)
  // 原元素位置尺寸没变 → 直接用录制坐标；变了才按当前 rect 重算。
  const x = unchanged ? point.x : box.x + point.fx * box.width
  const y = unchanged ? point.y : box.y + point.fy * box.height
  if (highlightClicks && typeof page.evaluate === 'function') {
    await page.evaluate(highlightClickExpression(x, y)).catch(() => undefined)
  }
  await page.mouse.click(x, y)
}

function emit(dataRoot: string, runId: string, event: UiRunEvent): void {
  appendUiRunEvent(dataRoot, runId, event)
}

/** 单步：动作 → 断言（任一失败即该步失败）。 */
async function runStep(
  page: Page,
  step: UiStep,
  inputs: Record<string, string>,
  timeoutMs: number,
  emit: (event: UiRunEvent) => void,
  highlightClicks: boolean,
): Promise<UiStepResult> {
  const startedAt = Date.now()
  const result: UiStepResult = { id: step.id, kind: step.kind, ok: false, elapsedMs: 0, assertions: [] }
  const target = targetOf(step)
  emit({ event: 'step', id: step.id, kind: step.kind, status: 'start', ...(target === undefined ? {} : { target }) })
  try {
    if (step.kind === 'wait') {
      await page.waitForTimeout(Math.min(step.ms ?? 0, timeoutMs))
    } else if (step.kind === 'goto') {
      const url = substituteInputs(step.url ?? '', inputs)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    } else if (step.kind === 'press' && step.selector === undefined && (step.candidates?.length ?? 0) === 0) {
      await page.keyboard.press(substituteInputs(step.key ?? '', inputs))
    } else {
      let resolved: Awaited<ReturnType<typeof resolveTarget>>
      try {
        resolved = await resolveTarget(page, step, timeoutMs)
      } catch (error) {
        // 录制标注了该步所在页面（at）而当前页不同：导航过去再试一次（旧脚本 / 点击未跳转时兜底）。
        const at = typeof step.at === 'string' && /^https?:\/\//.test(step.at) ? step.at : undefined
        if (at === undefined || page.url() === at) throw error
        await page.goto(at, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        resolved = await resolveTarget(page, step, timeoutMs)
      }
      result.target = resolved.selector
      const timeout = Math.max(500, timeoutMs - (Date.now() - startedAt))
      if (step.kind === 'click') {
        if (step.clickPoint === undefined) {
          await highlightLocator(page, resolved.locator, highlightClicks)
          await resolved.locator.click({ timeout })
        } else {
          // canvas 图表：元素中心通常是空白，按录制时的落点比例真鼠标点击。
          const canvas = await resolved.locator.evaluate((el: { tagName?: string }) => el.tagName === 'CANVAS').catch(() => false)
          if (canvas) {
            await clickLocatorPoint(page, resolved.locator, step.clickPoint, highlightClicks)
          } else {
            try {
              await highlightLocator(page, resolved.locator, highlightClicks)
              await resolved.locator.click({ timeout })
            } catch (error) {
              await clickLocatorPoint(page, resolved.locator, step.clickPoint, highlightClicks).catch(() => { throw error })
            }
          }
        }
      } else if (step.kind === 'fill') {
        await resolved.locator.fill(substituteInputs(step.value ?? '', inputs), { timeout })
      } else if (step.kind === 'select') {
        await resolved.locator.selectOption(substituteInputs(step.value ?? '', inputs), { timeout })
      } else if (step.kind === 'press') {
        await resolved.locator.press(substituteInputs(step.key ?? '', inputs), { timeout })
      } else if (step.kind === 'submit') {
        // 用真函数而不是字符串表达式：Playwright 对字符串按表达式求值，(form)=>… 只会返回函数不调用。
        await resolved.locator.evaluate((form: unknown) => {
          const target = form as { requestSubmit?: () => void }
          if (typeof target.requestSubmit === 'function') target.requestSubmit()
        })
      } else if (step.kind === 'upload') {
        const files = (step.files ?? []).map((file) => substituteInputs(file, inputs))
        await resolved.locator.setInputFiles(files, { timeout })
      }
    }

    for (const expect of step.expect ?? []) {
      const assertion = await runExpect(page, expect, timeoutMs)
      result.assertions.push(assertion)
      emit({
        event: 'assert', stepId: step.id, kind: assertion.kind, status: assertion.ok ? 'ok' : 'error',
        ...(assertion.selector === undefined ? {} : { selector: assertion.selector }),
        ...(assertion.expected === undefined ? {} : { expected: assertion.expected }),
        ...(assertion.actual === undefined ? {} : { actual: assertion.actual }),
        elapsed: assertion.elapsedMs,
        ...(assertion.error === undefined ? {} : { error: assertion.error }),
      })
      if (!assertion.ok) {
        result.error = `断言失败：${assertion.error ?? '未知原因'}`
        result.elapsedMs = Date.now() - startedAt
        return result
      }
    }
    result.ok = true
    result.elapsedMs = Date.now() - startedAt
    return result
  } catch (error) {
    result.error = String((error as Error)?.message ?? error).slice(0, 800)
    result.elapsedMs = Date.now() - startedAt
    return result
  } finally {
    emit({
      event: 'step', id: step.id, kind: step.kind, status: result.ok ? 'done' : 'error',
      elapsed: result.elapsedMs,
      ...(result.target === undefined ? {} : { target: result.target }),
      ...(result.error === undefined ? {} : { error: result.error }),
    })
  }
}

/** 目标解析：候选链里找第一个"当前唯一命中"的元素，找不到就给全部候选的失败说明。 */
async function resolveTarget(
  page: Page,
  step: UiStep,
  timeoutMs: number,
): Promise<{ locator: ReturnType<Page['locator']>; selector: string }> {
  const candidates = buildCandidates(step)
  if (candidates.length === 0) throw new Error(`${step.kind} 步骤没有 selector/candidates`)
  const deadline = Date.now() + timeoutMs
  const attempts: string[] = []
  for (const candidate of candidates) {
    const locator = page.locator(candidate)
    try {
      const count = await waitForPresent(locator, Math.max(1_000, Math.floor(timeoutMs / candidates.length)))
      if (count === 1) return { locator, selector: candidate }
      attempts.push(`${candidate}（命中 ${count} 个，需唯一）`)
    } catch (error) {
      attempts.push(`${candidate}（${String((error as Error)?.message ?? error).slice(0, 120)}）`)
    }
    if (Date.now() > deadline) break
  }
  throw new Error(`找不到唯一命中元素：${attempts.join('；')}`)
}

function buildCandidates(step: UiStep): string[] {
  const out: string[] = []
  if (step.selector !== undefined) out.push(step.selector)
  for (const candidate of step.candidates ?? []) {
    if (!out.includes(candidate)) out.push(candidate)
  }
  // 选择器全失效时的语义兜底（testid/id/name/aria/placeholder/role/文本）。
  for (const candidate of featureCandidates(step.features)) {
    if (!out.includes(candidate)) out.push(candidate)
  }
  // clickPoint.name：录制时记的控件名，最后一层文本兜底。
  const name = step.clickPoint?.name
  if (name !== undefined && name !== '') {
    const text = `text="${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    if (!out.includes(text)) out.push(text)
  }
  return out
}

/**
 * 轮询等待元素出现（命中数 ≥1 就返回；返回 0 = 超时）。
 *
 * 命中数 >1 说明选择器有歧义，交给调用方换下一个候选——不在这里等"变成 1"，
 * 那只会白等到超时。
 */
async function waitForPresent(locator: ReturnType<Page['locator']>, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const count = await locator.count().catch(() => 0)
    if (count >= 1) return count
    if (Date.now() >= deadline) return 0
    await sleep(80)
  }
}

/** 断言：轮询到步骤超时，失败时带实际值（截断）作为证据。 */
async function runExpect(page: Page, expect: UiExpect, timeoutMs: number): Promise<UiExpectResult> {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  const selector = expect.selector
  const expectedText = expect.equals === undefined ? expect.contains : String(expect.equals)
  const result: UiExpectResult = {
    kind: expect.kind,
    ...(selector === undefined ? {} : { selector }),
    ok: false,
    elapsedMs: 0,
    ...(expectedText === undefined ? {} : { expected: expectedText }),
  }
  const locator = selector === undefined ? undefined : page.locator(selector)
  let actual = ''
  for (;;) {
    try {
      const verdict = await evaluateExpect(page, expect, locator)
      actual = verdict.actual
      if (verdict.ok) {
        result.ok = true
        result.elapsedMs = Date.now() - startedAt
        return result
      }
    } catch (error) {
      actual = String((error as Error)?.message ?? error).slice(0, 300)
    }
    if (Date.now() >= deadline) break
    await sleep(80)
  }
  result.elapsedMs = Date.now() - startedAt
  result.actual = actual.slice(0, 500)
  result.error = expect.kind === 'url'
    ? `URL 期望 ${expect.equals === undefined ? `包含 ${String(expect.contains)}` : `等于 ${String(expect.equals)}`}，实际 ${actual.slice(0, 200)}`
    : expect.kind === 'count'
      ? `元素数期望 ${String(expect.equals)}，实际 ${actual}`
      : expect.kind === 'visible' || expect.kind === 'hidden'
        ? `元素可见性期望 ${expect.kind}，实际不满足（${selector ?? '?'}）`
        : `期望 ${expectedText ?? ''}，实际 ${actual.slice(0, 200)}`
  return result
}

async function evaluateExpect(
  page: Page,
  expect: UiExpect,
  locator: ReturnType<Page['locator']> | undefined,
): Promise<{ ok: boolean; actual: string }> {
  if (expect.kind === 'url') {
    const url = page.url()
    const ok = expect.equals !== undefined ? url === String(expect.equals) : url.includes(expect.contains ?? '')
    return { ok, actual: url }
  }
  if (locator === undefined) throw new Error('断言缺 selector')
  if (expect.kind === 'count') {
    const count = await locator.count()
    return { ok: count === Number(expect.equals), actual: String(count) }
  }
  if (expect.kind === 'visible') {
    const visible = await locator.first().isVisible().catch(() => false)
    return { ok: visible, actual: visible ? 'visible' : 'hidden' }
  }
  if (expect.kind === 'hidden') {
    const visible = await locator.first().isVisible().catch(() => false)
    return { ok: !visible, actual: visible ? 'visible' : 'hidden' }
  }
  if (expect.kind === 'value') {
    const value = await locator.first().inputValue().catch(() => '')
    const ok = expect.equals !== undefined ? value === String(expect.equals) : value.includes(expect.contains ?? '')
    return { ok, actual: value }
  }
  // text：取第一个命中元素的可见文本，压缩空白后比对
  const text = (await locator.first().innerText().catch(() => '')) || ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  const ok = expect.equals !== undefined ? normalized === String(expect.equals) : normalized.includes(expect.contains ?? '')
  return { ok, actual: normalized }
}

/** 成功证据：末态截图（写不进去不阻断结果，如实不带路径）。 */
async function captureSuccess(
  page: Page,
  dataRoot: string,
  runId: string,
): Promise<{ screenshot?: string }> {
  const target = join(uiRunDir(dataRoot, runId), 'success.png')
  try {
    await page.screenshot({ path: target, fullPage: false, timeout: 10_000 })
    return existsSync(target) ? { screenshot: join('ui-runs', runId, 'success.png') } : {}
  } catch {
    return {}
  }
}

/** 失败证据：截图 + 现场 HTML（写不进去不阻断结果，如实不带路径）。 */
async function captureFailure(
  page: Page,
  dataRoot: string,
  runId: string,
): Promise<{ screenshot?: string; dom?: string }> {
  const dir = uiRunDir(dataRoot, runId)
  const evidence: { screenshot?: string; dom?: string } = {}
  try {
    await page.screenshot({ path: join(dir, 'failure.png'), fullPage: false, timeout: 10_000 })
    evidence.screenshot = join('ui-runs', runId, 'failure.png')
  } catch {
    // 页面已崩/超时：没有截图也照常返回失败结果
  }
  try {
    const html = await page.content()
    writeFileSync(join(dir, 'failure.html'), html.slice(0, 2 * 1024 * 1024), 'utf8')
    evidence.dom = join('ui-runs', runId, 'failure.html')
  } catch {
    // 同上
  }
  return evidence
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
