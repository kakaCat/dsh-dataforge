---
title: UI 自动化测试（浏览器录制 + 回放）· 设计
status: draft
owner: kakaCat
reviewers: 待定
prd: docs/projects/PRJ-0003/requirement/ui-recording-replay.md
serves: FR-1.1～FR-1.12
created: 2026-10-17
updated: 2026-10-18
---

# UI 自动化测试（浏览器录制 + 回放）· 设计  serves: FR-1.1～FR-1.12

## 摘要  serves: 全文

- **问题**：接口链只断言响应字段；页面级回归仍靠人工点。采集期的 `browser_act` 是逐轮 agent 决策，不可保存、不可回放。
- **方案**：新增第三条执行面 **UI 测试**：可见 Chrome 手动操作 → 录制器收成步骤（带选择器候选）→ 落 `ui-script` 版本文件 → 无头 Chrome 回放 + 页面断言 → 失败截图/HTML + 运行留痕；agent 与面板共用同一套应用层与三道闸。
- **影响面**：新增 `src/uitest/*`、9 个工具、客户端第 5 页签、`dataRoot/ui-runs/` 留痕、`uiTestEnabled`/`uiStepTimeoutSeconds` 两个配置；M2 增面板步骤/断言编辑器与页面点选（`POST /script` 收 doc、`POST /record/pick`）；M3 增批量回放与报告（`dataRoot/ui-batches/`、`dataforge_ui_batch_run`）；不改链/卡 schema，不碰 `src/execute/*` 的依赖图。

## 背景与问题  serves: 全文

接口链（PRJ-0002）能自动跑 HTTP，但它断言的是响应字段；真实业务回归里大量缺陷发生在**页面状态**（元素没出来、文案不对、跳转错、表单交互失效）。人工回归「照步骤点一遍」不可重复、无留痕；采集期的 `browser_act` 是 agent 每步决策，不产出可保存、可重放的资产。

### 需求来源

| 需求编号 | 原始诉求 | 本设计如何回应 |
|---|---|---|
| FR-1.1 | 可见 Chrome 手动登录/导航，登录动作不进脚本 | 录制拆 open（只开窗）与 start（开始录）两步；cookie 在 stop 时持久化 |
| FR-1.2 | 捕获 click/fill/select/submit/press，生成有序步骤 | 页面内事件监听 + Node 侧去重/合并，事件到达顺序即步骤顺序（不做输入去抖） |
| FR-1.3 | 选择器候选并校验唯一性 | 页面生成候选，stop 时用 Playwright `locator.count()` 二次校验，回放按序取第一个唯一命中 |
| FR-1.4 | 密码输入/文件选择不入脚本 | 录制器直接跳过并计数；脚本里不产生密码值 |
| FR-1.5 | 脚本落工作区、版本不可变 | `.dsh/dataforge/ui-tests/<site>/<flow>/vN.yaml`，`saveUiScript` 永远分配 max+1 |
| FR-1.6 | 无头回放 + 页面断言，失败即停 | `runUiScript`：动作 + 断言轮询到步骤超时；失败 fail-fast 不重试 |
| FR-1.7 | 失败截图/HTML + 运行留痕 | `dataRoot/ui-runs/<runId>/failure.png`、`failure.html`、`run.json`、`events.ndjson` |
| FR-1.8 | 入参槽位 `{{name}}` 双向校验 | `schema.ts` 收集 url/value/key/files/断言文本引用；缺参闸在起浏览器前 |
| FR-1.9 | 回放三道闸 | `application.ts`：missing-inputs → confirm 计划卡 → 执行；开关关闭一律拒跑 |
| FR-1.10 | 面板第 5 页签 | `page-uitest.tsx` + `uitest/panel-routes.ts`；闸门全在服务端 |
| FR-1.11 | 8 个 agent 工具 | `tools.ts` 新增 ui_script_get/upsert、ui_record_open/start/stop/close、ui_run/ui_runs |
| FR-1.12 | cookie 持久化与回放注入 | 复用 R-4 的 cookie jar（0600、按 origin）；回执只报条数 |

### 现状与代价

- 页面级回归靠人工：一次回归 N 个流程 × M 步，不可复用、无证据；
- 采集成卡（PRJ-0001）只覆盖「接口」维度，交互顺序与页面状态没有资产；
- 若用 agent 每轮 `browser_act` 复现，成本是 token 与不可确定性，无法做回归门禁。

