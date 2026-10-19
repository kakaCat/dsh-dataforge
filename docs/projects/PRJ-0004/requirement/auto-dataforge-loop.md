---
title: AI 造数闭环（采集 → 自动编排 → 场景执行）· 需求
status: draft
owner: kakaCat
reviewers: 待定
created: 2026-10-18
updated: 2026-10-18
---

# AI 造数闭环（采集 → 自动编排 → 场景执行）· 需求

- 项目：PRJ-0004 造数闭环（测试数据工厂）
- 目标：测试人员只给业务目标，由**同一个 agent** 完成理解、追问、查接口、生成编排、执行和诊断；把真实操作采集到的接口自动编排成可复用、可回放的造数场景。
- 关联：PRJ-0001 采集（trace/接口卡）、PRJ-0002 链编排（`interface-chain` 执行器）、PRJ-0003 UI 测试（可选页面验收）。
- 参考模板：同级 checkout `../ai-dataforge-loop`（闭环思想与阶段划分），**只借鉴流程，不引入 Python/SQL**。

## 1. 背景与问题

模板 `ai-dataforge-loop` 已经证明“识别 → 参数 → 造数 → UI 验收 → 诊断 → 证据”的闭环是成立的，但它的实现里有大量 Python 业务代码、SQL 查询和硬编码映射：

- SQL 是为“接口不好用/没有接口”填坑，不是造数主路径；
- 阶段逻辑、组织映射、订单类型判断写死在代码/prompt 里；
- 新增一个业务场景要改 Python，不可持续。

本需求要把这条闭环**用 TypeScript 重新实现**，并且：

1. **纯 HTTP 接口造数**：目标系统的数据读写只通过接口，不查询目标库；
2. **无硬编码**：业务值、阶段、URL、字段都不进 TS 代码；配置与 lookup 在运行时解析；
3. **采集驱动自动编排**：从真实操作 trace 自动生成 `interface-chain` 草稿，而不是让 agent 从零手写；
4. **同一个 agent**：不新增第二个 agent、不做表单驱动的“数据工坊”。

当前缺口：采集已经能存请求/响应样本和接口卡，但没有“trace → 编排草稿”的分析器；`dataforge_run` 仍依赖外部 Python 引擎。

## 2. 目标与非目标

### 2.1 目标

| 编号 | 目标 | 衡量方式 |
|---|---|---|
| G1 | 一次真实操作 → 自动生成可执行编排草稿 | 给定 captureId，产出 `interface-chain` 草稿，覆盖率/置信度报告可读 |
| G2 | 新增业务场景不改 TS | 新场景只改 YAML（接口/绑定/断言/清理）即可执行 |
| G3 | 纯接口造数 | 运行期无 SQL、无 Python；所有目标系统访问都是 HTTP |
| G4 | 业务值运行时解析 | 组织/供应商/物料等通过 lookup 从接口或页面获取，带来源与缓存 |
| G5 | 同一个 agent 完成闭环 | 对话中完成目标 → 草稿审阅 → 确认 → 执行 → 诊断，不跳转第二个 agent |
| G6 | 可追溯 | 每次运行有 `runId`、步骤事件、输入输出、证据；失败可定位到步骤 |

### 2.2 非目标（本期不做）

- 不承诺“一键零修改生成完美编排”；目标是**高置信度草稿 + agent 少量审阅**；
- 不做目标库 SQL 查询/写入（接口缺失时如实标记，不引 SQL 回退）；
- 不做原生 App 自动化（Web 浏览器之外的端后续单独立项）；
- 不做表单驱动的数据工坊主入口；面板只做进度/结果/证据查看；
- 不重写 UI 测试引擎（复用 PRJ-0003 的 `UiBrowserEngine`）；
- 不做多 trace 的自动合并（放到后续版本，先支持单 trace）。

## 3. 角色与场景

### 3.1 角色

| 角色 | 职责 |
|---|---|
| 测试人员 | 给业务目标/截图/SOP；确认参数与写操作；看结果与证据 |
| 同一个 agent | 理解目标、追问缺参、调 `dataforge_lookup`、生成/审阅编排、执行、诊断 |
| dataforge TS 运行时 | trace 读取、自动分析、草稿生成、链执行、lookup、断言、清理、证据 |
| 目标系统 | 只通过 HTTP 接口被访问 |

### 3.2 核心场景

1. **S1 采集真实操作**：agent 驱动浏览器完成一次业务操作，trace 记录请求/响应序列；
2. **S2 自动生成草稿**：`dataforge_chain_draft(captureId)` 输出 `interface-chain` + 覆盖率/置信度；
3. **S3 agent 审阅**：补输入、补断言、接 lookup、确认写操作；
4. **S4 执行与复用**：保存版本，换输入重跑；失败按步骤诊断；
5. **S5 多阶段闭环（后续）**：多个链/UI 验收组合成 `data-scenario`。

