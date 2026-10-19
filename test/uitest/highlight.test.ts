/**
 * 点击视觉提示：注入表达式必须是可编译 JS，且只写坐标/样式，不含用户输入。
 *
 * @module dsh-dataforge/test/uitest/highlight
 */
import { describe, expect, it } from 'vitest'
import { highlightClickExpression } from '../../src/uitest/highlight.js'

describe('highlightClickExpression', () => {
  it('可编译；包含固定定位与光圈/Dot 样式；坐标取整', () => {
    const expr = highlightClickExpression(120.4, 88.6)
    expect(() => new Function(expr)).not.toThrow()
    expect(expr).toContain('left:120px')
    expect(expr).toContain('top:89px')
    expect(expr).toContain('data-df-ui-click')
    expect(expr).toContain('pointer-events:none')
    expect(expr).toContain('dfUiClickRing')
  })

  it('非法坐标回落 0，不抛错', () => {
    expect(() => new Function(highlightClickExpression(Number.NaN, Number.POSITIVE_INFINITY))).not.toThrow()
  })
})
