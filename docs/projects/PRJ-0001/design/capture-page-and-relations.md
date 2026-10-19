---
title: 采集页与页面-接口关系模型设计
status: approved
owner: yunpeng
reviewers: yunpeng
prd: docs/projects/PRJ-0001/requirement/interface-capture.md
serves: FR-1、FR-3、FR-7
created: 2026-10-17
updated: 2026-10-17
---

# 采集页与页面-接口关系模型设计  serves: FR-1、FR-3、FR-7

## 摘要  serves: 全文

- **问题**：采集只能通过 agent 对话发起（普通用户不会用）；接口与页面的关系只是卡上的 URL 数组，回答不了"哪个页面用什么入参调了哪个接口"；出入参字段缺位置标注，够不上接口文档。
- **方案**：面板加「采集」页（URL 输入 + 采集按钮）经 `POST /captures` 复用同一 `startCapture` 编排；新增 `page_card_relations` 关系表（pageId × cardId × 入参指纹）与字段 `location` 标注。
- **影响面**：改 normalizer / store / application 桥 / panel-routes / client 五个模块；存量库启动时幂等迁移；agent 工具面行为不变。

## 背景与问题  serves: 全文

### 需求来源

| 需求编号 | 原始诉求 | 本设计如何回应 |
|---|---|---|
| FR-1.1 | 「采集页有一个输入 url 的地方，点击采集就开始采集，不是直接在 agent 里输入」（用户原话） | 新增面板 POST /captures 路由 + 采集页 UI，与 agent 入口共用同一 `startCapture`（§方案总览、§接口设计 IF-1） |
| FR-3.1/3.3 | 「数据库保存接口与页面关系，页面和接口可能是 n:n 的关系，可能区别是入参的不同」（用户原话） | 新增 `page_card_relations` 表，以入参指纹区分同一接口的调用形态（§数据模型） |
| FR-3.5 / A8 | 「入参和出参要采集成接口文档的内容」（用户原话）；追问「content-type 这类的不需要采集吗」（用户原话） | 字段模板补 `location`（path/query/header/body）+ 请求头契约入卡（凭证头只记名不记值），接口卡达到文档可读六要素（§数据模型） |
| NFR（可靠性） | 现有插件纪律：即写即落盘、迁移幂等、凭证零外传 | 启动迁移仿 `migrateLegacyCardScope`；POST 路由不破凭证出口闸（§数据模型、§跨关注点） |

### 现状与代价

- 发起采集只能在 DSH 对话里让 agent 调 `dataforge_capture`：用户要组织自然语言、等 agent 理解、再看文字回执；想"看一眼某页有哪些接口"要开一段对话。
- 页面与接口关系现状是 `interface_cards.related_pages_json`（URL 数组）：同一接口不同入参的调用被不可区分地压平；样本表无外键回指关系，"这条样本是哪种调用形态"无法回答。
- 字段模板只有 field/type/sample/role/unverified，没有 path/query/body 位置——生成的"接口文档"读者要自己猜参数放哪。

### 为什么是现在

采集流水线后四段（编排/执行/结晶/复跑）的原料质量取决于卡片的文档化程度与关系可追溯性；库每多跑一天，legacy 数据回填的不可考范围就扩大一分（指纹无法事后重建，只能标 legacy）。面板骨架（runs/cards 两 tab + 只读路由）已在工作区未提交，采集页是顺势的第三个 tab。

## 目标与非目标  serves: 全文

### 目标

- 用户在采集页输入 URL 点「采集」，不经过 agent 对话即可完成一次 single_page 采集并看到该页接口文档清单（e2e 可证）。
- 同一接口两种入参调用落为一张卡 + 两条关系行，卡片入参模板为两形态并集且差异字段标 `input`（单测可证）。
- 任意样本可经 `relation_id` 追溯到其调用形态；接口卡可列出全部关联页面与形态（store 单测可证）。
- 存量库升级后：迁移幂等、老卡有 `legacy` 关系行、旧工具与旧路由行为不变（迁移测试可证）。

### 非目标

