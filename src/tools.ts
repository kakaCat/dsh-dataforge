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
import type {
  CardRow, CaptureRunRow, CredentialRow, PageRow, SampleRow,
} from './shared/capture-types.js'
import type { RunSummary } from './shared/types.js'

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
      return await listFlows(deps, exec)
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
      return await runFlow(deps, exec, {
        flow: args.flow,
        params: args.params,
        ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
        ...(args.dry_run === undefined ? {} : { dryRun: args.dry_run }),
      })
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
  const lines = value.runs.map((r) =>
    `- ${r.runId}：${r.status} ${r.stepsDone}/${r.totalSteps} 步${r.businessData?.poNo === undefined ? '' : ` PO=${String(r.businessData.poNo)}`}`)
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
      return runStatus(deps, args.run_id)
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
  return `🚀 采集已启动（captureId ${value.captureId ?? '?'}）：site_crawl 是后台任务，用 dataforge_capture_status 轮询，完成后 dataforge_capture_result(scope=cards) 取卡。`
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
      return await startCapture(deps, {
        taskType,
        entryUrl: args.entry_url,
        ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
        ...(args.max_depth === undefined ? {} : { maxDepth: args.max_depth }),
        ...(args.max_pages === undefined ? {} : { maxPages: args.max_pages }),
      } satisfies StartCaptureArgs)
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
      return captureStatus(deps, args.capture_id)
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
      render: (_args, value) => {
        const v = tighten<CaptureResultValue>(value)
        if (v.notice !== undefined) return [{ type: 'text', text: `📭 ${v.notice}` }]
        return [{ type: 'text', text: `📦 ${v.items?.length ?? 0} 条记录（详见 items）` }]
      },
    },
    async execute(args) {
      if (args.scope !== 'cards' && args.scope !== 'samples' && args.scope !== 'credentials' && args.scope !== 'pages') {
        return { ok: false, notice: `scope 非法：${String(args.scope)}（cards | samples | credentials | pages）` }
      }
      return captureResult(deps, args.capture_id, args.scope, args.limit)
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
      return captureCancel(deps, args.capture_id)
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
      return deps.registry.open(args.entry_url === undefined ? {} : { entryUrl: args.entry_url })
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
      return await deps.registry.act(args.session_id, spec)
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
      return await deps.registry.snapshot(args.session_id)
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
        const run = deps.store.getRun(closed.captureId)
        if (run?.status === 'running') deps.store.finishRun(closed.captureId, 'done')
      }
      return closed
    },
  })
}
