import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import Database from "better-sqlite3";

//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.5/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Shared config references used by schema validators and plugin runtimes. */
const write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
	if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
	if (value === null || typeof value !== "object") return value;
	if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
	ancestors.add(value);
	try {
		if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
		if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
		return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
	} finally {
		ancestors.delete(value);
	}
}
/**
* Create a detached reference containing an immutable copy of the supplied data.
* @param value - validated config data; class instances and functions are unsupported.
* @returns a reference whose value is updated only by its owning runtime.
*/
function createVolatile(value) {
	let current = snapshot(value);
	return Object.freeze({
		get: () => current,
		[write]: (value) => {
			current = value;
		}
	});
}
/**
* Identify references across ESM/CJS copies of the shared library.
* @param value - a parsed config value.
* @returns whether the value implements the shared reference protocol.
*/
function isVolatile(value) {
	return typeof value === "object" && value !== null && write in value;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
/** Decode a base64 string into binary data. */
const base64ToArrayBuffer = Binary.fromBase64;
/** Encode binary data as base64. */
const arrayBufferToBase64 = Binary.toBase64;
/** Decode a hex string into binary data. */
const hexToArrayBuffer = Binary.fromHex;
/** Encode binary data as hex. */
const arrayBufferToHex = Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/**
* Compare values recursively, treating two volatile references as equal regardless of value.
* Strict comparison distinguishes null/undefined, treats opaque objects by identity,
* compares URLs by normalized href, treats array holes as undefined, and considers distinct cyclic structures unequal.
* @param a - first value.
* @param b - second value.
* @param strict - whether to require strict data equality outside volatile references.
* @returns whether the values compare equal.
*/
function deepEqual(a, b, strict) {
	const ancestors = /* @__PURE__ */ new Set();
	function compare(a, b) {
		if (a === b) return true;
		if (isVolatile(a) || isVolatile(b)) return isVolatile(a) && isVolatile(b);
		if (!strict && isNullable(a) && isNullable(b)) return true;
		if (typeof a !== typeof b || typeof a !== "object" || !a || !b) return false;
		if (ancestors.has(a)) return false;
		function check(test, then) {
			return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
		}
		ancestors.add(a);
		try {
			return check(Array.isArray, (a, b) => {
				if (a.length !== b.length) return false;
				for (let index = 0; index < a.length; index++) if (!compare(a[index], b[index])) return false;
				return true;
			}) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("URL"), (a, b) => a.href === b.href) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
				if (a.byteLength !== b.byteLength) return false;
				const viewA = new Uint8Array(a);
				const viewB = new Uint8Array(b);
				for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
				return true;
			}) ?? ((!strict || [a, b].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
				...a,
				...b
			}).every((key) => compare(a[key], b[key])));
		} finally {
			ancestors.delete(a);
		}
	}
	return compare(a, b);
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));

//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.4/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (isVolatile(value)) value = value.get();
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.volatile = function volatile() {
	if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
	return this.extra("volatile", true);
};
const resolvers = {};
const checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
	const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
	if (states.has(blocked)) return;
	states.add(blocked);
	seen.set(schema, states);
	if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
	const nested = blocked || !!schema.meta?.volatile;
	if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
	if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
	if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
	if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (!options[checkedVolatile]) {
		validateVolatileSchema(schema, options.path);
		options = {
			...options,
			[checkedVolatile]: true
		};
	}
	if (schema.meta?.volatile) {
		const inner = Schema(schema);
		inner.meta = {
			...schema.meta,
			volatile: false
		};
		const [value, adapted] = Schema.resolve(data, inner, options, strict);
		try {
			return [createVolatile(value), adapted];
		} catch (error) {
			throw new ValidationError(error instanceof Error ? error.message : String(error), options);
		}
	}
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
		validateVolatileSchema(schema.inner, options.path, true);
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));

//#endregion
//#region src/config.ts
/**
* 插件配置 schema（Schemastery 面向 cordis.yml）：
* 凡是不同部署可能取不同值的，都必须是配置字段——无默默兜底。
*
* @module dsh-dataforge/config
*/
const Config = Schema.object({
	engineRoot: Schema.string().required(),
	pythonBin: Schema.string().default("python3"),
	dataRoot: Schema.string().default(join(homedir(), ".dsh", "storages", "dsh-dataforge")),
	timeoutSeconds: Schema.number().default(600),
	injectPolicy: Schema.boolean().default(true),
	captureMaxDepth: Schema.number().default(3),
	captureMaxPages: Schema.number().default(50),
	captureStabilityWindowMs: Schema.number().default(1500),
	captureBodyLimitBytes: Schema.number().default(262144),
	captureChromeChannel: Schema.string().default("chrome")
});
/** 归一化（相对路径 → 绝对；~ 展开）。 */
function normalizeConfig(raw) {
	const expandHome = (p) => p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
	return {
		engineRoot: resolve(expandHome(raw.engineRoot)),
		pythonBin: raw.pythonBin,
		dataRoot: resolve(expandHome(raw.dataRoot)),
		timeoutSeconds: raw.timeoutSeconds,
		injectPolicy: raw.injectPolicy,
		captureMaxDepth: raw.captureMaxDepth,
		captureMaxPages: raw.captureMaxPages,
		captureStabilityWindowMs: raw.captureStabilityWindowMs,
		captureBodyLimitBytes: raw.captureBodyLimitBytes,
		captureChromeChannel: raw.captureChromeChannel
	};
}

//#endregion
//#region src/shared/errors.ts
var DataforgeError = class extends Error {
	code;
	/** 给模型看的可操作明细（missing 清单 / 建议动作）。 */
	hints;
	constructor(code, message, hints = []) {
		super(message);
		this.name = "DataforgeError";
		this.code = code;
		this.hints = hints;
	}
};

//#endregion
//#region src/engine/bridge.ts
/**
* 引擎桥：预检（python / 引擎 / dsh_bridge.py）+ 参数构造 + NDJSON 事件解析。
*
* 契约（引擎侧 `dsh_bridge.py`）：
*   stdout = 纯 NDJSON 事件流（meta/step/terminal/result）
*   stderr = 引擎人类可读输出
*   exit 0 = 命中 SUCCESS terminal
*
* 凭证零经手：python 进程继承宿主 env；引擎自己在 checkout 里加载 .env。
*
* @module dsh-dataforge/engine/bridge
*/
/** 解析引擎运行面：engineRoot / dsh_bridge.py / pythonBin 三件套。 */
function resolveEngineLocators(engineRoot, pythonBin) {
	const reasons = [];
	const root = engineRoot.trim();
	if (!root) reasons.push("config.engineRoot 未配置（指向引擎流程包 checkout 的绝对路径）");
	else if (!existsSync(root)) reasons.push(`engineRoot 不存在: ${root}`);
	else if (!existsSync(join(root, "dsh_bridge.py"))) reasons.push(`引擎 checkout 缺 dsh_bridge.py: ${join(root, "dsh_bridge.py")}`);
	return {
		ok: reasons.length === 0,
		...reasons.length === 0 ? {
			engineRoot: root,
			bridgePath: join(root, "dsh_bridge.py")
		} : {},
		reasons
	};
}
/** pythonBin 可执行性探测（`pythonBin --version` 起得来即算可用）。 */
async function probePython(pythonBin) {
	return new Promise((resolve) => {
		const child = spawn(pythonBin, ["--version"], { stdio: "ignore" });
		child.on("error", () => resolve([`pythonBin 不可用: ${pythonBin}`]));
		child.on("exit", (code) => resolve(code === 0 ? [] : [`pythonBin 退出码异常: ${pythonBin}（${code}）`]));
	});
}
/** 组装桥 argv（参数风格 = engine.py：--key value，materials 单键归并由桥完成）。 */
function buildBridgeArgv(locators, flowPath, params, dryRun) {
	if (!locators.ok || locators.bridgePath === void 0) throw new Error(`引擎定位未就绪：${locators.reasons.join("；")}`);
	const argv = [locators.bridgePath, flowPath];
	if (dryRun) argv.push("--dry-run");
	for (const [key, value] of Object.entries(params)) {
		if (value === void 0 || value === null || value === "") continue;
		argv.push(`--${key}`, typeof value === "string" ? value : JSON.stringify(value));
	}
	return argv;
}
/**
* 起桥进程：
* - stdout 按行解析为事件（buffer 处理半行）
* - stderr 只保留尾部 4000 字符（收局诊断）
*/
function spawnBridge(pythonBin, argv, engineRoot, timeoutMs) {
	const child = spawn(pythonBin, argv, {
		cwd: engineRoot,
		env: process.env,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		]
	});
	const listeners = [];
	let buffer = "";
	let stderrTail = "";
	let exited = false;
	const onTap = (chunk) => {
		buffer += chunk.toString("utf8");
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const event = JSON.parse(trimmed);
				for (const listener of listeners) try {
					listener(event);
				} catch {}
			} catch {}
		}
	};
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk) => onTap(Buffer.from(chunk, "utf8")));
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderrTail = (stderrTail + chunk).slice(-4e3);
	});
	return {
		child,
		onEvent(listener) {
			listeners.push(listener);
		},
		getStderrTail: () => stderrTail,
		exitCode: new Promise((resolve) => {
			child.on("exit", (code) => {
				exited = true;
				resolve(code ?? -1);
			});
			child.on("error", () => {
				if (!exited) resolve(-1);
			});
		}),
		kill(reason) {
			if (child.exitCode !== null || exited) return;
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 2e3).unref?.();
		}
	};
}
/** 抽取最后一条 result 事件。 */
function lastResult(events) {
	for (let i = events.length - 1; i >= 0; i -= 1) if (events[i].event === "result") return events[i];
}

