/**
 * 共享浏览器引擎的回放器（seam 版 `runUiScript`）。
 *
 * 语义与 Playwright 版逐项对齐（步骤/断言/失败证据/run.json + events.ndjson），
 * 差别只在"动作怎么发出去"：这里走 seam 的 navigate/click/setValue/key/execute/screenshot。
 *
 * 目标解析：ui-script 的候选链是 Playwright 优先的；本引擎把 `text="…"` / `tag:has-text("…")`
 * 映射成 seam 的 text 定位，其余按 CSS。CSS 是页面内 `querySelectorAll`，不支持的选择器
 * 会被跳过验证（录制阶段已尽力保留候选）。
 *
 * 边界：`upload` 步骤在共享引擎上不支持（seam 没有文件选择通道）——失败信息会指回 Playwright 引擎。
 *
 * @module dsh-dataforge/uitest/engines/shared-run
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserSeam, SeamTarget } from '../browser-seam.js'
import { substituteInputs, type UiExpect, type UiScriptDoc, type UiStep } from '../schema.js'
import { highlightClickExpression } from '../highlight.js'
import { featureCandidates } from '../features.js'
import type { UiExpectResult, UiRunResult, UiStepResult } from '../run.js'
import type { UiRunEvent } from '../run-store.js'
import {
  appendUiRunEvent, finishUiRun, startUiRun, uiRunDir,
} from '../run-store.js'

export type SharedRunIo = {
  seam: BrowserSeam
  /** 当前对话 id：共享浏览器按对话挂右侧栏面板。 */
  owner: string
  dataRoot: string
  stepTimeoutMs: number
  /** 点击时画脉冲光圈（缺省 true）。 */
  highlightClicks?: boolean
  /** 回放结束后停留多久再关会话（毫秒）。 */
  holdMs?: number
}

const SUPPORTED_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Space',
])

