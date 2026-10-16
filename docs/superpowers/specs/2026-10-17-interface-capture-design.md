# 接口采集功能 · 设计文档（MVP-1）

- 日期：2026-10-17
- 状态：待用户批准
- 范围：链工坊（接口测试流水线）的第一期——只做**接口采集**功能
- 形态：**DSH 插件**，存储用 **SQLite**

---

## 1. 意图与动机

最终产品是一条流水线：**采集 →（编排 DAG）→（探索执行）→（结晶）→（复跑）**，目标是"自动测试一个网站的一连串接口，最终完成业务流程任务"。本期只交付流水线的第一段——**接口采集**：用户给出网站页面/入口 URL，agent 开浏览器模拟 UI 操作，把网站触发的接口连同出入参、凭证（登录态：cookie/token/localStorage）全部抓下来，归一化成**接口卡片**存入 SQLite 接口库。

为什么第一刀只做采集：
- 后续编排/执行/复跑的一切原料都来自接口库，采集是唯一从零到一的部件；
- 采集本身可以独立验收（给定网站 → 产出接口卡片库），不依赖后续阶段；
- 其余三段（编排 DAG、探索执行、结晶复跑）已有雏形设计，随本期文档一并封存为下期范围。

## 2. 全貌与本期边界

产品最终形态（已与用户对齐的路线，仅记录，不在本期实现）：

| 阶段 | 归属 | 状态 |
|---|---|---|
| ① 接口采集（本设计） | 全局独立域，不属于任何项目 | **本期实现** |
| 采集包 → 项目接口库「导入」 | 项目域 | 后期（接口库在项目里） |
| ② 编排（DAG：绑定即依赖，引擎拓扑调度） | 项目内 | 后期 |
| ③⑤ 探索执行 / 复跑（快链优先、半自我修复） | 挂在链下（链详情·运行 tab） | 后期 |
| ④ 结晶（常量/入参/链生成值三分类沉淀链文件） | 链生命周期 | 后期 |

### 已拍板、必须遵守的结构决定

- 采集是**全局独立**功能：不绑定项目；产出「采集包」。
- 每次采集运行的产物持久化为：接口卡片（含出入参模板）+ 原始请求样本 + 凭证事件。
- 出入参**两层留档**：原始厚数据全量保真（每次请求一条样本）+ 卡片上沉淀参数模板（字段名/类型/变量角色标注）。
- 变量标注三来源：多次采样自动 diff（值变=变量，不变=常量）、agent 语义标注、卡片详情人工点改。
- 执行永远属于编排（未来执行挂在链下），采集不关心执行。
- 采集的驱动方式：**agent 驱动无头浏览器**（B 方案），凭证由采集过程自己记录（模拟一次 UI 操作），不走人工录 cookie。
- 站点级采集分两层，本期实现第一层+任务制动作采集：页面逐页爬行（全自动）；交互探测（点按钮触发深层接口）**不在本期**；"创建/审批"类写操作接口靠**任务制动作采集**（不做探测式乱点，避免脏数据）。

## 3. 目标 / 非目标 / 反目标

### 目标（MVP-1 完成的定义）

1. 在 DSH 会话中对 agent 发起采集：三种任务型可用
   - `single_page`：给定一个 URL，打开并捕获该页触发的接口
   - `site_crawl`：给定入口 URL，登录后递归发现站内页面（导航/路由/翻页），逐页捕获，全站去重归并
   - `action`：给定 URL + 任务描述（如"创建一笔 PR"），agent 模拟一段 UI 操作，捕获过程中触发的接口（含写操作）与凭证下发
2. 采集过程全程可观测：实时状态（当前页/已访问页数/捕获请求数/已结卡数），产物按采集包归档
3. 出入参按第 2 节的两层留档；同一接口跨页面触发自动归并为一张卡（卡上记录出现在哪些页面）
4. 凭证捕获：登录接口的请求/响应、cookie/localStorage/token 的下发与存放位置记录成「凭证卡」，供后续阶段复跑时自动重登换票
5. 数据落 SQLite，单文件即可迁移；采集包结构自描述
6. 通过 DSH 插件工具面交付（对话驱动），无自研前端页面（页面在后期阶段）