## 4. 总体方案与原则

```text
真实操作（agent/人）
  → capture trace（请求/响应/顺序/页面）
  → 分析器（序列 / 字段流转 / 输入输出 / 写操作 / 断言候选）
  → interface-chain 草稿（节点/边/绑定/断言/输入）
  → agent 审阅 + lookup + 确认
  → 现有 TS chain 执行器（纯 HTTP）
  → runId / 证据 / 数据集
```

原则：

1. **先链后场景**：单次 trace 先产出 `interface-chain`（现有执行器可直接跑）；多链/UI 验收再用 `data-scenario` 包装；
2. **分析规则通用**：只依赖 HTTP 方法、序号、JSON 值匹配、JSONPath，不出现业务名称；
3. **配置即业务**：接口卡、lookup、链/场景、断言、清理都在 YAML；
4. **运行时不猜**：低置信度绑定、缺失输入、未覆盖调用一律进 warning，由 agent/用户确认；
5. **写操作必须确认**：草稿生成不执行；执行前有计划卡与确认闸。

## 5. 交付步骤（5 个功能步骤 + 1 个迁移收口，共 6 步）

| 步骤 | 名称 | 依赖 | 产出 |
|---|---|---|---|
| S1 | Trace 摄取与可读 | 采集已有数据 | `dataforge_trace_get` + trace 模型 |
| S2 | 自动编排分析 | S1 | 序列/绑定/输入输出/覆盖率报告 |
| S3 | 链草稿生成与校验 | S2 | `interface-chain` YAML 草稿 + warning |
| S4 | agent 工具与执行 | S3 | 草稿审阅/保存/运行/状态；确认闸 |
| S5 | 闭环增强 | S4 | lookup、断言、清理、UI 验收、数据集、证据 |
| S6 | 旧路径下线 | S4 | 移除 Python/SQL 依赖；迁移配置 |

> 说明：S6 不是新功能，是迁移收口；如果按“功能步骤”算，是 **5 步**，全流程收口算 **6 步**。

### S1 · Trace 摄取与可读

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-1.1 | `dataforge_trace_get(capture_id)` 返回有序样本：`seq/ts/method/url/status/pageUrl/request/response/truncated` | P0 |
| FR-1.2 | 响应体/请求体按现有采集落盘读取；敏感头（authorization/cookie）只报名称，不返原文 | P0 |
| FR-1.3 | 样本与接口卡关联：能拿到 `cardId`/`mergeKey`，供草稿引用 | P0 |
| FR-1.4 | 可选动作标注：与 UI 录制/浏览器操作时间对齐，给步骤附 `actionLabel`（点击提交/填写表单） | P1 |
| FR-1.5 | trace 统计：总请求、去重后接口数、写操作数、页面数、截断数 | P0 |

**验收**：任取一个真实 capture，`trace_get` 输出顺序与采集 `seq` 一致；敏感值不出现；截断样本有 `truncated` 标记；测试覆盖坏/空 capture。

### S2 · 自动编排分析

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-2.1 | 按 `seq` 排序并合并同一接口的重复调用；短时间轮询识别为 polling | P0 |
| FR-2.2 | 标记写操作（POST/PUT/PATCH/DELETE）与只读接口 | P0 |
| FR-2.3 | **字段流转推断**：后请求中的值若来自前响应字段，生成绑定边（from 节点/路径 → to 节点/路径），附 confidence | P0 |
| FR-2.4 | 识别场景输入：未被前序响应产生、在请求中出现的值；识别输出：最终响应中的单号/状态字段 | P0 |
| FR-2.5 | 生成断言候选：HTTP 2xx + 业务成功码（从响应结构归纳 `code=0`/`success=true` 等） | P1 |
| FR-2.6 | 输出分析报告：覆盖率（草稿覆盖的业务调用 / trace 调用）、低置信度绑定、无法解析的字段、缺失输入 | P0 |

**验收**：用至少 3 条真实 trace 做 fixture；绑定推断在 fixture 上 precision ≥ 0.8、recall ≥ 0.7；所有低置信度/缺失项都有 warning；分析代码无业务名称/URL/字段硬编码。

