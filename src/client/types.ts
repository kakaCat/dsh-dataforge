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

export type PageRow = {
  id: string
  url: string
  depth: number
  status: string
  /** 采集时记录的 document.title（旧数据没有）。 */
  title?: string
  /** 采集时记录的站点名（og:site_name / 标题推断；旧数据没有）。 */
  siteName?: string
}

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
  /** 跨页归并键（method + 路径 + query 键集合）：接口手工改名的持久化键。 */
  mergeKey: string
  /** 服务端给出的可读接口名（自动名或手工名）。 */
  name: string
  /** 名称来源：auto = 自动取名（可被手工名覆盖）；manual = 面板手工改名。 */
  nameSource?: 'auto' | 'manual'
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

/* ───────────────────────── 三级名称（网站 / 页面 / 接口） ───────────────────────── */

/**
 * 采集时记录的页面元数据（GET /page-meta 投影）。
 *
 * `url` 是 `pageIdentityOf` 归一后的页面身份；`title` / `siteName` 取自采集中
 * 记录的 document.title 与 og:site_name（缺省 = 采集时没拿到，不是空名）。
 */
export type PageMetaRow = {
  url: string
  title?: string
  siteName?: string
  visitedAt: number
}

/** 手工名称覆盖（GET /names 投影；键：sites=小写 host，pages=pageIdentityOf，interfaces=mergeKey）。 */
export type NameMaps = {
  sites: Record<string, string>
  pages: Record<string, string>
  interfaces: Record<string, string>
}

/** 面板手工改名的入口（POST /names 的入参 kind）。 */
export type NameKind = 'site' | 'page' | 'interface'

/** POST /retitle 回执：accepted=false 时 reason 说明为什么没发起。 */
export type RetitleStartResult = {
  accepted: boolean
  targets: number
  hosts: number
  reason?: 'busy' | 'no-targets' | 'capture-running'
}

