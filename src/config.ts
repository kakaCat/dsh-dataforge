/**
 * 插件配置 schema（Schemastery 面向 cordis.yml）：
 * 凡是不同部署可能取不同值的，都必须是配置字段——无默默兜底。
 *
 * @module dsh-dataforge/config
 */
import Schema from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'

export interface Config {
  /** 引擎流程包 checkout 绝对路径（含 dsh_bridge.py；DataForge Loop 仓库即首个流程包+引擎）。 */
  engineRoot: string
  /** python 解释器（造数引擎运行时）。 */
  pythonBin: string
  /** 插件数据根：runs 留痕与第三方流程包（默认 $DSH_HOME/storages/dsh-dataforge）。 */
  dataRoot: string
  /** 桥进程硬超时（秒）；超时即杀并如实汇报。 */
  timeoutSeconds: number
  /** 是否把流程包 policy.md 注入常驻策略段（三道闸纪律 + 业务映射）。 */
  injectPolicy: boolean
  /** 采集：站点爬行 BFS 深度上限。 */
  captureMaxDepth: number
  /** 采集：单次 site_crawl 页面数上限（超限诚实截断）。 */
  captureMaxPages: number
  /** 采集：网络 idle 后的稳定窗口 ms。 */
  captureStabilityWindowMs: number
  /** 采集：单响应体留盘点上限（字节），超过落文件。 */
  captureBodyLimitBytes: number
  /** 采集：Chrome 通道（缺省 'chrome' = 本机系统 Chrome，免下载浏览器）。 */
  captureChromeChannel: string
}

export const Config: Schema<Config> = Schema.object({
  engineRoot: Schema.string().required(),
  pythonBin: Schema.string().default('python3'),
  dataRoot: Schema.string().default(join(homedir(), '.dsh', 'storages', 'dsh-dataforge')),
  timeoutSeconds: Schema.number().default(600),
  injectPolicy: Schema.boolean().default(true),
  captureMaxDepth: Schema.number().default(3),
  captureMaxPages: Schema.number().default(50),
  captureStabilityWindowMs: Schema.number().default(1500),
  captureBodyLimitBytes: Schema.number().default(262_144),
  captureChromeChannel: Schema.string().default('chrome'),
})

/** 归一化（相对路径 → 绝对；~ 展开）。 */
export function normalizeConfig(raw: Config): Required<Config> {
  const expandHome = (p: string): string => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p)
  return {
    engineRoot: resolvePath(expandHome(raw.engineRoot)),
    pythonBin: raw.pythonBin,
    dataRoot: resolvePath(expandHome(raw.dataRoot)),
    timeoutSeconds: raw.timeoutSeconds,
    injectPolicy: raw.injectPolicy,
    captureMaxDepth: raw.captureMaxDepth,
    captureMaxPages: raw.captureMaxPages,
    captureStabilityWindowMs: raw.captureStabilityWindowMs,
    captureBodyLimitBytes: raw.captureBodyLimitBytes,
    captureChromeChannel: raw.captureChromeChannel,
  }
}
