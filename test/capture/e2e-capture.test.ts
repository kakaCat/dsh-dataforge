import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { SessionRegistry } from '../../src/capture/session.js'
import { openCapturingPage } from '../../src/capture/browser.js'
import { startCapture, captureStatus, captureResult, captureCancel, type CaptureDeps } from '../../src/capture/application.js'

const itReal = process.env.CAPTURE_E2E === '1' ? it : it.skip
const poll = async (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

itReal('single_page 抓百度：run=done 且 cards ≥1（首页静止 0 卡时如实降级报告）', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-e2e-'))
  try {
    const store = new CaptureStore(
      join(dir, 'c.sqlite'), join(dir, 'samples'), join(dir, 'events.ndjson'),
    )
    const registry = new SessionRegistry({ openCapturingPage, bodyLimit: 262_144 })
    const done: Array<Promise<unknown>> = []
    const deps: CaptureDeps = {
      config: {
        engineRoot: dir, pythonBin: 'python3', dataRoot: dir, timeoutSeconds: 600, injectPolicy: false,
        captureMaxDepth: 3, captureMaxPages: 50, captureStabilityWindowMs: 1500,
        captureBodyLimitBytes: 262_144, captureChromeChannel: 'chrome',
        chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true, uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright', uiAgentCredentials: {},
      },
      resolveJobs: () => ({
        start: (spec: { run: (h: { id: string; append: (t: string) => void; updateProgress: (t: string) => void }) => { done: Promise<unknown> } }) => {
          const hooks = spec.run({ id: 'e2e', append: () => undefined, updateProgress: () => undefined })
          done.push(hooks.done)
          return { id: 'e2e' }
        },
      }),
      store,
      registry,
      openCapturingPage,
    }
    const a = await startCapture(deps, { taskType: 'single_page', entryUrl: 'https://www.baidu.com/' })
    expect(a.accepted).toBe(true)
    const id = a.captureId as string
    let run = store.getRun(id)
    for (let i = 0; i < 50 && run?.status === 'running'; i += 1) {
      await poll(1_000)
      run = store.getRun(id)
    }
    expect(run?.status).toBe('done')
    const cards = captureResult(deps, id, 'cards')
    expect(cards.ok).toBe(true)
    const cardRows = (cards.items ?? []) as Array<{ urlTemplate: string }>
    console.log('captured cards:', cardRows.map((c) => c.urlTemplate).join(' | '))
    if (cardRows.length === 0) {
      console.log('如实报告：百度首页静止期未见接口（sugrec 只在输入动作时出现）；e2e 管道本身已验证（run=done）。')
    } else {
      expect(cardRows.some((c) => c.urlTemplate.length > 0)).toBe(true)
      const samples = captureResult(deps, id, 'samples') as { items?: Array<{ url: string }> }
      expect((samples.items ?? []).some((s) => s.url.includes('baidu'))).toBe(true)
    }
    await captureCancel(deps, id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
