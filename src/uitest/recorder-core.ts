/**
 * 录制核心：原始 DOM 事件 → 去重/脱敏后的步骤与统计。
 *
 * 从 `UiRecorder` 里抽出来的原因：共享浏览器引擎（seam）没有 Playwright Page，
 * 但它拿到的是同一批「事件载荷」，所以核心逻辑必须与传输方式无关：
 *   - Playwright：binding 回调 → `RecorderCore.ingest()`
 *   - seam：页面内的 `__dfUiSeamQueue` → 轮询 drain → `RecorderCore.ingest()`
 * 两边共用去重规则、密码/上传计数、步骤生成与回执文案，避免两套录制语义漂移。
 *
 * 候选唯一性校验由调用方注入（Playwright 用 locator；seam 用 page 内 querySelectorAll），
 * 核心只负责"把校验后的候选写进步骤"。
 *
 * @module dsh-dataforge/uitest/recorder-core
 */
import type { UiClickPoint, UiStep } from './schema.js'
import { normalizeFeatures } from './features.js'
import type { UiRecordingResult } from './recorder.js'

/** 页面回传的原始载荷（字段全部弱类型，核心再收口）。 */
export type RawRecordPayload = {
  kind?: unknown
  tag?: unknown
  candidates?: unknown
  value?: unknown
  key?: unknown
  isSubmitter?: unknown
  submitter?: unknown
  at?: unknown
  clickPoint?: unknown
  features?: unknown
}

/** 一条原始步骤（finalize 前的内部形状）。 */
type RawStep = {
  kind?: unknown
  candidates?: unknown
  value?: unknown
  key?: unknown
  isSubmitter?: unknown
  at?: unknown
}

/** 候选唯一性校验缝：返回"当前页面仍唯一命中"的候选（保序）。 */
export type CandidateValidator = (candidates: string[]) => Promise<string[]>

export class RecorderCore {
  private raw: RawStep[] = []
  private seenAt: number[] = []
  private skippedSecrets = 0
  private skippedUploads = 0
  private lastSecretAt = 0
  private singleCandidateSteps = 0
  private readonly now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }

  /** 原始载荷 → 步骤（去重在这里做，页面脚本保持无状态）。 */
  ingest(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) return
    const record = payload as RawRecordPayload
    const kind = typeof record.kind === 'string' ? record.kind : ''
    if (kind === 'skip-secret') {
      // 密码框每个按键都会触发 input：按「一次密码输入」计数，不是按事件数。
      const now = this.now()
      if (now - this.lastSecretAt > 2_000) this.skippedSecrets += 1
      this.lastSecretAt = now
      return
    }
    const candidates = normalizeCandidateList(record.candidates)
    const at = typeof record.at === 'string' && record.at.length > 0 ? record.at.slice(0, 2_000) : undefined
    const now = this.now()

    if (kind === 'fill') {
      const value = typeof record.value === 'string' ? record.value : ''
      if (candidates.length === 0) return
      const last = this.raw[this.raw.length - 1]
      // 同一元素的连续输入合并成最后一次的值（fill 回放是整体赋值，不需要按键级别回放）。
      if (last !== undefined && last.kind === 'fill' && sameCandidates(normalizeCandidateList(last.candidates), candidates)) {
        last.value = value
        last.at = at
        this.seenAt[this.seenAt.length - 1] = now
        return
      }
      const fillFeatures = featuresFor(record)
      this.push({ kind: 'fill', candidates, value, ...(fillFeatures === undefined ? {} : { features: fillFeatures }), ...(at === undefined ? {} : { at }) }, now)
      return
    }

    if (kind === 'click') {
      if (candidates.length === 0) return
      const clickPoint = normalizeClickPoint(record.clickPoint)
      const features = normalizeFeatures(record.features)
      const last = this.raw[this.raw.length - 1]
      if (last !== undefined && last.kind === 'click' && sameCandidates(normalizeCandidateList(last.candidates), candidates)
        && now - (this.seenAt[this.seenAt.length - 1] ?? 0) < 500) {
        return // 同一次点击的双事件/双击抖动
      }
      this.push({
        kind: 'click',
        candidates,
        isSubmitter: record.isSubmitter === true,
        ...(clickPoint === undefined ? {} : { clickPoint }),
        ...(features === undefined ? {} : { features }),
        ...(at === undefined ? {} : { at }),
      }, now)
      return
    }

    if (kind === 'select') {
      const value = typeof record.value === 'string' ? record.value : ''
      if (candidates.length === 0) return
      const selectFeatures = featuresFor(record)
      this.push({ kind: 'select', candidates, value, ...(selectFeatures === undefined ? {} : { features: selectFeatures }), ...(at === undefined ? {} : { at }) }, now)
      return
    }

    if (kind === 'submit') {
      // 点提交按钮已经录成 click（回放 click 会自然触发 submit）；这里只处理
      // Enter/JS 触发的提交，避免同一次提交录成两步。
      const last = this.raw[this.raw.length - 1]
      const lastAt = this.seenAt[this.seenAt.length - 1] ?? 0
      if (last !== undefined && last.kind === 'click' && last.isSubmitter === true && now - lastAt < 1_500) return
      const submitter = normalizeCandidateList(record.submitter)
      this.push({
        kind: 'submit',
        candidates: candidates.length > 0 ? candidates : submitter,
        ...(at === undefined ? {} : { at }),
      }, now)
      return
    }

    if (kind === 'press') {
      const key = typeof record.key === 'string' ? record.key : ''
      if (key === '') return
      const last = this.raw[this.raw.length - 1]
      if (last !== undefined && last.kind === 'press' && last.key === key
        && now - (this.seenAt[this.seenAt.length - 1] ?? 0) < 500) {
        return
      }
      this.push({ kind: 'press', key, candidates, ...(at === undefined ? {} : { at }) }, now)
    }
  }

  private push(payload: RawStep, now: number): void {
    this.raw.push(payload)
    this.seenAt.push(now)
  }

  /** 文件选择只计数（浏览器不暴露本地路径）。 */
  recordUploadSkip(): void {
    this.skippedUploads += 1
  }

  /** 已收到的原始事件数（诊断用）。 */
  get eventCount(): number {
    return this.raw.length
  }

  /** 原始事件 → 步骤（候选校验由调用方注入，核心不依赖浏览器实现）。 */
  async finalize(validate: CandidateValidator): Promise<UiStep[]> {
    const steps: UiStep[] = []
    let singleCandidate = 0
    for (const raw of this.raw) {
      const kind = raw.kind
      if (kind !== 'click' && kind !== 'fill' && kind !== 'select' && kind !== 'submit' && kind !== 'press') continue
      const candidates = normalizeCandidateList(raw.candidates)
      const checked = await validate(candidates)
      if (checked.length === 1) singleCandidate += 1
      const step: UiStep = {
        id: `s${steps.length + 1}`,
        kind,
        ...(checked.length > 0 ? { selector: checked[0] } : {}),
        ...(checked.length > 0 ? { candidates: checked } : {}),
      }
      if (kind === 'fill' || kind === 'select') step.value = typeof raw.value === 'string' ? raw.value : ''
      if (kind === 'press') step.key = typeof raw.key === 'string' ? raw.key : ''
      if (typeof raw.at === 'string' && raw.at.length > 0) step.at = raw.at
      steps.push(step)
    }
    this.singleCandidateSteps = singleCandidate
    return steps
  }

  /** 生成录制回执（文案与 Playwright 路径共用）。 */
  result(steps: UiStep[], meta: { startUrl: string; viewport: { width: number; height: number } }): UiRecordingResult {
    const notices: string[] = []
    if (this.skippedSecrets > 0) notices.push(`跳过 ${this.skippedSecrets} 次密码输入（凭证不入脚本，回放请带 cookie）`)
    if (this.skippedUploads > 0) notices.push(`跳过 ${this.skippedUploads} 次文件选择（浏览器不暴露本地路径，upload 步骤请手写）`)
    if (this.raw.length > 0 && steps.length === 0) notices.push('没有录到可回放的步骤（可能只做了聚焦/滚动）')
    return {
      startUrl: meta.startUrl,
      viewport: meta.viewport,
      steps,
      skippedSecrets: this.skippedSecrets,
      skippedUploads: this.skippedUploads,
      singleCandidateSteps: this.singleCandidateSteps,
      totalSteps: steps.length,
      ...(notices.length === 0 ? {} : { notice: notices.join('；') }),
    }
  }
}

