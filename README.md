# dsh-dataforge

DSH 数据智造插件：把**声明式流程包（Flow Pack）**变成 agent 可调用的工具面。
DataForge Loop（供应链造数引擎）是第一个内置流程包，但插件本体与领域无关——任何符合下列契约的 Python 引擎 + YAML 流程包都能挂进来。

## 形态速览

```
对话 agent
  └─ dataforge_flows   列出可运行流程（含必填参数清单）
  └─ dataforge_run     三道闸 → 后台 job（或前台降级）→ 引擎桥
  └─ dataforge_status  按留痕查进度 / 业务单号链
        │
        ▼  spawn python dsh_bridge.py <flow.yaml> [--dry-run] --key value ...
        │
   stdout = NDJSON 事件流（meta/step/terminal/result）
   stderr = 引擎人类可读日志（收局诊断取尾部 4000 字符）
   exit 0 = SUCCESS terminal
```

分层职责（与 DSH 家族插件同款约定）：

| 层 | 文件 | 职责 |
|---|---|---|
| 工具壳 | `src/tools.ts` | 参数声明 / 规范值 / `render` 回执；判定不下沉 |
| 应用编排 | `src/application.ts` | 三道闸判据、后台 job 装配、`foldSummary` 投影 |
| 包发现 | `src/flows/discover.ts` | 三层流程包合并（后写赢）、yaml `inputs` 解析 |
| 引擎桥 | `src/engine/bridge.ts` | 预检、argv 构造、NDJSON 逐行解析（半行缓冲）、kill |
| 运行留痕 | `src/runs/store.ts` | `dataRoot/runs/<runId>/`：`run.json` + `events.ndjson` |

## 三道闸（调用纪律，写进 dataforge_run 工具描述）

1. **必填校验**：流程 yaml `inputs.*.required: true` 的字段缺一即拒绝启动（`gate=missing-fields`），回执给中文标签清单。
2. **用户确认**：无 `confirm=true` 只返回参数确认卡（`gate=confirm-required`），不启动任何进程。
3. **业务映射**：口语 → 编码（如「生态链」→ `stockOrg/purchaseOrg`），规则由流程包 `policy.md` 承载；插件在装配期把 `policy.md` 注入常驻策略段（`config.injectPolicy` 可关）。

## 配置（cordis.yml）

```yaml
- id: dataforge
  name: dsh-dataforge
  config:
    engineRoot: /Volumes/ORICO/doc/github/dsh/ai-dataforge-loop
    pythonBin: python3
    dataRoot: ~/.dsh/storages/dsh-dataforge
    timeoutSeconds: 600
    injectPolicy: true
```

| 字段 | 说明 | 缺省 |
|---|---|---|
| `engineRoot` | 引擎流程包 checkout 绝对路径（含 `dsh_bridge.py` 与 `configs/`）| 必填 |
| `pythonBin` | 引擎运行时 | `python3` |
| `dataRoot` | 插件数据根：留痕 + 全局三方包（`<dataRoot>/flows/`）| `~/.dsh/storages/dsh-dataforge` |
| `timeoutSeconds` | 桥进程硬超时，超时即杀 | `600` |
| `injectPolicy` | 是否注入 `policy.md` 常驻策略段 | `true` |

## 流程包发现（后写赢）

1. `engineRoot/configs/` —— 引擎内置默认包
2. `<dataRoot>/flows/` —— 部署者三方包
3. `<工作区>/.dsh/dataforge/flows/` —— 项目自带，**权威覆盖**

每次调用现扫盘（mtime 热重载），改 yaml 即生效，无需重启宿主；坏 yaml 跳过不炸。

## 引擎桥契约（dsh_bridge.py）

- `stdout` 纯 NDJSON：`meta`（flow/steps/dryRun）、`step`（id/action/status/elapsed）、`terminal`（name/success/message）、`result`（success/businessData）
- `stderr` 人类可读日志，允许引擎随意打
- `exit 0` = 命中 SUCCESS terminal；argv 风格 `--key value`，materials 等单键归并在桥内完成
- **凭证零经手**：bridge 进程继承宿主 env，引擎在自己的 checkout 里加载 `.env`；DB URI/BPM 地址等真实值也留在引擎 config 里
- `--dry-run` 静态走查全流程，必装验证第一闸

## 运行留痕（状态查询只认盘）

`<dataRoot>/runs/<runId>/run.json` 元数据 + `events.ndjson` 事件副本（每次事件即写即落盘）。
`dataforge_status` 无 runId 时列最近 10 条；有 runId 时折叠为摘要（status/stepsDone/lastStepId/lastError/businessData/message）。
长跑（真实造数 2-8 分钟）必须走宿主后台 job：`dataforge_run` 经 `ctx.jobs.start()` 注册（NDJSON 逐行 append 推流、cancel = SIGTERM→2s SIGKILL）；jobs 服务缺席时如实标注 `degradedNotice` 前台执行。

## 验证

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest：24 个用例，含真引擎 dry-run 集成（python3 + engineRoot 存在时自动启用）
pnpm build       # tsdown → dist/
```

直接 CLI 冒烟：

```bash
python3 dsh_bridge.py configs/znb-prpo.yaml --dry-run \
  --stockOrg MI_IOT --purchaseOrg 2120 --supplierCode 108062 \
  --materials '{"1710301000006A": 1}'
# exit 0 + 39 行 NDJSON（meta 18 步 → step 对 → terminal SUCCESS → result）
```
