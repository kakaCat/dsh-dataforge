/**
 * 绑定求值（IF-5）单测：R-1 路径语法、通配展开、单元素解包、类型校验。
 *
 * @module dsh-dataforge/test/execute/binding
 */
import { describe, expect, it } from 'vitest'
import type { BindingResult, BindingRoot } from '../../src/execute/binding.js'
import { resolveBinding } from '../../src/execute/binding.js'

const TWO_ITEMS = [
  { internalId: 'M-1', code: 'C-1', qty: 3, tags: ['a', 'b'] },
  { internalId: 'M-2', code: 'C-2', qty: 5, tags: ['c'] },
]

function rootOf(body: unknown, overrides: Partial<BindingRoot> = {}): BindingRoot {
  return {
    body,
    status: 200,
    headers: { 'x-total': '2', 'content-type': 'application/json' },
    ...overrides,
  }
}

function itemsBody(items: unknown[] = TWO_ITEMS): unknown {
  return {
    items,
    Result: { list: [{ code: 'R-1' }, { code: 'R-2' }] },
    meta: null,
  }
}

function okResult(result: BindingResult): Extract<BindingResult, { ok: true }> {
  if (!result.ok) throw new Error(`期望成功，实际 ${result.code}: ${result.message}`)
  return result
}

function failureResult(result: BindingResult): Extract<BindingResult, { ok: false }> {
  if (result.ok) throw new Error('期望失败，实际成功')
  return result
}

describe('[0] 与 [*] 的单元素取值一致（R-1/R-3 契约）', () => {
  it('同一份单元素响应取到同一个值，matched 都归一成 [*]', () => {
    const root = rootOf({ items: [{ internalId: 'M-1' }] })
    const indexed = okResult(resolveBinding(root, 'body.items[0].internalId'))
    const wildcard = okResult(resolveBinding(root, 'body.items[*].internalId'))

    expect(indexed.value).toBe('M-1')
    expect(wildcard.value).toBe('M-1')
    expect(indexed.value).toBe(wildcard.value)

    expect(indexed.matched).toBe('body.items[*].internalId')
    expect(wildcard.matched).toBe('body.items[*].internalId')

    expect(indexed.unwrapped).toBeUndefined()
    expect(wildcard.unwrapped).toBe(true)
  })
})

describe('通配投影', () => {
  it('多元素 [*] 返回数组，expectedType: array 通过', () => {
    const result = okResult(resolveBinding(rootOf(itemsBody()), 'body.items[*].internalId', 'array'))
    expect(result.value).toEqual(['M-1', 'M-2'])
    expect(result.matched).toBe('body.items[*].internalId')
    expect(result.unwrapped).toBeUndefined()
  })

  it('[] 与 [*] 等价，同样按数组返回', () => {
    const result = okResult(resolveBinding(rootOf(itemsBody()), 'body.Result.list[].code'))
    expect(result.value).toEqual(['R-1', 'R-2'])
    expect(result.matched).toBe('body.Result.list[*].code')
  })

  it('单元素 [*] 解包成标量并标 unwrapped', () => {
    const root = rootOf({ items: [{ internalId: 'M-1' }] })
    const result = okResult(resolveBinding(root, 'body.items[*].internalId'))
    expect(result.value).toBe('M-1')
    expect(result.unwrapped).toBe(true)
  })

  it('目标声明为 array 时单元素投影保持数组，不回退成标量', () => {
    const root = rootOf({ items: [{ internalId: 'M-1' }] })
    const result = okResult(resolveBinding(root, 'body.items[*].internalId', 'array'))
    expect(result.value).toEqual(['M-1'])
    expect(result.unwrapped).toBeUndefined()
  })

  it('空数组 → empty-wildcard', () => {
    const failure = failureResult(resolveBinding(rootOf({ items: [] }), 'body.items[*].internalId'))
    expect(failure.code).toBe('empty-wildcard')
    expect(failure.path).toBe('body.items[*].internalId')
    expect(failure.message).toContain('未匹配到任何元素')
  })

  it('多元素投影给标量目标 → type-mismatch，并提示改用 [0]', () => {
    const failure = failureResult(resolveBinding(rootOf(itemsBody()), 'body.items[*].internalId', 'string'))
    expect(failure.code).toBe('type-mismatch')
    expect(failure.message).toContain('array')
    expect(failure.message).toContain('[0]')
  })

  it('多级 [*] 如实产出嵌套数组', () => {
    const root = rootOf({ groups: [{ items: [{ code: 'a' }, { code: 'b' }] }, { items: [{ code: 'c' }] }] })
    const result = okResult(resolveBinding(root, 'body.groups[*].items[*].code', 'array<array<string>>'))
    expect(result.value).toEqual([['a', 'b'], ['c']])
  })
})

