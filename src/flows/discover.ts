/**
 * 流程包发现（Flow Pack Discovery）。
 *
 * 三层来源（后写赢，同名流程高优先级包覆盖低优先级包）：
 *   1. builtin —— 引擎 checkout 自带的 configs/*.yaml（DataForge 流程包）
 *   2. dataRoot —— $DSH_HOME/storages/dsh-dataforge/flows/*.yaml（用户第三方包）
 *   3. workspace —— <工作区>/.dsh/dataforge/flows/*.yaml（项目自带，权威）
 *
 * 热重载：每次 flows() 现场扫盘读 mtime（目录级廉价操作），改文件即生效，
 * 不需要重启宿主——对齐 dsh-file-enhance 的「文件是唯一权威」哲学。
 *
 * @module dsh-dataforge/flows/discover
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import yaml from 'js-yaml'
import type { FlowField, FlowInfo } from '../shared/types.js'

const YAML_RE = /\.ya?ml$/

/** 平铺读一个包目录下的流程 yaml（绝对路径）。 */
export function readFlowsFromDir(dir: string, pack: string): FlowInfo[] {
  if (!existsSync(dir)) return []
  const flows: FlowInfo[] = []
  for (const entry of readdirSync(dir)) {
    if (!YAML_RE.test(entry)) continue
    const flowPath = join(dir, entry)
    const info = readFlowYaml(flowPath, pack)
    if (info) flows.push(info)
  }
  return flows
}

/** 读单份流程 yaml；解析失败（坏 yaml）跳过不炸——包是用户手写的。 */
export function readFlowYaml(flowPath: string, pack: string): FlowInfo | undefined {
  try {
    const stat = statSync(flowPath)
    if (!stat.isFile()) return undefined
    const doc = yaml.load(readFileSync(flowPath, 'utf8')) as Record<string, unknown> | null
    if (doc === null || typeof doc !== 'object') return undefined
    const name = typeof doc['name'] === 'string' ? doc['name'] : basename(flowPath, '.yaml')
    const inputs = (doc['inputs'] ?? {}) as Record<string, Record<string, unknown>>
    const { required, optional } = splitInputs(inputs)
    const description = typeof doc['description'] === 'string' ? doc['description'] : undefined
    return { name, flowPath, pack, description, requiredFields: required, optionalFields: optional }
  } catch {
    return undefined
  }
}

function splitInputs(inputs: Record<string, Record<string, unknown>>): {
  required: FlowField[]
  optional: FlowField[]
} {
  const required: FlowField[] = []
  const optional: FlowField[] = []
  for (const [field, def] of Object.entries(inputs ?? {})) {
    if (def === null || typeof def !== 'object') continue
    const entry: FlowField = {
      field,
      label: typeof def['label'] === 'string' ? def['label'] : field,
    }
    if (def['required'] === true) required.push(entry)
    else optional.push(entry)
  }
  return { required, optional }
}

/** 插件可用的全部包根（顺序即优先级，先列后覆盖）。 */
export interface PackRoots {
  /** 引擎 checkout（内置默认包：configs/）。 */
  builtinConfigsDir?: string
  /** $DSH_HOME/storages/dsh-dataforge/flows。 */
  dataRootFlows?: string
  /** 工作区 .dsh/dataforge/flows。 */
  workspaceFlows?: string
}

export interface DiscoveredFlows {
  flows: FlowInfo[]
  /** 每层包根是否存在（诊断诚实面）。 */
  packs: { builtin?: string; dataRoot?: string; workspace?: string }
}

/**
 * 汇合并发：低优先级包先入册，同名流程被高优先级包覆盖（记录新 pack 来源）。
 * 多流程同名同包同理，先读到的行被同包后写覆盖。
 */
export function discoverFlows(roots: PackRoots): DiscoveredFlows {
  const byName = new Map<string, FlowInfo>()
  const layers: Array<[keyof PackRoots, string | undefined]> = [
    ['builtinConfigsDir', roots.builtinConfigsDir],
    ['dataRootFlows', roots.dataRootFlows],
    ['workspaceFlows', roots.workspaceFlows],
  ]

  for (const [layer, dir] of layers) {
    if (!dir) continue
    for (const flow of readFlowsFromDir(dir, layer)) {
      byName.set(flow.name, flow) // 后写赢：高优先级覆盖
    }
  }

  return {
    flows: [...byName.values()],
    packs: {
      ...(roots.builtinConfigsDir === undefined ? {} : { builtin: roots.builtinConfigsDir }),
      ...(roots.dataRootFlows === undefined ? {} : { dataRoot: roots.dataRootFlows }),
      ...(roots.workspaceFlows === undefined ? {} : { workspace: roots.workspaceFlows }),
    },
  }
}

/** 按名字取流程：找不到抛 FLOW_NOT_FOUND（工具壳转诚实回执）。 */
export function pickFlow(discovered: DiscoveredFlows, name: string): FlowInfo {
  const flow = discovered.flows.find((f) => f.name === name)
  if (!flow) {
    const names = discovered.flows.map((f) => f.name).slice(0, 10).join(', ')
    throw Object.assign(new Error(`流程「${name}」不存在于任何流程包`), {
      code: 'FLOW_NOT_FOUND',
      hints: [`可用流程：${names}${discovered.flows.length > 10 ? ' …' : ''}`],
    })
  }
  return flow
}
