---
title: 探索执行（首跑打通）· R-5 设计
status: draft
owner: yunpeng
reviewers: 待定
prd: docs/projects/PRJ-0002/requirement/r5-exploratory-execution.md
serves: FR-5.1、FR-5.2、FR-5.3、FR-5.4、FR-5.5、FR-5.6
created: 2026-10-17
updated: 2026-10-17
---

# 探索执行（首跑打通）· R-5 设计  serves: FR-5.1～FR-5.6

## 摘要  serves: 全文

- **问题**：R-3/R-4 的执行器是确定性的——链缺一个入参就整链拒跑，失败就中止；可首跑的真实状态恰恰是「链还不完整、值还不知道、绑定还没连」。agent 现在只能靠反复改链文件 + 整链重跑，既慢又可能重放写请求。
- **方案**：新增一个**单节点试探**工具 `dataforge_chain_probe`：agent 指定链上的某个节点，给出**带来源标注**的入参值，引擎只发这一发请求，返回请求/响应摘要、卡出参的实际值（供发现绑定）与逐值来源；缺参就停在节点前并返回「缺什么 + 卡模板」；写方法没有 `confirm` 只出计划卡。每次 probe 落一条独立运行留痕（`kind: probe-run`），用 `explorationId` 把同一轮首跑的多次 probe 串起来。
- **影响面**：新增 `src/execute/probe.ts`、`src/orchestration/explore.ts` 与第 17 个工具 `dataforge_chain_probe`；扩展 `runs/` 的 run 形状（可选 `probe` 段）；不改链/卡 schema，不新增 npm 依赖，不建数据库表。
- **关键决策（回答需求 Q1）**：`agent-inferred` 必须带推断依据，且**永远不等于用户确认**；写操作只认 `confirm=true`；`user` 来源由 agent 声明、工具无法替代真人确认——这是诚实边界，不伪造。

## 背景与问题  serves: 全文

### 需求来源

| 需求编号 | 原始诉求 | 本设计如何回应 |
|---|---|---|
| FR-5.1 | 缺参暂停：报告缺什么、卡模板长什么样 | probe 在发请求前用 `missingInputs()` 一次判完，返回 `gaps` + 卡入参模板（path/type/required/role），不发请求 |
| FR-5.2 | 每个入参必带来源：user / agent-inferred / upstream / constant | 入参值形状升级为 `{ value, source, evidence? }`；常量自动标 `constant`，`upstream`/`agent-inferred` 缺依据直接拒 |
| FR-5.3 | 首跑中新建的绑定边回写链文件（经 R-1 校验） | 不新增写入口：probe 返回卡出参实际值，agent 用 `dataforge_chain_upsert` 写绑定边（同一套 R-1 校验/版本快照） |
| FR-5.4 | 有限重试与半自我修复，超次数诚实失败 | probe 是「一次尝试」；可配 `retry`（仅幂等方法，0..3），每次结果都落 run；失败不自动换值、不假装成功，agent 换值后再 probe |
| FR-5.5 | 关键业务值与写操作节点的确认权属用户 | 写方法（非 GET/HEAD/OPTIONS）不带 `confirm=true` 只返回计划卡；`agent-inferred` 值必须带依据，工具不把它当用户确认 |
| FR-5.6 | 首跑记录：值 + 来源 + 依据 + 每步请求/响应摘要 | 每次 probe 落 `runs/<runId>/`：`run.json` 的 `probe` 段 + `provenance` + `values` + `events.ndjson`（meta/step/terminal/result） |

### 现状与代价

今天的首跑路径是「改链 → 整链跑 → 失败 → 再改」：

- 缺一个 `materialId`，`dataforge_chain_run` 预检直接 `missing-params`，**一个请求都不发**，agent 拿不到任何上游数据来补值；
- 想试探材料编码，只能临时写一条单节点链（或改原链），跑完再改回来；
- 整链重跑会把已成功的**读请求**重放一遍；如果链里有写节点，风险更大；
- 失败后没有「这次用了哪个值、从哪来的」的记录，agent 只能凭上下文复述，R-6 也没有可结晶的原料。

代价在首跑阶段最集中：链越不完整，整链重跑的浪费越大；而首跑恰恰是链最不完整的时候。

出处：R-5 需求 §1/§3；R-3 设计的「非目标：不做 agent 在环试探」；本机无真实登录站点样本，首跑验收以本地 HTTP 服务为准。