### S3 · 链草稿生成与校验

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-3.1 | 草稿格式为 `interface-chain`（复用现有链 schema/执行器）；节点引用接口卡 `cardId` | P0 |
| FR-3.2 | 按 trace 顺序生成节点与边；字段流转生成绑定边；常量/输入写入 `constants`/`inputs` | P0 |
| FR-3.3 | 生成 `inputs` 声明（名称/类型/必填/示例）、`outputs`、断言骨架 | P0 |
| FR-3.4 | 校验：缺绑定、环、必填未填、卡片不存在、写操作未确认；错误指到 `nodes[i]`/`edges[j]` | P0 |
| FR-3.5 | 草稿只落“草稿区/新版本”，不自动执行；保存需显式 `dataforge_chain_upsert` | P0 |
| FR-3.6 | 覆盖率报告与 warning 随草稿返回；低置信度项默认注释/标记，不静默采纳 | P0 |

**验收**：真实 capture 生成草稿可通过链校验；覆盖率 ≥ 0.8（业务调用口径）；未覆盖调用列明；删掉 Python 后仍能生成/校验。

### S4 · agent 工具与执行

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-4.1 | 工具面：`dataforge_trace_get`、`dataforge_chain_draft`、`dataforge_chain_upsert`、`dataforge_chain_run`（复用）、`dataforge_chain_runs` | P0 |
| FR-4.2 | 同一个 agent：草稿生成后由 agent 审阅/补参/接 lookup；不引入第二个 agent | P0 |
| FR-4.3 | 三道闸：必填 → 计划卡（含写操作数/目标 host/输入来源）→ 用户确认后执行 | P0 |
| FR-4.4 | 后台 job + NDJSON 进度 + 取消；`runId` 可查询 | P0 |
| FR-4.5 | 执行只走 TS `interface-chain` 执行器；运行期无 Python、无目标库 SQL | P0 |
| FR-4.6 | 运行留痕：`run.json` / `events.ndjson` / 失败证据；输出结构化 | P0 |

**验收**：mock HTTP 服务上跑通“草稿 → 审阅 → 保存 → 确认执行 → 结果”；确认缺失时零请求；无 Python 进程；无 SQL 调用；失败步骤可定位。

### S5 · 闭环增强

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-5.1 | `dataforge_lookup`：按接口卡或页面查组织/供应商/物料等映射，缓存 + TTL + 来源 | P0 |
| FR-5.2 | 链级断言：JSONPath equals/contains/exists、状态码；支持轮询/重试直到成功 | P0 |
| FR-5.3 | 清理（cleanup）：声明式清理链/步骤，支持 `onFailure/always/manual` | P1 |
| FR-5.4 | UI 验收（可选）：复用 `UiBrowserEngine` 执行 ui-script，截图进证据 | P1 |
| FR-5.5 | 数据集：场景输出 → `dataset/<runId>.json`，供后续链/UI 测试复用 | P1 |
| FR-5.6 | 证据包：`report.html` + `summary.json`（阶段/步骤/输入/输出/失败） | P1 |
| FR-5.7 | 面板只读视图：运行历史、阶段进度、证据链接（不做主入口） | P2 |

**验收**：lookup 从 mock API 取值并记录来源；断言失败即停；cleanup 在失败时执行；UI 验收成功/失败都有截图；数据集可被下一链读取。

### S6 · 旧路径下线（迁移收口）

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-6.1 | 移除 `spawn dsh_bridge.py` / `engineRoot` 依赖；不再要求 Python | P0 |
| FR-6.2 | 移除目标库 SQL 执行路径；代码中不出现目标 SQL | P0 |
| FR-6.3 | 移除硬编码业务映射/阶段/URL/字段；加静态检查或 grep 门禁 | P0 |
| FR-6.4 | 旧 Flow Pack/Python 配置迁移为接口卡 + 链/场景；`dataforge_run` 标记 legacy 并最终删除 | P1 |
| FR-6.5 | 文档/README/配置示例同步；旧路径不再出现在新手指引 | P1 |

**验收**：仓库全文 grep `dsh_bridge|spawn.*python|sql_query` 归零（历史文档除外需标注）；新环境不装 Python 可跑通 S4；配置迁移清单完成。

## 6. 数据模型与文件布局

### 6.1 Trace（只读投影）

```ts
type TraceSample = {
  seq: number
  ts: number
  method: string
  url: string
  status?: number
  pageUrl?: string
  requestHeaders: Record<string, string>
  requestBody?: string
  responseHeaders: Record<string, string>
  responseBody?: string
  truncated?: boolean
  cardId?: string
  mergeKey?: string
  actionLabel?: string
}
type Trace = { captureId: string; entryUrl: string; samples: TraceSample[] }
```

### 6.2 草稿/链文件

```text
<workspace>/.dsh/dataforge/chains/<site>/<flow>/v<n>.yaml
```

