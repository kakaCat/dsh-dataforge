#!/usr/bin/env node
/**
 * 生成 `src/client/xyflow-css.ts`：把 @xyflow/react 的 style.css 变成一段可注入的字符串。
 *
 * 为什么不在源码里 `import '@xyflow/react/dist/style.css'`：
 *   client 半边的构建契约是「单个 .cjs」，宿主模块表只加载那一个文件。tsdown 遇到 CSS
 *   会交给 @tsdown/css 输出独立 .css，那个文件永远没人加载（实测报错：
 *   `CSS file ... was encountered but @tsdown/css is not installed`）。
 *   面板本来就有 injectStyles 的运行时注入模式（src/client/styles.ts），沿用它即可。
 *
 * 用法：pnpm gen:xyflow-css（升级 @xyflow/react 后重跑；产物进 git，构建不依赖本脚本）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const cssPath = require.resolve('@xyflow/react/dist/style.css')
const raw = readFileSync(cssPath, 'utf8')
const version = require('@xyflow/react/package.json').version

if (raw.includes('url(')) {
  console.error('React Flow 样式里出现 url()：外部资源无法随单文件 bundle 分发，请人工检查')
  process.exitCode = 1
}

const banner = `/**
 * 自动生成，勿手改：\`pnpm gen:xyflow-css\`（来源 @xyflow/react@${version}/dist/style.css）。
 *
 * React Flow 的结构样式（节点绝对定位、Handle、Controls、MiniMap）缺了画布就是坏的，
 * 而 client 半边只能分发一个 .cjs，所以把样式收成字符串在运行时注入。
 *
 * @module dsh-dataforge/client/xyflow-css
 */
export const XYFLOW_CSS_VERSION = ${JSON.stringify(version)}

export const XYFLOW_CSS: string = ${JSON.stringify(raw)}
`

const out = join(root, 'src', 'client', 'xyflow-css.ts')
writeFileSync(out, banner, 'utf8')
console.log(`wrote ${out} (${raw.length} bytes, @xyflow/react@${version})`)
