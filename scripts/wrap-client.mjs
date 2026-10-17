// 把 lib/client.cjs 包成宿主模块加载器注册文件 lib/client.js（对齐 dsh-pmboard/scripts/wrap-client.mjs）：
// window.__ModuleLoader__.load({ id: pkg.name, factory }) —— 正是 DSH web shell
// 在 /plugins/??<pkg>/client.js 提供的形状。构建戳 = sha256(client.cjs) 前 12 位，
// 哈希对象是 client.cjs 的原始字节（不是本文件自己的输出——戳写在 client.js 体内，自指即变）。
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const cjsBuf = readFileSync(join(root, 'lib', 'client.cjs'))
const cjs = cjsBuf.toString('utf8')

const stamp = createHash('sha256').update(cjsBuf).digest('hex').slice(0, 12)

// 浏览器宿主没有 `process`：bundle 里只要残留裸 `process.*`，模块加载器会
// 在 factory 执行时抛 `process is not defined`，整个客户端插件不激活。
// 当前每个 process 引用都应被 tsdown 的 define 替代（见 tsdown.client.config.mjs）；
// 这里兜底，避免换依赖/改构建配置后静默发布一个必炸的 bundle。
if (/\bprocess\s*\./.test(cjs)) {
  const line = cjs.split('\n').findIndex((text) => /\bprocess\s*\./.test(text)) + 1
  console.error(
    `[wrap-client] ${pkg.name}: lib/client.cjs still references \`process\` at line ${line}.\n` +
      'A browser bundle cannot use process; add a build-time define (e.g. process.env.NODE_ENV) ' +
      'or stop bundling the dependency that emits it.',
  )
  process.exit(1)
}

// 不给行注入缩进：会污染 bundle 内多行模板字符串（pm 同款教训）。
const body = cjs

const out = `window.__DSH_DJBUILD__ = ${JSON.stringify(stamp)};
window.__ModuleLoader__.load({
\t\tid: ${JSON.stringify(pkg.name)},
\t\tfactory: (require) => {
\t\t\tvar module = { exports: {} };
\t\t\tvar exports = module.exports;
\t\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
\t\t\treturn module.exports;
\t\t}
\t});
\n`

writeFileSync(join(root, 'lib', 'client.js'), out)
console.log('wrapped', pkg.name, '->', 'lib/client.js', out.length, 'bytes')
