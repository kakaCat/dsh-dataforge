---
title: 凭证注入与登录态换票 · R-4 设计
status: draft
owner: yunpeng
reviewers: 待定
prd: docs/projects/PRJ-0002/requirement/r4-credential-injection.md
serves: FR-4.1、FR-4.2、FR-4.3、FR-4.4、FR-4.5、FR-4.6
created: 2026-10-17
updated: 2026-10-17
---

# 凭证注入与登录态换票 · R-4 设计  serves: FR-4.1～FR-4.6

## 摘要  serves: 全文

- **问题**：R-3 执行引擎已经能按链发请求，但它刻意不碰登录态——`card.auth` 只投影标志，请求不带任何凭证；真实业务链第一步就 401，R-5（首跑）与 R-6（无人值守复跑）因此全部堵住。
- **方案（分三段交付，不一次做完）**：
  1. **M1 注入**：执行期从一期采集库（`capture.sqlite` 的 `credential_events`）按「卡的来源 captureId + 目标 origin」解析 cookie，在 `buildRequest()` 之后、`httpRequest()` 之前把 `cookie` 头注入；值只在进程内过手，运行记录只留名字/来源，不留值。
  2. **M2 换票**：401 时执行一条**显式声明的登录链**（普通 `interface-chain`，经 `dataforge_chain_run` 的 `relogin` 运行参数传入），从登录响应收割 `set-cookie` 进本次运行的内存 cookie jar，单飞换票后重放原请求一次；登录链的账号/密码来自运行期槽位，不落链文件、不写运行记录。
  3. **M3 硬化**：换票节流与过期刷新、token 型凭证补课/持久化、零凭证泄漏的扫描门。
- **本期实际落地**：M1（cookie 注入）+ M2（401 换票，2026-10-17）。M3（token 补课/持久化/节流/扫描门）的接口与失败语义仍按本设计推进。
- **关键决策（回答需求 Q1）**：**cookie 型先行，token 型如实拒绝**。一期采集只落 cookie（本机实查：48 条 `cookie`、0 条 `token`/`localStorage`、0 条 `login_sessions`），token 型站点在 M1 不伪造注入，回执明说「token 型凭证未采集」；补采集是 M3 的前置，不在 R-4 里偷做。
- **影响面**：新增 `src/execute/credentials.ts`（纯函数 + 契约）与 `src/capture/credentials.ts`（只读采集库的 provider）；`src/execute/run.ts` 增加注入点与 401 诊断；`src/orchestration/application.ts` 加一个可选依赖缝；`src/index.ts` 装配。**不改**链/卡文件格式，**不新增 npm 依赖**，**不加数据库表**（M1）。

## 背景与问题  serves: 全文

### 需求来源

| 需求编号 | 原始诉求 | 本设计如何回应 |
|---|---|---|
| FR-4.1 | 按一期凭证卡记录定位并注入真实值；注入点在请求构造之后、发出之前 | M1：`CredentialProvider` 按卡的 `sources[].captureId` + 目标 URL 的 host/path/secure 解析 cookie；`run.ts` 在 `buildRequest()` 与 `httpRequest()` 之间注入 |
| FR-4.2 | 401 时按 `credential_events` 锚点重放登录卡链路，更新本地凭证后继续 | M2：登录链作为显式声明执行，收割 `set-cookie` 更新内存 jar；**不猜登录接口、不自动填账号密码** |
| FR-4.3 | 换票成功后重放被 401 的请求，链不断 | M2：单飞换票后仅重放当前节点一次；重放仍有 401 → 中止，不无限循环 |
| FR-4.4 | 凭证值只在执行进程内过手，不入运行记录、不出路由、不进日志 | M1：注入值不进入任何摘要/事件/回执；`requestDigest.headers.cookie` 恒为 `***`；单测对事件全文做原文扫描 |
| FR-4.5 | 重登失败 → 链中止 + 明确诊断「需人工重新登录」 | M2：新错误码 `relogin-failed` / `relogin-unavailable`，消息固定带「需人工重新登录并更新凭证」 |
| FR-4.6 | 同一会话换票进行中时并发请求等待，不并发重登 | M3：按 `origin + 登录链` 的 single-flight；M2 先保证「同一运行内只换一次」 |

### 现状与代价

一期把凭证「记录」下来了，但记录面比需求假设的窄：

| 数据面 | 一期实际能力（本机 `dataRoot` 实查） | 对 R-4 的影响 |
|---|---|---|
| `credential_events` | 只有 `kind='cookie'`（48 条），`token`/`localStorage` 为 0 | M1 只能做 cookie 注入；token 型如实拒绝 |
| `login_sessions` | 表已建，**没有写入方**（0 行） | 不能靠它复用登录态 |
| 卡 `auth` 标志 | 23 张 `none`、3 张未判定（`null`），没有 `cookie-session` 样本 | 真实登录态站点尚未进入采集样本库；M1 用合成卡 + 本地服务验证 |
| 登录卡标注 | 采集期没有「登录卡」字段/表 | FR-4.2 的「按锚点重放登录卡链路」当前**没有锚点**，必须显式声明登录链 |
| 账号/密码 | 一期不采集、不存储 | 换票输入只能来自运行期槽位；无人值守复跑需要另行补课（M3） |

代价很直接：执行引擎跑真实业务链时只能拿到 401，回执还会说「凭证注入是 R-4 的事」——用户被卡在一个没有出口的提示上。但如果不先把「凭证从哪来、什么时候算过期、换票失败怎么诚实」定清楚，直接写「自动重登」会变成：把账号密码写进链文件、把 token 打进日志、401 无限重试。这三件事都比 401 本身更贵。

