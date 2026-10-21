/**
 * 工具壳级行为测试：browser_close 的 run 收口语义。
 *
 * - 会话绑定 captureId 且 run 仍 running → close 即收口 done（action 会话由 agent 结束）；
 * - 已到终态的 run 不被 close 改写（幂等，尊重 done/failed/cancelled）。
 */
import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineBrowserCloseTool, defineCaptureResultTool, defineCaptureStatusTool } from '../../src/tools.js'
import { lossless } from '../../src/shared/json.js'
import { CaptureStore } from '../../src/capture/store.js'
import { openCapturingPage } from '../../src/capture/browser.js'
import type { CaptureDeps } from '../../src/capture/application.js'
import type { Config } from '../../src/config.js'

function buildCloseTool(): { tool: { execute: (a: { session_id: string }) => Promise<{ ok: boolean; captureId?: string }> }; store: CaptureStore } {
  const dir = mkdtempSync(join(tmpdir(), 'cap-tools-'))
  const store = new CaptureStore(join(dir, 'c.sqlite'), join(dir, 'samples'), join(dir, 'events.ndjson'))
  const config: Required<Config> = {
    engineRoot: dir,
    pythonBin: 'python3',
    dataRoot: join(dir, 'data'),
    timeoutSeconds: 600,
    injectPolicy: false,
    captureMaxDepth: 3,
    captureMaxPages: 50,
    captureStabilityWindowMs: 1500,
    captureBodyLimitBytes: 262_144,
    captureChromeChannel: 'chrome',
    chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true, uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright', uiAgentCredentials: {},
  }
  const deps: CaptureDeps = {
    config,
    resolveJobs: () => undefined,
    store,
    registry: {
      open: async () => ({ sessionId: 'bs_x', pageUrl: 'https://x.test/' }),
      act: async () => ({ ok: true }),
      snapshot: async () => ({ ok: true, elements: [] }),
      close: async () => ({ ok: true, cookies: [], captureId: 'cap_x' }),
      bindSink: () => undefined,
    },
    openCapturingPage,
  }
  return { tool: defineBrowserCloseTool(deps) as unknown as { execute: (a: { session_id: string }) => Promise<{ ok: boolean; captureId?: string }> }, store }
}

