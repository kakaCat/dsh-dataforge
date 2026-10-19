/**
 * 真实站点端到端（可选，默认跳过）：
 *   jsonplaceholder 真实 GET → capture 写库 → trace 草稿 → chain 保存/执行
 *   → 真实 Chrome 跑 ui-script → verify 自动导出 evidence。
 *
 * 只读：两条 GET，不写目标系统。联网 + 本机 Chrome 时运行：
 *   NODE_OPTIONS=--dns-result-order=ipv4first E2E_REAL=1 pnpm exec vitest run test/e2e/real-site.test.ts
 *
 * @module dsh-dataforge/test/e2e/real-site
 */
import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { CaptureStore } from '../../src/capture/store.js'
import { writeCard } from '../../src/library/store.js'
import { chainDraftForTool } from '../../src/trace/application.js'
import {
  upsertChainForTool, chainRunForTool, type ChainRunToolDeps, type ChainRunToolValue,
} from '../../src/orchestration/application.js'
import { runUiScriptForTool, type UiTestDeps } from '../../src/uitest/application.js'
import { runUiScript } from '../../src/uitest/run.js'
import { saveUiScript } from '../../src/uitest/store.js'
import { PlaywrightBrowserEngine } from '../../src/uitest/engines/playwright.js'
import { UiRecordingSessions } from '../../src/uitest/sessions.js'
import { exportRunArtifacts } from '../../src/datasets/export.js'
import type { LibraryCard } from '../../src/library/types.js'

const ENABLED = process.env['E2E_REAL'] === '1'
const USERS_URL = 'https://jsonplaceholder.typicode.com/users/1'
const COMMENTS_BASE = 'https://jsonplaceholder.typicode.com/comments'

let workspace = ''
let dataRoot = ''
let store: CaptureStore | undefined

async function fetchJson(url: string): Promise<{ body: string; status: number; headers: Record<string, string> }> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      const body = await response.text()
      return { body, status: response.status, headers: Object.fromEntries(response.headers.entries()) }
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function libraryCards(): LibraryCard[] {
  return [
    {
      cardId: 'card_000001', kind: 'interface-card', name: 'GET 用户 1',
      identity: { mergeKey: 'GET /users/1', method: 'GET', urlTemplate: '/users/1' },
      inputs: [],
      outputs: [{ path: 'body.email', type: 'string' }, { path: 'body.username', type: 'string' }],
      auth: 'none',
      sources: [{ captureId: 'cap_real', pages: [USERS_URL], relationIds: [] }],
    },
    {
      cardId: 'card_000002', kind: 'interface-card', name: 'GET 评论',
      identity: { mergeKey: 'GET /comments', method: 'GET', urlTemplate: '/comments' },
      inputs: [{ path: 'query.email', type: 'string', required: true, role: 'input' }],
      outputs: [{ path: 'body[0].id', type: 'number' }],
      auth: 'none',
      sources: [{ captureId: 'cap_real', pages: [COMMENTS_BASE], relationIds: [] }],
    },
  ]
}

afterAll(() => { store?.close() })