出处：R-4 需求 §1/§2/§5/§6；PRJ-0001 需求 G5 与 FR-5.1～5.3；本机采集库实查（2026-10-17）。

### 为什么是现在

R-3 已经冻结了执行错误码与请求构造边界，401 现在有确定落点（`node-auth-required`）；R-5/R-6 都要求「无人值守直跑」，没有凭证注入就只能是人工回放。再晚做，R-6 的复跑会在「凭证过期」这一条上返工，而且会把凭证语义带进结晶（把 cookie 冻成常量）——那是安全红线。

## 目标与非目标  serves: 全文

### 目标

- **M1**：一张 `auth: cookie-session` 的卡，经 `dataforge_chain_run` 发出的请求带上了采集期同站点的 cookie；值只出现在出站请求里，运行记录、日志、工具回执、面板路由中都扫不到原文；
- **M1**：没有可用凭证时不伪造、不发明文空值；401 回执能区分「未注入」与「注入了但仍 401」，后者明确指向 M2 换票；
- **M1**：注入不影响 R-3 既有语义——无凭证提供者（provider 缺席）时行为与今天完全一致；
- **M2**：显式声明登录链后，401 → 登录链执行 → 收割新 cookie → 重放原请求一次；登录链失败 → 中止并报「需人工重新登录」；
- **M2**：并发节点同时遇 401 时，同一运行内只执行一次登录链，其它节点等结果；
- **M3**：token 型凭证具备与 cookie 同等的注入/换票能力，或明确降级为「本期不做」并在回执里给出补课路径；零泄漏扫描成为 CI 门。

### 非目标

- **不做凭证采集/录入 UI**：一期范围。M1 只消费已有 `credential_events`；需要新凭证时走重新采集。
- **不把账号密码写进链/卡/运行记录**：M2 的登录输入只从运行期 `inputs` 取，运行记录只留槽位名，不留值。
- **不做验证码/风控/双因素突破**：诚实边界；遇到即失败并建议人工登录。
- **不自动嗅探登录接口**：没有登录卡标注就不猜。M2 要求显式声明登录链（链级 `auth.login` 或运行参数，见开放问题 Q2）。
- **不做跨站点凭证复用**：凭证按卡来源 captureId + origin/path 匹配；拒绝把 A 站 cookie 发给 B 站。
- **不改 `apiVersion: dataforge/v1` 的已有字段语义**：M1 零格式变更；M2 若加链级 `auth` 段按可选字段加法，老链零迁移。
- **不加 npm 依赖**：cookie 解析与匹配是本地纯函数；SQLite 用已装的 `better-sqlite3`（只读打开）。
- **不新增数据库表**：M1 只读 `capture.sqlite`；M2 的换票结果先只活在一次运行内（内存 jar），持久化归 M3。

## 方案总览  serves: FR-4.1

**一句话方案**：把「凭证从哪来」收进一个注入式 provider，把「怎么注入」收进执行层的唯一注入点，把「401 怎么办」收进调度器的显式换票分支——三层各自可单测，任何一层都不接触链文件。

```text
dataforge_chain_run(site, flow, ...)
        │
        ▼
runChain(deps, { ..., credentials?: CredentialProvider })
        │
        │  每节点：buildRequest()（R-3，纯函数）
        ▼
credentials({ card, url, method, nodeId })
        │  ├─ card.auth = none/unknown → 不注入，只记状态
        │  ├─ token-header/token-param → 不伪造，记 unsupported（M1）
        │  └─ cookie-session → 只读 capture.sqlite：
        │        sources[].captureId → credential_events(kind=cookie)
        │        → 按 host/domain、path、secure、expires 过滤
        │        → cookie: name=value; ...
        ▼
httpRequest()（R-3 唯一出口，credentials:'omit'）
        │
        ├─ 2xx → 正常出参/绑定
        └─ 401/403 且 card.auth≠none
                ├─ 注入了 → node-auth-required（M1：说明可能过期；M2：进换票）
                └─ 未注入 → node-auth-required（说明没有可用凭证）
```

**关键概念**：

- **凭证提供者（CredentialProvider）**：执行层注入的一个函数，输入「卡 + 目标 URL + 节点」，输出「要合并的请求头 + 可审计的注入摘要」。执行层不认识 SQLite、不认识 capture 域。
- **注入摘要（CredentialApplication）**：只有 `status / names / domains / captureIds / expired / reason`，**没有值**。它进运行事件，供人事后回答「这次到底带没带凭证、带了哪几个名字」。
- **cookie jar（M2）**：一次运行内的可变凭证集合。换票写入它，后续节点从它取；运行结束即丢，不落盘。

## 架构与依赖  serves: FR-4.1、FR-4.4

- **模块划分**：
  - `src/execute/credentials.ts` → 纯函数 + 契约：`CredentialProvider`、`CredentialNeed`、`CredentialApplication`、`CredentialCookie`；`selectCookies(entries, url, now)`、`cookieHeaderOf(cookies)`、`mergeCredentialHeaders(existing, injected)`。不读盘、不联网。
  - `src/capture/credentials.ts` → provider 实现：只读打开 `capture.sqlite`，按 `captureId` 查 `credential_events`，把 `value_json` 投影成 `CredentialCookie[]`，调 `selectCookies`。数据库不存在/不可读 → 返回 `status: 'none'` + 中文 reason，不抛。
  - `src/execute/run.ts` → 注入点：`buildRequest()` 成功后调 provider；把返回头合并进请求；把摘要放进 `NodeResult.credentials` 与 `step.start.data.credentials`；401 分支据此改诊断。
  - `src/orchestration/application.ts` → 依赖缝：`ChainRunToolDeps.credentials?: CredentialProvider`，原样传进 `runInput`。
  - `src/index.ts` → 装配：用 `config.dataRoot` 拼采集库路径，`createCaptureCredentialProvider({ dbPath })`。
