# 采集页与页面-接口关系模型 · 实现计划

- 项目：PRJ-0001 · 里程碑：M1（契约冻结）→ M2（链路贯通）→ M3（采集页 + 验收）
- 设计基线：[../design/capture-page-and-relations.md](../design/capture-page-and-relations.md)（approved，v1.2）
- 需求：[../requirement/interface-capture.md](../requirement/interface-capture.md)（v1.3）
- 日期：2026-10-17

## 约定（贯穿全计划的硬规则）

- 工具/路由边界上的值类型一律 **type 别名**（interface 缺隐式索引签名会被 schema 推断拒绝）。
- 无 `as any` / `@ts-ignore`；store 写路径全同步（better-sqlite3）。
- 凭证红线：凭证类头/参数只记名称与角色，值不进模板、不出路由。
- TDD：先写失败测试 → 实现 → 通过 → 提交；每任务一提交，message 用 `feat(capture): ...` / `test(capture): ...`。
- 每任务收尾跑 `pnpm typecheck && pnpm test`，全绿才提交。
- 除 e2e 外零真浏览器（adapter/fake 注入）。

---

## M1 契约冻结

### Task 1: 类型扩展（`src/shared/capture-types.ts`）

**Files:** 改 `src/shared/capture-types.ts`

- [ ] `FieldLocation = 'path' | 'query' | 'header' | 'body'`；`TemplateField` 加 `location: FieldLocation`
- [ ] 新增 `AuthType = 'none' | 'token-header' | 'token-param' | 'cookie-session' | 'unknown'`
- [ ] 新增 `AuthFlag = { authType: AuthType; evidence: string[]; credentialRefs: string[] }`；`CardRow.authBinding` 扩展为 `{ cookies: number; storageKeys: number; auth?: AuthFlag }`（旧库无 auth 字段，读取兼容）
- [ ] 新增 `RelationRow`（id/captureId/pageId?/pageUrl/cardId/paramsFingerprint/sampleCount/firstSeenAt/lastSeenAt）
- [ ] `Template` 加可选 `contentType?: string`（出参模板元信息）
- [ ] 验证 `pnpm typecheck` → 提交 `feat(capture): 采集域类型扩展（location/AuthFlag/RelationRow）`

### Task 2: normalizer 纯函数（`src/capture/normalizer.ts`）

**Files:** 改 `src/capture/normalizer.ts`、Test `test/capture/normalizer.test.ts`

先写失败测试：

- [ ] `paramsFingerprintOf(url, contentType?, requestBody?)`：
  - query 键序无关 → 同指纹；VOLATILE 键（sid/ts/token…）剔除 → 同指纹
  - body JSON 键序无关（递归排序、数组保序）→ 同指纹；值变 → 异指纹
  - content-type 不同（json vs form）→ 异指纹
  - 非 JSON body 原样参与；非法 URL 不抛（原样参与哈希）
- [ ] `headerFieldsOf(headers)`：content-type/accept/x-* → 字段（`field: 'header.<小写名>'`, location='header'）；凭证头（cookie/authorization/proxy-authorization/set-cookie）`sample='<credential>'`、`role='credential'`，值不出现
- [ ] `queryFieldsOf(urlTemplate)` / `pathFieldsOf(urlTemplate)`：query 逐键、`{p}` 逐段，location 正确
- [ ] `detectAuthType(sample: { headers, url, body? }, hasCredentials)`：
  - authorization 头 → token-header；query `?token=` 或 body 含 access_token → token-param
  - **query token 被 VOLATILE 滤掉后仍标 token-param**（回归门：探测读原始样本）
  - 只有 cookie + run 有凭证事件 → cookie-session；都无 → none；无样本 → unknown
  - evidence 只含名称（`header:authorization` / `query:token`），credentialRefs 传入什么存什么

实现要点：sha256 用 `node:crypto`；指纹 = `sha256(JSON.stringify([contentType, queryPairs, normalizedBody])).slice(0,16)`。

- [ ] `pnpm vitest run test/capture/normalizer.test.ts` 全绿 → 提交 `feat(capture): 指纹/location/鉴权探测纯函数`

### Task 3: store 关系表与迁移（`src/capture/store.ts`）

**Files:** 改 `src/capture/store.ts`、Test `test/capture/store.test.ts`

先写失败测试：

- [ ] 建库即有 `page_card_relations` 表；`upsertRelation` 同四元组幂等（sample_count+1、last_seen_at 刷新）、异指纹新行
- [ ] `attachSampleRelation` 回填样本 `relation_id`；`listRelations(captureId)` / `listRelationsByCard(cardId)` 读出
- [ ] 迁移幂等：老库（无 relation_id 列、卡有 related_pages_json）→ 启动后列存在、老卡有 `legacy` 关系行；二次启动无副作用
- [ ] upsertCard 后 `related_pages_json` 仍正确刷新（冗余缓存不变量）

实现要点：

- DDL 追加 `page_card_relations` + 唯一索引 `(capture_id,page_url,card_id,params_fingerprint)`
- 迁移仿 `migrateLegacyCardScope`：`PRAGMA table_info(request_samples)` 判列 → `ALTER TABLE ADD COLUMN relation_id TEXT`；老卡逐 URL 回填 legacy 关系行（page_id 查不到留 NULL）
- `upsertRelation` 返回 relationId；appendEvent 增 `kind:'relation'`

