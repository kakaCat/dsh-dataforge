/**
 * 编排面板数据路由：overview / graph 读，graph 写（画布保存）。
 *
 * @module dsh-dataforge/test/orchestration/panel-routes
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createOrchestrationPanelHandler } from '../../src/orchestration/panel-routes.js'
import { chainFilePath, cardsRoot, saveChain } from '../../src/chains/store.js'
import { chainToYaml } from '../../src/chains/schema.js'
import { allCards, chainDoc } from '../chains/fixtures.js'

let dir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-orch-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function workspace(): string {
  return dir as string
}

function writeCards(): void {
  const cards = cardsRoot(workspace())
  mkdirSync(cards, { recursive: true })
  for (const card of [allCards('card_000123'), allCards('card_000457')]) {
    if (card === undefined) continue
    writeFileSync(join(cards, `${card.cardId}.yaml`), JSON.stringify(card, null, 2), 'utf8')
  }
}

function seedChain(): void {
  writeCards()
  const saved = saveChain(workspace(), chainDoc(), { resolveCard: allCards, source: 'agent' })
  expect(saved.ok).toBe(true)
}

interface FakeResponse {
  status: number
  body: string
}

function serve(method: string, url: string, body?: string, root?: string): FakeResponse {
  const captured: FakeResponse = { status: 0, body: '' }
  const res = {
    writeHead: (status: number) => { captured.status = status },
    end: (payload: string) => { captured.body = payload },
  }
  const req = {
    method,
    url,
    on: (event: string, cb: (chunk?: unknown) => void) => {
      if (event === 'data' && body !== undefined) cb(Buffer.from(body, 'utf8'))
      if (event === 'end') cb()
    },
  }
  createOrchestrationPanelHandler({ resolveWorkspaceRoot: async () => root ?? workspace() })(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  )
  return captured
}

function json(response: FakeResponse): { success: boolean; data?: Record<string, unknown>; error?: string; code?: string } {
  return JSON.parse(response.body) as { success: boolean; data?: Record<string, unknown>; error?: string; code?: string }
}

/** 路由是异步处理体，等一轮微任务再读结果。 */
async function serveAsync(method: string, url: string, body?: string, root?: string): Promise<FakeResponse> {
  const captured = serve(method, url, body, root)
  await new Promise((resolve) => setTimeout(resolve, 0))
  // handle() 是 async：第一次调用返回后 res 可能还没写，轮询到有 body 为止。
  for (let i = 0; i < 50 && captured.status === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return captured
}

const OVERVIEW = '/dashboard/api/dataforge/orchestration/overview'
const GRAPH = '/dashboard/api/dataforge/orchestration/graph'

describe('GET /orchestration/overview', () => {
  it('没有链时是空列表，不是错误', async () => {
    const response = await serveAsync('GET', OVERVIEW)
    expect(response.status).toBe(200)
    const payload = json(response)
    expect(payload.success).toBe(true)
    expect(payload.data?.sites).toEqual([])
    expect(payload.data?.flows).toEqual([])
  })

  it('按网站折叠，并带上 kind / 业务域 / 版本 / 节点边数', async () => {
    writeCards()
    saveChain(workspace(), chainDoc({ meta: { ...chainDoc().meta, domain: '采购域' } }), {
      resolveCard: allCards,
      source: 'agent',
    })
    saveChain(workspace(), chainDoc({ meta: { ...chainDoc().meta, domain: '采购域' } }), {
      resolveCard: allCards,
      source: 'canvas',
    })

    const response = await serveAsync('GET', OVERVIEW)
    const payload = json(response)
    expect(payload.success).toBe(true)
    const sites = payload.data?.sites as Array<Record<string, unknown>>
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ site: '智慧供应链-scm', flows: 1, pageFlows: 0, apiFlows: 1 })
    expect(sites[0]?.domains).toEqual(['采购域'])

    const flows = payload.data?.flows as Array<Record<string, unknown>>
    expect(flows[0]).toMatchObject({ kind: 'interface-chain', domain: '采购域', latest: 2, nodeCount: 2, edgeCount: 1 })
    const versions = flows[0]?.versions as Array<Record<string, unknown>>
    expect(versions.map((v) => v.version)).toEqual([1, 2])
    // 旧版本被标注取代，最新版不是
    expect(versions[0]?.superseded).toBe(true)
    expect(versions[1]?.superseded).toBe(false)
    // 来源如写入方声明那样区分开
    expect(versions[0]?.source).toBe('agent')
    expect(versions[1]?.source).toBe('canvas')
  })

  it('坏版本文件不炸整页：版本行带 unreadable', async () => {
    seedChain()
    writeFileSync(chainFilePath(workspace(), '智慧供应链 SCM', '采购下单', 1), 'nodes: [ 坏', 'utf8')
    const response = await serveAsync('GET', OVERVIEW)
    const payload = json(response)
    expect(payload.success).toBe(true)
    const flows = payload.data?.flows as Array<Record<string, unknown>>
    const versions = flows[0]?.versions as Array<Record<string, unknown>>
    expect(versions[0]?.unreadable).toBeTruthy()
  })
})

