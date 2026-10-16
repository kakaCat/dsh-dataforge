import { Context } from "@deepseek-ai/cordis";
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.5/node_modules/@deepseek-ai/cosmokit/lib/types/types.d.ts
declare function isArrayBufferLike(value: any): value is ArrayBufferLike;
declare function isArrayBufferSource(value: any): value is Binary.Source;
/** Binary source detection and base64/hex conversion helpers. */
declare namespace Binary {
  type Source<T extends ArrayBufferLike = ArrayBufferLike> = T | ArrayBufferView<T>;
  const is: typeof isArrayBufferLike;
  const isSource: typeof isArrayBufferSource;
  function fromSource<T extends ArrayBufferLike>(source: Source<T>): T;
  function toBase64(source: Source): string;
  function fromBase64(source: string): ArrayBuffer | Uint8Array<ArrayBuffer>;
  function toHex(source: Source): string;
  function fromHex(source: string): ArrayBuffer;
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.5/node_modules/@deepseek-ai/cosmokit/lib/types/misc.d.ts
/** String/symbol keyed dictionary type. */
type Dict<T = any, K extends string | symbol = string> = { [key in K]: T; };
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.5/node_modules/@deepseek-ai/cosmokit/lib/types/volatile.d.ts
/** Shared config references used by schema validators and plugin runtimes. */
/** Recursively readonly data returned by a volatile config reference. */
type VolatileSnapshot<T> = T extends object ? { readonly [K in keyof T]: VolatileSnapshot<T[K]>; } : T;
/** A stable reference; keep the reference, or capture its value for one operation only. */
interface Volatile<T> {
  /** @returns the current immutable snapshot, including undefined for an absent value. */
  get(): VolatileSnapshot<T>;
}
//#endregion
//#region node_modules/.pnpm/@standard-schema+spec@1.1.0/node_modules/@standard-schema/spec/dist/index.d.ts
/** The Standard Typed interface. This is a base type extended by other specs. */
interface StandardTypedV1<Input = unknown, Output = Input> {
  /** The Standard properties. */
  readonly "~standard": StandardTypedV1.Props<Input, Output>;
}
declare namespace StandardTypedV1 {
  /** The Standard Typed properties interface. */
  interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1;
    /** The vendor name of the schema library. */
    readonly vendor: string;
    /** Inferred types associated with the schema. */
    readonly types?: Types<Input, Output> | undefined;
  }
  /** The Standard Typed types interface. */
  interface Types<Input = unknown, Output = Input> {
    /** The input type of the schema. */
    readonly input: Input;
    /** The output type of the schema. */
    readonly output: Output;
  }
  /** Infers the input type of a Standard Typed. */
  type InferInput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  /** Infers the output type of a Standard Typed. */
  type InferOutput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}
