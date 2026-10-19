/**
 * 元素特征：录制载荷收口 + 备用候选生成。
 *
 * @module dsh-dataforge/test/uitest/features
 */
import { describe, expect, it } from 'vitest'
import { featureCandidates, normalizeFeatures } from '../../src/uitest/features.js'
import { seamTargetsOf } from '../../src/uitest/engines/shared-run.js'
import type { UiStep } from '../../src/uitest/schema.js'

describe('normalizeFeatures', () => {
  it('收口字符串字段、canvas 序号；非法值丢弃', () => {
    const features = normalizeFeatures({
      tag: 'CANVAS', id: 'chart', ariaLabel: '  A股涨跌  ', canvasIndex: 2, bogus: 1,
    })
    expect(features).toEqual({ tag: 'canvas', id: 'chart', ariaLabel: 'A股涨跌', canvasIndex: 2 })
    expect(normalizeFeatures({ id: 'x' })).toBeUndefined()
    expect(normalizeFeatures({ tag: 'A', canvasIndex: -1 })).toEqual({ tag: 'a' })
  })
})

describe('featureCandidates', () => {
  it('按 testid → id → name → aria → placeholder → role/text 生成备用定位', () => {
    const candidates = featureCandidates({
      tag: 'button', testId: 'submit', id: 'go', name: 'submit', ariaLabel: '提交',
      role: 'button', text: '提交',
    })
    expect(candidates[0]).toBe('[data-testid="submit"]')
    expect(candidates).toContain('#go')
    expect(candidates).toContain('button[name="submit"]')
    expect(candidates).toContain('button[aria-label="提交"]')
    expect(candidates).toContain('[role="button"]:has-text("提交")')
    expect(candidates).toContain('text="提交"')
  })

  it('无 features → 无备用候选', () => {
    expect(featureCandidates(undefined)).toEqual([])
  })
})

describe('seamTargetsOf 合并备用候选', () => {
  it('原候选为空时用 features 兜底', () => {
    const step = { id: 's1', kind: 'click', candidates: [], features: { tag: 'button', text: '搜索' } } satisfies UiStep
    const targets = seamTargetsOf(step)
    expect(targets).toContainEqual({ by: 'text', value: '搜索' })
  })

  it('clickPoint.name 作为最后一层文本兜底', () => {
    const step = {
      id: 's1', kind: 'click', candidates: [],
      clickPoint: { fx: 0.5, fy: 0.5, x: 10, y: 10, vw: 100, vh: 100, name: '回调' },
    } satisfies UiStep
    expect(seamTargetsOf(step)).toContainEqual({ by: 'text', value: '回调' })
  })
})