describe('GET /orchestration/graph', () => {
  it('返回画布要的节点/边与 YAML 原文', async () => {
    seedChain()
    const response = await serveAsync('GET', `${GRAPH}?site=${encodeURIComponent('智慧供应链 SCM')}&flow=${encodeURIComponent('采购下单')}`)
    expect(response.status).toBe(200)
    const data = json(response).data as Record<string, unknown>
    expect(data.version).toBe(1)
    expect(data.kind).toBe('interface-chain')
    const doc = data.doc as Record<string, unknown>
    const nodes = doc.nodes as Array<Record<string, unknown>>
    expect(nodes).toHaveLength(2)
    expect(nodes[0]?.id).toBe('query-material')
    expect(String(data.chainYaml)).toContain('apiVersion: dataforge/v1')
    // 卡身份按 cardId 解析出来（画布显示方法/地址用），且不含凭证
    const cards = data.cards as Record<string, Record<string, unknown>>
    expect(cards.card_000123).toMatchObject({ method: 'GET', urlTemplate: '/api/materials?q={q}' })
    // 字段路径表随卡下发：画布「连线即绑定」的下拉候选来自这里（FR-2.3）
    expect(cards.card_000123?.inputs).toEqual([
      { path: 'query.q', type: 'string', required: true },
      { path: 'query.orgId', type: 'string', required: true },
    ])
    expect(cards.card_000457?.outputs).toEqual([{ path: 'body.orderNo', type: 'string' }])
    // 零凭证：卡投影里不该出现 auth/sources/任何 value 字段
    expect(Object.keys(cards.card_000123 ?? {})).not.toContain('auth')
  })

  it('缺 site/flow 是 400，链不存在是 404', async () => {
    const missing = await serveAsync('GET', GRAPH)
    expect(missing.status).toBe(400)
    expect(json(missing).code).toBe('missing-param')

    const absent = await serveAsync('GET', `${GRAPH}?site=不存在&flow=也不存在`)
    expect(absent.status).toBe(404)
    expect(json(absent).code).toBe('chain-not-found')
  })

  it('坏链文件是 422 + invalid-chain（不假装能画）', async () => {
    seedChain()
    writeFileSync(chainFilePath(workspace(), '智慧供应链 SCM', '采购下单', 1), 'kind: interface-chain\nmeta: {}\n', 'utf8')
    const response = await serveAsync('GET', `${GRAPH}?site=${encodeURIComponent('智慧供应链 SCM')}&flow=${encodeURIComponent('采购下单')}`)
    expect(response.status).toBe(422)
    expect(json(response).code).toBe('invalid-chain')
  })
})

