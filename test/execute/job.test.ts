/**
 * 后台 job 与状态投影（IF-1 后台路径 / IF-2 / IF-6 / FR-3.6）。
 *
 * 三种装配各验一次：jobs 缺席 → 前台降级；jobs 在场 → 后台 job（可取消）；
 * 跑完之后 → `dataforge_chain_runs` 与 `dataforge_status` 都能读到节点级事实。
 *
 * @module dsh-dataforge/test/execute/job
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { chainToYaml } from '../../src/chains/schema.js'
import { cardsRoot, saveChain } from '../../src/chains/store.js'
import {
  chainRunForTool,
  listChainRunsForTool,
  type ChainRunToolDeps,
} from '../../src/orchestration/application.js'
import { buildDataforgeDeps } from '../../src/application.js'
import { runStatus } from '../../src/application.js'
import type { Config } from '../../src/config.js'

/* ================================================================== 假服务端 */

let server: Server
let base = ''
const hanging: ServerResponse[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/'
    req.resume()
    if (url === '/api/hang') {
      hanging.push(res)
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
      }, 600)
      return
    }
    if (url === '/api/fail') {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('boom')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const res of hanging) res.socket?.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/* ================================================================== 夹具 */

type JobHandle = {
  readonly id: string
  append(text: string): void
  updateProgress(line: string): void
}
type JobHooks = { cancel: (reason?: string) => void; done: Promise<{ status: string; detail?: string }> }
type JobSpec = {
  kind: string
  label: string
  owner?: string
  outputLimitBytes?: number
  run: (job: JobHandle) => JobHooks
}

/** 假 jobs 服务：把 spec 收进数组，测试自己驱动 run()。 */
function fakeJobs(): { service: { start(spec: JobSpec): { id: string } }; specs: JobSpec[]; progress: string[] } {
  const specs: JobSpec[] = []
  const progress: string[] = []
  return {
    service: {
      start(spec: JobSpec) {
        specs.push(spec)
        return { id: 'job_1' }
      },
    },
    specs,
    progress,
  }
}

function handleOf(progress: string[]): JobHandle {
  return {
    id: 'job_1',
    append: (text: string) => progress.push(text),
    updateProgress: (line: string) => progress.push(line),
  }
}

function cardOf(cardId: string, path: string, method = 'GET'): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: `${method} ${path}`, method, urlTemplate: path },
    inputs: [],
    outputs: [],
    sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }],
  }
}