- **不做** site_crawl / action 的面板入口：爬行与写操作的任务参数（深度/确认闸）在按钮交互里表达不清，留在 agent 工具面，做了会稀释采集页的单一心智。
- **不做**指纹的存量精确回填：老样本的请求体原文不全（超限截断），重建指纹必然造假；标 legacy 更诚实。
- **不做**采集任务的队列调度与多并发：同 host 直接 409 拒绝而非排队，排队意味着要做任务生命周期管理，超出本期边界。
- **不做**登录态注入闭环：采集页采集的是无登录/已公开页面；带登录的采集仍走 agent 路径（需求 §12 开放问题 5，下期）。

## 方案总览  serves: FR-1、FR-3、FR-7

**一句话方案**：采集页把 URL POST 到面板路由，路由调与 agent 入口同一个 `startCapture` 编排；采集桥在落卡的同时按「页面 × 卡 × 入参指纹」落关系行，并让样本回指关系行。

```text
面板「采集」页 ──POST /captures──┐
                                  ├─→ startCapture（同一编排/闸门）
agent ── dataforge_capture ──────┘        │
                                          ▼
                              自治 job：openCapturingPage → wireToStore 桥
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                             ▼
     upsertSample（厚数据）      upsertCard（归并+模板并集）     upsertRelation（新增）
            │                                                             │
            └────────────── samples.relation_id 回指关系行 ◄──────────────┘
```

**关键概念**：

- **入参指纹（params_fingerprint）**：对归一化后的 query + 请求体做稳定哈希，区分同一接口的不同调用形态。
- **调用形态**：同一接口卡下、指纹不同的一组调用；每种形态一条关系行。
- **location**：模板字段标注参数位置（path/query/header/body），接口文档可读性的最后一块。

## 架构与依赖  serves: FR-1、FR-3

- **模块划分**：normalizer（指纹与 location 零件，纯函数）→ store（关系表与迁移，同步写）→ application 桥（样本袋聚合与三写编排）→ panel-routes（HTTP 契约）→ client（采集页视图）。
- **依赖方向**：client → panel-routes → application → {browser, normalizer, store}。无环；面板路由只是 `startCapture` 的第二个调用方，不引入第二条流水线。
- **外部依赖**：无新增 npm 依赖。指纹用 `node:crypto` sha256（确定性计算，不破 normalizer"纯函数零 I/O"纪律）。系统 Chrome 不可用时行为与现状一致（run 置 failed 如实回报）。
- **与既有架构的差异**：panel-routes 从"仅 GET"放宽为"GET/POST 白名单"，其余方法仍 405——这是本设计对既有纪律的唯一偏离，理由是发起采集必须有写路由；放宽以白名单为界，不开任意方法。

## 数据模型  serves: FR-3

### 实体与字段

- **新增 `page_card_relations`**：`id 'rel_xxx'` / `capture_id` / `page_id`（可空，action 会话无 page 行）/ `page_url`（冗余，page 行缺席时仍可展示）/ `card_id` / `params_fingerprint`（`'legacy'` = 迁移回填）/ `sample_count` / `first_seen_at` / `last_seen_at`。
- **`request_samples` 加列** `relation_id TEXT`（可空）。
- **`TemplateField` 加字段** `location: 'path' | 'query' | 'header' | 'body'`（出参模板恒 `'body'`）。
- **请求头契约入卡**：从样本袋的请求头聚合出头字段（`location='header'`）——content-type/accept/`x-*` 等业务头照常标角色；**凭证类头（cookie/authorization/proxy-authorization/set-cookie）只记名称、`role='credential'`、`sample` 恒 `'<credential>'`，值永不进模板**。
- **鉴权标志入卡**（`auth_json` 扩展）：`{ authType, evidence, credentialRefs }`——
  - `authType`：`none | token-header | token-param | cookie-session | unknown`；
  - **探测读原始样本，不走 VOLATILE 过滤链**（query 里的 `token` 被模板滤掉后，鉴权标志仍须如实标出——滤键是为了归并稳定，不是为了抹掉契约）；
  - 探测规则：`authorization`/`x-access-token` 头存在 → `token-header`；query/body 字段名命中 `token|access_token|api_key|sign|ticket` → `token-param`；两者皆无但请求带 cookie 且本次 run 有 credential_events → `cookie-session`；都无 → `none`；样本不足 1 条 → `unknown`；
  - `evidence` 只记触发的头/字段**名称**（如 `header:authorization`、`query:token`），值永不入卡；
  - `credentialRefs` 指向本次 run 的 credential_events（复跑换票的锚点，本期只记录不消费）。
