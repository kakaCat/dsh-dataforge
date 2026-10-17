/**
 * 三个工具壳：参数声明 / 规范值 / 回执渲染；判定全在 application 层。
 *
 * 对齐官方「工具编写参考」硬规则：
 *   - parameters 由 defineTool 校验；execute 返回规范 JSON 值；
 *   - output.render 只产模型可见的一小段自然语言，让模型从结果里找业务单号；
 *   - 确认卡（闸2）/ 缺参清单（闸1）走 card 字段进模型结果。
 *
 * @module dsh-dataforge/tools
 */
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { DataforgeDeps, FlowsValue, RunToolValue, StatusValue } from './application.js'
import { listFlows, runFlow, runStatus } from './application.js'
import {
  startCapture, captureStatus, captureResult, captureCancel,
  type CaptureDeps, type CaptureToolValue, type StartCaptureArgs,
} from './capture/application.js'
import type { ActSpec } from './capture/session.js'
import { lossless } from './shared/json.js'
import type {
  CardRow, CaptureRunRow, CredentialRow, PageRow, SampleRow,
} from './shared/capture-types.js'
import type { RunSummary } from './shared/types.js'
import {
  chainRunForTool, getChainForTool, importLibraryForTool, listChainRunsForTool, upsertChainForTool,
  type ChainGetToolValue, type ChainRunPlanValue, type ChainRunsToolValue, type ChainRunToolDeps,
  type ChainRunToolValue, type ChainUpsertToolValue, type ImportLibraryToolValue, type OrchestrationDeps,
} from './orchestration/application.js'
import { probeForTool, type ChainProbeToolArgs } from './orchestration/explore.js'
import type { ProbeResult } from './execute/probe.js'

/** 渲染边界单向收紧：进 render 的值已被 defineTool 按 schema 运行时校验，只是 TS 推断偏松。 */
function tighten<T>(value: unknown): T {
  return value as T
}

// ────────────────────────────────────────────────
// dataforge_flows
// ────────────────────────────────────────────────

function renderFlows(value: FlowsValue): string {
  if (value.flows.length === 0) {
    return `📂 未发现任何流程。包根：engineRoot/configs、dataRoot/flows、工作区 .dsh/dataforge/flows。`
  }
  const lines = value.flows.map((f) => {
    const req = f.required.map((r) => r.label).join('、')
    return `- ${f.name}（${f.pack}）${f.description ? `：${f.description}` : ''}${req ? `；必填：${req}` : ''}`
  })
  return `📚 可用流程 ${value.flows.length} 个：\n${lines.join('\n')}`
}

export function defineFlowsTool(deps: DataforgeDeps) {
  return defineTool({
    name: 'dataforge_flows',
    description: `列出可运行的造数流程（声明式流程包）。

选择规则：
- 先调本工具看有哪些流程与各自的必填参数；禁止凭记忆猜流程名。
- 每个流程的 required 字段就是「闸1 必填校验」的清单：缺任何一项都会被拒绝启动。

失败时：
- 空列表 → 配置的流程包根（engineRoot/configs、dataRoot/flows、工作区 .dsh/dataforge/flows）都没有 yaml。`,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          flows: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                pack: { type: 'string' },
                flowPath: { type: 'string' },
                description: { type: 'string' },
                required: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { field: { type: 'string' }, label: { type: 'string' } },
                  },
                },
                optional: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { field: { type: 'string' }, label: { type: 'string' } },
                  },
                },
              },
            },
          },
          packs: {
            type: 'object',
            additionalProperties: false,
            properties: {
              builtin: { type: 'string' },
              dataRoot: { type: 'string' },
              workspace: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderFlows(tighten<FlowsValue>(value)) }],
    },
    async execute(_args, exec: ToolRunContext) {
      return lossless(await listFlows(deps, exec))
    },
  })
}

// ────────────────────────────────────────────────
// dataforge_run
// ────────────────────────────────────────────────

const RUN_PROMPT = `执行一条造数流程（三道闸编排）。

调用前必须满足（缺一会被拒绝启动）：
1. 闸1 必填齐全：流程 yaml 的 required 参数全部就位（可先 dataforge_flows 核对）。
2. 闸2 用户确认：先展示参数确认卡，用户回复「确认」后，才允许 confirm=true 重调本工具；
   没有这一步，不要擅自 confirm。
3. 业务映射：把「生态链」这类口语映射成对应编码（stockOrg/purchaseOrg 等），规则见流程包说明。

dry_run=true 仅做静态走查（不碰外部系统），验收/试跑用它；
真实造数单次 2-8 分钟，accepted=true 时走宿主后台任务（kind=background），
用 job_output 看进度，dataforge_status 查业务结果。

失败时（accepted=false）：
- gate=missing-fields → 补齐 missing 后重调；
- gate=confirm-required → 把 card 转述给用户求确认；
- gate=preflight-failed → 按提示修引擎环境，不要重试绕过。`

function renderRun(value: RunToolValue): string {
  if (!value.accepted) {
    return value.card ?? '❌ 未获接受（缺细节）'
  }
  const mode = value.kind === 'background'
    ? `已注册后台任务 ${value.jobId ?? '?'}`
    : `前台已执行完毕${value.degradedNotice ? `（${value.degradedNotice}）` : ''}`
  const head = value.kind === 'background'
    ? `🚀 ${value.runId ?? '?'}：${mode}；用 job_output 看进度，或 dataforge_status 查结果。`
    : `✅ ${value.runId ?? '?'}：${mode}`
  const summary = value.summary === undefined ? '' : `\n${summarizeRunBrief(value.summary)}`
  return `${head}${summary}`
}

function summarizeRunBrief(summary: RunSummary): string {
  const biz = summary.businessData === undefined ? '' :
    Object.entries(summary.businessData).map(([k, v]) => `${k}=${String(v)}`).join(' ')
  const icon = summary.status === 'completed' ? '✅' : summary.status === 'running' ? '⏳' : '❌'
  const where = summary.lastStepId === undefined ? '' : `（最后一步 ${summary.lastStepId}）`
  return `${icon} ${summary.status}：${summary.stepsDone}/${summary.totalSteps} 步${where}${biz ? `；${biz}` : ''}`
}

export function defineRunTool(deps: DataforgeDeps) {
  return defineTool({
    name: 'dataforge_run',
    description: RUN_PROMPT,
    parameters: {
      flow: { type: 'string', required: true, description: '流程名（dataforge_flows 的 name，禁止凭记忆编造）' },
      params: { type: 'object', required: true, additionalProperties: true, description: '流程入参（required 全给齐；materials 是对象）' },
      confirm: { type: 'boolean', description: '闸2：用户确认后才允许 true；缺省 = 只出确认卡' },
      dry_run: { type: 'boolean', description: '静态走查（不执行外部调用）；缺省 false' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean' },
          gate: { type: 'string', description: 'started / missing-fields / confirm-required / preflight-failed' },
          kind: { type: 'string', description: 'background / foreground' },
          jobId: { type: 'string' },
          runId: { type: 'string' },
          runDir: { type: 'string' },
          missing: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { field: { type: 'string' }, label: { type: 'string' } },
            },
          },
          card: { type: 'string' },
          degradedNotice: { type: 'string' },
          summary: { type: 'object', additionalProperties: true, description: '前台模式下的运行摘要' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderRun(tighten<RunToolValue>(value)) }],
    },
    async execute(args, exec: ToolRunContext) {
      return lossless(await runFlow(deps, exec, {
        flow: args.flow,
        params: args.params,
        ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
        ...(args.dry_run === undefined ? {} : { dryRun: args.dry_run }),
      }))
    },
  })
}

