/**
 * 分页按钮窗口（纯函数）：接口库页面节点里的接口分页要能容纳几十页，按钮只画首末 + 邻域。
 *
 * @module test/client-pager
 */
import { expect, it } from 'vitest'
import { pagerWindow } from '../src/client/dom.js'

it('页数不多（≤9）时全量列出页码', () => {
  expect(pagerWindow(0, 1)).toEqual([0])
  expect(pagerWindow(2, 5)).toEqual([0, 1, 2, 3, 4])
  expect(pagerWindow(8, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
})

it('页数多时保留首末 + 当前页邻域，中间用省略号', () => {
  expect(pagerWindow(0, 10)).toEqual([0, 1, '…', 9])
  expect(pagerWindow(1, 10)).toEqual([0, 1, 2, '…', 9])
  expect(pagerWindow(5, 10)).toEqual([0, '…', 4, 5, 6, '…', 9])
  expect(pagerWindow(8, 10)).toEqual([0, '…', 7, 8, 9])
  expect(pagerWindow(9, 10)).toEqual([0, '…', 8, 9])
})

it('窗口页码单调递增且不重复（省略号只是占位）', () => {
  for (const total of [10, 17, 29, 120]) {
    for (let current = 0; current < total; current += 1) {
      const window = pagerWindow(current, total)
      const numbers = window.filter((item): item is number => item !== '…')
      expect(numbers).toContain(current)
      expect(numbers[0]).toBe(0)
      expect(numbers[numbers.length - 1]).toBe(total - 1)
      expect(new Set(numbers).size).toBe(numbers.length)
      expect([...numbers].sort((left, right) => left - right)).toEqual(numbers)
    }
  }
})