- **类型新增** `RelationRow`（type 别名，守工具 schema 纪律）。

### 字段合成规则（卡片入参模板）

入参模板字段由四部分合成（桥内完成，normalizer 提供零件）：

- **path 字段**：urlTemplate 中每个 `{p}` 一个字段（`field: 'path.{p}'`，`location: 'path'`）；
- **query 字段**：urlTemplate 的 query 段逐键展开（`location: 'query'`）；
- **header 字段**：样本袋请求头聚合（`field: 'header.<小写名>'`，`location: 'header'`），凭证类头按上条规则脱敏；
- **body 字段**：`jsonToTemplate(requestBody)` 产出（`location: 'body'`）。

出参模板字段 `location` 恒 `'body'`，另记响应 `contentType` 元信息，供复跑构造请求时对照。

### 约束与不变量

- 唯一索引 `(capture_id, page_url, card_id, params_fingerprint)`：同形态幂等累加，异形态各行。
- 卡片身份仍是 `(capture_id, merge_key)`——关系表不改动卡的归并语义。
- 不变量：卡的 `related_pages_json` = 其关系行 pageUrl 去重集（冗余缓存，关系表为权威）。

### 迁移与回填

1. `PRAGMA table_info(request_samples)` 无 `relation_id` → `ALTER TABLE ADD COLUMN`（幂等）。
2. 老卡逐 `related_pages_json` URL 回填 `params_fingerprint='legacy'` 关系行；`(capture_id,url)` 查 pages 得 page_id，查不到留 NULL。**不伪造指纹**；唯一索引兜底幂等。
3. 老模板 JSON 无 location：读取侧 `rowToCard` 兜底 `'body'`，不回填。
4. 回滚：迁移只增不删（新表 + 新列 + 新行），回滚 = 代码降级后新表闲置，旧逻辑不读新表，无破坏性。

### 生命周期

- 写入：采集进行中逐样本落关系行/回指；更新：同形态样本计数与 last_seen_at 刷新；归档/删除：随 capture run 生命周期，不单独清理。

## 接口设计  serves: FR-1、FR-7

| 编号 | 接口 | 输入 | 输出 | 失败与错误 | 兼容性 |
|---|---|---|---|---|---|
| IF-1 | `POST /dashboard/api/dataforge/captures` | JSON `{entryUrl}`；非法 JSON / 非法 URL / body>8KB | `{captureId, status:'running'}` | 400 bad-json / 400 bad-url / 409 host-busy / 413 too-large | 新增端点，无旧调用方 |
| IF-2 | `GET /dashboard/api/dataforge/runs/:id/cards` | 路径 id | `{cards, relations}`（模板含 location） | 404 not-found | 新增端点 |
| IF-3 | `paramsFingerprintOf(rawUrl, requestBody?)`（normalizer 纯函数） | URL 字符串、可选请求体 | 16 hex 指纹 | 非法 URL 按原样参与哈希（不抛） | 模块内新导出 |
| IF-4 | `upsertRelation(captureId, pageUrl, cardId, fingerprint, pageId?)`（store） | 见签名 | relationId（幂等） | store 纪律同现有（同步写，异常上抛） | 新方法 |
| IF-5 | 客户端 `postCapture(entryUrl)` / `fetchRunCards(runId)` | 见 §7.3 | 信封解析后数据 | PanelApiError（服务端 error 直透） | 客户端内部 |

#### IF-1 POST /captures

**语义**

面板发起 single_page 采集的唯一写入口。服务端校验后调 `startCapture(deps, {taskType:'single_page', entryUrl})`，与 agent 工具入口共用编排与闸门；接受即后台 job 启动，调用方拿 captureId 轮询。面板发起无 confirm 闸（用户点击即显式操作，且 single_page 只读）；action 不从面板开。

**错误码**

- `bad-json`（400）：body 非 JSON 或缺 entryUrl → 调用方修正输入，不重试。
- `bad-url`（400）：与 agent 入口同一闸语义 → 同上。
- `host-busy`（409）：同 host 有 running run → 调用方提示"该站点正在采集中"，等收口后重试。
- `too-large`（413）：body 超 8KB → 放弃。

**兼容性**

