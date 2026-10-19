# dsh-dataforge

DSH 数据智造插件：把**声明式流程包（Flow Pack）**变成 agent 可调用的工具面。
DataForge Loop（供应链造数引擎）是第一个内置流程包，但插件本体与领域无关——任何符合下列契约的 Python 引擎 + YAML 流程包都能挂进来。

## 形态速览

```
对话 agent
  └─ dataforge_flows   列出可运行流程（含必填参数清单）
  └─ dataforge_run     三道闸 → 后台 job（或前台降级）→ 引擎桥
  └─ dataforge_status  按留痕查进度 / 业务单号链

采集 → 编排（编排是本次新增的一段，见「编排」节）
  └─ dataforge_capture* / dataforge_browser_*   采集期浏览器：页面上的 XHR 成卡（UI 测试另起浏览器，见「UI 测试」节）
  └─ dataforge_trace_get / dataforge_trace_analyze  采集 trace → 顺序/字段流转/覆盖率分析（PRJ-0004 S1/S2）
  └─ dataforge_chain_draft                        trace → interface-chain 草稿（S3；不落盘、不执行，agent 审阅后 upsert）
  └─ dataforge_lookup                             运行时业务映射（接口取值 + 缓存 + 来源，不写死）
  └─ dataforge_dataset_export                     运行留痕 → dataset + evidence/report.html
  └─ dataforge_library_import                   采集卡 → 项目接口库（稳定 cardId、跨 run 归并）
  └─ dataforge_chain_upsert / dataforge_chain_get  接口链：版本快照、绑定即拓扑依赖
  └─ dataforge_chain_bind                         绑定回写：probe 发现的边 → 新版本（不手抄 YAML）
  └─ dataforge_chain_run / dataforge_chain_runs    执行：拓扑调度 + 纯 HTTP 直调 + 运行留痕
  └─ dataforge_chain_probe                        首跑：单节点试探 + 每个值带来源 + 写操作确认闸
  └─ dataforge_chain_crystallize                  结晶：三分类草案 + 用户确认 + 入参槽位写回
  └─ dataforge_chain_diagnose                     复跑诊断：失败节点 / 绑定边 / 上游状态 / 下一步
  └─ dataforge_chain_compare                      复跑对照：两次 run 的入参/出参/节点差异
  └─ dataforge_ui_*                               UI 测试（第三条执行面）：真浏览器录制/回放 + 页面断言
        │
        ▼  编排/执行/复跑一律走「接口卡模板 + 凭证卡」＋纯 HTTP，不再开浏览器；
          UI 回放是另一条执行面（浏览器），与 src/execute/* 依赖图互不相交
```

分层职责（与 DSH 家族插件同款约定）：

| 层 | 文件 | 职责 |
|---|---|---|
| 工具壳 | `src/tools.ts` | 参数声明 / 规范值 / `render` 回执；判定不下沉 |
| 应用编排 | `src/application.ts` | 三道闸判据、后台 job 装配、`foldSummary` 投影 |
| 包发现 | `src/flows/discover.ts` | 三层流程包合并（后写赢）、yaml `inputs` 解析 |
| 引擎桥 | `src/engine/bridge.ts` | 预检、argv 构造、NDJSON 逐行解析（半行缓冲）、kill |
| 运行留痕 | `src/runs/store.ts` | `dataRoot/runs/<runId>/`：`run.json` + `events.ndjson` |
| 接口库 | `src/library/{import,store}.ts` | 采集 SQLite（只读）→ 卡文件；cardId 分配与归并 |
| 接口链 | `src/chains/{schema,validate,store,compile}.ts` | 链 schema / 语义校验 / 版本快照 / page-chain 编译 |
| 执行引擎 | `src/execute/{plan,coverage,request,binding,http,run}.ts` | 计划编译 / 缺参覆盖 / 请求构造 / 绑定求值 / HTTP 出口 / 调度器 |
| 凭证注入 | `src/{execute,capture}/{credentials,token-harvest,throttle}.ts` | cookie/token 匹配与注入 / token 补采 / 运行级缓存 / 换票单飞（R-4 M1/M3） |
| 首跑试探 | `src/{execute,orchestration}/{probe,explore}.ts` | 单节点请求 / 值来源校验 / 缺参与写闸 / `probe-run` 留痕（R-5 M1） |
| 绑定回写 | `src/orchestration/bind.ts` | probe outputs → 绑定边合并（to 相同替换）→ `saveChain` 新版本（R-5 M2） |
| 结晶复跑 | `src/{execute,orchestration}/crystal.ts` | 三分类草案 / 铁律 / 确认闸 / `saveChain` 槽位写回 / `crystal-run` 审计（R-6 M1） |
| 复跑诊断 | `src/orchestration/diagnose.ts` | 失败节点 / 入边 / 上游状态 / 按错误码给建议（R-6 M2） |
| 复跑对照 | `src/orchestration/compare.ts` | 两次 `chain-run` 的入参 / 节点出参 / 状态差异投影（R-6 M2） |
| 编排应用层 | `src/orchestration/application.ts` | 链读写、执行闸门与 IF-1/2 的错误码折叠与回执值 |
| UI 脚本契约 | `src/uitest/{schema,store}.ts` | ui-script YAML / 版本快照 / 入参槽位 / 选择器候选 |
| UI 录制 | `src/uitest/{recorder,sessions}.ts` | DOM 事件→步骤 / 密码脱敏 / 可见 Chrome 会话 |
| UI 回放 | `src/uitest/{run,run-store}.ts` | 候选解析 / 动作执行 / 页面断言 / 截图 / `dataRoot/ui-runs` 留痕 |
| UI 应用层 | `src/uitest/application.ts` | UI 三道闸、cookie jar、录制保存；工具与面板共用 |
| 浏览器引擎 | `src/uitest/engines*.ts`、`src/uitest/engines/` | `UiBrowserEngine` 契约 + `playwright` / `shared` 两实现（`cdp` 预留）；`RecorderCore` 语义共用 |

## 可选依赖：共享真实浏览器（dsh-builtin-browser）

