import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBridgeArgv, resolveEngineLocators, spawnBridge, lastResult } from '../src/engine/bridge.js'
import type { BridgeEvent } from '../src/shared/types.js'

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true })
    dir = undefined
  }
})

describe('resolveEngineLocators', () => {
  it('三件套齐 + bridge 缺失给出原因', () => {
    dir = mkdtempSync(join(tmpdir(), 'df-bridge-'))
    writeFileSync(join(dir, 'dsh_bridge.py'), '#!/usr/bin/env python3\n', 'utf8')
    const ok = resolveEngineLocators(dir, 'python3')
    expect(ok.ok).toBe(true)
    expect(ok.reasons).toEqual([])
    expect(ok.bridgePath).toBe(join(dir, 'dsh_bridge.py'))

    rmSync(join(dir, 'dsh_bridge.py'))
    const missing = resolveEngineLocators(dir, 'python3')
    expect(missing.ok).toBe(false)
    expect(missing.reasons[0]).toContain('dsh_bridge.py')

    const noRoot = resolveEngineLocators('/nonexistent/df', 'python3')
    expect(noRoot.ok).toBe(false)
    expect(noRoot.reasons[0]).toContain('不存在')
  })
})

describe('buildBridgeArgv', () => {
  it('config 优先 + --dry-run + 字符串直传 / 对象 JSON 化 / 跳过空值', () => {
    const locator = { bridgePath: '/e/dsh_bridge.py', reasons: [], ok: true, engineRoot: '/e' }
    const argv = buildBridgeArgv(
      locator,
      '/packs/flow.yaml',
      { stockOrg: 'MI_IOT', materials: { M1: 1710 }, empty: '', nil: undefined, none: null },
      true,
    )
    expect(argv).toEqual([
      '/e/dsh_bridge.py',
      '/packs/flow.yaml',
      '--dry-run',
      '--stockOrg', 'MI_IOT',
      '--materials', '{"M1":1710}',
    ])
  })

  it('未定位成功直接抛错（contract：先 preflight 再 argv）', () => {
    expect(() => buildBridgeArgv({ ok: false, reasons: ['缺引擎'], bridgePath: undefined, engineRoot: undefined }, 'x', {}, false)).toThrow(/缺引擎/)
  })
})

describe('spawnBridge（真实 python3）', () => {
  it('stdout 逐行 NDJSON 事件解析（含半行缓冲/坏行/合并行），stderr 尾部保留，exit 码透传', async () => {
    const script = `
import sys, time, json
sys.stdout.write('{"event":"met')
sys.stdout.flush()
time.sleep(0.2)
sys.stdout.write('a","flow":"t"}\\nnot-json-line\\n{"event":"step","id":"s1","status":"start"}\\n')
sys.stderr.write('ERRERTAIL-9012\\n')
sys.stdout.write('{"event":"terminal","name":"SUCCESS","success":true,"message":"ok"}\\n{"event":"result","success":true,"businessData":{"poNo":"PO009"}}\\n')
sys.stdout.flush()
sys.exit(0)
`
    dir = mkdtempSync(join(tmpdir(), 'df-spawn-'))
    const scriptPath = join(dir, 'fake_bridge.py')
    writeFileSync(scriptPath, script, 'utf8')

    const events: BridgeEvent[] = []
    const spawned = spawnBridge('python3', [scriptPath], dir, 5000)
    spawned.onEvent((e) => events.push(e))
    const code = await spawned.exitCode

    expect(code).toBe(0)
    expect(events.map((e) => e.event)).toEqual(['meta', 'step', 'terminal', 'result'])
    const meta = events[0] as { flow?: string }
    expect(meta.flow).toBe('t')
    expect(spawned.getStderrTail()).toContain('ERRERTAIL-9012')
    const result = lastResult(events)
    expect(result?.success).toBe(true)
    expect((result?.businessData as { poNo?: string } | undefined)?.poNo).toBe('PO009')
  })

  it('kill() 幂等且可提前收尾（SIGTERM 后 exit 兜底）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'df-kill-'))
    const scriptPath = join(dir, 'sleeper.py')
    writeFileSync(scriptPath, 'import time\ntime.sleep(30)\n', 'utf8')
    const spawned = spawnBridge('python3', [scriptPath], dir, 60000)
    spawned.kill('测试取消')
    spawned.kill('重复调用应无副作用')
    const started = Date.now()
    const code = await spawned.exitCode
    expect(code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(15000)
  })
})