// ────────────────────────────────────────────────
// dataforge_status
// ────────────────────────────────────────────────

function renderStatus(value: StatusValue): string {
  if (value.run !== undefined) return summarizeRunFull(value.run)
  if (value.runs === undefined) return value.notice ?? '查询无结果'
  if (value.runs.length === 0) return value.notice ?? '暂无运行留痕'
  const lines = value.runs.map((r) => {
    const chain = r.chain === undefined ? '' : ` 链 ${r.chain.site}/${r.chain.flow} v${r.chain.version}`
    const failed = r.chain?.failedNode === undefined ? '' : `，断在 ${r.chain.failedNode}`
    return `- ${r.runId}：${r.status} ${r.stepsDone}/${r.totalSteps} 步${chain}${failed}${r.businessData?.poNo === undefined ? '' : ` PO=${String(r.businessData.poNo)}`}`
  })
  return `🗂 最近运行：\n${lines.join('\n')}`
}

function summarizeRunFull(run: RunSummary): string {
  const icon = run.status === 'completed' ? '✅' : run.status === 'running' ? '⏳' : run.status === 'killed' ? '🛑' : '❌'
  const biz = run.businessData === undefined
    ? []
    : Object.entries(run.businessData).map(([k, v]) => `${k}=${String(v)}`)
  return [
    `${icon} ${run.runId}（${run.flowName || run.flow}）— ${run.status}${run.dryRun ? '（dry-run）' : ''}`,
    `进度：${run.stepsDone}/${run.totalSteps} 步${run.lastStepId === undefined ? '' : `，最后一步 ${run.lastStepId}`}`,
    ...(run.chain === undefined
      ? []
      : [`链：${run.chain.site} / ${run.chain.flow} v${run.chain.version}${run.chain.failedNode === undefined ? '' : `，断在 ${run.chain.failedNode}`}${(run.chain.completedNodes ?? []).length === 0 ? '' : `，已完成 ${(run.chain.completedNodes ?? []).join('、')}`}`]),
    ...(run.message === undefined ? [] : [`信息：${run.message}`]),
    ...(run.lastError === undefined ? [] : [`错误：${run.lastError}`]),
    ...(biz.length === 0 ? [] : [`业务字段：${biz.join('  ')}`]),
  ].join('\n')
}

export function defineStatusTool(deps: DataforgeDeps) {
  return defineTool({
    name: 'dataforge_status',
    description: `查造数运行状态。

用法：
- runId 给出时：单查一次运行（进度、最后一步、失败原因、业务单号链）。
- runId 省略：列最近运行。

对后台任务的约定：dataforge_run 返回 accepted=true + kind=background 后，用本工具轮询或等 job 完成通知；不要凭空报结果。`,
    parameters: {
      run_id: { type: 'string', description: '缺省 = 列最近 10 条运行' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          notice: { type: 'string' },
          run: { type: 'object', additionalProperties: true },
          runs: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderStatus(tighten<StatusValue>(value)) }],
    },
    async execute(args) {
      return lossless(runStatus(deps, args.run_id))
    },
  })
}

// ────────────────────────────────────────────────
// 采集域：dataforge_capture / _status / _result / _cancel
// ────────────────────────────────────────────────

type CaptureStatusValue = { ok: boolean; run?: CaptureRunRow; runs?: CaptureRunRow[]; notice?: string }
type CaptureResultValue = { ok: boolean; items?: Array<CardRow | SampleRow | CredentialRow | PageRow>; notice?: string }
type CaptureCancelValue = { ok: boolean; status?: string; notice?: string }

function renderCapture(value: CaptureToolValue): string {
  if (!value.accepted) return value.card ?? '❌ 采集请求未被接受（缺细节）'
  if (value.sessionId !== undefined) {
    return `✅ 已开会话 ${value.sessionId}（captureId ${value.captureId ?? '?'}）：用 dataforge_browser_snapshot 看 UI、dataforge_browser_act 交互；结束后 dataforge_browser_close 收 cookie。`
  }
  const degraded = value.degradedNotice === undefined ? '' : `\n⚠ ${value.degradedNotice}`
  return `🚀 采集已启动（captureId ${value.captureId ?? '?'}）：site_crawl 是后台任务，用 dataforge_capture_status 轮询，完成后 dataforge_capture_result(scope=cards) 取卡。${degraded}`
}

/** 回执里一行一条，逐行截断；超出部分只报条数，不回灌原始 JSON。 */
const RECEIPT_MAX_LINES = 20
const RECEIPT_URL_MAX = 110

function shortUrl(url: string): string {
  return url.length <= RECEIPT_URL_MAX ? url : `${url.slice(0, RECEIPT_URL_MAX)}…`
}

/** 模板摘要：字段数 + 探测到的状态码路径（"入参 5 字段" / "出参 8 字段(code)"）。 */
function templateBrief(label: string, template: CardRow['requestTemplate']): string {
  if (template === undefined) return `${label} 未采到`
  const code = template.codePath === undefined ? '' : `(${template.codePath})`
  return `${label} ${template.fields.length} 字段${code}`
}

/**
 * 采集产物回执：直接把接口列出来——方法 + URL 模板 + 样本数 + 出入参规模。
 *
 * 早先只回一句「N 条记录（详见 items）」，对话里根本看不到采到了什么接口；
 * 凭证只报名称与来源，value_json 原文永不进回执。
 */
function renderCaptureResult(scope: string, value: CaptureResultValue): string {
  if (value.notice !== undefined) return `📭 ${value.notice}`
  const items = value.items ?? []
  if (items.length === 0) return `📦 0 条记录`

  let lines: string[]
  if (scope === 'cards') {
    lines = (items as CardRow[]).map((c) => {
      const name = c.name === undefined ? '' : `${c.name} `
      return `- ${name}${c.method} ${shortUrl(c.urlTemplate)} ｜ ×${c.sampleCount} ｜ ${templateBrief('入参', c.requestTemplate)}，${templateBrief('出参', c.responseTemplate)}`
    })
  } else if (scope === 'samples') {
    lines = (items as SampleRow[]).map((s) => {
      const status = s.status === undefined ? '???' : String(s.status)
      const trunc = s.truncated ? ' ⚠️超限未存正文' : ''
      return `- #${s.seq} ${s.method} ${status} ${shortUrl(s.url)}${trunc}`
    })
  } else if (scope === 'credentials') {
    // 只报名称/类型/来源域；value_json（cookie 原文）不出壳。
    lines = (items as CredentialRow[]).map((c) => `- ${c.kind} ${c.name} @ ${c.url}`)
  } else {
    lines = (items as PageRow[]).map((p) => `- [d${p.depth}] ${p.status} ${shortUrl(p.url)}`)
  }

  const shown = lines.slice(0, RECEIPT_MAX_LINES)
  const rest = lines.length - shown.length
  const tail = rest > 0 ? `\n… 还有 ${rest} 条（items 里有全量）` : ''
  const head = scope === 'cards' ? '🧩 接口卡' : scope === 'samples' ? '📡 请求样本' : scope === 'credentials' ? '🔒 凭证（仅名称/来源）' : '📄 页面'
  return `${head} ${items.length} 条：\n${shown.join('\n')}${tail}`
}

