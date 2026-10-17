import { defineConfig } from 'vitest/config'

// 测试用 esbuild 的 automatic JSX：client 半边本来就是 `jsx: react-jsx`
// （tsconfig.client.json），但根 tsconfig 不设 jsx，.tsx 测试文件会退回 classic
// 转换并报 `React is not defined`。这里对齐编译口径，免得每个测试文件都要
// 手动 `import React`。
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node' },
})
