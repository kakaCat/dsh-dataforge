/**
 * 共享词汇：流程元数据、NDJSON 事件、运行摘要。
 *
 * 与引擎侧 `dsh_bridge.py` 的事件契约一一对应：
 *   {event:'meta'|'step'|'terminal'|'result', ...}
 *
 * @module dsh-dataforge/shared/types
 */

/** 一个已发现流程（流程包里的一份 yaml）。 */
export interface FlowInfo {
  /** 流程名（yaml 的 name；冲突时高优先级包赢）。 */
  name: string
  /** 流程 yaml 绝对路径。 */
  flowPath: string
  /** 包来源（builtin / dataRoot / workspace 的展示名）。 */
  pack: string
  /** yaml description（可缺）。 */
  description?: string
  /** 必填输入（闸 1 校验对象）。 */
  requiredFields: FlowField[]
  /** 可选输入。 */
  optionalFields: FlowField[]
}

export interface FlowField {
  field: string
  label: string
}

/** dsh_bridge 吐出的 NDJSON 事件（弱类型透传：契约在 README）。 */
export interface BridgeEvent {
  event: 'meta' | 'step' | 'terminal' | 'result'
  /** step 事件。 */
  id?: string
  action?: string
  status?: 'start' | 'done' | 'error'
  elapsed?: number
  data?: Record<string, unknown>
  error?: string
  /** terminal 事件。 */
  name?: string
  success?: boolean
  message?: string
  /** meta / result 事件共用。 */
  steps?: string[]
  dryRun?: boolean
  /** result 事件。 */
  businessData?: Record<string, unknown>
  [key: string]: unknown
}

/** JSON 可序列化叶子（循环安全版 JsonValue）：businessData 只装业务标量/嵌套 JSON。 */
export type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike }

/** dataforge_status 的投影：把事件流折成一张运行摘要。type 别名 == 有隐式索引签名（工具 schema 推断要求 Record 兼容；interface 会断言失败，勿改回）。 */
export type RunSummary = {
  runId: string
  flow: string
  flowName: string
  jobId?: string
  startedAt: number
  updatedAt: number
  status: 'running' | 'completed' | 'failed' | 'killed' | 'unknown'
  dryRun: boolean
  totalSteps: number
  stepsDone: number
  lastStepId?: string
  lastError?: string
  success?: boolean
  businessData?: Record<string, JsonLike>
  /** 结束消息（terminal.message）。 */
  message?: string
}

/** 预检结果：引擎/python/桥是否可用。 */
export interface EnginePreflight {
  ok: boolean
  engineRoot?: string
  bridgePath?: string
  reasons: string[]
}

/** 任意可 JSON 化对象（采集正文解析用；仅作形状标注，运行时以 JSON.parse 后按需收紧）。 */
export type RawJson = { [key: string]: unknown }