### 非目标（本期明确不做）

- 交互式探测（在页面上自动寻找并点击按钮去触发深层接口）
- 编排 / DAG / 引擎拓扑调度 / 探索执行 / 结晶 / 复跑——全部下期
- 项目维度（项目的接口库导入机制）——下期，但数据模型不与其冲突（见 §6 采集包与卡片的可归属性）
- 自研 Web 界面（所有交互走 DSH 对话 + 工具返回）
- 全站规模优化（万级页面爬行队列调度；本期以中小站点为度，超过按诚实提示截断）

### 反目标（防止跑偏）

- **不做探测式写操作**：永远不会为了"采接口"去自动点提交/删除/审批类按钮；写操作只经由 `action` 任务制显式发生
- **不做凭证外传**：cookie/token 值只存本地 SQLite，不写日志、不做任何上传
- **不静默截断**：爬行策略遇到超多页面/超慢站点时如实回报边界，不悄悄少采假装成功

## 4. 约束

- **形态约束**：以 DSH 插件交付，延续 dsh-dataforge 现有插件骨架（`defineTool` 工具面 + Schemastery 配置 + 后台 job 三道闸的纪律）。工具命名沿用 `dataforge_*` 前缀。
- **存储约束**：SQLite 单文件（配置项指定路径，默认 `<plugin-data>/capture.sqlite`）；不引入数据库服务。
- **环境约束**：目标网站默认按生产环境对待——默认安全档位"从严"。若用户声明测试环境可放宽（配置项），但写操作永远任务制。
- **登录态约束**：`site_crawl` 与 `action` 需要登录。本期凭据输入方式：用户在对账会话中提供（账号密码走任务参数/配置），不在本期做 SSO/验证码攻坚；遇验证码如实失败回报。
- **技术约束**：浏览器用 Playwright 无头 Chromium（含 `--disable-blink-features=AutomationControlled` 级基础隐匿）；CDP 侧重网络监听（请求/响应/头/体），不依赖页面注入脚本获取网络数据。包管理 pnpm、构建 tsdown、测试 vitest，与现有插件一致。
- **运行时约束**：采集是长任务 → 走后台 job（参照现有 `context.jobs` 后台路径纪律），前台降级仅在用户显式要求同步等待时使用；状态查询幂等可轮询。

## 5. 功能规格

### 5.1 采集任务（三种任务型）

统一走一个工具入口，任务型支配行为差异：

| 任务型 | 输入 | 行为 | 特有产物 |
|---|---|---|---|
| `single_page` | `entryUrl`（+可选凭据） | 打开页面，等待网络静默，捕获全部 XHR/fetch | 该页接口卡 |
| `site_crawl` | `entryUrl` + 凭据 | 登录 →（可选）页面每页触发接口 — 递归发现同域链接 BFS 爬行 → 逐页捕获 → 结卡时跨页去重归并 | 全站卡库 + 爬行轨迹（页数、深度、跳过原因） |
| `action` | `entryUrl` + `taskDescription` + 凭据 | 登录 → 按任务描述模拟一段 UI 操作（点击/填表/提交）→ 全程捕获 | 操作型接口卡（含真实写操作）+ 凭证卡 |

- **页面发现**：同域 BFS，探测深度与页数上限可配置（默认深度 3、页数 50）；外域跳过并记录。
- **网络捕获**：CDP 事件全量旁路；只收 XHR/fetch 资源型请求（静态资源 js/css/img/woff 走黑名单过滤），响应体 size 超限（默认 256KB)只存摘要+标记截断。
- **动作简驱（MVP 取小合规）**：`action` 不做自由 agent 探索，按任务描述做"单段线性操作脚本"（登录→导航→操作→提交）；执行元素定位失败时明确失败回报，不乱点兜底。自由探索属后期代理能力。
- **采集器节奏**：每页等待网络 idle + 可配稳定窗口，避免漏收懒加载接口；页面超时/崩溃如实记为失败样本。

