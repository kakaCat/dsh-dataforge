/**
 * application 层：数据面装配 + 三道闸判据 + 运行编排。
 *
 * 工具壳（tools.ts）只做参数声明与回执渲染；所有判定在这里，保持纯本地逻辑、可单测。
 *
 * @module dsh-dataforge/application
 */
import { probePython, resolveEngineLocators, spawnBridge, buildBridgeArgv, lastResult } from './engine/bridge.js'
import { discoverFlows, pickFlow, type DiscoveredFlows, type PackRoots } from './flows/discover.js'
import type { Config } from './config.js'
import type { FlowField, FlowInfo, BridgeEvent, RunSummary } from './shared/types.js'
import { foldSummary, appendEvent, startRunRecord, loadRunEvents, listRunIds } from './runs/store.js'

// ────────────────────────────────────────────────
// 依赖装配（工具壳只认这个口；全部可注入，测试零 monkeypatch）
// ────────────────────────────────────────────────

/** dsh ctx.jobs 的最小结构投影（对齐 tool-workflow 用法；服务缺席 = unknown/undefined）。 */
interface JobsLike {
  start?: (spec: JobsSpec) => unknown
}

interface JobsSpec {
  kind: string
  label: string
  owner?: string
  outputLimitBytes?: number
  run: (job: JobsJobHandle) => JobsHooks
}

interface JobsJobHandle {
  readonly id: string
  append(text: string, options?: { channel?: 'stdout' | 'stderr' | 'log' }): void
  updateProgress(line: string): void
}

interface JobsHooks {
  cancel: (reason?: string) => void
  done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string; result?: string }>
}

export interface DataforgeInit {
  config: Required<Config>
  /** ctx.jobs 服务（可能 undefined —— 诚实降级前台）。 */
  resolveJobs: () => unknown
  /** 工作区根解析（工作区流程包锚点）。 */
  resolveWorkspaceRoot: (exec: unknown) => Promise<string | undefined>
}

export interface DataforgeDeps extends DataforgeInit {
  discover: (exec: unknown) => Promise<DiscoveredFlows>
  /** 统一入口：返回后台 job 信息，或前台执行摘要（degraded），或闸卡。 */
  startRun: (
    deps: DataforgeDeps,
    exec: unknown,
    args: RunArgs,
  ) => Promise<RunToolValue>
}

export function buildDataforgeDeps(init: DataforgeInit): DataforgeDeps {
  const deps: DataforgeDeps = {
    ...init,
    discover: async (exec) => discoverFor(deps, exec),
    startRun: (d, exec, args) => runFlow(d, exec, args),
  }
  return deps
}

/** 包根构建：builtin=引擎 configs；dataRoot=全局三方包；workspace=工作区包（权威覆盖）。 */
async function discoverFor(deps: DataforgeDeps, exec: unknown): Promise<DiscoveredFlows> {
  const wsRoot = await deps.resolveWorkspaceRoot(exec)
  const roots: PackRoots = {
    builtinConfigsDir: `${deps.config.engineRoot}/configs`,
    dataRootFlows: `${deps.config.dataRoot}/flows`,
    ...(wsRoot === undefined ? {} : { workspaceFlows: `${wsRoot}/.dsh/dataforge/flows` }),
  }
  return discoverFlows(roots)
}

// ────────────────────────────────────────────────
// dataforge_flows
// ────────────────────────────────────────────────

/** type 别名 == 有隐式索引签名（工具 schema 推断要求 Record 兼容；interface 会断言失败，勿改回）。 */
export type PacksInfo = {
  builtin?: string
  dataRoot?: string
  workspace?: string
}

export interface FlowsRow {
  name: string
  pack: string
  flowPath: string
  description?: string
  required: FlowField[]
  optional: FlowField[]
}

/** type 别名 == 有隐式索引签名（工具 schema 推断要求 Record 兼容；interface 会断言失败，勿改回）。 */
export type FlowsValue = {
  flows: FlowsRow[]
  packs: PacksInfo
}

export async function listFlows(deps: DataforgeDeps, exec: unknown): Promise<FlowsValue> {
  const { flows, packs } = await discoverFor(deps, exec)
  return {
    packs,
    flows: flows.map((f) => ({
      name: f.name,
      pack: f.pack,
      flowPath: f.flowPath,
      ...(f.description === undefined ? {} : { description: f.description }),
      required: f.requiredFields,
      optional: f.optionalFields,
    })),
  }
}

// ────────────────────────────────────────────────
// dataforge_run：三道闸 + 编排
// ────────────────────────────────────────────────

export interface RunArgs {
  flow: string
  params: Record<string, unknown>
  confirm?: boolean
  dryRun?: boolean
}

export type RunGate = 'started' | 'missing-fields' | 'confirm-required' | 'preflight-failed'

