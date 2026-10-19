---
title: 执行引擎（拓扑调度 + HTTP 直调）· R-3 设计
status: draft
owner: kakaCat
reviewers: 待定
prd: docs/projects/PRJ-0002/requirement/r3-execution-engine.md
serves: FR-3.1、FR-3.2、FR-3.3、FR-3.4、FR-3.5、FR-3.6
created: 2026-10-17
updated: 2026-10-17
---

# 执行引擎（拓扑调度 + HTTP 直调）· R-3 设计  serves: FR-3.1～FR-3.6

## 摘要  serves: 全文

- **问题**：链到现在只是「能校验的项目资产」，没有任何东西能把它变成真实请求；采集期立下的「浏览器只在采集段」边界缺一条落地路径。
- **方案**：读 `kind: interface-chain` 的链文件，复用 `src/chains/validate.ts` 已导出的 `topoOrder` / `dependencyPairs` 排依赖，按「卡入参模板 + 节点常量 + 绑定边 + 链级槽位」构造请求，用 Node 22 内置 `fetch` 逐节点直调；每步写 `dataRoot/runs/<runId>/events.ndjson`，长链走宿主 `ctx.jobs`。
- **影响面**：新增 `src/execute/*`（计划/请求/绑定/HTTP/调度）、2 个 agent 工具（`dataforge_chain_run`、`dataforge_chain_runs`）并扩展 `dataforge_status`；`src/application.ts` 增加执行装配；`src/runs/store.ts` 与 `src/shared/types.ts` 做向后兼容的小扩展。**不改** R-1 的 `chains/schema.ts` / `chains/validate.ts` 导出面，不新增 npm 依赖，不新增数据库。

## 背景与问题  serves: 全文

### 需求来源

| 需求编号 | 原始诉求 | 本设计如何回应 |
|---|---|---|
| FR-3.1 | 拓扑调度：绑定即依赖，无依赖节点并发，遇环兜底报错 | 直接调用已导出的 `topoOrder(doc)`（Kahn，返回 `{order, cycle}`）与 `dependencyPairs(doc)`（`from` 为 `$inputs.` 的槽位边已被跳过，不构成节点依赖）；运行时按 indegree 就绪队列并发，不自造排序算法 |
| FR-3.2 | 按卡 URL 模板 + 入参模板拼 query/body/header，缺必填入参即停 | 请求构造器 `buildRequest()`；缺参判据见 §数据模型·缺参判据（**不看卡上的 `required`**），预检阶段就不发请求 |
| FR-3.3 | 从上游响应体按声明路径取出参，类型/路径不符如实报错 | 绑定求值器 `resolveBinding()`：支持 `body.items[0]` 与 `body.items[*]`，错误指到具体绑定边 |
| FR-3.4 | 运行挂在链下，每节点记请求/响应摘要/耗时/状态，即写即落盘 | 复用 `dataRoot/runs/<runId>/`：`run.json` 加 `chain` 段，节点粒度写 `step` 事件；新增按链查询的运行列表 |
| FR-3.5 | 节点失败默认中止链；节点级重试/超时消费 R-1 预留位 | 中止语义 + `node.retry` / `node.timeoutSeconds` 消费；默认 `retry: 0`、超时 30s，写进 §失败模式与回滚 |
| FR-3.6 | 长链走宿主后台 job，状态可轮询、可取消 | 复用 `application.ts` 的 `resolveJobs()` 装配（`JobsLike` 形状），`job.done` 收敛为运行终态；取消走宿主 job 取消 + AbortController |

### 现状与代价

今天链的消费终点是 `dataforge_chain_get`：读回 YAML、人眼读节点与边，然后**手工回放**——打开上一个接口的响应，把字段值复制进下一个接口，再逐个发请求。代价是结构性的：

- 值传递靠手抄，抄错一位就得到「看起来成功」的脏数据，且没有任何记录能证明传的是哪个值；
- 节点一多，人工回放的步骤数随节点数线性增长，回归不可重复；
- 失败没有诚实落点：谁失败、HTTP 多少、响应长什么样，全靠当时那一眼；
- R-4（凭证注入）、R-5（探索执行）、R-6（复跑/结晶）都在等一个「有运行记录的执行面」，没有它三条需求都无法验收。

出处：R-3 需求 §1/§2/§5（G1～G4 与验收判据）、PRJ-0001 需求 G4（卡片结构化就是为了给编排消费）。具体人工回放耗时未做计时采样，**未验证**，不写数字。

### 为什么是现在

第二期依赖拓扑里，R-1 已冻结链与卡的契约（`apiVersion: dataforge/v1`），R-2 画布与 R-3 引擎是并行下游；再往后 R-4/R-5/R-6 全是「在本引擎之上叠加一种驾驶方式」。现在不做，后续三条需求只能继续拿桩件拼，契约会在真实 HTTP 语义（超时、错误分类、响应摘要）上返工——这些语义必须在第一次真实执行时就定下来，否则每次叠加都要重谈。

## 目标与非目标  serves: 全文

### 目标

- 一条 ≥3 节点、含绑定边的无登录态链，经 `dataforge_chain_run` 直跑成功；上游出参值与下游实际发出的入参逐条可核对（运行记录里两侧都有）；
- 全程无浏览器进程启动（验收用进程列表断言，不靠自述）；
- 并行分支真实并发：链中两个无依赖节点同时发出，整链耗时 ≈ 较慢者 + 调度开销，而非两者之和；依赖未满足的节点在记录里**没有** `step` 事件；
- 节点 4xx/5xx/超时/网络错误 → 链中止，运行记录给出失败节点 ID、错误码、HTTP 状态、响应摘要，且已跑节点的结果仍可读；
- 缺参在**发出任何请求之前**被拒，回执逐条列出「节点 + 卡字段路径 + 类型」，不出现空值请求（单测断言请求体/查询串里没有空值键）；
- 长链以宿主后台 job 运行：`dataforge_status` 可轮询到节点级进度，`job_kill` 后运行在节点边界内收敛为 `killed`，不留下悬挂的 `running`。

### 非目标

- **不做凭证注入 / 401 换票（R-4）**：引擎只投影 `card.auth` 标志；缺凭证时不发空值、不冒充、不重试换票，401 如实记为 `node-auth-required` 并提示 R-4。现在做会把「凭证从哪来」的决策提前锁死。
- **不做 agent 在环试探（R-5）**：本引擎是确定性执行器，不在失败处插入模型决策或参数试探；试探是 R-5 的驾驶方式，叠在本引擎之外。
- **不做结晶与槽位替换语义（R-6）**：本期只**消费**已声明的 `$inputs.<name>` 与节点常量；谁在什么时候把值写进槽位、如何从一次成功运行结晶出常量，全部留给 R-6。
- **不做条件边 / 分支判断**：R-1 的边只有「绑定即依赖」一种语义，引入条件会让拓扑、缺参判据、失败语义同时翻倍；本期一条链只有一种执行路径。
- **不做画布 / 可视化（R-2）**：本期不交付任何前端；「链详情·运行 tab」只交付数据面（`run.json.chain` + `dataforge_chain_runs`），由 R-2 或后续面板消费。
- **不开浏览器**：执行段只用 Node 22 内置 `fetch`，不 import `capture/browser.ts`，不申请 Chrome 通道；浏览器只属于采集阶段。
- **不新增 npm 依赖**：不引 undici、axios、p-limit、ajv 之类；并发与重试都是几十行本地逻辑。
- **不做批量数据驱动**：目标路径里的 `[*]` 一律视为 `[0]`（单元素），一条链一次运行只发一套请求；多行循环留给后续需求。