### 5.2 归一化：接口卡片

一次采集运行产出 `capture_runs` + 相关实体，结构如下（SQLite DDL 草案，具体迁移工具选型留给 builder）：

```sql
-- 采集运行（=采集包）
CREATE TABLE capture_runs (
  id TEXT PRIMARY KEY,          -- 'cap_xxx'
  task_type TEXT NOT NULL,      -- single_page | site_crawl | action
  entry_url TEXT NOT NULL,
  status TEXT NOT NULL,         -- running | done | failed | cancelled
  started_at TEXT NOT NULL,
  ended_at TEXT,
  stats_json TEXT,              -- {pagesVisited, requests, cards, credentialEvents,...}
  error TEXT
);

-- 页面轨迹
CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES capture_runs(id),
  url TEXT NOT NULL, depth INTEGER, status TEXT, visited_at TEXT
);

-- 原始请求样本（出入参原始厚数据）
CREATE TABLE request_samples (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES capture_runs(id),
  page_id TEXT REFERENCES pages(id),
  ts TEXT NOT NULL, seq INTEGER NOT NULL,
  url TEXT NOT NULL, method TEXT NOT NULL,
  status INTEGER, request_headers_json TEXT, request_body_bin BLOB,
  response_headers_json TEXT, response_body_bin BLOB,
  truncated INTEGER DEFAULT 0
);

-- 接口卡片（归一化模板；跨页归并）
CREATE TABLE interface_cards (
  id TEXT PRIMARY KEY,          -- 'card_xxx'
  capture_id TEXT NOT NULL REFERENCES capture_runs(id),
  name TEXT,                    -- 可由 agent 依 URL 语义生成
  url_template TEXT NOT NULL, method TEXT NOT NULL,
  request_template_json TEXT,   -- [ {field,type,sample,role: const|input|chain|credential},... ]
  response_template_json TEXT,  -- 同上（含业务 code 项）
  auth_binding_json TEXT,       -- 依赖哪些凭证注入（指向 credential_events）
  related_page_ids_json TEXT,   -- 出现它的页面
  sample_count INTEGER,
  created_at TEXT NOT NULL
);

-- 凭证事件（凭证卡）
CREATE TABLE credential_events (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES capture_runs(id),
  kind TEXT NOT NULL,           -- cookie | token | localStorage
  interface_ref TEXT,           -- 由哪个接口下发（如登录接口）
  url_set_at TEXT,              -- 在哪里写入
  name TEXT NOT NULL,
  value_bin BLOB,               -- 本地保存，不上传不进日志
  obtained_at TEXT NOT NULL
);

-- 登录状态（站点间限定域内复用；cookie jar 按 origin 存）
CREATE TABLE login_sessions (
  id TEXT PRIMARY KEY,
  capture_id TEXT REFERENCES capture_runs(id),
  origin TEXT NOT NULL, stored_context_bin BLOB, stored_at TEXT
);
```

