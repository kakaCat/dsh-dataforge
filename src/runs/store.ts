/**
 * 运行留痕：runId 落盘 + 事件追加 + 摘要折叠。
 *
 * 所有运行事件都写在 dataRoot/runs/<runId>/events.ndjson ——
 * 状态查询与重启后回看都只认这张盘（flush at write-time）。
 *
 * @module dsh-dataforge/runs/store
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BridgeEvent, RunSummary, JsonLike } from '../shared/types.js'

/** 落盘侧事件：桥事件 + 写入时刻（fold 的排序与时延都靠它）。 */
interface StoredEvent extends BridgeEvent {
  ts: number
}

export function runsRoot(dataRoot: string): string {
  return join(dataRoot, 'runs')
}

/** 新建 run 目录并写 run.json 元数据；返回 run 目录绝对路径。 */
export function startRunRecord(dataRoot: string, runId: string, meta: Record<string, unknown>): string {
  const dir = join(runsRoot(dataRoot), runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ runId, ...meta }, null, 2), 'utf8')
  return dir
}

/** 事件即写即落盘：后台 job 推流与 status 工具共用的唯一事实源。 */
export function appendEvent(dataRoot: string, runId: string, event: BridgeEvent): void {
  const stored: StoredEvent = { ...event, ts: Date.now() }
  appendFileSync(join(runsRoot(dataRoot), runId, 'events.ndjson'), `${JSON.stringify(stored)}\n`, 'utf8')
}

/** 读一份运行事件；不存在返回 undefined。 */
export function loadRunEvents(dataRoot: string, runId: string): BridgeEvent[] | undefined {
  const path = join(runsRoot(dataRoot), runId, 'events.ndjson')
  if (!existsSync(path)) return undefined
  const events: BridgeEvent[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed) as BridgeEvent)
    } catch {
      // 坏行跳过
    }
  }
  return events
}

/** 列已留痕的 runId（按目录名倒序，最近在前），上限 limit。 */
export function listRunIds(dataRoot: string, limit = 20): string[] {
  const root = runsRoot(dataRoot)
  if (!existsSync(root)) return []
  return readdirSync(root)
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
}

/**
 * 把事件流折叠成了 → 一张摘要（唯一投影规则）：
 * - meta 定 flow/steps/dryRun
 * - step.start 计入 lastStep；step.done 计入 stepsDone；step.error 计入 lastError
 * - terminal 贡献 message/success 兜底；result 是最终权威（businessData、success）
 * - 无 result 且无 terminal → running；overrideStatus 用于 cancel 场景标 killed
 */
export function foldSummary(runId: string, events: BridgeEvent[], overrideStatus?: RunSummary['status']): RunSummary {
  const meta = events.find((e) => e.event === 'meta')

  let stepsDone = 0
  let lastStepId: string | undefined
  let lastError: string | undefined
  let terminalMessage: string | undefined
  let terminalSuccess: boolean | undefined
  let result: BridgeEvent | undefined
  for (const e of events) {
    if (e.event === 'step') {
      if (e.status === 'start') lastStepId = e.id
      else if (e.status === 'done') stepsDone += 1
      else if (e.status === 'error') {
        lastError = e.error
        lastStepId = e.id
      }
    } else if (e.event === 'terminal') {
      terminalMessage = e.message
      terminalSuccess = e.success
    } else if (e.event === 'result') {
      result = e
    }
  }

  const success = result?.success ?? terminalSuccess
  let status: RunSummary['status']
  if (overrideStatus !== undefined) status = overrideStatus
  else if (result === undefined && terminalMessage === undefined) status = 'running'
  else if (success === true) status = 'completed'
  else status = 'failed'

  const firstTs = numOrUndefined((events[0] as StoredEvent | undefined)?.ts)
  const lastTs = numOrUndefined((events[events.length - 1] as StoredEvent | undefined)?.ts)

  const bizData = plainRecord(result?.businessData)

  return {
    runId,
    flow: typeof meta?.flow === 'string' ? meta.flow : '',
    flowName: typeof meta?.name === 'string' ? meta.name : '',
    startedAt: firstTs ?? 0,
    updatedAt: lastTs ?? firstTs ?? 0,
    status,
    dryRun: meta?.dryRun === true,
    totalSteps: Array.isArray(meta?.steps) ? meta.steps.length : 0,
    stepsDone,
    ...(lastStepId === undefined ? {} : { lastStepId }),
    ...(lastError === undefined ? {} : { lastError }),
    ...(success === undefined ? {} : { success }),
    ...(bizData === undefined ? {} : { businessData: bizData }),
    ...(terminalMessage === undefined ? {} : { message: terminalMessage }),
  }
}

function numOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** 非 plain object（数组/缺失）一律 undefined。 */
function plainRecord(value: unknown): Record<string, JsonLike> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, JsonLike>
  }
  return undefined
}