## 方案总览  serves: FR-3.1

**一句话方案**：把链编译成一张「节点 + 就绪依赖 + 每节点入参覆盖表」的执行计划，按就绪队列并发直调 HTTP，节点的出参经绑定边进入下游入参，全过程以 runs 事件流为唯一事实源。

```text
dataforge_chain_run(site, flow, version?, inputs?, baseUrl?, dryRun?, confirm?)
        │
        ▼
loadChain()  ── 非 interface-chain ──► not-executable（先走 R-1 编译成草稿并落盘）
        │ ok
        ▼
buildPlan()  ← topoOrder(doc) / dependencyPairs(doc) / card.inputs / fieldSegments()
        │        ├─ 环 → cycle（兜底，R-1 正常已拒）
        │        ├─ 静态缺参 → missing-params（一个请求都不发）
        │        └─ baseUrl 不可解析 → base-url-unresolved
        ▼
dryRun? ── 是 ──► 返回计划（请求骨架 + 缺参 + 写方法清单），不发请求，仍落 run
        │ 否 + confirm
        ▼
scheduler（就绪队列，并发 ≤ concurrency，默认 4）
        │  节点：buildRequest → httpRequest（超时/重试）→ 解析 → resolveBinding 出参
        │  成功 → 下游 indegree-1；失败 → 停止调度、等在飞落定
        ▼
runs/<runId>/events.ndjson（meta → step×N → terminal → result）
        │
        ├─ 前台：返回 RunSummary
        └─ 后台：ctx.jobs（jobId 可 job_output / job_kill）
```

**关键概念**：

- **执行计划（ExecutionPlan）**：节点的拓扑序、每个节点的入参覆盖表（常量/绑定/槽位/凭证豁免）、静态缺参清单、目标 baseUrl；纯函数产物，dry-run 与真实执行共用。
- **入参覆盖（coverage）**：某个卡入参路径是否已被节点常量或绑定边赋值；**判据不看 `required`**，见下节。
- **绑定值（binding value）**：上游节点响应经 `resolveBinding()` 取出的值，连同来源路径一起进运行记录。
- **节点结果（NodeResult）**：一次节点执行的全部事实（请求摘要、响应摘要、耗时、尝试次数、错误码），只存在于事件流与内存，不建表也不建新目录。

## 架构与依赖  serves: FR-3.1、FR-3.4、FR-3.6

- **模块划分**（全部新增在 `src/execute/`，一个模块一件事）：
  - `plan.ts` → 纯函数：`buildPlan(doc, cards, inputs, baseUrl?)`；调 `topoOrder`/`dependencyPairs`/`fieldSegments`/`isInputSlotRef`，产出拓扑序、indegree、静态缺参、每卡 baseUrl；**不实现第二套拓扑**。
  - `coverage.ts` → 纯函数：常量/绑定/槽位的覆盖判定与类型校验（`normalizePath` 统一走 `fieldSegments(path).join('.')`，与 R-1 校验同一把尺）。
  - `request.ts` → 纯函数：`buildRequest(plan, node, card, provided, baseUrl)`，处理 `{p}` 位置替换、query 覆盖、header、body 组装与 JSON 序列化。
  - `binding.ts` → 纯函数：`resolveBinding(root, path, expectedType)`；路径求值（`[n]` / `[*]`）、类型校验、单元素解包。
  - `http.ts` → `httpRequest()`：Node 22 `fetch` 的唯一封装（超时、重试、正文上限、头脱敏、重定向策略）。
  - `run.ts` → 调度器 `runChain(deps, exec, plan, options)`：就绪队列、并发、取消、事件写入、`NodeResult` 汇总。
- **依赖方向**：`tools.ts` → `orchestration/application.ts` → `execute/run.ts` → `execute/{plan,request,binding,http}.ts` → `chains/{schema,validate,store}.ts` + `runs/store.ts`；`application.ts` 只负责注入 `config` / `resolveJobs` / `resolveWorkspaceRoot`。`execute` **不依赖** `capture/`、`library/`、`client/`，杜绝环。
- **外部依赖**：Node 22 内置 `fetch`（全局，无新包）、`node:crypto`（runId 后缀可选）、`js-yaml`/`schemastery`（R-1 已在，仅间接用）。需求 Q1 已决：**统一封装 `httpRequest()`（内置 fetch），不直接用 undici，也不引第三方 client**——执行语义（超时、错误分类、截断、脱敏）必须收在一处。启动时做能力探测（`typeof fetch === 'function'` 且 `typeof AbortSignal.timeout === 'function'`），不满足才报 `execution-unavailable`，不做 polyfill。接口库/链文件缺席时如实报 `chain-not-found` / `card-not-imported`，不降级成「猜字段」。
- **长跑与后台 job 装配**：执行一律先取 `deps.resolveJobs()`（与 `src/application.ts` 的 `startRunJob` 同一个注入缝，`JobsLike { start(spec) }`）。在场则以 `kind: 'dataforge-chain'`、`owner: exec.agent.id`、`outputLimitBytes: 65536` 起 job，`job.append` 逐节点推进度，`job.done` 由 `terminal`/`result` 收敛；不在场则前台降级，用 `config.timeoutSeconds` 兜底并在回执标 `degradedNotice`（宿主补装配后自动恢复后台路径，不改执行代码）。取消：宿主 `job_kill(jobId)` 触发 spec 的 `cancel()` → AbortController → 在飞请求 abort。
- **与既有架构的差异**：这是插件里**第一个直接向外部站点发 HTTP 的模块**（此前只有采集期浏览器与 python 桥）。因此安全面单列：`credentials: 'omit'`、禁止继承 cookie jar、头脱敏、响应正文截断、执行开关。其余（文件为资产、runs 为留痕、工具只做渲染）全部沿用既有纪律。

## 数据模型  serves: FR-3.2、FR-3.3、FR-3.4

### 运行记录：复用 `dataRoot/runs`，不新建存储

结论：**复用** `runs/store.ts` 的目录式留痕，不引入 SQLite（回答需求 Q2）。理由：`startRunRecord` / `appendEvent` / `loadRunEvents` / `foldSummary` / `listRunIds` 已经覆盖「即写即落盘 + 状态折叠 + 重启回看」，链运行与流程运行在留痕上是同一件事。新增的只有 `run.json` 的一个可选段与 `step` 事件的数据形状。