describe('POST /orchestration/graph（画布保存）', () => {
  it('落成新版本，来源标 canvas', async () => {
    seedChain()
    const next = chainToYaml(chainDoc({ meta: { ...chainDoc().meta, domain: '采购域' } }))
    const response = await serveAsync('POST', GRAPH, JSON.stringify({ chainYaml: next }))
    const payload = json(response)
    expect(payload.success).toBe(true)
    expect(payload.data).toMatchObject({ ok: true, version: 2 })

    const overview = json(await serveAsync('GET', OVERVIEW))
    const versions = (overview.data?.flows as Array<Record<string, unknown>>)[0]?.versions as Array<Record<string, unknown>>
    expect(versions[1]?.source).toBe('canvas')
  })

  it('接受 doc 形态（画布回传可编辑副本）：链级 inputs 原样保留', async () => {
    seedChain()
    const base = chainDoc() as unknown as Record<string, unknown>
    // 槽位必须真被引用（R-1 的「僵尸槽位」校验）：这里让 orgId 槽位顶掉原来的常量。
    const doc = {
      ...base,
      inputs: [{ name: 'orgId', type: 'string', required: true }],
      nodes: (base.nodes as Array<Record<string, unknown>>).map((node, index) => (
        index === 0
          ? { ...node, constants: { 'query.orgId': '$inputs.orgId' }, layout: { x: 40, y: 80 } }
          : node
      )),
    }
    const response = await serveAsync('POST', GRAPH, JSON.stringify({ doc }))
    expect(json(response).data).toMatchObject({ ok: true, version: 2 })

    const graph = json(await serveAsync('GET', `${GRAPH}?site=${encodeURIComponent('智慧供应链 SCM')}&flow=${encodeURIComponent('采购下单')}`))
    const saved = graph.data?.doc as Record<string, unknown>
    expect(saved.inputs).toEqual([{ name: 'orgId', type: 'string', required: true }])
    expect((saved.nodes as Array<Record<string, unknown>>)[0]?.layout).toEqual({ x: 40, y: 80 })
    expect(saved.meta).toMatchObject({ version: 2, source: 'canvas' })
  })

  it('source=import 的导入版本被如实标注（与画布保存区分开）', async () => {
    seedChain()
    const response = await serveAsync('POST', GRAPH, JSON.stringify({
      chainYaml: chainToYaml(chainDoc()),
      source: 'import',
    }))
    expect(json(response).data).toMatchObject({ ok: true, version: 2 })

    const overview = json(await serveAsync('GET', OVERVIEW))
    const versions = (overview.data?.flows as Array<Record<string, unknown>>)[0]?.versions as Array<Record<string, unknown>>
    expect(versions[1]?.source).toBe('import')
  })

  it('source 只接受 canvas / import（别的值 400，不写不可解释的来源）', async () => {
    seedChain()
    const response = await serveAsync('POST', GRAPH, JSON.stringify({
      chainYaml: chainToYaml(chainDoc()),
      source: 'agent',
    }))
    expect(response.status).toBe(400)
    expect(json(response).code).toBe('bad-param')
  })

  it('校验不过不落盘，issues 原样回给画布', async () => {
    seedChain()
    const broken = chainToYaml({ ...chainDoc(), edges: [{ from: 'ghost.body.x', to: 'create-order.body.orgId' }] })
    const response = await serveAsync('POST', GRAPH, JSON.stringify({ chainYaml: broken }))
    const payload = json(response)
    expect(payload.success).toBe(true)
    expect(payload.data).toMatchObject({ ok: false, code: 'invalid-chain' })
    expect((payload.data?.issues as unknown[]).length).toBeGreaterThan(0)

    // 版本数没变
    const overview = json(await serveAsync('GET', OVERVIEW))
    const versions = (overview.data?.flows as Array<Record<string, unknown>>)[0]?.versions as Array<Record<string, unknown>>
    expect(versions).toHaveLength(1)
  })

  it('请求体不是 JSON / 没有 chainYaml 都是 400', async () => {
    const badJson = await serveAsync('POST', GRAPH, 'not-json')
    expect(badJson.status).toBe(400)
    expect(json(badJson).code).toBe('bad-json')

    const noField = await serveAsync('POST', GRAPH, JSON.stringify({ yaml: 'x' }))
    expect(noField.status).toBe(400)
    expect(json(noField).code).toBe('bad-param')
  })

  it('POST 到未知子路径是 405（写入口只有 /graph）', async () => {
    const response = await serveAsync('POST', `${OVERVIEW}`)
    expect(response.status).toBe(405)
    expect(json(response).code).toBe('method-not-allowed')
  })
})

