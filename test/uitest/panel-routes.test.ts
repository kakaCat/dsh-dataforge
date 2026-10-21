/**
 * UI 测试面板数据路由：overview / script 读写 / 回放闸门 / 证据白名单。
 *
 * 不启动真浏览器（录制会话用假 registry；回放只测不带 confirm 的闸门）。
 *
 * @module dsh-dataforge/test/uitest/panel-routes
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createUiTestPanelHandler, isUiTestRequest } from '../../src/uitest/panel-routes.js'
import type { UiTestDeps } from '../../src/uitest/application.js'
import { AgentRecordingSessions } from '../../src/uitest/agentrec.js'
import type { UiBrowserEngine, UiEngineOpenArgs } from '../../src/uitest/engines.js'

let dir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-ui-panel-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function workspace(): string {
  return dir as string
}

function fakeEngine(overrides: Partial<UiBrowserEngine> = {}): UiBrowserEngine {
  return {
    kind: 'playwright',
    label: '假引擎',
    managesCookies: false,
    available: () => true,
    open: async () => ({ ok: true, sessionId: 'uis_x', pageUrl: 'https://example.com/' }),
    start: async () => ({ ok: true, pageUrl: 'https://example.com/' }),
    stop: async () => ({ ok: true, result: { startUrl: 'https://example.com/', viewport: { width: 1280, height: 720 }, steps: [], skippedSecrets: 0, skippedUploads: 0, singleCandidateSteps: 0, totalSteps: 0 } }),
    cookiesOf: async () => [],
    close: async () => ({ ok: true }),
    list: () => [],
    pageUrlOf: () => undefined,
    has: () => false,
    closeAll: async () => undefined,
    pickSelector: async () => ({
      ok: true,
      sessionId: 'uis_x',
      pageUrl: 'https://example.com/',
      selector: '#kw',
      candidates: ['#kw', 'input[name="q"]'],
      element: { tag: 'INPUT', id: 'kw', text: '' },
    }),
    pageMeta: async () => ({ url: 'https://example.com/', title: '示例页 - 示例站', siteName: '示例站' }),
    run: async () => ({
      runId: 'uir_fake', site: '示例站', flow: '搜索', version: 1, startUrl: 'https://example.com/',
      success: true, totalSteps: 0, stepsDone: 0, steps: [], elapsedMs: 1, cookiesApplied: 0,
    }),
    ...overrides,
  }
}

function deps(overrides: Partial<UiTestDeps> = {}): UiTestDeps {
  return {
    resolveWorkspaceRoot: async () => workspace(),
    dataRoot: join(workspace(), 'data'),
    enabled: true,
    resolveEngine: () => ({ engine: fakeEngine() }),
    batchEngine: fakeEngine(),
    agentSessions: new AgentRecordingSessions(),
    agentSecrets: {},
    ...overrides,
  }
}

const SCRIPT_YAML = `apiVersion: dataforge/v1
kind: ui-script
meta:
  site: 示例站
  flow: 搜索
  version: 1
  created: '2026-10-17T21:00:00+08:00'
  startUrl: https://example.com/
inputs:
  - name: keyword
    type: string
    required: true
steps:
  - id: s1
    kind: goto
    url: https://example.com/
  - id: s2
    kind: fill
    selector: '#kw'
    value: '{{keyword}}'
`

interface FakeResponse { status: number; body: string }

async function serve(method: string, url: string, body?: unknown, overrides: Partial<UiTestDeps> = {}): Promise<FakeResponse> {
  const captured: FakeResponse = { status: 0, body: '' }
  const res = {
    statusCode: 0,
    setHeader: () => undefined,
    end: (payload: string) => {
      captured.status = res.statusCode === 0 ? 200 : res.statusCode
      captured.body += payload
    },
  }
  const text = body === undefined ? undefined : JSON.stringify(body)
  const req = {
    method,
    url,
    on: (event: string, cb: (chunk?: unknown) => void) => {
      if (event === 'data' && text !== undefined) cb(Buffer.from(text, 'utf8'))
      if (event === 'end') cb()
    },
  } as unknown as IncomingMessage
  const handler = createUiTestPanelHandler({
    deps: deps(overrides),
    resolveWorkspaceRoot: async () => workspace(),
  })
  handler(req, res as unknown as ServerResponse)
  for (let i = 0; i < 50; i += 1) {
    if (captured.body !== '') break
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return captured
}

function json(response: FakeResponse): { success: boolean; data?: Record<string, unknown>; error?: string; code?: string } {
  return JSON.parse(response.body) as { success: boolean; data?: Record<string, unknown>; error?: string; code?: string }
}

describe('isUiTestRequest', () => {
  it('两种 URL 形态都认', () => {
    expect(isUiTestRequest('/dashboard/api/dataforge/ui-tests/overview')).toBe(true)
    expect(isUiTestRequest('/ui-tests/runs')).toBe(true)
    expect(isUiTestRequest('/dashboard/api/dataforge/runs')).toBe(false)
    expect(isUiTestRequest('/orchestration/overview')).toBe(false)
  })
})

describe('UI 测试面板路由', () => {
  it('空态：overview 返回空脚本/运行/会话', async () => {
    const response = await serve('GET', '/dashboard/api/dataforge/ui-tests/overview')
    expect(response.status).toBe(200)
    const value = json(response)
    expect(value.success).toBe(true)
    expect(value.data?.['scripts']).toEqual([])
    expect(value.data?.['runs']).toEqual([])
  })

  it('写脚本 → overview 出现 → 详情可读', async () => {
    const saved = await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { yaml: SCRIPT_YAML })
    expect(json(saved).success).toBe(true)
    const savedData = json(saved).data as { version: number }
    expect(savedData.version).toBe(1)

    const overview = json(await serve('GET', '/dashboard/api/dataforge/ui-tests/overview'))
    const scripts = overview.data?.['scripts'] as Array<{ site: string; flow: string; latest: number; versions: Array<{ stepCount?: number }> }>
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.latest).toBe(1)
    expect(scripts[0]?.versions[0]?.stepCount).toBe(2)

    const detail = json(await serve('GET', '/dashboard/api/dataforge/ui-tests/script?site=%E7%A4%BA%E4%BE%8B%E7%AB%99&flow=%E6%90%9C%E7%B4%A2'))
    expect(detail.success).toBe(true)
    const doc = detail.data?.['doc'] as { steps: unknown[] }
    expect(doc.steps).toHaveLength(2)
  })

  it('面板编辑器保存整份 doc → 新版本（source=canvas）', async () => {
    await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { yaml: SCRIPT_YAML })
    const detail = json(await serve('GET', '/dashboard/api/dataforge/ui-tests/script?site=%E7%A4%BA%E4%BE%8B%E7%AB%99&flow=%E6%90%9C%E7%B4%A2'))
    const doc = detail.data?.['doc'] as Record<string, unknown>
    const steps = doc['steps'] as Array<Record<string, unknown>>
    steps[1] = {
      ...steps[1],
      expect: [{ kind: 'text', selector: '#echo', equals: '{{keyword}}' }],
    }
    const saved = await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { doc })
    expect(json(saved).success).toBe(true)
    const savedData = json(saved).data as { version: number }
    expect(savedData.version).toBe(2)

    const v2 = json(await serve('GET', '/dashboard/api/dataforge/ui-tests/script?site=%E7%A4%BA%E4%BE%8B%E7%AB%99&flow=%E6%90%9C%E7%B4%A2&version=2'))
    const v2doc = v2.data?.['doc'] as { meta: { source?: string }; steps: Array<{ expect?: unknown[] }> }
    expect(v2doc.meta.source).toBe('canvas')
    expect(v2doc.steps[1]?.expect).toHaveLength(1)
  })

  it('另存为新流程：改 meta.site/flow 的整份 doc → 独立流程 v1，原流程不受影响', async () => {
    await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { yaml: SCRIPT_YAML })
    const detail = json(await serve('GET', '/dashboard/api/dataforge/ui-tests/script?site=%E7%A4%BA%E4%BE%8B%E7%AB%99&flow=%E6%90%9C%E7%B4%A2'))
    const doc = detail.data?.['doc'] as Record<string, unknown>
    const meta = doc['meta'] as Record<string, unknown>
    const variant = { ...doc, meta: { ...meta, site: '示例站', flow: '搜索-变体' } }
    const saved = await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { doc: variant })
    const savedData = json(saved).data as { site: string; flow: string; version: number }
    expect(savedData.flow).toBe('搜索-变体')
    expect(savedData.version).toBe(1)

    const overview = json(await serve('GET', '/dashboard/api/dataforge/ui-tests/overview'))
    const scripts = overview.data?.['scripts'] as Array<{ site: string; flow: string; latest: number }>
    expect(scripts.map((item) => `${item.site}/${item.flow}@${item.latest}`)).toEqual(['示例站/搜索@1', '示例站/搜索-变体@1'])
  })

  it('面板打开浏览器：?session= 作为共享浏览器 owner 传给引擎', async () => {
    let openedArgs: UiEngineOpenArgs | undefined
    const response = await serve('POST', '/dashboard/api/dataforge/ui-tests/record/open?session=session-test', {
      startUrl: 'https://example.com/',
      headless: false,
    }, {
      resolveEngine: () => ({
        engine: fakeEngine({
          open: async (args) => {
            openedArgs = args
            return { ok: true, sessionId: 'uis_x', pageUrl: 'https://example.com/' }
          },
        }),
      }),
    })
    expect(json(response).success).toBe(true)
    expect(openedArgs?.owner).toBe('session-test')
    const data = json(response).data as { suggestedSite?: string; suggestedFlow?: string }
    expect(data.suggestedSite).toBe('示例站')
    expect(data.suggestedFlow).toBe('示例页')
  })

  it('回放：slowMoMs/headless 透传给引擎', async () => {
    await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { yaml: SCRIPT_YAML })
    let runOptions: Record<string, unknown> | undefined
    const fakeResult = {
      runId: 'uir_fake', site: '示例站', flow: '搜索', version: 1, startUrl: 'https://example.com/',
      success: true, totalSteps: 1, stepsDone: 1, steps: [], elapsedMs: 1, cookiesApplied: 0,
    }
    const response = await serve('POST', '/dashboard/api/dataforge/ui-tests/run', {
      site: '示例站',
      flow: '搜索',
      inputs: { keyword: '键盘精灵' },
      confirm: true,
      slowMoMs: 500,
      headless: false,
    }, {
      resolveEngine: () => ({
        engine: fakeEngine({
          run: async (_doc, _inputs, options) => {
            runOptions = options as Record<string, unknown>
            return fakeResult
          },
        }),
      }),
    })
    expect(json(response).success).toBe(true)
    expect(runOptions?.slowMoMs).toBe(500)
    expect(runOptions?.headless).toBe(false)
  })

  it('面板点选：返回候选 selector；录制中/无会话时是 ok:false 数据不是 5xx', async () => {
    const picked = json(await serve('POST', '/dashboard/api/dataforge/ui-tests/record/pick', { sessionId: 'uis_x' }))
    expect(picked.success).toBe(true)
    expect((picked.data as { selector?: string }).selector).toBe('#kw')

    const noSession = json(await serve('POST', '/dashboard/api/dataforge/ui-tests/record/pick', { sessionId: 'uis_missing' }, {
      resolveEngine: () => ({ engine: fakeEngine({ pickSelector: async () => ({ ok: false, error: '缺少会话' }) }) }),
    }))
    expect(noSession.success).toBe(true)
    expect((noSession.data as { ok: boolean }).ok).toBe(false)
  })

  it('坏 YAML：400 + 可读错误，不落盘', async () => {
    const response = await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { yaml: 'kind: ui-script' })
    expect(response.status).toBe(400)
    expect(json(response).success).toBe(false)
  })

  it('回放缺必填入参：missing-inputs 闸（不起浏览器）', async () => {
    await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { yaml: SCRIPT_YAML })
    const response = await serve('POST', '/dashboard/api/dataforge/ui-tests/run', { site: '示例站', flow: '搜索' })
    const value = json(response)
    expect(value.success).toBe(true)
    const data = value.data as { ok: boolean; gate?: string; missing?: string[] }
    expect(data.ok).toBe(false)
    expect(data.gate).toBe('missing-inputs')
    expect(data.missing).toEqual(['keyword'])
  })

  it('回放不带 confirm：confirm-required 计划卡（不起浏览器）', async () => {
    await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { yaml: SCRIPT_YAML })
    const response = await serve('POST', '/dashboard/api/dataforge/ui-tests/run', {
      site: '示例站', flow: '搜索', inputs: { keyword: '键盘精灵' },
    })
    const data = json(response).data as { ok: boolean; gate?: string; plan?: { stepCount: number; card?: string } }
    expect(data.ok).toBe(true)
    expect(data.gate).toBe('confirm-required')
    expect(data.plan?.stepCount).toBe(2)
    expect(data.plan?.card).toContain('UI 回放计划')
  })

  it('回放开关关闭：ui-test-disabled', async () => {
    const response = await serve('POST', '/dashboard/api/dataforge/ui-tests/run', {
      site: '示例站', flow: '搜索', inputs: { keyword: 'k' },
    }, { enabled: false })
    const data = json(response).data as { gate?: string }
    expect(data.gate).toBe('ui-test-disabled')
  })

  it('证据白名单：非 failure.* 一律 400', async () => {
    const response = await serve('GET', '/dashboard/api/dataforge/ui-tests/runs/uir_x/evidence?name=../../etc/passwd')
    expect(response.status).toBe(400)
  })

  it('批量：计划卡（confirm 缺省）→ 不跑浏览器；批次列表为空；报告不存在 404', async () => {
    await serve('POST', '/dashboard/api/dataforge/ui-tests/script', { yaml: SCRIPT_YAML })
    const planned = json(await serve('POST', '/dashboard/api/dataforge/ui-tests/batch/run', {}))
    expect(planned.success).toBe(true)
    const data = planned.data as { ok: boolean; gate?: string; plan?: { total: number; items: Array<{ missing: string[] }> } }
    expect(data.ok).toBe(true)
    expect(data.gate).toBe('confirm-required')
    expect(data.plan?.total).toBe(1)
    expect(data.plan?.items[0]?.missing).toEqual(['keyword'])

    const list = json(await serve('GET', '/dashboard/api/dataforge/ui-tests/batch/runs'))
    expect(list.success).toBe(true)
    expect(list.data?.['batches']).toEqual([])

    const missing = await serve('GET', '/dashboard/api/dataforge/ui-tests/batch/uibatch_nope/report')
    expect(missing.status).toBe(404)
  })

  it('未知路径 404', async () => {
    const response = await serve('GET', '/dashboard/api/dataforge/ui-tests/nope')
    expect(response.status).toBe(404)
  })
})