```jsonc
// dataRoot/runs/<runId>/run.json（写入一次，先于首个请求）
{
  "runId": "chain-采购下单-1729150000000",
  "kind": "chain-run",
  "flow": "采购下单",              // 沿用现有键，foldSummary/status 无需改
  "flowName": "采购下单",
  "chain": {
    "site": "智慧供应链 SCM",
    "flow": "采购下单",
    "version": 3,
    "path": ".dsh/dataforge/chains/智慧供应链-SCM/采购下单/v3.yaml",
    "apiVersion": "dataforge/v1"
  },
  "params": { "materialCodes": ["M-1"], "keyword": "螺丝" },
  "baseUrl": "https://scm.example.com",
  "dryRun": false,
  "planned": ["query-material", "query-detail", "create-order"],
  "concurrency": 4,
  "startedAt": 1729150000000
}
```

事件流仍只认 `events.ndjson`（唯一事实源），节点粒度：

```jsonc
{"event":"meta","flow":"采购下单","name":"采购下单","steps":["query-material","query-detail","create-order"],"dryRun":false}
{"event":"step","id":"query-material","action":"GET /api/materials?q=螺丝","status":"start",
 "data":{"card":"card_000123","attempt":1,"request":{"method":"GET","url":"https://scm.example.com/api/materials?q=%E8%9E%BA%E4%B8%9D","headers":{"accept":"application/json"}}}}
{"event":"step","id":"query-material","status":"done","elapsed":123,
 "data":{"response":{"status":200,"bytes":812,"truncated":false,"bodyPreview":"{\"items\":[{\"internalId\":\"M-1\"}]}"},
         "emitted":{"body.items[*].internalId":"M-1"}}}
{"event":"terminal","success":false,"cancelled":false,"message":"链在第 2 步「create-order」失败：HTTP 500"}
{"event":"result","success":false,"businessData":{"chain":{"site":"智慧供应链 SCM","flow":"采购下单","version":3},"failedNode":"create-order","completed":["query-material","query-detail"],"nodes":[]}}
```

- **实体与字段**：
  - `ChainRunMeta`（`run.json`）→ `kind: 'chain-run'`、`chain.{site,flow,version,path,apiVersion}`、`params`、`baseUrl`、`planned[]`、`concurrency`、`dryRun`；
  - `NodeResult`（仅事件/内存）→ `nodeId`、`cardId`、`method`、`url`、`status: done|error|skipped|cancelled`、`httpStatus?`、`attempts`、`elapsedMs`、`errorCode?`、`error?`、`requestDigest`、`responseDigest?`、`bindings[]`、`truncated?`；
  - `RunSummary`（`shared/types.ts`）→ 增加可选 `chain?: { site, flow, version, failedNode?, completedNodes? }`，投影只读 `run.json` 与事件。
- **约束与不变量**：
  - `run.json` 在**第一个请求之前**落盘；崩溃时至少留下计划与目标；
  - 每个节点恰好一条 `step(status:start)` 与一条终态（`done` 或 `error`）；`skipped` 节点**不发** `step` 事件，只进 `result.businessData`——避免被 `foldSummary` 误算成失败节点；
  - 事件 append-only；`responseDigest.bodyPreview` ≤ 4 KiB、`requestDigest.bodyPreview` ≤ 4 KiB，响应解析上限 `chainResponseLimitBytes`（默认 2 MiB）；
  - 任何文件都不写凭证值：头名命中脱敏集合（`cookie` / `set-cookie` / `authorization` / `proxy-authorization` / `x-api-key` 等）时值替换为 `***`；卡里本就不存在凭证字段（R-1 红线）。
- **缺参判据（本设计的硬规则）**：

```text
covered(node) = { normalize(k) | k ∈ node.constants } ∪ { normalize(e.to 的字段路径) | e.to.nodeId = node.id }
missing(node) = card.inputs.filter(f =>
      f.role !== 'credential'            // 凭证字段由 R-4 注入，引擎不发空值
   && !covered(node).has(normalize(f.path))
)
```

  - **`required` 不参与判据**。R-1 的卡投影里 `required = (role === 'input')`，而 `role` 只在「采集期观察到该值跨样本变化」时才为 `input`；真实单样本卡几乎全是 `role: constant` / `required: false`，拿它判缺参会把「必须给值的入参」全部放行，进而静默发空值。因此判据只看「模板里有这个入参 + 无常量 + 无绑定 + 角色不是 credential」。
  - 关于 `credential` 角色：现状 `src/library/import.ts` 在投影入参时已把 `role: credential` 的字段整条剔除（凭证只以 `auth` 标志 + 来源名表达），所以今天的卡里不会出现该角色；这条豁免是防御性的，给 R-4 扩展卡字段或未来手工卡留口子。它保证的语义不变：**没有值就不发，绝不发空值**。
  - 静态缺参（与上游响应无关的那部分）在 `buildPlan()` 里一次判完，**整链不执行**；因上游未产出而缺的值，在节点执行时以 `binding-path-not-found` / `binding-null` 中止并指到绑定边。
  - `role: credential` 且无值的入参：**不报缺参、不发空值**，只在回执与运行记录里记一条 `auth-not-injected` 提示；若服务端因此 401，按 §失败模式与回滚 处理（不换票）。
  - 链级槽位同理：被任何节点常量或边引用的 `$inputs.<name>` 没有运行值即 `missing-params`；`inputs[].required` 同样不作为判据（R-1 已禁止未引用槽位，引用即需要值）。
- **迁移与回填**：不适用——runs 是既有目录，`chain` 段是可选新增键；旧 run 的 `run.json` 没有该段，读取方按缺省处理即可。链与卡文件不改一个字节，无需回填，也不需要双写。
- **生命周期**：`startRunRecord` 建目录 → 追加 `meta` → 每节点 `step` → `terminal` → `result`；取消追加 `terminal(cancelled: true)`。留存沿用 runs 纪律：不自动清理、不自动归档，用户可按目录删除；面板/工具只读。

## 接口设计  serves: FR-3.1、FR-3.2、FR-3.3、FR-3.5、FR-3.6