/** 目标解析：优先 Playwright 候选，映射成 seam 的 css/text/xpath。 */
export function seamTargetsOf(step: UiStep): SeamTarget[] {
  const inputs = [step.selector, ...(step.candidates ?? [])].filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  const out: SeamTarget[] = []
  const seen = new Set<string>()
  const add = (target: SeamTarget): void => {
    const key = `${target.by}:${target.value}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(target)
  }
  for (const candidate of inputs) {
    if (candidate.startsWith('text=')) {
      add({ by: 'text', value: unquote(candidate.slice('text='.length)) })
      continue
    }
    if (candidate.startsWith('xpath=')) {
      add({ by: 'xpath', value: candidate.slice('xpath='.length) })
      continue
    }
    const hasText = /:has-text\("([\s\S]*)"\)\s*$/.exec(candidate)
    if (hasText !== null) {
      add({ by: 'text', value: unescapeQuoted(hasText[1] as string) })
      continue
    }
    add({ by: 'css', value: candidate })
  }
  for (const candidate of featureCandidates(step.features)) {
    if (candidate.startsWith('text=')) {
      add({ by: 'text', value: unquote(candidate.slice('text='.length)) })
      continue
    }
    const hasText = /:has-text\("([\s\S]*)"\)\s*$/.exec(candidate)
    if (hasText !== null) {
      add({ by: 'text', value: unescapeQuoted(hasText[1] as string) })
      continue
    }
    add({ by: 'css', value: candidate })
  }
  const name = step.clickPoint?.name
  if (name !== undefined && name !== '') {
    add({ by: 'text', value: name })
  }
  return out
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function unescapeQuoted(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/** CSS 候选（submit/focus 这类只能用页面内 querySelector 的动作用）。 */
function cssCandidatesOf(step: UiStep): string[] {
  return [step.selector, ...(step.candidates ?? [])]
    .filter((item): item is string => typeof item === 'string')
    .filter((item) => !item.startsWith('text=') && !item.startsWith('xpath=') && !item.includes(':has-text('))
}

export async function runUiScriptOnSeam(
  io: SharedRunIo,
  doc: UiScriptDoc,
  inputs: Record<string, string>,
  options: { slowMoMs?: number; highlightClicks?: boolean; holdMs?: number } = {},
): Promise<UiRunResult> {
  const slowMoMs = Math.min(Math.max(Math.floor(options.slowMoMs ?? 0), 0), 10_000)
  const holdMs = Math.min(Math.max(Math.floor(io.holdMs ?? options.holdMs ?? 0), 0), 30_000)
  const runId = `uir_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const startUrl = substituteInputs(doc.meta.startUrl, inputs)
  const startedAt = Date.now()
  let sessionId: string | undefined
  const stepResults: UiStepResult[] = []
  startUiRun(io.dataRoot, runId, {
    site: doc.meta.site,
    flow: doc.meta.flow,
    version: doc.meta.version,
    startUrl,
    engine: 'shared',
    totalSteps: doc.steps.length,
  })
  const emit = (event: UiRunEvent): void => appendUiRunEvent(io.dataRoot, runId, event)
  emit({ event: 'meta', site: doc.meta.site, flow: doc.meta.flow, version: doc.meta.version, startUrl })

  try {
    sessionId = await io.seam.open(io.owner)
    await io.seam.navigate(sessionId, { url: startUrl })
    await io.seam.waitFor(sessionId, { url: startUrl, loaded: true, timeoutMs: io.stepTimeoutMs }).catch(() => undefined)

    for (const step of doc.steps) {
      if (slowMoMs > 0) await sleep(slowMoMs)
      const result = await runStep(io, sessionId, step, inputs, emit, doc)
      stepResults.push(result)
      if (!result.ok) {
        const evidence = await captureFailure(io, sessionId, runId)
        const elapsedMs = Date.now() - startedAt
        emit({
          event: 'terminal', success: false, message: result.error,
          ...(evidence.screenshot === undefined ? {} : { screenshot: evidence.screenshot }),
          ...(evidence.dom === undefined ? {} : { dom: evidence.dom }),
          elapsed: elapsedMs,
        })
        finishUiRun(io.dataRoot, runId, {
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
          cookiesApplied: 0,
          notice: '共享浏览器引擎（dsh-builtin-browser seam）',
        }
      }
    }

    const elapsedMs = Date.now() - startedAt
    emit({ event: 'terminal', success: true, message: `全部 ${doc.steps.length} 步通过`, elapsed: elapsedMs })
    finishUiRun(io.dataRoot, runId, {
      status: 'success',
      finishedAt: Date.now(),
      stepsDone: stepResults.length,
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
      elapsedMs,
      cookiesApplied: 0,
      notice: '共享浏览器引擎（dsh-builtin-browser seam）',
    }
  } catch (error) {
    const message = String((error as Error)?.message ?? error).slice(0, 1_000)
    const elapsedMs = Date.now() - startedAt
    emit({ event: 'terminal', success: false, message, elapsed: elapsedMs })
    finishUiRun(io.dataRoot, runId, { status: 'failed', finishedAt: Date.now(), stepsDone: stepResults.length, error: message, elapsedMs })
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
      cookiesApplied: 0,
      notice: '共享浏览器引擎（dsh-builtin-browser seam）',
    }
  } finally {
    // 末尾停留：最后一步/动画先让人看到，再关闭共享浏览器会话。
    if (sessionId !== undefined && holdMs > 0) await sleep(holdMs)
    if (sessionId !== undefined) await io.seam.close(sessionId).catch(() => undefined)
  }
}

async function runStep(
  io: SharedRunIo,
  sessionId: string,
  step: UiStep,
  inputs: Record<string, string>,
  emit: (event: UiRunEvent) => void,
  doc: UiScriptDoc,
): Promise<UiStepResult> {
  const startedAt = Date.now()
  const targetText = step.selector ?? step.candidates?.[0] ?? step.url
  const result: UiStepResult = { id: step.id, kind: step.kind, ok: false, elapsedMs: 0, assertions: [] }
  emit({ event: 'step', id: step.id, kind: step.kind, status: 'start', ...(targetText === undefined ? {} : { target: targetText }) })
  try {
    if (step.kind === 'wait') {
      await sleep(Math.min(step.ms ?? 0, io.stepTimeoutMs))
    } else if (step.kind === 'goto') {
      const url = substituteInputs(step.url ?? '', inputs)
      await io.seam.navigate(sessionId, { url })
      await io.seam.waitFor(sessionId, { url, loaded: true, timeoutMs: io.stepTimeoutMs }).catch(() => undefined)
    } else if (step.kind === 'upload') {
      throw new Error('共享浏览器引擎不支持 upload 步骤（seam 无文件选择通道）：请把该脚本切回 Playwright 引擎，或手写上传步骤')
    } else if (step.kind === 'press' && seamTargetsOf(step).length === 0) {
      const key = substituteInputs(step.key ?? '', inputs)
      assertKey(key)
      await io.seam.key(sessionId, { key })
    } else if (step.kind === 'scroll') {
      // 两种形态与 Playwright 引擎同口径：selector = 滚到元素；否则 deltaY 窗口滚动。
      if (step.selector !== undefined) {
        await io.seam.scroll(sessionId, { selector: step.selector })
      } else {
        await io.seam.scroll(sessionId, { deltaY: step.deltaY ?? 0 })
      }
    } else if (step.kind === 'submit') {
      const selector = cssCandidatesOf(step)[0]
      if (selector === undefined) throw new Error('submit 步骤没有 CSS selector（共享引擎只能用 CSS 触发表单提交）')
      const submitted = await io.seam.execute(sessionId, {
        script: `return (function (selector) {
          const form = document.querySelector(selector)
          if (!form) return 'not-found'
          if (typeof form.requestSubmit === 'function') { form.requestSubmit(); return 'ok' }
          if (typeof form.submit === 'function') { form.submit(); return 'submitted' }
          return 'not-a-form'
        })(arguments[0])`,
        args: [selector],
        timeoutMs: io.stepTimeoutMs,
      })
      if (!submitted.ok) throw new Error(submitted.exception)
      if (submitted.value !== 'ok' && submitted.value !== 'submitted') throw new Error(`提交失败：${String(submitted.value)}`)
    } else {
      await performTargetedAction(io, sessionId, step, inputs, result)
    }

    for (const expect of step.expect ?? []) {
      const assertion = await runExpect(io, sessionId, expect)
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
    void doc
    emit({
      event: 'step', id: step.id, kind: step.kind, status: result.ok ? 'done' : 'error',
      elapsed: result.elapsedMs,
      ...(result.target === undefined ? {} : { target: result.target }),
      ...(result.error === undefined ? {} : { error: result.error }),
    })
  }
}

async function performTargetedAction(
  io: SharedRunIo,
  sessionId: string,
  step: UiStep,
  inputs: Record<string, string>,
  result: UiStepResult,
): Promise<void> {
  const targets = seamTargetsOf(step)
  if (targets.length === 0) throw new Error(`${step.kind} 步骤没有 selector/candidates`)
  const attempts: string[] = []
  const attemptAll = async (): Promise<boolean> => {
    for (const target of targets) {
      try {
        if (step.kind === 'click') {
          await clickTarget(io, sessionId, step, target)
        } else if (step.kind === 'fill') {
          await io.seam.setValue(sessionId, { target, value: substituteInputs(step.value ?? '', inputs) })
        } else if (step.kind === 'select') {
          await io.seam.selectOption(sessionId, { target, optionValue: substituteInputs(step.value ?? '', inputs) })
        } else if (step.kind === 'press') {
          await focusTarget(io, sessionId, target)
          const key = substituteInputs(step.key ?? '', inputs)
          assertKey(key)
          await io.seam.key(sessionId, { key })
        } else {
          throw new Error(`共享引擎不支持步骤类型：${step.kind}`)
        }
        result.target = target.by === 'css' ? target.value : `${target.by}=${target.value}`
        return true
      } catch (error) {
        attempts.push(`${target.by}:${target.value}（${String((error as Error)?.message ?? error).slice(0, 120)}）`)
      }
    }
    return false
  }
  if (await attemptAll()) return
  // 录制标注了 at（该步所在页面）而当前页不同：导航过去再试一次。
  // 典型场景：上一步点击没触发跳转（canvas 图表），或脚本从旧版本回放时页面不对。
  const at = typeof step.at === 'string' && /^https?:\/\//.test(step.at) ? step.at : undefined
  if (at !== undefined) {
    const current = await activeUrl(io, sessionId)
    if (current !== at) {
      try {
        await io.seam.navigate(sessionId, { url: at })
        await io.seam.waitFor(sessionId, { loaded: true, timeoutMs: 15_000 }).catch(() => undefined)
        attempts.push(`重新导航到录制页 ${at}`)
        if (await attemptAll()) return
      } catch (error) {
        attempts.push(`导航到 ${at} 失败（${String((error as Error)?.message ?? error).slice(0, 120)}）`)
      }
    }
  }
  throw new Error(`找不到可用目标：${attempts.join('；')}`)
}

async function activeUrl(io: SharedRunIo, sessionId: string): Promise<string> {
  const tabs = await io.seam.listTabs(sessionId).catch(() => [])
  const active = tabs.find((tab) => tab.active) ?? tabs[0]
  return active?.url ?? ''
}

/**
 * 点击：canvas 图表必须按坐标点（元素中心落在空白处不会触发图表交互）；
 * 普通元素先走语义点击，失败且录了坐标时按坐标兜底。点完等一小段导航落定。
 */
async function clickTarget(io: SharedRunIo, sessionId: string, step: UiStep, target: SeamTarget): Promise<void> {
  const point = step.clickPoint
  const info = target.by === 'css' ? await elementInfo(io, sessionId, target.value) : undefined
  if (point !== undefined) {
    // canvas 只能按坐标；普通元素仍优先语义点击（元素中心由页面自己算）。
    const tagMatches = info !== undefined && (step.features?.tag === undefined || info.tag.toLowerCase() === step.features.tag.toLowerCase())
    if (info !== undefined && info.tag === 'CANVAS' && tagMatches) {
      await clickAt(io, sessionId, point, info)
      await settleAfterClick(io, sessionId)
      return
    }
    // 选择器失效/元素换了：用特征找回，再按"新元素 rect"决定用录制坐标还是重算。
    if (info === undefined || !tagMatches) {
      const resolved = await featureInfo(io, sessionId, step.features)
      if (resolved !== undefined) {
        await clickAt(io, sessionId, point, resolved)
        await settleAfterClick(io, sessionId)
        return
      }
    }
  }
  if (info !== undefined && io.highlightClicks !== false) {
    await highlightAt(io, sessionId, info.x + info.w / 2, info.y + info.h / 2)
  }
  try {
    await io.seam.click(sessionId, { target })
  } catch (error) {
    if (point === undefined) throw error
    await clickAt(io, sessionId, point, info)
  }
  await settleAfterClick(io, sessionId)
}

/**
 * 用录制特征在当前页面找回元素并返回最新几何。
 *
 * 只用于"选择器失效但录了落点"的场景：分数最高且至少命中一个稳定属性才采用，
 * 避免只按 tag 乱点。
 */
async function featureInfo(io: SharedRunIo, sessionId: string, features: UiStep['features']): Promise<ElementInfo | undefined> {
  if (features === undefined) return undefined
  const result = await io.seam.execute(sessionId, {
    script: `return (function (f) {
      const norm = (value) => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim()
      let nodes = []
      try { nodes = document.querySelectorAll(f.tag || '*') } catch (err) { nodes = [] }
      let best = null
      let bestScore = 0
      const canvases = document.querySelectorAll('canvas')
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i]
        let score = 0
        if (f.id && el.id === f.id) score += 8
        if (f.testId) {
          const attrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa']
          for (let a = 0; a < attrs.length; a += 1) { if (el.getAttribute(attrs[a]) === f.testId) { score += 8; break } }
        }
        if (f.name && el.getAttribute('name') === f.name) score += 4
        if (f.ariaLabel && el.getAttribute('aria-label') === f.ariaLabel) score += 6
        if (f.placeholder && el.getAttribute('placeholder') === f.placeholder) score += 6
        if (f.role && el.getAttribute('role') === f.role) score += 2
        if (f.title && el.getAttribute('title') === f.title) score += 2
        if (f.alt && el.getAttribute('alt') === f.alt) score += 2
        if (f.text && norm(el.innerText || el.textContent).indexOf(f.text) >= 0) score += 3
        if (f.canvasIndex !== undefined && el.tagName === 'CANVAS') {
          const index = Array.prototype.indexOf.call(canvases, el)
          if (index === f.canvasIndex) score += 6
        }
        if (score > bestScore) { bestScore = score; best = el }
      }
      if (!best) return null
      const r = best.getBoundingClientRect()
      return { tag: best.tagName, x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }
    })(arguments[0])`,
    args: [features],
    timeoutMs: io.stepTimeoutMs,
  }).catch(() => undefined)
  if (result === undefined || !result.ok || result.value === null || typeof result.value !== 'object') return undefined
  return readElementInfo(result.value)
}

function readElementInfo(value: unknown): ElementInfo | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const num = (key: string): number | undefined => (typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] as number : undefined)
  const tag = typeof record['tag'] === 'string' ? record['tag'] : undefined
  const x = num('x')
  const y = num('y')
  const w = num('w')
  const h = num('h')
  const vw = num('vw')
  const vh = num('vh')
  if (tag === undefined || x === undefined || y === undefined || w === undefined || h === undefined || vw === undefined || vh === undefined) return undefined
  return { tag, x, y, w, h, vw, vh }
}

type ElementInfo = { tag: string; x: number; y: number; w: number; h: number; vw: number; vh: number }

async function elementInfo(io: SharedRunIo, sessionId: string, selector: string): Promise<ElementInfo | undefined> {
  const result = await io.seam.execute(sessionId, {
    script: `return (function (selector) {
      const el = document.querySelector(selector)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { tag: el.tagName, x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }
    })(arguments[0])`,
    args: [selector],
    timeoutMs: io.stepTimeoutMs,
  }).catch(() => undefined)
  if (result === undefined || !result.ok) return undefined
  return readElementInfo(result.value)
}

/** 元素内比例坐标 → 视口坐标；元素找不到时按录制视口等比缩放兜底。 */
async function clickAt(
  io: SharedRunIo,
  sessionId: string,
  point: { fx: number; fy: number; x: number; y: number; vw: number; vh: number; bx?: number; by?: number; bw?: number; bh?: number },
  info: ElementInfo | undefined,
): Promise<void> {
  let x: number
  let y: number
  if (info !== undefined && sameBox(point, info)) {
    // 特征还在且位置/尺寸没变：直接用录制坐标，不再重算。
    x = point.x
    y = point.y
  } else if (info !== undefined && info.w > 0 && info.h > 0) {
    x = info.x + point.fx * info.w
    y = info.y + point.fy * info.h
  } else {
    const viewport = await io.seam.execute(sessionId, {
      script: 'return { vw: window.innerWidth, vh: window.innerHeight }',
      timeoutMs: io.stepTimeoutMs,
    }).catch(() => undefined)
    const raw = viewport !== undefined && viewport.ok && typeof viewport.value === 'object' && viewport.value !== null
      ? viewport.value as Record<string, unknown>
      : {}
    const vw = typeof raw['vw'] === 'number' && raw['vw'] > 0 ? raw['vw'] : point.vw
    const vh = typeof raw['vh'] === 'number' && raw['vh'] > 0 ? raw['vh'] : point.vh
    x = vw > 0 && point.vw > 0 ? point.x * (vw / point.vw) : point.x
    y = vh > 0 && point.vh > 0 ? point.y * (vh / point.vh) : point.y
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('点击坐标无效')
  if (io.highlightClicks !== false) await highlightAt(io, sessionId, x, y)
  await io.seam.click(sessionId, { x: Math.round(x), y: Math.round(y) })
}

function sameBox(
  point: { bx?: number; by?: number; bw?: number; bh?: number },
  info: ElementInfo,
): boolean {
  if (point.bx === undefined || point.by === undefined || point.bw === undefined || point.bh === undefined) return false
  const near = (left: number, right: number): boolean => Math.abs(left - right) <= 1.5
  return near(point.bx, info.x) && near(point.by, info.y) && near(point.bw, info.w) && near(point.bh, info.h)
}

/** 点击提示：注入脉冲光圈（失败不影响点击）。 */
async function highlightAt(io: SharedRunIo, sessionId: string, x: number, y: number): Promise<void> {
  await io.seam.execute(sessionId, {
    script: highlightClickExpression(x, y),
    timeoutMs: 2_000,
  }).catch(() => undefined)
}

/** 点击后等页面加载落定（不阻塞失败；导航由下一步的元素等待兜底）。 */
async function settleAfterClick(io: SharedRunIo, sessionId: string): Promise<void> {
  await io.seam.waitFor(sessionId, { loaded: true, timeoutMs: 1_500 }).catch(() => undefined)
}

function assertKey(key: string): void {
  if (!SUPPORTED_KEYS.has(key)) throw new Error(`共享浏览器引擎不支持按键 ${key}（支持：${[...SUPPORTED_KEYS].join('/')}）`)
}

async function focusTarget(io: SharedRunIo, sessionId: string, target: SeamTarget): Promise<void> {
  if (target.by !== 'css') return
  await io.seam.execute(sessionId, {
    script: 'return (function (selector) { const el = document.querySelector(selector); if (el && typeof el.focus === "function") { el.focus(); return true } return false })(arguments[0])',
    args: [target.value],
    timeoutMs: io.stepTimeoutMs,
  }).catch(() => undefined)
}

/** 页面内断言求值（同一段脚本同时支持 CSS / text= / *:has-text）。 */
const EVALUATE_EXPECT = `return (function (kind, selector, equals, contains) {
  const normalize = (value) => String(value == null ? '' : value).replace(/\\s+/g, ' ').trim()
  const visible = (el) => {
    if (!el) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = window.getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  const matches = (sel) => {
    if (sel.startsWith('text="') && sel.endsWith('"')) {
      const text = sel.slice(6, -1)
      return Array.from(document.querySelectorAll('*')).filter((el) => normalize(el.innerText || el.textContent).includes(text))
    }
    const m = /:has-text\\("([\\s\\S]*)"\\)\\s*$/.exec(sel)
    if (m) {
      const tag = sel.slice(0, m.index).trim() || '*'
      return Array.from(document.querySelectorAll(tag)).filter((el) => normalize(el.innerText || el.textContent).includes(m[1]))
    }
    try { return Array.from(document.querySelectorAll(sel)) } catch (err) { return [] }
  }
  if (kind === 'url') {
    const url = location.href
    return { ok: equals != null && equals !== '' ? url === String(equals) : url.includes(String(contains)), actual: url }
  }
  if (kind === 'count') {
    const count = matches(selector).length
    return { ok: count === Number(equals), actual: String(count) }
  }
  const el = matches(selector)[0]
  if (kind === 'visible') return { ok: visible(el), actual: visible(el) ? 'visible' : 'hidden' }
  if (kind === 'hidden') return { ok: !visible(el), actual: visible(el) ? 'visible' : 'hidden' }
  if (kind === 'value') {
    const value = el ? String(el.value == null ? '' : el.value) : ''
    return { ok: equals != null ? value === String(equals) : value.includes(String(contains)), actual: value }
  }
  const text = el ? normalize(el.innerText || el.textContent) : ''
  return { ok: equals != null ? text === String(equals) : text.includes(String(contains)), actual: text }
})(arguments[0], arguments[1], arguments[2], arguments[3])`

async function runExpect(io: SharedRunIo, sessionId: string, expect: UiExpect): Promise<UiExpectResult> {
  const startedAt = Date.now()
  const deadline = startedAt + io.stepTimeoutMs
  const selector = expect.selector
  const expected = expect.equals === undefined ? expect.contains : String(expect.equals)
  const result: UiExpectResult = {
    kind: expect.kind,
    ...(selector === undefined ? {} : { selector }),
    ok: false,
    elapsedMs: 0,
    ...(expected === undefined ? {} : { expected }),
  }
  let actual = ''
  for (;;) {
    const evaluated = await io.seam.execute(sessionId, {
      script: EVALUATE_EXPECT,
      args: [expect.kind, selector ?? '', expect.equals ?? null, expect.contains ?? null],
      timeoutMs: io.stepTimeoutMs,
    }).catch((error: unknown) => ({ ok: false as const, exception: String((error as Error)?.message ?? error) }))
    if (evaluated.ok) {
      const value = evaluated.value as { ok?: unknown; actual?: unknown } | null
      actual = value !== null && typeof value === 'object' ? String(value.actual ?? '') : ''
      if (value !== null && typeof value === 'object' && value.ok === true) {
        result.ok = true
        result.elapsedMs = Date.now() - startedAt
        return result
      }
    } else {
      actual = evaluated.exception
    }
    if (Date.now() >= deadline) break
    await sleep(120)
  }
  result.elapsedMs = Date.now() - startedAt
  result.actual = actual.slice(0, 500)
  result.error = expect.kind === 'url'
    ? `URL 期望 ${expect.equals === undefined ? `包含 ${String(expect.contains)}` : `等于 ${String(expect.equals)}`}，实际 ${actual.slice(0, 200)}`
    : expect.kind === 'count'
      ? `元素数期望 ${String(expect.equals)}，实际 ${actual}`
      : expect.kind === 'visible' || expect.kind === 'hidden'
        ? `元素可见性期望 ${expect.kind}，实际不满足（${selector ?? '?'}）`
        : `期望 ${expected ?? ''}，实际 ${actual.slice(0, 200)}`
  return result
}

async function captureFailure(
  io: SharedRunIo,
  sessionId: string,
  runId: string,
): Promise<{ screenshot?: string; dom?: string }> {
  const dir = uiRunDir(io.dataRoot, runId)
  const evidence: { screenshot?: string; dom?: string } = {}
  try {
    const shot = await io.seam.screenshot(sessionId, { format: 'png' })
    const payload = shot.dataUrl.split(',')[1] ?? ''
    writeFileSync(join(dir, 'failure.png'), Buffer.from(payload, 'base64'))
    evidence.screenshot = join('ui-runs', runId, 'failure.png')
  } catch {
    // 页面崩了/截图失败：不阻断失败结果
  }
  try {
    const dom = await io.seam.execute(sessionId, { script: 'return document.documentElement ? document.documentElement.outerHTML : ""', timeoutMs: io.stepTimeoutMs })
    const html = dom.ok ? String(dom.value ?? '') : ''
    if (html !== '') {
      writeFileSync(join(dir, 'failure.html'), html.slice(0, 2 * 1024 * 1024), 'utf8')
      evidence.dom = join('ui-runs', runId, 'failure.html')
    }
  } catch {
    // 同上
  }
  return evidence
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
