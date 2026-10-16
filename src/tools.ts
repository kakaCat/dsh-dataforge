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