| 编号 | 接口 | 输入 | 输出 | 失败与错误 | 兼容性 |
|---|---|---|---|---|---|
| IF-1 | `dataforge_chain_run`（agent 工具，唯一执行入口） | `site`、`flow`、`version?`（缺省最新）、`inputs?`（槽位值）、`baseUrl?`、`concurrency?`、`dry_run?`、`confirm?` | `accepted`、`kind`（background/foreground/dry-run）、`jobId?`、`runId`、`runDir`、`plan`（拓扑序/缺参/写方法清单/目标 host） | `missing-params` / `chain-not-found` / `invalid-chain` / `card-not-imported` / `not-executable` / `cycle` / `base-url-unresolved` / `inputs-invalid` / `confirm-required` / `execution-disabled` / `execution-unavailable` | 新增工具；入参只增不改，`apiVersion: dataforge/v1` |
| IF-2 | `dataforge_chain_runs`（agent 工具，链维度运行列表） | `site`、`flow`、`version?`、`limit?`（默认 20） | `runs[]`：`runId`、`status`、`startedAt`、`updatedAt`、`dryRun`、`stepsDone`、`totalSteps`、`failedNode?`、`version` | 无留痕 → `ok: true` + `notice`（空态不是错误）；参数缺失由工具 schema 拒绝 | 新增工具；读取时忽略 `run.json` 未知键 |
| IF-3 | `runChain()`（application 层编排函数，工具与 dry-run 共用） | `deps`、`exec`、已加载的 `ChainDoc`、`inputs`、`baseUrl`、`concurrency`、`signal` | `ChainRunResult`（`runId`、`runDir`、`summary`、`nodes[]`、`failedNode?`、`degraded`） | 预检码同 IF-1；运行期 `binding-path-not-found` / `binding-type-mismatch` / `binding-null` / `param-type-mismatch` / `node-timeout` / `node-network-error` / `node-http-error` / `node-auth-required` / `response-too-large` / `cancelled` | 内部函数，无对外版本承诺；单测直接打它，不经过工具壳 |
| IF-4 | `httpRequest()`（HTTP 直调客户端契约） | `method`、`url`、`headers`、`body`、`timeoutMs`、`retry`、`signal` | `status`、`headers`、`bodyText`、`json?`、`bytes`、`truncated`、`attempts`、`elapsedMs`、`finalUrl` | `timeout` / `network-error` / `aborted`；正文超限不算错误，标 `truncated: true` | 仅 Node 22 内置 fetch；不新增依赖，未来换实现不改签名 |
| IF-5 | `resolveBinding()`（绑定求值） | 响应根 `{body,status,headers}`、`path`、`expectedType`、`sourceNode` | `{ value, matched, unwrapped? }` | `path-not-found` / `type-mismatch` / `null-value` / `empty-wildcard` | 路径语法是 R-1 绑定路径的子集（`[]` 视同 `[*]`），不引 JSONPath |
| IF-6 | `dataforge_status`（扩展：链运行节点级进度） | `runId?`（沿用现有签名） | `run` 增加 `chain` 段与 `completedNodes` / `failedNode`；终态支持 `killed` | `run-not-found` 沿用现有 `notice` 语义（`ok: false` + 中文提示） | 只增可选字段；旧 run、旧流程运行照常显示 |

#### IF-1 dataforge_chain_run

**语义**

唯一的执行入口。做三件事：加载并复核链（`loadChain` 会重新校验，文件被手改坏时如实报 `invalid-chain`）、编译执行计划、按计划跑。**只接受 `kind: interface-chain`**：`page-chain` 必须先在 R-1 侧经 `compilePageChain()` 编译成草稿、确认绑定后经 `dataforge_chain_upsert` 落盘成 `interface-chain`，否则一律 `not-executable`（不要在执行段偷偷补一层页面语义，那会让「执行模型只有一套」的承诺失效）。

首次调用不带 `confirm: true` 时**不发任何请求**，返回一张计划卡：拓扑序、每个节点将发的方法与 URL 骨架、写方法（非 GET/HEAD）清单、静态缺参、目标 host。`dry_run: true` 走同一计划、永不发请求，但会落一条 `dryRun: true` 的运行留痕（便于事后复查计划）。确认后 `confirm: true` 才进入执行。

`baseUrl` 解析优先级：工具入参 > 卡 `sources[].pages[]` 的 origin（多来源跨 origin 视为冲突，报 `base-url-unresolved` 并列出候选）> 失败。卡 `identity.urlTemplate` 是采集期归一化后的**相对路径**（`/api/x?q=1`），不含 origin，因此这一步不能省。

**错误码**

- `missing-params` → 预检静态缺参，回执逐条 `nodes[i] · <卡字段路径> · <类型>`，调用方补 `constants` 或绑定边后重新 upsert（**调用方不应重试同一份链**）；
- `chain-not-found` → site/flow/version 不匹配，回执带 `availableVersions`，先 `dataforge_chain_get` 核对；
- `invalid-chain` → 文件坏或校验不过，带 R-1 的 issues 原文；
- `not-executable` → `kind: page-chain`，回执提示「先编译成 interface-chain 草稿并落盘」；
- `cycle` → 兜底；R-1 的 upsert 已拒，出现即说明文件被绕过工具手改，直接拒绝执行；
- `base-url-unresolved` / `inputs-invalid`（未知槽位、槽位值类型不符）/ `execution-disabled`（开关关闭）→ 均不发请求；
- `card-not-imported` → 链引用的卡不在项目接口库（`loadChain` 会先拦成 `invalid-chain`，本条是防御兜底）；
- `execution-unavailable` → 运行时缺 `fetch` 或 `AbortSignal.timeout`（能力探测，只看能力不看 Node 版本号）；dry-run 不触发它；
- `confirm-required` → 首次调用或写类链未确认；按回执计划卡向用户转述后带 `confirm: true` 重调。
- 运行期失败不在本接口回执里「重试」：链已中止，错误进运行记录，修复后用新 run 重跑（不自动整链重放写请求）。

**兼容性**

新增工具，无旧调用方。入参字段只增不改；`inputs` 的键必须是链文件已声明的槽位名，未来若 R-6 增加槽位语义，只扩值形状不换接口。工具描述里固定写明「只接受 interface-chain」「先 dry-run 再真跑」。

**幂等与重试**

**不幂等**：同一参数重复调用就是新 run、新请求。写类节点不做自动整链重试；节点级重试由 `node.retry` 控制且只对幂等方法/网络错误生效（见 IF-4）。取消后重跑必须由用户重新确认。

#### IF-2 dataforge_chain_runs

**语义**

链详情·运行 tab 的数据面：按 `site`/`flow`（可再收窄 `version`）列运行，读 `run.json` 的 `chain` 段过滤，状态用 `foldSummary` 现折叠。现状没有链维度索引，实现为扫描 `listRunIds(dataRoot, 200)` 并读每个 `run.json`；这个量级（单项目几十到几百条运行）可接受，量级上来再加索引（见开放问题）。运行留痕与链文件解耦：链被删/改名，历史运行仍能列出（`chain` 段是写入时的快照）。

**错误码**

- 没有任何匹配运行 → `ok: true` + `notice: '该链暂无运行留痕'`（空态是常态，不是失败）；
- `site`/`flow` 缺失 → 工具 schema 直接拒绝，不进入业务层；
- 某条 `run.json` 损坏 → 跳过该条并在 `notice` 里计数，不阻断整批（与「坏 yaml 跳过不炸」同纪律）。

**兼容性**

新增工具；读取侧对未知键与缺失 `chain` 段的旧 run 一律容忍（无 `chain` 段即不属于任何链，不参与过滤）。

**幂等与重试**

只读，天然幂等。

#### IF-3 runChain

**语义**

application 层的执行编排，工具壳只负责参数与回执渲染（沿用本仓「判定全在 application 层」的纪律）。步骤：加载链 → `buildPlan()`（含 `topoOrder`、`dependencyPairs`、静态缺参、baseUrl）→ `dry_run` 直接返回计划 → `startRunRecord` 写 `run.json` 与 `meta` 事件 → 就绪队列调度 → 每节点 `buildRequest` / `httpRequest` / `resolveBinding` → 汇总 `terminal` 与 `result`。