### 为什么是现在

R-3 已把请求构造/绑定求值/运行留痕收口，R-4 已把登录态补齐；R-5 不需要再发明执行器，只需要在现有能力上加一个**更小的执行单位（单节点）**和**更严的来源标注**。再晚做，R-6 的结晶只能从「整链成功」的结果反推值来源，而那时已经分不清哪些值是用户给的、哪些是 agent 猜的。

## 目标与非目标  serves: 全文

### 目标

- 一条链的某个节点缺 1 个以上入参时，probe 在**一个请求都不发**的前提下返回：缺哪些字段、卡模板长什么样、已经有哪些常量；
- 给齐值后，probe 只发**这一发**请求；响应摘要、耗时、状态码、卡出参实际值进运行留痕；
- 每个入参在留痕里有来源：`user` / `agent-inferred` / `upstream` / `constant`；`agent-inferred` 与 `upstream` 必须有依据；
- 写方法没有 `confirm=true` 时只出计划卡，**一个请求都不发**；
- 同一 `explorationId` 的多次 probe 可在运行留痕里串起来；
- 首跑中发现的绑定边由 agent 经 `dataforge_chain_upsert` 回写，R-1 校验不过不落盘。

### 非目标

- **不做整链断点续跑**：probe 是单节点；不缓存上游响应供下一次 probe 复用。理由是跨请求缓存会把「这一发到底带了什么」变得不可审计，M2 再评估。
- **不做自动值试探/自动换值**：探测哪些值由 agent 决定；工具只负责发一发、如实记录。自动猜值会把「猜错」变成看不见的静默重试。
- **不做自动绑定推断**：probe 只把卡出参的实际值给 agent 看；哪条出参喂哪个入参由 agent 判断并 upsert，避免把「看起来名字像」错连成边。
- **不做浏览器**：执行段仍只用 Node 22 内置 `fetch`；登录态由 R-4 的 cookie/换票承担。
- **不做凭证录入**：probe 的 `values` 是业务入参；路径命中敏感词（password/token/secret…）时值写 `***`，凭证仍走 R-4。
- **不新增写链入口**：绑定回写复用 `dataforge_chain_upsert`，不引入第二套链写路径。
- **不做 UI**：本轮只交付工具面与运行留痕；面板展示留给后续。

## 方案总览  serves: FR-5.1

**一句话方案**：把执行单位从「整链」缩到「单节点」，把入参从「裸值」升级成「值 + 来源 + 依据」，让 agent 用一次次可审计的 probe 把链从定义态推到可整链执行态。

```text
agent
  │  dataforge_chain_probe(site, flow, node, values:{path:{value,source,evidence}}, confirm?)
  ▼
loadChain（R-1 校验）→ 找节点/卡 → 解析 baseUrl
  │
  ├─ 缺参 → paused：gaps + cardInputs（不发请求）
  ├─ 写方法且无 confirm → confirm-required：计划卡（不发请求）
  └─ 齐了 → buildRequest → httpRequest → 解析
        │
        ├─ step(done/error) + terminal + result
        └─ run.json.probe { explorationId, provenance, values }
  ▼
agent 读 outputs → 用 dataforge_chain_upsert 写绑定边 → dataforge_chain_run 整链跑
```

**关键概念**：

- **probe（试探）**：对链上**一个节点**发一次请求。不是整链执行，不消费上游绑定，不写链文件。
- **值来源（provenance）**：每个入参的 `source` 与 `evidence`。`constant` 自动；`user` 由 agent 声明；`agent-inferred`/`upstream` 必须给依据。
- **探索组（explorationId）**：同一轮首跑的多次 probe 共用的 ID；缺省自动生成 `exp_<timestamp>`，写进每次 run。
- **卡模板**：卡入参/出参的 path/type/required/role；缺参时原样返回给 agent。

## 架构与依赖  serves: FR-5.1、FR-5.2

- **模块划分**：
  - `src/execute/probe.ts` → 纯执行：缺参判定、值来源校验、请求构造（复用 `buildRequest`）、HTTP（复用 `httpRequest`）、出参求值（复用 `resolveBinding`）、运行留痕。
  - `src/orchestration/explore.ts` → 应用层：载链、找节点/卡、baseUrl 解析、错误折叠、工具值形状校验；工具壳只做参数声明与回执。
  - `src/tools.ts` → `dataforge_chain_probe` 工具壳（第 17 个工具）。
  - `src/index.ts` → 装配 `ProbeToolDeps`（复用 `ChainRunToolDeps` 的 dataRoot/chain 配置）。