- **依赖方向**：`index.ts` → `capture/credentials.ts` → `execute/credentials.ts`（只 type/纯函数）；`orchestration/application.ts` → `execute/run.ts`。`execute/*` **不 import** `capture/*`，capture 与 execute 之间只有单向的类型依赖，无运行时环。
- **外部依赖**：`better-sqlite3`（已在依赖里，只读打开，`fileMustExist: true`）；Node 22 内置 `URL`。无新包。
- **失败面**：provider 自身**不抛**——数据库缺失、SQL 错、JSON 坏都折成 `status: 'none' | 'expired'` + reason。执行层只在 HTTP 响应上判 401，不对凭证解析失败做「猜一个值」的兜底。

## 数据模型  serves: FR-4.1、FR-4.4

### 只读采集库（不新增表）

M1 只读 `dataRoot/capture/capture.sqlite` 的既有表：

```sql
SELECT capture_id, kind, url, name, value_json, obtained_at
FROM credential_events
WHERE capture_id IN (?, ?, ...) AND kind = 'cookie'
ORDER BY obtained_at ASC
```

`value_json` 是一期落库的 Playwright cookie 对象：

```jsonc
{
  "name": "JSESSIONID",
  "value": "<secret>",
  "domain": ".scm.example.com",
  "path": "/",
  "expires": 1792208073,        // 秒；-1 = 会话 cookie
  "httpOnly": true,
  "secure": true,
  "sameSite": "Lax"
}
```

- 只取 `kind='cookie'`；`token`/`localStorage` 在 M1 不消费（见非目标）。
- `capture_id` 必须来自卡的 `sources[].captureId`；**不做全库兜底扫描**，避免把 A 站凭证发给 B 站。
- 一期老行可能 `value_json` 为空或字段缺失 → 跳过该行，不让坏行炸整条链。

### 投影与匹配（`CredentialCookie`）

```ts
type CredentialCookie = {
  name: string
  value: string
  domain: string        // 原样保留前导点，匹配时再归一
  path: string          // 缺省 '/'
  secure: boolean
  /** 毫秒时间戳；undefined = 会话 cookie（不按时间过期）。 */
  expiresAt?: number
  captureId: string
  obtainedAt: number
}
```

匹配规则（与浏览器 cookie 语义对齐的最小集）：

1. **domain**：去掉前导点后小写；`host === domain` 或 `host.endsWith('.' + domain)`；空 domain 不匹配。
2. **path**：请求 path 等于 cookie path，或以 `cookiePath + '/'` 开头；cookie path 为 `/` 时恒匹配。
3. **secure**：`cookie.secure === true` 时只允许 `https:`。
4. **expires**：`expiresAt` 存在且 `<= now` → 过期；**会话 cookie 不过期**。
5. **去重**：同 `name + path` 只留一个，优先更具体的 domain（更长），再优先 `obtainedAt` 更新者——避免同名 cookie 在 `Cookie` 头里重复。
6. **顺序**：path 更长的在前（浏览器风格），同长度按 name 字典序，保证可复现。

### 注入摘要（进事件，不进去）

```ts
type CredentialApplication = {
  status: 'applied' | 'none' | 'expired' | 'unsupported'
  source: 'capture'
  header?: 'cookie'
  /** 只留 cookie 名，不留值。 */
  names: string[]
  /** 匹配到的 cookie domain（不是页面 URL）。 */
  domains: string[]
  captureIds: string[]
  /** 匹配到但已过期的条数。 */
  expired: number
  /** 失败/降级的中文原因（可进事件）。 */
  reason?: string
}
```

**不变量**：`CredentialApplication` 的任何字段都不允许出现 cookie 值；`RequestDigest.headers` 里 `cookie` / `authorization` / `set-cookie` 恒为 `***`（R-3 的 `redactHeaders` 已有，M1 复用）。

### 换票（M2）：一次运行内的内存 jar

```ts
type ReloginSpec = {
  site: string
  flow: string
  version?: number
  /** 登录链槽位值（账号/密码等）：只在内存里过手，不落链、不写运行记录。 */
  inputs?: Record<string, unknown>
  /** 登录链目标源；缺省按登录链卡的来源 origin 推断。 */
  baseUrl?: string
}

type ReloginOutcome =
  | { ok: true; cookieHeader: string; cookieNames: string[]; runId?: string }
  | { ok: false; code: 'relogin-failed' | 'relogin-unavailable' | 'relogin-cycle'; message: string; runId?: string }

type ReloginRecord = {
  attempted: true
  success: boolean
  code?: string
  message?: string
  /** 登录链自己的 runId（可在 dataforge_chain_runs 里回看；参数已脱敏）。 */
  runId?: string
  /** 登录链下发的 cookie 名（不是值）。 */
  cookieNames?: string[]
}
```