调度规则：`indegree` 由 `dependencyPairs(doc)` 统计，且**只保留两端都在节点集合里的 pair**（与 `topoOrder` 内部的 `indegree.has` 同规则）。`dependencyPairs` 早期版本会把 `from: $inputs.x` 解析成 `{from: '$inputs', to}` 的幻影依赖（槽位不是节点，计进 indegree 会让目标节点永远等不到上游、整链卡死）；该缺陷已在 R-1 侧修掉（`dependencyPairs` 现在显式跳过 `isInputSlotRef` 的边，并补了单测），本模块仍保留一次过滤作为防御——判据与 `indegree.has` 同源，不引入第二套规则。某节点**成功且出参求值完成**后才对其下游 `indegree-1`，保证「依赖未满足不发请求」；并发上限 `concurrency`（默认 4，硬上限 16），就绪节点按节点 ID 字典序取，保证同等输入下调度顺序可复现。

**错误码**

- 预检：同 IF-1 的全部码，全部在第一个请求之前返回；
- 运行期：`binding-path-not-found`（上游响应里没有该路径，回执给「断在第几段」）、`binding-type-mismatch`（目标声明类型与值形状不符）、`binding-null`（上游值为 `null`，按缺值处理而不是塞 `null`）、`empty-wildcard`（`[*]` 一个元素都没匹配到，与 IF-5 同名）、`param-missing`（防御：静态缺参已拦过，例如 URL 模板有 `{p2}` 但卡只声明 `path.p1`）、`param-type-mismatch`（常量字符串无法转成卡声明类型）、`bad-url-template`（拼出来的 URL 不合法或不是 http(s)）、`node-timeout`、`node-network-error`、`node-http-error`（4xx/5xx，带状态码与响应摘要）、`node-auth-required`（401/403 且 `card.auth !== 'none'`，提示 R-4）、`response-too-large`（正文超上限无法解析，宁可失败也不截断后硬解析）、`cancelled`（用户/宿主取消）。
- HTTP 出口码到运行期码的映射固定在三处，不散落：`aborted` → `cancelled`；`timeout` → `node-timeout`；`bad-url` → `bad-url-template`；`redirect-limit` → `node-network-error`（附原始原因）。
- 所有运行期错误都会：停止调度、等在飞节点落定、写 `terminal(success: false)` 与 `result`，回执里给 `failedNode` 与已完节点清单。

**兼容性**

内部函数，签名随实现演进；但**错误码是契约**：工具回执、运行记录、面板都按这些码分支，新增码只能新增不能改名（改名要同步 `ChainRunErrorCode` 联合类型与文档）。

**幂等与重试**

不幂等（发真实请求）。`dry_run: true` 是纯计划，可重复调用；同一链同一参数两次 dry-run 的计划应完全一致（单测断言）。

#### IF-4 httpRequest

**语义**

对 Node 22 全局 `fetch` 的唯一封装，禁止业务代码直接 `fetch`。行为固定：

- 超时：`AbortSignal.timeout(timeoutMs)`；节点 `timeoutSeconds`（R-1 预留位）优先，缺省 30s；
- 重试：`retry` 次（默认 0，上限 5），仅当「网络错误 / 429 / 5xx」**且**（方法为 GET/HEAD/OPTIONS **或** 作者显式配了 `retry`）时重试；退避 `200ms × 2^(n-1)` + 抖动，总等待不超过 2s；用户取消立刻终止重试；
- 请求：`credentials: 'omit'`（不继承 cookie jar）、`redirect: 'follow'`（最多 5 跳，记录 `finalUrl`）、不设 `User-Agent`（用运行时默认）、`accept: application/json`；
- 响应：先看 `content-length`，再用流式 reader 累计到 `chainResponseLimitBytes`（默认 2 MiB）即停止读取并标 `truncated: true`；`content-type` 含 json 或能 `JSON.parse` 时给 `json`，否则只给文本；
- 摘要：写运行记录时正文只留前 4 KiB，头名命中脱敏集合的值替换为 `***`。

**错误码**

- `timeout` → 每次尝试超时，重试耗尽后返回（调用方映射为 `node-timeout`，重试/放弃由调用方决定）；
- `network-error` → DNS/连接/TLS/连接被重置；可重试；
- `aborted` → 用户取消，**绝不重试**，调用方映射 `cancelled`；
- 正文超限不发生「错误」，只标 `truncated`；是否因截断而无法求值由调用方判 `response-too-large`。

**兼容性**

签名冻结为本文的形状；未来若换 HTTP 实现（如 undici 显式依赖），只换内部实现不改签名与错误码。运行前做能力探测（`fetch` + `AbortSignal.timeout`），不满足即报 `execution-unavailable`，不以 Node 版本号硬判——这样 `package.json` 的 `engines` 无需为执行模块单独收紧。

**幂等与重试**

封装自身不判断业务幂等，只按入参重试；调用方（`runChain`）负责「写方法默认不重试」。同一请求重试的 `attempts` 与每次耗时都进运行记录，便于事后确认是否重放过。

#### IF-5 resolveBinding

**语义**

从上游响应取值喂下游入参，规则必须与 R-1 的路径语法一一对应：

1. 求值根是 `{ body, status, headers }`；路径首段是 `body`/`status`/`headers` 时按特殊根取，否则按 `body` 相对路径取（兼容早期只写 `items[0].id` 的手写链）。
2. 段内索引：`[n]` 取数组第 n 项（越界 → `path-not-found`）；`[*]` 或 `[]` 对数组做投影，**结果恒为数组**（单个匹配也是单元素数组）；多级 `[*]` 如实产出嵌套数组。
3. 目标类型是标量、而投影结果恰好 1 个元素时解包成标量并记 `unwrapped: true`；投影结果 0 个元素 → `empty-wildcard`；多于 1 个且目标为标量 → `type-mismatch`，错误提示「请改用 `[0]` 或把目标声明成数组」。
4. 值 `null` 一律视为缺值 → `null-value`，**不把 `null` 塞给下游**；`undefined`/路径不存在 → `path-not-found`，错误信息带上断在第几段。
5. 类型校验按目标卡字段的声明类型做：`array<T>` 要求数组且元素类型匹配，`object` 要求 plain object，`number` 接受有限数字与可无损转换的数字字符串，`boolean` 接受 `true/false` 与 `"true"/"false"`。不做隐式 `String()` 兜底。

这样 `body.items[*].internalId` 与 `body.items[0].internalId` 在单元素场景下都能取到值，且形状差异显式可见。

**错误码**

- `path-not-found` → 上游响应结构与卡出参模板不符：改绑定路径，或重新采集刷新卡模板；
- `type-mismatch` → 值形状与目标声明不符：改路径取更精确的值，或修卡模板；
- `null-value` → 上游返回 `null`：视为缺值，不要用 `?? ""` 之类的默认值掩盖；
- `empty-wildcard` → 通配没匹配到任何元素：通常是上游查询为空，先确认上游请求参数。
- 以上一律中止链（默认语义），错误指向具体绑定边 `from → to`。