export function defineCaptureTool(deps: CaptureDeps) {
  return defineTool({
    name: 'dataforge_capture',
    description: `启动接口采集（接口测试流水线第一期）。

三种任务型：
- single_page：打开一个页面，静止期收 XHR/fetch → 接口卡（后台 job）。
- site_crawl：从入口 BFS 同域逐页采集，maxDepth/maxPages 截断、诚实标注（后台 job）。
- action：智能驱动采集——由你经 dataforge_browser_* 原语模拟真实 UI 操作（搜索/翻页/提交），
  遇到的 XHR 全部成卡；**任何写操作必须先向用户转述并获同意**。

三道闸语义：
- single_page/site_crawl 只读，accepted 即后台启动；用 captureId 轮询。
- action 是写操作闸：未 confirm=true 一律拒绝（gate=action-confirm-required）。

失败门：bad-url（entryUrl 非法）/ bad-task（taskType 非法）/ action-confirm-required（未确认）。`,
    parameters: {
      task_type: { type: 'string', required: true, description: 'single_page | site_crawl | action' },
      entry_url: { type: 'string', required: true, description: '采集入口 URL（https:// 开头）' },
      confirm: { type: 'boolean', description: '仅 action 需要：用户确认真实 UI 写操作后为 true' },
      max_depth: { type: 'number', description: 'site_crawl BFS 深度上限（缺省用配置）' },
      max_pages: { type: 'number', description: 'site_crawl BFS 页数上限（缺省用配置）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean' },
          gate: { type: 'string', description: 'started / bad-url / bad-task / action-confirm-required' },
          captureId: { type: 'string' },
          sessionId: { type: 'string', description: 'action 型：会话原语 id' },
          degradedNotice: { type: 'string', description: 'jobs 服务缺席时前台降级执行的说明' },
          card: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderCapture(tighten<CaptureToolValue>(value)) }],
    },
    async execute(args): Promise<CaptureToolValue> {
      const taskType = args.task_type
      if (taskType !== 'single_page' && taskType !== 'site_crawl' && taskType !== 'action') {
        return { accepted: false, gate: 'bad-task', card: `❌ taskType 非法：${String(taskType)}` }
      }
      return lossless(await startCapture(deps, {
        taskType,
        entryUrl: args.entry_url,
        ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
        ...(args.max_depth === undefined ? {} : { maxDepth: args.max_depth }),
        ...(args.max_pages === undefined ? {} : { maxPages: args.max_pages }),
      } satisfies StartCaptureArgs))
    },
  })
}

