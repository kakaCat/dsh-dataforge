/**
 * Trace（采集样本流）的只读模型。
 *
 * 设计约束（PRJ-0004 S1）：
 *   - 样本顺序以采集的 `seq` 为准，`ts` 只做展示；
 *   - 请求/响应正文可能来自落盘文件（超过 captureBodyLimitBytes）或 DB 预览；
 *     两者必须区分 `source` 与 `truncated`，不把预览当完整正文；
 *   - 敏感头只保留**名字**，值永不出现在 trace 回执里；
 *   - 这里不出现任何业务系统名称/字段名：分析器只认 HTTP 方法与 JSON 结构。
 *
 * @module dsh-dataforge/trace/types
 */

/** 正文来源：file=落盘完整正文；preview=DB 里的 512 字符预览；none=没有正文。 */
export type TraceBodySource = 'file' | 'preview' | 'none'

/** 脱敏后的头集合：`values` 只含非敏感头，`sensitive` 是敏感头的名字。 */
export type TraceHeaders = {
  values: Record<string, string>
  sensitive: string[]
}

export type TraceSample = {
  id: string
  seq: number
  ts: number
  method: string
  url: string
  /** URL path（不含 query）；分析器用它做接口身份与静态资源过滤。 */
  path: string
  /** 解析后的 query（重复 key 取最后一个；仅用于分析，不含敏感头）。 */
  query: Record<string, string>
  status?: number
  pageUrl?: string
  requestHeaders: TraceHeaders
  requestBody?: string
  requestBodySource: TraceBodySource
  requestBodyTruncated: boolean
  responseHeaders: TraceHeaders
  responseBody?: string
  responseBodySource: TraceBodySource
  responseBodyTruncated: boolean
  /** 采集库原始 truncated 位（正文落盘/显式截断都算 true）。 */
  truncated: boolean
  cardId?: string
  mergeKey?: string
  actionLabel?: string
}

export type TraceStats = {
  /** 采集库里该 capture 的样本总数（不受 limit 影响）。 */
  totalSamples: number
  /** 本次返回的样本数。 */
  returnedSamples: number
  /** 去重后的接口数（method + path）。 */
  interfaces: number
  /** 写操作数（非 GET/HEAD/OPTIONS）。 */
  writes: number
  /** 页面数。 */
  pages: number
  /** 正文被截断的样本数。 */
  truncatedBodies: number
}

export type TraceWarning = {
  code: string
  message: string
  sampleId?: string
}

export type Trace = {
  captureId: string
  entryUrl: string
  status?: string
  samples: TraceSample[]
  stats: TraceStats
  warnings: TraceWarning[]
}

export type TraceReadOptions = {
  /** 最多返回多少条样本（1..2000，缺省 200）。 */
  limit?: number
  /** 单条正文最多读取多少字符（256..65536，缺省 8192）。 */
  bodyLimit?: number
  /** 是否对正文做展示脱敏（工具回执 true；分析 false）。 */
  redactBodies?: boolean
  /** 是否包含正文（工具可关；分析必须 true）。 */
  includeBodies?: boolean
}

export type TraceFailure = {
  ok: false
  code: 'capture-not-found' | 'capture-empty' | 'capture-unreadable' | 'bad-capture-id'
  error: string
  hints?: string[]
}

export type TraceGetToolValue =
  | ({
      ok: true
      captureId: string
      entryUrl: string
      status?: string
      stats: TraceStats
      samples: TraceSample[]
      warnings: TraceWarning[]
    })
  | TraceFailure