- **依赖方向**：`tools.ts` → `orchestration/explore.ts` → `execute/probe.ts` → `chains/*` + `runs/store.ts` + `execute/{request,http,binding,coverage}.ts`。`execute/probe.ts` 不依赖 capture/ library/ client/，也不依赖 orchestration。
- **外部依赖**：无新增；Node 22 内置 `fetch`；`js-yaml`/`schemastery` 已在用。
- **与既有架构的差异**：这是第一个**不是整链**的执行入口；因此运行记录新增 `kind: 'probe-run'` 与 `probe` 段。`foldSummary` 仍按 `meta.steps` + `step` 事件折叠，不引入第二套状态机。

## 数据模型  serves: FR-5.2、FR-5.6

### probe 运行留痕

```jsonc
// dataRoot/runs/<runId>/run.json
{
  "runId": "probe-采购下单-1729150000000",
  "kind": "probe-run",
  "flow": "采购下单",
  "flowName": "采购下单",
  "probe": {
    "site": "智慧供应链 SCM",
    "flow": "采购下单",
    "version": 3,
    "nodeId": "query-material",
    "cardId": "card_000123",
    "method": "GET",
    "urlTemplate": "/api/materials?q={q}",
    "explorationId": "exp_1729150000000",
    "writes": false,
    "paused": false
  },
  "params": { "query.q": "螺丝" },
  "values": { "query.q": "螺丝", "query.orgId": "2120" },
  "provenance": [
    { "path": "query.q", "source": "user", "evidence": "用户原话：用螺丝试一下" },
    { "path": "query.orgId", "source": "constant", "evidence": "节点常量 query.orgId=2120" }
  ],
  "baseUrl": "https://scm.example.com",
  "startedAt": 1729150000000
}
```

- **实体与字段**：`kind: 'probe-run'`、`probe.{site,flow,version,nodeId,cardId,method,urlTemplate,explorationId,writes,paused}`、`values`、`provenance[]`、`params`（敏感值写 `***`）。
- **约束与不变量**：
  - 每次 probe 只写一个 run 目录；不修改链/卡；
  - `provenance` 覆盖卡模板里**每个非 credential 入参**（缺参的进 `gaps`，不进 provenance）；
  - `agent-inferred` / `upstream` 必须带 `evidence`，否则在发请求前拒（`invalid-source`）；
  - 路径命中敏感词（`password|passwd|pwd|secret|token|authorization|cookie|api[-_]?key`）时 `values` 与回执只写 `***`，`redacted: true`；
  - 事件流仍 append-only：`meta` → `step(start)` → `step(done|error)` → `terminal` → `result`；`paused` 只有 `meta` + `terminal(success:false)` + `result`，没有 `step`。
- **迁移与回填**：不适用——新增 `probe` 段与 `kind`，旧 `chain-run`/流程 run 读取方按缺省忽略；不需要迁移。
- **生命周期**：与 `runs/` 一致，不自动清理；`dataforge_status` 可读。

## 接口设计  serves: FR-5.1、FR-5.4、FR-5.5

| 编号 | 接口 | 输入 | 输出 | 失败与错误 | 兼容性 |
|---|---|---|---|---|---|
| IF-1 | `dataforge_chain_probe`（agent 工具，第 17 个） | `site`、`flow`、`version?`、`node`、`values?`、`baseUrl?`、`confirm?`、`retry?`、`explorationId?` | `gate`（executed/paused/confirm-required/blocked）、`runId`、`explorationId`、`gaps`、`plan`、`request`、`response`、`outputs`、`provenance`、`attempts` | 见 IF-2 | 新增工具；不改现有 16 个工具签名 |
| IF-2 | `probeNode()`（执行核心） | 已加载链/卡/节点 + 带来源的值 | `ProbeResult`（gate + run + 摘要） | 预检 `node-not-found`/`invalid-source`/`unknown-value`/`confirm-required`/`base-url-unresolved`；运行期 `node-*`/`response-too-large`/`cancelled` | 内部函数；错误码只增不改名 |
| IF-3 | 值来源校验（`validateValues`） | `values` 形状 + 卡模板 | 规整后的值 + provenance | `invalid-source` / `unknown-value` | 纯函数，可穷举单测 |
| IF-4 | 写操作确认闸 | 方法 + `confirm` | 计划卡或放行 | `confirm-required` | 与 R-3 的写类闸同语义，不重复实现 |

