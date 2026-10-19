/**
 * S2 真实 capture fixture：用 bilibili 公开页面采集的前 20 条样本做冒烟。
 *
 * fixture 已脱敏（敏感头只留名字），来自 cap_mvchv4hi_92f020；只验证分析器
 * 在真实数据形状上不崩、能给出节点/覆盖率/提示，不承诺业务绑定。
 *
 * @module dsh-dataforge/test/trace/real-capture
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeTrace } from '../../src/trace/analyze.js'
import type { Trace } from '../../src/trace/types.js'

const FIXTURES = ['cap_mvchv4hi_92f020', 'cap_mvcdgc74_zdh9u7', 'cap_mvbueob4_sh32y9']

describe('真实 capture fixture', () => {
  it.each(FIXTURES)('%s：能分析真实样本形状，输出节点/覆盖率/警告', (captureId) => {
    const raw = readFileSync(join(__dirname, `../fixtures/trace/${captureId}.json`), 'utf8')
    const fixture = JSON.parse(raw) as Trace
    const analysis = analyzeTrace(fixture)
    expect(analysis.stats.totalSamples).toBeGreaterThanOrEqual(1)
    expect(analysis.stats.analyzedSamples).toBeGreaterThan(0)
    expect(analysis.nodes.length).toBeGreaterThan(0)
    expect(analysis.coverage.callCoverage).toBeGreaterThan(0)
    expect(Array.isArray(analysis.warnings)).toBe(true)
    // 敏感头在 fixture 里只有名字，不应出现原始值。
    expect(raw).not.toContain('Bearer ')
  })
})
