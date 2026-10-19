/**
 * 本地真链路 e2e（默认跳过）：真实 Chrome + 真实 HTTP + 真实 sqlite。
 *
 * 跑法（需要本机已装 Chrome）：
 *   CAPTURE_E2E_LOCAL=1 E2E_URL=http://127.0.0.1:8731/ pnpm exec vitest run test/capture/e2e-local.test.ts
 *
 * 验证三件事（都是这一轮修出来的行为，必须在真 wire 数据上成立）：
 *   1. POST XHR 的请求体进卡：出参之外还必须有入参模板（回归：曾只对 fetch 取 postData）；
 *   2. 模板是合法 URL：query 用 ? 拼（回归：曾用 : 拼成不可回放的串）；
 *   3. 卡片身份按 run 隔离：同接口两次采集各留各的卡（回归：merge_key 全库唯一 → 后一次被吞）。
 *
 * @module test/capture/e2e-local
 */
import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { SessionRegistry } from '../../src/capture/session.js'
import { openCapturingPage } from '../../src/capture/browser.js'
import { startCapture, type CaptureDeps } from '../../src/capture/application.js'

const itLocal = process.env.CAPTURE_E2E_LOCAL === '1' ? it : it.skip
const E2E_URL = process.env.E2E_URL ?? 'http://127.0.0.1:8731/'
const poll = async (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function depsFor(dir: string, store: CaptureStore): { deps: CaptureDeps; dones: Array<Promise<unknown>> } {
  const dones: Array<Promise<unknown>> = []
  const deps: CaptureDeps = {
    config: {
      engineRoot: dir, pythonBin: 'python3', dataRoot: dir, timeoutSeconds: 600, injectPolicy: false,
      captureMaxDepth: 3, captureMaxPages: 50, captureStabilityWindowMs: 1500,
      captureBodyLimitBytes: 262_144, captureChromeChannel: 'chrome',
      chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true, uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright',
    },
    resolveJobs: () => ({
      start: (spec: { run: (h: { id: string; append: (t: string) => void; updateProgress: (t: string) => void }) => { done: Promise<unknown> } }) => {
        const hooks = spec.run({ id: 'e2e', append: () => undefined, updateProgress: () => undefined })
        dones.push(hooks.done)
        return { id: 'e2e' }
      },
    }),
    store,
    registry: new SessionRegistry({ openCapturingPage, bodyLimit: 262_144 }),
    openCapturingPage,
  }
  return { deps, dones }
}

async function runOnce(deps: CaptureDeps, dones: Array<Promise<unknown>>): Promise<string> {
  const a = await startCapture(deps, { taskType: 'single_page', entryUrl: E2E_URL })
  expect(a.accepted).toBe(true)
  const id = a.captureId as string
  await Promise.all(dones)
  return id
}

itLocal('本地真链路：POST 入参成模板、模板是合法 URL、两次采集卡片不串味', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-e2e-local-'))
  try {
    const store = new CaptureStore(join(dir, 'c.sqlite'), join(dir, 'samples'), join(dir, 'events.ndjson'))
    const { deps, dones } = depsFor(dir, store)

    const first = await runOnce(deps, dones)
    expect(store.getRun(first)?.status).toBe('done')
    const cards1 = store.listCards(first)
    const byTemplate = new Map(cards1.map((c) => [c.urlTemplate, c]))
    console.log('第一次采集的卡：', cards1.map((c) => `${c.method} ${c.urlTemplate}`).join(' | '))

    // 2. 模板是合法 URL（? 分隔，且能真的解析出 query）
    const listCard = byTemplate.get('/api/list?page=1&uid=88')
    expect(listCard).not.toBeUndefined()
    expect(new URL(String(listCard?.urlTemplate), E2E_URL).searchParams.get('page')).toBe('1')

    // 1. POST XHR 的请求体进卡：入参模板必须带上页面真实发的字段
    const echoCard = byTemplate.get('/api/echo')
    expect(echoCard).not.toBeUndefined()
    expect(echoCard?.method).toBe('POST')
    const reqFields = (echoCard?.requestTemplate?.fields ?? []).map((f) => f.field).sort()
    expect(reqFields).toContain('prNo')
    // 数组入参（物料清单）必须在模板里，不能因为"是数组"就被吞掉
    const material = (echoCard?.requestTemplate?.fields ?? []).find((f) => f.field === 'materials[].sku')
    expect(material?.location).toBe('body')
    expect(material?.sample).toBe('1710301000006A')
    // 出参也成模板，并探到 code 路径
    expect(echoCard?.responseTemplate?.codePath).toBe('code')

    // 3. 同接口第二次采集：各留各的卡，第一次的卡不被并吞
    const second = await runOnce(deps, dones)
    const cards2 = store.listCards(second)
    expect(cards2).toHaveLength(cards1.length)
    expect(cards2.map((c) => c.id)).not.toContain(cards1[0]?.id)
    expect(store.getCard(cards1[0]?.id ?? 'x')?.captureId).toBe(first)
    expect(store.getCard(cards1[0]?.id ?? 'x')?.sampleCount).toBe(1)
    expect(store.getCard(cards2[0]?.id ?? 'x')?.sampleCount).toBe(1)
    expect(store.getRun(second)?.stats.cards).toBe(cards1.length)

    // 4. 关系行 + 样本回指：样本能回答「哪个页面 × 哪个接口 × 哪种形态」
    const rels2 = store.listRelations(second)
    expect(rels2.length).toBeGreaterThan(0)
    const relationIds = new Set(rels2.map((r) => r.id))
    const samples2 = store.listSamples(second)
    expect(samples2.length).toBeGreaterThan(0)
    expect(samples2.every((s) => s.relationId !== undefined && relationIds.has(s.relationId))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

itLocal('真链路 + jobs 拒绝：前台降级照常跑完，不留 running 僵尸', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-e2e-degrade-'))
  try {
    const store = new CaptureStore(join(dir, 'c.sqlite'), join(dir, 'samples'), join(dir, 'events.ndjson'))
    const { deps } = depsFor(dir, store)
    // 线上面板的真实形态：jobs 服务在，但没有 agent 归属 → start 抛错
    const degradeDeps: CaptureDeps = {
      ...deps,
      resolveJobs: () => ({ start: () => { throw new Error('no job controller serves this agent') } }),
    }
    const a = await startCapture(degradeDeps, { taskType: 'single_page', entryUrl: E2E_URL })
    expect(a.accepted).toBe(true)
    expect(a.degradedNotice).toContain('前台降级')

    const id = a.captureId as string
    const deadline = Date.now() + 90_000
    let run = store.getRun(id)
    while (run?.status === 'running' && Date.now() < deadline) {
      await poll(500)
      run = store.getRun(id)
    }
    expect(run?.status).toBe('done')
    expect(store.listCards(id).length).toBeGreaterThan(0)
    expect(store.listRelations(id).length).toBeGreaterThan(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
