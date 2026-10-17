# ADR-0001 编排界面的技术选型（React + shadcn/ui + @xyflow/react）

- 状态：已接受
- 日期：2026-10-17
- 决策人：yunpeng
- 相关：[R-2 设计](../projects/PRJ-0002/design/r2-orchestration-canvas.md)、[R-2 需求](../projects/PRJ-0002/requirement/r2-orchestration-canvas.md)

## 背景

编排页签需要一个可编辑的 DAG 画布。用户已明确指定两件事：

1. **DAG 图用 `@xyflow/react`**（原话：「DAG 图 用 @xyflow/react 这个框架」）；
2. **前端用 React、UI 用 shadcn/ui**（体现在既有代码与配置里，见下）。

本 ADR 把这三点固化成可引用的决策，避免后续每个 PR 重新讨论。

## 决策

| 层 | 选择 | 落地位置 |
|---|---|---|
| 前端框架 | React（宿主 seed 注入，不入 dependencies） | `tsdown.client.config.mjs` 的 `deps.neverBundle: ['react', 'react/jsx-runtime']` |
| UI 框架 | shadcn/ui（标准 token 名 + 手写组件，不引入 Tailwind 构建链） | `src/client/styles.ts` 的 `--background/--card/--primary/--radius` 变量表 |
| 画布 | `@xyflow/react` 12.12.0 | `src/client/orchestration-canvas.tsx` |

## 依据

- **React 是宿主的契约，不是插件依赖**：client 半边以单 CJS 交付，`react` 由宿主加载器提供；写进 `dependencies` 只会让它被重复打包或与宿主版本冲突。
- **shadcn/ui 已在用**：`styles.ts` 自述「shadcn/ui 标准 token 名（前端统一约定）；值来自三张原型的色板」。本期沿用同一套 token，不引入 Tailwind——现有 client 文件与运行时注入样式的做法已经稳定，换构建链的收益不抵风险。
- **@xyflow/react 是用户指定**，且原型 `docs/prototypes/orchestration.html` 就是 React Flow v12 写法（`nodeTypes` / `Panel` / `applyNodeChanges`），迁移成本最低。

## 后果

**正面**

- 画布与现有面板共用一套 token 与类名前缀（`dsh-df-`），视觉一致；
- 不需要为样式引额外构建步骤；React Flow 的结构样式以字符串注入（`pnpm gen:xyflow-css`），仍满足单 CJS 交付；
- 升级 `@xyflow/react` 只需重跑生成脚本并重建。

**负面**

- client bundle 从 61 KB 涨到 325 KB（React Flow + zustand + d3-*）；
- shadcn/ui 组件是「手写复刻」而非 npm 包：新增组件要照着 token 自己写，没有 `npx shadcn add` 那套；
- React Flow 样式是构建期快照，升级后忘记重跑脚本会让样式落后于组件版本。

## 备选方案

| 方案 | 为什么未选 |
|---|---|
| Vue 3 + Element Plus | 与既有 React 面板及用户指定的 `@xyflow/react` 冲突（Vue 生态对应的是 `@vue-flow/core`），等于把客户端页面重写一遍 |
| 引入 Tailwind + 真正的 shadcn 组件包 | 需要把运行时注入样式改成构建期 CSS 管线，与「单 CJS 交付、无一额外文件」的约束冲突；收益仅是少写几个组件的 CSS |
| 自绘 SVG 画布（不引 React Flow） | 拖拽、连线、缩放、MiniMap 全部要自己实现，等于重写一个 React Flow |