纯新增；既有 GET 路由与方法外 405 纪律不变（白名单 GET/POST，其余仍 405）。

**幂等与重试**

非幂等（每次成功调用产生新 run）。409 是天然的重复点击防护；客户端在按钮上加"进行中禁用"，不做重试键。

#### IF-2 GET /runs/:id/cards

**语义**

run 详情现有 pages/samples/credentials 三块独缺 cards；本端点补齐并附 `relations`，供采集页按「页面 → 接口 → 调用形态」分组渲染结果。

**错误码**

- `not-found`（404）：run 不存在 → 调用方展示空态，不重试。

**兼容性**

纯新增。响应模板字段带 `location`，老库读出的模板经兜底恒有该字段，客户端无需版本判断。

#### IF-3 paramsFingerprintOf（normalizer 纯函数）

**语义**

区分同一接口的调用形态：query 滤 VOLATILE 键、按键名排序、保值；body 为 JSON 时递归键排序规范化（数组保序），非 JSON 原样；**请求 content-type 一并参与**（同 URL 同 body 但 json/form 编码不同 = 不同形态）；`sha256(JSON.stringify([contentType, queryPairs, normalizedBody]))` 取前 16 hex。与 mergeKey 相反，指纹**值参与计算**——形态的差异恰恰在值。

**错误码**

不抛异常：非法 URL 以原样字符串参与哈希（采集旁路不允许因归一化失败丢样本）。

**兼容性**

模块内新导出，无旧调用方。指纹算法变更会使新旧指纹不可比——算法冻结在 M1，变更需新版本与关系表重建说明。

#### IF-4 upsertRelation（store）

**语义**

`(capture_id, page_url, card_id, params_fingerprint)` 幂等：已存在则 `sample_count+1` 并刷新 `last_seen_at`，否则建行；返回 relationId。同时维护卡片冗余 `related_pages_json`（= 关系行 pageUrl 去重集），关系表为权威、卡字段为缓存。

**错误码**

无错误码：沿用 store 纪律（better-sqlite3 同步写，异常原样上抛由编排层收口为 run failed）。

**兼容性**

新方法。旧库经启动迁移获得表与 legacy 行后行为一致；迁移幂等（唯一索引兜底），重复启动无副作用。

#### IF-5 客户端 postCapture / fetchRunCards

**语义**

采集页与数据面的唯一接触点；与既有 GET 访问器共用信封解析（服务端 error 直透、本地异常包上下文），`postCapture` 仅多带 method/body。

**错误码**

无自有错误码：HTTP/信封异常统一 `PanelApiError`，409 host-busy 等服务端语义以 error 原文呈现于状态条。

**兼容性**

客户端内部模块，与服务端同仓库同版本发布，无跨版本承诺。

## 备选方案  serves: 全文

| 方案 | 一句话说明 | 优点 | 代价 | 为什么未选 |
|---|---|---|---|---|
| A（选用）：关系表 + 指纹 + 面板写路由 | 按需求 v1.1 目标模型补齐三件套 | 关系可追溯、文档可读、入口顺手 | 改五模块 + 迁移 | — |
| B：只在卡片 JSON 里扩字段 | 不建关系表，把形态数组塞进 `related_pages_json` | 零迁移、改动小 | JSON 数组无法索引/分页/join，"接口出现在哪些页面"要全表扫；样本仍无法回指形态 | 把查询面压力推给每次读取，且堵死后期"项目接口库导入"的溯源需求 |
| C：指纹用全量原文替代哈希 | 关系行存规范化后的完整入参 | 无需哈希、可直接展示 | 大入参灌库（与 256KB 截断纪律冲突）；重复形态存重复原文 | 与体量保护纪律直接冲突；指纹展示需求可由样本回查满足 |
| D：什么都不做 | 维持 agent 入口 + URL 数组 | 零成本 | 需求 v1.1 三条用户原话诉求全部不满足；legacy 数据范围随时间扩大 | 用户已明确入口与关系建模是第一期主线 |

## 四风险与证据  serves: 全文