- **登录链是普通 `interface-chain`**：复用同一套加载/校验/执行，不引第二种登录描述语言；它不参加主链的拓扑，不在主链 `nodes` 里。
- **敏感模式**：登录链以 `sensitive: true` 执行——`run.json.params` 的值写成 `***`，请求/响应正文摘要写 `[已脱敏]`，`emitted`/绑定预览不落值；只有 `set-cookie` 经回调进内存。
- **内存 jar**：`relogin` 成功后把 `set-cookie` 解析成 `name=value`，按 name 覆盖旧 cookie；只活一次运行，不写 `capture.sqlite`、不写工作区。
- **单飞**：一次运行只有一个 `reloginTask` Promise；并发节点同时 401 时都等它，登录链只执行一次。
- **重放一次**：换票成功后只重放当前节点一次；重放仍 401 → 中止，报「换票后仍 401」。
- **自环保护**：`relogin.site/flow` 与主链相同 → `relogin-cycle`，绝不递归登录。

## 接口设计  serves: FR-4.1、FR-4.4

| 编号 | 接口 | 输入 | 输出 | 失败与错误 | 兼容性 |
|---|---|---|---|---|---|
| IF-1 | `CredentialProvider`（注入缝） | `{ card, url, method, nodeId }` | `{ headers, application }` | 不抛；内部失败折成 `application.status/reason` | 新内部接口；provider 缺席 = 今天的行为 |
| IF-2 | `selectCookies()`（纯函数） | `CredentialCookie[]`、绝对 URL、`now` | `{ selected, expired, matched }` | 不合法 URL → 空结果 | 新纯函数，可穷举单测 |
| IF-3 | `mergeCredentialHeaders()`（纯函数） | 已有头 + 注入头 | 合并后的头 | 同名 `cookie` 追加、其它同名覆盖 | 新纯函数 |
| IF-4 | `createCaptureCredentialProvider()` | `{ dbPath, now? }` | `CredentialProvider` | 库不存在/坏行 → `status:'none'` | 新工厂；只读打开 |
| IF-5 | `runChain` 注入点 | 现有 `RunChainInput` + `credentials?` | 现有结果 + 节点摘要 | 401 诊断扩展，错误码只增 | 可选入参，旧调用零变化 |
| IF-6 | `dataforge_chain_run.relogin`（M2） | `{ site, flow, version?, inputs?, baseUrl? }` | 主链继续执行；节点 `relogin` 摘要 | `relogin-failed` / `relogin-unavailable` / `relogin-cycle` | 新增可选运行参数；不传 = M1 行为 |
| IF-6 | `dataforge_chain_run.relogin`（M2） | `{ site, flow, version?, inputs?, baseUrl? }` | 主链继续执行；节点 `relogin` 摘要 | `relogin-failed` / `relogin-unavailable` / `relogin-cycle` | 新增可选运行参数；不传 = M1 行为 |

#### IF-1 CredentialProvider

```ts
type CredentialNeed = {
  card: InterfaceCardDoc
  url: string          // buildRequest 产出的绝对 URL
  method: string
  nodeId: string
}

type CredentialResolution = {
  headers: Record<string, string>
  application: CredentialApplication
}

type CredentialProvider = (need: CredentialNeed) => CredentialResolution
```

**语义**：只回答「这一发请求要不要带凭证、带哪些」，不做 HTTP、不改计划、不抛。执行层把它当纯数据源。

**失败语义**：provider 内部任何异常都折成 `status:'none'` + `reason`（例如「采集库不存在」「cookie JSON 解析失败」），**不阻断执行**；真正的阻断点是 HTTP 401。

**错误码**

provider 不抛异常，因此没有对外错误码；内部失败一律折成 `application.status`：

| 情形 | status | 调用方处理 |
|---|---|---|
| 无凭证 / 库不可用 / 卡无来源 | `none` | 继续发请求；若 401，回执说「未注入可用凭证」 |
| 匹配到但全过期 | `expired` | 继续发请求；若 401，回执说「凭证可能过期」 |
| token 型凭证 | `unsupported` | 继续发请求；回执说「token 型一期未采集」 |
| JSON 坏行 | `none`（跳过坏行） | 同无凭证；不因单条坏数据炸整条链 |

**兼容性**

新增内部接口，无旧调用方。执行层只在 provider 存在时调用；provider 缺席时 R-3 行为一字不变。

#### IF-2 selectCookies

```
input:  entries: CredentialCookie[], url: string, now: number
output: {
  selected: CredentialCookie[],   // 匹配 + 未过期 + 去重 + 排序
  expired: CredentialCookie[],    // 匹配但过期（只用于计数与诊断）
  matched: CredentialCookie[]     // 匹配（含过期），用于判断 none/expired
}
```

**语义**

纯函数，不读盘、不联网、不看当前时间之外的状态。按浏览器 cookie 的最小语义做 domain/path/secure/expires 四道匹配，再按「name + path 去重、path 长优先」排序，产出可直接拼进 `Cookie` 头的集合。`matched` 用于区分「没匹配到」与「匹配到但全过期」——这两种情况对用户的下一步完全不同。

**错误码**

不抛异常，无错误码。非法 URL、空 host、坏条目一律跳过（返回空数组），由 provider 折成 `status:'none'`。

**兼容性**

新增纯函数，无旧调用方。匹配规则只做加法；若未来要支持 SameSite/Partitioned，走新增字段，不改现有四道匹配。

#### IF-3 mergeCredentialHeaders

```ts
mergeCredentialHeaders(
  existing: Record<string, string>,
  injected: Record<string, string>,
): Record<string, string>
```

- 头名大小写不敏感；
- `cookie`：已有则 `existing; injected`，没有则直接放；
- 其它：注入值覆盖同名已有值（凭证是权威）；
- 不改入参对象（纯函数）。

**语义**

把「卡自己声明的头」与「凭证解析出的头」合成一份可发给 `fetch` 的头。凭证是权威：除 `cookie` 需要与已有值拼接外，同名头一律以注入值为准。

