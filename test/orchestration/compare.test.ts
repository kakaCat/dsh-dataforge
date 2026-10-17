/**
 * 复跑对照（R-6 M2 / FR-6.7）：两条 `chain-run` 留痕 → 入参 / 出参 / 节点状态差异。
 *
 * 夹具直接按 R-3 的写入形状造 `runs/<id>/run.json` + `events.ndjson`
 * （形状见 src/execute/run.ts 的 emit 处与 test/execute/run.test.ts），不 mock
 * compare 内部、也不起本地服务：对照是纯只读投影，输入就是盘上的留痕。
 *
 * @module dsh-dataforge/test/orchestration/compare
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainRunToolDeps } from '../../src/orchestration/application.js'
import type {
  ChainCompareRun,
  ChainCompareSummary,
  ChainCompareToolValue,
} from '../../src/orchestration/compare.js'
import { compareForTool, compareOutputOf } from '../../src/orchestration/compare.js'

/* ================================================================== 夹具 */

type FixtureNode = {
  id: string
  status: 'done' | 'error'
  elapsedMs: number
  httpStatus?: number
  emitted?: Record<string, unknown>
  code?: string
  error?: string
}

type FixtureRun = {
  runId: string
  kind?: string
  chain?: { site: string; flow: string; version: number }
  params?: Record<string, unknown>
  startedAt?: number
  nodes?: FixtureNode[]
  /** 只在 `result.businessData.nodes` 里的节点（失败后没启动：skipped）。 */
  skipped?: string[]
  failedNode?: string
  /** 故意写进留痕的「原始」请求头：compare 回执不得带出任何 header 值。 */
  requestHeaders?: Record<string, string>
}

function dataRootOf(): string {
  return join(mkdtempSync(join(tmpdir(), 'compare-')), 'data')
}

function depsOf(dataRoot: string): ChainRunToolDeps {
  return {
    captureDbPath: join(dataRoot, 'capture.sqlite'),
    resolveWorkspaceRoot: async () => undefined,
    dataRoot,
    chain: {
      enabled: true,
      nodeTimeoutSeconds: 5,
      concurrency: 2,
      responseLimitBytes: 2_097_152,
      foregroundTimeoutSeconds: 60,
    },
    resolveJobs: () => undefined,
  }
}

