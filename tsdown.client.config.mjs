import { defineConfig } from 'tsdown'

// client-half build 契约（对齐 dsh-pmboard/pm/tsdown.client.config.mjs）：
// react 是宿主 seed 提供的 external，除此之外 client 源码必须零 bare import ——
// 宿主模块表里没有插件自己的 bare 依赖，漏 bundle 即运行时 require 失败
// （pm 教训：'require("marked") missed the module table'）。
export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: ['cjs'],
  outDir: 'lib',
  clean: false,
  sourcemap: false,
  external: ['react', 'react/jsx-runtime'],
  target: 'chrome120',
  minify: true,
  outExtensions: () => ({ js: '.cjs' }),
})