/** The Standard Schema interface. */
interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}
declare namespace StandardSchemaV1 {
  /** The Standard Schema properties interface. */
  interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<Input, Output> {
    /** Validates unknown input values. */
    readonly validate: (value: unknown, options?: StandardSchemaV1.Options | undefined) => Result<Output> | Promise<Result<Output>>;
  }
  /** The result interface of the validate function. */
  type Result<Output> = SuccessResult<Output> | FailureResult;
  /** The result interface if validation succeeds. */
  interface SuccessResult<Output> {
    /** The typed output value. */
    readonly value: Output;
    /** A falsy value for `issues` indicates success. */
    readonly issues?: undefined;
  }
  interface Options {
    /** Explicit support for additional vendor-specific parameters, if needed. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }
  /** The result interface if validation fails. */
  interface FailureResult {
    /** The issues of failed validation. */
    readonly issues: ReadonlyArray<Issue>;
  }
  /** The issue interface of the failure output. */
  interface Issue {
    /** The error message of the issue. */
    readonly message: string;
    /** The path of the issue, if any. */
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  /** The path segment interface of the issue. */
  interface PathSegment {
    /** The key representing a path segment. */
    readonly key: PropertyKey;
  }
  /** The Standard types interface. */
  interface Types<Input = unknown, Output = Input> extends StandardTypedV1.Types<Input, Output> {}
  /** Infers the input type of a Standard. */
  type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<Schema>;
  /** Infers the output type of a Standard. */
  type InferOutput<Schema extends StandardTypedV1> = StandardTypedV1.InferOutput<Schema>;
}
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.4/node_modules/@deepseek-ai/schemastery/lib/types/index.d.ts
declare const kSchema: unique symbol;
declare global {
  namespace Schemastery {
    /** Convert primitive constructors, constants, and existing schemas into a schema type. */
    type From<X> = X extends string | number | boolean ? Schema<X> : X extends Schema<any, any, SchemaMode> ? X : X extends typeof String ? Schema<string> : X extends typeof Number ? Schema<number> : X extends typeof Boolean ? Schema<boolean> : X extends typeof Function ? Schema<Function, (...args: any[]) => any> : X extends Constructor<infer S> ? Schema<S> : never;
    type TypeS1<X> = X extends Schema<infer S, infer _T, infer _M> ? S : never;
    type Inverse<X> = X extends Schema<infer _S, infer T, infer M> ? (arg: SchemaOutput<T, M>) => void : never;
    /** Input type accepted by a schema-like value. */
    type TypeS<X> = TypeS1<From<X>>;
    /** Output type returned by a schema-like value after validation. */
    type TypeT<X> = ReturnType<From<X>>;
    /** Resolver callback used by custom schema types registered with `Schema.extend()`. */
    type Resolve = (data: any, schema: Schema, options: Options, strict?: boolean) => [any, any?];
    /** Input type accepted by one schema in an intersection. */
    type IntersectS<X> = From<X> extends Schema<infer S, infer _T, infer _M> ? S : never;
    /** Output type returned by one schema in an intersection. */
    type IntersectT<X> = Inverse<From<X>> extends ((arg: infer T) => void) ? T : never;
    type TupleS<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeS<L>?, ...TupleS<R>] : any[];
    type TupleT<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeT<L>?, ...TupleT<R>] : any[];
    type ObjectS<X extends Dict> = { [K in keyof X]?: TypeS<X[K]> | null; } & Dict;
    type ObjectT<X extends Dict> = { [K in keyof X]: TypeT<X[K]>; } & Dict;
    type Constructor<T = any> = new (...args: any[]) => T;
    /** Static constructor and factory methods exposed by the default `Schema` export. */
    interface Static {
      <T = any>(options: Partial<Schema<T>>): Schema<T>;
      new <T = any>(options: Partial<Schema<T>>): Schema<T>;
      prototype: Schema;
      /** Validate a value against a schema node and return `[output, adaptedInput?]`. */
      resolve: Resolve;
      /** Infer a schema from a primitive value, constructor, or existing schema. */
      from<X = any>(source?: X): From<X>;
      /** Register a resolver for a custom schema `type`. */
      extend(type: string, resolve: Resolve): void;
      /** Accept any value without validation. */
      any<T = any>(): Schema<T>;
      /** Accept only nullable input. */
      never(): Schema<never>;
      /** Accept exactly one constant value. */
      const<const T>(value: T): Schema<T>;
      /** Accept strings, with optional metadata constraints added by instance methods. */
      string(): Schema<string>;
      /** Accept numbers, with optional range and step constraints. */
      number(): Schema<number>;
      /** Accept non-negative integer numbers. */
      natural(): Schema<number>;
      /** Accept a number between 0 and 1 and mark it as a slider. */
      percent(): Schema<number>;
      /** Accept booleans. */
      boolean(): Schema<boolean>;
      /** Accept `Date` instances or parse datetime strings into `Date` objects. */
      date(): Schema<string | Date, Date>;
      /** Accept `RegExp` instances or parse strings into regular expressions. */
      regExp(flag?: string): Schema<string | RegExp, RegExp>;
      /** Accept binary sources and normalize them to `ArrayBufferLike`. */
      arrayBuffer(): Schema<Binary.Source, ArrayBufferLike>;
      arrayBuffer(encoding: 'hex' | 'base64'): Schema<Binary.Source | string, ArrayBufferLike>;
      /** Accept a numeric bitset or string keys and normalize to a number. */
      bitset<K extends string>(bits: Partial<Record<K, number>>): Schema<number | readonly K[], number>;
      /** Accept functions. */
      function(): Schema<Function, (...args: any[]) => any>;
      /** Accept instances of a constructor or objects whose constructor name matches. */
      is(constructor: string): Schema;
      is<T>(constructor: Constructor<T>): Schema<T>;
      /** Accept arrays whose elements match `inner`. */
      array<X>(inner: X): Schema<TypeS<X>[], TypeT<X>[]>;
      /** Accept plain objects with values matching `inner` and optional key schema. */
      dict<X, Y extends Schema<any, string> = Schema<string>>(inner: X, sKey?: Y): Schema<Dict<TypeS<X>, TypeS<Y>>, Dict<TypeT<X>, TypeT<Y>>>;
      /** Accept tuple arrays where each index matches the corresponding schema. */
      tuple<const X extends readonly any[]>(list: X): Schema<TupleS<X>, TupleT<X>>;
      /** Accept plain objects; infer fields from the dictionary, not the enclosing schema's output type. */
      object<X extends Dict>(dict: X): Schema<ObjectS<NoInfer<X>>, ObjectT<NoInfer<X>>>;
      /** Accept values matching at least one schema in `list`. */
      union<const X>(list: readonly X[]): Schema<TypeS<X>, TypeT<X>>;
      /** Accept values matching every schema in `list`, merging object outputs. */
      intersect<const X>(list: readonly X[]): Schema<IntersectS<X>, IntersectT<X>>;
      /** Validate with `inner`, then convert the result with `callback`. */
      transform<X, T>(inner: X, callback: (value: TypeS<X>, options: Schemastery.Options) => T, preserve?: boolean): Schema<TypeS<X>, T>;
      /** Defer construction of a recursive schema until validation or serialization. */
      lazy<X extends Schema<any, any, SchemaMode>>(callback: () => X): X;
      ValidationError: typeof ValidationError;
    }
    /** Runtime validation options shared by all schema calls. */
    interface Options {
      /** Remove invalid object properties instead of throwing when possible. */
      autofix?: boolean;
      /** Skip validation for selected values and schema nodes. */
      ignore?(data: any, schema: Schema): boolean;
      /** Path used to format nested validation errors. */
      path?: (keyof any)[];
    }
    /** UI and validation metadata attached by schema builder methods. */
    interface Meta<T = any> {
      default?: T extends {} ? Partial<T> : T;
      required?: boolean;
      /** Parse this node as a stable config reference; its type and UI metadata remain unchanged. */
      volatile?: boolean;
      disabled?: boolean;
      collapse?: boolean;
      badges?: {
        text: string;
        type: string;
      }[];
      hidden?: boolean;
      loose?: boolean;
      role?: string;
      extra?: any;
      link?: string;
      description?: string | Dict<string>;
      comment?: string;
      pattern?: {
        source: string;
        flags?: string;
      };
      max?: number;
      min?: number;
      step?: number;
    }
  }
  /** Callable schema instance that validates input and returns normalized output. */
  interface Schemastery<S = any, T = S, Mode extends SchemaMode = 'plain'> {
    (data?: S | null, options?: Schemastery.Options): SchemaOutput<T, Mode>;
    new (data?: S | null, options?: Schemastery.Options): SchemaOutput<T, Mode>;
    [kSchema]: true;
    uid: number;
    meta: Schemastery.Meta<T>;
    type: string;
    sKey?: Schema;
    inner?: Schema;
    list?: Schema[];
    dict?: Dict<Schema>;
    bits?: Dict<number>;
    callback?: Function;
    constructor?: string | Function;
    builder?: Function;
    value?: T;
    refs?: Dict<Schema>;
    preserve?: boolean;
    '~standard': StandardSchemaV1.Props;
    /** Format this schema as a compact TypeScript-like type string. */
    toString(inline?: boolean): string;
    /** Serialize this schema, preserving shared and recursive references. */
    toJSON(): Schema<S, T, Mode>;
    /** Mark nullable input as invalid unless a default supplies a fallback. */
    required<R extends boolean = true>(value?: R): Schema<S, T, SetRequired<Mode, R>>;
    /**
     * Parse this config field as a stable reference containing immutable data.
     * @returns a schema whose output supports get(), including when the field is absent.
     */
    volatile(): Schema<NoInfer<S>, NoInfer<T>, Mode extends 'defined' | 'volatile-defined' ? 'volatile-defined' : 'volatile'>;
    /** Hide this schema node from UI renderers. */
    hidden(value?: boolean): Schema<S, T, Mode>;
    /** Return the default value instead of throwing when validation fails. */
    loose(value?: boolean): Schema<S, T, Mode>;
    /** Attach a renderer role and optional role-specific metadata. */
    role(text: string, extra?: any): Schema<S, T, Mode>;
    /** Attach an external documentation link. */
    link(link: string): Schema<S, T, Mode>;
    /** Set the fallback value used for nullable input. */
    default(value: T | NoInfer<Partial<S>>): Schema<S, T, SetRequired<Mode, true>>;
    /** Attach an auxiliary comment for documentation or form UIs. */
    comment(text: string): Schema<S, T, Mode>;
    /** Attach a localized or plain description for documentation or form UIs. */
    description(text: string): Schema<S, T, Mode>;
    /** Mark this schema node as disabled for form UIs. */
    disabled(value?: boolean): Schema<S, T, Mode>;
    /** Request collapsed rendering for nested form UIs. */
    collapse(value?: boolean): Schema<S, T, Mode>;
    /** Add a deprecated badge to this schema node. */
    deprecated(): Schema<S, T, Mode>;
    /** Add an experimental badge to this schema node. */
    experimental(): Schema<S, T, Mode>;
    /** Require strings to match a regular expression. */
    pattern(regexp: RegExp): Schema<S, T, Mode>;
    /** Set an inclusive maximum for numbers or collection lengths. */
    max(value: number): Schema<S, T, Mode>;
    /** Set an inclusive minimum for numbers or collection lengths. */
    min(value: number): Schema<S, T, Mode>;
    /** Set the numeric increment constraint. */
    step(value: number): Schema<S, T, Mode>;
    /** Add or replace an object property schema. */
    set(key: string, value: Schema): Schema<S, T, Mode>;
    /** Append a tuple, union, or intersection member schema. */
    push(value: Schema): Schema<S, T, Mode>;
    /** Remove values equal to schema defaults from normalized output. */
    simplify(value?: any): any;
    /** Return a schema clone with descriptions merged from locale messages. */
    i18n(messages: Dict): Schema<S, T, Mode>;
    /** Attach arbitrary metadata consumed by form renderers and downstream tools. */
    extra<K extends keyof Schemastery.Meta>(key: K, value: Schemastery.Meta[K]): Schema<S, T, Mode>;
  }
}
declare class ValidationError extends TypeError {
  options: Schemastery.Options;
  name: string;
  constructor(message: string, options: Schemastery.Options);
  static is(error: any): error is ValidationError;
}
type SchemaMode = 'plain' | 'defined' | 'volatile' | 'volatile-defined';
type SchemaOutput<T, M extends SchemaMode> = M extends 'volatile' ? Volatile<T | undefined> : M extends 'volatile-defined' ? Volatile<T> : T;
type SetRequired<M extends SchemaMode, R extends boolean> = M extends 'volatile' | 'volatile-defined' ? R extends true ? 'volatile-defined' : 'volatile' : R extends true ? 'defined' : 'plain';
type Schema<S = any, T = S, Mode extends SchemaMode = 'plain'> = Schemastery<S, T, Mode>;
declare const Schema: Schemastery.Static;
//#endregion
//#region src/config.d.ts
interface Config {
  /** 引擎流程包 checkout 绝对路径（含 dsh_bridge.py；DataForge Loop 仓库即首个流程包+引擎）。 */
  engineRoot: string;
  /** python 解释器（造数引擎运行时）。 */
  pythonBin: string;
  /** 插件数据根：runs 留痕与第三方流程包（默认 $DSH_HOME/storages/dsh-dataforge）。 */
  dataRoot: string;
  /** 桥进程硬超时（秒）；超时即杀并如实汇报。 */
  timeoutSeconds: number;
  /** 是否把流程包 policy.md 注入常驻策略段（三道闸纪律 + 业务映射）。 */
  injectPolicy: boolean;
  /** 采集：站点爬行 BFS 深度上限。 */
  captureMaxDepth: number;
  /** 采集：单次 site_crawl 页面数上限（超限诚实截断）。 */
  captureMaxPages: number;
  /** 采集：网络 idle 后的稳定窗口 ms。 */
  captureStabilityWindowMs: number;
  /** 采集：单响应体留盘点上限（字节），超过落文件。 */
  captureBodyLimitBytes: number;
  /** 采集：Chrome 通道（缺省 'chrome' = 本机系统 Chrome，免下载浏览器）。 */
  captureChromeChannel: string;
}
declare const Config: Schema<Config>;
/** 归一化（相对路径 → 绝对；~ 展开）。 */
declare function normalizeConfig(raw: Config): Required<Config>;
//#endregion
//#region src/shared/errors.d.ts
/**
 * 领域错误：错误码 + 人话。工具壳把它折成诚实回执。
 *
 * @module dsh-dataforge/shared/errors
 */
