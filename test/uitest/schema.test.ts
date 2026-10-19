/**
 * ui-script 契约：形状 / 必填 / 入参引用 / YAML 往返。
 *
 * @module dsh-dataforge/test/uitest/schema
 */
import { describe, expect, it } from 'vitest'
import {
  formatUiIssues, inputRefsOf, missingInputsOf, parseUiScriptDoc, parseUiScriptYaml,
  substituteInputs, uiScriptToYaml, type UiScriptDoc,
} from '../../src/uitest/schema.js'

function validRaw(): Record<string, unknown> {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'ui-script',
    meta: {
      site: '百度网盘',
      flow: '上传文件',
      version: 1,
      created: '2026-10-17T21:00:00+08:00',
      startUrl: 'https://pan.baidu.com/disk/main',
      source: 'record',
      viewport: { width: 1280, height: 720 },
    },
    inputs: [
      { name: 'keyword', type: 'string', required: true, example: '键盘精灵' },
    ],
    steps: [
      { id: 's1', kind: 'goto', url: 'https://pan.baidu.com/disk/main' },
      { id: 's2', kind: 'fill', selector: '#kw', value: '{{keyword}}', at: 'https://pan.baidu.com/disk/main' },
      {
        id: 's3',
        kind: 'click',
        selector: 'button:has-text("搜索")',
        candidates: ['[data-testid="search"]', 'button:has-text("搜索")'],
        expect: [
          { kind: 'visible', selector: '#result' },
          { kind: 'text', selector: '#echo', equals: '{{keyword}}' },
          { kind: 'url', contains: '/result' },
        ],
      },
    ],
  }
}

describe('parseUiScriptDoc', () => {
  it('合法脚本：动作/断言/入参引用都保留', () => {
    const parsed = parseUiScriptDoc(validRaw())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.meta.site).toBe('百度网盘')
    expect(parsed.doc.meta.source).toBe('record')
    expect(parsed.doc.inputs).toHaveLength(1)
    expect(parsed.doc.steps).toHaveLength(3)
    expect(parsed.doc.steps[1]?.value).toBe('{{keyword}}')
    expect(parsed.doc.steps[2]?.expect?.[1]?.equals).toBe('{{keyword}}')
  })

  it('缺 steps → no-steps', () => {
    const raw = validRaw()
    raw['steps'] = []
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues.some((item) => item.code === 'no-steps')).toBe(true)
  })

  it('kind 非法 → bad-step-kind', () => {
    const raw = validRaw()
    ;(raw['steps'] as Array<Record<string, unknown>>)[0]!['kind'] = 'double-click'
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'bad-step-kind', target: 'steps[0]' }))
  })

  it('click 缺 selector/candidates → missing-target', () => {
    const raw = validRaw()
    const step = (raw['steps'] as Array<Record<string, unknown>>)[2]!
    delete step['selector']
    delete step['candidates']
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'missing-target' }))
  })

  it('fill 缺 value → bad-step-field', () => {
    const raw = validRaw()
    delete (raw['steps'] as Array<Record<string, unknown>>)[1]!['value']
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'bad-step-field', target: 'steps[1]' }))
  })

  it('wait ms 越界 → bad-step-field', () => {
    const raw = validRaw()
    ;(raw['steps'] as Array<Record<string, unknown>>).push({ id: 's9', kind: 'wait', ms: 999_999 })
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues.some((item) => item.code === 'bad-step-field' && item.target === 'steps[3]')).toBe(true)
  })

  it('重复步骤 id → duplicate-step-id', () => {
    const raw = validRaw()
    ;(raw['steps'] as Array<Record<string, unknown>>)[1]!['id'] = 's1'
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues.some((item) => item.code === 'duplicate-step-id')).toBe(true)
  })

  it('声明了没人用的入参 → unreferenced-input', () => {
    const raw = validRaw()
    ;(raw['inputs'] as Array<Record<string, unknown>>).push({ name: 'unused', type: 'string', required: false })
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues.some((item) => item.code === 'unreferenced-input')).toBe(true)
  })

  it('引用了未声明的入参 → unknown-input-ref', () => {
    const raw = validRaw()
    ;(raw['steps'] as Array<Record<string, unknown>>)[1]!['value'] = '{{nope}}'
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues.some((item) => item.code === 'unknown-input-ref')).toBe(true)
  })

  it('startUrl 非 http/https → bad-start-url', () => {
    const raw = validRaw()
    ;(raw['meta'] as Record<string, unknown>)['startUrl'] = 'file:///tmp/a.html'
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues.some((item) => item.code === 'bad-start-url')).toBe(true)
  })

  it('重复入参名 → duplicate-input', () => {
    const raw = validRaw()
    ;(raw['inputs'] as Array<Record<string, unknown>>).push({ name: 'keyword', type: 'string', required: false })
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues.some((item) => item.code === 'duplicate-input')).toBe(true)
  })

  it('断言缺 equals/contains → bad-expect', () => {
    const raw = validRaw()
    ;(raw['steps'] as Array<Record<string, unknown>>)[2]!['expect'] = [{ kind: 'text', selector: '#echo' }]
    const parsed = parseUiScriptDoc(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues.some((item) => item.code === 'bad-expect')).toBe(true)
  })
})

describe('YAML 往返', () => {
  it('toYaml → parse 得到同一份文档', () => {
    const parsed = parseUiScriptDoc(validRaw())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const yaml = uiScriptToYaml(parsed.doc)
    const back = parseUiScriptYaml(yaml)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.doc).toEqual(parsed.doc)
  })

  it('YAML 语法错误 → invalid-script', () => {
    const parsed = parseUiScriptYaml('apiVersion: [unclosed')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues[0]?.code).toBe('invalid-script')
  })

  it('YAML 里 created 是时间戳也保持字符串', () => {
    const parsed = parseUiScriptYaml(uiScriptToYaml((parseUiScriptDoc(validRaw()) as { ok: true; doc: UiScriptDoc }).doc))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(typeof parsed.doc.meta.created).toBe('string')
  })
})

describe('入参替换', () => {
  it('inputRefsOf 去重保序', () => {
    expect(inputRefsOf('a {{x}} b {{ y }} {{x}}')).toEqual(['x', 'y'])
  })

  it('substituteInputs 只替换给了值的槽位', () => {
    expect(substituteInputs('{{a}}-{{b}}', { a: 'A' })).toBe('A-{{b}}')
  })

  it('missingInputsOf 只报必填缺失', () => {
    const parsed = parseUiScriptDoc(validRaw())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(missingInputsOf(parsed.doc, {})).toEqual(['keyword'])
    expect(missingInputsOf(parsed.doc, { keyword: 'x' })).toEqual([])
  })

  it('formatUiIssues 一行一条', () => {
    expect(formatUiIssues([{ target: 'steps[0]', code: 'missing-target', reason: '缺 selector' }]))
      .toBe('steps[0]：缺 selector')
  })
})