describe('同一前缀内的分派（不赌宿主 prefix 匹配语义）', () => {
  it('编排路径交给编排 handler，其余仍归采集 handler', async () => {
    const { registerCapturePanelRoutes, isOrchestrationRequest } = await import('../../src/capture/panel-routes.js')
    const { CaptureStore } = await import('../../src/capture/store.js')

    const captureDir = mkdtempSync(join(tmpdir(), 'df-dispatch-'))
    const store = new CaptureStore(join(captureDir, 'c.sqlite'), join(captureDir, 'samples'), join(captureDir, 'e.ndjson'))
    let registered: ((req: unknown, res: unknown) => void) | undefined
    const webServer = {
      register: (route: { handler: (req: unknown, res: unknown) => void }) => {
        registered = route.handler
        return () => { /* dispose */ }
      },
    }
    registerCapturePanelRoutes(webServer as never, {
      store,
      orchestration: createOrchestrationPanelHandler({ resolveWorkspaceRoot: async () => workspace() }),
    })
    store.close()
    rmSync(captureDir, { recursive: true, force: true })
    expect(registered).toBeDefined()

    // 路径判定：完整路径与剩余路径两种形态都认
    expect(isOrchestrationRequest('/dashboard/api/dataforge/orchestration/overview')).toBe(true)
    expect(isOrchestrationRequest('/orchestration/graph?site=a')).toBe(true)
    expect(isOrchestrationRequest('/dashboard/api/dataforge/runs')).toBe(false)

    const response: FakeResponse = { status: 0, body: '' }
    const res = {
      writeHead: (status: number) => { response.status = status },
      end: (payload: string) => { response.body = payload },
    }
    registered?.(
      { method: 'GET', url: '/dashboard/api/dataforge/orchestration/overview', on: () => undefined } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    )
    for (let i = 0; i < 50 && response.status === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    // 编排 handler 认这个路径（空工作区 → 空列表），而不是采集 handler 的 unknown-path
    expect(response.status).toBe(200)
    expect(json(response).success).toBe(true)
  })
})

describe('GET /orchestration/palette（画布左栏拖拽源）', () => {
  it('列出库里的卡与采集到的页面，且不含凭证字段', async () => {
    const { writeCard } = await import('../../src/library/store.js')
    writeCard(workspace(), {
      cardId: 'card_000123',
      kind: 'interface-card',
      name: '搜索材料',
      identity: { mergeKey: 'GET /api/materials:q', method: 'GET', urlTemplate: '/api/materials?q={q}' },
      inputs: [{ path: 'query.q', type: 'string', required: true, role: 'input' }],
      outputs: [{ path: 'body.items[*].internalId', type: 'string' }],
      auth: 'cookie-session',
      authEvidence: 'header:cookie:JSESSIONID',
      sources: [{
        captureId: 'cap_1',
        pages: ['https://scm.example.com/materials', 'https://scm.example.com/materials/detail'],
        relationIds: [],
      }],
    })

    const response = await serveAsync('GET', '/dashboard/api/dataforge/orchestration/palette')
    expect(response.status).toBe(200)
    const data = json(response).data as Record<string, unknown>
    const cards = data.cards as Array<Record<string, unknown>>
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ cardId: 'card_000123', name: '搜索材料', method: 'GET', inputCount: 1, outputCount: 1 })
    // 凭证/鉴权来源名都不出壳
    expect(Object.keys(cards[0] ?? {})).not.toContain('auth')
    expect(JSON.stringify(cards[0])).not.toContain('JSESSIONID')

    expect(data.pages).toEqual([
      'https://scm.example.com/materials',
      'https://scm.example.com/materials/detail',
    ])
  })

  it('库为空时是空调色板，不是错误', async () => {
    const response = await serveAsync('GET', '/dashboard/api/dataforge/orchestration/palette')
    expect(response.status).toBe(200)
    const data = json(response).data as Record<string, unknown>
    expect(data.cards).toEqual([])
    expect(data.pages).toEqual([])
  })
})

describe('?workspace=：面板显式指定工作区根', () => {
  it('带 workspace 时读那个目录（宿主 cwd 是 profile 目录，不能靠它）', async () => {
    seedChain()
    // 服务端回落值指向一个**空**目录：如果它赢，就会显示 0 条流程。
    const emptyDir = mkdtempSync(join(tmpdir(), 'df-empty-'))
    const response = await serveAsync(
      'GET',
      `${OVERVIEW}?workspace=${encodeURIComponent(workspace())}`,
      undefined,
      emptyDir,
    )
    expect(response.status).toBe(200)
    const payload = json(response)
    expect(payload.success).toBe(true)
    expect((payload.data?.flows as unknown[]).length).toBeGreaterThan(0)
    rmSync(emptyDir, { recursive: true, force: true })
  })

  it('workspace 不是绝对路径 / 不存在 → 忽略并回落，不报错也不读脏路径', async () => {
    seedChain()
    for (const bogus of ['relative/path', '/definitely/not/here-9f2c']) {
      const response = await serveAsync('GET', `${OVERVIEW}?workspace=${encodeURIComponent(bogus)}`)
      expect(response.status).toBe(200)
      expect((json(response).data?.flows as unknown[]).length).toBeGreaterThan(0)
    }
  })
})
