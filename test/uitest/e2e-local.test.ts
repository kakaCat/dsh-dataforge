/**
 * UI 录制 → 落盘 → 回放 的真实浏览器端到端（默认跳过）。
 *
 * 跑法（需要本机 Chrome）：
 *   UI_E2E=1 pnpm exec vitest run test/uitest/e2e-local.test.ts
 *
 * 校验的是 spike 里验证过、但单测覆盖不到的那条真链路：
 *   真 DOM 事件 → 录制器 selector 候选 → ui-script YAML → 无头回放 → 页面断言。
 *
 * @module dsh-dataforge/test/uitest/e2e-local
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { UiRecorder } from '../../src/uitest/recorder.js'
import { openUiBrowser, runUiScript } from '../../src/uitest/run.js'
import { saveUiScript } from '../../src/uitest/store.js'
import { pickOnPage } from '../../src/uitest/picker.js'
import { PICKER_SCRIPT, SELECTOR_HELPER_SCRIPT } from '../../src/uitest/selector-script.js'
import type { UiScriptDoc, UiStep } from '../../src/uitest/schema.js'

const itReal = process.env.UI_E2E === '1' ? it : it.skip

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>UI e2e</title></head>
<body>
  <form id="search-form">
    <label>关键词 <input id="kw" name="q" placeholder="输入关键词"></label>
    <button type="submit">搜索</button>
  </form>
  <div id="result" style="display:none">结果：<span id="echo"></span></div>
  <script>
    document.getElementById('search-form').addEventListener('submit', (event) => {
      event.preventDefault()
      document.getElementById('echo').textContent = document.getElementById('kw').value
      document.getElementById('result').style.display = 'block'
    })
  </script>
</body></html>`

let server: Server | undefined
let baseUrl = ''
let dir: string | undefined

beforeAll(async () => {
  if (process.env.UI_E2E !== '1') return
  server = createServer((_req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(PAGE)
  })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('监听地址异常')
  baseUrl = `http://127.0.0.1:${address.port}/`
  dir = mkdtempSync(join(tmpdir(), 'df-ui-e2e-'))
})

afterAll(async () => {
  await new Promise<void>((resolve) => { if (server === undefined) resolve(); else server.close(() => resolve()) })
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

itReal('录制真实页面操作 → 存 ui-script → 无头回放通过断言', { timeout: 120_000 }, async () => {
  expect(baseUrl).not.toBe('')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

    const recorder = await UiRecorder.start(page, context)
    await page.fill('#kw', '键盘精灵')
    await page.click('button:has-text("搜索")')
    await page.waitForTimeout(150)
    const recorded = await recorder.stop()

    // 同一页面「停止 → 再开始」：监听器复用必须重新激活（换流程录制依赖这条）。
    const restarted = await UiRecorder.start(page, context)
    await page.click('button:has-text("搜索")')
    const secondRecording = await restarted.stop()
    expect(secondRecording.steps.length).toBeGreaterThanOrEqual(1)

    expect(recorded.steps.length).toBeGreaterThanOrEqual(2)
    const fill = recorded.steps.find((step) => step.kind === 'fill')
    const click = recorded.steps.find((step) => step.kind === 'click')
    expect(fill?.value).toBe('键盘精灵')
    expect(click?.selector).toBeTruthy()

    // 录制只录动作；断言由测试补上（面板/agent 的职责），证明回放真的在判页面状态。
    const steps: UiStep[] = recorded.steps.map((step) => (step.kind === 'click'
      ? {
          ...step,
          expect: [
            { kind: 'visible', selector: '#result' },
            { kind: 'text', selector: '#echo', equals: '键盘精灵' },
          ],
        }
      : step))
    // submit 步骤走 requestSubmit 回放（与 click 触发的提交是两条路径）。
    steps.push({
      id: `s${steps.length + 1}`,
      kind: 'submit',
      selector: '#search-form',
      expect: [{ kind: 'text', selector: '#echo', equals: '键盘精灵' }],
    })
    const doc: UiScriptDoc = {
      apiVersion: 'dataforge/v1',
      kind: 'ui-script',
      meta: {
        site: '本地 e2e',
        flow: '搜索',
        version: 1,
        created: new Date().toISOString(),
        source: 'record',
        startUrl: baseUrl,
        viewport: { width: 1280, height: 720 },
      },
      inputs: [],
      steps,
    }
    const saved = saveUiScript(dir as string, doc)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.version).toBe(1)

    const run = await runUiScript({
      dataRoot: join(dir as string, 'data'),
      channel: 'chrome',
      stepTimeoutMs: 15_000,
      openBrowser: openUiBrowser,
    }, { doc: saved.doc })
    if (!run.success) console.error('run failed:', JSON.stringify({ error: run.error, failedStep: run.failedStep, steps: run.steps }, null, 2))
    expect(run.success).toBe(true)
    expect(run.failedStep).toBeUndefined()
    expect(run.steps.every((step) => step.ok)).toBe(true)
  } finally {
    await browser.close()
  }
})


itReal('页面点选：用户点元素 → 返回候选 selector（不触发业务）', { timeout: 60_000 }, async () => {
  expect(baseUrl).not.toBe('')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.evaluate(SELECTOR_HELPER_SCRIPT)
    const pickedPromise = pickOnPage(page, 10_000)
    // 模拟用户在浏览器里点输入框：点选器在捕获阶段吞掉事件，页面表单不应被提交
    await page.click('#kw')
    const picked = await pickedPromise
    expect(picked.ok).toBe(true)
    expect(picked.candidates).toContain('#kw')
    expect(picked.selector).toBe('#kw')
    // 业务没被触发：结果区仍然隐藏
    expect(await page.isVisible('#result')).toBe(false)
  } finally {
    await browser.close()
  }
})

itReal('页面点选：helper 未注入时如实报错，不挂起', { timeout: 30_000 }, async () => {
  expect(baseUrl).not.toBe('')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    const picked = await page.evaluate(PICKER_SCRIPT) as { ok: boolean; error?: string }
    expect(picked.ok).toBe(false)
    expect(picked.error).toContain('helper')
  } finally {
    await browser.close()
  }
})
