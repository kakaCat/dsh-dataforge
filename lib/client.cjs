Object.defineProperty(exports,Symbol.toStringTag,{value:`Module`});let e=require("react"),t=require("react/jsx-runtime");const n=`dataforge`,r=`dataforge-capture`,i=`dataforge-new-capture`,a=`dataforge-interfaces`,o=15e3,s={running:`进行中`,done:`完成`,failed:`失败`,cancelled:`已取消`,ok:`ok`,error:`error`,"skipped-external":`外部跳过`},c={"token-header":`Token 请求头`,"token-param":`Token 入参`,"cookie-session":`Cookie 会话`,none:`无鉴权`,unknown:`未识别`},l={path:`路径`,query:`查询串`,header:`请求头`,body:`请求体`};function u(e){return e===`GET`||e===`POST`?e:`dsh-df-method-other`}function d(e){return e.length<=300?e:`${e.slice(0,300)}…`}const f=`（未识别站点）`;function p(e,t){let n=new Map(e.map(e=>[e.id,e])),r=[],i=/* @__PURE__ */ new Map,a=(e,t,n)=>{let a=i.get(e);a===void 0&&(a=/* @__PURE__ */ new Map,i.set(e,a),r.push(e));let o=a.get(t)??[];n!==void 0&&o.push(n),a.has(t)||a.set(t,o)};for(let e of t)n.has(e.cardId)&&a(e.pageUrl,e.cardId,e);let o=/* @__PURE__ */ new Set;for(let e of i.values())for(let t of e.keys())o.add(t);for(let t of e)o.has(t.id)||a(`（未记录页面）`,t.id,void 0);return r.map(e=>({pageUrl:e,cards:[...(i.get(e)??/* @__PURE__ */ new Map).entries()].flatMap(([e,t])=>{let r=n.get(e);return r===void 0?[]:[{card:r,relations:t}]})}))}function m(e,t){if(t.length===0)return{shapes:1,samples:e.sampleCount};let n=new Set(t.map(e=>e.paramsFingerprint)),r=t.reduce((e,t)=>e+t.sampleCount,0);return{shapes:n.size,samples:r}}function h(e){let t=[],n=/* @__PURE__ */ new Map;for(let r of e){let e=r.paramsFingerprint;n.has(e)||(n.set(e,0),t.push(e)),n.set(e,(n.get(e)??0)+r.sampleCount)}return t.map(e=>({fp:e,samples:n.get(e)??0}))}function g(e){let t=/* @__PURE__ */ new Map;for(let n of e)for(let e of n.relatedPageUrls){let r=t.get(e)??[];r.push(n),t.set(e,r)}return t}function _(e){let t;try{t=new URL(e)}catch{return}if(t.protocol===`http:`||t.protocol===`https:`)return t.host===``?void 0:t.host}function v(e,t){let n=new Map(t.map(e=>[e.id,_(e.entryUrl)??`（未识别站点）`])),r=/* @__PURE__ */ new Map,i=e=>{let t=r.get(e);return t===void 0&&(t={stats:{pages:0,cards:0,samples:0,runs:0},pages:/* @__PURE__ */ new Set,seenCards:/* @__PURE__ */ new Set},r.set(e,t)),t};for(let e of t){let t=i(n.get(e.id)??`（未识别站点）`);t.pages.add(e.entryUrl),t.stats.runs+=1,t.stats.firstAt=t.stats.firstAt===void 0?e.startedAt:Math.min(t.stats.firstAt,e.startedAt),t.stats.lastAt=t.stats.lastAt===void 0?e.startedAt:Math.max(t.stats.lastAt,e.startedAt)}for(let t of e){let e=t.relatedPageUrls.map(_).find(e=>e!==void 0)??n.get(t.captureId)??`（未识别站点）`,r=i(e);if(!r.seenCards.has(t.id)){r.seenCards.add(t.id),r.stats.cards+=1,r.stats.samples+=t.sampleCount;for(let n of t.relatedPageUrls)_(n)===e&&r.pages.add(n)}}for(let e of r.values())e.stats.pages=e.pages.size;let a=r.get(f),o=[...r.entries()].filter(([e])=>e!==f).map(([e,t])=>({host:e,stats:t.stats,pageUrls:[...t.pages]})).sort((e,t)=>(t.stats.lastAt??NaN)-(e.stats.lastAt??NaN));return a!==void 0&&o.push({host:f,stats:a.stats,pageUrls:[...a.pages]}),o}function y({method:e}){return/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-method ${u(e)}`,children:e})}function b({title:e,template:n}){let r=n!==void 0&&n.fields.length>0;return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-sec`,children:[/* @__PURE__ */ (0,t.jsxs)(`h3`,{children:[e,n?.codePath!==void 0&&/* @__PURE__ */ (0,t.jsx)(`small`,{children:n.codePath})]}),!r&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-kv`,children:`暂无`}),r&&/* @__PURE__ */ (0,t.jsxs)(t.Fragment,{children:[n?.pathParams!==void 0&&n.pathParams.length>0&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-kv`,children:[`路径参数：`,n.pathParams.map(e=>/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-fp`,children:`{${e}}`},e))]}),/* @__PURE__ */ (0,t.jsxs)(`table`,{className:`dsh-df-fields`,children:[/* @__PURE__ */ (0,t.jsx)(`thead`,{children:/* @__PURE__ */ (0,t.jsxs)(`tr`,{children:[/* @__PURE__ */ (0,t.jsx)(`th`,{children:`字段`}),/* @__PURE__ */ (0,t.jsx)(`th`,{children:`位置`}),/* @__PURE__ */ (0,t.jsx)(`th`,{children:`类型`}),/* @__PURE__ */ (0,t.jsx)(`th`,{children:`示例`}),/* @__PURE__ */ (0,t.jsx)(`th`,{children:`备注`})]})}),/* @__PURE__ */ (0,t.jsx)(`tbody`,{children:n?.fields.map(e=>/* @__PURE__ */ (0,t.jsxs)(`tr`,{children:[/* @__PURE__ */ (0,t.jsx)(`td`,{className:`dsh-df-mono`,children:e.field}),/* @__PURE__ */ (0,t.jsx)(`td`,{children:e.location===void 0?`—`:l[e.location]??e.location}),/* @__PURE__ */ (0,t.jsx)(`td`,{children:e.type}),/* @__PURE__ */ (0,t.jsx)(`td`,{className:`dsh-df-mono`,children:d(e.sample)}),/* @__PURE__ */ (0,t.jsxs)(`td`,{children:[e.role,e.unverified&&/* @__PURE__ */ (0,t.jsx)(`sup`,{className:`dsh-df-tag-unverified`,children:`样本未验证`})]})]},`${e.field}-${e.location??`legacy`}`))})]})]})]})}function x({card:e}){return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-sec`,children:[/* @__PURE__ */ (0,t.jsx)(`h3`,{children:`鉴权`}),e.authType===void 0?/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-kv`,children:`未探测到鉴权特征`}):/* @__PURE__ */ (0,t.jsxs)(t.Fragment,{children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-kv`,children:[`类型 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:c[e.authType]??e.authType})]}),e.authEvidence!==void 0&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-kv`,children:[`证据 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:e.authEvidence})]}),e.authBinding!==void 0&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-kv`,children:[`会话 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:`cookies ${e.authBinding.cookies} · storageKeys ${e.authBinding.storageKeys}`})]})]})]})}function S({card:e}){let n=e.relatedPageUrls;return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-sec`,children:[/* @__PURE__ */ (0,t.jsxs)(`h3`,{children:[`关联页面 `,/* @__PURE__ */ (0,t.jsx)(`small`,{children:n.length})]}),n.length===0?/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-kv`,children:`无`}):/* @__PURE__ */ (0,t.jsxs)(t.Fragment,{children:[/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-list`,children:n.slice(0,10).map(e=>/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-mono`,children:e},e))}),n.length>10&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-kv`,children:`…共 ${n.length} 条，仅展示前 10 条`})]})]})}function C({relations:e}){return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-sec`,children:[/* @__PURE__ */ (0,t.jsxs)(`h3`,{children:[`形态 `,/* @__PURE__ */ (0,t.jsx)(`small`,{children:e.length===0?`无关系行`:h(e).length})]}),e.length===0?/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-kv`,children:`本运行没有入参关系行（历史数据）；不同指纹即不同形态（比如物料单不同）。`}):/* @__PURE__ */ (0,t.jsx)(`ul`,{className:`dsh-df-shape-list`,children:h(e).map(e=>/* @__PURE__ */ (0,t.jsxs)(`li`,{className:`dsh-df-shape`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-fp`,children:e.fp}),/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-kv`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:e.samples}),` 样本`]})]},e.fp))})]})}function w({entries:e}){return/* @__PURE__ */ (0,t.jsx)(`aside`,{className:`dsh-df-legend`,children:e.map(e=>/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-kv`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-lv dsh-df-lv${e.level}`,children:e.level}),e.label]},e.label))})}function T(e,t={},...n){let r=document.createElement(e);for(let[e,n]of Object.entries(t))n!==!1&&n!=null&&r.setAttribute(e,n===!0?``:String(n));for(let e of n)e!=null&&r.append(e instanceof Node?e:document.createTextNode(e));return r}function E(e){for(;e.firstChild!==null;)e.removeChild(e.firstChild)}function D(e){return new Date(e).toLocaleString()}function O(e){let t=e=>String(e).padStart(2,`0`),n=new Date(e);return`${t(n.getMonth()+1)}-${t(n.getDate())} ${t(n.getHours())}:${t(n.getMinutes())}`}const k=`/dashboard/api/dataforge`;var A=class extends Error{status;constructor(e,t){super(e),this.status=t}};async function j(e){let t=`${k}${e}`,n;try{n=await fetch(t,{headers:{accept:`application/json`}})}catch(e){throw new A(`面板数据服务不可达（${String(e?.message??e)}）`,0)}if(!n.ok)throw new A(`面板数据服务 HTTP ${n.status}（${t}）`,n.status);let r;try{r=await n.json()}catch{throw new A(`面板响应不是 JSON（HTTP ${n.status}）：${t}`,n.status)}if(r.success!==!0||r.data===void 0)throw new A(r.error??`面板信封异常：${t}`,n.status);return r.data}async function M(e=30){return j(`/runs?limit=${e}`)}async function N(e){return j(`/runs/${encodeURIComponent(e)}`)}async function ee(e=200,t=0){return j(`/cards?limit=${e}&offset=${t}`)}async function P(e,t){let n=`${k}${e}`,r;try{r=await fetch(n,{method:`POST`,headers:{"content-type":`application/json`,accept:`application/json`},body:JSON.stringify(t??{})})}catch(e){throw new A(`面板数据服务不可达（${String(e?.message??e)}）`,0)}let i;try{i=await r.json()}catch{throw new A(`面板响应不是 JSON（HTTP ${r.status}）：${n}`,r.status)}if(i.success!==!0||i.data===void 0)throw new A(i.error??`面板信封异常：${n}`,r.status);return i.data}function F(e,t){return P(`/captures`,{taskType:e,entryUrl:t})}function I(e){return e?.message??String(e)}function L(t){let[n,r]=(0,e.useState)(),[i,a]=(0,e.useState)(),[s,c]=(0,e.useState)(``),[l,u]=(0,e.useState)(0),d=(0,e.useMemo)(()=>({current:t}),[]);d.current=t;let f=(0,e.useRef)(void 0);return f.current=async()=>{try{let e=[],t=0;do{let n=await ee(500,e.length);t=n.total,e=e.concat(n.cards)}while(e.length<t&&e.length<5e3);let{runs:n}=await M(500);r({cards:e,runs:n,sites:v(e,n),truncated:t>e.length}),a(void 0),c(`刷新于 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`)}catch(e){r(void 0),a(I(e))}},(0,e.useEffect)(()=>{t&&f.current?.()},[t,l]),(0,e.useEffect)(()=>{let e=setInterval(()=>{d.current&&f.current?.()},o);return()=>{clearInterval(e)}},[d]),{aggregate:n,cardsByPage:(0,e.useMemo)(()=>n===void 0?/* @__PURE__ */ new Map:g(n.cards),[n]),error:i,lastSync:s,reload:()=>{u(e=>e+1)}}}function te({visible:n,openSite:r,openNonce:i}){let{aggregate:a,cardsByPage:o,error:s,lastSync:c,reload:l}=L(n),[u,d]=(0,e.useState)(),[f,p]=(0,e.useState)(0),[m,h]=(0,e.useState)(0);(0,e.useEffect)(()=>{r!==void 0&&(d(r),h(0))},[r,i]);let g=a?.sites??[],_=Math.max(1,Math.ceil(g.length/9)),v=Math.min(f,_-1),y=g.slice(v*9,(v+1)*9),b=g.find(e=>e.host===u),x=b?.pageUrls??[],S=Math.max(1,Math.ceil(x.length/5)),C=Math.min(m,S-1);return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-page`,children:[b===void 0?/* @__PURE__ */ (0,t.jsx)(re,{loading:s===void 0&&a===void 0,error:s,lastSync:c,sites:y,totalSites:g.length,totalCards:a?.cards.length??0,page:v,totalPages:_,onEnter:e=>{d(e),h(0)},onGoto:e=>{p(e)},onReload:l}):/* @__PURE__ */ (0,t.jsx)(ie,{site:b,clockPages:x,byPage:o,lastSync:c,page:C,totalPages:S,onBack:()=>{d(void 0),p(0)},onGoto:e=>{h(e)},onReload:l}),/* @__PURE__ */ (0,t.jsx)(w,{entries:[{level:1,label:`网站`},{level:2,label:`页面`},{level:3,label:`接口`}]})]})}function ne({site:e,huge:n}){let r=e.stats;return/* @__PURE__ */ (0,t.jsxs)(t.Fragment,{children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-lv dsh-df-lv1`,children:`网站`}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:n?`dsh-df-site-name`:`dsh-df-site-card-title`,style:n?void 0:{flex:`1`,minWidth:0},children:/* @__PURE__ */ (0,t.jsx)(`span`,{style:{flex:`1`,minWidth:0},children:e.host})}),/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-stats`,children:[/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`页面 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:r.pages})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`接口 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:r.cards})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`样本 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:r.samples})]}),n!==!0&&/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`采集 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:r.runs}),` 次`]})]})]})}function re({loading:e,error:n,lastSync:r,sites:i,totalSites:a,totalCards:o,page:s,totalPages:c,onEnter:l,onGoto:u,onReload:d}){return/* @__PURE__ */ (0,t.jsxs)(t.Fragment,{children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-head`,children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{children:[/* @__PURE__ */ (0,t.jsx)(`h2`,{children:`接口库`}),/* @__PURE__ */ (0,t.jsx)(`p`,{className:`dsh-df-sub`,children:`接口按网站分类归档；点站点卡进入它的页面与接口`})]}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-sync`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-last`,children:r}),/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-btn-ghost`,type:`button`,onClick:d,children:`刷新`})]})]}),n!==void 0&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-empty`,children:`取数失败：${n} —— 点「刷新」重试。`}),n===void 0&&e&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-state`,children:`加载中…`}),n===void 0&&!e&&i.length===0&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-empty`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:`接口库还是空的`}),`——采集运行沉淀的接口卡会按网站出现在这里。`]}),n===void 0&&!e&&i.length>0&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-site-grid`,children:i.map(e=>/* @__PURE__ */ (0,t.jsxs)(`button`,{className:`dsh-df-site-card`,type:`button`,onClick:()=>{l(e.host)},children:[/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-site-card-title`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-lv dsh-df-lv1`,children:`网站`}),/* @__PURE__ */ (0,t.jsx)(`span`,{style:{flex:`1`,minWidth:0,overflowWrap:`anywhere`},children:e.host})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-site-card-stats`,children:[/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`页面 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:e.stats.pages})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`接口 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:e.stats.cards})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`样本 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:e.stats.samples})]})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-site-card-foot`,children:[e.stats.lastAt===void 0?`没有采集记录`:`最近 ${O(e.stats.lastAt)}`,/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-site-card-enter`,children:`进入 →`})]})]},e.host))}),n===void 0&&!e&&a>0&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-pagerbar`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{children:`共 ${a} 站点 · ${o} 接口卡`}),c>1&&/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-pages`,children:Array.from({length:c},(e,n)=>/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-pg`,type:`button`,"aria-current":n===s,onClick:()=>{u(n)},children:n+1},n))})]})]})}function ie({site:e,clockPages:n,byPage:r,lastSync:i,page:a,totalPages:o,onBack:s,onGoto:c,onReload:l}){let u=n.slice(a*5,(a+1)*5);return/* @__PURE__ */ (0,t.jsxs)(t.Fragment,{children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-crumb`,children:[/* @__PURE__ */ (0,t.jsx)(`button`,{type:`button`,onClick:s,children:`接口库`}),/* @__PURE__ */ (0,t.jsx)(`span`,{children:`/`}),/* @__PURE__ */ (0,t.jsx)(`b`,{style:{color:`var(--dsh-df-ink)`},children:e.host})]}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-card dsh-df-site-banner`,children:[/* @__PURE__ */ (0,t.jsx)(ne,{site:e,huge:!0}),/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-sync`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-last`,children:i}),/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-btn-ghost`,type:`button`,onClick:l,children:`刷新`})]})]}),u.map(e=>/* @__PURE__ */ (0,t.jsx)(ae,{pageUrl:e,cards:r.get(e)??[]},e)),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-pagerbar`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{children:`共 ${n.length} 页面`}),o>1&&/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-pages`,children:Array.from({length:o},(e,n)=>/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-pg`,type:`button`,"aria-current":n===a,onClick:()=>{c(n)},children:n+1},n))})]})]})}function ae({pageUrl:n,cards:r}){let[i,a]=(0,e.useState)(!0),o=r.length,s=r.reduce((e,t)=>e+t.sampleCount,0);return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-page-node${i?``:` dsh-df-collapsed`}`,children:[/* @__PURE__ */ (0,t.jsxs)(`button`,{className:`dsh-df-pn-head`,type:`button`,onClick:()=>{a(e=>!e)},children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-lv dsh-df-lv2`,children:`页面`}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-pn-name dsh-df-mono`,children:n}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-pn-meta`,children:`${o} 接口 · ${s} 样本`}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-caret`,children:`▾`})]}),i&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-pn-body`,children:r.length===0?/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-cap`,children:`这页没有挂接口卡`}):r.map(e=>/* @__PURE__ */ (0,t.jsx)(oe,{card:e},e.id))})]})}function oe({card:n}){let[r,i]=(0,e.useState)(!1);return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-iface-card${r?` dsh-df-open`:``}`,children:[/* @__PURE__ */ (0,t.jsxs)(`button`,{className:`dsh-df-iface-head`,type:`button`,onClick:()=>{i(e=>!e)},children:[/* @__PURE__ */ (0,t.jsx)(y,{method:n.method}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-grow`,children:n.name??`未命名接口`}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-caret`,children:`▾`})]}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-iface-url`,children:n.urlTemplate}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-iface-chips`,children:[/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:n.sampleCount}),` 样本`]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`页面 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:n.relatedPageUrls.length})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`鉴权 `,n.authType===void 0?`未探测`:c[n.authType]??n.authType]}),n.createdAt>0&&/* @__PURE__ */ (0,t.jsx)(`span`,{children:`沉淀 ${O(n.createdAt)}`})]}),r&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-iface-detail`,onClick:e=>{e.stopPropagation()},children:[/* @__PURE__ */ (0,t.jsx)(b,{title:`请求模板`,template:n.requestTemplate}),/* @__PURE__ */ (0,t.jsx)(b,{title:`响应模板`,template:n.responseTemplate}),/* @__PURE__ */ (0,t.jsx)(x,{card:n}),/* @__PURE__ */ (0,t.jsx)(S,{card:n})]})]})}function R(e){if(e.length===0)throw Error(`[tabs] 至少需要一个 BlockTabSpec`);let t=T(`div`,{class:`dsh-df-tabs dsh-df-subtabs`,role:`tablist`}),n=[],r=[];function i(e){for(let[t,i]of n.entries())i.setAttribute(`aria-selected`,t===e?`true`:`false`),r[t].hidden=t!==e}e.forEach((e,a)=>{let o=T(`button`,{class:`dsh-df-tab`,type:`button`,role:`tab`,"aria-selected":a===0,"data-dsh-df-subtab":e.id},e.label);o.addEventListener(`click`,()=>{r[a].hidden&&i(a)}),t.append(o),n.push(o),r.push(T(`div`,{class:`dsh-df-tabpane`,role:`tabpanel`,"data-dsh-df-subtabpane":e.id},e.build()))});let a=T(`div`,{class:`dsh-df-blocktabs`});return a.append(t,...r),i(0),a}function z(e,t){let n=!1,r=0,i;e.replaceChildren();let a=T(`div`,{class:`dsh-df-runs`}),c=T(`span`,{class:`dsh-df-last`}),l=T(`button`,{class:`dsh-df-btn`,type:`button`},`刷新`);l.addEventListener(`click`,()=>{f()}),e.append(T(`div`,{class:`dsh-df-head`},T(`div`,{},T(`h2`,{},`采集运行`),T(`p`,{class:`dsh-df-sub`},`dataforge_capture / site_crawl / action 的留痕；15 秒自动刷新`)),T(`div`,{class:`dsh-df-sync`},c,l)),a);let u=setInterval(d,o);return f(),()=>{n=!0,r+=1,clearInterval(u)};function d(){t.isActive()&&f()}async function f(){let e=r;try{let{runs:t}=await M();if(n||e!==r)return;if(c.textContent=`刷新于 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`,E(a),t.length===0){a.append(G(`暂无采集运行 —— 先用 dataforge_capture 起一次采集，或用 agent 触发后回来查看。`,!1));return}for(let e of t)a.append(p(e))}catch(t){if(n||e!==r)return;E(a),a.append(G(`取数失败：${K(t)}\n点「刷新」重试。`,!0))}}function p(e){let t=T(`div`,{class:`dsh-df-item`});t.append(T(`div`,{class:`dsh-df-row`},T(`span`,{class:`dsh-df-badge ${e.status}`},s[e.status]??e.status),T(`span`,{class:`dsh-df-mono dsh-df-grow`},e.entryUrl),T(`span`,{class:`dsh-df-cap`},e.taskType)),T(`div`,{class:`dsh-df-row`,style:`margin-top:4px`},T(`span`,{class:`dsh-df-chips`},`${e.stats.pages} 页 · ${e.stats.requests} 样本 · ${e.stats.cards} 卡 · ${e.stats.credentials} 凭证`,D(e.startedAt),e.endedAt===void 0?`仍在进行`:`结束于 ${D(e.endedAt)}`))),e.error!==void 0&&e.error.length>0&&t.append(T(`div`,{class:`dsh-df-errline`},e.error)),e.notice!==void 0&&e.notice.length>0&&t.append(T(`div`,{class:`dsh-df-noticeline`},e.notice));let n=T(`div`,{class:`dsh-df-detail`});return n.addEventListener(`click`,e=>{e.stopPropagation()}),e.id===i&&(t.classList.add(`open`),n.append(T(`div`,{class:`dsh-df-cap`},`详情加载中…`)),m(n,e.id)),t.append(n),t.addEventListener(`click`,()=>{i=i===e.id?void 0:e.id,f()}),t}async function m(e,t){let i=r;try{let a=await N(t);if(n||i!==r)return;e.replaceChildren(B(a))}catch(t){if(n||i!==r)return;e.replaceChildren(T(`div`,{class:`dsh-df-errline`},`详情取数失败：${K(t)}`))}}}function B(e){return R([{id:`pages`,label:`页面 ${e.pages.length}`,build:()=>V(e)},{id:`credentials`,label:`凭据 ${e.credentials.length}`,build:()=>H(e)},{id:`samples`,label:`样本 ${e.samples.length}`,build:()=>U(e)}])}function V(e){let t=T(`div`,{class:`dsh-df-block`}),n=T(`div`,{class:`dsh-df-list`});return e.pages.length===0&&n.append(T(`div`,{class:`dsh-df-cap`},`本运行没有页面记录`)),e.pages.slice(0,50).forEach(e=>{n.append(T(`div`,{class:`dsh-df-line`},T(`span`,{class:`dsh-df-badge `+e.status},s[e.status]??e.status),T(`span`,{class:`dsh-df-mono dsh-df-grow`},e.url),T(`span`,{class:`dsh-df-cap`},`depth ${e.depth}`)))}),e.pages.length>50&&n.append(T(`div`,{class:`dsh-df-cap`},`…共 ${e.pages.length} 条，仅展示前 50 条`)),t.append(n),t}function H(e){let t=T(`div`,{class:`dsh-df-block`});t.append(T(`div`,{class:`dsh-df-cap`},`仅名字与种类；原文不出服务端`));let n=T(`div`,{class:`dsh-df-list`});e.credentials.length===0&&n.append(T(`div`,{class:`dsh-df-cap`},`本运行未入库凭据`));for(let t of e.credentials)n.append(T(`div`,{class:`dsh-df-line`},T(`span`,{class:`dsh-df-badge cancelled`},t.kind),T(`span`,{class:`dsh-df-mono dsh-df-grow`},t.name),T(`span`,{class:`dsh-df-cap`},D(t.obtainedAt))));return t.append(n),t}function U(e){let t=T(`div`,{class:`dsh-df-block`});t.append(T(`div`,{class:`dsh-df-cap`},`点击行展开请求/响应预览`));let n=T(`div`,{class:`dsh-df-list`});return e.samples.length===0&&n.append(T(`div`,{class:`dsh-df-cap`},`本运行没有样本`)),e.samples.slice(0,50).forEach(e=>{let t=T(`div`,{class:`dsh-df-line dsh-df-sample`},T(`span`,{class:`dsh-df-method ${e.method===`GET`||e.method===`POST`?e.method:`dsh-df-method-other`}`},e.method),T(`span`,{class:`dsh-df-mono dsh-df-grow`},e.url),T(`span`,{class:`dsh-df-cap`},e.status===void 0?`—`:String(e.status))),r=T(`pre`,{class:`dsh-df-pre`,style:`display:none`},W(e));t.addEventListener(`click`,()=>{r.style.display=r.style.display===`none`?``:`none`}),n.append(t,r)}),e.samples.length>50&&n.append(T(`div`,{class:`dsh-df-cap`},`…共 ${e.samples.length} 条，仅展示前 50 条`)),t.append(n),t}function W(e){let t=[];return e.requestBodyPreview!==void 0&&t.push(`请求体：\n${e.requestBodyPreview}`),e.responsePreview!==void 0&&t.push(`响应体：\n${e.responsePreview}`),t.length===0?e.truncated?`正文超过留痕上限已落盘（服务端不给预览）`:`该样本没有正文`:t.join(`

`)}function G(e,t){return T(`div`,{class:t?`dsh-df-state err`:`dsh-df-state`},e)}function K(e){return e?.message??String(e)}function q(e){return e?.message??String(e)}function se(e){return e.length===0||e.startsWith(`http://`)||e.startsWith(`https://`)?e:`https://${e}`}function ce({visible:n,seed:r}){let[i,a]=(0,e.useState)(``),[o,c]=(0,e.useState)(!1),[l,u]=(0,e.useState)(),[d,f]=(0,e.useState)(),[p,m]=(0,e.useState)(),[h,g]=(0,e.useState)();(0,e.useEffect)(()=>{r!==void 0&&a(r.url)},[r]);let _=(0,e.useMemo)(()=>({current:n}),[]);_.current=n,(0,e.useEffect)(()=>{if(d===void 0)return;let e=!0,t,n=()=>{t!==void 0&&clearInterval(t),t=void 0};return r(),t=setInterval(()=>{r()},2e3),()=>{e=!1,n()};async function r(){let t=d;if(t===void 0||!_.current)return;let r;try{r=await N(t)}catch(t){if(!e)return;n(),g(`进度取数失败：${q(t)}`);return}e&&(m(r),g(void 0),r.run.status!==`running`&&n())}},[d,_]);async function v(e){e.preventDefault();let t=se(i.trim());if(t.length===0)u({ok:!1,text:`请先输入页面 URL`});else{u({ok:!0,text:`发起中…`}),c(!0),f(void 0),m(void 0),g(void 0);try{let e=await F(`single_page`,t);if(e.accepted&&e.captureId!==void 0){f(e.captureId),u({ok:!0,text:`已发起（captureId ${e.captureId}）——左侧实时更新进度，收口后出接口文档。`});return}u({ok:!1,text:e.accepted===!1?`未能发起：${e.gate}${e.card===void 0?``:`\n${e.card}`}`:`发起失败：面板信封异常`})}catch(e){u({ok:!1,text:`发起失败：${q(e)}`})}finally{c(!1)}}}let y=p?.run,b=y?.status===`running`,x=y===void 0?void 0:s[y.status]??y.status;return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-page-spl`,children:[/* @__PURE__ */ (0,t.jsxs)(`section`,{className:`dsh-df-card`,children:[/* @__PURE__ */ (0,t.jsx)(`h2`,{children:`发起采集`}),/* @__PURE__ */ (0,t.jsx)(`p`,{className:`dsh-df-sub`,children:`对单个页面发起，把它的 XHR / fetch 沉淀成接口卡。`}),/* @__PURE__ */ (0,t.jsxs)(`form`,{onSubmit:e=>{v(e)},children:[/* @__PURE__ */ (0,t.jsx)(`input`,{className:`dsh-df-url-input`,type:`url`,name:`entryUrl`,placeholder:`https://example.com/page（单页入口）`,autoComplete:`off`,spellCheck:!1,style:{marginTop:10,display:`block`},value:i,onChange:e=>{a(e.target.value)}}),/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-mode-tag`,children:`单页 · 只读 · 静止期监听`}),/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-btn-primary`,type:`submit`,disabled:o,children:`发起采集`})]}),l!==void 0&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:l.ok?`dsh-df-noticeline`:`dsh-df-errline`,style:{marginTop:8,whiteSpace:`pre-wrap`},children:l.text})]}),/* @__PURE__ */ (0,t.jsxs)(`section`,{className:`dsh-df-card`,children:[/* @__PURE__ */ (0,t.jsxs)(`h2`,{children:[`本次进度`,x!==void 0&&/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-badge ${y?.status??``}`,children:x})]}),p===void 0&&h===void 0&&/* @__PURE__ */ (0,t.jsx)(`p`,{className:`dsh-df-sub`,children:`还没发起。发起后这里出现实时进度与统计。`}),h!==void 0&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-errline`,children:h}),p!==void 0&&y!==void 0&&/* @__PURE__ */ (0,t.jsxs)(t.Fragment,{children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-stat-grid`,children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-stat`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:y.stats.pages}),/* @__PURE__ */ (0,t.jsx)(`span`,{children:`页面`})]}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-stat`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:y.stats.requests}),/* @__PURE__ */ (0,t.jsx)(`span`,{children:`样本`})]}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-stat`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:y.stats.cards}),/* @__PURE__ */ (0,t.jsx)(`span`,{children:`接口`})]}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-stat`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:y.stats.credentials}),/* @__PURE__ */ (0,t.jsx)(`span`,{children:`凭证`})]})]}),/* @__PURE__ */ (0,t.jsxs)(`ul`,{className:`dsh-df-steps`,children:[/* @__PURE__ */ (0,t.jsxs)(`li`,{className:`dsh-df-done`,children:[`发起采集`,/* @__PURE__ */ (0,t.jsx)(`small`,{children:`${O(y.startedAt)} · captureId ${y.id}`})]}),/* @__PURE__ */ (0,t.jsxs)(`li`,{className:b?`dsh-df-doing`:`dsh-df-done`,children:[`静止期监听 XHR / fetch`,/* @__PURE__ */ (0,t.jsx)(`small`,{children:b?`进行中 · 已捕获 ${y.stats.requests} 个请求样本`:`共捕获 ${y.stats.requests} 个请求样本`})]}),/* @__PURE__ */ (0,t.jsxs)(`li`,{className:b?void 0:`dsh-df-done`,children:[`归并收口出接口文档`,/* @__PURE__ */ (0,t.jsx)(`small`,{children:b?`等待页面静止，收口后出文档`:`${y.stats.cards} 个接口卡${y.endedAt===void 0?``:` · 收口于 ${O(y.endedAt)}`}`})]})]}),y.error!==void 0&&y.error.length>0&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-errline`,children:y.error}),y.notice!==void 0&&y.notice.length>0&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-noticeline`,children:y.notice}),b&&/* @__PURE__ */ (0,t.jsx)(`p`,{className:`dsh-df-sub`,children:`每 2 秒刷新，收口后自动停止。`})]})]}),/* @__PURE__ */ (0,t.jsxs)(`section`,{className:`dsh-df-card`,children:[/* @__PURE__ */ (0,t.jsx)(`h2`,{children:`边界说明`}),/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-kv`,children:`只走 HTTP 请求洞察：不点按钮、不填表单、不执行写操作。`}),/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-kv`,children:`静止期窗口：页面加载完成后继续监听一小段时间，收走 XHR / fetch。`}),/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-kv`,children:`要驱动真实交互（登录、翻页、提交）→ 用 agent 会话 dataforge_capture。`}),/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-kv`,children:`凭证只记标志与来源，原文不进卡、不出路由。`})]}),/* @__PURE__ */ (0,t.jsxs)(`main`,{children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-doc-head`,children:[/* @__PURE__ */ (0,t.jsx)(`h1`,{children:`采集结果`}),/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-summary`,children:p===void 0?`还没有进行中的采集`:b===!0?`采集中——收口后自动出文档`:`${p.cards?.length??0} 个接口卡`})]}),p===void 0&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-empty`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:`发起一次采集`}),`后，这里会出现按「页面 → 接口 → 形态」组装的接口文档。`]}),p!==void 0&&b===!0&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-empty`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:`采集进行中`}),`——收口后这里出现按「页面 → 接口 → 形态」组装的接口文档。`]}),p!==void 0&&b===!1&&/* @__PURE__ */ (0,t.jsx)(le,{detail:p}),/* @__PURE__ */ (0,t.jsx)(w,{entries:[{level:1,label:`页面`},{level:2,label:`接口`},{level:3,label:`形态`}]})]})]})}function le({detail:e}){let n=e.cards??[];if(n.length===0)return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-empty`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:`本页没有采到 XHR/fetch 接口`}),`——页面可能是纯静态，或接口在登录/交互之后才发。 可换页或用 agent 会话驱动交互再采。`]});let r=p(n,e.relations??[]),i=n.reduce((t,n)=>t+m(n,e.relations??[]).shapes,0);return/* @__PURE__ */ (0,t.jsxs)(t.Fragment,{children:[/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-summary`,style:{marginBottom:12},children:`${r.length} 个页面 · ${n.length} 个接口 · ${i} 个形态`}),r.map(e=>/* @__PURE__ */ (0,t.jsx)(ue,{group:e},e.pageUrl))]})}function ue({group:n}){let[r,i]=(0,e.useState)(!0),a=n.cards,o=a.reduce((e,t)=>e+m(t.card,t.relations).shapes,0);return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-page-node${r?``:` dsh-df-collapsed`}`,children:[/* @__PURE__ */ (0,t.jsxs)(`button`,{className:`dsh-df-pn-head`,type:`button`,onClick:()=>{i(e=>!e)},children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-lv dsh-df-lv1`,children:`页面`}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-pn-name dsh-df-mono`,children:n.pageUrl}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-pn-meta`,children:`${a.length} 接口 · ${o} 形态`}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-caret`,children:`▾`})]}),r&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-pn-body`,children:a.map(e=>/* @__PURE__ */ (0,t.jsx)(de,{card:e.card,relations:e.relations},e.card.id))})]})}function de({card:n,relations:r}){let[i,a]=(0,e.useState)(!1),o=m(n,r);return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-iface-card${i?` dsh-df-open`:``}`,children:[/* @__PURE__ */ (0,t.jsxs)(`button`,{className:`dsh-df-iface-head`,type:`button`,onClick:()=>{a(e=>!e)},children:[/* @__PURE__ */ (0,t.jsx)(y,{method:n.method}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-grow`,children:n.name??`未命名接口`}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-caret`,children:`▾`})]}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-iface-url`,children:n.urlTemplate}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-iface-chips`,children:[/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:o.shapes}),` 形态`]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:o.samples}),` 样本`]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`鉴权 `,n.authType===void 0?`未探测`:c[n.authType]??n.authType]})]}),i&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-iface-detail`,onClick:e=>{e.stopPropagation()},children:[/* @__PURE__ */ (0,t.jsx)(b,{title:`请求模板`,template:n.requestTemplate}),/* @__PURE__ */ (0,t.jsx)(b,{title:`响应模板`,template:n.responseTemplate}),/* @__PURE__ */ (0,t.jsx)(x,{card:n}),/* @__PURE__ */ (0,t.jsx)(C,{relations:r})]})]})}const J=`dsh-dataforge-panel-styles`;function Y(){if(document.getElementById(J)!==null)return;let e=document.createElement(`style`);e.id=J,e.textContent=`
.dsh-df-view {
  /* shadcn/ui 标准 token 名（前端统一约定）；值来自三张原型的色板 */
  --background: #f4f5f7; --card: #ffffff; --border: #e4e7ec;
  --foreground: #1d2129; --muted-foreground: #86909c; --secondary-foreground: #4e5969;
  --primary: #3b6ef0; --primary-foreground: #ffffff;
  --accent: #eaf0fe; --accent-foreground: #3b6ef0;
  --ring: #3b6ef0;
  --destructive: #dc2626; --destructive-foreground: #ffffff;
  --success: #16a34a; --success-soft: #e8f8f0;
  --warning: #d97706; --warning-soft: #fff4e5; --warning-soft-line: #f5dfa8;
  --radius: 12px;
  --dsh-df-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  /* 兼容别名：既有类名先吃这层，统一迁移完成前不删 */
  --dsh-df-bg: var(--background); --dsh-df-card: var(--card); --dsh-df-line: var(--border);
  --dsh-df-ink: var(--foreground); --dsh-df-ink-2: var(--secondary-foreground);
  --dsh-df-ink-3: var(--muted-foreground);
  --dsh-df-accent: var(--primary); --dsh-df-accent-soft: var(--accent);
  --dsh-df-ok: var(--success); --dsh-df-ok-soft: var(--success-soft);
  --dsh-df-warn: var(--warning); --dsh-df-warn-soft: var(--warning-soft);
  --dsh-df-err: var(--destructive); --dsh-df-err-soft: #fdecec;
  --dsh-df-radius: var(--radius);
  background: var(--background); color: var(--foreground);
  font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ── 顶栏（brand + tabs，原型 .topbar） ── */
.dsh-df-topbar { background: var(--dsh-df-card); border-bottom: 1px solid var(--dsh-df-line);
  padding: 0 24px; display: flex; align-items: center; gap: 24px; height: 52px;
  position: sticky; top: 0; z-index: 10; }
.dsh-df-brand { font-weight: 700; font-size: 14px; white-space: nowrap; }
.dsh-df-brand em { font-style: normal; color: var(--dsh-df-accent); }
.dsh-df-tabs { display: flex; gap: 4px; height: 100%; }
.dsh-df-tab { display: flex; align-items: center; padding: 0 14px; color: var(--dsh-df-ink-2);
  border: none; border-bottom: 2px solid transparent; font-size: 13px; background: none; cursor: pointer; }
.dsh-df-tab:hover { color: var(--dsh-df-ink); }
.dsh-df-tab[aria-selected="true"] { color: var(--dsh-df-ink); font-weight: 600;
  border-bottom-color: var(--dsh-df-accent); }
.dsh-df-subtabs { margin: 2px 0 10px; }
.dsh-df-subtabs .dsh-df-tab { padding: 4px 10px; font-size: 12px; height: auto; }
.dsh-df-tabpane[hidden] { display: none; }

/* ── 页面容器（原型 .page） ── */
.dsh-df-page { max-width: 1080px; margin: 0 auto; padding: 22px 24px 56px; }
.dsh-df-page-spl { max-width: 1280px; margin: 0 auto; padding: 22px 24px 56px;
  display: grid; grid-template-columns: 360px 1fr; gap: 20px; align-items: start; }
@media (max-width: 980px) { .dsh-df-page-spl { grid-template-columns: 1fr; } }
.dsh-df-page-spl > aside { min-width: 0; }
.dsh-df-page-spl > main { min-width: 0; }

/* ── 通用卡 / 头部 / 状态 ── */
.dsh-df-card { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); padding: 16px 18px; }
.dsh-df-card + .dsh-df-card { margin-top: 14px; }
.dsh-df-card h2 { font-size: 14px; font-weight: 600; margin-bottom: 4px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-df-sub { color: var(--dsh-df-ink-3); font-size: 12px; margin: 0; }
.dsh-df-head { display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 12px; gap: 10px; flex-wrap: wrap; }
.dsh-df-sync { font-size: 11px; color: var(--dsh-df-ink-3); display: flex; align-items: center;
  gap: 8px; white-space: nowrap; }
.dsh-df-last { font-size: 11px; color: var(--dsh-df-ink-3); }

/* ── 徽标 / 方法 / 层级标识 ── */
.dsh-df-badge { display: inline-block; border-radius: 5px; padding: 1px 8px; font-size: 11px;
  font-weight: 600; white-space: nowrap; }
.dsh-df-badge.running { background: var(--dsh-df-accent-soft); color: var(--dsh-df-accent); }
.dsh-df-badge.done, .dsh-df-badge.ok { background: var(--dsh-df-ok-soft); color: var(--dsh-df-ok); }
.dsh-df-badge.failed, .dsh-df-badge.error { background: var(--dsh-df-err-soft); color: var(--dsh-df-err); }
.dsh-df-badge.cancelled, .dsh-df-badge.skipped-external { background: #f1f2f4; color: var(--dsh-df-ink-3); }
.dsh-df-method { font: 700 10.5px var(--dsh-df-mono); border-radius: 5px; padding: 1px 7px;
  white-space: nowrap; }
.dsh-df-method.GET { background: var(--dsh-df-ok-soft); color: var(--dsh-df-ok); }
.dsh-df-method.POST { background: var(--dsh-df-warn-soft); color: var(--dsh-df-warn); }
.dsh-df-method.dsh-df-method-other { background: #f1f2f4; color: var(--dsh-df-ink-3); }
.dsh-df-lv { font-size: 10px; font-weight: 700; letter-spacing: .05em; border-radius: 4px;
  padding: 1px 6px; white-space: nowrap; }
.dsh-df-lv1 { background: #eef2ff; color: #4f46e5; }
.dsh-df-lv2 { background: #ecfdf5; color: #059669; }
.dsh-df-lv3 { background: #fff7ed; color: #ea580c; }
.dsh-df-auto-tag { font-size: 10px; color: var(--dsh-df-warn); background: var(--dsh-df-warn-soft);
  border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.dsh-df-mono { font-family: var(--dsh-df-mono); font-size: 11.5px; word-break: break-all; }

/* ── 表单（原型 .url-input / .mode-tag / .btn-primary） ── */
.dsh-df-url-input, .dsh-df-search { width: 100%; border: 1px solid #d4d8df; border-radius: 8px;
  padding: 8px 12px; font: 12px var(--dsh-df-mono); color: var(--dsh-df-ink);
  background: var(--dsh-df-card); box-sizing: border-box; }
.dsh-df-url-input:focus, .dsh-df-search:focus { outline: none; border-color: var(--dsh-df-accent);
  box-shadow: 0 0 0 3px var(--dsh-df-accent-soft); }
.dsh-df-search { flex: 1; max-width: 340px; font-family: inherit; font-size: 13px; }
.dsh-df-mode-tag { display: inline-flex; align-items: center; gap: 5px;
  background: var(--dsh-df-accent-soft); color: var(--dsh-df-accent); border-radius: 6px;
  padding: 2px 8px; font-size: 11px; font-weight: 600; margin-top: 10px; }
.dsh-df-btn-primary { margin-top: 12px; width: 100%; border: none; background: var(--dsh-df-accent);
  color: #fff; border-radius: 8px; padding: 9px 0; font-size: 13px; font-weight: 600; cursor: pointer; }
.dsh-df-btn-primary:hover { filter: brightness(1.06); }
.dsh-df-btn-primary:disabled { opacity: .5; cursor: default; }
.dsh-df-btn, .dsh-df-btn-ghost, .dsh-df-mini, .dsh-df-pact { border: 1px solid var(--dsh-df-line);
  background: var(--dsh-df-card); border-radius: 6px; padding: 4px 10px; font-size: 12px;
  color: var(--dsh-df-ink-2); cursor: pointer; white-space: nowrap; }
.dsh-df-btn:hover, .dsh-df-btn-ghost:hover { border-color: #b8c3d9; color: var(--dsh-df-ink); }
.dsh-df-btn[disabled], .dsh-df-btn-ghost[disabled] { opacity: .45; cursor: default; }
.dsh-df-mini { font-size: 11px; padding: 1px 8px; }
.dsh-df-mini:hover { border-color: var(--dsh-df-accent); color: var(--dsh-df-accent);
  background: var(--dsh-df-accent-soft); }
.dsh-df-select { border: 1px solid var(--dsh-df-line); border-radius: 8px; padding: 7px 8px;
  font-size: 12px; color: var(--dsh-df-ink-2); background: var(--dsh-df-card); cursor: pointer; }

/* ── 进度：stat 网格 + 步骤时间线 + note（原型 .stat-grid / .steps / .note） ── */
.dsh-df-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 14px; }
.dsh-df-stat { background: #f7f8fa; border: 1px solid var(--dsh-df-line); border-radius: 8px;
  padding: 8px 4px; text-align: center; }
.dsh-df-stat b { display: block; font-size: 17px; font-weight: 700; }
.dsh-df-stat span { font-size: 11px; color: var(--dsh-df-ink-3); }
.dsh-df-steps { list-style: none; padding: 0; margin: 0; }
.dsh-df-steps li { position: relative; padding: 0 0 16px 26px; font-size: 12px; color: var(--dsh-df-ink-2); }
.dsh-df-steps li:last-child { padding-bottom: 0; }
.dsh-df-steps li::before { content: ""; position: absolute; left: 6px; top: 4px; width: 9px;
  height: 9px; border-radius: 50%; background: #d4d8df; }
.dsh-df-steps li::after { content: ""; position: absolute; left: 10px; top: 16px; bottom: 0;
  width: 1px; background: var(--dsh-df-line); }
.dsh-df-steps li:last-child::after { display: none; }
.dsh-df-steps li.dsh-df-done { color: var(--dsh-df-ink); }
.dsh-df-steps li.dsh-df-done::before { background: var(--dsh-df-ok); }
.dsh-df-steps li.dsh-df-doing { color: var(--dsh-df-accent); font-weight: 600; }
.dsh-df-steps li.dsh-df-doing::before { background: var(--dsh-df-accent);
  box-shadow: 0 0 0 4px var(--dsh-df-accent-soft); }
.dsh-df-steps li small { display: block; color: var(--dsh-df-ink-3); font-size: 11px; font-weight: 400; }
.dsh-df-note { background: var(--dsh-df-warn-soft); border: 1px solid #f5dfa8; border-radius: 8px;
  padding: 8px 12px; font-size: 12px; color: var(--dsh-df-warn); }

/* ── 结果文档头 + L1 页面节点（原型 .doc-head / .page-node） ── */
.dsh-df-doc-head { display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 14px; gap: 10px; flex-wrap: wrap; }
.dsh-df-doc-head h1 { font-size: 17px; font-weight: 700; margin: 0; }
.dsh-df-summary { color: var(--dsh-df-ink-3); font-size: 12px; }
.dsh-df-page-node { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); margin-bottom: 14px; overflow: hidden; }
.dsh-df-pn-head { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 12px 18px; background: linear-gradient(90deg, #f8faff, #ffffff);
  border: none; border-bottom: 1px solid transparent; cursor: pointer; }
.dsh-df-page-node:not(.dsh-df-collapsed) > .dsh-df-pn-head { border-bottom-color: var(--dsh-df-line); }
.dsh-df-pn-name { font-weight: 600; font-size: 13px; word-break: break-all; }
.dsh-df-pn-meta { margin-left: auto; color: var(--dsh-df-ink-3); font-size: 11px; white-space: nowrap; }
.dsh-df-caret { color: var(--dsh-df-ink-3); font-size: 10px; transition: transform .15s ease; }
.dsh-df-collapsed .dsh-df-caret { transform: rotate(-90deg); }
.dsh-df-pn-body { padding: 14px 18px 16px; }

/* ── L2 接口卡 + L3 细节导轨（原型 .iface / .sec） ── */
.dsh-df-iface { margin-left: 0; }
.dsh-df-iface-card { border: 1px dashed var(--dsh-df-line); border-radius: 10px;
  background: var(--dsh-df-card); padding: 10px 14px; margin-bottom: 10px; }
.dsh-df-iface-card:hover { border-color: #b8c3d9; }
.dsh-df-iface-card.dsh-df-open { border: 1px dashed var(--dsh-df-accent); }
.dsh-df-iface-head { display: flex; align-items: center; gap: 8px; cursor: pointer;
  background: none; border: none; width: 100%; text-align: left; padding: 0; }
.dsh-df-iface-url { display: block; font: 11px var(--dsh-df-mono); color: var(--dsh-df-ink-2);
  margin: 4px 0 0 2px; word-break: break-all; }
.dsh-df-iface-chips { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px;
  color: var(--dsh-df-ink-3); margin-top: 6px; }
.dsh-df-iface-chips b { color: var(--dsh-df-ink-2); font-weight: 600; }
.dsh-df-iface-detail { margin-top: 10px; border-left: 2px solid var(--dsh-df-accent);
  background: #fdfdff; border-radius: 0 8px 8px 0; padding: 2px 0 2px 14px; }
.dsh-df-sec { border-left: 2px dashed #ead9c2; margin: 12px 0; padding-left: 12px; }
.dsh-df-sec:last-child { margin-bottom: 2px; }
.dsh-df-sec h3 { font-size: 12px; font-weight: 600; margin: 0 0 6px; color: var(--dsh-df-ink);
  display: flex; align-items: center; gap: 8px; }
.dsh-df-sec h3 small { color: var(--dsh-df-ink-3); font-weight: 400; }
.dsh-df-fields { width: 100%; border-collapse: collapse; font-size: 11px; }
.dsh-df-fields th { text-align: left; font-weight: 600; color: var(--dsh-df-ink-3);
  background: #f7f8fa; padding: 4px 8px; border: 1px solid var(--dsh-df-line); white-space: nowrap; }
.dsh-df-fields td { padding: 4px 8px; border: 1px solid var(--dsh-df-line);
  color: var(--dsh-df-ink-2); word-break: break-all; }
.dsh-df-fields td.dsh-df-mono { font-size: 11px; }
.dsh-df-tag-unverified { font-size: 10px; font-weight: 600; color: var(--dsh-df-warn);
  background: var(--dsh-df-warn-soft); border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.dsh-df-shape-list { list-style: none; margin: 0; padding: 0; }
.dsh-df-shape { display: flex; align-items: center; gap: 10px; padding: 5px 0;
  border-bottom: 1px dashed var(--dsh-df-line); font-size: 11.5px; flex-wrap: wrap; }
.dsh-df-shape:last-child { border-bottom: none; }
.dsh-df-fp { font: 11px var(--dsh-df-mono); background: #f1f2f4; border-radius: 4px;
  padding: 1px 7px; color: var(--dsh-df-ink-2); word-break: break-all; }
.dsh-df-kv { color: var(--dsh-df-ink-3); font-size: 11px; }
.dsh-df-kv b { color: var(--dsh-df-ink-2); font-weight: 600; }

/* ── 工具条（原型 .toolbar） ── */
.dsh-df-toolbar { display: flex; gap: 10px; align-items: center; margin: 0 0 14px; flex-wrap: wrap; }
.dsh-df-view-head { margin-bottom: 16px; }
.dsh-df-view-head h1 { font-size: 17px; font-weight: 700; margin: 0 0 2px; }

/* ── L1 网站（article 级，原型 .site） ── */
.dsh-df-site { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); margin-bottom: 14px; overflow: hidden; }
.dsh-df-site-header { display: flex; align-items: center; gap: 10px; width: 100%;
  text-align: left; padding: 12px 18px; background: linear-gradient(90deg, #f8faff, #ffffff);
  border: none; cursor: pointer; border-bottom: 1px solid transparent; }
.dsh-df-site:not(.dsh-df-collapsed) > .dsh-df-site-header { border-bottom-color: var(--dsh-df-line); }
.dsh-df-site-name { font-weight: 600; font-size: 13px; }
.dsh-df-host { font: 11.5px var(--dsh-df-mono); color: var(--dsh-df-ink-3); word-break: break-all; }
.dsh-df-stats { margin-left: auto; display: flex; gap: 14px; font-size: 11px;
  color: var(--dsh-df-ink-3); white-space: nowrap; }
.dsh-df-stats b { color: var(--dsh-df-ink); font-weight: 700; font-size: 12px; }
.dsh-df-time-row { display: flex; gap: 16px; padding: 6px 18px; font-size: 11px;
  color: var(--dsh-df-ink-3); border-top: 1px dashed var(--dsh-df-line); flex-wrap: wrap; }
.dsh-df-site-body { border-top: 1px dashed var(--dsh-df-line); background: #fdfdff;
  padding: 12px 18px 16px; }
.dsh-df-site-body h3 { font-size: 12px; font-weight: 600; color: var(--dsh-df-ink-3);
  margin: 0 0 10px; }
.dsh-df-pages-rail { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: 10px; padding: 4px 16px; }

/* ── L2 页面页卡（rail 行，原型 .pgcard） ── */
.dsh-df-pgcard { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0;
  border-bottom: 1px dashed var(--dsh-df-line); }
.dsh-df-pgcard:last-child { border-bottom: none; }
.dsh-df-pg-main { min-width: 0; flex: 1; }
.dsh-df-pname { font-weight: 600; font-size: 12.5px; }
.dsh-df-purl { color: var(--dsh-df-accent); text-decoration: none; font: 11.5px var(--dsh-df-mono);
  word-break: break-all; }
.dsh-df-purl::after { content: " ↗"; font-family: inherit; }
.dsh-df-purl:hover { text-decoration: underline; }
.dsh-df-pg-acts { margin-left: auto; display: flex; gap: 6px; white-space: nowrap; }
.dsh-df-pg-chips { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px;
  color: var(--dsh-df-ink-3); margin-top: 3px; }
.dsh-df-pg-chips b { color: var(--dsh-df-ink-2); font-weight: 600; }

/* ── 空态（原型 .empty） ── */
.dsh-df-empty { border: 1.5px dashed #c8cdd6; border-radius: var(--dsh-df-radius);
  padding: 30px 20px; text-align: center; color: var(--dsh-df-ink-3); font-size: 12px;
  background: rgba(255, 255, 255, .5); }
.dsh-df-empty b { color: var(--dsh-df-ink-2); font-weight: 600; }

/* ── 接口库视图：网站网格（原型 .site-grid/.site-card） ── */
.dsh-df-site-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px; }
.dsh-df-site-card { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); padding: 14px 16px; cursor: pointer; text-align: left;
  transition: border-color .15s ease, transform .15s ease; }
.dsh-df-site-card:hover { border-color: var(--dsh-df-accent); transform: translateY(-1px); }
.dsh-df-site-card-title { display: flex; align-items: center; gap: 8px; font-size: 13px;
  font-weight: 600; flex-wrap: wrap; }
.dsh-df-site-card-stats { display: flex; gap: 12px; margin: 8px 0; font-size: 11px;
  color: var(--dsh-df-ink-3); flex-wrap: wrap; }
.dsh-df-site-card-stats b { color: var(--dsh-df-ink); font-weight: 700; font-size: 12px; }
.dsh-df-site-card-foot { display: flex; align-items: center; gap: 8px; font-size: 11px;
  color: var(--dsh-df-ink-3); }
.dsh-df-site-card-enter { margin-left: auto; color: var(--dsh-df-accent); font-size: 11px;
  font-weight: 600; }

/* ── 接口库视图：面包屑 + 站点横幅 ── */
.dsh-df-crumb { display: flex; gap: 8px; align-items: center; margin-bottom: 12px;
  font-size: 12px; color: var(--dsh-df-ink-3); flex-wrap: wrap; }
.dsh-df-crumb button { color: var(--dsh-df-accent); background: none; border: none; cursor: pointer;
  font-size: 12px; padding: 0; }
.dsh-df-crumb button:hover { text-decoration: underline; }
.dsh-df-site-banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 14px; padding: 14px 18px; }

/* ── 分页条（原型 .pagerbar） ── */
.dsh-df-pagerbar { display: flex; align-items: center; gap: 10px; margin-top: 14px;
  font-size: 12px; color: var(--dsh-df-ink-3); flex-wrap: wrap; }
.dsh-df-pages { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
.dsh-df-pg { border: 1px solid var(--dsh-df-line); background: var(--dsh-df-card);
  border-radius: 6px; padding: 2px 9px; cursor: pointer; font-size: 12px; color: var(--dsh-df-ink-2); }
.dsh-df-pg:hover { border-color: #b8c3d9; }
.dsh-df-pg[aria-current="true"] { background: var(--dsh-df-accent); border-color: var(--dsh-df-accent);
  color: #fff; cursor: default; }
.dsh-df-pg[disabled] { opacity: .4; cursor: default; }

/* ── 右下角图例（原型 .legend, position fixed） ── */
.dsh-df-legend { position: fixed; right: 16px; bottom: 16px; z-index: 20;
  background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line); border-radius: 10px;
  padding: 9px 14px; font-size: 11px; color: var(--dsh-df-ink-3); display: flex; gap: 14px;
  align-items: center; box-shadow: 0 8px 24px rgba(29, 33, 41, .08); flex-wrap: wrap; }

/* ── 刷新/加载/错误提示（跨页共用） ── */
.dsh-df-errline { color: var(--dsh-df-err); font-size: 12px; margin-top: 10px;
  word-break: break-all; }
.dsh-df-noticeline { color: var(--dsh-df-ink-3); font-size: 12px; margin-top: 10px; }
.dsh-df-state { text-align: center; padding: 20px 0; color: var(--dsh-df-ink-3); font-size: 12px; }
.dsh-df-state.err { color: var(--dsh-df-err); }

/* ── 采集运行页（命令式 board-runs）沿用类：只换皮不改 DOM ── */
.dsh-df-runs { padding: 22px 24px 56px; max-width: 1080px; margin: 0 auto; }
.dsh-df-item { background: var(--dsh-df-card); border: 1px dashed var(--dsh-df-line);
  border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; cursor: pointer; }
.dsh-df-item:hover { border-color: #b8c3d9; }
.dsh-df-item.open { border: 1px dashed var(--dsh-df-accent); }
.dsh-df-row { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dsh-df-grow { flex: 1; min-width: 0; }
.dsh-df-cap { color: var(--dsh-df-ink-3); font-size: 11px; }
.dsh-df-chips { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; color: var(--dsh-df-ink-3); }
.dsh-df-detail { display: none; margin-top: 10px; border-left: 2px solid var(--dsh-df-accent);
  background: #fdfdff; border-radius: 0 8px 8px 0; padding: 2px 0 2px 14px; }
.dsh-df-item.open > .dsh-df-detail { display: block; }
.dsh-df-block { margin: 10px 0; }
.dsh-df-block h3 { font-size: 12px; font-weight: 600; margin: 0 0 6px; color: var(--dsh-df-ink-2); }
.dsh-df-list { display: flex; flex-direction: column; gap: 2px; }
.dsh-df-line { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; min-width: 0; }
.dsh-df-sample { cursor: pointer; }
.dsh-df-pre { font: 11px var(--dsh-df-mono); background: #f7f8fa; border: 1px solid var(--dsh-df-line);
  border-radius: 8px; padding: 8px 10px; margin: 4px 0 10px; white-space: pre-wrap;
  word-break: break-all; max-height: 220px; overflow: auto; }
`,document.head.appendChild(e)}function fe(t,n){let r=e=>e({activePanelId:n});return function(i={}){let a=(typeof i.usePanelInfo==`function`?i.usePanelInfo:r)(e=>e.activePanelId),o=(0,e.useRef)(null),s=(0,e.useRef)(a===n);return s.current=a===n,(0,e.useEffect)(()=>{let e=o.current;if(e!==null)return Y(),t(e,{isActive:()=>s.current})},[]),(0,e.createElement)(`div`,{ref:o,className:`dsh-df-view`,"data-dsh-df-view":``})}}const pe=[{key:`recent`,label:`最近采集`},{key:`cards`,label:`接口最多`},{key:`name`,label:`站点名`}];function me({visible:n,onRecapture:r,onOpenInLibrary:i}){let{aggregate:a,cardsByPage:o,error:s,lastSync:c,reload:l}=L(n),[u,d]=(0,e.useState)(``),[p,m]=(0,e.useState)(`recent`),[h,g]=(0,e.useState)(!1),[_,v]=(0,e.useState)(/* @__PURE__ */ new Set),[y,b]=(0,e.useState)(0),x=(0,e.useMemo)(()=>{let e=u.trim().toLowerCase(),t=(a?.sites??[]).filter(t=>e.length===0||t.host.toLowerCase().includes(e)||t.pageUrls.some(t=>t.toLowerCase().includes(e)));if(p===`recent`)return t;let n=[...t].sort((e,t)=>p===`cards`?t.stats.cards-e.stats.cards:e.host.localeCompare(t.host)),r=n.find(e=>e.host===f);return r===void 0?n:[...n.filter(e=>e.host!==f),r]},[a,u,p]),S=Math.max(1,Math.ceil(x.length/10)),C=Math.min(y,S-1),T=x.slice(C*10,(C+1)*10),E=e=>{v(t=>{let n=new Set(t);return n.has(e)?n.delete(e):n.add(e),n})};return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-page`,children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-head`,children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{children:[/* @__PURE__ */ (0,t.jsx)(`h2`,{children:`采集网站`}),/* @__PURE__ */ (0,t.jsx)(`p`,{className:`dsh-df-sub`,children:`按站点看已采过的页面与接口；15 秒自动刷新`})]}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-sync`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-last`,children:c}),/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-btn-ghost`,type:`button`,onClick:l,children:`刷新`})]})]}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-toolbar`,children:[/* @__PURE__ */ (0,t.jsx)(`input`,{className:`dsh-df-search`,type:`search`,placeholder:`搜索站点或页面 URL`,spellCheck:!1,value:u,onChange:e=>{d(e.target.value)}}),/* @__PURE__ */ (0,t.jsx)(`select`,{className:`dsh-df-select`,value:p,onChange:e=>{m(e.target.value)},children:pe.map(e=>/* @__PURE__ */ (0,t.jsx)(`option`,{value:e.key,children:e.label},e.key))}),/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-btn-ghost`,type:`button`,disabled:a===void 0||x.length===0,onClick:()=>{g(e=>!e)},children:h===!1?`全部展开`:`全部收起`})]}),a?.truncated===!0&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-note`,style:{marginBottom:12},children:`接口卡超过 5000 张：本页仅按最近 5000 张卡聚合，站点清单可能不全。`}),s!==void 0&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-empty`,children:`取数失败：${s} —— 点「刷新」重试。`}),s===void 0&&a===void 0&&/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-state`,children:`加载中…`}),s===void 0&&a!==void 0&&x.length===0&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-empty`,children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:`还没有可展示的站点`}),`——先用快速采集或 agent 会话采一次接口。`]}),s===void 0&&T.map(e=>/* @__PURE__ */ (0,t.jsx)(he,{site:e,byPage:o,shown:h||_.has(e.host),onRecapture:r,onOpenInLibrary:i,onToggle:()=>{E(e.host)}},e.host)),s===void 0&&a!==void 0&&x.length>0&&/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-pagerbar`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{children:`共 ${x.length} 站点 · ${a.cards.length} 接口卡`}),S>1&&/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-pages`,children:[/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-pg`,type:`button`,disabled:C<=0,onClick:()=>{b(C-1)},children:`‹`}),Array.from({length:S},(e,n)=>/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-pg`,type:`button`,"aria-current":n===C,onClick:()=>{b(n)},children:n+1},n)),/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-pg`,type:`button`,disabled:C>=S-1,onClick:()=>{b(C+1)},children:`›`})]})]}),/* @__PURE__ */ (0,t.jsx)(w,{entries:[{level:1,label:`网站`},{level:2,label:`页面`},{level:3,label:`接口`}]})]})}function he({site:e,byPage:n,shown:r,onRecapture:i,onOpenInLibrary:a,onToggle:o}){let s=e.stats;return/* @__PURE__ */ (0,t.jsxs)(`article`,{className:`dsh-df-site${r?``:` dsh-df-collapsed`}`,children:[/* @__PURE__ */ (0,t.jsxs)(`button`,{className:`dsh-df-site-header`,type:`button`,onClick:o,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-lv dsh-df-lv1`,children:`网站`}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-site-name`,children:e.host}),/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-stats`,children:[/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`页面 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:s.pages})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`接口 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:s.cards})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`样本 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:s.samples})]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[`采集 `,/* @__PURE__ */ (0,t.jsx)(`b`,{children:s.runs}),` 次`]})]}),/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-caret`,children:`▾`})]}),r&&/* @__PURE__ */ (0,t.jsxs)(t.Fragment,{children:[/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-time-row`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{children:s.firstAt===void 0?`没有采集记录（历史卡）`:`首次 ${O(s.firstAt)}`}),s.lastAt!==void 0&&/* @__PURE__ */ (0,t.jsx)(`span`,{children:`最近 ${O(s.lastAt)}`})]}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-site-body`,children:[e.host===`（未识别站点）`&&/* @__PURE__ */ (0,t.jsx)(`p`,{className:`dsh-df-sub`,style:{margin:`0 0 10px`},children:`这批接口卡（或采集 run）的 URL 无法解析出 host。`}),/* @__PURE__ */ (0,t.jsx)(`h3`,{children:`页面 ${e.pageUrls.length}`}),e.pageUrls.length===0?/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-cap`,children:`没有页面记录`}):/* @__PURE__ */ (0,t.jsx)(`div`,{className:`dsh-df-pages-rail`,children:e.pageUrls.map(r=>/* @__PURE__ */ (0,t.jsx)(ge,{siteHost:e.host,pageUrl:r,cards:n?.get(r)??[],onRecapture:i,onOpenInLibrary:a},r))})]})]})]})}function ge({siteHost:e,pageUrl:n,cards:r,onRecapture:i,onOpenInLibrary:a}){let o=r.reduce((e,t)=>e+t.sampleCount,0),s=r.reduce((e,t)=>Math.max(e,t.createdAt),0);return/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-pgcard`,children:[/* @__PURE__ */ (0,t.jsx)(`span`,{className:`dsh-df-lv dsh-df-lv2`,children:`页面`}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-pg-main`,children:[/* @__PURE__ */ (0,t.jsx)(`a`,{className:`dsh-df-purl`,href:n,target:`_blank`,rel:`noreferrer`,children:n}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-pg-chips`,children:[/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:r.length}),` 接口`]}),/* @__PURE__ */ (0,t.jsxs)(`span`,{children:[/* @__PURE__ */ (0,t.jsx)(`b`,{children:o}),` 样本`]}),s>0&&/* @__PURE__ */ (0,t.jsx)(`span`,{children:`最近 ${O(s)}`})]})]}),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-pg-acts`,children:[a!==void 0&&/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-pact`,type:`button`,onClick:()=>{a(e)},children:`接口 →`}),i!==void 0&&/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-pact`,type:`button`,onClick:()=>{i(n)},children:`重采`})]})]})}const _e=[{id:r,label:`采集运行`},{id:i,label:`快速采集`},{id:a,label:`接口库`},{id:`dataforge-sites`,label:`采集网站`}],ve=e=>e({activePanelId:n}),ye=fe(z,n);function be(o){let s=typeof o.usePanelInfo==`function`?o.usePanelInfo:ve,c=s(e=>e.activePanelId)===n,[l,u]=(0,e.useState)(r),[d,f]=(0,e.useState)(),[p,m]=(0,e.useState)();return(0,e.useEffect)(()=>{Y()},[]),/* @__PURE__ */ (0,t.jsxs)(`div`,{className:`dsh-df-view`,"data-dsh-df-view":``,children:[/* @__PURE__ */ (0,t.jsxs)(`header`,{className:`dsh-df-topbar`,children:[/* @__PURE__ */ (0,t.jsxs)(`span`,{className:`dsh-df-brand`,children:[`Data`,/* @__PURE__ */ (0,t.jsx)(`em`,{children:`Forge`}),` · 数据采集`]}),/* @__PURE__ */ (0,t.jsx)(`nav`,{className:`dsh-df-tabs`,role:`tablist`,children:_e.map(e=>/* @__PURE__ */ (0,t.jsx)(`button`,{className:`dsh-df-tab`,type:`button`,role:`tab`,"aria-selected":l===e.id,"data-dsh-df-tab":e.id,onClick:()=>{u(e.id)},children:e.label},e.id))})]}),l===`dataforge-capture`&&/* @__PURE__ */ (0,t.jsx)(ye,{usePanelInfo:s}),l===`dataforge-new-capture`&&/* @__PURE__ */ (0,t.jsx)(ce,{visible:c,seed:d}),l===`dataforge-interfaces`&&/* @__PURE__ */ (0,t.jsx)(te,{visible:c,openSite:p?.host,openNonce:p?.nonce}),l===`dataforge-sites`&&/* @__PURE__ */ (0,t.jsx)(me,{visible:c,onRecapture:e=>{f({url:e,nonce:Date.now()}),u(i)},onOpenInLibrary:e=>{m({host:e,nonce:Date.now()}),u(a)}})]})}const xe={viewBox:`0 0 24 24`,width:`1.1em`,height:`1.1em`,fill:`none`,stroke:`currentColor`,strokeWidth:1.8,strokeLinecap:`round`,strokeLinejoin:`round`,"aria-hidden":``};function Se(){return(0,e.createElement)(`svg`,xe,(0,e.createElement)(`rect`,{x:3,y:4,width:18,height:16,rx:2}),(0,e.createElement)(`path`,{d:`M3 9h18`}),(0,e.createElement)(`path`,{d:`M12 11v6`}),(0,e.createElement)(`path`,{d:`M9.5 14.5L12 17l2.5-2.5`}))}const X=`main`,Z=`sidebar.panellist`,Ce=()=>null;function Q(e){return typeof e==`function`?e:()=>{}}function $(e,t){let n=e?.slots;if(n==null)throw Error(`[page-panel] ctx.slots unavailable（inject 缺 "slots"）`);let r=t.id,i=[Q(n.inject(X,()=>n.register({name:X,key:r},t.Component))),Q(n.inject(Z,()=>n.register({name:Z,id:r,order:t.order??0,label:t.label},t.Icon??Ce)))],a=!1;return()=>{if(!a){a=!0;for(let e of i)try{e()}catch{}}}}const we=[`slots`];function Te(e){$(e,{id:n,label:`数据采集`,order:120,Component:be,Icon:Se})}exports.apply=Te,exports.inject=we,exports.name=`dsh-dataforge/client`;