it('browser_close：running 的绑定 run 被收口为 done；重复 close 幂等', async () => {
  const { tool, store } = buildCloseTool()
  store.upsertRun({
    id: 'cap_x', taskType: 'action', entryUrl: 'https://x.test/', status: 'running', startedAt: Date.now(),
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const closed = await tool.execute({ session_id: 'bs_x' })
  expect(closed.ok).toBe(true)
  expect(closed.captureId).toBe('cap_x')
  expect(store.getRun('cap_x')?.status).toBe('done')
  await tool.execute({ session_id: 'bs_x' })
  expect(store.getRun('cap_x')?.status).toBe('done')
})

it('browser_close：raw cookie 逐条入库，工具输出只有 name/domain 摘要（原文不出壳）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-tools-'))
  const store = new CaptureStore(join(dir, 'c.sqlite'), join(dir, 'samples'), join(dir, 'events.ndjson'))
  const config: Required<Config> = {
    engineRoot: dir, pythonBin: 'python3', dataRoot: join(dir, 'data'), timeoutSeconds: 600,
    injectPolicy: false, captureMaxDepth: 3, captureMaxPages: 50,
    captureStabilityWindowMs: 1500, captureBodyLimitBytes: 262_144, captureChromeChannel: 'chrome',
    chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true, uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright', uiAgentCredentials: {},
  }
  store.upsertRun({
    id: 'cap_c', taskType: 'action', entryUrl: 'https://x.test/', status: 'running', startedAt: Date.now(),
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const deps: CaptureDeps = {
    config,
    resolveJobs: () => undefined,
    store,
    registry: {
      open: async () => ({ sessionId: 's1', pageUrl: 'https://x.test/' }),
      act: async () => ({ ok: true }),
      snapshot: async () => ({ ok: true, elements: [] }),
      close: async () => ({
        ok: true,
        cookies: [{ name: 'BKID', domain: 'x.test', value: 'raw-bkid-value', httpOnly: true }],
        captureId: 'cap_c',
      }),
      bindSink: () => undefined,
    },
    openCapturingPage,
  }
  const tool = defineBrowserCloseTool(deps) as unknown as {
    execute: (a: { session_id: string }) => Promise<{ ok: boolean; cookies: unknown[]; captureId?: string }>
  }
  const closed = await tool.execute({ session_id: 's1' })
  expect(closed.cookies).toEqual([{ name: 'BKID', domain: 'x.test' }])

  const rows = store.listCredentials('cap_c')
  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe('BKID')
  expect(JSON.stringify(rows[0]?.valueJson ?? rows[0])).toContain('raw-bkid-value')
  const run = store.getRun('cap_c')
  expect(run?.status).toBe('done')
  expect(run?.stats.credentials).toBe(1)
  expect(JSON.stringify(closed)).not.toContain('raw-bkid-value')
})

// ── capture_result 回执渲染：必须让人看见「采到了什么接口」 ──

type RenderTool = {
  output: { render: (args: { capture_id: string; scope: string }, value: unknown) => Array<{ text?: string }> }
  execute: (args: { capture_id: string; scope: string; limit?: number }) => Promise<unknown>
}

type StatusTool = { execute: (args: { capture_id?: string }) => Promise<unknown> }

function buildDeps(): { deps: CaptureDeps; store: CaptureStore } {
  const dir = mkdtempSync(join(tmpdir(), 'cap-render-'))
  const store = new CaptureStore(join(dir, 'c.sqlite'), join(dir, 'samples'), join(dir, 'events.ndjson'))
  const config: Required<Config> = {
    engineRoot: dir, pythonBin: 'python3', dataRoot: join(dir, 'data'), timeoutSeconds: 600,
    injectPolicy: false, captureMaxDepth: 3, captureMaxPages: 50,
    captureStabilityWindowMs: 1500, captureBodyLimitBytes: 262_144, captureChromeChannel: 'chrome',
    chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true, uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright', uiAgentCredentials: {},
  }
  const deps: CaptureDeps = {
    config,
    resolveJobs: () => undefined,
    store,
    registry: {
      open: async () => ({ sessionId: 's1', pageUrl: 'https://x.test/' }),
      act: async () => ({ ok: true }),
      snapshot: async () => ({ ok: true, elements: [] }),
      close: async () => ({ ok: true, cookies: [], captureId: undefined }),
      bindSink: () => undefined,
    },
    openCapturingPage,
  }
  return { deps, store }
}

function buildResultTool(): { tool: RenderTool; store: CaptureStore; deps: CaptureDeps } {
  const { deps, store } = buildDeps()
  return { tool: defineCaptureResultTool(deps) as unknown as RenderTool, store, deps }
}

function renderText(tool: RenderTool, scope: string, value: unknown): string {
  return tool.output.render({ capture_id: 'cap_x', scope }, value).map((b) => b.text ?? '').join('\n')
}

/** 无损 JSON 校验的等价检查：任何层级都不许留 undefined 键。 */
function undefinedPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => undefinedPaths(v, `${path}[${i}]`))
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    v === undefined ? [`${path}.${k}`] : undefinedPaths(v, `${path}.${k}`))
}

it('lossless：递归丢 undefined 键，Date/Buffer 等非纯对象不动', () => {
  const date = new Date(0)
  const out = lossless({ a: 1, b: undefined, c: { d: undefined, e: 2 }, f: [{ g: undefined, h: 3 }], date, buf: Buffer.from('x') }) as Record<string, unknown>
  expect(Object.keys(out)).toEqual(['a', 'c', 'f', 'date', 'buf'])
  expect(out['c']).toEqual({ e: 2 })
  expect(out['f']).toEqual([{ h: 3 }])
  expect(out['date']).toBe(date)
})

