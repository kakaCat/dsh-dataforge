/**
 * 客户端半自包含类型：只列两个页面实际消费的字段，不 import 服务端类型。
 * （pm-client 同款纪律：client 半零跨包 import，服务端字段增删不会隐式漂移进页面。）
 *
 * @module dsh-dataforge/client/types
 */

export type TemplateField = {
  field: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  sample: string
  role: string
  unverified: boolean
  /** 入参位置（A8）：path / query / header / body；缺省为旧数据。 */
  location?: 'path' | 'query' | 'header' | 'body'
}

export type Template = {
  fields: TemplateField[]
  /** 路径参数语义名列表（A8；缺省为旧数据）。 */
  pathParams?: string[]
  codePath?: string
}

export type AuthBinding = { cookies: number; storageKeys: number }

export type RunRow = {
  id: string
  taskType: string
  entryUrl: string
  status: string
  startedAt: number
  endedAt?: number
  stats: { pages: number; requests: number; cards: number; credentials: number }
  error?: string
  /** 诚实边界提示（如实弃采/降级说明；缺省为旧数据）。 */
  notice?: string
}

export type PageRow = { id: string; url: string; depth: number; status: string }

export type SampleRow = {
  id: string
  pageUrl: string
  seq: number
  url: string
  method: string
  status?: number
  requestBodyPreview?: string
  responsePreview?: string
  truncated: boolean
  ts: number
}

export type CredentialRow = { id: string; kind: string; url: string; name: string; obtainedAt: number }

/** 单条「页面×接口」关系投影（A7；引用行，字段与 capture-types.ts RelationRow 同名对齐）。 */
export type RelationRow = {
  cardId: string
  pageUrl: string
  paramsFingerprint: string
  sampleCount: number
  pageId?: string
}

export type RunDetail = {
  run: RunRow
  pages: PageRow[]
  samples: SampleRow[]
  credentials: CredentialRow[]
  /** 本 run 采到的接口卡（采集页结果区用）。 */
  cards?: CardRow[]
  /** 页面 × 接口 × 形态关系行（采集页结果区的分组依据）。 */
  relations?: RelationRow[]
}

export type CardRow = {
  id: string
  captureId: string
  name?: string
  urlTemplate: string
  method: string
  requestTemplate?: Template
  responseTemplate?: Template
  authBinding?: AuthBinding
  /** 鉴权标志（A8）：token-header / token-param / cookie-session / none / unknown。 */
  authType?: string
  /** 鉴权判定依据摘要：命中了哪个头/参数（不含凭证值）。 */
  authEvidence?: string
  relatedPageUrls: string[]
  sampleCount: number
  createdAt: number
}

/** POST /captures 回执投影（panel-routes ok(data) 的 data 段）。 */
export type CaptureStartResult = {
  accepted: boolean
  gate: string
  captureId?: string
  degradedNotice?: string
  card?: string
}

/** 站点页「重采」跨页动线的种子：url 预填快速采集输入框；nonce 让重复点同页也能再次预填。 */
export type RecaptureSeed = { url: string; nonce: number }