### 为什么是现在

采集与接口链已经把「真 Chrome、凭证纪律、运行留痕、面板数据面」铺好；UI 录制回放只差「录制器 + 脚本资产 + 回放器」三块，是复用率最高的一步。再晚做，页面级回归仍无法进入自动化的门禁。

## 目标与非目标  serves: 全文

### 目标

- 录制一遍真实页面操作，生成可评审、可版本化的 `ui-script`；
- 无头回放按步骤执行并用页面断言给出 pass/fail，失败留下截图与现场 HTML；
- agent 与面板拥有同一套闸门与回执，面板可独立完成录制/回放/看记录；
- 不破坏既有接口链执行面的依赖守卫（`src/execute` 仍无浏览器）。

### 非目标

- 坐标级点击/全局键鼠宏（canvas、非 DOM 控件）——M1 不做，避免不稳定与跨平台问题；
- 多标签页跟随、iframe/shadow 切换的显式建模——先覆盖主文档常规 Web；
- 断言编辑器——M1 面板只展示断言，编辑走 agent `ui_script_upsert`；
- 批量/定时回归、截图对比、CI 报告——留给 M3；
- 录制中自动修复选择器——失效只如实失败并留证据，不猜。

## 方案总览  serves: FR-1

**一句话方案**：录制器把用户在可见 Chrome 里的 DOM 操作翻译成带候选选择器的步骤，落到工作区版本文件；回放器在无头 Chrome 里逐步执行并做页面断言，运行与证据落 `dataRoot/ui-runs/`。

```text
可见 Chrome（用户操作）
  └─ 页面脚本：DOM 事件 → 原始载荷（候选选择器/值）
  └─ Node 录制器：去重/脱敏 → UiRecordingResult
        → saveUiScript（工作区 .dsh/dataforge/ui-tests/…/vN.yaml）

dataforge_ui_run / 面板回放
  └─ application 三道闸（缺参 → confirm 计划卡 → 执行）
  └─ runUiScript：无头 Chrome + cookie jar → 步骤/断言 → 失败截图
  └─ run-store：dataRoot/ui-runs/<runId>/{run.json,events.ndjson,evidence}
```

**关键概念**：

- **ui-script**：一个版本快照的页面操作脚本（steps + inputs + meta；与接口链同级但独立）；
- **选择器候选**：同一元素的有序定位候选，回放取第一个「唯一命中」的；
- **页面断言**：步骤后校验元素可见/文本/值/URL/计数，是「回放」与「测试」的分界。

## 架构与依赖  serves: FR-1

- **模块划分**：
  - `src/uitest/{schema,store}.ts`：契约与版本化落盘（纯 IO + 校验）；
  - `src/uitest/{recorder,sessions}.ts`：真浏览器录制与可见会话；
  - `src/uitest/{run,run-store}.ts`：无头回放、断言、证据与运行留痕；
  - `src/uitest/{application,panel-routes}.ts`：三道闸、cookie jar、工具/面板共用；
  - `src/client/page-uitest.tsx` + `api.ts`：面板第 5 页签。