草稿与正式版本同 schema；草稿先返回给 agent 审阅，不落盘或落到草稿区，确认后 upsert。

### 6.3 运行留痕

```text
<dataRoot>/runs/<runId>/run.json
<dataRoot>/runs/<runId>/events.ndjson
<dataRoot>/datasets/<runId>.json        # P1
<dataRoot>/evidence/<runId>/report.html # P1
<dataRoot>/evidence/<runId>/screenshots/
```

### 6.4 lookup 配置与缓存

```text
<workspace>/.dsh/dataforge/lookups/<name>.yaml   # 只声明怎么查
<dataRoot>/lookups/<site>/<name>.json            # 值 + source + fetchedAt
```

## 7. 验收判据（整体）

| 判据 | 证据 |
|---|---|
| 真实 capture → 草稿 → 换输入执行成功 | 端到端 fixture + 一次真实测试环境验证 |
| 新增场景只改 YAML | 同一周内新增第二场景，无 TS diff |
| 纯接口 | 运行日志无 SQL、无 Python 子进程 |
| 无硬编码 | 静态检查：无业务名称/URL/字段常量；lookup 运行时取值 |
| 业务值可追溯 | lookup 返回 source/fetchedAt；运行回执展示来源 |
| 写操作有闸 | 无 confirm 时零请求 |
| 失败可诊断 | 失败步骤、错误、证据齐全 |

## 8. 风险与边界

| 风险 | 处理 |
|---|---|
| 字段流转推断误判/漏判 | confidence + warning；agent 审阅；fixture 持续回归 |
| 加密/计算/随机字段（token、签名） | 标记不可推断，配置派生或由 agent 处理；不猜 |
| 异步/轮询/并行 | 先串行化（seq）；polling 识别为 retry/until；并行后续再做 |
| 无可用 API（只有 UI/DB） | 标记 unsupported；UI 验收兜底；不引 SQL |
| 响应体截断/缺失 | `truncated` 标记；warning；必要时重新采集 |
| 登录/验证码/多账号 | 复用采集登录态；lookup/环境 profile；不硬编码账号 |
| 清理接口不存在 | 明确提示“无清理方案”；不假装清理成功 |
| 自动生成质量不足 | 定位为草稿；agent 审阅为必经步骤；不承诺零修改 |

## 9. 开放问题

1. 动作标注（FR-1.4）从 UI 录制对齐，还是先只靠请求序列？建议先只靠序列，动作标注作为增强。
2. 自动草稿落 “草稿区” 还是直接作为新版本候选？建议先只返回、不落盘，确认后 upsert。
3. `dataforge_run` / Flow Pack 的退役时间窗？建议 S4 通过后立即标记 legacy，S6 删除。
4. 多 trace 合并、跨系统阶段（SRM+SAP）何时做？建议 S5 之后单独版本。
5. UI 验收是否纳入每个造数场景，还是按需开启？建议按需（配置里一个 `ui` 节点）。

## 10. 实现进展（S1/S2，2026-10-18）

- **S1 已实现**：
  - `dataforge_trace_get(capture_id, limit?, body_limit?)`：只读采集库，按 `seq` 返回样本；
  - 正文读取顺序：落盘文件 → DB 预览 → 缺失；`requestBodySource/responseBodySource` 与 `*Truncated` 如实标注；
  - 敏感头只返回名字（`sensitive`），值不进入回执；正文按敏感键脱敏后回执；
  - 代码：`src/trace/{types,read,application}.ts`；测试：`test/trace/read.test.ts`、`test/trace/tools.test.ts`。
- **S2 已实现**：
  - `dataforge_trace_analyze(capture_id, limit?)`：序列/连续重复合并/polling、写操作、字段流转绑定、输入/常量/输出、断言候选、覆盖率与 warning；
  - 绑定路径为 `节点.body...` / `节点.query...`，带 confidence；低置信度、动态值、截断/非 JSON 正文进 warning；
  - 规则只用 HTTP 方法、序号、JSON 值匹配、路径提取；代码：`src/trace/analyze.ts`。
- **fixture**：`test/fixtures/trace/` 下 3 条公开页面真实 capture 的前 20 条样本（敏感头脱敏），用于真实形状冒烟；
  合成 JSON fixture 用于绑定 precision/recall（当前 2/2 全命中，precision=1.0、recall=1.0）。
