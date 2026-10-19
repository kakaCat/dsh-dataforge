---
title: UI 自动化测试（浏览器录制 + 回放）· 需求
status: draft
owner: yunpeng
reviewers: 待定
created: 2026-10-17
updated: 2026-10-18
---

# UI 自动化测试（浏览器录制 + 回放）· 需求

- 项目：PRJ-0003 UI 测试（第三条执行面）
- 目标：像「按键精灵」一样录一遍页面操作，回放时在真浏览器里重现，并用**页面断言**判定通过/失败。
- 关联：PRJ-0001 采集（真 Chrome、cookie/凭证纪律）、PRJ-0002 接口链（执行闸门与留痕习惯）；本需求是独立执行面，不复用 `src/execute/*`。

## 1. 问题

接口链能自动跑 HTTP，但它断言的是响应字段；真实业务回归里大量缺陷发生在**页面状态**（元素没出来、文案不对、跳转错、表单交互失效）。
人工回归的做法是「照着一份步骤点一遍」，不可重复、无留痕。采集期的 `browser_act` 是 agent 每步决策，不是可保存、可回放的脚本。

## 2. 范围（M1）

| 编号 | 诉求 | 优先级 |
|---|---|---|
| FR-1.1 | 可见 Chrome 打开站点，用户手动登录/导航；登录动作不进脚本 | P0 |
| FR-1.2 | 开始/停止录制：捕获 click/fill/select/submit/press；生成有序步骤 | P0 |
| FR-1.3 | 选择器候选：testid → id → name → aria-label → 文本 → CSS 路径，停止时校验唯一性 | P0 |
| FR-1.4 | 密码输入/文件选择不入脚本（凭证与本地路径纪律），回执如实计数 | P0 |
| FR-1.5 | 脚本落工作区 `.dsh/dataforge/ui-tests/<site>/<flow>/vN.yaml`，版本不可变、可手改、可评审 | P0 |
| FR-1.6 | 回放：无头 Chrome 逐步执行 + 页面断言（visible/hidden/text/value/url/count），失败即停 | P0 |
| FR-1.7 | 失败证据：截图 + 现场 HTML；运行留痕 `dataRoot/ui-runs/<runId>/` | P0 |
| FR-1.8 | 入参槽位 `{{name}}`：声明即校验（引用未声明 / 声明未使用都拒），回放缺必填不出浏览器 | P1 |
| FR-1.9 | 回放三道闸：必填 → 用户确认计划卡 → 执行；与链路执行同款纪律 | P0 |
| FR-1.10 | 面板第 5 页签「UI 测试」：脚本列表、录制、回放、运行记录、失败截图 | P0 |
| FR-1.11 | agent 工具面：脚本读写 / 录制生命周期 / 回放 / 运行查询（8 个工具） | P0 |
| FR-1.12 | 登录态：录制结束持久化会话 cookie（0600、按 origin），回放按起点域名注入，回执只报条数 | P0 |

## 3. 非目标（M1 不做）

- 坐标级点击/键鼠全局宏（canvas、非 DOM 控件）；
- 多标签页跟随、iframe 切换的显式建模；
- 断言编辑器（M1 面板只展示断言，编辑走 agent 的 `ui_script_upsert`）；
- 批量/定时回归、截图对比断言、CI 报告；
- 录制过程中的自动修复（选择器失效只如实失败，不猜）；
- 使用 DSH 右侧 Sidebar 浏览器（`dsh-client-ui-sidebar-browser`）作为自动化执行面——该 webview 不向页面注入 Electron/Node 能力、也没有 DOM/CDP 自动化接口，跨域 iframe 更拿不到目标 DOM；只做「只读打开目标页」的查看集成。

## 4. 验收判据

| 判据 | 证据 |
|---|---|
| 真 Chrome 录制 → 落盘 → 无头回放通过 | `UI_E2E=1 pnpm exec vitest run test/uitest/e2e-local.test.ts` |
| 断言失败即停并留截图/HTML | `test/uitest/run.test.ts`（失败证据用例）+ `dataRoot/ui-runs/<runId>/failure.*` |
| 候选回退（首选有歧义 → 次选唯一） | `test/uitest/run.test.ts` |
| 密码/上传不落脚本 | `test/uitest/recorder.test.ts` |
| 版本不可变 / 坏文件如实报错 | `test/uitest/store.test.ts` |
| 缺参/确认/开关三道闸 | `test/uitest/tools.test.ts`、`test/uitest/panel-routes.test.ts` |
| 面板页签可渲染、录制/回放/记录可操作 | `test/client/render-smoke.test.tsx` + 本地 GUI 验证 |
| 全量回归不破坏既有能力 | `pnpm typecheck && pnpm test`（63 files / 709 passed / 6 skipped） |

## 5. 开放问题

