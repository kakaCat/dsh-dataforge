/**
 * S5 verify：链级 UI 验收随主链确认，主链成功后执行；不覆盖主链结果。
 *
 * @module dsh-dataforge/test/orchestration/verify
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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
let seen: string[]
let mainCode = 0
let verifyCalls: Array<{ site: string; flow: string; inputs: Record<string, string> }>

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
    sources: [{ captureId: 'cap_verify', pages: [`${baseUrl}/page`], relationIds: [] }],
  }
}

function mainDoc(when: 'onSuccess' | 'onFailure' | 'always' = 'onSuccess', verifyInputs: Record<string, string> = { id: '$result.outputs.create.body.id' }): ChainDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: 'VerifySite', flow: 'create', version: 1, created: '2026-10-18T00:00:00Z' },
    inputs: [{ name: 'name', type: 'string', required: true }],
    nodes: [{ id: 'create', card: 'card_main', constants: { 'body.name': '$inputs.name' }, expect: { path: 'body.code', equals: 0 } }],
    edges: [],
    verify: {
      when,
      ui: { site: 'UiSite', flow: 'verify-view' },
      inputs: verifyInputs,
    },
  }
}

function seed(doc: ChainDoc): void {
  const saved = saveChain(workspace, chainToYaml({ ...doc, meta: { ...doc.meta, site: 'VerifySite' } }), { source: 'agent' })
  if (!saved.ok) throw new Error(saved.issues.map((issue) => issue.reason).join('; '))
}

function deps(): ChainRunToolDeps {
  return {
    captureDbPath: join(workspace, 'capture.sqlite'),
    resolveWorkspaceRoot: async () => workspace,
    dataRoot,
    chain: { ...CHAIN_CONFIG },
    resolveJobs: () => undefined,
    verifyUi: async (request) => {
      verifyCalls.push({ site: request.site, flow: request.flow, inputs: request.inputs })
      return { runId: 'uir_verify', success: true, status: 'success', screenshot: 'ui-runs/uir_verify/success.png' }
    },
  }
}

beforeEach(async () => {
  seen = []
  verifyCalls = []
  mainCode = 0
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      seen.push(`${req.method ?? ''} ${(req.url ?? '').split('?')[0] ?? ''}`)
      res.setHeader('content-type', 'application/json')
      if ((req.url ?? '').startsWith('/api/items') && req.method === 'POST') {
        res.end(JSON.stringify({ code: mainCode, id: 'ITEM-1' }))
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
  workspace = mkdtempSync(join(tmpdir(), 'df-verify-'))
  dataRoot = join(workspace, 'data')
  const uiDir = join(dataRoot, 'ui-runs', 'uir_verify')
  mkdirSync(uiDir, { recursive: true })
  writeFileSync(join(uiDir, 'success.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(uiDir, 'run.json'), JSON.stringify({
    runId: 'uir_verify', kind: 'ui-run', status: 'success', site: 'UiSite', flow: 'verify-view', version: 1,
    startUrl: 'https://example.test/', startedAt: 1, finishedAt: 2, totalSteps: 1, stepsDone: 1,
    screenshot: 'ui-runs/uir_verify/success.png',
  }), 'utf8')
  writeFileSync(join(uiDir, 'events.ndjson'), JSON.stringify({ event: 'terminal', success: true }), 'utf8')
  writeCard(workspace, card('card_main', 'POST', '/api/items', [{ path: 'body.name', type: 'string', required: true }], [{ path: 'body.id', type: 'string' }]))
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('verify', () => {
  it('计划卡含 UI 验收且零请求；确认后主链成功 → verify 收到结果绑定', async () => {
    seed(mainDoc('onSuccess'))
    const planned = await chainRunForTool(deps(), undefined, {
      site: 'VerifySite', flow: 'create', inputs: { name: 'demo' }, baseUrl,
    })
    expect(planned.gate).toBe('confirm-required')
    expect(planned.plan?.verify).toEqual({ site: 'UiSite', flow: 'verify-view', when: 'onSuccess' })
    expect(seen).toHaveLength(0)
    expect(verifyCalls).toHaveLength(0)
    expect(planned.card).toContain('验收')

    const tool = defineChainRunTool(deps()) as unknown as {
      execute: (args: { site: string; flow: string; inputs: Record<string, unknown>; baseUrl: string; confirm: boolean }, exec?: unknown) => Promise<{ verify?: { status?: string; screenshot?: string; reportPath?: string; datasetPath?: string } }>
    }
    const executed = await tool.execute({ site: 'VerifySite', flow: 'create', inputs: { name: 'demo' }, baseUrl, confirm: true }, undefined)
    expect(seen).toEqual(['POST /api/items'])
    expect(verifyCalls).toHaveLength(1)
    expect(verifyCalls[0]?.inputs).toEqual({ id: 'ITEM-1' })
    expect(executed.verify?.status).toBe('success')
    expect(executed.verify?.screenshot).toContain('success.png')
    expect(executed.verify?.reportPath).toContain('report.html')
    expect(executed.verify?.datasetPath).toContain('datasets')
  })

  it('onFailure：主链成功不验收，失败才验收', async () => {
    seed(mainDoc('onFailure', { id: '$inputs.name' }))
    const success = await chainRunForTool(deps(), undefined, {
      site: 'VerifySite', flow: 'create', inputs: { name: 'demo' }, baseUrl, confirm: true,
    })
    expect(success.summary?.status).toBe('completed')
    expect(success.verify).toBeUndefined()
    expect(verifyCalls).toHaveLength(0)

    mainCode = 1
    seen = []
    const failed = await chainRunForTool(deps(), undefined, {
      site: 'VerifySite', flow: 'create', inputs: { name: 'demo' }, baseUrl, confirm: true,
    })
    expect(failed.summary?.status).toBe('failed')
    expect(failed.verify?.status).toBe('success')
    expect(verifyCalls).toHaveLength(1)
    expect(verifyCalls[0]?.inputs).toEqual({ id: 'demo' })
    expect(seen).toEqual(['POST /api/items'])
  })

  it('verify 缺执行器：只标记 skipped，不覆盖主链', async () => {
    seed(mainDoc('always'))
    const noVerify = { ...deps(), verifyUi: undefined }
    const executed = await chainRunForTool(noVerify, undefined, {
      site: 'VerifySite', flow: 'create', inputs: { name: 'demo' }, baseUrl, confirm: true,
    })
    expect(executed.summary?.status).toBe('completed')
    expect(executed.verify?.skipped).toContain('未装配')
  })
})