#### IF-1 dataforge_chain_probe

**语义**

唯一的单节点试探入口。它**不消费绑定边**：节点里声明的 `constants` 照常生效；缺失的入参由 `values` 提供（键 = 卡字段路径，归一化后匹配）。`values` 的每个条目必须带 `source`：

- `user`：用户明确给出的值（evidence 可选，建议写原话）；
- `agent-inferred`：agent 推断的值，**必须给 evidence**（依据/推断链）；
- `upstream`：来自某个已完成 probe 的响应，**必须给 evidence**（如 `probe:probe-xxx · body.items[0].internalId`）；
- `constant` 不接受调用方传入（常量由节点 `constants` 自动判定）。

调用方拿到 `paused` 时补值后重调用；拿到 `executed` 时读 `outputs` 决定绑定边，再用 `dataforge_chain_upsert` 写链。

**错误码**

| 情形 | gate | code | 调用方处理 |
|---|---|---|---|
| 执行开关关闭 | blocked | `probe-disabled` | 打开 `chainRunEnabled` 后重试 |
| 链/节点/卡不存在或链校验不过 | blocked | `chain-not-found` / `invalid-chain` / `node-not-found` / `card-not-imported` | 先修链/导卡；不要重试同一份 |
| `values` 的键不在卡入参模板里 | blocked | `unknown-value` | 修键名；键是卡字段路径 |
| `source` 非法 / `agent-inferred`/`upstream` 缺 evidence | blocked | `invalid-source` | 补 source/evidence |
| 缺入参 | paused | `missing-params`（gate 非错误） | 按 `gaps` 补 `values` 后重调 |
| 写方法且 `confirm !== true` | confirm-required | `confirm-required` | 向用户确认后带 `confirm=true` 重调 |
| baseUrl 推不出/跨 origin | blocked | `base-url-unresolved` | 显式传 `baseUrl` |
| 请求已发出但 HTTP 非 2xx | failed | `node-http-error` / `node-auth-required` | 读 `response`，换值/补登录后重 probe |
| 超时/网络/取消/正文超限 | failed | `node-timeout` / `node-network-error` / `cancelled` / `response-too-large` | 如实记录；不要盲目重试写请求 |

**兼容性**

新增工具，无旧调用方；不改变 `dataforge_chain_run` 的签名与语义。`probe` run 对旧读取方是未知 `kind`，`dataforge_status` 仍能按通用事件折叠展示。

#### IF-2 probeNode

**语义**

步骤固定：值来源校验 → 缺参判定（一个请求都不发）→ 写操作确认闸 → `buildRequest` → `httpRequest` → 解析 → 出参求值 → 落 run。`retry` 只对 GET/HEAD/OPTIONS 生效，0..3 封顶；写方法强制 0。`onSetCookies` 不参与（probe 不换票），但 R-4 注入仍由调用方装配的 provider 负责。

**错误码**

预检阶段：`invalid-source` / `unknown-value` / `node-not-found` / `base-url-unresolved` / `confirm-required`；运行期：`node-timeout` / `node-network-error` / `node-http-error` / `node-auth-required` / `response-too-large` / `cancelled`。所有错误码进 `ProbeResult.code`，不抛异常。

**兼容性**

内部函数，签名随实现演进；错误码是契约，只增不改名。

#### IF-3 validateValues

**语义**

把工具入参的 `values` 规整成 `{ path（归一化）, rawPath, value, source, evidence? }`，并与卡模板对齐：未知键拒、credential 角色拒、`source` 只允许 `user|agent-inferred|upstream`。`agent-inferred`/`upstream` 缺 evidence 拒。敏感路径不改变来源，只把值在留痕里写成 `***`。

**错误码**

- `unknown-value`：键不在卡入参模板；
- `invalid-source`：source 非法/缺 evidence/对 credential 字段赋值。

**兼容性**

新增纯函数，无旧调用方；后续若增加来源类型（如 `system`）只扩词表，不改形状。

#### IF-4 写操作确认闸

**语义**

方法不是 GET/HEAD/OPTIONS 即视为写操作：没有 `confirm=true` 时只返回计划卡（节点、方法、URL 模板、卡入参模板），**不建 run、不发请求**。`confirm=true` 才真正执行。工具不判断用户是否真的确认过；它只保证「没带 confirm 就绝不发」。