**兼容性**

路径语法取 R-1 的子集并且只做**加法**（`[]` 等价 `[*]` 是 R-1 已定的归一化）；不引入 JSONPath、不支持过滤器与函数调用——那些会让「卡模板能表达什么」和「引擎能求什么」两套语法分叉。

**幂等与重试**

纯函数，天然幂等；同输入同输出（单测可穷举）。

#### IF-6 dataforge_status 扩展

**语义**

`dataforge_status(runId)` 已经能读 `dataRoot/runs`，链运行天然可见；本设计只扩三处投影：

1. 从 `run.json` 读 `chain` 段填进 `RunSummary.chain`；
2. 节点进度：`meta.steps` 是节点 ID 列表，`stepsDone` 即已成功节点数，`lastError` 即失败原因，`lastStepId` 即失败/当前节点；
3. 终态识别：`terminal.cancelled === true` → `status: 'killed'`（`foldSummary` 增加这一条分支，优先于 success 判断），其余逻辑不变。

**错误码**

- `run-not-found` → 沿用现有语义：`ok: false` + `notice`（不是异常）；调用方先 `dataforge_chain_runs` 或 `job_output` 核对 runId；
- 事件文件为空 → 同上（run 还没写事件，属于启动瞬间）。

**兼容性**

只增可选字段，旧 run 无 `chain` 段时字段缺席；旧流程运行不受影响。`foldSummary` 的新分支只在 `cancelled === true` 时生效，历史事件没有该键，行为不变。

**幂等与重试**

只读，天然幂等。

## 备选方案  serves: 全文

| 方案 | 一句话说明 | 优点 | 代价 | 为什么未选 |
|---|---|---|---|---|
| A（选用） | TS 内执行器 + runs 目录留痕 + Node 22 内置 fetch + 复用 `topoOrder` | 与 R-1 同一套校验/路径语义；零新依赖；留痕与流程运行同构，工具/面板直接复用 | 自己要写并发调度、超时重试、脱敏与截断 | — |
| B | 把执行下沉到 Python 引擎（复用 `spawnBridge` + NDJSON） | 复用现成进程管理与事件桥；HTTP 生态成熟 | 执行要拉 python 依赖；链的 schema/校验在 TS、执行在 Python，两套语义必然分叉；runs 事件要再翻译一层 | 语义分叉的返工成本高于写一个几百行的调度器 |
| C | 直接用 undici / axios 封装 HTTP 客户端 | 拦截器、重试、代理能力现成 | 新增 npm 依赖（违反本需求与仓库纪律）；与内置 fetch 行为分叉；升级与安全面多一条线 | 内置 fetch 的 `AbortSignal`/流式读取足够，依赖不值得 |
| D：什么都不做 | 链只是可读文档，执行靠人工回放 | 零开发、零风险 | G1～G4 全部不成立；R-4/R-5/R-6 没有可叠加的执行面；每次回归继续手抄字段 | 现在不能接受：第二期后续三条需求全部堵在这里 |

## 四风险与证据  serves: 全文

| 风险类型 | 判断问题 | 现有证据 | 结论 |
|---|---|---|---|
| 价值 | 用户真的想要吗 | R-3 需求由用户主动推进并列入第二期依赖拓扑；PRJ-0001 G4 明确「卡片结构化就是为了编排消费」；用户已确认「执行 = 纯 HTTP 直调，无浏览器」边界 | 已验证 |
| 可用性 | 用户/agent 会用吗 | agent 侧有工具回执与 dry-run 计划卡；人类侧暂无画布与运行 tab（R-2），只能读运行记录。未做任务测试 | 部分 |
| 可行性 | 我们建得出来吗 | `topoOrder` / `dependencyPairs` 已导出并有单测；`runs/store.ts` 的即写即落盘已在流程造数上跑通；Node 22 内置 fetch 与 `AbortSignal.timeout` 在运行时可用；本设计不需要新依赖 | 已验证 |
| 商业可行性 | 公司能接受吗 | 纯本地执行，无云资源、无外部服务采购；运行记录落在本机 `dataRoot` | 已验证 |

**未验证项的补课计划**：可用性（无 UI 时的可诊断性）→ 用 M2 的一条真实 3 节点链 + 一次故意失败，让用户只看运行记录回答「失败在哪、传了什么值」，读不懂就补回执字段；kakaCat，M3 开始前要结论。真实站点的响应结构多样性（同一卡多形态）→ M2 用两条不同站点链各跑一次，记录 `binding-*` 错误分布。

## 失败模式与回滚  serves: 全文

| 失败场景 | 触发条件 | 用户可见影响 | 检测手段 | 回滚动作 | 决策人 |
|---|---|---|---|---|---|
| 缺参被静默发成空值 | 误把卡 `required` 当判据 / 覆盖判定漏了 `[*]` 归一 | 下游收到空值，可能写脏数据 | 预检单测 + e2e 断言请求串无空值键 | 关执行开关 `chainRunEnabled=false`，修覆盖判定后重跑；已发生的写入需人工核对 | kakaCat |
| 上游响应结构变化导致绑定取不到值 | 站点改字段 / 重新采集刷新了卡模板 | 链在绑定边处中止 | `binding-path-not-found` / `empty-wildcard` 进运行记录 | 修绑定路径或重新采集导卡，upsert 新版本；旧链版本仍可回读 | 用户 / agent |
| 节点 5xx / 超时 / 网络错误 | 下游服务故障、网络抖动 | 链中止，失败节点与状态码可见 | `node-http-error` / `node-timeout` / `node-network-error` | 重试只按 `node.retry` 生效；修复后用新 run 重跑 | 用户 |
| 并行节点互相踩写 | 两条无依赖边同时写同一业务对象 | 业务数据冲突，可能一方 409 或脏写 | 运行记录里两节点 `start` 时间重叠 + 业务侧对账 | 把并发降到 1（`concurrency: 1`）或显式加一条依赖边；已发生的写入不可自动回滚 | 用户 |
| baseUrl 推错（多来源跨域） | 卡 `sources.pages` 混了多个 origin | 请求打到错误站点，401/404 或数据串站 | `base-url-unresolved` 预检直接拒；实际 host 写进运行记录 | 显式传 `baseUrl` 重跑；已发出的请求按不可逆动作处理 | kakaCat |
| 后台 job 缺席（前台降级） | 宿主未装配 `dsh-jobs` | 长链阻塞对话，且不可取消 | 回执 `kind: foreground` + `degradedNotice` | 部署 jobs 插件；或调小 `timeoutSeconds` 并用只读链验证 | 平台 |
| 运行悬挂（进程被杀） | 执行中插件重启/崩溃 | `dataforge_status` 长期显示 `running` | 无 `terminal` 事件 + `startedAt` 过旧 | 手动结束本地 run，重跑新 run；不对旧 run 做自动判死 | 用户 |
| 取消时在飞请求已到达服务端 | 用户在写请求发出瞬间取消 | 服务端可能已执行，本地记 `cancelled` | 运行记录里取消时的在飞节点清单 | 人工核对业务侧；对写类链约定「先 dry-run 再真跑」 | 用户 |