export function defineCaptureStatusTool(deps: CaptureDeps) {
  return defineTool({
    name: 'dataforge_capture_status',
    description: `查采集运行状态。capture_id 给出时单查（running/done/failed/cancelled + 页面/请求/卡/凭证计数）；省缺省列最近 10 条。site_crawl 后台任务用它轮询，不要凭空报结果。`,
    parameters: {
      capture_id: { type: 'string', description: '缺省 = 列最近 10 条' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          notice: { type: 'string' },
          run: { type: 'object', additionalProperties: true },
          runs: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => {
        const v = tighten<CaptureStatusValue>(value)
        if (v.runs !== undefined) {
          const lines = v.runs.map((r) => `- ${r.id}: ${r.status}`).join('\n')
          return [{ type: 'text', text: `🗂 最近采集：\n${lines}` }]
        }
        const run = v.run
        return [{ type: 'text', text: run === undefined
          ? `⚠️ ${v.notice ?? '查询无结果'}`
          : `📡 ${run.id}：${run.status} 页${run.stats.pages}/请求${run.stats.requests}/卡${run.stats.cards}/凭证${run.stats.credentials}` }]
      },
    },
    async execute(args) {
      return lossless(captureStatus(deps, args.capture_id))
    },
  })
}

export function defineCaptureResultTool(deps: CaptureDeps) {
  return defineTool({
    name: 'dataforge_capture_result',
    description: `取采集产物（四种 scope）：cards=接口卡（模板/归并键）；samples=原始请求留痕（文件指针）；credentials=捕获的凭证（只报名称/来源，不贴原文）；pages=已抓页面清单。报给用户时只说接口名/用途/出入参要点，不贴 token/cookie 原文。`,
    parameters: {
      capture_id: { type: 'string', required: true },
      scope: { type: 'string', required: true, description: 'cards | samples | credentials | pages' },
      limit: { type: 'number', description: '缺省 50' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          notice: { type: 'string' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (args, value) => [{ type: 'text', text: renderCaptureResult(String(args.scope), tighten<CaptureResultValue>(value)) }],
    },
    async execute(args) {
      if (args.scope !== 'cards' && args.scope !== 'samples' && args.scope !== 'credentials' && args.scope !== 'pages') {
        return { ok: false, notice: `scope 非法：${String(args.scope)}（cards | samples | credentials | pages）` }
      }
      return lossless(captureResult(deps, args.capture_id, args.scope, args.limit))
    },
  })
}

export function defineCaptureCancelTool(deps: CaptureDeps) {
  return defineTool({
    name: 'dataforge_capture_cancel',
    description: `取消一次采集：run 收口为 cancelled（幂等）。后台 job 的进程级取消由宿主 job 系统负责。`,
    parameters: {
      capture_id: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          status: { type: 'string' },
          notice: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = tighten<CaptureCancelValue>(value)
        return [{ type: 'text', text: v.ok ? `🛑 已收口（status=${v.status ?? 'cancelled'}）` : `⚠️ ${v.notice ?? '取消未生效'}` }]
      },
    },
    async execute(args) {
      return lossless(captureCancel(deps, args.capture_id))
    },
  })
}

// ────────────────────────────────────────────────
// 会话原语：dataforge_browser_open / _act / _snapshot / _close
// ────────────────────────────────────────────────

type BrowserActValue = { ok: boolean; pageUrl?: string; error?: string }
type BrowserSnapshotValue = { ok: boolean; elements?: string[]; error?: string }
type BrowserCloseValue = { ok: boolean; cookies: Array<{ name: string; domain: string }>; captureId?: string }

function toActSpec(raw: unknown): ActSpec | undefined {
  const r = raw as Record<string, unknown>
  const selector = typeof r['selector'] === 'string' ? r['selector'] : undefined
  switch (r['kind']) {
    case 'click':
      return selector === undefined ? undefined : { kind: 'click', selector }
    case 'submit':
      return selector === undefined ? undefined : { kind: 'submit', selector }
    case 'fill':
      return selector === undefined || typeof r['value'] !== 'string' ? undefined : { kind: 'fill', selector, value: r['value'] }
    case 'press':
      return typeof r['key'] !== 'string' ? undefined : { kind: 'press', key: r['key'] }
    case 'wait':
      return typeof r['ms'] !== 'number' ? undefined : { kind: 'wait', ms: r['ms'] }
    case 'goto':
      return typeof r['url'] !== 'string' ? undefined : { kind: 'goto', url: r['url'] }
    default:
      return undefined
  }
}

export function defineBrowserOpenTool(deps: CaptureDeps) {
  return defineTool({
    name: 'dataforge_browser_open',
    description: `开一个无头 Chrome 采集会话（系统 Chrome，流经隐私侧通道）。entry_url 给出时直接导航过去。与 dataforge_capture(task_type=action) 配合使用：action 会话可自动开。`,
    parameters: {
      entry_url: { type: 'string', description: '打开后立刻导航的 URL' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          sessionId: { type: 'string' },
          pageUrl: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = tighten<{ sessionId: string; pageUrl: string }>(value)
        return [{ type: 'text', text: `🖥 会话 ${v.sessionId} 已开（${v.pageUrl}）。下一步用 dataforge_browser_snapshot 看页面。` }]
      },
    },
    async execute(args) {
      return lossless(deps.registry.open(args.entry_url === undefined ? {} : { entryUrl: args.entry_url }))
    },
  })
}

export function defineBrowserActTool(deps: CaptureDeps) {
  return defineTool({
    name: 'dataforge_browser_act',
    description: `对采集会话执行一次页面动作：click/fill/press/submit/wait/goto。⚠️ 此工具生成真实用户操作（含写）：生产站点填表/点击前先转述给用户确认；提交类只应出现在 dataforge_capture(task_type=action) 且用户 confirm 之后。`,
    parameters: {
      session_id: { type: 'string', required: true },
      act: {
        type: 'object', required: true, additionalProperties: true,
        description: '{kind: click|fill|press|submit|wait|goto, selector?, value?, key?, url?, ms?}',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          pageUrl: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = tighten<BrowserActValue>(value)
        return [{ type: 'text', text: v.ok ? `✅ 动作完成（当前页 ${v.pageUrl ?? '?'}）` : `❌ 动作失败：${v.error ?? '未知'}` }]
      },
    },
    async execute(args) {
      const spec = toActSpec(args.act)
      if (spec === undefined) return { ok: false, error: `act 非法：${JSON.stringify(args.act).slice(0, 200)}` }
      return lossless(await deps.registry.act(args.session_id, spec))
    },
  })
}

export function defineBrowserSnapshotTool(deps: CaptureDeps) {
  return defineTool({
    name: 'dataforge_browser_snapshot',
    description: `抓当前页面可交互元素清单（≤80 个：链接/按钮/输入/表单），据此决定下一步 browser_act。$eval：id/name/textElement 每个元素一行。`,
    parameters: {
      session_id: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          elements: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = tighten<BrowserSnapshotValue>(value)
        if (!v.ok) return [{ type: 'text', text: `❌ 快照失败：${v.error ?? '未知'}` }]
        const lines = (v.elements ?? []).map((e) => `- ${e}`).join('\n')
        return [{ type: 'text', text: `🔍 可交互元素 ${v.elements?.length ?? 0} 个：\n${lines}` }]
      },
    },
    async execute(args) {
      return lossless(await deps.registry.snapshot(args.session_id))
    },
  })
}

export function defineBrowserCloseTool(deps: CaptureDeps) {
  return defineTool({
    name: 'dataforge_browser_close',
    description: `关闭采集会话并交回 cookie 总结；若会话绑定了 captureId，凭证已在收口时入库。`,
    parameters: {
      session_id: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          cookies: { type: 'array', items: { type: 'object', additionalProperties: true } },
          captureId: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = tighten<BrowserCloseValue>(value)
        return [{
          type: 'text',
          text: v.ok
            ? `🔒 会话已关（cookie ${v.cookies.length} 个${v.captureId === undefined ? '' : `，已挂到 ${v.captureId}`}）`
            : '❌ 会话不存在或已关闭',
        }]
      },
    },
    async execute(args) {
      const closed = await deps.registry.close(args.session_id)
      if (closed.captureId !== undefined) {
        for (const c of closed.cookies) {
          deps.store.upsertCredential(
            closed.captureId,
            'cookie',
            String(c['domain'] ?? ''),
            String(c['name'] ?? ''),
            Date.now(),
            c,
          )
        }
        const run = deps.store.getRun(closed.captureId)
        if (run?.status === 'running') deps.store.finishRun(closed.captureId, 'done')
      }
      const summarized: BrowserCloseValue = {
        ok: closed.ok,
        cookies: closed.cookies.map((c) => ({ name: String(c['name'] ?? ''), domain: String(c['domain'] ?? '') })),
        ...(closed.captureId === undefined ? {} : { captureId: closed.captureId }),
      }
      return lossless(summarized)
    },
  })
}

// ────────────────────────────────────────────────
// 编排三件套：dataforge_library_import / dataforge_chain_upsert / dataforge_chain_get
// ────────────────────────────────────────────────

function renderLibraryImport(value: ImportLibraryToolValue): string {
  if (!value.ok) {
    const hints = value.hints === undefined || value.hints.length === 0 ? '' : `\n建议：${value.hints.join('；')}`
    return `⚠️ 接口库导入未完成（${value.code ?? 'unknown'}）：${value.message ?? ''}${hints}`
  }
  const head = `📦 接口库导入：新建 ${value.imported ?? 0} 张 / 归并 ${value.merged ?? 0} 张 / 未变 ${value.unchanged ?? 0} 张 / 跳过 ${value.skipped ?? 0} 张`
  const ids = value.cardIds ?? []
  const body = ids.length === 0 ? '- 本次没有卡落库' : ids.slice(0, RECEIPT_MAX_LINES).map((id) => `- ${id}`).join('\n')
  const rest = ids.length > RECEIPT_MAX_LINES ? `\n… 还有 ${ids.length - RECEIPT_MAX_LINES} 张（cardIds 里有全量）` : ''
  const skipped = (value.skippedReasons ?? []).length === 0 ? '' : `\n跳过原因：\n${(value.skippedReasons ?? []).map((r) => `- ${r}`).join('\n')}`
  return `${head}\n${body}${rest}${skipped}\n库：${value.libraryRoot ?? ''}`
}

