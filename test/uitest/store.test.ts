/**
 * ui-script 存取：版本快照 / 回读 / 坏文件 / 列表 / 路径安全。
 *
 * @module dsh-dataforge/test/uitest/store
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  latestUiScriptVersion, listUiScriptVersions, listUiScripts, listUiVersionInfos, loadUiScript,
  nextUiScriptVersion, saveUiScript, uiScriptDir, uiScriptPath, uiTestsRoot,
} from '../../src/uitest/store.js'
import type { UiScriptDoc } from '../../src/uitest/schema.js'

const SITE = '百度网盘'
const FLOW = '文件列表→分享'

let dir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-ui-script-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function workspace(): string {
  return dir as string
}

function script(overrides: Partial<UiScriptDoc> = {}): UiScriptDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'ui-script',
    meta: {
      site: SITE,
      flow: FLOW,
      version: 1,
      created: '2026-10-17T21:00:00+08:00',
      startUrl: 'https://pan.baidu.com/disk/main',
      source: 'record',
    },
    inputs: [],
    steps: [
      { id: 's1', kind: 'goto', url: 'https://pan.baidu.com/disk/main' },
      { id: 's2', kind: 'click', selector: 'button:has-text("分享")' },
    ],
    ...overrides,
  }
}

describe('ui-script store', () => {
  it('落盘 v1、回读、列版本', () => {
    const saved = saveUiScript(workspace(), script(), { source: 'record' })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.version).toBe(1)
    expect(saved.path).toBe(uiScriptPath(workspace(), SITE, FLOW, 1))
    expect(existsSync(saved.path)).toBe(true)
    expect(listUiScriptVersions(workspace(), SITE, FLOW)).toEqual([1])
    expect(latestUiScriptVersion(workspace(), SITE, FLOW)).toBe(1)

    const loaded = loadUiScript(workspace(), SITE, FLOW)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.version).toBe(1)
    expect(loaded.doc.steps).toHaveLength(2)
    expect(loaded.availableVersions).toEqual([1])
  })

  it('再保存一次 → v2，旧版本仍在且不可变', () => {
    saveUiScript(workspace(), script())
    const saved = saveUiScript(workspace(), script({ inputs: [] }))
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.version).toBe(2)
    expect(saved.doc.meta.version).toBe(2)
    const v1 = loadUiScript(workspace(), SITE, FLOW, 1)
    expect(v1.ok).toBe(true)
    if (!v1.ok) return
    expect(v1.doc.meta.version).toBe(1)
    expect(nextUiScriptVersion(workspace(), SITE, FLOW)).toBe(3)
  })

  it('version 由 store 分配：输入里写 99 也会被覆盖成实际版本', () => {
    const input = script()
    input.meta.version = 99
    const saved = saveUiScript(workspace(), input)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.doc.meta.version).toBe(1)
  })

  it('读取不存在的版本 → ui-script-not-found + 可用版本', () => {
    saveUiScript(workspace(), script())
    const missing = loadUiScript(workspace(), SITE, FLOW, 9)
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.code).toBe('ui-script-not-found')
    expect(missing.availableVersions).toEqual([1])
  })

  it('坏文件如实报 invalid-ui-script，不静默', () => {
    saveUiScript(workspace(), script())
    writeFileSync(uiScriptPath(workspace(), SITE, FLOW, 1), 'steps: [oops', 'utf8')
    const loaded = loadUiScript(workspace(), SITE, FLOW)
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.code).toBe('invalid-ui-script')
    expect(loaded.issues?.length).toBeGreaterThan(0)
  })

  it('列表：流程 + 版本摘要（坏版本带 unreadable）', () => {
    saveUiScript(workspace(), script())
    const refs = listUiScripts(workspace())
    expect(refs).toHaveLength(1)
    expect(refs[0]?.site).toBe(SITE)
    expect(refs[0]?.latest).toBe(1)

    const infos = listUiVersionInfos(workspace(), SITE, FLOW)
    expect(infos[0]?.stepCount).toBe(2)

    writeFileSync(uiScriptPath(workspace(), SITE, FLOW, 1), 'kind: ui-script', 'utf8')
    const broken = listUiVersionInfos(workspace(), SITE, FLOW)
    expect(broken[0]?.unreadable).toBeTruthy()
    const brokenRefs = listUiScripts(workspace())
    expect(brokenRefs[0]?.unreadable).toBeTruthy()
  })

  it('目录走 slug：站点/流程名不直接拼路径', () => {
    expect(uiScriptDir(workspace(), '../etc', 'a/b')).toContain(join('.dsh', 'dataforge', 'ui-tests'))
    expect(uiTestsRoot(workspace()).endsWith(join('.dsh', 'dataforge', 'ui-tests'))).toBe(true)
  })

  it('save 校验不过不落盘', () => {
    const bad = script()
    bad.steps = []
    const saved = saveUiScript(workspace(), bad)
    expect(saved.ok).toBe(false)
    expect(listUiScriptVersions(workspace(), SITE, FLOW)).toEqual([])
  })
})