/** 按 run.ts 的写入形状造一条 run；事件顺序：meta → 逐节点 start/终态 → terminal → result。 */
function writeRun(dataRoot: string, fixture: FixtureRun): void {
  const runDir = join(dataRoot, 'runs', fixture.runId)
  mkdirSync(runDir, { recursive: true })
  const chain = fixture.chain ?? { site: '测试站点', flow: '对照', version: 1 }
  const nodes = fixture.nodes ?? []
  const skipped = fixture.skipped ?? []
  const startedAt = fixture.startedAt ?? 1_000
  const planned = [...nodes.map((node) => node.id), ...skipped]
  const record = {
    runId: fixture.runId,
    kind: fixture.kind ?? 'chain-run',
    flow: chain.flow,
    flowName: chain.flow,
    chain,
    params: fixture.params ?? {},
    baseUrl: 'http://127.0.0.1:1',
    dryRun: false,
    planned,
    concurrency: 2,
    startedAt,
  }
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(record, null, 2), 'utf8')
  // 没有节点 = 只落 run.json、没有事件留痕（用于 run-not-found 的空留痕用例）。
  if (nodes.length === 0) return

  const success = fixture.failedNode === undefined
  const completed = nodes.filter((node) => node.status === 'done').map((node) => node.id)
  const businessNodes = [
    ...nodes.map((node) => ({
      nodeId: node.id,
      status: node.status,
      attempts: 1,
      elapsedMs: node.elapsedMs,
      ...(node.httpStatus === undefined ? {} : { httpStatus: node.httpStatus }),
      ...(node.code === undefined ? {} : { errorCode: node.code }),
    })),
    ...skipped.map((nodeId) => ({ nodeId, status: 'skipped', attempts: 0, elapsedMs: 0 })),
  ]
  const events: Array<Record<string, unknown>> = [
    { event: 'meta', flow: chain.flow, name: chain.flow, steps: planned, dryRun: false, chain, ts: startedAt },
  ]
  let ts = startedAt
  for (const node of nodes) {
    ts += 1
    events.push({
      event: 'step',
      id: node.id,
      action: `GET /api/${node.id}`,
      status: 'start',
      // 真实 run.ts 落盘的是已脱敏的头；这里放原始值，验证 compare 从不复制 header。
      data: {
        card: `card_${node.id}`,
        attempt: 1,
        request: {
          method: 'GET',
          url: `http://127.0.0.1:1/api/${node.id}`,
          headers: fixture.requestHeaders ?? {},
        },
      },
      ts,
    })
    ts += 1
    if (node.status === 'done') {
      events.push({
        event: 'step',
        id: node.id,
        status: 'done',
        elapsed: node.elapsedMs,
        data: {
          response: { status: node.httpStatus ?? 200, bytes: 16, truncated: false, bodyPreview: '{}' },
          emitted: node.emitted ?? {},
        },
        ts,
      })
    } else {
      events.push({
        event: 'step',
        id: node.id,
        status: 'error',
        elapsed: node.elapsedMs,
        error: node.error ?? '节点失败',
        data: {
          code: node.code ?? 'node-http-error',
          ...(node.httpStatus === undefined
            ? {}
            : { response: { status: node.httpStatus, bytes: 0, truncated: false, bodyPreview: '' } }),
        },
        ts,
      })
    }
  }
  ts += 1
  events.push({ event: 'terminal', success, cancelled: false, message: success ? '完成' : '失败', ts })
  ts += 1
  events.push({
    event: 'result',
    success,
    businessData: {
      chain,
      ...(fixture.failedNode === undefined ? {} : { failedNode: fixture.failedNode }),
      completed,
      nodes: businessNodes,
    },
    ts,
  })
  writeFileSync(
    join(runDir, 'events.ndjson'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  )
}

function runsOf(value: ChainCompareToolValue): [ChainCompareRun, ChainCompareRun] {
  if (value.runs === undefined) throw new Error('对照回执缺少 runs')
  return value.runs
}

function summaryOf(value: ChainCompareToolValue): ChainCompareSummary {
  if (value.summary === undefined) throw new Error('对照回执缺少 summary')
  return value.summary
}

/* ================================================================== 用例 */