function writeCard(workspace: string, card: InterfaceCardDoc): void {
  const dir = cardsRoot(workspace)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${card.cardId}.yaml`), JSON.stringify(card, null, 2), 'utf8')
}

/** 落一份真链（走唯一写入口 saveChain：它自己校验卡引用与拓扑）。 */
function seedChain(workspace: string, flow: string, card: InterfaceCardDoc, nodeId = 'node-1'): ChainDoc {
  writeCard(workspace, card)
  const doc: ChainDoc = {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: '测试站点', flow, version: 1, created: '2026-10-17T00:00:00Z' },
    inputs: [],
    nodes: [{ id: nodeId, card: card.cardId, constants: {} }],
    edges: [],
  }
  const saved = saveChain(workspace, chainToYaml(doc), { source: 'agent' })
  if (!saved.ok) throw new Error(`夹具链落盘失败：${saved.issues.map((issue) => issue.reason).join('；')}`)
  return saved.doc
}

const CHAIN_CONFIG = {
  enabled: true,
  nodeTimeoutSeconds: 5,
  concurrency: 4,
  responseLimitBytes: 2_097_152,
  foregroundTimeoutSeconds: 60,
}

function depsOf(workspace: string, jobs: unknown = undefined): ChainRunToolDeps {
  return {
    captureDbPath: join(workspace, 'capture.sqlite'),
    resolveWorkspaceRoot: async () => workspace,
    dataRoot: join(workspace, 'data'),
    chain: CHAIN_CONFIG,
    resolveJobs: () => jobs,
  }
}

/** 完整 Config（status 工具走 DataforgeDeps，需要整份配置）。 */
function fullConfig(workspace: string): Required<Config> {
  return {
    engineRoot: workspace,
    pythonBin: 'python3',
    dataRoot: join(workspace, 'data'),
    timeoutSeconds: 600,
    injectPolicy: false,
    captureMaxDepth: 3,
    captureMaxPages: 50,
    captureStabilityWindowMs: 1500,
    captureBodyLimitBytes: 262_144,
    captureChromeChannel: 'chrome',
    chainRunEnabled: true,
    chainNodeTimeoutSeconds: 5,
    chainConcurrency: 4,
    chainResponseLimitBytes: 2_097_152,
    chainCredentialPersistence: true,
    uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright',
  }
}

/* ================================================================== 用例 */

describe('jobs 缺席：前台降级（诚实标注）', () => {
  it('kind=foreground + degradedNotice，summary 当场可用', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'chain-job-'))
    seedChain(workspace, '前台链', cardOf('card_ok', '/api/ok'))
    const deps = depsOf(workspace)

    const value = await chainRunForTool(deps, {}, { site: '测试站点', flow: '前台链', confirm: true })

    expect(value.ok).toBe(true)
    expect(value.accepted).toBe(true)
    expect(value.kind).toBe('foreground')
    expect(value.gate).toBe('started')
    expect(value.jobId).toBeUndefined()
    expect(value.degradedNotice).toContain('dsh-jobs')
    expect(value.summary?.status).toBe('completed')
    expect(value.nodes?.[0]?.nodeId).toBe('node-1')
    expect(value.nodes?.[0]?.status).toBe('done')
    expect(value.runId).toBeDefined()
  })
})

describe('jobs 在场：后台 job 路径', () => {
  it('spec 形状正确（kind/owner/输出上限），done 收敛 completed', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'chain-job-'))
    seedChain(workspace, '后台链', cardOf('card_ok', '/api/ok'))
    const fake = fakeJobs()
    const deps = depsOf(workspace, fake.service)

    const value = await chainRunForTool(deps, { agent: { id: 'agent-7' } }, {
      site: '测试站点', flow: '后台链', confirm: true,
    })

    expect(value.kind).toBe('background')
    expect(value.jobId).toBe('job_1')
    expect(value.runId).toBeDefined()

    const spec = fake.specs[0] as JobSpec
    expect(spec.kind).toBe('dataforge-chain')
    expect(spec.owner).toBe('agent-7')
    expect(spec.outputLimitBytes).toBe(65536)
    expect(spec.label).toContain('后台链')

    const progress: string[] = []
    const hooks = spec.run(handleOf(progress))
    const done = await hooks.done
    expect(done.status).toBe('completed')
    expect(progress.some((line) => line.includes('node-1'))).toBe(true)

    // 后台跑完之后，status 能看到节点级事实。
    const status = runStatus(
      buildDataforgeDeps({
        config: fullConfig(workspace),
        resolveJobs: () => undefined,
        resolveWorkspaceRoot: async () => workspace,
      }),
      value.runId,
    )
    expect(status.ok).toBe(true)
    expect(status.run?.status).toBe('completed')
    expect(status.run?.chain).toMatchObject({ site: '测试站点', flow: '后台链', version: 1 })
    expect(status.run?.chain?.completedNodes).toEqual(['node-1'])
  })

  it('cancel → 在飞请求中止，done 收敛 killed，status 也是 killed', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'chain-job-'))
    seedChain(workspace, '取消链', cardOf('card_hang', '/api/hang'))
    const fake = fakeJobs()
    const deps = depsOf(workspace, fake.service)

    const value = await chainRunForTool(deps, {}, { site: '测试站点', flow: '取消链', confirm: true })
    const spec = fake.specs[0] as JobSpec
    const hooks = spec.run(handleOf([]))
    setTimeout(() => hooks.cancel('test'), 100)
    const done = await hooks.done

    expect(done.status).toBe('killed')
    const status = runStatus(
      buildDataforgeDeps({
        config: fullConfig(workspace),
        resolveJobs: () => undefined,
        resolveWorkspaceRoot: async () => workspace,
      }),
      value.runId,
    )
    expect(status.run?.status).toBe('killed')
    expect(status.run?.stepsDone).toBe(0)
  })
})

describe('IF-2 dataforge_chain_runs：链维度留痕', () => {
  it('空态是 ok:true + notice（不是错误）', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'chain-job-'))
    const value = listChainRunsForTool(depsOf(workspace), { site: '测试站点', flow: '还没跑过' })
    expect(value.ok).toBe(true)
    expect(value.runs).toEqual([])
    expect(value.notice).toBe('该链暂无运行留痕')
  })

  it('跑两次（一次成功、一次失败）后按时间倒序列出，带版本与失败节点', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'chain-job-'))
    seedChain(workspace, '列表链', cardOf('card_ok', '/api/ok'))
    const deps = depsOf(workspace)
    await chainRunForTool(deps, {}, { site: '测试站点', flow: '列表链', confirm: true })

    seedChain(workspace, '坏链', cardOf('card_fail', '/api/fail'))
    const failed = await chainRunForTool(deps, {}, { site: '测试站点', flow: '坏链', confirm: true })
    expect(failed.summary?.status).toBe('failed')

    const okRuns = listChainRunsForTool(deps, { site: '测试站点', flow: '列表链' })
    expect(okRuns.runs).toHaveLength(1)
    expect(okRuns.runs?.[0]?.status).toBe('completed')
    expect(okRuns.runs?.[0]?.version).toBe(1)
    expect(okRuns.runs?.[0]?.stepsDone).toBe(1)
    expect(okRuns.runs?.[0]?.totalSteps).toBe(1)

    const badRuns = listChainRunsForTool(deps, { site: '测试站点', flow: '坏链' })
    expect(badRuns.runs?.[0]?.status).toBe('failed')
    expect(badRuns.runs?.[0]?.failedNode).toBe('node-1')
    expect(badRuns.runs?.[0]?.stepsDone).toBe(0)
  })

  it('version 收窄：只列指定链版本的运行；旧流程运行不参与过滤', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'chain-job-'))
    const card = cardOf('card_ok', '/api/ok')
    seedChain(workspace, '多版本链', card)
    const deps = depsOf(workspace)
    await chainRunForTool(deps, {}, { site: '测试站点', flow: '多版本链', confirm: true })

    // 再落一个新版本（v2），并跑一次。
    const doc: ChainDoc = {
      apiVersion: 'dataforge/v1',
      kind: 'interface-chain',
      meta: { site: '测试站点', flow: '多版本链', version: 1, created: '2026-10-17T00:00:00Z' },
      inputs: [],
      nodes: [{ id: 'node-1', card: card.cardId, constants: {} }],
      edges: [],
    }
    saveChain(workspace, chainToYaml(doc), { source: 'agent' })
    await chainRunForTool(deps, {}, { site: '测试站点', flow: '多版本链', confirm: true })

    const all = listChainRunsForTool(deps, { site: '测试站点', flow: '多版本链' })
    expect(all.runs).toHaveLength(2)
    expect(all.runs?.map((run) => run.version)).toEqual([2, 1])

    const onlyV1 = listChainRunsForTool(deps, { site: '测试站点', flow: '多版本链', version: 1 })
    expect(onlyV1.runs).toHaveLength(1)
    expect(onlyV1.runs?.[0]?.version).toBe(1)
  })

  it('limit 生效', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'chain-job-'))
    seedChain(workspace, '多条链', cardOf('card_ok', '/api/ok'))
    const deps = depsOf(workspace)
    for (let index = 0; index < 3; index += 1) {
      await chainRunForTool(deps, {}, { site: '测试站点', flow: '多条链', confirm: true })
    }
    expect(listChainRunsForTool(deps, { site: '测试站点', flow: '多条链', limit: 2 }).runs).toHaveLength(2)
  })
})