export function defineLibraryImportTool(deps: OrchestrationDeps) {
  return defineTool({
    name: 'dataforge_library_import',
    description: `把采集到的接口卡导入**项目接口库**（工作区 .dsh/dataforge/library/）。

为什么要有这一步：链靠稳定的 cardId 引用接口，而不是 (capture_id, merge_key)。
同 mergeKey 的卡跨 run 归并成同一张卡，重新采集不会让旧链断引用。

用法：
- 一般先跑本工具再写链；capture_id 缺省 = 全部尚未导入完的采集 run。
- 纯增量幂等：重复导入同一 run 不产生重复卡、不重复记来源、不重写文件。
- 坏卡跳过不炸批：被跳过的卡与中文原因在 skippedReasons 里如实给出。

失败时：
- no-capture-data → 采集库里还没有卡；先让用户跑一次采集（dataforge_capture），不要空转重试。
- 卡文件不含任何凭证值：只投影 auth 标志与来源名，凭证注入是 R-4 的事。`,
    parameters: {
      capture_id: { type: 'string', description: '只导入这一次采集；缺省 = 全部尚未导入完的 run' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          code: { type: 'string', description: 'no-capture-data / capture-unreadable / library-unavailable' },
          message: { type: 'string' },
          hints: { type: 'array', items: { type: 'string' } },
          imported: { type: 'number' },
          merged: { type: 'number' },
          unchanged: { type: 'number' },
          skipped: { type: 'number' },
          cardIds: { type: 'array', items: { type: 'string' } },
          skippedReasons: { type: 'array', items: { type: 'string' } },
          captures: { type: 'array', items: { type: 'string' } },
          libraryRoot: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderLibraryImport(tighten<ImportLibraryToolValue>(value)) }],
    },
    async execute(args, exec: ToolRunContext): Promise<ImportLibraryToolValue> {
      return lossless(await importLibraryForTool(deps, exec, {
        ...(args.capture_id === undefined ? {} : { captureId: args.capture_id }),
      }))
    },
  })
}

function renderChainIssues(issues: Array<{ target: string; code: string; reason: string }> | undefined): string {
  if (issues === undefined || issues.length === 0) return ''
  return `\n${issues.map((issue) => `- ${issue.target}：${issue.reason}`).join('\n')}`
}

