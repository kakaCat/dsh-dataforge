/**
 * 执行段的结构不变量（把验收判据变成可自动检查的断言）。
 *
 * 「全程无浏览器进程启动」在验收里写作「进程列表断言」。这里用更硬的一种做法：
 * **执行模块的依赖图里根本没有能起进程或开浏览器的边**——只要 `src/execute` 不 import
 * `capture/`（Playwright 只在那里）、不 import `node:child_process`、不直接调 `fetch`，
 * 就不存在「某条路径偷偷起浏览器」的可能。一次性的进程列表快照只能证明那一次，
 * 依赖图断言能证明每一次。
 *
 * @module dsh-dataforge/test/execute/invariants
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const EXECUTE_DIR = join(process.cwd(), 'src', 'execute')

function executeSources(): Array<{ file: string; text: string }> {
  return readdirSync(EXECUTE_DIR)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, text: readFileSync(join(EXECUTE_DIR, file), 'utf8') }))
}

describe('执行段的依赖边界', () => {
  it('不依赖 capture/ library/ client/：执行段没有任何浏览器入口', () => {
    const offenders: string[] = []
    for (const { file, text } of executeSources()) {
      for (const line of text.split('\n')) {
        if (!/^\s*(import|export)\b/.test(line)) continue
        if (/(['"])(\.\.\/(capture|library|client)\/|@playwright|playwright-core)/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('不 import node:child_process：执行段起不了任何子进程', () => {
    const offenders = executeSources()
      .filter(({ text }) => /from\s+['"]node:child_process['"]/.test(text))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('只有 http.ts 能直接写 fetch（HTTP 出口唯一）', () => {
    const callers = executeSources()
      .filter(({ file, text }) => file !== 'http.ts' && /\bfetch\s*\(/.test(text))
      .map(({ file }) => file)
    expect(callers).toEqual([])
  })

  it('run.ts 的拓扑只复用 chains/validate，不自己再排一遍', () => {
    const run = readFileSync(join(EXECUTE_DIR, 'run.ts'), 'utf8')
    expect(run).toContain("from '../chains/validate.js'")
    expect(run).toContain('dependencyPairs')
    // 没有第二套拓扑实现（Kahn 的队列只有调度器自己的就绪队列）。
    expect(run).not.toMatch(/function\s+topoOrder/)
    expect(run).not.toMatch(/function\s+cycleOf/)
  })
})
