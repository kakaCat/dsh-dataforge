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

export type TemplateField = {
  field: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  sample: string
  role: FieldRole
  /** 单样本未验证（无法 diff）；多样本 diff 后 false。 */
  unverified: boolean
}

export type Template = {
  fields: TemplateField[]
  codePath?: string
}

export type CaptureStatus = 'running' | 'done' | 'failed' | 'cancelled'

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
  relatedPageUrls: string[]
  sampleCount: number
  createdAt: number
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
}