- **依赖方向**：`uitest` → `playwright-core` / `js-yaml` / `shared` / `capture/credential-store`（cookie jar）/ `execute/credentials`（纯域名匹配）。**`src/execute` 不 import `src/uitest`**，既有 invariants 继续守护「链执行无浏览器」。
- **外部依赖**：系统 Chrome（`channel: 'chrome'`，与采集同款，免下载浏览器）；不可用时回放/录制失败并如实报错。
- **共享浏览器依赖（M4 决策）**：UI 测试的浏览器执行面改为依赖 [`dsh-builtin-browser`](https://github.com/wqty123/dsh-browser)（peer `>=0.4.13 <0.5.0`，提供 `ctx.browser` 服务与 CDP 驱动）。DSH 的 bundle 选择是 profile 级、不随 npm 依赖传递，因此安装命令为两个 bundle 同装；当前已落地「peer 依赖 + 安装文档 + `ctx.browser` 探测/面板状态」，**执行后端从内置 Playwright 切到 `ctx.browser` 是下一步重构**（未切之前录制/回放仍走 Playwright，功能不受影响）。
- **与既有架构的差异**：偏离「编排/执行一律纯 HTTP」的旧口径——新增第三条执行面；这是有意的：页面断言与响应断言无法在同一执行器里诚实地表达。
- **与 DSH 右侧 Sidebar 浏览器（`dsh-client-ui-sidebar-browser`）的关系**：仅做「只读查看」集成——脚本详情页调 client 服务 `sidebarRight.openResource(url)` 打开起点页。不把它当执行面：Desktop 的 Electron `<webview>` 不向页面注入 Electron/Node 能力，Web 是跨域 sandbox iframe；均无 DOM/事件/CDP 自动化通道，录制与回放都无法接。
- **浏览器引擎抽象（M4）**：录制/单回放统一走 `UiBrowserEngine`（`src/uitest/engines.ts`）：
  `playwright`（现有实现：可见录制/无头回放/upload/cookie jar）与 `shared`（`dsh-builtin-browser` 的 `ctx.browser` seam：人机同页、可接管；事件队列录制 + seam 操作回放；upload 不支持）。
  选择点只在 `UiTestDeps.resolveEngine()`；`config.uiTestBrowser` = `auto|playwright|shared|cdp`。
  未来 CDP 引擎只需实现同一接口（`connectOverCDP` + 复用现有 Playwright 回放器），application/tools/panel/batch 不改。
  批量回归固定 Playwright 无头（共享浏览器一次只适合一条）。

## 数据模型  serves: FR-1

- **ui-script 文件**（工作区项目资产，版本不可变）：`meta`（site/flow/version/created/source/startUrl/viewport/domain/note）、`inputs[]`（name/type/required/example）、`steps[]`（id/kind/selector/candidates/value/key/url/ms/files/expect/at）。
- **约束与不变量**：apiVersion/kind 固定；meta.startUrl 必须 http(s)；步骤 id 唯一、字段与 kind 匹配；断言形状完整；`{{name}}` 引用必须声明且被引用（双向）；上限 300 步/20 槽位/8 候选/10 断言/步。
- **运行记录**：`run.json`（runId/kind/status/site/flow/version/startUrl/startedAt/finishedAt/totalSteps/stepsDone/failedStep/error/screenshot）+ `events.ndjson`（meta/step/assert/terminal）。
- **迁移与回填**：不涉及存量数据；新目录 `ui-runs/` 与既有 `runs/` 分开，避免 `dataforge_status`/面板运行列表互相误读。
- **生命周期**：脚本版本只增不删；运行记录与证据同目录留存；cookie jar 与换票共用（0600、按 origin）。

## 接口设计  serves: FR-3

| 编号 | 接口 | 输入 | 输出 | 失败与错误 | 兼容性 |
|---|---|---|---|---|---|
| IF-1 | ui-script YAML（文件契约） | 完整 YAML 文本 | 校验后的 doc + 版本号 | invalid-ui-script（issues 逐条 target/reason） | apiVersion `dataforge/v1`，新增字段走可选 |
| IF-2 | `dataforge_ui_record_open` | start_url（http/https）、headless | sessionId、pageUrl、notice | record-open-failed | 新增工具 |
| IF-3 | `dataforge_ui_record_start/stop/close` | session_id；stop 可带 site/flow/domain/note/save | 步骤、跳过计数、saved 版本、persistedCookies | 会话不存在/未在录制 | 新增工具 |
| IF-4 | `dataforge_ui_script_get/upsert` | site/flow/version（读）；yaml（写） | doc/yaml/可用版本；新版本 path | ui-script-not-found / invalid-ui-script | 新增工具 |
| IF-5 | `dataforge_ui_run` | site/flow/version/inputs/confirm/dry_run/headless | 计划卡或运行结果（步骤/断言/证据） | missing-inputs / UI-test-disabled / ui-run-failed | 新增工具 |
| IF-6 | `dataforge_ui_runs` | run_id?、limit | run 行 + events | not-found | 新增工具 |
| IF-7 | 面板 `/ui-tests/*` | 同工具语义（HTTP JSON）；`POST /script` 收 doc 或 yaml；`POST /record/pick` 点选元素 | 同工具值 + 证据二进制 + 点选候选 | 400/404/405/413 信封；点选取消/超时回 200 + `ok:false` | 前缀下新增子路由 |
| IF-8 | cookie jar 读写 | 录制会话 cookie / 起点 URL | 持久化条数 / 注入条数 | 不抛（缺省空） | 复用 R-4 文件格式 |
| IF-9 | `dataforge_ui_batch_run` / 面板 `/batch/*` | site / flows / inputs / limit / confirm / dry_run | 计划卡或批次结果（逐条 runId/verdict/报告路径） | ui-test-disabled / batch-plan-failed | 新增工具与子路由；报告文件只增 |

#### IF-1 ui-script 文件契约

**语义**：一个文件 = 一个版本快照。写入永远新版本；读时重新校验，坏文件不静默（返回 issues + 可用版本）。`source` 由写入方声明（record/agent/canvas），不猜。

**错误码**：`invalid-ui-script`（形状/字段/入参引用任一不过，零落盘）；`ui-script-not-found`（版本不存在，带 availableVersions）。

**兼容性**：**不修改** 既有链/卡 schema；新字段（如未来 `assertionsV2`）以可选字段加入，旧版本零迁移。面板只吃服务端投影，不自行拼协议。

#### IF-2 `dataforge_ui_record_open`

**语义**：打开一个可见 Chrome 窗口，**不开始录制**（登录动作不进脚本）。起点只收 http/https；从本地 cookie jar 按域名注入已有登录态。返回 `sessionId`，后续 stop 前会话一直保留。

**错误码**：`record-open-failed`（URL 非法 / Chrome 起不来）→ 修正后重试，不自动重试。

**兼容性**：纯新增工具；不影响既有 browser_*（那套用于采集）。

#### IF-3 `dataforge_ui_record_start` / `stop` / `close`

**语义**：`start` 在会话上注入事件监听，开始把用户操作记成步骤；`stop` 结束录制、持久化会话 cookie、给 site+flow 时落新版本；`close` 关闭浏览器（未 stop 的录制被取消）。同一页面重复 start 幂等返回同一录制器。

**错误码**：`record-start-failed`（会话不存在）；`record-stop-failed`（没有在录制）；`ok:false + error`（close 幂等）。

**兼容性**：纯新增；录制器与采集型 `browser_act` 会话互不影响。

#### IF-4 `dataforge_ui_script_get` / `upsert`

**语义**：`get` 列脚本或读某版本（doc + YAML 原文 + 可用版本）；`upsert` 是 agent 手写/编辑的唯一写入口，YAML 进、校验全过才落新版本，`source` 由调用方声明。

**错误码**：`ui-script-not-found`（附 availableVersions）→ 换版本或先写；`invalid-ui-script`（附 issues）→ 按 target/reason 修 YAML 再写。

**兼容性**：新工具；脚本 apiVersion 固定 `dataforge/v1`，未来字段以可选方式加入。

#### IF-5 `dataforge_ui_run`

**语义**：不带 `confirm` 或 `dry_run=true` 只回计划卡（步骤/写操作数/起点），不起浏览器；带 `confirm=true` 才执行；入参必填缺失在计划前拒绝；`uiTestEnabled=false` 时计划也拒跑。

**错误码**：`missing-inputs`（附 missing 列表）→ 补齐后重试；`ui-test-disabled` → 开关问题，不走重试；`ui-run-failed` → 浏览器/步骤异常，先看 run 记录与证据。

**兼容性**：纯新增执行面；不改变任何既有链执行行为与依赖图。

**幂等与重试**：**不幂等**。同一参数重复调用就是新 run、新浏览器；失败不自动重试（click/submit 可能重复写入）。

#### IF-6 `dataforge_ui_runs`

**语义**：给 run_id 回运行详情（run 行 + 事件流：步骤/断言/终态）；不给则列最近运行。状态只认盘（`ui-runs/<runId>/`），运行中途也能看到已完成步骤。

**错误码**：运行不存在 → `ok:false + message`（不是异常）。

**兼容性**：纯新增；与 `dataforge_status`（引擎运行）互不读取彼此目录。

#### IF-7 面板子路由

**语义**：与采集/编排同前缀 `/dashboard/api/dataforge`，由采集 handler 分派（同前缀只注册一次）；写入口只有 `/script`、`record/*`、`/run`；证据读取只允许 `failure.png|failure.html` 白名单。

M2 起 `POST /script` 同时接受整份 `doc`（面板编辑器，来源 `canvas`）与 `yaml`（agent/导入，来源 `agent`）；`POST /record/pick` 调页面点选器，成功回候选选择器，取消/超时回 200 + `ok:false` + message（用户可处理的结果，不进 4xx）。

**错误码**：`bad-json`/`bad-body`/`bad-query`（400）、`method-not-allowed`（405）、`not-found`（404）、`invalid-ui-script`（400）。

**兼容性**：纯新增；既有四页签与路由不变。

#### IF-8 cookie jar 读写

**语义**：录制 stop 时把会话 cookie 按 domain 分 origin 写入 `dataRoot/credentials/cookies.json`；回放按起点 URL 的域名匹配读取并注入 browser context。与 R-4 换票共用同一文件格式与 0600 权限纪律。

**错误码**：落盘失败不抛（录制本身已成功，回执 `persistedCookies` 如实为 0）；jar 缺失/损坏按空库处理，回放继续（可能因未登录失败并留截图）。

**兼容性**：复用 R-4 的 `PersistedStore` v1 格式，不新增字段、不迁移。

#### IF-9 批量回归

**语义**：`dataforge_ui_batch_run` 先出计划（选中脚本/步骤/写操作/缺参），`confirm=true` 后逐条串行回放；每条复用单次执行，缺参/坏文件脚本记 `skipped`，单条失败不中断整批；结束写 `dataRoot/ui-batches/<batchId>/batch.json + report.md + report.json`。面板 `/ui-tests/batch/*` 提供计划/执行/历史/报告直链。

**错误码**：`ui-test-disabled`（开关关闭）→ 不重试；`batch-plan-failed`（flows 格式错/没有选中脚本）→ 修正选择后重试；单条失败不改变批次 HTTP 结果，看 `passed/failed/skipped` 与报告。

**兼容性**：纯新增；报告文件只增不删，历史批次可回看；默认串行，后续加并发不改契约。

## 备选方案  serves: 全文

| 方案 | 一句话说明 | 优点 | 代价 | 为什么未选 |
|---|---|---|---|---|
| A（选用） | 自研录制器 + 候选选择器 + 独立 ui-script 资产 | 与项目资产/闸门/凭证纪律同构；依赖轻（playwright-core） | 需维护选择器生成与断言实现 | — |
| B | 用 `playwright` 包的 codegen/recorder | 现成录制 UI | 依赖更重；选择器与资产模型（版本/入参/候选）不一致，落地要二次改造 | 改造面大于自研，且引入不必要依赖 |
| C | 继续用 agent `browser_act` 逐步点 | 零新代码 | 不可保存/不可重复/烧 token/无法做回归门禁 | 不满足「录制一次、反复回放」的核心诉求 |
| D | 把 UI 步骤编进 interface-chain | 复用一条执行入口 | 破坏 `src/execute` 无浏览器守卫；响应断言与页面断言混在一起无法定位 | 架构上不可接受 |
| E：什么都不做 | 维持人工回归 | 零成本 | 页面级回归永远无法自动化；缺陷漏到线上 | 现在不能接受：采集与链已铺好，差最后一块 |
| F | 用 DSH 右侧 Sidebar 浏览器做录制/回放 | 与 Session 同屏、无需另开窗口 | 无注入/CDP 通道；Web 版跨域 iframe 拿不到 DOM；Electron webview 不暴露自动化接口 | 只能查看，无法录制/回放；仅保留 `openResource` 只读入口 |

## 四风险与证据  serves: 全文

| 风险类型 | 判断问题 | 现有证据 | 结论 |
|---|---|---|---|
| 价值 | 用户真的想要「录一遍回放」吗 | 用户原话「按键精灵那样对页面进行操作」+ 已实现 spike（本地页面录制→回放通过） | 已验证（M1 真站有待用户试跑） |
| 可用性 | 用户会用吗 | 面板五步动线 + e2e 链路；尚未做真实用户任务测试 | 部分 |
| 可行性 | 我们建得出来吗 | 真 Chrome 录制→落盘→无头回放 e2e 通过（`UI_E2E=1`）；单测 60+ 例 | 已验证 |
| 商业可行性 | 公司能接受吗 | 无新增外部服务/云成本；仅本机 Chrome 与磁盘留痕 | 已验证（估算：每次运行 1 浏览器实例，与采集期一致） |

**未验证项的补课计划**：M2 前用 2 个真实站点（含登录态）各录一条流程，记录选择器失效率与录制耗时，由 kakaCat 在下一个迭代评审前给结论。

## 失败模式与回滚  serves: 全文

| 失败场景 | 触发条件 | 用户可见影响 | 检测手段 | 回滚动作 | 决策人 |
|---|---|---|---|---|---|
| 选择器失效 | 前端改版 | 回放中断并留截图 | run 记录 failedStep + failure.png/html | 修脚本（新版本）或重录 | kakaCat |
| 凭证泄漏 | 密码/上传被录进 YAML | 脚本进 git 即泄漏 | 录制器跳过 + 回执计数；评审看 YAML | 删版本文件/改写历史（需人） | kakaCat |
| 真实写入副作用 | click/submit/upload | 业务数据被改 | 计划卡写操作计数 + confirm 闸 | 业务侧人工回滚/撤销 | 用户 |
| 回放顺序错乱 | 事件去抖/异步 | 先点空表单 | e2e 已覆盖；断言失败即暴露 | 修录制器（本次已改为不去抖） | kakaCat |
| 长脚本/站点慢 | 步骤多/网络慢 | 回放超时 | 单步超时事件 + failedStep | 调 `uiStepTimeoutSeconds` / 拆脚本 | kakaCat |
| 面板误触发 | 用户点录制/回放 | 打开浏览器/真实提交 | 服务端闸门 + confirm | 关闭浏览器 / 停用开关 | 用户 |

- **开关**：`uiTestEnabled`（默认 true，全局）——关闭后所有回放返回 `ui-test-disabled`，录制与脚本读写/历史回看照常；
- **回滚演练**：关开关 → 确认 `dataforge_ui_run` 立即拒绝；脚本与运行记录保留，不影响接口链；
- **不可逆动作**：回放中的 click/submit/upload 可能产生业务写入。事前保护：计划卡如实计写操作数，`confirm=true` 才执行；失败不重试。

## 跨关注点  serves: 全文

| 关注点 | 结论 | 依据与措施 |
|---|---|---|
| 安全 | 可接受 | 面板写入口有闸；密码不录；cookie 只进 context/jar，事件与回执只报条数；证据路由白名单防路径穿越 |
| 隐私与合规 | 需注意 | 录制内容含页面文本/值；脚本进工作区 git，敏感值靠「密码不录 + 手写 upload 路径」纪律，评审时人工检查 |
| 成本 | 低 | 每次回放 1 个 Chrome 实例；无外部服务；留痕仅截图/HTML（失败时） |
| 可观测性 | 够用 | run.json + events.ndjson + 失败截图/HTML；面板与 `dataforge_ui_runs` 可查；无指标/告警（M1） |
| 性能与容量 | 够用 | 单步超时 15s；长脚本线性耗时；不做并发批量（M1） |
| 文档与支持 | 已覆盖 | README「UI 测试」节 + PRJ-0003 需求/设计；面板内有操作提示 |

## 交付拆分与里程碑  serves: 全文

| 里程碑 | 内容 | 出口判据 | 负责人 | 目标日期 |
|---|---|---|---|---|
| M1 | 契约/存储 + 录制器 + 回放器 + 8 工具 + 面板页签 + cookie jar | 真 Chrome 录制→回放 e2e 通过；全量测试绿；面板可录制/回放/看记录 | kakaCat | 2026-10-17（已完成） |
| M2 | 面板步骤/断言编辑器 + 页面点选元素生成 selector + 插入等待步骤（用例矩阵暂未做） | 面板内「录制→加断言→回放」闭环可用：doc 保存只落 vN+1、点选不误触业务、真 Chrome 点选 e2e 通过 | kakaCat | 2026-10-18（已完成） |
| M3 | 批量回归 + 报告（第一阶段，已完成 2026-10-18）；网络断言联动 / 定时调度 / CI 集成留后续 | 一键跑完一组脚本并出 `report.md/json`；缺参/坏文件不静默消失，单条失败不中断整批 | kakaCat | 2026-10-18（第一阶段完成） |
| M4 | 浏览器引擎适配层（已完成 2026-10-18）：Playwright + 共享浏览器 seam 同契约；`uiTestBrowser` 配置切换；`cdp` 预留 | 两引擎共用录制核心与回放语义；假 seam 单测通过；切换只改配置 | kakaCat | 2026-10-18（完成） |
| M4 | 共享真实浏览器依赖（`dsh-builtin-browser`）：peer 依赖 + 安装文档 + `ctx.browser` 探测/面板状态（已完成）；执行后端从 Playwright 切到 `ctx.browser`（待做） | 两个 bundle 同装后 `ctx.browser` 可用、面板显示已连接；切换后录制/回放走共享浏览器 | kakaCat | 2026-10-18（依赖接入完成，执行后端待做） |

## 需求追溯  serves: 全文

| 需求编号 | 设计节 | 测试用例 | 指标 |
|---|---|---|---|
| FR-1.1/1.12 | 方案总览 / 数据模型 | `test/uitest/recorder.test.ts`、`test/uitest/run.test.ts`（cookie 不回显） | 不适用 |
| FR-1.2/1.3 | 方案总览（录制器） | `test/uitest/recorder.test.ts`、`test/uitest/run.test.ts`（候选回退） | 不适用 |
| FR-1.4 | 背景与问题（凭证纪律） | `test/uitest/recorder.test.ts`（密码/上传计数） | 不适用 |
| FR-1.5 | 数据模型 / 接口设计 IF-1 | `test/uitest/store.test.ts`、`test/uitest/schema.test.ts` | 不适用 |
| FR-1.6/1.7 | 接口设计 IF-5 / 数据模型 | `test/uitest/run.test.ts`（证据）、`e2e-local.test.ts` | 回放成功率 = 1（e2e） |
| FR-1.8/1.9 | 接口设计 IF-5 | `test/uitest/tools.test.ts`、`test/uitest/panel-routes.test.ts` | 缺参零浏览器启动 = 1 |
| FR-1.10 | 方案总览（面板） | `test/client/render-smoke.test.tsx` | 不适用 |
| FR-1.11 | 接口设计 IF-2～IF-6 | `test/uitest/tools.test.ts`、`test/index.test.ts` | 工具数 29 |
| FR-1.12 | 数据模型 | 与 R-4 共用 jar 实现的回归用例 | 凭证零回显 |
| FR-2.1/2.2 | 接口设计 IF-7、方案总览（面板） | `test/uitest/panel-routes.test.ts`（doc 保存新版本）、`test/client/render-smoke.test.tsx`（编辑器渲染） | 编辑保存 = 新版本，旧版本可回读 |
| FR-2.3 | 接口设计 IF-7、方案总览（点选） | `test/uitest/e2e-local.test.ts`（真 Chrome 点选，业务不被触发）、`test/uitest/selector.test.ts`（脚本可编译） | 点选返回候选且不误触 = 1 |
| FR-2.4 | 数据模型 | `test/uitest/store.test.ts`（版本 max+1） | 旧版本不覆盖 |
| FR-3.1/3.2 | 接口设计 IF-9、方案总览（批量） | `test/uitest/batch.test.ts`（选择/计划/缺参/坏文件）、`test/uitest/panel-routes.test.ts`（计划闸） | 选中脚本数 = 计划条数 |
| FR-3.3/3.4 | 接口设计 IF-9 | `test/uitest/batch.test.ts`（汇总/单条抛错不中断/缺参跳过） | 单条失败不影响其余 = 1 |
| FR-3.5/3.6 | 数据模型（批次报告）、方案总览（面板） | `test/uitest/batch.test.ts`（报告落盘）、`test/uitest/tools.test.ts`（批量工具）、`test/client/render-smoke.test.tsx` | 报告含逐条结果 |
| FR-4.1～4.6 | 架构与依赖（浏览器引擎抽象）、接口设计 IF-9 | `test/uitest/shared-engine.test.ts`（seam 录制/回放/断言/证据/upload 拒绝）、`test/uitest/tools.test.ts`、`test/uitest/panel-routes.test.ts` | 两引擎共用 `RecorderCore`，run 留痕同构 |

## 常见问题  serves: 全文

| 问题 | 回答 |
|---|---|
| 最可能被投诉什么？ | 选择器失效导致回放挂；先用候选链 + 截图定位，M2 加「点选元素生成断言/选择器」。 |
| 6 个月后会成为什么负担？ | 脚本数量与浏览器依赖；建议按站点/流程目录治理，定期清理失效流程；浏览器复用采集的系统 Chrome。 |
| 流量涨 10 倍先坏在哪？ | 回放并发是 Chrome 实例；M1 串行、无批量，先坏在内存/CPU；批量前要加并发上限与队列。 |
| 谁半夜被叫起来、手上有什么？ | M1 无定时任务，不涉及；若 M3 上 CI/定时，值班先看 run.json + failure.png/html + 开关 `uiTestEnabled`。 |
| 数据错了怎么修、修得回来吗？ | 脚本是版本文件，回读旧版本即可；运行记录只读；业务写入需业务侧回滚（计划卡已预警）。 |
| 这个决定错了多久能发现？ | M1 已用本地 e2e 与真站试跑验证；错误决策会在第一轮真实流程录制/回放时暴露（用户试跑即可）。 |

## 开放问题  serves: 全文

| 问题 | 选项 | 负责人 | 截止 |
|---|---|---|---|
| 断言编辑器交互 | A. 页面点选元素即时生成断言；B. 录完后在面板编辑步骤/断言 | kakaCat | M2 设计前 |
| 参数化用例矩阵 | A. 单脚本多组 inputs（面板表单）；B. 复制脚本派生用例 | kakaCat | M2 设计前 |
| 与接口链联动 | A. UI 操作顺带断言 XHR（复用采集 wire）；B. 保持两条执行面独立 | kakaCat | M3 立项前 |
| 站点级登录 cookie 隔离 | A. 复用统一 jar（现状）；B. UI 测试独立 jar | kakaCat | 已决：A（复用 0600 jar） |
| 回放实时画面 | A. CDP screencast 推流到面板；B. 侧栏浏览器打开本地流 URL；C. 不做（现状：只有失败截图） | kakaCat | M4 设计前 |
| CDP 引擎落地 | A. 等 `dsh-builtin-browser` 暴露 CDP 访问器后新增 `cdp` 引擎；B. 保持 seam 适配 | kakaCat | 插件提供公开 CDP 契约后 |

## 附录  serves: 全文

- **原型与验证材料**：本地 spike（/tmp/ui-spike，未入库）→ 正式 e2e `test/uitest/e2e-local.test.ts`（录制/回放 + 页面点选共 3 例）；批量回归单测 `test/uitest/batch.test.ts`（10 例）；共享浏览器依赖的探测/状态在 `src/index.ts` 与 `/ui-tests/overview` 的 `browser` 字段；
- **相关文档**：[PRJ-0003 需求](../requirement/ui-recording-replay.md)、[PRJ-0001 采集设计](../../PRJ-0001/design/capture-page-and-relations.md)、[PRJ-0002 链设计](../PRJ-0002/design/r3-execution-engine.md)；
- **评审记录**：待评审（M4 引擎适配后更新）；
- **变更历史**：2026-10-17 初稿（M1 实现同步）；同日按设计模板补全接口明细（IF-2～IF-8）；2026-10-18 M2 增量（面板编辑器 + 页面点选 + 插入等待），IF-7 增补 doc/pick 语义；2026-10-18 M3 第一阶段（批量回归 + 报告），新增 IF-9 与 `ui-batches/` 留痕；2026-10-18 记录与 Sidebar 浏览器的能力边界（只读查看，不做执行面）并补「在侧栏浏览器打开」入口；2026-10-18 引入 `dsh-builtin-browser`（seam = `ctx.browser`）并完成 M4 浏览器引擎适配：`UiBrowserEngine` 契约 + Playwright/shared 两实现 + `uiTestBrowser` 配置切换 + `RecorderCore` 语义复用；2026-10-18 面板编辑器补「另存为新流程」（变体流程，原流程不动）；2026-10-18 补「站点/流程留空自动命名」（og:site_name/域名 + 页面标题/路径/时间兜底）与面板状态跨挂载持久化；2026-10-18 增加右侧栏「录制控制」tab（与共享浏览器并排，开始/停止/关闭）；2026-10-18 回放增加慢放（0/0.5s/1s/2s 每步）与 Playwright 可见窗口选项；2026-10-18 canvas 图表录制 `clickPoint` 坐标并按坐标回放，目标缺失时按 `at` 页面导航重试；2026-10-18 回放点击落点增加脉冲光圈动画（面板可关）；2026-10-18 回放末尾增加「停留再关」选项（默认 2s），避免最后一步一闪而过；2026-10-18 录制增加元素语义特征 `features` 与回放备用定位（跨布局/跨引擎降低脆性，仍不提供绝对保证）；2026-10-18 录制器/选择器脚本加版本号并在注入时替换旧版（避免复用页面时录出旧格式）；面板保存后显式切到新版本、脚本列表 5s 自动刷新（诊断 + 文本兜底），点击坐标改为三级策略（原元素未变用录制坐标 / 变了按当前 rect 重算 / 找不到用 features 找回再算），绝对视口坐标仅兜底。
