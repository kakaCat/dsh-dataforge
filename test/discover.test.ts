import { describe, expect, it, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverFlows, pickFlow, readFlowYaml } from '../src/flows/discover.js'

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true })
    dir = undefined
  }
})

function freshRoot(): string {
  dir = mkdtempSync(join(tmpdir(), 'df-discover-'))
  return dir
}

function writeFlow(root: string, file: string, content: string): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, file), content, 'utf8')
}

describe('readFlowYaml / splitInputs', () => {
  it('解析 name/inputs.required/optional/label/description', () => {
    const root = freshRoot()
    const path = join(root, 'sample.yaml')
    writeFileSync(path, `
name: ZNB普通物料PRPO造单
description: 查询物料元数据 → 创建PR → PR转PO
inputs:
  stockOrg:    { label: 库存组织, required: true }
  purchaseOrg: { label: 采购组织, required: true }
  projectCode: { label: 项目编码, required: false }
`, 'utf8')
    const flow = readFlowYaml(path, 'builtin')
    expect(flow).toEqual({
      name: 'ZNB普通物料PRPO造单',
      flowPath: path,
      pack: 'builtin',
      description: '查询物料元数据 → 创建PR → PR转PO',
      requiredFields: [
        { field: 'stockOrg', label: '库存组织' },
        { field: 'purchaseOrg', label: '采购组织' },
      ],
      optionalFields: [{ field: 'projectCode', label: '项目编码' }],
    })
  })

  it('缺 name 回退文件名；缺 label 回退字段名；缺 inputs 全 optional', () => {
    const root = freshRoot()
    const path = join(root, 'anon.yaml')
    writeFileSync(path, 'steps: []\n', 'utf8')
    expect(readFlowYaml(path, 'workspace')).toEqual({
      name: 'anon',
      flowPath: path,
      pack: 'workspace',
      description: undefined,
      requiredFields: [],
      optionalFields: [],
    })
  })

  it('坏 yaml / 目录 / 空文件 → undefined 不炸', () => {
    const root = freshRoot()
    const bad = join(root, 'bad.yaml')
    writeFileSync(bad, '{ name: [unclosed\n  broken: ::', 'utf8')
    expect(readFlowYaml(bad, 'builtin')).toBeUndefined()
    expect(readFlowYaml(join(root, 'missing.yaml'), 'builtin')).toBeUndefined()
  })
})

describe('discoverFlows 三层合并', () => {
  it('后写赢：workspace 覆盖 dataRoot 覆盖 builtin，同名流程 pack 注记新来源', () => {
    const root = freshRoot()
    const builtin = join(root, 'builtin')
    const dataRoot = join(root, 'dataRoot')
    const workspace = join(root, 'workspace')
    writeFlow(builtin, 'a.yaml', 'name: A\ndescription: builtin 版\n')
    writeFlow(dataRoot, 'a.yaml', 'name: A\ndescription: dataRoot 版\n')
    writeFlow(dataRoot, 'b.yaml', 'name: B\ninputs:\n  x: {label: X, required: true}\n')
    writeFlow(workspace, 'a.yaml', 'name: A\n')
    writeFileSync(join(root, 'stray.txt'), 'name: 非yaml不收集\n', 'utf8')

    const { flows, packs } = discoverFlows({
      builtinConfigsDir: builtin,
      dataRootFlows: dataRoot,
      workspaceFlows: workspace,
    })

    expect(flows).toHaveLength(2)
    const a = flows.find((f) => f.name === 'A')
    expect(a?.pack).toBe('workspaceFlows')
    expect(a?.description).toBeUndefined()
    const b = flows.find((f) => f.name === 'B')
    expect(b?.requiredFields).toEqual([{ field: 'x', label: 'X' }])
    expect(packs).toEqual({ builtin, dataRoot, workspace })
  })

  it('缺席包根不炸，packs 不留空条目', () => {
    const root = freshRoot()
    const { flows, packs } = discoverFlows({ builtinConfigsDir: join(root, 'nope') })
    expect(flows).toEqual([])
    expect(packs).toEqual({ builtin: join(root, 'nope') })
  })
})

describe('pickFlow', () => {
  it('命中返回；未命中抛 FLOW_NOT_FOUND 附可用清单', () => {
    const discovered = discoverFlows({})
    expect(() => pickFlow(discovered, 'A')).toThrow(/不存在/)

    const root = freshRoot()
    const builtin = join(root, 'builtin')
    writeFlow(builtin, 'a.yaml', 'name: A\n')
    writeFlow(builtin, 'b.yaml', 'name: B\n')
    const full = discoverFlows({ builtinConfigsDir: builtin })
    expect(pickFlow(full, 'B').pack).toBe('builtinConfigsDir')
    const err = (() => {
      try {
        pickFlow(full, 'Z')
        return undefined
      } catch (e) {
        return e as Error & { code?: string; hints?: string[] }
      }
    })()
    expect(err?.code).toBe('FLOW_NOT_FOUND')
    expect(err?.hints?.[0]).toContain('A, B')
  })
})