**错误码**

不抛异常，无错误码。`undefined` 头按空对象处理。

**兼容性**

新增纯函数；只处理 `Record<string,string>`，不改变 R-3 已有 `buildRequest()` 的头部形状。

#### IF-4 createCaptureCredentialProvider

```ts
createCaptureCredentialProvider(options: {
  dbPath: string
  now?: () => number
}): CredentialProvider
```

**语义**：每次调用按需只读打开 SQLite、查该卡来源 captureId 的 cookie、关闭连接；不做缓存（M1 以正确性优先，节点量级几十到几百，打开开销可接受；M3 再评估缓存）。

**降级**：

| 情况 | application |
|---|---|
| `card.auth` 为 `none` | `status:'none'`，`reason:'该卡无鉴权'` |
| `card.auth` 为 `unknown` | `status:'none'`，`reason:'鉴权标志未判定，不注入'` |
| `card.auth` 为 `token-header/token-param` | `status:'unsupported'`，`reason:'token 型凭证一期未采集'`（M1） |
| 无 `sources[].captureId` | `status:'none'`，`reason:'卡没有采集来源'` |
| 采集库不存在/打不开 | `status:'none'`，`reason:'采集库不可用：<中文原因>'` |
| 有匹配但全过期 | `status:'expired'`，`expired: n` |
| 有匹配且未过期 | `status:'applied'`，`headers.cookie` 有值 |

**错误码**

工厂本身不抛异常，也没有对外错误码。所有降级都通过上表的 `application.status` 表达；真正阻断请求的是 HTTP 401，不是凭证解析失败。

**兼容性**

新增工厂，无旧调用方。`dbPath` 指向一期既有采集库；只读打开、不建表、不迁移。采集库格式一变（例如新增 `kind`），M1 的 `kind='cookie'` 过滤仍然成立；未知 `kind` 被忽略，不会误注入。

#### IF-5 runChain 注入点

**语义**

在 R-3 的「构造请求 → 发请求」之间插入唯一一次凭证解析，保证注入语义只有一处实现。注入只发生在真实执行路径；`dry-run` 不发请求、也不解析凭证（不读采集库，保持 plan 的纯函数边界）。

顺序固定（在 R-3 的顺序上只插一步）：

```text
buildRequest() → credentials()（可选）→ mergeCredentialHeaders() → requestDigest(redact) → step.start → httpRequest()
```

- provider 缺席 → 跳过，行为与 R-3 完全一致；
- provider 返回 `headers` 为空 → 不合并，仍写 `step.start.data.credentials`（`status:'none'|'expired'|'unsupported'`），让运行记录能回答「为什么没带」；
- 401/403 且 `card.auth !== 'none'`：
  - `status:'applied'` → `node-auth-required`，消息带「已注入 N 个 cookie 但仍 401（凭证可能过期）；自动换票属 R-4 M2」；
  - 其它 → `node-auth-required`，消息带「未注入可用凭证（reason）」；
- `result.credentials` 与 `step` 事件只放摘要，不放值。

**错误码**

M1 不新增错误码，沿用 `node-auth-required`；只在其文案里区分「未注入 / 注入了仍 401」。M2 新增 `relogin-failed` / `relogin-unavailable` / `relogin-cycle`，出现前先在本设计登记。`credential-unavailable` 这类「预检失败码」M1 **不引入**——没有凭证不等于链不可执行，401 才是事实。

**兼容性**

`RunChainInput.credentials` 是可选字段；不传时 `executeChainRun` 与 R-3 完全一致。`NodeResult.credentials` 与 `step.start.data.credentials` 都是只增字段，旧读取方忽略即可。工具面（`dataforge_chain_run`）M1 不加参数。

#### IF-6 dataforge_chain_run.relogin

**语义**

M2 的可选运行参数，形状 `{ site, flow, version?, inputs?, baseUrl? }`：

- 只在**主链节点收到 401** 时使用；不传时行为与 M1 完全一致；
- 登录链是普通 `interface-chain`，按 `site/flow/version` 从工作区加载，走同一套 `loadChain` / `buildPlan` / `executeChainRun`；
- 登录链以敏感模式执行：`run.json.params` 的值写 `***`、请求/响应正文摘要 `[已脱敏]`、`emitted`/绑定预览不落值；
- 登录链下发的 `set-cookie` 经 `onSetCookies` 回调进**本次运行的内存 jar**，按 cookie name 覆盖旧值；不写采集库、不写工作区；
- 同一运行只有一个 `reloginTask`（单飞）；并发节点同时 401 时只执行一次登录链；
- 换票成功后**只重放当前节点一次**；重放仍 401 → 中止，报「换票后仍 401」；
- 登录链不能是主链自身（同 site/flow）→ `relogin-cycle`，绝不递归；
- 登录链与主链必须**同源**（`origin` 相等）→ 否则 `relogin-unavailable`，拒绝把登录链的 cookie 带去另一个站点。

**错误码**

| 情形 | 错误码 | 调用方处理 |
|---|---|---|
| 登录链不存在/加载失败/入参不合法/baseUrl 不可解析 | `relogin-unavailable` | 修登录链或 `relogin` 参数后重跑；主链不回退到无凭证重试 |
| 登录链执行失败（HTTP 非 2xx、绑定失败、超时、取消） | `relogin-failed` | 中止主链；回执固定带「需人工重新登录并更新凭证」；可回看登录链 runId |
| 登录链成功但没有下发可用 `set-cookie` | `relogin-failed` | 同上；提示登录接口可能不是 cookie 型 |
| `relogin.site/flow` 与主链相同 | `relogin-cycle` | 改成真正的登录链；不执行任何请求 |