//#endregion
//#region src/flows/discover.ts
/**
* 流程包发现（Flow Pack Discovery）。
*
* 三层来源（后写赢，同名流程高优先级包覆盖低优先级包）：
*   1. builtin —— 引擎 checkout 自带的 configs/*.yaml（DataForge 流程包）
*   2. dataRoot —— $DSH_HOME/storages/dsh-dataforge/flows/*.yaml（用户第三方包）
*   3. workspace —— <工作区>/.dsh/dataforge/flows/*.yaml（项目自带，权威）
*
* 热重载：每次 flows() 现场扫盘读 mtime（目录级廉价操作），改文件即生效，
* 不需要重启宿主——对齐 dsh-file-enhance 的「文件是唯一权威」哲学。
*
* @module dsh-dataforge/flows/discover
*/
const YAML_RE = /\.ya?ml$/;
/** 平铺读一个包目录下的流程 yaml（绝对路径）。 */
function readFlowsFromDir(dir, pack) {
	if (!existsSync(dir)) return [];
	const flows = [];
	for (const entry of readdirSync(dir)) {
		if (!YAML_RE.test(entry)) continue;
		const info = readFlowYaml(join(dir, entry), pack);
		if (info) flows.push(info);
	}
	return flows;
}
/** 读单份流程 yaml；解析失败（坏 yaml）跳过不炸——包是用户手写的。 */
function readFlowYaml(flowPath, pack) {
	try {
		if (!statSync(flowPath).isFile()) return void 0;
		const doc = yaml.load(readFileSync(flowPath, "utf8"));
		if (doc === null || typeof doc !== "object") return void 0;
		const name = typeof doc["name"] === "string" ? doc["name"] : basename(flowPath, ".yaml");
		const { required, optional } = splitInputs(doc["inputs"] ?? {});
		return {
			name,
			flowPath,
			pack,
			description: typeof doc["description"] === "string" ? doc["description"] : void 0,
			requiredFields: required,
			optionalFields: optional
		};
	} catch {
		return;
	}
}
function splitInputs(inputs) {
	const required = [];
	const optional = [];
	for (const [field, def] of Object.entries(inputs ?? {})) {
		if (def === null || typeof def !== "object") continue;
		const entry = {
			field,
			label: typeof def["label"] === "string" ? def["label"] : field
		};
		if (def["required"] === true) required.push(entry);
		else optional.push(entry);
	}
	return {
		required,
		optional
	};
}
/**
* 汇合并发：低优先级包先入册，同名流程被高优先级包覆盖（记录新 pack 来源）。
* 多流程同名同包同理，先读到的行被同包后写覆盖。
*/
function discoverFlows(roots) {
	const byName = /* @__PURE__ */ new Map();
	const layers = [
		["builtinConfigsDir", roots.builtinConfigsDir],
		["dataRootFlows", roots.dataRootFlows],
		["workspaceFlows", roots.workspaceFlows]
	];
	for (const [layer, dir] of layers) {
		if (!dir) continue;
		for (const flow of readFlowsFromDir(dir, layer)) byName.set(flow.name, flow);
	}
	return {
		flows: [...byName.values()],
		packs: {
			...roots.builtinConfigsDir === void 0 ? {} : { builtin: roots.builtinConfigsDir },
			...roots.dataRootFlows === void 0 ? {} : { dataRoot: roots.dataRootFlows },
			...roots.workspaceFlows === void 0 ? {} : { workspace: roots.workspaceFlows }
		}
	};
}
/** 按名字取流程：找不到抛 FLOW_NOT_FOUND（工具壳转诚实回执）。 */
function pickFlow(discovered, name) {
	const flow = discovered.flows.find((f) => f.name === name);
	if (!flow) {
		const names = discovered.flows.map((f) => f.name).slice(0, 10).join(", ");
		throw Object.assign(/* @__PURE__ */ new Error(`流程「${name}」不存在于任何流程包`), {
			code: "FLOW_NOT_FOUND",
			hints: [`可用流程：${names}${discovered.flows.length > 10 ? " …" : ""}`]
		});
	}
	return flow;
}

//#endregion
//#region src/runs/store.ts
/**
* 运行留痕：runId 落盘 + 事件追加 + 摘要折叠。
*
* 所有运行事件都写在 dataRoot/runs/<runId>/events.ndjson ——
* 状态查询与重启后回看都只认这张盘（flush at write-time）。
*
* @module dsh-dataforge/runs/store
*/
function runsRoot(dataRoot) {
	return join(dataRoot, "runs");
}
/** 新建 run 目录并写 run.json 元数据；返回 run 目录绝对路径。 */
function startRunRecord(dataRoot, runId, meta) {
	const dir = join(runsRoot(dataRoot), runId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "run.json"), JSON.stringify({
		runId,
		...meta
	}, null, 2), "utf8");
	return dir;
}
/** 事件即写即落盘：后台 job 推流与 status 工具共用的唯一事实源。 */
function appendEvent(dataRoot, runId, event) {
	const stored = {
		...event,
		ts: Date.now()
	};
	appendFileSync(join(runsRoot(dataRoot), runId, "events.ndjson"), `${JSON.stringify(stored)}\n`, "utf8");
}
/** 读一份运行事件；不存在返回 undefined。 */
function loadRunEvents(dataRoot, runId) {
	const path = join(runsRoot(dataRoot), runId, "events.ndjson");
	if (!existsSync(path)) return void 0;
	const events = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			events.push(JSON.parse(trimmed));
		} catch {}
	}
	return events;
}
/** 列已留痕的 runId（按目录名倒序，最近在前），上限 limit。 */
function listRunIds(dataRoot, limit = 20) {
	const root = runsRoot(dataRoot);
	if (!existsSync(root)) return [];
	return readdirSync(root).filter((entry) => {
		try {
			return statSync(join(root, entry)).isDirectory();
		} catch {
			return false;
		}
	}).sort().reverse().slice(0, limit);
}
/**
* 把事件流折叠成了 → 一张摘要（唯一投影规则）：
* - meta 定 flow/steps/dryRun
* - step.start 计入 lastStep；step.done 计入 stepsDone；step.error 计入 lastError
* - terminal 贡献 message/success 兜底；result 是最终权威（businessData、success）
* - 无 result 且无 terminal → running；overrideStatus 用于 cancel 场景标 killed
*/
function foldSummary(runId, events, overrideStatus) {
	const meta = events.find((e) => e.event === "meta");
	let stepsDone = 0;
	let lastStepId;
	let lastError;
	let terminalMessage;
	let terminalSuccess;
	let result;
	for (const e of events) if (e.event === "step") {
		if (e.status === "start") lastStepId = e.id;
		else if (e.status === "done") stepsDone += 1;
		else if (e.status === "error") {
			lastError = e.error;
			lastStepId = e.id;
		}
	} else if (e.event === "terminal") {
		terminalMessage = e.message;
		terminalSuccess = e.success;
	} else if (e.event === "result") result = e;
	const success = result?.success ?? terminalSuccess;
	let status;
	if (overrideStatus !== void 0) status = overrideStatus;
	else if (result === void 0 && terminalMessage === void 0) status = "running";
	else if (success === true) status = "completed";
	else status = "failed";
	const firstTs = numOrUndefined(events[0]?.ts);
	const lastTs = numOrUndefined(events[events.length - 1]?.ts);
	const bizData = plainRecord(result?.businessData);
	return {
		runId,
		flow: typeof meta?.flow === "string" ? meta.flow : "",
		flowName: typeof meta?.name === "string" ? meta.name : "",
		startedAt: firstTs ?? 0,
		updatedAt: lastTs ?? firstTs ?? 0,
		status,
		dryRun: meta?.dryRun === true,
		totalSteps: Array.isArray(meta?.steps) ? meta.steps.length : 0,
		stepsDone,
		...lastStepId === void 0 ? {} : { lastStepId },
		...lastError === void 0 ? {} : { lastError },
		...success === void 0 ? {} : { success },
		...bizData === void 0 ? {} : { businessData: bizData },
		...terminalMessage === void 0 ? {} : { message: terminalMessage }
	};
}
function numOrUndefined(value) {
	return typeof value === "number" ? value : void 0;
}
/** 非 plain object（数组/缺失）一律 undefined。 */
function plainRecord(value) {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
}