it('capture_result：真实行（可选字段缺省）不再触发 value is not lossless JSON', async () => {
  const { tool, store, deps } = buildResultTool()
  store.upsertRun({
    id: 'cap_r', taskType: 'single_page', entryUrl: 'https://x.test', status: 'running', startedAt: 1,
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  // 可选列全缺省：status/page_url/name/request_body_path… 都是 NULL → 行映射成 undefined（就是报错现场）
  store.upsertSample('cap_r', undefined, {
    url: 'https://x.test/api/a', method: 'GET', requestHeaders: {}, responseHeaders: {}, bodyLimit: 262_144,
  })
  store.upsertCard('cap_r', {
    mergeKey: 'GET /api/a', method: 'GET', urlTemplate: '/api/a', relatedPageUrls: ['https://x.test/'],
  })
  store.upsertCredential('cap_r', 'cookie', '.x.test', 'BKID', 1)

  for (const scope of ['cards', 'samples', 'credentials', 'pages']) {
    const value = await tool.execute({ capture_id: 'cap_r', scope })
    expect(undefinedPaths(value)).toEqual([])
  }

  // running 的 run：ended_at / error 都是 NULL → 同样不能把 undefined 漏出去
  const statusTool = defineCaptureStatusTool(deps) as unknown as StatusTool
  expect(undefinedPaths(await statusTool.execute({ capture_id: 'cap_r' }))).toEqual([])
  expect(undefinedPaths(await statusTool.execute({}))).toEqual([])
})

it('cards 回执：逐条列出方法/模板/样本数/出入参规模（不再只回一句条数）', () => {
  const { tool } = buildResultTool()
  const text = renderText(tool, 'cards', {
    ok: true,
    items: [{
      id: 'card_1', captureId: 'cap_x', urlTemplate: '/api/pr/create?org=MI', method: 'POST',
      requestTemplate: { fields: [{ field: 'prNo', type: 'string', sample: 'PR1', role: 'input', unverified: false }] },
      responseTemplate: { fields: [{ field: 'code', type: 'number', sample: '0', role: 'constant', unverified: true }], codePath: 'code' },
      relatedPageUrls: ['https://x.test/'], sampleCount: 3, createdAt: 1,
    }],
  })
  expect(text).toContain('POST /api/pr/create?org=MI')
  expect(text).toContain('×3')
  expect(text).toContain('入参 1 字段')
  expect(text).toContain('出参 1 字段(code)')
})

it('credentials 回执：只给类型/名称/来源，cookie 原文绝不出壳', () => {
  const { tool } = buildResultTool()
  const text = renderText(tool, 'credentials', {
    ok: true,
    items: [{ id: 'cr_1', captureId: 'cap_x', kind: 'cookie', url: '.x.test', name: 'BKID', valueJson: 'raw-secret-token', obtainedAt: 1 }],
  })
  expect(text).toContain('cookie BKID @ .x.test')
  expect(text).not.toContain('raw-secret-token')
})

it('samples/pages 回执：带状态与截断标注；notice 原样透出', () => {
  const { tool } = buildResultTool()
  const samples = renderText(tool, 'samples', {
    ok: true,
    items: [{ id: 'sm_1', captureId: 'cap_x', pageUrl: 'https://x.test/', seq: 2, url: 'https://x.test/api/a', method: 'POST', status: 500, requestHeaders: {}, responseHeaders: {}, truncated: true, ts: 1 }],
  })
  expect(samples).toContain('#2 POST 500 https://x.test/api/a')
  expect(samples).toContain('超限未存正文')
  expect(renderText(tool, 'pages', { ok: true, notice: 'captureId cap_x 的页面暂无记录' })).toContain('页面暂无记录')
})