describe.skipIf(!ENABLED)('真实站点：capture → 草稿 → 执行 → UI 验收 → evidence', () => {
  it('跑通 jsonplaceholder 只读闭环', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'df-real-site-'))
    dataRoot = join(workspace, 'data')
    for (const card of libraryCards()) writeCard(workspace, card)

    // 1) 真实 GET 两条，写入 capture trace（模拟采集器已抓到的内容）。
    const users = await fetchJson(USERS_URL)
    expect(users.status).toBe(200)
    const email = (JSON.parse(users.body) as { email?: string }).email
    expect(typeof email).toBe('string')
    const commentsUrl = `${COMMENTS_BASE}?email=${encodeURIComponent(email as string)}`
    const comments = await fetchJson(commentsUrl)
    expect(comments.status).toBe(200)

    store = new CaptureStore(join(dataRoot, 'capture', 'capture.sqlite'), join(dataRoot, 'capture', 'samples'))
    store.upsertRun({
      id: 'cap_real', taskType: 'single_page', entryUrl: 'https://jsonplaceholder.typicode.com/', status: 'done',
      startedAt: Date.now(), stats: { pages: 1, requests: 2, cards: 2, credentials: 0 },
    })
    const rows = [
      { method: 'GET', url: USERS_URL, body: users.body, headers: users.headers },
      { method: 'GET', url: commentsUrl, body: comments.body, headers: comments.headers },
    ]
    for (const [index, row] of rows.entries()) {
      const parsed = new URL(row.url)
      const cardId = store.upsertCard('cap_real', {
        mergeKey: `${row.method} ${parsed.pathname}`,
        method: row.method,
        urlTemplate: parsed.pathname,
        relatedPageUrls: ['https://jsonplaceholder.typicode.com/'],
      })
      const relationId = store.upsertRelation('cap_real', cardId, 'https://jsonplaceholder.typicode.com/', `fp-${index}`)
      const sampleId = store.upsertSample('cap_real', undefined, {
        url: row.url, method: row.method, status: 200,
        requestHeaders: {}, responseHeaders: row.headers,
        responseBody: row.body, bodyLimit: 1_000_000, ts: index,
      })
      store.attachSampleRelation(sampleId, relationId)
    }

    // 2) trace → 草稿；用真实 email 绑定 query.email。
    const draft = await chainDraftForTool(
      {
        captureDbPath: join(dataRoot, 'capture', 'capture.sqlite'),
        samplesDir: join(dataRoot, 'capture', 'samples'),
        resolveWorkspaceRoot: async () => workspace,
      },
      undefined,
      { capture_id: 'cap_real', site: 'JsonPlaceholder', flow: '真实只读闭环' },
    )
    expect(draft.ok).toBe(true)
    if (!draft.ok) throw new Error(draft.error)
    expect(draft.chain.edges.some((edge) => edge.from.includes('email') && edge.to.includes('email'))).toBe(true)

    // 3) 保存链 + 加 verify 块。
    const chainDoc = yaml.load(draft.yaml) as Record<string, unknown>
    chainDoc['verify'] = {
      when: 'onSuccess',
      ui: { site: 'JsonPlaceholder', flow: '查看用户页' },
      inputs: {},
    }
    const saved = await upsertChainForTool(
      { captureDbPath: join(dataRoot, 'capture', 'capture.sqlite'), resolveWorkspaceRoot: async () => workspace },
      undefined,
      { site: 'JsonPlaceholder', flow: '真实只读闭环', chainYaml: yaml.dump(chainDoc) },
    )
    expect(saved.ok).toBe(true)

    // 4) 保存一条真实浏览器 ui-script：打开用户 JSON 页，断言 email 文本存在。
    const uiScript = `apiVersion: dataforge/v1
kind: ui-script
meta:
  site: JsonPlaceholder
  flow: 查看用户页
  version: 1
  created: '2026-10-18T00:00:00.000Z'
  startUrl: '${USERS_URL}'
inputs: []
steps:
  - id: open
    kind: goto
    url: '${USERS_URL}'
    expect:
      - kind: text
        selector: body
        contains: '${email}'
`
    const uiSaved = saveUiScript(workspace, uiScript)
    expect(uiSaved.ok).toBe(true)

    const sessions = new UiRecordingSessions()
    const engine = new PlaywrightBrowserEngine({
      sessions,
      channel: process.env['CHROME_CHANNEL'] ?? 'chrome',
      run: (doc, inputs, options) => runUiScript(
        { dataRoot, channel: process.env['CHROME_CHANNEL'] ?? 'chrome', stepTimeoutMs: 20_000 },
        { doc, inputs, ...(options?.headless === undefined ? {} : { headless: options.headless }) },
      ),
    })
    const uiDeps: UiTestDeps = {
      resolveWorkspaceRoot: async () => workspace,
      dataRoot,
      enabled: true,
      resolveEngine: () => ({ engine }),
      batchEngine: engine,
    }

    const runDeps: ChainRunToolDeps = {
      captureDbPath: join(dataRoot, 'capture', 'capture.sqlite'),
      resolveWorkspaceRoot: async () => workspace,
      dataRoot,
      chain: { enabled: true, nodeTimeoutSeconds: 20, concurrency: 2, responseLimitBytes: 2_097_152, foregroundTimeoutSeconds: 60 },
      resolveJobs: () => undefined,
      verifyUi: async (request) => {
        const value = await runUiScriptForTool(uiDeps, undefined, {
          site: request.site, flow: request.flow, inputs: request.inputs, confirm: true, headless: true,
        })
        return {
          ...(value.result?.runId === undefined ? {} : { runId: value.result.runId }),
          ...(value.result === undefined ? {} : { success: value.result.success }),
          status: value.ok ? (value.result?.success === true ? 'success' : 'failed') : 'failed',
          ...(value.result?.screenshot === undefined ? {} : { screenshot: value.result.screenshot }),
          ...(value.message === undefined ? {} : { message: value.message }),
        }
      },
    }

    // 5) 计划卡不能发请求；确认后真实 GET + UI 验收。
    const planned = await chainRunForTool(runDeps, undefined, {
      site: 'JsonPlaceholder', flow: '真实只读闭环', inputs: {}, baseUrl: 'https://jsonplaceholder.typicode.com',
    })
    expect(planned.gate).toBe('confirm-required')
    expect(planned.plan?.verify?.flow).toBe('查看用户页')

    let executed: ChainRunToolValue | undefined
    for (let attempt = 0; attempt < 2; attempt += 1) {
      executed = await chainRunForTool(runDeps, undefined, {
        site: 'JsonPlaceholder', flow: '真实只读闭环', inputs: {},
        baseUrl: 'https://jsonplaceholder.typicode.com', confirm: true,
      })
      if (executed.ok && executed.summary?.status === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 1_200))
    }
    expect(executed?.ok).toBe(true)
    if (executed === undefined || !executed.ok) throw new Error(executed?.message ?? '链执行失败')
    expect(executed.summary?.status).toBe('completed')
    expect(executed.nodes?.map((node) => node.httpStatus)).toEqual([200, 200])
    const second = executed.nodes?.find((node) => node.nodeId === 'n2')
    expect(second?.url).toContain('email=Sincere%40april.biz')
    const business = executed.summary?.businessData as
      | { outputs?: Record<string, Record<string, unknown>> }
      | undefined
    expect(business?.outputs?.['n1']?.['body.email']).toBe(email)
    expect(executed.verify?.status).toBe('success')
    expect(executed.verify?.reportPath).toBeDefined()
    if (executed.runId !== undefined) {
      const exported = exportRunArtifacts(dataRoot, executed.runId)
      expect(exported.ok).toBe(true)
      if (exported.ok) {
        expect(existsSync(exported.reportPath)).toBe(true)
        expect((JSON.parse(readFileSync(exported.datasetPath, 'utf8')) as { site?: string }).site).toBe('JsonPlaceholder')
      }
    }
  }, 180_000)
})
