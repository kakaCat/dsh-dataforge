/**
 * 复跑诊断（R-6 M2）：失败的链运行 → 断点/入边/上游状态/建议。
 *
 * 用真实 `chainRunForTool` 造一条绑定失败的 run，再只读诊断；不 mock 事件。
 *
 * @module dsh-dataforge/test/orchestration/diagnose
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { chainToYaml } from '../../src/chains/schema.js'
import { cardsRoot, saveChain } from '../../src/chains/store.js'
import { chainRunForTool, type ChainRunToolDeps } from '../../src/orchestration/application.js'
import { probeForTool } from '../../src/orchestration/explore.js'
import { diagnoseForTool } from '../../src/orchestration/diagnose.js'

const CHAIN_CONFIG = {
  enabled: true,
  nodeTimeoutSeconds: 5,
  concurrency: 2,
  responseLimitBytes: 2_097_152,
  foregroundTimeoutSeconds: 60,
}

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const url = new URL(req.url ?? '/', base)
      if (url.pathname === '/api/materials') {
        const q = url.searchParams.get('q') ?? ''
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(q === 'Z' ? '{"items":[]}' : `{"items":[{"internalId":"${q}-ID"}]}`)
        return
      }
      if (url.pathname === '/api/orders') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"orderNo":"PO-1"}')
        return
      }
      res.writeHead(404)
      res.end('nope')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function workspaceOf(): string {
  return mkdtempSync(join(tmpdir(), 'diagnose-'))
}

function depsOf(workspace: string): ChainRunToolDeps {
  return {
    captureDbPath: join(workspace, 'capture.sqlite'),
    resolveWorkspaceRoot: async () => workspace,
    dataRoot: join(workspace, 'data'),
    chain: CHAIN_CONFIG,
    resolveJobs: () => undefined,
  }
}

function cardOf(cardId: string, method: string, urlTemplate: string, inputs: InterfaceCardDoc['inputs'], outputs: InterfaceCardDoc['outputs'] = []): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: `${method} ${urlTemplate}`, method, urlTemplate },
    inputs,
    outputs,
    sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }],
  }
}

function writeCard(workspace: string, card: InterfaceCardDoc): void {
  const dir = cardsRoot(workspace)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${card.cardId}.yaml`), JSON.stringify(card, null, 2), 'utf8')
}

function seedChain(workspace: string): void {
  const doc: ChainDoc = {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: '测试站点', flow: '诊断', version: 1, created: '2026-10-17T00:00:00Z' },
    inputs: [],
    nodes: [
      { id: 'query', card: 'card_query', constants: { 'query.q': 'Z' } },
      { id: 'order', card: 'card_order', constants: { 'body.quantity': '1' } },
    ],
    edges: [{ from: 'query.body.items[0].internalId', to: 'order.body.materialId' }],
  }
  const saved = saveChain(workspace, chainToYaml(doc), { source: 'agent' })
  if (!saved.ok) throw new Error(saved.issues.map((issue) => issue.reason).join('；'))
}

const queryCard = (): InterfaceCardDoc => cardOf('card_query', 'GET', '/api/materials?q={q}', [
  { path: 'query.q', type: 'string' },
], [{ path: 'body.items[0].internalId', type: 'string' }])
const orderCard = (): InterfaceCardDoc => cardOf('card_order', 'POST', '/api/orders', [
  { path: 'body.materialId', type: 'string' },
  { path: 'body.quantity', type: 'number' },
])

describe('diagnoseForTool：失败链的断点报告', () => {
  it('绑定失败 → failedNode + 入边可疑 + 上游状态 + 建议', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, queryCard())
    writeCard(workspace, orderCard())
    seedChain(workspace)
    const deps = depsOf(workspace)

    const failed = await chainRunForTool(deps, {}, { site: '测试站点', flow: '诊断', confirm: true })
    expect(failed.summary?.status).toBe('failed')
    expect(failed.runId).toBeDefined()

    const diagnosis = await diagnoseForTool(deps, {}, { runId: failed.runId ?? '' })
    expect(diagnosis.ok).toBe(true)
    expect(diagnosis.failedNode).toBe('order')
    expect(diagnosis.errorCode).toBe('binding-path-not-found')
    expect(diagnosis.nodes?.find((node) => node.nodeId === 'query')?.status).toBe('done')
    expect(diagnosis.nodes?.find((node) => node.nodeId === 'order')?.status).toBe('error')
    expect(diagnosis.edges).toHaveLength(1)
    expect(diagnosis.edges?.[0]).toMatchObject({
      from: 'query.body.items[0].internalId',
      to: 'order.body.materialId',
      sourceNode: 'query',
      sourceStatus: 'done',
      suspect: true,
    })
    expect(diagnosis.hints?.some((hint) => hint.includes('绑定断点'))).toBe(true)
  })

  it('run 不存在 / 不是链运行 → 诚实错误', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, queryCard())
    writeCard(workspace, orderCard())
    seedChain(workspace)
    const deps = depsOf(workspace)

    const missing = await diagnoseForTool(deps, {}, { runId: 'chain-nope' })
    expect(missing.code).toBe('run-not-found')

    const probe = await probeForTool(deps, {}, {
      site: '测试站点',
      flow: '诊断',
      node: 'query',
      values: { 'query.q': { value: 'A', source: 'user' } },
    })
    expect(probe.gate).toBe('executed')
    const notChain = await diagnoseForTool(deps, {}, { runId: probe.runId ?? '' })
    expect(notChain.code).toBe('not-a-chain-run')
  })
})
