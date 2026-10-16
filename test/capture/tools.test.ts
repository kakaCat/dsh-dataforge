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
import { defineBrowserCloseTool } from '../../src/tools.js'
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