export function defineChainUpsertTool(deps: OrchestrationDeps) {
  return defineTool({
    name: 'dataforge_chain_upsert',
    description: `写入一条接口链（唯一写入口），落盘为**新版本快照**。

先 schema 校验、再语义校验：卡引用必须在项目接口库存在、拓扑无环、绑定两端字段在卡模板里、
绑定与常量互斥、链级 inputs 槽位被 $inputs.<name> 引用。**全部通过才落盘，不存在部分写入。**

链 YAML 形状（apiVersion: dataforge/v1）：
- nodes: [{id, card, constants}]，card 是 dataforge_library_import 给的 cardId；
- edges: [{from, to}]，from 是「节点.出参路径」或「$inputs.槽位名」，to 是「节点.入参路径」；
- inputs: [{name, type, required}]，槽位靠常量值引用才算有人用（防僵尸槽位）。

失败时（逐条问题指向 nodes[i] / edges[j]，修好再提交，不会落盘）：
- invalid-chain → 定义本身不合法；
- card-not-imported → 卡不在项目库，先跑 dataforge_library_import。

版本只增不删：同一 site/flow 每次落盘都是 max+1 的新文件，旧版本永远可回读。`,
    parameters: {
      site: { type: 'string', required: true, description: '站点名（如「智慧供应链 SCM」）' },
      flow: { type: 'string', required: true, description: '流程名（如「采购下单」）' },
      chain_yaml: { type: 'string', required: true, description: '链 YAML 全文' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          code: { type: 'string', description: 'invalid-chain / card-not-imported' },
          message: { type: 'string' },
          version: { type: 'number' },
          path: { type: 'string' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { target: { type: 'string' }, code: { type: 'string' }, reason: { type: 'string' } },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const v = tighten<ChainUpsertToolValue>(value)
        if (!v.ok) {
          return [{
            type: 'text',
            text: `❌ 链未落盘（${v.code ?? 'invalid-chain'}）：${v.message ?? ''}${renderChainIssues(v.issues)}`,
          }]
        }
        const warn = (v.warnings ?? []).length === 0 ? '' : `\n⚠️ 提醒：\n${(v.warnings ?? []).map((w) => `- ${w}`).join('\n')}`
        return [{ type: 'text', text: `🔗 链已落盘：v${v.version ?? 0}\n文件：${v.path ?? ''}${warn}` }]
      },
    },
    async execute(args, exec: ToolRunContext): Promise<ChainUpsertToolValue> {
      return lossless(await upsertChainForTool(deps, exec, {
        site: args.site,
        flow: args.flow,
        chainYaml: args.chain_yaml,
      }))
    },
  })
}

export function defineChainGetTool(deps: OrchestrationDeps) {
  return defineTool({
    name: 'dataforge_chain_get',
    description: `读链：按 site/flow/version（缺省最新）取链 YAML 全文。

- 缺省：校验读取——文件被手改坏就如实报 invalid-chain，并列出可用版本供你回读旧版本；
- export=true：原文读取（不校验）。链文件天然零凭证，导出即原文，无需剥除。

失败时：
- chain-not-found → site/flow/version 任一不匹配；versions 里是可用版本，据此重试或放弃。`,
    parameters: {
      site: { type: 'string', required: true },
      flow: { type: 'string', required: true },
      version: { type: 'number', description: '缺省 = 最新版本' },
      export: { type: 'boolean', description: 'true = 原文导出（不校验）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          code: { type: 'string', description: 'chain-not-found / invalid-chain' },
          message: { type: 'string' },
          chainYaml: { type: 'string' },
          version: { type: 'number' },
          path: { type: 'string' },
          versions: { type: 'array', items: { type: 'number' } },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { target: { type: 'string' }, code: { type: 'string' }, reason: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => {
        const v = tighten<ChainGetToolValue>(value)
        if (!v.ok) {
          const versions = (v.versions ?? []).length === 0 ? '无' : (v.versions ?? []).map((n) => `v${n}`).join(' / ')
          return [{
            type: 'text',
            text: `❌ 读链失败（${v.code ?? 'chain-not-found'}）：${v.message ?? ''}\n可用版本：${versions}${renderChainIssues(v.issues)}`,
          }]
        }
        return [{
          type: 'text',
          text: `🔗 ${v.path ?? ''}（v${v.version ?? 0}）\n\`\`\`yaml\n${v.chainYaml ?? ''}\`\`\``,
        }]
      },
    },
    async execute(args, exec: ToolRunContext): Promise<ChainGetToolValue> {
      return lossless(await getChainForTool(deps, exec, {
        site: args.site,
        flow: args.flow,
        ...(args.version === undefined ? {} : { version: args.version }),
        ...(args.export === undefined ? {} : { export: args.export }),
      }))
    },
  })
}

// ────────────────────────────────────────────────
// 执行两件套：dataforge_chain_run / dataforge_chain_runs
// ────────────────────────────────────────────────

/** 计划卡的人话版：目标 host + 拓扑序 + 写类节点（这三样是确认的前提）。 */
function renderPlan(plan: ChainRunPlanValue | undefined): string {
  if (plan === undefined) return ''
  const lines = plan.nodes.map((node) => {
    const write = node.writes ? ' ✍️写' : ''
    const deps = node.dependsOn.length === 0 ? '' : `（等 ${node.dependsOn.join('、')}）`
    return `- ${node.nodeId}${write}：${node.method} ${node.url}${deps}`
  })
  const writes = plan.writeNodes.length === 0 ? '无（整链只读）' : `${plan.writeNodes.join('、')}（已发出无法撤销）`
  return [
    `🎯 目标：${plan.host}`,
    ...lines,
    `写类节点：${writes}`,
    ...(plan.notices.length === 0 ? [] : [`提醒：${plan.notices.join('；')}`]),
  ].join('\n')
}

function renderChainRun(value: ChainRunToolValue): string {
  if (value.accepted !== true) {
    if (value.gate === 'confirm-required') {
      return `${value.card ?? value.message ?? '确认后带 confirm=true 重调'}\n\n${renderPlan(value.plan)}`
    }
    const gaps = (value.gaps ?? []).length === 0
      ? ''
      : `\n缺参（链定义要改，重试同一份链没用）：\n${(value.gaps ?? []).map((gap) => `- ${gap.nodeId} · ${gap.path} · ${gap.type}`).join('\n')}`
    const cycle = (value.cycle ?? []).length === 0 ? '' : `\n成环节点：${(value.cycle ?? []).join(' → ')}`
    const versions = (value.versions ?? []).length === 0
      ? ''
      : `\n可用版本：${(value.versions ?? []).map((version) => `v${version}`).join(' / ')}`
    return `❌ 未执行（${value.code ?? 'unknown'}）：${value.message ?? ''}${gaps}${cycle}${versions}${renderChainIssues(value.issues)}`
  }

  if (value.kind === 'dry-run') {
    return `🧪 dry-run 已留痕（runId ${value.runId ?? '?'}）：${value.summary?.totalSteps ?? 0} 个节点，未发送任何请求\n${renderPlan(value.plan)}`
  }

  if (value.kind === 'background') {
    return `🚀 链已启动（jobId ${value.jobId ?? '?'}，runId ${value.runId ?? '?'}）：用 dataforge_status 轮询节点级进度，job_kill 可取消\n${renderPlan(value.plan)}`
  }

  const nodes = value.nodes ?? []
  const lines = nodes.map((node) => {
    const http = node.httpStatus === undefined ? '' : ` HTTP ${node.httpStatus}`
    const error = node.errorCode === undefined ? '' : ` ${node.errorCode}：${node.error ?? ''}`
    const relogin =
      node.relogin === undefined
        ? ''
        : node.relogin.success
          ? `（已换票重放${node.relogin.runId === undefined ? '' : `，登录链 ${node.relogin.runId}`}${node.relogin.persisted === undefined ? '' : `，已持久化 ${node.relogin.persisted} 个 cookie`}）`
          : `（换票失败 ${node.relogin.code ?? 'relogin-failed'}）`
    return `- ${node.nodeId}：${node.status}${http}（${node.elapsedMs}ms）${error}${relogin}`
  })
  const degraded = value.degradedNotice === undefined ? '' : `\n⚠ ${value.degradedNotice}`
  return [
    `🏁 链已跑完（前台）：${value.summary?.status ?? 'unknown'} ${value.summary?.stepsDone ?? 0}/${value.summary?.totalSteps ?? 0} 步`,
    ...lines,
    ...(value.failedNode === undefined ? [] : [`断在：${value.failedNode}`]),
    degraded,
  ].join('\n')
}

export function defineChainRunTool(deps: ChainRunToolDeps) {
  return defineTool({
    name: 'dataforge_chain_run',
    description: `执行一条接口链（唯一执行入口）：按拓扑序发真实 HTTP 请求，节点出参经绑定边进入下游入参。

只接受 kind: interface-chain。page-chain 必须先在 R-1 侧编译成 interface-chain 草稿、经 dataforge_chain_upsert 落盘，否则一律 not-executable。

三道闸（缺一道都不发请求）：
- 闸1 计划：首次调用不带 confirm 时返回**计划卡**（拓扑序 + 每节点方法/URL 骨架 + 写类节点 + 目标 host），不发任何请求、不建运行；
- 闸2 确认：向用户转述计划卡，得到确认后带 confirm=true 重调才真跑；
- 闸3 dry-run 优先：只想留档或先验证连接参数时用 dry_run=true——同一份计划、永不发请求，但会落一条 dryRun 留痕。

缺参判据不看卡的 required：卡模板里出现的入参，只要有常量或绑定边覆盖就不缺，否则预检直接 missing-params（回执逐条「节点 · 字段 · 类型」），整链不执行。

失败时（一个请求都不会发）：
- missing-params → 补 constants 或绑定边后 upsert 新版本，别重试同一份链；
- chain-not-found → 回执带 availableVersions，先 dataforge_chain_get 核对；
- invalid-chain → 文件坏或校验不过，issues 是 R-1 原文；
- base-url-unresolved → 显式传 baseUrl（卡的来源页面跨多个 origin 时只能人来定）；
- inputs-invalid → inputs 的键必须是链文件声明过的槽位；
- execution-disabled → 执行开关关着，链读写与历史回看照常。

运行期失败（binding-* / node-* / response-too-large / cancelled）不自动重试：链已中止，错误进运行记录，修好后用新 run 重跑（绝不自动重放写请求）。

鉴权：卡声明 cookie-session 时，引擎会按卡的采集来源自动注入 cookie；token 型一期未采集，不猜 Authorization。401 回执区分「未注入可用凭证」与「已注入但仍 401」。

自动换票：传 relogin（一条普通 interface-chain）后，401 会执行登录链、收割 set-cookie、单飞换票并重放当前节点一次；重放仍 401 就中止并报「换票后仍 401」。登录链的 inputs 只进内存，不写运行记录。

幂等性：**不幂等**。同一参数重复调用就是新 run、新请求。长链走宿主后台 job，用 dataforge_status 轮询、job_kill 取消。`,
    parameters: {
      site: { type: 'string', required: true, description: '站点名（链的 meta.site）' },
      flow: { type: 'string', required: true, description: '流程名（链的 meta.flow）' },
      version: { type: 'number', description: '链版本；缺省最新' },
      inputs: {
        type: 'object',
        additionalProperties: true,
        description: '链级槽位运行值（键必须已在链文件 inputs 里声明）',
      },
      baseUrl: { type: 'string', description: '目标站点源（缺省从卡的来源页面 origin 推断；跨 origin 必须显式给）' },
      concurrency: { type: 'number', description: '运行期并发上限（缺省 4，硬上限 16）' },
      dry_run: { type: 'boolean', description: '只编译计划并落留痕，永不发请求' },
      confirm: { type: 'boolean', description: '闸2：用户确认后才允许 true；缺省 = 只出计划卡' },
      relogin: {
        type: 'object',
        additionalProperties: false,
        description:
          '可选：401 时自动执行的登录链（普通 interface-chain）。inputs 是登录链槽位值（账号/密码等），只在内存里过手，不写运行记录；不传 = 不换票。',
        properties: {
          site: { type: 'string', required: true, description: '登录链的 meta.site' },
          flow: { type: 'string', required: true, description: '登录链的 meta.flow' },
          version: { type: 'number', description: '登录链版本；缺省最新' },
          inputs: {
            type: 'object',
            additionalProperties: true,
            description: '登录链槽位运行值（不落盘、不写事件）',
          },
          baseUrl: { type: 'string', description: '登录链目标源；缺省按登录链卡的来源 origin 推断' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          accepted: { type: 'boolean' },
          gate: { type: 'string', description: 'started / confirm-required / blocked' },
          code: { type: 'string', description: 'missing-params / chain-not-found / invalid-chain / base-url-unresolved / inputs-invalid / not-executable / cycle / execution-disabled / execution-unavailable / relogin-unavailable / relogin-failed / relogin-cycle' },
          message: { type: 'string' },
          kind: { type: 'string', description: 'background / foreground / dry-run' },
          jobId: { type: 'string' },
          runId: { type: 'string' },
          runDir: { type: 'string' },
          degradedNotice: { type: 'string' },
          card: { type: 'string' },
          plan: {
            type: 'object',
            additionalProperties: false,
            properties: {
              order: { type: 'array', items: { type: 'string' } },
              totalNodes: { type: 'number' },
              baseUrl: { type: 'string' },
              host: { type: 'string' },
              writeNodes: { type: 'array', items: { type: 'string' } },
              nodes: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    nodeId: { type: 'string' },
                    method: { type: 'string' },
                    url: { type: 'string' },
                    dependsOn: { type: 'array', items: { type: 'string' } },
                    writes: { type: 'boolean' },
                  },
                },
              },
              notices: { type: 'array', items: { type: 'string' } },
            },
          },
          gaps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                nodeId: { type: 'string' },
                path: { type: 'string' },
                type: { type: 'string' },
                target: { type: 'string' },
              },
            },
          },
          cycle: { type: 'array', items: { type: 'string' } },
          versions: { type: 'array', items: { type: 'number' } },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { target: { type: 'string' }, code: { type: 'string' }, reason: { type: 'string' } },
            },
          },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                nodeId: { type: 'string' },
                status: { type: 'string' },
                method: { type: 'string' },
                url: { type: 'string' },
                httpStatus: { type: 'number' },
                attempts: { type: 'number' },
                elapsedMs: { type: 'number' },
                errorCode: { type: 'string' },
                error: { type: 'string' },
                relogin: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    attempted: { type: 'boolean' },
                    success: { type: 'boolean' },
                    code: { type: 'string' },
                    message: { type: 'string' },
                    runId: { type: 'string' },
                    cookieNames: { type: 'array', items: { type: 'string' } },
                    persisted: { type: 'number' },
                  },
                },
              },
            },
          },
          failedNode: { type: 'string' },
          summary: { type: 'object', additionalProperties: true, description: '运行摘要（前台/dry-run）' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderChainRun(tighten<ChainRunToolValue>(value)) }],
    },
    async execute(args, exec: ToolRunContext): Promise<ChainRunToolValue> {
      return lossless(await chainRunForTool(deps, exec, {
        site: args.site,
        flow: args.flow,
        ...(args.version === undefined ? {} : { version: args.version }),
        ...(args.inputs === undefined ? {} : { inputs: args.inputs }),
        ...(args.baseUrl === undefined ? {} : { baseUrl: args.baseUrl }),
        ...(args.concurrency === undefined ? {} : { concurrency: args.concurrency }),
        ...(args.dry_run === undefined ? {} : { dryRun: args.dry_run }),
        ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
        ...(args.relogin === undefined ? {} : { relogin: args.relogin }),
      }))
    },
  })
}