**错误码**

`confirm-required`（gate，不是失败）；`confirm=true` 后仍失败的走 IF-2 的运行期码。

**兼容性**

与 R-3 的写类闸同语义，不重复实现；`dataforge_chain_run` 的确认卡不受影响。

## 备选方案  serves: 全文

| 方案 | 一句话说明 | 优点 | 代价 | 为什么未选 |
|---|---|---|---|---|
| A（选用） | 单节点 probe + 来源标注 + 独立 run | 不发整链；写风险最小；每次尝试可审计；复用 R-3 请求/HTTP/绑定 | agent 要多次调用；需要新工具与回执 | — |
| B | 整链 `explore` 模式：跑到缺参停下，缓存上游结果供续跑 | 一次调用跑多节点 | 要引入执行会话/断点缓存；重跑写节点风险；状态机翻倍 | 首跑阶段写风险最高，先做小执行单位 |
| C | 让 agent 直接写临时单节点链再跑 | 零新代码 | 每次试探都改工作区文件、污染版本；来源标注无处落 | 版本噪音与审计缺口不可接受 |
| D | 自动猜值 + 自动重试直到成功 | agent 省事 | 猜错静默、写操作可能重放；来源不可信 | 与 G2/G3 直接冲突 |
| E：什么都不做 | 继续「改链 → 整链跑」 | 零开发 | 首跑慢、写风险高、无来源标注，R-6 无原料 | 现在不能接受：R-5/R-6 都堵在这里 |

## 四风险与证据  serves: 全文

| 风险类型 | 判断问题 | 现有证据 | 结论 |
|---|---|---|---|
| 价值 | 用户真的需要吗 | R-5 需求明确了「参数不全的首跑」场景；现有整链预检在缺参时零请求，agent 拿不到上游数据 | 已验证 |
| 可用性 | agent 会用吗 | 工具回执给 gaps/plan/request/response/outputs/provenance；`dataforge_chain_upsert` 已是现成回写入口 | 部分（未做任务测试） |
| 可行性 | 我们建得出来吗 | `buildRequest`/`httpRequest`/`resolveBinding`/`runs/store` 均已存在；probe 只是组合，不新增依赖 | 已验证（本地服务用例） |
| 商业可行性 | 公司能接受吗 | 纯本地、零新依赖；不新增外部服务 | 已验证 |
| **安全** | 会不会把密码/token 写进留痕 | 敏感路径值写 `***`；请求头走 `redactHeaders`；probe 不处理凭证，凭证归 R-4 | 需持续守住（扫描用例） |

**未验证项的补课计划**：
- 真实业务链首跑（材料编码、内部 ID、写节点）需要一条真实站点链；M1 先用本地 HTTP 服务验证机制，真实链由 R-6 前的联调补；
- agent 自主权边界（哪些值可以猜）→ M2 用一次真实首跑做任务观察，记录 agent 是否把 `agent-inferred` 当 `user` 用。

## 失败模式与回滚  serves: 全文

| 失败场景 | 触发条件 | 用户可见影响 | 检测手段 | 回滚动作 | 决策人 |
|---|---|---|---|---|---|
| 写请求被误发 | agent 没带 `confirm` 或方法判断漏了 | 真实写操作发生 | 写方法白名单 + 单测断言「无 confirm 零请求」 | 关 `chainRunEnabled=false`；业务侧人工核对 | yunpeng |
| 敏感值进留痕 | 新字段没命中敏感词规则 | 密码/token 落 `run.json` | 敏感路径单测 + 事件全文扫描 | 删泄漏 run 目录；补规则；后续加扫描门 | yunpeng |
| 值来源造假 | agent 把猜的值标 `user` | 结晶（R-6）把猜测当事实 | `agent-inferred` 强制 evidence；工具无法验证真人确认（诚实边界） | R-6 结晶前二次确认；修标注后重 probe | 用户/agent |
| 探测把读接口打爆 | agent 高频 probe | 目标站限流/封禁 | 每次 probe 一条 run；无自动循环 | 降低调用频率；必要时关执行开关 | 用户 |
| 绑定写错 | agent 选错出参/入参 | 整链跑出脏数据 | probe `outputs` + R-1 校验拒悬空/成环 | 回读旧链版本；upsert 新版本修正 | agent/用户 |
| probe 留痕过多 | 首跑反复试探 | `runs/` 目录增长 | runId 可按 `probe` 段过滤 | 手动清理旧 run；后续加保留策略 | 用户 |