//#endregion
//#region src/application.ts
/**
* application 层：数据面装配 + 三道闸判据 + 运行编排。
*
* 工具壳（tools.ts）只做参数声明与回执渲染；所有判定在这里，保持纯本地逻辑、可单测。
*
* @module dsh-dataforge/application
*/
function buildDataforgeDeps(init) {
	const deps = {
		...init,
		discover: async (exec) => discoverFor(deps, exec),
		startRun: (d, exec, args) => runFlow(d, exec, args)
	};
	return deps;
}
/** 包根构建：builtin=引擎 configs；dataRoot=全局三方包；workspace=工作区包（权威覆盖）。 */
async function discoverFor(deps, exec) {
	const wsRoot = await deps.resolveWorkspaceRoot(exec);
	const roots = {
		builtinConfigsDir: `${deps.config.engineRoot}/configs`,
		dataRootFlows: `${deps.config.dataRoot}/flows`,
		...wsRoot === void 0 ? {} : { workspaceFlows: `${wsRoot}/.dsh/dataforge/flows` }
	};
	return discoverFlows(roots);
}
async function listFlows(deps, exec) {
	const { flows, packs } = await discoverFor(deps, exec);
	return {
		packs,
		flows: flows.map((f) => ({
			name: f.name,
			pack: f.pack,
			flowPath: f.flowPath,
			...f.description === void 0 ? {} : { description: f.description },
			required: f.requiredFields,
			optional: f.optionalFields
		}))
	};
}
/** 闸 1：必填校验（参数 present = 非空字符串/数字/对象）。 */
function missingFields(flow, params) {
	return flow.requiredFields.filter(({ field }) => {
		const value = params[field];
		return value === void 0 || value === null || value === "" || typeof value === "object" && Object.keys(value).length === 0;
	});
}
/** 闸 2：参数确认卡（人类可读，模型原样转述）。 */
function buildConfirmationCard(flow, params, dryRun, missing) {
	const rows = [["流程", `${flow.name}（${flow.pack}）`]];
	for (const { field, label } of [...flow.requiredFields, ...flow.optionalFields]) if (params[field] !== void 0) rows.push([label || field, JSON.stringify(params[field])]);
	const width = Math.max(...rows.map(([k]) => k.length));
	const table = rows.map(([k, v]) => `  ${k.padEnd(width)}  │  ${v}`).join("\n");
	const missingLine = missing.length === 0 ? "" : `\n  ⚠️ 仍缺必填（确认后仍无法启动，请先补齐）: ${missing.map((m) => m.label).join("、")}`;
	return [
		`📋 参数确认卡${dryRun ? "（dry-run）" : ""}`,
		table,
		missingLine,
		"请用户回复「确认」后再以 confirm=true 调用 dataforge_run。"
	].filter(Boolean).join("\n");
}
/** 预检（引擎三件套）。 */
async function preflight(deps) {
	const locals = resolveEngineLocators(deps.config.engineRoot, deps.config.pythonBin);
	if (!locals.ok) return locals.reasons;
	return probePython(deps.config.pythonBin);
}
/** 运行编排：闸1 → 闸2 → preflight → 后台 job / 前台降级。 */
async function runFlow(deps, exec, args) {
	const discovered = await discoverFor(deps, exec);
	const flow = pickFlow(discovered, args.flow);
	const params = args.params ?? {};
	const dryRun = args.dryRun === true;
	const missing = missingFields(flow, params);
	if (missing.length > 0) return {
		accepted: false,
		gate: "missing-fields",
		missing,
		card: `❌ 必填参数缺失：${missing.map((m) => `${m.label}（${m.field}）`).join("、")}\n${buildConfirmationCard(flow, params, dryRun, missing)}`
	};
	if (args.confirm !== true) return {
		accepted: false,
		gate: "confirm-required",
		card: buildConfirmationCard(flow, params, dryRun, missing)
	};
	const reasons = await preflight(deps);
	if (reasons.length > 0) return {
		accepted: false,
		gate: "preflight-failed",
		card: `❌ 引擎预检失败：\n  ${reasons.join("\n  ")}`
	};
	return startRunJob(deps, exec, flow, params, dryRun);
}
function runIdOf(flow, now) {
	return `${flow}-${now}`;
}
/** 把一次 spawn 抽象出来（测试注入 fake runner）。 */
function spawnRunner(deps, argv) {
	const spawned = spawnBridge(deps.config.pythonBin, argv, deps.config.engineRoot, deps.config.timeoutSeconds * 1e3);
	return {
		argv,
		onEvent: spawned.onEvent,
		getStderrTail: spawned.getStderrTail,
		exitCode: spawned.exitCode,
		kill: (reason) => spawned.kill(reason)
	};
}
/** 启动运行：优先后台 job；jobs 不在场 → 前台降级（degradedNotice 如实标注）。 */
async function startRunJob(deps, exec, flow, params, dryRun) {
	const argv = buildBridgeArgv(resolveEngineLocators(deps.config.engineRoot, deps.config.pythonBin), flow.flowPath, params, dryRun);
	const runId = runIdOf(flow.flowPath.split("/").pop()?.replace(/\.ya?ml$/, "") ?? "flow", Date.now());
	const runDir = startRunRecord(deps.config.dataRoot, runId, {
		flow: flow.name,
		flowPath: flow.flowPath,
		pack: flow.pack,
		params,
		dryRun,
		startedAt: Date.now()
	});
	const events = [];
	const runner = spawnRunner(deps, argv);
	runner.onEvent((event) => {
		events.push(event);
		appendEvent(deps.config.dataRoot, runId, event);
	});
	const jobs = deps.resolveJobs();
	if (jobs !== void 0 && typeof jobs.start === "function") {
		const spec = {
			kind: "dataforge",
			label: `${flow.name}${dryRun ? "（dry-run）" : ""}`,
			owner: ownerOf(exec),
			outputLimitBytes: 65536,
			run(job) {
				return {
					cancel: (reason) => {
						runner.kill(reason ?? "dataforge job killed");
					},
					done: runner.exitCode.then((code) => {
						const result = lastResult(events);
						const success = result?.success === true;
						const summary = foldSummary(runId, events);
						const detail = (result?.message ?? (success ? "造数完成" : `退出码 ${code}`)) + (success ? "" : tailOf(runner.getStderrTail()));
						return {
							status: success ? "completed" : "failed",
							detail,
							result: JSON.stringify(summary)
						};
					})
				};
			}
		};
		return {
			accepted: true,
			gate: "started",
			kind: "background",
			jobId: extractJobId(jobs.start(spec)),
			runId,
			runDir
		};
	}
	const timeoutTimer = setTimeout(() => runner.kill(`前台执行超时（${deps.config.timeoutSeconds}s）`), deps.config.timeoutSeconds * 1e3);
	timeoutTimer.unref?.();
	await runner.exitCode;
	clearTimeout(timeoutTimer);
	const summary = foldSummary(runId, events);
	const resultEvent = lastResult(events);
	return {
		accepted: true,
		gate: "started",
		kind: "foreground",
		runId,
		runDir,
		degradedNotice: "宿主未装配 dsh-jobs：本次前台执行（建议部署 @deepseek-ai/dsh-jobs + @deepseek-ai/dsh-tool-jobs 以解锁后台运行）",
		summary: {
			...summary,
			status: resultEvent?.success === true ? "completed" : "failed"
		}
	};
}
function ownerOf(exec) {
	const id = exec?.agent?.id;
	return typeof id === "string" && id.length > 0 ? id : void 0;
}
function extractJobId(started) {
	const id = started?.id;
	return typeof id === "string" ? id : void 0;
}
function tailOf(stderrTail) {
	const tail = stderrTail.trim().split("\n").slice(-2).filter(Boolean).join(" | ");
	return tail ? `\n  stderr 尾部: ${tail}` : "";
}
/** 单查或列最近运行（runId 缺省 = 最近 10 条）。 */
function runStatus(deps, runId) {
	const { dataRoot } = deps.config;
	if (runId !== void 0) {
		const events = loadRunEvents(dataRoot, runId);
		if (events === void 0 || events.length === 0) return {
			ok: false,
			notice: `运行「${runId}」无留痕（runId 不存在或 run 尚未写下事件）`
		};
		return {
			ok: true,
			run: foldSummary(runId, events)
		};
	}
	const runs = listRunIds(dataRoot, 10).map((id) => {
		const events = loadRunEvents(dataRoot, id);
		return events === void 0 || events.length === 0 ? void 0 : foldSummary(id, events);
	}).filter((s) => s !== void 0);
	return {
		ok: true,
		runs,
		...runs.length === 0 ? { notice: "暂无运行留痕" } : {}
	};
}

