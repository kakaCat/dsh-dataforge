/**
 * S5 cleanup：链级声明式清理。
 *
 * 验：清理链进入主计划卡（此时零请求）→ 主链+清理链同一确认执行；
 * onFailure/always；清理失败不覆盖主链；缺清理链在第一个请求前挡住。
 *
 * @module dsh-dataforge/test/orchestration/cleanup
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chainToYaml, type ChainDoc } from '../../src/chains/schema.js'
import { saveChain } from '../../src/chains/store.js'
import { writeCard } from '../../src/library/store.js'
import type { LibraryCard, LibraryFieldType } from '../../src/library/types.js'
import { chainRunForTool, type ChainRunToolDeps } from '../../src/orchestration/application.js'
import { defineChainRunTool } from '../../src/tools.js'

let workspace: string
let dataRoot: string
let server: Server
let baseUrl: string
let seen: Array<{ method: string; path: string; query: string; body: string }>
let mainCode = 0
let cleanupStatus = 200
let cleanupBody = '{"ok":true}'

const CHAIN_CONFIG = {
  enabled: true,
  nodeTimeoutSeconds: 5,
  concurrency: 2,
  responseLimitBytes: 2_097_152,
  foregroundTimeoutSeconds: 30,
}

function card(cardId: string, method: string, path: string, inputs: Array<{ path: string; type: LibraryFieldType; required: boolean }>, outputs: Array<{ path: string; type: LibraryFieldType }>): LibraryCard {
  return {
    cardId, kind: 'interface-card',
    identity: { mergeKey: `${method} ${path}`, method, urlTemplate: path },
    inputs: inputs.map((field) => ({ ...field, role: 'input' as const })),
    outputs,
    auth: 'none',
    sources: [{ captureId: 'cap_cleanup', pages: [`${baseUrl}/page`], relationIds: [] }],
  }
}

function seed(doc: ChainDoc): void {
  const saved = saveChain(workspace, chainToYaml({ ...doc, meta: { ...doc.meta, site: 'CleanupSite' } }), { source: 'agent' })
  if (!saved.ok) throw new Error(saved.issues.map((issue) => issue.reason).join('; '))
}

function mainDoc(cleanupWhen: 'onFailure' | 'always' = 'always', cleanupFlow = 'cleanup', cleanupInputs: Record<string, string> = { id: '$inputs.name' }): ChainDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: 'CleanupSite', flow: 'create', version: 1, created: '2026-10-18T00:00:00Z' },
    inputs: [{ name: 'name', type: 'string', required: true }],
    nodes: [{ id: 'create', card: 'card_main', constants: { 'body.name': '$inputs.name' }, expect: { path: 'body.code', equals: 0 } }],
    edges: [],
    cleanup: {
      when: cleanupWhen,
      chain: { site: 'CleanupSite', flow: cleanupFlow },
      inputs: cleanupInputs,
    },
  }
}

function cleanupDoc(): ChainDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: 'CleanupSite', flow: 'cleanup', version: 1, created: '2026-10-18T00:00:00Z' },
    inputs: [{ name: 'id', type: 'string', required: true }],
    nodes: [{ id: 'remove', card: 'card_cleanup', constants: { 'query.id': '$inputs.id' }, expect: { path: 'body.ok', equals: true } }],
    edges: [],
  }
}

function deps(): ChainRunToolDeps {
  return {
    captureDbPath: join(workspace, 'capture.sqlite'),
    resolveWorkspaceRoot: async () => workspace,
    dataRoot,
    chain: { ...CHAIN_CONFIG },
    resolveJobs: () => undefined,
  }
}

beforeEach(async () => {
  seen = []
  mainCode = 0
  cleanupStatus = 200
  cleanupBody = '{"ok":true}'
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const parsed = new URL(req.url ?? '/', 'http://127.0.0.1')
      seen.push({ method: req.method ?? '', path: parsed.pathname, query: parsed.search, body: Buffer.concat(chunks).toString('utf8') })
      res.setHeader('content-type', 'application/json')
      if (parsed.pathname === '/api/items' && req.method === 'POST') {
        res.end(JSON.stringify({ code: mainCode, id: 'ITEM-1' }))
      } else if (parsed.pathname === '/api/items' && req.method === 'DELETE') {
        res.statusCode = cleanupStatus
        res.end(cleanupBody)
      } else {
        res.statusCode = 404
        res.end('{}')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock 未监听')
  baseUrl = `http://127.0.0.1:${address.port}`
  workspace = mkdtempSync(join(tmpdir(), 'df-cleanup-'))
  dataRoot = join(workspace, 'data')
  writeCard(workspace, card('card_main', 'POST', '/api/items', [{ path: 'body.name', type: 'string', required: true }], [{ path: 'body.id', type: 'string' }]))
  writeCard(workspace, card('card_cleanup', 'DELETE', '/api/items', [{ path: 'query.id', type: 'string', required: true }], [{ path: 'body.ok', type: 'boolean' }]))
  seed(cleanupDoc())
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('cleanup', () => {
  it('always：计划卡含清理链且零请求；确认后主链+清理链执行', async () => {
    seed(mainDoc('always'))
    const planned = await chainRunForTool(deps(), undefined, {
      site: 'CleanupSite', flow: 'create', inputs: { name: 'ITEM-1' }, baseUrl,
    })
    expect(planned.gate).toBe('confirm-required')
    expect(planned.plan?.cleanup).toEqual({
      site: 'CleanupSite', flow: 'cleanup', version: 1, when: 'always', nodeCount: 1, writeCount: 1,
    })
    expect(seen).toHaveLength(0)
    expect(planned.card).toContain('清理')
    const tool = defineChainRunTool(deps()) as unknown as {
      execute: (args: { site: string; flow: string; inputs: Record<string, unknown>; baseUrl: string }, exec?: unknown) => Promise<{ plan?: { cleanup?: unknown } }>
    }
    const viaTool = await tool.execute({ site: 'CleanupSite', flow: 'create', inputs: { name: 'ITEM-1' }, baseUrl }, undefined)
    expect(viaTool.plan?.cleanup).toBeDefined()
    expect(seen).toHaveLength(0)

    const executed = await chainRunForTool(deps(), undefined, {
      site: 'CleanupSite', flow: 'create', inputs: { name: 'ITEM-1' }, baseUrl, confirm: true,
    })
    expect(executed.ok).toBe(true)
    if (!executed.ok) return
    expect(executed.summary?.status).toBe('completed')
    expect(executed.cleanup?.status).toBe('completed')
    expect(seen.map((entry) => entry.method)).toEqual(['POST', 'DELETE'])
    expect(seen[1]?.query).toContain('ITEM-1')
  })

  it('cleanup 入参可从主链 businessData.outputs 绑定', async () => {
    seed(mainDoc('always', 'cleanup', { id: '$result.outputs.create.body.id' }))
    const executed = await chainRunForTool(deps(), undefined, {
      site: 'CleanupSite', flow: 'create', inputs: { name: 'demo' }, baseUrl, confirm: true,
    })
    expect(executed.summary?.status).toBe('completed')
    expect(executed.cleanup?.status).toBe('completed')
    expect(seen[1]?.query).toContain('ITEM-1')
  })

  it('onFailure：成功不清理，失败清理；清理失败不覆盖主链', async () => {
    seed(mainDoc('onFailure'))
    const success = await chainRunForTool(deps(), undefined, {
      site: 'CleanupSite', flow: 'create', inputs: { name: 'ITEM-1' }, baseUrl, confirm: true,
    })
    expect(success.summary?.status).toBe('completed')
    expect(success.cleanup).toBeUndefined()
    expect(seen.map((entry) => entry.method)).toEqual(['POST'])

    seen = []
    mainCode = 1
    cleanupStatus = 500
    cleanupBody = '{"ok":false}'
    const failed = await chainRunForTool(deps(), undefined, {
      site: 'CleanupSite', flow: 'create', inputs: { name: 'ITEM-1' }, baseUrl, confirm: true,
    })
    expect(failed.summary?.status).toBe('failed')
    expect(failed.cleanup?.status).toBe('failed')
    expect(seen.map((entry) => entry.method)).toEqual(['POST', 'DELETE'])
  })

  it('cleanup 不能指向自身（保存时校验）', () => {
    const self = mainDoc('always', 'create')
    const saved = saveChain(workspace, chainToYaml({ ...self, meta: { ...self.meta, site: 'CleanupSite' } }), { source: 'agent' })
    expect(saved.ok).toBe(false)
    if (saved.ok) return
    expect(saved.issues.some((issue) => issue.reason.includes('自身'))).toBe(true)
  })

  it('cleanup 链不存在：计划阶段挡住，零请求', async () => {
    seed(mainDoc('always', 'missing-cleanup'))
    const blocked = await chainRunForTool(deps(), undefined, {
      site: 'CleanupSite', flow: 'create', inputs: { name: 'ITEM-1' }, baseUrl,
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe('invalid-chain')
    expect(seen).toHaveLength(0)
  })
})