/** GET /retitle/status 投影（补抓名称的进度/结果）。 */
export type RetitleStatus = {
  running: boolean
  targets: number
  tried: number
  updated: number
  failed: number
  skipped: number
  startedAt?: number
  finishedAt?: number
  error?: string
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

/* ───────────────────────────── 编排页（R-2） ───────────────────────────── */

/** 版本来源（服务端 meta.source 的原样投影）。 */
export type ChainSource = 'agent' | 'canvas' | 'import'

export type OrchestrationVersion = {
  version: number
  created?: string
  source?: ChainSource
  /** 该版本的 meta.note（版本说明）。 */
  note?: string
  nodeCount?: number
  edgeCount?: number
  /** 是否已被更新的版本取代（非最新版）。 */
  superseded: boolean
  unreadable?: string
}

export type OrchestrationFlow = {
  site: string
  flow: string
  kind?: 'interface-chain' | 'page-chain'
  domain?: string
  note?: string
  latest?: number
  updatedAt?: string
  nodeCount?: number
  edgeCount?: number
  versions: OrchestrationVersion[]
  unreadable?: string
}

export type OrchestrationSite = {
  site: string
  pageFlows: number
  apiFlows: number
  flows: number
  updatedAt?: string
  domains: string[]
  /** 链引用的卡/页面 host（原型网站卡的 host 行）。 */
  hosts: string[]
}

export type OrchestrationOverview = {
  sites: OrchestrationSite[]
  flows: OrchestrationFlow[]
  chainsRootHint: string
}

export type CanvasNode = {
  id: string
  card?: string
  page?: string
  constants: Record<string, string>
  layout?: { x: number; y: number }
}

export type CanvasEdge = { from: string; to: string; suggested?: boolean }

/** 卡的画布投影（字段路径表用于连线绑定下拉）。 */
export type CardProjection = {
  name?: string
  method: string
  urlTemplate: string
  inputs: Array<{ path: string; type: string; required?: boolean }>
  outputs: Array<{ path: string; type: string; required?: boolean }>
}

/** 链级入参槽位（画布原样带回，不解释）。 */
export type ChainInputSlot = {
  name: string
  type: string
  required: boolean
  example?: string
}

/** 画布的可编辑链文档副本（服务端给的完整 JSON，保存时原样带回）。 */
export type ChainDocLike = {
  apiVersion: string
  kind: 'interface-chain' | 'page-chain'
  meta: {
    site: string
    flow: string
    version: number
    created: string
    domain?: string
    note?: string
    source?: ChainSource
  }
  inputs: ChainInputSlot[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** GET /orchestration/graph 的回执（画布渲染输入）。 */
export type ChainGraph = {
  site: string
  flow: string
  version: number
  kind: 'interface-chain' | 'page-chain'
  domain?: string
  note?: string
  source?: ChainSource
  created?: string
  chainYaml: string
  doc: ChainDocLike
  /** 节点引用的卡投影（method/url/name + 字段路径表，零凭证）；读不到就没有该键。 */
  cards: Record<string, CardProjection>
  versions: number[]
}

/** GET /orchestration/palette：画布左栏可拖入的卡与页面。 */
export type PaletteCard = {
  cardId: string
  name?: string
  method: string
  urlTemplate: string
  inputCount: number
  outputCount: number
}

export type OrchestrationPalette = {
  cards: PaletteCard[]
  pages: string[]
  truncated?: string
}

/** POST /orchestration/graph 的回执。 */
export type ChainSaveResult = {
  ok: boolean
  version?: number
  path?: string
  code?: string
  issues?: Array<{ target: string; code: string; reason: string }>
  warnings?: Array<{ target: string; code: string; reason: string }>
}


/* ───────────────────────── UI 测试（浏览器录制 + 回放） ───────────────────────── */

/** 页面断言（与服务端 ui-script 契约同形；客户端只做展示，不重复校验）。 */
export type UiExpectLike = {
  kind: string
  selector?: string
  equals?: string | number
  contains?: string
}

/** 回放步骤。 */
export type UiStepLike = {
  id: string
  kind: string
  selector?: string
  candidates?: string[]
  value?: string
  key?: string
  url?: string
  ms?: number
  files?: string[]
  expect?: UiExpectLike[]
  at?: string
}

/** 脚本入参槽位。 */
export type UiInputLike = {
  name: string
  type: string
  required: boolean
  example?: string
}

/** ui-script 文档（面板展示用；字段与服务端契约一一对应）。 */
export type UiScriptDocLike = {
  apiVersion: string
  kind: string
  meta: {
    site: string
    flow: string
    version: number
    created: string
    source?: string
    startUrl: string
    domain?: string
    note?: string
    viewport?: { width: number; height: number }
  }
  inputs: UiInputLike[]
  steps: UiStepLike[]
}

/** 版本摘要。 */
export type UiScriptVersionInfo = {
  version: number
  created?: string
  source?: string
  stepCount?: number
  startUrl?: string
  note?: string
  unreadable?: string
}

/** 脚本列表行（overview）。 */
export type UiScriptRef = {
  site: string
  flow: string
  latest: number
  versions: number[]
  domain?: string
  updatedAt?: string
  unreadable?: string
  versionsInfo?: UiScriptVersionInfo[]
}

/** UI 回放运行行（/ui-tests/runs）。 */
export type UiRunRow = {
  runId: string
  status: string
  site: string
  flow: string
  version: number
  startUrl: string
  startedAt: number
  finishedAt?: number
  totalSteps?: number
  stepsDone?: number
  failedStep?: string
  error?: string
  screenshot?: string
}

/** 录制会话。 */
export type UiRecordingSessionView = {
  sessionId: string
  pageUrl: string
  recording: boolean
  startedAt: number
}

/** 面板 overview。 */
export type UiOverview = {
  generatedAt: number
  scripts: UiScriptRef[]
  runs: UiRunRow[]
  sessions: UiRecordingSessionView[]
  uiTestsRootHint: string
  /** 当前浏览器引擎（配置 uiTestBrowser 解析后的结果）。 */
  browser?: {
    engine: string
    label: string
    available: boolean
    degraded?: string
    installCommand?: string
  }
}

/** 单版本脚本详情。 */
export type UiScriptDetail = {
  site: string
  flow: string
  version: number
  availableVersions: number[]
  yaml: string
  doc: UiScriptDocLike
}

/** 停止录制回执（面板只消费展示字段）。 */
export type UiRecordStopResult = {
  ok: boolean
  sessionId?: string
  startUrl?: string
  steps?: UiStepLike[]
  stepCount?: number
  skippedSecrets?: number
  skippedUploads?: number
  notice?: string
  saved?: { site: string; flow: string; version: number; path: string }
  persistedCookies?: number
  error?: string
}

/** 回放计划卡 / 执行回执。 */
export type UiRunResponse = {
  ok: boolean
  gate?: string
  code?: string
  message?: string
  missing?: string[]
  plan?: {
    site: string
    flow: string
    version: number
    startUrl: string
    stepCount: number
    writeSteps: number
    steps: Array<{ id: string; kind: string; target?: string; value?: string }>
    inputs: Record<string, string>
    card?: string
  }
  result?: {
    runId: string
    success: boolean
    site: string
    flow: string
    version: number
    startUrl: string
    totalSteps: number
    stepsDone: number
    steps: Array<{
      id: string
      kind: string
      ok: boolean
      target?: string
      elapsedMs: number
      error?: string
      assertions: Array<{ kind: string; ok: boolean; expected?: string; actual?: string; elapsedMs: number; error?: string }>
    }>
    failedStep?: { id: string; kind: string; ok: boolean; error?: string }
    screenshot?: string
    dom?: string
    error?: string
    elapsedMs: number
    cookiesApplied: number
  }
}

/** 运行详情事件（扁平投影）。 */
export type UiRunEventRow = {
  event: string
  ts?: number
  id?: string
  kind?: string
  status?: string
  stepId?: string
  selector?: string
  expected?: string
  actual?: string
  elapsed?: number
  error?: string
  success?: boolean
  message?: string
  screenshot?: string
  dom?: string
}

/** 运行详情。 */
export type UiRunDetail = {
  run: UiRunRow
  events: UiRunEventRow[]
}


/** 页面点选结果（选择器候选 + 元素摘要）。 */
export type UiPickResult = {
  ok: boolean
  cancelled?: boolean
  sessionId?: string
  pageUrl?: string
  selector?: string
  candidates?: string[]
  element?: { tag: string; id: string; text: string }
  error?: string
}


/* ───────────────────────── UI 批量回归（M3） ───────────────────────── */

export type UiBatchPlanItem = {
  index: number
  site: string
  flow: string
  version?: number
  stepCount: number
  writeSteps: number
  missing: string[]
  error?: string
}

export type UiBatchPlan = {
  selection: 'flows' | 'site' | 'all'
  site?: string
  total: number
  limit: number
  items: UiBatchPlanItem[]
  missingInputs: string[]
  writeSteps: number
  card?: string
}

export type UiBatchItemResult = {
  index: number
  site: string
  flow: string
  version?: number
  runId?: string
  success: boolean
  skipped?: boolean
  error?: string
  stepsDone?: number
  totalSteps?: number
  failedStep?: string
  screenshot?: string
  elapsedMs?: number
}

export type UiBatchRecord = {
  batchId: string
  status: string
  startedAt: number
  finishedAt?: number
  selection: string
  site?: string
  total: number
  passed: number
  failed: number
  skipped: number
  elapsedMs?: number
  items: UiBatchItemResult[]
  report?: string
  reportJson?: string
}

export type UiBatchResponse = {
  ok: boolean
  gate?: string
  code?: string
  message?: string
  plan?: UiBatchPlan
  result?: {
    batchId: string
    selection: string
    site?: string
    total: number
    passed: number
    failed: number
    skipped: number
    elapsedMs: number
    items: UiBatchItemResult[]
    report: string
    reportJson: string
  }
}


/** 运行产物行（GET /artifacts）。 */
export type ArtifactList = {
  artifacts: ArtifactRow[]
  total: number
  limit: number
  offset: number
}

export type ArtifactRow = {
  runId: string
  kind: 'chain' | 'ui' | 'unknown'
  status?: string
  site?: string
  flow?: string
  createdAt?: string
  hasDataset: boolean
  hasReport: boolean
  datasetSize?: number
}
