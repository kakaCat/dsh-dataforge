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