**兼容性**

新增可选参数；旧调用方不传即 M1 行为。`NodeResult.relogin` 与 `step` 事件里的 `relogin` 摘要都是只增字段，不含凭证值。登录链自己的运行记录沿用 `runs/`，但参数已脱敏，**不能**从运行记录回放账号密码。

## 备选方案  serves: 全文

| 方案 | 一句话说明 | 优点 | 代价 | 为什么未选 |
|---|---|---|---|---|
| A（选用） | provider 注入 + 只读采集库 + 执行层唯一注入点 | 凭证来源可替换；执行层不依赖 capture；单测容易；零迁移 | 每次节点打开一次 SQLite（M1 不缓存） | — |
| B | 把 cookie 直接写进卡的 `constants` 或链文件 | 不用改执行层 | 违反 R-1 红线（卡/链零凭证）；凭证进 git；无法过期 | 安全红线，直接排除 |
| C | 执行前开一次浏览器登录，导出 cookie 再跑 | 与采集期同一套登录能力；验证码可人工过 | 执行段重新引入浏览器，违背「执行段无浏览器」边界；慢且不可无人值守 | 边界冲突 |
| D | 先把一期补成完整凭证卡（token/localStorage/登录卡）再做执行注入 | 一步到位 | R-4 被无限期阻塞；执行层没有可验证的注入点 | 先做能做的，补课并行 |
| E | 401 时自动重放**采集期登录请求样本**（不声明登录链） | 看似「零配置」 | 没有登录卡标注，猜错会把业务请求当登录请求重放；请求体里的密码会进运行记录 | 不可接受的误重放与泄漏面 |
| F：什么都不做 | 维持 R-3 现状：只投影 `auth` 标志，401 让用户手工重登 | 零开发、零风险 | FR-4.1～4.6 全部不成立；R-5/R-6 无法验收；真实链首步就停 | 现在不能接受：执行面已经能跑，缺的就是登录态这一层 |

## 四风险与证据  serves: 全文

| 风险类型 | 判断问题 | 现有证据 | 结论 |
|---|---|---|---|
| 价值 | 用户真的需要吗 | R-4 需求由用户从执行引擎单列；R-5/R-6 依赖登录态；本机已有真实 cookie 采集数据 | 已验证 |
| 可用性 | agent 会用吗 | 工具面不需要新参数（M1）；回执只多一句 401 诊断；运行记录能回答「带没带凭证」 | 部分（真实登录站点样本不足） |
| 可行性 | 我们建得出来吗 | cookie 匹配是纯函数；`better-sqlite3` 已装；R-3 注入点已收口；本地可起带 cookie 校验的 HTTP 服务做 e2e | 已验证（M1） |
| 商业可行性 | 公司能接受吗 | 纯本地、零新依赖、零新表；凭证不出本机 | 已验证 |
| **安全** | 会不会把凭证写进日志/链/事件 | R-3 的 `redactHeaders` 已覆盖 cookie/authorization；M1 摘要不含值；单测做事件全文扫描 | 需持续守住（M3 扫描门） |

**未验证项的补课计划**：
- 真实登录态站点（`cookie-session` 卡）当前样本库为 0 → M1 用本地 HTTP 服务 + 合成卡验证；真实站点首跑归 R-5 的 agent 在环场景，yunpeng 在 M2 前给一条真实链；
- token 型凭证覆盖不足 → 需求 Q1 已决「限定 cookie 型验收」；token 补课放 M3，补课内容是采集期收割 `Authorization`/`localStorage` 并落 `credential_events`；
- 换票节流的并发语义 → M2 先用单飞（同运行只换一次），M3 再做跨运行/跨会话节流。

## 失败模式与回滚  serves: 全文

| 失败场景 | 触发条件 | 用户可见影响 | 检测手段 | 回滚动作 | 决策人 |
|---|---|---|---|---|---|
| 凭证注错站点 | 卡来源混了多个 captureId / cookie domain 过宽 | 把 A 站 cookie 发给 B 站 | provider 按 `sources[].captureId` + domain 双重限定；单测覆盖 `badexample.com` 不匹配 | 停用注入（provider 缺席即回 R-3 行为），修来源后重采集 | yunpeng |
| 凭证过期 | cookie `expires` 已过 | 请求 401，回执说「已注入但仍 401」 | `application.expired > 0` / `status:'expired'` | M1：重新采集；M2：换票 | 用户 |
| 注入值进日志 | 新代码把 `headers` 直接序列化进事件 | 凭证泄漏到 `run.json`/`events.ndjson` | `redactHeaders` + 事件全文扫描单测 | 删除泄漏 run 目录；撤回事件格式；M3 加 CI 门 | yunpeng |
| 采集库坏/缺 | 数据根迁移、文件被删 | 所有 `cookie-session` 卡都不带凭证 | `application.status='none'` + reason | 重建 `dataRoot` 或重新采集；不阻断无鉴权链 | 用户 |
| 401 被误判为凭证问题 | 卡 `auth` 标错（实际公开接口） | 回执建议重登，实际是业务 401 | 运行记录同时有 `credentials.status` 与响应摘要 | 重新采集刷新 `auth` 标志；必要时把卡改 `none` | agent/用户 |
| 自动换票无限循环（M2） | 登录链本身 401、或换票后仍 401 | 请求风暴/账号锁定风险 | 单飞 + 每运行一次 + 重放一次硬上限 | 关执行开关 `chainRunEnabled=false`；手工登录后重跑 | yunpeng |

