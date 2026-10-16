/**
 * 引擎桥：预检（python / 引擎 / dsh_bridge.py）+ 参数构造 + NDJSON 事件解析。
 *
 * 契约（引擎侧 `dsh_bridge.py`）：
 *   stdout = 纯 NDJSON 事件流（meta/step/terminal/result）
 *   stderr = 引擎人类可读输出
 *   exit 0 = 命中 SUCCESS terminal
 *
 * 凭证零经手：python 进程继承宿主 env；引擎自己在 checkout 里加载 .env。
 *
 * @module dsh-dataforge/engine/bridge
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import type { BridgeEvent, EnginePreflight } from '../shared/types.js'

/** 解析引擎运行面：engineRoot / dsh_bridge.py / pythonBin 三件套。 */
export function resolveEngineLocators(engineRoot: string, pythonBin: string): EnginePreflight {
  const reasons: string[] = []
  const root = engineRoot.trim()
  if (!root) reasons.push('config.engineRoot 未配置（指向引擎流程包 checkout 的绝对路径）')
  else if (!existsSync(root)) reasons.push(`engineRoot 不存在: ${root}`)
  else if (!existsSync(join(root, 'dsh_bridge.py'))) {
    reasons.push(`引擎 checkout 缺 dsh_bridge.py: ${join(root, 'dsh_bridge.py')}`)
  }
  return {
    ok: reasons.length === 0,
    ...(reasons.length === 0 ? { engineRoot: root, bridgePath: join(root, 'dsh_bridge.py') } : {}),
    reasons,
  }
}

/** pythonBin 可执行性探测（`pythonBin --version` 起得来即算可用）。 */
export async function probePython(pythonBin: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(pythonBin, ['--version'], { stdio: 'ignore' })
    child.on('error', () => resolve([`pythonBin 不可用: ${pythonBin}`]))
    child.on('exit', (code) => resolve(code === 0 ? [] : [`pythonBin 退出码异常: ${pythonBin}（${code}）`]))
  })
}

/** 组装桥 argv（参数风格 = engine.py：--key value，materials 单键归并由桥完成）。 */
export function buildBridgeArgv(
  locators: EnginePreflight,
  flowPath: string,
  params: Record<string, unknown>,
  dryRun: boolean,
): string[] {
  if (!locators.ok || locators.bridgePath === undefined) {
    throw new Error(`引擎定位未就绪：${locators.reasons.join('；')}`)
  }
  const argv = [locators.bridgePath, flowPath]
  if (dryRun) argv.push('--dry-run')
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    argv.push(`--${key}`, typeof value === 'string' ? value : JSON.stringify(value))
  }
  return argv
}

/** stdin 关闭、stdout/stderr 为管道的子进程类型。 */
type BridgeChild = ChildProcessByStdio<null, Readable, Readable>

export interface SpawnedBridge {
  child: BridgeChild
  /** 逐行 NDJSON 事件（已 JSON.parse；坏行丢弃不炸）。 */
  onEvent: (listener: (event: BridgeEvent) => void) => void
  /** stderr 尾部（实时快照，收局诊断用）。 */
  getStderrTail: () => string
  exitCode: Promise<number>
  /** 幂等杀进程：SIGTERM，2s 后残留则 SIGKILL。 */
  kill: (reason: string) => void
}

/**
 * 起桥进程：
 * - stdout 按行解析为事件（buffer 处理半行）
 * - stderr 只保留尾部 4000 字符（收局诊断）
 */
export function spawnBridge(
  pythonBin: string,
  argv: string[],
  engineRoot: string,
  timeoutMs: number,
): SpawnedBridge {
  void timeoutMs
  const child: BridgeChild = spawn(pythonBin, argv, {
    cwd: engineRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const listeners: Array<(event: BridgeEvent) => void> = []
  let buffer = ''
  let stderrTail = ''
  let exited = false

  const onTap = (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as BridgeEvent
        for (const listener of listeners) {
          try {
            listener(event)
          } catch {
            // 监听者异常不影响下一行
          }
        }
      } catch {
        // 坏行（非 JSON）丢弃：stdout 理论上只有桥写
      }
    }
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => onTap(Buffer.from(chunk, 'utf8')))

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000)
  })

  const exitCode = new Promise<number>((resolve) => {
    child.on('exit', (code) => {
      exited = true
      resolve(code ?? -1)
    })
    child.on('error', () => {
      if (!exited) resolve(-1)
    })
  })

  return {
    child,
    onEvent(listener) {
      listeners.push(listener)
    },
    getStderrTail: () => stderrTail,
    exitCode,
    kill(reason: string) {
      if (child.exitCode !== null || exited) return
      void reason
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
      timer.unref?.()
    },
  }
}

/** 抽取最后一条 result 事件。 */
export function lastResult(events: BridgeEvent[]): BridgeEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].event === 'result') return events[i]
  }
  return undefined
}