- **开关**：`config.chainRunEnabled`（默认 `true`，全局粒度）；关闭后 IF-1 直接返回 `execution-disabled`，不影响链读写与已有运行回看。新增 `config.chainNodeTimeoutSeconds`（默认 30）、`config.chainConcurrency`（默认 4，上限 16）、`config.chainResponseLimitBytes`（默认 2 MiB）。
- **回滚演练**：M4 前做一次「关开关 → 工具拒跑 → 打开 → 恢复」的演练，kakaCat 执行，预期 1 分钟内恢复；数据面无需迁移。
- **不可逆动作**：**已发出的写请求（非 GET/HEAD）无法撤销**。事前保护：首次调用必须 `confirm: true`、计划卡列出写方法与目标 host、`dry_run` 可先看计划；事后只能靠业务侧核对与运行记录追溯，不做自动补偿。

## 跨关注点  serves: 全文

| 关注点 | 结论 | 依据与措施 |
|---|---|---|
| 安全 | 出网面受控但非白名单 | `credentials: 'omit'` 不继承 cookie；头名命中脱敏集合即打码；卡与链零凭证（R-1 红线），凭证注入归 R-4；仅允许 http/https（其余 scheme 拒绝），baseUrl 只取运行参数或卡来源 origin，不做任意跳转；SSRF 白名单未做（见开放问题） |
| 隐私与合规 | 本地留存，可能含业务数据 | 请求/响应摘要只留前 4 KiB 且落本机 `dataRoot`，不上传；用户可删 run 目录；留存期限随 runs 现有纪律（不自动清理） |
| 成本 | 可忽略 | 无云资源、无新增依赖；每次运行只增 KB 级事件；最坏情况是响应体 2 MiB 上限 × 并发 4 的内存峰值 |
| 可观测性 | 以运行事件为唯一观测面 | `step` 事件给节点级进度与耗时，`terminal`/`result` 给终态与失败节点；`dataforge_status` 轮询、`job_output` 推流；无独立指标系统与告警（本地工具，无值班面） |
| 性能与容量 | 网络延迟主导，调度开销可忽略 | 并发默认 4，就绪即发；百节点链的调度计算是毫秒级（与 R-1 校验同量级）；先坏在「单站点限流/连接数」，用 `concurrency` 下调兜底 |
| 文档与支持 | 需要新增执行章节 | M4 更新 README「执行」节：dry-run 先行、缺参怎么补、失败码怎么读、写类链的确认纪律；工具描述内嵌同样要点，agent 不依赖 README 也能用对 |

## 交付拆分与里程碑  serves: 全文

| 里程碑 | 内容 | 出口判据 | 负责人 | 目标日期 |
|---|---|---|---|---|
| M1 | 计划与预检（`plan.ts` / `coverage.ts`）+ dry-run + 绑定求值单测 | **执行契约冻结**（错误码、缺参判据、`[*]`/`[n]` 语义）；5 类坏链（缺参/环/非 interface-chain/baseUrl/槽位）回执与 dry-run 计划可读；单测覆盖 `body.items[*]` 与 `body.items[0]` | kakaCat | 2026-10-24 |
| M2 | 主路径执行（`request.ts` / `http.ts` / `run.ts`）+ runs 留痕 + 并发调度 | 3 节点链 e2e 全绿且绑定值可核对；S2 并发计时达标；进程列表无浏览器；`run.json.chain` 可读 | kakaCat | 2026-10-28 |
| M3 | 失败语义 + 后台 job + 取消 + `dataforge_chain_runs` + status 扩展 | 500/超时/绑定失败均中止并指到节点；job 可轮询、可取消且终态 `killed`；可用性补课结论出炉 | kakaCat | 2026-10-30 |
| M4 | 硬化（截断/重定向/类型边界/脱敏）+ 开关 + README + 验收逐条过 | typecheck / build / vitest 全绿；R-3 验收判据逐条有证据；开关演练完成 | kakaCat | 2026-11-03 |

## 需求追溯  serves: 全文

| 需求编号 | 设计节 | 测试用例 | 指标 |
|---|---|---|---|
| FR-3.1 | §架构与依赖·`plan.ts` / IF-3 调度规则 | `plan.test.ts`：三节点链拓扑序、并行分支 indegree、`$inputs.` 边不产生依赖、环兜底 | 不适用 |
| FR-3.2 | §数据模型·缺参判据 / IF-5 | `coverage.test.ts`：`required:false` 仍判缺参、有常量/绑定即不缺、credential 豁免；`request.test.ts`：`{p}` 位置替换、query 覆盖、body 组装 | 不适用 |
| FR-3.3 | IF-5 / `binding.ts` | `binding.test.ts`：`[0]`、`[*]` 单/多元素、空投影、`null`、类型不符、多级通配 | 不适用 |
| FR-3.4 | §数据模型·运行记录 / IF-6 | `run.test.ts`：`run.json` 先于请求落盘、每节点一对 start/终态、skipped 不发 step、`foldSummary` 折叠 | 不适用 |
| FR-3.5 | §失败模式与回滚 / IF-3 | `failure.test.ts`：4xx/5xx/超时/网络中止链、失败节点与响应摘要、`retry` 只对幂等方法 | 不适用 |
| FR-3.6 | IF-1 后台路径 / IF-6 | `job.test.ts`：jobs 缺席降级前台、jobs 在场返回 jobId、取消收敛 `killed` | 不适用 |

## 常见问题  serves: 全文

| 问题 | 回答 |
|---|---|
| 最可能被投诉什么 | 「链明明是好的，为什么报一堆缺参」。因为卡模板把采集时见过的所有入参都记下来，单样本卡几乎不可能自带值；所以回执必须逐条给「节点 + 字段 + 类型」并提示两种补法（常量或绑定边），而不是一句「参数不全」。 |
| 6 个月后会成为什么负担 | 两处：① `baseUrl` 靠来源页面 origin 推断，站点换域名或一卡多来源就要人肉传参；② 缺参判据是「模板里有值就必须给」，遇到「服务端可省略」的可选入参会被误杀。前者要推动 R-1 在卡上加 `identity.baseUrl`，后者要卡上加可选标注——都应在下一轮契约评审时解决。 |
| 流量涨 10 倍先坏在哪里 | 先坏在单站点并发与限流（默认并发 4、无全局限速），其次是运行记录条数增长后 `dataforge_chain_runs` 的全量扫描变慢；前者调并发，后者加索引。 |
| 谁半夜被叫起来、手上有什么 | 无人——纯本地执行，没有线上值班面。最坏是用户发现某条链跑挂，手上有完整 `run.json` + `events.ndjson`（失败节点、HTTP 状态、请求 URL、响应摘要）可定位。 |
| 数据错了怎么修、修得回来吗 | 已发出的写请求修不回来，只能按运行记录人工核对业务侧；本地记录可删可重跑，链与卡是文件版本，回读旧版本即回退定义。这也是「写类链先 dry-run、必须 confirm」的原因。 |
| 这个决定错了多久能发现 | 缺参判据错在 M1 单测就暴露；绑定路径语义错在 M2 第一条真实链暴露；并发/取消语义错在 M3 后台 job 演练暴露。真正可能拖久的是 `baseUrl` 推断，只有遇到跨域多来源卡才暴露。 |
| 为什么不用现成的 DAG 库 | 依赖已经由 R-1 的 `topoOrder` 解掉，剩下的是「就绪队列 + 并发上限 + 取消」，几十行；引库会把错误码、中止语义、事件形状都交给第三方，反而更难与 runs 契约对齐。 |
| 为什么 dry-run 也要落运行记录 | 计划本身就是要被复查的证据：用户确认时看的那张卡、事后「当时打算发什么」，都应该能回读；dry-run 不发请求，成本只有几 KB。 |

