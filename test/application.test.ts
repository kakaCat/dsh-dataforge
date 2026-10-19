import { describe, expect, it, afterEach, beforeAll } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { buildDataforgeDeps, runFlow, runStatus } from '../src/application.js'
import type { DataforgeDeps } from '../src/application.js'

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true })
    dir = undefined
  }
})

const FLOW_YAML = `
name: 演示造单
description: 单测流程
inputs:
  stockOrg:    { label: 库存组织, required: true }
  materials:   { label: 物料列表, required: true }
  projectCode: { label: 项目编码, required: false }
steps: []
`

function makeDeps(overrides: Partial<Parameters<typeof buildDataforgeDeps>[0]['config']> = {}, withJobs = false): DataforgeDeps {
  dir = mkdtempSync(join(tmpdir(), 'df-app-'))
  const engineRoot = join(dir, 'engine')
  const configsDir = join(engineRoot, 'configs')
  mkdirSync(configsDir, { recursive: true })
  writeFileSync(join(configsDir, 'demo.yaml'), FLOW_YAML, 'utf8')
  return buildDataforgeDeps({
    config: {
      engineRoot: overrides.engineRoot ?? engineRoot,
      pythonBin: overrides.pythonBin ?? 'python3',
      dataRoot: overrides.dataRoot ?? join(dir, 'data'),
      timeoutSeconds: overrides.timeoutSeconds ?? 600,
      injectPolicy: overrides.injectPolicy ?? false,
      captureMaxDepth: overrides.captureMaxDepth ?? 3,
      captureMaxPages: overrides.captureMaxPages ?? 50,
      captureStabilityWindowMs: overrides.captureStabilityWindowMs ?? 1500,
      captureBodyLimitBytes: overrides.captureBodyLimitBytes ?? 262_144,
      captureChromeChannel: overrides.captureChromeChannel ?? 'chrome',
      chainRunEnabled: overrides.chainRunEnabled ?? true,
      chainNodeTimeoutSeconds: overrides.chainNodeTimeoutSeconds ?? 30,
      chainConcurrency: overrides.chainConcurrency ?? 4,
      chainResponseLimitBytes: overrides.chainResponseLimitBytes ?? 2_097_152,
      chainCredentialPersistence: overrides.chainCredentialPersistence ?? true,
      uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright',
    },
    resolveJobs: withJobs ? () => ({ start: () => ({ id: 'job-x' }) }) : () => undefined,
    resolveWorkspaceRoot: async () => undefined,
  })
}

const FULL_PARAMS = { stockOrg: 'MI_IOT', materials: { M1: 1710 } }

describe('三道闸', () => {
  it('闸1：缺必填 → missing-fields + 中文标签清单', async () => {
    const result = await runFlow(makeDeps(), undefined, { flow: '演示造单', params: {} })
    expect(result.gate).toBe('missing-fields')
    expect(result.accepted).toBe(false)
    expect(result.missing?.map((m) => m.field)).toEqual(['stockOrg', 'materials'])
    expect(result.card).toContain('库存组织')
  })

  it('闸2：参数齐但无 confirm → confirm-required 确认卡', async () => {
    const result = await runFlow(makeDeps(), undefined, { flow: '演示造单', params: FULL_PARAMS })
    expect(result.gate).toBe('confirm-required')
    expect(result.accepted).toBe(false)
    expect(result.card).toContain('参数确认卡')
    expect(result.card).toContain('演示造单')
    expect(result.card).toContain('MI_IOT')
  })

  it('闸2.5：确认卡在缺参时给出双提示（先补齐再确认）', async () => {
    const result = await runFlow(makeDeps(), undefined, { flow: '演示造单', params: { materials: { M1: 1 } } })
    expect(result.missing?.map((m) => m.field)).toEqual(['stockOrg'])
  })

  it('预检失败 → preflight-failed（fixture 缺 dsh_bridge.py；pythonBin 坏同样拦截）', async () => {
    const missingBridge = await runFlow(makeDeps(), undefined, { flow: '演示造单', params: FULL_PARAMS, confirm: true })
    expect(missingBridge.accepted).toBe(false)
    expect(missingBridge.gate).toBe('preflight-failed')
    expect(missingBridge.card).toContain('预检失败')

    dir = mkdtempSync(join(tmpdir(), 'df-app-'))
    const engineRoot = join(dir, 'engine')
    const configsDir = join(engineRoot, 'configs')
    mkdirSync(configsDir, { recursive: true })
    writeFileSync(join(configsDir, 'demo.yaml'), FLOW_YAML, 'utf8')
    writeFileSync(join(engineRoot, 'dsh_bridge.py'), '#!/usr/bin/env python3\n', 'utf8')
    const deps = buildDataforgeDeps({
      config: {
        engineRoot,
        pythonBin: '/nonexistent/python3',
        dataRoot: join(dir, 'data'),
        timeoutSeconds: 600,
        injectPolicy: false,
        captureMaxDepth: 3,
        captureMaxPages: 50,
        captureStabilityWindowMs: 1500,
        captureBodyLimitBytes: 262144,
        captureChromeChannel: 'chrome',
        chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true, uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright',
      },
      resolveJobs: () => undefined,
      resolveWorkspaceRoot: async () => undefined,
    })
    const badPython = await runFlow(deps, undefined, { flow: '演示造单', params: FULL_PARAMS, confirm: true })
    expect(badPython.gate).toBe('preflight-failed')
    expect(badPython.card).toContain('pythonBin')
  })

  it('FLOW_NOT_FOUND 冒泡给工具壳', async () => {
    await expect(runFlow(makeDeps(), undefined, { flow: '不存在的流程', params: {} })).rejects.toThrow(/不存在/)
  })
})