1. 断言编辑器与「从页面点选元素生成断言」的交互，留到 M2；
2. 参数化运行值的历史（C/D 用例矩阵）是否需要脚本级 example 组合，留到 M2；
3. 与接口链的联动断言（同一个 UI 操作顺带断言 XHR 响应）留到 M3；届时可复用采集的 wire 流，但 UI 执行层仍不 import `src/execute`。


## 6. M2 增量（2026-10-18 已实现）

M2 的目标是把「录制 → 加断言 → 回放」收进面板，不需要 agent 参与改脚本：

| 编号 | 诉求 | 状态 |
|---|---|---|
| FR-2.1 | 面板内步骤编辑：改 kind / selector / value / url / key / ms，增删、上下移动、任意步骤后插入「等待」 | ✅ |
| FR-2.2 | 面板内断言编辑：六种断言（visible/hidden/text/value/url/count）+ equals/contains | ✅ |
| FR-2.3 | 从可见会话点选元素 → 自动回填 `selector` + `candidates`（捕获阶段吞掉点击，不误触业务、不进录制步骤） | ✅ |
| FR-2.4 | 编辑保存只落新版本（vN+1，`source: canvas`），服务端校验全过才落盘，旧版本可回看 | ✅ |
| FR-2.5 | 回放前入参表单（required/optional 逐槽位填写，缺必填不出浏览器） | ✅（M1 已有） |
| FR-2.6 | 另存为新流程：复制当前 doc 到新的 site/flow（v1），原流程不动；保存后可直接对新流程回放（适合只改类型/选项的变体） | ✅ |
| FR-2.7 | 自动命名：站点/流程留空时，站点取 og:site_name/域名、流程取页面标题（或路径/时间兜底）；open 回执带预填建议 | ✅ |
| FR-2.8 | 右侧栏「录制控制」tab：共享浏览器旁直接开始/停止/关闭（宿主 sidebar-right 可用时自动打开；尽量与浏览器并排分格） | ✅ |

**M2 验收判据**：面板内「选中脚本 → 编辑脚本 → 点选元素加断言 → 保存 vN+1 → 确认回放」闭环可用；
`test/uitest/panel-routes.test.ts`（doc 保存/点选路由）、`test/uitest/e2e-local.test.ts`（真 Chrome 点选）、
`test/client/render-smoke.test.tsx`（编辑器渲染）通过。

**M2 边界**：点选需要会话已打开且不在录制；选择器仍优先 testid/id/name/aria/文本/CSS 路径，页面内无法自校验的选择器由回放期 Playwright 判定；
用例矩阵（多组入参一键跑）与网络断言仍留 M3。


## 7. M3 增量（2026-10-18 已实现：批量回归 + 报告）

M3 第一阶段先把「一组脚本一键跑完、出可判定的报告」做出来；网络断言联动、定时调度与 CI 集成留后续。

| 编号 | 诉求 | 状态 |
|---|---|---|
| FR-3.1 | 批量选择：显式 flows（`site/flow`、`site/flow@版本`）/ 按站点 / 全部脚本，带条数上限 | ✅ |
| FR-3.2 | 批量计划卡：选中脚本、步骤数、写操作数、缺参/坏文件在起浏览器前列出 | ✅ |
| FR-3.3 | 串行执行：单条失败不中断整批；每条复用单次回放（runId/断言/截图一致） | ✅ |
| FR-3.4 | 缺参/坏文件脚本记为 `skipped + 原因`，不从总数里消失 | ✅ |
| FR-3.5 | 报告：`dataRoot/ui-batches/<batchId>/report.md`（人看）+ `report.json`（CI 消费） | ✅ |
| FR-3.6 | 面板「批量回归」卡片：范围选择、计划、确认回放、结果与报告直链 | ✅ |

**M3 验收判据**：`dataforge_ui_batch_run` 计划/执行闸门与汇总正确（`test/uitest/batch.test.ts` 10 例、`test/uitest/tools.test.ts`、`test/uitest/panel-routes.test.ts`）；
报告文件落盘且内容含逐条结果与失败证据；面板可操作（渲染冒烟）。

**M3 边界**：默认串行（并发/定时调度留后续）；报告是文件 + 面板直链，尚未接 CI 退出码约定；网络断言仍未做。


## 8. M4 增量（共享真实浏览器依赖，进行中）

UI 测试的浏览器执行面改为依赖 `dsh-builtin-browser`（提供 `ctx.browser` 服务、共享真实浏览器与 CDP 驱动）。