//#endregion
//#region src/capture/normalizer.ts
/** 每次必变不参与归并与模板比对的 query 键。 */
const VOLATILE = /* @__PURE__ */ new Set([
	"sid",
	"ts",
	"t",
	"token",
	"nonce",
	"cb",
	"callback",
	"rsv_t",
	"rsv_pq"
]);
const SEGMENT_PARAM = /\/(?:\d+|[a-f0-9][a-f0-9-]{19,})(?=\/|$)/gi;
function normalizeUrlForTemplate(rawUrl) {
	const u = new URL(rawUrl, "http://capture.local");
	const seen = /* @__PURE__ */ new Map();
	for (const [k, v] of u.searchParams.entries()) {
		if (VOLATILE.has(k)) continue;
		if (!seen.has(k)) seen.set(k, v);
	}
	const path = u.pathname.replace(SEGMENT_PARAM, "/{p}");
	const query = sortedParamsToString([...seen.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
	return { urlTemplate: query === "" ? path : `${path}:${query}` };
}
function sortedParamsToString(pairs) {
	return pairs.map(([k, v]) => v === "" ? k : `${k}=${v}`).join("&");
}
/** 归并键：值不入键（键集合排序），同接口跨参数值变化可归并。 */
function mergeKeyOf(method, urlTemplate) {
	const colon = urlTemplate.lastIndexOf(":");
	if (colon === -1) return `${method} ${urlTemplate}`;
	return `${method} ${urlTemplate.slice(0, colon)}:${urlTemplate.slice(colon + 1).split("&").map((kv) => kv.split("=")[0]).sort().join(",")}`;
}
const LINK_RE = /href\s*=\s*["']([^"'#]+)["']/gi;
/** 同上但不做 host 过滤——crawler 调用方自持 host 过滤并统计被跳过的外域。 */
function extractAllLinks(html, baseUrl) {
	const out = /* @__PURE__ */ new Set();
	let match;
	while ((match = LINK_RE.exec(html)) !== null) try {
		const u = new URL(match[1], baseUrl);
		if (u.protocol.startsWith("http")) out.add(u.href);
	} catch {}
	return [...out];
}
/** 站点归并域：host（协议差异不出域，https/http 视为同站点）。 */
function captureHost(url) {
	return new URL(url).host;
}
const MAX_TEMPLATE_DEPTH = 2;
const SAMPLE_MAX = 120;
function jsonToTemplate(body) {
	const fields = [];
	const walk = (obj, prefix, depth) => {
		for (const [key, value] of Object.entries(obj)) {
			const field = prefix === "" ? key : `${prefix}.${key}`;
			if (value !== null && typeof value === "object" && !Array.isArray(value)) {
				if (depth < MAX_TEMPLATE_DEPTH) walk(value, field, depth + 1);
				continue;
			}
			if (Array.isArray(value)) {
				const first = value[0];
				if (depth < MAX_TEMPLATE_DEPTH && first !== null && typeof first === "object" && !Array.isArray(first)) walk(first, `${field}[]`, depth + 1);
				continue;
			}
			fields.push({
				field,
				type: value === null ? "null" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
				sample: value === null ? "null" : String(value).slice(0, SAMPLE_MAX),
				role: "constant",
				unverified: true
			});
		}
	};
	walk(body, "", 0);
	const hasCode = fields.find((f) => f.field === "code");
	const hasErrNo = fields.find((f) => f.field === "err_no");
	const codePath = hasCode !== void 0 ? "code" : hasErrNo !== void 0 ? "err_no" : void 0;
	return {
		fields,
		...codePath === void 0 ? {} : { codePath }
	};
}

//#endregion
//#region src/capture/crawler.ts
/**
* site_crawl BFS driver：同域逐页采集与链接发现。
*
* 登录会话由调用方先就绪（application 层先 open 会话再委托抓取）；
* 这里只做 BFS 队列调度、同 host 过滤、深度/页数截断与诚实标注。
*
* @module dsh-dataforge/capture/crawler
*/
/** site_crawl BFS：登录会话由调用方先就绪；这里只做同域逐页采集与链接发现。 */
async function crawlSite(o) {
	const visited = /* @__PURE__ */ new Set();
	const queued = /* @__PURE__ */ new Set([o.entryUrl]);
	const queue = [{
		url: o.entryUrl,
		depth: 0
	}];
	let externalSkipped = 0;
	const errors = [];
	while (queue.length > 0 && visited.size < o.maxPages) {
		const { url, depth } = queue.shift();
		if (visited.has(url) || depth > o.maxDepth) continue;
		visited.add(url);
		try {
			const { html } = await o.driver.openPage(url);
			o.onEvent({
				kind: "page",
				url
			});
			for (const link of extractAllLinks(html, url)) {
				if (visited.has(link) || queued.has(link)) continue;
				if (captureHost(link) !== o.ownHost) {
					externalSkipped += 1;
					o.onEvent({
						kind: "skip",
						url: link,
						detail: "external host"
					});
					continue;
				}
				if (visited.size + queue.length >= o.maxPages || depth + 1 > o.maxDepth) continue;
				queued.add(link);
				queue.push({
					url: link,
					depth: depth + 1
				});
			}
		} catch (err) {
			const msg = err?.message?.slice(0, 200) ?? "unknown error";
			errors.push(msg);
			o.onEvent({
				kind: "error",
				url,
				detail: msg
			});
		}
	}
	await o.driver.close().catch(() => void 0);
	return {
		pagesVisited: visited.size,
		externalSkipped,
		truncated: queue.length > 0 || visited.size >= o.maxPages,
		errors
	};
}

//#endregion
//#region src/capture/browser.ts
const SAMPLE_THRESHOLD = 1e4;
/** wire→store 输入：小体量 JSON 才读全量；超限标 truncated 不挂预览。 */
function responseToRawSample(wire, bodyLimit) {
	const body = wire.responseText;
	const oversized = body !== void 0 && Buffer.byteLength(body) > bodyLimit;
	return {
		url: wire.url,
		method: wire.method,
		status: wire.status,
		requestHeaders: wire.requestHeaders,
		requestBody: wire.requestPostData === void 0 || Buffer.byteLength(wire.requestPostData) > SAMPLE_THRESHOLD ? void 0 : wire.requestPostData,
		responseBody: body === void 0 || oversized ? void 0 : body,
		truncated: oversized
	};
}
/**
* 起一次会话：无头 chrome（channel: 'chrome' 系统浏览器）
* + 旁路 CDP response 流（只收 xhr/fetch，静态资源全滤）。
* 页面与 context 由 openCapturingPage 拥有，close 也由它交付（SessionRegistry 调 close）。
*/
async function openCapturingPage(channel, onWireSample) {
	const { chromium } = await import("playwright-core");
	const browser = await chromium.launch({
		channel,
		headless: true,
		args: ["--disable-blink-features=AutomationControlled"]
	});
	const context = await browser.newContext();
	const page = await context.newPage();
	page.on("response", (response) => {
		(async () => {
			const request = response.request();
			const resourceType = request.resourceType();
			if (resourceType !== "xhr" && resourceType !== "fetch") return;
			let responseText;
			const contentType = response.headers()["content-type"] ?? "";
			let status;
			let method = request.method();
			let url = request.url();
			try {
				status = response.status();
				url = response.url();
				if (contentType.includes("json") || contentType.includes("javascript")) responseText = await response.text();
			} catch {
				responseText = void 0;
			}
			try {
				method = request.method();
				const postRaw = resourceType === "fetch" ? request.postData() : null;
				onWireSample({
					url,
					method,
					status,
					resourceType,
					contentType,
					requestHeaders: request.headers(),
					requestPostData: postRaw === null ? void 0 : postRaw,
					responseText,
					pageUrl: page.url(),
					ts: Date.now()
				});
			} catch {}
		})().catch(() => void 0);
	});
	return {
		browser,
		context,
		page
	};
}

//#endregion
//#region src/capture/application.ts
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
function jsonTemplateOf(body) {
	if (typeof body !== "string" || body.trim().startsWith("{") === false) return void 0;
	try {
		const parsed = JSON.parse(body);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
		return jsonToTemplate(parsed);
	} catch {
		return;
	}
}
async function startCapture(deps, args) {
	const { taskType, entryUrl } = args;
	let entry;
	try {
		entry = new URL(entryUrl);
	} catch {
		return {
			accepted: false,
			gate: "bad-url",
			card: `❌ entryUrl 不是合法 URL：${entryUrl}`
		};
	}
	if (taskType !== "single_page" && taskType !== "site_crawl" && taskType !== "action") return {
		accepted: false,
		gate: "bad-task",
		card: `❌ taskType 非法：${String(taskType)}（可选 single_page/site_crawl/action）`
	};
	const captureId = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	if (taskType === "action") {
		if (args.confirm !== true) return {
			accepted: false,
			gate: "action-confirm-required",
			card: `⚠️ action 任务将对 ${entry.host} 执行真实 UI 写操作（提交/创建类）。请用户确认后以 confirm=true 重调。`
		};
		deps.store.upsertRun({
			id: captureId,
			taskType,
			entryUrl,
			status: "running",
			startedAt: Date.now(),
			stats: {
				pages: 0,
				requests: 0,
				cards: 0,
				credentials: 0
			}
		});
		const { sessionId } = await deps.registry.open({
			entryUrl,
			captureId
		});
		return {
			accepted: true,
			gate: "started",
			captureId,
			sessionId
		};
	}
	deps.store.upsertRun({
		id: captureId,
		taskType,
		entryUrl,
		status: "running",
		startedAt: Date.now(),
		stats: {
			pages: 0,
			requests: 0,
			cards: 0,
			credentials: 0
		}
	});
	const jobs = deps.resolveJobs();
	const spec = {
		kind: "dataforge-capture",
		label: `capture ${taskType} ${entry.host}`,
		run: makeAutonomousRun(deps, captureId, taskType, entry, args)
	};
	return {
		accepted: true,
		gate: "started",
		captureId,
		...jobs?.start?.(spec) === void 0 ? {} : {}
	};
}
function makeAutonomousRun(deps, captureId, taskType, entry, args) {
	return (job) => {
		let browserClosed = false;
		let closeBrowser;
		return {
			cancel: (reason) => {
				browserClosed = true;
				(async () => {
					await closeBrowser?.();
				})();
				job.append(`capture cancel: ${reason ?? "user requested"}`);
			},
			done: (async () => {
				try {
					const pageUrls = /* @__PURE__ */ new Map();
					const onWire = (w) => {
						const raw = responseToRawSample(w, deps.config.captureBodyLimitBytes);
						if (raw === void 0) return;
						deps.store.upsertSample(captureId, void 0, {
							...raw,
							responseHeaders: { "content-type": w.contentType },
							pageUrl: w.pageUrl,
							ts: w.ts,
							bodyLimit: deps.config.captureBodyLimitBytes
						});
						const urlTemplate = normalizeUrlForTemplate(raw.url).urlTemplate;
						const mergeKey = mergeKeyOf(raw.method, urlTemplate);
						const pages = pageUrls.get(mergeKey) ?? /* @__PURE__ */ new Set();
						pages.add(w.pageUrl);
						pageUrls.set(mergeKey, pages);
						const requestTemplate = raw.truncated ? void 0 : jsonTemplateOf(raw.requestBody);
						const responseTemplate = raw.truncated ? void 0 : jsonTemplateOf(raw.responseBody);
						deps.store.upsertCard(captureId, {
							mergeKey,
							method: raw.method,
							urlTemplate,
							relatedPageUrls: [...pages],
							...requestTemplate === void 0 ? {} : { requestTemplate },
							...responseTemplate === void 0 ? {} : { responseTemplate }
						});
					};
					const { page, context, browser } = await deps.openCapturingPage(deps.config.captureChromeChannel, onWire);
					closeBrowser = async () => {
						await browser.close().catch(() => void 0);
					};
					if (taskType === "single_page") {
						await page.goto(entry.href, {
							waitUntil: "domcontentloaded",
							timeout: 3e4
						});
						await page.waitForLoadState("networkidle", { timeout: Math.max(deps.config.captureStabilityWindowMs, 8e3) }).catch(() => void 0);
					} else {
						job.updateProgress("crawl-start");
						const r = await crawlSite({
							entryUrl: entry.href,
							driver: {
								openPage: async (url) => {
									await page.goto(url, {
										waitUntil: "domcontentloaded",
										timeout: 3e4
									});
									await sleep(deps.config.captureStabilityWindowMs);
									return {
										pageId: "",
										html: await page.content(),
										sampleCount: deps.store.countSamples(captureId)
									};
								},
								close: async () => {
									await closeBrowser?.();
								}
							},
							ownHost: entry.host,
							maxDepth: args.maxDepth ?? deps.config.captureMaxDepth,
							maxPages: args.maxPages ?? deps.config.captureMaxPages,
							stabilityMs: deps.config.captureStabilityWindowMs,
							onEvent: (e) => {
								if (e.kind === "page") deps.store.upsertPage(captureId, e.url, 0, "ok");
							},
							onSample: () => void 0
						});
						job.updateProgress(`crawl-end pages=${r.pagesVisited} truncated=${r.truncated}`);
					}
					if (browserClosed) return { status: "killed" };
					for (const c of await context.cookies()) deps.store.upsertCredential(captureId, "cookie", String(c["domain"] ?? ""), String(c["name"] ?? ""), Date.now(), c);
					deps.store.finishRun(captureId, "done", void 0);
					return {
						status: "completed",
						detail: `capture ${captureId} 完成`
					};
				} catch (err) {
					const msg = err?.message?.slice(0, 400) ?? "unknown error";
					deps.store.finishRun(captureId, "failed", msg);
					return {
						status: "failed",
						detail: msg
					};
				}
			})()
		};
	};
}
function captureStatus(deps, captureId) {
	if (captureId !== void 0) {
		const run = deps.store.getRun(captureId);
		if (run === void 0) return {
			ok: false,
			notice: `captureId ${captureId} 无记录`
		};
		return {
			ok: true,
			run
		};
	}
	return {
		ok: true,
		runs: deps.store.listRuns(10)
	};
}
function captureResult(deps, captureId, scope, limit = 50) {
	const labels = {
		cards: "卡片",
		samples: "样本",
		credentials: "凭证",
		pages: "页面"
	};
	if (deps.store.getRun(captureId) === void 0) return {
		ok: false,
		notice: `captureId ${captureId} 无记录`
	};
	const items = scope === "cards" ? deps.store.listCards(captureId, limit) : scope === "samples" ? deps.store.listSamples(captureId, limit) : scope === "credentials" ? deps.store.listCredentials(captureId, limit) : deps.store.listPages(captureId, limit);
	return items.length === 0 ? {
		ok: true,
		notice: `captureId ${captureId} 的${labels[scope]}暂无记录`
	} : {
		ok: true,
		items
	};
}
function captureCancel(deps, captureId) {
	if (deps.store.getRun(captureId) === void 0) return {
		ok: false,
		notice: `captureId ${captureId} 无记录`
	};
	deps.store.finishRun(captureId, "cancelled");
	return {
		ok: true,
		status: "cancelled"
	};
}

//#endregion
//#region src/tools.ts
/**
* 三个工具壳：参数声明 / 规范值 / 回执渲染；判定全在 application 层。
*
* 对齐官方「工具编写参考」硬规则：
*   - parameters 由 defineTool 校验；execute 返回规范 JSON 值；
*   - output.render 只产模型可见的一小段自然语言，让模型从结果里找业务单号；
*   - 确认卡（闸2）/ 缺参清单（闸1）走 card 字段进模型结果。
*
* @module dsh-dataforge/tools
*/
/** 渲染边界单向收紧：进 render 的值已被 defineTool 按 schema 运行时校验，只是 TS 推断偏松。 */
function tighten(value) {
	return value;
}
function renderFlows(value) {
	if (value.flows.length === 0) return `📂 未发现任何流程。包根：engineRoot/configs、dataRoot/flows、工作区 .dsh/dataforge/flows。`;
	const lines = value.flows.map((f) => {
		const req = f.required.map((r) => r.label).join("、");
		return `- ${f.name}（${f.pack}）${f.description ? `：${f.description}` : ""}${req ? `；必填：${req}` : ""}`;
	});
	return `📚 可用流程 ${value.flows.length} 个：\n${lines.join("\n")}`;
}
function defineFlowsTool(deps) {
	return defineTool({
		name: "dataforge_flows",
		description: `列出可运行的造数流程（声明式流程包）。

选择规则：
- 先调本工具看有哪些流程与各自的必填参数；禁止凭记忆猜流程名。
- 每个流程的 required 字段就是「闸1 必填校验」的清单：缺任何一项都会被拒绝启动。

失败时：
- 空列表 → 配置的流程包根（engineRoot/configs、dataRoot/flows、工作区 .dsh/dataforge/flows）都没有 yaml。`,
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					flows: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: { type: "string" },
								pack: { type: "string" },
								flowPath: { type: "string" },
								description: { type: "string" },
								required: {
									type: "array",
									items: {
										type: "object",
										additionalProperties: false,
										properties: {
											field: { type: "string" },
											label: { type: "string" }
										}
									}
								},
								optional: {
									type: "array",
									items: {
										type: "object",
										additionalProperties: false,
										properties: {
											field: { type: "string" },
											label: { type: "string" }
										}
									}
								}
							}
						}
					},
					packs: {
						type: "object",
						additionalProperties: false,
						properties: {
							builtin: { type: "string" },
							dataRoot: { type: "string" },
							workspace: { type: "string" }
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderFlows(tighten(value))
			}]
		},
		async execute(_args, exec) {
			return await listFlows(deps, exec);
		}
	});
}
const RUN_PROMPT = `执行一条造数流程（三道闸编排）。

调用前必须满足（缺一会被拒绝启动）：
1. 闸1 必填齐全：流程 yaml 的 required 参数全部就位（可先 dataforge_flows 核对）。
2. 闸2 用户确认：先展示参数确认卡，用户回复「确认」后，才允许 confirm=true 重调本工具；
   没有这一步，不要擅自 confirm。
3. 业务映射：把「生态链」这类口语映射成对应编码（stockOrg/purchaseOrg 等），规则见流程包说明。

dry_run=true 仅做静态走查（不碰外部系统），验收/试跑用它；
真实造数单次 2-8 分钟，accepted=true 时走宿主后台任务（kind=background），
用 job_output 看进度，dataforge_status 查业务结果。

失败时（accepted=false）：
- gate=missing-fields → 补齐 missing 后重调；
- gate=confirm-required → 把 card 转述给用户求确认；
- gate=preflight-failed → 按提示修引擎环境，不要重试绕过。`;
function renderRun(value) {
	if (!value.accepted) return value.card ?? "❌ 未获接受（缺细节）";
	const mode = value.kind === "background" ? `已注册后台任务 ${value.jobId ?? "?"}` : `前台已执行完毕${value.degradedNotice ? `（${value.degradedNotice}）` : ""}`;
	return `${value.kind === "background" ? `🚀 ${value.runId ?? "?"}：${mode}；用 job_output 看进度，或 dataforge_status 查结果。` : `✅ ${value.runId ?? "?"}：${mode}`}${value.summary === void 0 ? "" : `\n${summarizeRunBrief(value.summary)}`}`;
}
function summarizeRunBrief(summary) {
	const biz = summary.businessData === void 0 ? "" : Object.entries(summary.businessData).map(([k, v]) => `${k}=${String(v)}`).join(" ");
	const icon = summary.status === "completed" ? "✅" : summary.status === "running" ? "⏳" : "❌";
	const where = summary.lastStepId === void 0 ? "" : `（最后一步 ${summary.lastStepId}）`;
	return `${icon} ${summary.status}：${summary.stepsDone}/${summary.totalSteps} 步${where}${biz ? `；${biz}` : ""}`;
}
function defineRunTool(deps) {
	return defineTool({
		name: "dataforge_run",
		description: RUN_PROMPT,
		parameters: {
			flow: {
				type: "string",
				required: true,
				description: "流程名（dataforge_flows 的 name，禁止凭记忆编造）"
			},
			params: {
				type: "object",
				required: true,
				additionalProperties: true,
				description: "流程入参（required 全给齐；materials 是对象）"
			},
			confirm: {
				type: "boolean",
				description: "闸2：用户确认后才允许 true；缺省 = 只出确认卡"
			},
			dry_run: {
				type: "boolean",
				description: "静态走查（不执行外部调用）；缺省 false"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					accepted: { type: "boolean" },
					gate: {
						type: "string",
						description: "started / missing-fields / confirm-required / preflight-failed"
					},
					kind: {
						type: "string",
						description: "background / foreground"
					},
					jobId: { type: "string" },
					runId: { type: "string" },
					runDir: { type: "string" },
					missing: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								field: { type: "string" },
								label: { type: "string" }
							}
						}
					},
					card: { type: "string" },
					degradedNotice: { type: "string" },
					summary: {
						type: "object",
						additionalProperties: true,
						description: "前台模式下的运行摘要"
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderRun(tighten(value))
			}]
		},
		async execute(args, exec) {
			return await runFlow(deps, exec, {
				flow: args.flow,
				params: args.params,
				...args.confirm === void 0 ? {} : { confirm: args.confirm },
				...args.dry_run === void 0 ? {} : { dryRun: args.dry_run }
			});
		}
	});
}
function renderStatus(value) {
	if (value.run !== void 0) return summarizeRunFull(value.run);
	if (value.runs === void 0) return value.notice ?? "查询无结果";
	if (value.runs.length === 0) return value.notice ?? "暂无运行留痕";
	return `🗂 最近运行：\n${value.runs.map((r) => `- ${r.runId}：${r.status} ${r.stepsDone}/${r.totalSteps} 步${r.businessData?.poNo === void 0 ? "" : ` PO=${String(r.businessData.poNo)}`}`).join("\n")}`;
}
function summarizeRunFull(run) {
	const icon = run.status === "completed" ? "✅" : run.status === "running" ? "⏳" : run.status === "killed" ? "🛑" : "❌";
	const biz = run.businessData === void 0 ? [] : Object.entries(run.businessData).map(([k, v]) => `${k}=${String(v)}`);
	return [
		`${icon} ${run.runId}（${run.flowName || run.flow}）— ${run.status}${run.dryRun ? "（dry-run）" : ""}`,
		`进度：${run.stepsDone}/${run.totalSteps} 步${run.lastStepId === void 0 ? "" : `，最后一步 ${run.lastStepId}`}`,
		...run.message === void 0 ? [] : [`信息：${run.message}`],
		...run.lastError === void 0 ? [] : [`错误：${run.lastError}`],
		...biz.length === 0 ? [] : [`业务字段：${biz.join("  ")}`]
	].join("\n");
}
function defineStatusTool(deps) {
	return defineTool({
		name: "dataforge_status",
		description: `查造数运行状态。

用法：
- runId 给出时：单查一次运行（进度、最后一步、失败原因、业务单号链）。
- runId 省略：列最近运行。

对后台任务的约定：dataforge_run 返回 accepted=true + kind=background 后，用本工具轮询或等 job 完成通知；不要凭空报结果。`,
		parameters: { run_id: {
			type: "string",
			description: "缺省 = 列最近 10 条运行"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					notice: { type: "string" },
					run: {
						type: "object",
						additionalProperties: true
					},
					runs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderStatus(tighten(value))
			}]
		},
		async execute(args) {
			return runStatus(deps, args.run_id);
		}
	});
}
function renderCapture(value) {
	if (!value.accepted) return value.card ?? "❌ 采集请求未被接受（缺细节）";
	if (value.sessionId !== void 0) return `✅ 已开会话 ${value.sessionId}（captureId ${value.captureId ?? "?"}）：用 dataforge_browser_snapshot 看 UI、dataforge_browser_act 交互；结束后 dataforge_browser_close 收 cookie。`;
	return `🚀 采集已启动（captureId ${value.captureId ?? "?"}）：site_crawl 是后台任务，用 dataforge_capture_status 轮询，完成后 dataforge_capture_result(scope=cards) 取卡。`;
}
function defineCaptureTool(deps) {
	return defineTool({
		name: "dataforge_capture",
		description: `启动接口采集（接口测试流水线第一期）。

三种任务型：
- single_page：打开一个页面，静止期收 XHR/fetch → 接口卡（后台 job）。
- site_crawl：从入口 BFS 同域逐页采集，maxDepth/maxPages 截断、诚实标注（后台 job）。
- action：智能驱动采集——由你经 dataforge_browser_* 原语模拟真实 UI 操作（搜索/翻页/提交），
  遇到的 XHR 全部成卡；**任何写操作必须先向用户转述并获同意**。

三道闸语义：
- single_page/site_crawl 只读，accepted 即后台启动；用 captureId 轮询。
- action 是写操作闸：未 confirm=true 一律拒绝（gate=action-confirm-required）。

失败门：bad-url（entryUrl 非法）/ bad-task（taskType 非法）/ action-confirm-required（未确认）。`,
		parameters: {
			task_type: {
				type: "string",
				required: true,
				description: "single_page | site_crawl | action"
			},
			entry_url: {
				type: "string",
				required: true,
				description: "采集入口 URL（https:// 开头）"
			},
			confirm: {
				type: "boolean",
				description: "仅 action 需要：用户确认真实 UI 写操作后为 true"
			},
			max_depth: {
				type: "number",
				description: "site_crawl BFS 深度上限（缺省用配置）"
			},
			max_pages: {
				type: "number",
				description: "site_crawl BFS 页数上限（缺省用配置）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					accepted: { type: "boolean" },
					gate: {
						type: "string",
						description: "started / bad-url / bad-task / action-confirm-required"
					},
					captureId: { type: "string" },
					sessionId: {
						type: "string",
						description: "action 型：会话原语 id"
					},
					card: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderCapture(tighten(value))
			}]
		},
		async execute(args) {
			const taskType = args.task_type;
			if (taskType !== "single_page" && taskType !== "site_crawl" && taskType !== "action") return {
				accepted: false,
				gate: "bad-task",
				card: `❌ taskType 非法：${String(taskType)}`
			};
			return await startCapture(deps, {
				taskType,
				entryUrl: args.entry_url,
				...args.confirm === void 0 ? {} : { confirm: args.confirm },
				...args.max_depth === void 0 ? {} : { maxDepth: args.max_depth },
				...args.max_pages === void 0 ? {} : { maxPages: args.max_pages }
			});
		}
	});
}
function defineCaptureStatusTool(deps) {
	return defineTool({
		name: "dataforge_capture_status",
		description: `查采集运行状态。capture_id 给出时单查（running/done/failed/cancelled + 页面/请求/卡/凭证计数）；省缺省列最近 10 条。site_crawl 后台任务用它轮询，不要凭空报结果。`,
		parameters: { capture_id: {
			type: "string",
			description: "缺省 = 列最近 10 条"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					notice: { type: "string" },
					run: {
						type: "object",
						additionalProperties: true
					},
					runs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					}
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				if (v.runs !== void 0) return [{
					type: "text",
					text: `🗂 最近采集：\n${v.runs.map((r) => `- ${r.id}: ${r.status}`).join("\n")}`
				}];
				const run = v.run;
				return [{
					type: "text",
					text: run === void 0 ? `⚠️ ${v.notice ?? "查询无结果"}` : `📡 ${run.id}：${run.status} 页${run.stats.pages}/请求${run.stats.requests}/卡${run.stats.cards}/凭证${run.stats.credentials}`
				}];
			}
		},
		async execute(args) {
			return captureStatus(deps, args.capture_id);
		}
	});
}
function defineCaptureResultTool(deps) {
	return defineTool({
		name: "dataforge_capture_result",
		description: `取采集产物（四种 scope）：cards=接口卡（模板/归并键）；samples=原始请求留痕（文件指针）；credentials=捕获的凭证（只报名称/来源，不贴原文）；pages=已抓页面清单。报给用户时只说接口名/用途/出入参要点，不贴 token/cookie 原文。`,
		parameters: {
			capture_id: {
				type: "string",
				required: true
			},
			scope: {
				type: "string",
				required: true,
				description: "cards | samples | credentials | pages"
			},
			limit: {
				type: "number",
				description: "缺省 50"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					notice: { type: "string" },
					items: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					}
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				if (v.notice !== void 0) return [{
					type: "text",
					text: `📭 ${v.notice}`
				}];
				return [{
					type: "text",
					text: `📦 ${v.items?.length ?? 0} 条记录（详见 items）`
				}];
			}
		},
		async execute(args) {
			if (args.scope !== "cards" && args.scope !== "samples" && args.scope !== "credentials" && args.scope !== "pages") return {
				ok: false,
				notice: `scope 非法：${String(args.scope)}（cards | samples | credentials | pages）`
			};
			return captureResult(deps, args.capture_id, args.scope, args.limit);
		}
	});
}
function defineCaptureCancelTool(deps) {
	return defineTool({
		name: "dataforge_capture_cancel",
		description: `取消一次采集：run 收口为 cancelled（幂等）。后台 job 的进程级取消由宿主 job 系统负责。`,
		parameters: { capture_id: {
			type: "string",
			required: true
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					status: { type: "string" },
					notice: { type: "string" }
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				return [{
					type: "text",
					text: v.ok ? `🛑 已收口（status=${v.status ?? "cancelled"}）` : `⚠️ ${v.notice ?? "取消未生效"}`
				}];
			}
		},
		async execute(args) {
			return captureCancel(deps, args.capture_id);
		}
	});
}
function toActSpec(raw) {
	const r = raw;
	const selector = typeof r["selector"] === "string" ? r["selector"] : void 0;
	switch (r["kind"]) {
		case "click": return selector === void 0 ? void 0 : {
			kind: "click",
			selector
		};
		case "submit": return selector === void 0 ? void 0 : {
			kind: "submit",
			selector
		};
		case "fill": return selector === void 0 || typeof r["value"] !== "string" ? void 0 : {
			kind: "fill",
			selector,
			value: r["value"]
		};
		case "press": return typeof r["key"] !== "string" ? void 0 : {
			kind: "press",
			key: r["key"]
		};
		case "wait": return typeof r["ms"] !== "number" ? void 0 : {
			kind: "wait",
			ms: r["ms"]
		};
		case "goto": return typeof r["url"] !== "string" ? void 0 : {
			kind: "goto",
			url: r["url"]
		};
		default: return;
	}
}
function defineBrowserOpenTool(deps) {
	return defineTool({
		name: "dataforge_browser_open",
		description: `开一个无头 Chrome 采集会话（系统 Chrome，流经隐私侧通道）。entry_url 给出时直接导航过去。与 dataforge_capture(task_type=action) 配合使用：action 会话可自动开。`,
		parameters: { entry_url: {
			type: "string",
			description: "打开后立刻导航的 URL"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					sessionId: { type: "string" },
					pageUrl: { type: "string" }
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				return [{
					type: "text",
					text: `🖥 会话 ${v.sessionId} 已开（${v.pageUrl}）。下一步用 dataforge_browser_snapshot 看页面。`
				}];
			}
		},
		async execute(args) {
			return deps.registry.open(args.entry_url === void 0 ? {} : { entryUrl: args.entry_url });
		}
	});
}
function defineBrowserActTool(deps) {
	return defineTool({
		name: "dataforge_browser_act",
		description: `对采集会话执行一次页面动作：click/fill/press/submit/wait/goto。⚠️ 此工具生成真实用户操作（含写）：生产站点填表/点击前先转述给用户确认；提交类只应出现在 dataforge_capture(task_type=action) 且用户 confirm 之后。`,
		parameters: {
			session_id: {
				type: "string",
				required: true
			},
			act: {
				type: "object",
				required: true,
				additionalProperties: true,
				description: "{kind: click|fill|press|submit|wait|goto, selector?, value?, key?, url?, ms?}"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					pageUrl: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				return [{
					type: "text",
					text: v.ok ? `✅ 动作完成（当前页 ${v.pageUrl ?? "?"}）` : `❌ 动作失败：${v.error ?? "未知"}`
				}];
			}
		},
		async execute(args) {
			const spec = toActSpec(args.act);
			if (spec === void 0) return {
				ok: false,
				error: `act 非法：${JSON.stringify(args.act).slice(0, 200)}`
			};
			return await deps.registry.act(args.session_id, spec);
		}
	});
}
function defineBrowserSnapshotTool(deps) {
	return defineTool({
		name: "dataforge_browser_snapshot",
		description: `抓当前页面可交互元素清单（≤80 个：链接/按钮/输入/表单），据此决定下一步 browser_act。$eval：id/name/textElement 每个元素一行。`,
		parameters: { session_id: {
			type: "string",
			required: true
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					elements: {
						type: "array",
						items: { type: "string" }
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				if (!v.ok) return [{
					type: "text",
					text: `❌ 快照失败：${v.error ?? "未知"}`
				}];
				const lines = (v.elements ?? []).map((e) => `- ${e}`).join("\n");
				return [{
					type: "text",
					text: `🔍 可交互元素 ${v.elements?.length ?? 0} 个：\n${lines}`
				}];
			}
		},
		async execute(args) {
			return await deps.registry.snapshot(args.session_id);
		}
	});
}
function defineBrowserCloseTool(deps) {
	return defineTool({
		name: "dataforge_browser_close",
		description: `关闭采集会话并交回 cookie 总结；若会话绑定了 captureId，凭证已在收口时入库。`,
		parameters: { session_id: {
			type: "string",
			required: true
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					ok: { type: "boolean" },
					cookies: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					},
					captureId: { type: "string" }
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				return [{
					type: "text",
					text: v.ok ? `🔒 会话已关（cookie ${v.cookies.length} 个${v.captureId === void 0 ? "" : `，已挂到 ${v.captureId}`}）` : "❌ 会话不存在或已关闭"
				}];
			}
		},
		async execute(args) {
			return await deps.registry.close(args.session_id);
		}
	});
}

