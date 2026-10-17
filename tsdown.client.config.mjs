import { defineConfig } from 'tsdown'

// client-half build 契约（对齐 dsh-pmboard/pm/tsdown.client.config.mjs）：
// react 是宿主 seed 提供的 external，除此之外 client 源码必须零 bare import ——
// 宿主模块表里没有插件自己的 bare 依赖，漏 bundle 即运行时 require 失败
// （pm 教训：'require("marked") missed the module table'）。
//
// 两条实测结论（2026-10-17 用 .probe-xy 验过，别再踩）：
//   ① tsdown 默认把 package.json 的 dependencies 全部 external，光写 external: ['react']
//      不会把 @xyflow/react 打进来（产物 0.23 kB 就是没打进去）。要用 deps.alwaysBundle。
//   ② React Flow 的 `dist/style.css` **不能**在源码里 import：tsdown 会把 CSS 交给
//      @tsdown/css 出独立 .css 文件，而宿主模块表只加载一个 .cjs，样式文件永远没人加载。
//      做法：把样式作为字符串注入（沿用 src/client/styles.ts 的 injectStyles 模式）。
//      实测只打包 JS：196K minified，单文件可行。
export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: ['cjs'],
  outDir: 'lib',
  clean: false,
  sourcemap: false,
  target: 'chrome120',
  minify: true,
  outExtensions: () => ({ js: '.cjs' }),
  deps: {
    neverBundle: ['react', 'react/jsx-runtime'],
    alwaysBundle: [/^@xyflow\//],
  },
})