| 风险类型 | 判断问题 | 现有证据 | 结论 |
|---|---|---|---|
| 价值 | 用户真的想要吗 | 用户三轮原话（面板入口 / n:n 关系 / 接口文档内容）直接改写需求文档 | 已验证 |
| 可用性 | 用户会用吗 | 采集页是"输入框 + 按钮"的最低交互；无原型测试 | 部分（布局评审时过一眼线框） |
| 可行性 | 我们建得出来吗 | MVP-1 已交付：旁路采集/归一化/SQLite 迁移（migrateLegacyCardScope）/面板 GET 路由均在运行；sha256 与 ALTER TABLE 是标准能力 | 已验证 |
| 商业可行性 | 公司能接受吗 | 个人/内部工具，无合规与定价面；凭证红线在路由层已有出口闸先例 | 已验证 |

**未验证项的补课计划**：可用性"部分"——M2 采集页出来后用 baidu.com 做一次真实点击验收（需求 A6 验收项），错成本为一次 e2e 运行。

## 失败模式与回滚  serves: 全文

| 失败场景 | 触发条件 | 用户可见影响 | 检测手段 | 回滚动作 | 决策人 |
|---|---|---|---|---|---|
| 迁移失败 | 老库结构意外（手工改过表） | 插件启动失败 | 启动日志 + vitest 迁移用例 | 迁移包在 try 内、失败时跳过新表并降级为旧行为（不读新表） | yunpeng |
| 指纹爆炸 | 某站把易变值放在 body 深层 | 关系行数膨胀、卡下形态刷屏 | run 详情 relations 计数；单卡关系行超 50 时面板如实提示 | 配置项追加易变 body 路径黑名单；存量行保留不删 | yunpeng |
| host-busy 误伤 | 上一次 run 异常未收口（进程被杀） | 同站永远 409 | 采集页状态条可见 running 残留 | `capture_cancel` 幂等收口后即可重发；面板给"强制收口"提示文案 | yunpeng |
| POST 路由被滥用 | 面板无鉴权，同机任意脚本可发起采集 | 对目标站的非预期请求 | NDJSON 审计流含发起来源 | 路由默认只绑 127.0.0.1（随宿主 webServer）；不暴露公网 | yunpeng |

- **开关**：无新增配置开关；并发策略（同 host 409）若需放宽再加 `captureAllowSameHostConcurrent`，默认 false。
- **回滚演练**：迁移用例在 vitest 内覆盖"老库 → 升级 → 再升级（幂等）"；代码级回滚 = revert 提交，旧逻辑不读新表。
- **不可逆动作**：无（迁移只增不删）。

## 跨关注点  serves: 全文

| 关注点 | 结论 | 依据与措施 |
|---|---|---|
| 安全 | 不破红线 | POST 只收 URL，无凭证上行；IF-1/IF-2 响应经同一剥壳纪律；store 全参数化 SQL；采集页零 innerHTML |
| 隐私与合规 | 不变 | 采集数据仍只在本地 SQLite；凭证原文不出壳（既有出口闸覆盖新路由） |
| 成本 | 可忽略 | 单表单条关系行 < 200B；样本袋内存上限每 mergeKey 20 条 |
| 可观测性 | 沿用 | 关系行/迁移走既有 NDJSON 事件流（appendEvent 增 'relation' kind）；轮询与状态面不变 |
| 性能与容量 | 先坏在指纹爆炸 | 见失败模式表第二行；正常站点关系行数 ≈ 接口数 × 形态数，量级百内 |
| 文档与支持 | 本设计 + README 追加采集页一段 | 验收时同步更新 README 形态速览图 |

## 交付拆分与里程碑  serves: 全文

| 里程碑 | 内容 | 出口判据 | 负责人 | 目标日期 |
|---|---|---|---|---|
| M1（契约冻结） | normalizer 指纹 + location；store 关系表 + 迁移 | 纯函数与 store 单测全绿；DDL/路由契约冻结，后续里程碑不改 | yunpeng | 2026-10-18 |
| M2（链路贯通） | application 桥三写 + POST /captures + GET /runs/:id/cards | 编排单测：两形态一卡两关系行；路由 400/409/200 用例齐 | yunpeng | 2026-10-18 |
| M3（采集页 + 验收） | client 采集页 tab + e2e 门 | `CAPTURE_E2E=1` 真实站点 POST 发起 → 采集页看到接口文档；typecheck/build/test 全绿 | yunpeng | 2026-10-19 |

## 需求追溯  serves: 全文