- **归并规则：去重集合 = 过滤静态后对 `method + url_template`（去 query/order 无关排序后）+ 归一化处理后的路径参数` 取交集；同一规则跨页触发 → 合卡并追加 `related_page_ids` 与样本计数；`request/response` 模板在多次样本下做字段合并与角色标注（变量 vs 常量 diff，见 5.3)。
- **模板生成**：镜像字段展开（JSON 递归）得到字段模板，`role` 初值由自动 diff 常量/变量、再经 agent 语义标注一次（异步可增），人工校正入口在卡片详情（后期页面）。
- **参数化 URL**：路径中的纯数字/长随机串段以 `{param_N}` 抽出模板，同卡保留样本原值。

### 5.3 出入参

- **原始样本层**：每次请求一条 `request_samples` 记录（含完整出/入参），detail 查询可分页取回。响应体大小限额外的标 `truncated` 与摘要哈希。
- **模板层（卡片）**：字段列表（含类型 + 首样本值 + role）+ 业务 code 抽取（响应体 `.code / .msg / .data` 常见按探测得出，失败则不强行归一化）。
- **变量标注**：观测到同一接口多进同参间 diff（≥2 样本）才标 `variable`；单样本只有 `const(暂定)` → 保留「未验证」旗标，后续采集补证。

### 5.4 凭证捕获

- 捕获过程中插件全程监听三处：`Set-Cookie` 事件、`document.cookie` 写点（通知型）、postMessage/localStorage 变更。初始化为 `credential_events`。
- 登录链路卡的判定：请求成功后引发全站 401→200 转变且 `Set-Cookie/Authorization` 存在的接口记为 `登录卡`（其注入回流待后续编排期实现；本期只记录与标注，供后续使用）。
- **诚实边界**：风控、验证码、双因素登录站点本期不支持，失败如实回报原因。

### 5.5 会话原语：UI 操作的驱动方式（重要）

采集 worker **内置 LLM**、也不做自由 agent 探索（对应 5.1 的说明）。页面操作的智能来自 **DSH 对话 agent** 本身——这要求工具面不是只有四个粗粒度命令，而是"自治爬行"与"agent 驱动原语"两条腿并存：

1. **`site_crawl`：自治模式**。发起后 worker 全自动跑（凭会话 cookie：见下），agent 只发起+收果。
2. **登录与 `single_page`/`action`：agent 驱动模式**。agent 通过原语工具逐步驾驶浏览器，worker 全程旁路记录（网络/动作/凭证），每个原语调用本身也是一次可观测事件：

| 原语工具（ Workers 同族 `dataforge_browser_*`） | 职责 |
|---|---|
| `dataforge_browser_open` | 开会话（单页/新任务上下文），返回 snapshot 摘要+ session id |
| `dataforge_browser_act` | 单步动作（click/fill/submit/scroll/wait），参数由 agent 给出，生成后（含真实写操作）仍是 tool 层确认纪律 |
| `dataforge_browser_snapshot` | 可交互元素/表单结构快照（辅助 agent 决步） |
| `dataforge_browser_close` | 会话结束并结卡（返回本次了一批卡片） |

3. **凭证传递**：登录所需的账号密码由用户在会话中提供（或配置/环境中引用），agent 用 `browser_act` 填入登录表单——`Set-Cookie` 随即被捕、会话也随之可自治。

这样采到的动作轨迹（何时点了什么、哪个 URL 响应）天然都是样本；`browser_act` 的参数怎么给出的智能在 agent，不在 worker。

### 5.6 工具面（DSH 插件）汇总

| 工具 | 职责 | 参数 |
|---|---|---|
| `dataforge_capture` | 发起采集（后台 job；site_crawl 自治任务） | taskType/entryUrl/taskDescription/credentialsFrom/maxDepth/maxPages/stabilityWindowMs… |
| `dataforge_capture_status` | 幂等查询进度 | captureId |
| `dataforge_capture_result` | 产物查询 | captureId；scope: cards|samples|credentials|pages（分页+过滤） |
| `dataforge_capture_cancel` | 终止运行 | captureId |
| `dataforge_browser_open/act/snapshot/close` | 会话原语（agent 驾驶，worker 旁落记录） | 见 5.5表 |

- 后台执行纪律同现有插件：`capture` 返回 captureId → `status` 轮询；目录式产物留痕。
- 生产运行限制：`action` 本质执行真实写操作，工具层要求用户免误用：agent 收尾三道闸里"risk/site/token 门"对应策略段明文（生产档位下写操作必须用户显式确认）。

### 5.7 配置（Schemastery，沿用现有插件配置骨架）

| 键 | 默认 | 说明 |
|---|---|---|
| `capture.dataRoot` | `<plugin-data>/capture` | SQLite 与样本二进制根目录 |
| `capture.browser.bin` | 自动 | Playwright Chromium 路径（默认自其包） |
| `capture.crawl.maxDepth` | 3 | BFS 站点深度上限 |
| `capture.crawl.maxPages` | 50 | 单次全站爬行页数上限 |
| `capture.stabilityWindowMs` | 1500 | 网络 idle 后再等窗口 |
| `capture.envTier` | `production` | production(从严) / test(可放宽交互探测——本期无实际作用占位) |

## 6. 架构（插件内组件）

```
DSH 插件壳（现有骨架）
 └─ application 层（开始/状态/结果/取消；后台 job 行规）
     └─ CaptureWorker（TS，新部件）
         ├─ BrowserSession（Playwright CDP 旁路：网络+存储+页面事件）
         ├─ Crawler（single_page 直开；site_crawl 同域 BFS；action 线性操作脚本）
         ├─ Normalizer（样本→卡片：URL/身体归一化+模板 diff+agent标注）
         ├─ CaptureStore（SQLite，better-sqlite3 同步写，绝无后台写竞争）
         └─ ProgressEvents（NDJSON 落盘 + 状态聚合，仿 runs 纪律）