/** type 别名 == 有隐式索引签名（工具 schema 推断要求 Record 兼容；interface 会断言失败，勿改回）。 */
export type RunToolValue = {
  accepted: boolean
  gate: RunGate
  /** 启动（background）；前台为 degraded 模式。 */
  kind?: 'background' | 'foreground'
  jobId?: string
  runId?: string
  runDir?: string
  missing?: FlowField[]
  /** 确认卡 / 引导文案（模型转述给用户）。 */
  card?: string
  degradedNotice?: string
  summary?: RunSummary
}

/** 闸 1：必填校验（参数 present = 非空字符串/数字/对象）。 */
function missingFields(flow: FlowInfo, params: Record<string, unknown>): FlowField[] {
  return flow.requiredFields.filter(({ field }) => {
    const value = params[field]
    return value === undefined || value === null || value === '' ||
      (typeof value === 'object' && Object.keys(value).length === 0)
  })
}

/** 闸 2：参数确认卡（人类可读，模型原样转述）。 */
export function buildConfirmationCard(flow: FlowInfo, params: Record<string, unknown>, dryRun: boolean, missing: FlowField[]): string {
  const rows: Array<[string, string]> = [['流程', `${flow.name}（${flow.pack}）`]]
  for (const { field, label } of [...flow.requiredFields, ...flow.optionalFields]) {
    if (params[field] !== undefined) {
      rows.push([label || field, JSON.stringify(params[field])])
    }
  }
  const width = Math.max(...rows.map(([k]) => k.length))
  const table = rows.map(([k, v]) => `  ${k.padEnd(width)}  │  ${v}`).join('\n')
  const missingLine = missing.length === 0
    ? '' : `\n  ⚠️ 仍缺必填（确认后仍无法启动，请先补齐）: ${missing.map((m) => m.label).join('、')}`
  return [
    `📋 参数确认卡${dryRun ? '（dry-run）' : ''}`,
    table,
    missingLine,
    '请用户回复「确认」后再以 confirm=true 调用 dataforge_run。',
  ].filter(Boolean).join('\n')
}

/** 预检（引擎三件套）。 */
async function preflight(deps: DataforgeDeps): Promise<string[]> {
  const locals = resolveEngineLocators(deps.config.engineRoot, deps.config.pythonBin)
  if (!locals.ok) return locals.reasons
  return probePython(deps.config.pythonBin)
}

/** 运行编排：闸1 → 闸2 → preflight → 后台 job / 前台降级。 */
export async function runFlow(deps: DataforgeDeps, exec: unknown, args: RunArgs): Promise<RunToolValue> {
  const discovered = await discoverFor(deps, exec)
  const flow = pickFlow(discovered, args.flow)
  const params = args.params ?? {}
  const dryRun = args.dryRun === true

  // 闸 1：必填
  const missing = missingFields(flow, params)
  if (missing.length > 0) {
    const labels = missing.map((m) => `${m.label}（${m.field}）`).join('、')
    return {
      accepted: false,
      gate: 'missing-fields',
      missing,
      card: `❌ 必填参数缺失：${labels}\n${buildConfirmationCard(flow, params, dryRun, missing)}`,
    }
  }

  // 闸 2：确认
  if (args.confirm !== true) {
    return {
      accepted: false,
      gate: 'confirm-required',
      card: buildConfirmationCard(flow, params, dryRun, missing),
    }
  }

  // 预检：python / 引擎 / 桥
  const reasons = await preflight(deps)
  if (reasons.length > 0) {
    return { accepted: false, gate: 'preflight-failed', card: `❌ 引擎预检失败：\n  ${reasons.join('\n  ')}` }
  }

  return startRunJob(deps, exec, flow, params, dryRun)
}

function runIdOf(flow: string, now: number): string {
  return `${flow}-${now}`
}

export interface BridgeRunner {
  argv: string[]
  onEvent: (cb: (e: BridgeEvent) => void) => void
  getStderrTail: () => string
  exitCode: Promise<number>
  kill: (reason: string) => void
}

/** 把一次 spawn 抽象出来（测试注入 fake runner）。 */
export function spawnRunner(deps: DataforgeDeps, argv: string[]): BridgeRunner {
  const spawned = spawnBridge(deps.config.pythonBin, argv, deps.config.engineRoot, deps.config.timeoutSeconds * 1000)
  return {
    argv,
    onEvent: spawned.onEvent,
    getStderrTail: spawned.getStderrTail,
    exitCode: spawned.exitCode,
    kill: (reason: string) => spawned.kill(reason),
  }
}