- **开关**：复用 `config.chainRunEnabled`；关闭后 probe 返回 `probe-disabled`。
- **回滚演练**：M1 合并前用「关开关 → probe 拒跑 → 打开 → 恢复」对照测试。
- **不可逆动作**：写方法 probe 一旦发出无法撤销；事前保护 = `confirm=true`，事后只能业务侧核对。

## 跨关注点  serves: 全文

| 关注点 | 结论 | 依据与措施 |
|---|---|---|
| 安全 | 写操作有显式闸；敏感值脱敏 | 非幂等方法无 confirm 不发；敏感路径值 `***`；请求头 `redactHeaders`；probe 不碰凭证 |
| 隐私与合规 | 业务值落本机 runs | 与 R-3 同一 runs 纪律；不自动上传；敏感值不落原文 |
| 成本 | 可忽略 | 每次 probe 一个请求 + KB 级事件；无新依赖 |
| 可观测性 | 每次试探独立可查 | `run.json.probe` + `explorationId` + `provenance`；`dataforge_status` 可读 |
| 性能与容量 | 网络延迟主导 | 单节点单请求；无并发/缓存；`retry` 上限 3 |
| 文档与支持 | 需要新增首跑章节 | README 增「探索执行（首跑）」：probe 用法、来源词表、写闸、绑定回写 |

## 交付拆分与里程碑  serves: 全文

| 里程碑 | 内容 | 出口判据 | 负责人 | 目标日期 |
|---|---|---|---|---|
| M1 | `execute/probe.ts` + `orchestration/explore.ts` + `dataforge_chain_probe` + 来源校验 + 写闸 + 留痕 | 本地服务：缺参 paused、写闸零请求、成功 probe 带 provenance/outputs、run 可回读；typecheck/test/build 全绿 | yunpeng | 已完成（2026-10-17） |
| M2 | 绑定回写便捷入口（`dataforge_chain_bind` 或 upsert 提示增强）+ 首跑任务测试 | agent 不手写 YAML 也能把 probe 发现的边写回；真实链首跑一次 | yunpeng | 已完成（2026-10-17）：新增 `dataforge_chain_bind`（只给边、to 相同替换、只经 saveChain） |
| M3 | 探索组汇总（一次看全组尝试）+ 有限自动重试策略 + 面板展示 | 首跑从 N 次 probe 到整链成功可复盘；无 P0/P1 | yunpeng | 2026-10-25 |

## 需求追溯  serves: 全文

| 需求编号 | 设计节 | 测试用例 | 指标 | 里程碑 |
|---|---|---|---|---|
| FR-5.1 | §方案总览 / IF-1 / IF-2 | `test/execute/probe.test.ts`：缺参 paused、零请求、gaps/cardInputs | 缺参暂停时请求数 = 0 | M1 |
| FR-5.2 | §数据模型 / IF-3 | `test/execute/probe.test.ts`：四种来源、缺 evidence 拒、敏感值脱敏 | provenance 覆盖率 = 100%（非 credential 入参） | M1 |
| FR-5.3 | §方案总览 / IF-1 | `test/orchestration/explore.test.ts`：probe outputs → upsert 绑定边 → 整链 | 回写链通过 R-1 校验 | M1/M2 |
| FR-5.4 | §接口设计 / IF-2 | `test/execute/probe.test.ts`：retry 上限、写方法不重试、失败如实落 run | 写方法 attempts = 1 | M1 |
| FR-5.5 | §接口设计 / IF-4 | `test/execute/probe.test.ts`：POST 无 confirm 零请求、有 confirm 执行 | 无 confirm 写请求数 = 0 | M1 |
| FR-5.6 | §数据模型 / IF-2 | `test/execute/probe.test.ts`：run.json.probe/provenance/values + events | 每次 probe 一条 run | M1 |

## 常见问题  serves: 全文