UI 测试的默认引擎是 `auto`：**装了** [`dsh-builtin-browser`](https://github.com/wqty123/dsh-browser)（npm `dsh-builtin-browser@0.4.13`，MIT）就用它的 `ctx.browser` seam（人机同页/可接管）；**没装**就自动退回插件自己拉起的系统 Chrome（`playwright` 引擎），功能不受影响——这也是为什么它是 **optional peer dependency**（`>=0.4.13 <0.5.0`）。
DSH 的 bundle 选择是 profile 级、不随 npm 依赖传递，所以想用共享浏览器时请**两个 bundle 一起装**：

```bash
# Desktop（推荐；侧栏浏览器需要额外装 bridge，见下文）
dsh plugin --profile desktop add dsh-dataforge dsh-builtin-browser@0.4.13

# Web（不需要 bridge，浏览器是插件自托管的独立窗口）
dsh plugin --profile web add dsh-dataforge dsh-builtin-browser@0.4.13
```

- 安装后**完整重启** DSH；桌面端若要让浏览器落在官方侧栏（而不是独立窗口），还需在 `dsh-builtin-browser` 包目录执行一次 `node desktop-bridge/install.mjs`（会改已安装桌面端 `main.js`，首次备份、可 `--revert`，**DSH 升级后要重跑**）；
- 不装 bridge 或桌面端版本不支持时，它会自动退回自托管窗口，功能不中断；
- 该插件的权限边界（agent 可读侧栏页面与 Cookie、34 个 `dsh_browser_*` 工具）见其 README，装之前请确认接受；
- 想显式选择引擎：`uiTestBrowser: auto|playwright|shared|cdp`（见「浏览器引擎」）；`shared` 下 `upload` 步骤不支持，需要上传的脚本切回 `playwright`。

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
    chainRunEnabled: true          # 执行开关：关掉只拒跑，链读写与历史回看照常
    chainNodeTimeoutSeconds: 30
    chainConcurrency: 4            # 硬上限 16
    chainResponseLimitBytes: 2097152
    chainCredentialPersistence: true  # 换票 cookie 落 dataRoot/credentials（0600）
    uiTestEnabled: true            # UI 回放开关：关掉只拒跑，录制/脚本读写照常
    uiStepTimeoutSeconds: 15       # UI 单步动作/断言超时（秒）
    uiTestBrowser: auto            # auto | playwright | shared | cdp（见「浏览器引擎」）
```

| 字段 | 说明 | 缺省 |
|---|---|---|
| `engineRoot` | 引擎流程包 checkout 绝对路径（含 `dsh_bridge.py` 与 `configs/`）| 必填 |
| `pythonBin` | 引擎运行时 | `python3` |
| `dataRoot` | 插件数据根：留痕 + 全局三方包（`<dataRoot>/flows/`）| `~/.dsh/storages/dsh-dataforge` |
| `timeoutSeconds` | 桥进程硬超时，超时即杀 | `600` |
| `injectPolicy` | 是否注入 `policy.md` 常驻策略段 | `true` |
| `chainRunEnabled` | 链执行开关；关闭后 `dataforge_chain_run` 一律 `execution-disabled` | `true` |
| `chainNodeTimeoutSeconds` | 执行：单节点请求超时（秒）；节点 `timeoutSeconds` 优先 | `30` |
| `chainConcurrency` | 执行：默认并发（就绪节点同时发出数），硬上限 16 | `4` |
| `chainResponseLimitBytes` | 执行：单响应正文读取上限（字节），超过标 `truncated` | `2097152` |
| `chainCredentialPersistence` | 换票结果持久化到 `dataRoot/credentials/cookies.json`（0600、按 origin）；关闭后只活一次运行 | `true` |
| `uiTestEnabled` | UI 回放开关；关闭后 `dataforge_ui_run` 一律 `ui-test-disabled`（录制/脚本读写/历史回看照常） | `true` |
| `uiStepTimeoutSeconds` | UI 回放：单步动作 + 断言超时（秒）；到点该步失败并留截图 | `15` |
| `uiTestBrowser` | UI 测试浏览器引擎：`auto`（有共享浏览器就用 shared，否则 playwright）/ `playwright` / `shared` / `cdp`（预留，未实现时回退 playwright） | `auto` |

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

## 采集（接口逆向）与侧栏面板

采集域把「页面上的 XHR/fetch」沉淀成**接口卡 + 页面×接口×形态关系行**，两个入口同一套落库投影：

| 入口 | 用途 | 说明 |
|---|---|---|
| `dataforge_capture(task_type=action)` + `dataforge_browser_*` | agent 驱动真实交互（搜索/翻页/提交） | 写操作先经用户确认；会话期间遇到的 XHR 全部成卡；`headless:false` 可开可见 Chrome 供用户手动登录 |
| `dataforge_capture(task_type=single_page)` | 单页静止期采集 | 走后台 job；jobs 不可用时**前台降级**执行（回执带 `degradedNotice`） |
| 侧栏「数据采集」面板 | 单入口五标签：快速采集 / 接口库 / 采集网站 / 编排 / UI 测试（原「采集运行」页已移除，运行进度在快速采集页内联展示、历史在采集网站页聚合） | 快速采集只发起 single_page（FR-7.6），2 秒轮询进度，收口后按「页面 → 接口 → 形态」出文档 |

**手动登录（可见 Chrome）**：需要用户亲自登录（验证码/扫码/双因素）时，用可见模式开会话：

```text
dataforge_capture(task_type=action, entry_url="https://目标站/", confirm=true, headless=false)
```

- 浏览器窗口会出现在用户桌面；用户在窗口里完成登录；
- 会话仍绑定 captureId：期间触发的 XHR 会成卡，收口时 cookie 入 `credential_events`；
- 登录完成后用 `dataforge_browser_snapshot` 看当前页，或直接 `dataforge_browser_close` 收口；
- 不传 `headless` = 无头采集（agent 驱动）；可见模式只用于人工登录，不要用它做无人值守采集；
- **复用登录态**：已有登录 captureId 时传 `reuse_cookies_from=<captureId>`，新会话会从本地 `credential_events` 读回 cookie 注入浏览器上下文，不用重新登录。

**落库模型**（`<dataRoot>/capture/capture.sqlite`）：

- `interface_cards`：接口卡，身份 `(capture_id, merge_key)`——跨 run 同接口各留各的卡，同 run 内归并；
- `page_card_relations`：`(card_id, page_url, params_fingerprint)` 幂等，同接口不同入参形态各一行，样本回指 `request_samples.relation_id`；
- **页面身份口径**（「同一个页面」怎么判，`src/shared/page-url.ts`）：`pages.url` 与关系行 `page_url` 存**页面身份** = 协议 + host + 端口 + 路径 + hash 路由段；query（外层与 `#` 内）一律不参与——SPA 同路由的 `#/index?category=all`、`?_at_=…` 变体因此是一页。卡上的页面引用与 `request_samples.page_url` 保留真实访问过的原始 URL（面板展示/打开/重采与逐请求证据；无样本的静态页只剩页面身份）。历史库存的字面 URL 在面板与工具出口按同一口径归并展示（不改历史行）；面板站点页的 SPA 外壳入口（entryUrl 无 hash、同 run 采集页是它的 hash 路由页）不单独成页（`pages` 表/工具回执仍按访问记录列出）；
- 入参指纹吃 **query + JSON 体 + 表单体**，数组保序、易变键（`_t`/`ts`/`sid`/token…）剔除——物料清单不同即不同形态；
- 鉴权标志只记来源名（`header:authorization` / `header:cookie:JSESSIONID`），**凭证值永不入卡、永不出路由**；
- 老库自动迁移：`merge_key` 全库唯一 → `(capture_id, merge_key)`；补 `notice` / `relation_id` 列；历史卡按 `related_pages_json` 补 `legacy` 关系行。

**三级名称（网站 / 页面 / 接口）**：

- `pages.title` / `pages.site_name`：采集时从浏览器读 `document.title` 与 `og:site_name` / `application-name`（旧库缺列由启动迁移补齐、历史行留空）；
- 旧数据补抓：面板「补抓名称」调 `POST /retitle`，用 `credential_events` 里的 cookie 无头重访缺标题页面；**最终页面身份必须等于目标身份才回写**（登录墙重定向只记 failed），正在采集的 host 本轮跳过；
- 手工改名：`<dataRoot>/capture/names.yaml` 三级覆盖（site = 小写 host、page = 页面身份、interface = `merge_key`，跨重采稳定），`GET/POST /names` 读写；展示优先级 **手工名 > 编排名 > 自动名 > host/URL**——编排里已有的站点名（链 `meta.site`，经 overview 的 `site × hosts` 映射）在采集网站/接口库同样生效，网站自动名（标题推断）在面板带「自动取名」标；
- 接口自动名：`semanticName` v2（路径去噪段 + 末两段 humanize、不带方法前缀）；`/cards` 与 `/runs/:id` 的卡片投影统一给 `mergeKey` / `name` / `nameSource`（`auto`|`manual`），客户端不自行拼名字；
- 名称数据面路由：`GET /page-meta`（页面身份 → 标题/站点名投影）、`GET /names`、`POST /names`、`POST /retitle`、`GET /retitle/status`。

**面板写入口纪律**：只收 `http/https`，拒本机回环与链路本地/云元数据地址；同 host 已有进行中采集 → `409 host-busy`；body 上限 8 KB（`413`）；响应一律剥除凭据原文与 `sessionId`；写入口仅 `POST /captures`、`/names`、`/retitle`，其余方法 405。

## Trace 读取与自动编排分析（PRJ-0004 S1/S2）

采集库里的 `request_samples` 已经是按 `seq` 排序的真实操作 trace。新增两个只读工具：

| 工具 | 作用 | 纪律 |
|---|---|---|
| `dataforge_trace_get` | 读一条 capture 的有序请求/响应样本 | 敏感头只返回名字；正文区分 file/preview/缺失并标截断；默认 limit=200 / body_limit=8192 |
| `dataforge_trace_analyze` | 通用分析：序列合并/polling、写操作、字段流转绑定、输入/输出、断言候选、覆盖率与 warning | 只用 HTTP 方法/序号/JSON 值匹配/JSONPath；无业务名称/URL/字段硬编码 |
| `dataforge_chain_draft` | 按 `mergeKey` 匹配接口库卡，生成 `interface-chain` 草稿（节点/边/`$inputs`/expect）并跑现有链校验 | 不落正式版本、不执行；缺卡/缺必填入参/模板缺字段全部 warning；业务值不写进 YAML |
| `dataforge_lookup` | 运行时从接口/页面查组织/供应商/物料等映射，带缓存/TTL/source | api 只读（GET/HEAD）；page 走 Playwright 只读选择器，不注入登录态；凭证用 `${ENV}` |
| `dataforge_dataset_export` | 把链/UI run 留痕导出 `datasets/<runId>.json` + `evidence/<runId>/report.html` | 不重新执行；UI 运行会复制 success/failure 截图；不含请求头/凭证原文 |

- 连续同接口同请求体的调用合并为一个节点（标 `polling`）；写操作请求体不同不合并；
- 字段流转给 `from.{nodeId,path}` → `to.{nodeId,path}` + confidence；低置信度进 warning；
- 动态值（UUID/长 hex/时间戳）不进 input，标 `unresolved-dynamic`；截断/非 JSON 正文也进 warning；
- 真实 capture fixture 在 `test/fixtures/trace/`（公开页面、脱敏）；合成 fixture 用来测 precision/recall；
- 需求与后续 S3 草稿生成见 [PRJ-0004 需求](docs/projects/PRJ-0004/requirement/auto-dataforge-loop.md)。

## 编排（接口库 → 接口链）

采集解决「接口长什么样」，编排解决「按什么顺序调、字段怎么传」。载体是**工作区文件**，不是表——它们要进 git、要手改、要导入导出：

| 落点 | 内容 |
|---|---|
| `<workspace>/.dsh/dataforge/library/cards/<cardId>.yaml` | 一张接口卡一个文件；`index.yaml` 是 cardId → 文件/归并键/站点的指针 |
| `<workspace>/.dsh/dataforge/chains/<site>/<flow>/v<n>.yaml` | 一个版本一个文件，**版本即不可变快照**，目录即历史 |

### 编排工具（六个）

| 工具 | 干什么 | 失败门 |
|---|---|---|
| `dataforge_library_import` | 采集卡 → 项目接口库；同 `mergeKey` 跨 run 归并，分配稳定 cardId | `no-capture-data`（采集库没卡）；坏卡跳过不炸批 |
| `dataforge_chain_upsert` | 唯一链写入口：schema + 语义校验全过才落盘为新版本 | `invalid-chain`（逐条指到 `nodes[i]`/`edges[j]`）、`card-not-imported` |
| `dataforge_chain_get` | 回读链（缺省最新版本）；`export=true` 原文导出 | `chain-not-found`、`invalid-chain`（手改坏，可回读旧版本） |
| `dataforge_chain_bind` | 绑定回写：只给边，`to` 相同替换、其余新增，自增版本 | `chain-not-found`、`invalid-chain`、`card-not-imported`（零落盘） |
| `dataforge_chain_run` | **唯一执行入口**：预检 → 计划卡 → 确认 → 拓扑调度直调 HTTP | `missing-params` / `chain-not-found` / `invalid-chain` / `not-executable` / `cycle` / `base-url-unresolved` / `inputs-invalid` / `confirm-required` / `execution-disabled` / `execution-unavailable`（都不发请求） |
| `dataforge_chain_runs` | 按链列运行留痕（读 `run.json` 的 `chain` 段过滤，状态现折叠） | 空态是 `ok:true` + `notice`；坏 `run.json` 跳过并计数 |

### 执行（R-3：拓扑调度 + 纯 HTTP 直调）

**唯一执行入口是 `dataforge_chain_run`**，且只接受 `interface-chain`：`page-chain` 必须先经 `compilePageChain` 编译成草稿、经 `dataforge_chain_upsert` 落盘。执行段**不开浏览器**，只用 Node 22 内置 `fetch`。

三道闸与实际顺序（前七步一个请求都不发）：

```text
执行开关 → 载链（loadChain 重校验）→ 卡 → 槽位值校验 → baseUrl 候选 → buildPlan()
   ├─ cycle / card-not-imported / missing-params / base-url-unresolved → 直接拒，回执指到节点与字段
   ▼
不带 confirm 且非 dry_run ──► 计划卡（拓扑序 + 方法/URL 骨架 + 写类节点 + 目标 host），不建运行
   ▼ confirm=true（或 dry_run=true）
dry_run ──► 同一份计划，永不发请求，但落一条 dryRun:true 留痕
   ▼
就绪队列调度（indegree 由 dependencyPairs 统计；就绪节点按 id 字典序；并发 ≤ chainConcurrency）
   ↓ 每节点：绑定求值 → buildRequest → httpRequest → 解析 → 出参探测
runs/<runId>/{run.json,events.ndjson}（meta → step×N → terminal → result）
```

**缺参判据（硬规则）**：`covered(node) = 常量键 ∪ 以该节点为终点的绑定边字段`，`missing = 卡入参.filter(角色≠credential 且 未被 covered)`。**卡的 `required` 不参与判据**——单样本卡几乎全是 `required: false`，拿它判会把必须给值的入参全部放行、进而静默发空值。静态缺参一次判完，整链不执行。

**错误码是契约**（只增不改名）：预检 `missing-params` / `chain-not-found` / `invalid-chain` / `not-executable` / `cycle` / `base-url-unresolved` / `inputs-invalid` / `confirm-required` / `execution-disabled` / `execution-unavailable`；运行期 `binding-path-not-found` / `binding-type-mismatch` / `binding-null` / `empty-wildcard` / `param-missing` / `param-type-mismatch` / `bad-url-template` / `node-timeout` / `node-network-error` / `node-http-error` / `node-auth-required` / `response-too-large` / `cancelled`；换票 `relogin-unavailable` / `relogin-failed` / `relogin-cycle`。

**真实站点适配（R-5）**：

- **正文编码**：按 `content-type` 自动选择 JSON / `application/x-www-form-urlencoded` / `multipart/form-data`；
- **文件上传**：节点可写 `files: { "body.file": "<本地路径或 $inputs.filePath>" }`，执行期读取文件、按扩展名猜 content-type，拼 multipart 正文；文件不存在在发请求前拒（`file-not-found`）；
- **跨域节点**：节点可写 `baseUrl`（如 `https://c5.pcs.baidu.com`），缺省才用链级源；
- **文件派生值**：节点可写 `hashes: { "body.block_list": "md5-array:$inputs.filePath" }`，运行期算 md5/sha1，支持 `md5` / `md5-array` / `sha1`；
- **业务码校验**：节点可写 `expect: { path: body.errno, equals: 0 }`；HTTP 200 但业务码不符 → `node-business-error`，不再假绿；
- **绑定值转换**：边可写 `transform: string | json | array-json`。`array-json` 把标量包成数组再 JSON 序列化（如网盘 `fs_id` → `fid_list` 需要的 `"[123]"`），不做隐式转换；
- **数组选择**：边可写 `pick: { match: { field, equals }, field? }`，从数组出参里按字段值选元素再取字段（替代脆弱的 `list[3]` 下标）；
- **鉴权误判修正**：采集期页面脚本拿不到 `cookie` 头时，卡可能被标成 `auth: none`；可在卡文件里把它改成 `cookie-session`，执行期就会按来源 captureId 注入本地 cookie。

**安全面**：`credentials: 'omit'`（不继承 cookie jar）、头名命中脱敏集合即打码、请求/响应正文摘要各留 4 KiB、响应读取上限 `chainResponseLimitBytes`、只允许 http(s)、`chainRunEnabled` 全局开关。**卡与链零凭证**；cookie/token 注入与 401 换票见下节（R-4 M1/M3）。

**不幂等**：同一参数重复调用就是新 run、新请求；写类节点不做自动整链重试（节点级 `retry` 只对 GET/HEAD/OPTIONS 生效）。取消后重跑必须重新确认。

**长跑**：`jobs` 在场则以 `kind: 'dataforge-chain'` 起后台 job（`job_output` 看进度、`job_kill` 取消，终态 `killed`）；`jobs` 不在场则前台降级并在回执标 `degradedNotice`。

### 凭证注入与自动换票（R-4 M1/M2/M3）

设计：[docs/projects/PRJ-0002/design/r4-credential-injection.md](docs/projects/PRJ-0002/design/r4-credential-injection.md)（M1 注入、M2 换票、M3 持久化 + token 补采与注入 + 运行级缓存 + 跨运行单飞已实现；body/localStorage token 只记录不注入）。

- **来源**：只读 `dataRoot/capture/capture.sqlite` 的 `credential_events`，**只按卡的 `sources[].captureId`** 查，不做全库兜底（A 站 cookie 不会发给 B 站）；
- **匹配**：cookie 走 domain / path / secure / expires 四道门，同名同路径去重（更具体的域优先），排序可复现；token 按卡的 `auth` 与 `authEvidence` 名字匹配（缺省 authorization）；
- **注入点**：`buildRequest()` 之后、`httpRequest()` 之前；`cookie` 头与卡上已有值拼接，其它同名头以注入值为准；token-param 以 URL 序列化拼 query（同名参数覆盖，正确编码）；
- **零留痕**：请求摘要里 `cookie` 恒为 `***`；token-param 的 query 参数名保留、值打码；响应正文摘要与 emitted 值会按已知凭证值再做一次脱敏（防服务端回显）；事件里只留 `credentials: { status, header, names, domains, captureIds, expired }`，**没有值**；
- **401 诊断**：区分「注入了 N 个 cookie / 注入了 authorization 头 / 注入了 query token 但仍 401」与「没有注入可用凭证（原因，含 token 未采集）」；传了 `relogin` 时自动进入换票；
- **回滚**：provider 缺席 = 回到 R-3 无凭证行为（`src/index.ts` 不装配即可）；不传 `relogin` = 回到 M1 行为，无需迁移。

**token 补采与注入（M3）**：

- 采集收口（`dataforge_capture` 自主任务与 `dataforge_browser_close`）会扫本 captureId 的请求样本：`authorization` / `proxy-authorization` 头原样落 `credential_events(kind='token')`；URL query 的 token 类参数（`access_token`/`*_token` 等）一并落库；JSON body token 只检测落库；
- 注入：`token-header` 卡注入 Authorization（保留 `Bearer`/`Basic` 原文，不猜 scheme）；`token-param` 卡把 token 拼进 URL query；**body token 与 localStorage token 本期只记录、不注入**（回执如实 `unsupported`，不伪造）；
- 采集库只读、凭证值只进出站请求与 DB `value_json`；事件里的 token query 值已打码；
- **运行级缓存**：`createCaptureCredentialProvider({ cache: true })`（`src/index.ts` 已开）按 db 主文件 + `-wal` 边车 + 持久化 jar 的 `mtimeMs:size` 缓存行；采集库变化自动失效，文件被删沿用缓存（同一运行不丢凭证）；
- 边界：只做进程内缓存与单飞，不做跨进程锁。

**自动换票（M2）**：给 `dataforge_chain_run` 传一条普通接口链作为登录链：

```json
{
  "site": "业务站点", "flow": "取数", "confirm": true,
  "relogin": {
    "site": "认证站点", "flow": "登录",
    "inputs": { "user": "alice", "pass": "***" }
  }
}
```

- 401 → 执行登录链（同一套 `loadChain`/`buildPlan`/`executeChainRun`）→ 收割 `set-cookie` → **单飞**换票 → 用新 cookie 重放当前节点**一次**；
- 登录链以**敏感模式**执行：`run.json.params` 的值写 `***`、请求/响应正文摘要 `[已脱敏]`、`emitted`/绑定预览不落值；账号密码只从 `relogin.inputs` 进内存，**不写链、不写运行记录**；
- 安全边界：登录链与主链必须**同源**（拒绝跨站复用凭证）；`relogin.site/flow` = 主链自身 → `relogin-cycle`；
- 失败语义：登录链不存在/不可用 → `relogin-unavailable`；登录链失败或没有下发 `set-cookie` → `relogin-failed`，回执固定带「需人工重新登录并更新凭证」；换票后重放仍 401 → 中止，不二次换票；
- 并发：同一运行内两个节点同时 401，只执行一次登录链，其它节点等结果（M2）；**跨运行/跨会话也会按「主链 origin + 登录链 site/flow」单飞**（M3），同一登录接口不会被并发打爆；
- 边界：登录链只收割 `set-cookie`；token 型站点 401 时换票能力取决于登录接口是否下发可注入的凭证（本期未扩展）。

**换票持久化（M3）**：

- 换票成功后把 `set-cookie` 写入 `<dataRoot>/credentials/cookies.json`：目录 0700、文件 0600、**按 origin 隔离**、原子写；
- 下一次运行由 provider 按目标 origin 读回，同名覆盖采集期的旧 cookie；采集库缺席时也能靠持久化 jar 兜底；
- 关闭方式：`chainCredentialPersistence: false`（换票只活一次运行）；
- **零泄漏扫描门**：换票端到端用例会扫描 `dataRoot` 下除持久化 jar 外的所有文件 + 工具回执，断言密码/token/新 cookie 原文零命中。

### 探索执行（R-5 M1：单节点 probe）

首跑时链往往还不完整：缺参数、缺绑定。`dataforge_chain_probe` 把执行单位缩到**一个节点**，避免为了试一个值整链重跑（尤其是写节点）：

```json
{
  "site": "智慧供应链 SCM", "flow": "采购下单",
  "node": "query-material",
  "values": {
    "query.q": { "value": "螺丝", "source": "user", "evidence": "用户原话：先用螺丝试" }
  }
}
```

（`query.orgId` 这类固定值放在节点 `constants` 里，probe 会自动标 `constant`。）
```

**值来源词表**（每个入参必须能说出出处）：

| source | 含义 | 约束 |
|---|---|---|
| `user` | 用户明确给出的值 | evidence 建议写原话；工具无法替代真人确认 |
| `agent-inferred` | agent 推断的值 | **必须带 evidence**（推断依据），否则 `invalid-source` |
| `upstream` | 来自某次 probe 的响应 | **必须带 evidence**（如 `probe:<runId> · body.items[0].internalId`） |
| `constant` | 节点 `constants` 里的值 | 自动标注，不要放进 `values` |

**四道门**：

1. **缺参**：发请求前返回 `gate=paused` + `gaps` + 卡入参模板，一个请求都不发；仍落一条 `probe-run` 留痕；
2. **写操作**（POST/PUT/PATCH/DELETE）：没有 `confirm=true` 只返回计划卡，**零请求、零 run**；
3. **来源校验**：未知字段 → `unknown-value`；`agent-inferred`/`upstream` 缺 evidence → `invalid-source`；
4. **敏感值**：路径命中 `password/token/secret/authorization/cookie/api-key…` 时，值在 `run.json`、事件、回执里一律 `***`。

**成功时返回**：请求/响应摘要、耗时、尝试次数、卡出参的实际值（`outputs`，用来发现绑定边）、逐值来源（`provenance`）。下一步：

```text
probe 试探 → 读 outputs 发现绑定 → dataforge_chain_bind 回写边（只给边，R-1 校验）→ dataforge_chain_run 整链
```

**留痕**：每次 probe 一条 `runs/<runId>/`，`run.json` 的 `kind: probe-run` + `probe.explorationId`，同一次首跑的多发 probe 用同一个 explorationId 串起来。`dataforge_status` 可直接读。

**诚实边界**：probe 不消费绑定边、不缓存上游响应、不自动猜值、不自动推断绑定；probe 也不换票（401 会提示走 `dataforge_chain_run` 的 `relogin`）。

### 绑定回写（R-5 M2：dataforge_chain_bind）

首跑 probe 拿到 `outputs` 后，不需要手抄整份链 YAML——只给「边」：

```json
{
  "site": "智慧供应链 SCM", "flow": "采购下单",
  "edges": [
    { "from": "query-material.body.items[0].internalId", "to": "create-order.body.lines[0].materialId" },
    { "from": "query-material.body.items[0].fs_id", "to": "create-order.body.fid_list", "transform": "array-json" }
  ]
}
```

- **合并语义**：`to` 相同 = 重写这条绑定（替换，不叠加两条指向同一入参的边）；`from/to/transform/pick` 全同 = 未变化；其余新增；同一次调用 `to` 重复以后者为准；
- **写链纪律不打折**：仍只经 `saveChain`——卡引用、两端字段存在性、成环、绑定与常量互斥、僵尸槽位全部校验，失败**零落盘**并逐条给 issues（指向 `edges[i]`）；版本只增不删，旧版本可回读；
- **内容无变化也落新版本**：`saveChain` 无内容去重，回执用 `added/replaced/unchanged` 说明原因；失败码复用 `chain-not-found` / `invalid-chain` / `card-not-imported`。

### 结晶与复跑（R-6 M1/M2）

首跑 probe 留下的「值 + 来源」在这里变成链资产：

```text
dataforge_chain_crystallize(explorationId)      ← 不带 confirm：只出草案
  → 用户确认
dataforge_chain_crystallize(explorationId, confirm:true[, decisions])
  → 新链版本：inputs 槽位 + $inputs.<name> 常量
dataforge_chain_run(inputs:{...}, confirm:true)  ← 换入参复跑
```

**三分类铁律**：

| 来源 | 结晶为 | 复跑时 |
|---|---|---|
| `user` | 链级 `inputs` 槽位（`example` 存本次值） | 替换成新入参 |
| `constant` | 节点 `constants` | 原样使用 |
| `upstream` | **链生成值**：只校验已有绑定边，**绝不冻结** | 沿绑定边重新求解 |
| `agent-inferred` | 入参候选，但必须在 `decisions` 里 `confirmed:true` | 同 user |

- **确认闸**：没有 `confirm=true` 绝不写链；写回只走 `saveChain`（R-1 校验 + 新版本）；
- **铁律强制**：任何把 upstream 当 constant/input 的决策 → `crystal-iron-rule`，整次写回拒绝；
- **冲突**：同一 `nodeId:path` 多条 probe 值/来源不一致 → `crystal-conflict`，必须用 decisions 明确选一个；
- **敏感值**：probe 标了 `redacted`/`***` 的行不参与结晶；
- **审计**：每次写回落一条 `crystal-run`（explorationId、decisions、写入版本）。

**复跑与诊断**：结晶后的链是普通 `interface-chain`，直接 `dataforge_chain_run(inputs:{q:'C', quantity:2}, confirm:true)`；链生成值由上游响应重新求解，不读首跑缓存。失败时 R-3 回执给 `failedNode` + `binding-*` 错误，错误消息带 `from → to`，可定位到求解断点。

**M1 边界**：只做手动复跑；不自动合并旧槽位（以一次 exploration 重新出草案）；不做定时/批量；不做自动修复。

**复跑诊断（R-6 M2）**：失败后先读断点，不要盲目重跑：

```text
dataforge_chain_diagnose(runId)
  → 失败节点 / 错误码 / 错误原文
  → 节点级状态（done/error）
  → 失败节点的入边（from → to、上游状态、是否可疑）
  → 建议（绑定断点 / 鉴权 / 换票 / HTTP）
```

只读，不重跑、不改链。真实站点联调步骤见 [docs/projects/PRJ-0002/plan/real-site-acceptance.md](docs/projects/PRJ-0002/plan/real-site-acceptance.md)。

**复跑对照（R-6 M2）**：诊断回答「断在哪」，对照回答「换入参复跑后什么变了」：

```text
dataforge_chain_compare(run_ids: [首跑 runId, 复跑 runId])
  → runs：两侧链版本 / params / 状态 / failedNode
  → inputs：链级入参逐槽位差异（谁从 A 换成了 C）
  → emitted：各节点出参差异（链生成值是否重新求解、不是首跑缓存）
  → nodes：节点状态 / HTTP / 耗时对照
  → summary + hints：版本不同、入参变化、失败节点变化等提示
```

只读，不重跑、不发请求；敏感键（password/token/authorization/cookie 等）一律 `***`，不投影 header。失败码：`invalid-run-ids` / `run-not-found` / `not-chain-run`。

### 编排页签（面板内可视化编辑）

面板第 4 个页签「编排」是链文件的图形前端（原型 `docs/prototypes/orchestration.html`）：

```text
网站选择 → 流程列表（页面编排 / 接口编排 × 业务域 → 流程 → 版本，带检索与分页）
        → 编排图列表（每版本一张，分页）→ 画布（@xyflow/react v12）
```

数据面（与采集共用 `/dashboard/api/dataforge` 前缀）：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/orchestration/overview` | 网站 + 流程 + 逐版本摘要（来源/更新时间/节点边数/是否被取代） |
| GET | `/orchestration/palette` | 左栏拖拽源：库里的卡（cardId/方法/地址）+ 采集到的页面 |
| GET | `/orchestration/graph?site&flow&version` | 单版本**可编辑 doc** + 卡投影 + YAML 原文 |
| POST | `/orchestration/graph` | 画布保存 / YAML 导入（`source` 区分），仍只经 `saveChain` |
| POST | `/orchestration/rename` | 业务域 / 流程改名：只同步目录名与各版本 `meta.domain` / `meta.flow`，节点/边/版本号不变 |

编排页的**业务域 / 流程标题支持 ✎ 内联改名**（Enter 提交、Esc 取消）：流程改名会同步重命名版本目录并改写每个版本的 `meta.flow`；业务域改名同步组内各流程所有版本的 `meta.domain`。这是对「版本文件不可变」的**元数据修正例外**（R-2 M5 已记录该风险），链内容与版本号不变。

三条与原型**有意的偏差**（界面上也写了原因）：

0. 节点可以**从左侧调色板拖进画布**（也可以点一下追加），拖的是「库里的卡」或「采集到的页面」；
1. 画布节点**只显示接口名称**（卡名优先；地址/入参/出参收进点击后的面板）——名称/方法/地址属于接口卡，链里只存 `cardId`，所以面板里只读展示；可编辑的是常量绑定、页面地址、重试/超时、坐标；
2. 「新建流程」不落盘空白链（R-1 要求链至少有 1 个节点），首次「保存为新版本」才落盘；
3. 边的标签由 `from` 的叶子字段名自动生成，编辑边 = 编辑两个绑定路径。

链文件因此多了三个可选字段（老链零迁移）：`meta.domain`（业务域）、`meta.source`（`agent`/`canvas`/`import`）、节点的 `layout: {x,y}`（缺省自动布局）。

升级 `@xyflow/react` 后要重跑样式生成（产物进 git，构建不依赖它）：

```bash
pnpm gen:xyflow-css   # node_modules/@xyflow/react/dist/style.css → src/client/xyflow-css.ts
```

> 为什么样式要生成成字符串：client 半边只分发**一个 .cjs**，CSS 文件没人加载（详见 `tsdown.client.config.mjs` 注释）。

### 卡文件（不含凭证值、不冻结样本值）

```yaml
cardId: card_000001
kind: interface-card
identity:
  mergeKey: GET /api/materials:q       # 采集期归并键原样保留：同键即同卡
  method: GET
  urlTemplate: /api/materials?q={q}
inputs:
  - path: query.q                      # 首段是位置：query/body/header/path
    type: string
    required: true
    role: input
outputs:
  - path: body.items[*].internalId     # 数组用 [*]；绑定边可用具体下标 [0]
    type: string
auth: cookie-session                   # 只投影鉴权**标志**
authEvidence: header:cookie:JSESSIONID # 只投影来源**名**
sources:                               # 溯源可多次累积
  - captureId: cap_20261017_01
    pages: [https://scm.example.com/purchase/new]
    relationIds: [pr_mvc1qewz_e4lk56]
```

- **为什么要有导入这步**：链靠稳定 cardId 引用接口，而不是 `(capture_id, merge_key)`——重新采集不会让旧链断引用；
- **cardId 序号式不复用**：水位持久化在 `index.yaml`，删卡重导拿新号，旧链不会被新卡顶替；
- **索引只是加速器**：`index.yaml` 缺失/损坏按卡文件重建，卡文件才是权威；
- **采集库全程只读**：导入侧用 `readonly` 打开 SQLite，不建表、不写事件。

### 链文件（绑定即拓扑依赖）

```yaml
apiVersion: dataforge/v1
kind: interface-chain        # interface-chain 可执行；page-chain 需编译
meta: { site: 智慧供应链 SCM, flow: 采购下单, version: 3, created: 2026-10-17T12:00:00Z }
inputs:                      # 链级入参槽位（R-6 结晶写入 example 值）
  - { name: materialCodes, type: array<string>, required: true }
nodes:
  - { id: query-material, card: card_000001, constants: { query.orgId: "2120" } }
  - { id: create-order, card: card_000457 }
edges:                       # from 可为「节点.出参」或 $inputs.槽位名
  - { from: query-material.body.items[0].internalId, to: create-order.body.lines[0].materialId }
```

**定义期校验**（不通过一律不落盘，不存在部分写入）：节点 id 链内唯一、边两端节点存在、`to` 在目标卡入参里（或在 `constants` 里已给值——绑定与常量互斥）、`from` 在源卡出参里、无环、槽位 `$inputs.<name>` 被引用（防僵尸槽位）。

**⚠️ 常量里不要写凭证**：`constants` 会进版本文件，落盘时 `scanCredentialConstants` 会告警；凭证注入是执行期的事（R-4）。

## UI 测试（浏览器录制 + 回放）

面向「按键精灵式」页面自动化：录制一遍真实操作，回放时在无头 Chrome 里重现，并用页面断言判定通过/失败。
它是**第三条执行面**——与接口链（纯 HTTP）分开：链断言响应字段，UI 脚本断言页面状态；两条线共享的只有项目资产目录与凭证纪律。

### 工具（九个）

| 工具 | 用途 |
|---|---|
| `dataforge_ui_record_open` | 打开可见 Chrome（不开始录；先登录/导航）；URL 只收 http/https |
| `dataforge_ui_record_start` | 开始录制（注入 click/fill/select/submit/press 监听） |
| `dataforge_ui_record_stop` | 停止录制：回步骤 + 持久化会话 cookie +（给了 site/flow 时）落新版本 |
| `dataforge_ui_record_close` | 关闭录制浏览器 |
| `dataforge_ui_script_get` | 列脚本 / 读某版本（doc + YAML 原文 + 可用版本） |
| `dataforge_ui_script_upsert` | agent 手写/编辑脚本（YAML 进，校验全过才落 vN+1） |
| `dataforge_ui_run` | 回放（三道闸：入参必填 → confirm 计划卡 → headless 执行 + 断言） |
| `dataforge_ui_runs` | 运行列表 / 详情（事件流、失败步骤、证据路径） |
| `dataforge_ui_batch_run` | 批量回归：选脚本（flows / site / 全部）→ 计划 → 串行回放 → 报告（`report.md` + `report.json`） |

### 脚本文件（工作区项目资产）

`.dsh/dataforge/ui-tests/<siteSlug>/<flowSlug>/vN.yaml`

```yaml
apiVersion: dataforge/v1
kind: ui-script
meta:
  site: 百度网盘
  flow: 文件列表探测
  version: 1
  created: 2026-10-17T21:00:00+08:00
  source: record            # record | agent | canvas
  startUrl: https://pan.baidu.com/disk/main
  viewport: { width: 1280, height: 720 }
inputs:                     # 回放时替换 {{name}}
  - { name: keyword, type: string, required: true }
steps:
  - id: s1
    kind: fill              # goto/click/fill/press/select/submit/wait/upload
    selector: '#kw'
    candidates: ['[data-testid="kw"]', '#kw']   # 有序候选：取第一个唯一命中
    value: '{{keyword}}'
  - id: s2
    kind: click
    selector: 'button:has-text("搜索")'
    expect:
      - { kind: visible, selector: '#result' }
      - { kind: text, selector: '#echo', equals: '{{keyword}}' }
      - { kind: url, contains: '/result' }
```

- **断言**（`expect`，步骤后校验，轮询到步骤超时）：`visible` / `hidden` / `text` / `value` / `url` / `count`；
- **selector 容错**：录制器按 testid → id → name → aria-label → 文本 → CSS 路径生成候选，停止录制时用 Playwright 引擎校验唯一性；回放按序取第一个唯一命中，全失效则该步失败；
- **入参槽位**：声明 `inputs` 并用 `{{name}}` 引用（url/value/key/files/断言文本）；引用了没声明、声明了没人用都会被校验拒绝；
- **版本不可变**：写入永远分配 max+1；读时重新校验，坏文件如实报 `invalid-ui-script` + 可用版本。

### 录制 → 回放闭环

```text
dataforge_ui_record_open(start_url, headless=false)   ← 可见 Chrome，用户登录/导航
  → 用户完成登录
dataforge_ui_record_start(session_id)                 ← 从这里开始进脚本
  → 用户在浏览器里操作业务
dataforge_ui_record_stop(session_id, site, flow)      ← 记录步骤 + cookie + 落 vN
dataforge_ui_run(site, flow, inputs)                  ← 不带 confirm：计划卡
  → 用户确认
dataforge_ui_run(..., confirm=true)                   ← headless 回放 + 断言 + 失败截图
```

回放失败即停（fail-fast），**不自动重试**（重试 click/submit 可能重复写入）；先看
`dataforge_ui_runs(run_id)` 的断点/断言/截图，再决定修脚本还是重录。

### 边界与纪律（M1 如实标注）

- **密码输入不录**：`input[type=password]` 直接跳过（凭证不入脚本），回执报跳过次数；回放登录态靠 cookie jar；
- **文件选择不录**：浏览器不暴露用户选中的本地路径，`upload` 步骤请手写（路径可参数化）；
- **录制只录动作**：断言由面板/agent 补（M2 起面板可编辑步骤与断言）；
- **cookie**：录制结束写 `dataRoot/credentials/cookies.json`（0600、按 origin），回放按起点域名注入，回执只有条数；
- **失败证据**：`dataRoot/ui-runs/<runId>/failure.png` + `failure.html`；运行记录与之同目录；
- **不幂等**：回放会真点真提交；写操作确认闸沿用链路执行纪律（计划卡里如实给 click/submit/upload 步数）；
- **仍未做**：坐标级点击（canvas/非 DOM 控件）、多标签页跟随、iframe 切换显式建模、定时调度/CI 集成、截图对比断言、网络断言联动。

### 面板

侧栏「数据采集」→ 第 5 个页签「UI 测试」：左列脚本列表 + 录制表单（打开浏览器 / 开始录制 / 停止并保存 / 关闭浏览器），右列步骤表（含断言）、回放计划与确认、每步/断言结果、失败截图、运行记录。面板不重复实现闸门，全部走与 agent 工具同一套应用层。

**clickPoint 的控件名**：`clickPoint.name` 记录被点击控件的可读名字（aria-label → 可见文本/按钮 value → title/placeholder/alt → name 属性），便于诊断；候选链全失败时也会用这个名字做 `text=` 兜底。

**录制语义特征（跨布局兜底）**：新录的脚本会额外保存目标的 `features`（tag/id/testid/name/aria-label/placeholder/role/文本/title/alt/href/关联 label/canvas 序号）；回放的候选链（testid → id → name → aria → placeholder/title/href/role/text → CSS 路径）全失败时，再用这些特征生成备用定位（含 `text=` / `:has-text`）重试。旧脚本没有 `features` 时行为不变；要获得这层兜底需要**重录**。

**canvas 图表 / 坐标点击（回放重算）**：图表类目标只有 canvas，没有稳定选择器；录制器把真实落点存成**元素内比例** `fx/fy`（视口坐标只作最后兜底）。回放按三级策略：
1. 原元素还在、且 rect 与录制时一致（±1.5px）→ **直接用录制坐标**；
2. 原元素还在但移动/缩放了 → 用当前 rect 重算 `rect.x + fx * rect.width`；
3. 原元素找不到 → 用 `features` 重新找回元素，再按新 rect 重算；都找不到才退回录制视口坐标按比例缩放。
普通元素仍优先语义点击（元素中心由浏览器算），canvas 才走坐标。旧脚本没有 `clickPoint`，需要重录；另外若某步在当前页找不到目标、但录了 `at`（该步所在页面），回放会导航到 `at` 再重试一次（兼容旧脚本/点击未跳转的流程）。

**回放速度（慢放）**：步骤表旁可选「正常 / 0.5s / 1s / 2s 每步」；慢放只影响步骤之间的观察节奏，不改变单步超时预算。Playwright 引擎可勾选「显示浏览器窗口」（慢放建议勾选；共享浏览器本来就在右侧栏可见）。另有「点击动画」开关（缺省开）：每次点击前在落点画脉冲光圈+圆点，`pointer-events:none` 不拦截操作，慢放时能看清点了哪里。**「末尾停留」**（缺省停 2s）让最后一步/动画在关闭浏览器前可见；选「结束即关闭」则不等待。速度/开关会随面板状态持久化；agent 侧用 `dataforge_ui_run(slow_mo_ms=…, highlight_clicks=true/false, headless=false)`。

#### 批量回归与报告（M3）

```text
dataforge_ui_batch_run(site="百度网盘")              ← 不带 confirm：计划卡（选中的脚本/缺参/写操作数）
  → 用户确认
dataforge_ui_batch_run(site="百度网盘", confirm=true) ← 串行回放，逐条复用单次执行
  → result: total/passed/failed/skipped + report.md / report.json 路径
```

- **选择口径**：`flows: ["站点/流程", "站点/流程@版本"]` > `site` 过滤 > 全部脚本（缺省 `limit` 20，上限 50）；
- **缺参脚本**：计划卡列出缺哪些入参，执行时记为 `skipped + 原因`，不从总数里消失；
- **单条失败不中断整批**；每条脚本的 runId / 断言 / 截图与单次回放完全一致；
- **报告**：`dataRoot/ui-batches/<batchId>/` 下的 `report.md`（人看）与 `report.json`（CI 消费），面板「批量回归」卡片可点开。

#### 自动命名（站点/流程留空也能落盘）

- 站点名：优先页面 `og:site_name` / `application-name`，否则取域名（去 `www.`/端口）；
- 流程名：优先页面标题（去掉站点名与 ` - / | / ·` 等分隔符），否则取 URL 最后一个有意义的路径段，再兜底 `录制-MMDD-HHmm`；
- 打开浏览器时回执带 `suggestedSite/suggestedFlow` 供面板预填；停止保存时仍为空就按**当时的真实页面**自动命名，并写进 `meta.site/meta.flow`（回执会说明“已自动命名”，之后可改 YAML）。

#### 浏览器引擎（可切换，seam / Playwright 同一契约）

录制与单条回放都走 `UiBrowserEngine` 契约（`src/uitest/engines.ts`），按 `config.uiTestBrowser` 选择实现：

| 引擎 | 承载 | 适合 | 边界 |
|---|---|---|---|
| `playwright` | dataforge 自己拉起系统 Chrome（可见窗录制 / 无头回放） | CI、批量、需要上传/特殊按键的脚本 | 独立窗口，人不在同一页 |
| `shared` | `dsh-builtin-browser` 的 `ctx.browser` seam（桌面侧栏/自托管窗口，人机同页） | 人工登录/接管、边看边录 | **upload 不支持**（seam 无文件选择通道）；登录态由共享浏览器自己的 profile 管理 |
| `cdp` | 预留：未来给 `dsh-builtin-browser` 暴露 CDP 端点后，用 `connectOverCDP` 复用 Playwright 引擎 | — | 尚未实现，当前回退 playwright |
| `auto` | 有共享浏览器用 `shared`，否则 `playwright` | 默认 | — |

- 共享引擎的录制：页面注入录制脚本 → 事件进 `__dfUiSeamQueue` → 宿主轮询 drain，**去重/脱敏/步骤生成与 Playwright 引擎共用 `RecorderCore`**；
- 共享引擎打开页面时会把**当前对话 id**（`ctx.agents.list()[0].id`）作为 owner 传给插件，页面才会落在该对话自己的右侧栏面板；拿不到对话 id 时如实报错（不会假装打开成功）；
- 共享引擎的回放：navigate/click/setValue/key/execute/screenshot，断言在页面内求值，run 留痕/失败截图与 Playwright 引擎同构；
- **批量回归固定走 Playwright 无头**（共享浏览器一次只适合一条、会抢窗口）；
- 切换只需改 `uiTestBrowser` 并重启宿主；`UiTestDeps.resolveEngine()` 是唯一选择点，未来接入 CDP 引擎不改 application/tools/panel。

#### 为什么不用右侧 Sidebar 浏览器（DSH 内置）

DSH 桌面端自带右侧 Sidebar「浏览器」tab（`dsh-client-ui-sidebar-browser`：Desktop 是 Electron `<webview>`，Web 是 sandbox iframe）。它**只能当查看面**，不能当 UI 测试的执行面：

- 官方明确**不向被访问页面注入 Electron/Node 能力**，也不暴露 DOM / 事件 / CDP 自动化接口；
- Web 版是跨域 sandbox iframe，拿不到目标页 DOM；Electron webview 同样没有给插件的注入通道；
- 因此「录制点击/输入」与「驱动回放/断言」都做不到——那不是配置问题，是这条通道的能力边界。

本插件与它的集成只有一件事：脚本详情页的 **「在侧栏浏览器打开」**（调 client 服务 `sidebarRight.openResource(url)`），用于人工盯着起点页核对；自动化录制/回放仍用插件自己拉起的系统 Chrome（录制可见窗、回放无头）。回放实时画面（CDP screencast 推流到侧栏/面板）是后续方向，不是现状。

**右侧栏「录制控制」tab**：共享浏览器打开在右侧栏时，录制按钮在 dataforge 面板里会“隔一层”。面板打开浏览器后会顺手在右侧栏注册/打开一个「录制控制」tab（尽量与浏览器并排分格；分格不可用就作为同格第二个 tab）：开始录制 / 停止并保存 / 关闭浏览器，停止时站点/流程留空也会自动命名。浏览器 tab 仍然保留，可随时切过去登录/操作。

**录制脚本升级**：页面内的录制器/选择器脚本带版本号，宿主升级后会替换旧脚本（旧监听器先失活），不会出现“重启了但录出来还是旧格式”。**脚本列表自动刷新**（5s）+ 手动「刷新」；从侧栏「录制控制」保存后会直接切到新保存的版本。

**切走再回来不丢状态**：面板按需挂载（离开会卸载 React 树），但录制表单、选中的脚本、浏览器会话 id、回放入参会写入 `sessionStorage`，回来时恢复；同时每 2.5s 轮询服务端会话对齐录制状态——浏览器被关掉或宿主重启后，失效的会话会被清掉，不会对着一个不存在的 session 点开始录制。

#### 面板内编辑（M2）

脚本详情页的「编辑脚本」进入编辑态（保存只落新版本 vN+1，`source: canvas`，旧版本保留）：

- **步骤**：改 kind / selector / value / url / key / ms，增删、上下移动，任意步骤后插入「等待」；
- **断言**：每步内增删 `visible / hidden / text / value / url / count`，填 `equals` / `contains`；
- **点选元素**：selector 旁的「从页面点选」把已打开的可见浏览器切到点选模式——捕获阶段吞掉点击（不会误触业务、也不会进录制步骤），点中元素后自动回填候选 `selector` + `candidates`；需要会话已打开且不在录制中；
- **保存**：客户端回传整份 doc，服务端 `parseUiScriptDoc` 校验全过才落盘；校验不过返回逐条 `target：reason`；
- **另存为新流程**：复制当前步骤到新的站点/流程（v1），原流程不受影响——适合「同一套操作、只改选择的类型/选项」的变体；改完值保存后回到面板直接对**新流程**点回放即可。同一流程只想换几组值，优先用入参槽位 `{{name}}`（录制后手工把值改成槽位，回放前填值）。

## 验证

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest：全量用例（含真引擎 dry-run 集成；python3 + engineRoot 存在时自动启用）
pnpm build       # tsdown → dist/ + lib/client.js（含画布与 UI 测试页，约 369 KB）
# 真 Chrome 的 UI 录制→回放/点选端到端（默认跳过；需要本机 Chrome）：
UI_E2E=1 pnpm exec vitest run test/uitest/e2e-local.test.ts
# 共享浏览器引擎（seam）用假 seam 单测（不依赖 dsh-builtin-browser）：
pnpm exec vitest run test/uitest/shared-engine.test.ts
```

直接 CLI 冒烟：

```bash
python3 dsh_bridge.py configs/znb-prpo.yaml --dry-run \
  --stockOrg MI_IOT --purchaseOrg 2120 --supplierCode 108062 \
  --materials '{"1710301000006A": 1}'
# exit 0 + 39 行 NDJSON（meta 18 步 → step 对 → terminal SUCCESS → result）
```