/** 启动运行：优先后台 job；jobs 不在场 → 前台降级（degradedNotice 如实标注）。 */
async function startRunJob(
  deps: DataforgeDeps,
  exec: unknown,
  flow: FlowInfo,
  params: Record<string, unknown>,
  dryRun: boolean,
): Promise<RunToolValue> {
  const argv = buildBridgeArgv(
    resolveEngineLocators(deps.config.engineRoot, deps.config.pythonBin),
    flow.flowPath,
    params,
    dryRun,
  )
  const runId = runIdOf(flow.flowPath.split('/').pop()?.replace(/\.ya?ml$/, '') ?? 'flow', Date.now())
  const runDir = startRunRecord(deps.config.dataRoot, runId, {
    flow: flow.name,
    flowPath: flow.flowPath,
    pack: flow.pack,
    params,
    dryRun,
    startedAt: Date.now(),
  })

  const events: BridgeEvent[] = []
  const runner = spawnRunner(deps, argv)
  runner.onEvent((event) => {
    events.push(event)
    appendEvent(deps.config.dataRoot, runId, event)
  })

  // ── 后台 job 路径 ──
  const jobs = deps.resolveJobs() as JobsLike | undefined
  if (jobs !== undefined && typeof jobs.start === 'function') {
    const spec: JobsSpec = {
      kind: 'dataforge',
      label: `${flow.name}${dryRun ? '（dry-run）' : ''}`,
      owner: ownerOf(exec),
      outputLimitBytes: 65536,
      run(job) {
        let settled = false
        const done = runner.exitCode.then((code): { status: 'completed' | 'failed'; detail?: string; result?: string } => {
          settled = true
          const result = lastResult(events)
          const success = result?.success === true
          const summary = foldSummary(runId, events)
          const detail = (result?.message ?? (success ? '造数完成' : `退出码 ${code}`)) +
            (success ? '' : tailOf(runner.getStderrTail()))
          return {
            status: success ? 'completed' : 'failed',
            detail,
            result: JSON.stringify(summary),
          }
        })
        // 未尽快 settle 不算问题；注册表只认 done。
        void settled
        return {
          cancel: (reason?: string) => {
            runner.kill(reason ?? 'dataforge job killed')
          },
          done,
        }
      },
    }
    const jobId = extractJobId(jobs.start(spec))
    return { accepted: true, gate: 'started', kind: 'background', jobId, runId, runDir }
  }

  // ── 前台降级（宿主未装配 dsh-jobs）──
  const timeoutTimer = setTimeout(() => runner.kill(`前台执行超时（${deps.config.timeoutSeconds}s）`), deps.config.timeoutSeconds * 1000)
  timeoutTimer.unref?.()
  const code = await runner.exitCode
  clearTimeout(timeoutTimer)
  const summary = foldSummary(runId, events)
  const resultEvent = lastResult(events)
  return {
    accepted: true,
    gate: 'started',
    kind: 'foreground',
    runId,
    runDir,
    degradedNotice: '宿主未装配 dsh-jobs：本次前台执行（建议部署 @deepseek-ai/dsh-jobs + @deepseek-ai/dsh-tool-jobs 以解锁后台运行）',
    summary: {
      ...summary,
      status: resultEvent?.success === true ? 'completed' : 'failed',
    },
  }
}

function ownerOf(exec: unknown): string | undefined {
  const id = (exec as { agent?: { id?: unknown } } | undefined)?.agent?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

function extractJobId(started: unknown): string | undefined {
  const id = (started as { id?: unknown } | null)?.id
  return typeof id === 'string' ? id : undefined
}

function tailOf(stderrTail: string): string {
  const tail = stderrTail.trim().split('\n').slice(-2).filter(Boolean).join(' | ')
  return tail ? `\n  stderr 尾部: ${tail}` : ''
}

// ────────────────────────────────────────────────
// dataforge_status
// ────────────────────────────────────────────────

/** type 别名 == 有隐式索引签名（工具 schema 推断要求 Record 兼容；interface 会断言失败，勿改回）。 */
export type StatusValue = {
  ok: boolean
  run?: RunSummary
  runs?: RunSummary[]
  notice?: string
}

/** 单查或列最近运行（runId 缺省 = 最近 10 条）。 */
export function runStatus(deps: DataforgeDeps, runId: string | undefined): StatusValue {
  const { dataRoot } = deps.config
  if (runId !== undefined) {
    const events = loadRunEvents(dataRoot, runId)
    if (events === undefined || events.length === 0) {
      return { ok: false, notice: `运行「${runId}」无留痕（runId 不存在或 run 尚未写下事件）` }
    }
    return { ok: true, run: foldSummary(runId, events) }
  }
  const ids = listRunIds(dataRoot, 10)
  const runs = ids
    .map((id) => {
      const events = loadRunEvents(dataRoot, id)
      return events === undefined || events.length === 0 ? undefined : foldSummary(id, events)
    })
    .filter((s): s is RunSummary => s !== undefined)
  return { ok: true, runs, ...(runs.length === 0 ? { notice: '暂无运行留痕' } : {}) }
}