//#endregion
//#region src/capture/store.ts
/**
* 采集留痕存储：SQLite（WAL）查询面 + NDJSON 事件审计面 + 大体二进制落文件。
*
* 写路径全部同步（better-sqlite3），跨会话/跨句柄并发天然串行；
* 样本正文超 captureBodyLimitBytes 时落 `<samplesDir>/<captureId>/*.bin`，DB 存相对路径。
*
* @module dsh-dataforge/capture/store
*/
const DDL = `
CREATE TABLE IF NOT EXISTS capture_runs (
  id TEXT PRIMARY KEY, task_type TEXT NOT NULL, entry_url TEXT NOT NULL,
  status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
  stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), url TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', visited_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS request_samples (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), page_id TEXT,
  page_url TEXT, ts INTEGER NOT NULL, seq INTEGER NOT NULL, url TEXT NOT NULL, method TEXT NOT NULL,
  status INTEGER, request_headers_json TEXT, request_body_path TEXT, request_body_preview TEXT,
  response_headers_json TEXT, response_body_path TEXT, response_preview TEXT, truncated INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS interface_cards (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), merge_key TEXT UNIQUE NOT NULL,
  name TEXT, url_template TEXT NOT NULL, method TEXT NOT NULL,
  request_template_json TEXT, response_template_json TEXT, auth_json TEXT,
  related_pages_json TEXT NOT NULL, sample_count INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credential_events (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), kind TEXT NOT NULL,
  url TEXT, name TEXT NOT NULL, value_json TEXT, obtained_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_sessions (
  id TEXT PRIMARY KEY, capture_id TEXT, origin TEXT NOT NULL, stored_body TEXT NOT NULL, stored_at INTEGER NOT NULL
);`;
var CaptureStore = class {
	db;
	seqCounters = /* @__PURE__ */ new Map();
	io;
	constructor(dbPath, samplesDir, eventsNdjsonPath) {
		this.io = {
			dbPath,
			samplesDir,
			eventsNdjsonPath
		};
		mkdirSync(samplesDir, { recursive: true });
		if (eventsNdjsonPath !== void 0) mkdirSync(join(eventsNdjsonPath, ".."), { recursive: true });
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.exec(DDL);
	}
	close() {
		this.db.close();
	}
	upsertRun(run) {
		this.db.prepare(`INSERT INTO capture_runs(id,task_type,entry_url,status,started_at,stats_json)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status`).run(run.id, run.taskType, run.entryUrl, run.status, run.startedAt, JSON.stringify(run.stats));
		this.appendEvent({
			kind: "terminal",
			phase: "start",
			captureId: run.id,
			taskType: run.taskType
		});
	}
	finishRun(id, status, error, stats) {
		const existing = this.getRun(id);
		if (existing === void 0) throw new Error(`capture ${id} 不存在，无法 finish`);
		const finalStats = stats ?? existing.stats;
		this.db.prepare(`UPDATE capture_runs SET status=?, ended_at=?, error=?, stats_json=? WHERE id=?`).run(status, Date.now(), error ?? null, JSON.stringify(finalStats), id);
		this.appendEvent({
			kind: "terminal",
			phase: "end",
			captureId: id,
			status,
			error
		});
	}
	getRun(id) {
		const row = this.db.prepare("SELECT * FROM capture_runs WHERE id=?").get(id);
		if (row === void 0) return void 0;
		return {
			id: String(row["id"]),
			taskType: String(row["task_type"]),
			entryUrl: String(row["entry_url"]),
			status: String(row["status"]),
			startedAt: Number(row["started_at"]),
			endedAt: row["ended_at"] === null || row["ended_at"] === void 0 ? void 0 : Number(row["ended_at"]),
			stats: JSON.parse(String(row["stats_json"])),
			error: row["error"] === null || row["error"] === void 0 ? void 0 : String(row["error"])
		};
	}
	listRuns(limit = 10) {
		return this.db.prepare("SELECT id FROM capture_runs ORDER BY started_at DESC LIMIT ?").all(limit).flatMap((r) => {
			const run = this.getRun(r.id);
			return run === void 0 ? [] : [run];
		});
	}
	upsertPage(captureId, url, depth, status) {
		const id = `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		this.db.prepare("INSERT INTO pages(id,capture_id,url,depth,status,visited_at) VALUES (?,?,?,?,?,?)").run(id, captureId, url, depth, status, Date.now());
		this.appendEvent({
			kind: "page",
			captureId,
			url,
			depth,
			status
		});
		this.bumpRunStats(captureId, "pages");
		return id;
	}
	listPages(captureId, limit = 50) {
		return this.db.prepare("SELECT * FROM pages WHERE capture_id=? ORDER BY visited_at DESC LIMIT ?").all(captureId, limit).map((row) => ({
			id: String(row["id"]),
			captureId: String(row["capture_id"]),
			url: String(row["url"]),
			depth: Number(row["depth"]),
			status: String(row["status"])
		}));
	}
	upsertSample(captureId, pageId, input) {
		const id = `sm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		const counter = this.seqCounters.get(captureId) ?? { requests: 0 };
		counter.requests += 1;
		this.seqCounters.set(captureId, counter);
		const reqPath = this.bodyPath(captureId, input.requestBody, input.bodyLimit);
		const respPath = this.bodyPath(captureId, input.responseBody, input.bodyLimit);
		const truncated = input.truncated === true || reqPath !== void 0 || respPath !== void 0;
		this.db.prepare(`INSERT INTO request_samples(id,capture_id,page_id,page_url,ts,seq,url,method,status,
          request_headers_json,request_body_path,request_body_preview,response_headers_json,response_body_path,response_preview,truncated)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, captureId, pageId ?? null, input.pageUrl ?? "", input.ts ?? Date.now(), counter.requests, input.url, input.method, input.status ?? null, JSON.stringify(input.requestHeaders), reqPath ?? null, previewOf(input.requestBody, input.bodyLimit), JSON.stringify(input.responseHeaders), respPath ?? null, previewOf(input.responseBody, input.bodyLimit), truncated ? 1 : 0);
		this.appendEvent({
			kind: "request",
			captureId,
			url: input.url,
			method: input.method,
			status: input.status
		});
		this.bumpRunStats(captureId, "requests");
		return id;
	}
	countSamples(captureId) {
		const row = this.db.prepare("SELECT COUNT(*) AS n FROM request_samples WHERE capture_id=?").get(captureId);
		return Number(row["n"]);
	}
	listSamples(captureId, limit = 100) {
		return this.db.prepare("SELECT * FROM request_samples WHERE capture_id=? ORDER BY ts ASC, seq ASC LIMIT ?").all(captureId, limit).map((row) => ({
			id: String(row["id"]),
			captureId: String(row["capture_id"]),
			pageUrl: row["page_url"] === null || row["page_url"] === void 0 ? "" : String(row["page_url"]),
			seq: Number(row["seq"]),
			url: String(row["url"]),
			method: String(row["method"]),
			status: row["status"] === null || row["status"] === void 0 ? void 0 : Number(row["status"]),
			requestHeaders: parseRecord(row["request_headers_json"]),
			requestBodyPath: optString(row["request_body_path"]),
			requestBodyPreview: optString(row["request_body_preview"]),
			responseHeaders: parseRecord(row["response_headers_json"]),
			responseBodyPath: optString(row["response_body_path"]),
			responsePreview: optString(row["response_preview"]),
			truncated: Number(row["truncated"]) === 1,
			ts: Number(row["ts"])
		}));
	}
	readBinary(relPath) {
		const abs = join(this.io.samplesDir, relPath);
		return existsSync(abs) ? readFileSync(abs) : void 0;
	}
	/** 按 merge_key 幂等：已有卡 → 追加页面引用 + 样本计数 +1；新卡 → 建行。 */
	upsertCard(captureId, input) {
		const existing = this.db.prepare("SELECT id FROM interface_cards WHERE merge_key=?").get(input.mergeKey);
		if (existing !== void 0) {
			this.db.prepare("UPDATE interface_cards SET related_pages_json=?, sample_count=sample_count+1 WHERE id=?").run(JSON.stringify(input.relatedPageUrls), existing.id);
			if (input.requestTemplate !== void 0) this.db.prepare("UPDATE interface_cards SET request_template_json=? WHERE id=?").run(JSON.stringify(input.requestTemplate), existing.id);
			if (input.responseTemplate !== void 0) this.db.prepare("UPDATE interface_cards SET response_template_json=? WHERE id=?").run(JSON.stringify(input.responseTemplate), existing.id);
			if (input.authBinding !== void 0) this.db.prepare("UPDATE interface_cards SET auth_json=? WHERE id=?").run(JSON.stringify(input.authBinding), existing.id);
			if (input.name !== void 0) this.db.prepare("UPDATE interface_cards SET name=? WHERE id=?").run(input.name, existing.id);
			this.appendEvent({
				kind: "card",
				captureId,
				cardId: existing.id,
				merged: true
			});
			return existing.id;
		}
		const id = `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		this.db.prepare(`INSERT INTO interface_cards(id,capture_id,merge_key,name,url_template,method,
          request_template_json,response_template_json,auth_json,related_pages_json,sample_count,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`).run(id, captureId, input.mergeKey, input.name ?? null, input.urlTemplate, input.method, input.requestTemplate === void 0 ? null : JSON.stringify(input.requestTemplate), input.responseTemplate === void 0 ? null : JSON.stringify(input.responseTemplate), input.authBinding === void 0 ? null : JSON.stringify(input.authBinding), JSON.stringify(input.relatedPageUrls), Date.now());
		this.bumpRunStats(captureId, "cards");
		this.appendEvent({
			kind: "card",
			captureId,
			cardId: id
		});
		return id;
	}
	getCard(id) {
		const row = this.db.prepare("SELECT * FROM interface_cards WHERE id=?").get(id);
		return row === void 0 ? void 0 : rowToCard(row);
	}
	listCards(captureId, limit = 200) {
		return this.db.prepare("SELECT * FROM interface_cards WHERE capture_id=? ORDER BY created_at ASC LIMIT ?").all(captureId, limit).map(rowToCard);
	}
	upsertCredential(captureId, kind, url, name, obtainedAt, value) {
		const id = `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		this.db.prepare("INSERT INTO credential_events(id,capture_id,kind,url,name,value_json,obtained_at) VALUES (?,?,?,?,?,?,?)").run(id, captureId, kind, url, name, value === void 0 ? null : JSON.stringify(value), obtainedAt);
		this.bumpRunStats(captureId, "credentials");
		this.appendEvent({
			kind: "credential",
			captureId,
			credentialKind: kind,
			name,
			url
		});
		return id;
	}
	listCredentials(captureId, limit = 200) {
		return this.db.prepare("SELECT * FROM credential_events WHERE capture_id=? ORDER BY obtained_at ASC LIMIT ?").all(captureId, limit).map((row) => ({
			id: String(row["id"]),
			captureId: String(row["capture_id"]),
			kind: String(row["kind"]),
			url: optString(row["url"]) ?? "",
			name: String(row["name"]),
			valueJson: optString(row["value_json"]),
			obtainedAt: Number(row["obtained_at"])
		}));
	}
	saveSession(origin, captureId, body) {
		const id = `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		this.db.prepare("INSERT INTO login_sessions(id,capture_id,origin,stored_body,stored_at) VALUES (?,?,?,?,?)").run(id, captureId ?? null, origin, JSON.stringify(body), Date.now());
		return id;
	}
	bumpRunStats(captureId, key) {
		this.db.prepare(`UPDATE capture_runs SET stats_json = json_set(stats_json, '$.${key}', COALESCE(json_extract(stats_json, '$.${key}'),0)+1)
         WHERE id=?`).run(captureId);
	}
	bodyPath(captureId, body, limit) {
		if (body === void 0 || Buffer.byteLength(body) <= limit) return void 0;
		const rel = join(captureId, `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.bin`);
		mkdirSync(join(this.io.samplesDir, captureId), { recursive: true });
		writeFileSync(join(this.io.samplesDir, rel), body);
		return rel;
	}
	appendEvent(event) {
		if (this.io.eventsNdjsonPath === void 0) return;
		appendFileSync(this.io.eventsNdjsonPath, `${JSON.stringify({
			ts: Date.now(),
			...event
		})}\n`, "utf8");
	}
};
function previewOf(body, limit) {
	if (body === void 0) return void 0;
	if (Buffer.byteLength(body) > limit) return void 0;
	return String(body).slice(0, 512);
}
function parseRecord(raw) {
	if (typeof raw !== "string") return {};
	try {
		const parsed = JSON.parse(raw);
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
		return {};
	} catch {
		return {};
	}
}
function optString(value) {
	return value === null || value === void 0 ? void 0 : String(value);
}
function rowToCard(row) {
	const related = parseArray(row["related_pages_json"]);
	const requestTemplate = optTemplate(row["request_template_json"]);
	const responseTemplate = optTemplate(row["response_template_json"]);
	return {
		id: String(row["id"]),
		captureId: String(row["capture_id"]),
		name: optString(row["name"]),
		urlTemplate: String(row["url_template"]),
		method: String(row["method"]),
		requestTemplate,
		responseTemplate,
		authBinding: optRecord(row["auth_json"]),
		relatedPageUrls: related,
		sampleCount: Number(row["sample_count"]),
		createdAt: Number(row["created_at"])
	};
}
function optTemplate(raw) {
	if (typeof raw !== "string" || raw.trim().startsWith("{") === false) return void 0;
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
	const record = parsed;
	return {
		fields: Array.isArray(record["fields"]) ? record["fields"] : [],
		codePath: typeof record["codePath"] === "string" ? record["codePath"] : void 0
	};
}
function optRecord(raw) {
	if (typeof raw !== "string" || raw.trim().startsWith("{") === false) return void 0;
	try {
		const parsed = JSON.parse(raw);
		return parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ? void 0 : parsed;
	} catch {
		return;
	}
}
function parseArray(raw) {
	if (typeof raw !== "string") return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

//#endregion
//#region src/capture/session.ts
var SessionRegistry = class {
	io;
	sessions = /* @__PURE__ */ new Map();
	constructor(io) {
		this.io = io;
	}
	async open(o) {
		const sessionId = `bs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		const { browser, context, page } = await this.io.openCapturingPage("chrome", (w) => {
			this.sessions.get(sessionId)?.sink?.(w);
		});
		this.sessions.set(sessionId, o.captureId === void 0 ? {
			page,
			browser,
			context
		} : {
			page,
			browser,
			context,
			captureId: o.captureId
		});
		if (o.entryUrl !== void 0) await page.goto(o.entryUrl, {
			waitUntil: "domcontentloaded",
			timeout: 15e3
		}).catch(() => void 0);
		return {
			sessionId,
			pageUrl: page.url()
		};
	}
	bindSink(sessionId, sink) {
		const s = this.sessions.get(sessionId);
		if (s !== void 0) s.sink = sink;
	}
	async act(sessionId, spec) {
		const s = this.sessions.get(sessionId);
		if (s === void 0) return {
			ok: false,
			error: `session ${sessionId} 不存在`
		};
		try {
			if (spec.kind === "click") await s.page.click(spec.selector, { timeout: 1e4 });
			else if (spec.kind === "fill") await s.page.fill(spec.selector, spec.value, { timeout: 1e4 });
			else if (spec.kind === "press") await s.page.keyboard.press(spec.key);
			else if (spec.kind === "submit") await s.page.click(spec.selector, { timeout: 1e4 });
			else if (spec.kind === "wait") await s.page.waitForTimeout(Math.min(spec.ms, 1e4));
			else if (spec.kind === "goto") await s.page.goto(spec.url, {
				waitUntil: "domcontentloaded",
				timeout: 3e4
			});
			return {
				ok: true,
				pageUrl: s.page.url()
			};
		} catch (err) {
			const msg = err?.message;
			return typeof msg === "string" ? {
				ok: false,
				error: msg.slice(0, 300)
			} : { ok: false };
		}
	}
	async snapshot(sessionId) {
		const s = this.sessions.get(sessionId);
		if (s === void 0) return {
			ok: false,
			error: `session ${sessionId} 不存在`
		};
		try {
			return {
				ok: true,
				elements: await s.page.$$eval("a[href], button, input, form, select, textarea", (els) => els.filter((el) => {
					const e = el;
					return typeof e.offsetWidth === "number" && e.offsetWidth > 0 && typeof e.offsetHeight === "number" && e.offsetHeight > 0;
				}).slice(0, 80).map((el) => {
					const e = el;
					const tag = String(e.tagName ?? "?").toLowerCase();
					const id = String(e.id ?? "");
					const name = e.getAttribute("name") ?? "";
					const txt = String(e.textContent ?? "").trim().slice(0, 40);
					return `${tag}${id ? `#${id}` : ""}${name ? `[name=${name}]` : ""} ${txt}`.trim();
				}))
			};
		} catch (err) {
			const msg = err?.message;
			return typeof msg === "string" ? {
				ok: false,
				error: msg.slice(0, 300)
			} : { ok: false };
		}
	}
	async close(sessionId) {
		const s = this.sessions.get(sessionId);
		if (s === void 0) return {
			ok: false,
			cookies: []
		};
		const cookies = (await s.context.cookies()).map((c) => ({
			name: String(c["name"] ?? ""),
			domain: String(c["domain"] ?? "")
		}));
		await s.browser.close().catch(() => void 0);
		this.sessions.delete(sessionId);
		return s.captureId === void 0 ? {
			ok: true,
			cookies
		} : {
			ok: true,
			cookies,
			captureId: s.captureId
		};
	}
};

//#endregion
//#region src/index.ts
/**
* dsh-dataforge —— Cordis 插件入口。
*
* 职责一句话：**把声明式造数流程包，变成 agent 可调用的三个工具**。
*
* 分层（与 DSH 家族插件同款约定）：
*   ① 工具壳（tools.ts）—— 参数声明 / 回执渲染 / 三道闸收口，全部本地纯逻辑；
*   ② 流程发现（flows/discover.ts）—— engineRoot 内置包 + dataRoot 包 + 工作区包，
*      「工作区 > dataRoot > 引擎内置」，改 yaml 即生效；
*   ③ 引擎桥（engine/bridge.ts）—— spawn python dsh_bridge.py，stdout 纯 NDJSON 事件流。
*      凭证不经过本插件；引擎在自己的 checkout 里加载 .env；
*   ④ 运行留痕（runs/store.ts）—— dataRoot/runs/<runId>/events.ndjson，唯一事实源。
*
* 长跑：造数 2-8 分钟，走宿主 ctx.jobs 后台任务（复选 dsh-jobs + dsh-tool-jobs）；
* jobs 不在场时 std 工具放行前台执行（如实标 foreground）。
*
* @module dsh-dataforge
*/
const name = "dsh-dataforge";
/** 工具注册表必依赖；jobs / systemPrompt / workingDirectory 惰性解析。 */
const inject = ["tools"];
/** 从执行上下文解析当前工作区根（工作区流程包的锚点；对齐 dsh-file-enhance resolveRoot）。 */
async function resolveWorkspaceRoot(exec) {
	const cwd = (exec?.agent)?.session?.header?.cwd;
	if (typeof cwd === "string" && cwd.length > 0) return cwd;
	return process.cwd();
}
/** policy 文本来源：流程包 policy.md（权威），缺省给一段最小纪律（诚实标注缺省）。 */
function loadPolicyText(engineRoot) {
	try {
		const text = readFileSync(join(engineRoot, "policy.md"), "utf8").trim();
		if (text.length > 0) return {
			text,
			source: "policy.md"
		};
	} catch {}
	return {
		source: "builtin-minimal",
		text: [
			"## dataforge（声明式造数流程）",
			"- 调 dataforge_run 前必须先 dataforge_flows 选定流程并核对必填参数；缺参数先向用户追问，不要瞎编。",
			"- 必须三闸齐备才执行：参数齐全（闸1）→ 用户确认（闸2，confirm=true）→ 业务词映射为编码（闸3，凭流程包说明）。",
			"- 结果只报业务字段（单号/状态/耗时），不暴露 HTTP 原文、token、数据库连接串。",
			"- 造数最终必须拿到完整单号链；只跑一半就该如实报失败步骤。"
		].join("\n")
	};
}
/** 采集域纪律：追加到 policy 文本末尾的常驻段。 */
const CAPTURE_POLICY = [
	"## dataforge-capture（接口采集）",
	"- 采集目标站任何写操作只经 dataforge_capture(task_type=action) 且用户明确 confirm；禁止用 browser_act 未确认直接提交表单。",
	"- site_crawl 是后台任务：dataforge_capture 返回 captureId 后用 dataforge_capture_status 轮询，不要凭空报结果。",
	"- 采集结果用 dataforge_capture_result(scope=cards|samples|credentials|pages) 取回，报给用户时只说接口名/用途/出入参要点，不贴 token/cookie 原文。",
	"- 诚实边界：遇风控/验证码/超限截断/外部域名跳过，如实转述 capture_status/capture_result 里的 notice，不隐瞒。"
].join("\n");
/** 装载插件。 */
function apply(ctx, rawConfig) {
	const anyCtx = ctx;
	const logger = anyCtx.logger?.(name);
	const config = normalizeConfig(rawConfig);
	let jobsService;
	anyCtx.inject?.(["jobs"], (svc) => {
		jobsService = svc["jobs"];
	});
	const dataforgeDeps = buildDataforgeDeps({
		config,
		resolveJobs: () => jobsService,
		resolveWorkspaceRoot
	});
	const captureDeps = {
		config,
		resolveJobs: () => jobsService,
		store: new CaptureStore(join(config.dataRoot, "capture", "capture.sqlite"), join(config.dataRoot, "capture", "samples"), join(config.dataRoot, "capture", "events.ndjson")),
		registry: new SessionRegistry({
			openCapturingPage,
			bodyLimit: config.captureBodyLimitBytes
		}),
		openCapturingPage
	};
	anyCtx.inject?.(["tools"], (toolsService) => {
		const tools = toolsService["tools"];
		if (typeof tools?.register !== "function") {
			logger?.warn?.("tools 服务不可用：dataforge 工具未注册");
			return;
		}
		join(config.engineRoot, "configs"), join(config.dataRoot, "flows");
		for (const tool of [
			defineFlowsTool(dataforgeDeps),
			defineRunTool(dataforgeDeps),
			defineStatusTool(dataforgeDeps),
			defineCaptureTool(captureDeps),
			defineCaptureStatusTool(captureDeps),
			defineCaptureResultTool(captureDeps),
			defineCaptureCancelTool(captureDeps),
			defineBrowserOpenTool(captureDeps),
			defineBrowserActTool(captureDeps),
			defineBrowserSnapshotTool(captureDeps),
			defineBrowserCloseTool(captureDeps)
		]) tools.register(tool);
		logger?.info?.(`已注册 11 个工具：flows/run/status + capture/status/result/cancel + browser_open/act/snapshot/close（引擎：${config.engineRoot}；数据根：${config.dataRoot}）`);
	});
	if (config.injectPolicy) try {
		const policy = loadPolicyText(config.engineRoot);
		const combined = `${policy.text}\n\n${CAPTURE_POLICY}`;
		const sectionName = "tool:dataforge";
		anyCtx.systemPrompt?.section?.({
			name: sectionName,
			order: anyCtx.systemPrompt?.getSectionOrder?.("TOOL_GOAL"),
			text: combined
		});
		logger?.info?.(`策略段 ${sectionName} 已注入（来源 ${policy.source}）`);
	} catch (err) {
		logger?.warn?.(`策略段注入失败（工具面照常）：${String(err?.message ?? err)}`);
	}
}

//#endregion
export { Config, DataforgeError, apply, discoverFlows, foldSummary, inject, loadRunEvents, name, normalizeConfig };