function renderChainProbe(value: ProbeResult): string {
  const head = `🔎 节点试探：${value.nodeId || '?'}（${value.method || '?'}）`
  if (value.gate === 'confirm-required') {
    const plan = value.plan
    const inputs = (plan?.cardInputs ?? []).map((input) => `- ${input.path}（${input.type}${input.required ? '，必填' : ''}）`).join('\n')
    return [
      `⚠️ 写操作需要确认：${plan?.method ?? value.method} ${plan?.urlTemplate ?? ''}`,
      '向用户确认后带 confirm=true 重调；本次没有发出任何请求。',
      inputs === '' ? '' : `卡入参模板：\n${inputs}`,
    ].filter(Boolean).join('\n')
  }

  if (value.gate === 'paused') {
    const gaps = (value.gaps ?? []).map((gap) => `- ${gap.path}（${gap.type}）`).join('\n')
    const inputs = (value.cardInputs ?? []).map((input) => `- ${input.path}（${input.type}${input.required ? '，必填' : ''}）`).join('\n')
    return [
      `⏸ 缺参暂停（未发请求）：${value.message ?? ''}`,
      gaps === '' ? '' : `缺什么：\n${gaps}`,
      inputs === '' ? '' : `卡入参模板：\n${inputs}`,
      value.runId === undefined ? '' : `留痕：${value.runId}`,
    ].filter(Boolean).join('\n')
  }

  if (!value.ok) {
    const response = value.response === undefined
      ? ''
      : `\nHTTP ${value.response.status}：${value.response.bodyPreview}`
    return `❌ 试探未完成（${value.code ?? 'unknown'}）：${value.message ?? ''}${response}${value.runId === undefined ? '' : `\n留痕：${value.runId}`}`
  }

  const req = value.request === undefined ? '' : `→ ${value.request.method} ${value.request.url}`
  const resp = value.response === undefined ? '' : `← HTTP ${value.response.status}（${value.response.bytes}B${value.response.truncated ? '，截断' : ''}）`
  const provenance = (value.provenance ?? []).map((item) => {
    const evidence = item.evidence === undefined ? '' : `，依据：${item.evidence}`
    return `- ${item.path} ← ${item.source}${evidence}${item.valuePreview === undefined ? '' : `（${item.valuePreview}）`}`
  })
  const outputs = (value.outputs ?? []).slice(0, RECEIPT_MAX_LINES).map((output) => {
    if (output.error !== undefined) return `- ${output.path}（${output.type}）：取不到（${output.error}）`
    return `- ${output.path}（${output.type}）：${output.valuePreview ?? '（空）'}`
  })
  return [
    `${head} ${req} ${resp}`,
    value.attempts === undefined ? '' : `尝试：${value.attempts}`,
    provenance.length === 0 ? '' : `值来源：\n${provenance.join('\n')}`,
    outputs.length === 0 ? '' : `卡出参实际值（用来发现绑定）：\n${outputs.join('\n')}`,
    value.runId === undefined ? '' : `留痕：${value.runId}（explorationId ${value.explorationId ?? '?'}）`,
    '下一步：用 dataforge_chain_upsert 把发现的绑定边写回链，再 dataforge_chain_run 整链执行。',
  ].filter(Boolean).join('\n')
}

