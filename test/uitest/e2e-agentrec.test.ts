/**
 * AI 代办录制（agentrec）真实浏览器端到端（默认跳过）。
 *
 * 跑法（需要本机 Chrome）：
 *   UI_E2E=1 pnpm exec vitest run test/uitest/e2e-agentrec.test.ts
 *
 * 校验单测覆盖不到的真链路：
 *   打开代办会话（真 Chrome）→ AI 动作（inspect/fill/click）同步录步
 *   → 密码字段 valueFrom 脱敏 → stop 落 review=pending 脚本
 *   → 带入参无头回放（scroll 步骤也在链里）。
 *
 * @module dsh-dataforge/test/uitest/e2e-agentrec
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { AgentRecordingSessions } from '../../src/uitest/agentrec.js'
import { openUiBrowser, runUiScript } from '../../src/uitest/run.js'
import { loadUiScript } from '../../src/uitest/store.js'
import {
  agentActForTool, openAgentSessionForTool, stopAgentSessionForTool, type UiTestDeps,
} from '../../src/uitest/application.js'
import type { UiBrowserEngine } from '../../src/uitest/engines.js'

const itReal = process.env.UI_E2E === '1' ? it : it.skip

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>代办 e2e</title></head>
<body>
  <form id="login-form">
    <input id="username" name="username" placeholder="用户名">
    <input id="password" name="password" type="password" placeholder="密码">
    <button type="submit" id="login-btn">登录</button>
  </form>
  <div id="articles" style="display:none">
    <h2>文章列表</h2>
    <a class="article" href="/a/1">文章一：录制与回放</a>
    <a class="article" href="/a/2">文章二：接口链</a>
    <a class="article" href="/a/3">文章三：结晶</a>
  </div>
  <script>
    document.getElementById('login-form').addEventListener('submit', (event) => {
      event.preventDefault()
      var u = document.getElementById('username').value
      var p = document.getElementById('password').value
      if (u !== '' && p !== '') document.getElementById('articles').style.display = 'block'
    })
  </script>
</body></html>`

let server: Server | undefined
let baseUrl = ''
let dir: string | undefined

beforeAll(async () => {
  if (process.env.UI_E2E !== '1') return
  server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/a/')) {
      res.statusCode = 200
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end('<!doctype html><title>文章</title><h1>正文</h1>')
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(PAGE)
  })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('监听地址异常')
  baseUrl = `http://127.0.0.1:${address.port}/`
  dir = mkdtempSync(join(tmpdir(), 'df-agentrec-e2e-'))
})

afterAll(async () => {
  await new Promise<void>((resolve) => { if (server === undefined) resolve(); else server.close(() => resolve()) })
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

itReal('AI 代办录制：登录 → 收集文章 → 落待审查脚本 → 无头回放', { timeout: 180_000 }, async () => {
  expect(baseUrl).not.toBe('')
  const fakeEngine = (): UiBrowserEngine => ({
    kind: 'playwright', label: 'e2e', managesCookies: false, available: () => true,
    open: async () => ({ ok: false }), start: async () => ({ ok: true }),
    stop: async () => ({ ok: false }), pickSelector: async () => ({ ok: false }),
    pageMeta: async () => ({}), cookiesOf: async () => [], close: async () => ({ ok: true }),
    list: () => [], pageUrlOf: () => undefined, has: () => false, closeAll: async () => {},
    run: async () => ({ ok: false }) as never,
  })
  const deps: UiTestDeps = {
    resolveWorkspaceRoot: async () => dir as string,
    dataRoot: join(dir as string, 'data'),
    enabled: true,
    resolveEngine: () => ({ engine: fakeEngine() }),
    batchEngine: fakeEngine(),
    agentSessions: new AgentRecordingSessions({
      dataRoot: join(dir as string, 'data'),
      openBrowser: (options) => openUiBrowser({ ...options, channel: 'chrome' }),
    }),
    agentSecrets: { demoPassword: 'e2e-secret' },
  }

  // 闸2：不带 confirm 只回计划卡。
  const plan = await openAgentSessionForTool(deps, undefined, {
    task: '登录并收集文章列表', startUrl: baseUrl,
  })
  expect(plan.gate).toBe('confirm-required')

  const opened = await openAgentSessionForTool(deps, undefined, {
    task: '登录并收集文章列表', startUrl: baseUrl, headless: true, confirm: true,
  })
  expect(opened.ok).toBe(true)
  expect(opened.credentialKeys).toEqual(['demoPassword'])
  const sessionId = opened.sessionId as string

  // 自主规划：先 inspect 观察页面。
  const inspect = await agentActForTool(deps, { sessionId, act: { kind: 'inspect' } })
  if (!inspect.ok) console.error('inspect failed:', inspect.error)
  expect(inspect.ok).toBe(true)
  expect(inspect.inspect?.elements.some((el) => el.candidates.includes('#username'))).toBe(true)
  expect(inspect.inspect?.challenge?.detected).toBe(false)

  // 登录：明文用户名 + valueFrom 密码。
  expect((await agentActForTool(deps, { sessionId, act: { kind: 'fill', selector: '#username', value: 'demo' } })).ok).toBe(true)
  const secret = await agentActForTool(deps, { sessionId, act: { kind: 'fill', selector: '#password', valueFrom: 'demoPassword' } })
  expect(secret.ok).toBe(true)
  expect(secret.valueMasked).toBe(true)
  expect((await agentActForTool(deps, { sessionId, act: { kind: 'click', selector: '#login-btn' } })).ok).toBe(true)
  expect((await agentActForTool(deps, { sessionId, act: { kind: 'wait', ms: 300 } })).ok).toBe(true)
  expect((await agentActForTool(deps, { sessionId, act: { kind: 'scroll', deltaY: 400 } })).ok).toBe(true)

  // 登录成功：页面出现文章列表，没有验证码。
  const after = await agentActForTool(deps, { sessionId, act: { kind: 'inspect' } })
  expect(after.inspect?.elements.some((el) => el.text.includes('文章列表'))).toBe(true)
  expect(after.inspect?.challenge?.detected).toBe(false)

  const stopped = await stopAgentSessionForTool(deps, undefined, { sessionId, site: '代办e2e', flow: '登录收集' })
  expect(stopped.ok).toBe(true)
  expect(stopped.stepCount).toBe(5)
  expect(stopped.saved?.review).toBe('pending')

  // 落盘内容：待审查 + 任务描述 + 密码槽位，且密钥值 nowhere。
  const loaded = loadUiScript(dir as string, '代办e2e', '登录收集')
  expect(loaded.ok).toBe(true)
  if (!loaded.ok) return
  expect(loaded.doc.meta.review).toBe('pending')
  expect(loaded.doc.meta.task).toBe('登录并收集文章列表')
  expect(loaded.doc.inputs).toEqual([{ name: 'demoPassword', type: 'string', required: true, example: '回放时由人提供' }])
  const passwordStep = loaded.doc.steps.find((step) => step.kind === 'fill' && step.selector === '#password')
  expect(passwordStep?.value).toBe('{{demoPassword}}')
  expect(JSON.stringify(loaded.doc)).not.toContain('e2e-secret')
  expect(loaded.doc.steps.some((step) => step.kind === 'scroll' && step.deltaY === 400)).toBe(true)

  // 无头回放：提供密码槽位值，整个脚本（含 scroll）在真浏览器里重放成功。
  const run = await runUiScript({
    dataRoot: join(dir as string, 'data'),
    channel: 'chrome',
    stepTimeoutMs: 15_000,
    openBrowser: openUiBrowser,
  }, { doc: loaded.doc, inputs: { demoPassword: 'e2e-secret' } })
  if (!run.success) console.error('run failed:', JSON.stringify({ error: run.error, failedStep: run.failedStep }, null, 2))
  expect(run.success).toBe(true)

  // 留痕：事件里没有密钥值。
  const traceDir = join(dir as string, 'data', 'ui-agent-runs')
  const runs = readdirSync(traceDir)
  expect(runs.length).toBe(1)
  const events = readFileSync(join(traceDir, runs[0] as string, 'events.ndjson'), 'utf8')
  expect(events).not.toContain('e2e-secret')
  expect(events).toContain('"valueMasked":true')
})