| 需求编号 | 设计节 | 测试用例 | 指标 |
|---|---|---|---|
| FR-1.1 双入口 | 方案总览、接口设计 IF-1 | panel-routes POST 用例 | 不适用 |
| FR-3.1 关系表 | 数据模型 | store 关系行幂等用例 | 不适用 |
| FR-3.3 调用形态 | 数据模型、架构与依赖 | 指纹 query 序无关/body 键排序用例 | 不适用 |
| FR-3.4 模板并集 | 架构与依赖（样本袋） | 桥两形态并集 + role=input 用例 | 不适用 |
| FR-3.5/3.6 文档六要素 | 数据模型（location、请求头契约）、接口设计 IF-2 | location 标注用例、凭证头脱敏用例 | 不适用 |
| FR-3.7 鉴权标志 | 数据模型（鉴权标志入卡） | authType 五值探测用例（含 query token 被 VOLATILE 滤后仍标 token-param） | 不适用 |
| FR-7.1/7.2 采集页 | 接口设计 IF-1/IF-2、交付 M3 | e2e-capture 门 | 不适用 |
| 名称可读性（2026-10-17 用户反馈：网站/网页/接口都没有名称） | 追记·三级名称 | store 页面标题幂等/投影用例、`semanticName` v2 用例、`/names` 读写用例、补抓身份校验用例、客户端名称解析用例 | 不适用 |
| NFR 可靠性 | 数据模型（迁移）、失败模式 | 迁移幂等用例 | 不适用 |

## 常见问题  serves: 全文

| 问题 | 回答 |
|---|---|
| 最可能被投诉什么 | "我点的采集怎么 409 了"——上一次 run 残留 running；采集页状态条直接给原因与处置（cancel 后重发） |
| 6 个月后会成为什么负担 | legacy 关系行永远区分不了形态——它是诚实标注，不是债；新采集的行都有真指纹 |
| 流量涨 10 倍先坏在哪里 | 指纹爆炸（失败模式表第二行）：黑名单配置项兜底；其次是样本袋内存，已有每 mergeKey 20 条上限 |
| 谁半夜被叫起来、手上有什么 | 本地工具无值班；真出事看 `<dataRoot>/capture/events.ndjson`，每次请求/关系/迁移都在里面 |
| 数据错了怎么修、修得回来吗 | 关系行错 → 删行重采即可（样本层厚数据是权威，关系与卡都可重建）；迁移只增不删，无修数场景 |
| 这个决定错了多久能发现 | 指纹规则错（误并/漏并形态）在第一次双形态站点采集的编排单测与 e2e 就会暴露 |

## 追记：三级名称（2026-10-17，v1.3）  serves: FR-7.3、FR-7.5

**问题**：接口库/采集网站里网站只有 host、页面只有 URL、接口名是机械的「GET hotrank」——原型（`docs/prototypes/sites.html`、`api-library.html`）写明「按 Host 自动归档、自动取名」并带「自动取名」标签，但数据面从未记录过标题，面板也没有改名入口。

**一句话方案**：采集期把页面标题/站点名落进 `pages`，读取面按「手工名 > 编排名 > 自动名 > host/URL」投影出三级名称；旧数据由面板「补抓名称」用已存 cookie 重访补齐；接口名另给面板改名入口（按 mergeKey 持久化）。

- **数据模型**：`pages` 加 `title`（`document.title`）与 `site_name`（`og:site_name` / `application-name` / `apple-mobile-web-app-title`），启动迁移只 ALTER 加列；`upsertPage` 按 (capture_id, url) 幂等，标题随 meta 更新、不重复计页。历史行留空 = 当时没记，不回填猜测。
- **采集落标题**：`browser.ts` 在主 frame 导航/`load` 防抖读标题并经 `onPageMeta` 上报；`session.ts` 的 `Sink` 增加同名回调（open 期先暂存、bindSink 补发，入口页不丢）；single_page / site_crawl / action 三条路径统一 `upsertPage(..., {title, siteName})`。
- **名称解析（只读投影，不改卡文件）**：
  - 网站名：手工 `/names` 覆盖 > **编排已有站点名**（链 `meta.site`，经 overview 的 `site × hosts` 投影，保证编排页与采集/接口库显示同一个名字）> 该 host 最新页面的 `site_name` > 入口页标题经 `siteLabelFromTitle` 截断 > host。标题推断来源在 UI 上标「自动取名」；编排名是已 authored 的名字，不标。
  - 页面名：手工覆盖 > 页面 `title` > 无（退回 URL）。
  - 接口名：手工覆盖（键 = `mergeKey`）> `semanticName` v2（路径去噪、取末两段 humanize、**不带方法前缀**，方法由徽标单独展示）。