// ── 真引擎集成（python3 可用且引擎 checkout 存在时运行）──
const ENGINE_ROOT = '/Volumes/ORICO/doc/github/dsh/ai-dataforge-loop'
const pythonReady = (() => {
  try {
    execSync('python3 --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const engineReady = existsSync(join(ENGINE_ROOT, 'dsh_bridge.py'))
const describeIntegration = pythonReady && engineReady ? describe : describe.skip

describeIntegration('前台 dry-run 集成（真实引擎桥）', () => {
  it('spawn python dsh_bridge.py --dry-run 走通：摘要 + 留痕 + 状态单查一致', { timeout: 120_000 }, async () => {
    let dataRoot: string | undefined
    try {
      dataRoot = mkdtempSync(join(tmpdir(), 'df-int-'))
      const deps = buildDataforgeDeps({
        config: {
          engineRoot: ENGINE_ROOT,
          pythonBin: 'python3',
          dataRoot,
          timeoutSeconds: 60,
          injectPolicy: false,
        captureMaxDepth: 3,
        captureMaxPages: 50,
        captureStabilityWindowMs: 1500,
        captureBodyLimitBytes: 262144,
        captureChromeChannel: 'chrome',
        chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true, uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright',
        },
        resolveJobs: () => undefined,
        resolveWorkspaceRoot: async () => undefined,
      })

      const result = await runFlow(deps, undefined, {
        flow: 'ZNB普通物料PRPO造单',
        params: { stockOrg: 'MI_IOT', purchaseOrg: '2120', supplierCode: '108062', materials: { '1710301000006A': 1 } },
        confirm: true,
        dryRun: true,
      })

      expect(result.accepted).toBe(true)
      expect(result.gate).toBe('started')
      expect(result.degradedNotice).toContain('dsh-jobs')
      expect(result.runId).toBeTruthy()

      const summary = result.summary!
      expect(summary.status).toBe('completed')
      expect(summary.dryRun).toBe(true)
      expect(summary.totalSteps).toBe(18)
      expect(summary.stepsDone).toBe(18)
      expect(summary.lastStepId).toBe('repush_erp')

      const events = readFileSync(join(dataRoot, 'runs', summary.runId, 'events.ndjson'), 'utf8').trim().split('\n')
      expect(events.length).toBeGreaterThanOrEqual(38)
      expect(JSON.parse(events[0] as string)).toMatchObject({ event: 'meta', dryRun: true })

      const status = runStatus(deps, summary.runId)
      expect(status.ok).toBe(true)
      expect(status.run?.status).toBe('completed')
      expect(statSync(join(dataRoot, 'runs', summary.runId, 'run.json')).isFile()).toBe(true)
    } finally {
      if (dataRoot !== undefined) rmSync(dataRoot, { recursive: true, force: true })
    }
  })
})

beforeAll(() => {
  if (!pythonReady) console.warn('[df-int] python3 不可用，跳过真引擎集成')
  else if (!engineReady) console.warn('[df-int] 引擎 checkout 缺失，跳过真引擎集成')
})