- [ ] `pnpm vitest run test/capture/store.test.ts` 全绿 → 提交 `feat(capture): page_card_relations 关系表与幂等迁移`

**M1 出口判据**：纯函数与 store 单测全绿；指纹算法、DDL、路由契约冻结，M2/M3 不改。

---

## M2 链路贯通

### Task 4: application 桥三写（`src/capture/application.ts`）

**Files:** 改 `src/capture/application.ts`、Test `test/capture/application.test.ts`

先写失败测试（fake 适配器，沿用现有 fixture）：

- [ ] 同接口两形态（`/api/list` type=1 / type=2 两个 wire 样本）→ **一张卡 + 两条关系行**；卡入参模板为并集，差异字段 `role='input'`、`unverified=false`
- [ ] 样本 `relation_id` 已回指；卡 `authBinding.auth` 有 authType 与 evidence
- [ ] 凭证头值不出现在卡模板 JSON 里（序列化后全文检索断言）

实现要点（wireToStore 重写）：

- 内存样本袋 `Map<mergeKey, {requests: RawJson[]; responses: RawJson[]; headers: Record<string,string>[]}>`，每 mergeKey 上限 20 条（超出丢最旧）
- 每样本：upsertSample → fingerprint → assignRoles 重算 request/response 模板 → 合成 path/query/header/body 字段 → detectAuthType → upsertCard → upsertRelation → attachSampleRelation
- action 会话与自治 job 共用此桥（现状已是，保持）

- [ ] `pnpm vitest run test/capture/application.test.ts` 全绿 → 提交 `feat(capture): 桥三写（样本袋并集 diff + 关系落库 + 鉴权标志）`

### Task 5: panel-routes 扩展（`src/capture/panel-routes.ts`）

**Files:** 改 `src/capture/panel-routes.ts`、Test `test/panel-routes.test.ts`

先写失败测试（内存 store + fake deps，fake `startCapture` 注入）：

- [ ] `POST /captures`：bad-json → 400；bad-url → 400；同 host running → 409 `host-busy`；成功 → 200 `{captureId}` 且 fake startCapture 收到 `{taskType:'single_page', entryUrl}`
- [ ] `GET /runs/:id/cards`：存在 → `{cards, relations}`；不存在 → 404
- [ ] 方法白名单：GET/POST 放行，PUT/DELETE → 405；POST body >8KB → 413
- [ ] 新路由响应无 credential 原文（序列化全文检索）

实现要点：

- 路由依赖扩展：`CapturePanelDeps` 加 `startCapture` 与 `store`（同 host 判定：`listRuns` 找 running 且 entryUrl host 相同）
- 采集页结果端点 IF-2 响应 = `listCards(id)` + `listRelations(id)`

- [ ] `pnpm vitest run test/panel-routes.test.ts` 全绿 → 提交 `feat(capture): 面板写路由 POST /captures 与 run 卡片端点`

**M2 出口判据**：编排单测证明两形态一卡两关系行；路由 400/409/200/404/405/413 用例齐。

---

## M3 采集页 + 验收

### Task 6: client api 与常量（`src/client/api.ts`、`dom.ts`、`types.ts`）

- [ ] `types.ts`：`RelationRow`、`TemplateField.location`、auth 字段（客户端自含类型纪律：不 import 服务端）
- [ ] `api.ts`：`fetchPanelData` 抽 method/body 参数；`postCapture(entryUrl)`、`fetchRunCards(runId)`
- [ ] `dom.ts`：`COLLECT_TAB_ID='dataforge-collect'`、`COLLECT_TAB_LABEL='采集'`、`COLLECT_POLL_MS=2_000`
- [ ] 提交 `feat(capture): client api 与采集页常量`

### Task 7: 采集页视图（`src/client/board-collect.ts`、`index.ts`、`styles.ts`）

**Files:** 新 `src/client/board-collect.ts`；改 `src/client/index.ts`（tabs 前插采集页）、`src/client/styles.ts`

- [ ] 输入区：URL 输入框 + 「采集」按钮（非法 URL 禁用 + 提示）；进行中按钮禁用
- [ ] 状态条：轮询 `fetchRunDetail`（进行中 2s，收口后停）；running/done/failed/cancelled + host-busy/失败原文如实展示
- [ ] 结果区：`fetchRunCards` 按「页面 → 接口 → 形态」分组渲染；卡片展开出入参文档（field/type/sample/role/location）与鉴权标志；复用 board-cards 渲染件
- [ ] 纪律：三态诚实、信封 error 直透、全 textContent 零 innerHTML
- [ ] 提交 `feat(capture): 采集页（URL 输入 + 采集按钮 + 实时进度 + 接口文档结果）`

### Task 8: e2e 门与收口

**Files:** 改 `test/capture/e2e-capture.test.ts`（或新增 e2e-collect）、`README.md`

- [ ] e2e（`CAPTURE_E2E=1`）：经 POST /captures 等价路径发起真实单页采集 → 轮询至 done → `/runs/:id/cards` 有卡、关系行存在、卡模板含 location 与 authType
- [ ] README 形态速览补采集页一句
- [ ] 全量：`pnpm typecheck && pnpm test && pnpm build` → 提交 `feat(capture): 采集页与关系模型收口（含 e2e 门）`

**M3 出口判据**：e2e 真实站点 POST 发起 → 采集页看到接口文档；typecheck/build/test 全绿。