## 开放问题  serves: 全文

| 问题 | 选项 | 负责人 | 截止 |
|---|---|---|---|
| 卡缺 baseUrl 权威来源 | 运行参数显式传 / 卡 `identity.baseUrl`（需 R-1 扩字段）/ 站点级配置 | kakaCat | M1 开工前定；倾向「运行参数兜底 + 给 R-1 提 `identity.baseUrl`」 |
| 「可省略入参」如何表达 | 卡上新增 `optional` 标记 / 仅 `role: constant` 视为可省略 / 一律必填 | kakaCat | M2 前定；倾向新增显式标记，不放宽现有判据 |
| 默认并发与写节点是否默认串行 | 全部并发 4 / 写方法默认串行 / 按链配置 | kakaCat | M2 前定；倾向「读并发 4，写默认串行并在回执说明」 |
| `dataforge_chain_runs` 何时加索引 | 扫描 run.json / `runs/index.ndjson` / SQLite | kakaCat | 单项目运行数 > 500 时再定 |
| 悬挂 run（无 terminal）如何判死与清理 | 只提示不自动处理 / `startedAt` 超 2×超时判 stale / 启动时清扫 | kakaCat | M4 前定；倾向只提示，不自动改状态 |
| SSRF 与目标站点白名单 | 不做 / 仅允许卡来源 origin / 配置站点白名单 | kakaCat | 与 R-4 一起定（凭证注入后风险面变大）；本期只做 http/https 限制与目标 host 记录 |

## 验收证据  serves: 全文

需求 §5 的五条判据逐条落到可自动跑的用例（`pnpm test` 全绿即通过），不留「人工点一遍」的模糊项：

| 验收判据 | 证据 | 说明 |
|---|---|---|
| ≥3 节点、含绑定边的无登录态链直跑成功，上游出参正确传入下游 | `test/execute/run.test.ts`「三节点链（两条绑定边）跑通」 | 值经两跳：`internalId(M-1)` → `detail.query.id` → `materialCode(CODE-9)` → 写节点请求体，断言的是**实际发出的请求体** |
| 并行分支并发执行；依赖未满足的节点不提前发请求 | `run.test.ts`「并发：两个无依赖节点同时发出」（计时 < 单次耗时上界）、「就绪节点按 id 字典序取」；`plan.test.ts` 拓扑序 | 依赖未满足的直接证据是真实请求顺序 = 拓扑序，以及被中止时下游节点**没有** `step` 事件 |
| 4xx/5xx/超时 → 链中止，运行记录诚实标注失败节点与响应摘要 | `test/execute/failure.test.ts`（500 / 405 / 401 / 403 / 超时 / 连接被拒）；`run.test.ts`「下游 500 → failedNode 指到该节点」 | 失败节点、错误码、HTTP 状态、响应摘要四项都在 `step(error)` 与 `terminal.message` 里 |
| 绑定路径不存在 / 类型不符 → 明确报错指到绑定边 | `run.test.ts`「绑定取不到值 → binding-path-not-found 指到绑定边」；`binding.test.ts` | 回执给 `from → to` 原文与求值原因，且下游节点一个请求都不发 |
| 全程无浏览器进程启动 | `test/execute/invariants.test.ts`（依赖图断言） | 比一次性进程列表更强的保证：`src/execute` 的依赖图里没有 `capture/`（Playwright 只在那里）、没有 `node:child_process`、没有 http.ts 之外的 `fetch` —— 不存在能起浏览器的代码路径 |
| 后台 job：可轮询、可取消、终态 `killed` | `test/execute/job.test.ts`（jobs 在场/缺席/取消 + `chain_runs` + `status`） | 取消后 `foldSummary` 折叠成 `killed`，不留悬挂 `running` |
| 执行开关回滚演练 | `test/orchestration/chain-run.test.ts`「开关演练（M4 回滚路径）」 | 关 → 拒跑且链照常可读；开 → 同一份链立刻出计划卡（配置即恢复，无数据面迁移） |

**仍未验证（需要真实站点，非代码问题）**：设计 §四风险里列的「可用性补课」——用一条真实 3 节点链 + 一次故意失败，让用户只看运行记录回答「失败在哪、传了什么值」。这一步要人参与，用例替代不了；M3 出口判据里已挂起，结论未出。

## 附录  serves: 全文

- **原型与验证材料**：无新原型；验证以单测 + 一条真实 3 节点链的 e2e 为准（M2 产出）。
- **相关文档**：[R-3 需求](../requirement/r3-execution-engine.md)、[R-1 链模型设计](r1-chain-model.md)、[采集流程图](../../../capture-flow-diagram.png)、[PRJ-0001 接口采集设计](../../../superpowers/specs/2026-10-17-interface-capture-design.md)。
- **代码事实来源**：`src/chains/validate.ts`（`topoOrder` / `dependencyPairs` / `scanCredentialConstants` 的导出面）、`src/chains/schema.ts`（`fieldSegments` / `isInputSlotRef` / `splitBindingPath`）、`src/chains/store.ts`（`loadChain` / `defaultCardResolver`）、`src/runs/store.ts`（`startRunRecord` / `appendEvent` / `foldSummary`）、`src/application.ts`（`JobsLike` / `resolveJobs` 装配）、`src/library/import.ts`（卡的 `query./body./header./path.` 入参前缀与 `role` 投影）。
- **评审记录**：未评审。
- **变更历史**：2026-10-17 初稿。已冻结的三条设计事实：执行只认 `interface-chain`；拓扑直接复用 `topoOrder`/`dependencyPairs`；缺参判据不看卡 `required`。
- 2026-10-17 实现回填：IF-1 的 `kind` 增加 `dry-run`（dry-run 不建 job，用单独的 kind 比谎报 foreground 诚实）；错误码**只增不改名**地补了 `card-not-imported` / `execution-unavailable`（预检）与 `empty-wildcard` / `param-missing` / `bad-url-template`（运行期）——前两条原就写在 IF-1 正文与架构节，后三条在失败模式表与 `request.ts`/`binding.ts` 里已经存在，这里只是让码表与实现对齐。