- **真实数据观察**：部分真实 capture 的正文是 preview/加密/截断，`body-truncated` 与 `*-body-unparsed` warning 会阻止绑定推断；这是 S3 前要补的采集正文完整性问题（S1.5，见开放问题）。
- **测试**：`pnpm typecheck` ✅；`pnpm test` ✅ 78 files passed / 774 tests passed / 7 skipped（含 trace 4 个测试文件）。
- **S3 已实现**：
  - `dataforge_chain_draft(capture_id, site?, flow?, domain?, note?, limit?)`：按 `mergeKey` 匹配项目接口库卡，生成 `interface-chain` 草稿；
  - 节点引用 `cardId`；binding 转 edges；未绑定字段转 `$inputs.<name>`（不把 trace 业务值写进 YAML）；断言转 `expect`；输出候选随结果返回（链 schema 暂无顶层 outputs）；
  - 草稿跑现有 `validateChain`，不落正式版本、不执行；缺卡/缺必填入参/模板缺字段进 warning；
  - 代码：`src/trace/draft.ts`；测试：`test/trace/draft.test.ts`（cardId/edges/$inputs/校验/业务值不落盘/缺卡 warning）。
- **S4 已实现/验证**：
  - 复用现有 `dataforge_chain_upsert`（草稿 YAML → v1）+ `dataforge_chain_run`（无 confirm 计划卡、零请求；确认后执行）；
  - 新增 mock HTTP 端到端测试：草稿 → upsert v1 → 计划卡（服务端收到 0 请求）→ 确认执行（3 个请求按 DAG 顺序成功）；测试 `test/trace/s4-e2e.test.ts`；
  - 系统策略加入 `dataforge-trace`：草稿不执行、`$inputs` 不写死、写操作必须确认。
- **S5 已实现（部分）**：
  - `dataforge_lookup`：`source.kind: api`（GET/HEAD）items/match/map 声明式；`source.kind: page` 走 Playwright 只读选择器（items/label/map，不注入登录态）；缓存 `dataRoot/lookups/<site>/<name>.json` + TTL + source/fetchedAt；`refresh=true` 强制刷新；凭证用 `${ENV}`；未装配 pageReader 时如实 `page-lookup-unavailable`；
  - `dataforge_dataset_export`：读 run 留痕（不重跑）→ `datasets/<runId>.json` + `evidence/<runId>/report.html`（businessData + 状态 + 链身份，不含请求头原文）；
  - 多字段断言：`ChainNode.expects?: ChainExpect[]`（与 `expect` 叠加，全部满足才通过）；S4 e2e 用 code+status 两条验证；
  - cleanup：`ChainDoc.cleanup`（when onFailure/always + 清理链 + `$inputs`/`$result.outputs` 入参）；清理链进主计划卡确认，主链失败/结束后执行，清理失败不覆盖主链；禁止清理链自引用；
  - businessData 增加 `outputs`（节点卡声明的全部出参），供 cleanup 结果绑定与 dataset；S4 e2e 追加 dataset/evidence/多断言断言；
  - UI 验收证据：UI run 成功落 `success.png`、失败保留 `failure.png`/`failure.html`；`dataforge_dataset_export` 支持 UI run，生成步骤/断言 dataset + 截图报告；
  - 链级 `verify`：随主链计划卡确认，主链后、cleanup 前执行；onSuccess/onFailure/always；`$inputs`/`$result.outputs` 绑定；verify 失败不覆盖主链；verify 的 UI run 自动导出 dataset/evidence；测试 `test/orchestration/verify.test.ts`；
  - 面板只读「运行产物」：`GET /artifacts` 列表（kind/status/q/limit/offset 筛选分页）+ report/dataset/asset 直链；新增 `src/client/page-artifacts.tsx` 与 `src/datasets/panel-routes.ts`；
  - 测试：`test/lookup/lookup.test.ts`、`test/orchestration/cleanup.test.ts`、S4 e2e。
- **真实公网 E2E 已跑通**：`jsonplaceholder` 只读闭环（capture → trace 草稿 → 链执行 → 真实 Chrome verify → dataset/evidence），记录见 `docs/e2e/jsonplaceholder/README.md`；测试默认跳过，`E2E_REAL=1` 开启。
- **S5 未做（下一轮）**：真实内部测试环境完整闭环、verify/cleanup 产物联动展示。
- **测试统计**：78 files passed / 774 tests passed / 7 skipped。

## 11. 变更历史

- 2026-10-18 初稿：基于 `ai-dataforge-loop` 闭环模板与“全 TS / 纯接口 / 无硬编码 / agent 驱动”约束，确定 5 个功能步骤 + 1 个迁移收口、trace → chain 草稿的自动编排路线。
- 2026-10-18 S1/S2 实现：`dataforge_trace_get` / `dataforge_trace_analyze`、只读 trace、通用分析器、真实 capture fixture 与单测；S3 待做。