export function defineChainProbeTool(deps: ChainRunToolDeps) {
  return defineTool({
    name: 'dataforge_chain_probe',
    description: `单节点试探（R-5 首跑）：只对链上的一个节点发**一发**请求，返回请求/响应摘要与卡出参实际值；不消费绑定边、不写链文件、不整链重跑。

值的形状：values = { "<卡字段路径>": { value, source, evidence? } }。
- source=user：用户明确给出的值（evidence 建议写原话）；
- source=agent-inferred：agent 推断的值，**必须给 evidence**；
- source=upstream：来自某次 probe 的响应，**必须给 evidence**（如 probe:<runId> · body.items[0].internalId）；
- 节点 constants 自动标 constant，不用放进 values。

三道门：
- 缺参：在发请求前返回 paused + gaps + 卡入参模板，一个请求都不发；
- 写操作（POST/PUT/PATCH/DELETE）：没有 confirm=true 只出计划卡，一个请求都不发；
- 敏感字段（password/token/secret/authorization/cookie/api-key…）的值在留痕里写 ***。

失败时：invalid-source / unknown-value / node-not-found / base-url-unresolved 在发请求前拒；HTTP 非 2xx、超时、网络错如实落 run 并返回 response 摘要。probe 不换票；需要登录态的节点请先确认凭证，或改走 dataforge_chain_run 的 relogin。

首跑闭环：probe 试探 → 读 outputs 发现绑定 → dataforge_chain_upsert 写边 → dataforge_chain_run 整链。`,
    parameters: {
      site: { type: 'string', required: true, description: '站点名（链的 meta.site）' },
      flow: { type: 'string', required: true, description: '流程名（链的 meta.flow）' },
      version: { type: 'number', description: '链版本；缺省最新' },
      node: { type: 'string', required: true, description: '链上的节点 id（nodes[].id）' },
      values: {
        type: 'object',
        additionalProperties: true,
        description: '卡字段路径 → { value, source, evidence? }；source 只允许 user / agent-inferred / upstream',
      },
      inputs: {
        type: 'object',
        additionalProperties: true,
        description: '链级槽位运行值（给节点常量里的 $inputs.x 用）',
      },
      baseUrl: { type: 'string', description: '目标站点源；缺省从卡的来源页面 origin 推断' },
      confirm: { type: 'boolean', description: '写操作必须显式确认；缺省 = 只出计划卡' },
      retry: { type: 'number', description: '仅 GET/HEAD/OPTIONS 生效；0..3 封顶，写方法强制 0' },
      explorationId: { type: 'string', description: '同一轮首跑的探索组 ID；缺省自动生成 exp_<timestamp>' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          gate: { type: 'string', description: 'executed / paused / confirm-required / failed / blocked' },
          code: { type: 'string' },
          message: { type: 'string' },
          runId: { type: 'string' },
          runDir: { type: 'string' },
          explorationId: { type: 'string' },
          nodeId: { type: 'string' },
          cardId: { type: 'string' },
          method: { type: 'string' },
          gaps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { path: { type: 'string' }, type: { type: 'string' }, target: { type: 'string' } },
            },
          },
          cardInputs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string' },
                type: { type: 'string' },
                required: { type: 'boolean' },
                role: { type: 'string' },
              },
            },
          },
          plan: {
            type: 'object',
            additionalProperties: false,
            properties: {
              nodeId: { type: 'string' },
              method: { type: 'string' },
              urlTemplate: { type: 'string' },
              writes: { type: 'boolean' },
              cardInputs: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string' },
                    type: { type: 'string' },
                    required: { type: 'boolean' },
                    role: { type: 'string' },
                  },
                },
              },
            },
          },
          request: {
            type: 'object',
            additionalProperties: false,
            properties: {
              method: { type: 'string' },
              url: { type: 'string' },
              headers: { type: 'object', additionalProperties: true },
              bodyPreview: { type: 'string' },
            },
          },
          response: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: { type: 'number' },
              bytes: { type: 'number' },
              truncated: { type: 'boolean' },
              bodyPreview: { type: 'string' },
            },
          },
          outputs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string' },
                type: { type: 'string' },
                valuePreview: { type: 'string' },
                redacted: { type: 'boolean' },
                error: { type: 'string' },
              },
            },
          },
          provenance: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string' },
                source: { type: 'string' },
                evidence: { type: 'string' },
                valuePreview: { type: 'string' },
                redacted: { type: 'boolean' },
              },
            },
          },
          attempts: { type: 'number' },
          credentials: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderChainProbe(tighten<ProbeResult>(value)) }],
    },
    async execute(args, exec: ToolRunContext): Promise<ProbeResult> {
      const values = args.values as ChainProbeToolArgs['values'] | undefined
      return lossless(await probeForTool(deps, exec, {
        site: args.site,
        flow: args.flow,
        node: args.node,
        ...(args.version === undefined ? {} : { version: args.version }),
        ...(values === undefined ? {} : { values }),
        ...(args.inputs === undefined ? {} : { inputs: args.inputs }),
        ...(args.baseUrl === undefined ? {} : { baseUrl: args.baseUrl }),
        ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
        ...(args.retry === undefined ? {} : { retry: args.retry }),
        ...(args.explorationId === undefined ? {} : { explorationId: args.explorationId }),
      }))
    },
  })
}

function renderChainRuns(value: ChainRunsToolValue): string {
  if (value.notice !== undefined && (value.runs ?? []).length === 0) return `📭 ${value.notice}`
  const lines = (value.runs ?? []).map((run) => {
    const version = run.version === undefined ? '' : ` v${run.version}`
    const failed = run.failedNode === undefined ? '' : `，断在 ${run.failedNode}`
    const dry = run.dryRun ? '（dry-run）' : ''
    return `- ${run.runId}${version}${dry}：${run.status} ${run.stepsDone}/${run.totalSteps} 步${failed}`
  })
  const notice = value.notice === undefined ? '' : `\n⚠ ${value.notice}`
  return `🗂 链运行留痕 ${(value.runs ?? []).length} 条：\n${lines.join('\n')}${notice}`
}

export function defineChainRunsTool(deps: ChainRunToolDeps) {
  return defineTool({
    name: 'dataforge_chain_runs',
    description: `按链列运行留痕（链详情·运行 tab 的数据面）。

读 run.json 的 chain 段过滤（写入时快照）：链被改名/删掉，历史运行仍能列出。
状态现折叠（与 dataforge_status 同一套投影），所以运行中的链也能看到节点级进度。

失败时：
- 没有任何匹配运行 → ok:true + notice「该链暂无运行留痕」（空态是常态，不是错误）；
- 某条 run.json 损坏 → 跳过并在 notice 里计数，不阻断整批。

只读，天然幂等。要节点级细节（失败原因、请求摘要）用 dataforge_status(run_id)。`,
    parameters: {
      site: { type: 'string', required: true, description: '站点名（链的 meta.site）' },
      flow: { type: 'string', required: true, description: '流程名（链的 meta.flow）' },
      version: { type: 'number', description: '只列这个链版本的运行；缺省 = 该链全部版本' },
      limit: { type: 'number', description: '返回条数上限（缺省 20，上限 200）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          notice: { type: 'string' },
          runs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                runId: { type: 'string' },
                status: { type: 'string' },
                startedAt: { type: 'number' },
                updatedAt: { type: 'number' },
                dryRun: { type: 'boolean' },
                stepsDone: { type: 'number' },
                totalSteps: { type: 'number' },
                version: { type: 'number' },
                failedNode: { type: 'string' },
                flow: { type: 'string' },
                flowName: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderChainRuns(tighten<ChainRunsToolValue>(value)) }],
    },
    async execute(args): Promise<ChainRunsToolValue> {
      return lossless(listChainRunsForTool(deps, {
        site: args.site,
        flow: args.flow,
        ...(args.version === undefined ? {} : { version: args.version }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }))
    },
  })
}
