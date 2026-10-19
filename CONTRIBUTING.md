# Contributing to dsh-dataforge

感谢你的贡献！本项目是 DSH（DeepSeek Harness）的 Cordis 插件，执行核心为纯 TypeScript + HTTP。

## 开发环境

- Node.js >= 20，包管理用 pnpm
- `pnpm install` 安装依赖

## 工作流

1. Fork 本仓库，从 `main` 切出分支
2. 修改代码 / 文档 / 测试
3. 本地验证全绿后再提交：

```bash
pnpm typecheck   # 三个 tsconfig 全量类型检查
pnpm test        # vitest 全量用例
pnpm build       # dist/ + lib/client.js
```

4. 真实站点 / 真 Chrome 的端到端用例默认跳过，仅在必要时本地开启：
   - `UI_E2E=1`：UI 录制回放本地端到端
   - `E2E_REAL=1`：jsonplaceholder 只读闭环
5. 提交 PR，描述清楚：改了什么、为什么、验证方式

## 设计约束（PR 会被按这些标准 review）

- **不用 Python**：插件本体与执行核心零 Python 依赖
- **HTTP-only**：对目标系统的读写只走 HTTP API，不引入目标库 SQL 回退
- **零硬编码业务映射**：网站/业务域/物料/组织等映射必须来自接口或页面（`dataforge_lookup`），不允许写死常量
- **凭证零入库明文**：卡文件/链文件/留痕不含凭证值；敏感键一律脱敏
- **写操作三道闸**：写类接口必须经过 计划 → 用户确认 → 执行，不允许静默发写请求

## 报告问题

提交 issue 时请附上：DSH 版本、插件版本、最小复现步骤、`dataRoot` 留痕目录里相关的 `run.json`（脱敏后）。

## 许可证

贡献的代码以 MIT 许可证发布，见 [LICENSE](LICENSE)。