| 编号 | 诉求 | 状态 |
|---|---|---|
| FR-4.1 | 将 `dsh-builtin-browser` 声明为本插件 peer dependency（`>=0.4.13 <0.5.0`） | ✅ |
| FR-4.2 | 安装文档给出一条命令同装两个 bundle（Desktop/Web 各一条）；桌面侧栏 bridge 单独说明 | ✅ |
| FR-4.3 | 运行时探测 `ctx.browser`，面板与日志如实显示「已连接 / 未安装 + 安装命令」 | ✅ |
| FR-4.4 | 录制/回放的执行后端从内置 Playwright 切到 `ctx.browser`（open/execute/click/type/key/screenshot/cookies） | ⏳ 待做（需重构录制传输与回放执行器） |

**边界**：依赖切换完成前，当前录制/回放仍走内置 Playwright，功能不受影响；切换后 `dsh-builtin-browser` 缺失时 UI 测试应如实拒绝（而不是静默换后端）。


## 8. M4 增量（2026-10-18 已实现：浏览器引擎适配层）

背景：`dsh-builtin-browser` 已经作为独立插件引入（seam = `ctx.browser`，不暴露 CDP）。
dataforge 把「怎么拿页面」抽成 `UiBrowserEngine` 契约，当前两套实现同一契约并用配置切换；
未来 CDP 版本（`connectOverCDP` 复用 Playwright 引擎）只要新增一个实现即可，上层不动。

| 编号 | 诉求 | 状态 |
|---|---|---|
| FR-4.1 | 引擎契约：会话/录制生命周期 + 单次回放统一接口（`UiBrowserEngine`） | ✅ |
| FR-4.2 | Playwright 引擎：现有实现原样迁入（可见录制 / 无头回放 / upload 可用 / cookie jar） | ✅ |
| FR-4.3 | 共享浏览器引擎（seam）：录制用页面事件队列轮询、回放用 seam 操作 + 页面内断言；登录态走插件 profile | ✅ |
| FR-4.4 | 配置切换：`uiTestBrowser: auto/playwright/shared/cdp`；不可用时如实报错/回退说明；批量固定 Playwright 无头 | ✅ |
| FR-4.5 | 语义复用：录制去重/脱敏/步骤生成抽成 `RecorderCore`，两引擎共用；回放结果的 run 留痕/断言/失败截图同构 | ✅ |
| FR-4.6 | 面板展示当前引擎（overview.browser：engine/label/available/degraded） | ✅ |
| FR-4.7 | 回放慢放：面板可选 0/0.5s/1s/2s 每步延迟；Playwright 引擎可选可见窗口；`slow_mo_ms` 工具参数；慢放不改变步超时预算 | ✅ |
| FR-4.8 | canvas 图表录坐标：`clickPoint`（fx/fy + x/y + viewport）录制，两引擎按坐标真鼠标点击；目标找不到时按步骤 `at` 导航重试一次 | ✅ |
| FR-4.9 | 点击视觉提示：回放点击前在落点注入脉冲光圈+圆点（非交互、自动淡出），面板「点击动画」开关，工具 `highlight_clicks` | ✅ |
| FR-4.10 | 末尾停留：回放结束后先停留再关浏览器（面板可选 0/1/2/5s；工具 `hold_ms`；批量不等待） | ✅ |
| FR-4.11 | 录制器/选择器脚本版本化：宿主升级后替换页面内旧脚本；面板保存后切到新版本并 5s 自动刷新脚本列表 | ✅ |
| FR-4.11a | `clickPoint.name`：录制点击控件名（aria-label/文本/value/title/placeholder/alt/name），用于诊断与文本兜底 | ✅ |
| FR-4.11b | 坐标回放三级策略：原元素 rect 未变→用录制坐标；变了→按当前 rect 重算；找不到→用 `features` 找回再算；绝对视口坐标仅最后兜底 | ✅ |
| FR-4.12 | 录制语义特征：步骤保存 `features`（testid/id/name/aria/placeholder/role/文本/title/alt/href/label/canvasIndex），回放候选链失败时用特征生成备用定位；录制候选链优先语义选择器（text=/:has-text 允许录制期无法校验唯一） | ✅ |

**M4 验收判据**：`pnpm typecheck && pnpm test` 全绿；`test/uitest/shared-engine.test.ts`（假 seam：录制/回放/断言/证据/upload 拒绝）
与既有 Playwright 测试同时通过；配置切换见 README「浏览器引擎」。

**M4 边界**：
- 共享引擎不支持 `upload`（seam 无文件选择通道），这类脚本切回 `playwright`；
- 共享引擎的登录态在插件自己的 profile（dataforge 不再注入/写回 cookie jar）；
- 共享引擎的页面选择器校验只做纯 CSS（Playwright 专属选择器保留原候选，靠回放映射）；
- 批量回归固定 `playwright`（共享浏览器一次只适合一条、会抢窗口）；
- `cdp` 引擎仍为预留配置值（未实现，回退 playwright）；真实共享浏览器链路需重启宿主后按 e2e 清单验证。
