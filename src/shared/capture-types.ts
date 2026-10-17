/**
 * 采集域共享类型。
 *
 * 全部用 type 别名：工具 output.schema 推断要求 Record 兼容（interface 会被
 * 没有 implicit index signature 的规则卡死，现有代码注释已警告过，勿改回）。
 *
 * @module dsh-dataforge/capture-types
 */

export type CaptureTaskType = 'single_page' | 'site_crawl' | 'action'

export type FieldRole = 'constant' | 'input' | 'chain' | 'credential'

export type FieldLocation = 'path' | 'query' | 'header' | 'body'

export type TemplateField = {
  field: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  sample: string
  role: FieldRole
  unverified: boolean
  location?: FieldLocation
}

export type Template = {
  fields: TemplateField[]
  codePath?: string
  pathParams?: string[]
}

export type CaptureStatus = 'running' | 'done' | 'failed' | 'cancelled'

/**
 * 鉴权标志 v1.3(FR-3.7):探测只记触发来源,凭证值永不入卡、永不入回执(红线)。
 */
export type AuthType = 'none' | 'token-header' | 'token-param' | 'cookie-session' | 'unknown'

/** type 别名 == 隐式索引签名。 */
export type CardRow = {
  id: string
  captureId: string
  name?: string
  urlTemplate: string
  method: string
  requestTemplate?: Template
  responseTemplate?: Template
  authBinding?: { cookies: number; storageKeys: number }
  authType?: AuthType
  authEvidence?: string
  relatedPageUrls: string[]
  sampleCount: number
  createdAt: number
}

export type RelationRow = {
  id: string
  captureId: string
  cardId: string
  pageId?: string
  pageUrl: string
  paramsFingerprint: string
  firstSeenAt: number
  lastSeenAt: number
  sampleCount: number
}

export type SampleRow = {
  id: string
  captureId: string
  pageUrl: string
  seq: number
  url: string
  method: string
  status?: number
  requestHeaders: Record<string, string>
  requestBodyPath?: string
  requestBodyPreview?: string
  responseHeaders: Record<string, string>
  responseBodyPath?: string
  responsePreview?: string
  truncated: boolean
  ts: number
  /** 回指「页面 × 接口 × 形态」关系行（关系模型引入前的历史样本缺省）。 */
  relationId?: string
}

export type CredentialRow = {
  id: string
  captureId: string
  kind: 'cookie' | 'localStorage' | 'token'
  url: string
  name: string
  valueJson?: string
  obtainedAt: number
}

export type PageRow = {
  id: string
  captureId: string
  url: string
  depth: number
  status: 'ok' | 'error' | 'skipped-external'
}

export type CaptureRunRow = {
  id: string
  taskType: CaptureTaskType
  entryUrl: string
  status: CaptureStatus
  startedAt: number
  endedAt?: number
  stats: { pages: number; requests: number; cards: number; credentials: number }
  error?: string
  /** 诚实边界提示（如样本上限截断、降级执行）；狀态机不变，仅附注。 */
  notice?: string
}