describe('compareForTool：两次复跑的对照视图', () => {
  it('入参 A/B → C/D：params 差异 + 上游求解值变化 + 节点均 done', async () => {
    const dataRoot = dataRootOf()
    writeRun(dataRoot, {
      runId: 'chain-rerun-a',
      params: { q: 'A', quantity: 1 },
      nodes: [
        { id: 'query', status: 'done', elapsedMs: 10, emitted: { 'query.body.items[0].internalId': 'A-ID' } },
        { id: 'order', status: 'done', elapsedMs: 12, emitted: { 'order.body.orderNo': 'PO-A-ID' } },
      ],
    })
    writeRun(dataRoot, {
      runId: 'chain-rerun-c',
      params: { q: 'C', quantity: 2 },
      nodes: [
        { id: 'query', status: 'done', elapsedMs: 14, emitted: { 'query.body.items[0].internalId': 'C-ID' } },
        { id: 'order', status: 'done', elapsedMs: 18, emitted: { 'order.body.orderNo': 'PO-C-ID' } },
      ],
    })

    const value = await compareForTool(depsOf(dataRoot), { runIds: ['chain-rerun-a', 'chain-rerun-c'] })
    expect(value.ok).toBe(true)
    const [baseRun, targetRun] = runsOf(value)
    expect(baseRun.runId).toBe('chain-rerun-a')
    expect(targetRun.runId).toBe('chain-rerun-c')
    expect(baseRun.status).toBe('completed')
    expect(targetRun.status).toBe('completed')
    expect(baseRun.chain).toEqual({ site: '测试站点', flow: '对照', version: 1 })
    expect(baseRun.startedAt).toBe(1_000)

    // runIds[0] = base、runIds[1] = target：槽位差异按同序给出。
    expect(value.inputs?.find((input) => input.key === 'q')).toMatchObject({
      base: 'A',
      target: 'C',
      changed: true,
    })
    expect(value.inputs?.find((input) => input.key === 'quantity')).toMatchObject({
      base: 1,
      target: 2,
      changed: true,
    })

    // 上游 node 出参真的换了：这是「复跑重新求解」的证据（不是首跑缓存）。
    expect(
      value.emitted?.find((item) => item.nodeId === 'query' && item.path === 'body.items[0].internalId'),
    ).toMatchObject({ base: 'A-ID', target: 'C-ID', changed: true })
    expect(
      value.emitted?.find((item) => item.nodeId === 'order' && item.path === 'body.orderNo'),
    ).toMatchObject({ base: 'PO-A-ID', target: 'PO-C-ID', changed: true })

    expect(value.nodes?.find((node) => node.nodeId === 'query')).toMatchObject({
      baseStatus: 'done',
      targetStatus: 'done',
      baseElapsedMs: 10,
      targetElapsedMs: 14,
      changed: true,
    })
    expect(summaryOf(value)).toEqual({ nodesChanged: 2, emittedChanged: 2, inputsChanged: 2 })
    expect(value.hints?.some((hint) => hint.includes('重新求解'))).toBe(true)

    // JSON 安全投影：再次序列化不改变形状（工具出口不应出现 undefined/循环）。
    const output = compareOutputOf(value)
    expect(JSON.parse(JSON.stringify(output))).toEqual(output)
  })

  it('两次 run 版本不同（v1 → v2）能读出，并提示不是同一版链', async () => {
    const dataRoot = dataRootOf()
    const nodes: FixtureNode[] = [
      { id: 'query', status: 'done', elapsedMs: 10, emitted: { 'query.body.items[0].internalId': 'A-ID' } },
    ]
    writeRun(dataRoot, {
      runId: 'chain-v1',
      chain: { site: '测试站点', flow: '对照', version: 1 },
      params: { q: 'A' },
      nodes,
    })
    writeRun(dataRoot, {
      runId: 'chain-v2',
      chain: { site: '测试站点', flow: '对照', version: 2 },
      params: { q: 'A' },
      nodes,
    })

    const value = await compareForTool(depsOf(dataRoot), { runIds: ['chain-v1', 'chain-v2'] })
    expect(value.ok).toBe(true)
    const [baseRun, targetRun] = runsOf(value)
    expect(baseRun.chain?.version).toBe(1)
    expect(targetRun.chain?.version).toBe(2)
    expect(value.hints?.some((hint) => hint.includes('v1 → v2'))).toBe(true)
  })

  it('一次成功、一次失败：failedNode 对照 + 节点状态差异（含 skipped）', async () => {
    const dataRoot = dataRootOf()
    writeRun(dataRoot, {
      runId: 'chain-ok',
      params: { q: 'C', quantity: 2 },
      nodes: [
        { id: 'query', status: 'done', elapsedMs: 10, emitted: { 'query.body.items[0].internalId': 'C-ID' } },
        { id: 'order', status: 'done', elapsedMs: 12, emitted: { 'order.body.orderNo': 'PO-C-ID' } },
        { id: 'submit', status: 'done', elapsedMs: 8, emitted: {} },
      ],
    })
    writeRun(dataRoot, {
      runId: 'chain-failed',
      params: { q: 'Z', quantity: 2 },
      failedNode: 'order',
      nodes: [
        { id: 'query', status: 'done', elapsedMs: 8, emitted: { 'query.body.items[0].internalId': 'Z-ID' } },
        {
          id: 'order',
          status: 'error',
          elapsedMs: 30,
          httpStatus: 500,
          code: 'node-http-error',
          error: '节点 order：HTTP 500',
        },
      ],
      skipped: ['submit'],
    })

    const value = await compareForTool(depsOf(dataRoot), { runIds: ['chain-ok', 'chain-failed'] })
    expect(value.ok).toBe(true)
    const [baseRun, targetRun] = runsOf(value)
    expect(baseRun.failedNode).toBeUndefined()
    expect(targetRun.failedNode).toBe('order')
    const summary = summaryOf(value)
    expect(summary.baseFailedNode).toBeUndefined()
    expect(summary.targetFailedNode).toBe('order')

    // 对照侧失败的节点没有 emitted：单侧缺席也要如实给出 changed。
    expect(value.emitted?.find((item) => item.path === 'body.orderNo')).toMatchObject({
      nodeId: 'order',
      base: 'PO-C-ID',
      changed: true,
    })
    expect(value.emitted?.find((item) => item.path === 'body.orderNo')?.target).toBeUndefined()

    expect(value.nodes?.find((node) => node.nodeId === 'order')).toMatchObject({
      baseStatus: 'done',
      targetStatus: 'error',
      targetHttpStatus: 500,
      changed: true,
    })
    // 失败后没启动的节点只在 result.businessData 里（run.ts 的约定），要补进对照。
    expect(value.nodes?.find((node) => node.nodeId === 'submit')).toMatchObject({
      baseStatus: 'done',
      targetStatus: 'skipped',
      changed: true,
    })
    expect(value.hints?.some((hint) => hint.includes('对照运行失败于节点 order'))).toBe(true)
    expect(value.hints?.some((hint) => hint.includes('dataforge_chain_diagnose'))).toBe(true)
  })

  it('两次都失败：各自的 failedNode 都能给出', async () => {
    const dataRoot = dataRootOf()
    writeRun(dataRoot, {
      runId: 'chain-fail-order',
      failedNode: 'order',
      nodes: [
        { id: 'query', status: 'done', elapsedMs: 10, emitted: { 'query.body.items[0].internalId': 'A-ID' } },
        { id: 'order', status: 'error', elapsedMs: 20, code: 'binding-path-not-found', error: '绑定路径不存在' },
      ],
      skipped: ['submit'],
    })
    writeRun(dataRoot, {
      runId: 'chain-fail-submit',
      failedNode: 'submit',
      nodes: [
        { id: 'query', status: 'done', elapsedMs: 9, emitted: { 'query.body.items[0].internalId': 'B-ID' } },
        { id: 'order', status: 'done', elapsedMs: 11, emitted: { 'order.body.orderNo': 'PO-B-ID' } },
        { id: 'submit', status: 'error', elapsedMs: 40, httpStatus: 502, code: 'node-http-error' },
      ],
    })

    const value = await compareForTool(depsOf(dataRoot), {
      runIds: ['chain-fail-order', 'chain-fail-submit'],
    })
    expect(value.ok).toBe(true)
    const summary = summaryOf(value)
    expect(summary.baseFailedNode).toBe('order')
    expect(summary.targetFailedNode).toBe('submit')
    expect(value.hints?.some((hint) => hint.includes('分别失败在 order / submit'))).toBe(true)
  })

  it('敏感键名一律打码，JSON 回执里零命中 token/cookie 原文', async () => {
    const dataRoot = dataRootOf()
    const baseSecrets = {
      access_token: 'tok_live_base_123',
      password: 'p@ss-base',
      nested: { authorization: 'Bearer NESTED-BASE' },
    }
    const targetSecrets = {
      access_token: 'tok_live_target_456',
      password: 'p@ss-target',
      nested: { authorization: 'Bearer NESTED-TARGET' },
    }
    writeRun(dataRoot, {
      runId: 'chain-secret-base',
      params: { q: 'A', ...baseSecrets },
      requestHeaders: { authorization: 'Bearer SECRET-HEADER-123', cookie: 'JSESSIONID=SECRETCOOKIEBASE' },
      nodes: [
        {
          id: 'query',
          status: 'done',
          elapsedMs: 10,
          emitted: {
            'query.body.access_token': 'tok_live_emit_base',
            'query.body.authorization': 'Bearer SECRET-BASE-HEADER',
          },
        },
      ],
    })
    writeRun(dataRoot, {
      runId: 'chain-secret-target',
      params: { q: 'A', ...targetSecrets },
      requestHeaders: { authorization: 'Bearer SECRET-HEADER-456', cookie: 'JSESSIONID=SECRETCOOKIE-TARGET' },
      nodes: [
        {
          id: 'query',
          status: 'done',
          elapsedMs: 12,
          emitted: {
            'query.body.access_token': 'tok_live_emit_target',
            'query.body.authorization': 'Bearer SECRET-TARGET-HEADER',
          },
        },
      ],
    })

    const value = await compareForTool(depsOf(dataRoot), {
      runIds: ['chain-secret-base', 'chain-secret-target'],
    })
    expect(value.ok).toBe(true)
    expect(value.inputs?.find((input) => input.key === 'access_token')).toMatchObject({
      base: '***',
      target: '***',
      changed: true,
    })
    expect(value.inputs?.find((input) => input.key === 'password')).toMatchObject({
      base: '***',
      target: '***',
      changed: true,
    })
    // 嵌套对象里的敏感键名同样命中。
    const output = compareOutputOf(value)
    expect(output.runs?.[0]?.params['nested']).toEqual({ authorization: '***' })
    expect(
      value.emitted?.find((item) => item.path === 'body.access_token'),
    ).toMatchObject({ base: '***', target: '***', changed: true })
    expect(
      value.emitted?.find((item) => item.path === 'body.authorization'),
    ).toMatchObject({ base: '***', target: '***', changed: true })

    // 硬扫描：值/请求头原文（含 cookie）在整份 JSON 回执里一次都不能出现。
    const text = JSON.stringify(output)
    const secrets = [
      'tok_live_base_123',
      'tok_live_target_456',
      'p@ss-base',
      'p@ss-target',
      'tok_live_emit_base',
      'tok_live_emit_target',
      'SECRET-BASE-HEADER',
      'SECRET-TARGET-HEADER',
      'SECRET-HEADER-123',
      'SECRET-HEADER-456',
      'SECRETCOOKIEBASE',
      'SECRETCOOKIE-TARGET',
      'NESTED-BASE',
      'NESTED-TARGET',
      'JSESSIONID',
    ]
    for (const secret of secrets) expect(text).not.toContain(secret)
  })

  it('run 不存在 / 非 chain-run / 空留痕 → ok:false + 自定错误码', async () => {
    const dataRoot = dataRootOf()
    writeRun(dataRoot, { runId: 'probe-1', kind: 'probe-run' })
    writeRun(dataRoot, { runId: 'chain-empty' })
    writeRun(dataRoot, {
      runId: 'chain-ok',
      nodes: [{ id: 'query', status: 'done', elapsedMs: 10, emitted: {} }],
    })
    const deps = depsOf(dataRoot)

    const missing = await compareForTool(deps, { runIds: ['chain-nope', 'chain-nope-2'] })
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('run-not-found')

    const notChain = await compareForTool(deps, { runIds: ['probe-1', 'chain-ok'] })
    expect(notChain.ok).toBe(false)
    expect(notChain.code).toBe('not-chain-run')

    // 对照第二条同样要过 kind 校验：非链运行不能当 target。
    const notChainTarget = await compareForTool(deps, { runIds: ['chain-ok', 'probe-1'] })
    expect(notChainTarget.code).toBe('not-chain-run')

    const invalid = await compareForTool(deps, { runIds: ['', 'chain-empty'] })
    expect(invalid.ok).toBe(false)
    expect(invalid.code).toBe('invalid-run-ids')

    const noEvents = await compareForTool(deps, { runIds: ['chain-empty', 'chain-empty'] })
    expect(noEvents.ok).toBe(false)
    expect(noEvents.code).toBe('run-not-found')
    expect(noEvents.message).toContain('事件留痕')
  })
})