```

- **采集归档目录**：`<dataRoot>/captures/<captureId>/events.ndjson` 逐事件 append（`page`/`request`/`card`/`credential`/`stats`/`terminal`），尾态写 `summary.json`，仿引擎 NDJSON 纪律。
- **SQLite 与二进制**：大响应体落 `samples/` 文件、PUT 记录相对路径（DB 只存指针），防库膨胀。
- **进程模型**：采集 worker 起独立子进程（node），插件壳通过 job 发令、事件轮询收果（不透传 Playwright 对象跨进程）。

## 7. 已做主的安全决策（带默认的可调项）

| 决策 | 默认 | 理由 |
|---|---|---|
| 生产环境档位 | `production`（仅只读交互） | 用户未声明测试环境（早期讨论中回过"生产从严"） |
| 写操作仅经 `action` 任务制 | 默认开 | 避免"顺手"脏数据 |
| 单次采集样本上限/页 | 1000 条 | 防喷射式脚本刷库（虚高质量样例） |
| 大响应截断 | 256KB | 防单个样本库膨胀 |
| 爬行规模上限 | 深度3/50页 | 行为可控、时间经济；超限时诚实回报 |

## 8. 留给 builder 的决策

1. **URL 归一化规则的细节阈值**（路径段抽参阈值、query 排除集）——影响归并精度，builder 可先下水较保守初版，标注 TODO 待比前。
2. **agent 语义标注的实现载体**（点评式 vs 用项目的 ai 工具调用）：只要按 §5.2 的三来源纪律执行。
3. **DDL 与迁移工具**（better-sqlite3 同步 + 手写 migration vs ORM），只要 SQLite 约束不破。
4. **事件 NDJSON 的字段字典**（沿用引擎现有 terminal/step 词汇做增量）。
5. **BFS 去重位与登录后的导航可达性策略**（如侧栏/工具栏遍历式）。

## 9. 验收标准（MVP-1 完成的证据）

验收冒烟站点由用户定为 **baidu.com**（公网可达、无需登录口令交互）：

1. `pnpm typecheck` / build / vitest 通过，包含采集器的单元级测试（归一化、归并、模板 diff）与 store 测试。
2. 集成冒烟（真实站点，用户已定目标）：
   - `single_page` 对 `https://www.baidu.com`：捕获首页触发的 XHR/fetch（搜索联想 sugrec、统计埋点等）并出卡；
   - `site_crawl` 以百度为入口、在 maxPages 配额内爬行（预期遇到大量外链被记录跳过——这本身就是诚实边界的展示）；
   - `action` 走**只读动作**（输入搜索词→提交→打开结果页），捕获结果页/联想接口；**登录流程不做**（百度登录风控/验证码属本期声明的诚实边界之一，如实失败即可，不作为阻断验收项）。

## 10. 下期展望（不实现，登记于此）

- 采集包 → 项目接口库导入（含卡片来源溯源）
- 编排 DAG 画布 + 绑定即依赖的引擎拓扑调度升级
- 探索执行 + 结晶复跑（快链优先、半自我修复）
- 条件边（审批分支）与自由 agent UI 探索动作
