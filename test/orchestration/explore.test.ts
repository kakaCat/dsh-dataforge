/**
 * 探索执行的应用层（R-5 M1）：载链 → 找节点/卡 → baseUrl → probe。
 *
 * 这一组验「工具入口的闸」：执行开关、链/节点/卡不存在、baseUrl 推不出，
 * 以及一条真实 probe 能落到工作区的 runs/ 下。
 *
 * @module dsh-dataforge/test/orchestration/explore
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
import type { ChainRunToolDeps } from '../../src/orchestration/application.js'
import { probeForTool } from '../../src/orchestration/explore.js'
import { listRunIds } from '../../src/runs/store.js'

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
      if ((req.url ?? '').startsWith('/api/materials')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"items":[{"internalId":"M-9"}]}')
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
  return mkdtempSync(join(tmpdir(), 'explore-'))
}

function depsOf(workspace: string, enabled = true): ChainRunToolDeps {
  return {
    captureDbPath: join(workspace, 'capture.sqlite'),
    resolveWorkspaceRoot: async () => workspace,
    dataRoot: join(workspace, 'data'),
    chain: { ...CHAIN_CONFIG, enabled },
    resolveJobs: () => undefined,
  }
}

function cardOf(cardId: string, inputs: InterfaceCardDoc['inputs'] = [], origin?: string): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: 'GET /api/materials?q={q}', method: 'GET', urlTemplate: '/api/materials?q={q}' },
    inputs,
    outputs: [{ path: 'body.items[*].internalId', type: 'string' }],
    ...(origin === undefined ? {} : { sources: [{ captureId: 'cap_1', pages: [`${origin}/page`] }] }),
  }
}

function writeCard(workspace: string, card: InterfaceCardDoc): void {
  const dir = cardsRoot(workspace)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${card.cardId}.yaml`), JSON.stringify(card, null, 2), 'utf8')
}

function seedChain(workspace: string, flow: string, nodeCard: string, constants: Record<string, string> = {}): void {
  const doc: ChainDoc = {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: '测试站点', flow, version: 1, created: '2026-10-17T00:00:00Z' },
    inputs: [],
    nodes: [{ id: 'n1', card: nodeCard, constants }],
    edges: [],
  }
  const saved = saveChain(workspace, chainToYaml(doc), { source: 'agent' })
  if (!saved.ok) throw new Error(`夹具链落盘失败：${saved.issues.map((issue) => issue.reason).join('；')}`)
}

const CARD = cardOf('card_1', [
  { path: 'query.q', type: 'string' },
  { path: 'query.orgId', type: 'string' },
])

describe('probeForTool：入口闸', () => {
  it('执行开关关闭 → probe-disabled，零 run', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, { ...CARD, sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }] })
    seedChain(workspace, '首跑', 'card_1')
    const deps = depsOf(workspace, false)

    const value = await probeForTool(deps, {}, { site: '测试站点', flow: '首跑', node: 'n1' })

    expect(value.gate).toBe('blocked')
    expect(value.code).toBe('probe-disabled')
    expect(listRunIds(deps.dataRoot, 10)).toHaveLength(0)
  })

  it('节点不存在 → node-not-found，并列出可用节点', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, CARD)
    seedChain(workspace, '首跑', 'card_1')
    const value = await probeForTool(depsOf(workspace), {}, { site: '测试站点', flow: '首跑', node: 'nope' })
    expect(value.code).toBe('node-not-found')
    expect(value.message).toContain('n1')
  })

  it('baseUrl 推不出 → base-url-unresolved', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, CARD)
    seedChain(workspace, '首跑', 'card_1')
    const value = await probeForTool(depsOf(workspace), {}, { site: '测试站点', flow: '首跑', node: 'n1' })
    expect(value.code).toBe('base-url-unresolved')
  })

  it('缺参 → paused，run 落盘；补值后 → executed + outputs', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, { ...CARD, sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }] })
    seedChain(workspace, '首跑', 'card_1')
    const deps = depsOf(workspace)

    const paused = await probeForTool(deps, {}, {
      site: '测试站点',
      flow: '首跑',
      node: 'n1',
      values: { 'query.q': { value: '螺丝', source: 'user' } },
    })
    expect(paused.gate).toBe('paused')
    expect(paused.gaps?.map((gap) => gap.path)).toEqual(['query.orgId'])
    expect(paused.runId).toBeDefined()

    const executed = await probeForTool(deps, {}, {
      site: '测试站点',
      flow: '首跑',
      node: 'n1',
      values: {
        'query.q': { value: '螺丝', source: 'user' },
        'query.orgId': { value: '2120', source: 'user' },
      },
    })
    expect(executed.gate).toBe('executed')
    expect(executed.outputs?.find((output) => output.path === 'body.items[*].internalId')?.valuePreview).toBe('M-9')
    expect(listRunIds(deps.dataRoot, 20).length).toBeGreaterThanOrEqual(2)
  })
})
