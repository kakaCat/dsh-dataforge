import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRunRecord, appendEvent, loadRunEvents, listRunIds, foldSummary } from '../src/runs/store.js'
import type { BridgeEvent } from '../src/shared/types.js'

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true })
    dir = undefined
  }
})

const metaEvent: BridgeEvent = {
  event: 'meta',
  flow: 'znb-prpo',
  name: 'ZNB普通物料PRPO造单',
  steps: ['get_cookie', 'build_pr', 'create_pr'],
  dryRun: false,
}

function doneStep(id: string): BridgeEvent {
  return { event: 'step', id, status: 'done' }
}

describe('startRunRecord / appendEvent / loadRunEvents', () => {
  it('run.json + events.ndjson 即写即落盘，读取带 ts', () => {
    dir = mkdtempSync(join(tmpdir(), 'df-store-'))
    startRunRecord(dir, 'znb-1', { flow: 'ZNB普通物料PRPO造单', dryRun: false })
    expect(statSync(join(dir, 'runs', 'znb-1', 'run.json')).isFile()).toBe(true)

    appendEvent(dir, 'znb-1', metaEvent)
    appendEvent(dir, 'znb-1', doneStep('get_cookie'))
    const events = loadRunEvents(dir, 'znb-1')
    expect(events).toHaveLength(2)
    expect(events?.[0]).toMatchObject({ ...metaEvent, ts: expect.any(Number) })
    // 读到的原始 ndjson 就是规范事件流
    const raw = readFileSync(join(dir, 'runs', 'znb-1', 'events.ndjson'), 'utf8')
    const lines = raw.trim().split('\n')
    expect(lines[0]).toContain('"event":"meta"')
  })

  it('坏行跳过不炸；不存在返回 undefined', () => {
    dir = mkdtempSync(join(tmpdir(), 'df-store-'))
    startRunRecord(dir, 'znb-2', {})
    const eventsFile = join(dir, 'runs', 'znb-2', 'events.ndjson')
    writeFileSync(eventsFile, '{"event":"meta"}\nNOT-JSON\n\n{"event":"terminal","success":true}\n', 'utf8')
    expect(loadRunEvents(dir, 'znb-2')).toHaveLength(2)
    expect(loadRunEvents(dir, 'no-such-run')).toBeUndefined()
  })

  it('listRunIds 倒序 + limit', () => {
    dir = mkdtempSync(join(tmpdir(), 'df-store-'))
    for (const id of ['znb-1', 'znb-2', 'znb-3']) {
      startRunRecord(dir, id, {})
      appendEvent(dir, id, metaEvent)
    }
    startRunRecord(dir, 'znb-4', {}) // 无事件也算目录（单查会提示无留痕）
    expect(listRunIds(dir, 2)).toEqual(['znb-4', 'znb-3'])
    expect(listRunIds(dir, 10).slice(0, 4)).toEqual(['znb-4', 'znb-3', 'znb-2', 'znb-1'])
    // 空 dataRoot
    expect(listRunIds(join(dir, 'empty'), 10)).toEqual([])
    expect(existsSync(join(dir, 'empty'))).toBe(false)
  })
})

describe('foldSummary 投影', () => {
  it('meta+steps+result → completed，businessData 投影', () => {
    const events: BridgeEvent[] = [
      metaEvent,
      doneStep('get_cookie'),
      { event: 'step', id: 'build_pr', status: 'start' },
      doneStep('build_pr'),
      { event: 'terminal', name: 'SUCCESS', success: true },
      { event: 'result', success: true, businessData: { prNo: 'PR001', poNo: 'PO009' } },
    ]
    const summary = foldSummary('znb-1', events)
    expect(summary).toMatchObject({
      runId: 'znb-1',
      flow: 'znb-prpo',
      flowName: 'ZNB普通物料PRPO造单',
      status: 'completed',
      success: true,
      dryRun: false,
      totalSteps: 3,
      stepsDone: 2,
      lastStepId: 'build_pr',
      businessData: { prNo: 'PR001', poNo: 'PO009' },
    })
  })

  it('无 terminal/result → running；step.error 记 lastError 全局视角', () => {
    const events: BridgeEvent[] = [
      metaEvent,
      doneStep('get_cookie'),
      { event: 'step', id: 'build_pr', status: 'error', error: 'ASL 校验失败' },
    ]
    const summary = foldSummary('znb-1', events)
    expect(summary.status).toBe('running')
    expect(summary.stepsDone).toBe(1)
    expect(summary.lastError).toBe('ASL 校验失败')
    expect(summary.lastStepId).toBe('build_pr')
  })

  it('terminal 失败兜底 status=failed；killed 覆盖优先', () => {
    const failed = foldSummary('znb-1', [metaEvent, { event: 'terminal', name: 'FAILED', success: false, message: 'cookie 过期' }])
    expect(failed.status).toBe('failed')
    expect(failed.message).toBe('cookie 过期')

    const killed = foldSummary('znb-1', [metaEvent], 'killed')
    expect(killed.status).toBe('killed')
    expect(killed.totalSteps).toBe(3)
  })

  it('businessData 非 object → 原地不写', () => {
    const rawEvent = JSON.parse('{"event":"result","success":true,"businessData":[1,2]}') as BridgeEvent
    const summary = foldSummary('znb-1', [rawEvent])
    expect(summary.businessData).toBeUndefined()
    expect(summary.status).toBe('completed')
  })
})
