/**
 * UI 回放留痕：`dataRoot/ui-runs/<runId>/`。
 *
 * 与造数/链运行同一套习惯（run.json 元数据 + events.ndjson 即写即落盘），但**目录分开**：
 * 造数运行按游戏规则折摘要（foldSummary 认 meta/step/terminal/result），UI 回放有自己
 * 的步骤/断言事件；混进同一个 runs 目录会让 `dataforge_status` 与面板运行列表互相误读。
 *
 * 截图与失败现场（failure.png / failure.html）落在同一目录，证据跟运行记录走。
 *
 * @module dsh-dataforge/uitest/run-store
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UiExpectKind, UiStepKind } from './schema.js'

/** UI 运行根：`dataRoot/ui-runs`。 */
export function uiRunsRoot(dataRoot: string): string {
  return join(dataRoot, 'ui-runs')
}

/** 单次运行目录。 */
export function uiRunDir(dataRoot: string, runId: string): string {
  return join(uiRunsRoot(dataRoot), runId)
}

/** 运行事件（ndjson 一行一条；ts 由写入器补）。 */
export type UiRunEvent =
  | {
    event: 'meta'
    site: string
    flow: string
    version: number
    startUrl: string
    dryRun?: boolean
  }
  | {
    event: 'step'
    id: string
    kind: UiStepKind
    status: 'start' | 'done' | 'error' | 'skipped'
    elapsed?: number
    target?: string
    error?: string
  }
  | {
    event: 'assert'
    stepId: string
    kind: UiExpectKind
    status: 'ok' | 'error'
    selector?: string
    expected?: string
    actual?: string
    elapsed?: number
    error?: string
  }
  | {
    event: 'terminal'
    success: boolean
    message?: string
    /** 失败截图（相对运行目录的文件名，如 failure.png）。 */
    screenshot?: string
    /** 失败现场 HTML。 */
    dom?: string
    elapsed?: number
  }

/** 写 run.json 的运行摘要。 */
export type UiRunRecord = {
  runId: string
  kind: 'ui-run'
  status: 'running' | 'success' | 'failed' | 'cancelled'
  site: string
  flow: string
  version: number
  startUrl: string
  startedAt: number
  finishedAt?: number
  /** 步骤总数 / 已完成步骤数（列表展示用）。 */
  totalSteps?: number
  stepsDone?: number
  failedStep?: string
  error?: string
  screenshot?: string
  [key: string]: unknown
}

/** 新建运行目录 + 初始 run.json；返回运行目录。 */
export function startUiRun(dataRoot: string, runId: string, meta: Record<string, unknown>): string {
  const dir = uiRunDir(dataRoot, runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run.json'), JSON.stringify({
    runId,
    kind: 'ui-run',
    status: 'running',
    startedAt: Date.now(),
    ...meta,
  }, null, 2), 'utf8')
  return dir
}

/** 追加事件（带 ts）。 */
export function appendUiRunEvent(dataRoot: string, runId: string, event: UiRunEvent): void {
  appendFileSync(join(uiRunDir(dataRoot, runId), 'events.ndjson'), `${JSON.stringify({ ...event, ts: Date.now() })}\n`, 'utf8')
}

/** 读 run.json；读不到/坏 JSON → undefined（调用方决定跳过还是报错）。 */
export function readUiRunRecord(dataRoot: string, runId: string): UiRunRecord | undefined {
  const path = join(uiRunDir(dataRoot, runId), 'run.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as UiRunRecord
  } catch {
    return undefined
  }
}

/** 读事件流；文件不存在 → 空数组。 */
export function readUiRunEvents(dataRoot: string, runId: string): Array<UiRunEvent & { ts?: number }> {
  const path = join(uiRunDir(dataRoot, runId), 'events.ndjson')
  if (!existsSync(path)) return []
  const events: Array<UiRunEvent & { ts?: number }> = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      events.push(JSON.parse(trimmed) as UiRunEvent & { ts?: number })
    } catch {
      // 坏行跳过（与 runs/store 同款）
    }
  }
  return events
}

/** 合并写 run.json（运行结束后写终态）。 */
export function finishUiRun(dataRoot: string, runId: string, patch: Partial<UiRunRecord>): void {
  const current = readUiRunRecord(dataRoot, runId)
  if (current === undefined) return
  writeFileSync(
    join(uiRunDir(dataRoot, runId), 'run.json'),
    JSON.stringify({ ...current, ...patch }, null, 2),
    'utf8',
  )
}

/** 列运行（最近在前）；坏目录跳过。 */
export function listUiRuns(dataRoot: string, limit = 20): UiRunRecord[] {
  const root = uiRunsRoot(dataRoot)
  if (!existsSync(root)) return []
  const dirs = readdirSync(root)
    .filter((entry) => {
      try {
        return statSync(join(root, entry)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
    .reverse()
    .slice(0, limit)
  const runs: UiRunRecord[] = []
  for (const dir of dirs) {
    const record = readUiRunRecord(dataRoot, dir)
    if (record !== undefined) runs.push(record)
  }
  return runs
}