function featuresFor(record: RawRecordPayload): ReturnType<typeof normalizeFeatures> {
  return normalizeFeatures(record.features)
}

/** 收口点击坐标：数字/范围不合法就丢弃（旧客户端没有该字段时不影响录制）。 */
function normalizeClickPoint(raw: unknown): UiClickPoint | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const num = (key: string): number | undefined => {
    const item = value[key]
    return typeof item === 'number' && Number.isFinite(item) ? item : undefined
  }
  const fx = num('fx')
  const fy = num('fy')
  const x = num('x')
  const y = num('y')
  const vw = num('vw')
  const vh = num('vh')
  if (fx === undefined || fy === undefined || x === undefined || y === undefined) return undefined
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || vw === undefined || vh === undefined || vw <= 0 || vh <= 0) return undefined
  const tag = typeof value['tag'] === 'string' && value['tag'] !== '' ? value['tag'] : undefined
  const bbox = ['bx', 'by', 'bw', 'bh'].map((key) => num(key))
  const hasBox = bbox.every((item) => item !== undefined)
  const name = typeof value['name'] === 'string' && value['name'].trim() !== '' ? value['name'].trim().slice(0, 120) : undefined
  return {
    fx, fy, x, y, vw, vh,
    ...(tag === undefined ? {} : { tag }),
    ...(hasBox ? { bx: bbox[0] as number, by: bbox[1] as number, bw: bbox[2] as number, bh: bbox[3] as number } : {}),
    ...(name === undefined ? {} : { name }),
  }
}

/** 候选列表清洗：去非字符串/空/重复/超长，最多 8 条。 */
export function normalizeCandidateList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const candidate = item.trim()
    if (candidate.length === 0 || candidate.length > 2_000) continue
    if (out.includes(candidate)) continue
    out.push(candidate)
    if (out.length >= 8) break
  }
  return out
}

/** 两个候选链是否指向同一元素（以首候选为准——录制器按优先级排序）。 */
function sameCandidates(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false
  return left[0] === right[0]
}