describe('索引与缺值', () => {
  it('[n] 取第 n 项', () => {
    expect(okResult(resolveBinding(rootOf(itemsBody()), 'body.items[1].code')).value).toBe('C-2')
  })

  it('越界 [9] → path-not-found', () => {
    const failure = failureResult(resolveBinding(rootOf(itemsBody()), 'body.items[9].internalId'))
    expect(failure.code).toBe('path-not-found')
    expect(failure.message).toContain('越界')
    expect(failure.path).toBe('body.items[9].internalId')
  })

  it('中途 null → null-value', () => {
    const failure = failureResult(resolveBinding(rootOf({ items: [null] }), 'body.items[0].internalId'))
    expect(failure.code).toBe('null-value')
    expect(failure.message).toContain('null')
  })

  it('字段不存在 → path-not-found（与 null 区分）', () => {
    const failure = failureResult(resolveBinding(rootOf({ items: [{ internalId: 'M-1' }] }), 'body.items[0].missing'))
    expect(failure.code).toBe('path-not-found')
    expect(failure.message).toContain('missing')
  })
})

describe('类型校验', () => {
  it('期望 number 实得 string → type-mismatch，message 带实际类型', () => {
    const failure = failureResult(
      resolveBinding(rootOf(itemsBody()), 'body.items[0].internalId', 'number'),
    )
    expect(failure.code).toBe('type-mismatch')
    expect(failure.message).toContain('string')
  })

  it('数字字符串可无损转换，按 number 通过', () => {
    const result = okResult(resolveBinding(rootOf({ qty: '42' }), 'body.qty', 'number'))
    expect(result.value).toBe('42')
  })

  it('object / boolean 按词表校验', () => {
    expect(okResult(resolveBinding(rootOf({ meta: { id: 1 } }), 'body.meta', 'object')).value).toEqual({ id: 1 })
    expect(okResult(resolveBinding(rootOf({ flag: true }), 'body.flag', 'boolean')).value).toBe(true)

    const failure = failureResult(resolveBinding(rootOf({ meta: { id: 1 } }), 'body.meta', 'array'))
    expect(failure.code).toBe('type-mismatch')
    expect(failure.message).toContain('object')
  })
})

describe('信封路径', () => {
  it('headers.x-total 取到值（头名大小写不敏感）', () => {
    expect(okResult(resolveBinding(rootOf(itemsBody()), 'headers.x-total')).value).toBe('2')
    expect(okResult(resolveBinding(rootOf(itemsBody()), 'headers.X-Total')).value).toBe('2')
  })

  it('status 取到值', () => {
    expect(okResult(resolveBinding(rootOf(itemsBody()), 'status')).value).toBe(200)
    expect(okResult(resolveBinding(rootOf(itemsBody()), 'status', 'number')).value).toBe(200)
  })
})

describe('宽容路径', () => {
  it('无 body. 前缀的裸路径直接对 root.body 求值', () => {
    const result = okResult(resolveBinding(rootOf(itemsBody()), 'items[0].internalId'))
    expect(result.value).toBe('M-1')
    expect(result.matched).toBe('items[*].internalId')
  })

  it('不修改响应根（纯函数）', () => {
    const root = rootOf(itemsBody())
    const before = JSON.stringify(root)
    resolveBinding(root, 'body.items[*].internalId')
    resolveBinding(root, 'headers.x-total')
    expect(JSON.stringify(root)).toBe(before)
  })
})