| 问题 | 回答 |
|---|---|
| 为什么不直接让整链跑到缺参停下？ | 整链重跑会重放已成功的请求，写节点风险最高；单节点 probe 把「尝试」压到最小，来源也更好标。 |
| agent 把猜的值标成 `user` 怎么办？ | 工具无法验证真人确认；只能强制 `agent-inferred` 带 evidence，并在 R-6 结晶前要求二次确认。这是诚实边界，不伪造。 |
| 为什么 probe 不消费绑定边？ | 首跑时绑定往往还没建；probe 要能独立试一个节点。上游来的值用 `source:'upstream'` + evidence 手填，等链补好后再跑整链。 |
| 敏感值怎么识别？ | 字段路径命中 `password/passwd/pwd/secret/token/authorization/cookie/api-key` 等词即脱敏；这只是兜底，凭证本身走 R-4。 |
| 6 个月后会成为什么负担？ | 多一个 probe 入口与一种 run kind；只要保持「probe 不写链、绑定回写只走 dataforge_chain_bind（仍过 R-1）」，负担可控。 |
| 流量涨 10 倍先坏在哪里？ | 目标站限流与 `runs/` 目录增长；probe 没有自动循环，先坏在 agent 调用频率，而不是插件吞吐。 |
| 数据错了怎么修？ | run 是 append-only 证据，不改历史；修值后重新 probe / 重新 upsert 链版本。 |
| 这个决定错了多久能发现？ | 若单节点 probe 不够用，第一次真实首跑就会暴露（需要跨节点缓存）；那时再补 M2 的探索组/断点。 |

## 开放问题  serves: 全文

| 问题 | 选项 | 负责人 | 截止 |
|---|---|---|---|
| Q1（需求原问题）agent 自主权边界 | **已决（M1）：`agent-inferred` 必须带依据，写操作只认 `confirm`；`user` 由 agent 声明，工具不验证真人** | yunpeng | 已决：2026-10-17 |
| Q2 绑定回写用 upsert 还是新工具 | **已决（M2）：新增 `dataforge_chain_bind`**——只收边、按 `to` 合并，避免 agent 每次重抄整份 YAML；写仍只经 `saveChain` | yunpeng | 已决：2026-10-17 |
| Q3 探索组是否需要汇总视图 | (a) 只按 `explorationId` 过滤 run（M1）；(b) 新增 `dataforge_explore_runs`（M3） | yunpeng | M3 开工前 |
| Q4 是否缓存 probe 响应供后续复用 | (a) 不复用（M1，审计优先）；(b) 探索组内缓存（M2 评估） | yunpeng | M2 开工前 |

## 验收证据  serves: 全文

> 本节在里程碑完成时逐条补证据；M1 完成后更新。

- M1（2026-10-17）：
  - [x] `pnpm typecheck` 0；`pnpm test` 452 passed / 3 skipped；`pnpm build` 通过；
  - [x] 缺参 paused 时零请求（`test/execute/probe.test.ts`）；
  - [x] 写方法无 confirm 零请求、零 run（`test/execute/probe.test.ts`）；
  - [x] run.json 含 `probe`/`provenance`/`values`，敏感值 `***`；响应回显也不进留痕；
  - [x] 成功后返回卡出参实际值（`body.items[*].internalId` = M-1）；
  - [x] 工具入口闸：执行开关/节点不存在/baseUrl 推不出/paused→executed（`test/orchestration/explore.test.ts`）；
  - [x] 注册第 17 个工具与首跑策略段（`test/index.test.ts`）。

- M2（2026-10-17）：
  - [x] `pnpm typecheck` 0；`pnpm test` 531 passed / 3 skipped；`pnpm build` 通过；
  - [x] `dataforge_chain_bind` 落地并注册：`test/orchestration/bind.test.ts` 9 例——新增/幂等/替换/transform+pick 回读/三类非法边零落盘/多边与 `$inputs` 槽位边/page-chain 拒绝/坏形状兜底；
  - [x] 写链纪律：只经 `saveChain`（R-1 校验），失败零落盘、issues 指到 `edges[i]`；版本只增不删；
  - [x] 真实链首跑：百度网盘「文件列表探测 → 文件列表→分享」已走 probe→绑定→整链（`runs/probe-*`、`runs/chain-*` 留痕）。

## 附录  serves: 全文

### 与 R-3 的边界

R-3 设计明确「不做 agent 在环试探」；本设计不改变整链执行语义，只在旁边加一个单节点入口。整链的预检/确认/失败语义原样保留。

### 与 R-6 的边界

R-5 只负责「值 + 来源 + 依据」的留痕；三分类沉淀（常量/入参/链生成值）与复跑是 R-6。probe 的 `provenance` 是 R-6 结晶的唯一原料，但 R-6 仍要经用户确认后才写链。