- **旧数据补抓**：`POST /retitle` 由插件进程用 `credential_events` 里的 cookie 无头重访缺标题页面（入口页优先）；**页面最终身份必须等于目标身份才写回**——登录墙重定向只会记 failed，绝不把登录页标题安到目标页上。单飞；**采集闸按 host**：正在采集的 host 本轮跳过、其余 host 照常补抓，全部目标被挡才回 `capture-running`（一条遗留 running 行不该永久堵死名称补抓）；`GET /retitle/status` 给计数。
- **手工名存储**：`<dataRoot>/capture/names.yaml`（`sites` = 小写 host、`pages` = 页面身份、`interfaces` = mergeKey），tmp+rename 原子写；`GET/POST /names` 读写。放在 dataRoot 而非工作区：被命名的采集卡/站点本就是 dataRoot 的全局采集库数据。
- **面板路由**：`GET /page-meta`（按页面身份去重的最新标题投影）、`GET/POST /names`、`POST /retitle`、`GET /retitle/status`；`/cards` 与 `/runs/:id` 的卡片投影补 `mergeKey` / `name` / `nameSource`（`auto`|`manual`）。

**边界与代价**：
- 名称是**展示投影**：不改链、不改项目接口库 YAML（库里仍是导入时快照）；存量 `interface_cards.name` 不回写，v2 规则只在读取投影与后续采集中生效。
- 自动名可能不准（没有 `og:site_name` 时靠入口页标题启发式），所以标「自动取名」而不谎称人工确认。
- 补抓是网络动作：cookie 失效的登录页会被身份校验拦下记 failed；不做后台定时回填，只在用户点按钮时跑。
- 客户端对 `/page-meta`、`/names` 取数失败必须降级为空（老服务端未更新时页面照常可用，只是没有名称）。

## 开放问题  serves: 全文

| 问题 | 选项 | 负责人 | 截止 |
|---|---|---|---|
| 采集页是否放「强制收口残留 run」按钮 | A 只给文案提示 / B 加按钮直调 cancel | yunpeng | M3 评审 |
| 形态在接口库的展示粒度 | A 卡详情列形态清单 / B 接口库列表直接展开形态行 | yunpeng | M3 评审 |
| 易变 body 路径黑名单 | 默认空集，按真实站点积累后补默认值 | yunpeng | 下一迭代 |

## 附录  serves: 全文

- **关联文档**：需求 [../requirement/interface-capture.md](../requirement/interface-capture.md)；MVP-1 设计 [../../superpowers/specs/2026-10-17-interface-capture-design.md](../../superpowers/specs/2026-10-17-interface-capture-design.md)；MVP-1 计划 [../../superpowers/plans/2026-10-17-interface-capture.md](../../superpowers/plans/2026-10-17-interface-capture.md)
- **现状代码**：[store.ts](../../../src/capture/store.ts)（迁移先例 `migrateLegacyCardScope`）、[normalizer.ts](../../../src/capture/normalizer.ts)（VOLATILE 表与归并键）、[panel-routes.ts](../../../src/capture/panel-routes.ts)（出口闸与 405 纪律）、[board-runs.ts](../../../src/client/board-runs.ts)（轮询与三态先例）
- **评审记录**：待评审
- **变更历史**：2026-10-17 v1.0 初稿；2026-10-17 v1.1 补请求头契约（location 增 'header'、凭证头脱敏、content-type 参与指纹）——源于评审追问「content-type 这类的不需要采集吗」；2026-10-17 v1.2 补鉴权标志（authType 五值 + 探测证据 + credentialRefs，探测绕开 VOLATILE 过滤链）——源于评审追问「token 这个需要标志是否接口需要 token」；2026-10-17 v1.3 三级名称（pages.title/site_name、名称解析优先级、旧页面补抓、接口自动名 v2 + 改名）——源于用户反馈「网站和网页没有名称」「接口也需要名称」
