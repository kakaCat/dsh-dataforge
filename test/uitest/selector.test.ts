/**
 * 页面选择器脚本/点选脚本：语法可编译（真浏览器行为在 e2e-local）。
 *
 * @module dsh-dataforge/test/uitest/selector
 */
import { expect, it } from 'vitest'
import { PICKER_SCRIPT, SELECTOR_HELPER_SCRIPT } from '../../src/uitest/selector-script.js'

it('SELECTOR_HELPER_SCRIPT 是合法 JS', () => {
  expect(() => new Function(SELECTOR_HELPER_SCRIPT)).not.toThrow()
})

it('PICKER_SCRIPT 是合法 Promise 表达式', () => {
  expect(() => new Function(`return (${PICKER_SCRIPT})`)).not.toThrow()
})