type DataforgeErrorCode = 'ENGINE_ROOT_MISSING' | 'BRIDGE_MISSING' | 'PYTHON_UNAVAILABLE' | 'FLOW_NOT_FOUND' | 'MISSING_FIELDS' | 'CONFIRM_REQUIRED' | 'JOBS_UNAVAILABLE' | 'RUN_NOT_FOUND' | 'OWNER_UNAVAILABLE';
declare class DataforgeError extends Error {
  readonly code: DataforgeErrorCode;
  /** 给模型看的可操作明细（missing 清单 / 建议动作）。 */
  readonly hints: string[];
  constructor(code: DataforgeErrorCode, message: string, hints?: string[]);
}
//#endregion
//#region src/shared/types.d.ts
/**
 * 共享词汇：流程元数据、NDJSON 事件、运行摘要。
 *
 * 与引擎侧 `dsh_bridge.py` 的事件契约一一对应：
 *   {event:'meta'|'step'|'terminal'|'result', ...}
 *
 * @module dsh-dataforge/shared/types
 */
/** 一个已发现流程（流程包里的一份 yaml）。 */
interface FlowInfo {
  /** 流程名（yaml 的 name；冲突时高优先级包赢）。 */
  name: string;
  /** 流程 yaml 绝对路径。 */
  flowPath: string;
  /** 包来源（builtin / dataRoot / workspace 的展示名）。 */
  pack: string;
  /** yaml description（可缺）。 */
  description?: string;
  /** 必填输入（闸 1 校验对象）。 */
  requiredFields: FlowField[];
  /** 可选输入。 */
  optionalFields: FlowField[];
}
interface FlowField {
  field: string;
  label: string;
}
/** dsh_bridge 吐出的 NDJSON 事件（弱类型透传：契约在 README）。 */
interface BridgeEvent {
  event: 'meta' | 'step' | 'terminal' | 'result';
  /** step 事件。 */
  id?: string;
  action?: string;
  status?: 'start' | 'done' | 'error';
  elapsed?: number;
  data?: Record<string, unknown>;
  error?: string;
  /** terminal 事件。 */
  name?: string;
  success?: boolean;
  message?: string;
  /** meta / result 事件共用。 */
  steps?: string[];
  dryRun?: boolean;
  /** result 事件。 */
  businessData?: Record<string, unknown>;
  [key: string]: unknown;
}
/** JSON 可序列化叶子（循环安全版 JsonValue）：businessData 只装业务标量/嵌套 JSON。 */
type JsonLike = string | number | boolean | null | JsonLike[] | {
  [key: string]: JsonLike;
};
/** dataforge_status 的投影：把事件流折成一张运行摘要。type 别名 == 有隐式索引签名（工具 schema 推断要求 Record 兼容；interface 会断言失败，勿改回）。 */
type RunSummary = {
  runId: string;
  flow: string;
  flowName: string;
  jobId?: string;
  startedAt: number;
  updatedAt: number;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'unknown';
  dryRun: boolean;
  totalSteps: number;
  stepsDone: number;
  lastStepId?: string;
  lastError?: string;
  success?: boolean;
  businessData?: Record<string, JsonLike>;
  /** 结束消息（terminal.message）。 */
  message?: string;
};
//#endregion
//#region src/flows/discover.d.ts
/** 插件可用的全部包根（顺序即优先级，先列后覆盖）。 */
interface PackRoots {
  /** 引擎 checkout（内置默认包：configs/）。 */
  builtinConfigsDir?: string;
  /** $DSH_HOME/storages/dsh-dataforge/flows。 */
  dataRootFlows?: string;
  /** 工作区 .dsh/dataforge/flows。 */
  workspaceFlows?: string;
}
interface DiscoveredFlows {
  flows: FlowInfo[];
  /** 每层包根是否存在（诊断诚实面）。 */
  packs: {
    builtin?: string;
    dataRoot?: string;
    workspace?: string;
  };
}
/**
 * 汇合并发：低优先级包先入册，同名流程被高优先级包覆盖（记录新 pack 来源）。
 * 多流程同名同包同理，先读到的行被同包后写覆盖。
 */
declare function discoverFlows(roots: PackRoots): DiscoveredFlows;
//#endregion
//#region src/runs/store.d.ts
/** 读一份运行事件；不存在返回 undefined。 */
declare function loadRunEvents(dataRoot: string, runId: string): BridgeEvent[] | undefined;
/**
 * 把事件流折叠成了 → 一张摘要（唯一投影规则）：
 * - meta 定 flow/steps/dryRun
 * - step.start 计入 lastStep；step.done 计入 stepsDone；step.error 计入 lastError
 * - terminal 贡献 message/success 兜底；result 是最终权威（businessData、success）
 * - 无 result 且无 terminal → running；overrideStatus 用于 cancel 场景标 killed
 */
declare function foldSummary(runId: string, events: BridgeEvent[], overrideStatus?: RunSummary['status']): RunSummary;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-dataforge";
/** 工具注册表必依赖；jobs / systemPrompt / workingDirectory 惰性解析。 */
declare const inject: string[];
/** 装载插件。 */
declare function apply(ctx: Context, rawConfig: Config): void;
//#endregion
export { Config, DataforgeError, apply, discoverFlows, foldSummary, inject, loadRunEvents, name, normalizeConfig };