- **开关**：M1 不加新开关。回滚路径 = 不装配 provider（`index.ts` 删一行），行为立即回到 R-3；已有运行记录不回填、不迁移。
- **回滚演练**：M1 合并前做一次「provider 缺席 → 无鉴权链照常、auth 卡回执退回 R-3 文案」的对照测试。
- **不可逆动作**：注入本身不产生写入；真正的写风险仍由 R-3 的 `confirm` 闸与写类节点清单承担。

## 跨关注点  serves: 全文

| 关注点 | 结论 | 依据与措施 |
|---|---|---|
| 安全 | 凭证只在本机、只在进程内 | 采集库只读；`credentials:'omit'`；注入头进摘要前打码；摘要只留名字；不把 cookie 写进链/卡/工作区 |
| 隐私与合规 | 采集库本身含凭证原文 | 沿用一期红线：不做上传、不出路由；M1 不新增任何导出面；运行记录不含值 |
| 成本 | 可忽略 | 每节点一次只读 SQLite 查询（毫秒级）；无新依赖、无新表、无后台服务 |
| 可观测性 | 注入是否发生可审计 | `step.start.data.credentials` 与 `NodeResult.credentials`；401 文案区分「未注入 / 注入了仍 401」 |
| 性能与容量 | 网络延迟主导 | 凭证查询是主键/索引级；cookie 数量通常 < 100；M3 若成瓶颈再加运行级缓存 |
| 文档与支持 | 需要新增凭证章节 | M1 更新 README「凭证注入」节：cookie 型可用、token 型未支持、401 怎么读；工具描述补一句 |

## 交付拆分与里程碑  serves: 全文

| 里程碑 | 内容 | 出口判据 | 负责人 | 目标日期 |
|---|---|---|---|---|
| M1 | `execute/credentials.ts` 纯函数 + `capture/credentials.ts` provider + `run.ts` 注入点 + 401 诊断 + 单测/e2e | 本地 HTTP 服务收到注入 cookie；事件全文无凭证原文；provider 缺席行为与 R-3 一致；typecheck/test/build 全绿 | yunpeng | 2026-10-18 |
| M2 | `relogin` 运行参数 + Set-Cookie 收割 + 内存 jar + 单飞 + 重放一次 + 敏感模式 + 同源/自环保护 + `relogin-*` 错误码 | 401 → 换票 → 重放成功；换票失败中止且文案含「需人工重新登录」；并发 401 只换一次；登录链参数/正文/token 不进留痕 | yunpeng | 已完成（2026-10-17） |
| M3 | 换票节流/过期刷新 + token 型补课（或明确降级）+ 零泄漏扫描门 + 运行级缓存 | token 卡可注入或回执给出补课路径；扫描门进 `pnpm test`；M2 的并发压测通过 | yunpeng | 2026-10-25 |

## 需求追溯  serves: 全文

| 需求编号 | 设计节 | 测试用例 | 指标 | 里程碑 |
|---|---|---|---|---|
| FR-4.1 | §方案总览 / IF-1～IF-5 / §数据模型 | `test/execute/credentials.test.ts`（匹配/合并）、`test/capture/credentials.test.ts`（provider）、`test/execute/run.test.ts`（注入到真实请求） | 注入成功率（本地服务断言 cookie 头命中 = 1） | M1 |
| FR-4.2 | §方案总览 M2 / IF-6 | `test/orchestration/relogin.test.ts`：主链 401 → 登录链 → set-cookie → 重放 | 单次运行换票成功数 ≤ 1 | M2 |
| FR-4.3 | §方案总览 M2 / IF-6 | `test/execute/run.test.ts`：换票成功重放 / 重放仍 401 中止 | 重放次数硬上限 = 1 | M2 |
| FR-4.4 | §数据模型·注入摘要 / §跨关注点 | 事件全文扫描 `SECRET` 零命中；登录链 params/正文/token 扫描零命中；`redactHeaders` 单测 | 泄漏命中数 = 0 | M1/M2 |
| FR-4.5 | §失败模式与回滚 / IF-6 | `test/execute/run.test.ts`：登录链失败 → `relogin-failed` + 「需人工重新登录」 | 换票失败诊断完整率 = 100% | M2 |
| FR-4.6 | §方案总览 M2 / M3 | `test/execute/run.test.ts` 单飞用例；M3 跨运行并发压测 | 并发 401 触发的登录请求数 = 1 | M2/M3 |

## 常见问题  serves: 全文

| 问题 | 回答 |
|---|---|
| 为什么不在 `buildPlan()` 里判凭证？ | 计划是纯函数、dry-run 与真跑共用，不能读盘。凭证是运行期事实（会过期、会换票），只能在节点发出前解析。计划卡因此不承诺「一定带得上凭证」，只承诺「不会发空值」。 |
| 为什么 provider 缺席不是错误？ | R-3 的既有调用方（单测、无采集环境的部署）不该因为 R-4 加一层就全挂。provider 是注入式增强，缺席 = 回到无凭证执行；401 仍然诚实。 |
| 为什么 token 型直接拒绝，不做「猜一个 Authorization」？ | token 的 scheme（Bearer/Basic/自定义）、位置（header/query/body）、刷新方式都因站点而异。一期没采到 token 值，猜一个只会制造「看起来带了凭证」的假象。回执明确说「未采集」比伪造更安全。 |
| 为什么采集库里的 cookie 是明文，M1 不加密？ | 一期红线是「只存本地、不出壳」，不是「加密存储」；加密需要密钥管理决策（系统钥匙串/环境变量），属于独立安全需求。M1 不改变存储形态，避免把「怎么加密」混进「怎么注入」。 |
| 最可能被投诉什么？ | 「为什么我的链还是 401」——因为一期只采到 cookie、没采到 token/登录卡，M1 只解决 cookie 型；回执必须把「没带」与「带了仍 401」说清楚，不能让用户以为注入没生效。 |
| 6 个月后会成为什么负担？ | 凭证解析散落成第二个「采集库读取面」：M1 只读 `credential_events`，若 M3 加持久化/缓存，必须继续收在 `capture/credentials.ts`，不许在执行层直接开 SQLite。 |
| 流量涨 10 倍先坏在哪里？ | 每节点一次 SQLite 打开/查询，节点数上千时先坏在文件句柄与查询开销；M3 用运行级缓存兜底，不改接口。 |
| 谁半夜被叫起来、手上有什么？ | 本地工具没有值班面；最坏是用户发现 401。手上证据：`step.start.data.credentials`（带没带、哪些名字）+ 响应摘要（状态码/错误体），足以判断是凭证问题还是业务问题。 |
| 数据错了怎么修、修得回来吗？ | 凭证不落运行记录，修数 = 重新采集/重新登录后重跑；已发出的写请求按 R-3 的不可逆纪律人工核对，不做自动补偿。 |
| 这个决定错了多久能发现？ | cookie-only 的范围错误会在第一条 token 型真实链首跑时暴露（M2 前）；如果一直没暴露，说明目标站点都是 cookie 型，范围决策可接受。 |

## 开放问题  serves: 全文

| 问题 | 选项 | 负责人 | 截止 |
|---|---|---|---|
| Q1（需求原问题）token 型覆盖不足：本期补采集还是限定 cookie 型 | **已决：限定 cookie 型（M1/M2），token 补课归 M3** | yunpeng | 已决：2026-10-17 |
| Q2 登录链怎么声明 | **已决（M2）：先用运行参数 `relogin: { site, flow, version?, inputs?, baseUrl? }`**——不改 R-1 schema、不动画布保存路径；链级 `auth.login` 留到画布能编辑登录链时再评估 | yunpeng | 已决：2026-10-17 |
| Q3 换票后的新 cookie 是否持久化 | **已决（M2）：只活一次运行（内存 jar）**；跨运行持久化（`dataRoot/credentials/`，0600）归 M3 | yunpeng | 已决：2026-10-17 |
| Q4 登录链的账号/密码从哪来 | **已决（M2）：运行期 `relogin.inputs`**，敏感模式脱敏后不落盘；环境变量引用归 M3（无人值守复跑） | yunpeng | 已决：2026-10-17 |
| Q5 同一站点多个 captureId 的 cookie 冲突怎么选 | 更近的 `obtainedAt` / 更具体的 domain（当前实现）；是否需要人工选择 | yunpeng | M3 |

## 验收证据  serves: 全文

> 本节在里程碑完成时逐条补证据；M1 已完成（2026-10-17）。

- M1：
  - [x] `pnpm typecheck` 0（三份 tsconfig 全过）；
  - [x] `pnpm test` 全绿：412 passed / 3 skipped（e2e 环境门控）；新增 `test/execute/credentials.test.ts` 10 例、`test/capture/credentials.test.ts` 9 例（含采集库→provider→真实请求的端到端）、`test/execute/run.test.ts` 注入 4 例；
  - [x] 本地服务端断言收到 `cookie` 头（`/api/cookie` 回显 + `seen[].headers.cookie`；provider e2e 断言 `sid=SECRET-E2E`）；
  - [x] `events.ndjson` 全文扫描不到 `SECRET-123`；请求摘要 `cookie: ***`；摘要只留 `names/domains/captureIds`；
  - [x] provider 缺席时 R-3 既有 401 用例不变（`test/execute/failure.test.ts` 全绿）。

- M2（2026-10-17）：
  - [x] 全量 `pnpm test`：426 passed / 3 skipped（环境门控 e2e）；`pnpm typecheck` 0；`pnpm build` 通过；
  - [x] 主链 401 → 登录链 → `set-cookie` → 重放成功（`test/orchestration/relogin.test.ts`）；
  - [x] 单飞：并发两个节点同时 401，登录链只执行一次（`test/execute/run.test.ts`）；
  - [x] 换票失败 → `relogin-failed`，文案含「需人工重新登录并更新凭证」；
  - [x] 换票成功但重放仍 401 → `node-auth-required`，文案含「已自动换票…重放」；
  - [x] 敏感模式：登录链 `run.json.params` 值写成 `***`，请求/响应正文 `[已脱敏]`，事件全文无密码/token；
  - [x] 同源 + 自环保护：跨源 `relogin-unavailable`、自环 `relogin-cycle`，均不发登录请求。

## 附录  serves: 全文

### 与 R-3 的边界

R-3 设计明确「不做凭证注入 / 401 换票（R-4）」，执行段只投影 `card.auth` 标志。本设计不修改 R-3 的任何错误码语义，只在其 401 分支上增加「带没带凭证」的上下文；`httpRequest()` 的 `credentials:'omit'` 保持不变——凭证由我们显式构造 `cookie` 头，不依赖 fetch 的 cookie jar。

### 与 R-6 的边界

R-6 结晶只处理「常量 / 用户入参 / 链生成值」三分类，**凭证永远不是常量**。M1/M2 的凭证不进入链文件，因此 R-6 的 `scanCredentialConstants` 不需要新增规则；M2 的登录输入也不写入链，避免被结晶误冻。
