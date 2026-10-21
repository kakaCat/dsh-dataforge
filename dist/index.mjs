import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { chromium } from "playwright-core";

//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.5/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject$1(data) {
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
function deepEqual$1(a, b, strict) {
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
	if (deepEqual$1(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual$1(result, this.meta.default, this.type === "dict")) return null;
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
	if (deepEqual$1(data, value)) return [value];
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
	if (!isPlainObject$1(data)) throw new ValidationError(`expected object but got ${data}`, options);
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
	if (!isPlainObject$1(data)) throw new ValidationError(`expected object but got ${data}`, options);
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
	if (!strict && isPlainObject$1(data)) merge(result, data);
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
	captureChromeChannel: Schema.string().default("chrome"),
	chainRunEnabled: Schema.boolean().default(true),
	chainNodeTimeoutSeconds: Schema.number().default(30),
	chainConcurrency: Schema.number().default(4),
	chainResponseLimitBytes: Schema.number().default(2097152),
	chainCredentialPersistence: Schema.boolean().default(true),
	uiTestEnabled: Schema.boolean().default(true),
	uiStepTimeoutSeconds: Schema.number().default(15),
	uiTestBrowser: Schema.union([
		"auto",
		"playwright",
		"shared",
		"cdp"
	]).default("auto"),
	uiAgentCredentials: Schema.dict(Schema.string()).default({})
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
		captureChromeChannel: raw.captureChromeChannel,
		chainRunEnabled: raw.chainRunEnabled,
		chainNodeTimeoutSeconds: raw.chainNodeTimeoutSeconds,
		chainConcurrency: raw.chainConcurrency,
		chainResponseLimitBytes: raw.chainResponseLimitBytes,
		chainCredentialPersistence: raw.chainCredentialPersistence ?? true,
		uiTestEnabled: raw.uiTestEnabled,
		uiStepTimeoutSeconds: raw.uiStepTimeoutSeconds,
		uiTestBrowser: raw.uiTestBrowser,
		uiAgentCredentials: raw.uiAgentCredentials ?? {}
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
* 读 `run.json` 元数据；目录/文件不存在或 JSON 坏掉一律返回 undefined。
*
* 读侧对未知键完全容忍（链路运行多出的 `chain` 段、未来新增键都不影响旧读者）。
* 返回 undefined 的语义是「这条记录读不出来」，由调用方决定跳过还是计数。
*/
function readRunRecord(dataRoot, runId) {
	const path = join(runsRoot(dataRoot), runId, "run.json");
	if (!existsSync(path)) return void 0;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
		return parsed;
	} catch {
		return;
	}
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
	let terminalCancelled = false;
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
		terminalCancelled = e.cancelled === true;
	} else if (e.event === "result") result = e;
	const success = result?.success ?? terminalSuccess;
	let status;
	if (overrideStatus !== void 0) status = overrideStatus;
	else if (terminalCancelled) status = "killed";
	else if (result === void 0 && terminalMessage === void 0) status = "running";
	else if (success === true) status = "completed";
	else status = "failed";
	const firstTs = numOrUndefined(events[0]?.ts);
	const lastTs = numOrUndefined(events[events.length - 1]?.ts);
	const bizData = plainRecord$3(result?.businessData);
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
		...terminalMessage === void 0 ? {} : { message: terminalMessage },
		...chainSummaryOf(meta, bizData)
	};
}
/**
* 链运行的身份与节点级结果（IF-6）：`meta.chain` 是写入时的快照，
* `result.businessData` 里的 `failedNode` / `completed` 是终态补充。
*
* 没有 `meta.chain` 的旧流程运行返回空对象——只增可选字段，旧 run 不受影响。
*/
function chainSummaryOf(meta, bizData) {
	const chainMeta = plainRecord$3(meta?.chain);
	if (chainMeta === void 0) return {};
	const failedNode = typeof bizData?.["failedNode"] === "string" ? bizData["failedNode"] : void 0;
	const completedRaw = bizData?.["completed"];
	const completedNodes = Array.isArray(completedRaw) ? completedRaw.filter((item) => typeof item === "string") : void 0;
	return { chain: {
		site: typeof chainMeta["site"] === "string" ? chainMeta["site"] : "",
		flow: typeof chainMeta["flow"] === "string" ? chainMeta["flow"] : "",
		version: numOrUndefined(chainMeta["version"]) ?? 0,
		...failedNode === void 0 ? {} : { failedNode },
		...completedNodes === void 0 ? {} : { completedNodes }
	} };
}
function numOrUndefined(value) {
	return typeof value === "number" ? value : void 0;
}
/** 非 plain object（数组/缺失）一律 undefined。 */
function plainRecord$3(value) {
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
/**
* URL/JSON 归一化与模板合成：纯函数、零 I/O。
*
* 归并规则（与测试对齐的两层命令）：
*   - urlTemplate：路径数字/长随机段抽 {p}；query 去重、滤易变键、按**键名**排序、保值 —— 留全值是为了回放；
*     非空 query 用 `?` 拼接（模板本身即合法 URL：能回放、能被面板/工具回执直接辨认，不再用 `:` 这个非法分隔符）；
*   - mergeKey：method + 路径 + ':' + query 键集合 —— 值不入键，跨页同键归并。
*
* @module dsh-dataforge/capture/normalizer
*/
/**
* 每次必变、且变值对回放无意义的 query 键：连同键一起从模板与归并键里剔除。
*
* 只收「无歧义的易变键」——语义参数（哪怕值多变）一律保留，宁可模板啰嗦也不能吞掉真实入参：
*   - 时间戳 / 缓存击穿：t、_t、_、ts、_ts、timestamp、rnd、_r
*   - JSONP 回调：cb、callback、jsonp、jsonpcallback
*   - 会话 / 请求标识：sid、isid、nonce、rsv_t、rsv_pq、token
*/
const VOLATILE = /* @__PURE__ */ new Set([
	"t",
	"_t",
	"_",
	"ts",
	"_ts",
	"timestamp",
	"rnd",
	"_r",
	"cb",
	"callback",
	"jsonp",
	"jsonpcallback",
	"sid",
	"isid",
	"nonce",
	"rsv_t",
	"rsv_pq",
	"token"
]);
const SEGMENT_PARAM = /\/(?:\d+|[a-f0-9][a-f0-9-]{19,})(?=\/|$)/gi;
/**
* `new URL()` 会把路径里的 `{}` 转义成 `%7B…%7D`。
*
* 模板占位符（`{p}`、`{id}`）必须原样保留：一旦落成 `%7Bp%7D`，入库后再归一化一次就完全
* 认不出来了——链上要替换的 `{p}` 没了，执行期只能报「匿名占位符无法给值」。
* 这里只还原**花括号**这一种转义，不动路径里别的 `%xx`（那可能是业务语义，比如 `%2F`）。
*/
function restorePlaceholderBraces(pathname) {
	return pathname.replace(/%7B([A-Za-z0-9_]*)%7D/gi, "{$1}");
}
function normalizeUrlForTemplate(rawUrl) {
	const u = new URL(rawUrl, "http://capture.local");
	const seen = /* @__PURE__ */ new Map();
	for (const [k, v] of u.searchParams.entries()) {
		if (VOLATILE.has(k)) continue;
		if (!seen.has(k)) seen.set(k, v);
	}
	const path = restorePlaceholderBraces(u.pathname).replace(SEGMENT_PARAM, "/{p}");
	const query = sortedParamsToString([...seen.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
	return { urlTemplate: query === "" ? path : `${path}?${query}` };
}
function sortedParamsToString(pairs) {
	return pairs.map(([k, v]) => v === "" ? k : `${k}=${v}`).join("&");
}
/** 归并键：值不入键（键集合排序），同接口跨参数值变化可归并。 */
function mergeKeyOf(method, urlTemplate) {
	const mark = urlTemplate.indexOf("?");
	if (mark === -1) return `${method} ${urlTemplate}`;
	return `${method} ${urlTemplate.slice(0, mark)}:${urlTemplate.slice(mark + 1).split("&").filter((kv) => kv !== "").map((kv) => kv.split("=")[0]).sort().join(",")}`;
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
				if (depth < MAX_TEMPLATE_DEPTH && first !== null && typeof first === "object" && !Array.isArray(first)) {
					walk(first, `${field}[]`, depth + 1);
					continue;
				}
				fields.push({
					field: `${field}[]`,
					type: first === void 0 || first === null ? "null" : typeof first === "number" ? "number" : typeof first === "boolean" ? "boolean" : "string",
					sample: JSON.stringify(value).slice(0, SAMPLE_MAX),
					role: "constant",
					unverified: true
				});
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
/**
* role diff：n≥2 样本里同字段值变 → input（unverified=false）；
* 值恒 → constant；n==1 整体保持 unverified（诚实标注"未验证"）。
*/
function assignRoles(samples) {
	const base = jsonToTemplate(samples[0] ?? {});
	if (samples.length <= 1) return base;
	return {
		fields: base.fields.map((f0) => {
			const bag = /* @__PURE__ */ new Set();
			for (const s of samples) {
				const v = pathAt(s, f0.field);
				bag.add(v === void 0 ? "<undef>" : String(v));
			}
			const role = bag.size > 1 ? "input" : f0.role;
			return {
				...f0,
				role,
				unverified: bag.size <= 1
			};
		}),
		...base.codePath === void 0 ? {} : { codePath: base.codePath }
	};
}
function pathAt(obj, path) {
	let current = obj;
	for (const seg of path.replace(/\[\]/g, "").split(".")) {
		if (Array.isArray(current)) current = current[0];
		if (current !== null && typeof current === "object") current = current[seg];
		else return;
	}
	return current;
}
function pathSegmentsOf(rawUrl) {
	return new URL(rawUrl, "http://capture.local").pathname.split("/").filter((s) => s !== "").map((seg) => {
		try {
			return decodeURIComponent(seg);
		} catch {
			return seg;
		}
	});
}
function queryPairsOf(rawUrl) {
	const u = new URL(rawUrl, "http://capture.local");
	const seen = /* @__PURE__ */ new Map();
	for (const [k, v] of u.searchParams.entries()) {
		if (VOLATILE.has(k)) continue;
		if (!seen.has(k)) seen.set(k, v);
	}
	return [...seen.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}
function jsonBodyOf(raw) {
	if (typeof raw !== "string" || raw.trim().startsWith("{") === false) return void 0;
	try {
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
		return parsed;
	} catch {
		return;
	}
}
/**
* JSON 体扁平成 'path=value'（叶值、深度 2、叶键滤易变键）：指纹与请求体模板共用同一条契约。
*
* 数组是**保序参与**的（物料清单这类入参主体就在数组里）：
* - 基本量数组 → `field[]=[v1,v2,…]`，元素顺序不同即视为不同形态；
* - 对象数组 → 逐元素按 `field[]` 递归展开。
*/
function bodyPairsOf(body) {
	if (body === void 0) return [];
	const out = [];
	const lastSeg = (path) => path.split(".").pop() ?? "";
	const walk = (obj, prefix, depth) => {
		for (const [key, value] of Object.entries(obj)) {
			const field = prefix === "" ? key : `${prefix}.${key}`;
			if (value !== null && typeof value === "object" && !Array.isArray(value)) {
				if (depth < MAX_TEMPLATE_DEPTH) walk(value, field, depth + 1);
				continue;
			}
			if (Array.isArray(value)) {
				const primitives = value.filter((item) => item === null || typeof item !== "object");
				if (primitives.length > 0) out.push(`${field}[]=[${primitives.map((item) => item === null ? "null" : String(item).slice(0, 120)).join(",")}]`);
				if (depth < MAX_TEMPLATE_DEPTH) {
					for (const item of value) if (item !== null && typeof item === "object" && !Array.isArray(item)) walk(item, `${field}[]`, depth + 1);
				}
				if (value.length === 0) out.push(`${field}[]=[]`);
				continue;
			}
			if (VOLATILE.has(lastSeg(field))) continue;
			out.push(`${field}=${value === null ? "null" : String(value).slice(0, 120)}`);
		}
	};
	walk(body, "", 0);
	return out;
}
const FORM_PAIR_RE = /^[^=&\s{}[\]"']+=[^&]*$/;
/**
* 表单体（application/x-www-form-urlencoded）：`a=1&b=2` → 有序键值对。
* multipart / 二进制体解析不了就如实返回 undefined（不猜、不吞成"没有入参"）。
*/
function formPairsOf(raw) {
	if (typeof raw !== "string") return void 0;
	const text = raw.trim();
	if (text.length === 0 || !text.includes("=")) return void 0;
	const parts = text.split("&");
	if (!parts.every((part) => FORM_PAIR_RE.test(part))) return void 0;
	const pairs = [];
	for (const part of parts) {
		const eq = part.indexOf("=");
		const key = part.slice(0, eq);
		if (VOLATILE.has(key)) continue;
		pairs.push([key, part.slice(eq + 1)]);
	}
	return pairs;
}
/** 指纹用体配对：JSON 与表单两条解析路径统一入口，输出按键排序（键序无关）；都解析不了 → []（诚实留空）。 */
function bodyPairsOfRaw(raw) {
	const json = jsonBodyOf(raw);
	if (json !== void 0) return bodyPairsOf(json).sort();
	const form = formPairsOf(raw);
	return form === void 0 ? [] : form.map(([k, v]) => `${k}=${v}`).sort();
}
const FINGERPRINT_INPUT_CAP = 8192;
/**
* 入参指纹（§6.2 rule 2）：归一化后的 query + 请求体（键排序、滤易变键）做稳定哈希。
* 同接口（mergeKey 同）指纹不同 = 不同调用形态 → 关系表各留一行。
*/
function paramsFingerprintOf(rawUrl, requestBody) {
	const query = queryPairsOf(rawUrl).map(([k, v]) => `${k}=${v}`);
	const body = bodyPairsOfRaw(requestBody);
	return sha256(`q:${query.join("&")}|b:${body.join("&")}`.slice(0, FINGERPRINT_INPUT_CAP));
}
function sha256(input) {
	return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
/**
* 接口名的噪声路径段：接口前缀 / 客户端壳层 / 静态资源，不含业务语义。
*
* 与「版本段（v1 / v1.2 / 1.2）、纯数字段、`{p}` 占位段」一起剥掉，剩下的末两段才是名字来源。
* 全小写比较（`API`、`Rest` 同样算噪声）。
*/
const SEMANTIC_NOISE_SEGMENTS = /* @__PURE__ */ new Set([
	"api",
	"apis",
	"sapi",
	"vapi",
	"rest",
	"restapi",
	"openapi",
	"ajax",
	"cgi-bin",
	"web",
	"www",
	"index",
	"index.html",
	"service",
	"services",
	"controller",
	"internal",
	"pub",
	"public",
	"static",
	"assets",
	"pc",
	"h5",
	"app"
]);
/** 占位段（`{p}` / `{id}`）：匿名参数不构成名字。 */
const PLACEHOLDER_SEGMENT_RE = /^\{[^}]*\}$/;
/** 纯数字段（路径 id）：不是名字。 */
const PURE_NUMBER_SEGMENT_RE = /^\d+$/;
/** 版本段：v1 / V2 / v1.2 / 1.2（纯数字段会先被更早的规则剥掉，这里只兜版本形态）。 */
const VERSION_SEGMENT_RE = /^v?\d+(?:\.\d+)*$/i;
/** 单段 humanize：驼峰拆词、`_-.` 变空格、压空白、小写化。 */
function humanizePathSegment(segment) {
	return segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[_\-.\s]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
function isNoisePathSegment(segment) {
	if (segment === "") return true;
	if (PLACEHOLDER_SEGMENT_RE.test(segment)) return true;
	if (PURE_NUMBER_SEGMENT_RE.test(segment)) return true;
	if (VERSION_SEGMENT_RE.test(segment)) return true;
	return SEMANTIC_NOISE_SEGMENTS.has(segment.toLowerCase());
}
/**
* 语义化名称 v2（§6.3 六要素之一）：路径去噪后取**最后两段** humanize，用 ` · ` 连接。
*
* 与 v1 的差别：
*   - 名字**不带方法前缀**（方法在界面上另有徽标，名字只描述接口语义）；
*   - 不只看最后一段：`aichat/api/messages/list` 也读得出 `messages · list`；
*   - 剥掉接口前缀（api/sapi/rest…）、版本段、纯数字 id 与 `{p}` 占位段；
*   - 什么都剥没了才退回 `${method} ${host}`（没有 host 用 capture.local）。
*/
function semanticName(method, urlTemplate) {
	const pathOnly = normalizeUrlForTemplate(urlTemplate).urlTemplate.split("?")[0];
	const picked = pathSegmentsOf(pathOnly).filter((segment) => !isNoisePathSegment(segment)).slice(-2).map(humanizePathSegment).filter((segment) => segment !== "");
	if (picked.length > 0) return picked.join(" · ");
	let host = "";
	try {
		host = new URL(pathOnly, "http://capture.local").host;
	} catch {
		host = "";
	}
	return `${method} ${host === "" ? "capture.local" : host}`;
}
const TOKEN_HEADERS$1 = /* @__PURE__ */ new Set(["authorization", "proxy-authorization"]);
const TOKEN_PARAM_KEYS = /* @__PURE__ */ new Set([
	"token",
	"access_token",
	"access-token",
	"accesstoken",
	"auth_token",
	"auth-token",
	"authtoken",
	"api_key",
	"api-key",
	"apikey",
	"app_token",
	"apptoken"
]);
function classifyAuth(rawUrl, requestHeaders, requestBody) {
	const lowerHeaders = new Map(Object.keys(requestHeaders).map((k) => [k.toLowerCase(), k]));
	const authHeader = [...lowerHeaders.keys()].find((k) => TOKEN_HEADERS$1.has(k));
	if (authHeader !== void 0) return {
		authType: "token-header",
		evidence: `header:${authHeader}`
	};
	const tokenQuery = [...new URL(rawUrl, "http://capture.local").searchParams.keys()].find((k) => TOKEN_PARAM_KEYS.has(k.toLowerCase()));
	if (tokenQuery !== void 0) return {
		authType: "token-param",
		evidence: `query:${tokenQuery}`
	};
	const tokenBody = bodyKeysOf(requestBody).find((k) => TOKEN_PARAM_KEYS.has(k.toLowerCase()));
	if (tokenBody !== void 0) return {
		authType: "token-param",
		evidence: `body:${tokenBody}`
	};
	const cookieHeader = firstHeaderOf(requestHeaders, "cookie");
	if (cookieHeader !== void 0) {
		const sessionName = cookieHeader.split(";").map((p) => (p.split("=")[0] ?? "").trim()).filter((n) => n !== "").find((n) => SESSION_COOKIE_RE.test(n));
		return sessionName === void 0 ? { authType: "none" } : {
			authType: "cookie-session",
			evidence: `header:cookie:${sessionName}`
		};
	}
	if (lowerHeaders.size === 0) return { authType: "unknown" };
	return { authType: "none" };
}
/** 会话风格 cookie 名（启发式，只用于判定，不记录值）：session / sid / token / auth / uid / JSESSIONID / PHPSESSID… */
const SESSION_COOKIE_RE = /(session|sess|sid|token|auth|login|uid|jsessionid|phpsessid|connect\.sid)/i;
function bodyKeysOf(raw) {
	return bodyPairsOfRaw(raw).map((pair) => (pair.split("=")[0] ?? "").split(".").pop() ?? "").filter((k) => k !== "");
}
const CREDENTIAL_HEADERS = /* @__PURE__ */ new Set([
	"cookie",
	"authorization",
	"proxy-authorization",
	"set-cookie"
]);
const HEADER_CONTRACT_KEYS = /* @__PURE__ */ new Set(["content-type", "accept"]);
function newRequestSamplesAcc() {
	return {
		querySamples: [],
		bodySamples: [],
		headerSamples: [],
		pathParams: []
	};
}
/**
* 模板合成样本数上限：同一卡片跨样本 diff 只看最近 N 个样本（内存与 CPU 的诚实上界）。
* 样本计数本身仍由 sample_count 全量累计，不受此上限影响。
*/
const TEMPLATE_DIFF_SAMPLE_CAP = 20;
/** 请求模板合成：query（location=query）+ body（location=body）+ 头契约（location=header）三段并集（codePath 有则附）。 */
function buildRequestTemplate(src) {
	const fields = [];
	fields.push(...queryFieldsOf(src.acc.querySamples, src.sampleTotal));
	const bodySamples = lastOf(src.acc.bodySamples, 20).map(stripVolatileLeaves);
	const assignRolesResult = bodySamples.length > 0 ? assignRoles(bodySamples) : void 0;
	if (assignRolesResult !== void 0) for (const f of assignRolesResult.fields) fields.push({
		...f,
		location: "body"
	});
	fields.push(...headerFieldsOf(src.acc.headerSamples, src.sampleTotal));
	return {
		fields,
		...assignRolesResult?.codePath === void 0 ? {} : { codePath: assignRolesResult.codePath },
		...src.acc.pathParams.length === 0 ? {} : { pathParams: src.acc.pathParams }
	};
}
function queryFieldsOf(samples, sampleTotal) {
	const picked = lastOf(samples, 20);
	const keys = /* @__PURE__ */ new Set();
	for (const pairs of picked) for (const [k] of pairs) keys.add(k);
	const fields = [];
	for (const key of [...keys].sort()) {
		const bag = /* @__PURE__ */ new Set();
		for (const pairs of picked) {
			const hit = pairs.find(([k]) => k === key);
			bag.add(hit === void 0 ? "<undef>" : hit[1]);
		}
		fields.push({
			field: key,
			type: "string",
			sample: [...bag].filter((v) => v !== "<undef>")[0] ?? "",
			role: bag.size > 1 ? "input" : "constant",
			unverified: sampleTotal <= 1 || bag.size <= 1,
			location: "query"
		});
	}
	return fields;
}
function headerFieldsOf(samples, sampleTotal) {
	const picked = lastOf(samples, 20);
	const lowerKeys = /* @__PURE__ */ new Set();
	for (const headers of picked) for (const [k] of Object.entries(headers)) lowerKeys.add(k.toLowerCase());
	const fields = [];
	for (const key of [...lowerKeys].sort()) {
		const isContract = HEADER_CONTRACT_KEYS.has(key) || key.startsWith("x-");
		if (CREDENTIAL_HEADERS.has(key)) {
			fields.push({
				field: key,
				type: "string",
				sample: "",
				role: "credential",
				unverified: false,
				location: "header"
			});
			continue;
		}
		if (!isContract) continue;
		const bag = /* @__PURE__ */ new Set();
		for (const headers of picked) {
			const value = firstHeaderOf(headers, key);
			bag.add(value === void 0 ? "<undef>" : value);
		}
		fields.push({
			field: key,
			type: "string",
			sample: [...bag].filter((v) => v !== "<undef>")[0] ?? "",
			role: bag.size > 1 ? "input" : "constant",
			unverified: sampleTotal <= 1 || bag.size <= 1,
			location: "header"
		});
	}
	return fields;
}
function firstHeaderOf(headers, lowerKey) {
	const hit = Object.keys(headers).find((k) => k.toLowerCase() === lowerKey);
	return hit === void 0 ? void 0 : String(headers[hit]).slice(0, 120);
}
/** 出参模板合成：多形态样本 role diff（样本文本 → JSON）。 */
function buildResponseTemplate(bodyTexts) {
	const bodies = [];
	for (const text of lastOf(bodyTexts, 20)) {
		const parsed = jsonBodyOf(text);
		if (parsed !== void 0) bodies.push(parsed);
	}
	if (bodies.length === 0) return void 0;
	return assignRoles(bodies);
}
function lastOf(items, cap) {
	return items.length <= cap ? items : items.slice(items.length - cap);
}
/** 请求体模板专用：递归剔除 VOLATILE 叶键（与 bodyPairsOf 同口径）——指纹/模板不吃每拍即变的噪声键。 */
function stripVolatileLeaves(body) {
	const out = {};
	for (const [key, value] of Object.entries(body)) {
		if (VOLATILE.has(key)) continue;
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			out[key] = stripVolatileLeaves(value);
			continue;
		}
		if (Array.isArray(value)) {
			out[key] = value.map((item) => item !== null && typeof item === "object" && !Array.isArray(item) ? stripVolatileLeaves(item) : item);
			continue;
		}
		out[key] = value;
	}
	return out;
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
/**
* wire→store 输入：请求体与响应体共用同一条体量上限。
*
* 超限不挂正文（避免把上传/大表单整包灌进盘），但**必须如实置 truncated**——
* 早期实现对超限请求体静默丢正文且不置位，卡上就只剩一个「没有入参的 POST 接口」。
*/
function responseToRawSample(wire, bodyLimit) {
	const body = wire.responseText;
	const responseOversized = body !== void 0 && Buffer.byteLength(body) > bodyLimit;
	const request = wire.requestPostData;
	const requestOversized = request !== void 0 && Buffer.byteLength(request) > bodyLimit;
	return {
		url: wire.url,
		method: wire.method,
		status: wire.status,
		requestHeaders: wire.requestHeaders,
		requestBody: requestOversized ? void 0 : request,
		responseBody: responseOversized ? void 0 : body,
		truncated: responseOversized || requestOversized
	};
}
const PAGE_TITLE_MAX = 300;
const PAGE_SITE_NAME_MAX = 80;
/** 页面内取标题/站点名的表达式（字符串形式：本 tsconfig 不含 DOM lib，且与 session.eval 同风格）。 */
const PAGE_META_SCRIPT = `(() => {
  const contentOf = (selector) => {
    try {
      const el = document.querySelector(selector)
      return el === null ? '' : (el.getAttribute('content') || '')
    } catch (err) {
      return ''
    }
  }
  return {
    title: typeof document.title === 'string' ? document.title : '',
    siteTags: [
      contentOf('meta[property="og:site_name"]'),
      contentOf('meta[name="application-name"]'),
      contentOf('meta[name="apple-mobile-web-app-title"]')
    ]
  }
})()`;
/** 空白压缩：换行/连续空格压成单空格并去首尾（标题里常见「站点 \\n | 页面」）。 */
function cleanMetaText$1(value) {
	if (typeof value !== "string") return "";
	return value.replace(/\s+/g, " ").trim();
}
/**
* 读当前页面的标题与站点名。
*
* - title 来自 `document.title`（≤300 字符）；
* - siteName 依次取 `og:site_name` → `application-name` → `apple-mobile-web-app-title`（≤80 字符）；
* - 读不到/页面已销毁 → 只回 `{ url }`，绝不抛错（采集旁路不因元信息失败中断）。
*/
async function readPageMeta(page) {
	let url = "";
	try {
		url = page.url();
	} catch {
		url = "";
	}
	try {
		const raw = await page.evaluate(PAGE_META_SCRIPT);
		const record = raw !== null && typeof raw === "object" ? raw : {};
		const title = cleanMetaText$1(record.title).slice(0, 300);
		let siteName = "";
		const candidates = Array.isArray(record.siteTags) ? record.siteTags : [];
		for (const candidate of candidates) {
			const cleaned = cleanMetaText$1(candidate);
			if (cleaned !== "") {
				siteName = cleaned.slice(0, 80);
				break;
			}
		}
		return {
			url,
			...title === "" ? {} : { title },
			...siteName === "" ? {} : { siteName }
		};
	} catch {
		return { url };
	}
}
/** 标题上报防抖窗口：SPA 一次导航常连发 load/framenavigated，150ms 内合并成一次读页面。 */
const PAGE_META_DEBOUNCE_MS = 150;
/**
* 起一次会话：无头 chrome（channel: 'chrome' 系统浏览器）
* + 旁路 CDP response 流（只收 xhr/fetch，静态资源全滤）。
* 页面与 context 由 openCapturingPage 拥有，close 也由它交付（SessionRegistry 调 close）。
*/
async function openCapturingPage(channel, onWireSample, options = {}) {
	const { chromium } = await import("playwright-core");
	const browser = await chromium.launch({
		channel,
		headless: options.headless ?? true,
		args: ["--disable-blink-features=AutomationControlled"]
	});
	const context = await browser.newContext();
	if (options.cookies !== void 0 && options.cookies.length > 0) await context.addCookies(options.cookies).catch(() => void 0);
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
				let postRaw = null;
				try {
					postRaw = request.postData();
				} catch {
					postRaw = null;
				}
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
	if (options.onPageMeta !== void 0) {
		const onPageMeta = options.onPageMeta;
		let timer;
		const report = () => {
			if (timer !== void 0) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = void 0;
				readPageMeta(page).then((meta) => onPageMeta(meta)).catch(() => void 0);
			}, PAGE_META_DEBOUNCE_MS);
		};
		page.on("load", report);
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame()) report();
		});
	}
	return {
		browser,
		context,
		page
	};
}

//#endregion
//#region src/capture/token-harvest.ts
/** 单次补采最多扫描的样本数（与 `SAMPLE_LIMIT_PER_RUN` 对齐）。 */
const TOKEN_HARVEST_SAMPLE_LIMIT = 1e3;
/** 单次补采最多读取的既有凭证行（去重基线）。 */
const TOKEN_HARVEST_CREDENTIAL_LIMIT = 1e3;
/** 请求头里的 token 位置（与采集期 `classifyAuth` 的 TOKEN_HEADERS 同源）。 */
const TOKEN_HEADERS = /* @__PURE__ */ new Set(["authorization", "proxy-authorization"]);
/**
* query/body 里的 token 类参数名（与采集期 `classifyAuth` 的 TOKEN_PARAM_KEYS 对齐，
* 另补 `id_token`/`jwt`/`refresh_token` 等 OAuth 常见名）。名称大小写不敏感。
*/
const TOKEN_PARAM_NAMES = /* @__PURE__ */ new Set([
	"token",
	"access_token",
	"access-token",
	"accesstoken",
	"auth_token",
	"auth-token",
	"authtoken",
	"id_token",
	"id-token",
	"jwt",
	"api_key",
	"api-key",
	"apikey",
	"app_token",
	"apptoken",
	"refresh_token",
	"refresh-token",
	"access_key",
	"access-key"
]);
function isTokenParamName(raw) {
	const name = raw.trim().toLowerCase();
	if (name === "") return false;
	if (TOKEN_PARAM_NAMES.has(name)) return true;
	return name.endsWith("_token") || name.endsWith("-token");
}
function headerValue(headers, name) {
	for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === name) return value;
}
/** 从 URL 里检测 token 类 query 参数（`searchParams` 已解码），逐条交给 push。 */
function collectQueryTokens(push, draftUrl) {
	let parsed;
	try {
		parsed = new URL(draftUrl, "http://capture.local");
	} catch {
		return;
	}
	for (const [name, value] of parsed.searchParams.entries()) {
		if (!isTokenParamName(name) || value === "") continue;
		push({
			location: "query",
			name,
			value
		});
	}
}
/** 从 JSON 正文预览里检测顶层 token 类字段；坏 JSON / 非对象一律跳过。 */
function collectBodyTokens(push, preview, contentType) {
	if (preview === void 0 || preview.trim() === "") return;
	if (!((contentType ?? "").toLowerCase().includes("json") || preview.trim().startsWith("{"))) return;
	let raw;
	try {
		raw = JSON.parse(preview);
	} catch {
		return;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
	for (const [name, value] of Object.entries(raw)) {
		if (!isTokenParamName(name) || typeof value !== "string" || value === "") continue;
		push({
			location: "body",
			name,
			value
		});
	}
}
/**
* 检测一条请求样本里的 token 凭证。
*
* 返回顺序固定（header → query → body，各自按出现顺序），同一次检测内按
* `name + url + value` 去重；不读盘、不写盘。
*/
function detectTokenCredentials(sample) {
	const drafts = [];
	const seen = /* @__PURE__ */ new Set();
	const push = (value) => {
		const name = `${value.location}:${value.name.toLowerCase()}`;
		const key = `${name}\u0000${sample.url}\u0000${value.value}`;
		if (seen.has(key)) return;
		seen.add(key);
		drafts.push({
			kind: "token",
			name,
			url: sample.url,
			value
		});
	};
	for (const [rawName, rawValue] of Object.entries(sample.requestHeaders)) {
		const name = rawName.toLowerCase();
		if (!TOKEN_HEADERS.has(name)) continue;
		const value = rawValue.trim();
		if (value === "") continue;
		push({
			location: "header",
			name,
			value
		});
	}
	collectQueryTokens(push, sample.url);
	collectBodyTokens(push, sample.requestBodyPreview, sample.contentType);
	return drafts;
}
/** 解析 `value_json` → token 值；坏 JSON/字段缺失返回 `undefined`（坏行不炸批）。 */
function tokenValueOfJson(valueJson) {
	if (typeof valueJson !== "string" || valueJson === "") return void 0;
	let raw;
	try {
		raw = JSON.parse(valueJson);
	} catch {
		return;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
	const record = raw;
	const location = record["location"];
	const name = record["name"];
	const value = record["value"];
	if (location !== "header" && location !== "query" && location !== "body") return void 0;
	if (typeof name !== "string" || name === "") return void 0;
	if (typeof value !== "string" || value === "") return void 0;
	return {
		location,
		name,
		value
	};
}
/** token 类 query 参数值打码：`?access_token=SECRET` → `?access_token=***`。 */
function maskedUrlOf(url) {
	let parsed;
	try {
		parsed = new URL(url, "http://capture.local");
	} catch {
		return url;
	}
	let changed = false;
	for (const name of [...parsed.searchParams.keys()]) {
		if (!isTokenParamName(name)) continue;
		parsed.searchParams.set(name, "***");
		changed = true;
	}
	if (!changed) return url;
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
}
function tokenKeyOf(name, url, value) {
	return `${name}\u0000${url}\u0000${value}`;
}
/**
* 扫一个 captureId 的请求样本，把还没落库的 token 写成 `credential_events(kind='token')`。
*
* 去重键是 `name + 落库 url + value`：重复调用是幂等的（第二次返回 0）。
* 返回新增条数；调用方负责吞异常（补采失败不该打断采集收口）。
*/
function harvestTokenCredentials(store, captureId) {
	const existing = /* @__PURE__ */ new Set();
	for (const row of store.listCredentials(captureId, TOKEN_HARVEST_CREDENTIAL_LIMIT)) {
		if (row.kind !== "token") continue;
		const value = tokenValueOfJson(row.valueJson);
		if (value === void 0) continue;
		existing.add(tokenKeyOf(row.name, row.url, value.value));
	}
	const seen = /* @__PURE__ */ new Set();
	let added = 0;
	const now = Date.now();
	for (const sample of store.listSamples(captureId, TOKEN_HARVEST_SAMPLE_LIMIT)) {
		const contentType = headerValue(sample.requestHeaders, "content-type");
		const drafts = detectTokenCredentials({
			url: sample.url,
			method: sample.method,
			requestHeaders: sample.requestHeaders,
			...sample.requestBodyPreview === void 0 ? {} : { requestBodyPreview: sample.requestBodyPreview },
			...contentType === void 0 ? {} : { contentType }
		});
		for (const draft of drafts) {
			const url = maskedUrlOf(draft.url);
			const key = tokenKeyOf(draft.name, url, draft.value.value);
			if (seen.has(key) || existing.has(key)) continue;
			seen.add(key);
			store.upsertCredential(captureId, "token", url, draft.name, now, draft.value);
			added += 1;
		}
	}
	return added;
}

//#endregion
//#region src/shared/page-url.ts
/**
* 页面身份归一（采集域「同一个页面」的唯一判定口径，纯函数、零 I/O）。
*
* 背景：旁路采集记的是每个请求发生时的 `page.url()`，而 SPA（百度网盘这类 hash 路由）
* 会在同一个页面上产出多个字面 URL：
*
*   https://pan.baidu.com/disk/main#/index?category=all
*   https://pan.baidu.com/disk/main#/index
*   https://pan.baidu.com/disk/main?_at_=1792240465584#/index?category=all
*
* 三者是同一个页面（同一路由、同一批接口），按字面 URL 分组会把它们拆成三行。
*
* 口径：**页面身份 = 协议 + host + 端口 + 路径 + hash 路由段**。
*
* - 外层 query 与 hash 内 query **都不参与身份**：它们是页面状态/筛选条件（`_at_` 这类
*   反缓存戳、`category=all` 这类筛选），同一页面换状态不该换身份；
* - hash 只有形如 `#/route` / `#!/route` 时才当路由保留（SPA 的页面路由就在 hash 里；
*   hashbang 归一成 `#/route`）；普通锚点（`#section`）不构成另一个页面，丢弃；
* - 路径空 → `/`，非根路径去掉结尾 `/`（`/a/` 与 `/a` 是同一页）；host 大小写与默认端口由 URL 归一；
* - 非 http(s) / 非法 URL 去首尾空白后**原样返回**：采集旁路不允许因为归一化失败丢样本
*   （与指纹口径一致）；
* - 百分号编码不做解码/重编码（`/%7Eu` 与 `/~u`、`%2f` 与 `%2F` 视为不同）：这些差异在
*   真实站点上可能是业务语义，宁可不并也不误并；同一字面写法下函数幂等（`f(f(x)) === f(x)`）。
*
* 落库口径：`pages.url` / 关系行 `page_url` 存身份串；卡上的页面引用与
* `request_samples.page_url` 保留真实访问过的原始 URL（展示/打开/重采与逐请求证据），
* 分组时各消费方再归一一遍。
*
* @module dsh-dataforge/shared/page-url
*/
const HTTP_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:"]);
/** 原始页面 URL → 页面身份（可用作 Map key / 落库的 page_url）。 */
function pageIdentityOf(rawUrl) {
	const raw = rawUrl.trim();
	if (raw === "") return "";
	let parsed;
	try {
		parsed = new URL(raw);
	} catch {
		return raw;
	}
	if (!HTTP_PROTOCOLS.has(parsed.protocol)) return raw;
	return `${parsed.origin}${normalizePath$1(parsed.pathname)}${hashRouteOf(parsed.hash)}`;
}
/** 路径归一：空路径与只有斜杠都是 `/`；其余去掉结尾斜杠。查询串已在上游丢弃。 */
function normalizePath$1(pathname) {
	if (pathname === "" || pathname === "/") return "/";
	const stripped = pathname.replace(/\/+$/, "");
	return stripped === "" ? "/" : stripped;
}
/**
* hash → 路由段（含 `#`，不含 query）。
*
* 只认 `#/…` 与 `#!/…`：普通锚点（`#top`）不是页面，返回空串；
* 根路由（`#/`）等同于无 hash，也返回空串。
*/
function hashRouteOf(hash) {
	if (!hash.startsWith("#")) return "";
	let rest = hash.slice(1);
	if (rest.startsWith("!")) rest = rest.slice(1);
	if (!rest.startsWith("/")) return "";
	const queryAt = rest.indexOf("?");
	if (queryAt !== -1) rest = rest.slice(0, queryAt);
	const route = rest.length > 1 ? rest.replace(/\/+$/, "") : rest;
	return route === "" || route === "/" ? "" : `#${route}`;
}

//#endregion
//#region src/capture/application.ts
const sleep$4 = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
/**
* 单次采集样本上限（§11 A9）：一次 run 至多入库 1000 条样本，超出如实弃采并在 run 上附 notice。
* 用模块常量而非 config 项——上限是采集纪律（验收基准），不是部署调参。
*/
const SAMPLE_LIMIT_PER_RUN = 1e3;
function newCardAcc() {
	return {
		acc: newRequestSamplesAcc(),
		responseTexts: [],
		pageUrls: /* @__PURE__ */ new Map(),
		sampleTotal: 0
	};
}
/** 每卡累计样本封顶（与 normalizer 的 TEMPLATE_DIFF_SAMPLE_CAP 对齐）：内存诚实上界，计数照实。 */
const CARD_ACC_SAMPLE_CAP = 20;
function pushCapped(bag, item, cap) {
	bag.push(item);
	if (bag.length > cap) bag.shift();
}
/** wire→store 桥：样本落库 + 关系/归并卡（自治 job、action 会话、面板采集页共用同一投影）。 */
function wireToStore(deps, captureId, pageIds) {
	const cards = /* @__PURE__ */ new Map();
	let sampleSeen = 0;
	let overLimit = false;
	const pageIdOf = (pageUrl) => {
		const hit = pageIds.get(pageUrl);
		if (hit !== void 0) return hit;
		const id = deps.store.upsertPage(captureId, pageUrl, 0, "ok");
		pageIds.set(pageUrl, id);
		return id;
	};
	return (w) => {
		sampleSeen += 1;
		if (sampleSeen > 1e3) {
			if (!overLimit) {
				overLimit = true;
				deps.store.setRunNotice(captureId, `单次采集样本上限 ${SAMPLE_LIMIT_PER_RUN} 已达，超出部分如实弃采（已采样本完整保留）`);
			}
			return;
		}
		const raw = responseToRawSample(w, deps.config.captureBodyLimitBytes);
		if (raw === void 0) return;
		const pageUrl = pageIdentityOf(w.pageUrl);
		const pageId = pageIdOf(pageUrl);
		const sampleId = deps.store.upsertSample(captureId, pageId, {
			...raw,
			responseHeaders: { "content-type": w.contentType },
			pageUrl: w.pageUrl,
			ts: w.ts,
			bodyLimit: deps.config.captureBodyLimitBytes
		});
		const urlTemplate = normalizeUrlForTemplate(raw.url).urlTemplate;
		const mergeKey = mergeKeyOf(raw.method, urlTemplate);
		const cardAcc = cards.get(mergeKey) ?? newCardAcc();
		cards.set(mergeKey, cardAcc);
		pushCapped(cardAcc.acc.querySamples, queryPairsOf(raw.url), CARD_ACC_SAMPLE_CAP);
		pushCapped(cardAcc.acc.headerSamples, raw.requestHeaders, CARD_ACC_SAMPLE_CAP);
		const bodyJson = jsonBodyOf(raw.requestBody);
		if (bodyJson !== void 0) pushCapped(cardAcc.acc.bodySamples, bodyJson, CARD_ACC_SAMPLE_CAP);
		else {
			const form = formPairsOf(raw.requestBody);
			if (form !== void 0 && form.length > 0) pushCapped(cardAcc.acc.bodySamples, Object.fromEntries(form), CARD_ACC_SAMPLE_CAP);
		}
		const templateSegments = urlTemplate.split("?")[0].split("/").filter((s) => s !== "");
		const rawSegments = pathSegmentsOf(raw.url);
		if (templateSegments.length === rawSegments.length) {
			for (let i = 0; i < templateSegments.length; i += 1) if (templateSegments[i] === "{p}" && !cardAcc.acc.pathParams.includes(rawSegments[i])) cardAcc.acc.pathParams.push(rawSegments[i]);
		}
		if (!cardAcc.pageUrls.has(pageUrl)) cardAcc.pageUrls.set(pageUrl, w.pageUrl);
		cardAcc.sampleTotal += 1;
		if (typeof raw.responseBody === "string" && raw.responseBody !== "") pushCapped(cardAcc.responseTexts, raw.responseBody, CARD_ACC_SAMPLE_CAP);
		const auth = classifyAuth(raw.url, w.requestHeaders, raw.requestBody);
		const cardId = deps.store.upsertCard(captureId, {
			mergeKey,
			method: raw.method,
			urlTemplate,
			name: semanticName(raw.method, urlTemplate),
			relatedPageUrls: [...cardAcc.pageUrls.values()],
			requestTemplate: buildRequestTemplate({
				acc: cardAcc.acc,
				sampleTotal: cardAcc.sampleTotal
			}),
			responseTemplate: buildResponseTemplate(cardAcc.responseTexts),
			...auth.authType === void 0 ? {} : { authType: auth.authType },
			...auth.evidence === void 0 ? {} : { authEvidence: auth.evidence }
		});
		const relationId = deps.store.upsertRelation(captureId, cardId, pageUrl, paramsFingerprintOf(raw.url, raw.requestBody), pageId);
		deps.store.attachSampleRelation(sampleId, relationId);
	};
}
/**
* 页面标题/站点名落库（三条采集路径共用）。
*
* url 先归一到页面身份再 upsert：与样本桥、爬行 page 事件写的是同一行（upsertPage 按
* (capture_id,url) 幂等，后到的 meta 只补非空标题/站点名，不重复计页数）。
* 身份为空（非法 URL）如实丢弃——名称是增强面，不因它中断采集。
*/
function pageMetaSink(deps, captureId) {
	return (meta) => {
		const identity = pageIdentityOf(meta.url);
		if (identity === "") return;
		deps.store.upsertPage(captureId, identity, 0, "ok", {
			...meta.title === void 0 ? {} : { title: meta.title },
			...meta.siteName === void 0 ? {} : { siteName: meta.siteName }
		});
	};
}
/**
* 安全启动后台 job：三种结局都要能落地，不能把异常冒给调用方。
*
* - jobs 服务缺席 → { failure: 'absent' }；
* - 服务在但拒绝（无 agent 归属 / 配额 / 组合未装 tool-jobs）→ start 抛错是**常态**，
*   必须按缺席处理走前台降级，否则调用方拿到异常、run 行永远停在 running（僵尸）；
* - start 返回 thenable 且后来 reject → 同样不能留僵尸：立刻把这个 run 收口为 failed。
*/
function startJobSafely(jobs, spec, onAsyncFailure) {
	const start = jobs?.start;
	if (typeof start !== "function") return { failure: "absent" };
	let started;
	try {
		started = start.call(jobs, spec);
	} catch (err) {
		return { failure: errText$1(err) };
	}
	if (started === void 0 || started === null) return { failure: "empty-handle" };
	const maybeThenable = started;
	if (typeof maybeThenable.then === "function" && typeof maybeThenable.catch === "function") maybeThenable.catch((err) => {
		onAsyncFailure(errText$1(err));
	});
	return { started };
}
function errText$1(err) {
	const message = err?.message;
	return (typeof message === "string" && message.length > 0 ? message : String(err)).slice(0, 200);
}
/** 从采集库的 credential_events 读回 cookie，转成 Playwright addCookies 的形状。 */
function cookiesFromCapture(store, captureId) {
	const cookies = [];
	const now = Date.now() / 1e3;
	for (const row of store.listCredentials(captureId, 500)) {
		if (row.kind !== "cookie" || row.valueJson === void 0) continue;
		let raw;
		try {
			raw = JSON.parse(row.valueJson);
		} catch {
			continue;
		}
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
		const record = raw;
		const name = typeof record["name"] === "string" ? record["name"] : row.name;
		const value = typeof record["value"] === "string" ? record["value"] : "";
		const domain = typeof record["domain"] === "string" && record["domain"] !== "" ? record["domain"] : row.url;
		if (name === "" || domain === "") continue;
		const expires = typeof record["expires"] === "number" && Number.isFinite(record["expires"]) ? record["expires"] : -1;
		if (expires > 0 && expires < now) continue;
		const sameSiteRaw = typeof record["sameSite"] === "string" ? record["sameSite"] : "Lax";
		const sameSite = sameSiteRaw === "Strict" || sameSiteRaw === "Lax" || sameSiteRaw === "None" ? sameSiteRaw : "Lax";
		cookies.push({
			name,
			value,
			domain,
			path: typeof record["path"] === "string" && record["path"] !== "" ? record["path"] : "/",
			expires,
			httpOnly: record["httpOnly"] === true,
			secure: record["secure"] === true,
			sameSite
		});
	}
	return cookies;
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
		const cookies = args.reuseCookiesFrom === void 0 ? [] : cookiesFromCapture(deps.store, args.reuseCookiesFrom);
		const { sessionId } = await deps.registry.open({
			entryUrl,
			captureId,
			...args.headless === void 0 ? {} : { headless: args.headless },
			...cookies.length === 0 ? {} : { cookies }
		});
		deps.registry.bindSink(sessionId, {
			onSample: wireToStore(deps, captureId, /* @__PURE__ */ new Map()),
			onPageMeta: pageMetaSink(deps, captureId)
		});
		return {
			accepted: true,
			gate: "started",
			captureId,
			sessionId,
			...cookies.length === 0 ? {} : { cookiesReused: cookies.length }
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
	const attempt = startJobSafely(deps.resolveJobs(), {
		kind: "dataforge-capture",
		label: `capture ${taskType} ${entry.host}`,
		run: makeAutonomousRun(deps, captureId, taskType, entry, args)
	}, (reason) => {
		deps.store.setRunNotice(captureId, `后台任务启动后失败：${reason}`);
		deps.store.finishRun(captureId, "failed", `后台任务启动后失败：${reason}`);
	});
	if (attempt.started === void 0) {
		const why = attempt.failure === "absent" ? "jobs 服务缺席" : `jobs 服务拒绝（${attempt.failure ?? "unknown"}）`;
		deps.store.setRunNotice(captureId, `${why}，本次采集已前台降级执行`);
		makeAutonomousRun(deps, captureId, taskType, entry, args)({
			id: captureId,
			append: () => void 0,
			updateProgress: () => void 0
		}).done.catch(() => void 0);
		return {
			accepted: true,
			gate: "started",
			captureId,
			degradedNotice: `${why}，本次采集已前台降级执行：仍会完整采集落库，但过程中无法进度查询，仅在完成后可在面板看到结果`
		};
	}
	return {
		accepted: true,
		gate: "started",
		captureId
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
					const pageIds = /* @__PURE__ */ new Map();
					const onWire = wireToStore(deps, captureId, pageIds);
					const { page, context, browser } = await deps.openCapturingPage(deps.config.captureChromeChannel, onWire, { onPageMeta: pageMetaSink(deps, captureId) });
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
									await sleep$4(deps.config.captureStabilityWindowMs);
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
								if (e.kind === "page") {
									const pageUrl = pageIdentityOf(e.url);
									if (!pageIds.has(pageUrl)) pageIds.set(pageUrl, deps.store.upsertPage(captureId, pageUrl, 0, "ok"));
								}
							},
							onSample: () => void 0
						});
						job.updateProgress(`crawl-end pages=${r.pagesVisited} truncated=${r.truncated}`);
					}
					if (browserClosed) return { status: "killed" };
					for (const c of await context.cookies()) deps.store.upsertCredential(captureId, "cookie", String(c["domain"] ?? ""), String(c["name"] ?? ""), Date.now(), c);
					try {
						harvestTokenCredentials(deps.store, captureId);
					} catch {}
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
//#region src/shared/json.ts
/**
* 工具回执的无损 JSON 投影。
*
* 工具的 output 走无损 JSON 校验：值里只要有一个 `undefined` 键，整次调用就会被判
* 「value is not lossless JSON」而失败——而存储层/查询面的行映射器习惯把「缺省的列」
* 直接映射成 undefined（可选字段）。在工具出口统一收口一次，比要求每个查询面各自
* 记住这条纪律更可靠。
*
* 只递归纯对象与数组：Date/Buffer/类实例原样返回（它们不参与工具回执，也不该被拆平）。
*
* @module dsh-dataforge/shared/json
*/
/** 递归丢掉值为 undefined 的对象键（数组按元素递归；非纯对象原样返回）。 */
function lossless(value) {
	if (Array.isArray(value)) return value.map((item) => lossless(item));
	if (value === null || typeof value !== "object") return value;
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return value;
	const out = {};
	for (const [key, item] of Object.entries(value)) {
		if (item === void 0) continue;
		out[key] = lossless(item);
	}
	return out;
}

//#endregion
//#region src/library/store.ts
/**
* 项目接口库的存取面：卡文件（`cards/<cardId>.yaml`）+ 索引（`index.yaml`）。
*
* 纪律（与流程包发现层同哲学）：
*   - **卡文件是权威，索引只是指针**：索引缺失/损坏时按卡文件重建，绝不因为索引坏了就
*     否认盘上已有的卡；
*   - **坏卡不炸批**：单张卡 YAML 坏了 → 跳过它（返回 undefined），由调用方计入 `skipped`；
*   - **写是原子的**：先写 `<file>.tmp` 再 rename，避免半截文件被后续读取当成真卡；
*   - `cardId` 序号式、不复用：序号水位持久化在 `index.yaml` 的 `nextCardSeq`，并取
*     盘上现有卡号的最大值兜底（索引被删也不会撞号）。
*
* @module dsh-dataforge/library/store
*/
/** 库根相对工作区的位置：`.dsh/dataforge/library/`（与 `.dsh/dataforge/flows` 同级）。 */
const LIBRARY_DIR_SEGMENTS = [
	".dsh",
	"dataforge",
	"library"
];
const CARD_ID_RE = /^card_(\d{6,})$/;
const CARD_FILE_RE = /^card_\d{6,}\.yaml$/;
const FIELD_TYPES = /* @__PURE__ */ new Set([
	"string",
	"number",
	"boolean",
	"object",
	"array"
]);
/** 库根（绝对路径）。 */
function libraryRoot(workspaceRoot) {
	return join(workspaceRoot, ...LIBRARY_DIR_SEGMENTS);
}
/** 卡文件目录。 */
function cardsDir(workspaceRoot) {
	return join(libraryRoot(workspaceRoot), "cards");
}
/** 索引文件路径。 */
function indexPath(workspaceRoot) {
	return join(libraryRoot(workspaceRoot), "index.yaml");
}
/** 序号 → cardId（6 位补零，与设计文档 `card_000123` 一致）。 */
function cardIdOf(seq) {
	return `card_${String(seq).padStart(6, "0")}`;
}
/** cardId → 序号；形状不合法返回 undefined。 */
function cardSeqOf(cardId) {
	const match = CARD_ID_RE.exec(cardId);
	return match === null ? void 0 : Number(match[1]);
}
function cardPathOf(workspaceRoot, cardId) {
	return join(cardsDir(workspaceRoot), `${cardId}.yaml`);
}
function writeFileAtomic(path, text) {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, text, "utf8");
	renameSync(tmp, path);
}
/** 站点 host：来源页面里的第一个能解析出 host 的 URL；都解析不出来就是空串（不编造）。 */
function siteOf(card) {
	for (const source of card.sources) for (const page of source.pages) try {
		return new URL(page).host;
	} catch {}
	return "";
}
/** 卡 → 索引条目。 */
function indexEntryOf(card) {
	return {
		cardId: card.cardId,
		file: `cards/${card.cardId}.yaml`,
		mergeKey: card.identity.mergeKey,
		method: card.identity.method,
		urlTemplate: card.identity.urlTemplate,
		site: siteOf(card),
		updatedAt: Date.now()
	};
}
function optString$1(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
function strArray(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function fieldTypeOf$1(value) {
	return typeof value === "string" && FIELD_TYPES.has(value) ? value : "string";
}
function toInput(raw) {
	if (raw === null || typeof raw !== "object") return void 0;
	const record = raw;
	const path = optString$1(record["path"]);
	if (path === void 0) return void 0;
	const role = optString$1(record["role"]);
	return {
		path,
		type: fieldTypeOf$1(record["type"]),
		required: record["required"] === true,
		role: role === "constant" || role === "input" || role === "chain" ? role : "constant",
		...record["unverified"] === true ? { unverified: true } : {}
	};
}
function toOutput(raw) {
	if (raw === null || typeof raw !== "object") return void 0;
	const record = raw;
	const path = optString$1(record["path"]);
	if (path === void 0) return void 0;
	return {
		path,
		type: fieldTypeOf$1(record["type"])
	};
}
function toSource(raw) {
	if (raw === null || typeof raw !== "object") return void 0;
	const record = raw;
	const captureId = optString$1(record["captureId"]);
	if (captureId === void 0) return void 0;
	return {
		captureId,
		pages: strArray(record["pages"]),
		relationIds: strArray(record["relationIds"])
	};
}
const AUTH_TYPES = /* @__PURE__ */ new Set([
	"none",
	"token-header",
	"token-param",
	"cookie-session",
	"unknown"
]);
function toAuth(value) {
	return typeof value === "string" && AUTH_TYPES.has(value) ? value : "unknown";
}
/**
* YAML 文本 → 卡对象。形状不合法（缺 cardId/归并键/入参出参不是数组……）返回 undefined：
* 单张坏卡跳过，不阻断整批导入。
*/
function parseCardFile(text) {
	let doc;
	try {
		doc = yaml.load(text);
	} catch {
		return;
	}
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return void 0;
	const record = doc;
	const cardId = optString$1(record["cardId"]);
	const identity = record["identity"];
	if (cardId === void 0 || cardSeqOf(cardId) === void 0) return void 0;
	if (identity === null || typeof identity !== "object") return void 0;
	const id = identity;
	const mergeKey = optString$1(id["mergeKey"]);
	const method = optString$1(id["method"]);
	const urlTemplate = optString$1(id["urlTemplate"]);
	if (mergeKey === void 0 || method === void 0 || urlTemplate === void 0) return void 0;
	if (!Array.isArray(record["inputs"]) || !Array.isArray(record["outputs"]) || !Array.isArray(record["sources"])) return;
	const authEvidence = optString$1(record["authEvidence"]);
	const name = optString$1(record["name"]);
	const notice = strArray(record["notice"]);
	return {
		cardId,
		kind: "interface-card",
		...name === void 0 ? {} : { name },
		identity: {
			mergeKey,
			method,
			urlTemplate
		},
		inputs: record["inputs"].map(toInput).filter((item) => item !== void 0),
		outputs: record["outputs"].map(toOutput).filter((item) => item !== void 0),
		auth: toAuth(record["auth"]),
		...authEvidence === void 0 ? {} : { authEvidence },
		sources: record["sources"].map(toSource).filter((item) => item !== void 0),
		...notice.length === 0 ? {} : { notice }
	};
}
/** 读一张卡；文件缺失或内容坏了 → undefined（不抛）。 */
function readCard$1(workspaceRoot, cardId) {
	if (cardSeqOf(cardId) === void 0) return void 0;
	const path = cardPathOf(workspaceRoot, cardId);
	if (!existsSync(path)) return void 0;
	try {
		return parseCardFile(readFileSync(path, "utf8"));
	} catch {
		return;
	}
}
/** 盘上所有卡文件的名字（不解析内容；坏文件也在里面，调用方读的时候再跳过）。 */
function listCardIdsOnDisk(workspaceRoot) {
	const dir = cardsDir(workspaceRoot);
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((name) => CARD_FILE_RE.test(name)).map((name) => basename(name, ".yaml")).sort();
}
/** 读全部卡（坏卡跳过，按 cardId 升序）。 */
function listCards(workspaceRoot) {
	const out = [];
	for (const cardId of listCardIdsOnDisk(workspaceRoot)) {
		const card = readCard$1(workspaceRoot, cardId);
		if (card !== void 0) out.push(card);
	}
	return out;
}
/** 卡对象 → YAML 文本（字段顺序固定，便于 git diff 与人工手改）。 */
function dumpCardFile(card) {
	const doc = {
		cardId: card.cardId,
		kind: "interface-card",
		...card.name === void 0 ? {} : { name: card.name },
		identity: {
			mergeKey: card.identity.mergeKey,
			method: card.identity.method,
			urlTemplate: card.identity.urlTemplate
		},
		inputs: card.inputs.map((field) => ({
			path: field.path,
			type: field.type,
			required: field.required,
			role: field.role,
			...field.unverified === true ? { unverified: true } : {}
		})),
		outputs: card.outputs.map((field) => ({
			path: field.path,
			type: field.type
		})),
		auth: card.auth,
		...card.authEvidence === void 0 ? {} : { authEvidence: card.authEvidence },
		sources: card.sources.map((source) => ({
			captureId: source.captureId,
			pages: source.pages,
			relationIds: source.relationIds
		})),
		...card.notice === void 0 || card.notice.length === 0 ? {} : { notice: card.notice }
	};
	return yaml.dump(doc, {
		lineWidth: 120,
		noRefs: true,
		sortKeys: false
	});
}
/** 落盘一张卡（mkdir -p + 原子写）。返回卡文件绝对路径。 */
function writeCard(workspaceRoot, card) {
	mkdirSync(cardsDir(workspaceRoot), { recursive: true });
	const path = cardPathOf(workspaceRoot, card.cardId);
	writeFileAtomic(path, dumpCardFile(card));
	return path;
}
function toIndexEntry(raw) {
	if (raw === null || typeof raw !== "object") return void 0;
	const record = raw;
	const cardId = optString$1(record["cardId"]);
	const mergeKey = optString$1(record["mergeKey"]);
	if (cardId === void 0 || cardSeqOf(cardId) === void 0 || mergeKey === void 0) return void 0;
	return {
		cardId,
		file: optString$1(record["file"]) ?? `cards/${cardId}.yaml`,
		mergeKey,
		method: optString$1(record["method"]) ?? "",
		urlTemplate: optString$1(record["urlTemplate"]) ?? "",
		site: optString$1(record["site"]) ?? "",
		updatedAt: typeof record["updatedAt"] === "number" ? record["updatedAt"] : 0
	};
}
function parseIndexFile(text) {
	let doc;
	try {
		doc = yaml.load(text);
	} catch {
		return;
	}
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return void 0;
	const record = doc;
	if (!Array.isArray(record["cards"])) return void 0;
	const cards = record["cards"].map(toIndexEntry).filter((item) => item !== void 0);
	return {
		apiVersion: "dataforge/v1",
		kind: "interface-library-index",
		nextCardSeq: typeof record["nextCardSeq"] === "number" && record["nextCardSeq"] > 0 ? Math.floor(record["nextCardSeq"]) : 1,
		cards
	};
}
/**
* 读索引。索引缺失或坏了 → **按卡文件重建**（卡文件是权威，索引只是加速器）。
* 永不抛：库里没有卡就是空索引。
*/
function readIndex(workspaceRoot) {
	const path = indexPath(workspaceRoot);
	let index;
	if (existsSync(path)) try {
		index = parseIndexFile(readFileSync(path, "utf8"));
	} catch {
		index = void 0;
	}
	const cards = listCards(workspaceRoot);
	const entries = /* @__PURE__ */ new Map();
	for (const card of cards) entries.set(card.cardId, indexEntryOf(card));
	const merged = [...entries.values()].sort((a, b) => a.cardId < b.cardId ? -1 : 1);
	const maxSeq = listCardIdsOnDisk(workspaceRoot).reduce((acc, cardId) => Math.max(acc, cardSeqOf(cardId) ?? 0), 0);
	return {
		apiVersion: "dataforge/v1",
		kind: "interface-library-index",
		nextCardSeq: Math.max(index?.nextCardSeq ?? 1, maxSeq + 1, 1),
		cards: merged
	};
}
/** 落盘索引（原子写）。 */
function writeIndex(workspaceRoot, index) {
	mkdirSync(libraryRoot(workspaceRoot), { recursive: true });
	const path = indexPath(workspaceRoot);
	writeFileAtomic(path, yaml.dump({
		apiVersion: index.apiVersion,
		kind: index.kind,
		nextCardSeq: index.nextCardSeq,
		cards: index.cards.map((entry) => ({
			cardId: entry.cardId,
			file: entry.file,
			mergeKey: entry.mergeKey,
			method: entry.method,
			urlTemplate: entry.urlTemplate,
			site: entry.site,
			updatedAt: entry.updatedAt
		}))
	}, {
		lineWidth: 120,
		noRefs: true,
		sortKeys: false
	}));
	return path;
}
/**
* 分配一个新 cardId 并把水位推进一位。**不复用**：水位来自 `readIndex` 的
* `nextCardSeq`（它已经取了盘上最大卡号 +1 兜底），删卡也不会把号还回去。
* 返回推进后的索引（调用方继续写卡/写索引，避免同一批导入反复读盘）。
*/
function allocateCardId(workspaceRoot, index) {
	let seq = index.nextCardSeq;
	while (readCard$1(workspaceRoot, cardIdOf(seq)) !== void 0) seq += 1;
	return {
		cardId: cardIdOf(seq),
		index: {
			...index,
			nextCardSeq: seq + 1
		}
	};
}
/** 把一张卡登记进索引（同 cardId 覆盖，新增追加）。 */
function upsertIndexEntry(index, card) {
	const entry = indexEntryOf(card);
	const cards = index.cards.filter((item) => item.cardId !== card.cardId);
	cards.push(entry);
	cards.sort((a, b) => a.cardId < b.cardId ? -1 : 1);
	const seq = cardSeqOf(card.cardId) ?? 0;
	return {
		...index,
		cards,
		nextCardSeq: Math.max(index.nextCardSeq, seq + 1)
	};
}
/**
* 建一张新卡并落盘（分配 cardId → 写卡 → 把索引推进内存态返回）。
* 调用方负责在整批结束后 `writeIndex`，避免逐卡刷盘。
*/
function createCard(workspaceRoot, index, draft) {
	const allocated = allocateCardId(workspaceRoot, index);
	const card = {
		cardId: allocated.cardId,
		...draft
	};
	writeCard(workspaceRoot, card);
	return {
		card,
		index: upsertIndexEntry(allocated.index, card)
	};
}

//#endregion
//#region src/library/import.ts
/**
* 接口库导入：采集库（SQLite）→ 项目接口库（卡文件）。
*
* 三条硬纪律：
*   1. **采集库只读**：本模块自己用 `readonly: true` 打开 SQLite，不走会建表/写事件的
*      `CaptureStore`——导错导坏都不可能影响采集数据；
*   2. **纯增量幂等**：以 `mergeKey` 为天然幂等键（同键即同卡），`sources` 按 captureId
*      去重，重复导入同一 run 结果收敛到同一卡集合、且不重写文件（git 干净）；
*   3. **坏卡不炸批**：单张采集卡数据损坏 → 跳过它、计入 `skipped` 并给中文原因，
*      其余照常导入（与流程包发现"坏 yaml 跳过不炸"同纪律）。
*
* 归并规则（设计 §数据模型）：同 `mergeKey` 即同卡；再导入同卡 = 合并 `sources`、
* 用新样本刷新字段模板（字段并集，类型/角色冲突记 `notice`，保留既有值）。
*
* @module dsh-dataforge/library/import
*/
function libraryError(code, message, hints = []) {
	return Object.assign(new Error(message), {
		name: "LibraryError",
		code,
		hints
	});
}
function parseJson$1(text) {
	if (text === null || text === "") return void 0;
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
}
function parseStringArray(text) {
	const parsed = parseJson$1(text);
	return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
}
/**
* 页面清单按页面身份去重（`shared/page-url` 口径），保留首次出现的原始 URL。
*
* 历史采集库里同一 SPA 页面有多个字面 URL（hash 路由 / `?_at_=` 反缓存戳），
* 卡文件不该把它们当多个页面来源；原始 URL 保留可打开性，去重只压掉同一身份。
*/
function unionPages(pages) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const page of pages) {
		if (page === "") continue;
		const key = pageIdentityOf(page);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(page);
	}
	return out;
}
/** 模板 JSON → Template；**存在但解析不出形状**返回 'broken'（调用方按坏卡跳过）。 */
function parseTemplate(text) {
	if (text === null || text === "") return void 0;
	const parsed = parseJson$1(text);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "broken";
	const fields = parsed["fields"];
	if (!Array.isArray(fields)) return "broken";
	const record = parsed;
	const codePath = typeof record["codePath"] === "string" ? record["codePath"] : void 0;
	const pathParams = Array.isArray(record["pathParams"]) ? record["pathParams"].filter((item) => typeof item === "string") : void 0;
	return {
		fields,
		...codePath === void 0 ? {} : { codePath },
		...pathParams === void 0 ? {} : { pathParams }
	};
}
function parseAuthType(text) {
	const parsed = parseJson$1(text);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { auth: "unknown" };
	const record = parsed;
	const raw = record["authType"];
	const auth = raw === "none" || raw === "token-header" || raw === "token-param" || raw === "cookie-session" ? raw : "unknown";
	const evidence = typeof record["authEvidence"] === "string" && record["authEvidence"] !== "" ? record["authEvidence"] : void 0;
	return {
		auth,
		...evidence === void 0 ? {} : { authEvidence: evidence }
	};
}
/**
* 只读打开采集库并取出导入所需的全部行。
* 库文件不存在 / 没有 interface_cards 表 → `no-capture-data`（诚实空态，不建空库）。
*/
function readCaptureSnapshot(dbPath, captureId) {
	if (!existsSync(dbPath)) throw libraryError("no-capture-data", `采集库不存在：${dbPath}`, ["先让用户跑一次采集（capture 工具或 dataforge_capture），再来导入接口库"]);
	let db;
	try {
		db = new Database(dbPath, {
			readonly: true,
			fileMustExist: true
		});
	} catch (error) {
		throw libraryError("capture-unreadable", `采集库打不开（只读）：${error.message}`, ["确认文件没有被别的进程独占写到一半，或先重跑一次采集"]);
	}
	try {
		const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
		if (!tables.has("interface_cards")) throw libraryError("no-capture-data", "采集库里还没有接口卡表：没有任何采集数据", ["先跑一次采集再导入；接口库导入只读采集库，不会凭空造卡"]);
		const runIds = db.prepare("SELECT id FROM capture_runs ORDER BY started_at DESC").all().map((row) => row.id);
		const hasRelations = tables.has("page_card_relations");
		const hasRuns = tables.has("capture_runs");
		const where = captureId === void 0 ? "" : " WHERE capture_id=?";
		const params = captureId === void 0 ? [] : [captureId];
		const cards = db.prepare(`SELECT id,capture_id,name,url_template,method,request_template_json,response_template_json,auth_json,
                  related_pages_json,sample_count
             FROM interface_cards${where}
            ORDER BY created_at ASC`).all(...params).map((row) => ({
			id: String(row["id"]),
			captureId: String(row["capture_id"]),
			...typeof row["name"] === "string" && row["name"] !== "" ? { name: String(row["name"]) } : {},
			urlTemplate: typeof row["url_template"] === "string" ? row["url_template"] : "",
			method: typeof row["method"] === "string" ? row["method"] : "",
			...typeof row["request_template_json"] === "string" ? { requestTemplateJson: row["request_template_json"] } : {},
			...typeof row["response_template_json"] === "string" ? { responseTemplateJson: row["response_template_json"] } : {},
			...typeof row["auth_json"] === "string" ? { authJson: row["auth_json"] } : {},
			relatedPagesJson: typeof row["related_pages_json"] === "string" ? row["related_pages_json"] : "[]",
			sampleCount: typeof row["sample_count"] === "number" ? row["sample_count"] : 0
		}));
		const relations = hasRelations ? db.prepare(`SELECT id,card_id,capture_id,page_url FROM page_card_relations${captureId === void 0 ? "" : " WHERE capture_id=?"}`).all(...params).map((row) => ({
			id: String(row["id"]),
			cardId: String(row["card_id"]),
			captureId: String(row["capture_id"]),
			pageUrl: typeof row["page_url"] === "string" ? row["page_url"] : ""
		})) : [];
		return {
			runIds: hasRuns ? runIds : [],
			cards,
			relations
		};
	} finally {
		db.close();
	}
}
const LOCATION_PREFIX = {
	query: "query",
	body: "body",
	header: "header",
	path: "path"
};
/** 采集模板的数组记法 `items[]` 统一成库的 `items[*]`（设计文档 §数据模型 的写法）。 */
function normalizeFieldPath(field) {
	return field.replace(/\[\]/g, "[*]");
}
function libraryTypeOf(field) {
	const type = field.type;
	return type === "null" ? "string" : type;
}
function libraryRoleOf(field) {
	return field.role === "input" || field.role === "chain" ? field.role : "constant";
}
function inputPathOf(field) {
	return `${LOCATION_PREFIX[field.location ?? "body"] ?? "body"}.${normalizeFieldPath(field.field)}`;
}
/**
* URL 模板的路径占位符 → 卡上的 `path.*` 入参名。
*
* 关键区别：采集期的 `pathParams` 记的是**采到的真实段值**（`['12345']`），不是参数名——
* 拿它当字段名会产出 `path.12345` 这种垃圾，而且每采到一个新 ID 就多一条，字段表会无限膨胀。
* 所以名字只能从**模板的占位符**来：`/orders/{p}/items` 里的 `{p}` 是采集期把「数字/长随机段」
* 统一抽掉的匿名记号，按出现次序命名为 `p1`、`p2`…；`{id}` 这种具名占位符直接用名字。
*/
function pathParamNamesOf(urlTemplate) {
	const path = urlTemplate.split("?")[0];
	const names = [];
	let anonymous = 0;
	for (const segment of path.split("/")) {
		const match = /^\{([A-Za-z0-9_]+)\}$/.exec(segment.trim());
		if (match === null) continue;
		const raw = match[1];
		if (raw === "p") {
			anonymous += 1;
			names.push(`p${anonymous}`);
			continue;
		}
		names.push(raw);
	}
	return names;
}
function projectInputs(template, urlTemplate) {
	if (template === void 0) return [];
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const name of pathParamNamesOf(urlTemplate)) {
		const path = `path.${name}`;
		if (seen.has(path)) continue;
		seen.add(path);
		out.push({
			path,
			type: "string",
			required: true,
			role: "input"
		});
	}
	for (const field of template.fields) {
		if (field.role === "credential") continue;
		const path = inputPathOf(field);
		if (seen.has(path)) continue;
		seen.add(path);
		const role = libraryRoleOf(field);
		out.push({
			path,
			type: libraryTypeOf(field),
			required: role === "input",
			role,
			...field.unverified === true ? { unverified: true } : {}
		});
	}
	return out;
}
function projectOutputs(template) {
	if (template === void 0) return [];
	const out = [];
	for (const field of template.fields) {
		if (field.role === "credential") continue;
		out.push({
			path: `body.${normalizeFieldPath(field.field)}`,
			type: libraryTypeOf(field)
		});
	}
	return out;
}
function projectCard$1(card, relations) {
	if (card.method === "") return { reason: "采集卡缺 method" };
	if (card.urlTemplate === "") return { reason: "采集卡缺 urlTemplate" };
	const requestTemplate = parseTemplate(card.requestTemplateJson ?? null);
	if (requestTemplate === "broken") return { reason: "请求模板 JSON 结构损坏" };
	const responseTemplate = parseTemplate(card.responseTemplateJson ?? null);
	if (responseTemplate === "broken") return { reason: "响应模板 JSON 结构损坏" };
	const urlTemplate = normalizeUrlForTemplate(card.urlTemplate).urlTemplate;
	const mergeKey = mergeKeyOf(card.method, urlTemplate);
	if (mergeKey === "") return { reason: "归并键为空" };
	const pages = unionPages([...parseStringArray(card.relatedPagesJson), ...relations.map((row) => row.pageUrl)]);
	const relationIds = [...new Set(relations.map((row) => row.id))];
	const auth = parseAuthType(card.authJson ?? null);
	return { draft: {
		kind: "interface-card",
		...card.name === void 0 ? {} : { name: card.name },
		identity: {
			mergeKey,
			method: card.method,
			urlTemplate
		},
		inputs: projectInputs(requestTemplate, urlTemplate),
		outputs: projectOutputs(responseTemplate),
		auth: auth.auth,
		...auth.authEvidence === void 0 ? {} : { authEvidence: auth.authEvidence },
		sources: [{
			captureId: card.captureId,
			pages,
			relationIds
		}]
	} };
}
function mergeSources(existing, incoming) {
	const out = existing.map((source) => ({
		...source,
		pages: [...source.pages],
		relationIds: [...source.relationIds]
	}));
	for (const source of incoming) {
		const hit = out.find((item) => item.captureId === source.captureId);
		if (hit === void 0) {
			out.push({
				captureId: source.captureId,
				pages: [...source.pages],
				relationIds: [...source.relationIds]
			});
			continue;
		}
		hit.pages = unionPages([...hit.pages, ...source.pages]);
		hit.relationIds = [.../* @__PURE__ */ new Set([...hit.relationIds, ...source.relationIds])];
	}
	return out;
}
function mergeInputs(existing, incoming, notice) {
	const out = existing.map((field) => ({ ...field }));
	for (const field of incoming) {
		const hit = out.find((item) => item.path === field.path);
		if (hit === void 0) {
			out.push({ ...field });
			continue;
		}
		if (hit.type !== field.type) notice.push(`入参 ${field.path} 类型冲突：既有 ${hit.type}，新样本 ${field.type}（保留既有）`);
		if (hit.role !== field.role) notice.push(`入参 ${field.path} 角色冲突：既有 ${hit.role}，新样本 ${field.role}（保留既有）`);
		if (field.unverified !== true) delete hit.unverified;
		if (field.required) hit.required = true;
	}
	return out;
}
function mergeOutputs(existing, incoming, notice) {
	const out = existing.map((field) => ({ ...field }));
	for (const field of incoming) {
		const hit = out.find((item) => item.path === field.path);
		if (hit === void 0) {
			out.push({ ...field });
			continue;
		}
		if (hit.type !== field.type) notice.push(`出参 ${field.path} 类型冲突：既有 ${hit.type}，新样本 ${field.type}（保留既有）`);
	}
	return out;
}
const AUTH_RANK = {
	unknown: 0,
	none: 1,
	"token-param": 2,
	"token-header": 2,
	"cookie-session": 2
};
function mergeAuth(existing, draft, notice) {
	const keep = {
		auth: existing.auth,
		...existing.authEvidence === void 0 ? {} : { authEvidence: existing.authEvidence }
	};
	if (existing.auth === draft.auth) return {
		auth: existing.auth,
		...(existing.authEvidence ?? draft.authEvidence) === void 0 ? {} : { authEvidence: existing.authEvidence ?? draft.authEvidence }
	};
	if (AUTH_RANK[draft.auth] > AUTH_RANK[existing.auth]) return {
		auth: draft.auth,
		...draft.authEvidence === void 0 ? {} : { authEvidence: draft.authEvidence }
	};
	notice.push(`鉴权标志冲突：既有 ${existing.auth}，新样本 ${draft.auth}（保留既有）`);
	return keep;
}
function sameJson(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
/** 归并一张既有卡；`changed === false` 表示与原卡完全一致（不重写文件，保住幂等与 git 干净）。 */
function mergeCard(existing, draft) {
	const notice = [...existing.notice ?? []];
	const merged = {
		...existing,
		inputs: mergeInputs(existing.inputs, draft.inputs, notice),
		outputs: mergeOutputs(existing.outputs, draft.outputs, notice),
		...mergeAuth(existing, draft, notice),
		sources: mergeSources(existing.sources, draft.sources)
	};
	if (existing.name === void 0 && draft.name !== void 0) merged.name = draft.name;
	const nextNotice = [...new Set(notice)];
	if (nextNotice.length > 0) merged.notice = nextNotice;
	const changed = !sameJson(merged, existing);
	return {
		card: changed ? merged : existing,
		changed
	};
}
/**
* 导入接口库（IF-1）。
*
* `captureId` 缺省时只处理"尚未导入完"的 run：某 run 的每张卡都已在 sources 里记过
* 该 captureId 才算导完；已有卡+新采集卡并存时照样会补进来（幂等且不丢新数据）。
*
* @throws LibraryError `no-capture-data`（无采集库/无卡）/ `capture-unreadable`（库打不开）
*/
function importLibrary(options) {
	const { workspaceRoot, captureDbPath, captureId } = options;
	const snapshot = readCaptureSnapshot(captureDbPath, captureId);
	const root = libraryRoot(workspaceRoot);
	if (snapshot.cards.length === 0) throw libraryError("no-capture-data", captureId === void 0 ? "采集库里还没有任何接口卡" : `采集 ${captureId} 里没有接口卡`, ["先让用户做一次采集（至少抓到一个 XHR/fetch 请求），再来导入接口库"]);
	let index = readIndex(workspaceRoot);
	const cardsByMergeKey = /* @__PURE__ */ new Map();
	for (const entry of index.cards) {
		if (cardsByMergeKey.has(entry.mergeKey)) continue;
		const file = readCard$1(workspaceRoot, entry.cardId);
		if (file !== void 0) cardsByMergeKey.set(entry.mergeKey, file);
	}
	const createdIds = /* @__PURE__ */ new Set();
	const merged = /* @__PURE__ */ new Set();
	const unchanged = /* @__PURE__ */ new Set();
	const skippedDetails = [];
	const touched = /* @__PURE__ */ new Set();
	const captureIds = /* @__PURE__ */ new Set();
	const relationsByCard = /* @__PURE__ */ new Map();
	for (const relation of snapshot.relations) {
		const list = relationsByCard.get(relation.cardId);
		if (list === void 0) relationsByCard.set(relation.cardId, [relation]);
		else list.push(relation);
	}
	for (const raw of snapshot.cards) {
		const projection = projectCard$1(raw, relationsByCard.get(raw.id) ?? []);
		if ("reason" in projection) {
			skippedDetails.push({
				captureId: raw.captureId,
				mergeKey: `${raw.method} ${raw.urlTemplate}`,
				reason: projection.reason
			});
			continue;
		}
		const draft = projection.draft;
		const existing = cardsByMergeKey.get(draft.identity.mergeKey);
		if (existing === void 0) {
			const created = createCard(workspaceRoot, index, draft);
			index = created.index;
			cardsByMergeKey.set(draft.identity.mergeKey, created.card);
			createdIds.add(created.card.cardId);
			touched.add(created.card.cardId);
			captureIds.add(raw.captureId);
			continue;
		}
		const result = mergeCard(existing, draft);
		cardsByMergeKey.set(draft.identity.mergeKey, result.card);
		if (!result.changed) {
			unchanged.add(result.card.cardId);
			touched.add(result.card.cardId);
			captureIds.add(raw.captureId);
			continue;
		}
		writeCard(workspaceRoot, result.card);
		index = upsertIndexEntry(index, result.card);
		merged.add(result.card.cardId);
		touched.add(result.card.cardId);
		captureIds.add(raw.captureId);
	}
	if (createdIds.size > 0 || merged.size > 0) writeIndex(workspaceRoot, index);
	return lossless({
		imported: createdIds.size,
		merged: merged.size,
		unchanged: unchanged.size,
		skipped: skippedDetails.length,
		cardIds: [...touched].sort(),
		skippedDetails,
		captureIds: [...captureIds].sort(),
		libraryRoot: root
	});
}

//#endregion
//#region src/chains/schema.ts
/**
* 链（chain）与项目接口卡的共享契约：YAML 形状 + 类型 + 解析入口。
*
* 全部用 type 别名：工具 output.schema 推断要求 Record 兼容（interface 会被
* 没有 implicit index signature 的规则卡死，见 src/shared/capture-types.ts 的同款警告）。
*
* 边界（重要）：schemastery 的 object 既不报未知键、也不保留它们（实测：多余键被丢掉），
* 所以它只负责形状与必填；悬空卡引用、成环、绑定字段存在性、绑定与常量互斥、
* 僵尸槽位这些语义检查全在 validate.ts —— 严格性来自显式检查，不来自 schema。
* 未知键的保留由 normalizeDoc 从原始映射里捞回（IF-3 承诺"未知字段原样保留不丢"）。
*
* 绑定路径用自定义点路径，不用 JSONPath：
*   - `<节点 id>.<字段路径>`，如 `query-material.body.items[0].internalId`
*   - 节点 id 因此不许带 `.`（validate 会报）
*   - `[n]` / `[*]` / `[]` 在比对时视作同一个占位（卡模板用 `[*]`，手写常用 `[0]`）
*
* 链级入参槽位（FR-1.7）的引用语法：常量值或边的 from 写 `$inputs.<name>`。
* 文档没定这条语法（见 r1 设计「开放问题」），这里定成显式前缀，便于 grep 与校验；
* R-6 结晶只需把用户给的值替换成槽位引用即可。
*
* @module dsh-dataforge/chains/schema
*/
/** 链文件格式版本；写进每份链文件，未来演进走它。 */
const CHAIN_API_VERSION = "dataforge/v1";
/** 链级入参槽位引用前缀：`$inputs.materialCodes`。 */
const INPUT_SLOT_PREFIX = "$inputs.";
/** 链级入参槽位的类型词表（与卡的字段类型同源，数组用 `array<T>` 写）。 */
const CHAIN_VALUE_TYPES = [
	"string",
	"number",
	"boolean",
	"object",
	"array",
	"null",
	"array<string>",
	"array<number>",
	"array<boolean>",
	"array<object>"
];
const IoFieldSchema = Schema.object({
	path: Schema.string().required(),
	type: Schema.string().required(),
	required: Schema.boolean(),
	role: Schema.string()
});
const CardSourceSchema = Schema.object({
	captureId: Schema.string().required(),
	pages: Schema.array(Schema.string()),
	relationIds: Schema.array(Schema.string())
});
const InterfaceCardSchema = Schema.object({
	cardId: Schema.string().required(),
	kind: Schema.const("interface-card").required(),
	identity: Schema.object({
		mergeKey: Schema.string().required(),
		method: Schema.string().required(),
		urlTemplate: Schema.string().required()
	}).required(),
	inputs: Schema.array(IoFieldSchema).default([]),
	outputs: Schema.array(IoFieldSchema).default([]),
	auth: Schema.string(),
	authEvidence: Schema.string(),
	sources: Schema.array(CardSourceSchema),
	name: Schema.string()
});
/** 常量值允许裸写数字/布尔（YAML 里 2120 不是字符串），落地时统一成字符串。 */
const ConstantValueSchema = Schema.union([
	Schema.string(),
	Schema.number(),
	Schema.boolean()
]);
/**
* 画布坐标。内层 x/y **刻意不 required**：schemastery 对可选的对象字段会先实例化成
* `{}` 再往里校验，写 required 就成了「没坐标的链一律校验失败」。是否算有效坐标由
* normalizeDoc 判（两个都是有限数才算），这样缺坐标 = 没有 layout，而不是坏链。
*/
const LayoutSchema = Schema.object({
	x: Schema.number(),
	y: Schema.number()
});
const NodeSchema = Schema.object({
	id: Schema.string().required(),
	card: Schema.string(),
	page: Schema.string(),
	constants: Schema.dict(ConstantValueSchema).default({}),
	files: Schema.dict(Schema.string()),
	baseUrl: Schema.string(),
	hashes: Schema.dict(Schema.string()),
	expect: Schema.any(),
	expects: Schema.any(),
	retry: Schema.number().min(0),
	timeoutSeconds: Schema.number().min(0),
	layout: LayoutSchema
});
const EdgeSchema = Schema.object({
	from: Schema.string().required(),
	to: Schema.string().required(),
	suggested: Schema.boolean(),
	transform: Schema.union([
		Schema.const("string"),
		Schema.const("json"),
		Schema.const("array-json")
	]),
	pick: Schema.any()
});
const InputSchema = Schema.object({
	name: Schema.string().required(),
	type: Schema.string().required(),
	required: Schema.boolean().default(false),
	example: Schema.string()
});
const MetaSchema = Schema.object({
	site: Schema.string().required(),
	flow: Schema.string().required(),
	version: Schema.number().min(1).required(),
	created: Schema.string().required(),
	domain: Schema.string(),
	note: Schema.string(),
	source: Schema.union([
		Schema.const("agent"),
		Schema.const("canvas"),
		Schema.const("import")
	])
});
const ChainSchema = Schema.object({
	apiVersion: Schema.string().required(),
	kind: Schema.union([Schema.const("interface-chain"), Schema.const("page-chain")]).required(),
	meta: MetaSchema.required(),
	inputs: Schema.array(InputSchema).default([]),
	nodes: Schema.array(NodeSchema).required(),
	edges: Schema.array(EdgeSchema).default([]),
	cleanup: Schema.any(),
	verify: Schema.any()
});
/**
* 从 schemastery 的报错里摘出字段路径。
*
* 实测：ValidationError 只有 `options`/`name` 两个自有键，`err.path`/`err.detail` 都是
* undefined，路径只能从 message 里取（形如 `$.nodes[0].card missing required value`）。
*/
function schemaErrorPath(message) {
	const text = message.trim();
	if (!text.startsWith("$")) return "";
	return text.slice(1).replace(/^\./, "").split(/\s/)[0] ?? "";
}
/** 把路径收敛成 issue 的 target（`nodes[0].card` → `nodes[0]`）。 */
function issueTargetOf(path) {
	const hit = /^(nodes|edges|inputs|meta)(\[\d+\])?/.exec(path);
	if (hit) return `${hit[1]}${hit[2] ?? ""}`;
	return path || "chain";
}
/**
* IF-2 的错误码归类：整批问题都是"卡没导入"时给 `card-not-imported`（提示先跑 IF-1），
* 其余一律 `invalid-chain`。混合时按 `invalid-chain` 报，但 issues 里逐条仍带各自 code。
*/
function chainErrorCode(issues) {
	if (issues.length > 0 && issues.every((issue) => issue.code === "card-not-imported")) return "card-not-imported";
	return "invalid-chain";
}
/** 字段路径 → 段数组；`[0]`/`[*]`/`[]` 都归一成 `[*]`（卡模板与手写路径才能对上）。 */
function fieldSegments(path) {
	return path.replace(/\[\s*\d*\s*\]/g, "[*]").split(".").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}
/** `<节点 id>.<字段路径>` → 两段；无 `.` 或 id 为空返回 undefined。 */
function splitBindingPath(path) {
	const dot = path.indexOf(".");
	if (dot <= 0 || dot === path.length - 1) return void 0;
	return {
		nodeId: path.slice(0, dot),
		fieldPath: path.slice(dot + 1)
	};
}
/** 是否是链级槽位引用（`$inputs.materialCodes`）。 */
function isInputSlotRef(value) {
	return value.startsWith("$inputs.") && value.length > 8;
}
/** 取槽位名；不是槽位引用返回 undefined。 */
function inputSlotNameOf(value) {
	return isInputSlotRef(value) ? value.slice(8) : void 0;
}
/**
* 绑定路径是否落在卡字段表里。
*
* 规则：归一段逐段相等；或绑定路径下钻到某个已声明的 object/array 字段内部
* （卡模板只声明到容器时仍允许绑它下面的字段，别拿"模板粗"当"路径错"）。
*/
function isFieldDeclared(bindingPath, fields) {
	const target = fieldSegments(bindingPath);
	if (target.length === 0) return false;
	const same = (left, right) => left.length === right.length && left.every((segment, index) => segment.replace(/\[\*\]$/, "") === right[index].replace(/\[\*\]$/, ""));
	for (const field of fields) {
		const declared = fieldSegments(field.path);
		if (declared.length === 0) continue;
		if (same(declared, target)) return true;
		if (declared.length < target.length && declared.every((segment, index) => segment.replace(/\[\*\]$/, "") === target[index].replace(/\[\*\]$/, "")) && (field.type === "object" || field.type.startsWith("array"))) return true;
	}
	return false;
}
/** 绑定路径是否是某个已声明字段的容器前缀（例如 body.list 之于 body.list[*].fs_id）。 */
function isDeclaredContainer(bindingPath, fields) {
	const target = fieldSegments(bindingPath);
	if (target.length === 0) return false;
	return fields.some((field) => {
		const declared = fieldSegments(field.path);
		return declared.length > target.length && target.every((segment, index) => segment.replace(/\[\*\]$/, "") === declared[index].replace(/\[\*\]$/, ""));
	});
}
/** 卡字段表里找同路径的声明（constants 合法性提示用）。 */
function findDeclaredField(bindingPath, fields) {
	const target = fieldSegments(bindingPath);
	return fields.find((field) => {
		const declared = fieldSegments(field.path);
		return declared.length === target.length && declared.every((segment, index) => segment === target[index]);
	});
}
function issueOfSchemaFailure(error) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		target: issueTargetOf(schemaErrorPath(message)),
		code: "invalid-chain",
		reason: `schema 校验失败：${message}`
	};
}
/** 把 schema 产物收敛成规范化的 ChainDoc（默认值补齐 + 常量统一成字符串）。 */
/** 把 YAML 里的 expect 收敛成类型；缺 path/equals 视为没写。 */
function normalizeExpect$1(raw) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
	const record = raw;
	const path = record["path"];
	const equals = record["equals"];
	if (typeof path !== "string" || path === "" || equals === void 0) return void 0;
	if (typeof equals !== "string" && typeof equals !== "number" && typeof equals !== "boolean") return void 0;
	return {
		path,
		equals
	};
}
/** expect 数组：非法项丢弃；空数组视为没写。 */
function normalizeExpects(raw) {
	if (!Array.isArray(raw)) return void 0;
	const out = raw.map(normalizeExpect$1).filter((item) => item !== void 0);
	return out.length === 0 ? void 0 : out;
}
/** 把 YAML 里的 pick 收敛成类型；缺 match/field 视为没写（不静默猜）。 */
function normalizePick(raw) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
	const record = raw;
	const match = record["match"];
	if (typeof match !== "object" || match === null || Array.isArray(match)) return void 0;
	const matchRecord = match;
	const field = matchRecord["field"];
	const equals = matchRecord["equals"];
	if (typeof field !== "string" || field === "" || equals === void 0) return void 0;
	if (typeof equals !== "string" && typeof equals !== "number" && typeof equals !== "boolean") return void 0;
	const take = record["field"];
	return {
		match: {
			field,
			equals
		},
		...typeof take === "string" && take !== "" ? { field: take } : {}
	};
}
/** cleanup 收敛：只认明确的 site/flow/when；输入必须是字符串映射。 */
function normalizeCleanup(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return void 0;
	const record = raw;
	const chainRaw = record["chain"];
	if (chainRaw === null || typeof chainRaw !== "object" || Array.isArray(chainRaw)) return void 0;
	const chain = chainRaw;
	const site = typeof chain["site"] === "string" ? chain["site"].trim() : "";
	const flow = typeof chain["flow"] === "string" ? chain["flow"].trim() : "";
	if (site === "" || flow === "") return void 0;
	const version = chain["version"];
	const inputsRaw = record["inputs"];
	const inputs = {};
	if (inputsRaw !== null && typeof inputsRaw === "object" && !Array.isArray(inputsRaw)) {
		for (const [key, value] of Object.entries(inputsRaw)) if (typeof value === "string") inputs[key] = value;
	}
	return {
		when: record["when"] === "always" ? "always" : "onFailure",
		chain: {
			site,
			flow,
			...typeof version === "number" && Number.isInteger(version) && version >= 1 ? { version } : {}
		},
		...Object.keys(inputs).length === 0 ? {} : { inputs }
	};
}
/** verify 收敛：when 缺省 onSuccess；site/flow 必填。 */
function normalizeVerify(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return void 0;
	const record = raw;
	const uiRaw = record["ui"];
	if (uiRaw === null || typeof uiRaw !== "object" || Array.isArray(uiRaw)) return void 0;
	const ui = uiRaw;
	const site = typeof ui["site"] === "string" ? ui["site"].trim() : "";
	const flow = typeof ui["flow"] === "string" ? ui["flow"].trim() : "";
	if (site === "" || flow === "") return void 0;
	const version = ui["version"];
	const inputsRaw = record["inputs"];
	const inputs = {};
	if (inputsRaw !== null && typeof inputsRaw === "object" && !Array.isArray(inputsRaw)) {
		for (const [key, value] of Object.entries(inputsRaw)) if (typeof value === "string") inputs[key] = value;
	}
	return {
		when: record["when"] === "always" ? "always" : record["when"] === "onFailure" ? "onFailure" : "onSuccess",
		ui: {
			site,
			flow,
			...typeof version === "number" && Number.isInteger(version) && version >= 1 ? { version } : {}
		},
		...Object.keys(inputs).length === 0 ? {} : { inputs }
	};
}
function normalizeDoc(raw) {
	const doc = raw;
	const docUnknown = unknownKeysOf(doc);
	delete docUnknown.cleanup;
	delete docUnknown.verify;
	return {
		...docUnknown,
		apiVersion: doc.apiVersion,
		kind: doc.kind,
		meta: {
			...unknownKeysOf(doc.meta),
			site: doc.meta.site,
			flow: doc.meta.flow,
			version: doc.meta.version,
			created: toIsoString(doc.meta.created),
			...doc.meta.domain === void 0 ? {} : { domain: doc.meta.domain },
			...doc.meta.note === void 0 ? {} : { note: doc.meta.note },
			...doc.meta.source === void 0 ? {} : { source: doc.meta.source }
		},
		inputs: (doc.inputs ?? []).map((input) => ({
			...unknownKeysOf(input),
			name: input.name,
			type: input.type,
			required: input.required === true,
			...input.example === void 0 ? {} : { example: input.example }
		})),
		nodes: (doc.nodes ?? []).map((node) => {
			const rest = unknownKeysOf(node);
			delete rest.layout;
			delete rest.files;
			delete rest.baseUrl;
			delete rest.hashes;
			delete rest.expect;
			delete rest.expects;
			const layout = nodeLayoutOf(node.layout);
			return {
				...rest,
				id: node.id,
				...node.card === void 0 ? {} : { card: node.card },
				...node.page === void 0 ? {} : { page: node.page },
				constants: Object.fromEntries(Object.entries(node.constants ?? {}).map(([key, value]) => [key, String(value)])),
				...node.baseUrl === void 0 || node.baseUrl === "" ? {} : { baseUrl: node.baseUrl },
				...node.files === void 0 || Object.keys(node.files).length === 0 ? {} : { files: { ...node.files } },
				...node.hashes === void 0 || Object.keys(node.hashes).length === 0 ? {} : { hashes: { ...node.hashes } },
				...normalizeExpect$1(node.expect) === void 0 ? {} : { expect: normalizeExpect$1(node.expect) },
				...normalizeExpects(node.expects) === void 0 ? {} : { expects: normalizeExpects(node.expects) },
				...node.retry === void 0 ? {} : { retry: node.retry },
				...node.timeoutSeconds === void 0 ? {} : { timeoutSeconds: node.timeoutSeconds },
				...layout === void 0 ? {} : { layout }
			};
		}),
		edges: (doc.edges ?? []).map((edge) => ({
			...unknownKeysOf(edge),
			from: edge.from,
			to: edge.to,
			...edge.suggested === true ? { suggested: true } : {},
			...edge.transform === void 0 ? {} : { transform: edge.transform },
			...normalizePick(edge.pick) === void 0 ? {} : { pick: normalizePick(edge.pick) }
		})),
		...normalizeCleanup(doc.cleanup) === void 0 ? {} : { cleanup: normalizeCleanup(doc.cleanup) },
		...normalizeVerify(doc.verify) === void 0 ? {} : { verify: normalizeVerify(doc.verify) }
	};
}
/**
* 画布坐标的有效性判定：x/y 都是有限数才算有坐标。
*
* schemastery 会把缺省的对象字段实例化成 `{}`，所以这里必须挡住"半个坐标"与空对象——
* 否则无坐标的链会被写成 `layout: {x: null, y: null}`。
*/
function nodeLayoutOf(layout) {
	if (layout === null || typeof layout !== "object") return void 0;
	const { x, y } = layout;
	return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? {
		x,
		y
	} : void 0;
}
/**
* 只留 schema 不认识的键：schemastery 的 object 会把未知键**丢掉**（不报错），
* 所以从原始映射里把它们捞回来——IF-3 承诺"未知字段原样保留不丢"，靠这一步兑现。
*/
function unknownKeysOf(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}
/** YAML 1.1 的时间戳可能被解析成 Date；链里的 created 统一成 ISO 字符串。 */
function toIsoString(value) {
	if (value instanceof Date) return value.toISOString();
	return typeof value === "string" ? value : String(value);
}
/**
* 校验器调用壳：schemastery 的调用签名要求具体对象类型，而我们的输入来自
* YAML/工具入参（unknown）——形状是否合法正是它要判的事，所以这里显式放宽。
*/
function callSchema(schema, value) {
	return schema(value);
}
/** 已解析的 YAML 值 → ChainDoc；只做形状/必填（语义在 validate.ts）。 */
function parseChainDoc(raw) {
	try {
		return {
			ok: true,
			doc: normalizeDoc(callSchema(ChainSchema, raw))
		};
	} catch (error) {
		return {
			ok: false,
			issues: [issueOfSchemaFailure(error)]
		};
	}
}
/** 链 YAML 文本 → ChainDoc；YAML 语法错也算 `invalid-chain`。 */
function parseChainYaml(text) {
	let raw;
	try {
		raw = loadYamlValue$1(text);
	} catch (error) {
		return {
			ok: false,
			issues: [{
				target: "chain",
				code: "invalid-chain",
				reason: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`
			}]
		};
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {
		ok: false,
		issues: [{
			target: "chain",
			code: "invalid-chain",
			reason: "链文件必须是一个 YAML 映射（key: value）"
		}]
	};
	return parseChainDoc(raw);
}
/** 卡 YAML 文本 → InterfaceCardDoc（undefined = 文件坏了/不是卡）。 */
function parseCardDoc(raw) {
	try {
		const card = callSchema(InterfaceCardSchema, raw);
		return {
			...card,
			inputs: card.inputs ?? [],
			outputs: card.outputs ?? []
		};
	} catch {
		return;
	}
}
/**
* YAML 文本 → JS 值（CORE schema：不把 `created: 2026-10-17T12:00:00Z` 解析成 Date）。
*
* 链/卡文件是给人手改的项目资产，时间戳就该是字符串；YAML 1.1 的 timestamp 类型
* 会让 `Schema.string()` 报"expected string but got ..."，纯属坑人。
*/
function loadYamlValue$1(text) {
	return yaml.load(text, { schema: yaml.CORE_SCHEMA });
}
/** ChainDoc → 链 YAML 文本（读回时手改过的字段原样保留，不丢未知键）。 */
function chainToYaml(doc) {
	return yaml.dump(doc, {
		lineWidth: 120,
		noRefs: true,
		sortKeys: false
	});
}

//#endregion
//#region src/chains/validate.ts
/** 原始值（YAML 已解析 / 工具入参）→ 校验通过的 ChainDoc；问题逐条返回。 */
function validateChain(input, options) {
	const parsed = parseChainDoc(input);
	if (!parsed.ok) return parsed;
	const issues = checkChain(parsed.doc, options.resolveCard);
	return issues.length === 0 ? {
		ok: true,
		doc: parsed.doc
	} : {
		ok: false,
		issues
	};
}
/** 链 YAML 文本 → 校验通过的 ChainDoc（IF-2 的入口）。 */
function validateChainYaml(text, options) {
	const parsed = parseChainYaml(text);
	if (!parsed.ok) return parsed;
	const issues = checkChain(parsed.doc, options.resolveCard);
	return issues.length === 0 ? {
		ok: true,
		doc: parsed.doc
	} : {
		ok: false,
		issues
	};
}
/** 全量语义检查（纯函数，无 IO）。 */
function checkChain(doc, resolveCard) {
	const issues = [];
	if (doc.apiVersion !== "dataforge/v1") issues.push({
		target: "chain",
		code: "invalid-chain",
		reason: `apiVersion 必须是 ${CHAIN_API_VERSION}，实际是 ${String(doc.apiVersion)}`
	});
	if (doc.nodes.length === 0) issues.push({
		target: "nodes",
		code: "invalid-chain",
		reason: "链至少要有一个节点"
	});
	const nodeIds = /* @__PURE__ */ new Set();
	doc.nodes.forEach((node, index) => {
		const target = `nodes[${index}]`;
		const id = typeof node.id === "string" ? node.id.trim() : "";
		if (id.length === 0) {
			issues.push({
				target,
				code: "bad-node-id",
				reason: "节点 id 不能为空"
			});
			return;
		}
		if (id.includes(".")) issues.push({
			target,
			code: "bad-node-id",
			reason: `节点 id 不能含 '.'（绑定路径用它分隔节点与字段）：${id}`
		});
		if (nodeIds.has(id)) issues.push({
			target,
			code: "duplicate-node-id",
			reason: `节点 id 重复：${id}`
		});
		nodeIds.add(id);
	});
	doc.nodes.forEach((node, index) => {
		const target = `nodes[${index}]`;
		const hasCard = typeof node.card === "string" && node.card.length > 0;
		const hasPage = typeof node.page === "string" && node.page.length > 0;
		if (hasCard && hasPage) {
			issues.push({
				target,
				code: "node-kind-mismatch",
				reason: `节点 ${node.id} 同时写了 card 与 page：一份链只能取一种形态`
			});
			return;
		}
		if (doc.kind === "interface-chain" && !hasCard) {
			issues.push({
				target,
				code: "node-kind-mismatch",
				reason: `interface-chain 的节点 ${node.id} 必须写 card（引用的接口卡 ID）`
			});
			return;
		}
		if (doc.kind === "page-chain" && !hasPage) issues.push({
			target,
			code: "node-kind-mismatch",
			reason: `page-chain 的节点 ${node.id} 必须写 page（页面 URL 模板）`
		});
	});
	const cards = /* @__PURE__ */ new Map();
	if (doc.kind === "interface-chain") doc.nodes.forEach((node, index) => {
		if (typeof node.card !== "string" || node.card.length === 0) return;
		const card = resolveCard(node.card);
		if (!card) {
			issues.push({
				target: `nodes[${index}]`,
				code: "card-not-imported",
				reason: `节点 ${node.id} 引用的卡 ${node.card} 不在项目接口库中：先跑 dataforge_library_import 把采集包导入`
			});
			return;
		}
		cards.set(node.id, card);
	});
	doc.nodes.forEach((node, index) => {
		if (node.baseUrl !== void 0) try {
			const url = new URL(node.baseUrl);
			if (url.protocol !== "http:" && url.protocol !== "https:") issues.push({
				target: `nodes[${index}]`,
				code: "invalid-chain",
				reason: `节点 ${node.id} 的 baseUrl 必须是 http(s)：${node.baseUrl}`
			});
		} catch {
			issues.push({
				target: `nodes[${index}]`,
				code: "invalid-chain",
				reason: `节点 ${node.id} 的 baseUrl 不是合法 URL：${node.baseUrl}`
			});
		}
		for (const [field, spec] of Object.entries(node.hashes ?? {})) if (!/^(md5|md5-array|sha1):.+/.test(spec)) issues.push({
			target: `nodes[${index}]`,
			code: "invalid-chain",
			reason: `节点 ${node.id} 的 hash 字段 ${field} 规格非法：${spec}（只支持 md5:/md5-array:/sha1: + 文件路径）`
		});
	});
	const declaredSlots = /* @__PURE__ */ new Set();
	doc.inputs.forEach((input, index) => {
		const target = `inputs[${index}]`;
		if (declaredSlots.has(input.name)) issues.push({
			target,
			code: "duplicate-input-slot",
			reason: `槽位名重复：${input.name}`
		});
		declaredSlots.add(input.name);
		if (!CHAIN_VALUE_TYPES.includes(input.type)) issues.push({
			target,
			code: "invalid-input-type",
			reason: `槽位 ${input.name} 的类型 ${input.type} 不在词表内：${CHAIN_VALUE_TYPES.join(" / ")}`
		});
	});
	const referencedSlots = /* @__PURE__ */ new Set();
	const constantsOf = /* @__PURE__ */ new Map();
	doc.nodes.forEach((node, index) => {
		const target = `nodes[${index}]`;
		const keys = /* @__PURE__ */ new Set();
		for (const [key, value] of Object.entries(node.constants ?? {})) {
			keys.add(fieldSegments(key).join("."));
			const slot = inputSlotNameOf(value);
			if (slot === void 0) continue;
			referencedSlots.add(slot);
			if (!declaredSlots.has(slot)) issues.push({
				target,
				code: "unknown-input-slot",
				reason: `节点 ${node.id} 的常量 ${key} 引用了未声明的槽位 $inputs.${slot}`
			});
		}
		for (const [key, value] of [...Object.entries(node.files ?? {}), ...Object.entries(node.hashes ?? {})]) {
			const slot = inputSlotNameOf(value.replace(/^(md5|md5-array|sha1):/, ""));
			if (slot === void 0) continue;
			referencedSlots.add(slot);
			if (!declaredSlots.has(slot)) issues.push({
				target,
				code: "unknown-input-slot",
				reason: `节点 ${node.id} 的文件/hash 字段 ${key} 引用了未声明的槽位 $inputs.${slot}`
			});
		}
		constantsOf.set(node.id, keys);
	});
	if (doc.kind === "page-chain") checkPageEdges(doc, nodeIds, issues);
	else checkInterfaceEdges(doc, nodeIds, cards, constantsOf, declaredSlots, referencedSlots, issues);
	if (doc.cleanup !== void 0) {
		const target = "cleanup";
		if (doc.kind !== "interface-chain") issues.push({
			target,
			code: "invalid-chain",
			reason: "cleanup 目前只支持 interface-chain"
		});
		if (doc.cleanup.chain.site.trim() === "" || doc.cleanup.chain.flow.trim() === "") issues.push({
			target,
			code: "invalid-chain",
			reason: "cleanup.chain 的 site/flow 不能为空"
		});
		if (doc.cleanup.chain.site === doc.meta.site && doc.cleanup.chain.flow === doc.meta.flow) issues.push({
			target,
			code: "invalid-chain",
			reason: "cleanup 不能指向当前链自身（会递归）"
		});
		if (doc.cleanup.chain.version !== void 0 && (!Number.isInteger(doc.cleanup.chain.version) || doc.cleanup.chain.version < 1)) issues.push({
			target,
			code: "invalid-chain",
			reason: "cleanup.chain.version 必须是正整数"
		});
		for (const [key, value] of Object.entries(doc.cleanup.inputs ?? {})) if (typeof value !== "string") issues.push({
			target,
			code: "invalid-chain",
			reason: `cleanup.inputs.${key} 必须是字符串`
		});
	}
	if (doc.verify !== void 0) {
		const target = "verify";
		if (doc.kind !== "interface-chain") issues.push({
			target,
			code: "invalid-chain",
			reason: "verify 目前只支持 interface-chain"
		});
		if (doc.verify.ui.site.trim() === "" || doc.verify.ui.flow.trim() === "") issues.push({
			target,
			code: "invalid-chain",
			reason: "verify.ui 的 site/flow 不能为空"
		});
		if (doc.verify.ui.version !== void 0 && (!Number.isInteger(doc.verify.ui.version) || doc.verify.ui.version < 1)) issues.push({
			target,
			code: "invalid-chain",
			reason: "verify.ui.version 必须是正整数"
		});
		for (const [key, value] of Object.entries(doc.verify.inputs ?? {})) if (typeof value !== "string") issues.push({
			target,
			code: "invalid-chain",
			reason: `verify.inputs.${key} 必须是字符串`
		});
	}
	doc.inputs.forEach((input, index) => {
		if (!referencedSlots.has(input.name)) issues.push({
			target: `inputs[${index}]`,
			code: "unreferenced-input-slot",
			reason: `槽位 ${input.name} 没有任何节点入参引用（僵尸槽位：要么接到某个节点的入参，要么删掉）`
		});
	});
	const cycle = cycleOf(doc);
	if (cycle.length > 0) issues.push({
		target: "edges",
		code: "cycle",
		reason: `绑定关系成环，涉及节点：${cycle.join(" → ")}（绑定即依赖，环意味着谁先跑都拿不到上游值）`
	});
	return issues;
}
/** page-chain：边是页面动线（节点 id → 节点 id）。 */
function checkPageEdges(doc, nodeIds, issues) {
	doc.edges.forEach((edge, index) => {
		const target = `edges[${index}]`;
		if (!nodeIds.has(edge.from)) issues.push({
			target,
			code: "unknown-node",
			reason: `动线起点节点不存在：${edge.from}`
		});
		if (!nodeIds.has(edge.to)) issues.push({
			target,
			code: "unknown-node",
			reason: `动线终点节点不存在：${edge.to}`
		});
	});
}
/** interface-chain：边是绑定声明（节点.字段 → 节点.字段，from 可为槽位引用）。 */
function checkInterfaceEdges(doc, nodeIds, cards, constantsOf, declaredSlots, referencedSlots, issues) {
	doc.edges.forEach((edge, index) => {
		const target = `edges[${index}]`;
		const slot = inputSlotNameOf(edge.from);
		if (slot !== void 0) {
			referencedSlots.add(slot);
			if (!declaredSlots.has(slot)) issues.push({
				target,
				code: "unknown-input-slot",
				reason: `边的 from 引用了未声明的槽位 ${edge.from}`
			});
		} else {
			const from = splitBindingPath(edge.from);
			if (!from) issues.push({
				target,
				code: "bad-binding-path",
				reason: `边的 from 必须是 <节点 id>.<出参路径> 或 $inputs.<槽位名>，实际是 ${edge.from}`
			});
			else if (!nodeIds.has(from.nodeId)) issues.push({
				target,
				code: "unknown-node",
				reason: `边的起点节点不存在：${from.nodeId}`
			});
			else {
				const card = cards.get(from.nodeId);
				if (card && !isFieldDeclared(from.fieldPath, card.outputs) && !(edge.pick !== void 0 && isDeclaredContainer(from.fieldPath, card.outputs))) issues.push({
					target,
					code: "unknown-source-field",
					reason: `${edge.from} 不在卡 ${card.cardId} 的出参模板里（卡模板里没有这个字段）`
				});
			}
		}
		const to = splitBindingPath(edge.to);
		if (!to) {
			issues.push({
				target,
				code: "bad-binding-path",
				reason: `边的 to 必须是 <节点 id>.<入参路径>，实际是 ${edge.to}`
			});
			return;
		}
		if (!nodeIds.has(to.nodeId)) {
			issues.push({
				target,
				code: "unknown-node",
				reason: `边的终点节点不存在：${to.nodeId}`
			});
			return;
		}
		const normalized = fieldSegments(to.fieldPath).join(".");
		if (constantsOf.get(to.nodeId)?.has(normalized)) {
			issues.push({
				target,
				code: "binding-constant-conflict",
				reason: `${edge.to} 同时被绑定边与节点常量赋值：绑定与常量互斥`
			});
			return;
		}
		const card = cards.get(to.nodeId);
		if (card && !isFieldDeclared(to.fieldPath, card.inputs)) issues.push({
			target,
			code: "unknown-target-field",
			reason: `${edge.to} 不在卡 ${card.cardId} 的入参模板里（卡模板里没有这个字段）`
		});
	});
}
/** 边 → 依赖对（from 节点先于 to 节点）；槽位引用不是依赖，跳过。 */
function dependencyPairs(doc) {
	const pairs = [];
	for (const edge of doc.edges) {
		if (doc.kind === "page-chain") {
			pairs.push({
				from: edge.from,
				to: edge.to
			});
			continue;
		}
		const from = splitBindingPath(edge.from);
		const to = splitBindingPath(edge.to);
		if (isInputSlotRef(edge.from)) continue;
		if (from && to) pairs.push({
			from: from.nodeId,
			to: to.nodeId
		});
	}
	return pairs;
}
/** Kahn 排序：绑定即依赖，排不出来就是有环。 */
function topoOrder(doc) {
	const ids = doc.nodes.map((node) => node.id).filter((id) => id.length > 0);
	const indegree = /* @__PURE__ */ new Map();
	const outgoing = /* @__PURE__ */ new Map();
	for (const id of ids) {
		indegree.set(id, indegree.get(id) ?? 0);
		outgoing.set(id, outgoing.get(id) ?? []);
	}
	for (const pair of dependencyPairs(doc)) {
		if (!indegree.has(pair.from) || !indegree.has(pair.to)) continue;
		indegree.set(pair.to, (indegree.get(pair.to) ?? 0) + 1);
		outgoing.get(pair.from)?.push(pair.to);
	}
	const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
	const order = [];
	while (queue.length > 0) {
		const id = queue.shift();
		order.push(id);
		for (const next of outgoing.get(id) ?? []) {
			const left = (indegree.get(next) ?? 0) - 1;
			indegree.set(next, left);
			if (left === 0) queue.push(next);
		}
	}
	return {
		order,
		cycle: ids.filter((id) => !order.includes(id))
	};
}
function cycleOf(doc) {
	return topoOrder(doc).cycle;
}
/** 明显是凭证名的常量键（叶子名精确匹配，避免误杀 `body.token` 之类业务字段）。 */
const CREDENTIAL_LEAVES = /* @__PURE__ */ new Set([
	"cookie",
	"cookies",
	"authorization",
	"token",
	"accesstoken",
	"password",
	"secret",
	"apikey",
	"sessionid"
]);
/**
* 常量里疑似凭证的键：**只提示不阻断**（FR-1.6 的硬保证来自格式本身没有凭证字段；
* 这里防的是人手滑把 token 贴进 constants）。
*/
function scanCredentialConstants(doc) {
	const issues = [];
	doc.nodes.forEach((node, index) => {
		for (const key of Object.keys(node.constants ?? {})) {
			const flat = (fieldSegments(key).pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
			if (CREDENTIAL_LEAVES.has(flat)) issues.push({
				target: `nodes[${index}]`,
				code: "credential-in-constants",
				reason: `节点 ${node.id} 的常量 ${key} 看着是凭证字段：链与接口库零凭证，凭证请走 R-4 的凭证注入`
			});
		}
	});
	return issues;
}

//#endregion
//#region src/chains/store.ts
/**
* 链文件存取：版本快照、回读、导出。
*
* 落点（项目资产，进 git、可手改）：
*   <workspaceRoot>/.dsh/dataforge/chains/<siteSlug>/<flowSlug>/v<n>.yaml
*
* 纪律：
*   - 一个版本一个文件，**版本即不可变快照**：写入永远分配 max+1，不覆盖旧版本、不删旧版本；
*   - 写入前先校验（schema + 语义），全过才落盘——不存在"部分写入"；
*   - 读时重新校验（文件可能被手改坏），坏文件如实报 `invalid-chain` 并列出可用版本；
*   - 落盘 IO 失败原样上抛（沿用插件纪律）。
*
* 卡解析器默认读 `.dsh/dataforge/library/cards/<cardId>.yaml`——只认卡 ID 到文件名的
* 直映射，**不 import `src/library/**`**（那条线归 library 模块，链侧只做结构性读取）。
*
* @module dsh-dataforge/chains/store
*/
/** 工作区里的项目资产根：`.dsh/dataforge`。 */
function dataforgeRoot(workspaceRoot) {
	return join(workspaceRoot, ".dsh", "dataforge");
}
/** 链根目录：`.dsh/dataforge/chains`。 */
function chainsRoot(workspaceRoot) {
	return join(dataforgeRoot(workspaceRoot), "chains");
}
/** 接口库卡目录：`.dsh/dataforge/library/cards`。 */
function cardsRoot(workspaceRoot) {
	return join(dataforgeRoot(workspaceRoot), "library", "cards");
}
/** 名字 → 目录名（保留中日韩字符，其余分隔符折叠成 '-'）。 */
function slugOf(name) {
	return String(name ?? "").trim().toLowerCase().replace(/[\s\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");
}
function requireSlug$1(name, what) {
	const slug = slugOf(name);
	if (slug.length === 0) throw Object.assign(/* @__PURE__ */ new Error(`${what} "${String(name)}" 不能作为目录名（为空或只含路径分隔符）`), { code: "invalid-chain" });
	return slug;
}
/** 链版本目录：`chains/<siteSlug>/<flowSlug>`。 */
function chainDir(workspaceRoot, site, flow) {
	return join(chainsRoot(workspaceRoot), requireSlug$1(site, "site"), requireSlug$1(flow, "flow"));
}
/** 单个版本文件路径：`.../v<n>.yaml`。 */
function chainFilePath(workspaceRoot, site, flow, version) {
	return join(chainDir(workspaceRoot, site, flow), `v${version}.yaml`);
}
/** 已有版本号（升序）；目录不存在返回空数组。 */
function listChainVersions(workspaceRoot, site, flow) {
	const dir = chainDir(workspaceRoot, site, flow);
	if (!existsSync(dir)) return [];
	const versions = [];
	for (const entry of readdirSync(dir)) {
		const hit = /^v(\d+)\.ya?ml$/.exec(entry);
		if (!hit) continue;
		const version = Number(hit[1]);
		if (Number.isInteger(version) && version >= 1) versions.push(version);
	}
	return versions.sort((left, right) => left - right);
}
/** 最新版本号；没有任何版本返回 undefined。 */
function latestChainVersion(workspaceRoot, site, flow) {
	const versions = listChainVersions(workspaceRoot, site, flow);
	return versions.length > 0 ? versions[versions.length - 1] : void 0;
}
/** 下一个版本号 = max+1（没有历史则 1）。 */
function nextChainVersion(workspaceRoot, site, flow) {
	return (latestChainVersion(workspaceRoot, site, flow) ?? 0) + 1;
}
/**
* 逐版本读文件头。编排页要显示「v3 · 当前 / v2 已被 v3 取代 / 来源 / 更新时间」，
* 这些只有打开每个版本文件才知道；文件坏了照常给出行，只是带 unreadable。
*/
function listChainVersionInfos(workspaceRoot, site, flow) {
	return listChainVersions(workspaceRoot, site, flow).map((version) => {
		try {
			const doc = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, version), "utf8"));
			if (!doc.ok) return {
				version,
				unreadable: doc.issues.map((issue) => `${issue.target}：${issue.reason}`).join("；")
			};
			const { meta, nodes, edges } = doc.doc;
			return {
				version,
				...meta.created === void 0 ? {} : { created: meta.created },
				...meta.source === void 0 ? {} : { source: meta.source },
				...meta.domain === void 0 ? {} : { domain: meta.domain },
				...meta.note === void 0 ? {} : { note: meta.note },
				nodeCount: nodes.length,
				edgeCount: edges.length
			};
		} catch (error) {
			return {
				version,
				unreadable: `读取失败：${error instanceof Error ? error.message : String(error)}`
			};
		}
	});
}
/**
* 列工作区里所有链（两层目录扫描；坏 slug 的目录跳过）。
*
* 会读一遍最新版本的头部来补 kind/domain/updatedAt/节点边数——编排页要按这三样
* 分组与排序。坏文件不抛：整条链照常出现，只是带 `unreadable` 说明。
*/
function listChains(workspaceRoot) {
	const root = chainsRoot(workspaceRoot);
	if (!existsSync(root)) return [];
	const result = [];
	for (const site of safeDirs(root)) for (const flow of safeDirs(join(root, site))) {
		let versions = [];
		try {
			versions = listChainVersions(workspaceRoot, site, flow);
		} catch {
			continue;
		}
		if (versions.length === 0) continue;
		const latest = versions[versions.length - 1];
		result.push({
			site,
			flow,
			versions,
			latest,
			...summarize(workspaceRoot, site, flow, latest)
		});
	}
	return result;
}
/** 最新版本文件头 → 列表要的元数据（读失败返回 unreadable，不抛）。 */
function summarize(workspaceRoot, site, flow, version) {
	try {
		const doc = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, version), "utf8"));
		if (!doc.ok) return { unreadable: doc.issues.map((issue) => `${issue.target}：${issue.reason}`).join("；") };
		const { meta, nodes, edges } = doc.doc;
		const hosts = hostsOfDoc(workspaceRoot, doc.doc);
		return {
			kind: doc.doc.kind,
			...meta.domain === void 0 ? {} : { domain: meta.domain },
			...meta.note === void 0 ? {} : { note: meta.note },
			...meta.created === void 0 ? {} : { updatedAt: meta.created },
			nodeCount: nodes.length,
			edgeCount: edges.length,
			...hosts.length === 0 ? {} : { hosts }
		};
	} catch (error) {
		return { unreadable: `读取失败：${error instanceof Error ? error.message : String(error)}` };
	}
}
/**
* 链节点引用的卡/页面的 host（去重、保序）。
*
* 用途只限面板「网站卡」展示（原型的新增字段）：host 不在链 schema 里，
* 它是卡的采集来源；卡/页面缺失时静默跳过，不因展示信息失败影响列表。
*/
function hostsOfDoc(workspaceRoot, doc) {
	const hosts = /* @__PURE__ */ new Set();
	const addUrl = (url) => {
		if (typeof url !== "string" || url === "") return;
		try {
			const parsed = new URL(url, "http://placeholder.invalid");
			if (parsed.host !== "" && parsed.host !== "placeholder.invalid") hosts.add(parsed.host);
		} catch {}
	};
	for (const node of doc.nodes ?? []) {
		if (typeof node.card === "string" && node.card !== "") {
			const card = readCard(workspaceRoot, node.card);
			for (const source of card?.sources ?? []) for (const page of source.pages ?? []) addUrl(page);
		}
		addUrl(node.page);
	}
	return [...hosts];
}
function safeDirs(dir) {
	try {
		return readdirSync(dir).filter((entry) => {
			try {
				return statSync(join(dir, entry)).isDirectory();
			} catch {
				return false;
			}
		});
	} catch {
		return [];
	}
}
/** 读一个版本并生成改写后的文本；坏文件返回可读错误（整次改名拒绝）。 */
function prepareVersionText(workspaceRoot, site, flow, version, patch) {
	let parsed;
	try {
		parsed = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, version), "utf8"));
	} catch (error) {
		return {
			ok: false,
			message: `v${version} 读取失败：${error instanceof Error ? error.message : String(error)}`,
			issues: []
		};
	}
	if (!parsed.ok) return {
		ok: false,
		message: `v${version} 校验不过，先修好再改名`,
		issues: parsed.issues
	};
	return {
		ok: true,
		text: chainToYaml(patch(parsed.doc))
	};
}
/** 先写临时文件、再逐个 rename 覆盖：尽量把「写到一半」的窗口压到最小。 */
function writePreparedVersions(dir, versions) {
	const pending = [];
	try {
		for (const version of versions) {
			const final = join(dir, `v${version.version}.yaml`);
			const tmp = `${final}.tmp-${process.pid}-${Date.now()}`;
			writeFileSync(tmp, version.text, "utf8");
			pending.push({
				tmp,
				final
			});
		}
		for (const file of pending) renameSync(file.tmp, file.final);
	} catch (error) {
		for (const file of pending) try {
			unlinkSync(file.tmp);
		} catch {}
		throw error;
	}
}
/** 流程改名：目录 + 每个版本的 meta.flow；同名（slug 相同）时只改展示名。 */
function renameChainFlow(workspaceRoot, site, flow, newFlow) {
	const trimmed = String(newFlow ?? "").trim();
	if (trimmed === "" || slugOf(trimmed) === "") return {
		ok: false,
		code: "rename-invalid",
		message: "流程名称不能为空（或只含路径分隔符）"
	};
	const oldDir = chainDir(workspaceRoot, site, flow);
	if (!existsSync(oldDir)) return {
		ok: false,
		code: "rename-not-found",
		message: `流程「${flow}」不存在`
	};
	const versions = listChainVersions(workspaceRoot, site, flow);
	if (versions.length === 0) return {
		ok: false,
		code: "rename-not-found",
		message: `流程「${flow}」没有可改名的版本`
	};
	const prepared = [];
	for (const version of versions) {
		const text = prepareVersionText(workspaceRoot, site, flow, version, (doc) => ({
			...doc,
			meta: {
				...doc.meta,
				flow: trimmed
			}
		}));
		if (!text.ok) return {
			ok: false,
			code: "invalid-chain",
			message: text.message,
			issues: text.issues
		};
		prepared.push({
			version,
			text: text.text
		});
	}
	slugOf(flow);
	const newSlug = slugOf(trimmed);
	const newDir = join(chainsRoot(workspaceRoot), slugOf(site), newSlug);
	if (newDir !== oldDir && existsSync(newDir)) return {
		ok: false,
		code: "rename-conflict",
		message: `目标流程目录已存在：${newSlug}`
	};
	let moved = false;
	try {
		if (newDir !== oldDir) {
			renameSync(oldDir, newDir);
			moved = true;
		}
		writePreparedVersions(newDir, prepared);
	} catch (error) {
		if (moved) try {
			renameSync(newDir, oldDir);
		} catch {}
		throw error;
	}
	return {
		ok: true,
		site,
		flow: trimmed,
		updatedVersions: prepared.length
	};
}
/**
* 业务域改名：把该网站下「最新版 domain = old」的所有流程的所有版本里
* `meta.domain === old` 的版本改写为新名字。
*/
function renameChainDomain(workspaceRoot, site, domain, newDomain) {
	const oldName = String(domain ?? "").trim();
	const trimmed = String(newDomain ?? "").trim();
	if (oldName === "") return {
		ok: false,
		code: "rename-invalid",
		message: "原业务域名称不能为空"
	};
	if (trimmed === "") return {
		ok: false,
		code: "rename-invalid",
		message: "业务域名称不能为空"
	};
	if (trimmed === oldName) return {
		ok: true,
		site,
		updatedFlows: 0,
		updatedVersions: 0
	};
	const siteDir = join(chainsRoot(workspaceRoot), slugOf(site));
	if (!existsSync(siteDir)) return {
		ok: false,
		code: "rename-not-found",
		message: `网站「${site}」不存在`
	};
	let updatedFlows = 0;
	let updatedVersions = 0;
	for (const flow of safeDirs(siteDir)) {
		const versions = listChainVersions(workspaceRoot, site, flow);
		if (versions.length === 0) continue;
		const latestVersion = versions[versions.length - 1];
		let latestDoc;
		try {
			latestDoc = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, latestVersion), "utf8"));
		} catch {
			continue;
		}
		if (!latestDoc.ok || latestDoc.doc.meta.domain !== oldName) continue;
		const prepared = [];
		for (const version of versions) {
			const candidate = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, version), "utf8"));
			if (!candidate.ok) return {
				ok: false,
				code: "invalid-chain",
				message: `流程「${flow}」的 v${version} 校验不过，先修好再改名`,
				issues: candidate.issues
			};
			if (candidate.doc.meta.domain !== oldName) continue;
			prepared.push({
				version,
				text: chainToYaml({
					...candidate.doc,
					meta: {
						...candidate.doc.meta,
						domain: trimmed
					}
				})
			});
		}
		if (prepared.length === 0) continue;
		writePreparedVersions(chainDir(workspaceRoot, site, flow), prepared);
		updatedFlows += 1;
		updatedVersions += prepared.length;
	}
	if (updatedFlows === 0) return {
		ok: false,
		code: "rename-not-found",
		message: `没有业务域「${oldName}」可改名`
	};
	return {
		ok: true,
		site,
		updatedFlows,
		updatedVersions
	};
}
/** 读某个版本（缺省最新）；文件被手改坏也如实报 invalid-chain。 */
function loadChain(workspaceRoot, site, flow, options = {}) {
	const availableVersions = listChainVersions(workspaceRoot, site, flow);
	const version = options.version ?? availableVersions[availableVersions.length - 1];
	if (version === void 0 || !availableVersions.includes(version)) return {
		ok: false,
		code: "chain-not-found",
		message: version === void 0 ? `没有找到 ${site} / ${flow} 的任何链版本` : `${site} / ${flow} 没有 v${version}`,
		availableVersions
	};
	const path = chainFilePath(workspaceRoot, site, flow, version);
	const text = readFileSync(path, "utf8");
	const parsed = validateChainYaml(text, { resolveCard: options.resolveCard ?? defaultCardResolver(workspaceRoot) });
	if (!parsed.ok) return {
		ok: false,
		code: "invalid-chain",
		message: `${path} 未通过校验（可能被手改坏）：可回读旧版本或修好再试`,
		issues: parsed.issues,
		path,
		availableVersions
	};
	return {
		ok: true,
		doc: parsed.doc,
		text,
		path,
		version,
		warnings: scanCredentialConstants(parsed.doc)
	};
}
/** 原文读取（不校验）：导出用，坏文件也照原样给出。 */
function readChainText(workspaceRoot, site, flow, version) {
	const versions = listChainVersions(workspaceRoot, site, flow);
	const target = version ?? versions[versions.length - 1];
	if (target === void 0 || !versions.includes(target)) return void 0;
	const path = chainFilePath(workspaceRoot, site, flow, target);
	return {
		text: readFileSync(path, "utf8"),
		path,
		version: target
	};
}
/**
* 落盘为**新版本**（version 取 max+1，输入里的 meta.version 会被覆盖成实际版本号）。
*
* `input` 可以是已解析的 ChainDoc（画布/编译草稿确认后）或链 YAML 文本（agent 手写）。
* 校验不过一律不落盘，把 issues 原样给回去。
*
* `source` 是**版本来源**（编排图列表要显示「agent 会话保存 / 画布保存 / 导入」）：
* 由调用方声明，不猜。调用方没声明就保留输入里已有的值，都没有则该版本无来源标注。
*/
function saveChain(workspaceRoot, input, options = {}) {
	const resolveCard = options.resolveCard ?? defaultCardResolver(workspaceRoot);
	const parsed = typeof input === "string" ? validateChainYaml(input, { resolveCard }) : validateChain(input, { resolveCard });
	if (!parsed.ok) return {
		ok: false,
		issues: parsed.issues
	};
	const { doc } = parsed;
	const version = nextChainVersion(workspaceRoot, doc.meta.site, doc.meta.flow);
	const created = isIsoInstant(doc.meta.created) ? doc.meta.created : (/* @__PURE__ */ new Date()).toISOString();
	const source = options.source ?? doc.meta.source;
	const finalDoc = {
		...doc,
		meta: {
			...doc.meta,
			version,
			created,
			...source === void 0 ? {} : { source }
		}
	};
	const dir = chainDir(workspaceRoot, finalDoc.meta.site, finalDoc.meta.flow);
	mkdirSync(dir, { recursive: true });
	const path = chainFilePath(workspaceRoot, finalDoc.meta.site, finalDoc.meta.flow, version);
	writeFileSync(path, chainToYaml(finalDoc), "utf8");
	return {
		ok: true,
		version,
		path,
		doc: finalDoc,
		warnings: scanCredentialConstants(finalDoc)
	};
}
function isIsoInstant(value) {
	if (typeof value !== "string" || value.length === 0) return false;
	return !Number.isNaN(Date.parse(value));
}
/** 读一张卡（`library/cards/<cardId>.yaml|yml`）；不存在/坏文件返回 undefined。 */
function readCard(workspaceRoot, cardId) {
	if (!/^[A-Za-z0-9._-]+$/.test(cardId)) return void 0;
	const dir = cardsRoot(workspaceRoot);
	for (const name of [`${cardId}.yaml`, `${cardId}.yml`]) {
		const path = join(dir, name);
		if (!existsSync(path)) continue;
		try {
			const parsed = loadYamlValue$1(readFileSync(path, "utf8"));
			const card = parseCardDoc(parsed);
			if (card) return card;
		} catch {
			return;
		}
	}
}
/**
* 默认卡解析器：按 cardId 直读接口库，单次校验内缓存（同一张卡不被读多次）。
* 集成侧若已有 library 模块，可改用它的 reader 注入（结构契约见 InterfaceCardDoc）。
*/
function defaultCardResolver(workspaceRoot) {
	const cache = /* @__PURE__ */ new Map();
	return (cardId) => {
		if (cache.has(cardId)) return cache.get(cardId);
		const card = readCard(workspaceRoot, cardId);
		cache.set(cardId, card);
		return card;
	};
}

//#endregion
//#region src/execute/coverage.ts
/**
* 绑定/常量/卡模板路径的归一形式：`fieldSegments(path).join('.')`。
*
* `[0]` / `[*]` / `[]` 一律收敛成 `[*]`，所以覆盖判定不再需要关心写法差异。
*/
function normalizePath(path) {
	return fieldSegments(path).join(".");
}
/**
* 一个节点已被静态赋值的入参路径集合（归一后）。
*
* 两个来源：
*   - 节点 `constants` 的键（R-6 结晶的常量写入点）；
*   - 以该节点为终点的绑定边 `to` 的字段路径（边只表示「上游产出填这里」，
*     值在执行期由 `resolveBinding` 取得）。
*
* 槽位引用 `$inputs.<name>` 不在这里展开：它仍是常量值，键已经被覆盖；
* 槽位有没有运行值是 `buildPlan()` 的事（缺值是链级缺参，不是节点覆盖问题）。
*/
function coveredPaths(doc, node) {
	const covered = /* @__PURE__ */ new Set();
	for (const key of Object.keys(node.constants ?? {})) {
		const normalized = normalizePath(key);
		if (normalized.length > 0) covered.add(normalized);
	}
	for (const key of Object.keys(node.files ?? {})) {
		const normalized = normalizePath(key);
		if (normalized.length > 0) covered.add(normalized);
	}
	for (const key of Object.keys(node.hashes ?? {})) {
		const normalized = normalizePath(key);
		if (normalized.length > 0) covered.add(normalized);
	}
	for (const edge of doc.edges) {
		const to = splitBindingPath(edge.to);
		if (!to || to.nodeId !== node.id) continue;
		const normalized = normalizePath(to.fieldPath);
		if (normalized.length > 0) covered.add(normalized);
	}
	return covered;
}
/**
* 卡模板里有、但节点既无常量也无绑定、且不是凭证字段的入参。
*
* 不看 `f.required`（见模块头注释）。`covered` 必须来自 {@link coveredPaths}
* （已归一）；未归一的集合会让 `[n]`/`[*]` 的差异漏判。
*
* 凭证字段（`role === 'credential'`）直接跳过：凭证由 R-4 注入，引擎既不发空值
* 也不报缺参；调用方需要自己记一条 `auth-not-injected` 提示（plan.ts 负责）。
*/
function missingInputs(node, card, covered) {
	const gaps = [];
	for (const field of card.inputs ?? []) {
		if (field.role === "credential") continue;
		if (covered.has(normalizePath(field.path))) continue;
		gaps.push(gapOf$1(node, field));
	}
	return gaps;
}
function gapOf$1(node, field) {
	return {
		nodeId: node.id,
		path: field.path,
		type: field.type,
		target: `node:${node.id}`
	};
}
const SCALAR_CHECKS = {
	string: (value) => typeof value === "string",
	number: (value) => typeof value === "number",
	boolean: (value) => typeof value === "boolean",
	object: (value) => typeof value === "object" && value !== null && !Array.isArray(value),
	array: (value) => Array.isArray(value),
	null: (value) => value === null
};
/**
* 运行值是否符合链/卡声明的类型；符合返回 `undefined`，不符返回中文原因（带路径）。
*
* 用于链级槽位值（`dataforge_chain_run` 的 `inputs`）与后续请求构造的入参校验。
* 类型词表与 R-1 的 `CHAIN_VALUE_TYPES` 同源：`string` / `number` / `boolean` /
* `object` / `array` / `null` 与 `array<T>`。
*/
function checkValueType(path, expected, value) {
	const want = expected.trim();
	const nested = /^array<(.+)>$/.exec(want);
	if (nested) {
		if (!Array.isArray(value)) return `${path}: 期望 ${want}，实际是 ${actualTypeOf(value)}`;
		const inner = nested[1].trim();
		for (let index = 0; index < value.length; index += 1) {
			const reason = checkValueType(`${path}[${index}]`, inner, value[index]);
			if (reason !== void 0) return reason;
		}
		return;
	}
	const check = SCALAR_CHECKS[want];
	if (!check) return `${path}: 未知的值类型 ${want}`;
	return check(value) ? void 0 : `${path}: 期望 ${want}，实际是 ${actualTypeOf(value)}`;
}
function actualTypeOf(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "object") return "object";
	if (value === void 0) return "undefined";
	return typeof value;
}

//#endregion
//#region src/execute/plan.ts
/**
* 编译执行计划。
*
* `inputs` 是本次运行的槽位值（键 = 链文件声明的槽位名）；`baseUrl` 由调用方
* （`chain_run`）解析后传入，本函数只判定「是不是 http(s) 源」，不做来源推断。
*/
function buildPlan(doc, cards, inputs, baseUrl) {
	if (doc.kind === "page-chain") return failure$2("not-executable", `链 ${doc.meta.site}/${doc.meta.flow} 是 page-chain：先经 R-1 compilePageChain 编译成 interface-chain 草稿并落盘，再执行`);
	const topo = topoOrder(doc);
	if (topo.cycle.length > 0) return failure$2("cycle", `绑定关系成环，涉及节点：${topo.cycle.join(" → ")}`, [], topo.cycle);
	const missingCards = [];
	for (const node of doc.nodes) {
		if (typeof node.card !== "string" || node.card.length === 0) {
			missingCards.push(`节点 ${node.id} 没有 card 引用`);
			continue;
		}
		if (!cards.has(node.card)) missingCards.push(`节点 ${node.id} 引用的卡 ${node.card} 不在项目接口库中`);
	}
	if (missingCards.length > 0) return failure$2("card-not-imported", `${missingCards.join("；")}：先跑 dataforge_library_import 把采集包导入`);
	const runtimeInputs = inputs ?? {};
	const declaredSlots = new Map(doc.inputs.map((input) => [input.name, input]));
	const edgeSlots = slotRefsFromEdges(doc);
	const gapsByNode = /* @__PURE__ */ new Map();
	const notices = [];
	const authGapNodes = [];
	for (const nodeId of topo.order) {
		const node = doc.nodes.find((candidate) => candidate.id === nodeId);
		if (!node) continue;
		const card = cards.get(node.card);
		const covered = coveredPaths(doc, node);
		const gaps = missingInputs(node, card, covered);
		const uncoveredCredentials = (card.inputs ?? []).filter((field) => field.role === "credential" && !covered.has(normalizePath(field.path)));
		if (uncoveredCredentials.length > 0) authGapNodes.push(`${node.id}（${uncoveredCredentials.map((field) => field.path).join(" / ")}）`);
		const seenSlots = /* @__PURE__ */ new Set();
		const slotValues = [
			...Object.values(node.constants ?? {}).map((value) => String(value)),
			...Object.values(node.files ?? {}),
			...Object.values(node.hashes ?? {}).map((value) => value.replace(/^(md5|md5-array|sha1):/, ""))
		];
		for (const value of slotValues) {
			const slot = inputSlotNameOf(value);
			if (slot === void 0 || seenSlots.has(slot)) continue;
			seenSlots.add(slot);
			const gap = slotGapOf(nodeId, slot, declaredSlots, runtimeInputs);
			if (gap) gaps.push(gap);
		}
		for (const slot of edgeSlots.get(nodeId) ?? []) {
			if (seenSlots.has(slot)) continue;
			seenSlots.add(slot);
			const gap = slotGapOf(nodeId, slot, declaredSlots, runtimeInputs);
			if (gap) gaps.push(gap);
		}
		gapsByNode.set(nodeId, gaps);
	}
	const allGaps = topo.order.flatMap((nodeId) => gapsByNode.get(nodeId) ?? []);
	if (allGaps.length > 0) return failure$2("missing-params", `静态缺参 ${allGaps.length} 条（一个请求都不会发）：${describeGaps(allGaps)}`, allGaps);
	const resolvedBase = resolveBaseUrl(baseUrl);
	const nodesWithoutBase = doc.nodes.filter((node) => node.baseUrl === void 0);
	if (!resolvedBase.ok && nodesWithoutBase.length > 0) return failure$2("base-url-unresolved", resolvedBase.message);
	const planBaseUrl = resolvedBase.ok ? resolvedBase.baseUrl : "";
	if (authGapNodes.length > 0) notices.push(`auth-not-injected：节点 ${authGapNodes.join("、")} 的凭证入参未注入（R-4 负责），引擎不会发送空值`);
	const idSet = new Set(topo.order);
	const dependsOn = /* @__PURE__ */ new Map();
	for (const pair of dependencyPairs(doc)) {
		if (!idSet.has(pair.from) || !idSet.has(pair.to)) continue;
		const list = dependsOn.get(pair.to) ?? [];
		if (!list.includes(pair.from)) list.push(pair.from);
		dependsOn.set(pair.to, list);
	}
	const nodes = topo.order.map((nodeId) => {
		const node = doc.nodes.find((candidate) => candidate.id === nodeId);
		const card = cards.get(node.card);
		return {
			nodeId,
			cardId: card.cardId,
			method: card.identity.method,
			urlTemplate: card.identity.urlTemplate,
			...node.baseUrl === void 0 ? {} : { baseUrl: resolveBaseUrl(node.baseUrl).ok ? node.baseUrl : node.baseUrl },
			dependsOn: dependsOn.get(nodeId) ?? [],
			constants: { ...node.constants ?? {} },
			gaps: gapsByNode.get(nodeId) ?? []
		};
	});
	return {
		ok: true,
		plan: {
			order: [...topo.order],
			nodes,
			gaps: [],
			baseUrl: planBaseUrl,
			writeNodes: nodes.filter((node) => isWriteMethod(node.method)).map((node) => node.nodeId),
			totalNodes: topo.order.length
		},
		notices
	};
}
function failure$2(code, message, gaps = [], cycle = []) {
	return {
		ok: false,
		code,
		message,
		gaps,
		cycle
	};
}
/** 写方法 = 非 GET/HEAD（大小写不敏感）；用于回执里的写类节点清单与确认纪律。 */
function isWriteMethod(method) {
	const normalized = method.trim().toUpperCase();
	return normalized !== "GET" && normalized !== "HEAD";
}
/** baseUrl 只判定：缺省、不是合法 URL、或协议不是 http(s) 都算不可解析。 */
function resolveBaseUrl(baseUrl) {
	const raw = typeof baseUrl === "string" ? baseUrl.trim() : "";
	if (raw.length === 0) return {
		ok: false,
		message: "baseUrl 未提供：执行需要一个明确的 http(s) 源（工具入参 baseUrl）"
	};
	let parsed;
	try {
		parsed = new URL(raw);
	} catch {
		return {
			ok: false,
			message: `baseUrl 不是合法的 URL：${raw}`
		};
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return {
		ok: false,
		message: `baseUrl 必须是 http(s) 源，实际是 ${parsed.protocol}//：${raw}`
	};
	return {
		ok: true,
		baseUrl: raw
	};
}
/** 边 `from: $inputs.x` → 终点节点 id 上的槽位引用（槽位不是节点，不能算依赖）。 */
function slotRefsFromEdges(doc) {
	const refs = /* @__PURE__ */ new Map();
	for (const edge of doc.edges) {
		const slot = inputSlotNameOf(edge.from);
		if (slot === void 0) continue;
		const to = splitBindingPath(edge.to);
		if (!to) continue;
		const list = refs.get(to.nodeId) ?? [];
		if (!list.includes(slot)) list.push(slot);
		refs.set(to.nodeId, list);
	}
	return refs;
}
/** 槽位没有运行值 → 缺参；`inputs[].required` 不参与判据（引用即需要值）。 */
function slotGapOf(nodeId, slot, declaredSlots, inputs) {
	if (hasRuntimeValue(inputs, slot)) return void 0;
	return {
		nodeId,
		path: `$inputs.${slot}`,
		type: declaredSlots.get(slot)?.type ?? "unknown",
		target: `$inputs.${slot}`
	};
}
function hasRuntimeValue(inputs, name) {
	return Object.prototype.hasOwnProperty.call(inputs, name) && inputs[name] !== void 0;
}
function describeGaps(gaps) {
	return gaps.map((gap) => `${gap.nodeId} · ${gap.path} · ${gap.type}`).join("；");
}

//#endregion
//#region src/execute/binding.ts
/**
* 绑定求值（IF-5）：从上游响应根按 R-1 绑定路径取出参值。
*
* 纯函数：不修改 `root`、不读磁盘、不联网；同输入同输出。
*
* 路径语法（R-1 的子集，不引 JSONPath）：
*   - 首段是 `body` / `status` / `headers` 时按信封取；否则整条路径对 `root.body` 求值
*     （兼容早期只写 `items[0].id` 的手写链）；
*   - `[n]` 取数组第 n 项，越界 → `path-not-found`；
*   - `[*]` / `[]` 对数组做投影，结果为数组；多级 `[*]` 如实产出嵌套数组；
*   - 投影结果 0 个元素 → `empty-wildcard`；目标为标量且恰好 1 个元素 → 解包并记
*     `unwrapped: true`；目标为数组时保持数组（`array<T>` 同理）。多于 1 个而目标为
*     标量 → `type-mismatch`（提示改用 `[0]` 或把目标声明成数组）。
*   - `null` / `undefined` 一律视为缺值 → `null-value`，不静默塞给下游；
*   - 路径不存在 / 结构不符（该是数组却不是、下标越界）→ `path-not-found`。
*
* `matched` 用 R-1 的 `fieldSegments` 归一（`[0]` / `[]` / `[*]` 都收敛成 `[*]`），
* 这样运行记录里的绑定值能回指到链上的绑定边。
*
* @module dsh-dataforge/execute/binding
*/
const ENVELOPES = /* @__PURE__ */ new Set([
	"body",
	"status",
	"headers"
]);
/** `items[0][*]` → 字段名 `items` + 两个下标；字段名本身不含方括号。 */
const SEGMENT_PATTERN = /^([^[\]]*)((?:\[[^[\]]*\])*)$/;
/**
* 解析一个可带下标的段；非法（如 `[abc]`）返回 undefined。
*
* 注意这里保留 `[n]` 的 n —— `fieldSegments` 会把 `[0]` 与 `[*]` 归一成同一个占位，
* 求值时必须知道到底取第几项，只有 `matched` 才走归一化。
*/
function parseSegment(raw) {
	const hit = SEGMENT_PATTERN.exec(raw);
	if (!hit) return void 0;
	const name = (hit[1] ?? "").trim();
	const brackets = (hit[2] ?? "").match(/\[[^[\]]*\]/g) ?? [];
	const indexes = [];
	for (const bracket of brackets) {
		const inner = bracket.slice(1, -1).trim();
		if (inner === "" || inner === "*") indexes.push("wildcard");
		else if (/^\d+$/.test(inner)) indexes.push(Number(inner));
		else return;
	}
	if (name.length === 0 && indexes.length === 0) return void 0;
	return {
		name,
		indexes
	};
}
/** 路径 → 信封 + 段数组；空路径/非法段返回 undefined。 */
function parsePath(path) {
	const raws = path.split(".").map((raw) => raw.trim()).filter((raw) => raw.length > 0);
	if (raws.length === 0) return void 0;
	let envelope;
	let start = 0;
	const first = raws[0] ?? "";
	if (ENVELOPES.has(first)) {
		envelope = first;
		start = 1;
	}
	const segments = [];
	for (const raw of raws.slice(start)) {
		const segment = parseSegment(raw);
		if (!segment) return void 0;
		segments.push(segment);
	}
	return {
		envelope,
		segments
	};
}
/** 段的中文定位（错误信息指出断在第几段）。 */
function segmentLabel(segment, step) {
	const suffix = segment.indexes.map((index) => index === "wildcard" ? "[*]" : `[${index}]`).join("");
	return `第 ${step} 段「${segment.name}${suffix}」`;
}
function whereOf(segments, step) {
	const segment = segments[step];
	return segment ? segmentLabel(segment, step + 1) : "路径末尾";
}
/** 运行记录里给人看的实际类型。 */
function typeName(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
/** 有限数字，或可无损往返的数字字符串（`"12"` 可以，`"12abc"` / `"1.0"` 不行）。 */
function isNumericString(value) {
	const text = value.trim();
	if (text.length === 0) return false;
	const parsed = Number(text);
	return Number.isFinite(parsed) && String(parsed) === text;
}
function isArrayType(expectedType) {
	const base = expectedType.trim().toLowerCase();
	return base === "array" || base.startsWith("array<") && base.endsWith(">");
}
/**
* 类型匹配（与卡模板同词表）。返回实际类型用于错误信息；
* `array<T>` 逐元素校验，元素的第一个不符点写进 actual（如 `array<string>`）。
*/
function matchType(value, expectedType) {
	const expected = expectedType.trim();
	const base = expected.toLowerCase();
	if (base.startsWith("array<") && base.endsWith(">")) {
		if (!Array.isArray(value)) return {
			ok: false,
			actual: typeName(value)
		};
		const inner = expected.slice(6, -1).trim();
		if (inner.length === 0) return {
			ok: true,
			actual: "array"
		};
		for (const item of value) {
			const result = matchType(item, inner);
			if (!result.ok) return {
				ok: false,
				actual: `array<${result.actual}>`
			};
		}
		return {
			ok: true,
			actual: "array"
		};
	}
	switch (base) {
		case "string": return {
			ok: typeof value === "string",
			actual: typeName(value)
		};
		case "number": return {
			ok: typeof value === "number" && Number.isFinite(value) || typeof value === "string" && isNumericString(value),
			actual: typeName(value)
		};
		case "boolean": return {
			ok: typeof value === "boolean" || value === "true" || value === "false",
			actual: typeName(value)
		};
		case "object": return {
			ok: isPlainObject(value),
			actual: typeName(value)
		};
		case "array": return {
			ok: Array.isArray(value),
			actual: typeName(value)
		};
		case "null": return {
			ok: value === null,
			actual: typeName(value)
		};
		default: return {
			ok: true,
			actual: typeName(value)
		};
	}
}
function failureOf$1(code, message) {
	return {
		ok: false,
		failure: {
			code,
			message
		}
	};
}
function nullFailure(path, where) {
	return failureOf$1("null-value", `绑定路径「${path}」在${where}处取到 null/undefined，不能把空值传给下游`);
}
/** 路径求值里的每个中间值都不许是 null/undefined（显式缺值要如实报）。 */
function guardNull(value, path, where) {
	return value === null || value === void 0 ? nullFailure(path, where) : void 0;
}
/** 读对象字段；字段不存在才是 `path-not-found`，字段存在但值是 null 交给 guard。 */
function readProperty(value, name, path, where) {
	if (value === null || value === void 0) return nullFailure(path, where);
	if (typeof value !== "object" || Array.isArray(value)) return failureOf$1("path-not-found", `绑定路径「${path}」在${where}处期望对象，实际类型 ${typeName(value)}`);
	if (!(name in value)) return failureOf$1("path-not-found", `绑定路径「${path}」在${where}处未命中：字段「${name}」不存在`);
	return {
		ok: true,
		value: value[name]
	};
}
/** 依次应用段内下标；`[*]` 投影到每个元素，并继续求后续段（多级通配得到嵌套数组）。 */
function applyIndexes(value, indexes, segments, step, where, path) {
	const head = indexes[0];
	if (head === void 0) return evalSegments(value, segments, step + 1, path);
	if (!Array.isArray(value)) return failureOf$1("path-not-found", `绑定路径「${path}」在${where}处期望数组，实际类型 ${typeName(value)}`);
	if (head === "wildcard") {
		const rest = indexes.slice(1);
		const projected = [];
		for (const element of value) {
			const result = applyIndexes(element, rest, segments, step, where, path);
			if (!result.ok) return result;
			projected.push(result.value);
		}
		return {
			ok: true,
			value: projected
		};
	}
	if (head >= value.length) return failureOf$1("path-not-found", `绑定路径「${path}」在${where}处下标 ${head} 越界（数组长度 ${value.length}）`);
	const element = value[head];
	const missing = guardNull(element, path, where);
	if (missing) return missing;
	return applyIndexes(element, indexes.slice(1), segments, step, where, path);
}
/** 对当前值求第 step 段：先取字段，再应用段内下标，最后进入下一段。 */
function evalSegments(value, segments, step, path) {
	const where = whereOf(segments, step);
	const missing = guardNull(value, path, where);
	if (missing) return missing;
	if (step >= segments.length) return {
		ok: true,
		value
	};
	const segment = segments[step];
	let current = value;
	if (segment.name.length > 0) {
		const read = readProperty(current, segment.name, path, where);
		if (!read.ok) return read;
		current = read.value;
		const bad = guardNull(current, path, where);
		if (bad) return bad;
	}
	return applyIndexes(current, segment.indexes, segments, step, where, path);
}
/** HTTP 头名大小写不敏感：lower-case 视图只影响求值，不改调用方的 headers。 */
function lowerCaseHeaders(headers) {
	const view = {};
	for (const [name, value] of Object.entries(headers ?? {})) view[name.toLowerCase()] = value;
	return view;
}
/**
* 按绑定路径从响应根取值。
*
* @param root 上游响应信封 `{ body, status, headers }`（不会被修改）
* @param path R-1 绑定路径，如 `body.items[0].internalId` / `body.items[*].code` / `headers.x-total`
* @param expectedType 可选目标类型（`string` / `number` / `boolean` / `object` / `array` / `null`，也接受 `array<T>`）
*/
function resolveBinding(root, path, expectedType) {
	const matched = fieldSegments(path).join(".");
	const fail = (code, message) => ({
		ok: false,
		code,
		message,
		path
	});
	if (typeof path !== "string" || path.trim().length === 0) return fail("path-not-found", "绑定路径为空");
	const parsed = parsePath(path);
	if (!parsed) return fail("path-not-found", `绑定路径「${path}」无法解析：只支持字段名与 [n] / [*] / [] 下标`);
	let segments = parsed.segments;
	let current;
	if (parsed.envelope === "status") current = root.status;
	else if (parsed.envelope === "headers") {
		current = root.headers;
		if (segments.length > 0) {
			const [first] = segments;
			if (first && first.name.length > 0 && first.indexes.length === 0) segments = [{
				...first,
				name: first.name.toLowerCase()
			}, ...segments.slice(1)];
			current = lowerCaseHeaders(root.headers);
		}
	} else current = root.body;
	const evaluated = evalSegments(current, segments, 0, path);
	if (!evaluated.ok) return fail(evaluated.failure.code, evaluated.failure.message);
	let value = evaluated.value;
	let unwrapped = false;
	if (segments.some((segment) => segment.indexes.includes("wildcard"))) {
		if (!Array.isArray(value)) return fail("path-not-found", `绑定路径「${path}」的通配未产出数组`);
		if (value.length === 0) return fail("empty-wildcard", `绑定路径「${path}」的通配（[*]）未匹配到任何元素；通常是上游查询为空，先确认上游请求参数`);
		const arrayTarget = expectedType !== void 0 && expectedType.trim().length > 0 && isArrayType(expectedType);
		if (value.length === 1 && !arrayTarget) {
			value = value[0];
			unwrapped = true;
		} else if (value.length > 1 && expectedType !== void 0 && expectedType.trim().length > 0 && !arrayTarget) return fail("type-mismatch", `绑定路径「${path}」期望类型 ${expectedType}，但通配展开得到 ${value.length} 个元素的数组（实际类型 array）；请改用 [0] 或把目标声明成数组`);
	}
	if (expectedType !== void 0 && expectedType.trim().length > 0) {
		const checked = matchType(value, expectedType);
		if (!checked.ok) return fail("type-mismatch", `绑定路径「${path}」期望类型 ${expectedType}，实际类型 ${checked.actual}`);
	}
	return unwrapped ? {
		ok: true,
		value,
		matched,
		unwrapped: true
	} : {
		ok: true,
		value,
		matched
	};
}

//#endregion
//#region src/execute/request.ts
const JSON_CONTENT_TYPE = "application/json";
function hasOwn(record, key) {
	return record !== void 0 && Object.prototype.hasOwnProperty.call(record, key) && record[key] !== void 0;
}
/**
* 把卡入参逐个解析出值：绑定优先，其次节点常量（含 `$inputs.x` 槽位引用）。
*
* 没解析出值的字段不在这里报错——`plan.buildPlan` 已经做过静态缺参判定，
* 走到这里还缺就是运行期漏传，由 {@link buildRequest} 统一报 `param-missing`。
*/
function resolveFields(input, filePaths) {
	const provided = input.provided ?? {};
	const inputs = input.inputs ?? {};
	const constants = input.node.constants ?? {};
	const constantKeys = Object.keys(constants);
	const fields = [];
	const missing = [];
	for (const field of input.card.inputs ?? []) {
		if (field.role === "credential") continue;
		const key = normalizePath(field.path);
		if (filePaths.has(key)) continue;
		if (hasOwn(provided, key)) {
			fields.push({
				path: field.path,
				type: field.type,
				value: provided[key]
			});
			continue;
		}
		const constantKey = constantKeys.find((candidate) => normalizePath(candidate) === key);
		if (constantKey !== void 0) {
			const raw = constants[constantKey];
			const slot = typeof raw === "string" ? inputSlotNameOf(raw) : void 0;
			if (slot === void 0) {
				fields.push({
					path: field.path,
					type: field.type,
					value: raw
				});
				continue;
			}
			if (hasOwn(inputs, slot)) {
				fields.push({
					path: field.path,
					type: field.type,
					value: inputs[slot]
				});
				continue;
			}
		}
		missing.push({
			path: field.path,
			type: field.type,
			value: void 0
		});
	}
	return {
		fields,
		missing
	};
}
/** 值 → 字符串（URL/请求头/路径参数只接受标量；对象/数组在这里是错的用法）。 */
function scalarText(field) {
	const value = field.value;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null) return void 0;
}
function parseBodyPath(path) {
	const segments = [];
	const pattern = /([^.[\]]+)|\[(\d+|\*)\]/g;
	let match;
	while ((match = pattern.exec(path)) !== null) {
		if (match[1] !== void 0) {
			segments.push({
				kind: "prop",
				name: match[1]
			});
			continue;
		}
		const raw = match[2] ?? "";
		segments.push(raw === "*" ? {
			kind: "index",
			index: 0,
			wildcard: true
		} : {
			kind: "index",
			index: Number(raw),
			wildcard: false
		});
	}
	return segments;
}
/** 往请求体骨架里写一个值（中途按下一段是属性还是下标决定建对象还是建数组）。 */
function assignBody(root, path, value) {
	const segments = parseBodyPath(path);
	if (segments.length === 0) return `空的 body 字段路径`;
	let cursor = root;
	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i];
		const isLast = i === segments.length - 1;
		const next = segments[i + 1];
		if (isLast) {
			if (segment.kind === "index") return `body 字段路径不能以下标结尾：${path}`;
			if (Array.isArray(value) && path.includes("[*]")) return `字段 ${path} 是通配行（[*]），不能直接喂数组：请在链上写显式下标（如 body.lines[0].materialId）`;
			cursor[segment.name] = value;
			return;
		}
		const wantsArray = next !== void 0 && next.kind === "index";
		if (segment.kind === "prop") {
			const holder = cursor;
			if (holder[segment.name] === void 0) holder[segment.name] = wantsArray ? [] : {};
			cursor = holder[segment.name];
			continue;
		}
		const holder = cursor;
		const index = segment.wildcard ? 0 : segment.index;
		if (holder[index] === void 0) holder[index] = wantsArray ? [] : {};
		cursor = holder[index];
	}
}
/** 模板 query 段 → 有序键值对（值为空表示裸键）。 */
function parseTemplateQuery(query) {
	if (query === "") return [];
	return query.split("&").filter((pair) => pair !== "").map((pair) => {
		const at = pair.indexOf("=");
		return at === -1 ? [pair, ""] : [pair.slice(0, at), pair.slice(at + 1)];
	});
}
/** query 值编码：冒号/等号按采集原文保留（百度 uploadid 这类值按字面校验）。 */
function encodeQueryValue(value) {
	return encodeURIComponent(value).replace(/%3A/g, ":").replace(/%3D/g, "=");
}
function serializeQuery(pairs) {
	return pairs.map(([name, value]) => value === "" ? name : `${name}=${encodeQueryValue(value)}`).join("&");
}
/** multipart 字段值：标量原样，数组/对象 JSON 字面量。 */
function multipartValueOf(value) {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null) return "";
	return JSON.stringify(value);
}
/** 构造 multipart 正文（文本字段 + 文件分片）；filePaths 里的字段不再重复写文本。 */
function multipartBodyOf(boundary, body, fileParts, filePaths) {
	const chunks = [];
	for (const [key, value] of Object.entries(body)) {
		if (filePaths.has(normalizePath(`body.${key}`))) continue;
		chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${multipartValueOf(value)}\r\n`, "utf8"));
	}
	for (const part of fileParts) {
		const formName = part.field.startsWith("body.") ? part.field.slice(5) : part.field;
		const safeName = part.filename.replace(/"/g, "_");
		chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${formName}"; filename="${safeName}"\r\nContent-Type: ${part.contentType}\r\n\r\n`, "utf8"));
		chunks.push(Buffer.from(part.data));
		chunks.push(Buffer.from("\r\n", "utf8"));
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
	return Buffer.concat(chunks);
}
/** 扁平 body → application/x-www-form-urlencoded；数组/对象按 JSON 字面量落值。 */
function formBodyOf(body) {
	const encode = (value) => encodeURIComponent(value).replace(/%3A/g, ":");
	const pairs = [];
	for (const [key, value] of Object.entries(body)) {
		if (value === void 0) continue;
		const text = typeof value === "string" ? value : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
		pairs.push(`${encodeURIComponent(key)}=${encode(text)}`);
	}
	return pairs.join("&");
}
/**
* 构造一条请求。
*
* 失败一律带 `path`（能指到具体字段就指），让回执能直接告诉 agent 该改链上的哪个位置。
*/
function buildRequest(input) {
	const fileParts = input.fileParts ?? [];
	const filePaths = new Set(fileParts.map((part) => normalizePath(part.field)));
	const { fields, missing } = resolveFields(input, filePaths);
	const notices = [];
	if (missing.length > 0) {
		const first = missing[0];
		return {
			ok: false,
			code: "param-missing",
			message: `节点 ${input.node.nodeId} 缺入参：${missing.map((field) => `${field.path}（${field.type}）`).join("、")}`,
			path: first.path
		};
	}
	const template = input.card.identity.urlTemplate;
	const mark = template.indexOf("?");
	const rawPath = mark === -1 ? template : template.slice(0, mark);
	const rawQuery = mark === -1 ? "" : template.slice(mark + 1);
	const pathValues = /* @__PURE__ */ new Map();
	const queryPairs = parseTemplateQuery(rawQuery);
	const headers = {};
	const body = {};
	let hasBodyField = false;
	for (const field of fields) {
		const at = field.path.indexOf(".");
		const location = at === -1 ? field.path : field.path.slice(0, at);
		const rest = at === -1 ? "" : field.path.slice(at + 1);
		if (location === "path") {
			const text = scalarText(field);
			if (text === void 0) return {
				ok: false,
				code: "param-type-mismatch",
				message: `path 参数 ${field.path} 必须是标量`,
				path: field.path
			};
			pathValues.set(rest, text);
			continue;
		}
		if (location === "header") {
			const text = scalarText(field);
			if (text === void 0) return {
				ok: false,
				code: "param-type-mismatch",
				message: `请求头 ${field.path} 必须是标量`,
				path: field.path
			};
			headers[rest] = text;
			continue;
		}
		if (location === "body") {
			if (filePaths.has(normalizePath(field.path))) continue;
			const failure = assignBody(body, rest, field.value);
			if (failure !== void 0) return {
				ok: false,
				code: "param-type-mismatch",
				message: failure,
				path: field.path
			};
			hasBodyField = true;
			continue;
		}
		if (location === "query") {
			const text = scalarText(field);
			if (text === void 0) return {
				ok: false,
				code: "param-type-mismatch",
				message: `query 参数 ${field.path} 必须是标量`,
				path: field.path
			};
			const hit = queryPairs.find(([name]) => name === rest);
			if (hit === void 0) queryPairs.push([rest, text]);
			else hit[1] = text;
			continue;
		}
		notices.push(`未知的入参位置前缀「${location}」（字段 ${field.path}），已忽略`);
	}
	let anonymousSeen = 0;
	let missingPlaceholder;
	const resolvedPath = rawPath.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name) => {
		const anonymous = name === "p";
		const key = anonymous ? `p${anonymousSeen += 1}` : name;
		const value = pathValues.get(key);
		if (value === void 0) {
			missingPlaceholder = missingPlaceholder ?? {
				key,
				anonymous
			};
			return "";
		}
		return encodeURIComponent(value);
	});
	if (missingPlaceholder !== void 0) return {
		ok: false,
		code: "param-missing",
		message: `URL 模板占位符 {${missingPlaceholder.anonymous ? "p" : missingPlaceholder.key}} 没有值：在链上给 path.${missingPlaceholder.key} 常量或绑定（匿名 {p} 按次序对应 path.p1、path.p2…）`,
		path: `path.${missingPlaceholder.key}`
	};
	const leftover = queryPairs.find(([, value]) => /^\{[A-Za-z0-9_]+\}$/.test(value));
	if (leftover !== void 0) {
		const name = leftover[1].slice(1, -1);
		return {
			ok: false,
			code: "param-missing",
			message: `query 模板占位符 {${name}} 没有值：在链上给 query.${name} 常量或绑定`,
			path: `query.${name}`
		};
	}
	const base = input.baseUrl.replace(/\/+$/, "");
	const query = serializeQuery(queryPairs);
	const url = query === "" ? `${base}${resolvedPath}` : `${base}${resolvedPath}?${query}`;
	try {
		new URL(url);
	} catch {
		return {
			ok: false,
			code: "bad-url-template",
			message: `拼出来的 URL 不合法：${url}`
		};
	}
	const method = input.node.method.toUpperCase();
	const sendsBody = method !== "GET" && method !== "HEAD" && (hasBodyField || fileParts.length > 0);
	let bodyText;
	if (sendsBody) {
		const contentTypeKey = Object.keys(headers).find((name) => name.toLowerCase() === "content-type");
		const contentType = contentTypeKey === void 0 ? "" : headers[contentTypeKey].toLowerCase();
		if (contentType.includes("multipart/form-data")) {
			const boundary = `----dshDataforge${Math.random().toString(16).slice(2)}`;
			const nextKey = Object.keys(headers).find((name) => name.toLowerCase() === "content-type") ?? "content-type";
			headers[nextKey] = `multipart/form-data; boundary=${boundary}`;
			bodyText = multipartBodyOf(boundary, body, fileParts, filePaths);
		} else if (fileParts.length > 0) return {
			ok: false,
			code: "file-part-invalid",
			message: `文件分片要求 content-type 为 multipart/form-data（当前 ${contentType === "" ? "未设置" : contentType}）`
		};
		else if (contentType === "") {
			headers["content-type"] = JSON_CONTENT_TYPE;
			bodyText = JSON.stringify(body);
		} else if (contentType.includes("application/x-www-form-urlencoded")) bodyText = formBodyOf(body);
		else bodyText = JSON.stringify(body);
	}
	return {
		ok: true,
		request: {
			method,
			url,
			headers,
			...bodyText === void 0 ? {} : { body: bodyText }
		},
		notices
	};
}

//#endregion
//#region src/execute/http.ts
/** 默认正文上限 2 MiB（对齐设计的 `chainResponseLimitBytes` 缺省）。 */
const DEFAULT_RESPONSE_LIMIT_BYTES = 2097152;
/** 默认单次超时 30s。 */
const DEFAULT_TIMEOUT_MS = 3e4;
/** 默认重定向跳数上限。 */
const DEFAULT_MAX_REDIRECTS = 5;
/** 留痕时必须脱敏的头名（小写）。 */
const SECRET_HEADERS = /* @__PURE__ */ new Set([
	"cookie",
	"set-cookie",
	"authorization",
	"proxy-authorization",
	"x-api-key",
	"x-auth-token",
	"x-csrf-token"
]);
/** 跨 origin 重定向时绝不带过去的头。 */
const AUTH_HEADERS = /* @__PURE__ */ new Set([
	"authorization",
	"proxy-authorization",
	"cookie",
	"x-api-key"
]);
/**
* 头脱敏：凭证类头名只留名字，值替换成 `***`。
*
* 进 `events.ndjson` 的请求/响应头都要过这一道——运行留痕是要长期保存、可能被导出的资产。
*/
function redactHeaders(headers) {
	const out = {};
	for (const [name, value] of Object.entries(headers ?? {})) out[name] = SECRET_HEADERS.has(name.toLowerCase()) ? "***" : value;
	return out;
}
/**
* 原始 `Set-Cookie` 行：优先用 `getSetCookie()`（Node 22 / undici），
* 老实现退回单条 `get('set-cookie')`。绝不把多条用 `, ` 拼起来再解析。
*/
function setCookiesOf(headers) {
	const getter = headers.getSetCookie;
	if (typeof getter === "function") try {
		return getter.call(headers);
	} catch {
		return [];
	}
	const merged = headers.get("set-cookie");
	return merged === null ? [] : [merged];
}
/** 小写化响应头（同名多值按 `, ` 合并）。 */
function normalizeHeaders(headers) {
	const out = {};
	headers.forEach((value, name) => {
		const key = name.toLowerCase();
		const existing = out[key];
		out[key] = existing === void 0 ? value : `${existing}, ${value}`;
	});
	return out;
}
function isRedirect(status) {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function isRetryableStatus(status) {
	return status === 429 || status >= 500 && status <= 599;
}
function parseUrlOrUndefined(raw) {
	try {
		const url = new URL(raw);
		return url.protocol === "http:" || url.protocol === "https:" ? url : void 0;
	} catch {
		return;
	}
}
const sleep$3 = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
/**
* 发一次请求（含重定向跟随）。
*
* `redirect: 'manual'` 是有意的：`fetch` 自带的自动跟随没有跳数上限，也管不住跨 origin
* 时是否把鉴权头带过去。这里每一跳都自己判一遍。
*/
async function attemptOnce(spec, headers) {
	const timeoutMs = spec.timeoutMs ?? 3e4;
	const maxRedirects = spec.maxRedirects ?? 5;
	let currentUrl = spec.url;
	for (let hop = 0; hop <= maxRedirects; hop += 1) {
		const target = parseUrlOrUndefined(currentUrl);
		if (target === void 0) return {
			kind: "failure",
			code: "bad-url",
			message: `不是合法的 http(s) URL：${currentUrl}`
		};
		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		const onCallerAbort = () => controller.abort();
		spec.signal?.addEventListener("abort", onCallerAbort, { once: true });
		let response;
		try {
			response = await fetch(currentUrl, {
				method: spec.method,
				headers,
				...spec.body === void 0 ? {} : { body: spec.body },
				redirect: "manual",
				credentials: "omit",
				signal: controller.signal
			});
		} catch (err) {
			if (spec.signal?.aborted === true) return {
				kind: "failure",
				code: "aborted",
				message: "调用方已取消"
			};
			if (timedOut) return {
				kind: "failure",
				code: "timeout",
				message: `请求超时（${timeoutMs}ms）`
			};
			return {
				kind: "failure",
				code: "network-error",
				message: err instanceof Error ? err.message : String(err)
			};
		} finally {
			clearTimeout(timer);
			spec.signal?.removeEventListener("abort", onCallerAbort);
		}
		const location = response.headers.get("location");
		if (!isRedirect(response.status) || location === null) return {
			kind: "response",
			response,
			finalUrl: currentUrl
		};
		await response.body?.cancel().catch(() => void 0);
		const next = parseUrlOrUndefined(new URL(location, currentUrl).href);
		if (next === void 0) return {
			kind: "failure",
			code: "bad-url",
			message: `重定向目标不是合法的 http(s) URL：${location}`
		};
		if (next.origin !== target.origin) {
			for (const name of Object.keys(headers)) if (AUTH_HEADERS.has(name.toLowerCase())) delete headers[name];
		}
		if (response.status === 303) spec = {
			...spec,
			method: "GET",
			body: void 0
		};
		currentUrl = next.href;
	}
	return {
		kind: "failure",
		code: "redirect-limit",
		message: `重定向超过 ${maxRedirects} 跳，已中止（疑似循环跳转）`
	};
}
/**
* 按上限流式读正文。
*
* 不用 `response.text()`：那会把整个响应先读进内存再让你截断，上限就形同虚设。
* 顺便 `reader.cancel()` 尽早断开，不给服务端继续灌数据的机会。
*/
async function readBodyLimited(response, limitBytes) {
	const body = response.body;
	if (body === null) return {
		text: "",
		bytes: 0,
		truncated: false
	};
	const reader = body.getReader();
	const chunks = [];
	let bytes = 0;
	let truncated = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value === void 0) continue;
			const room = limitBytes - bytes;
			if (value.byteLength >= room) {
				if (room > 0) chunks.push(value.subarray(0, room));
				bytes += Math.max(0, room);
				truncated = true;
				await reader.cancel().catch(() => void 0);
				break;
			}
			chunks.push(value);
			bytes += value.byteLength;
		}
	} finally {
		reader.releaseLock();
	}
	const merged = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return {
		text: new TextDecoder("utf-8").decode(merged),
		bytes,
		truncated
	};
}
function parseJson(text) {
	const trimmed = text.trim();
	if (trimmed === "" || trimmed.startsWith("{") === false && trimmed.startsWith("[") === false) return void 0;
	try {
		return JSON.parse(trimmed);
	} catch {
		return;
	}
}
/**
* 发请求并返回分类后的结果。
*
* 重试只发生在**没有拿到可用响应**的情形：网络错、超时、以及 429/5xx。
* 4xx（除 429）不重试——那是定义问题，重试只是把同一个错误多打几遍。
* 调用方取消后立即停止重试。
*/
async function httpRequest(spec) {
	const started = Date.now();
	const retry = Math.max(0, spec.retry ?? 0);
	const limitBytes = spec.limitBytes ?? 2097152;
	const headers = { ...spec.headers ?? {} };
	let attempts = 0;
	let last;
	for (let attempt = 0; attempt <= retry; attempt += 1) {
		attempts = attempt + 1;
		if (spec.signal?.aborted === true) return {
			ok: false,
			code: "aborted",
			message: "调用方已取消",
			attempts,
			elapsedMs: Date.now() - started
		};
		const outcome = await attemptOnce(spec, headers);
		if (outcome.kind === "failure") {
			last = {
				code: outcome.code,
				message: outcome.message
			};
			if (outcome.code === "aborted" || outcome.code === "bad-url" || outcome.code === "redirect-limit") break;
		} else {
			const { response, finalUrl } = outcome;
			if (!isRetryableStatus(response.status) || attempt === retry) {
				const read = await readBodyLimited(response, limitBytes);
				const json = parseJson(read.text);
				const setCookies = setCookiesOf(response.headers);
				return {
					ok: true,
					response: {
						status: response.status,
						headers: normalizeHeaders(response.headers),
						...setCookies.length === 0 ? {} : { setCookies },
						bodyText: read.text,
						...json === void 0 ? {} : { json },
						bytes: read.bytes,
						truncated: read.truncated,
						attempts,
						elapsedMs: Date.now() - started,
						finalUrl
					}
				};
			}
			await response.body?.cancel().catch(() => void 0);
			last = {
				code: "network-error",
				message: `HTTP ${response.status}`
			};
		}
		if (attempt < retry) await sleep$3(120 * (attempt + 1));
	}
	return {
		ok: false,
		code: last?.code ?? "network-error",
		message: last?.message ?? "请求失败（无细节）",
		attempts,
		elapsedMs: Date.now() - started
	};
}

//#endregion
//#region src/execute/credentials.ts
/** 空摘要（降级用）。 */
function emptyCredentialApplication(status, reason, captureIds = []) {
	return {
		status,
		source: "capture",
		names: [],
		domains: [],
		captureIds: [...captureIds],
		expired: 0,
		reason
	};
}
/** 去掉前导点并小写：`.Example.com` → `example.com`。 */
function normalizeDomain(domain) {
	return domain.replace(/^\./, "").toLowerCase();
}
/** 域名匹配：host 等于域，或 host 以 `.域` 结尾（`badexample.com` 不会命中 `example.com`）。 */
function domainMatches(host, cookieDomain) {
	const domain = normalizeDomain(cookieDomain);
	if (domain === "") return false;
	const target = host.toLowerCase();
	return target === domain || target.endsWith(`.${domain}`);
}
/** 路径匹配：`/api` 命中 `/api/x`，不命中 `/apix`；`/` 恒命中。 */
function pathMatches(requestPath, cookiePath) {
	if (cookiePath === "" || cookiePath === "/") return true;
	if (requestPath === cookiePath) return true;
	if (!requestPath.startsWith(cookiePath)) return false;
	return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}
function expiredAt(cookie, now) {
	return cookie.expiresAt !== void 0 && cookie.expiresAt <= now;
}
function domainSpecificity(cookie) {
	return normalizeDomain(cookie.domain).length;
}
/**
* 按目标 URL 选 cookie：domain/path/secure 匹配 → 过期拆分 → 同名去重 → 排序。
*
* 同名去重键是 `name + path`：浏览器可能同时持有父域与子域的同名 cookie，
* 全发出去会让服务端取到不确定的那一个。这里选**更具体的域**（更长），
* 同域再取 `obtainedAt` 更新者——可解释、可复现。
*/
function selectCookies(entries, url, now) {
	let target;
	try {
		target = new URL(url);
	} catch {
		return {
			selected: [],
			expired: [],
			matched: []
		};
	}
	if (target.protocol !== "http:" && target.protocol !== "https:") return {
		selected: [],
		expired: [],
		matched: []
	};
	const host = target.hostname;
	const requestPath = target.pathname === "" ? "/" : target.pathname;
	const matched = [];
	for (const cookie of entries) {
		if (cookie.name === "" || cookie.value === "") continue;
		if (!domainMatches(host, cookie.domain)) continue;
		if (!pathMatches(requestPath, cookie.path)) continue;
		if (cookie.secure && target.protocol !== "https:") continue;
		matched.push(cookie);
	}
	const expired = [];
	const live = [];
	for (const cookie of matched) (expiredAt(cookie, now) ? expired : live).push(cookie);
	const byKey = /* @__PURE__ */ new Map();
	for (const cookie of live) {
		const key = `${cookie.name}\u0000${cookie.path}`;
		const existing = byKey.get(key);
		if (existing === void 0 || domainSpecificity(cookie) > domainSpecificity(existing) || domainSpecificity(cookie) === domainSpecificity(existing) && cookie.obtainedAt > existing.obtainedAt) byKey.set(key, cookie);
	}
	return {
		selected: [...byKey.values()].sort((left, right) => {
			if (left.path.length !== right.path.length) return right.path.length - left.path.length;
			return left.name.localeCompare(right.name);
		}),
		expired,
		matched
	};
}
/** 选中的 cookie → `Cookie` 头值；空集合返回 `undefined`（不造空头）。 */
function cookieHeaderOf(cookies) {
	if (cookies.length === 0) return void 0;
	return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
/**
* 合并凭证头：头名大小写不敏感；`cookie` 与已有值拼接，其它同名以注入值为准。
*
* 纯函数：不修改入参对象。凭证是权威——卡上若显式写了同名头，注入值覆盖它；
* 唯一例外是 `cookie`，因为丢弃卡上已有的 cookie 会静默改变请求语义。
*/
function mergeCredentialHeaders(existing, injected) {
	const out = { ...existing };
	for (const [rawName, value] of Object.entries(injected)) {
		const key = Object.keys(out).find((candidate) => candidate.toLowerCase() === rawName.toLowerCase());
		if (key === void 0) {
			out[rawName] = value;
			continue;
		}
		if (key.toLowerCase() === "cookie" && out[key] !== "") out[key] = `${out[key]}; ${value}`;
		else out[key] = value;
	}
	return out;
}
/** 参与二次脱敏的最小值长度：太短的值会把正常业务文本打碎。 */
const MIN_SECRET_LENGTH = 4;
/**
* 把凭证 query 参数拼进 URL（R-4 M3 token-param）。
*
* - 同名参数以凭证值为准（`searchParams.set`），URL 其余部分原样保留；
* - 编码交给 `URL` 的序列化（空格→`+`、`&`/`=` 等百分号编码），不手拼字符串；
* - 非法 URL / 非 http(s) / 空参数表原样返回，不抛。
*/
function withQueryParams(url, params) {
	if (params === void 0) return url;
	const entries = Object.entries(params).filter(([name]) => name !== "");
	if (entries.length === 0) return url;
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
	for (const [name, value] of entries) parsed.searchParams.set(name, value);
	return parsed.toString();
}
/**
* 敏感值集合：去空/去短（< 4 字符，避免打碎正常文本）、去重、按长度降序。
*
* 降序是为了先替换长值：当短值恰好是长值子串时（如 `abc` 与 `abcdef`），
* 先替换长值才不会留下半截泄漏。返回值只在内存里用，不落任何地方。
*/
function redactSecretValues(values) {
	const unique = /* @__PURE__ */ new Set();
	for (const value of values) {
		if (typeof value !== "string") continue;
		if (value.length < MIN_SECRET_LENGTH) continue;
		unique.add(value);
	}
	return [...unique].sort((left, right) => right.length - left.length);
}
/**
* 文本脱敏：把已知凭证值替换成 `***`。
*
* 用在「服务端把凭证回显进响应正文/URL」这类二次泄漏面：请求 URL 摘要、正文摘要、
* `emitted` 出参、错误消息都要过这一道。secrets 为空时原样返回。
*/
function redactSecretsInText(text, secrets) {
	const list = redactSecretValues(secrets);
	if (list.length === 0) return text;
	let out = text;
	for (const secret of list) out = out.split(secret).join("***");
	return out;
}
/** 由匹配结果构造 `applied` 摘要（名字/域/来源，不含值）。 */
function appliedCredentialApplication(selection, captureIds) {
	return {
		status: "applied",
		source: "capture",
		header: "cookie",
		names: selection.selected.map((cookie) => cookie.name),
		domains: [...new Set(selection.selected.map((cookie) => normalizeDomain(cookie.domain)))],
		captureIds: [...captureIds],
		expired: selection.expired.length
	};
}
/**
* 解析 `Set-Cookie`：只取 `name=value`，属性（Path/Domain/HttpOnly…）不进内存 jar。
*
* M2 的 jar 只服务「同一个主链目标站点」的重放，不需要跨域/跨路径选择；
* 真正的域/路径匹配仍由采集期 provider 负责。属性丢掉是刻意的简化，写在设计里。
*/
function setCookiePairsOf(setCookies) {
	const pairs = [];
	for (const raw of setCookies) {
		const first = raw.split(";")[0]?.trim() ?? "";
		const at = first.indexOf("=");
		if (at <= 0) continue;
		const name = first.slice(0, at).trim();
		const value = first.slice(at + 1).trim();
		if (name === "" || value === "") continue;
		pairs.push({
			name,
			value
		});
	}
	return pairs;
}
/** `Set-Cookie[]` → 一个可发的 `cookie` 头值；没有可用 cookie 返回 `undefined`。 */
function cookieHeaderFromSetCookies(setCookies) {
	const pairs = setCookiePairsOf(setCookies);
	if (pairs.length === 0) return void 0;
	return pairs.map((pair) => `${pair.name}=${pair.value}`).join("; ");
}
/** cookie 头值里的名字（去重、保序）；用于事件摘要，不含值。 */
function cookieNamesOf(header) {
	if (header === void 0 || header === "") return [];
	const names = [];
	for (const part of header.split(";")) {
		const name = part.trim().split("=")[0]?.trim() ?? "";
		if (name !== "" && !names.includes(name)) names.push(name);
	}
	return names;
}
/**
* 合并两份 cookie 头：按 name 覆盖，fresh 永远赢。
*
* 换票后的新会话 cookie 必须覆盖旧值；保留其它 cookie（locale/AB 等）能减少
* 「登录成功但页面参数丢了」的次生失败。返回 `undefined` 表示两边都没有。
*/
function mergeCookieValues(base, fresh) {
	const pairs = /* @__PURE__ */ new Map();
	const ingest = (header) => {
		if (header === void 0 || header === "") return;
		for (const part of header.split(";")) {
			const trimmed = part.trim();
			const at = trimmed.indexOf("=");
			if (at <= 0) continue;
			const name = trimmed.slice(0, at).trim();
			const value = trimmed.slice(at + 1).trim();
			if (name !== "") pairs.set(name, value);
		}
	};
	ingest(base);
	ingest(fresh);
	if (pairs.size === 0) return void 0;
	return [...pairs].map(([name, value]) => `${name}=${value}`).join("; ");
}
/** 把 `cookie` 头写进请求头（大小写不敏感替换）；不修改入参。 */
function withCookieHeader(headers, cookieHeader) {
	const out = { ...headers };
	if (cookieHeader === void 0 || cookieHeader === "") return out;
	const key = Object.keys(out).find((name) => name.toLowerCase() === "cookie");
	if (key === void 0) out["cookie"] = cookieHeader;
	else out[key] = cookieHeader;
	return out;
}
/** 读取请求头里的 cookie 值（大小写不敏感）；没有返回 `undefined`。 */
function cookieHeaderIn(headers) {
	const key = Object.keys(headers).find((name) => name.toLowerCase() === "cookie");
	return key === void 0 ? void 0 : headers[key];
}

//#endregion
//#region src/execute/run.ts
/**
* 执行调度器（IF-3）：一条 interface-chain + 一份执行计划 → 一条 runs 事件流。
*
* 职责边界（刻意收窄）：
*   - 只认 `buildPlan()` 的产物，不自己算拓扑或覆盖判定（`topoOrder` / `dependencyPairs`
*     只有一份，见 `chains/validate.ts`）；
*   - 只依赖 `chains/*`、`runs/store.ts` 与 `execute/*`，**不**依赖 capture/ library/ client/；
*   - 闸门（预检、确认、执行开关、后台 job 装配）全在 `orchestration/application.ts`，
*     这里只回答一个问题：按计划把请求发出去，并把发生的事如实写进事件流。
*
* 调度规则：
*   - 就绪队列 = indegree 0 的节点；indegree 由 `dependencyPairs(doc)` 统计，且只保留两端
*     都在节点集合里的 pair（与 `topoOrder` 内部的 `indegree.has` 同源，不引第二套规则）；
*   - 就绪节点按节点 ID 字典序取，同等输入下调度顺序可复现；
*   - 某节点成功后才对其下游 `indegree-1`（失败/取消不再放行任何新节点）；
*   - 并发上限 `concurrency`（默认 4，硬上限 16）。
*
* 事件不变量：
*   - 每个实际启动的节点恰好一条 `step(status:start)` + 一条终态（`done` | `error`）；
*   - 因中止而没启动的节点**不发** `step`，只在 `result.businessData` 里标 `skipped`
*     ——否则会被 `foldSummary` 误算成失败节点；
*   - `start` 先于请求；`terminal` / `result` 只在全部在飞节点落定后写。
*
* 错误码是契约：`ChainRunErrorCode` 只增不改名（工具回执、运行记录、面板都按它分支）。
* 三处映射在这里显式写明，不打哑谜：
*   - HTTP `aborted` → `cancelled`；`timeout` → `node-timeout`；
*   - HTTP `bad-url` → `bad-url-template`；`redirect-limit` → `node-network-error`（带原文）；
*   - `buildRequest` 的运行期 `param-missing` → `param-missing`（静态缺参已在 `buildPlan`
*     拦过，走到这里是防御：例如模板里有 `{p2}` 但卡只声明了 `path.p1`）。
*
* @module dsh-dataforge/execute/run
*/
/** 摘要正文上限：请求/响应各留前 4 KiB（隐私面与可诊断面的平衡点）。 */
const DIGEST_PREVIEW_BYTES = 4096;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
/** 节点级重试硬上限（与 IF-4 的 retry 上限一致）。 */
const MAX_NODE_RETRY = 5;
/** 幂等方法：只有它们才吃 `node.retry`（写方法重试 = 重放写请求，绝不默认）。 */
const IDEMPOTENT_METHODS$1 = /* @__PURE__ */ new Set([
	"GET",
	"HEAD",
	"OPTIONS"
]);
/**
* 执行能力探测：不按 Node 版本号硬判，只看实际能力。
*
* 这样 `package.json` 的 `engines` 不必为执行模块单独收紧；能力缺席时诚实报
* `execution-unavailable`，不做 polyfill（polyfill 会让「能跑」变成不确定行为）。
*/
function chainExecutionUnavailableReason() {
	if (typeof fetch !== "function") return "当前运行时没有全局 fetch（需要 Node 22+）：执行不可用";
	if (typeof AbortSignal.timeout !== "function") return "当前运行时没有 AbortSignal.timeout：执行不可用";
}
/**
* 生成唯一 runId：`chain-<流程 slug>-<毫秒>`，撞名加 `-2`/`-3`。
*
* 目录名必须安全（会当目录用），所以走 `slugOf`；流程名是用户词汇，中日韩字符保留。
*/
function newChainRunId(dataRoot, flow, now) {
	const base = `chain-${slugOf(flow) || "flow"}-${now}`;
	let candidate = base;
	let suffix = 2;
	while (existsSync(join(runsRoot(dataRoot), candidate))) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}
/** 归一并发：非法值退回默认值，越界夹到 [1, 16]。 */
function clampConcurrency(value, fallback = DEFAULT_CONCURRENCY) {
	return Math.max(1, Math.min(MAX_CONCURRENCY, typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback));
}
/**
* 写运行起点：run.json（写入一次）+ `meta` 事件。
*
* **同步**完成是刻意的：调用方（后台 job 路径）必须在启动 job 之前拿到 runId/runDir，
* 而 `run.json` 又必须早于第一个请求——只有一个同步入口能同时满足这两条。
*/
function prepareChainRun(deps, input) {
	const now = Date.now();
	const runId = input.runId ?? newChainRunId(deps.dataRoot, input.doc.meta.flow, now);
	const concurrency = clampConcurrency(input.concurrency, deps.config.concurrency);
	const chain = {
		site: input.doc.meta.site,
		flow: input.doc.meta.flow,
		version: input.doc.meta.version,
		...input.chainPath === void 0 ? {} : { path: input.chainPath },
		apiVersion: input.doc.apiVersion
	};
	const meta = {
		kind: "chain-run",
		flow: input.doc.meta.flow,
		flowName: input.doc.meta.flow,
		chain,
		params: input.redactParams === true ? Object.fromEntries(Object.keys(input.inputs ?? {}).map((key) => [key, "***"])) : { ...input.inputs ?? {} },
		baseUrl: input.plan.baseUrl,
		dryRun: input.dryRun === true,
		planned: [...input.plan.order],
		concurrency,
		startedAt: now
	};
	const runDir = startRunRecord(deps.dataRoot, runId, meta);
	appendEvent(deps.dataRoot, runId, {
		event: "meta",
		flow: meta.flow,
		name: meta.flowName,
		steps: meta.planned,
		dryRun: meta.dryRun,
		chain
	});
	return {
		runId,
		runDir,
		meta
	};
}
/**
* 跑完一条链（预检已过、计划已定）。
*
* 返回 `ok: false` 只可能是**预检**级别的问题（当前实现里只有「计划为空」这类防御分支）；
* 运行期失败走 `ok: true` + `summary.status='failed'` + `failedNode`——因为留痕已经写下了，
* 调用方不该把它当成「没开始」。
*/
async function executeChainRun(deps, prepared, input) {
	const { doc, cards, plan } = input;
	const { runId, runDir } = prepared;
	const inputs = input.inputs ?? {};
	const concurrency = clampConcurrency(input.concurrency, deps.config.concurrency);
	const fallbackTimeoutMs = Math.max(1, Math.floor(deps.config.nodeTimeoutSeconds)) * 1e3;
	const limitBytes = Math.max(1, Math.floor(deps.config.responseLimitBytes));
	const events = loadRunEvents(deps.dataRoot, runId) ?? [];
	const emit = (event) => {
		appendEvent(deps.dataRoot, runId, event);
		events.push({
			...event,
			ts: Date.now()
		});
	};
	const nodeById = /* @__PURE__ */ new Map();
	for (const node of doc.nodes) nodeById.set(node.id, node);
	const planById = /* @__PURE__ */ new Map();
	for (const node of plan.nodes) planById.set(node.nodeId, node);
	if (input.dryRun === true) {
		emit({
			event: "terminal",
			success: true,
			cancelled: false,
			message: `dry-run：计划 ${plan.order.length} 个节点，未发送任何请求`
		});
		emit({
			event: "result",
			success: true,
			businessData: businessDataOf(doc, [])
		});
		return {
			ok: true,
			runId,
			runDir,
			summary: foldSummary(runId, loadRunEvents(deps.dataRoot, runId) ?? events),
			nodes: [],
			cancelled: false
		};
	}
	const idSet = new Set(plan.order);
	const indegree = /* @__PURE__ */ new Map();
	for (const id of plan.order) indegree.set(id, 0);
	const downstream = /* @__PURE__ */ new Map();
	const seenDependencies = /* @__PURE__ */ new Set();
	for (const pair of dependencyPairs(doc)) {
		if (!idSet.has(pair.from) || !idSet.has(pair.to)) continue;
		const dependencyKey = `${pair.from}\u0000${pair.to}`;
		if (seenDependencies.has(dependencyKey)) continue;
		seenDependencies.add(dependencyKey);
		indegree.set(pair.to, (indegree.get(pair.to) ?? 0) + 1);
		const list = downstream.get(pair.from) ?? [];
		if (!list.includes(pair.to)) list.push(pair.to);
		downstream.set(pair.from, list);
	}
	const ready = plan.order.filter((id) => (indegree.get(id) ?? 0) === 0);
	const sortReady = () => {
		ready.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
	};
	sortReady();
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (input.signal?.aborted === true) controller.abort();
	else input.signal?.addEventListener("abort", onAbort, { once: true });
	let runtimeCookieHeader;
	let reloginTask;
	const ensureRelogin = () => {
		if (reloginTask !== void 0) return reloginTask;
		const spec = input.relogin?.spec;
		if (spec === void 0) {
			reloginTask = Promise.resolve({
				ok: false,
				code: "relogin-unavailable",
				message: "未配置登录链（relogin 运行参数缺席）"
			});
			return reloginTask;
		}
		if (spec.site === doc.meta.site && spec.flow === doc.meta.flow) {
			reloginTask = Promise.resolve({
				ok: false,
				code: "relogin-cycle",
				message: "登录链不能是当前链自身（会无限递归）；请指定一条真正的登录链路"
			});
			return reloginTask;
		}
		reloginTask = (async () => {
			try {
				const outcome = await input.relogin.run(spec, controller.signal);
				if (outcome.ok) runtimeCookieHeader = mergeCookieValues(runtimeCookieHeader, outcome.cookieHeader);
				return outcome;
			} catch (error) {
				return {
					ok: false,
					code: "relogin-failed",
					message: `登录链执行抛异常：${error instanceof Error ? error.message : String(error)}`
				};
			}
		})();
		return reloginTask;
	};
	const roots = /* @__PURE__ */ new Map();
	const results = /* @__PURE__ */ new Map();
	const emittedByNode = /* @__PURE__ */ new Map();
	let failure;
	let cancelled = false;
	let cancelledMessage;
	const markSkipped = (nodeId) => {
		const planNode = planById.get(nodeId);
		if (results.has(nodeId)) return;
		results.set(nodeId, {
			nodeId,
			cardId: planNode.cardId,
			method: planNode.method.toUpperCase(),
			url: planNode.urlTemplate,
			status: "skipped",
			attempts: 0,
			elapsedMs: 0,
			requestDigest: {
				method: planNode.method.toUpperCase(),
				url: planNode.urlTemplate,
				headers: {}
			},
			bindings: []
		});
	};
	async function runNode(nodeId) {
		const planNode = planById.get(nodeId);
		const card = cards.get(planNode.cardId);
		const node = nodeById.get(nodeId);
		const method = planNode.method.toUpperCase();
		const startedAt = Date.now();
		const bindings = [];
		const result = {
			nodeId,
			cardId: planNode.cardId,
			method,
			url: planNode.urlTemplate,
			status: "error",
			attempts: 0,
			elapsedMs: 0,
			requestDigest: {
				method,
				url: planNode.urlTemplate,
				headers: {}
			},
			bindings
		};
		const provided = {};
		for (const edge of doc.edges) {
			const to = splitBindingPath(edge.to);
			if (!to || to.nodeId !== nodeId) continue;
			if (isInputSlotRef(edge.from)) continue;
			const from = splitBindingPath(edge.from);
			if (!from) {
				const message = `绑定边 ${edge.from} → ${edge.to} 的 from 不是合法路径`;
				bindings.push({
					from: edge.from,
					to: edge.to,
					code: "binding-path-not-found",
					error: message
				});
				return failPreRequest(bindings, "binding-path-not-found", message);
			}
			const root = roots.get(from.nodeId);
			if (root === void 0) {
				const message = `绑定边 ${edge.from} → ${edge.to} 的上游节点 ${from.nodeId} 没有可用响应`;
				bindings.push({
					from: edge.from,
					to: edge.to,
					code: "binding-path-not-found",
					error: message
				});
				return failPreRequest(bindings, "binding-path-not-found", message);
			}
			const bound = resolveBinding(root, from.fieldPath, edge.transform === void 0 && edge.pick === void 0 ? edgeTargetType(card, to.fieldPath) : void 0);
			if (!bound.ok) {
				const code = bindingCodeOf(bound.code);
				const message = `绑定边 ${edge.from} → ${edge.to} 求值失败：${bound.message}`;
				bindings.push({
					from: edge.from,
					to: edge.to,
					code,
					error: bound.message
				});
				return failPreRequest(bindings, code, message);
			}
			let value = bound.value;
			if (edge.pick !== void 0) {
				const picked = applyPick(value, edge.pick);
				if (!picked.ok) {
					bindings.push({
						from: edge.from,
						to: edge.to,
						code: "pick-not-found",
						error: picked.message
					});
					return failPreRequest(bindings, "pick-not-found", picked.message);
				}
				value = picked.value;
			}
			const transformed = edge.transform === void 0 ? value : applyEdgeTransform(value, edge.transform);
			provided[normalizePath(to.fieldPath)] = transformed;
			bindings.push({
				from: edge.from,
				to: edge.to,
				...edge.transform === void 0 ? {} : { transform: edge.transform },
				...edge.pick === void 0 ? {} : { pick: edge.pick },
				valuePreview: previewValue$1(transformed)
			});
		}
		const fileParts = resolveNodeFiles(node, inputs);
		if (!fileParts.ok) {
			emit({
				event: "step",
				id: nodeId,
				action: `${method} ${planNode.urlTemplate}`,
				status: "start",
				data: { card: planNode.cardId }
			});
			return failAfterStart(bindings, fileParts.code, fileParts.message);
		}
		const hashes = resolveNodeHashes(node, inputs);
		if (!hashes.ok) {
			emit({
				event: "step",
				id: nodeId,
				action: `${method} ${planNode.urlTemplate}`,
				status: "start",
				data: { card: planNode.cardId }
			});
			return failAfterStart(bindings, hashes.code, hashes.message);
		}
		for (const [field, value] of Object.entries(hashes.values)) provided[normalizePath(field)] = value;
		const built = buildRequest({
			node: planNode,
			card,
			baseUrl: planNode.baseUrl ?? plan.baseUrl,
			provided,
			inputs,
			...fileParts.parts.length === 0 ? {} : { fileParts: fileParts.parts }
		});
		if (!built.ok) {
			const message = built.message;
			emit({
				event: "step",
				id: nodeId,
				action: `${method} ${planNode.urlTemplate}`,
				status: "start",
				data: { card: planNode.cardId }
			});
			return failAfterStart(bindings, built.code, message);
		}
		let request = built.request;
		let credentialApplication;
		/** token-param 注入的 query 参数：只用于拼真实 URL 与脱敏，值绝不进事件/回执。 */
		let injectedQuery = {};
		if (input.credentials !== void 0) {
			const resolution = input.credentials({
				card,
				url: request.url,
				method: request.method,
				nodeId
			});
			credentialApplication = resolution.application;
			if (Object.keys(resolution.headers).length > 0) request = {
				...request,
				headers: mergeCredentialHeaders(request.headers, resolution.headers)
			};
			if (resolution.query !== void 0 && Object.keys(resolution.query).length > 0) {
				injectedQuery = resolution.query;
				request = {
					...request,
					url: withQueryParams(request.url, resolution.query)
				};
			}
			result.credentials = credentialApplication;
		}
		if (runtimeCookieHeader !== void 0) {
			const merged = mergeCookieValues(cookieHeaderIn(request.headers), runtimeCookieHeader);
			request = {
				...request,
				headers: withCookieHeader(request.headers, merged)
			};
		}
		let secrets = credentialApplication?.status === "applied" ? secretValuesOf(request.headers, injectedQuery) : [];
		const sensitive = input.sensitive === true;
		if (secrets.length > 0) {
			for (const binding of bindings) if (binding.valuePreview !== void 0) binding.valuePreview = redactSecrets(binding.valuePreview, secrets);
		}
		if (sensitive) {
			for (const binding of bindings) if (binding.valuePreview !== void 0) binding.valuePreview = "[已脱敏]";
		}
		const requestDigest = {
			method: request.method,
			url: digestUrlFor(request.url, injectedQuery, secrets),
			headers: redactHeaders(request.headers),
			...request.body === void 0 ? {} : { bodyPreview: bodyPreviewOf(request.body, secrets, sensitive) }
		};
		result.requestDigest = requestDigest;
		result.url = requestDigest.url;
		emit({
			event: "step",
			id: nodeId,
			action: `${request.method} ${requestDigest.url}`,
			status: "start",
			data: {
				card: planNode.cardId,
				attempt: 1,
				request: requestDigest,
				...credentialApplication === void 0 ? {} : { credentials: credentialApplication }
			}
		});
		input.onProgress?.(`▶ ${nodeId}：${request.method} ${requestDigest.url}`);
		const sendRequest = async (target) => httpRequest({
			method: target.method,
			url: target.url,
			headers: target.headers,
			...target.body === void 0 ? {} : { body: target.body },
			timeoutMs: timeoutOf(node, fallbackTimeoutMs),
			retry: retryOf(node, method),
			limitBytes,
			signal: controller.signal
		});
		let outcome = await sendRequest(request);
		result.attempts = outcome.ok ? outcome.response.attempts : outcome.attempts;
		if (outcome.ok && outcome.response.status === 401 && input.relogin !== void 0) {
			const firstResponse = outcome.response;
			const relogin = await ensureRelogin();
			result.relogin = relogin.ok ? {
				attempted: true,
				success: true,
				...relogin.runId === void 0 ? {} : { runId: relogin.runId },
				cookieNames: relogin.cookieNames,
				...relogin.persisted === void 0 ? {} : { persisted: relogin.persisted }
			} : {
				attempted: true,
				success: false,
				code: relogin.code,
				message: relogin.message,
				...relogin.runId === void 0 ? {} : { runId: relogin.runId }
			};
			if (!relogin.ok) {
				if (controller.signal.aborted) {
					result.status = "cancelled";
					result.errorCode = "cancelled";
					result.error = "已取消：换票过程中被中止";
					result.elapsedMs = Date.now() - startedAt;
					results.set(nodeId, result);
					emit({
						event: "step",
						id: nodeId,
						status: "error",
						elapsed: result.elapsedMs,
						error: result.error,
						data: {
							code: "cancelled",
							relogin: result.relogin
						}
					});
					return {
						kind: "cancelled",
						message: result.error
					};
				}
				const firstDigest = {
					status: firstResponse.status,
					bytes: firstResponse.bytes,
					truncated: firstResponse.truncated,
					bodyPreview: sensitive ? "[已脱敏]" : previewText(redactSecrets(firstResponse.bodyText, secrets))
				};
				result.status = "error";
				result.httpStatus = firstResponse.status;
				result.responseDigest = firstDigest;
				result.errorCode = relogin.code;
				result.error = `HTTP 401 后自动换票失败（${relogin.code}）：${relogin.message}；需人工重新登录并更新凭证`;
				result.elapsedMs = Date.now() - startedAt;
				results.set(nodeId, result);
				emit({
					event: "step",
					id: nodeId,
					status: "error",
					elapsed: result.elapsedMs,
					error: result.error,
					data: {
						code: relogin.code,
						response: firstDigest,
						relogin: result.relogin
					}
				});
				return {
					kind: "failed",
					code: relogin.code,
					message: `节点 ${nodeId}：${result.error}`
				};
			}
			const freshCookie = mergeCookieValues(cookieHeaderIn(request.headers), runtimeCookieHeader ?? relogin.cookieHeader);
			request = {
				...request,
				headers: withCookieHeader(request.headers, freshCookie)
			};
			secrets = secretValuesOf(request.headers, injectedQuery);
			const replayDigestUrl = digestUrlFor(request.url, injectedQuery, secrets);
			result.requestDigest = {
				method: request.method,
				url: replayDigestUrl,
				headers: redactHeaders(request.headers),
				...request.body === void 0 ? {} : { bodyPreview: bodyPreviewOf(request.body, secrets, sensitive) }
			};
			result.url = replayDigestUrl;
			outcome = await sendRequest(request);
			result.attempts += outcome.ok ? outcome.response.attempts : outcome.attempts;
		}
		if (!outcome.ok) {
			if (outcome.code === "aborted" || controller.signal.aborted) {
				result.status = "cancelled";
				result.errorCode = "cancelled";
				result.error = "已取消：请求在飞行途中被中止";
				result.elapsedMs = Date.now() - startedAt;
				results.set(nodeId, result);
				emit({
					event: "step",
					id: nodeId,
					status: "error",
					elapsed: result.elapsedMs,
					error: result.error,
					data: { code: "cancelled" }
				});
				return {
					kind: "cancelled",
					message: result.error
				};
			}
			const code = outcome.code === "timeout" ? "node-timeout" : outcome.code === "bad-url" ? "bad-url-template" : "node-network-error";
			result.errorCode = code;
			result.error = outcome.message;
			result.elapsedMs = Date.now() - startedAt;
			results.set(nodeId, result);
			emit({
				event: "step",
				id: nodeId,
				status: "error",
				elapsed: result.elapsedMs,
				error: outcome.message,
				data: {
					code,
					attempts: outcome.attempts
				}
			});
			return {
				kind: "failed",
				code,
				message: `节点 ${nodeId}：${outcome.message}`
			};
		}
		const response = outcome.response;
		input.onSetCookies?.(response.setCookies ?? [], nodeId);
		const responseDigest = {
			status: response.status,
			bytes: response.bytes,
			truncated: response.truncated,
			bodyPreview: sensitive ? "[已脱敏]" : previewText(redactSecrets(response.bodyText, secrets))
		};
		result.httpStatus = response.status;
		result.responseDigest = responseDigest;
		if (response.truncated) result.truncated = true;
		result.elapsedMs = Date.now() - startedAt;
		if (response.status < 200 || response.status >= 300) {
			const code = response.status === 401 || response.status === 403 ? authRequired(card) ? "node-auth-required" : "node-http-error" : "node-http-error";
			const hint = code === "node-auth-required" ? authHint(card, response.status, credentialApplication, result.relogin) : `HTTP ${response.status}`;
			result.errorCode = code;
			result.error = hint;
			results.set(nodeId, result);
			emit({
				event: "step",
				id: nodeId,
				status: "error",
				elapsed: result.elapsedMs,
				error: hint,
				data: {
					code,
					response: responseDigest,
					...result.relogin === void 0 ? {} : { relogin: result.relogin }
				}
			});
			return {
				kind: "failed",
				code,
				message: `节点 ${nodeId}：${hint}`
			};
		}
		if (response.truncated && needsBody(doc, nodeId)) {
			result.errorCode = "response-too-large";
			result.error = `响应正文超过 ${limitBytes} 字节上限（已截断），下游要读 body：拒绝拿半截正文解析`;
			results.set(nodeId, result);
			emit({
				event: "step",
				id: nodeId,
				status: "error",
				elapsed: result.elapsedMs,
				error: result.error,
				data: {
					code: "response-too-large",
					response: responseDigest
				}
			});
			return {
				kind: "failed",
				code: "response-too-large",
				message: `节点 ${nodeId}：${result.error}`
			};
		}
		const expectation = checkNodeExpects(node, response.json === void 0 ? void 0 : { body: response.json });
		if (!expectation.ok) {
			result.errorCode = "node-business-error";
			result.error = expectation.message;
			results.set(nodeId, result);
			emit({
				event: "step",
				id: nodeId,
				status: "error",
				elapsed: result.elapsedMs,
				error: expectation.message,
				data: {
					code: "node-business-error",
					response: responseDigest
				}
			});
			return {
				kind: "failed",
				code: "node-business-error",
				message: `节点 ${nodeId}：${expectation.message}`
			};
		}
		roots.set(nodeId, {
			body: response.json ?? response.bodyText,
			status: response.status,
			headers: response.headers
		});
		const emitted = sensitive ? {} : redactRecord({
			...collectEmitted(doc, cards, nodeId, roots.get(nodeId)),
			...collectCardOutputs(doc, cards, nodeId, roots.get(nodeId))
		}, secrets);
		emittedByNode.set(nodeId, emitted);
		result.status = "done";
		results.set(nodeId, result);
		emit({
			event: "step",
			id: nodeId,
			status: "done",
			elapsed: result.elapsedMs,
			data: {
				response: responseDigest,
				emitted,
				...result.relogin === void 0 ? {} : { relogin: result.relogin }
			}
		});
		input.onProgress?.(`✔ ${nodeId}：HTTP ${response.status}，${result.elapsedMs}ms`);
		return { kind: "done" };
		function failPreRequest(records, code, message) {
			emit({
				event: "step",
				id: nodeId,
				action: `${method} ${planNode.urlTemplate}`,
				status: "start",
				data: { card: planNode.cardId }
			});
			return failAfterStart(records, code, message);
		}
		function failAfterStart(records, code, message) {
			result.status = "error";
			result.errorCode = code;
			result.error = message;
			result.elapsedMs = Date.now() - startedAt;
			result.bindings = records;
			results.set(nodeId, result);
			emit({
				event: "step",
				id: nodeId,
				status: "error",
				elapsed: result.elapsedMs,
				error: message,
				data: { code }
			});
			return {
				kind: "failed",
				code,
				message: `节点 ${nodeId}：${message}`
			};
		}
	}
	const inFlight = /* @__PURE__ */ new Set();
	for (;;) {
		while (failure === void 0 && !controller.signal.aborted && ready.length > 0 && inFlight.size < concurrency) {
			const nodeId = ready.shift();
			const task = runNode(nodeId).then((outcome) => {
				if (outcome.kind === "done") {
					for (const next of downstream.get(nodeId) ?? []) {
						const left = (indegree.get(next) ?? 0) - 1;
						indegree.set(next, left);
						if (left === 0 && !results.has(next)) {
							ready.push(next);
							sortReady();
						}
					}
					return;
				}
				if (outcome.kind === "cancelled") {
					cancelled = true;
					cancelledMessage = outcome.message;
					return;
				}
				if (failure === void 0) failure = {
					nodeId,
					code: outcome.code,
					message: outcome.message
				};
			}).finally(() => {
				inFlight.delete(task);
			});
			inFlight.add(task);
		}
		if (inFlight.size === 0) break;
		await Promise.race(inFlight);
	}
	if (controller.signal.aborted && !cancelled && results.size < plan.order.length) {
		cancelled = true;
		cancelledMessage = cancelledMessage ?? "已取消：调度在节点边界停止";
	}
	for (const nodeId of plan.order) if (!results.has(nodeId)) markSkipped(nodeId);
	if (failure === void 0 && !cancelled) {
		const stranded = plan.order.filter((nodeId) => results.get(nodeId)?.status === "skipped");
		if (stranded.length > 0) failure = {
			nodeId: stranded[0],
			code: "cycle",
			message: `调度器没有放行 ${stranded.join("、")}：依赖永远满足不了（拓扑序与依赖表不一致，链可能被绕过工具手改）`
		};
	}
	const ordered = plan.order.map((nodeId) => results.get(nodeId));
	const success = failure === void 0 && !cancelled;
	const failedNode = failure?.nodeId;
	const message = terminalMessage(doc, plan, failure, cancelled, cancelledMessage, ordered);
	emit({
		event: "terminal",
		success,
		cancelled,
		message
	});
	emit({
		event: "result",
		success,
		businessData: businessDataOf(doc, ordered, {
			failedNode,
			cancelled,
			outputs: Object.fromEntries(emittedByNode)
		})
	});
	input.signal?.removeEventListener("abort", onAbort);
	const finalEvents = loadRunEvents(deps.dataRoot, runId) ?? events;
	return {
		ok: true,
		runId,
		runDir,
		summary: foldSummary(runId, finalEvents),
		nodes: ordered,
		...failedNode === void 0 ? {} : { failedNode },
		cancelled
	};
}
/** 结果段的业务视图：只放小字段，NodeResult 的摘要留在 step 事件里。 */
function businessDataOf(doc, nodes, extra = {}) {
	const completed = nodes.filter((node) => node.status === "done").map((node) => node.nodeId);
	return {
		chain: {
			site: doc.meta.site,
			flow: doc.meta.flow,
			version: doc.meta.version
		},
		...extra.failedNode === void 0 ? {} : { failedNode: extra.failedNode },
		...extra.cancelled === true ? { cancelled: true } : {},
		completed,
		...extra.outputs === void 0 || Object.keys(extra.outputs).length === 0 ? {} : { outputs: extra.outputs },
		nodes: nodes.map((node) => ({
			nodeId: node.nodeId,
			status: node.status,
			attempts: node.attempts,
			elapsedMs: node.elapsedMs,
			...node.httpStatus === void 0 ? {} : { httpStatus: node.httpStatus },
			...node.errorCode === void 0 ? {} : { errorCode: node.errorCode },
			...node.relogin === void 0 ? {} : { relogin: node.relogin }
		}))
	};
}
/** 终态消息：成功/失败/取消三种叙述，失败时必须指到节点与第几步。 */
function terminalMessage(doc, plan, failure, cancelled, cancelledMessage, nodes) {
	const doneCount = nodes.filter((node) => node.status === "done").length;
	if (failure !== void 0) {
		const step = plan.order.indexOf(failure.nodeId) + 1;
		return `链 ${doc.meta.site}/${doc.meta.flow} v${doc.meta.version} 在第 ${step} 步「${failure.nodeId}」失败（${failure.code}）：${failure.message}`;
	}
	if (cancelled) return `链 ${doc.meta.site}/${doc.meta.flow} v${doc.meta.version} 已取消：${doneCount}/${plan.order.length} 个节点完成${cancelledMessage === void 0 ? "" : `（${cancelledMessage}）`}`;
	return `链 ${doc.meta.site}/${doc.meta.flow} v${doc.meta.version} 执行完成：${plan.order.length} 个节点全绿`;
}
/** 业务码校验：expect 缺省 = 不检查。 */
function checkNodeExpects(node, json) {
	const expectations = [...node.expect === void 0 ? [] : [node.expect], ...node.expects ?? []];
	if (expectations.length === 0) return { ok: true };
	if (json === void 0) return {
		ok: false,
		message: `业务码校验失败：响应不是 JSON，取不到 ${expectations[0]?.path ?? ""}`
	};
	for (const expectation of expectations) {
		const actual = fieldValueOf(json, expectation.path);
		if (actual === void 0) return {
			ok: false,
			message: `业务码校验失败：响应里没有 ${expectation.path}`
		};
		if (String(actual) !== String(expectation.equals)) return {
			ok: false,
			message: `业务码不符：${expectation.path} 期望 ${String(expectation.equals)}，实际 ${String(actual)}`
		};
	}
	return { ok: true };
}
/** 从数组出参里按字段值选一个元素，再取字段（缺省取整个元素）。 */
function applyPick(value, pick) {
	if (!Array.isArray(value)) return {
		ok: false,
		message: `pick 需要数组出参，实际是 ${Array.isArray(value) ? "array" : typeof value}`
	};
	const hit = value.find((item) => fieldValueOf(item, pick.match.field) !== void 0 && String(fieldValueOf(item, pick.match.field)) === String(pick.match.equals));
	if (hit === void 0) return {
		ok: false,
		message: `pick 没有匹配项：${pick.match.field} = ${String(pick.match.equals)}`
	};
	if (pick.field === void 0) return {
		ok: true,
		value: hit
	};
	const picked = fieldValueOf(hit, pick.field);
	if (picked === void 0) return {
		ok: false,
		message: `pick 命中元素里没有字段 ${pick.field}`
	};
	return {
		ok: true,
		value: picked
	};
}
/** 点路径取值（只用于 pick 的 match.field / field，不支持通配）。 */
function fieldValueOf(value, path) {
	let cursor = value;
	for (const segment of path.split(".").filter((part) => part !== "")) {
		if (Array.isArray(cursor)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return void 0;
			cursor = cursor[index];
			continue;
		}
		if (typeof cursor !== "object" || cursor === null) return void 0;
		cursor = cursor[segment];
	}
	return cursor;
}
/** 节点 hashes → 文件派生值（md5 / md5-array / sha1）。 */
function resolveNodeHashes(node, inputs) {
	const values = {};
	for (const [field, spec] of Object.entries(node.hashes ?? {})) {
		const match = /^(md5|md5-array|sha1):(.+)$/.exec(spec);
		if (match === null) return {
			ok: false,
			code: "hash-spec-invalid",
			message: `节点 ${node.id} 的 hash 字段 ${field} 规格非法：${spec}`
		};
		const algorithm = match[1] === "sha1" ? "sha1" : "md5";
		const rawRef = match[2].trim();
		const slot = isInputSlotRef(rawRef) ? rawRef.slice(8) : void 0;
		const path = slot === void 0 ? rawRef : inputs[slot];
		if (typeof path !== "string" || path.trim() === "") return {
			ok: false,
			code: "hash-file-not-found",
			message: `节点 ${node.id} 的 hash 字段 ${field} 取不到文件路径（${spec}）`
		};
		if (!existsSync(path) || !statSync(path).isFile()) return {
			ok: false,
			code: "hash-file-not-found",
			message: `节点 ${node.id} 的 hash 文件不存在：${path}`
		};
		let digest;
		try {
			digest = createHash(algorithm).update(readFileSync(path)).digest("hex");
		} catch (error) {
			return {
				ok: false,
				code: "hash-failed",
				message: `计算 ${algorithm} 失败 ${path}：${error instanceof Error ? error.message : String(error)}`
			};
		}
		values[field] = match[1] === "md5-array" ? [digest] : digest;
	}
	return {
		ok: true,
		values
	};
}
/** 节点 files → 本地文件分片；文件不存在/读失败在发请求前拒。 */
function resolveNodeFiles(node, inputs) {
	const parts = [];
	for (const [field, ref] of Object.entries(node.files ?? {})) {
		if (typeof ref !== "string" || ref.trim() === "") return {
			ok: false,
			code: "file-field-invalid",
			message: `节点 ${node.id} 的文件字段 ${field} 没有路径`
		};
		const slot = isInputSlotRef(ref) ? ref.slice(8) : void 0;
		const path = slot === void 0 ? ref : inputs[slot];
		if (typeof path !== "string" || path.trim() === "") return {
			ok: false,
			code: "file-not-found",
			message: `节点 ${node.id} 的文件字段 ${field} 取不到路径（${ref}）`
		};
		if (!existsSync(path) || !statSync(path).isFile()) return {
			ok: false,
			code: "file-not-found",
			message: `节点 ${node.id} 的文件不存在或不是普通文件：${path}`
		};
		let data;
		try {
			data = readFileSync(path);
		} catch (error) {
			return {
				ok: false,
				code: "file-read-failed",
				message: `读取文件失败 ${path}：${error instanceof Error ? error.message : String(error)}`
			};
		}
		parts.push({
			field,
			filename: basename(path),
			contentType: contentTypeOfFile(path),
			data
		});
	}
	return {
		ok: true,
		parts
	};
}
function contentTypeOfFile(path) {
	const ext = extname(path).toLowerCase();
	if (ext === ".txt") return "text/plain";
	if (ext === ".json") return "application/json";
	if (ext === ".png") return "image/png";
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".gif") return "image/gif";
	if (ext === ".pdf") return "application/pdf";
	return "application/octet-stream";
}
/** 绑定值转换：显式声明才做，绝不隐式改变类型。 */
function applyEdgeTransform(value, transform) {
	if (transform === "string") return typeof value === "string" ? value : String(value);
	if (transform === "json") return JSON.stringify(value);
	return JSON.stringify(Array.isArray(value) ? value : [value]);
}
function bindingCodeOf(code) {
	if (code === "type-mismatch") return "binding-type-mismatch";
	if (code === "null-value") return "binding-null";
	if (code === "empty-wildcard") return "empty-wildcard";
	return "binding-path-not-found";
}
/** 一个节点的下游绑定目标字段声明类型（决定 `[*]` 解包还是保数组）。 */
function edgeTargetType(card, fieldPath) {
	const key = normalizePath(fieldPath);
	return (card.inputs ?? []).find((field) => normalizePath(field.path) === key)?.type;
}
/** 节点出参探测：把能取到的绑定值报进 `emitted`；取不到的不报错（由消费节点报）。 */
function collectEmitted(doc, cards, nodeId, root) {
	const emitted = {};
	for (const edge of doc.edges) {
		if (isInputSlotRef(edge.from)) continue;
		const from = splitBindingPath(edge.from);
		if (!from || from.nodeId !== nodeId) continue;
		const to = splitBindingPath(edge.to);
		const card = to === void 0 ? void 0 : cards.get(cardOfNode(doc, to.nodeId));
		const bound = resolveBinding(root, from.fieldPath, edge.transform !== void 0 || edge.pick !== void 0 || to === void 0 || card === void 0 ? void 0 : edgeTargetType(card, to.fieldPath));
		if (bound.ok) {
			let value = bound.value;
			if (edge.pick !== void 0) {
				const picked = applyPick(value, edge.pick);
				if (!picked.ok) continue;
				value = picked.value;
			}
			emitted[edge.from] = edge.transform === void 0 ? value : applyEdgeTransform(value, edge.transform);
		}
	}
	return emitted;
}
/** 卡片声明的全部出参（不依赖 downstream edge），供 businessData/cleanup 结果绑定使用。 */
function collectCardOutputs(doc, cards, nodeId, root) {
	const card = cards.get(cardOfNode(doc, nodeId));
	if (card === void 0) return {};
	const emitted = {};
	for (const field of card.outputs) {
		const bound = resolveBinding(root, field.path);
		if (bound.ok) emitted[field.path] = bound.value;
	}
	return emitted;
}
function cardOfNode(doc, nodeId) {
	return doc.nodes.find((node) => node.id === nodeId)?.card ?? "";
}
/** 下游是否有绑定读 `body.*`（决定「截断能否忍」）。 */
function needsBody(doc, nodeId) {
	for (const edge of doc.edges) {
		if (isInputSlotRef(edge.from)) continue;
		const from = splitBindingPath(edge.from);
		if (!from || from.nodeId !== nodeId) continue;
		const path = from.fieldPath;
		if (path === "body" || path.startsWith("body.") || path.startsWith("body[")) return true;
	}
	return false;
}
/** 卡声明了鉴权（非 `none`）才有资格报 `node-auth-required`。 */
function authRequired(card) {
	return typeof card.auth === "string" && card.auth.length > 0 && card.auth !== "none";
}
/**
* 401/403 的诊断：必须能回答「到底带没带凭证」。
*
* R-3 的旧文案把 401 一律推给 R-4；现在注入了就说明「带了但仍被拒（可能过期）」，
* 没注入就说明「没带上以及为什么」——两种下一步不同，不能混成一句。
*/
function authHint(card, status, application, relogin) {
	if (relogin?.success === true) return `HTTP ${status}：已自动换票（登录链 ${relogin.runId ?? "本次运行"}）并重放一次，仍被拒；登录态或账号权限仍有问题。请检查登录链/账号权限后重跑，不要原样重试`;
	if (relogin?.attempted === true && relogin.success === false) return `HTTP ${status}：自动换票失败（${relogin.code ?? "relogin-failed"}）：${relogin.message ?? "未知原因"}；需人工重新登录并更新凭证`;
	if (application?.status === "applied") {
		const names = application.names.join("、");
		return `HTTP ${status}：${application.header === "cookie" ? `已注入 ${application.names.length} 个 cookie（${names}）` : application.header === "authorization" ? `已注入 authorization 头（${names}）` : application.header === "query" ? `已注入 query token（${names}）` : `已注入 ${application.names.length} 个凭证（${names}）`}但仍被拒；凭证可能过期或账号权限不足。可传 relogin 登录链自动换票，或重新采集/登录后重跑`;
	}
	const reason = application === void 0 ? "本次运行未配置凭证注入（R-4 注入缝未装配）" : application.status === "expired" ? "匹配到的 cookie 全部过期" : application.status === "unsupported" ? application.reason ?? "token 型凭证未采集" : application.reason ?? "没有可用凭证";
	return `HTTP ${status}：该卡声明了鉴权（${String(card.auth)}），但没有注入可用凭证（${reason}）；本次未执行自动换票`;
}
/** 节点级超时优先（R-1 预留位），否则用全局缺省。 */
function timeoutOf(node, fallbackMs) {
	const seconds = node.timeoutSeconds;
	return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) * 1e3 : fallbackMs;
}
/** 只有幂等方法才吃节点级 retry：写方法重试就是重放写请求。 */
function retryOf(node, method) {
	if (!IDEMPOTENT_METHODS$1.has(method)) return 0;
	const raw = node.retry;
	if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
	return Math.max(0, Math.min(MAX_NODE_RETRY, Math.floor(raw)));
}
/** 正文预览：按字节截前 4 KiB（多字节字符被切断时留替换符，比超限更可接受）。 */
/** 请求正文预览：字符串脱敏截断；multipart 二进制只报字节数。 */
function bodyPreviewOf(body, secrets, sensitive) {
	if (typeof body !== "string") return `[multipart ${body.byteLength} bytes]`;
	return sensitive ? "[已脱敏]" : previewText(redactSecrets(body, secrets));
}
function previewText(text) {
	const buffer = Buffer.from(text ?? "", "utf8");
	if (buffer.byteLength <= DIGEST_PREVIEW_BYTES) return text ?? "";
	return buffer.subarray(0, DIGEST_PREVIEW_BYTES).toString("utf8");
}
/** 留痕里必须二次脱敏的 token 类头（与 http.ts 的 SECRET_HEADERS 对齐）。 */
const TOKEN_SECRET_HEADERS = /* @__PURE__ */ new Set([
	"authorization",
	"proxy-authorization",
	"x-api-key",
	"x-auth-token",
	"x-csrf-token"
]);
/**
* 请求 URL 的留痕版本：先按注入的 query 参数名打码，再按已知凭证值全文替换。
*
* token-param 的凭证就在 URL 里，原样落 `events.ndjson`/回执就是泄漏；参数名保留
* 是为了让运行记录还能回答「带了哪个参数」，值一律 `***`。
*/
function digestUrlFor(url, query, secrets) {
	const names = Object.keys(query);
	return redactSecrets(names.length === 0 ? url : withQueryParams(url, Object.fromEntries(names.map((name) => [name, "***"]))), secrets);
}
/**
* 从已注入的凭证里取「需要从留痕中抹掉的值」。
*
* 覆盖三类（R-4 M3 起）：cookie 值、token 头值（`Bearer xxx` 连同裸 token）、
* query token 值（原始值 + URL 编码形态）。太短（< 4 字符）的值不参与替换，
* 避免把正常业务文本打碎。这些值只在本次节点的内存里存在，函数返回后不写任何地方。
*/
function secretValuesOf(headers, query = {}) {
	const secrets = /* @__PURE__ */ new Set();
	const add = (raw) => {
		if (raw === void 0) return;
		const value = raw.trim();
		if (value.length < 4) return;
		secrets.add(value);
		const space = value.indexOf(" ");
		if (space > 0) {
			const tail = value.slice(space + 1).trim();
			if (tail.length >= 4) secrets.add(tail);
		}
	};
	for (const [name, headerValue] of Object.entries(headers)) {
		const lower = name.toLowerCase();
		if (lower === "cookie") {
			for (const part of headerValue.split(";")) {
				const trimmed = part.trim();
				const at = trimmed.indexOf("=");
				if (at === -1) continue;
				add(trimmed.slice(at + 1));
			}
			continue;
		}
		if (TOKEN_SECRET_HEADERS.has(lower)) add(headerValue);
	}
	for (const value of Object.values(query)) {
		add(value);
		add(value.replace(/ /g, "+"));
		try {
			add(encodeURIComponent(value));
		} catch {}
	}
	return [...secrets];
}
/** 文本脱敏：把已知凭证值替换成 `***`（先长后短，避免半截泄漏）。 */
function redactSecrets(text, secrets) {
	return redactSecretsInText(text, secrets);
}
/** 递归脱敏（只用于事件里的 emitted 值，不改变绑定求值本身）。 */
function redactRecord(record, secrets) {
	if (secrets.length === 0) return record;
	const redactUnknown = (value) => {
		if (typeof value === "string") return redactSecrets(value, secrets);
		if (Array.isArray(value)) return value.map(redactUnknown);
		if (typeof value === "object" && value !== null) {
			const out = {};
			for (const [key, child] of Object.entries(value)) out[key] = redactUnknown(child);
			return out;
		}
		return value;
	};
	return redactUnknown(record);
}
/** 绑定值预览：标量原样，对象/数组序列化后截断（事件流不做数据仓库）。 */
function previewValue$1(value) {
	if (typeof value === "string") return value.length <= 512 ? value : `${value.slice(0, 512)}…`;
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		const text = JSON.stringify(value);
		return text.length <= 512 ? text : `${text.slice(0, 512)}…`;
	} catch {
		return "[不可序列化]";
	}
}

//#endregion
//#region src/capture/credential-store.ts
/**
* 换票 cookie 的本地持久化（R-4 M3）。
*
* 为什么要落盘：M2 的换票结果只活一次运行，R-6 的「隔天复跑」会重新 401、重新登录。
* 这里把登录链下发的 cookie 存到 `dataRoot/credentials/cookies.json`，下一次运行
* 由 provider 按 origin 读回，直接带上去。
*
* 安全纪律（红线，改代码前先读）：
*   - 只存本地 `dataRoot`，目录 0700、文件 0600；不做任何上传/日志/回执输出；
*   - 按 **origin** 隔离：`https://a.example.com` 的 cookie 不会发给 `b.example.com`；
*   - 只由登录链（换票）写入；普通主链响应里的 `set-cookie` 不落盘；
*   - 文件损坏/超大 → 当作空库，不抛、不阻塞执行；
*   - 凭证值只出现在这个文件和出站 `cookie` 头里，事件/摘要/回执一律不落值。
*
* @module dsh-dataforge/capture/credential-store
*/
/** 读文件上限：超过就当作空库（防止有人把大文件塞进数据根）。 */
const MAX_STORE_BYTES = 524288;
function emptyStore() {
	return {
		version: 1,
		origins: Object.create(null)
	};
}
/** 读库：不存在/坏 JSON/超大 → 空库。绝不抛。 */
function readStore(storePath) {
	try {
		if (!existsSync(storePath)) return emptyStore();
		const text = readFileSync(storePath, "utf8");
		if (text.length === 0 || Buffer.byteLength(text, "utf8") > MAX_STORE_BYTES) return emptyStore();
		const raw = JSON.parse(text);
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return emptyStore();
		const record = raw;
		if (record["version"] !== 1) return emptyStore();
		const originsRaw = record["origins"];
		if (typeof originsRaw !== "object" || originsRaw === null || Array.isArray(originsRaw)) return emptyStore();
		const origins = Object.create(null);
		for (const [origin, value] of Object.entries(originsRaw)) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
			const entry = value;
			const cookiesRaw = entry["cookies"];
			if (!Array.isArray(cookiesRaw)) continue;
			const cookies = [];
			for (const item of cookiesRaw) {
				if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
				const cookie = item;
				const name = typeof cookie["name"] === "string" ? cookie["name"] : "";
				const cookieValue = typeof cookie["value"] === "string" ? cookie["value"] : "";
				if (name === "" || cookieValue === "") continue;
				const expiresAt = typeof cookie["expiresAt"] === "number" && Number.isFinite(cookie["expiresAt"]) ? cookie["expiresAt"] : void 0;
				cookies.push({
					name,
					value: cookieValue,
					...expiresAt === void 0 ? {} : { expiresAt }
				});
			}
			if (cookies.length === 0) continue;
			origins[origin] = {
				updatedAt: typeof entry["updatedAt"] === "number" ? entry["updatedAt"] : 0,
				cookies
			};
		}
		return {
			version: 1,
			origins
		};
	} catch {
		return emptyStore();
	}
}
/** 原子写：临时文件 0600 → rename；目录 0700。失败不抛（换票成功不应因落盘失败而失败）。 */
function writeStore(storePath, store) {
	const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
	try {
		mkdirSync(dirname(storePath), {
			recursive: true,
			mode: 448
		});
		try {
			chmodSync(dirname(storePath), 448);
		} catch {}
		writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, {
			encoding: "utf8",
			mode: 384
		});
		renameSync(tempPath, storePath);
		try {
			chmodSync(storePath, 384);
		} catch {}
		return true;
	} catch {
		try {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		} catch {}
		return false;
	}
}
/** `https://a.example.com/x` → `https://a.example.com`；非法 URL 返回 undefined。 */
function originOfUrl(url) {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return void 0;
		return parsed.origin;
	} catch {
		return;
	}
}
/**
* 解析一条 `Set-Cookie` 的 name/value/expiresAt。
*
* `Max-Age` 优先于 `Expires`（RFC 6265）；`Max-Age=0` 视为立即过期。
* 属性名大小写不敏感；值里允许出现 `=`。
*/
function parseSetCookie(raw, now) {
	const parts = raw.split(";");
	const first = parts[0]?.trim() ?? "";
	const at = first.indexOf("=");
	if (at <= 0) return void 0;
	const name = first.slice(0, at).trim();
	const value = first.slice(at + 1).trim();
	if (name === "" || value === "") return void 0;
	let expiresAt;
	for (const part of parts.slice(1)) {
		const trimmed = part.trim();
		const eq = trimmed.indexOf("=");
		if (eq <= 0) continue;
		const attr = trimmed.slice(0, eq).trim().toLowerCase();
		const attrValue = trimmed.slice(eq + 1).trim();
		if (attr === "max-age") {
			const seconds = Number(attrValue);
			if (Number.isFinite(seconds)) expiresAt = seconds <= 0 ? now - 1 : now + Math.floor(seconds) * 1e3;
		} else if (attr === "expires" && expiresAt === void 0) {
			const parsed = Date.parse(attrValue);
			if (Number.isFinite(parsed)) expiresAt = parsed;
		}
	}
	return {
		name,
		value,
		...expiresAt === void 0 ? {} : { expiresAt }
	};
}
/** 读某个 origin 的可用 cookie（已过期的不返回）。 */
function readPersistedCookies(storePath, origin, now) {
	const entry = readStore(storePath).origins[origin];
	if (entry === void 0) return [];
	let host;
	let secure;
	try {
		const parsed = new URL(origin);
		host = parsed.hostname;
		secure = parsed.protocol === "https:";
	} catch {
		return [];
	}
	return entry.cookies.filter((cookie) => cookie.expiresAt === void 0 || cookie.expiresAt > now).map((cookie) => ({
		name: cookie.name,
		value: cookie.value,
		domain: host,
		path: "/",
		secure,
		...cookie.expiresAt === void 0 ? {} : { expiresAt: cookie.expiresAt },
		captureId: "persisted",
		obtainedAt: entry.updatedAt
	}));
}
/**
* 把登录链下发的 `set-cookie` 合并进某个 origin（同名覆盖），并原子落盘。
*
* 返回写入的 cookie 数（0 = 没有可用 cookie / 落盘失败）。失败不抛：
* 换票本身已经成功，持久化是「下一次更省事」，不能反过来把当前链打断。
*/
function persistCookies(storePath, origin, setCookies, now) {
	const parsed = setCookies.map((raw) => parseSetCookie(raw, now)).filter((cookie) => cookie !== void 0).filter((cookie) => cookie.expiresAt === void 0 || cookie.expiresAt > now);
	if (parsed.length === 0) return 0;
	const store = readStore(storePath);
	const existing = store.origins[origin]?.cookies ?? [];
	const byName = /* @__PURE__ */ new Map();
	for (const cookie of existing) byName.set(cookie.name, cookie);
	for (const cookie of parsed) byName.set(cookie.name, cookie);
	let cookies = [...byName.values()].slice(-100);
	cookies = cookies.filter((cookie) => cookie.expiresAt === void 0 || cookie.expiresAt > now);
	if (cookies.length === 0) {
		delete store.origins[origin];
		writeStore(storePath, store);
		return 0;
	}
	store.origins[origin] = {
		updatedAt: now,
		cookies
	};
	return writeStore(storePath, store) ? parsed.length : 0;
}

//#endregion
//#region src/execute/throttle.ts
/**
* 创建进程内单飞节流器。
*
* 在飞表只存 Promise：settle 后从表中删除，因此不会缓存「上一次的失败」——
* 下一次触发换票必须重新执行 `fn`（失败不该被静默复用）。
*/
function createReloginThrottle() {
	const inflight = /* @__PURE__ */ new Map();
	return { run(key, fn) {
		const existing = inflight.get(key);
		if (existing !== void 0) return existing;
		let task;
		try {
			task = Promise.resolve(fn());
		} catch (error) {
			task = Promise.reject(error);
		}
		const shared = task.finally(() => {
			if (inflight.get(key) === shared) inflight.delete(key);
		});
		inflight.set(key, shared);
		return shared;
	} };
}

//#endregion
//#region src/uitest/run-store.ts
/**
* UI 回放留痕：`dataRoot/ui-runs/<runId>/`。
*
* 与造数/链运行同一套习惯（run.json 元数据 + events.ndjson 即写即落盘），但**目录分开**：
* 造数运行按游戏规则折摘要（foldSummary 认 meta/step/terminal/result），UI 回放有自己
* 的步骤/断言事件；混进同一个 runs 目录会让 `dataforge_status` 与面板运行列表互相误读。
*
* 截图与失败现场（failure.png / failure.html）落在同一目录，证据跟运行记录走。
*
* @module dsh-dataforge/uitest/run-store
*/
/** UI 运行根：`dataRoot/ui-runs`。 */
function uiRunsRoot(dataRoot) {
	return join(dataRoot, "ui-runs");
}
/** 单次运行目录。 */
function uiRunDir(dataRoot, runId) {
	return join(uiRunsRoot(dataRoot), runId);
}
/** 新建运行目录 + 初始 run.json；返回运行目录。 */
function startUiRun(dataRoot, runId, meta) {
	const dir = uiRunDir(dataRoot, runId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "run.json"), JSON.stringify({
		runId,
		kind: "ui-run",
		status: "running",
		startedAt: Date.now(),
		...meta
	}, null, 2), "utf8");
	return dir;
}
/** 追加事件（带 ts）。 */
function appendUiRunEvent(dataRoot, runId, event) {
	appendFileSync(join(uiRunDir(dataRoot, runId), "events.ndjson"), `${JSON.stringify({
		...event,
		ts: Date.now()
	})}\n`, "utf8");
}
/** 读 run.json；读不到/坏 JSON → undefined（调用方决定跳过还是报错）。 */
function readUiRunRecord(dataRoot, runId) {
	const path = join(uiRunDir(dataRoot, runId), "run.json");
	if (!existsSync(path)) return void 0;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
		return parsed;
	} catch {
		return;
	}
}
/** 读事件流；文件不存在 → 空数组。 */
function readUiRunEvents(dataRoot, runId) {
	const path = join(uiRunDir(dataRoot, runId), "events.ndjson");
	if (!existsSync(path)) return [];
	const events = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		try {
			events.push(JSON.parse(trimmed));
		} catch {}
	}
	return events;
}
/** 合并写 run.json（运行结束后写终态）。 */
function finishUiRun(dataRoot, runId, patch) {
	const current = readUiRunRecord(dataRoot, runId);
	if (current === void 0) return;
	writeFileSync(join(uiRunDir(dataRoot, runId), "run.json"), JSON.stringify({
		...current,
		...patch
	}, null, 2), "utf8");
}
/** 列运行（最近在前）；坏目录跳过。 */
function listUiRuns(dataRoot, limit = 20) {
	const root = uiRunsRoot(dataRoot);
	if (!existsSync(root)) return [];
	const dirs = readdirSync(root).filter((entry) => {
		try {
			return statSync(join(root, entry)).isDirectory();
		} catch {
			return false;
		}
	}).sort().reverse().slice(0, limit);
	const runs = [];
	for (const dir of dirs) {
		const record = readUiRunRecord(dataRoot, dir);
		if (record !== void 0) runs.push(record);
	}
	return runs;
}

//#endregion
//#region src/datasets/export.ts
/**
* 运行产物导出：dataset（业务数据）+ evidence（HTML 报告）。
*
* 只读 run 留痕，不重新执行；业务数据来自 foldSummary 的 businessData（result 事件）。
* 不写凭证、不写请求头原文。
*
* @module dsh-dataforge/datasets/export
*/
function escapeHtml(text) {
	return text.replace(/[&<>"']/g, (ch) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	})[ch]);
}
function textOf$1(value) {
	if (value === void 0) return "";
	try {
		return typeof value === "string" ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}
/**
* 导出一次运行的 dataset + evidence。
*
* @param dataRoot - 插件数据根（runs/datasets/evidence 同级）。
* @param runId - 运行 id。
*/
function exportRunArtifacts(dataRoot, runId) {
	const id = runId.trim();
	if (id === "") return {
		ok: false,
		code: "run-not-found",
		error: "run_id 不能为空"
	};
	const record = readRunRecord(dataRoot, id);
	const events = loadRunEvents(dataRoot, id);
	if (record === void 0 || events === void 0) {
		const uiRecord = readUiRunRecord(dataRoot, id);
		if (uiRecord === void 0) return {
			ok: false,
			code: "run-not-found",
			error: `没有这个运行留痕：${id}`,
			hints: ["先跑一次 dataforge_chain_run / dataforge_ui_run"]
		};
		return exportUiRun(dataRoot, id, uiRecord);
	}
	let summary;
	try {
		summary = foldSummary(id, events);
	} catch (error) {
		return {
			ok: false,
			code: "run-unreadable",
			error: `运行留痕折叠失败：${error.message}`
		};
	}
	const rawChain = record["chain"];
	const chain = rawChain !== null && typeof rawChain === "object" && !Array.isArray(rawChain) ? rawChain : void 0;
	const chainSite = chain?.["site"];
	const chainVersion = chain?.["version"];
	const businessData = summary.businessData ?? {};
	const dataset = {
		apiVersion: "dataforge/v1",
		kind: "run-dataset",
		runId: id,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		status: summary.status,
		site: typeof record["site"] === "string" ? record["site"] : typeof chainSite === "string" ? chainSite : void 0,
		flow: typeof record["flow"] === "string" ? record["flow"] : summary.flow,
		version: typeof record["version"] === "number" ? record["version"] : typeof chainVersion === "number" ? chainVersion : void 0,
		businessData,
		chain,
		run: {
			startedAt: summary.startedAt,
			updatedAt: summary.updatedAt,
			stepsDone: summary.stepsDone,
			totalSteps: summary.totalSteps,
			lastError: summary.lastError
		}
	};
	const datasetPath = join(dataRoot, "datasets", `${id}.json`);
	mkdirSync(dirname(datasetPath), { recursive: true });
	writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), "utf8");
	const reportPath = join(dataRoot, "evidence", id, "report.html");
	mkdirSync(dirname(reportPath), { recursive: true });
	const businessLines = Object.entries(businessData).length === 0 ? "<p class=\"muted\">本次运行没有 businessData</p>" : `<table><thead><tr><th>字段</th><th>值</th></tr></thead><tbody>${Object.entries(businessData).map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td><code>${escapeHtml(textOf$1(value))}</code></td></tr>`).join("")}</tbody></table>`;
	const chainText = chain === void 0 ? "" : `<h2>链身份</h2><pre>${escapeHtml(JSON.stringify(chain, null, 2))}</pre>`;
	const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>运行报告 ${escapeHtml(id)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:920px;margin:32px auto;padding:0 20px;color:#111827;line-height:1.6}h1{font-size:24px}h2{font-size:17px;margin-top:24px}.muted{color:#6b7280}code,pre{background:#f3f4f6;padding:2px 5px;border-radius:4px}pre{padding:12px;overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e7eb;padding:7px 9px;text-align:left;vertical-align:top}th{background:#f9fafb}.status{padding:2px 9px;border-radius:999px;background:#e8f7ee;color:#166534}.failed{background:#fdecea;color:#b91c1c}</style></head><body>
<h1>运行报告 <code>${escapeHtml(id)}</code></h1>
<p>状态：<span class="status ${summary.status === "failed" ? "failed" : ""}">${escapeHtml(summary.status)}</span> ｜ 步骤 ${summary.stepsDone}/${summary.totalSteps} ｜ 更新 ${new Date(summary.updatedAt).toISOString()}</p>
${summary.lastError === void 0 ? "" : `<p class="failed">错误：${escapeHtml(summary.lastError)}</p>`}
<h2>业务数据</h2>${businessLines}
${chainText}
<p class="muted">由 dsh-dataforge 生成；本报告只含运行摘要与 businessData，不含请求头/凭证原文。</p>
</body></html>`;
	writeFileSync(reportPath, html, "utf8");
	return {
		ok: true,
		runId: id,
		datasetPath,
		reportPath,
		kind: "chain",
		status: summary.status,
		businessData,
		...chain === void 0 ? {} : { chain }
	};
}
/** UI 回放证据：dataset 记录步骤/断言，report.html 引截图（success/failure）。 */
function exportUiRun(dataRoot, runId, record) {
	const evidenceDir = join(dataRoot, "evidence", runId);
	mkdirSync(evidenceDir, { recursive: true });
	let copied;
	if (typeof record.screenshot === "string") {
		const name = record.screenshot.split("/").pop() ?? "";
		if (name === "success.png" || name === "failure.png") {
			const source = join(uiRunDir(dataRoot, runId), name);
			if (existsSync(source)) {
				copyFileSync(source, join(evidenceDir, name));
				copied = name;
			}
		}
	}
	const steps = readUiRunEvents(dataRoot, runId).filter((event) => event.event === "step").map((event) => ({
		id: event.id,
		kind: event.kind,
		status: event.status,
		error: event.error
	}));
	const dataset = {
		apiVersion: "dataforge/v1",
		kind: "ui-run-dataset",
		runId,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		status: record.status ?? "unknown",
		site: record.site,
		flow: record.flow,
		version: record.version,
		ui: record,
		steps,
		screenshot: copied
	};
	const datasetPath = join(dataRoot, "datasets", `${runId}.json`);
	mkdirSync(dirname(datasetPath), { recursive: true });
	writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), "utf8");
	const rows = steps.length === 0 ? "<p class=\"muted\">没有步骤事件</p>" : `<table><thead><tr><th>步骤</th><th>状态</th><th>错误</th></tr></thead><tbody>${steps.map((step) => `<tr><td>${escapeHtml(step.id ?? "")}（${escapeHtml(step.kind ?? "")}）</td><td>${escapeHtml(step.status ?? "")}</td><td>${escapeHtml(step.error ?? "")}</td></tr>`).join("")}</tbody></table>`;
	const image = copied === void 0 ? "" : `<h2>末态截图</h2><p><img src="${escapeHtml(copied)}" alt="UI run ${escapeHtml(runId)}" style="max-width:100%;border:1px solid #e5e7eb;border-radius:6px"></p>`;
	const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>UI 运行报告 ${escapeHtml(runId)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:920px;margin:32px auto;padding:0 20px;color:#111827;line-height:1.6}h1{font-size:24px}h2{font-size:17px;margin-top:24px}.muted{color:#6b7280}code{background:#f3f4f6;padding:2px 5px;border-radius:4px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e7eb;padding:7px 9px;text-align:left}th{background:#f9fafb}.status{padding:2px 9px;border-radius:999px;background:#e8f7ee;color:#166534}.failed{background:#fdecea;color:#b91c1c}</style></head><body>
<h1>UI 运行报告 <code>${escapeHtml(runId)}</code></h1>
<p>状态：<span class="status ${record.status === "failed" ? "failed" : ""}">${escapeHtml(record.status ?? "unknown")}</span> ｜ ${escapeHtml(String(record.site ?? ""))} / ${escapeHtml(String(record.flow ?? ""))}</p>
${typeof record.error === "string" ? `<p class="failed">错误：${escapeHtml(record.error)}</p>` : ""}
<h2>步骤</h2>${rows}
${image}
<p class="muted">由 dsh-dataforge 生成；本报告只含 UI 运行摘要/步骤/截图，不含登录凭证。</p>
</body></html>`;
	const reportPath = join(evidenceDir, "report.html");
	writeFileSync(reportPath, html, "utf8");
	return {
		ok: true,
		runId,
		datasetPath,
		reportPath,
		kind: "ui",
		status: record.status ?? "unknown",
		businessData: {},
		ui: record
	};
}

//#endregion
//#region src/orchestration/application.ts
/**
* 编排域的应用层：把 IF-1/2/3 的判定与错误折叠收在一处，工具壳（`src/tools.ts`）
* 只做参数声明与回执渲染。
*
* 为什么单独一层而不是塞进工具壳：`src/tools.ts` 的自述纪律是"判定全在 application 层"。
* 这三个工具的判定不是三道闸那种业务规则，而是「错误码 → 诚实回执」的折叠——
* 但它同样需要被单测直接打到（不经过 defineTool 的 schema 校验），所以放这里。
*
* @module dsh-dataforge/orchestration/application
*/
/**
* R-4 M3：跨运行换票单飞。key = 主链 origin + 登录链 site/flow。
*
* M2 的单飞只在一条 run 内；这里提到进程级：同一站点同一登录链被并发运行时，
* 只打一次登录接口，其余运行等待并共享结果（避免账号锁定与握手风暴）。
* 失败不缓存——settle 后清理，下一次触发重新登录。
*/
const reloginThrottle = createReloginThrottle();
/** 逐条问题时给模型看的行：`nodes[0]: reason`。 */
function issueLines(issues) {
	return issues.map((issue) => `${issue.target}：${issue.reason}`);
}
function toChainIssues$1(issues) {
	return issues.map((issue) => ({
		target: issue.target,
		code: issue.code,
		reason: issue.reason
	}));
}
function messageOf$8(error) {
	return error instanceof Error ? error.message : String(error);
}
function isLibraryError(error) {
	return error instanceof Error && typeof error.code === "string" && Array.isArray(error.hints);
}
/**
* 导入接口库。失败一律折成回执（**不抛**）：无采集数据是常态空态，agent 该据此
* 引导用户去采集，而不是拿到一个异常。
*/
async function importLibraryForTool(deps, exec, args) {
	let workspaceRoot;
	try {
		workspaceRoot = await deps.resolveWorkspaceRoot(exec) ?? process.cwd();
	} catch (error) {
		return {
			ok: false,
			code: "library-unavailable",
			message: `解析工作区根失败：${messageOf$8(error)}`,
			hints: []
		};
	}
	try {
		const result = importLibrary({
			workspaceRoot,
			captureDbPath: deps.captureDbPath,
			...args.captureId === void 0 ? {} : { captureId: args.captureId }
		});
		return {
			ok: true,
			imported: result.imported,
			merged: result.merged,
			unchanged: result.unchanged,
			skipped: result.skipped,
			cardIds: result.cardIds,
			skippedReasons: result.skippedDetails.map((item) => `${item.mergeKey}：${item.reason}`),
			captures: result.captureIds,
			libraryRoot: result.libraryRoot
		};
	} catch (error) {
		if (isLibraryError(error)) return {
			ok: false,
			code: error.code,
			message: error.message,
			hints: error.hints
		};
		return {
			ok: false,
			code: "library-unavailable",
			message: `导入接口库失败：${messageOf$8(error)}`,
			hints: []
		};
	}
}
/** 唯一的链写入口：先 schema、再语义校验，全过才落盘为新版本（不存在部分写入）。 */
async function upsertChainForTool(deps, exec, args) {
	const workspaceRoot = await deps.resolveWorkspaceRoot(exec) ?? process.cwd();
	if (args.site.trim() === "" || args.flow.trim() === "") return {
		ok: false,
		code: "invalid-chain",
		message: "site 与 flow 不能为空：链按「站点 / 流程」归档"
	};
	try {
		const saved = saveChain(workspaceRoot, args.chainYaml, { source: "agent" });
		if (!saved.ok) return {
			ok: false,
			code: saved.issues.some((issue) => issue.code === "card-not-imported") ? "card-not-imported" : "invalid-chain",
			message: saved.issues.some((issue) => issue.code === "card-not-imported") ? "链引用的接口卡不在项目接口库：先跑 dataforge_library_import" : `链未通过校验（${saved.issues.length} 条）：修好再提交，没有落盘`,
			issues: toChainIssues$1(saved.issues)
		};
		return {
			ok: true,
			version: saved.version,
			path: saved.path,
			...saved.warnings.length === 0 ? {} : { warnings: issueLines(saved.warnings) }
		};
	} catch (error) {
		return {
			ok: false,
			code: "invalid-chain",
			message: `落盘链失败：${messageOf$8(error)}`
		};
	}
}
/**
* 读链。`export: true` 走原文读取（不校验，坏文件也照原样导出，便于人工抢救）；
* 缺省走校验读取——文件被手改坏就如实报 invalid-chain 并提示可回读旧版本。
*/
async function getChainForTool(deps, exec, args) {
	const workspaceRoot = await deps.resolveWorkspaceRoot(exec) ?? process.cwd();
	if (args.export === true) {
		const found = readChainText(workspaceRoot, args.site, args.flow, args.version);
		if (found === void 0) return {
			ok: false,
			code: "chain-not-found",
			message: `没有找到 ${args.site} / ${args.flow} 的链${args.version === void 0 ? "" : ` v${args.version}`}`,
			versions: listChainVersions(workspaceRoot, args.site, args.flow)
		};
		return {
			ok: true,
			chainYaml: found.text,
			version: found.version,
			path: found.path
		};
	}
	const loaded = loadChain(workspaceRoot, args.site, args.flow, { ...args.version === void 0 ? {} : { version: args.version } });
	if (!loaded.ok) return {
		ok: false,
		code: loaded.code,
		message: loaded.message,
		versions: loaded.availableVersions,
		..."issues" in loaded && loaded.issues !== void 0 ? { issues: toChainIssues$1(loaded.issues) } : {},
		..."path" in loaded && loaded.path !== void 0 ? { path: loaded.path } : {}
	};
	return {
		ok: true,
		chainYaml: loaded.text,
		version: loaded.version,
		path: loaded.path,
		versions: listChainVersions(workspaceRoot, args.site, args.flow)
	};
}
/** 链执行节点的卡：逐 cardId 解析（默认解析器直读接口库，单次调用内缓存）。 */
/** 逐 cardId 解析卡（probe/整链共用；单次调用内缓存）。 */
function cardsForChain(workspaceRoot, doc) {
	const resolve = defaultCardResolver(workspaceRoot);
	const cards = /* @__PURE__ */ new Map();
	for (const node of doc.nodes) {
		if (typeof node.card !== "string" || node.card.length === 0) continue;
		if (cards.has(node.card)) continue;
		const card = resolve(node.card);
		if (card !== void 0) cards.set(node.card, card);
	}
	return cards;
}
/**
* 槽位入参校验（`inputs-invalid`）：键必须是链文件声明过的槽位，值要符合声明类型。
*
* 与 `missing-params` 分工明确——这里管「你给了不该给的值」，`buildPlan` 管
* 「该给的值没给」。两者都在第一个请求之前，不会发半截请求出去。
*/
function validateChainInputs(doc, inputs) {
	if (inputs === void 0) return { ok: true };
	const declared = new Map(doc.inputs.map((input) => [input.name, input]));
	for (const [name, value] of Object.entries(inputs)) {
		const slot = declared.get(name);
		if (slot === void 0) {
			const known = doc.inputs.map((input) => input.name);
			return {
				ok: false,
				message: `未知槽位「${name}」：本链只声明了 ${known.length === 0 ? "（没有槽位）" : known.join("、")}；槽位必须先写进链文件的 inputs 段`
			};
		}
		const problem = checkValueType(name, slot.type, value);
		if (problem !== void 0) return {
			ok: false,
			message: `槽位值不符合声明类型：${problem}`
		};
	}
	return { ok: true };
}
/**
* baseUrl 候选解析：工具入参 > 卡 `sources[].pages[]` 的 origin。
*
* 卡的 `identity.urlTemplate` 是采集期归一化后的相对路径，不含 origin，所以这一步
* 不能省；多来源跨 origin 视为冲突（宁可拒跑也不打到错站点）。
* 一个候选都没有时不在这里报错——交给 `buildPlan` 统一给 `base-url-unresolved`。
*/
function resolveChainBaseUrl(doc, cards, explicit) {
	const raw = typeof explicit === "string" ? explicit.trim() : "";
	if (raw.length > 0) return {
		ok: true,
		baseUrl: raw
	};
	const origins = /* @__PURE__ */ new Set();
	for (const node of doc.nodes) {
		const card = typeof node.card === "string" ? cards.get(node.card) : void 0;
		for (const source of card?.sources ?? []) for (const page of source.pages ?? []) {
			const origin = originOf(page);
			if (origin !== void 0) origins.add(origin);
		}
	}
	if (origins.size === 0) return { ok: true };
	if (origins.size > 1) return {
		ok: false,
		message: `卡来源跨多个 origin（${[...origins].join("、")}）：显式传 baseUrl 指定目标站点，不让引擎猜`
	};
	return {
		ok: true,
		baseUrl: [...origins][0]
	};
}
function originOf(page) {
	try {
		const url = new URL(page);
		return url.protocol === "http:" || url.protocol === "https:" ? url.origin : void 0;
	} catch {
		return;
	}
}
function hostOf$3(baseUrl) {
	try {
		return new URL(baseUrl).host;
	} catch {
		return baseUrl;
	}
}
function planValueOf(plan, notices, cleanup, verify) {
	return {
		order: [...plan.order],
		totalNodes: plan.totalNodes,
		baseUrl: plan.baseUrl,
		host: hostOf$3(plan.baseUrl),
		writeNodes: [...plan.writeNodes],
		nodes: plan.nodes.map((node) => ({
			nodeId: node.nodeId,
			method: node.method,
			url: node.urlTemplate,
			dependsOn: [...node.dependsOn],
			writes: plan.writeNodes.includes(node.nodeId)
		})),
		notices: [...notices],
		...cleanup === void 0 ? {} : { cleanup },
		...verify === void 0 ? {} : { verify }
	};
}
/** 确认卡：拓扑序 + 每节点方法/URL 骨架 + 写方法清单 + 目标 host。 */
function chainConfirmationCard(doc, plan, notices, cleanup, verify) {
	const lines = plan.order.map((nodeId, index) => {
		const node = plan.nodes.find((candidate) => candidate.nodeId === nodeId);
		const write = plan.writeNodes.includes(nodeId) ? " ✍️写" : "";
		return `${index + 1}. ${nodeId}${write}：${node.method} ${node.urlTemplate}`;
	});
	const writes = plan.writeNodes.length === 0 ? "写类节点：无（整链只读）" : `写类节点：${plan.writeNodes.join("、")}（已发出的写请求无法撤销）`;
	const note = notices.length === 0 ? "" : `\n提醒：${notices.join("；")}`;
	const cleanupLine = cleanup === void 0 ? "" : `\n清理：${cleanup.site} / ${cleanup.flow}${cleanup.version === void 0 ? "" : ` v${cleanup.version}`}（${cleanup.when}，${cleanup.nodeCount} 节点，写 ${cleanup.writeCount} 个）`;
	const verifyLine = verify === void 0 ? "" : `\n验收：${verify.site} / ${verify.flow}${verify.version === void 0 ? "" : ` v${verify.version}`}（${verify.when}）`;
	return [
		`🧭 执行计划（${doc.meta.site} / ${doc.meta.flow} v${doc.meta.version}）→ ${hostOf$3(plan.baseUrl)}`,
		...lines,
		writes,
		`确认后带 confirm=true 重调即真跑；只想留档用 dry_run=true（永不发请求）。${note}${cleanupLine}${verifyLine}`
	].join("\n");
}
/** cleanup 计划摘要：只读链/卡，不预检执行，供确认卡展示。 */
function cleanupPlanOf(workspaceRoot, doc) {
	if (doc.cleanup === void 0) return { ok: true };
	const loaded = loadChain(workspaceRoot, doc.cleanup.chain.site, doc.cleanup.chain.flow, { ...doc.cleanup.chain.version === void 0 ? {} : { version: doc.cleanup.chain.version } });
	if (!loaded.ok) return {
		ok: false,
		message: `cleanup 链不可用：${loaded.message}`
	};
	const cleanupCards = cardsForChain(workspaceRoot, loaded.doc);
	let writeCount = 0;
	for (const node of loaded.doc.nodes) {
		const card = node.card === void 0 ? void 0 : cleanupCards.get(node.card);
		if (card !== void 0 && card.identity.method !== "GET" && card.identity.method !== "HEAD") writeCount += 1;
	}
	return {
		ok: true,
		value: {
			site: loaded.doc.meta.site,
			flow: loaded.doc.meta.flow,
			version: loaded.doc.meta.version,
			when: doc.cleanup.when,
			nodeCount: loaded.doc.nodes.length,
			writeCount
		}
	};
}
function valueAtPath(root, path) {
	const clean = path.replace(/^\$\.?/, "");
	const tokens = [];
	for (const part of clean.split(".")) for (const match of part.matchAll(/([^[\]]+)|\[(\d+)\]/g)) if (match[1] !== void 0 && match[1] !== "") tokens.push(match[1]);
	else if (match[2] !== void 0) tokens.push(Number(match[2]));
	let current = root;
	for (const token of tokens) if (typeof token === "number") {
		if (!Array.isArray(current) || token < 0 || token >= current.length) return void 0;
		current = current[token];
	} else {
		if (current === null || typeof current !== "object" || Array.isArray(current)) return void 0;
		current = current[token];
	}
	return current;
}
function shouldRunCleanup(doc, summary) {
	if (doc.cleanup === void 0) return false;
	return doc.cleanup.when === "always" || summary.status === "failed";
}
function resolveBoundInputs(templates, mainInputs, summary) {
	const inputs = {};
	for (const [key, template] of Object.entries(templates ?? {})) {
		if (template.startsWith("$inputs.")) {
			const slot = template.slice(8);
			if (!(slot in mainInputs)) return {
				ok: false,
				missing: template
			};
			inputs[key] = mainInputs[slot];
			continue;
		}
		if (template.startsWith("$result.outputs.")) {
			const rest = template.slice(16);
			const dot = rest.indexOf(".");
			const nodeId = dot < 0 ? rest : rest.slice(0, dot);
			const fieldPath = dot < 0 ? "" : rest.slice(dot + 1);
			const outputs = summary.businessData?.["outputs"];
			const nodeOutputs = outputs !== null && typeof outputs === "object" && !Array.isArray(outputs) ? outputs[nodeId] : void 0;
			const direct = nodeOutputs !== null && typeof nodeOutputs === "object" && !Array.isArray(nodeOutputs) ? nodeOutputs[fieldPath] : void 0;
			const value = direct !== void 0 ? direct : valueAtPath(nodeOutputs, fieldPath);
			if (value === void 0) return {
				ok: false,
				missing: template
			};
			inputs[key] = value;
			continue;
		}
		if (template.startsWith("$result.")) {
			const value = valueAtPath(summary.businessData, template.slice(8));
			if (value === void 0) return {
				ok: false,
				missing: template
			};
			inputs[key] = value;
			continue;
		}
		inputs[key] = template;
	}
	return {
		ok: true,
		inputs
	};
}
function cleanupInputsOf(doc, mainInputs, summary) {
	return resolveBoundInputs(doc.cleanup?.inputs, mainInputs, summary);
}
function verifyInputsOf(doc, mainInputs, summary) {
	return resolveBoundInputs(doc.verify?.inputs, mainInputs, summary);
}
function verifyPlanOf(doc) {
	if (doc.verify === void 0) return void 0;
	return {
		site: doc.verify.ui.site,
		flow: doc.verify.ui.flow,
		...doc.verify.ui.version === void 0 ? {} : { version: doc.verify.ui.version },
		when: doc.verify.when
	};
}
function shouldRunVerify(doc, summary) {
	if (doc.verify === void 0) return false;
	if (doc.verify.when === "always") return true;
	if (doc.verify.when === "onSuccess") return summary.status === "completed";
	return summary.status === "failed";
}
/** 主链结束后执行 UI 验收；失败只返回错误信息，不覆盖主链结果。 */
async function runVerifyForTool(deps, doc, summary, mainInputs) {
	const base = verifyPlanOf(doc);
	if (base === void 0 || !shouldRunVerify(doc, summary)) return void 0;
	const resolved = verifyInputsOf(doc, mainInputs, summary);
	if (!resolved.ok) return {
		...base,
		skipped: `缺 UI 验收入参 ${resolved.missing}（主链结果/输入里找不到）`
	};
	if (deps.verifyUi === void 0) return {
		...base,
		skipped: "未装配 UI 验收执行器（uiTestEnabled / verifyUi）"
	};
	try {
		const result = await deps.verifyUi({
			site: base.site,
			flow: base.flow,
			...base.version === void 0 ? {} : { version: base.version },
			inputs: Object.fromEntries(Object.entries(resolved.inputs).map(([key, value]) => [key, String(value)]))
		});
		const merged = {
			...base,
			...result
		};
		if (merged.runId !== void 0) {
			const exported = exportRunArtifacts(deps.dataRoot, merged.runId);
			if (exported.ok) return {
				...merged,
				datasetPath: exported.datasetPath,
				reportPath: exported.reportPath
			};
		}
		return merged;
	} catch (error) {
		return {
			...base,
			message: `UI 验收执行失败：${messageOf$8(error)}`
		};
	}
}
/** 主链结束后执行 cleanup；失败只返回错误信息，不覆盖主链结果。 */
async function runCleanupForTool(deps, workspaceRoot, doc, summary, mainInputs) {
	if (doc.cleanup === void 0 || !shouldRunCleanup(doc, summary)) return void 0;
	const planInfo = cleanupPlanOf(workspaceRoot, doc);
	if (!planInfo.ok || planInfo.value === void 0) return {
		site: doc.cleanup.chain.site,
		flow: doc.cleanup.chain.flow,
		when: doc.cleanup.when,
		nodeCount: 0,
		writeCount: 0,
		message: planInfo.ok ? "cleanup 链不可用" : planInfo.message
	};
	const base = planInfo.value;
	const resolved = cleanupInputsOf(doc, mainInputs, summary);
	if (!resolved.ok) return {
		...base,
		skipped: `缺 cleanup 入参 ${resolved.missing}（主链结果/输入里找不到）`
	};
	const loaded = loadChain(workspaceRoot, base.site, base.flow, { ...base.version === void 0 ? {} : { version: base.version } });
	if (!loaded.ok) return {
		...base,
		message: `cleanup 链不可用：${loaded.message}`
	};
	const cards = cardsForChain(workspaceRoot, loaded.doc);
	const inputCheck = validateChainInputs(loaded.doc, resolved.inputs);
	if (!inputCheck.ok) return {
		...base,
		message: inputCheck.message
	};
	const baseUrl = resolveChainBaseUrl(loaded.doc, cards, void 0);
	const planned = buildPlan(loaded.doc, cards, resolved.inputs, baseUrl.ok ? baseUrl.baseUrl : void 0);
	if (!planned.ok) return {
		...base,
		message: planned.code === "base-url-unresolved" && !baseUrl.ok ? baseUrl.message : planned.message
	};
	try {
		const runInput = {
			doc: loaded.doc,
			cards,
			plan: planned.plan,
			inputs: resolved.inputs,
			baseUrl: planned.plan.baseUrl,
			chainPath: chainPathForRecord(workspaceRoot, loaded.path),
			...deps.credentials === void 0 ? {} : { credentials: deps.credentials }
		};
		const prepared = prepareChainRun({
			dataRoot: deps.dataRoot,
			config: deps.chain
		}, runInput);
		const run = await executeChainRun({
			dataRoot: deps.dataRoot,
			config: deps.chain
		}, prepared, runInput);
		return {
			...base,
			runId: prepared.runId,
			...run.ok ? { status: run.summary.status } : { message: run.message }
		};
	} catch (error) {
		return {
			...base,
			message: `cleanup 执行失败：${messageOf$8(error)}`
		};
	}
}
/** 链文件路径：工作区内用相对路径（便于回看与迁移），越界则保留绝对路径。 */
function chainPathForRecord(workspaceRoot, absolutePath) {
	const base = workspaceRoot.replace(/\/+$/, "");
	return absolutePath.startsWith(`${base}/`) ? absolutePath.slice(base.length + 1) : absolutePath;
}
function compactNodes(nodes) {
	return nodes.map((node) => ({
		nodeId: node.nodeId,
		status: node.status,
		method: node.method,
		url: node.url,
		...node.httpStatus === void 0 ? {} : { httpStatus: node.httpStatus },
		attempts: node.attempts,
		elapsedMs: node.elapsedMs,
		...node.errorCode === void 0 ? {} : { errorCode: node.errorCode },
		...node.error === void 0 ? {} : { error: node.error },
		...node.relogin === void 0 ? {} : { relogin: node.relogin }
	}));
}
function jobStatusOf(result, cancelled) {
	if (!result.ok) return "failed";
	if (cancelled || result.cancelled) return "killed";
	return result.summary.status === "completed" ? "completed" : "failed";
}
function jobDetailOf(result) {
	if (!result.ok) return `${result.code}：${result.message}`;
	return result.summary.message ?? `${result.summary.stepsDone}/${result.summary.totalSteps} 步`;
}
/**
* R-4 M2：构造「执行登录链」的函数，交给执行器在 401 时调用。
*
* 登录链走与主链完全相同的加载/校验/执行路径；差异只有三点：
*   1. 敏感模式（参数/正文/出参都不落值）；
*   2. 不注入旧凭证、不再递归换票（避免 401 套 401）；
*   3. 只把响应里的原始 `set-cookie` 收集成内存 jar 交回主链。
*/
function createReloginRunner(deps, workspaceRoot, expectedBaseUrl) {
	return async (spec, signal) => {
		const throttleKey = `${originOf(expectedBaseUrl) ?? "unknown"}|${spec.site}/${spec.flow}`;
		return reloginThrottle.run(throttleKey, () => reloginOnce(deps, workspaceRoot, expectedBaseUrl, spec, signal));
	};
}
/** 真正执行一条登录链（单飞的实际负载；同一时刻同 key 只有一个在飞）。 */
async function reloginOnce(deps, workspaceRoot, expectedBaseUrl, spec, signal) {
	if (spec.site.trim() === "" || spec.flow.trim() === "") return {
		ok: false,
		code: "relogin-unavailable",
		message: "登录链的 site / flow 不能为空"
	};
	const loaded = loadChain(workspaceRoot, spec.site, spec.flow, { ...spec.version === void 0 ? {} : { version: spec.version } });
	if (!loaded.ok) return {
		ok: false,
		code: "relogin-unavailable",
		message: `登录链不可用：${loaded.message}`
	};
	const doc = loaded.doc;
	if (doc.kind !== "interface-chain") return {
		ok: false,
		code: "relogin-unavailable",
		message: `登录链必须是 interface-chain（当前 ${doc.kind}）`
	};
	const cards = cardsForChain(workspaceRoot, doc);
	const inputCheck = validateChainInputs(doc, spec.inputs);
	if (!inputCheck.ok) return {
		ok: false,
		code: "relogin-unavailable",
		message: `登录链入参不合法：${inputCheck.message}`
	};
	const base = resolveChainBaseUrl(doc, cards, spec.baseUrl);
	if (!base.ok) return {
		ok: false,
		code: "relogin-unavailable",
		message: `登录链 baseUrl 无法确定：${base.message}`
	};
	const planned = buildPlan(doc, cards, spec.inputs ?? {}, base.baseUrl);
	if (!planned.ok) return {
		ok: false,
		code: "relogin-unavailable",
		message: `登录链不可执行：${planned.message}`
	};
	const expectedOrigin = originOf(expectedBaseUrl);
	const loginOrigin = originOf(planned.plan.baseUrl);
	if (expectedOrigin !== void 0 && loginOrigin !== void 0 && expectedOrigin !== loginOrigin) return {
		ok: false,
		code: "relogin-unavailable",
		message: `登录链与主链不同源（登录 ${loginOrigin} / 主链 ${expectedOrigin}）：拒绝跨站复用凭证`
	};
	const cookies = [];
	const chainDeps = {
		dataRoot: deps.dataRoot,
		config: deps.chain
	};
	const runInput = {
		doc,
		cards,
		plan: planned.plan,
		inputs: spec.inputs ?? {},
		baseUrl: planned.plan.baseUrl,
		chainPath: chainPathForRecord(workspaceRoot, loaded.path),
		sensitive: true,
		redactParams: true,
		onSetCookies: (values) => {
			for (const value of values) cookies.push(value);
		}
	};
	const prepared = prepareChainRun(chainDeps, runInput);
	const result = await executeChainRun(chainDeps, prepared, {
		...runInput,
		signal
	});
	if (!result.ok) return {
		ok: false,
		code: "relogin-failed",
		message: result.message,
		runId: prepared.runId
	};
	if (result.summary.status !== "completed") return {
		ok: false,
		code: "relogin-failed",
		message: result.summary.message ?? `登录链未完成（${result.summary.status}）`,
		runId: prepared.runId
	};
	const cookieHeader = cookieHeaderFromSetCookies(cookies);
	if (cookieHeader === void 0) return {
		ok: false,
		code: "relogin-failed",
		message: "登录链执行完成但没有下发可用的 set-cookie（登录接口可能不是 cookie 型）",
		runId: prepared.runId
	};
	const persisted = deps.credentialStorePath !== void 0 && expectedOrigin !== void 0 ? persistCookies(deps.credentialStorePath, expectedOrigin, cookies, Date.now()) : 0;
	return {
		ok: true,
		cookieHeader,
		cookieNames: cookieNamesOf(cookieHeader),
		runId: prepared.runId,
		...persisted > 0 ? { persisted } : {}
	};
}
/**
* 唯一的执行入口（IF-1）。
*
* 顺序是设计的一部分：开关 → 载链 → 卡 → 槽位值 → baseUrl 候选 → 执行计划 →
* 确认闸 → 能力探测 → 真跑。**前七步一个请求都不发**；缺参、环、坏 URL 全在
* 第一个请求之前被拒，回执逐条指到「节点 · 字段 · 类型」。
*/
async function chainRunForTool(deps, exec, args) {
	if (deps.chain.enabled !== true) return {
		ok: false,
		accepted: false,
		gate: "blocked",
		code: "execution-disabled",
		message: "执行开关已关闭（config.chainRunEnabled=false）：链读写与历史回看照常，执行一律拒绝"
	};
	let workspaceRoot;
	try {
		workspaceRoot = await deps.resolveWorkspaceRoot(exec) ?? process.cwd();
	} catch (error) {
		return {
			ok: false,
			accepted: false,
			gate: "blocked",
			code: "invalid-chain",
			message: `解析工作区根失败：${messageOf$8(error)}`
		};
	}
	const loaded = loadChain(workspaceRoot, args.site, args.flow, { ...args.version === void 0 ? {} : { version: args.version } });
	if (!loaded.ok) {
		if (loaded.code === "chain-not-found") return {
			ok: false,
			accepted: false,
			code: "chain-not-found",
			message: loaded.message,
			versions: loaded.availableVersions
		};
		return {
			ok: false,
			accepted: false,
			code: "invalid-chain",
			message: loaded.message,
			issues: toChainIssues$1(loaded.issues),
			versions: loaded.availableVersions
		};
	}
	const doc = loaded.doc;
	if (args.relogin !== void 0) {
		if (args.relogin.site.trim() === "" || args.relogin.flow.trim() === "") return {
			ok: false,
			accepted: false,
			gate: "blocked",
			code: "relogin-unavailable",
			message: "relogin.site / relogin.flow 不能为空"
		};
		if (args.relogin.site === doc.meta.site && args.relogin.flow === doc.meta.flow) return {
			ok: false,
			accepted: false,
			gate: "blocked",
			code: "relogin-cycle",
			message: `登录链不能是当前链自身（${doc.meta.site} / ${doc.meta.flow}）：会无限递归；请指定一条真正的登录链路`
		};
	}
	const cards = cardsForChain(workspaceRoot, doc);
	const inputCheck = validateChainInputs(doc, args.inputs);
	if (!inputCheck.ok) return {
		ok: false,
		accepted: false,
		code: "inputs-invalid",
		message: inputCheck.message
	};
	const base = resolveChainBaseUrl(doc, cards, args.baseUrl);
	const planned = buildPlan(doc, cards, args.inputs ?? {}, base.ok ? base.baseUrl : void 0);
	if (!planned.ok) return {
		ok: false,
		accepted: false,
		code: planned.code,
		message: planned.code === "base-url-unresolved" && !base.ok ? base.message : planned.message,
		gaps: planned.gaps,
		cycle: planned.cycle
	};
	const plan = planned.plan;
	const cleanupPlan = cleanupPlanOf(workspaceRoot, doc);
	if (!cleanupPlan.ok) return {
		ok: false,
		accepted: false,
		gate: "blocked",
		code: "invalid-chain",
		message: cleanupPlan.message
	};
	const cleanupValue = cleanupPlan.value;
	const verifyValue = verifyPlanOf(doc);
	const planValue = planValueOf(plan, planned.notices, cleanupValue, verifyValue);
	if (args.dryRun !== true && args.confirm !== true) return {
		ok: true,
		accepted: false,
		gate: "confirm-required",
		code: "confirm-required",
		message: `计划已编译（${plan.totalNodes} 个节点，写类 ${plan.writeNodes.length} 个，目标 ${planValue.host}）：确认后带 confirm=true 重调`,
		plan: planValue,
		card: chainConfirmationCard(doc, plan, planned.notices, cleanupValue, verifyValue)
	};
	if (args.dryRun !== true) {
		const reason = chainExecutionUnavailableReason();
		if (reason !== void 0) return {
			ok: false,
			accepted: false,
			gate: "blocked",
			code: "execution-unavailable",
			message: reason,
			plan: planValue
		};
	}
	const chainDeps = {
		dataRoot: deps.dataRoot,
		config: deps.chain
	};
	const runInput = {
		doc,
		cards,
		plan,
		inputs: args.inputs ?? {},
		baseUrl: plan.baseUrl,
		...args.concurrency === void 0 ? {} : { concurrency: args.concurrency },
		chainPath: chainPathForRecord(workspaceRoot, loaded.path),
		...args.dryRun === true ? { dryRun: true } : {},
		...deps.credentials === void 0 ? {} : { credentials: deps.credentials },
		...args.relogin === void 0 ? {} : { relogin: {
			spec: args.relogin,
			run: createReloginRunner(deps, workspaceRoot, plan.baseUrl)
		} }
	};
	if (args.dryRun === true) {
		const prepared = prepareChainRun(chainDeps, runInput);
		const run = await executeChainRun(chainDeps, prepared, runInput);
		return {
			ok: true,
			accepted: true,
			gate: "started",
			kind: "dry-run",
			runId: prepared.runId,
			runDir: prepared.runDir,
			plan: planValue,
			...run.ok ? { summary: run.summary } : { message: run.message }
		};
	}
	const prepared = prepareChainRun(chainDeps, runInput);
	const jobs = deps.resolveJobs();
	if (jobs !== void 0 && typeof jobs.start === "function") {
		const controller = new AbortController();
		const spec = {
			kind: "dataforge-chain",
			label: `${doc.meta.flow} v${doc.meta.version}`,
			owner: ownerOf(exec),
			outputLimitBytes: 65536,
			run(job) {
				const task = executeChainRun(chainDeps, prepared, {
					...runInput,
					signal: controller.signal,
					onProgress: (line) => job.updateProgress(line)
				});
				job.append(`链 ${doc.meta.site}/${doc.meta.flow} v${doc.meta.version} → ${planValue.host}（${plan.totalNodes} 节点）`);
				return {
					cancel: (reason) => controller.abort(reason),
					done: task.then(async (result) => {
						const verify = result.ok ? await runVerifyForTool(deps, doc, result.summary, args.inputs ?? {}) : void 0;
						if (verify !== void 0) job.append(`verify ${verify.site}/${verify.flow}：${verify.skipped ?? verify.status ?? (verify.success === true ? "success" : verify.message ?? "unknown")}`);
						const cleanup = result.ok ? await runCleanupForTool(deps, workspaceRoot, doc, result.summary, args.inputs ?? {}) : void 0;
						if (cleanup?.skipped !== void 0) job.append(`cleanup 跳过：${cleanup.skipped}`);
						else if (cleanup !== void 0) job.append(`cleanup ${cleanup.site}/${cleanup.flow}：${cleanup.status ?? cleanup.message ?? "unknown"}`);
						return {
							status: jobStatusOf(result, controller.signal.aborted),
							detail: jobDetailOf(result),
							...result.ok ? { result: JSON.stringify(cleanup === void 0 && verify === void 0 ? result.summary : {
								...result.summary,
								...verify === void 0 ? {} : { verify },
								...cleanup === void 0 ? {} : { cleanup }
							}) } : {}
						};
					})
				};
			}
		};
		const jobId = extractJobId(jobs.start(spec));
		return {
			ok: true,
			accepted: true,
			gate: "started",
			kind: "background",
			...jobId === void 0 ? {} : { jobId },
			runId: prepared.runId,
			runDir: prepared.runDir,
			plan: planValue
		};
	}
	const controller = new AbortController();
	const watchdog = setTimeout(() => controller.abort("foreground-timeout"), Math.max(1, deps.chain.foregroundTimeoutSeconds) * 1e3);
	watchdog.unref?.();
	try {
		const run = await executeChainRun(chainDeps, prepared, {
			...runInput,
			signal: controller.signal
		});
		const verify = run.ok ? await runVerifyForTool(deps, doc, run.summary, args.inputs ?? {}) : void 0;
		const cleanup = run.ok ? await runCleanupForTool(deps, workspaceRoot, doc, run.summary, args.inputs ?? {}) : void 0;
		return {
			ok: true,
			accepted: true,
			gate: "started",
			kind: "foreground",
			runId: prepared.runId,
			runDir: prepared.runDir,
			plan: planValue,
			degradedNotice: "宿主未装配 dsh-jobs：本次前台执行（长链会占用对话，且不可 job_kill；建议部署 @deepseek-ai/dsh-jobs + @deepseek-ai/dsh-tool-jobs）",
			...verify === void 0 ? {} : { verify },
			...cleanup === void 0 ? {} : { cleanup },
			...run.ok ? {
				summary: run.summary,
				nodes: compactNodes(run.nodes),
				...run.failedNode === void 0 ? {} : { failedNode: run.failedNode }
			} : { message: run.message }
		};
	} finally {
		clearTimeout(watchdog);
	}
}
/**
* 链维度运行列表（IF-2）：扫描 `runs/` 读 `run.json` 的 `chain` 段过滤。
*
* 没有链维度索引是有意的：单项目几十到几百条运行，全量扫描可接受；量级上来再加索引。
* 运行留痕与链文件解耦——链被删/改名，历史运行仍能列出（`chain` 段是写入时快照）。
*/
function listChainRunsForTool(deps, args) {
	const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 20)));
	const siteSlug = slugOf(args.site);
	const flowSlug = slugOf(args.flow);
	const rows = [];
	let damaged = 0;
	for (const runId of listRunIds(deps.dataRoot, 200)) {
		const record = readRunRecord(deps.dataRoot, runId);
		if (record === void 0) {
			damaged += 1;
			continue;
		}
		const chain = plainRecordOf(record["chain"]);
		if (chain === void 0) continue;
		const site = typeof chain["site"] === "string" ? chain["site"] : "";
		const flow = typeof chain["flow"] === "string" ? chain["flow"] : "";
		const sameSite = site === args.site || slugOf(site) === siteSlug;
		const sameFlow = flow === args.flow || slugOf(flow) === flowSlug;
		if (!sameSite || !sameFlow) continue;
		const version = typeof chain["version"] === "number" ? chain["version"] : void 0;
		if (args.version !== void 0 && version !== args.version) continue;
		const events = loadRunEvents(deps.dataRoot, runId);
		if (events === void 0 || events.length === 0) continue;
		const summary = foldSummary(runId, events);
		rows.push({
			runId,
			status: summary.status,
			startedAt: summary.startedAt,
			updatedAt: summary.updatedAt,
			dryRun: summary.dryRun,
			stepsDone: summary.stepsDone,
			totalSteps: summary.totalSteps,
			...version === void 0 ? {} : { version },
			...summary.chain?.failedNode === void 0 ? {} : { failedNode: summary.chain.failedNode },
			flow: summary.flow,
			flowName: summary.flowName,
			...summary.message === void 0 ? {} : { message: summary.message }
		});
	}
	rows.sort((left, right) => right.startedAt - left.startedAt || (left.runId < right.runId ? 1 : left.runId > right.runId ? -1 : 0));
	const damagedNote = damaged > 0 ? `另有 ${damaged} 条运行记录读不出来已跳过` : void 0;
	const runs = rows.slice(0, limit);
	if (runs.length === 0) return {
		ok: true,
		runs,
		notice: ["该链暂无运行留痕", damagedNote].filter(Boolean).join("；")
	};
	return {
		ok: true,
		runs,
		...damagedNote === void 0 ? {} : { notice: damagedNote }
	};
}
/** 非 plain object（数组/缺失）一律 undefined。 */
function plainRecordOf(value) {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
}

//#endregion
//#region src/orchestration/bind.ts
function messageOf$7(error) {
	return error instanceof Error ? error.message : String(error);
}
function toChainIssues(issues) {
	return issues.map((issue) => ({
		target: issue.target,
		code: issue.code,
		reason: issue.reason
	}));
}
/**
* 入参边的形状兜底。
*
* 为什么不把这些也交给 saveChain：`from`/`to` 不是字符串时合并逻辑自身会崩，`pick` 形状坏
* 时 R-1 的 normalizePick 会**静默丢掉** pick（schema 里是 Schema.any），agent 会以为
* 「按字段选元素」生效了。这里只挡形状（不是语义：字段是否存在、卡是否存在仍由 saveChain 判），
* 并且一次把坏边全报完，沿用 validate.ts 的「报全不 fail-fast」纪律。
*/
function specShapeIssues(specs) {
	const issues = [];
	specs.forEach((spec, index) => {
		const target = `edges[${index}]`;
		const from = typeof spec?.from === "string" ? spec.from : "";
		const to = typeof spec?.to === "string" ? spec.to : "";
		if (from.trim() === "" || to.trim() === "") {
			issues.push({
				target,
				code: "invalid-chain",
				reason: "from/to 必须是非空字符串：from 是 <节点 id>.<出参路径> 或 $inputs.<槽位名>，to 是 <节点 id>.<入参路径>"
			});
			return;
		}
		const pickProblem = pickShapeProblemOf(spec.pick);
		if (pickProblem !== void 0) issues.push({
			target,
			code: "invalid-chain",
			reason: pickProblem
		});
	});
	return issues;
}
/** pick 的形状检查（语义解释见 specShapeIssues 的注释）。 */
function pickShapeProblemOf(pick) {
	if (pick === void 0) return void 0;
	if (typeof pick !== "object" || pick === null || Array.isArray(pick)) return "pick 必须是对象：{ match: { field, equals }, field? }";
	const record = pick;
	const match = record["match"];
	if (typeof match !== "object" || match === null || Array.isArray(match)) return "pick.match 必须是对象：{ field, equals }";
	const matchRecord = match;
	const field = matchRecord["field"];
	if (typeof field !== "string" || field.trim() === "") return "pick.match.field 必须是非空字符串（从数组元素里按哪个字段匹配）";
	const equals = matchRecord["equals"];
	if (typeof equals !== "string" && typeof equals !== "number" && typeof equals !== "boolean") return "pick.match.equals 必须是 string / number / boolean";
	const take = record["field"];
	if (take !== void 0 && (typeof take !== "string" || take.trim() === "")) return "pick.field 若给出必须是非空字符串（命中后取哪个字段；缺省取整个元素）";
}
/** 入参边 → 链边（不写 `suggested`：这是明确绑定，不是编译期的建议）。 */
function edgeOf(spec) {
	return {
		from: spec.from,
		to: spec.to,
		...spec.transform === void 0 ? {} : { transform: spec.transform },
		...spec.pick === void 0 ? {} : { pick: spec.pick }
	};
}
/** 同一次调用里 `to` 重复时以后者为准；保留各个 to 最后一次出现的位置。 */
function lastWinsByTo(specs) {
	const lastIndex = /* @__PURE__ */ new Map();
	specs.forEach((spec, index) => lastIndex.set(spec.to, index));
	return specs.filter((spec, index) => lastIndex.get(spec.to) === index);
}
function samePick(left, right) {
	if (left === void 0 || right === void 0) return left === right;
	return left.match.field === right.match.field && left.match.equals === right.match.equals && left.field === right.field;
}
/** 两条边是否「完全相同的绑定」（比较 from/to/transform/pick；`suggested` 不参与）。 */
function sameEdge(left, right) {
	return left.from === right.from && left.to === right.to && left.transform === right.transform && samePick(left.pick, right.pick);
}
/**
* 把入参边合入现有边集。
*
* 同 `to` 的既有边被整体替换（即使历史上有重复 to 也收敛成一条），新边占第一条旧边的位置，
* 其余边的相对顺序不变——这样版本 diff 只显示真正的绑定变化。
*/
function mergeEdges(current, specs) {
	let edges = current.map((edge) => ({ ...edge }));
	const tally = {
		added: 0,
		replaced: 0,
		unchanged: 0
	};
	for (const spec of lastWinsByTo(specs)) {
		const incoming = edgeOf(spec);
		const firstIndex = edges.findIndex((edge) => edge.to === incoming.to);
		if (firstIndex === -1) {
			edges.push(incoming);
			tally.added += 1;
			continue;
		}
		const sameTo = edges.filter((edge) => edge.to === incoming.to);
		if (sameTo.length === 1 && sameEdge(sameTo[0], incoming)) {
			tally.unchanged += 1;
			continue;
		}
		edges = edges.filter((edge) => edge.to !== incoming.to);
		edges.splice(firstIndex, 0, incoming);
		tally.replaced += 1;
	}
	return {
		edges,
		tally
	};
}
/**
* 绑定回写工具入口：载链 → 合并边 → saveChain 新版本 → 回读。
*
* 所有链相关的失败都折成回执（不抛）：语义校验失败原样带 issues（逐条指到 edges[j]），
* 且一定没有落盘——saveChain 的「全过才写」保证了这一点。
*/
async function bindChainForTool(deps, exec, args) {
	const site = typeof args.site === "string" ? args.site : "";
	const flow = typeof args.flow === "string" ? args.flow : "";
	if (site.trim() === "" || flow.trim() === "") return {
		ok: false,
		code: "invalid-chain",
		message: "site 与 flow 不能为空：链按「站点 / 流程」归档"
	};
	const specs = Array.isArray(args.edges) ? args.edges : [];
	if (specs.length === 0) return {
		ok: false,
		code: "invalid-chain",
		message: "edges 不能为空：至少给一条要回写的绑定边（from → to）",
		site,
		flow
	};
	const shapeIssues = specShapeIssues(specs);
	if (shapeIssues.length > 0) return {
		ok: false,
		code: "invalid-chain",
		message: `绑定边入参不合法（${shapeIssues.length} 条）：没有读写链`,
		issues: toChainIssues(shapeIssues),
		site,
		flow
	};
	const workspaceRoot = await deps.resolveWorkspaceRoot(exec) ?? process.cwd();
	let loaded;
	try {
		loaded = loadChain(workspaceRoot, site, flow, { ...args.version === void 0 ? {} : { version: args.version } });
	} catch (error) {
		return {
			ok: false,
			code: "invalid-chain",
			message: `读取链失败：${messageOf$7(error)}`,
			site,
			flow
		};
	}
	if (!loaded.ok) {
		if (loaded.code === "chain-not-found") {
			const hints = loaded.availableVersions.length === 0 ? ["该站点/流程还没有任何链版本：先跑 dataforge_chain_upsert 建一份链，再用本入口回写绑定边"] : [`可用版本：${loaded.availableVersions.map((version) => `v${version}`).join("、")}；不传 version 即取最新`];
			return {
				ok: false,
				code: "chain-not-found",
				message: loaded.message,
				hints,
				site,
				flow
			};
		}
		return {
			ok: false,
			code: "invalid-chain",
			message: loaded.message,
			issues: toChainIssues(loaded.issues),
			path: loaded.path,
			site,
			flow
		};
	}
	if (loaded.doc.kind !== "interface-chain") return {
		ok: false,
		code: "invalid-chain",
		message: `绑定边只适用于 interface-chain（当前 ${loaded.doc.kind}）：页面动线是节点到节点的顺序，请直接 dataforge_chain_upsert`,
		site,
		flow
	};
	const merged = mergeEdges(loaded.doc.edges, specs);
	const nextDoc = {
		...loaded.doc,
		edges: merged.edges
	};
	let saved;
	try {
		saved = saveChain(workspaceRoot, chainToYaml(nextDoc), { source: "agent" });
	} catch (error) {
		return {
			ok: false,
			code: "invalid-chain",
			message: `落盘链失败：${messageOf$7(error)}`,
			site,
			flow
		};
	}
	if (!saved.ok) {
		const code = chainErrorCode(saved.issues);
		return {
			ok: false,
			code,
			message: code === "card-not-imported" ? "链引用的接口卡不在项目接口库：先跑 dataforge_library_import" : `绑定后的链未通过校验（${saved.issues.length} 条）：修好再提交，没有落盘`,
			issues: toChainIssues(saved.issues),
			site,
			flow
		};
	}
	let persisted;
	try {
		persisted = loadChain(workspaceRoot, saved.doc.meta.site, saved.doc.meta.flow, { version: saved.version });
	} catch (error) {
		return {
			ok: false,
			code: "invalid-chain",
			message: `绑定已落盘为 v${saved.version}，但回读失败：${messageOf$7(error)}`,
			version: saved.version,
			path: saved.path,
			site,
			flow
		};
	}
	if (!persisted.ok) return {
		ok: false,
		code: "invalid-chain",
		message: `绑定已落盘为 v${saved.version}，但回读失败：${persisted.message}`,
		version: saved.version,
		path: saved.path,
		site,
		flow
	};
	const hints = [];
	if (merged.tally.added === 0 && merged.tally.replaced === 0) hints.push(`绑定无变化（unchanged ${merged.tally.unchanged}）：本入口仍按 saveChain 的「每次落盘即新快照」纪律写成新版本，旧版本可回读`);
	if (saved.warnings.length > 0) hints.push(...saved.warnings.map((issue) => `${issue.target}：${issue.reason}`));
	return {
		ok: true,
		site: saved.doc.meta.site,
		flow: saved.doc.meta.flow,
		version: saved.version,
		path: saved.path,
		added: merged.tally.added,
		replaced: merged.tally.replaced,
		unchanged: merged.tally.unchanged,
		edges: persisted.doc.edges.map((edge) => ({
			from: edge.from,
			to: edge.to
		})),
		...hints.length === 0 ? {} : { hints }
	};
}

//#endregion
//#region src/execute/probe.ts
/**
* 单节点试探（R-5 M1）：链上某一个节点的一发请求 + 值来源 + 独立 run 留痕。
*
* 与整链执行（`run.ts`）的分工：
*   - probe **不消费绑定边**、不写链文件、不做换票；它只回答「这个节点用这些值发一发，
*     会发生什么、能取到哪些出参」；
*   - 缺参不整链拒跑，而是在发请求前返回 `paused`：缺什么 + 卡模板长什么样；
*   - 写方法没有 `confirm=true` 只出计划卡，一个请求都不发（R-5 的用户确认闸）。
*
* 安全面：
*   - 敏感路径（password/token/secret/authorization/cookie/api-key…）的值一律写 `***`，
*     不进 run.json / 事件 / 回执；
*   - 请求头走 `redactHeaders`；正文与响应预览按敏感值再做一次文本脱敏；
*   - probe 不处理凭证；需要登录态的节点由调用方装配的 R-4 provider 注入。
*
* @module dsh-dataforge/execute/probe
*/
const WRITE_METHODS = /* @__PURE__ */ new Set([
	"POST",
	"PUT",
	"PATCH",
	"DELETE"
]);
const IDEMPOTENT_METHODS = /* @__PURE__ */ new Set([
	"GET",
	"HEAD",
	"OPTIONS"
]);
const MAX_PROBE_RETRY = 3;
const SENSITIVE_PATH_RE = /(pass(word)?|pwd|secret|token|authorization|cookie|api[-_]?key|credential)/i;
function isSensitivePath(path) {
	return SENSITIVE_PATH_RE.test(path);
}
function previewValue(value) {
	if (typeof value === "string") return value.length <= 512 ? value : `${value.slice(0, 512)}…`;
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		const text = JSON.stringify(value);
		return text.length <= 512 ? text : `${text.slice(0, 512)}…`;
	} catch {
		return "[不可序列化]";
	}
}
/** 文本脱敏：把已知敏感值替换成 `***`（防请求/响应回显）。 */
function redactText(text, sensitiveValues) {
	if (sensitiveValues.length === 0) return text;
	let out = text;
	for (const value of sensitiveValues) {
		if (value === void 0 || value === null) continue;
		const raw = typeof value === "string" ? value : previewValue(value);
		if (raw.length < 2) continue;
		out = out.split(raw).join("***");
	}
	return out;
}
function redactHeaderValues(headers, sensitiveValues) {
	const out = {};
	for (const [name, value] of Object.entries(headers)) out[name] = redactText(value, sensitiveValues);
	return out;
}
function cardInputsOf(card) {
	return (card.inputs ?? []).filter((field) => field.role !== "credential").map((field) => ({
		path: field.path,
		type: field.type,
		required: field.required === true,
		...field.role === void 0 ? {} : { role: field.role }
	}));
}
function newProbeRunId(dataRoot, flow, now) {
	const base = `probe-${slugOf(flow) || "flow"}-${now}`;
	let candidate = base;
	let suffix = 2;
	while (existsSync(join(runsRoot(dataRoot), candidate))) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}
function gapOf(gap) {
	return {
		path: gap.path,
		type: gap.type,
		target: gap.target
	};
}
/**
* 值来源校验 + 缺参判定。
*
* 缺参不走错误：返回 `gaps` 让调用方 `paused`；值形状错误才是 blocked。
* 常量的来源自动标 `constant`；`$inputs.x` 常量从 `chainInputs` 取，来源标 `user`。
*/
function prepareProbeValues(input) {
	const { card, node } = input;
	const allInputs = new Map((card.inputs ?? []).map((field) => [normalizePath(field.path), field]));
	const cardInputs = cardInputsOf(card);
	const provided = /* @__PURE__ */ new Map();
	for (const [rawPath, spec] of Object.entries(input.values ?? {})) {
		const path = normalizePath(rawPath);
		const field = allInputs.get(path);
		if (field === void 0) return {
			ok: false,
			code: "unknown-value",
			message: `${rawPath} 不在卡入参模板里；可用字段：${[...allInputs.keys()].join("、") || "（卡里没有入参）"}`
		};
		if (field.role === "credential") return {
			ok: false,
			code: "invalid-source",
			message: `${rawPath} 是凭证字段：probe 不接受凭证值，请走 R-4 凭证注入`
		};
		if (spec === null || typeof spec !== "object" || Array.isArray(spec)) return {
			ok: false,
			code: "invalid-source",
			message: `${rawPath} 的值必须形如 { value, source, evidence? }`
		};
		const source = spec.source;
		if (source !== "user" && source !== "agent-inferred" && source !== "upstream") return {
			ok: false,
			code: "invalid-source",
			message: `${rawPath} 的 source 非法：只允许 user / agent-inferred / upstream`
		};
		const value = spec.value;
		if (value === void 0) return {
			ok: false,
			code: "invalid-source",
			message: `${rawPath} 缺少 value`
		};
		const evidence = typeof spec.evidence === "string" ? spec.evidence.trim() : "";
		if ((source === "agent-inferred" || source === "upstream") && evidence === "") return {
			ok: false,
			code: "invalid-source",
			message: `${rawPath} 的来源是 ${source}：必须给 evidence（推断依据/上游绑定证据）`
		};
		provided.set(path, {
			rawPath,
			path,
			value,
			source,
			...evidence === "" ? {} : { evidence },
			sensitive: isSensitivePath(rawPath)
		});
	}
	const covered = /* @__PURE__ */ new Set();
	const provenance = [];
	const valuesRecord = {};
	const sensitiveValues = [];
	const push = (field, value, source, evidence, sensitive) => {
		covered.add(normalizePath(field.path));
		provenance.push({
			path: field.path,
			source,
			...evidence === void 0 || evidence === "" ? {} : { evidence },
			valuePreview: sensitive ? "***" : previewValue(value),
			...sensitive ? { redacted: true } : {}
		});
		valuesRecord[field.path] = sensitive ? "***" : value;
		if (sensitive) sensitiveValues.push(value);
	};
	for (const field of card.inputs ?? []) {
		if (field.role === "credential") continue;
		const key = normalizePath(field.path);
		const direct = provided.get(key);
		if (direct !== void 0) {
			push(field, direct.value, direct.source, direct.evidence, direct.sensitive);
			continue;
		}
		const constantKey = Object.keys(node.constants ?? {}).find((candidate) => normalizePath(candidate) === key);
		if (constantKey === void 0) continue;
		const raw = (node.constants ?? {})[constantKey];
		const slot = typeof raw === "string" ? inputSlotNameOf(raw) : void 0;
		if (slot !== void 0) {
			const slotValue = input.chainInputs?.[slot];
			if (slotValue === void 0) continue;
			push(field, slotValue, "user", `链级槽位 ${slot}`, isSensitivePath(field.path));
			continue;
		}
		push(field, raw, "constant", `节点常量 ${constantKey}`, isSensitivePath(field.path) || isSensitivePath(constantKey));
	}
	return {
		ok: true,
		prepared: {
			cardInputs,
			provided,
			provenance,
			valuesRecord,
			sensitiveValues,
			gaps: missingInputs(node, card, covered).map(gapOf)
		}
	};
}
/** 一次单节点试探。不抛异常：所有失败折成 `ProbeResult`。 */
async function probeNode(input) {
	const { node, card, doc } = input;
	const method = card.identity.method.toUpperCase();
	const writes = WRITE_METHODS.has(method);
	const preparedResult = prepareProbeValues(input);
	if (!preparedResult.ok) return {
		ok: false,
		gate: "blocked",
		code: preparedResult.code,
		message: preparedResult.message,
		nodeId: node.id,
		cardId: card.cardId,
		method
	};
	const prepared = preparedResult.prepared;
	if (writes && input.confirm !== true) {
		const plan = {
			nodeId: node.id,
			method,
			urlTemplate: card.identity.urlTemplate,
			writes: true,
			cardInputs: prepared.cardInputs
		};
		return {
			ok: true,
			gate: "confirm-required",
			code: "confirm-required",
			message: `节点 ${node.id} 是写操作（${method}）：向用户确认后带 confirm=true 重调；本次没有发出任何请求`,
			nodeId: node.id,
			cardId: card.cardId,
			method,
			cardInputs: prepared.cardInputs,
			plan,
			provenance: prepared.provenance
		};
	}
	const now = Date.now();
	const explorationId = input.explorationId ?? `exp_${now}`;
	const runId = newProbeRunId(input.dataRoot, doc.meta.flow, now);
	const runRecord = {
		kind: "probe-run",
		flow: doc.meta.flow,
		flowName: doc.meta.flow,
		probe: {
			site: doc.meta.site,
			flow: doc.meta.flow,
			version: doc.meta.version,
			nodeId: node.id,
			cardId: card.cardId,
			method,
			urlTemplate: card.identity.urlTemplate,
			explorationId,
			writes,
			paused: prepared.gaps.length > 0
		},
		params: prepared.valuesRecord,
		values: prepared.valuesRecord,
		provenance: prepared.provenance,
		baseUrl: input.baseUrl,
		startedAt: now
	};
	const runDir = startRunRecord(input.dataRoot, runId, runRecord);
	appendEvent(input.dataRoot, runId, {
		event: "meta",
		flow: doc.meta.flow,
		name: doc.meta.flow,
		steps: [node.id],
		dryRun: false
	});
	if (prepared.gaps.length > 0) {
		const message = `暂停：节点 ${node.id} 缺 ${prepared.gaps.length} 个入参，未发送任何请求`;
		appendEvent(input.dataRoot, runId, {
			event: "terminal",
			success: false,
			cancelled: false,
			message
		});
		appendEvent(input.dataRoot, runId, {
			event: "result",
			success: false,
			businessData: {
				probe: true,
				paused: true,
				gaps: prepared.gaps,
				provenance: prepared.provenance
			}
		});
		return {
			ok: true,
			gate: "paused",
			code: "missing-params",
			message,
			runId,
			runDir,
			explorationId,
			nodeId: node.id,
			cardId: card.cardId,
			method,
			gaps: prepared.gaps,
			cardInputs: prepared.cardInputs,
			provenance: prepared.provenance
		};
	}
	const planNode = {
		nodeId: node.id,
		cardId: card.cardId,
		method,
		urlTemplate: card.identity.urlTemplate,
		dependsOn: [],
		constants: node.constants ?? {},
		gaps: []
	};
	const providedValues = Object.fromEntries([...prepared.provided.values()].map((value) => [value.path, value.value]));
	const fileParts = resolveNodeFiles(node, input.chainInputs ?? {});
	if (!fileParts.ok) {
		appendEvent(input.dataRoot, runId, {
			event: "terminal",
			success: false,
			cancelled: false,
			message: fileParts.message
		});
		return {
			ok: false,
			gate: "blocked",
			code: fileParts.code,
			message: fileParts.message,
			runId,
			runDir,
			explorationId,
			nodeId: node.id,
			cardId: card.cardId,
			method,
			cardInputs: prepared.cardInputs,
			provenance: prepared.provenance
		};
	}
	const built = buildRequest({
		node: planNode,
		card,
		baseUrl: input.baseUrl,
		provided: providedValues,
		inputs: input.chainInputs ?? {},
		...fileParts.parts.length === 0 ? {} : { fileParts: fileParts.parts }
	});
	if (!built.ok) {
		appendEvent(input.dataRoot, runId, {
			event: "terminal",
			success: false,
			cancelled: false,
			message: `请求构造失败：${built.message}`
		});
		appendEvent(input.dataRoot, runId, {
			event: "result",
			success: false,
			businessData: {
				probe: true,
				code: built.code,
				provenance: prepared.provenance
			}
		});
		return {
			ok: false,
			gate: "blocked",
			code: built.code,
			message: built.message,
			runId,
			runDir,
			explorationId,
			nodeId: node.id,
			cardId: card.cardId,
			method,
			cardInputs: prepared.cardInputs,
			provenance: prepared.provenance
		};
	}
	let request = built.request;
	let credentialApplication;
	if (input.credentials !== void 0) {
		const resolution = input.credentials({
			card,
			url: request.url,
			method,
			nodeId: node.id
		});
		credentialApplication = resolution.application;
		if (Object.keys(resolution.headers).length > 0) request = {
			...request,
			headers: mergeCredentialHeaders(request.headers, resolution.headers)
		};
	}
	const sessionCookie = cookieHeaderIn(request.headers);
	const sensitiveValues = [...prepared.sensitiveValues];
	if (sessionCookie !== void 0) for (const part of sessionCookie.split(";")) {
		const at = part.indexOf("=");
		if (at > 0) {
			const value = part.slice(at + 1).trim();
			if (value.length >= 4) sensitiveValues.push(value);
		}
	}
	const redactedHeaders = redactHeaderValues(redactHeaders(request.headers), sensitiveValues);
	const requestDigest = {
		method: request.method,
		url: request.url,
		headers: redactedHeaders,
		...request.body === void 0 ? {} : { bodyPreview: typeof request.body === "string" ? previewText(redactText(request.body, sensitiveValues)) : `[multipart ${request.body.byteLength} bytes]` }
	};
	appendEvent(input.dataRoot, runId, {
		event: "step",
		id: node.id,
		action: `${request.method} ${request.url}`,
		status: "start",
		data: {
			card: card.cardId,
			request: requestDigest,
			provenance: prepared.provenance,
			...credentialApplication === void 0 ? {} : { credentials: credentialApplication }
		}
	});
	const retry = IDEMPOTENT_METHODS.has(method) ? Math.max(0, Math.min(MAX_PROBE_RETRY, Math.floor(input.retry ?? 0))) : 0;
	const outcome = await httpRequest({
		method: request.method,
		url: request.url,
		headers: request.headers,
		...request.body === void 0 ? {} : { body: request.body },
		timeoutMs: Math.max(1, Math.floor(input.config.nodeTimeoutSeconds)) * 1e3,
		retry,
		limitBytes: Math.max(1, Math.floor(input.config.responseLimitBytes)),
		...input.signal === void 0 ? {} : { signal: input.signal }
	});
	if (!outcome.ok) {
		const code = outcome.code === "aborted" ? "cancelled" : outcome.code === "timeout" ? "node-timeout" : outcome.code === "bad-url" ? "bad-url-template" : "node-network-error";
		const message = `节点 ${node.id}：${outcome.message}`;
		appendEvent(input.dataRoot, runId, {
			event: "step",
			id: node.id,
			status: "error",
			elapsed: outcome.elapsedMs,
			error: message,
			data: {
				code,
				attempts: outcome.attempts
			}
		});
		appendEvent(input.dataRoot, runId, {
			event: "terminal",
			success: false,
			cancelled: code === "cancelled",
			message
		});
		appendEvent(input.dataRoot, runId, {
			event: "result",
			success: false,
			businessData: {
				probe: true,
				code,
				provenance: prepared.provenance,
				attempts: outcome.attempts
			}
		});
		return {
			ok: false,
			gate: code === "cancelled" ? "blocked" : "failed",
			code,
			message,
			runId,
			runDir,
			explorationId,
			nodeId: node.id,
			cardId: card.cardId,
			method,
			request: requestDigest,
			provenance: prepared.provenance,
			attempts: outcome.attempts,
			...credentialApplication === void 0 ? {} : { credentials: credentialApplication }
		};
	}
	const response = outcome.response;
	const responseDigest = {
		status: response.status,
		bytes: response.bytes,
		truncated: response.truncated,
		bodyPreview: previewText(redactText(response.bodyText, sensitiveValues))
	};
	const root = {
		body: response.json ?? response.bodyText,
		status: response.status,
		headers: response.headers
	};
	const outputs = [];
	for (const field of card.outputs ?? []) {
		const bound = resolveBinding(root, field.path, field.type);
		const sensitive = isSensitivePath(field.path);
		if (!bound.ok) {
			outputs.push({
				path: field.path,
				type: field.type,
				error: bound.message
			});
			continue;
		}
		outputs.push({
			path: field.path,
			type: field.type,
			valuePreview: sensitive ? "***" : redactText(previewValue(bound.value), sensitiveValues),
			...sensitive ? { redacted: true } : {}
		});
	}
	if (response.status < 200 || response.status >= 300) {
		const code = response.status === 401 || response.status === 403 ? typeof card.auth === "string" && card.auth !== "none" ? "node-auth-required" : "node-http-error" : "node-http-error";
		const message = code === "node-auth-required" ? `HTTP ${response.status}：该卡声明了鉴权（${String(card.auth)}）；probe 不换票，请先确认凭证或走 dataforge_chain_run 的 relogin` : `HTTP ${response.status}`;
		appendEvent(input.dataRoot, runId, {
			event: "step",
			id: node.id,
			status: "error",
			elapsed: outcome.response.elapsedMs,
			error: message,
			data: {
				code,
				response: responseDigest,
				outputs
			}
		});
		appendEvent(input.dataRoot, runId, {
			event: "terminal",
			success: false,
			cancelled: false,
			message
		});
		appendEvent(input.dataRoot, runId, {
			event: "result",
			success: false,
			businessData: {
				probe: true,
				code,
				provenance: prepared.provenance,
				outputs,
				attempts: response.attempts
			}
		});
		return {
			ok: false,
			gate: "failed",
			code,
			message,
			runId,
			runDir,
			explorationId,
			nodeId: node.id,
			cardId: card.cardId,
			method,
			request: requestDigest,
			response: responseDigest,
			outputs,
			provenance: prepared.provenance,
			attempts: response.attempts,
			...credentialApplication === void 0 ? {} : { credentials: credentialApplication }
		};
	}
	appendEvent(input.dataRoot, runId, {
		event: "step",
		id: node.id,
		status: "done",
		elapsed: response.elapsedMs,
		data: {
			response: responseDigest,
			outputs
		}
	});
	appendEvent(input.dataRoot, runId, {
		event: "terminal",
		success: true,
		cancelled: false,
		message: `节点 ${node.id} 试探完成：HTTP ${response.status}`
	});
	appendEvent(input.dataRoot, runId, {
		event: "result",
		success: true,
		businessData: {
			probe: true,
			provenance: prepared.provenance,
			outputs,
			attempts: response.attempts
		}
	});
	return {
		ok: true,
		gate: "executed",
		runId,
		runDir,
		explorationId,
		nodeId: node.id,
		cardId: card.cardId,
		method,
		request: requestDigest,
		response: responseDigest,
		outputs,
		provenance: prepared.provenance,
		attempts: response.attempts,
		...credentialApplication === void 0 ? {} : { credentials: credentialApplication }
	};
}

//#endregion
//#region src/orchestration/explore.ts
/**
* 探索执行的应用层（R-5 M1）：把「链 + 节点 + 带来源的值」拼成一次 probe。
*
* 工具壳只做参数声明与回执；载链、找节点/卡、baseUrl 解析、错误折叠都收在这里。
* 与整链执行共用同一套 `loadChain` / `cardsForChain` / `resolveChainBaseUrl`，
* 不另造第二套链读取规则。
*
* @module dsh-dataforge/orchestration/explore
*/
function messageOf$6(error) {
	return error instanceof Error ? error.message : String(error);
}
function blocked(code, message, extra = {}) {
	return {
		ok: false,
		gate: "blocked",
		code,
		message,
		nodeId: "",
		cardId: "",
		method: "",
		...extra
	};
}
/** 一次单节点试探（工具入口）。所有失败折成 `ProbeResult`，不抛。 */
async function probeForTool(deps, exec, args) {
	if (deps.chain.enabled !== true) return blocked("probe-disabled", "执行开关已关闭（config.chainRunEnabled=false）：probe 一律拒绝");
	let workspaceRoot;
	try {
		workspaceRoot = await deps.resolveWorkspaceRoot(exec) ?? process.cwd();
	} catch (error) {
		return blocked("workspace-unavailable", `解析工作区根失败：${messageOf$6(error)}`);
	}
	const loaded = loadChain(workspaceRoot, args.site, args.flow, { ...args.version === void 0 ? {} : { version: args.version } });
	if (!loaded.ok) return {
		ok: false,
		gate: "blocked",
		code: loaded.code === "chain-not-found" ? "chain-not-found" : "invalid-chain",
		message: loaded.message,
		nodeId: args.node,
		cardId: "",
		method: ""
	};
	const doc = loaded.doc;
	if (doc.kind !== "interface-chain") return blocked("invalid-chain", `链 ${doc.meta.site}/${doc.meta.flow} 是 ${doc.kind}：probe 只支持 interface-chain`);
	const node = doc.nodes.find((candidate) => candidate.id === args.node);
	if (node === void 0) {
		const known = doc.nodes.map((candidate) => candidate.id).join("、");
		return blocked("node-not-found", `链上没有节点「${args.node}」；可用节点：${known || "（无）"}`);
	}
	if (typeof node.card !== "string" || node.card === "") return blocked("card-not-imported", `节点 ${node.id} 没有 card 引用（page-chain 需先编译）`);
	const cards = cardsForChain(workspaceRoot, doc);
	const card = cards.get(node.card);
	if (card === void 0) return blocked("card-not-imported", `节点 ${node.id} 引用的卡 ${node.card} 不在项目接口库：先 dataforge_library_import`);
	const base = resolveChainBaseUrl(doc, cards, args.baseUrl);
	const baseUrl = node.baseUrl ?? (base.ok ? base.baseUrl : void 0);
	if (baseUrl === void 0) return blocked("base-url-unresolved", base.ok ? "推不出目标站点源：显式传 baseUrl（卡的来源页面跨多个 origin 时只能人来定）" : base.message);
	return probeNode({
		dataRoot: deps.dataRoot,
		doc,
		node,
		card,
		...args.values === void 0 ? {} : { values: args.values },
		...args.inputs === void 0 ? {} : { chainInputs: args.inputs },
		baseUrl,
		...args.confirm === void 0 ? {} : { confirm: args.confirm },
		...args.retry === void 0 ? {} : { retry: args.retry },
		...args.explorationId === void 0 ? {} : { explorationId: args.explorationId },
		config: {
			nodeTimeoutSeconds: deps.chain.nodeTimeoutSeconds,
			responseLimitBytes: deps.chain.responseLimitBytes
		},
		...deps.credentials === void 0 ? {} : { credentials: deps.credentials }
	});
}

//#endregion
//#region src/execute/crystal.ts
function stringifyValue(value) {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return String(value);
	}
}
function plainRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function sourceOf(value) {
	return value === "user" || value === "agent-inferred" || value === "upstream" || value === "constant" ? value : void 0;
}
function suggestionOf(source) {
	if (source === "constant") return "constant";
	if (source === "upstream") return "chain";
	return "input";
}
/** 字段叶子名 → 槽位候选（`body.lines[0].quantity` → `quantity`）。 */
function slotNameOf$1(path) {
	const safe = (path.split(/[.[\]]/).filter((part) => part !== "" && part !== "*").pop() ?? "value").replace(/[^\p{L}\p{N}_]/gu, "_");
	return /^[0-9]/.test(safe) ? `v_${safe}` : safe === "" ? "value" : safe;
}
function probeRunsOf(input) {
	const runs = [];
	for (const runId of listRunIds(input.dataRoot, 200)) {
		const record = readRunRecord(input.dataRoot, runId);
		if (record === void 0 || record["kind"] !== "probe-run") continue;
		const probe = plainRecord$2(record["probe"]);
		if (probe === void 0) continue;
		if (probe["site"] !== input.site || probe["flow"] !== input.flow) continue;
		if (input.version !== void 0 && probe["version"] !== input.version) continue;
		const explorationId = typeof probe["explorationId"] === "string" ? probe["explorationId"] : "";
		if (explorationId === "") continue;
		if (input.explorationId !== void 0 && explorationId !== input.explorationId) continue;
		const nodeId = typeof probe["nodeId"] === "string" ? probe["nodeId"] : "";
		const cardId = typeof probe["cardId"] === "string" ? probe["cardId"] : "";
		if (nodeId === "" || cardId === "") continue;
		const provenanceRaw = record["provenance"];
		const provenance = Array.isArray(provenanceRaw) ? provenanceRaw.filter((item) => plainRecord$2(item) !== void 0) : [];
		if (provenance.length === 0) continue;
		const values = plainRecord$2(record["values"]) ?? {};
		runs.push({
			runId,
			startedAt: typeof record["startedAt"] === "number" ? record["startedAt"] : 0,
			explorationId,
			nodeId,
			cardId,
			provenance,
			values
		});
	}
	runs.sort((left, right) => left.startedAt - right.startedAt);
	return runs;
}
function fieldTypeOf(card, path) {
	if (card === void 0) return {
		type: "unknown",
		exists: false
	};
	const key = normalizePath(path);
	const field = (card.inputs ?? []).find((candidate) => normalizePath(candidate.path) === key);
	return field === void 0 ? {
		type: "unknown",
		exists: false
	} : {
		type: field.type,
		exists: true
	};
}
/**
* 读 probe 留痕 → 三分类草案。
*
* 同一 `nodeId + path` 出现多次：值/来源不一致标 `conflict`，保留最新一次的值/来源。
*/
function buildCrystalDraft(input) {
	const all = probeRunsOf(input);
	if (all.length === 0) return {
		ok: false,
		code: "crystal-no-source",
		message: `没有找到 ${input.site}/${input.flow} 的 probe 留痕${input.explorationId === void 0 ? "" : `（explorationId ${input.explorationId}）`}：先跑 dataforge_chain_probe`
	};
	const explorationId = input.explorationId ?? all[all.length - 1].explorationId;
	const runs = all.filter((run) => run.explorationId === explorationId);
	const warnings = [];
	const byKey = /* @__PURE__ */ new Map();
	for (const run of runs) {
		const card = input.cards.get(run.cardId);
		for (const item of run.provenance) {
			const path = typeof item["path"] === "string" ? item["path"] : "";
			const source = sourceOf(item["source"]);
			if (path === "" || source === void 0) continue;
			const redacted = item["redacted"] === true || run.values[path] === "***";
			const { type, exists } = fieldTypeOf(card, path);
			const rawValue = run.values[path];
			const value = redacted ? "***" : rawValue === void 0 ? null : rawValue;
			const row = {
				nodeId: run.nodeId,
				path,
				value,
				source,
				suggestion: suggestionOf(source),
				...suggestionOf(source) === "input" ? { slotName: slotNameOf$1(path) } : {},
				type,
				...typeof item["evidence"] === "string" && item["evidence"] !== "" ? { evidence: item["evidence"] } : {},
				requiresUserConfirmation: source === "agent-inferred",
				...redacted ? { excluded: "敏感值不参与结晶" } : {},
				...!exists && !redacted ? { excluded: "卡模板里没有这个入参" } : {}
			};
			const key = `${run.nodeId}\u0000${path}`;
			const existing = byKey.get(key);
			if (existing === void 0) {
				byKey.set(key, row);
				continue;
			}
			if (existing.source !== row.source || stringifyValue(existing.value) !== stringifyValue(row.value)) byKey.set(key, {
				...row,
				conflict: true
			});
		}
	}
	const rows = [...byKey.values()];
	if (rows.length === 0) return {
		ok: false,
		code: "crystal-no-source",
		message: "probe 留痕里没有可结晶的 provenance 行"
	};
	const excluded = rows.filter((row) => row.excluded !== void 0);
	if (excluded.length > 0) warnings.push(`${excluded.length} 行被排除（敏感/卡模板缺失），不写回`);
	return {
		ok: true,
		draft: {
			site: input.site,
			flow: input.flow,
			...input.version === void 0 ? {} : { version: input.version },
			explorationId,
			probeRunIds: runs.map((run) => run.runId),
			rows,
			warnings
		}
	};
}
/**
* 铁律校验：响应值（upstream）不能出现在 decisions 的 `as` 里。
*
* 即使调用方硬写 `as:'constant'`，也在写链前拒绝——工具不提供这条路径。
*/
function assertNoResponseConstant(draft, decisions = {}) {
	for (const row of draft.rows) {
		if (row.source !== "upstream") continue;
		const decision = decisions[`${row.nodeId}:${row.path}`];
		if (decision?.as !== void 0) return {
			ok: false,
			code: "crystal-iron-rule",
			message: `${row.nodeId}.${row.path} 是 upstream 响应值：只能走绑定边重新求解，不能冻成 ${decision.as}`,
			row
		};
	}
	return { ok: true };
}
function exampleOf(value) {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null) return "";
	try {
		return JSON.stringify(value);
	} catch {
		return "";
	}
}
function hasBindingTo(doc, nodeId, path) {
	return doc.edges.some((edge) => {
		const to = splitBindingPath(edge.to);
		return to !== void 0 && to.nodeId === nodeId && normalizePath(to.fieldPath) === normalizePath(path);
	});
}
/**
* 草案 + 决策 → 新链 doc。纯函数：不写盘、不改入参。
*
* 写回规则：
*   - constant → `node.constants[path] = value`（只接受 string/number/boolean）；
*   - input → 链级 inputs 槽位 + `node.constants[path] = "$inputs.<name>"`；
*   - chain → 不写常量，只校验已有绑定边；
*   - excluded → 跳过。
*/
function applyCrystalDraft(input) {
	const { doc, draft } = input;
	const decisions = input.decisions ?? {};
	const iron = assertNoResponseConstant(draft, decisions);
	if (!iron.ok) return iron;
	const warnings = [...draft.warnings];
	const nodes = doc.nodes.map((node) => ({
		...node,
		constants: { ...node.constants ?? {} }
	}));
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const inputs = doc.inputs.map((slot) => ({ ...slot }));
	const inputByName = new Map(inputs.map((slot) => [slot.name, slot]));
	const usedSlotNames = new Set(inputs.map((slot) => slot.name));
	for (const row of draft.rows) {
		if (row.excluded !== void 0) continue;
		const node = nodeById.get(row.nodeId);
		if (node === void 0) {
			warnings.push(`节点 ${row.nodeId} 已不在链上，跳过 ${row.path}`);
			continue;
		}
		const decision = decisions[`${row.nodeId}:${row.path}`];
		if (decision !== void 0 && decision.as !== void 0 && decision.as !== "constant" && decision.as !== "input") return {
			ok: false,
			code: "crystal-invalid-decision",
			message: `${row.nodeId}.${row.path} 的决策非法：只允许 constant / input`,
			row
		};
		if (row.source === "agent-inferred" && decision?.confirmed !== true) return {
			ok: false,
			code: "crystal-confirmation-required",
			message: `${row.nodeId}.${row.path} 来自 agent-inferred：必须在 decisions 里 confirmed:true（用户确认过）`,
			row
		};
		if (row.conflict === true && decision === void 0) return {
			ok: false,
			code: "crystal-conflict",
			message: `${row.nodeId}.${row.path} 在多条 probe 里值/来源不一致：在 decisions 里明确选一个`,
			row
		};
		const as = row.source === "upstream" ? "chain" : decision?.as ?? row.suggestion;
		if (as === "chain") {
			if (!hasBindingTo(doc, row.nodeId, row.path)) return {
				ok: false,
				code: "crystal-chain-without-binding",
				message: `${row.nodeId}.${row.path} 是响应值，但链上没有指向它的绑定边：先用 dataforge_chain_upsert 补边`,
				row
			};
			continue;
		}
		if (as === "constant") {
			const value = row.value;
			if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return {
				ok: false,
				code: "crystal-unsupported-value",
				message: `${row.nodeId}.${row.path} 的值不是标量，不能冻成常量；请改成入参槽位`,
				row
			};
			node.constants[row.path] = String(value);
			continue;
		}
		if (!CHAIN_VALUE_TYPES.includes(row.type)) return {
			ok: false,
			code: "crystal-unsupported-value",
			message: `${row.nodeId}.${row.path} 的类型 ${row.type} 不在链槽位类型词表里`,
			row
		};
		let slotName = decision?.slotName ?? row.slotName ?? slotNameOf$1(row.path);
		const existing = inputByName.get(slotName);
		if (existing !== void 0 && existing.type !== row.type) return {
			ok: false,
			code: "crystal-slot-conflict",
			message: `槽位 ${slotName} 已存在且类型是 ${existing.type}，与 ${row.type} 冲突：换一个 slotName`,
			row
		};
		if (existing === void 0) {
			let candidate = slotName;
			let suffix = 2;
			while (usedSlotNames.has(candidate)) {
				candidate = `${slotName}_${suffix}`;
				suffix += 1;
			}
			slotName = candidate;
			const slot = {
				name: slotName,
				type: row.type,
				required: true,
				example: exampleOf(row.value)
			};
			inputs.push(slot);
			inputByName.set(slotName, slot);
			usedSlotNames.add(slotName);
		}
		node.constants[row.path] = `$inputs.${slotName}`;
	}
	return {
		ok: true,
		doc: {
			...doc,
			inputs,
			nodes
		},
		inputs,
		warnings
	};
}

//#endregion
//#region src/orchestration/crystal.ts
/**
* 结晶的应用层（R-6 M1）：载链/卡 → 草案 → 决策 → saveChain 新版本 + crystal-run。
*
* 写回只走 `saveChain`（R-1 校验 + 版本快照）；本模块不直接写 YAML。
* 复跑不在这里：结晶后的链直接交给 `dataforge_chain_run` 代入新槽位。
*
* @module dsh-dataforge/orchestration/crystal
*/
const toJsonObject = (value) => JSON.parse(JSON.stringify(value));
const toJsonArray = (value) => JSON.parse(JSON.stringify(value));
/** 把内部回执转成工具出口可校验的 JSON（递归丢 undefined 由 lossless 再做一次）。 */
function crystalOutputOf(value) {
	return {
		ok: value.ok,
		gate: value.gate,
		...value.code === void 0 ? {} : { code: value.code },
		...value.message === void 0 ? {} : { message: value.message },
		...value.draft === void 0 ? {} : { draft: toJsonObject(value.draft) },
		...value.rows === void 0 ? {} : { rows: toJsonArray(value.rows) },
		...value.inputs === void 0 ? {} : { inputs: toJsonArray(value.inputs) },
		...value.version === void 0 ? {} : { version: value.version },
		...value.path === void 0 ? {} : { path: value.path },
		...value.runId === void 0 ? {} : { runId: value.runId },
		...value.runDir === void 0 ? {} : { runDir: value.runDir },
		...value.issues === void 0 ? {} : { issues: toJsonArray(value.issues) },
		...value.warnings === void 0 ? {} : { warnings: value.warnings }
	};
}
function messageOf$5(error) {
	return error instanceof Error ? error.message : String(error);
}
function newCrystalRunId(dataRoot, flow, now) {
	const base = `crystal-${slugOf(flow) || "flow"}-${now}`;
	let candidate = base;
	let suffix = 2;
	while (existsSync(join(runsRoot(dataRoot), candidate))) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}
function auditRow(row) {
	return row.excluded === void 0 ? row : {
		...row,
		value: "***"
	};
}
/** 结晶工具入口：草案 → 确认 → 写回 → crystal-run。所有失败折成回执，不抛。 */
async function crystalForTool(deps, exec, args) {
	if (deps.chain.enabled !== true) return {
		ok: false,
		gate: "blocked",
		code: "execution-disabled",
		message: "执行开关已关闭（config.chainRunEnabled=false）：结晶也拒绝，避免在停执行时改资产"
	};
	let workspaceRoot;
	try {
		workspaceRoot = await deps.resolveWorkspaceRoot(exec) ?? process.cwd();
	} catch (error) {
		return {
			ok: false,
			gate: "blocked",
			code: "crystal-no-source",
			message: `解析工作区根失败：${messageOf$5(error)}`
		};
	}
	const loaded = loadChain(workspaceRoot, args.site, args.flow, { ...args.version === void 0 ? {} : { version: args.version } });
	if (!loaded.ok) return {
		ok: false,
		gate: "blocked",
		code: "invalid-chain",
		message: loaded.message
	};
	const doc = loaded.doc;
	if (doc.kind !== "interface-chain") return {
		ok: false,
		gate: "blocked",
		code: "invalid-chain",
		message: `结晶只支持 interface-chain（当前 ${doc.kind}）`
	};
	const cards = cardsForChain(workspaceRoot, doc);
	const built = buildCrystalDraft({
		dataRoot: deps.dataRoot,
		site: args.site,
		flow: args.flow,
		...args.version === void 0 ? {} : { version: args.version },
		...args.explorationId === void 0 ? {} : { explorationId: args.explorationId },
		cards
	});
	if (!built.ok) return {
		ok: false,
		gate: "blocked",
		code: built.code,
		message: built.message,
		...built.row === void 0 ? {} : { rows: [built.row] }
	};
	const draft = built.draft;
	if (args.confirm !== true) return {
		ok: true,
		gate: "draft",
		code: "crystal-confirmation-required",
		message: `结晶草案已生成（${draft.rows.length} 行，exploration ${draft.explorationId}）：向用户确认后带 confirm=true 重调；本次没有写链`,
		draft,
		inputs: doc.inputs,
		warnings: draft.warnings
	};
	const applied = applyCrystalDraft({
		doc,
		cards,
		draft,
		...args.decisions === void 0 ? {} : { decisions: args.decisions }
	});
	if (!applied.ok) return {
		ok: false,
		gate: "blocked",
		code: applied.code,
		message: applied.message,
		...applied.row === void 0 ? {} : { rows: [applied.row] },
		draft,
		warnings: draft.warnings
	};
	const saved = saveChain(workspaceRoot, applied.doc, { source: "agent" });
	if (!saved.ok) return {
		ok: false,
		gate: "blocked",
		code: "invalid-chain",
		message: `结晶后的链未通过 R-1 校验（${saved.issues.length} 条）：没有落盘`,
		issues: saved.issues.map((issue) => ({
			target: issue.target,
			code: issue.code,
			reason: issue.reason
		})),
		draft,
		warnings: draft.warnings
	};
	const now = Date.now();
	const runId = newCrystalRunId(deps.dataRoot, args.flow, now);
	const runRecord = {
		kind: "crystal-run",
		flow: args.flow,
		flowName: args.flow,
		crystal: {
			site: args.site,
			flow: args.flow,
			explorationId: draft.explorationId,
			decisions: args.decisions ?? {},
			writtenVersion: saved.version,
			path: saved.path
		},
		draft: draft.rows.map(auditRow),
		startedAt: now
	};
	const runDir = startRunRecord(deps.dataRoot, runId, runRecord);
	appendEvent(deps.dataRoot, runId, {
		event: "meta",
		flow: args.flow,
		name: args.flow,
		steps: [],
		dryRun: false
	});
	appendEvent(deps.dataRoot, runId, {
		event: "terminal",
		success: true,
		cancelled: false,
		message: `结晶写回 ${args.site}/${args.flow} v${saved.version}`
	});
	appendEvent(deps.dataRoot, runId, {
		event: "result",
		success: true,
		businessData: {
			crystal: true,
			explorationId: draft.explorationId,
			version: saved.version,
			path: saved.path,
			inputs: applied.inputs
		}
	});
	return {
		ok: true,
		gate: "written",
		message: `结晶已写回 ${args.site}/${args.flow} v${saved.version}（${applied.inputs.length} 个槽位）`,
		draft,
		inputs: applied.inputs,
		version: saved.version,
		path: saved.path,
		runId,
		runDir,
		warnings: applied.warnings
	};
}

//#endregion
//#region src/orchestration/compare.ts
/**
* 复跑对照（R-6 M2 / FR-6.7）：把两次 `chain-run` 的留痕并排投影成一张差异视图。
*
* 为什么要单独一个模块：`diagnose` 回答「一条失败的 run 断在哪」，对照要回答
* 「换入参复跑之后什么变了、链生成值是不是重新求解」。两者都是只读投影，
* 只是这里一次读一对 run，输出要能直接给模型看「入参 / 出参 / 节点状态」的差异。
*
* 只读铁律：只走 `readRunRecord` + `loadRunEvents`；不重跑、不发请求、不写留痕、
* 不碰凭证。事件形状完全复用 R-3 已写入的事实（step done 的 `data.emitted` /
* `data.response`、result 的 `businessData`），不发明第二套执行语义。
*
* @module dsh-dataforge/orchestration/compare
*/
/** 工具回执的 JSON 安全投影（照 `diagnoseOutputOf` 的做法，二次序列化兜底）。 */
function compareOutputOf(value) {
	return JSON.parse(JSON.stringify(value));
}
function plainRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function stringOf$1(value) {
	return typeof value === "string" ? value : void 0;
}
function numberOrUndefined$1(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* 敏感键名片段（小写子串匹配）。
*
* 为什么用「命中即打码」而不是精确键名表：留痕里的键名有 `access_token`、
* `x-api-key`、`Authorization` 等各种写法，漏一个就是一次泄漏；宁可多打码。
*/
const SENSITIVE_KEY_MARKERS = [
	"password",
	"passwd",
	"pwd",
	"secret",
	"token",
	"authorization",
	"cookie",
	"api-key",
	"apikey",
	"api_key",
	"private-key",
	"access-key"
];
function isSensitiveKey(key) {
	const lower = key.toLowerCase();
	return SENSITIVE_KEY_MARKERS.some((marker) => lower.includes(marker));
}
/** 递归把敏感键名的值换成 `***`；数组/对象深拷贝，只用于输出投影。 */
function redactValue(value) {
	if (Array.isArray(value)) return value.map(redactValue);
	if (value !== null && typeof value === "object") {
		const out = {};
		for (const [key, child] of Object.entries(value)) out[key] = isSensitiveKey(key) ? "***" : redactValue(child);
		return out;
	}
	return value;
}
/** 把 unknown 折成 JSON 安全叶子；序列化不了的值不投影（诚实留空，不塞 `[object]`）。 */
function jsonValueOf(value) {
	try {
		const text = JSON.stringify(value);
		if (text === void 0) return void 0;
		return JSON.parse(text);
	} catch {
		return;
	}
}
/** 递归 JSON 比较（对象键序无关）：判断「值是否真的变了」只看原始值，不看打码后的投影。 */
function deepEqual(left, right) {
	if (left === right) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		return left.every((item, index) => deepEqual(item, right[index]));
	}
	if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
	const leftRecord = left;
	const rightRecord = right;
	const leftKeys = Object.keys(leftRecord);
	if (leftKeys.length !== Object.keys(rightRecord).length) return false;
	return leftKeys.every((key) => key in rightRecord && deepEqual(leftRecord[key], rightRecord[key]));
}
/**
* 从事件流里取节点状态。
*
* 只认 step 事件：`start` 标 started，`done`/`error` 取 response.status 与 elapsed。
* 没启动过的节点（失败后下游被跳过）不会有 step —— 由 `businessNodesOf` 补。
*/
function stepNodesOf(events) {
	const nodes = /* @__PURE__ */ new Map();
	const order = [];
	for (const event of events) {
		if (event.event !== "step" || typeof event.id !== "string") continue;
		const nodeId = event.id;
		const info = { ...nodes.get(nodeId) ?? {} };
		if (!nodes.has(nodeId)) order.push(nodeId);
		if (event.status === "start") info.status = "started";
		if (event.status === "done") info.status = "done";
		if (event.status === "error") info.status = "error";
		const httpStatus = numberOrUndefined$1(plainRecord$1(plainRecord$1(event.data)?.["response"])?.["status"]);
		if (httpStatus !== void 0) info.httpStatus = httpStatus;
		const elapsedMs = numberOrUndefined$1(event.elapsed);
		if (elapsedMs !== void 0) info.elapsedMs = elapsedMs;
		nodes.set(nodeId, info);
	}
	return {
		order,
		nodes
	};
}
/** `result.businessData.nodes`：全量节点列表（含 skipped），事件流里没有的靠它补。 */
function businessNodesOf(events) {
	let result;
	for (const event of events) if (event.event === "result") result = event;
	const raw = plainRecord$1(result?.businessData)?.["nodes"];
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const item of raw) {
		const record = plainRecord$1(item);
		const nodeId = stringOf$1(record?.["nodeId"]);
		if (nodeId === void 0) continue;
		const status = stringOf$1(record?.["status"]);
		const httpStatus = numberOrUndefined$1(record?.["httpStatus"]);
		const elapsedMs = numberOrUndefined$1(record?.["elapsedMs"]);
		out.push({
			nodeId,
			...status === void 0 ? {} : { status },
			...httpStatus === void 0 ? {} : { httpStatus },
			...elapsedMs === void 0 ? {} : { elapsedMs }
		});
	}
	return out;
}
/** 出参实际值：step done 的 `data.emitted`，键就是绑定边 `from`（如 `query.body.items[0].internalId`）。 */
function emittedOf(events) {
	const values = /* @__PURE__ */ new Map();
	const order = [];
	for (const event of events) {
		if (event.event !== "step" || event.status !== "done") continue;
		const emitted = plainRecord$1(plainRecord$1(event.data)?.["emitted"]);
		if (emitted === void 0) continue;
		for (const [path, value] of Object.entries(emitted)) {
			if (isInputSlotRef(path)) continue;
			if (splitBindingPath(path) === void 0) continue;
			if (!values.has(path)) order.push(path);
			values.set(path, value);
		}
	}
	return {
		order,
		values
	};
}
/** 链身份：以 run.json 的 `chain` 快照为准（写入时的版本），旧 run 退回 meta 折叠。 */
function chainOf(record, summary) {
	const recordChain = plainRecord$1(record["chain"]);
	const site = stringOf$1(recordChain?.["site"]) ?? summary.chain?.site;
	const flow = stringOf$1(recordChain?.["flow"]) ?? summary.chain?.flow;
	const version = numberOrUndefined$1(recordChain?.["version"]) ?? summary.chain?.version;
	if (site === void 0 && flow === void 0 && version === void 0) return void 0;
	return {
		site: site ?? "",
		flow: flow ?? "",
		version: version ?? 0
	};
}
/** 把一条 run 的留痕折成投影；事件流为空时调用方已经先报 run-not-found。 */
function snapshotOf(runId, record, events) {
	const summary = foldSummary(runId, events);
	const step = stepNodesOf(events);
	for (const business of businessNodesOf(events)) {
		const existing = step.nodes.get(business.nodeId);
		if (existing === void 0) {
			step.order.push(business.nodeId);
			step.nodes.set(business.nodeId, {
				...business.status === void 0 ? {} : { status: business.status },
				...business.httpStatus === void 0 ? {} : { httpStatus: business.httpStatus },
				...business.elapsedMs === void 0 ? {} : { elapsedMs: business.elapsedMs }
			});
			continue;
		}
		if (existing.status === void 0 && business.status !== void 0) existing.status = business.status;
		if (existing.httpStatus === void 0 && business.httpStatus !== void 0) existing.httpStatus = business.httpStatus;
		if (existing.elapsedMs === void 0 && business.elapsedMs !== void 0) existing.elapsedMs = business.elapsedMs;
	}
	const emitted = emittedOf(events);
	const chain = chainOf(record, summary);
	const failedNode = summary.chain?.failedNode ?? (summary.status === "failed" ? summary.lastStepId : void 0);
	return {
		runId,
		status: summary.status,
		startedAt: numberOrUndefined$1(record["startedAt"]) ?? summary.startedAt,
		...chain === void 0 ? {} : { chain },
		params: plainRecord$1(record["params"]) ?? {},
		...failedNode === void 0 ? {} : { failedNode },
		nodeOrder: step.order,
		nodes: step.nodes,
		emittedOrder: emitted.order,
		emitted: emitted.values
	};
}
function inputsOf(base, target) {
	return [.../* @__PURE__ */ new Set([...Object.keys(base.params), ...Object.keys(target.params)])].map((key) => {
		const hasBase = Object.prototype.hasOwnProperty.call(base.params, key);
		const hasTarget = Object.prototype.hasOwnProperty.call(target.params, key);
		const baseValue = base.params[key];
		const targetValue = target.params[key];
		const changed = hasBase !== hasTarget ? true : !deepEqual(baseValue, targetValue);
		const baseJson = hasBase ? jsonValueOf(isSensitiveKey(key) ? "***" : redactValue(baseValue)) : void 0;
		const targetJson = hasTarget ? jsonValueOf(isSensitiveKey(key) ? "***" : redactValue(targetValue)) : void 0;
		return {
			key,
			...baseJson === void 0 ? {} : { base: baseJson },
			...targetJson === void 0 ? {} : { target: targetJson },
			changed
		};
	});
}
function emittedDiffsOf(base, target) {
	const keys = [...base.emittedOrder, ...target.emittedOrder.filter((key) => !base.emitted.has(key))];
	const out = [];
	for (const key of keys) {
		const split = splitBindingPath(key);
		if (split === void 0) continue;
		const hasBase = base.emitted.has(key);
		const hasTarget = target.emitted.has(key);
		const baseRaw = base.emitted.get(key);
		const targetRaw = target.emitted.get(key);
		const changed = hasBase !== hasTarget ? true : !deepEqual(baseRaw, targetRaw);
		const sensitive = isSensitiveKey(key);
		const baseJson = hasBase ? jsonValueOf(sensitive ? "***" : redactValue(baseRaw)) : void 0;
		const targetJson = hasTarget ? jsonValueOf(sensitive ? "***" : redactValue(targetRaw)) : void 0;
		out.push({
			nodeId: split.nodeId,
			path: split.fieldPath,
			...baseJson === void 0 ? {} : { base: baseJson },
			...targetJson === void 0 ? {} : { target: targetJson },
			changed
		});
	}
	return out;
}
function nodesOf(base, target) {
	return [...base.nodeOrder, ...target.nodeOrder.filter((nodeId) => !base.nodes.has(nodeId))].map((nodeId) => {
		const baseInfo = base.nodes.get(nodeId);
		const targetInfo = target.nodes.get(nodeId);
		const changed = baseInfo?.status !== targetInfo?.status || baseInfo?.httpStatus !== targetInfo?.httpStatus || baseInfo?.elapsedMs !== targetInfo?.elapsedMs;
		return {
			nodeId,
			...baseInfo?.status === void 0 ? {} : { baseStatus: baseInfo.status },
			...targetInfo?.status === void 0 ? {} : { targetStatus: targetInfo.status },
			...baseInfo?.httpStatus === void 0 ? {} : { baseHttpStatus: baseInfo.httpStatus },
			...targetInfo?.httpStatus === void 0 ? {} : { targetHttpStatus: targetInfo.httpStatus },
			...baseInfo?.elapsedMs === void 0 ? {} : { baseElapsedMs: baseInfo.elapsedMs },
			...targetInfo?.elapsedMs === void 0 ? {} : { targetElapsedMs: targetInfo.elapsedMs },
			changed
		};
	});
}
/** 建议只给「下一步能做什么」，不重复回执里已有的事实。 */
function hintsOf$1(base, target, inputs, emitted, nodes) {
	const hints = [];
	const baseVersion = base.chain?.version;
	const targetVersion = target.chain?.version;
	if (baseVersion !== void 0 && targetVersion !== void 0 && baseVersion !== targetVersion) hints.push(`链版本不同（v${baseVersion} → v${targetVersion}）：两次跑的不是同一版链，出参差异也可能来自链定义变化`);
	const inputsChanged = inputs.filter((input) => input.changed).length;
	const emittedChanged = emitted.filter((item) => item.changed).length;
	if (inputsChanged > 0) hints.push(`入参有 ${inputsChanged} 个不同（inputs.changed）：复跑换的就是这些槽位`);
	if (emittedChanged > 0) hints.push(`出参有 ${emittedChanged} 个不同（emitted.changed）：链生成值由上游响应重新求解，不是首跑缓存`);
	if (base.failedNode !== void 0 && target.failedNode === void 0) hints.push(`基线失败于节点 ${base.failedNode}、对照运行已完成：对照 nodes 里该节点的状态变化可确认修复点`);
	if (base.failedNode === void 0 && target.failedNode !== void 0) hints.push(`对照运行失败于节点 ${target.failedNode}：用 dataforge_chain_diagnose(runId=${target.runId}) 看该节点的入边与上游状态`);
	if (base.failedNode !== void 0 && target.failedNode !== void 0) hints.push(base.failedNode === target.failedNode ? `两次都失败在同一节点 ${base.failedNode}：先核对入参与绑定边，再决定是否重跑` : `两次分别失败在 ${base.failedNode} / ${target.failedNode}：断点变了，先修对照运行的新断点`);
	const statusSame = nodes.every((node) => node.baseStatus === node.targetStatus && node.baseHttpStatus === node.targetHttpStatus);
	if (inputsChanged === 0 && emittedChanged === 0 && statusSame) hints.push("两次运行在入参、出参与节点状态上没有差异（耗时可能不同）：复跑没有改变求解结果");
	return hints;
}
function failureOf(code, message) {
	return {
		ok: false,
		code,
		message
	};
}
function sideLabelOf(side) {
	return side === "base" ? "基线运行（runIds[0]）" : "对照运行（runIds[1]）";
}
/**
* 读一条 run 并折成投影。
*
* 只读：没有就如实报错，不猜测、不回退到「最近一次运行」——对照的对象必须是
* 调用方明确给的那两条留痕。
*/
function loadSnapshotOf(deps, runId, side) {
	const label = sideLabelOf(side);
	const record = readRunRecord(deps.dataRoot, runId);
	if (record === void 0) return {
		ok: false,
		value: failureOf("run-not-found", `${label} ${runId} 不存在（没有 run.json 留痕）`)
	};
	if (record["kind"] !== "chain-run") return {
		ok: false,
		value: failureOf("not-chain-run", `${label} ${runId} 不是链运行（kind=${String(record["kind"])}）：复跑对照只接受 dataforge_chain_run 的留痕`)
	};
	const events = loadRunEvents(deps.dataRoot, runId);
	if (events === void 0 || events.length === 0) return {
		ok: false,
		value: failureOf("run-not-found", `${label} ${runId} 还没有事件留痕，无法对照`)
	};
	return {
		ok: true,
		snapshot: snapshotOf(runId, record, events)
	};
}
/**
* 对照两条链运行（只读）。
*
* 顺序语义：`runIds[0]` = 基线（base），`runIds[1]` = 对照（target）；
* 输出的 `runs` 固定 [base, target]，`inputs`/`nodes`/`emitted` 的 base/target
* 字段也按同样顺序，避免调用方还要猜。
*/
async function compareForTool(deps, args) {
	const runIds = args.runIds;
	if (!Array.isArray(runIds) || runIds.length !== 2) return failureOf("invalid-run-ids", "runIds 必须是 [baseRunId, targetRunId]：两个 runId 缺一不可");
	const [rawBase, rawTarget] = runIds;
	if (typeof rawBase !== "string" || typeof rawTarget !== "string") return failureOf("invalid-run-ids", "runIds 的两个元素都必须是字符串 runId");
	const baseRunId = rawBase.trim();
	const targetRunId = rawTarget.trim();
	if (baseRunId === "" || targetRunId === "") return failureOf("invalid-run-ids", "runIds 的两个元素都不能为空字符串");
	const baseLoaded = loadSnapshotOf(deps, baseRunId, "base");
	if (!baseLoaded.ok) return baseLoaded.value;
	const targetLoaded = loadSnapshotOf(deps, targetRunId, "target");
	if (!targetLoaded.ok) return targetLoaded.value;
	const base = baseLoaded.snapshot;
	const target = targetLoaded.snapshot;
	const inputs = inputsOf(base, target);
	const emitted = emittedDiffsOf(base, target);
	const nodes = nodesOf(base, target);
	const hints = hintsOf$1(base, target, inputs, emitted, nodes);
	return compareOutputOf({
		ok: true,
		runs: [{
			runId: base.runId,
			...base.chain === void 0 ? {} : { chain: base.chain },
			params: jsonObjectOf(base.params),
			status: base.status,
			...base.failedNode === void 0 ? {} : { failedNode: base.failedNode },
			startedAt: base.startedAt
		}, {
			runId: target.runId,
			...target.chain === void 0 ? {} : { chain: target.chain },
			params: jsonObjectOf(target.params),
			status: target.status,
			...target.failedNode === void 0 ? {} : { failedNode: target.failedNode },
			startedAt: target.startedAt
		}],
		inputs,
		nodes,
		emitted,
		summary: {
			nodesChanged: nodes.filter((node) => node.changed).length,
			emittedChanged: emitted.filter((item) => item.changed).length,
			inputsChanged: inputs.filter((input) => input.changed).length,
			...base.failedNode === void 0 ? {} : { baseFailedNode: base.failedNode },
			...target.failedNode === void 0 ? {} : { targetFailedNode: target.failedNode }
		},
		...hints.length === 0 ? {} : { hints }
	});
}
/** run.json 的 params 投影：顶层敏感键打码，嵌套值递归打码。 */
function jsonObjectOf(params) {
	const out = {};
	for (const [key, value] of Object.entries(params)) {
		const encoded = jsonValueOf(isSensitiveKey(key) ? "***" : redactValue(value));
		if (encoded !== void 0) out[key] = encoded;
	}
	return out;
}

//#endregion
//#region src/orchestration/diagnose.ts
function diagnoseOutputOf(value) {
	return JSON.parse(JSON.stringify(value));
}
function plainRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function stringOf(value) {
	return typeof value === "string" ? value : void 0;
}
function numberOrUndefined(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function nodeSummaries(events) {
	const map = /* @__PURE__ */ new Map();
	for (const event of events) {
		if (event.event !== "step" || event.id === void 0) continue;
		const nodeId = event.id;
		const data = plainRecord(event.data);
		const existing = map.get(nodeId) ?? {
			nodeId,
			status: "started"
		};
		if (event.status === "start") {
			map.set(nodeId, {
				...existing,
				status: "started"
			});
			continue;
		}
		if (event.status === "done") {
			const response = plainRecord(data?.["response"]);
			map.set(nodeId, {
				nodeId,
				status: "done",
				...numberOrUndefined(response?.["status"]) === void 0 ? {} : { httpStatus: numberOrUndefined(response?.["status"]) },
				...numberOrUndefined(data?.["attempts"]) === void 0 ? {} : { attempts: numberOrUndefined(data?.["attempts"]) },
				...numberOrUndefined(event.elapsed) === void 0 ? {} : { elapsedMs: numberOrUndefined(event.elapsed) }
			});
			continue;
		}
		if (event.status === "error") {
			const response = plainRecord(data?.["response"]);
			map.set(nodeId, {
				nodeId,
				status: "error",
				...numberOrUndefined(response?.["status"]) === void 0 ? {} : { httpStatus: numberOrUndefined(response?.["status"]) },
				...numberOrUndefined(data?.["attempts"]) === void 0 ? {} : { attempts: numberOrUndefined(data?.["attempts"]) },
				...numberOrUndefined(event.elapsed) === void 0 ? {} : { elapsedMs: numberOrUndefined(event.elapsed) },
				...stringOf(data?.["code"]) === void 0 ? {} : { errorCode: stringOf(data?.["code"]) },
				...event.error === void 0 ? {} : { error: event.error }
			});
		}
	}
	return [...map.values()];
}
function hintsOf(errorCode) {
	if (errorCode === void 0) return [];
	if (errorCode.startsWith("binding-") || errorCode === "empty-wildcard") return ["绑定断点：先 probe 上游节点，核对 outputs 里该路径是否真的存在", "确认 from 路径（[*]/[0]）与上游响应结构一致；必要时重新采集刷新卡模板"];
	if (errorCode === "node-auth-required") return ["鉴权失败：确认 cookie/token 是否注入；过期时用 dataforge_chain_run 的 relogin 换票", "仍失败就重新采集登录态，不要把凭证手写进链"];
	if (errorCode.startsWith("relogin-")) return ["换票失败：检查登录链（site/flow/inputs）与账号权限；修好后用新 run 重跑"];
	if (errorCode === "node-http-error" || errorCode === "node-timeout" || errorCode === "node-network-error") return ["看 response.bodyPreview 与状态码；改入参/补绑定后重跑，不自动重放写请求"];
	if (errorCode === "missing-params" || errorCode === "inputs-invalid") return ["补齐链级 inputs/节点常量；结晶后的链应只有槽位和常量，不应再有裸值"];
	return [];
}
/** 诊断一条链运行（只读）。 */
async function diagnoseForTool(deps, exec, args) {
	const runId = args.runId.trim();
	if (runId === "") return {
		ok: false,
		code: "invalid-run-id",
		message: "runId 不能为空",
		runId
	};
	const record = readRunRecord(deps.dataRoot, runId);
	if (record === void 0) return {
		ok: false,
		code: "run-not-found",
		message: `没有找到运行 ${runId}`,
		runId
	};
	if (record["kind"] !== "chain-run") return {
		ok: false,
		code: "not-a-chain-run",
		message: `运行 ${runId} 不是链运行（kind=${String(record["kind"])}）：诊断只针对 dataforge_chain_run 的留痕`,
		runId
	};
	const events = loadRunEvents(deps.dataRoot, runId);
	if (events === void 0 || events.length === 0) return {
		ok: false,
		code: "run-not-found",
		message: `运行 ${runId} 还没有事件留痕`,
		runId
	};
	const summary = foldSummary(runId, events);
	const chain = summary.chain;
	const chainRecord = plainRecord(record["chain"]);
	const site = chain?.site ?? stringOf(chainRecord?.["site"]) ?? "";
	const flow = chain?.flow ?? stringOf(chainRecord?.["flow"]) ?? "";
	const version = chain?.version ?? numberOrUndefined(chainRecord?.["version"]);
	const failedNode = chain?.failedNode ?? summary.lastStepId;
	const nodes = nodeSummaries(events);
	const failedNodeInfo = nodes.find((node) => node.nodeId === failedNode);
	const errorCode = failedNodeInfo?.errorCode;
	const error = failedNodeInfo?.error ?? summary.lastError;
	const failedStart = events.find((event) => event.event === "step" && event.id === failedNode && event.status === "start");
	const failedEnd = events.find((event) => event.event === "step" && event.id === failedNode && event.status !== "start");
	const startData = plainRecord(failedStart?.data);
	const endData = plainRecord(failedEnd?.data);
	const request = plainRecord(startData?.["request"]);
	const response = plainRecord(endData?.["response"]);
	let edges = [];
	const hints = hintsOf(errorCode);
	if (failedNode !== void 0 && site !== "" && flow !== "" && version !== void 0) {
		const workspaceRoot = await deps.resolveWorkspaceRoot(exec) ?? process.cwd();
		const loaded = loadChain(workspaceRoot, site, flow, { version });
		if (!loaded.ok) hints.push(`链文件不可读（v${version}）：${loaded.message}；只能按事件留痕诊断`);
		else {
			edges = edgesInto(loaded.doc, failedNode, nodes, error);
			if (edges.length === 0) hints.push(`节点 ${failedNode} 没有入边：失败不是绑定造成的，先看请求/响应`);
		}
	}
	return {
		ok: true,
		runId,
		status: summary.status,
		...site === "" ? {} : { chain: {
			site,
			flow,
			version: version ?? 0
		} },
		...plainRecord(record["params"]) === void 0 ? {} : { params: plainRecord(record["params"]) },
		...failedNode === void 0 ? {} : { failedNode },
		...errorCode === void 0 ? {} : { errorCode },
		...error === void 0 ? {} : { error },
		nodes,
		...failedNode === void 0 ? {} : { failed: {
			...typeof failedStart?.action === "string" ? { action: failedStart.action } : {},
			...request === void 0 ? {} : { request },
			...response === void 0 ? {} : { response }
		} },
		edges,
		...hints.length === 0 ? {} : { hints }
	};
}
function edgesInto(doc, failedNode, nodes, error) {
	const statusOf = new Map(nodes.map((node) => [node.nodeId, node.status]));
	const edges = [];
	for (const edge of doc.edges) {
		const to = splitBindingPath(edge.to);
		if (to === void 0 || to.nodeId !== failedNode) continue;
		const sourceNode = splitBindingPath(edge.from)?.nodeId ?? "";
		const sourceStatus = statusOf.get(sourceNode) ?? "unknown";
		const suspect = error !== void 0 && (error.includes(edge.from) || error.includes(`${edge.from} → ${edge.to}`));
		const reason = sourceStatus === "error" ? `上游节点 ${sourceNode} 失败` : suspect ? "错误消息指向这条绑定边" : void 0;
		edges.push({
			from: edge.from,
			to: edge.to,
			sourceNode,
			sourceStatus,
			suspect,
			...reason === void 0 ? {} : { reason }
		});
	}
	return edges;
}

//#endregion
//#region src/trace/analyze.ts
const STATIC_EXT = /\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|txt|xml|mp4|webm|mp3|zip|gz)$/i;
const VOLATILE_QUERY = /^(?:_|_t|ts|timestamp|dp-logid|dp_logid|callback|cb|nonce|sign|signature|token|_sign|rnd|random|request[-_]?id|trace[-_]?id)$/i;
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|api[-_]?key|session/i;
const SUCCESS_KEY = /^(?:code|errno|error|status|success|ok)$/i;
const SUCCESS_VALUES = /* @__PURE__ */ new Set([
	"0",
	"true",
	"success",
	"ok",
	"200"
]);
const POLL_WINDOW_MS = 5e3;
const MAX_LEAVES_PER_BODY = 400;
const MAX_BINDINGS = 300;
const MAX_INPUTS = 80;
const MAX_CONSTANTS = 80;
const MAX_OUTPUTS = 50;
const MAX_ASSERTIONS = 80;
function mask(value) {
	if (value.length <= 8) return `${value.slice(0, 2)}****${value.slice(-2)}`;
	return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
function parseBody(body, contentType) {
	if (body === void 0 || body.trim() === "") return { kind: "empty" };
	const type = contentType.toLowerCase();
	if (type.includes("application/x-www-form-urlencoded") || /^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/.test(body.trim())) try {
		const params = new URLSearchParams(body);
		const out = {};
		for (const [key, value] of params.entries()) out[key] = value;
		return {
			kind: "form",
			value: out
		};
	} catch {}
	if (type.includes("json") || /^[\s]*[\[{]/.test(body)) try {
		return {
			kind: "json",
			value: JSON.parse(body)
		};
	} catch {
		return { kind: "text" };
	}
	return { kind: "text" };
}
function collectLeaves(value, base, out, depth = 0) {
	if (out.length >= MAX_LEAVES_PER_BODY || depth > 8) return;
	if (value === null || value === void 0) return;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		if (typeof value === "string" && value === "") return;
		out.push({
			path: base,
			value
		});
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => collectLeaves(item, `${base}[${index}]`, out, depth + 1));
		return;
	}
	if (typeof value === "object") for (const [key, item] of Object.entries(value)) collectLeaves(item, base === "" ? key : `${base}.${key}`, out, depth + 1);
}
function leavesOfBody(parsed, prefix) {
	const out = [];
	if (parsed.kind === "json" && parsed.value !== void 0) collectLeaves(parsed.value, prefix, out);
	else if (parsed.kind === "form" && parsed.value !== void 0) collectLeaves(parsed.value, prefix, out);
	return out;
}
function leafKeyValue(leaf) {
	return String(leaf.value);
}
function usableLeaf(leaf) {
	if (typeof leaf.value === "boolean") return false;
	const text = String(leaf.value);
	if (text.length < 4 || text.length > 200) return false;
	if (SENSITIVE_KEY.test(leaf.path)) return false;
	return true;
}
function likelyDynamic(value) {
	return /^[0-9a-f]{16,}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || /^\d{10,13}$/.test(value) || /^[A-Za-z0-9+/]{24,}={0,2}$/.test(value);
}
function bodyFingerprint(body) {
	if (body === void 0 || body === "") return "";
	let hash = 0;
	for (let index = 0; index < body.length; index += 1) hash = hash * 31 + body.charCodeAt(index) >>> 0;
	return `${body.length}:${hash.toString(36)}`;
}
function normalizeQuery(query) {
	return Object.keys(query).filter((key) => !VOLATILE_QUERY.test(key)).sort().map((key) => `${key}=${query[key]}`).join("&");
}
function isStatic(sample) {
	if (sample.method !== "GET" && sample.method !== "HEAD") return false;
	return STATIC_EXT.test(sample.path);
}
function leafName(path) {
	const parts = path.split(".");
	const last = (parts[parts.length - 1] ?? path).replace(/\[\d+\]/g, "");
	return last === "" || last === "body" || last === "query" ? "value" : last;
}
function uniqueName(base, used) {
	const clean = base.replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, "_").slice(0, 50) || "input";
	if (!used.has(clean)) {
		used.add(clean);
		return clean;
	}
	let index = 2;
	while (used.has(`${clean}_${index}`)) index += 1;
	const name = `${clean}_${index}`;
	used.add(name);
	return name;
}
/**
* 分析一条 trace；纯函数，不读写磁盘。
*
* @param trace - `readTrace` 的结果。
*/
function analyzeTrace(trace) {
	const warnings = [];
	const nodes = [];
	const mutable = [];
	const skipped = [];
	let staticAssets = 0;
	for (const sample of trace.samples) {
		if (isStatic(sample)) {
			staticAssets += 1;
			skipped.push(sample);
			continue;
		}
		const write = sample.method !== "GET" && sample.method !== "HEAD" && sample.method !== "OPTIONS";
		const key = `${sample.method} ${sample.path}?${normalizeQuery(sample.query)}${write ? `#${bodyFingerprint(sample.requestBody)}` : ""}`;
		const previous = mutable[mutable.length - 1];
		if (previous !== void 0 && previous.key === key && sample.ts - previous.lastTs <= POLL_WINDOW_MS) {
			previous.sampleIds.push(sample.id);
			previous.lastTs = sample.ts;
			previous.ts = sample.ts;
			if (sample.responseBody !== void 0) previous.responseBody = sample.responseBody;
			if (sample.requestBody !== void 0 && previous.requestBody === void 0) previous.requestBody = sample.requestBody;
			if (sample.cardId !== void 0) previous.cardId = sample.cardId;
			if (sample.mergeKey !== void 0) previous.mergeKey = sample.mergeKey;
			if (sample.status !== void 0) previous.status = sample.status;
			continue;
		}
		mutable.push({
			key,
			method: sample.method,
			path: sample.path,
			url: sample.url,
			...sample.pageUrl === void 0 ? {} : { pageUrl: sample.pageUrl },
			...sample.status === void 0 ? {} : { status: sample.status },
			ts: sample.ts,
			lastTs: sample.ts,
			sampleIds: [sample.id],
			...sample.requestBody === void 0 ? {} : { requestBody: sample.requestBody },
			...sample.responseBody === void 0 ? {} : { responseBody: sample.responseBody },
			...sample.cardId === void 0 ? {} : { cardId: sample.cardId },
			...sample.mergeKey === void 0 ? {} : { mergeKey: sample.mergeKey }
		});
	}
	mutable.forEach((node, index) => {
		const id = `n${index + 1}`;
		nodes.push({
			id,
			method: node.method,
			url: node.url,
			path: node.path,
			...node.pageUrl === void 0 ? {} : { pageUrl: node.pageUrl },
			...node.status === void 0 ? {} : { status: node.status },
			ts: node.ts,
			write: node.method !== "GET" && node.method !== "HEAD" && node.method !== "OPTIONS",
			polling: node.sampleIds.length > 1,
			occurrences: node.sampleIds.length,
			sampleIds: node.sampleIds,
			...node.requestBody === void 0 ? {} : { requestBody: node.requestBody },
			...node.responseBody === void 0 ? {} : { responseBody: node.responseBody },
			...node.cardId === void 0 ? {} : { cardId: node.cardId },
			...node.mergeKey === void 0 ? {} : { mergeKey: node.mergeKey }
		});
		if (node.sampleIds.length > 1) warnings.push({
			code: "polling-merged",
			message: `${node.method} ${node.path} 连续调用 ${node.sampleIds.length} 次，已合并为一个节点（polling）；回放需配置重试/轮询。`
		});
	});
	const nodeLeaves = /* @__PURE__ */ new Map();
	for (let index = 0; index < mutable.length; index += 1) {
		const node = mutable[index];
		const id = `n${index + 1}`;
		const requestBody = parseBody(node.requestBody, "");
		const responseBody = parseBody(node.responseBody, "");
		const requestLeaves = leavesOfBody(requestBody, "body");
		const responseLeaves = leavesOfBody(responseBody, "body");
		nodeLeaves.set(id, {
			request: requestLeaves,
			response: responseLeaves
		});
		if (node.requestBody !== void 0 && requestBody.kind === "text") warnings.push({
			code: "request-body-unparsed",
			message: `${node.method} ${node.path} 的请求正文不是 JSON/表单，字段流转无法推断。`
		});
		if (node.responseBody !== void 0 && responseBody.kind === "text") warnings.push({
			code: "response-body-unparsed",
			message: `${node.method} ${node.path} 的响应正文不是 JSON，字段流转无法推断。`
		});
	}
	for (let index = 0; index < mutable.length; index += 1) {
		const node = mutable[index];
		const id = `n${index + 1}`;
		const leaves = nodeLeaves.get(id);
		if (leaves === void 0) continue;
		const sample = trace.samples.find((item) => item.id === node.sampleIds[0]);
		if (sample === void 0) continue;
		for (const [key, value] of Object.entries(sample.query)) if (value !== "" && !VOLATILE_QUERY.test(key)) leaves.request.push({
			path: `query.${key}`,
			value
		});
	}
	const bindings = [];
	const boundTo = /* @__PURE__ */ new Set();
	const responseIndex = /* @__PURE__ */ new Map();
	for (let index = 0; index < mutable.length; index += 1) {
		mutable[index];
		const id = `n${index + 1}`;
		const leaves = nodeLeaves.get(id);
		if (leaves === void 0) continue;
		for (const leaf of leaves.request) {
			if (!usableLeaf(leaf)) continue;
			const value = leafKeyValue(leaf);
			const toKey = `${id}.${leaf.path}`;
			if (boundTo.has(toKey)) continue;
			const matches = responseIndex.get(value);
			if (matches === void 0 || matches.length === 0) continue;
			const chosen = matches[matches.length - 1];
			const confidence = matches.length === 1 ? .9 : .65;
			bindings.push({
				from: {
					nodeId: chosen.nodeId,
					path: chosen.path
				},
				to: {
					nodeId: id,
					path: leaf.path
				},
				valuePreview: mask(value),
				confidence,
				reason: matches.length === 1 ? "值在之前响应中唯一出现（精确匹配）" : `值在之前 ${matches.length} 个响应中出现，取最近一个（精确匹配）`
			});
			boundTo.add(toKey);
			if (confidence < .7) warnings.push({
				code: "low-confidence-binding",
				message: `${chosen.nodeId}.${chosen.path} → ${id}.${leaf.path} 置信度 ${confidence}：值在多个响应中出现，需 agent 确认来源。`
			});
			if (bindings.length >= MAX_BINDINGS) break;
		}
		for (const leaf of leaves.response) {
			if (!usableLeaf(leaf)) continue;
			const list = responseIndex.get(leafKeyValue(leaf)) ?? [];
			list.push({
				nodeId: id,
				path: leaf.path
			});
			responseIndex.set(leafKeyValue(leaf), list);
		}
	}
	const inputMap = /* @__PURE__ */ new Map();
	for (let index = 0; index < mutable.length; index += 1) {
		mutable[index];
		const id = `n${index + 1}`;
		const leaves = nodeLeaves.get(id);
		if (leaves === void 0) continue;
		for (const leaf of leaves.request) {
			if (!usableLeaf(leaf)) continue;
			if (boundTo.has(`${id}.${leaf.path}`)) continue;
			const value = leafKeyValue(leaf);
			const existing = inputMap.get(leaf.path);
			if (existing === void 0) inputMap.set(leaf.path, {
				path: leaf.path,
				nodeIds: /* @__PURE__ */ new Set([id]),
				values: /* @__PURE__ */ new Set([value]),
				example: value
			});
			else {
				existing.nodeIds.add(id);
				existing.values.add(value);
			}
		}
	}
	const inputs = [];
	const constants = [];
	const usedNames = /* @__PURE__ */ new Set();
	let inputIndex = 0;
	for (const item of inputMap.values()) {
		if (inputs.length >= MAX_INPUTS) break;
		if ([...item.values].some((value) => likelyDynamic(value))) {
			warnings.push({
				code: "unresolved-dynamic",
				message: `${item.path} 的值像动态 ID/时间戳/编码，未作为输入（需 agent 确认派生来源）。`
			});
			continue;
		}
		if (item.values.size === 1 && item.nodeIds.size > 1) {
			if (constants.length < MAX_CONSTANTS) constants.push({
				path: item.path,
				valuePreview: mask(item.example),
				nodeIds: [...item.nodeIds]
			});
			continue;
		}
		const type = typeof [...item.values][0] === "number" ? "number" : "string";
		const base = leafName(item.path);
		const name = uniqueName(base === "value" ? `input_${inputIndex + 1}` : base, usedNames);
		inputIndex += 1;
		inputs.push({
			name,
			path: item.path,
			nodeId: [...item.nodeIds][0],
			nodeIds: [...item.nodeIds],
			type,
			examplePreview: mask(item.example),
			required: item.nodeIds.size <= 1,
			confidence: item.values.size > 1 ? .8 : .55,
			reason: item.values.size > 1 ? "同一路径在不同节点取值不同，像业务入参" : "未在前序响应中找到来源"
		});
	}
	const lastNode = nodes[nodes.length - 1];
	const outputs = [];
	if (lastNode !== void 0) {
		const leaves = nodeLeaves.get(lastNode.id)?.response ?? [];
		const usedOutputs = /* @__PURE__ */ new Set();
		for (const leaf of leaves) {
			if (outputs.length >= MAX_OUTPUTS) break;
			if (SENSITIVE_KEY.test(leaf.path)) continue;
			const name = uniqueName(leafName(leaf.path), usedOutputs);
			outputs.push({
				name,
				path: leaf.path,
				nodeId: lastNode.id,
				type: typeof leaf.value === "number" ? "number" : typeof leaf.value === "boolean" ? "boolean" : "string",
				examplePreview: mask(String(leaf.value))
			});
		}
	}
	const assertions = [];
	for (const node of nodes) {
		if (node.status !== void 0) assertions.push({
			nodeId: node.id,
			path: "status",
			equals: String(node.status),
			confidence: .9,
			reason: "录制时 HTTP 状态码"
		});
		const leaves = nodeLeaves.get(node.id)?.response ?? [];
		for (const leaf of leaves) {
			if (assertions.length >= MAX_ASSERTIONS) break;
			if (!SUCCESS_KEY.test(leafName(leaf.path))) continue;
			const value = String(leaf.value);
			if (!SUCCESS_VALUES.has(value.toLowerCase())) continue;
			if (assertions.some((item) => item.nodeId === node.id && item.path === leaf.path)) continue;
			assertions.push({
				nodeId: node.id,
				path: leaf.path,
				equals: value,
				confidence: .7,
				reason: "响应中的成功标记字段（通用键名启发）"
			});
		}
	}
	const candidateLeaves = [...nodeLeaves.values()].reduce((sum, item) => sum + item.request.length, 0);
	const boundLeaves = bindings.length;
	const analyzedSamples = trace.samples.length - skipped.length;
	const stats = {
		totalSamples: trace.stats.totalSamples,
		analyzedSamples,
		skippedSamples: skipped.length,
		nodes: nodes.length,
		writes: nodes.filter((node) => node.write).length,
		pages: new Set(nodes.map((node) => node.pageUrl).filter((page) => page !== void 0)).size,
		truncatedBodies: trace.stats.truncatedBodies,
		staticAssets
	};
	if (nodes.length === 0) warnings.push({
		code: "no-business-calls",
		message: "没有可分析的业务调用（全部被识别为静态资源或空 trace）。"
	});
	if (bindings.length === 0 && nodes.length > 1) warnings.push({
		code: "no-bindings",
		message: "没有推断出字段流转：可能是正文加密/截断，或接口之间没有值传递。"
	});
	return {
		captureId: trace.captureId,
		entryUrl: trace.entryUrl,
		stats,
		nodes,
		bindings,
		inputs,
		constants,
		outputs,
		assertions,
		coverage: {
			candidateLeaves,
			boundLeaves,
			bindingCoverage: candidateLeaves === 0 ? 0 : Number((boundLeaves / candidateLeaves).toFixed(3)),
			callCoverage: trace.samples.length === 0 ? 0 : Number((analyzedSamples / trace.samples.length).toFixed(3))
		},
		warnings: warnings.slice(0, 100)
	};
}

//#endregion
//#region src/trace/draft.ts
/**
* S3：TraceAnalysis → interface-chain 草稿。
*
* 只做“草稿”：不落正式版本、不执行、不碰目标系统。
* 业务值不写死：未绑定的请求字段变成链级 input（`$inputs.<name>`），由 agent/用户填写；
* 绑定边来自 S2 推断；卡片必须已在项目接口库，否则该节点跳过并 warning。
*
* @module dsh-dataforge/trace/draft
*/
function hostOf$2(url) {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}
function safeFlow(captureId) {
	return `trace-${captureId.replace(/[^A-Za-z0-9_-]/g, "-").slice(-24)}`;
}
function safeName(raw, used, fallback) {
	const clean = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 50);
	const base = clean === "" ? fallback : clean;
	if (!used.has(base)) {
		used.add(base);
		return base;
	}
	let index = 2;
	while (used.has(`${base}_${index}`)) index += 1;
	used.add(`${base}_${index}`);
	return `${base}_${index}`;
}
function warn(warnings, code, message, nodeId, path) {
	warnings.push({
		code,
		message,
		...nodeId === void 0 ? {} : { nodeId },
		...path === void 0 ? {} : { path }
	});
}
function inputTypeOf(input) {
	return input.type === "number" ? "number" : input.type === "boolean" ? "boolean" : "string";
}
function expectsOf(analysis, nodeId) {
	return analysis.assertions.filter((item) => item.nodeId === nodeId && item.path !== "status" && item.path.startsWith("body.")).map((item) => ({
		path: item.path,
		equals: item.equals
	}));
}
/**
* 由分析结果 + 项目接口库生成草稿。
*
* @param analysis - S2 结果。
* @param cards - 当前工作区接口库卡片。
* @param options - site/flow/domain/note；缺省 site=entryUrl host、flow=trace-<captureId>。
*/
function buildChainDraft(analysis, cards, options = {}) {
	if (cards.length === 0) return {
		ok: false,
		code: "no-cards",
		error: "项目接口库为空：先 dataforge_library_import 导入采集卡，再生成链草稿",
		hints: ["接口库在 <workspace>/.dsh/dataforge/library，不读取目标系统数据库"]
	};
	const byMergeKey = /* @__PURE__ */ new Map();
	for (const card of cards) byMergeKey.set(card.identity.mergeKey, card);
	const byCardId = /* @__PURE__ */ new Map();
	for (const card of cards) byCardId.set(card.cardId, card);
	const resolveCard = (cardId) => byCardId.get(cardId);
	const warnings = [];
	const nodeByTraceId = /* @__PURE__ */ new Map();
	const cardByTraceId = /* @__PURE__ */ new Map();
	for (const node of analysis.nodes) {
		const mergeKey = node.mergeKey;
		const card = mergeKey === void 0 ? void 0 : byMergeKey.get(mergeKey);
		if (card === void 0) {
			warn(warnings, "card-not-imported", `${node.method} ${node.path} 没有匹配的接口库卡；该节点未进入草稿（先导入采集卡，或让 agent 补卡）`, node.id);
			continue;
		}
		const chainNode = {
			id: node.id,
			card: card.cardId,
			constants: {}
		};
		const expects = expectsOf(analysis, node.id);
		if (expects.length === 1) chainNode.expect = expects[0];
		else if (expects.length > 1) chainNode.expects = expects;
		nodeByTraceId.set(node.id, chainNode);
		cardByTraceId.set(node.id, card);
	}
	if (nodeByTraceId.size === 0) return {
		ok: false,
		code: "no-nodes",
		error: "trace 里没有任何节点能匹配到接口库卡，无法生成链草稿",
		hints: ["先把该 capture 的接口卡导入接口库（dataforge_library_import），再重试"]
	};
	const usedInputNames = /* @__PURE__ */ new Set();
	const inputs = [];
	const inputByPath = /* @__PURE__ */ new Map();
	for (const input of analysis.inputs) {
		const chainInput = {
			name: safeName(input.name, usedInputNames, "input"),
			type: inputTypeOf(input),
			required: input.required
		};
		inputs.push(chainInput);
		inputByPath.set(input.path, chainInput);
	}
	for (const input of analysis.inputs) {
		const chainInput = inputByPath.get(input.path);
		if (chainInput === void 0) continue;
		for (const nodeId of input.nodeIds) {
			const card = cardByTraceId.get(nodeId);
			const node = nodeByTraceId.get(nodeId);
			if (card === void 0 || node === void 0) continue;
			if (!isFieldDeclared(input.path, card.inputs)) {
				warn(warnings, "input-not-in-card", `${nodeId}.${input.path} 不在卡 ${card.cardId} 的入参模板里；未写入常量`, nodeId, input.path);
				continue;
			}
			const key = findDeclaredField(input.path, card.inputs)?.path ?? input.path;
			node.constants[key] = `$inputs.${chainInput.name}`;
		}
	}
	const referenced = /* @__PURE__ */ new Set();
	for (const node of nodeByTraceId.values()) for (const value of Object.values(node.constants)) {
		const match = /^\$inputs\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
		if (match !== null) referenced.add(match[1]);
	}
	const filteredInputs = inputs.filter((input) => {
		if (referenced.has(input.name)) return true;
		warn(warnings, "unreferenced-input", `输入 ${input.name} 在卡入参里找不到落点，已从草稿移除`, void 0, input.name);
		return false;
	});
	const edges = [];
	for (const binding of analysis.bindings) {
		const fromNode = nodeByTraceId.get(binding.from.nodeId);
		const toNode = nodeByTraceId.get(binding.to.nodeId);
		const fromCard = cardByTraceId.get(binding.from.nodeId);
		const toCard = cardByTraceId.get(binding.to.nodeId);
		if (fromNode === void 0 || toNode === void 0 || fromCard === void 0 || toCard === void 0) continue;
		if (!isFieldDeclared(binding.from.path, fromCard.outputs)) {
			warn(warnings, "binding-source-not-in-card", `${binding.from.nodeId}.${binding.from.path} 不在卡 ${fromCard.cardId} 的出参模板里；跳过该边`, binding.from.nodeId, binding.from.path);
			continue;
		}
		if (!isFieldDeclared(binding.to.path, toCard.inputs)) {
			warn(warnings, "binding-target-not-in-card", `${binding.to.nodeId}.${binding.to.path} 不在卡 ${toCard.cardId} 的入参模板里；跳过该边`, binding.to.nodeId, binding.to.path);
			continue;
		}
		edges.push({
			from: `${binding.from.nodeId}.${binding.from.path}`,
			to: `${binding.to.nodeId}.${binding.to.path}`
		});
	}
	for (const [traceId, card] of cardByTraceId) {
		const node = nodeByTraceId.get(traceId);
		if (node === void 0) continue;
		const covered = new Set(Object.keys(node.constants));
		for (const edge of edges) if (edge.to.startsWith(`${traceId}.`)) covered.add(edge.to.slice(traceId.length + 1));
		for (const field of card.inputs) {
			if (field.required !== true) continue;
			if ([...covered].some((path) => isFieldDeclared(path, [field]))) continue;
			warn(warnings, "missing-required-input", `${traceId}.${field.path} 是必填入参，但 trace 里没有值/绑定；草稿会缺参`, traceId, field.path);
		}
	}
	const site = (options.site ?? "").trim() || hostOf$2(analysis.entryUrl) || "unknown-site";
	const flow = (options.flow ?? "").trim() || safeFlow(analysis.captureId);
	const chain = {
		apiVersion: CHAIN_API_VERSION,
		kind: "interface-chain",
		meta: {
			site,
			flow,
			version: 1,
			created: (/* @__PURE__ */ new Date()).toISOString(),
			source: "agent",
			...options.domain === void 0 || options.domain.trim() === "" ? {} : { domain: options.domain.trim() },
			...options.note === void 0 || options.note.trim() === "" ? {} : { note: options.note.trim() }
		},
		inputs: filteredInputs,
		nodes: [...nodeByTraceId.values()],
		edges
	};
	const validation = validateChain(chain, { resolveCard });
	const validationOk = validation.ok;
	if (!validationOk) for (const issue of validation.issues) warn(warnings, issue.code, `${issue.target}：${issue.reason}`);
	const finalChain = validationOk ? validation.doc : chain;
	return {
		ok: true,
		site,
		flow,
		...chain.meta.domain === void 0 ? {} : { domain: chain.meta.domain },
		chain: finalChain,
		yaml: chainToYaml(finalChain),
		warnings,
		validation: validationOk ? {
			ok: true,
			issues: []
		} : {
			ok: false,
			issues: validation.issues
		},
		outputs: analysis.outputs,
		coverage: analysis.coverage
	};
}

//#endregion
//#region src/trace/read.ts
/**
* 从采集库只读读取一条 capture 的 trace。
*
* 只读纪律与接口库导入一致：`readonly: true, fileMustExist: true`，不建表、不写事件。
* 正文读取顺序：落盘文件（完整）→ DB 预览（最多 512 字符）→ 缺失；截断必须如实标注。
*
* @module dsh-dataforge/trace/read
*/
const SENSITIVE_HEADER = /authorization|proxy-authorization|cookie|set-cookie|token|secret|password|api[-_]?key|session/i;
const SENSITIVE_BODY_KEY = /authorization|cookie|token|secret|password|api[-_]?key|session/i;
const PREVIEW_CAP = 512;
function clamp(value, min, max, fallback) {
	if (value === void 0 || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.floor(value), min), max);
}
function failure$1(code, error, hints) {
	return {
		ok: false,
		code,
		error,
		...hints === void 0 ? {} : { hints }
	};
}
function parseHeaders(raw) {
	const values = {};
	const sensitive = [];
	if (typeof raw !== "string" || raw === "") return {
		values,
		sensitive
	};
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			values,
			sensitive
		};
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {
		values,
		sensitive
	};
	for (const [name, value] of Object.entries(parsed)) {
		if (SENSITIVE_HEADER.test(name)) {
			sensitive.push(name);
			continue;
		}
		if (typeof value === "string") values[name] = value;
	}
	sensitive.sort();
	return {
		values,
		sensitive
	};
}
function redactJson(value, depth = 0) {
	if (depth > 8) return "[depth]";
	if (Array.isArray(value)) return value.map((item) => redactJson(item, depth + 1));
	if (value !== null && typeof value === "object") {
		const out = {};
		for (const [key, item] of Object.entries(value)) out[key] = SENSITIVE_BODY_KEY.test(key) ? "[redacted]" : redactJson(item, depth + 1);
		return out;
	}
	return value;
}
/** 工具回执用的正文脱敏：JSON 递归按敏感键替换；表单按参数名替换；其它原样截断。 */
function redactBodyForDisplay(body) {
	if (body === void 0) return void 0;
	const trimmed = body.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) try {
		return JSON.stringify(redactJson(JSON.parse(trimmed)));
	} catch {
		return body;
	}
	if (/^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/.test(trimmed)) try {
		const params = new URLSearchParams(trimmed);
		const out = new URLSearchParams();
		for (const [key, value] of params.entries()) out.append(key, SENSITIVE_BODY_KEY.test(key) ? "[redacted]" : value);
		return out.toString();
	} catch {
		return body;
	}
	return body;
}
function safeReadFile(root, relPath) {
	try {
		const rootAbs = resolve(root);
		const abs = resolve(rootAbs, relPath);
		if (abs !== rootAbs && !abs.startsWith(`${rootAbs}${sep}`)) return void 0;
		if (!existsSync(abs)) return void 0;
		return readFileSync(abs);
	} catch {
		return;
	}
}
function readBody$3(samplesDir, bodyPath, preview, cap, rawTruncated) {
	if (bodyPath !== void 0 && bodyPath !== "") {
		const buffer = safeReadFile(samplesDir, bodyPath);
		if (buffer !== void 0) {
			const truncated = buffer.byteLength > cap;
			return {
				body: truncated ? buffer.subarray(0, cap).toString("utf8") : buffer.toString("utf8"),
				source: "file",
				truncated
			};
		}
	}
	if (preview !== void 0 && preview !== "") return {
		body: preview.slice(0, cap),
		source: "preview",
		truncated: preview.length >= PREVIEW_CAP || rawTruncated
	};
	return {
		source: "none",
		truncated: rawTruncated
	};
}
function parseUrl(url) {
	try {
		const parsed = new URL(url);
		const query = {};
		for (const [key, value] of parsed.searchParams.entries()) query[key] = value;
		return {
			path: parsed.pathname,
			query
		};
	} catch {
		return {
			path: url,
			query: {}
		};
	}
}
/**
* 读一条 capture 的 trace；失败返回结构化 code（不抛业务错）。
*
* @param deps - 采集库路径 + 落盘正文根。
* @param captureId - 采集 run id。
* @param options - limit/bodyLimit/redactBodies/includeBodies。
*/
function readTrace(deps, captureId, options = {}) {
	const id = typeof captureId === "string" ? captureId.trim() : "";
	if (id === "" || id.length > 200 || /[\\/]/.test(id)) return failure$1("bad-capture-id", "capture_id 非法：需要采集 run id（不含路径分隔符）", ["先用 dataforge_capture_status 或面板确认 captureId"]);
	if (!existsSync(deps.captureDbPath)) return failure$1("capture-not-found", `采集库不存在：${deps.captureDbPath}`, ["先跑一次采集，再生成 trace"]);
	const limit = clamp(options.limit, 1, 2e3, 200);
	const bodyLimit = clamp(options.bodyLimit, 256, 65536, 8192);
	let db;
	try {
		db = new Database(deps.captureDbPath, {
			readonly: true,
			fileMustExist: true
		});
	} catch (error) {
		return failure$1("capture-unreadable", `采集库打不开（只读）：${error.message}`, ["确认采集库没有被独占写入；或先关闭正在跑的采集"]);
	}
	try {
		const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
		if (!tables.has("capture_runs") || !tables.has("request_samples")) return failure$1("capture-empty", "采集库里还没有 capture_runs/request_samples：没有可读的 trace", ["先跑一次采集"]);
		const run = db.prepare("SELECT id,entry_url,status FROM capture_runs WHERE id=?").get(id);
		const countRow = db.prepare("SELECT COUNT(*) AS n FROM request_samples WHERE capture_id=?").get(id);
		const totalSamples = Number(countRow.n);
		if (run === void 0 && totalSamples === 0) return failure$1("capture-not-found", `没有这个 capture：${id}`, ["先用 dataforge_capture_status 列最近采集，确认 id"]);
		if (totalSamples === 0) return failure$1("capture-empty", `capture ${id} 还没有请求样本`, ["确认采集已完成且页面确实产生了 XHR/fetch；或重采一条"]);
		const relations = /* @__PURE__ */ new Map();
		if (tables.has("page_card_relations")) {
			const relRows = db.prepare("SELECT id,card_id FROM page_card_relations WHERE capture_id=?").all(id);
			const cards = /* @__PURE__ */ new Map();
			if (tables.has("interface_cards")) {
				const cardRows = db.prepare("SELECT id,merge_key FROM interface_cards WHERE capture_id=?").all(id);
				for (const card of cardRows) cards.set(card.id, card.merge_key === null ? {} : { mergeKey: card.merge_key });
			}
			for (const rel of relRows) {
				const card = cards.get(rel.card_id);
				relations.set(rel.id, {
					cardId: rel.card_id,
					...card?.mergeKey === void 0 ? {} : { mergeKey: card.mergeKey }
				});
			}
		}
		const rows = db.prepare(`SELECT id,page_url,ts,seq,url,method,status,request_headers_json,request_body_path,request_body_preview,
                response_headers_json,response_body_path,response_preview,truncated,relation_id
           FROM request_samples WHERE capture_id=? ORDER BY seq ASC, ts ASC LIMIT ?`).all(id, limit);
		const includeBodies = options.includeBodies !== false;
		const redactBodies = options.redactBodies === true;
		const warnings = [];
		const interfaces = /* @__PURE__ */ new Set();
		const pages = /* @__PURE__ */ new Set();
		let writes = 0;
		let truncatedBodies = 0;
		const samples = rows.map((row) => {
			const method = String(row.method || "GET").toUpperCase();
			const url = String(row.url || "");
			const parsed = parseUrl(url);
			const request = readBody$3(deps.samplesDir, row.request_body_path ?? void 0, row.request_body_preview ?? void 0, bodyLimit, row.truncated === 1);
			const response = readBody$3(deps.samplesDir, row.response_body_path ?? void 0, row.response_preview ?? void 0, bodyLimit, row.truncated === 1);
			if (request.truncated || response.truncated) truncatedBodies += 1;
			if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") writes += 1;
			interfaces.add(`${method} ${parsed.path}`);
			const pageUrl = typeof row.page_url === "string" && row.page_url !== "" ? row.page_url : void 0;
			if (pageUrl !== void 0) pages.add(pageUrl);
			const relation = row.relation_id === null ? void 0 : relations.get(row.relation_id);
			const requestBody = includeBodies && request.body !== void 0 ? redactBodies ? redactBodyForDisplay(request.body) : request.body : void 0;
			const responseBody = includeBodies && response.body !== void 0 ? redactBodies ? redactBodyForDisplay(response.body) : response.body : void 0;
			return {
				id: String(row.id),
				seq: Number(row.seq),
				ts: Number(row.ts),
				method,
				url,
				path: parsed.path,
				query: parsed.query,
				...row.status === null ? {} : { status: Number(row.status) },
				...pageUrl === void 0 ? {} : { pageUrl },
				requestHeaders: parseHeaders(row.request_headers_json),
				...requestBody === void 0 ? {} : { requestBody },
				requestBodySource: includeBodies ? request.source : "none",
				requestBodyTruncated: includeBodies ? request.truncated : false,
				responseHeaders: parseHeaders(row.response_headers_json),
				...responseBody === void 0 ? {} : { responseBody },
				responseBodySource: includeBodies ? response.source : "none",
				responseBodyTruncated: includeBodies ? response.truncated : false,
				truncated: row.truncated === 1,
				...relation === void 0 ? {} : { cardId: relation.cardId },
				...relation?.mergeKey === void 0 ? {} : { mergeKey: relation.mergeKey }
			};
		});
		if (rows.length < totalSamples) warnings.push({
			code: "trace-limit",
			message: `只返回了前 ${rows.length} / ${totalSamples} 条样本（limit=${limit}）；分析全文时提高 limit。`
		});
		if (truncatedBodies > 0) warnings.push({
			code: "body-truncated",
			message: `${truncatedBodies} 条样本的正文被截断/只有预览；字段流转推断可能漏字段。`
		});
		const stats = {
			totalSamples,
			returnedSamples: samples.length,
			interfaces: interfaces.size,
			writes,
			pages: pages.size,
			truncatedBodies
		};
		return {
			captureId: id,
			entryUrl: run?.entry_url ?? "",
			...run === void 0 ? {} : { status: run.status },
			samples,
			stats,
			warnings
		};
	} finally {
		db.close();
	}
}

//#endregion
//#region src/trace/application.ts
/**
* Trace 工具应用层：读 trace / 分析 trace。
*
* 与工具壳分离：这里只做参数收口、只读读取、分析结果合并与错误返回；
* 工具壳负责 schema 与模型可见的渲染。
*
* @module dsh-dataforge/trace/application
*/
function traceGetForTool(deps, args) {
	const trace = readTrace(deps, args.capture_id, {
		...args.limit === void 0 ? {} : { limit: args.limit },
		...args.body_limit === void 0 ? {} : { bodyLimit: args.body_limit },
		redactBodies: true,
		includeBodies: true
	});
	if ("ok" in trace) return trace;
	return {
		ok: true,
		captureId: trace.captureId,
		entryUrl: trace.entryUrl,
		...trace.status === void 0 ? {} : { status: trace.status },
		stats: trace.stats,
		samples: trace.samples,
		warnings: trace.warnings
	};
}
async function chainDraftForTool(deps, exec, args) {
	const trace = readTrace(deps, args.capture_id, {
		limit: args.limit ?? 1e3,
		bodyLimit: 65536,
		redactBodies: false,
		includeBodies: true
	});
	if ("ok" in trace) return trace;
	const workspaceRoot = await deps.resolveWorkspaceRoot(exec);
	if (workspaceRoot === void 0) return {
		ok: false,
		code: "no-workspace",
		error: "无法解析工作区根：接口库/链文件都按工作区落盘"
	};
	const analysis = analyzeTrace(trace);
	const cards = listCards(workspaceRoot);
	const built = buildChainDraft(analysis, cards, {
		...args.site === void 0 ? {} : { site: args.site },
		...args.flow === void 0 ? {} : { flow: args.flow },
		...args.domain === void 0 ? {} : { domain: args.domain },
		...args.note === void 0 ? {} : { note: args.note }
	});
	if (built.ok !== true) return built;
	return {
		ok: true,
		captureId: trace.captureId,
		site: built.site,
		flow: built.flow,
		...built.domain === void 0 ? {} : { domain: built.domain },
		yaml: built.yaml,
		chain: built.chain,
		warnings: [...trace.warnings.map((warning) => ({
			code: warning.code,
			message: warning.message
		})), ...built.warnings],
		validation: built.validation,
		outputs: built.outputs,
		coverage: built.coverage
	};
}
function traceAnalyzeForTool(deps, args) {
	const trace = readTrace(deps, args.capture_id, {
		limit: args.limit ?? 1e3,
		bodyLimit: 65536,
		redactBodies: false,
		includeBodies: true
	});
	if ("ok" in trace) return trace;
	const analysis = analyzeTrace(trace);
	return {
		ok: true,
		captureId: trace.captureId,
		entryUrl: trace.entryUrl,
		analysis: {
			...analysis,
			warnings: [...trace.warnings, ...analysis.warnings].slice(0, 100)
		}
	};
}

//#endregion
//#region src/lookup/lookup.ts
/**
* 运行时 lookup：业务值从接口（或后续页面）获取，带缓存与来源。
*
* 解决的是“生态链 → stockOrg/purchaseOrg”这类映射不能写死的问题：
*   - YAML 只声明**怎么查**（源、路径、匹配字段、映射字段），不存业务值；
*   - 运行时 fetch 接口 → 缓存 items → 按 query 匹配 → 返回值 + source/fetchedAt；
*   - 代码里不出现任何业务名称/编码。
*
* 本期只实现 `source.kind: api`（GET/HEAD）；page 来源明确返回 unavailable，
* 不伪造页面读取成功（后续 S5 可接 UiBrowserEngine / 无头页面读取）。
*
* @module dsh-dataforge/lookup/lookup
*/
function failure(code, error, hints) {
	return {
		ok: false,
		code,
		error,
		...hints === void 0 ? {} : { hints }
	};
}
function optionalString(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function expandEnv(text) {
	return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
		const value = process.env[name];
		if (value === void 0) throw new Error(`lookup 配置引用的环境变量不存在：${name}`);
		return value;
	});
}
/** 极简 JSON 路径：`$.a.b[0].c` / `a.b`；不支持通配，lookup 只需要标量/数组。 */
function getByPath(value, path) {
	const trimmed = path.trim();
	if (trimmed === "" || trimmed === "$" || trimmed === ".") return value;
	const normalized = trimmed.replace(/^\$?\.?/, "");
	const tokens = [];
	for (const part of normalized.split(".")) {
		const matches = [...part.matchAll(/([^[\]]+)|\[(\d+)\]/g)];
		for (const match of matches) if (match[1] !== void 0 && match[1] !== "") tokens.push(match[1]);
		else if (match[2] !== void 0) tokens.push(Number(match[2]));
	}
	let current = value;
	for (const token of tokens) if (typeof token === "number") {
		if (!Array.isArray(current) || token < 0 || token >= current.length) return void 0;
		current = current[token];
	} else {
		if (current === null || typeof current !== "object" || Array.isArray(current)) return void 0;
		current = current[token];
	}
	return current;
}
function parseConfig(raw, name) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("lookup yaml 必须是映射");
	const doc = raw;
	if (doc["kind"] !== void 0 && doc["kind"] !== "data-lookup") throw new Error(`kind 必须是 data-lookup（收到 ${String(doc["kind"])}）`);
	const source = doc["source"];
	if (source === null || typeof source !== "object" || Array.isArray(source)) throw new Error("source 必须是映射");
	const s = source;
	const kind = s["kind"];
	if (kind !== "api" && kind !== "page") throw new Error("source.kind 必须是 api 或 page");
	const mapRaw = s["map"];
	if (mapRaw === null || typeof mapRaw !== "object" || Array.isArray(mapRaw)) throw new Error("source.map 必须是字段映射");
	const map = {};
	for (const [key, value] of Object.entries(mapRaw)) {
		if (typeof value !== "string" || value.trim() === "") throw new Error(`source.map.${key} 必须是 JSON 路径`);
		map[key] = value.trim();
	}
	if (Object.keys(map).length === 0) throw new Error("source.map 不能为空");
	const site = optionalString(doc["site"]);
	const cacheRaw = doc["cache"];
	const ttl = cacheRaw !== null && typeof cacheRaw === "object" && !Array.isArray(cacheRaw) ? Number(cacheRaw["ttlSeconds"]) : void 0;
	const common = {
		kind: "data-lookup",
		name: optionalString(doc["name"]) ?? name,
		...site === void 0 ? {} : { site },
		cache: ttl !== void 0 && Number.isFinite(ttl) && ttl >= 0 ? { ttlSeconds: Math.floor(ttl) } : { ttlSeconds: 86400 }
	};
	if (kind === "api") {
		const matchRaw = s["match"];
		const match = Array.isArray(matchRaw) ? matchRaw.filter((item) => typeof item === "string" && item.trim() !== "") : typeof matchRaw === "string" && matchRaw.trim() !== "" ? [matchRaw.trim()] : [];
		if (match.length === 0) throw new Error("api lookup 的 source.match 至少给一个字段路径");
		return {
			...common,
			source: {
				kind: "api",
				...optionalString(s["baseUrl"]) === void 0 ? {} : { baseUrl: expandEnv(String(s["baseUrl"])) },
				path: optionalString(s["path"]) ?? (() => {
					throw new Error("api lookup 缺 source.path");
				})(),
				method: s["method"] === "HEAD" ? "HEAD" : "GET",
				...s["query"] !== null && typeof s["query"] === "object" && !Array.isArray(s["query"]) ? { query: Object.fromEntries(Object.entries(s["query"]).filter((entry) => typeof entry[1] === "string")) } : {},
				...s["headers"] !== null && typeof s["headers"] === "object" && !Array.isArray(s["headers"]) ? { headers: Object.fromEntries(Object.entries(s["headers"]).filter((entry) => typeof entry[1] === "string")) } : {},
				...optionalString(s["items"]) === void 0 ? {} : { items: optionalString(s["items"]) },
				match,
				map
			}
		};
	}
	const items = optionalString(s["items"]);
	const label = optionalString(s["label"]);
	if (items === void 0) throw new Error("page lookup 缺 source.items（CSS selector）");
	if (label === void 0) throw new Error("page lookup 缺 source.label（text 或 attr:<name>）");
	const mapSpec = {};
	for (const [key, value] of Object.entries(map)) {
		if (value !== "text" && !/^attr:.+/.test(value)) throw new Error(`page lookup 的 map.${key} 必须是 text 或 attr:<name>`);
		mapSpec[key] = value;
	}
	return {
		...common,
		source: {
			kind: "page",
			url: optionalString(s["url"]) ?? (() => {
				throw new Error("page lookup 缺 source.url");
			})(),
			items,
			label: label === "text" || /^attr:.+/.test(label) ? label : (() => {
				throw new Error("page lookup 的 source.label 必须是 text 或 attr:<name>");
			})(),
			map: mapSpec
		}
	};
}
function cachePath(dataRoot, site, name) {
	const safeSite = site.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
	const safeName = name.replace(/[^A-Za-z0-9._-]/g, "_") || "lookup";
	return join(dataRoot, "lookups", safeSite, `${safeName}.json`);
}
function configHash(config) {
	return JSON.stringify(config.source);
}
function readCache(path) {
	if (!existsSync(path)) return void 0;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
		const file = parsed;
		if (!Array.isArray(file.items) || typeof file.fetchedAt !== "string" || typeof file.configHash !== "string") return void 0;
		return file;
	} catch {
		return;
	}
}
function writeCache(path, file) {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
	renameSync(tmp, path);
}
function valueOf(item, path) {
	const value = getByPath(item, path);
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : void 0;
}
function matchItem(item, match, query) {
	const wanted = query.trim().toLowerCase();
	for (const path of match) {
		const value = valueOf(item, path);
		if (value === void 0) continue;
		const text = String(value).trim();
		if (text.toLowerCase() === wanted || text.toLowerCase().includes(wanted)) return text;
	}
}
async function fetchItems(config, query, fetchImpl) {
	if (config.source.kind !== "api") throw new Error("page source 不能走 fetchItems");
	const source = config.source;
	const base = source.baseUrl === void 0 ? void 0 : expandEnv(source.baseUrl);
	let url;
	try {
		url = base === void 0 ? new URL(source.path) : new URL(source.path, base.endsWith("/") ? base : `${base}/`);
	} catch {
		throw new Error(`lookup URL 不合法：${source.path}`);
	}
	for (const [key, template] of Object.entries(source.query ?? {})) url.searchParams.set(key, template.replaceAll("{{query}}", query));
	const headers = { accept: "application/json" };
	for (const [key, value] of Object.entries(source.headers ?? {})) headers[key] = expandEnv(value);
	const response = await fetchImpl(url.toString(), {
		method: source.method ?? "GET",
		headers,
		signal: AbortSignal.timeout(15e3)
	});
	if (!response.ok) throw new Error(`lookup 接口返回 HTTP ${response.status}`);
	const itemsValue = getByPath(await response.json(), source.items ?? "$");
	if (!Array.isArray(itemsValue)) throw new Error("lookup items 路径没有返回数组");
	return {
		items: itemsValue,
		description: `${source.method ?? "GET"} ${url.pathname}`
	};
}
async function loadConfig(workspaceRoot, dataRoot, name) {
	const path = [
		join(workspaceRoot, ".dsh", "dataforge", "lookups", `${name}.yaml`),
		join(workspaceRoot, ".dsh", "dataforge", "lookups", `${name}.yml`),
		join(dataRoot, "lookups", `${name}.yaml`)
	].find((candidate) => existsSync(candidate));
	if (path === void 0) return void 0;
	return parseConfig(yaml.load(readFileSync(path, "utf8"), { schema: yaml.CORE_SCHEMA }), name);
}
/**
* 运行时 lookup：查缓存 → 过期则 fetch → 按 match 过滤 → map 出候选值。
*
* @param deps - dataRoot + 工作区解析 + 可注入 fetch。
* @param exec - 工具执行上下文（解析工作区）。
* @param args - name/query/site/refresh。
*/
async function lookupForTool(deps, exec, args) {
	const name = args.name.trim();
	const query = args.query.trim();
	if (name === "") return failure("lookup-not-found", "lookup name 不能为空", ["lookup 配置放 <workspace>/.dsh/dataforge/lookups/<name>.yaml"]);
	if (query === "") return failure("lookup-unusable", "lookup query 不能为空", ["给 query 传业务词，例如生态链"]);
	const workspaceRoot = await deps.resolveWorkspaceRoot(exec);
	if (workspaceRoot === void 0) return failure("no-workspace", "无法解析工作区根：lookup 配置按工作区落盘");
	let config;
	try {
		config = await loadConfig(workspaceRoot, deps.dataRoot, name);
	} catch (error) {
		return failure("lookup-invalid", `lookup 配置无效：${error.message}`);
	}
	if (config === void 0) return failure("lookup-not-found", `没有 lookup 配置：${name}`, ["在 <workspace>/.dsh/dataforge/lookups/ 下新增 YAML；只声明怎么查，不写业务值"]);
	const site = (args.site ?? config.site ?? "default").trim();
	const path = cachePath(deps.dataRoot, site, name);
	const hash = configHash(config);
	const cached = readCache(path);
	const ttl = config.cache?.ttlSeconds ?? 86400;
	const fresh = cached !== void 0 && cached.configHash === hash && ttl > 0 && Date.now() - Date.parse(cached.fetchedAt) < ttl * 1e3;
	let items;
	let fetchedAt;
	let source;
	let cache;
	let warnings = [];
	if (config.source.kind === "page") {
		if (!args.refresh && fresh && cached !== void 0) {
			items = cached.items;
			fetchedAt = cached.fetchedAt;
			source = cached.source;
			cache = "hit";
		} else {
			const reader = deps.pageReader;
			if (reader === void 0) return failure("page-lookup-unavailable", "page 来源 lookup 需要页面读取器（Playwright）；当前未装配", ["先用 api 来源；或启用 pageReader"]);
			try {
				items = await reader(config.source);
				fetchedAt = (/* @__PURE__ */ new Date()).toISOString();
				source = {
					kind: "page",
					description: `PAGE ${new URL(config.source.url).pathname}`
				};
				cache = "miss";
				writeCache(path, {
					name,
					site,
					configHash: hash,
					fetchedAt,
					source,
					items
				});
			} catch (error) {
				if (cached !== void 0 && cached.configHash === hash) {
					items = cached.items;
					fetchedAt = cached.fetchedAt;
					source = cached.source;
					cache = "hit";
					warnings = [`page lookup 读取失败，降级使用缓存：${error.message}`];
				} else return failure("lookup-http-error", `page lookup 失败：${error.message}`);
			}
		}
		const candidates = items.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)).filter((item) => item.label !== void 0 && item.values !== void 0 && String(item.label).toLowerCase().includes(query.toLowerCase()));
		return {
			ok: true,
			name,
			site,
			query,
			cache,
			fetchedAt,
			source,
			candidates,
			warnings
		};
	}
	if (!args.refresh && fresh && cached !== void 0) {
		items = cached.items;
		fetchedAt = cached.fetchedAt;
		source = cached.source;
		cache = "hit";
	} else try {
		const fetched = await fetchItems(config, query, deps.fetch ?? globalThis.fetch);
		items = fetched.items;
		source = {
			kind: "api",
			description: fetched.description
		};
		fetchedAt = (/* @__PURE__ */ new Date()).toISOString();
		cache = "miss";
		writeCache(path, {
			name,
			site,
			configHash: hash,
			fetchedAt,
			source,
			items
		});
	} catch (error) {
		if (cached !== void 0 && cached.configHash === hash) {
			items = cached.items;
			fetchedAt = cached.fetchedAt;
			source = cached.source;
			cache = "hit";
			warnings = [`lookup 刷新失败，降级使用缓存：${error.message}`];
		} else return failure("lookup-http-error", `lookup 查询失败：${error.message}`, ["检查 source.baseUrl/path/headers；凭证用 ${ENV} 注入，不要写进 YAML"]);
	}
	const candidates = [];
	for (const item of items) {
		const label = matchItem(item, config.source.match, query);
		if (label === void 0) continue;
		const values = {};
		for (const [key, itemPath] of Object.entries(config.source.map)) {
			const value = valueOf(item, itemPath);
			if (value !== void 0) values[key] = value;
		}
		if (Object.keys(values).length === 0) continue;
		if (candidates.some((candidate) => candidate.label === label && JSON.stringify(candidate.values) === JSON.stringify(values))) continue;
		candidates.push({
			label,
			values
		});
	}
	return {
		ok: true,
		name,
		site,
		query,
		cache,
		fetchedAt,
		source,
		candidates,
		warnings
	};
}

//#endregion
//#region src/uitest/features.ts
const MAX_FEATURE_TEXT = 80;
function clean(value) {
	if (typeof value !== "string") return void 0;
	const text = value.replace(/\s+/g, " ").trim();
	return text === "" ? void 0 : text.slice(0, MAX_FEATURE_TEXT);
}
/** 收口任意来源的 features（录制载荷 / YAML）；非法字段丢弃。 */
function normalizeFeatures(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return void 0;
	const value = raw;
	const tag = clean(value["tag"]);
	if (tag === void 0) return void 0;
	const out = { tag: tag.toLowerCase() };
	for (const key of [
		"id",
		"testId",
		"name",
		"ariaLabel",
		"placeholder",
		"role",
		"type",
		"text",
		"title",
		"alt",
		"href",
		"label"
	]) {
		const item = clean(value[key]);
		if (item !== void 0) out[key] = item;
	}
	const index = value["canvasIndex"];
	if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index <= 1e4) out.canvasIndex = index;
	return out;
}
/** CSS 属性值转义（只处理引号/反斜杠，特征来自真实 DOM，够用）。 */
function quote(value) {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
/**
* 由特征生成备用候选（按稳定性排序）。
* 返回的字符串同时兼容 Playwright 选择器与共享引擎的映射（text= / :has-text）。
*/
function featureCandidates(features) {
	if (features === void 0) return [];
	const out = [];
	const add = (selector) => {
		if (selector !== "" && !out.includes(selector) && out.length < 8) out.push(selector);
	};
	const tag = features.tag;
	if (features.testId !== void 0) add(`[data-testid="${quote(features.testId)}"]`);
	if (features.id !== void 0) add(`#${features.id.replace(/([^\w-])/g, "\\$1")}`);
	if (features.name !== void 0) add(`${tag}[name="${quote(features.name)}"]`);
	if (features.ariaLabel !== void 0) add(`${tag}[aria-label="${quote(features.ariaLabel)}"]`);
	if (features.placeholder !== void 0) add(`${tag}[placeholder="${quote(features.placeholder)}"]`);
	if (features.title !== void 0) add(`${tag}[title="${quote(features.title)}"]`);
	if (features.alt !== void 0) add(`${tag}[alt="${quote(features.alt)}"]`);
	if (features.href !== void 0) add(`${tag}[href="${quote(features.href)}"]`);
	if (features.role !== void 0 && features.text !== void 0) add(`[role="${quote(features.role)}"]:has-text("${quote(features.text)}")`);
	if (features.text !== void 0 && /^(BUTTON|A|LABEL|SUMMARY)$/i.test(tag)) {
		add(`${tag}:has-text("${quote(features.text)}")`);
		add(`text="${quote(features.text)}"`);
	}
	if (features.role !== void 0) add(`[role="${quote(features.role)}"]`);
	return out;
}

//#endregion
//#region src/uitest/schema.ts
/**
* UI 测试脚本（ui-script）的契约：YAML 形状 + 类型 + 解析/校验入口。
*
* 定位：这是**浏览器回放**的资产，不是接口链（interface-chain）的变体。
*   - 链走纯 HTTP，断言的是响应字段；
*   - ui-script 走真浏览器，断言的是页面状态（元素/文本/URL），步骤就是"人怎么点"。
* 两者共享的只有项目资产目录与运行留痕习惯，执行面互不依赖（见 README 的架构守卫）。
*
* 为什么用 YAML + 版本快照：
*   - 与链/卡同款：`.dsh/dataforge/ui-tests/<site>/<flow>/vN.yaml`，进 git、可手改、可评审；
*   - 一个版本一个文件，版本不可变（写入永远 max+1），回放记录里存版本号即快照身份。
*
* 选择器纪律：
*   - `selector` 是主选择器；`candidates` 是录制器给的有序候选（优先级从高到低），
*     回放时取**第一个在该页面唯一命中**的候选——录制期的 DOM 与回放期不完全相同，
*     单条选择器一旦失效就整步失败，候选链让回放有容错但不猜。
*   - `{{input}}` 是链级入参槽位引用（与链同款语法），可出现在 url / value / key / files / 断言文本里。
*
* @module dsh-dataforge/uitest/schema
*/
/** ui-script 文件格式版本；写进每份脚本，未来演进走它。 */
const UI_SCRIPT_API_VERSION = "dataforge/v1";
const UI_SCRIPT_KIND = "ui-script";
/** 步骤动作词表：录得出来的、回放得回去的。 */
const UI_STEP_KINDS = [
	"goto",
	"click",
	"fill",
	"press",
	"select",
	"submit",
	"wait",
	"upload",
	"scroll"
];
/** 页面断言词表：回放判定只看页面，不看响应（响应断言走接口链）。 */
const UI_EXPECT_KINDS = [
	"visible",
	"hidden",
	"text",
	"value",
	"url",
	"count"
];
/** 入参槽位类型词表（与链的标量词表对齐，数组在 UI 步里没有落点）。 */
const UI_INPUT_TYPES = [
	"string",
	"number",
	"boolean"
];
/** 单个脚本最多步骤数（再多就该拆流程，或者干脆写代码）。 */
const MAX_UI_STEPS = 300;
/** 单脚本最多入参槽位。 */
const MAX_UI_INPUTS = 20;
/** selector / 值 / 文件路径的长度上限（防手滑把整段 HTML 塞进来）。 */
const MAX_SELECTOR_CHARS = 2e3;
const MAX_VALUE_CHARS = 8e3;
const MAX_FILE_CHARS = 1e3;
/** 单个步骤最多候选/断言数。 */
const MAX_CANDIDATES = 8;
const MAX_EXPECTS = 10;
/** upload 单步最多文件数。 */
const MAX_UPLOAD_FILES = 10;
/** wait 上限（毫秒）。 */
const MAX_WAIT_MS = 6e4;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
	return typeof value === "string" ? value : void 0;
}
/** 空白裁掉；非字符串或空串 → undefined。 */
function textOf(value) {
	const text = asString(value);
	if (text === void 0) return void 0;
	const trimmed = text.trim();
	return trimmed.length === 0 ? void 0 : trimmed;
}
/** 入参引用语法：`{{name}}`（名字与链的槽位规则一致：字母/数字/下划线，字母开头）。 */
const INPUT_REF_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
/** 一段文本里引用了哪些入参（去重保序）。 */
function inputRefsOf(text) {
	if (text === void 0) return [];
	const refs = [];
	for (const match of text.matchAll(INPUT_REF_RE)) if (!refs.includes(match[1])) refs.push(match[1]);
	return refs;
}
/** 用入参值替换 `{{name}}`；未提供的槽位原样保留（由缺参闸在运行前拦）。 */
function substituteInputs(text, inputs) {
	return text.replace(INPUT_REF_RE, (whole, name) => {
		const value = inputs[name];
		return value === void 0 ? whole : value;
	});
}
/** 一个步骤里所有可替换文本（校验引用与运行期替换共用同一入口）。 */
function substitutableTextsOf(step) {
	const texts = [];
	if (step.url !== void 0) texts.push(step.url);
	if (step.value !== void 0) texts.push(step.value);
	if (step.key !== void 0) texts.push(step.key);
	for (const file of step.files ?? []) texts.push(file);
	for (const expect of step.expect ?? []) {
		if (expect.equals !== void 0) texts.push(String(expect.equals));
		if (expect.contains !== void 0) texts.push(expect.contains);
	}
	return texts;
}
/** 页面地址合法性：只收 http/https（file: 留给单测，不进项目脚本）。 */
function isHttpUrl$1(value) {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}
function issue(target, code, reason) {
	return {
		target,
		code,
		reason
	};
}
function normalizeExpect(raw, target, issues) {
	if (!isRecord(raw)) {
		issues.push(issue(target, "bad-expect", "断言必须是对象（kind + selector/equals/contains）"));
		return;
	}
	const kind = asString(raw["kind"]);
	if (kind === void 0 || !UI_EXPECT_KINDS.includes(kind)) {
		issues.push(issue(target, "bad-expect", `断言 kind 非法：${String(raw["kind"])}（可选 ${UI_EXPECT_KINDS.join("/")}）`));
		return;
	}
	const expectKind = kind;
	const selector = textOf(raw["selector"]);
	if (expectKind !== "url" && selector === void 0) {
		issues.push(issue(target, "bad-expect", `${expectKind} 断言缺 selector`));
		return;
	}
	if (selector !== void 0 && selector.length > MAX_SELECTOR_CHARS) {
		issues.push(issue(target, "bad-expect", `断言 selector 超过 ${MAX_SELECTOR_CHARS} 字符`));
		return;
	}
	const equalsRaw = raw["equals"];
	const equals = typeof equalsRaw === "number" ? equalsRaw : textOf(equalsRaw);
	const contains = textOf(raw["contains"]);
	if (expectKind === "visible" || expectKind === "hidden") {
		if (equals !== void 0 || contains !== void 0) {
			issues.push(issue(target, "bad-expect", `${expectKind} 断言不接受 equals/contains（只判元素是否可见）`));
			return;
		}
		return {
			kind: expectKind,
			selector
		};
	}
	if (equals === void 0 && contains === void 0) {
		issues.push(issue(target, "bad-expect", `${expectKind} 断言必须给 equals 或 contains`));
		return;
	}
	if (equals !== void 0 && typeof equals === "number" && expectKind !== "count") {
		issues.push(issue(target, "bad-expect", "只有 count 断言允许数字 equals（其他按字符串比较）"));
		return;
	}
	if (equals === void 0 && expectKind === "count") {
		issues.push(issue(target, "bad-expect", "count 断言必须给 equals（数字）"));
		return;
	}
	return {
		kind: expectKind,
		...selector === void 0 ? {} : { selector },
		...equals === void 0 ? {} : { equals },
		...contains === void 0 ? {} : { contains }
	};
}
function normalizeStep(raw, index, issues) {
	const target = `steps[${index}]`;
	if (!isRecord(raw)) {
		issues.push(issue(target, "bad-step-field", "步骤必须是对象"));
		return;
	}
	const id = textOf(raw["id"]);
	if (id === void 0) {
		issues.push(issue(target, "bad-step-id", "步骤缺 id"));
		return;
	}
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
		issues.push(issue(target, "bad-step-id", `步骤 id 只能用字母/数字/下划线/连字符：${id}`));
		return;
	}
	const kindRaw = asString(raw["kind"]);
	if (kindRaw === void 0 || !UI_STEP_KINDS.includes(kindRaw)) {
		issues.push(issue(target, "bad-step-kind", `步骤 kind 非法：${String(raw["kind"])}（可选 ${UI_STEP_KINDS.join("/")}）`));
		return;
	}
	const kind = kindRaw;
	const selector = textOf(raw["selector"]);
	const candidatesRaw = Array.isArray(raw["candidates"]) ? raw["candidates"] : [];
	const candidates = [];
	for (const item of candidatesRaw) {
		const candidate = textOf(item);
		if (candidate === void 0 || candidates.includes(candidate)) continue;
		if (candidate.length > MAX_SELECTOR_CHARS) {
			issues.push(issue(target, "bad-step-field", `candidate 超过 ${MAX_SELECTOR_CHARS} 字符`));
			return;
		}
		candidates.push(candidate);
	}
	if (selector !== void 0 && selector.length > MAX_SELECTOR_CHARS) {
		issues.push(issue(target, "bad-step-field", `selector 超过 ${MAX_SELECTOR_CHARS} 字符`));
		return;
	}
	if (candidates.length > MAX_CANDIDATES) {
		issues.push(issue(target, "bad-step-field", `candidates 最多 ${MAX_CANDIDATES} 条`));
		return;
	}
	const hasTarget = selector !== void 0 || candidates.length > 0;
	if ((kind === "click" || kind === "fill" || kind === "press" || kind === "select" || kind === "submit" || kind === "upload") && !hasTarget && kind !== "press") {
		issues.push(issue(target, "missing-target", `${kind} 步骤缺 selector/candidates`));
		return;
	}
	const value = asString(raw["value"]);
	const url = textOf(raw["url"]);
	const key = textOf(raw["key"]);
	const msRaw = raw["ms"];
	const step = {
		id,
		kind
	};
	if (selector !== void 0) step.selector = selector;
	if (candidates.length > 0) step.candidates = candidates;
	if (kind === "click") {
		const point = parseClickPoint(raw["clickPoint"], target, issues);
		if (point !== void 0) step.clickPoint = point;
	}
	const features = normalizeFeatures(raw["features"]);
	if (features !== void 0) step.features = features;
	if (kind === "goto") {
		if (url === void 0) {
			issues.push(issue(target, "bad-step-field", "goto 步骤缺 url"));
			return;
		}
		if (!isHttpUrl$1(substituteInputs(url, {})) && !url.includes("{{")) {
			issues.push(issue(target, "bad-step-field", `goto url 必须是 http/https：${url}`));
			return;
		}
		step.url = url;
	}
	if (kind === "fill") {
		if (value === void 0) {
			issues.push(issue(target, "bad-step-field", "fill 步骤缺 value（密码类输入不录制，见录制器说明）"));
			return;
		}
		if (value.length > MAX_VALUE_CHARS) {
			issues.push(issue(target, "bad-step-field", `fill value 超过 ${MAX_VALUE_CHARS} 字符`));
			return;
		}
		step.value = value;
	}
	if (kind === "select") {
		if (value === void 0) {
			issues.push(issue(target, "bad-step-field", "select 步骤缺 value（选项值）"));
			return;
		}
		step.value = value;
	}
	if (kind === "press") {
		if (key === void 0) {
			issues.push(issue(target, "bad-step-field", "press 步骤缺 key（如 Enter/Escape/Tab）"));
			return;
		}
		step.key = key;
	}
	if (kind === "wait") {
		if (typeof msRaw !== "number" || !Number.isFinite(msRaw) || msRaw < 0 || msRaw > 6e4) {
			issues.push(issue(target, "bad-step-field", `wait 步骤的 ms 必须是 0..${MAX_WAIT_MS} 的数字`));
			return;
		}
		step.ms = Math.round(msRaw);
	}
	if (kind === "scroll") {
		const deltaYRaw = raw["deltaY"];
		if (selector === void 0 && candidates.length === 0) {
			if (typeof deltaYRaw !== "number" || !Number.isFinite(deltaYRaw) || Math.round(deltaYRaw) !== deltaYRaw || Math.abs(deltaYRaw) > 1e4) {
				issues.push(issue(target, "bad-step-field", "scroll 步骤需要 selector（滚到元素）或 deltaY（窗口滚动像素，-10000..10000 整数）"));
				return;
			}
			step.deltaY = Math.round(deltaYRaw);
		} else if (deltaYRaw !== void 0) {
			issues.push(issue(target, "bad-step-field", "scroll 步骤的 selector 与 deltaY 二选一"));
			return;
		}
	}
	if (kind === "upload") {
		const filesRaw = Array.isArray(raw["files"]) ? raw["files"] : [];
		const files = [];
		for (const item of filesRaw) {
			const file = textOf(item);
			if (file === void 0) continue;
			if (file.length > MAX_FILE_CHARS) {
				issues.push(issue(target, "bad-step-field", `upload 文件路径超过 ${MAX_FILE_CHARS} 字符`));
				return;
			}
			files.push(file);
		}
		if (files.length === 0) {
			issues.push(issue(target, "bad-step-field", "upload 步骤缺 files（本地路径数组）"));
			return;
		}
		if (files.length > MAX_UPLOAD_FILES) {
			issues.push(issue(target, "bad-step-field", `upload 最多 ${MAX_UPLOAD_FILES} 个文件`));
			return;
		}
		step.files = files;
	}
	const at = textOf(raw["at"]);
	if (at !== void 0) step.at = at;
	const expectRaw = raw["expect"];
	if (expectRaw !== void 0) {
		if (!Array.isArray(expectRaw)) {
			issues.push(issue(target, "bad-expect", "expect 必须是数组"));
			return;
		}
		if (expectRaw.length > MAX_EXPECTS) {
			issues.push(issue(target, "bad-expect", `单步断言最多 ${MAX_EXPECTS} 条`));
			return;
		}
		const expects = [];
		for (const [i, item] of expectRaw.entries()) {
			const normalized = normalizeExpect(item, `${target}.expect[${i}]`, issues);
			if (normalized === void 0) return void 0;
			expects.push(normalized);
		}
		if (expects.length > 0) step.expect = expects;
	}
	return step;
}
function normalizeMeta(raw, issues) {
	if (!isRecord(raw)) {
		issues.push(issue("meta", "bad-meta", "缺 meta（site/flow/version/created/startUrl）"));
		return;
	}
	const site = textOf(raw["site"]);
	const flow = textOf(raw["flow"]);
	const versionRaw = raw["version"];
	if (site === void 0) issues.push(issue("meta", "bad-meta", "meta.site 不能为空"));
	if (flow === void 0) issues.push(issue("meta", "bad-meta", "meta.flow 不能为空"));
	if (typeof versionRaw !== "number" || !Number.isInteger(versionRaw) || versionRaw < 1) issues.push(issue("meta", "bad-meta", "meta.version 必须是 ≥1 的整数"));
	const startUrl = textOf(raw["startUrl"]);
	if (startUrl === void 0) issues.push(issue("meta", "bad-start-url", "meta.startUrl 不能为空（回放要一个起点）"));
	else if (!isHttpUrl$1(startUrl)) issues.push(issue("meta", "bad-start-url", `meta.startUrl 必须是 http/https：${startUrl}`));
	if (issues.length > 0) return void 0;
	const created = raw["created"] instanceof Date ? raw["created"].toISOString() : textOf(raw["created"]);
	const sourceRaw = asString(raw["source"]);
	const source = sourceRaw === "record" || sourceRaw === "agent" || sourceRaw === "canvas" ? sourceRaw : void 0;
	const viewportRaw = raw["viewport"];
	let viewport;
	if (isRecord(viewportRaw)) {
		const width = viewportRaw["width"];
		const height = viewportRaw["height"];
		if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) viewport = {
			width: Math.round(width),
			height: Math.round(height)
		};
	}
	return {
		site,
		flow,
		version: versionRaw,
		created: created ?? (/* @__PURE__ */ new Date()).toISOString(),
		startUrl,
		...source === void 0 ? {} : { source },
		...textOf(raw["domain"]) === void 0 ? {} : { domain: textOf(raw["domain"]) },
		...textOf(raw["note"]) === void 0 ? {} : { note: textOf(raw["note"]) },
		...textOf(raw["task"]) === void 0 ? {} : { task: textOf(raw["task"]).slice(0, 4e3) },
		...raw["review"] === "pending" || raw["review"] === "confirmed" ? { review: raw["review"] } : {},
		...viewport === void 0 ? {} : { viewport }
	};
}
function normalizeInputs$1(raw, issues) {
	if (raw === void 0) return [];
	if (!Array.isArray(raw)) {
		issues.push(issue("inputs", "bad-input", "inputs 必须是数组"));
		return;
	}
	if (raw.length > 20) {
		issues.push(issue("inputs", "bad-input", `入参槽位最多 ${20} 个`));
		return;
	}
	const inputs = [];
	for (const [i, item] of raw.entries()) {
		const target = `inputs[${i}]`;
		if (!isRecord(item)) {
			issues.push(issue(target, "bad-input", "入参槽位必须是对象（name/type/required）"));
			return;
		}
		const name = textOf(item["name"]);
		if (name === void 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
			issues.push(issue(target, "bad-input", `入参名非法：${String(item["name"])}`));
			return;
		}
		if (inputs.some((input) => input.name === name)) {
			issues.push(issue(target, "duplicate-input", `入参名重复：${name}`));
			return;
		}
		const typeRaw = asString(item["type"]);
		if (typeRaw === void 0 || !UI_INPUT_TYPES.includes(typeRaw)) {
			issues.push(issue(target, "bad-input", `入参类型非法：${String(item["type"])}（可选 ${UI_INPUT_TYPES.join("/")}）`));
			return;
		}
		const required = item["required"] === void 0 ? false : item["required"];
		if (typeof required !== "boolean") {
			issues.push(issue(target, "bad-input", "required 必须是布尔"));
			return;
		}
		const example = textOf(item["example"]);
		inputs.push({
			name,
			type: typeRaw,
			required,
			...example === void 0 ? {} : { example }
		});
	}
	return inputs;
}
/** 解析点击落点：非法值忽略（不让旧脚本因坐标脏值整份失败）。 */
function parseClickPoint(raw, target, issues) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return void 0;
	const value = raw;
	const num = (key) => {
		const item = value[key];
		return typeof item === "number" && Number.isFinite(item) ? item : void 0;
	};
	const fx = num("fx");
	const fy = num("fy");
	const x = num("x");
	const y = num("y");
	const vw = num("vw");
	const vh = num("vh");
	if (fx === void 0 || fy === void 0 || x === void 0 || y === void 0) {
		issues.push(issue(target, "bad-step-field", "clickPoint 需要数字 fx/fy/x/y"));
		return;
	}
	if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || vw !== void 0 && vw <= 0 || vh !== void 0 && vh <= 0) {
		issues.push(issue(target, "bad-step-field", "clickPoint 的 fx/fy 必须在 0..1、vw/vh 必须为正"));
		return;
	}
	const tag = textOf(value["tag"]);
	const box = [
		"bx",
		"by",
		"bw",
		"bh"
	].map((key) => num(key));
	const hasBox = box.every((item) => item !== void 0);
	const name = textOf(value["name"]);
	return {
		fx,
		fy,
		x,
		y,
		vw: vw ?? 0,
		vh: vh ?? 0,
		...tag === void 0 ? {} : { tag },
		...hasBox ? {
			bx: box[0],
			by: box[1],
			bw: box[2],
			bh: box[3]
		} : {},
		...name === void 0 ? {} : { name: name.slice(0, 120) }
	};
}
/**
* 已解析的 YAML 值 → UiScriptDoc。
*
* 只做形状与"该有的字段必须有"，语义（入参引用是否都声明了、是否有人用）在同一遍
* 校验里做完——ui-script 没有卡引用那种跨文件语义，不需要像链那样拆两段。
*/
function parseUiScriptDoc(raw) {
	if (!isRecord(raw)) return {
		ok: false,
		issues: [issue("script", "invalid-script", "脚本必须是一个 YAML 映射（key: value）")]
	};
	const issues = [];
	if (asString(raw["apiVersion"]) !== "dataforge/v1") issues.push(issue("script", "invalid-script", `apiVersion 必须是 ${UI_SCRIPT_API_VERSION}（收到 ${String(raw["apiVersion"])}）`));
	if (raw["kind"] !== "ui-script") issues.push(issue("script", "invalid-script", `kind 必须是 ${UI_SCRIPT_KIND}（收到 ${String(raw["kind"])}）`));
	const meta = normalizeMeta(raw["meta"], issues);
	const inputs = normalizeInputs$1(raw["inputs"], issues);
	const stepsRaw = raw["steps"];
	const steps = [];
	if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) issues.push(issue("steps", "no-steps", "脚本至少要有 1 个步骤"));
	else if (stepsRaw.length > 300) issues.push(issue("steps", "too-many-steps", `步骤最多 ${300} 个`));
	else {
		const ids = /* @__PURE__ */ new Set();
		for (const [i, item] of stepsRaw.entries()) {
			const step = normalizeStep(item, i, issues);
			if (step === void 0) continue;
			if (ids.has(step.id)) {
				issues.push(issue(`steps[${i}]`, "duplicate-step-id", `步骤 id 重复：${step.id}`));
				continue;
			}
			ids.add(step.id);
			steps.push(step);
		}
	}
	if (issues.length > 0 || meta === void 0 || inputs === void 0) return {
		ok: false,
		issues
	};
	const used = /* @__PURE__ */ new Set();
	const unknownRefs = /* @__PURE__ */ new Set();
	const declared = new Set(inputs.map((input) => input.name));
	for (const step of steps) for (const text of substitutableTextsOf(step)) for (const ref of inputRefsOf(text)) {
		used.add(ref);
		if (!declared.has(ref)) unknownRefs.add(ref);
	}
	for (const ref of unknownRefs) issues.push(issue("steps", "unknown-input-ref", `步骤里引用了未声明的入参槽位 {{${ref}}}`));
	for (const input of inputs) if (!used.has(input.name)) issues.push(issue("inputs", "unreferenced-input", `入参槽位 ${input.name} 没有被任何步骤引用（\\{\\{${input.name}\\}\\}）`));
	if (issues.length > 0) return {
		ok: false,
		issues
	};
	return {
		ok: true,
		doc: {
			apiVersion: UI_SCRIPT_API_VERSION,
			kind: UI_SCRIPT_KIND,
			meta,
			inputs,
			steps
		}
	};
}
/** YAML 文本 → UiScriptDoc；YAML 语法错也算 invalid-script。 */
function parseUiScriptYaml(text) {
	let raw;
	try {
		raw = loadYamlValue(text);
	} catch (error) {
		return {
			ok: false,
			issues: [issue("script", "invalid-script", `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`)]
		};
	}
	return parseUiScriptDoc(raw);
}
/**
* YAML 文本 → JS 值（CORE schema：时间戳保持字符串，与链/卡同款，避免 YAML 1.1 把
* `created` 变 Date 再被 schema 判成非字符串）。
*/
function loadYamlValue(text) {
	return yaml.load(text, { schema: yaml.CORE_SCHEMA });
}
/** UiScriptDoc → YAML 文本。 */
function uiScriptToYaml(doc) {
	return yaml.dump(doc, {
		lineWidth: 120,
		noRefs: true,
		sortKeys: false
	});
}
/** 缺参闸：回放前检查 required 槽位是否给了值；返回缺的槽位名（类型按 string 传入）。 */
function missingInputsOf(doc, provided) {
	return doc.inputs.filter((input) => input.required).filter((input) => (provided[input.name] ?? "").length === 0).map((input) => input.name);
}
/** 统一格式化成一行可读问题（工具回执/面板展示共用）。 */
function formatUiIssues(issues) {
	return issues.map((item) => `${item.target}：${item.reason}`).join("；");
}

//#endregion
//#region src/uitest/store.ts
/**
* ui-script 存取：版本快照、回读、列表。
*
* 落点（项目资产，进 git、可手改）：
*   <workspaceRoot>/.dsh/dataforge/ui-tests/<siteSlug>/<flowSlug>/v<n>.yaml
*
* 纪律与链完全一致：
*   - 一个版本一个文件，**版本即不可变快照**：写入永远分配 max+1，不覆盖旧版本；
*   - 写入前先校验（形状 + 入参引用），全过才落盘——不存在"部分写入"；
*   - 读时重新校验（文件可能被手改坏），坏文件如实报 `invalid-ui-script` 并列出可用版本；
*   - 路径参数一律经 slug 校验，不把用户输入直接拼进文件路径。
*
* 与链的差异：ui-script 没有跨文件引用（不解析接口卡），所以没有 CardResolver 这类注入缝。
*
* @module dsh-dataforge/uitest/store
*/
/** ui-script 根目录：`.dsh/dataforge/ui-tests`。 */
function uiTestsRoot(workspaceRoot) {
	return join(dataforgeRoot(workspaceRoot), "ui-tests");
}
function requireSlug(name, what) {
	const slug = slugOf(name);
	if (slug.length === 0) throw Object.assign(/* @__PURE__ */ new Error(`${what} "${String(name)}" 不能作为目录名（为空或只含路径分隔符）`), { code: "invalid-ui-script" });
	return slug;
}
/** 流程版本目录：`ui-tests/<siteSlug>/<flowSlug>`。 */
function uiScriptDir(workspaceRoot, site, flow) {
	return join(uiTestsRoot(workspaceRoot), requireSlug(site, "site"), requireSlug(flow, "flow"));
}
/** 单个版本文件路径：`.../v<n>.yaml`。 */
function uiScriptPath(workspaceRoot, site, flow, version) {
	return join(uiScriptDir(workspaceRoot, site, flow), `v${version}.yaml`);
}
/** 已有版本号（升序）；目录不存在返回空数组。 */
function listUiScriptVersions(workspaceRoot, site, flow) {
	const dir = uiScriptDir(workspaceRoot, site, flow);
	if (!existsSync(dir)) return [];
	const versions = [];
	for (const entry of readdirSync(dir)) {
		const hit = /^v(\d+)\.ya?ml$/.exec(entry);
		if (!hit) continue;
		const version = Number(hit[1]);
		if (Number.isInteger(version) && version >= 1) versions.push(version);
	}
	return versions.sort((left, right) => left - right);
}
/** 最新版本号；没有任何版本返回 undefined。 */
function latestUiScriptVersion(workspaceRoot, site, flow) {
	const versions = listUiScriptVersions(workspaceRoot, site, flow);
	return versions.length > 0 ? versions[versions.length - 1] : void 0;
}
/** 下一个版本号 = max+1（没有历史则 1）。 */
function nextUiScriptVersion(workspaceRoot, site, flow) {
	return (latestUiScriptVersion(workspaceRoot, site, flow) ?? 0) + 1;
}
function dirOfSite(root) {
	if (!existsSync(root)) return [];
	try {
		return readdirSync(root).filter((entry) => {
			try {
				return statSync(join(root, entry)).isDirectory();
			} catch {
				return false;
			}
		});
	} catch {
		return [];
	}
}
/** 逐版本读文件头：面板要显示「v3 · 3 步 · 更新时间」。 */
function listUiVersionInfos(workspaceRoot, site, flow) {
	return listUiScriptVersions(workspaceRoot, site, flow).map((version) => {
		try {
			const doc = parseUiScriptYaml(readFileSync(uiScriptPath(workspaceRoot, site, flow, version), "utf8"));
			if (!doc.ok) return {
				version,
				unreadable: doc.issues.map((item) => `${item.target}：${item.reason}`).join("；")
			};
			return {
				version,
				created: doc.doc.meta.created,
				...doc.doc.meta.source === void 0 ? {} : { source: doc.doc.meta.source },
				stepCount: doc.doc.steps.length,
				startUrl: doc.doc.meta.startUrl,
				...doc.doc.meta.note === void 0 ? {} : { note: doc.doc.meta.note },
				...doc.doc.meta.task === void 0 ? {} : { task: doc.doc.meta.task },
				...doc.doc.meta.review === void 0 ? {} : { review: doc.doc.meta.review }
			};
		} catch (error) {
			return {
				version,
				unreadable: String(error?.message ?? error)
			};
		}
	});
}
/** 列全部流程（面板一级/二级列表用；坏目录跳过）。 */
function listUiScripts(workspaceRoot) {
	const root = uiTestsRoot(workspaceRoot);
	const refs = [];
	for (const site of dirOfSite(root)) for (const flow of dirOfSite(join(root, site))) {
		let versions = [];
		try {
			versions = listUiScriptVersions(workspaceRoot, site, flow);
		} catch {
			continue;
		}
		if (versions.length === 0) continue;
		const latest = versions[versions.length - 1];
		let domain;
		let unreadable;
		let updatedAt;
		let review;
		let task;
		try {
			const doc = parseUiScriptYaml(readFileSync(uiScriptPath(workspaceRoot, site, flow, latest), "utf8"));
			if (doc.ok) {
				domain = doc.doc.meta.domain;
				updatedAt = doc.doc.meta.created;
				review = doc.doc.meta.review;
				task = doc.doc.meta.task;
			} else unreadable = doc.issues.map((item) => `${item.target}：${item.reason}`).join("；");
		} catch (error) {
			unreadable = String(error?.message ?? error);
		}
		refs.push({
			site,
			flow,
			latest,
			versions,
			...domain === void 0 ? {} : { domain },
			...updatedAt === void 0 ? {} : { updatedAt },
			...review === void 0 ? {} : { review },
			...task === void 0 ? {} : { task },
			...unreadable === void 0 ? {} : { unreadable }
		});
	}
	return refs.sort((left, right) => `${left.site}/${left.flow}`.localeCompare(`${right.site}/${right.flow}`));
}
/** 读一个版本（缺省最新）；文件坏了不静默，返回 issues + 可用版本。 */
function loadUiScript(workspaceRoot, site, flow, version) {
	const availableVersions = listUiScriptVersions(workspaceRoot, site, flow);
	const target = version ?? availableVersions[availableVersions.length - 1];
	if (target === void 0 || !availableVersions.includes(target)) return {
		ok: false,
		code: "ui-script-not-found",
		message: target === void 0 ? `没有找到 ${site} / ${flow} 的任何 UI 脚本版本` : `${site} / ${flow} 没有 v${target}`,
		availableVersions
	};
	const path = uiScriptPath(workspaceRoot, site, flow, target);
	const text = readFileSync(path, "utf8");
	const parsed = parseUiScriptYaml(text);
	if (!parsed.ok) return {
		ok: false,
		code: "invalid-ui-script",
		message: `${path} 未通过校验（可能被手改坏）：可回读旧版本或修好再试`,
		issues: parsed.issues,
		availableVersions
	};
	return {
		ok: true,
		doc: parsed.doc,
		yaml: text,
		path,
		version: target,
		availableVersions
	};
}
/**
* 落盘为**新版本**（version 取 max+1，输入里的 meta.version 会被覆盖成实际版本号）。
*
* `input` 可以是已解析的 UiScriptDoc，也可以是 YAML 文本（agent 手写/面板导入）。
* 校验不过一律不落盘。`source` 由调用方声明（record/agent/canvas），不猜。
*/
function saveUiScript(workspaceRoot, input, options = {}) {
	const parsed = typeof input === "string" ? parseUiScriptYaml(input) : parseUiScriptDoc(input);
	if (!parsed.ok) return {
		ok: false,
		issues: parsed.issues
	};
	const doc = parsed.doc;
	const version = nextUiScriptVersion(workspaceRoot, doc.meta.site, doc.meta.flow);
	const meta = {
		...doc.meta,
		version,
		created: isValidInstant(doc.meta.created) ? doc.meta.created : (/* @__PURE__ */ new Date()).toISOString(),
		...options.source === void 0 ? {} : { source: options.source }
	};
	const finalDoc = {
		...doc,
		meta
	};
	const path = uiScriptPath(workspaceRoot, meta.site, meta.flow, version);
	mkdirSync(uiScriptDir(workspaceRoot, meta.site, meta.flow), { recursive: true });
	writeFileSync(path, uiScriptToYaml(finalDoc), "utf8");
	return {
		ok: true,
		version,
		path,
		doc: finalDoc
	};
}
function isValidInstant(value) {
	if (typeof value !== "string" || value.length === 0) return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed);
}

//#endregion
//#region src/uitest/highlight.ts
/**
* 回放点击的视觉提示：在点击落点注入一个脉冲光圈 + 圆点，让观看者能看清"点到哪了"。
*
* 约束：
*   - `pointer-events:none` + 最高 z-index：不拦截点击、不改布局；
*   - 开一次样式、每次点击生成一个小节点，900ms 后自删；
*   - 纯页面内 DOM，不依赖 CDP 覆盖层（共享浏览器和 Playwright 都能用）。
*
* @module dsh-dataforge/uitest/highlight
*/
const STYLE_ID = "df-ui-click-highlight-style";
/** 生成"在视口 (x, y) 点击"的注入表达式（数字内联，安全）。 */
function highlightClickExpression(x, y) {
	const px = Math.round(Number.isFinite(x) ? x : 0);
	const py = Math.round(Number.isFinite(y) ? y : 0);
	return `(() => {
    try {
      const STYLE_ID = ${JSON.stringify(STYLE_ID)}
      if (document.getElementById(STYLE_ID) === null) {
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = [
          '@keyframes dfUiClickRing { 0% { transform: translate(-50%, -50%) scale(0.25); opacity: 0.95 } 100% { transform: translate(-50%, -50%) scale(1.7); opacity: 0 } }',
          '@keyframes dfUiClickDot { 0% { transform: translate(-50%, -50%) scale(0); opacity: 1 } 25% { transform: translate(-50%, -50%) scale(1); opacity: 1 } 100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0 } }'
        ].join('\\n')
        ;(document.head || document.documentElement).appendChild(style)
      }
      const host = document.createElement('div')
      host.setAttribute('data-df-ui-click', '1')
      host.style.cssText = 'position:fixed;left:${px}px;top:${py}px;width:0;height:0;z-index:2147483647;pointer-events:none;'
      const ring = document.createElement('span')
      ring.style.cssText = 'position:absolute;left:0;top:0;width:34px;height:34px;border:2px solid rgba(255,82,82,0.95);border-radius:50%;box-shadow:0 0 10px rgba(255,82,82,0.55);animation:dfUiClickRing 760ms ease-out forwards;'
      const dot = document.createElement('span')
      dot.style.cssText = 'position:absolute;left:0;top:0;width:9px;height:9px;border-radius:50%;background:#ff5252;box-shadow:0 0 6px rgba(255,82,82,0.8);animation:dfUiClickDot 760ms ease-out forwards;'
      host.appendChild(ring)
      host.appendChild(dot)
      ;(document.body || document.documentElement).appendChild(host)
      setTimeout(() => { host.remove() }, 1000)
      return { x: ${px}, y: ${py} }
    } catch (err) { return null }
  })()`;
}

//#endregion
//#region src/uitest/run.ts
/**
* UI 回放引擎：把 ui-script 的步骤在真浏览器里按顺序执行，并在每步后做页面断言。
*
* 与接口链执行（src/execute）的关系：
*   - 两者都是「执行面」，但依赖图互不相交：本模块只依赖 playwright-core + uitest 自己的
*     store，**不 import src/execute/**、不 import src/capture/**（浏览器只在这里起）；
*   - 共用的是运行留痕习惯（run.json + events.ndjson）与凭证纪律（cookie 只进 context，
*     不进事件/摘要）。
*
* 回放语义（刻意保守）：
*   - 选择器候选按顺序找「当前页面唯一命中」的那个；候选全失效 = 该步失败（带截图）；
*   - 动作后用 Playwright 的自动等待收口（点击后导航、列表渲染）；断言独立轮询到步骤超时；
*   - 失败即停（fail-fast），不猜测修复、不重试写操作（重试写可能造成重复提交）。
*
* @module dsh-dataforge/uitest/run
*/
/** 默认工厂：playwright-core + 系统 Chrome（与本插件采集同款，免下载浏览器）。 */
const openUiBrowser = async ({ headless, viewport, channel }) => {
	const { chromium } = await import("playwright-core");
	const browser = await chromium.launch({
		channel,
		headless
	});
	const context = await browser.newContext({ viewport });
	return {
		browser,
		context,
		page: await context.newPage()
	};
};
/** 步骤执行后的目标描述（回执/事件用，不含值）。 */
function targetOf(step) {
	return step.selector ?? step.candidates?.[0] ?? step.url;
}
/** 计划：替换入参后的步骤摘要 + 写操作计数。 */
function planUiRun(doc, inputs = {}) {
	return {
		site: doc.meta.site,
		flow: doc.meta.flow,
		version: doc.meta.version,
		startUrl: substituteInputs(doc.meta.startUrl, inputs),
		stepCount: doc.steps.length,
		writeSteps: doc.steps.filter((step) => step.kind === "click" || step.kind === "submit" || step.kind === "upload").length,
		steps: doc.steps.map((step) => ({
			id: step.id,
			kind: step.kind,
			...targetOf(step) === void 0 ? {} : { target: targetOf(step) },
			...step.value === void 0 ? {} : { value: substituteInputs(step.value, inputs) }
		})),
		inputs
	};
}
/** 跑一次 ui-script：建留痕 → 起浏览器 → 逐步执行 + 断言 → 写终态。 */
async function runUiScript(deps, args) {
	const { doc } = args;
	const inputs = args.inputs ?? {};
	const runId = `uir_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	const startUrl = substituteInputs(doc.meta.startUrl, inputs);
	const headless = args.headless ?? true;
	const slowMoMs = Math.min(Math.max(Math.floor(args.slowMoMs ?? 0), 0), 1e4);
	const highlightClicks = args.highlightClicks ?? true;
	const holdMs = Math.min(Math.max(Math.floor(args.holdMs ?? 0), 0), 3e4);
	const startedAt = Date.now();
	const viewport = doc.meta.viewport ?? {
		width: 1280,
		height: 720
	};
	startUiRun(deps.dataRoot, runId, {
		site: doc.meta.site,
		flow: doc.meta.flow,
		version: doc.meta.version,
		startUrl,
		headless,
		totalSteps: doc.steps.length
	});
	emit(deps.dataRoot, runId, {
		event: "meta",
		site: doc.meta.site,
		flow: doc.meta.flow,
		version: doc.meta.version,
		startUrl
	});
	const stepResults = [];
	let cookiesApplied = 0;
	let browser;
	try {
		const opened = await (deps.openBrowser ?? openUiBrowser)({
			headless,
			viewport,
			channel: deps.channel
		});
		browser = opened.browser;
		const { page, context } = opened;
		if (deps.loadCookies !== void 0) {
			const cookies = await deps.loadCookies(startUrl).catch(() => []);
			if (cookies.length > 0) {
				await context.addCookies(cookies.map((cookie) => ({
					name: cookie.name,
					value: cookie.value,
					domain: cookie.domain,
					path: cookie.path ?? "/",
					secure: cookie.secure ?? startUrl.startsWith("https:"),
					...cookie.expires === void 0 ? {} : { expires: cookie.expires }
				}))).catch(() => void 0);
				cookiesApplied = cookies.length;
			}
		}
		await page.goto(startUrl, {
			waitUntil: "domcontentloaded",
			timeout: deps.stepTimeoutMs
		});
		const emitStepEvent = (event) => appendUiRunEvent(deps.dataRoot, runId, event);
		for (const step of doc.steps) {
			if (slowMoMs > 0) await sleep$2(slowMoMs);
			const result = await runStep$1(page, step, inputs, deps.stepTimeoutMs, emitStepEvent, highlightClicks);
			stepResults.push(result);
			if (!result.ok) {
				const evidence = await captureFailure$1(page, deps.dataRoot, runId);
				const elapsedMs = Date.now() - startedAt;
				appendUiRunEvent(deps.dataRoot, runId, {
					event: "terminal",
					success: false,
					message: result.error,
					...evidence.screenshot === void 0 ? {} : { screenshot: evidence.screenshot },
					...evidence.dom === void 0 ? {} : { dom: evidence.dom },
					elapsed: elapsedMs
				});
				finishUiRun(deps.dataRoot, runId, {
					status: "failed",
					finishedAt: Date.now(),
					stepsDone: stepResults.length - 1,
					failedStep: result.id,
					...result.error === void 0 ? {} : { error: result.error },
					...evidence.screenshot === void 0 ? {} : { screenshot: evidence.screenshot },
					elapsedMs
				});
				return {
					runId,
					site: doc.meta.site,
					flow: doc.meta.flow,
					version: doc.meta.version,
					startUrl,
					success: false,
					totalSteps: doc.steps.length,
					stepsDone: stepResults.length - 1,
					steps: stepResults,
					failedStep: result,
					...evidence.screenshot === void 0 ? {} : { screenshot: evidence.screenshot },
					...evidence.dom === void 0 ? {} : { dom: evidence.dom },
					...result.error === void 0 ? {} : { error: result.error },
					elapsedMs,
					cookiesApplied
				};
			}
		}
		const elapsedMs = Date.now() - startedAt;
		const evidence = await captureSuccess(page, deps.dataRoot, runId);
		appendUiRunEvent(deps.dataRoot, runId, {
			event: "terminal",
			success: true,
			message: `全部 ${doc.steps.length} 步通过`,
			elapsed: elapsedMs,
			...evidence.screenshot === void 0 ? {} : { screenshot: evidence.screenshot }
		});
		finishUiRun(deps.dataRoot, runId, {
			status: "success",
			finishedAt: Date.now(),
			stepsDone: stepResults.length,
			...evidence.screenshot === void 0 ? {} : { screenshot: evidence.screenshot },
			elapsedMs
		});
		return {
			runId,
			site: doc.meta.site,
			flow: doc.meta.flow,
			version: doc.meta.version,
			startUrl,
			success: true,
			totalSteps: doc.steps.length,
			stepsDone: stepResults.length,
			steps: stepResults,
			...evidence.screenshot === void 0 ? {} : { screenshot: evidence.screenshot },
			elapsedMs,
			cookiesApplied
		};
	} catch (error) {
		const message = String(error?.message ?? error).slice(0, 1e3);
		const elapsedMs = Date.now() - startedAt;
		appendUiRunEvent(deps.dataRoot, runId, {
			event: "terminal",
			success: false,
			message,
			elapsed: elapsedMs
		});
		finishUiRun(deps.dataRoot, runId, {
			status: "failed",
			finishedAt: Date.now(),
			stepsDone: stepResults.length,
			error: message,
			elapsedMs
		});
		return {
			runId,
			site: doc.meta.site,
			flow: doc.meta.flow,
			version: doc.meta.version,
			startUrl,
			success: false,
			totalSteps: doc.steps.length,
			stepsDone: stepResults.length,
			steps: stepResults,
			error: message,
			elapsedMs,
			cookiesApplied
		};
	} finally {
		if (browser !== void 0 && holdMs > 0) await sleep$2(holdMs);
		await browser?.close().catch(() => void 0);
	}
}
/** 点击前在元素中心画光圈（best-effort：无 boundingBox/evaluate 时跳过）。 */
async function highlightLocator(page, locator, enabled) {
	if (!enabled) return;
	try {
		const box = await locator.boundingBox();
		if (box === null || box.width <= 0 || box.height <= 0) return;
		if (typeof page.evaluate !== "function") return;
		await page.evaluate(highlightClickExpression(box.x + box.width / 2, box.y + box.height / 2));
	} catch {}
}
/** 按元素内比例坐标点击（clickPoint.fx/fy）；元素不可见/无尺寸时抛错。 */
async function clickLocatorPoint(page, locator, point, highlightClicks) {
	const box = await locator.boundingBox();
	if (box === null || box.width <= 0 || box.height <= 0) throw new Error("元素没有可点击的尺寸（无法按坐标点击）");
	const near = (left, right) => Math.abs(left - right) <= 1.5;
	const unchanged = point.bx !== void 0 && point.by !== void 0 && point.bw !== void 0 && point.bh !== void 0 && near(point.bx, box.x) && near(point.by, box.y) && near(point.bw, box.width) && near(point.bh, box.height);
	const x = unchanged ? point.x : box.x + point.fx * box.width;
	const y = unchanged ? point.y : box.y + point.fy * box.height;
	if (highlightClicks && typeof page.evaluate === "function") await page.evaluate(highlightClickExpression(x, y)).catch(() => void 0);
	await page.mouse.click(x, y);
}
function emit(dataRoot, runId, event) {
	appendUiRunEvent(dataRoot, runId, event);
}
/** 单步：动作 → 断言（任一失败即该步失败）。 */
async function runStep$1(page, step, inputs, timeoutMs, emit, highlightClicks) {
	const startedAt = Date.now();
	const result = {
		id: step.id,
		kind: step.kind,
		ok: false,
		elapsedMs: 0,
		assertions: []
	};
	const target = targetOf(step);
	emit({
		event: "step",
		id: step.id,
		kind: step.kind,
		status: "start",
		...target === void 0 ? {} : { target }
	});
	try {
		if (step.kind === "wait") await page.waitForTimeout(Math.min(step.ms ?? 0, timeoutMs));
		else if (step.kind === "goto") {
			const url = substituteInputs(step.url ?? "", inputs);
			await page.goto(url, {
				waitUntil: "domcontentloaded",
				timeout: timeoutMs
			});
		} else if (step.kind === "press" && step.selector === void 0 && (step.candidates?.length ?? 0) === 0) await page.keyboard.press(substituteInputs(step.key ?? "", inputs));
		else if (step.kind === "scroll" && step.selector === void 0 && (step.candidates?.length ?? 0) === 0) await page.mouse.wheel(0, step.deltaY ?? 0);
		else {
			let resolved;
			try {
				resolved = await resolveTarget(page, step, timeoutMs);
			} catch (error) {
				const at = typeof step.at === "string" && /^https?:\/\//.test(step.at) ? step.at : void 0;
				if (at === void 0 || page.url() === at) throw error;
				await page.goto(at, {
					waitUntil: "domcontentloaded",
					timeout: timeoutMs
				});
				resolved = await resolveTarget(page, step, timeoutMs);
			}
			result.target = resolved.selector;
			const timeout = Math.max(500, timeoutMs - (Date.now() - startedAt));
			if (step.kind === "click") {
				if (step.clickPoint === void 0) {
					await highlightLocator(page, resolved.locator, highlightClicks);
					await resolved.locator.click({ timeout });
				} else if (await resolved.locator.evaluate((el) => el.tagName === "CANVAS").catch(() => false)) await clickLocatorPoint(page, resolved.locator, step.clickPoint, highlightClicks);
				else try {
					await highlightLocator(page, resolved.locator, highlightClicks);
					await resolved.locator.click({ timeout });
				} catch (error) {
					await clickLocatorPoint(page, resolved.locator, step.clickPoint, highlightClicks).catch(() => {
						throw error;
					});
				}
			} else if (step.kind === "fill") await resolved.locator.fill(substituteInputs(step.value ?? "", inputs), { timeout });
			else if (step.kind === "select") await resolved.locator.selectOption(substituteInputs(step.value ?? "", inputs), { timeout });
			else if (step.kind === "press") await resolved.locator.press(substituteInputs(step.key ?? "", inputs), { timeout });
			else if (step.kind === "submit") await resolved.locator.evaluate((form) => {
				const target = form;
				if (typeof target.requestSubmit === "function") target.requestSubmit();
			});
			else if (step.kind === "upload") {
				const files = (step.files ?? []).map((file) => substituteInputs(file, inputs));
				await resolved.locator.setInputFiles(files, { timeout });
			} else if (step.kind === "scroll") await resolved.locator.scrollIntoViewIfNeeded({ timeout });
		}
		for (const expect of step.expect ?? []) {
			const assertion = await runExpect$1(page, expect, timeoutMs);
			result.assertions.push(assertion);
			emit({
				event: "assert",
				stepId: step.id,
				kind: assertion.kind,
				status: assertion.ok ? "ok" : "error",
				...assertion.selector === void 0 ? {} : { selector: assertion.selector },
				...assertion.expected === void 0 ? {} : { expected: assertion.expected },
				...assertion.actual === void 0 ? {} : { actual: assertion.actual },
				elapsed: assertion.elapsedMs,
				...assertion.error === void 0 ? {} : { error: assertion.error }
			});
			if (!assertion.ok) {
				result.error = `断言失败：${assertion.error ?? "未知原因"}`;
				result.elapsedMs = Date.now() - startedAt;
				return result;
			}
		}
		result.ok = true;
		result.elapsedMs = Date.now() - startedAt;
		return result;
	} catch (error) {
		result.error = String(error?.message ?? error).slice(0, 800);
		result.elapsedMs = Date.now() - startedAt;
		return result;
	} finally {
		emit({
			event: "step",
			id: step.id,
			kind: step.kind,
			status: result.ok ? "done" : "error",
			elapsed: result.elapsedMs,
			...result.target === void 0 ? {} : { target: result.target },
			...result.error === void 0 ? {} : { error: result.error }
		});
	}
}
/** 目标解析：候选链里找第一个"当前唯一命中"的元素，找不到就给全部候选的失败说明。 */
async function resolveTarget(page, step, timeoutMs) {
	const candidates = buildCandidates(step);
	if (candidates.length === 0) throw new Error(`${step.kind} 步骤没有 selector/candidates`);
	const deadline = Date.now() + timeoutMs;
	const attempts = [];
	for (const candidate of candidates) {
		const locator = page.locator(candidate);
		try {
			const count = await waitForPresent(locator, Math.max(1e3, Math.floor(timeoutMs / candidates.length)));
			if (count === 1) return {
				locator,
				selector: candidate
			};
			attempts.push(`${candidate}（命中 ${count} 个，需唯一）`);
		} catch (error) {
			attempts.push(`${candidate}（${String(error?.message ?? error).slice(0, 120)}）`);
		}
		if (Date.now() > deadline) break;
	}
	throw new Error(`找不到唯一命中元素：${attempts.join("；")}`);
}
function buildCandidates(step) {
	const out = [];
	if (step.selector !== void 0) out.push(step.selector);
	for (const candidate of step.candidates ?? []) if (!out.includes(candidate)) out.push(candidate);
	for (const candidate of featureCandidates(step.features)) if (!out.includes(candidate)) out.push(candidate);
	const name = step.clickPoint?.name;
	if (name !== void 0 && name !== "") {
		const text = `text="${name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
		if (!out.includes(text)) out.push(text);
	}
	return out;
}
/**
* 轮询等待元素出现（命中数 ≥1 就返回；返回 0 = 超时）。
*
* 命中数 >1 说明选择器有歧义，交给调用方换下一个候选——不在这里等"变成 1"，
* 那只会白等到超时。
*/
async function waitForPresent(locator, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const count = await locator.count().catch(() => 0);
		if (count >= 1) return count;
		if (Date.now() >= deadline) return 0;
		await sleep$2(80);
	}
}
/** 断言：轮询到步骤超时，失败时带实际值（截断）作为证据。 */
async function runExpect$1(page, expect, timeoutMs) {
	const startedAt = Date.now();
	const deadline = startedAt + timeoutMs;
	const selector = expect.selector;
	const expectedText = expect.equals === void 0 ? expect.contains : String(expect.equals);
	const result = {
		kind: expect.kind,
		...selector === void 0 ? {} : { selector },
		ok: false,
		elapsedMs: 0,
		...expectedText === void 0 ? {} : { expected: expectedText }
	};
	const locator = selector === void 0 ? void 0 : page.locator(selector);
	let actual = "";
	for (;;) {
		try {
			const verdict = await evaluateExpect(page, expect, locator);
			actual = verdict.actual;
			if (verdict.ok) {
				result.ok = true;
				result.elapsedMs = Date.now() - startedAt;
				return result;
			}
		} catch (error) {
			actual = String(error?.message ?? error).slice(0, 300);
		}
		if (Date.now() >= deadline) break;
		await sleep$2(80);
	}
	result.elapsedMs = Date.now() - startedAt;
	result.actual = actual.slice(0, 500);
	result.error = expect.kind === "url" ? `URL 期望 ${expect.equals === void 0 ? `包含 ${String(expect.contains)}` : `等于 ${String(expect.equals)}`}，实际 ${actual.slice(0, 200)}` : expect.kind === "count" ? `元素数期望 ${String(expect.equals)}，实际 ${actual}` : expect.kind === "visible" || expect.kind === "hidden" ? `元素可见性期望 ${expect.kind}，实际不满足（${selector ?? "?"}）` : `期望 ${expectedText ?? ""}，实际 ${actual.slice(0, 200)}`;
	return result;
}
async function evaluateExpect(page, expect, locator) {
	if (expect.kind === "url") {
		const url = page.url();
		return {
			ok: expect.equals !== void 0 ? url === String(expect.equals) : url.includes(expect.contains ?? ""),
			actual: url
		};
	}
	if (locator === void 0) throw new Error("断言缺 selector");
	if (expect.kind === "count") {
		const count = await locator.count();
		return {
			ok: count === Number(expect.equals),
			actual: String(count)
		};
	}
	if (expect.kind === "visible") {
		const visible = await locator.first().isVisible().catch(() => false);
		return {
			ok: visible,
			actual: visible ? "visible" : "hidden"
		};
	}
	if (expect.kind === "hidden") {
		const visible = await locator.first().isVisible().catch(() => false);
		return {
			ok: !visible,
			actual: visible ? "visible" : "hidden"
		};
	}
	if (expect.kind === "value") {
		const value = await locator.first().inputValue().catch(() => "");
		return {
			ok: expect.equals !== void 0 ? value === String(expect.equals) : value.includes(expect.contains ?? ""),
			actual: value
		};
	}
	const normalized = (await locator.first().innerText().catch(() => "") || "").replace(/\s+/g, " ").trim();
	return {
		ok: expect.equals !== void 0 ? normalized === String(expect.equals) : normalized.includes(expect.contains ?? ""),
		actual: normalized
	};
}
/** 成功证据：末态截图（写不进去不阻断结果，如实不带路径）。 */
async function captureSuccess(page, dataRoot, runId) {
	const target = join(uiRunDir(dataRoot, runId), "success.png");
	try {
		await page.screenshot({
			path: target,
			fullPage: false,
			timeout: 1e4
		});
		return existsSync(target) ? { screenshot: join("ui-runs", runId, "success.png") } : {};
	} catch {
		return {};
	}
}
/** 失败证据：截图 + 现场 HTML（写不进去不阻断结果，如实不带路径）。 */
async function captureFailure$1(page, dataRoot, runId) {
	const dir = uiRunDir(dataRoot, runId);
	const evidence = {};
	try {
		await page.screenshot({
			path: join(dir, "failure.png"),
			fullPage: false,
			timeout: 1e4
		});
		evidence.screenshot = join("ui-runs", runId, "failure.png");
	} catch {}
	try {
		const html = await page.content();
		writeFileSync(join(dir, "failure.html"), html.slice(0, 2097152), "utf8");
		evidence.dom = join("ui-runs", runId, "failure.html");
	} catch {}
	return evidence;
}
function sleep$2(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

//#endregion
//#region src/uitest/batch-store.ts
/**
* UI 批量回放留痕：`dataRoot/ui-batches/<batchId>/`。
*
* 与单次运行（`ui-runs/`）分目录：
*   - 单次运行回答「这条脚本哪一步断了」；
*   - 批次回答「这一轮回归整体过没过、报告在哪」。
* 报告同时落 `report.md`（人看）与 `report.json`（CI/后续工具消费），
* 两者都由 `batch.json` 的 items 生成，不引入第二份事实源。
*
* @module dsh-dataforge/uitest/batch-store
*/
/** 批次根目录。 */
function uiBatchesRoot(dataRoot) {
	return join(dataRoot, "ui-batches");
}
/** 单批次目录。 */
function uiBatchDir(dataRoot, batchId) {
	return join(uiBatchesRoot(dataRoot), batchId);
}
/** 新建批次目录 + 初始 batch.json；返回目录。 */
function startUiBatch(dataRoot, batchId, meta) {
	const dir = uiBatchDir(dataRoot, batchId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "batch.json"), JSON.stringify({
		batchId,
		status: "running",
		startedAt: Date.now(),
		...meta
	}, null, 2), "utf8");
	return dir;
}
/** 读 batch.json；坏文件/不存在 → undefined。 */
function readUiBatch(dataRoot, batchId) {
	const path = join(uiBatchDir(dataRoot, batchId), "batch.json");
	if (!existsSync(path)) return void 0;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
		return parsed;
	} catch {
		return;
	}
}
/** 合并写 batch.json（执行完写终态）。 */
function finishUiBatch(dataRoot, batchId, patch) {
	const current = readUiBatch(dataRoot, batchId);
	if (current === void 0) return void 0;
	const next = {
		...current,
		...patch
	};
	writeFileSync(join(uiBatchDir(dataRoot, batchId), "batch.json"), JSON.stringify(next, null, 2), "utf8");
	return next;
}
/** 列最近批次（按目录名倒序 = 创建时间倒序）。 */
function listUiBatches(dataRoot, limit = 20) {
	const root = uiBatchesRoot(dataRoot);
	if (!existsSync(root)) return [];
	const dirs = readdirSync(root).filter((entry) => {
		try {
			return statSync(join(root, entry)).isDirectory();
		} catch {
			return false;
		}
	}).sort().reverse().slice(0, Math.max(1, limit));
	const records = [];
	for (const dir of dirs) {
		const record = readUiBatch(dataRoot, dir);
		if (record !== void 0) records.push(record);
	}
	return records;
}
/** 报告文件白名单解析（面板/工具读取出口）。 */
function batchReportPath(dataRoot, batchId, format) {
	if (!/^[A-Za-z0-9_-]{1,80}$/.test(batchId)) return void 0;
	const name = format === "md" ? "report.md" : "report.json";
	const path = join(uiBatchDir(dataRoot, batchId), name);
	return existsSync(path) ? path : void 0;
}
/**
* 生成并落盘报告（md + json），返回相对 dataRoot 的路径。
*
* md 是给人/PR 贴的；json 给 CI 判断退出码与看明细。
*/
function writeUiBatchReport(dataRoot, record) {
	const dir = uiBatchDir(dataRoot, record.batchId);
	const finishedAt = record.finishedAt ?? Date.now();
	const summary = {
		batchId: record.batchId,
		generatedAt: new Date(finishedAt).toISOString(),
		selection: record.selection,
		...record.site === void 0 ? {} : { site: record.site },
		total: record.total,
		passed: record.passed,
		failed: record.failed,
		skipped: record.skipped,
		elapsedMs: record.elapsedMs ?? 0,
		success: record.failed === 0,
		items: record.items
	};
	const lines = [
		"# UI 批量回归报告",
		"",
		`- 批次：\`${record.batchId}\``,
		`- 时间：${summary.generatedAt}`,
		`- 范围：${record.selection === "all" ? "全部脚本" : record.selection === "site" ? `站点 ${record.site ?? ""}` : "指定流程"}`,
		`- 结果：**${record.passed} 通过 / ${record.failed} 失败 / ${record.skipped} 跳过**（共 ${record.total}，${Math.round((record.elapsedMs ?? 0) / 1e3)}s）`,
		"",
		"| # | 站点 / 流程 | 版本 | 步骤 | 结果 | 耗时 | 失败点 / 原因 |",
		"|---|---|---|---|---|---|---|"
	];
	for (const item of record.items) {
		const version = item.version === void 0 ? "—" : `v${item.version}`;
		const steps = item.totalSteps === void 0 ? "—" : `${item.stepsDone ?? 0}/${item.totalSteps}`;
		const elapsed = item.elapsedMs === void 0 ? "—" : `${item.elapsedMs}ms`;
		const verdict = item.skipped === true ? "⏭ 跳过" : item.success ? "✅ 通过" : "❌ 失败";
		const reason = item.error === void 0 ? "" : item.error.replace(/\|/g, "\\|").replace(/\n/g, " ");
		lines.push(`| ${item.index + 1} | ${item.site} / ${item.flow} | ${version} | ${steps} | ${verdict} | ${elapsed} | ${reason} |`);
	}
	const failures = record.items.filter((item) => item.success !== true);
	if (failures.length > 0) {
		lines.push("", "## 失败证据", "");
		for (const item of failures) {
			if (item.runId === void 0) {
				lines.push(`- ${item.site} / ${item.flow}：${item.error ?? "未执行"}（未产生运行记录）`);
				continue;
			}
			lines.push(`- ${item.site} / ${item.flow}（run \`${item.runId}\`）${item.failedStep === void 0 ? "" : `断在 ${item.failedStep}`}${item.screenshot === void 0 ? "" : `；截图 \`${item.screenshot}\``}`);
		}
	}
	lines.push("");
	writeFileSync(join(dir, "report.md"), lines.join("\n"), "utf8");
	writeFileSync(join(dir, "report.json"), JSON.stringify(summary, null, 2), "utf8");
	return {
		report: join("ui-batches", record.batchId, "report.md"),
		reportJson: join("ui-batches", record.batchId, "report.json")
	};
}

//#endregion
//#region src/uitest/batch.ts
/**
* UI 批量回归：选脚本 → 逐条回放 → 汇总通过/失败 → 落报告。
*
* 与单次 `runUiScript` 的关系：批次不重新实现回放，只做「选哪些、按什么顺序、怎么汇总」；
* 每条脚本的回放/断言/截图/run 留痕完全复用单次执行（runId 一一对应）。
*
* 为什么默认串行：一个 Chrome 实例 = 一份内存/CPU；并发回放很容易把同一台机器打满，
* 而 UI 回归的价值在"稳定"不在"快"。并发留给后续版本（要配合队列与资源上限）。
*
* 设计取舍：缺必填入参的脚本**不静默跳过**——在计划卡里列出，执行时记 `skipped + 原因`，
* 最终计入 failed/skipped 而不是从总数里消失。
*
* @module dsh-dataforge/uitest/batch
*/
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** `site/flow` 或 `site/flow@3` → {site, flow, version?}（站点名里可能有空格，取最后一个 `/`）。 */
function parseFlowRef(text) {
	const trimmed = text.trim();
	if (trimmed === "") return void 0;
	const at = trimmed.lastIndexOf("@");
	let version;
	let base = trimmed;
	if (at > 0) {
		const parsed = Number(trimmed.slice(at + 1));
		if (Number.isInteger(parsed) && parsed >= 1) {
			version = parsed;
			base = trimmed.slice(0, at);
		}
	}
	const slash = base.lastIndexOf("/");
	if (slash <= 0 || slash === base.length - 1) return void 0;
	return {
		site: base.slice(0, slash).trim(),
		flow: base.slice(slash + 1).trim(),
		...version === void 0 ? {} : { version }
	};
}
function normalizeInputs(raw) {
	if (raw === void 0) return {};
	const out = {};
	for (const [key, value] of Object.entries(raw)) if (typeof value === "string") out[key] = value;
	else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
	return out;
}
/**
* 选脚本并生成计划（不跑浏览器）。
*
* 缺参/坏文件不抛，写进条目的 `missing` / `error`，由执行阶段记为跳过/失败——
* 计划卡里先让用户看到"这轮会跑什么、哪些跑不了"。
*/
function planUiBatch(workspaceRoot, args, inputsOverride) {
	const inputs = normalizeInputs(inputsOverride ?? args.inputs);
	const limit = Math.min(Math.max(Math.floor(args.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
	const refs = [];
	let selection = "all";
	const flowArgs = (args.flows ?? []).map((item) => item.trim()).filter((item) => item !== "");
	if (flowArgs.length > 0) {
		selection = "flows";
		for (const text of flowArgs) {
			const parsed = parseFlowRef(text);
			if (parsed === void 0) return {
				ok: false,
				message: `flows 里的条目格式不对：${text}（应为 site/flow 或 site/flow@3）`
			};
			refs.push(parsed);
		}
	} else if (args.site !== void 0 && args.site.trim() !== "") {
		selection = "site";
		for (const script of listUiScripts(workspaceRoot)) {
			if (script.site !== args.site.trim()) continue;
			refs.push({
				site: script.site,
				flow: script.flow,
				version: script.latest
			});
		}
	} else for (const script of listUiScripts(workspaceRoot)) refs.push({
		site: script.site,
		flow: script.flow,
		version: script.latest
	});
	const limited = refs.slice(0, limit);
	const entries = [];
	const missingUnion = [];
	let writeSteps = 0;
	for (const [index, ref] of limited.entries()) {
		const loaded = loadUiScript(workspaceRoot, ref.site, ref.flow, ref.version);
		if (!loaded.ok) {
			entries.push({
				item: {
					index,
					site: ref.site,
					flow: ref.flow,
					...ref.version === void 0 ? {} : { version: ref.version },
					stepCount: 0,
					writeSteps: 0,
					missing: [],
					error: loaded.message
				},
				inputs
			});
			continue;
		}
		const doc = loaded.doc;
		const missing = missingInputsOf(doc, inputs);
		const item = {
			index,
			site: doc.meta.site,
			flow: doc.meta.flow,
			version: loaded.version,
			stepCount: doc.steps.length,
			writeSteps: doc.steps.filter((step) => step.kind === "click" || step.kind === "submit" || step.kind === "upload").length,
			missing
		};
		for (const name of missing) if (!missingUnion.includes(name)) missingUnion.push(name);
		writeSteps += item.writeSteps;
		entries.push({
			item,
			doc,
			inputs
		});
	}
	return {
		ok: true,
		entries,
		plan: {
			selection,
			...args.site === void 0 || args.site.trim() === "" || selection !== "site" ? {} : { site: args.site.trim() },
			total: entries.length,
			limit,
			items: entries.map((entry) => entry.item),
			missingInputs: missingUnion,
			writeSteps
		}
	};
}
/**
* 执行计划：逐条调用 `deps.run`，汇总后写 batch.json + report.md/json。
*
* 某条脚本回放抛错不会中断整批（捕获成该条失败）；预检失败（缺参/脚本坏）不跑浏览器。
*/
async function executeUiBatch(deps, planned) {
	const startedAt = Date.now();
	const batchId = `uibatch_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	const items = [];
	startUiBatch(deps.dataRoot, batchId, {
		selection: planned.plan.selection,
		...planned.plan.site === void 0 ? {} : { site: planned.plan.site },
		total: planned.entries.length,
		passed: 0,
		failed: 0,
		skipped: 0,
		items: []
	});
	for (const entry of planned.entries) {
		const { item, doc, inputs } = entry;
		const base = {
			index: item.index,
			site: item.site,
			flow: item.flow,
			...item.version === void 0 ? {} : { version: item.version },
			success: false
		};
		if (item.error !== void 0 || item.missing.length > 0 || doc === void 0) {
			const reason = item.error ?? `缺必填入参：${item.missing.join("、")}`;
			items.push({
				...base,
				skipped: true,
				error: reason
			});
			continue;
		}
		try {
			const run = await deps.run(doc, inputs);
			items.push({
				...base,
				runId: run.runId,
				success: run.success,
				stepsDone: run.stepsDone,
				totalSteps: run.totalSteps,
				...run.failedStep === void 0 ? {} : { failedStep: run.failedStep.id },
				...run.screenshot === void 0 ? {} : { screenshot: run.screenshot },
				...run.error === void 0 ? {} : { error: run.error },
				elapsedMs: run.elapsedMs
			});
		} catch (error) {
			items.push({
				...base,
				error: String(error?.message ?? error).slice(0, 800)
			});
		}
	}
	const passed = items.filter((item) => item.success).length;
	const failed = items.filter((item) => item.success !== true && item.skipped !== true).length;
	const skipped = items.filter((item) => item.skipped === true).length;
	const elapsedMs = Date.now() - startedAt;
	const record = finishUiBatch(deps.dataRoot, batchId, {
		status: "done",
		finishedAt: Date.now(),
		total: items.length,
		passed,
		failed,
		skipped,
		elapsedMs,
		items
	});
	if (record === void 0) throw new Error(`批次 ${batchId} 的 batch.json 写入失败`);
	const paths = writeUiBatchReport(deps.dataRoot, record);
	finishUiBatch(deps.dataRoot, batchId, paths);
	return {
		batchId,
		selection: record.selection,
		...record.site === void 0 ? {} : { site: record.site },
		total: items.length,
		passed,
		failed,
		skipped,
		elapsedMs,
		items,
		report: paths.report,
		reportJson: paths.reportJson
	};
}

//#endregion
//#region src/uitest/naming.ts
function cleanText(value) {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
/** hostname（去 www.、去端口、去末尾点）。非法 URL 返回空串。 */
function hostOfUrl(url) {
	if (url === void 0 || url === "") return "";
	try {
		return new URL(url).hostname.replace(/^www\./i, "").replace(/\.$/, "");
	} catch {
		return "";
	}
}
/** 站点名：og:site_name 优先，其次 hostname。 */
function suggestSiteName(meta) {
	const siteName = cleanText(meta.siteName);
	if (siteName !== "") return siteName.slice(0, 80);
	return hostOfUrl(meta.url).slice(0, 80);
}
const TITLE_SEPARATORS = /\s*[-–—|·•/]\s*/g;
/** 去掉标题里重复的站点名与首尾分隔符。 */
function stripSiteFromTitle(title, siteName) {
	let text = title;
	if (siteName !== "") text = text.replace(new RegExp(siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
	text = text.split(TITLE_SEPARATORS).map((part) => part.trim()).filter((part) => part !== "").join(" - ");
	return text.replace(/^[\s\-–—|·•/]+|[\s\-–—|·•/]+$/g, "").trim();
}
/** URL 最后一个有意义路径段（跳过纯数字/扩展名/id 形式的段）。 */
function lastPathSegment(url) {
	if (url === void 0 || url === "") return "";
	try {
		const segments = new URL(url).pathname.split("/").map((part) => decodeURIComponent(part).trim()).filter((part) => part !== "");
		for (let i = segments.length - 1; i >= 0; i -= 1) {
			const segment = segments[i];
			if (/^\d+$/.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment)) continue;
			return segment.replace(/\.[a-z0-9]{1,6}$/i, "");
		}
		return "";
	} catch {
		return "";
	}
}
/** 流程名：页面标题 → 路径段 → `录制-MMDD-HHmm` 兜底。 */
function suggestFlowName(meta, now = /* @__PURE__ */ new Date()) {
	const siteName = cleanText(meta.siteName);
	const fromTitle = stripSiteFromTitle(cleanText(meta.title), siteName !== "" ? siteName : hostOfUrl(meta.url));
	const cleaned = (fromTitle !== "" ? fromTitle : lastPathSegment(meta.url)).replace(/\s+/g, " ").trim().slice(0, 60);
	if (cleaned !== "") return cleaned;
	const pad = (value) => String(value).padStart(2, "0");
	return `录制-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}
/** 一次生成站点/流程（只在调用方没有显式给名字时用）。 */
function autoNameFor(meta, now = /* @__PURE__ */ new Date()) {
	return {
		site: suggestSiteName(meta),
		flow: suggestFlowName(meta, now)
	};
}

//#endregion
//#region src/uitest/application.ts
/**
* UI 测试域的应用层：录制生命周期、脚本读写、回放闸门与回执折叠。
*
* 分层与编排域一致：工具壳（`src/tools.ts`）只声明参数/渲染回执，判定与 IO 都在这里，
* 面板路由复用同一批函数（不重新实现闸门）。
*
* 三道闸（沿用链路执行纪律，不另造一套）：
*   1. 必填：脚本声明的 required 入参缺一即 `missing-inputs`，一个请求/浏览器都不起；
*   2. 确认：不带 confirm 只给计划卡（步骤 + 写操作数 + 起点 host），不起浏览器；
*   3. 开关：`uiTestEnabled=false` 时一律 `ui-test-disabled`（脚本读写/历史回看照常）。
*
* 凭证纪律：录制结束把会话 cookie 写进本地凭证 jar（0600、按 origin 隔离），回放按起点域名
* 读回；cookie 值只在内存/context 里过手，事件、回执、摘要只有条数。
*
* @module dsh-dataforge/uitest/application
*/
async function workspaceOf(deps, exec) {
	return await deps.resolveWorkspaceRoot(exec) ?? process.cwd();
}
function messageOf$4(error) {
	return (error instanceof Error ? error.message : String(error)).slice(0, 1e3);
}
/**
* 读脚本：给 site+flow 回详情（缺省最新版本），否则回列表。
*
* `yaml: true` 时详情附 YAML 原文（agent 要改脚本时先读原文，避免重写丢字段）。
*/
async function getUiScriptForTool(deps, exec, args) {
	const workspaceRoot = await workspaceOf(deps, exec);
	const site = args.site?.trim();
	const flow = args.flow?.trim();
	if (site === void 0 || site === "" || flow === void 0 || flow === "") return {
		ok: true,
		scripts: listUiScripts(workspaceRoot)
	};
	const loaded = loadUiScript(workspaceRoot, site, flow, args.version);
	if (!loaded.ok) return {
		ok: false,
		code: loaded.code,
		message: loaded.message,
		availableVersions: loaded.availableVersions,
		...loaded.issues === void 0 ? {} : { issues: loaded.issues }
	};
	return {
		ok: true,
		site,
		flow,
		version: loaded.version,
		availableVersions: loaded.availableVersions,
		yaml: loaded.yaml,
		doc: loaded.doc
	};
}
/** agent 手写/导入脚本：YAML 进、校验过才落新版本。 */
async function upsertUiScriptForTool(deps, exec, args) {
	const workspaceRoot = await workspaceOf(deps, exec);
	let parsed;
	try {
		parsed = parseUiScriptDoc(safeYaml(args.yaml));
	} catch (error) {
		return {
			ok: false,
			message: messageOf$4(error)
		};
	}
	if (!parsed.ok) return {
		ok: false,
		message: `脚本未通过校验：${formatUiIssues(parsed.issues)}`,
		issues: parsed.issues
	};
	const saved = saveUiScript(workspaceRoot, parsed.doc, { source: args.source ?? "agent" });
	if (!saved.ok) return {
		ok: false,
		issues: saved.issues,
		message: `脚本未通过校验：${formatUiIssues(saved.issues)}`
	};
	return {
		ok: true,
		site: saved.doc.meta.site,
		flow: saved.doc.meta.flow,
		version: saved.version,
		path: saved.path
	};
}
function safeYaml(text) {
	try {
		return parseYaml(text);
	} catch (error) {
		throw new Error(`YAML 解析失败：${messageOf$4(error)}`);
	}
}
function parseYaml(text) {
	return loadYamlValue(text);
}
/**
* 打开一个可见 Chrome（不开始录制）：先让用户登录/导航到起点，再 start。
*
* 为什么分成 open/start 两步：登录动作不该进脚本。用户先登录，再点"开始录制"，
* 脚本里就只剩业务操作；回放靠录制时持久化的 cookie 直接进登录态。
*/
async function openRecordingForTool(deps, args) {
	let url;
	try {
		const parsed = new URL(args.startUrl);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
		url = parsed.toString();
	} catch {
		return {
			ok: false,
			error: `startUrl 必须是 http/https 的合法 URL：${args.startUrl}`
		};
	}
	const selection = deps.resolveEngine();
	const engine = selection.engine;
	if (!engine.available()) return {
		ok: false,
		error: `浏览器引擎 ${engine.label} 不可用：${selection.degraded ?? "宿主未提供共享浏览器（安装/启用 dsh-builtin-browser 或把 uiTestBrowser 设为 playwright）"}`
	};
	const cookies = engine.managesCookies ? void 0 : await loadCookiesForStart(deps, url);
	const opened = await engine.open({
		startUrl: url,
		...args.headless === void 0 ? {} : { headless: args.headless },
		...cookies === void 0 ? {} : { cookies },
		...args.ownerSessionId === void 0 || args.ownerSessionId === "" ? {} : { owner: args.ownerSessionId }
	});
	if (!opened.ok) return {
		ok: false,
		error: opened.error
	};
	const meta = opened.sessionId === void 0 ? {} : await engine.pageMeta(opened.sessionId).catch(() => ({}));
	const suggestedSite = suggestSiteName(meta);
	const suggestedFlow = suggestFlowName(meta);
	return {
		ok: true,
		sessionId: opened.sessionId,
		pageUrl: opened.pageUrl,
		engine: engine.kind,
		...suggestedSite === "" ? {} : { suggestedSite },
		...suggestedFlow === "" ? {} : { suggestedFlow },
		notice: engine.kind === "shared" ? "共享浏览器已打开（未开始录制）：页面在该对话的右侧栏浏览器面板里——没看到就点会话右上角的展开侧栏按钮。站点名/流程名留空会自动命名。" : "浏览器已打开（未开始录制）：先完成登录/导航，再开始录制；站点名/流程名留空会自动命名。"
	};
}
async function startRecordingForTool(deps, args) {
	const { engine } = deps.resolveEngine();
	if (!engine.available()) return {
		ok: false,
		error: `浏览器引擎 ${engine.label} 不可用`
	};
	const started = await engine.start(args.sessionId);
	if (!started.ok) return {
		ok: false,
		error: started.error
	};
	return {
		ok: true,
		sessionId: args.sessionId,
		pageUrl: started.pageUrl,
		...started.alreadyRecording === true ? { alreadyRecording: true } : {}
	};
}
/**
* 停止录制：生成步骤 → 持久化会话 cookie → （可选）落新脚本版本。
*
* 没给 site/flow 就只回步骤（agent 先看再决定怎么落盘）；给了默认保存。
* 空步骤不落盘（脚本 schema 要求至少 1 步），如实回 notice。
*/
async function stopRecordingForTool(deps, exec, args) {
	const { engine } = deps.resolveEngine();
	if (!engine.available()) return {
		ok: false,
		sessionId: args.sessionId,
		error: `浏览器引擎 ${engine.label} 不可用`
	};
	const stopped = await engine.stop(args.sessionId);
	if (!stopped.ok || stopped.result === void 0) return {
		ok: false,
		sessionId: args.sessionId,
		error: stopped.error ?? "没有录到步骤"
	};
	const result = stopped.result;
	const persistedCookies = engine.managesCookies ? void 0 : await persistSessionCookies(deps, engine, args.sessionId);
	const base = {
		ok: true,
		sessionId: args.sessionId,
		startUrl: result.startUrl,
		steps: result.steps,
		stepCount: result.steps.length,
		skippedSecrets: result.skippedSecrets,
		skippedUploads: result.skippedUploads,
		...result.notice === void 0 ? {} : { notice: result.notice },
		...persistedCookies === void 0 ? {} : { persistedCookies }
	};
	let site = args.site?.trim();
	let flow = args.flow?.trim();
	const save = args.save ?? true;
	let autoNamed = false;
	if (save && result.steps.length > 0 && (site === void 0 || site === "" || flow === void 0 || flow === "")) {
		const meta = await engine.pageMeta(args.sessionId).catch(() => ({}));
		const auto = autoNameFor(meta);
		if (site === void 0 || site === "") {
			site = auto.site === "" ? "未命名站点" : auto.site;
			autoNamed = true;
		}
		if (flow === void 0 || flow === "") {
			flow = auto.flow;
			autoNamed = true;
		}
	}
	if (save && site !== void 0 && site !== "" && flow !== void 0 && flow !== "" && result.steps.length > 0) {
		const saved = saveUiScript(await workspaceOf(deps, exec), {
			apiVersion: "dataforge/v1",
			kind: "ui-script",
			meta: {
				site,
				flow,
				version: 1,
				created: (/* @__PURE__ */ new Date()).toISOString(),
				source: "record",
				startUrl: result.startUrl,
				viewport: result.viewport,
				...args.domain === void 0 || args.domain.trim() === "" ? {} : { domain: args.domain.trim() },
				...args.note === void 0 || args.note.trim() === "" ? {} : { note: args.note.trim() }
			},
			inputs: [],
			steps: result.steps
		}, { source: "record" });
		if (saved.ok) {
			base.saved = {
				site: saved.doc.meta.site,
				flow: saved.doc.meta.flow,
				version: saved.version,
				path: saved.path
			};
			if (autoNamed) base.notice = [base.notice, `站点/流程名留空，已自动命名：${saved.doc.meta.site} / ${saved.doc.meta.flow}（可在脚本 YAML 里改）`].filter((item) => item !== void 0 && item !== "").join("；");
		} else base.notice = [base.notice, `脚本未保存：${formatUiIssues(saved.issues)}`].filter((item) => item !== void 0 && item !== "").join("；");
	} else if (save && result.steps.length === 0) base.notice = [base.notice, "没有可保存的步骤（未落盘）"].filter((item) => item !== void 0 && item !== "").join("；");
	return base;
}
/** 关闭录制会话回执。 */
async function closeRecordingForTool(deps, args) {
	const { engine } = deps.resolveEngine();
	return (await engine.close(args.sessionId)).ok ? { ok: true } : {
		ok: false,
		error: `会话 ${args.sessionId} 不存在或已关闭`
	};
}
/** 录制会话列表（面板轮询用）。 */
function recordingSessionsOf(deps) {
	return deps.resolveEngine().engine.list();
}
/** 在录制会话页面上点选一个元素（面板补断言/改步骤用；agent 无此工具，避免误触）。 */
async function pickSelectorForTool(deps, args) {
	return deps.resolveEngine().engine.pickSelector(args.sessionId, args.timeoutMs);
}
/**
* 打开 AI 代办录制会话（可见 Chrome，人能围观/随时接管）。
*
* 三道闸之闸2：不带 confirm 只回计划卡（任务/起点/密钥键名/写操作提示），
* 一个浏览器都不起；确认后才真开。AI 随后用 agent_act 自主操作，动作同步录步。
*
* 引擎说明：代办录制用自己的浏览器工厂（AgentRecordingSessions，playwright-core +
* 系统 Chrome），与 uiTestBrowser 配置的录制/回放引擎相互独立——shared 引擎下
* 人录走侧栏共享浏览器，代办录制仍拉自己的可见窗口，互不影响。
*/
async function openAgentSessionForTool(deps, exec, args) {
	const task = args.task.trim();
	if (task === "") return {
		ok: false,
		error: "task 不能为空：写清楚要 AI 完成什么（审查比对的基准）"
	};
	let url;
	try {
		const parsed = new URL(args.startUrl);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
		url = parsed.toString();
	} catch {
		return {
			ok: false,
			error: `startUrl 必须是 http/https 的合法 URL：${args.startUrl}`
		};
	}
	const headless = args.headless ?? false;
	const credentialKeys = Object.keys(deps.agentSecrets).sort();
	const card = [
		`🤖 AI 代办录制计划`,
		`任务：${task}`,
		`起点：${url}（${headless ? "无头" : "可见"} Chrome）`,
		credentialKeys.length > 0 ? `服务端密钥（valueFrom 可用键名）：${credentialKeys.join("、")}` : "未配置服务端密钥（uiAgentCredentials）：fill 只能给明文值，密码字段将无法执行",
		"⚠️ AI 将自主操作真实页面（点击/输入可能产生真实写入），期间检测到验证码会暂停叫人。",
		"确认后带 confirm=true 重调才会打开浏览器。"
	].join("\n");
	if (args.confirm !== true) return {
		ok: true,
		gate: "confirm-required",
		plan: {
			card,
			task,
			startUrl: url,
			headless,
			credentialKeys
		}
	};
	const cookies = await loadCookiesForStart(deps, url);
	const opened = await deps.agentSessions.open({
		startUrl: url,
		task,
		headless,
		cookies
	});
	if (!opened.ok) return {
		ok: false,
		error: opened.error
	};
	return {
		ok: true,
		sessionId: opened.sessionId,
		runId: opened.runId,
		pageUrl: opened.pageUrl,
		credentialKeys,
		notice: headless ? "会话已打开（无头）。建议可见窗口以便围观与人工过验证码；如要切换，关闭后重开。" : "会话已打开（可见 Chrome）：你可围观 AI 操作，随时人工接管；AI 应用 dataforge_ui_agent_act 逐步执行，动作会同步录成步骤。"
	};
}
/** 执行一个代办动作：动作进页面，步骤进缓冲；challenge 检测到就如实报（AI 应暂停叫人）。 */
async function agentActForTool(deps, args) {
	return deps.agentSessions.act(args.sessionId, args.act, deps.agentSecrets);
}
/**
* 停止代办录制：步骤缓冲 → ui-script v1（review=pending + 原始任务描述）→ cookie 落 jar → 关会话。
*
* 没录到步骤不落盘（如实回 notice）。站点/流程名留空时按当前页面自动命名（与录制器同口径）。
* 回放不消费 review：待审查版本确认前也可以直接回放，只是面板会一直挂「待审查」角标。
*/
async function stopAgentSessionForTool(deps, exec, args) {
	const steps = deps.agentSessions.stepsOf(args.sessionId);
	if (steps === void 0) return {
		ok: false,
		error: `会话 ${args.sessionId} 不存在（可能已关闭）`
	};
	const task = deps.agentSessions.taskOf(args.sessionId) ?? "";
	const startUrl = deps.agentSessions.startUrlOf(args.sessionId) ?? "";
	const viewport = deps.agentSessions.viewportOf(args.sessionId);
	const secretSlots = deps.agentSessions.secretSlotsOf(args.sessionId);
	if (steps.length === 0) {
		await deps.agentSessions.close(args.sessionId);
		return {
			ok: true,
			sessionId: args.sessionId,
			stepCount: 0,
			notice: "没有录到任何步骤（未落盘）"
		};
	}
	let site = args.site?.trim();
	let flow = args.flow?.trim();
	let autoNamed = false;
	if (site === void 0 || site === "" || flow === void 0 || flow === "") {
		const meta = await deps.agentSessions.pageMetaOf(args.sessionId).catch(() => ({}));
		const auto = autoNameFor(meta);
		if (site === void 0 || site === "") {
			site = auto.site === "" ? "未命名站点" : auto.site;
			autoNamed = true;
		}
		if (flow === void 0 || flow === "") {
			flow = auto.flow;
			autoNamed = true;
		}
	}
	const doc = {
		apiVersion: "dataforge/v1",
		kind: "ui-script",
		meta: {
			site,
			flow,
			version: 1,
			created: (/* @__PURE__ */ new Date()).toISOString(),
			source: "agent",
			startUrl,
			review: "pending",
			task,
			...viewport === void 0 ? {} : { viewport },
			...args.domain === void 0 || args.domain.trim() === "" ? {} : { domain: args.domain.trim() },
			...args.note === void 0 || args.note.trim() === "" ? {} : { note: args.note.trim() }
		},
		inputs: secretSlots.map((name) => ({
			name,
			type: "string",
			required: true,
			example: "回放时由人提供"
		})),
		steps
	};
	const saved = saveUiScript(await workspaceOf(deps, exec), doc, { source: "agent" });
	const persistedCookies = await persistCookiesOf(deps, await deps.agentSessions.cookiesOf(args.sessionId)).catch(() => void 0);
	await deps.agentSessions.close(args.sessionId);
	if (!saved.ok) return {
		ok: false,
		sessionId: args.sessionId,
		stepCount: steps.length,
		steps,
		persistedCookies,
		notice: `步骤已录到 ${steps.length} 条，但脚本未通过校验未落盘：${formatUiIssues(saved.issues)}`
	};
	return {
		ok: true,
		sessionId: args.sessionId,
		stepCount: steps.length,
		saved: {
			site: saved.doc.meta.site,
			flow: saved.doc.meta.flow,
			version: saved.version,
			path: saved.path,
			review: "pending"
		},
		persistedCookies,
		steps,
		notice: [
			`已落盘为 v${saved.version}（待审查）：人在面板比对任务描述与步骤，确认后转 confirmed。`,
			autoNamed ? `站点/流程名留空，已自动命名：${saved.doc.meta.site} / ${saved.doc.meta.flow}` : "",
			secretSlots.length > 0 ? `${secretSlots.length} 个字段经服务端密钥注入，已脱敏为入参槽位：${secretSlots.join("、")}（回放前提供）。` : "",
			"待审查不影响回放：确认前也可直接 dataforge_ui_run 验证。"
		].filter((item) => item !== "").join("；")
	};
}
/** 代办录制会话列表（面板轮询用）。 */
function agentSessionsOf(deps) {
	return deps.agentSessions.list();
}
/**
* 审查确认（面板用）：把指定版本确认为「与任务一致」。
*
* 版本不可变：确认不是改旧文件，而是落一个 review=confirmed 的新版本（沿用原 source/task）。
* 驳回不需要工具：人直接编辑步骤/断言后另存新版本即可（pending 角标随最新版本走）。
*/
async function confirmAgentReviewForTool(workspaceRoot, args) {
	const loaded = loadUiScript(workspaceRoot, args.site, args.flow, args.version);
	if (!loaded.ok) return {
		ok: false,
		error: loaded.message,
		availableVersions: loaded.availableVersions
	};
	const note = args.note?.trim();
	const doc = {
		...loaded.doc,
		meta: {
			...loaded.doc.meta,
			created: (/* @__PURE__ */ new Date()).toISOString(),
			review: "confirmed",
			...note === void 0 || note === "" ? {} : { note }
		}
	};
	const saved = saveUiScript(workspaceRoot, doc, { source: loaded.doc.meta.source });
	if (!saved.ok) return {
		ok: false,
		error: `确认版本未通过校验：${formatUiIssues(saved.issues)}`
	};
	return {
		ok: true,
		site: saved.doc.meta.site,
		flow: saved.doc.meta.flow,
		version: saved.version,
		review: "confirmed",
		message: `已确认：v${saved.version} 标记为 review=confirmed（任务：${saved.doc.meta.task ?? "（无）"}）`
	};
}
/**
* 回放一个脚本：三道闸 + 执行。
*
* 不带 confirm / dry_run=true 只回计划卡；带 confirm 才起浏览器。
* 写操作提示：click/submit/upload 可能产生业务写入，计划卡里如实计数，不替用户担保。
*/
async function runUiScriptForTool(deps, exec, args) {
	if (!deps.enabled) return {
		ok: false,
		gate: "ui-test-disabled",
		code: "ui-test-disabled",
		message: "UI 回放开关关闭（uiTestEnabled=false）：脚本读写与历史回看照常，回放不执行。"
	};
	const inputs = normalizeInputsMap(args.inputs);
	const workspaceRoot = await workspaceOf(deps, exec);
	const loaded = loadUiScript(workspaceRoot, args.site, args.flow, args.version);
	if (!loaded.ok) return {
		ok: false,
		gate: loaded.code,
		code: loaded.code,
		message: loaded.message,
		availableVersions: loaded.availableVersions,
		...loaded.issues === void 0 ? {} : { issues: loaded.issues }
	};
	const missing = missingInputsOf(loaded.doc, inputs);
	if (missing.length > 0) return {
		ok: false,
		gate: "missing-inputs",
		code: "missing-inputs",
		message: `缺必填入参：${missing.join("、")}`,
		missing
	};
	const plan = planUiRun(loaded.doc, inputs);
	const writeHint = plan.writeSteps > 0 ? `其中 ${plan.writeSteps} 步是 click/submit/upload，可能产生真实业务写入` : "没有写操作步骤（只读）";
	const card = [
		`🧪 UI 回放计划：${plan.site} / ${plan.flow} v${plan.version}`,
		`起点：${plan.startUrl}`,
		`步骤 ${plan.stepCount} 条（${writeHint}）`,
		...plan.steps.slice(0, 20).map((step, index) => `${index + 1}. ${step.kind}${step.target === void 0 ? "" : ` ${step.target}`}`),
		plan.steps.length > 20 ? `… 还有 ${plan.steps.length - 20} 步` : "",
		"确认后带 confirm=true 重调才会起浏览器。"
	].filter((line) => line !== "").join("\n");
	if (args.dryRun === true || args.confirm !== true) return {
		ok: true,
		gate: args.dryRun === true ? "dry-run" : "confirm-required",
		plan: {
			...plan,
			card
		}
	};
	const selection = deps.resolveEngine();
	const engine = selection.engine;
	if (!engine.available()) return {
		ok: false,
		gate: "ui-engine-unavailable",
		code: "ui-engine-unavailable",
		message: `浏览器引擎 ${engine.label} 不可用：${selection.degraded ?? "宿主未提供共享浏览器；请安装/启用 dsh-builtin-browser 或把 uiTestBrowser 设为 playwright"}`
	};
	const owner = args.ownerSessionId ?? ownerOf(exec);
	const result = await engine.run(loaded.doc, inputs, {
		...args.headless === void 0 ? {} : { headless: args.headless },
		...args.slowMoMs === void 0 ? {} : { slowMoMs: args.slowMoMs },
		...args.highlightClicks === void 0 ? {} : { highlightClicks: args.highlightClicks },
		holdMs: args.holdMs ?? 1200,
		...owner === void 0 ? {} : { owner }
	});
	return {
		ok: true,
		gate: "executed",
		plan: {
			...plan,
			card
		},
		result: {
			runId: result.runId,
			success: result.success,
			site: result.site,
			flow: result.flow,
			version: result.version,
			startUrl: result.startUrl,
			totalSteps: result.totalSteps,
			stepsDone: result.stepsDone,
			steps: result.steps,
			...result.failedStep === void 0 ? {} : { failedStep: result.failedStep },
			...result.screenshot === void 0 ? {} : { screenshot: result.screenshot },
			...result.dom === void 0 ? {} : { dom: result.dom },
			...result.error === void 0 ? {} : { error: result.error },
			elapsedMs: result.elapsedMs,
			cookiesApplied: result.cookiesApplied
		}
	};
}
function normalizeInputsMap(raw) {
	if (raw === void 0) return {};
	const out = {};
	for (const [key, value] of Object.entries(raw)) if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = String(value);
	return out;
}
function runRowOf(record) {
	return {
		runId: record.runId,
		status: record.status,
		site: record.site,
		flow: record.flow,
		version: record.version,
		startUrl: record.startUrl,
		startedAt: record.startedAt,
		...record.finishedAt === void 0 ? {} : { finishedAt: record.finishedAt },
		...record.totalSteps === void 0 ? {} : { totalSteps: record.totalSteps },
		...record.stepsDone === void 0 ? {} : { stepsDone: record.stepsDone },
		...record.failedStep === void 0 ? {} : { failedStep: record.failedStep },
		...record.error === void 0 ? {} : { error: record.error },
		...record.screenshot === void 0 ? {} : { screenshot: record.screenshot }
	};
}
function eventRowsOf(events) {
	return events.map((event) => {
		if (event.event === "step") return {
			event: "step",
			...event.ts === void 0 ? {} : { ts: event.ts },
			id: event.id,
			kind: event.kind,
			status: event.status,
			...event.elapsed === void 0 ? {} : { elapsed: event.elapsed },
			...event.error === void 0 ? {} : { error: event.error }
		};
		if (event.event === "assert") return {
			event: "assert",
			...event.ts === void 0 ? {} : { ts: event.ts },
			stepId: event.stepId,
			kind: event.kind,
			status: event.status,
			...event.selector === void 0 ? {} : { selector: event.selector },
			...event.expected === void 0 ? {} : { expected: event.expected },
			...event.actual === void 0 ? {} : { actual: event.actual },
			...event.elapsed === void 0 ? {} : { elapsed: event.elapsed },
			...event.error === void 0 ? {} : { error: event.error }
		};
		if (event.event === "terminal") return {
			event: "terminal",
			...event.ts === void 0 ? {} : { ts: event.ts },
			success: event.success,
			...event.message === void 0 ? {} : { message: event.message },
			...event.screenshot === void 0 ? {} : { screenshot: event.screenshot },
			...event.dom === void 0 ? {} : { dom: event.dom },
			...event.elapsed === void 0 ? {} : { elapsed: event.elapsed }
		};
		return {
			event: "meta",
			...event.ts === void 0 ? {} : { ts: event.ts },
			site: event.site,
			flow: event.flow,
			version: event.version,
			startUrl: event.startUrl
		};
	});
}
function runsForTool(deps, args) {
	if (args.runId !== void 0 && args.runId.trim() !== "") {
		const runId = args.runId.trim();
		const run = readUiRunRecord(deps.dataRoot, runId);
		if (run === void 0) return {
			ok: false,
			message: `UI 运行 ${runId} 不存在`
		};
		return {
			ok: true,
			run: runRowOf(run),
			events: eventRowsOf(readUiRunEvents(deps.dataRoot, runId))
		};
	}
	return {
		ok: true,
		runs: listUiRuns(deps.dataRoot, args.limit ?? 20).map(runRowOf)
	};
}
function renderBatchPlanCard(plan) {
	const scope = plan.selection === "all" ? "全部脚本" : plan.selection === "site" ? `站点 ${plan.site ?? ""}` : "指定流程";
	const lines = plan.items.map((item) => {
		const version = item.version === void 0 ? "" : ` v${item.version}`;
		const tail = item.error !== void 0 ? `（✗ ${item.error}）` : item.missing.length > 0 ? `（缺参 ${item.missing.join("、")}）` : "";
		return `${item.index + 1}. ${item.site} / ${item.flow}${version} ｜ ${item.stepCount} 步${tail}`;
	});
	const missing = plan.missingInputs.length === 0 ? "" : `\n缺必填入参：${plan.missingInputs.join("、")}（补齐后重调）`;
	const writes = plan.writeSteps === 0 ? "无写操作步骤" : `${plan.writeSteps} 步 click/submit/upload 可能产生真实业务写入`;
	return [
		`🧪 UI 批量回放计划：${scope}，${plan.total} 条脚本（${writes}）`,
		...lines,
		missing,
		"确认后带 confirm=true 重调才会逐条起浏览器。"
	].filter((line) => line !== "").join("\n");
}
/**
* 批量回放：计划（确认前）/ 执行（confirm=true）。
*
* 与单次回放同款纪律：`uiTestEnabled=false` 拒跑；缺参不静默跳过（计划卡列出，执行记跳过）；
* 默认串行；每条脚本的回放/断言/截图复用单次执行，报告落 `dataRoot/ui-batches/<id>/`。
*/
async function batchRunForTool(deps, exec, args) {
	if (!deps.enabled) return {
		ok: false,
		gate: "ui-test-disabled",
		code: "ui-test-disabled",
		message: "UI 回放开关关闭（uiTestEnabled=false）：批量回放不执行，脚本与历史留痕照常。"
	};
	const workspaceRoot = await workspaceOf(deps, exec);
	const planned = planUiBatch(workspaceRoot, args, args.inputs);
	if (!planned.ok) return {
		ok: false,
		gate: "batch-plan-failed",
		code: "batch-plan-failed",
		message: planned.message
	};
	if (planned.plan.total === 0) return {
		ok: false,
		gate: "batch-plan-failed",
		code: "batch-plan-failed",
		message: args.flows !== void 0 && args.flows.length > 0 ? "指定的流程没有找到 UI 脚本" : "没有选中任何 UI 脚本（先录制或用 ui_script_upsert 写入）"
	};
	const plan = {
		...planned.plan,
		card: renderBatchPlanCard(planned.plan)
	};
	if (args.dryRun === true || args.confirm !== true) return {
		ok: true,
		gate: args.dryRun === true ? "dry-run" : "confirm-required",
		plan
	};
	if (!deps.batchEngine.available()) return {
		ok: false,
		gate: "batch-plan-failed",
		code: "ui-engine-unavailable",
		message: `批量回放引擎 ${deps.batchEngine.label} 不可用`
	};
	return {
		ok: true,
		gate: "executed",
		plan,
		result: await executeUiBatch({
			dataRoot: deps.dataRoot,
			run: (doc, inputs) => deps.batchEngine.run(doc, inputs, {
				headless: true,
				highlightClicks: false,
				holdMs: 0
			})
		}, {
			plan: planned.plan,
			entries: planned.entries
		})
	};
}
/** 按起点 URL 从本地凭证 jar 读 cookie（值只进内存，供 context.addCookies）。 */
async function loadCookiesForStart(deps, startUrl) {
	if (deps.credentialStorePath === void 0) return [];
	let host;
	try {
		host = new URL(startUrl).hostname;
	} catch {
		return [];
	}
	const store = readStore(deps.credentialStorePath);
	const out = [];
	for (const [origin, entry] of Object.entries(store.origins)) {
		let originHost;
		try {
			originHost = new URL(origin).hostname;
		} catch {
			continue;
		}
		if (!domainMatches(host, originHost)) continue;
		const secure = origin.startsWith("https:");
		for (const cookie of entry.cookies) out.push({
			name: cookie.name,
			value: cookie.value,
			domain: originHost,
			path: "/",
			secure,
			...cookie.expiresAt === void 0 ? {} : { expires: cookie.expiresAt }
		});
	}
	return out;
}
/**
* 录制结束后把会话 cookie 写进本地 jar（0600、按 origin 隔离）。
*
* 只报写入条数，cookie 值不经过任何回执/日志。落盘失败不抛（录制本身已成功）。
*/
/**
* 把一组 cookie 写进本地 jar（0600、按 origin 隔离）。只报写入条数，值不经过任何回执/日志。
* 落盘失败不抛（录制/代办本身已成功）。
*/
async function persistCookiesOf(deps, cookies) {
	if (deps.credentialStorePath === void 0) return void 0;
	if (cookies.length === 0) return 0;
	const now = deps.now?.() ?? Date.now();
	const byOrigin = /* @__PURE__ */ new Map();
	for (const cookie of cookies) {
		const domain = cookie.domain.replace(/^\./, "");
		const origin = `${cookie.secure === true ? "https" : "http"}://${domain}`;
		const expires = cookie.expires === void 0 ? "" : `; Max-Age=${Math.max(0, Math.floor((cookie.expires - now) / 1e3))}`;
		const line = `${cookie.name}=${cookie.value}; Path=${cookie.path ?? "/"}${expires}`;
		byOrigin.set(origin, [...byOrigin.get(origin) ?? [], line]);
	}
	let persisted = 0;
	for (const [origin, lines] of byOrigin) {
		if (originOfUrl(origin) === void 0) continue;
		persisted += persistCookies(deps.credentialStorePath, origin, lines, now);
	}
	return persisted;
}
async function persistSessionCookies(deps, engine, sessionId) {
	return persistCookiesOf(deps, await engine.cookiesOf(sessionId));
}
/** 运行证据文件（面板 GET 用）：只允许运行目录内的白名单文件名。 */
function evidencePathOf(dataRoot, runId, name) {
	if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) return void 0;
	if (name !== "failure.png" && name !== "failure.html" && name !== "success.png") return void 0;
	return join(uiRunDir(dataRoot, runId), name);
}
/** 保存脚本（面板导入/手写用）。 */
async function saveUiScriptForPanel(deps, workspaceRoot, yaml, source = "agent") {
	let parsed;
	try {
		parsed = parseUiScriptDoc(safeYaml(yaml));
	} catch (error) {
		return {
			ok: false,
			issues: [{
				target: "script",
				code: "invalid-script",
				reason: messageOf$4(error)
			}]
		};
	}
	if (!parsed.ok) return {
		ok: false,
		issues: parsed.issues
	};
	return saveUiScript(workspaceRoot, parsed.doc, { source });
}
/**
* 保存脚本（面板编辑器用）：客户端回传**完整 doc**（含未知字段）而不是 YAML。
*
* 客户端没有 YAML 序列化器（不为它把 js-yaml 打进 bundle）；回传整份 doc 也能保证
* 编辑过程中未被前端理解的字段零丢失（与服务端 `parseUiScriptDoc` 的"保留未知键"口径一致）。
*/
function saveUiScriptDocForPanel(workspaceRoot, docRaw, source = "canvas") {
	const parsed = parseUiScriptDoc(docRaw);
	if (!parsed.ok) return {
		ok: false,
		issues: parsed.issues
	};
	const doc = {
		...parsed.doc,
		meta: {
			...parsed.doc.meta,
			created: (/* @__PURE__ */ new Date()).toISOString()
		}
	};
	return saveUiScript(workspaceRoot, doc, { source });
}
/** 脚本详情（面板用；缺省最新）。 */
function loadUiScriptForPanel(workspaceRoot, site, flow, version) {
	return loadUiScript(workspaceRoot, site, flow, version);
}
/** 版本摘要（面板用）。 */
function uiVersionInfosForPanel(workspaceRoot, site, flow) {
	return listUiVersionInfos(workspaceRoot, site, flow);
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
			return lossless(await listFlows(deps, exec));
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
			return lossless(await runFlow(deps, exec, {
				flow: args.flow,
				params: args.params,
				...args.confirm === void 0 ? {} : { confirm: args.confirm },
				...args.dry_run === void 0 ? {} : { dryRun: args.dry_run }
			}));
		}
	});
}
function renderStatus(value) {
	if (value.run !== void 0) return summarizeRunFull(value.run);
	if (value.runs === void 0) return value.notice ?? "查询无结果";
	if (value.runs.length === 0) return value.notice ?? "暂无运行留痕";
	return `🗂 最近运行：\n${value.runs.map((r) => {
		const chain = r.chain === void 0 ? "" : ` 链 ${r.chain.site}/${r.chain.flow} v${r.chain.version}`;
		const failed = r.chain?.failedNode === void 0 ? "" : `，断在 ${r.chain.failedNode}`;
		return `- ${r.runId}：${r.status} ${r.stepsDone}/${r.totalSteps} 步${chain}${failed}${r.businessData?.poNo === void 0 ? "" : ` PO=${String(r.businessData.poNo)}`}`;
	}).join("\n")}`;
}
function summarizeRunFull(run) {
	const icon = run.status === "completed" ? "✅" : run.status === "running" ? "⏳" : run.status === "killed" ? "🛑" : "❌";
	const biz = run.businessData === void 0 ? [] : Object.entries(run.businessData).map(([k, v]) => `${k}=${String(v)}`);
	return [
		`${icon} ${run.runId}（${run.flowName || run.flow}）— ${run.status}${run.dryRun ? "（dry-run）" : ""}`,
		`进度：${run.stepsDone}/${run.totalSteps} 步${run.lastStepId === void 0 ? "" : `，最后一步 ${run.lastStepId}`}`,
		...run.chain === void 0 ? [] : [`链：${run.chain.site} / ${run.chain.flow} v${run.chain.version}${run.chain.failedNode === void 0 ? "" : `，断在 ${run.chain.failedNode}`}${(run.chain.completedNodes ?? []).length === 0 ? "" : `，已完成 ${(run.chain.completedNodes ?? []).join("、")}`}`],
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
			return lossless(runStatus(deps, args.run_id));
		}
	});
}
function renderCapture(value) {
	if (!value.accepted) return value.card ?? "❌ 采集请求未被接受（缺细节）";
	if (value.sessionId !== void 0) {
		const reused = value.cookiesReused === void 0 ? "" : `，已复用 ${value.cookiesReused} 个 cookie`;
		return `✅ 已开会话 ${value.sessionId}（captureId ${value.captureId ?? "?"}${reused}）：用 dataforge_browser_snapshot 看 UI、dataforge_browser_act 交互；结束后 dataforge_browser_close 收 cookie。`;
	}
	const degraded = value.degradedNotice === void 0 ? "" : `\n⚠ ${value.degradedNotice}`;
	return `🚀 采集已启动（captureId ${value.captureId ?? "?"}）：site_crawl 是后台任务，用 dataforge_capture_status 轮询，完成后 dataforge_capture_result(scope=cards) 取卡。${degraded}`;
}
/** 回执里一行一条，逐行截断；超出部分只报条数，不回灌原始 JSON。 */
const RECEIPT_MAX_LINES = 20;
const RECEIPT_URL_MAX = 110;
function shortUrl(url) {
	return url.length <= RECEIPT_URL_MAX ? url : `${url.slice(0, RECEIPT_URL_MAX)}…`;
}
/** 模板摘要：字段数 + 探测到的状态码路径（"入参 5 字段" / "出参 8 字段(code)"）。 */
function templateBrief(label, template) {
	if (template === void 0) return `${label} 未采到`;
	const code = template.codePath === void 0 ? "" : `(${template.codePath})`;
	return `${label} ${template.fields.length} 字段${code}`;
}
/**
* 采集产物回执：直接把接口列出来——方法 + URL 模板 + 样本数 + 出入参规模。
*
* 早先只回一句「N 条记录（详见 items）」，对话里根本看不到采到了什么接口；
* 凭证只报名称与来源，value_json 原文永不进回执。
*/
function renderCaptureResult(scope, value) {
	if (value.notice !== void 0) return `📭 ${value.notice}`;
	const items = value.items ?? [];
	if (items.length === 0) return `📦 0 条记录`;
	let lines;
	if (scope === "cards") lines = items.map((c) => {
		return `- ${c.name === void 0 ? "" : `${c.name} `}${c.method} ${shortUrl(c.urlTemplate)} ｜ ×${c.sampleCount} ｜ ${templateBrief("入参", c.requestTemplate)}，${templateBrief("出参", c.responseTemplate)}`;
	});
	else if (scope === "samples") lines = items.map((s) => {
		const status = s.status === void 0 ? "???" : String(s.status);
		const trunc = s.truncated ? " ⚠️超限未存正文" : "";
		return `- #${s.seq} ${s.method} ${status} ${shortUrl(s.url)}${trunc}`;
	});
	else if (scope === "credentials") lines = items.map((c) => `- ${c.kind} ${c.name} @ ${c.url}`);
	else lines = items.map((p) => `- [d${p.depth}] ${p.status} ${shortUrl(p.url)}`);
	const shown = lines.slice(0, RECEIPT_MAX_LINES);
	const rest = lines.length - shown.length;
	const tail = rest > 0 ? `\n… 还有 ${rest} 条（items 里有全量）` : "";
	return `${scope === "cards" ? "🧩 接口卡" : scope === "samples" ? "📡 请求样本" : scope === "credentials" ? "🔒 凭证（仅名称/来源）" : "📄 页面"} ${items.length} 条：\n${shown.join("\n")}${tail}`;
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
			},
			headless: {
				type: "boolean",
				description: "action 型：false = 可见 Chrome，供用户手动登录；缺省无头"
			},
			reuse_cookies_from: {
				type: "string",
				description: "从指定 captureId 的本地 cookie 恢复登录态，再注入新浏览器上下文"
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
					cookiesReused: {
						type: "number",
						description: "action 型：从旧 captureId 注入的 cookie 数"
					},
					degradedNotice: {
						type: "string",
						description: "jobs 服务缺席时前台降级执行的说明"
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
			return lossless(await startCapture(deps, {
				taskType,
				entryUrl: args.entry_url,
				...args.confirm === void 0 ? {} : { confirm: args.confirm },
				...args.max_depth === void 0 ? {} : { maxDepth: args.max_depth },
				...args.max_pages === void 0 ? {} : { maxPages: args.max_pages },
				...args.headless === void 0 ? {} : { headless: args.headless },
				...args.reuse_cookies_from === void 0 ? {} : { reuseCookiesFrom: args.reuse_cookies_from }
			}));
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
			return lossless(captureStatus(deps, args.capture_id));
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
			render: (args, value) => [{
				type: "text",
				text: renderCaptureResult(String(args.scope), tighten(value))
			}]
		},
		async execute(args) {
			if (args.scope !== "cards" && args.scope !== "samples" && args.scope !== "credentials" && args.scope !== "pages") return {
				ok: false,
				notice: `scope 非法：${String(args.scope)}（cards | samples | credentials | pages）`
			};
			return lossless(captureResult(deps, args.capture_id, args.scope, args.limit));
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
			return lossless(captureCancel(deps, args.capture_id));
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
		case "upload": {
			const files = Array.isArray(r["files"]) && r["files"].every((file) => typeof file === "string") ? r["files"] : void 0;
			return selector === void 0 || files === void 0 || files.length === 0 ? void 0 : {
				kind: "upload",
				selector,
				files
			};
		}
		case "eval": return typeof r["script"] !== "string" || r["script"].trim() === "" ? void 0 : {
			kind: "eval",
			script: r["script"]
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
		description: `开一个 Chrome 采集会话（系统 Chrome，流经隐私侧通道）。entry_url 给出时直接导航过去。headless=false 会打开可见窗口，供用户手动登录；与 dataforge_capture(task_type=action) 配合使用。`,
		parameters: {
			entry_url: {
				type: "string",
				description: "打开后立刻导航的 URL"
			},
			headless: {
				type: "boolean",
				description: "false = 可见 Chrome（用户手动登录）；缺省无头"
			},
			reuse_cookies_from: {
				type: "string",
				description: "从指定 captureId 的本地 cookie 恢复登录态"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					sessionId: { type: "string" },
					pageUrl: { type: "string" },
					cookiesReused: { type: "number" }
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				const reused = v.cookiesReused === void 0 ? "" : `（复用 ${v.cookiesReused} 个 cookie）`;
				return [{
					type: "text",
					text: `🖥 会话 ${v.sessionId} 已开（${v.pageUrl}）${reused}。下一步用 dataforge_browser_snapshot 看页面。`
				}];
			}
		},
		async execute(args) {
			const cookies = args.reuse_cookies_from === void 0 ? [] : cookiesFromCapture(deps.store, args.reuse_cookies_from);
			const opened = await deps.registry.open({
				...args.entry_url === void 0 ? {} : { entryUrl: args.entry_url },
				...args.headless === void 0 ? {} : { headless: args.headless },
				...cookies.length === 0 ? {} : { cookies }
			});
			return lossless({
				...opened,
				...cookies.length === 0 ? {} : { cookiesReused: cookies.length }
			});
		}
	});
}
function defineBrowserActTool(deps) {
	return defineTool({
		name: "dataforge_browser_act",
		description: `对采集会话执行一次页面动作：click/fill/press/submit/wait/goto/upload/eval。⚠️ 此工具生成真实用户操作（含写/上传）：生产站点填表、上传、提交前先向用户确认；提交/上传类只应出现在 dataforge_capture(task_type=action) 且用户 confirm 之后。eval 只用于读 DOM/辅助定位，不执行外部脚本。`,
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
				const extra = v.value === void 0 ? "" : `\n${JSON.stringify(v.value).slice(0, 4e3)}`;
				return [{
					type: "text",
					text: (v.ok ? `✅ 动作完成（当前页 ${v.pageUrl ?? "?"}）` : `❌ 动作失败：${v.error ?? "未知"}`) + extra
				}];
			}
		},
		async execute(args) {
			const spec = toActSpec(args.act);
			if (spec === void 0) return {
				ok: false,
				error: `act 非法：${JSON.stringify(args.act).slice(0, 200)}`
			};
			return lossless(await deps.registry.act(args.session_id, spec));
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
			return lossless(await deps.registry.snapshot(args.session_id));
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
					captureId: { type: "string" },
					tokensHarvested: { type: "number" }
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				const tokens = v.tokensHarvested === void 0 || v.tokensHarvested === 0 ? "" : `，补采 token ${v.tokensHarvested} 条`;
				return [{
					type: "text",
					text: v.ok ? `🔒 会话已关（cookie ${v.cookies.length} 个${v.captureId === void 0 ? "" : `，已挂到 ${v.captureId}`}${tokens}）` : "❌ 会话不存在或已关闭"
				}];
			}
		},
		async execute(args) {
			const closed = await deps.registry.close(args.session_id);
			let tokensHarvested = 0;
			if (closed.captureId !== void 0) {
				for (const c of closed.cookies) deps.store.upsertCredential(closed.captureId, "cookie", String(c["domain"] ?? ""), String(c["name"] ?? ""), Date.now(), c);
				try {
					tokensHarvested = harvestTokenCredentials(deps.store, closed.captureId);
				} catch {
					tokensHarvested = 0;
				}
				if (deps.store.getRun(closed.captureId)?.status === "running") deps.store.finishRun(closed.captureId, "done");
			}
			const summarized = {
				ok: closed.ok,
				cookies: closed.cookies.map((c) => ({
					name: String(c["name"] ?? ""),
					domain: String(c["domain"] ?? "")
				})),
				...closed.captureId === void 0 ? {} : { captureId: closed.captureId },
				...tokensHarvested === 0 ? {} : { tokensHarvested }
			};
			return lossless(summarized);
		}
	});
}
function renderLibraryImport(value) {
	if (!value.ok) {
		const hints = value.hints === void 0 || value.hints.length === 0 ? "" : `\n建议：${value.hints.join("；")}`;
		return `⚠️ 接口库导入未完成（${value.code ?? "unknown"}）：${value.message ?? ""}${hints}`;
	}
	const head = `📦 接口库导入：新建 ${value.imported ?? 0} 张 / 归并 ${value.merged ?? 0} 张 / 未变 ${value.unchanged ?? 0} 张 / 跳过 ${value.skipped ?? 0} 张`;
	const ids = value.cardIds ?? [];
	return `${head}\n${ids.length === 0 ? "- 本次没有卡落库" : ids.slice(0, RECEIPT_MAX_LINES).map((id) => `- ${id}`).join("\n")}${ids.length > RECEIPT_MAX_LINES ? `\n… 还有 ${ids.length - RECEIPT_MAX_LINES} 张（cardIds 里有全量）` : ""}${(value.skippedReasons ?? []).length === 0 ? "" : `\n跳过原因：\n${(value.skippedReasons ?? []).map((r) => `- ${r}`).join("\n")}`}\n库：${value.libraryRoot ?? ""}`;
}
function renderChainDraft(value) {
	if (value.ok !== true) {
		const hints = (value.hints ?? []).length === 0 ? "" : `\n${(value.hints ?? []).map((hint) => `- ${hint}`).join("\n")}`;
		return `❌ 链草稿生成失败（${value.code}）：${value.error}${hints}`;
	}
	const head = `🧩 链草稿 ${value.site} / ${value.flow}${value.domain === void 0 ? "" : `（${value.domain}）`}
节点 ${value.chain.nodes.length} ｜ 边 ${value.chain.edges.length} ｜ 输入 ${value.chain.inputs.length} ｜ 输出候选 ${value.outputs.length} ｜ 绑定覆盖率 ${value.coverage.bindingCoverage} ｜ 校验 ${value.validation.ok ? "通过（未落盘）" : "未通过"}`;
	const nodes = value.chain.nodes.slice(0, 10).map((node) => `- ${node.id} → ${node.card ?? "?"}${Object.keys(node.constants).length === 0 ? "" : ` · 常量 ${Object.keys(node.constants).length}`}`);
	const warnings = value.warnings.slice(0, 10).map((warning) => `- ${warning.message}`);
	return `${head}\n节点：\n${nodes.join("\n")}${value.chain.nodes.length > 10 ? "\n…" : ""}\n草稿提示：\n${warnings.length === 0 ? "- 无" : warnings.join("\n")}\n\n未落盘：确认后用 dataforge_chain_upsert 保存；不要直接执行草稿。`;
}
function defineChainDraftTool(deps) {
	return defineTool({
		name: "dataforge_chain_draft",
		description: `从采集 trace 生成 interface-chain 草稿（S3）。

流程：trace_get/analyze → 按 mergeKey 匹配接口库卡 → 节点/绑定边/输入/断言 → 现有链校验。
- 草稿不执行、不落正式版本；确认后用 dataforge_chain_upsert 保存；
- 卡不在接口库 → 该节点跳过并 warning（先 dataforge_library_import）；
- 业务值不写死：未绑定字段变成 \$inputs.<name>，由 agent/用户填写；
- 低置信度绑定、缺失必填入参、卡模板缺字段都进 warnings，不能静默当成功。

失败码：no-workspace / no-cards / no-nodes / capture-*（同 trace_get）。`,
		parameters: {
			capture_id: {
				type: "string",
				required: true,
				description: "采集 run id"
			},
			site: {
				type: "string",
				description: "链 meta.site（缺省取 entryUrl host）"
			},
			flow: {
				type: "string",
				description: "链 meta.flow（缺省 trace-<captureId>）"
			},
			domain: {
				type: "string",
				description: "业务域（可选）"
			},
			note: {
				type: "string",
				description: "版本说明（可选）"
			},
			limit: {
				type: "number",
				description: "最多分析样本数（1..2000，缺省 1000）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: { type: "string" },
					error: { type: "string" },
					hints: {
						type: "array",
						items: { type: "string" }
					},
					captureId: { type: "string" },
					site: { type: "string" },
					flow: { type: "string" },
					domain: { type: "string" },
					yaml: { type: "string" },
					chain: {
						type: "object",
						additionalProperties: true
					},
					warnings: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								code: { type: "string" },
								message: { type: "string" },
								nodeId: { type: "string" },
								path: { type: "string" }
							}
						}
					},
					validation: {
						type: "object",
						additionalProperties: false,
						properties: {
							ok: { type: "boolean" },
							issues: {
								type: "array",
								items: {
									type: "object",
									additionalProperties: true
								}
							}
						}
					},
					outputs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					},
					coverage: {
						type: "object",
						additionalProperties: false,
						properties: {
							candidateLeaves: { type: "number" },
							boundLeaves: { type: "number" },
							bindingCoverage: { type: "number" },
							callCoverage: { type: "number" }
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderChainDraft(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await chainDraftForTool(deps, exec, args));
		}
	});
}
function renderLookup(value) {
	if (value.ok !== true) {
		const hints = (value.hints ?? []).length === 0 ? "" : `\n${(value.hints ?? []).map((hint) => `- ${hint}`).join("\n")}`;
		return `❌ lookup 失败（${value.code}）：${value.error}${hints}`;
	}
	const head = `🔎 lookup ${value.name}（${value.site}）｜ query=${value.query} ｜ cache=${value.cache} ｜ ${value.fetchedAt}`;
	const lines = value.candidates.slice(0, 10).map((candidate) => `- ${candidate.label}: ${Object.entries(candidate.values).map(([key, val]) => `${key}=${String(val)}`).join("  ")}`);
	const more = value.candidates.length > 10 ? `\n… 还有 ${value.candidates.length - 10} 条` : "";
	const warnings = value.warnings.length === 0 ? "" : `\n提示：\n${value.warnings.map((warning) => `- ${warning}`).join("\n")}`;
	return `${head}\n${lines.length === 0 ? "- 没有匹配项" : lines.join("\n")}${more}${warnings}\n来源：${value.source.description}`;
}
function defineLookupTool(deps) {
	return defineTool({
		name: "dataforge_lookup",
		description: `运行时查业务映射（组织/供应商/物料等），不把映射写死。

配置在 <workspace>/.dsh/dataforge/lookups/<name>.yaml：只声明源、匹配/映射字段，不存业务值。
运行时取值 → 缓存 + TTL → 按 query 匹配 → 返回值 + source/fetchedAt。
- api：GET/HEAD，items/match/map（JSON 路径）；
- page：Playwright 只读选择器，items/label/map（text 或 attr:<name>）；不注入登录态；
- 凭证用 \${ENV} 注入，不把 token/cookie 写进 YAML；
- 缓存落 dataRoot/lookups/<site>/<name>.json；refresh=true 强制刷新。

失败码：lookup-not-found / lookup-invalid / lookup-http-error / lookup-items-not-array / lookup-unusable / page-lookup-unavailable / no-workspace。`,
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "lookup 名称（对应 lookups/<name>.yaml）"
			},
			query: {
				type: "string",
				required: true,
				description: "业务词，如生态链；与配置里的 match 字段比较"
			},
			site: {
				type: "string",
				description: "缓存/来源 site（缺省用配置 site 或 default）"
			},
			refresh: {
				type: "boolean",
				description: "true = 跳过缓存强制刷新"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: { type: "string" },
					error: { type: "string" },
					hints: {
						type: "array",
						items: { type: "string" }
					},
					name: { type: "string" },
					site: { type: "string" },
					query: { type: "string" },
					cache: { type: "string" },
					fetchedAt: { type: "string" },
					source: {
						type: "object",
						additionalProperties: false,
						properties: {
							kind: { type: "string" },
							description: { type: "string" }
						}
					},
					candidates: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								label: { type: "string" },
								values: {
									type: "object",
									additionalProperties: true
								}
							}
						}
					},
					warnings: {
						type: "array",
						items: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderLookup(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await lookupForTool(deps, exec, args));
		}
	});
}
function renderDatasetExport(value) {
	if (value.ok !== true) {
		const hints = (value.hints ?? []).length === 0 ? "" : `\n${(value.hints ?? []).map((hint) => `- ${hint}`).join("\n")}`;
		return `❌ 导出失败（${value.code}）：${value.error}${hints}`;
	}
	const fields = Object.keys(value.businessData).length;
	return `📦 ${value.runId}｜${value.kind}｜${value.status}｜businessData ${fields} 个字段
dataset：${value.datasetPath}
evidence：${value.reportPath}`;
}
function defineDatasetExportTool(dataRoot) {
	return defineTool({
		name: "dataforge_dataset_export",
		description: `把一次运行留痕导出为 dataset + evidence 报告（不重新执行）。

- dataset：dataRoot/datasets/<runId>.json（链运行含 businessData/链身份；UI 运行含步骤/断言/截图）；
- evidence：dataRoot/evidence/<runId>/report.html（业务数据或 UI 步骤 + 截图，不含请求头/凭证原文）；
- 先 dataforge_chain_run 成功（或失败有留痕）再导出；失败也会导出已有摘要。

失败码：run-not-found / run-unreadable。`,
		parameters: { run_id: {
			type: "string",
			required: true,
			description: "运行 id（chain_run / ui_run 回执里的 runId）"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: { type: "string" },
					error: { type: "string" },
					hints: {
						type: "array",
						items: { type: "string" }
					},
					runId: { type: "string" },
					datasetPath: { type: "string" },
					reportPath: { type: "string" },
					kind: { type: "string" },
					status: { type: "string" },
					businessData: {
						type: "object",
						additionalProperties: true
					},
					chain: {
						type: "object",
						additionalProperties: true
					},
					ui: {
						type: "object",
						additionalProperties: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderDatasetExport(tighten(value))
			}]
		},
		async execute(args) {
			return lossless(exportRunArtifacts(dataRoot, args.run_id));
		}
	});
}
function renderTraceGet(value) {
	if (value.ok !== true) {
		const hints = (value.hints ?? []).length === 0 ? "" : `\n${(value.hints ?? []).map((hint) => `- ${hint}`).join("\n")}`;
		return `❌ trace 读取失败（${value.code}）：${value.error}${hints}`;
	}
	const head = `🧭 trace ${value.captureId}｜${value.entryUrl}${value.status === void 0 ? "" : ` · ${value.status}`}
样本 ${value.stats.returnedSamples}/${value.stats.totalSamples} ｜ 接口 ${value.stats.interfaces} ｜ 写操作 ${value.stats.writes} ｜ 页面 ${value.stats.pages} ｜ 正文截断 ${value.stats.truncatedBodies}`;
	const lines = value.samples.slice(0, RECEIPT_MAX_LINES).map((sample) => {
		const target = `${sample.method} ${sample.path}`;
		const status = sample.status === void 0 ? "" : ` ${sample.status}`;
		const body = sample.responseBodySource === "none" ? "" : ` · resp:${sample.responseBodySource}${sample.responseBodyTruncated ? "(截断)" : ""}`;
		return `- #${sample.seq} ${target}${status}${body}`;
	});
	const more = value.samples.length > RECEIPT_MAX_LINES ? `\n… 还有 ${value.samples.length - RECEIPT_MAX_LINES} 条（samples 里有全量）` : "";
	const warnings = value.warnings.length === 0 ? "" : `\n提示：\n${value.warnings.slice(0, 5).map((item) => `- ${item.message}`).join("\n")}`;
	return `${head}\n${lines.join("\n")}${more}${warnings}`;
}
function renderTraceAnalyze(value) {
	if (value.ok !== true) {
		const hints = (value.hints ?? []).length === 0 ? "" : `\n${(value.hints ?? []).map((hint) => `- ${hint}`).join("\n")}`;
		return `❌ trace 分析失败（${value.code}）：${value.error}${hints}`;
	}
	const a = value.analysis;
	const head = `🧠 trace 分析 ${value.captureId}｜节点 ${a.stats.nodes} ｜ 绑定 ${a.bindings.length} ｜ 输入 ${a.inputs.length} ｜ 输出 ${a.outputs.length} ｜ 覆盖率 ${a.coverage.bindingCoverage}`;
	const nodes = a.nodes.slice(0, 12).map((node) => `- ${node.id} ${node.method} ${node.path}${node.write ? " [写]" : ""}${node.polling ? ` [polling×${node.occurrences}]` : ""}`);
	const bindings = a.bindings.slice(0, 12).map((binding) => `- ${binding.from.nodeId}.${binding.from.path} → ${binding.to.nodeId}.${binding.to.path}（${binding.confidence}）`);
	const warnings = a.warnings.slice(0, 8).map((warning) => `- ${warning.message}`);
	return `${head}\n节点：\n${nodes.join("\n")}${a.nodes.length > 12 ? "\n…" : ""}\n绑定：\n${bindings.length === 0 ? "- 无" : bindings.join("\n")}${a.bindings.length > 12 ? "\n…" : ""}\n提示：\n${warnings.length === 0 ? "- 无" : warnings.join("\n")}`;
}
function defineTraceGetTool(deps) {
	return defineTool({
		name: "dataforge_trace_get",
		description: `读取一条采集 run 的 trace（有序请求/响应样本）。

用途：在自动编排前看清真实操作产生了哪些接口调用。
- 顺序以采集 seq 为准；正文来自落盘文件或 DB 预览，截断会标 truncated；
- 敏感头（authorization/cookie/token 等）只返回名字，值永不返回；
- 默认 limit=200、body_limit=8192；大 trace 请分页/提高 limit，不要一次拉全量。

失败码：capture-not-found / capture-empty / capture-unreadable / bad-capture-id。`,
		parameters: {
			capture_id: {
				type: "string",
				required: true,
				description: "采集 run id（dataforge_capture / 面板的 captureId）"
			},
			limit: {
				type: "number",
				description: "最多返回样本数（1..2000，缺省 200）"
			},
			body_limit: {
				type: "number",
				description: "单条正文最多返回字符数（256..65536，缺省 8192）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: { type: "string" },
					error: { type: "string" },
					hints: {
						type: "array",
						items: { type: "string" }
					},
					captureId: { type: "string" },
					entryUrl: { type: "string" },
					status: { type: "string" },
					stats: {
						type: "object",
						additionalProperties: false,
						properties: {
							totalSamples: { type: "number" },
							returnedSamples: { type: "number" },
							interfaces: { type: "number" },
							writes: { type: "number" },
							pages: { type: "number" },
							truncatedBodies: { type: "number" }
						}
					},
					samples: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: { type: "string" },
								seq: { type: "number" },
								ts: { type: "number" },
								method: { type: "string" },
								url: { type: "string" },
								path: { type: "string" },
								query: {
									type: "object",
									additionalProperties: true
								},
								status: { type: "number" },
								pageUrl: { type: "string" },
								requestHeaders: {
									type: "object",
									additionalProperties: false,
									properties: {
										values: {
											type: "object",
											additionalProperties: true
										},
										sensitive: {
											type: "array",
											items: { type: "string" }
										}
									}
								},
								requestBody: { type: "string" },
								requestBodySource: { type: "string" },
								requestBodyTruncated: { type: "boolean" },
								responseHeaders: {
									type: "object",
									additionalProperties: false,
									properties: {
										values: {
											type: "object",
											additionalProperties: true
										},
										sensitive: {
											type: "array",
											items: { type: "string" }
										}
									}
								},
								responseBody: { type: "string" },
								responseBodySource: { type: "string" },
								responseBodyTruncated: { type: "boolean" },
								truncated: { type: "boolean" },
								cardId: { type: "string" },
								mergeKey: { type: "string" },
								actionLabel: { type: "string" }
							}
						}
					},
					warnings: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								code: { type: "string" },
								message: { type: "string" },
								sampleId: { type: "string" }
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderTraceGet(tighten(value))
			}]
		},
		async execute(args) {
			return lossless(traceGetForTool(deps, args));
		}
	});
}
function defineTraceAnalyzeTool(deps) {
	return defineTool({
		name: "dataforge_trace_analyze",
		description: `分析一条 trace：自动推断调用顺序、写操作、字段流转、输入/输出与覆盖率。

规则只用 HTTP 方法 / 采集序号 / JSON 值匹配 / 路径提取，不含业务名称/URL/字段硬编码。
产出是“草稿 + warning”：低置信度绑定、动态值、未解析正文都要 agent 审阅，不能直接当最终编排。
- 连续重复调用会合并并标 polling；
- 绑定 from/to 路径相对节点（如 body.data[0].id → body.orgId），供下一步生成 interface-chain。

失败码同 dataforge_trace_get。`,
		parameters: {
			capture_id: {
				type: "string",
				required: true,
				description: "采集 run id"
			},
			limit: {
				type: "number",
				description: "最多分析样本数（1..2000，缺省 1000）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: { type: "string" },
					error: { type: "string" },
					hints: {
						type: "array",
						items: { type: "string" }
					},
					captureId: { type: "string" },
					entryUrl: { type: "string" },
					analysis: {
						type: "object",
						additionalProperties: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderTraceAnalyze(tighten(value))
			}]
		},
		async execute(args) {
			return lossless(traceAnalyzeForTool(deps, args));
		}
	});
}
function defineLibraryImportTool(deps) {
	return defineTool({
		name: "dataforge_library_import",
		description: `把采集到的接口卡导入**项目接口库**（工作区 .dsh/dataforge/library/）。

为什么要有这一步：链靠稳定的 cardId 引用接口，而不是 (capture_id, merge_key)。
同 mergeKey 的卡跨 run 归并成同一张卡，重新采集不会让旧链断引用。

用法：
- 一般先跑本工具再写链；capture_id 缺省 = 全部尚未导入完的采集 run。
- 纯增量幂等：重复导入同一 run 不产生重复卡、不重复记来源、不重写文件。
- 坏卡跳过不炸批：被跳过的卡与中文原因在 skippedReasons 里如实给出。

失败时：
- no-capture-data → 采集库里还没有卡；先让用户跑一次采集（dataforge_capture），不要空转重试。
- 卡文件不含任何凭证值：只投影 auth 标志与来源名，凭证注入是 R-4 的事。`,
		parameters: { capture_id: {
			type: "string",
			description: "只导入这一次采集；缺省 = 全部尚未导入完的 run"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: {
						type: "string",
						description: "no-capture-data / capture-unreadable / library-unavailable"
					},
					message: { type: "string" },
					hints: {
						type: "array",
						items: { type: "string" }
					},
					imported: { type: "number" },
					merged: { type: "number" },
					unchanged: { type: "number" },
					skipped: { type: "number" },
					cardIds: {
						type: "array",
						items: { type: "string" }
					},
					skippedReasons: {
						type: "array",
						items: { type: "string" }
					},
					captures: {
						type: "array",
						items: { type: "string" }
					},
					libraryRoot: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderLibraryImport(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await importLibraryForTool(deps, exec, { ...args.capture_id === void 0 ? {} : { captureId: args.capture_id } }));
		}
	});
}
function renderChainIssues(issues) {
	if (issues === void 0 || issues.length === 0) return "";
	return `\n${issues.map((issue) => `- ${issue.target}：${issue.reason}`).join("\n")}`;
}
function defineChainUpsertTool(deps) {
	return defineTool({
		name: "dataforge_chain_upsert",
		description: `写入一条接口链（唯一写入口），落盘为**新版本快照**。

先 schema 校验、再语义校验：卡引用必须在项目接口库存在、拓扑无环、绑定两端字段在卡模板里、
绑定与常量互斥、链级 inputs 槽位被 $inputs.<name> 引用。**全部通过才落盘，不存在部分写入。**

链 YAML 形状（apiVersion: dataforge/v1）：
- nodes: [{id, card, constants}]，card 是 dataforge_library_import 给的 cardId；
- edges: [{from, to}]，from 是「节点.出参路径」或「$inputs.槽位名」，to 是「节点.入参路径」；
- inputs: [{name, type, required}]，槽位靠常量值引用才算有人用（防僵尸槽位）。

失败时（逐条问题指向 nodes[i] / edges[j]，修好再提交，不会落盘）：
- invalid-chain → 定义本身不合法；
- card-not-imported → 卡不在项目库，先跑 dataforge_library_import。

版本只增不删：同一 site/flow 每次落盘都是 max+1 的新文件，旧版本永远可回读。`,
		parameters: {
			site: {
				type: "string",
				required: true,
				description: "站点名（如「智慧供应链 SCM」）"
			},
			flow: {
				type: "string",
				required: true,
				description: "流程名（如「采购下单」）"
			},
			chain_yaml: {
				type: "string",
				required: true,
				description: "链 YAML 全文"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: {
						type: "string",
						description: "invalid-chain / card-not-imported"
					},
					message: { type: "string" },
					version: { type: "number" },
					path: { type: "string" },
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								target: { type: "string" },
								code: { type: "string" },
								reason: { type: "string" }
							}
						}
					},
					warnings: {
						type: "array",
						items: { type: "string" }
					}
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				if (!v.ok) return [{
					type: "text",
					text: `❌ 链未落盘（${v.code ?? "invalid-chain"}）：${v.message ?? ""}${renderChainIssues(v.issues)}`
				}];
				const warn = (v.warnings ?? []).length === 0 ? "" : `\n⚠️ 提醒：\n${(v.warnings ?? []).map((w) => `- ${w}`).join("\n")}`;
				return [{
					type: "text",
					text: `🔗 链已落盘：v${v.version ?? 0}\n文件：${v.path ?? ""}${warn}`
				}];
			}
		},
		async execute(args, exec) {
			return lossless(await upsertChainForTool(deps, exec, {
				site: args.site,
				flow: args.flow,
				chainYaml: args.chain_yaml
			}));
		}
	});
}
function defineChainGetTool(deps) {
	return defineTool({
		name: "dataforge_chain_get",
		description: `读链：按 site/flow/version（缺省最新）取链 YAML 全文。

- 缺省：校验读取——文件被手改坏就如实报 invalid-chain，并列出可用版本供你回读旧版本；
- export=true：原文读取（不校验）。链文件天然零凭证，导出即原文，无需剥除。

失败时：
- chain-not-found → site/flow/version 任一不匹配；versions 里是可用版本，据此重试或放弃。`,
		parameters: {
			site: {
				type: "string",
				required: true
			},
			flow: {
				type: "string",
				required: true
			},
			version: {
				type: "number",
				description: "缺省 = 最新版本"
			},
			export: {
				type: "boolean",
				description: "true = 原文导出（不校验）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: {
						type: "string",
						description: "chain-not-found / invalid-chain"
					},
					message: { type: "string" },
					chainYaml: { type: "string" },
					version: { type: "number" },
					path: { type: "string" },
					versions: {
						type: "array",
						items: { type: "number" }
					},
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								target: { type: "string" },
								code: { type: "string" },
								reason: { type: "string" }
							}
						}
					}
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				if (!v.ok) {
					const versions = (v.versions ?? []).length === 0 ? "无" : (v.versions ?? []).map((n) => `v${n}`).join(" / ");
					return [{
						type: "text",
						text: `❌ 读链失败（${v.code ?? "chain-not-found"}）：${v.message ?? ""}\n可用版本：${versions}${renderChainIssues(v.issues)}`
					}];
				}
				return [{
					type: "text",
					text: `🔗 ${v.path ?? ""}（v${v.version ?? 0}）\n\`\`\`yaml\n${v.chainYaml ?? ""}\`\`\``
				}];
			}
		},
		async execute(args, exec) {
			return lossless(await getChainForTool(deps, exec, {
				site: args.site,
				flow: args.flow,
				...args.version === void 0 ? {} : { version: args.version },
				...args.export === void 0 ? {} : { export: args.export }
			}));
		}
	});
}
/**
* 工具入参 → bind 核心的严格边形状。
*
* 嵌套对象在参数 DSL 里的 required 推断偏松（TS 侧 match 可能被当成可选），所以这里显式收敛：
* 缺失的 match 字段补空串，交给 bind 的 pickShapeProblemOf 给出「pick.match.field 必须是非空字符串」
* 这类可读拒绝，而不是在工具壳里静默丢掉 pick。
*/
function bindEdgeSpecsOf(raw) {
	return raw.map((edge) => ({
		from: edge.from,
		to: edge.to,
		...edge.transform === void 0 ? {} : { transform: edge.transform },
		...edge.pick === void 0 ? {} : { pick: {
			match: {
				field: edge.pick.match?.field ?? "",
				equals: edge.pick.match?.equals ?? ""
			},
			...edge.pick.field === void 0 ? {} : { field: edge.pick.field }
		} }
	}));
}
function renderChainBind(value) {
	if (!value.ok) return `❌ 绑定未写入（${value.code ?? "invalid-chain"}）：${value.message ?? ""}${renderChainIssues(value.issues)}` + ((value.hints ?? []).length === 0 ? "" : `\n建议：\n${(value.hints ?? []).map((hint) => `- ${hint}`).join("\n")}`);
	const edges = value.edges ?? [];
	const shown = edges.slice(0, RECEIPT_MAX_LINES).map((edge) => `- ${edge.from} → ${edge.to}`);
	const rest = edges.length > RECEIPT_MAX_LINES ? `\n… 还有 ${edges.length - RECEIPT_MAX_LINES} 条（edges 里有全量）` : "";
	const hints = (value.hints ?? []).length === 0 ? "" : `\n提醒：\n${(value.hints ?? []).map((hint) => `- ${hint}`).join("\n")}`;
	return [
		`🔗 绑定已写入 ${value.site ?? ""}/${value.flow ?? ""} v${value.version ?? 0}（新增 ${value.added ?? 0} / 替换 ${value.replaced ?? 0} / 未变 ${value.unchanged ?? 0}）`,
		`文件：${value.path ?? ""}`,
		edges.length === 0 ? "- 新版本没有任何绑定边" : `边：\n${shown.join("\n")}${rest}`
	].join("\n") + hints;
}
function defineChainBindTool(deps) {
	return defineTool({
		name: "dataforge_chain_bind",
		description: `把 probe 发现的绑定边**回写进链**（R-5 M2）：不需要手抄整份 YAML，只给边 → 自增版本。

入参 edges：每条 { from, to, transform?, pick? }
- from 是「节点.出参路径」（如上一步 probe 的 outputs 里那条 body.items[0].internalId），也允许 $inputs.槽位名；
- to 是「节点.入参路径」（下游卡的入参，如 body.lines[0].materialId）；
- transform（string/json/array-json）与 pick（按数组元素字段选值）原样写进边，语义同 dataforge_chain_run。

合并语义（同一次只增改给定的边，其余边原样保留）：
- to 相同 = 重写这条绑定（替换，不会叠加两条指向同一入参的边）；
- from/to/transform/pick 全同 = 未变化（只计数）；
- to 不同 = 新增；同一次调用里 to 重复，以后者为准。

写链纪律不打折：仍只经 R-1 的 saveChain —— 卡引用/两端字段存在性/成环/绑定与常量互斥/僵尸槽位全部校验，失败零落盘并逐条给 issues（指向 edges[i]）。版本只增不删，旧版本永远可回读；内容无变化也会落 max+1 新版本（回执 added=0/replaced=0/unchanged>0 说明原因）。

失败时：chain-not-found（先 upsert）/ invalid-chain（含 page-chain 不支持、边形状坏、R-1 语义不符）/ card-not-imported（先 dataforge_library_import）。

首跑闭环：dataforge_chain_probe 试探 → 读 outputs 发现绑定 → **dataforge_chain_bind 回写边** → dataforge_chain_run 整链。`,
		parameters: {
			site: {
				type: "string",
				required: true,
				description: "站点名（链的 meta.site）"
			},
			flow: {
				type: "string",
				required: true,
				description: "流程名（链的 meta.flow）"
			},
			version: {
				type: "number",
				description: "以哪个版本为基（缺省最新）；落盘永远是 max+1 新版本"
			},
			edges: {
				type: "array",
				required: true,
				description: "要回写的绑定边；to 相同视为重写同一条绑定",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						from: {
							type: "string",
							required: true,
							description: "「节点.出参路径」或 $inputs.槽位名"
						},
						to: {
							type: "string",
							required: true,
							description: "「节点.入参路径」"
						},
						transform: {
							type: "string",
							enum: [
								"string",
								"json",
								"array-json"
							],
							description: "缺省原样传值（不隐式转换）"
						},
						pick: {
							type: "object",
							additionalProperties: false,
							description: "{ match: { field, equals }, field? }：从数组出参按字段选元素再取字段（equals 按字符串比较）",
							properties: {
								match: {
									type: "object",
									additionalProperties: false,
									properties: {
										field: {
											type: "string",
											required: true
										},
										equals: {
											type: "string",
											required: true,
											description: "匹配值（按字符串比较，数字写 \"123\" 即可）"
										}
									}
								},
								field: { type: "string" }
							}
						}
					}
				}
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: {
						type: "string",
						description: "chain-not-found / invalid-chain / card-not-imported"
					},
					message: { type: "string" },
					hints: {
						type: "array",
						items: { type: "string" }
					},
					site: { type: "string" },
					flow: { type: "string" },
					version: { type: "number" },
					path: { type: "string" },
					added: { type: "number" },
					replaced: { type: "number" },
					unchanged: { type: "number" },
					edges: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								from: { type: "string" },
								to: { type: "string" }
							}
						}
					},
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								target: { type: "string" },
								code: { type: "string" },
								reason: { type: "string" }
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderChainBind(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await bindChainForTool(deps, exec, {
				site: args.site,
				flow: args.flow,
				...args.version === void 0 ? {} : { version: args.version },
				edges: bindEdgeSpecsOf(args.edges)
			}));
		}
	});
}
/** 计划卡的人话版：目标 host + 拓扑序 + 写类节点（这三样是确认的前提）。 */
function renderPlan(plan) {
	if (plan === void 0) return "";
	const lines = plan.nodes.map((node) => {
		const write = node.writes ? " ✍️写" : "";
		const deps = node.dependsOn.length === 0 ? "" : `（等 ${node.dependsOn.join("、")}）`;
		return `- ${node.nodeId}${write}：${node.method} ${node.url}${deps}`;
	});
	const writes = plan.writeNodes.length === 0 ? "无（整链只读）" : `${plan.writeNodes.join("、")}（已发出无法撤销）`;
	const cleanup = plan.cleanup === void 0 ? "" : `\n清理（主链后 ${plan.cleanup.when}）：${plan.cleanup.site} / ${plan.cleanup.flow}${plan.cleanup.version === void 0 ? "" : ` v${plan.cleanup.version}`}（${plan.cleanup.nodeCount} 节点，写 ${plan.cleanup.writeCount} 个）`;
	const verify = plan.verify === void 0 ? "" : `\n验收（主链后 ${plan.verify.when}）：${plan.verify.site} / ${plan.verify.flow}${plan.verify.version === void 0 ? "" : ` v${plan.verify.version}`}`;
	return [
		`🎯 目标：${plan.host}`,
		...lines,
		`写类节点：${writes}`,
		...plan.notices.length === 0 ? [] : [`提醒：${plan.notices.join("；")}`]
	].join("\n") + cleanup + verify;
}
function renderChainRun(value) {
	if (value.accepted !== true) {
		if (value.gate === "confirm-required") return `${value.card ?? value.message ?? "确认后带 confirm=true 重调"}\n\n${renderPlan(value.plan)}`;
		const gaps = (value.gaps ?? []).length === 0 ? "" : `\n缺参（链定义要改，重试同一份链没用）：\n${(value.gaps ?? []).map((gap) => `- ${gap.nodeId} · ${gap.path} · ${gap.type}`).join("\n")}`;
		const cycle = (value.cycle ?? []).length === 0 ? "" : `\n成环节点：${(value.cycle ?? []).join(" → ")}`;
		const versions = (value.versions ?? []).length === 0 ? "" : `\n可用版本：${(value.versions ?? []).map((version) => `v${version}`).join(" / ")}`;
		return `❌ 未执行（${value.code ?? "unknown"}）：${value.message ?? ""}${gaps}${cycle}${versions}${renderChainIssues(value.issues)}`;
	}
	if (value.kind === "dry-run") return `🧪 dry-run 已留痕（runId ${value.runId ?? "?"}）：${value.summary?.totalSteps ?? 0} 个节点，未发送任何请求\n${renderPlan(value.plan)}`;
	if (value.kind === "background") return `🚀 链已启动（jobId ${value.jobId ?? "?"}，runId ${value.runId ?? "?"}）：用 dataforge_status 轮询节点级进度，job_kill 可取消\n${renderPlan(value.plan)}`;
	const lines = (value.nodes ?? []).map((node) => {
		const http = node.httpStatus === void 0 ? "" : ` HTTP ${node.httpStatus}`;
		const error = node.errorCode === void 0 ? "" : ` ${node.errorCode}：${node.error ?? ""}`;
		const relogin = node.relogin === void 0 ? "" : node.relogin.success ? `（已换票重放${node.relogin.runId === void 0 ? "" : `，登录链 ${node.relogin.runId}`}${node.relogin.persisted === void 0 ? "" : `，已持久化 ${node.relogin.persisted} 个 cookie`}）` : `（换票失败 ${node.relogin.code ?? "relogin-failed"}）`;
		return `- ${node.nodeId}：${node.status}${http}（${node.elapsedMs}ms）${error}${relogin}`;
	});
	const degraded = value.degradedNotice === void 0 ? "" : `\n⚠ ${value.degradedNotice}`;
	return [
		`🏁 链已跑完（前台）：${value.summary?.status ?? "unknown"} ${value.summary?.stepsDone ?? 0}/${value.summary?.totalSteps ?? 0} 步`,
		...lines,
		...value.failedNode === void 0 ? [] : [`断在：${value.failedNode}`],
		...value.verify === void 0 ? [] : [`验收 ${value.verify.site}/${value.verify.flow}：${value.verify.skipped ?? value.verify.status ?? (value.verify.success === true ? "success" : value.verify.message ?? "unknown")}${value.verify.runId === void 0 ? "" : `（${value.verify.runId}）`}${value.verify.reportPath === void 0 ? "" : `；证据 ${value.verify.reportPath}`}`],
		...value.cleanup === void 0 ? [] : [`清理 ${value.cleanup.site}/${value.cleanup.flow}：${value.cleanup.skipped ?? value.cleanup.status ?? value.cleanup.message ?? "unknown"}${value.cleanup.runId === void 0 ? "" : `（${value.cleanup.runId}）`}`],
		degraded
	].join("\n");
}
function defineChainRunTool(deps) {
	return defineTool({
		name: "dataforge_chain_run",
		description: `执行一条接口链（唯一执行入口）：按拓扑序发真实 HTTP 请求，节点出参经绑定边进入下游入参。

只接受 kind: interface-chain。page-chain 必须先在 R-1 侧编译成 interface-chain 草稿、经 dataforge_chain_upsert 落盘，否则一律 not-executable。

三道闸（缺一道都不发请求）：
- 闸1 计划：首次调用不带 confirm 时返回**计划卡**（拓扑序 + 每节点方法/URL 骨架 + 写类节点 + 目标 host），不发任何请求、不建运行；
- 闸2 确认：向用户转述计划卡，得到确认后带 confirm=true 重调才真跑；
- 闸3 dry-run 优先：只想留档或先验证连接参数时用 dry_run=true——同一份计划、永不发请求，但会落一条 dryRun 留痕。

链里声明 cleanup 时，清理链会出现在同一张计划卡里一起确认；主链结束后按 onFailure/always 执行，清理失败不覆盖主链结果。
链里声明 verify 时，UI 验收会在主链后、cleanup 前执行（onSuccess/onFailure/always），失败不覆盖主链结果。

缺参判据不看卡的 required：卡模板里出现的入参，只要有常量或绑定边覆盖就不缺，否则预检直接 missing-params（回执逐条「节点 · 字段 · 类型」），整链不执行。

失败时（一个请求都不会发）：
- missing-params → 补 constants 或绑定边后 upsert 新版本，别重试同一份链；
- chain-not-found → 回执带 availableVersions，先 dataforge_chain_get 核对；
- invalid-chain → 文件坏或校验不过，issues 是 R-1 原文；
- base-url-unresolved → 显式传 baseUrl（卡的来源页面跨多个 origin 时只能人来定）；
- inputs-invalid → inputs 的键必须是链文件声明过的槽位；
- execution-disabled → 执行开关关着，链读写与历史回看照常。

运行期失败（binding-* / node-* / response-too-large / cancelled）不自动重试：链已中止，错误进运行记录，修好后用新 run 重跑（绝不自动重放写请求）。

鉴权（R-4 M1/M3）：按卡的采集来源自动注入本地凭证——cookie-session 注 cookie；token-header 注 Authorization（采集到的原文，Bearer/Basic 原样）；token-param 注 URL query。body token / localStorage token 本期只记录不注入（回执如实 unsupported，不猜）。401 回执区分「未采集到可用凭证」与「已注入但仍 401」。

自动换票：传 relogin（一条普通 interface-chain）后，401 会执行登录链、收割 set-cookie、单飞换票并重放当前节点一次；重放仍 401 就中止并报「换票后仍 401」。登录链的 inputs 只进内存，不写运行记录。

幂等性：**不幂等**。同一参数重复调用就是新 run、新请求。长链走宿主后台 job，用 dataforge_status 轮询、job_kill 取消。`,
		parameters: {
			site: {
				type: "string",
				required: true,
				description: "站点名（链的 meta.site）"
			},
			flow: {
				type: "string",
				required: true,
				description: "流程名（链的 meta.flow）"
			},
			version: {
				type: "number",
				description: "链版本；缺省最新"
			},
			inputs: {
				type: "object",
				additionalProperties: true,
				description: "链级槽位运行值（键必须已在链文件 inputs 里声明）"
			},
			baseUrl: {
				type: "string",
				description: "目标站点源（缺省从卡的来源页面 origin 推断；跨 origin 必须显式给）"
			},
			concurrency: {
				type: "number",
				description: "运行期并发上限（缺省 4，硬上限 16）"
			},
			dry_run: {
				type: "boolean",
				description: "只编译计划并落留痕，永不发请求"
			},
			confirm: {
				type: "boolean",
				description: "闸2：用户确认后才允许 true；缺省 = 只出计划卡"
			},
			relogin: {
				type: "object",
				additionalProperties: false,
				description: "可选：401 时自动执行的登录链（普通 interface-chain）。inputs 是登录链槽位值（账号/密码等），只在内存里过手，不写运行记录；不传 = 不换票。",
				properties: {
					site: {
						type: "string",
						required: true,
						description: "登录链的 meta.site"
					},
					flow: {
						type: "string",
						required: true,
						description: "登录链的 meta.flow"
					},
					version: {
						type: "number",
						description: "登录链版本；缺省最新"
					},
					inputs: {
						type: "object",
						additionalProperties: true,
						description: "登录链槽位运行值（不落盘、不写事件）"
					},
					baseUrl: {
						type: "string",
						description: "登录链目标源；缺省按登录链卡的来源 origin 推断"
					}
				}
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					accepted: { type: "boolean" },
					gate: {
						type: "string",
						description: "started / confirm-required / blocked"
					},
					code: {
						type: "string",
						description: "missing-params / chain-not-found / invalid-chain / base-url-unresolved / inputs-invalid / not-executable / cycle / execution-disabled / execution-unavailable / relogin-unavailable / relogin-failed / relogin-cycle"
					},
					message: { type: "string" },
					kind: {
						type: "string",
						description: "background / foreground / dry-run"
					},
					jobId: { type: "string" },
					runId: { type: "string" },
					runDir: { type: "string" },
					degradedNotice: { type: "string" },
					card: { type: "string" },
					plan: {
						type: "object",
						additionalProperties: false,
						properties: {
							order: {
								type: "array",
								items: { type: "string" }
							},
							totalNodes: { type: "number" },
							baseUrl: { type: "string" },
							host: { type: "string" },
							writeNodes: {
								type: "array",
								items: { type: "string" }
							},
							nodes: {
								type: "array",
								items: {
									type: "object",
									additionalProperties: false,
									properties: {
										nodeId: { type: "string" },
										method: { type: "string" },
										url: { type: "string" },
										dependsOn: {
											type: "array",
											items: { type: "string" }
										},
										writes: { type: "boolean" }
									}
								}
							},
							notices: {
								type: "array",
								items: { type: "string" }
							},
							cleanup: {
								type: "object",
								additionalProperties: false,
								properties: {
									site: { type: "string" },
									flow: { type: "string" },
									version: { type: "number" },
									when: { type: "string" },
									nodeCount: { type: "number" },
									writeCount: { type: "number" }
								}
							},
							verify: {
								type: "object",
								additionalProperties: false,
								properties: {
									site: { type: "string" },
									flow: { type: "string" },
									version: { type: "number" },
									when: { type: "string" }
								}
							}
						}
					},
					gaps: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								nodeId: { type: "string" },
								path: { type: "string" },
								type: { type: "string" },
								target: { type: "string" }
							}
						}
					},
					cycle: {
						type: "array",
						items: { type: "string" }
					},
					versions: {
						type: "array",
						items: { type: "number" }
					},
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								target: { type: "string" },
								code: { type: "string" },
								reason: { type: "string" }
							}
						}
					},
					nodes: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								nodeId: { type: "string" },
								status: { type: "string" },
								method: { type: "string" },
								url: { type: "string" },
								httpStatus: { type: "number" },
								attempts: { type: "number" },
								elapsedMs: { type: "number" },
								errorCode: { type: "string" },
								error: { type: "string" },
								relogin: {
									type: "object",
									additionalProperties: false,
									properties: {
										attempted: { type: "boolean" },
										success: { type: "boolean" },
										code: { type: "string" },
										message: { type: "string" },
										runId: { type: "string" },
										cookieNames: {
											type: "array",
											items: { type: "string" }
										},
										persisted: { type: "number" }
									}
								}
							}
						}
					},
					failedNode: { type: "string" },
					summary: {
						type: "object",
						additionalProperties: true,
						description: "运行摘要（前台/dry-run）"
					},
					cleanup: {
						type: "object",
						additionalProperties: false,
						properties: {
							site: { type: "string" },
							flow: { type: "string" },
							version: { type: "number" },
							when: { type: "string" },
							nodeCount: { type: "number" },
							writeCount: { type: "number" },
							runId: { type: "string" },
							status: { type: "string" },
							message: { type: "string" },
							skipped: { type: "string" }
						}
					},
					verify: {
						type: "object",
						additionalProperties: false,
						properties: {
							site: { type: "string" },
							flow: { type: "string" },
							version: { type: "number" },
							when: { type: "string" },
							runId: { type: "string" },
							success: { type: "boolean" },
							status: { type: "string" },
							screenshot: { type: "string" },
							datasetPath: { type: "string" },
							reportPath: { type: "string" },
							message: { type: "string" },
							skipped: { type: "string" }
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderChainRun(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await chainRunForTool(deps, exec, {
				site: args.site,
				flow: args.flow,
				...args.version === void 0 ? {} : { version: args.version },
				...args.inputs === void 0 ? {} : { inputs: args.inputs },
				...args.baseUrl === void 0 ? {} : { baseUrl: args.baseUrl },
				...args.concurrency === void 0 ? {} : { concurrency: args.concurrency },
				...args.dry_run === void 0 ? {} : { dryRun: args.dry_run },
				...args.confirm === void 0 ? {} : { confirm: args.confirm },
				...args.relogin === void 0 ? {} : { relogin: args.relogin }
			}));
		}
	});
}
function renderChainProbe(value) {
	const head = `🔎 节点试探：${value.nodeId || "?"}（${value.method || "?"}）`;
	if (value.gate === "confirm-required") {
		const plan = value.plan;
		const inputs = (plan?.cardInputs ?? []).map((input) => `- ${input.path}（${input.type}${input.required ? "，必填" : ""}）`).join("\n");
		return [
			`⚠️ 写操作需要确认：${plan?.method ?? value.method} ${plan?.urlTemplate ?? ""}`,
			"向用户确认后带 confirm=true 重调；本次没有发出任何请求。",
			inputs === "" ? "" : `卡入参模板：\n${inputs}`
		].filter(Boolean).join("\n");
	}
	if (value.gate === "paused") {
		const gaps = (value.gaps ?? []).map((gap) => `- ${gap.path}（${gap.type}）`).join("\n");
		const inputs = (value.cardInputs ?? []).map((input) => `- ${input.path}（${input.type}${input.required ? "，必填" : ""}）`).join("\n");
		return [
			`⏸ 缺参暂停（未发请求）：${value.message ?? ""}`,
			gaps === "" ? "" : `缺什么：\n${gaps}`,
			inputs === "" ? "" : `卡入参模板：\n${inputs}`,
			value.runId === void 0 ? "" : `留痕：${value.runId}`
		].filter(Boolean).join("\n");
	}
	if (!value.ok) {
		const response = value.response === void 0 ? "" : `\nHTTP ${value.response.status}：${value.response.bodyPreview}`;
		return `❌ 试探未完成（${value.code ?? "unknown"}）：${value.message ?? ""}${response}${value.runId === void 0 ? "" : `\n留痕：${value.runId}`}`;
	}
	const req = value.request === void 0 ? "" : `→ ${value.request.method} ${value.request.url}`;
	const resp = value.response === void 0 ? "" : `← HTTP ${value.response.status}（${value.response.bytes}B${value.response.truncated ? "，截断" : ""}）`;
	const provenance = (value.provenance ?? []).map((item) => {
		const evidence = item.evidence === void 0 ? "" : `，依据：${item.evidence}`;
		return `- ${item.path} ← ${item.source}${evidence}${item.valuePreview === void 0 ? "" : `（${item.valuePreview}）`}`;
	});
	const outputs = (value.outputs ?? []).slice(0, RECEIPT_MAX_LINES).map((output) => {
		if (output.error !== void 0) return `- ${output.path}（${output.type}）：取不到（${output.error}）`;
		return `- ${output.path}（${output.type}）：${output.valuePreview ?? "（空）"}`;
	});
	return [
		`${head} ${req} ${resp}`,
		value.attempts === void 0 ? "" : `尝试：${value.attempts}`,
		provenance.length === 0 ? "" : `值来源：\n${provenance.join("\n")}`,
		outputs.length === 0 ? "" : `卡出参实际值（用来发现绑定）：\n${outputs.join("\n")}`,
		value.runId === void 0 ? "" : `留痕：${value.runId}（explorationId ${value.explorationId ?? "?"}）`,
		"下一步：用 dataforge_chain_upsert 把发现的绑定边写回链，再 dataforge_chain_run 整链执行。"
	].filter(Boolean).join("\n");
}
function defineChainProbeTool(deps) {
	return defineTool({
		name: "dataforge_chain_probe",
		description: `单节点试探（R-5 首跑）：只对链上的一个节点发**一发**请求，返回请求/响应摘要与卡出参实际值；不消费绑定边、不写链文件、不整链重跑。

值的形状：values = { "<卡字段路径>": { value, source, evidence? } }。
- source=user：用户明确给出的值（evidence 建议写原话）；
- source=agent-inferred：agent 推断的值，**必须给 evidence**；
- source=upstream：来自某次 probe 的响应，**必须给 evidence**（如 probe:<runId> · body.items[0].internalId）；
- 节点 constants 自动标 constant，不用放进 values。

三道门：
- 缺参：在发请求前返回 paused + gaps + 卡入参模板，一个请求都不发；
- 写操作（POST/PUT/PATCH/DELETE）：没有 confirm=true 只出计划卡，一个请求都不发；
- 敏感字段（password/token/secret/authorization/cookie/api-key…）的值在留痕里写 ***。

失败时：invalid-source / unknown-value / node-not-found / base-url-unresolved 在发请求前拒；HTTP 非 2xx、超时、网络错如实落 run 并返回 response 摘要。probe 不换票；需要登录态的节点请先确认凭证，或改走 dataforge_chain_run 的 relogin。

首跑闭环：probe 试探 → 读 outputs 发现绑定 → dataforge_chain_upsert 写边 → dataforge_chain_run 整链。`,
		parameters: {
			site: {
				type: "string",
				required: true,
				description: "站点名（链的 meta.site）"
			},
			flow: {
				type: "string",
				required: true,
				description: "流程名（链的 meta.flow）"
			},
			version: {
				type: "number",
				description: "链版本；缺省最新"
			},
			node: {
				type: "string",
				required: true,
				description: "链上的节点 id（nodes[].id）"
			},
			values: {
				type: "object",
				additionalProperties: true,
				description: "卡字段路径 → { value, source, evidence? }；source 只允许 user / agent-inferred / upstream"
			},
			inputs: {
				type: "object",
				additionalProperties: true,
				description: "链级槽位运行值（给节点常量里的 $inputs.x 用）"
			},
			baseUrl: {
				type: "string",
				description: "目标站点源；缺省从卡的来源页面 origin 推断"
			},
			confirm: {
				type: "boolean",
				description: "写操作必须显式确认；缺省 = 只出计划卡"
			},
			retry: {
				type: "number",
				description: "仅 GET/HEAD/OPTIONS 生效；0..3 封顶，写方法强制 0"
			},
			explorationId: {
				type: "string",
				description: "同一轮首跑的探索组 ID；缺省自动生成 exp_<timestamp>"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					gate: {
						type: "string",
						description: "executed / paused / confirm-required / failed / blocked"
					},
					code: { type: "string" },
					message: { type: "string" },
					runId: { type: "string" },
					runDir: { type: "string" },
					explorationId: { type: "string" },
					nodeId: { type: "string" },
					cardId: { type: "string" },
					method: { type: "string" },
					gaps: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: { type: "string" },
								type: { type: "string" },
								target: { type: "string" }
							}
						}
					},
					cardInputs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: { type: "string" },
								type: { type: "string" },
								required: { type: "boolean" },
								role: { type: "string" }
							}
						}
					},
					plan: {
						type: "object",
						additionalProperties: false,
						properties: {
							nodeId: { type: "string" },
							method: { type: "string" },
							urlTemplate: { type: "string" },
							writes: { type: "boolean" },
							cardInputs: {
								type: "array",
								items: {
									type: "object",
									additionalProperties: false,
									properties: {
										path: { type: "string" },
										type: { type: "string" },
										required: { type: "boolean" },
										role: { type: "string" }
									}
								}
							}
						}
					},
					request: {
						type: "object",
						additionalProperties: false,
						properties: {
							method: { type: "string" },
							url: { type: "string" },
							headers: {
								type: "object",
								additionalProperties: true
							},
							bodyPreview: { type: "string" }
						}
					},
					response: {
						type: "object",
						additionalProperties: false,
						properties: {
							status: { type: "number" },
							bytes: { type: "number" },
							truncated: { type: "boolean" },
							bodyPreview: { type: "string" }
						}
					},
					outputs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: { type: "string" },
								type: { type: "string" },
								valuePreview: { type: "string" },
								redacted: { type: "boolean" },
								error: { type: "string" }
							}
						}
					},
					provenance: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: { type: "string" },
								source: { type: "string" },
								evidence: { type: "string" },
								valuePreview: { type: "string" },
								redacted: { type: "boolean" }
							}
						}
					},
					attempts: { type: "number" },
					credentials: {
						type: "object",
						additionalProperties: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderChainProbe(tighten(value))
			}]
		},
		async execute(args, exec) {
			const values = args.values;
			return lossless(await probeForTool(deps, exec, {
				site: args.site,
				flow: args.flow,
				node: args.node,
				...args.version === void 0 ? {} : { version: args.version },
				...values === void 0 ? {} : { values },
				...args.inputs === void 0 ? {} : { inputs: args.inputs },
				...args.baseUrl === void 0 ? {} : { baseUrl: args.baseUrl },
				...args.confirm === void 0 ? {} : { confirm: args.confirm },
				...args.retry === void 0 ? {} : { retry: args.retry },
				...args.explorationId === void 0 ? {} : { explorationId: args.explorationId }
			}));
		}
	});
}
function renderChainCrystal(value) {
	if (value.gate === "blocked") {
		const issues = (value.issues ?? []).map((issue) => `- ${issue.target}：${issue.reason}`).join("\n");
		return `❌ 结晶未完成（${value.code ?? "unknown"}）：${value.message ?? ""}${issues === "" ? "" : `\n${issues}`}`;
	}
	const rows = value.draft?.rows ?? value.rows ?? [];
	const lines = rows.slice(0, RECEIPT_MAX_LINES).map((row) => {
		const flags = [
			row.requiresUserConfirmation ? "需用户确认" : "",
			row.conflict ? "冲突" : "",
			row.excluded === void 0 ? "" : `排除：${row.excluded}`
		].filter(Boolean).join("；");
		const valueText = row.excluded === void 0 ? ` = ${row.value === void 0 ? "" : JSON.stringify(row.value)}` : "";
		return `- ${row.nodeId} · ${row.path} ← ${row.source} → ${row.suggestion}${valueText}${flags === "" ? "" : `（${flags}）`}`;
	});
	const more = rows.length > RECEIPT_MAX_LINES ? `\n… 还有 ${rows.length - RECEIPT_MAX_LINES} 行` : "";
	const inputs = (value.inputs ?? []).map((slot) => `- ${slot.name}: ${slot.type}${slot.required ? "（必填）" : ""}${slot.example === void 0 ? "" : `，例 ${slot.example}`}`).join("\n");
	return [
		value.gate === "written" ? `✅ ${value.message ?? "结晶已写回"}\n版本：v${value.version ?? "?"}（${value.path ?? "?"}）` : `📝 结晶草案（未写链）：${rows.length} 行\n${lines.join("\n")}${more}`,
		value.gate === "written" && lines.length > 0 ? `\n本次分类：\n${lines.join("\n")}${more}` : "",
		inputs === "" ? "" : `\n链级槽位：\n${inputs}`,
		value.runId === void 0 ? "" : `\n留痕：${value.runId}`,
		value.gate === "written" ? "\n下一步：dataforge_chain_run(inputs:{...}, confirm:true) 换入参复跑。" : "\n确认草案后带 confirm=true 重调；agent-inferred 行需在 decisions 里 confirmed:true。",
		(value.warnings ?? []).length === 0 ? "" : `\n提醒：${(value.warnings ?? []).join("；")}`
	].filter(Boolean).join("\n");
}
function defineChainCrystalTool(deps) {
	return defineTool({
		name: "dataforge_chain_crystallize",
		description: `结晶（R-6）：读同一 explorationId 的 probe 留痕，按来源给出三分类草案；confirm=true 后写回链的新版本。

分类铁律（工具层强制）：
- source=user → 入参槽位（链级 inputs + 节点 constants: "$inputs.<name>"）；
- source=constant → 节点 constants；
- source=upstream → 链生成值，**绝不冻结**，只校验已有绑定边；任何把 upstream 当 constant/input 的决策都会被 crystal-iron-rule 拒绝；
- source=agent-inferred → 入参候选，必须在 decisions 里 confirmed:true（用户确认过）才写。

用法：
- 不带 confirm 只返回草案（draft），不写链；
- decisions 的键是 "<nodeId>:<path>"，值形如 { "as": "input"|"constant", "slotName"?: "...", "confirmed"?: true }；
- 冲突行（同一 path 多条 probe 值/来源不一致）必须用 decisions 明确选一个，否则 crystal-conflict；
- 写回只走 saveChain（R-1 校验 + 新版本），失败不落盘。

结晶后复跑：dataforge_chain_run(site, flow, inputs:{...}, confirm:true)；链生成值会由上游响应重新求解。`,
		parameters: {
			site: {
				type: "string",
				required: true,
				description: "站点名（链的 meta.site）"
			},
			flow: {
				type: "string",
				required: true,
				description: "流程名（链的 meta.flow）"
			},
			version: {
				type: "number",
				description: "链版本；缺省最新"
			},
			explorationId: {
				type: "string",
				description: "要结晶的探索组；缺省 = 该 site/flow 最近一组 probe"
			},
			confirm: {
				type: "boolean",
				description: "确认草案后才允许 true；缺省只返回草案，不写链"
			},
			decisions: {
				type: "object",
				additionalProperties: true,
				description: "键 \"<nodeId>:<path>\"，值 { as: \"input\"|\"constant\", slotName?, confirmed? }；agent-inferred 行必须 confirmed:true"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					gate: {
						type: "string",
						description: "draft / written / blocked"
					},
					code: { type: "string" },
					message: { type: "string" },
					draft: {
						type: "object",
						additionalProperties: true
					},
					rows: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					},
					inputs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					},
					version: { type: "number" },
					path: { type: "string" },
					runId: { type: "string" },
					runDir: { type: "string" },
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								target: { type: "string" },
								code: { type: "string" },
								reason: { type: "string" }
							}
						}
					},
					warnings: {
						type: "array",
						items: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderChainCrystal(tighten(value))
			}]
		},
		async execute(args, exec) {
			const decisions = args.decisions;
			return lossless(crystalOutputOf(await crystalForTool(deps, exec, {
				site: args.site,
				flow: args.flow,
				...args.version === void 0 ? {} : { version: args.version },
				...args.explorationId === void 0 ? {} : { explorationId: args.explorationId },
				...args.confirm === void 0 ? {} : { confirm: args.confirm },
				...decisions === void 0 ? {} : { decisions }
			})));
		}
	});
}
function renderChainDiagnose(value) {
	if (!value.ok) return `❌ 诊断不可用（${value.code ?? "unknown"}）：${value.message ?? ""}`;
	const chain = value.chain === void 0 ? "" : `${value.chain.site}/${value.chain.flow} v${value.chain.version}`;
	const failed = value.failedNode === void 0 ? "" : `断点：${value.failedNode}${value.errorCode === void 0 ? "" : `（${value.errorCode}）`}`;
	const nodeLines = (value.nodes ?? []).map((node) => {
		const http = node.httpStatus === void 0 ? "" : ` HTTP ${node.httpStatus}`;
		const error = node.errorCode === void 0 ? "" : ` ${node.errorCode}`;
		return `- ${node.nodeId}：${node.status}${http}${error}`;
	});
	const edgeLines = (value.edges ?? []).map((edge) => {
		return `- ${edge.suspect ? "⚠️ " : ""}${edge.from} → ${edge.to}（上游 ${edge.sourceNode}: ${edge.sourceStatus}${edge.reason === void 0 ? "" : `；${edge.reason}`}）`;
	});
	const failedRequest = value.failed?.request;
	const failedResponse = value.failed?.response;
	const req = failedRequest === void 0 ? "" : `请求：${String(failedRequest["method"] ?? "")} ${String(failedRequest["url"] ?? "")}`;
	const resp = failedResponse === void 0 ? "" : `响应：HTTP ${String(failedResponse["status"] ?? "?")} ${String(failedResponse["bodyPreview"] ?? "")}`;
	return [
		`🩺 复跑诊断：${value.runId} ${chain === "" ? "" : `（${chain}）`} ${value.status ?? ""}`,
		failed,
		value.error === void 0 ? "" : `错误：${value.error}`,
		nodeLines.length === 0 ? "" : `节点：\n${nodeLines.join("\n")}`,
		edgeLines.length === 0 ? "" : `入边：\n${edgeLines.join("\n")}`,
		req === "" ? "" : req,
		resp === "" ? "" : resp,
		(value.hints ?? []).length === 0 ? "" : `建议：\n${(value.hints ?? []).map((hint) => `- ${hint}`).join("\n")}`
	].filter(Boolean).join("\n");
}
function defineChainDiagnoseTool(deps) {
	return defineTool({
		name: "dataforge_chain_diagnose",
		description: `复跑诊断（R-6）：只读一条失败的链运行，回答「断在哪个节点、哪条绑定边、上游什么状态、下一步改什么」。

读 run.json 与 events.ndjson：
- 失败节点 / 错误码 / 错误原文 / 请求与响应摘要；
- 节点级状态（done/error/started）；
- 失败节点的入边（from → to、上游节点状态、是否可疑）；
- 按错误码给下一步建议（绑定断点、鉴权、换票、HTTP 失败…）。

只读：不重跑、不改链、不碰凭证。要重跑请用 dataforge_chain_run；要重新试探请用 dataforge_chain_probe。`,
		parameters: { run_id: {
			type: "string",
			required: true,
			description: "链运行的 runId（dataforge_chain_run 回执里的 runId）"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: { type: "string" },
					message: { type: "string" },
					runId: { type: "string" },
					status: { type: "string" },
					chain: {
						type: "object",
						additionalProperties: false,
						properties: {
							site: { type: "string" },
							flow: { type: "string" },
							version: { type: "number" }
						}
					},
					params: {
						type: "object",
						additionalProperties: true
					},
					failedNode: { type: "string" },
					errorCode: { type: "string" },
					error: { type: "string" },
					nodes: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								nodeId: { type: "string" },
								status: { type: "string" },
								httpStatus: { type: "number" },
								attempts: { type: "number" },
								elapsedMs: { type: "number" },
								errorCode: { type: "string" },
								error: { type: "string" }
							}
						}
					},
					failed: {
						type: "object",
						additionalProperties: false,
						properties: {
							action: { type: "string" },
							request: {
								type: "object",
								additionalProperties: true
							},
							response: {
								type: "object",
								additionalProperties: true
							}
						}
					},
					edges: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								from: { type: "string" },
								to: { type: "string" },
								sourceNode: { type: "string" },
								sourceStatus: { type: "string" },
								suspect: { type: "boolean" },
								reason: { type: "string" }
							}
						}
					},
					hints: {
						type: "array",
						items: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderChainDiagnose(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(diagnoseOutputOf(await diagnoseForTool(deps, exec, { runId: args.run_id })));
		}
	});
}
/** 对照值的人话预览：对象/数组截 120 字，避免回执被整段正文撑爆。 */
function previewOfJson(value) {
	if (value === void 0) return "（缺）";
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
function renderChainCompare(value) {
	if (!value.ok) return `❌ 对照失败（${value.code ?? "unknown"}）：${value.message ?? ""}`;
	const runs = value.runs ?? [];
	const base = runs[0];
	const target = runs[1];
	if (base === void 0 || target === void 0) return "❌ 对照失败：回执缺少一侧 run";
	const versionOf = (run) => run.chain === void 0 ? "" : ` v${run.chain.version}`;
	const header = `🆚 复跑对照：${base.runId}${versionOf(base)} → ${target.runId}${versionOf(target)}`;
	const stateOf = (run) => `${run.status}${run.failedNode === void 0 ? "" : `（断在 ${run.failedNode}）`}`;
	const inputLines = (value.inputs ?? []).filter((row) => row.changed).slice(0, RECEIPT_MAX_LINES).map((row) => `- ${row.key}：${previewOfJson(row.base)} → ${previewOfJson(row.target)}`);
	const nodeLines = (value.nodes ?? []).filter((row) => row.changed).slice(0, RECEIPT_MAX_LINES).map((row) => {
		const http = (from, to) => from === to ? from === void 0 ? "" : ` HTTP ${from}` : ` HTTP ${from ?? "?"} → ${to ?? "?"}`;
		const elapsed = (from, to) => from === to ? from === void 0 ? "" : ` ${from}ms` : ` ${from ?? "?"}ms → ${to ?? "?"}ms`;
		return `- ${row.nodeId}：${row.baseStatus ?? "缺"} → ${row.targetStatus ?? "缺"}${http(row.baseHttpStatus, row.targetHttpStatus)}${elapsed(row.baseElapsedMs, row.targetElapsedMs)}`;
	});
	const emittedLines = (value.emitted ?? []).filter((row) => row.changed).slice(0, RECEIPT_MAX_LINES).map((row) => `- ${row.nodeId} · ${row.path}：${previewOfJson(row.base)} → ${previewOfJson(row.target)}`);
	const summary = value.summary;
	const summaryLine = summary === void 0 ? "" : `差异：入参 ${summary.inputsChanged} / 出参 ${summary.emittedChanged} / 节点 ${summary.nodesChanged}`;
	return [
		header,
		`状态：${stateOf(base)} → ${stateOf(target)}`,
		inputLines.length === 0 ? "入参：无差异" : `入参变化：\n${inputLines.join("\n")}`,
		emittedLines.length === 0 ? "出参：无差异" : `出参变化（链生成值重新求解）：\n${emittedLines.join("\n")}`,
		nodeLines.length === 0 ? "节点：无差异" : `节点变化：\n${nodeLines.join("\n")}`,
		summaryLine,
		(value.hints ?? []).length === 0 ? "" : `提示：\n${(value.hints ?? []).map((hint) => `- ${hint}`).join("\n")}`
	].filter(Boolean).join("\n");
}
function defineChainCompareTool(deps) {
	return defineTool({
		name: "dataforge_chain_compare",
		description: `复跑对照（R-6 M2）：把两次 chain-run 的留痕并排投影成差异视图，回答「换入参复跑后什么变了、链生成值是不是重新求解」。

输入 run_ids = [基线 runId, 对照 runId]（runId 来自 dataforge_chain_run / dataforge_status / dataforge_chain_runs）。
输出：
- runs：两侧的身份快照（链版本、params、状态、failedNode）；
- inputs：链级入参逐槽位差异（changed）；
- emitted：各节点出参（绑定边 from 取到的实际值）差异——复跑换了 C/D 时这里应看到新求解值，证明没吃首跑缓存；
- nodes：节点状态/HTTP/耗时对照；
- summary + hints：版本不同、入参变化、失败节点变化等提示。

只读：不重跑、不发请求、不改链；敏感键（password/token/authorization/cookie 等）在输出里一律 ***，不含任何 header 原文。

失败时：invalid-run-ids（须恰好两个非空 runId）/ run-not-found（run.json 或事件留痕缺失）/ not-chain-run（不是链运行）。`,
		parameters: { run_ids: {
			type: "array",
			required: true,
			items: { type: "string" },
			description: "[基线 runId, 对照 runId]：先首跑、后复跑"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: {
						type: "string",
						description: "invalid-run-ids / run-not-found / not-chain-run"
					},
					message: { type: "string" },
					runs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								runId: { type: "string" },
								chain: {
									type: "object",
									additionalProperties: false,
									properties: {
										site: { type: "string" },
										flow: { type: "string" },
										version: { type: "number" }
									}
								},
								params: {
									type: "object",
									additionalProperties: true
								},
								status: { type: "string" },
								failedNode: { type: "string" },
								startedAt: { type: "number" }
							}
						}
					},
					inputs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								key: { type: "string" },
								base: { type: "json" },
								target: { type: "json" },
								changed: { type: "boolean" }
							}
						}
					},
					nodes: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								nodeId: { type: "string" },
								baseStatus: { type: "string" },
								targetStatus: { type: "string" },
								baseHttpStatus: { type: "number" },
								targetHttpStatus: { type: "number" },
								baseElapsedMs: { type: "number" },
								targetElapsedMs: { type: "number" },
								changed: { type: "boolean" }
							}
						}
					},
					emitted: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								nodeId: { type: "string" },
								path: { type: "string" },
								base: { type: "json" },
								target: { type: "json" },
								changed: { type: "boolean" }
							}
						}
					},
					summary: {
						type: "object",
						additionalProperties: false,
						properties: {
							nodesChanged: { type: "number" },
							emittedChanged: { type: "number" },
							inputsChanged: { type: "number" },
							baseFailedNode: { type: "string" },
							targetFailedNode: { type: "string" }
						}
					},
					hints: {
						type: "array",
						items: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderChainCompare(tighten(value))
			}]
		},
		async execute(args) {
			return lossless(await compareForTool(deps, { runIds: [args.run_ids[0], args.run_ids[1]] }));
		}
	});
}
function renderChainRuns(value) {
	if (value.notice !== void 0 && (value.runs ?? []).length === 0) return `📭 ${value.notice}`;
	const lines = (value.runs ?? []).map((run) => {
		const version = run.version === void 0 ? "" : ` v${run.version}`;
		const failed = run.failedNode === void 0 ? "" : `，断在 ${run.failedNode}`;
		const dry = run.dryRun ? "（dry-run）" : "";
		return `- ${run.runId}${version}${dry}：${run.status} ${run.stepsDone}/${run.totalSteps} 步${failed}`;
	});
	const notice = value.notice === void 0 ? "" : `\n⚠ ${value.notice}`;
	return `🗂 链运行留痕 ${(value.runs ?? []).length} 条：\n${lines.join("\n")}${notice}`;
}
function defineChainRunsTool(deps) {
	return defineTool({
		name: "dataforge_chain_runs",
		description: `按链列运行留痕（链详情·运行 tab 的数据面）。

读 run.json 的 chain 段过滤（写入时快照）：链被改名/删掉，历史运行仍能列出。
状态现折叠（与 dataforge_status 同一套投影），所以运行中的链也能看到节点级进度。

失败时：
- 没有任何匹配运行 → ok:true + notice「该链暂无运行留痕」（空态是常态，不是错误）；
- 某条 run.json 损坏 → 跳过并在 notice 里计数，不阻断整批。

只读，天然幂等。要节点级细节（失败原因、请求摘要）用 dataforge_status(run_id)。`,
		parameters: {
			site: {
				type: "string",
				required: true,
				description: "站点名（链的 meta.site）"
			},
			flow: {
				type: "string",
				required: true,
				description: "流程名（链的 meta.flow）"
			},
			version: {
				type: "number",
				description: "只列这个链版本的运行；缺省 = 该链全部版本"
			},
			limit: {
				type: "number",
				description: "返回条数上限（缺省 20，上限 200）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					notice: { type: "string" },
					runs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								runId: { type: "string" },
								status: { type: "string" },
								startedAt: { type: "number" },
								updatedAt: { type: "number" },
								dryRun: { type: "boolean" },
								stepsDone: { type: "number" },
								totalSteps: { type: "number" },
								version: { type: "number" },
								failedNode: { type: "string" },
								flow: { type: "string" },
								flowName: { type: "string" },
								message: { type: "string" }
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderChainRuns(tighten(value))
			}]
		},
		async execute(args) {
			return lossless(listChainRunsForTool(deps, {
				site: args.site,
				flow: args.flow,
				...args.version === void 0 ? {} : { version: args.version },
				...args.limit === void 0 ? {} : { limit: args.limit }
			}));
		}
	});
}
function renderUiScriptGet(value) {
	if (!value.ok) {
		const versions = (value.availableVersions ?? []).map((n) => `v${n}`).join(" / ");
		return `❌ 读 UI 脚本失败（${value.code ?? "unknown"}）：${value.message ?? ""}${versions === "" ? "" : `\n可用版本：${versions}`}${renderChainIssues(value.issues?.map((item) => ({
			...item,
			code: item.code
		})))}`;
	}
	const scripts = value.scripts ?? [];
	if (value.doc === void 0) {
		if (scripts.length === 0) return "📂 还没有 UI 脚本。先 dataforge_ui_record_open → record_start 录制，或用 dataforge_ui_script_upsert 手写。";
		const lines = scripts.map((script) => {
			const versions = script.versions.map((n) => `v${n}`).join("/");
			return `- ${script.site} / ${script.flow} ｜ ${versions} ｜ 最新 v${script.latest}${script.unreadable === void 0 ? "" : ` ⚠ ${script.unreadable}`}`;
		});
		return `🧪 UI 脚本 ${scripts.length} 个：\n${lines.join("\n")}`;
	}
	const doc = value.doc;
	const steps = doc.steps.map((step, index) => {
		const target = step.selector ?? step.url ?? step.key ?? "";
		const expects = step.expect === void 0 ? "" : ` ｜ 断言 ${step.expect.length}`;
		return `${index + 1}. ${step.kind}${step.value === void 0 ? "" : ` = ${step.value}`}${target === "" ? "" : ` @ ${target}`}${expects}`;
	});
	return `${`🧪 ${doc.meta.site} / ${doc.meta.flow} v${value.version ?? doc.meta.version} ｜ 起点 ${doc.meta.startUrl} ｜ ${doc.steps.length} 步`}${doc.inputs.length === 0 ? "" : `\n入参：${doc.inputs.map((input) => `${input.name}(${input.type}${input.required ? ",必填" : ""})`).join("、")}`}\n${steps.join("\n")}\n\`\`\`yaml\n${value.yaml ?? ""}\`\`\``;
}
function defineUiScriptGetTool(deps) {
	return defineTool({
		name: "dataforge_ui_script_get",
		description: `读 UI 测试脚本（浏览器录制/回放用）：给 site+flow 回某版本的步骤 + YAML 原文；不给就列全部脚本。

UI 脚本与接口链（interface-chain）是两条执行面：链发 HTTP、断言响应字段；UI 脚本开真浏览器、
断言页面状态（元素/文本/URL）。脚本落在工作区 .dsh/dataforge/ui-tests/<site>/<flow>/vN.yaml。

返回 false 的失败码：ui-script-not-found / invalid-ui-script（坏文件带 issues 与可用版本）。`,
		parameters: {
			site: {
				type: "string",
				description: "站点名；与 flow 一起给才回详情"
			},
			flow: {
				type: "string",
				description: "流程名；与 site 一起给才回详情"
			},
			version: {
				type: "number",
				description: "脚本版本；缺省最新"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					code: { type: "string" },
					message: { type: "string" },
					scripts: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								site: { type: "string" },
								flow: { type: "string" },
								latest: { type: "number" },
								versions: {
									type: "array",
									items: { type: "number" }
								},
								domain: { type: "string" },
								updatedAt: { type: "string" },
								unreadable: { type: "string" }
							}
						}
					},
					site: { type: "string" },
					flow: { type: "string" },
					version: { type: "number" },
					availableVersions: {
						type: "array",
						items: { type: "number" }
					},
					yaml: { type: "string" },
					doc: {
						type: "object",
						additionalProperties: true
					},
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								target: { type: "string" },
								code: { type: "string" },
								reason: { type: "string" }
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderUiScriptGet(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await getUiScriptForTool(deps, exec, {
				...args.site === void 0 ? {} : { site: args.site },
				...args.flow === void 0 ? {} : { flow: args.flow },
				...args.version === void 0 ? {} : { version: args.version }
			}));
		}
	});
}
function renderUiScriptUpsert(value) {
	if (!value.ok) return `❌ 保存失败：${value.message ?? ""}${renderChainIssues(value.issues?.map((item) => ({
		...item,
		code: item.code
	})))}`;
	return `✅ 已保存 UI 脚本 ${value.site} / ${value.flow} → v${value.version}（${value.path ?? ""}）`;
}
function defineUiScriptUpsertTool(deps) {
	return defineTool({
		name: "dataforge_ui_script_upsert",
		description: `写入 UI 测试脚本（agent 手写/编辑的唯一入口）：YAML 全文进，校验全过才落**新版本**（vN+1，旧版本不覆盖）。

YAML 形状（apiVersion: dataforge/v1）：
\`\`\`yaml
kind: ui-script
meta: { site, flow, version: 1, created, startUrl, viewport? }
inputs: [{ name, type: string|number|boolean, required, example? }]
steps:
  - id: s1
    kind: goto | click | fill | press | select | submit | wait | upload
    selector: '#kw'            # 或 candidates: [...]（有序候选，回放取第一个唯一命中）
    value: '{{keyword}}'       # fill/select；{{input}} 是入参槽位
    key: Enter                 # press
    ms: 300                    # wait（0..60000）
    url: 'https://…'           # goto
    files: ['/tmp/a.txt']      # upload（回放机路径）
    expect: [{ kind: visible|hidden|text|value|url|count, selector?, equals?, contains? }]
\`\`\`
校验不过一律不落盘（缺步骤/缺 selector/断言不完整/入参引用未声明/声明了没用都会拒）。

**另存为新流程**：改 YAML 的 meta.site / meta.flow 再 upsert，就会在新站点/流程下写 v1（原流程不受影响）——
适合「同一套操作、只改选择的类型/选项」的变体；同一流程多组值优先用入参槽位 {{name}}。

失败码：invalid-ui-script（issues 逐条 target：reason）。`,
		parameters: {
			yaml: {
				type: "string",
				required: true,
				description: "ui-script 的完整 YAML 文本"
			},
			source: {
				type: "string",
				description: "版本来源标注（缺省 agent；可选 agent/canvas/record）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					site: { type: "string" },
					flow: { type: "string" },
					version: { type: "number" },
					path: { type: "string" },
					message: { type: "string" },
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								target: { type: "string" },
								code: { type: "string" },
								reason: { type: "string" }
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderUiScriptUpsert(tighten(value))
			}]
		},
		async execute(args, exec) {
			const source = args.source === "canvas" || args.source === "record" ? args.source : "agent";
			return lossless(await upsertUiScriptForTool(deps, exec, {
				yaml: args.yaml,
				source
			}));
		}
	});
}
function renderUiRecordOpen(value) {
	if (!value.ok) return `❌ 打开录制会话失败：${value.error ?? ""}`;
	return `🖥 已打开录制浏览器（sessionId ${value.sessionId ?? "?"}，当前页 ${value.pageUrl ?? ""}）。\n${value.notice ?? "先登录/导航，再 dataforge_ui_record_start 开始录制。"}`;
}
function defineUiRecordOpenTool(deps) {
	return defineTool({
		name: "dataforge_ui_record_open",
		description: `打开一个**可见** Chrome 窗口用于 UI 录制（此时还没开始录，登录动作不会进脚本）。

用法：open → 用户在窗口里登录/导航 → dataforge_ui_record_start → 用户操作业务 → dataforge_ui_record_stop。
录制时密码输入与文件选择会被跳过（凭证/本地路径不落脚本，回执如实计数）。
**站点名/流程名留空会自动命名**：站点取 og:site_name 或域名，流程取页面标题（去站点后缀）；
open 回执会带 suggestedSite/suggestedFlow，可用作预填。
回放登录态靠录制结束时持久化的 cookie（dataRoot/credentials/cookies.json，0600）。

失败：record-open-failed（Chrome 起不来/URL 非法）。`,
		parameters: {
			start_url: {
				type: "string",
				required: true,
				description: "录制起点（http/https）"
			},
			headless: {
				type: "boolean",
				description: "谨慎使用：true = 无头（只适合无需登录的站点，缺省可见）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					sessionId: { type: "string" },
					pageUrl: { type: "string" },
					engine: { type: "string" },
					notice: { type: "string" },
					suggestedSite: { type: "string" },
					suggestedFlow: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderUiRecordOpen(tighten(value))
			}]
		},
		async execute(args, exec) {
			const owner = ownerOf(exec);
			return lossless(await openRecordingForTool(deps, {
				startUrl: args.start_url,
				...args.headless === void 0 ? {} : { headless: args.headless },
				...owner === void 0 ? {} : { ownerSessionId: owner }
			}));
		}
	});
}
function defineUiRecordStartTool(deps) {
	return defineTool({
		name: "dataforge_ui_record_start",
		description: `在已打开的录制会话上开始录制（注入事件监听，捕获 click/fill/select/submit/press）。
开始前请让用户完成登录/导航；之后的业务操作才会进脚本。

回放会沿用录制时的视口与起点 URL；录制结束用 dataforge_ui_record_stop 取步骤。`,
		parameters: { session_id: {
			type: "string",
			required: true,
			description: "dataforge_ui_record_open 返回的 sessionId"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					sessionId: { type: "string" },
					pageUrl: { type: "string" },
					alreadyRecording: { type: "boolean" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				if (!v.ok) return [{
					type: "text",
					text: `❌ 开始录制失败：${v.error ?? ""}`
				}];
				return [{
					type: "text",
					text: `🔴 已开始录制（sessionId ${v.sessionId ?? "?"}，页 ${v.pageUrl ?? ""}）。用户在浏览器里操作，完成后调 dataforge_ui_record_stop。${v.alreadyRecording === true ? "（此前已在录制）" : ""}`
				}];
			}
		},
		async execute(args) {
			return lossless(await startRecordingForTool(deps, { sessionId: args.session_id }));
		}
	});
}
function renderUiRecordStop(value) {
	if (!value.ok) return `❌ 停止录制失败：${value.error ?? ""}`;
	const steps = value.steps ?? [];
	const lines = steps.slice(0, 20).map((step, index) => {
		const target = step.selector ?? step.url ?? step.key ?? "";
		return `${index + 1}. ${step.kind}${step.value === void 0 ? "" : ` = ${step.value}`}${target === "" ? "" : ` @ ${target}`}`;
	});
	const saved = value.saved === void 0 ? "未保存为脚本（给 site/flow 再 stop 才会落新版本）" : `已保存为 ${value.saved.site} / ${value.saved.flow} v${value.saved.version}`;
	const notice = value.notice === void 0 ? "" : `\n⚠ ${value.notice}`;
	return `⏹ 录制结束：${value.stepCount ?? steps.length} 步 ｜ 跳过密码 ${value.skippedSecrets ?? 0} 次 / 上传 ${value.skippedUploads ?? 0} 次 ｜ cookie 持久化 ${value.persistedCookies ?? 0} 条\n${saved}${notice}\n${lines.join("\n")}${steps.length > 20 ? `\n… 还有 ${steps.length - 20} 步` : ""}`;
}
function defineUiRecordStopTool(deps) {
	return defineTool({
		name: "dataforge_ui_record_stop",
		description: `停止录制并取步骤；给了 site+flow 默认保存为新版本（save=false 可只看不存）。

- 密码输入不录（凭证不入脚本）；文件选择不录（浏览器不给本地路径，upload 步骤请手写）；
- **站点名/流程名留空会自动命名**（站点名/域名 + 页面标题；回执说明用了哪个）；
- 录制会话保留，可继续录下一个流程；不用了调 dataforge_ui_record_close；
- 会话 cookie 会持久化到本地凭证 jar（回执只有条数），回放直接带登录态。`,
		parameters: {
			session_id: {
				type: "string",
				required: true
			},
			site: {
				type: "string",
				description: "站点名（与 flow 一起给才保存）"
			},
			flow: {
				type: "string",
				description: "流程名（与 site 一起给才保存）"
			},
			domain: {
				type: "string",
				description: "业务域（可选，列表分组用）"
			},
			note: {
				type: "string",
				description: "版本说明（可选）"
			},
			save: {
				type: "boolean",
				description: "缺省 true；false = 只回步骤不落盘"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					sessionId: { type: "string" },
					startUrl: { type: "string" },
					steps: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					},
					stepCount: { type: "number" },
					skippedSecrets: { type: "number" },
					skippedUploads: { type: "number" },
					notice: { type: "string" },
					saved: {
						type: "object",
						additionalProperties: false,
						properties: {
							site: { type: "string" },
							flow: { type: "string" },
							version: { type: "number" },
							path: { type: "string" }
						}
					},
					persistedCookies: { type: "number" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderUiRecordStop(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await stopRecordingForTool(deps, exec, {
				sessionId: args.session_id,
				...args.site === void 0 ? {} : { site: args.site },
				...args.flow === void 0 ? {} : { flow: args.flow },
				...args.domain === void 0 ? {} : { domain: args.domain },
				...args.note === void 0 ? {} : { note: args.note },
				...args.save === void 0 ? {} : { save: args.save }
			}));
		}
	});
}
function defineUiRecordCloseTool(deps) {
	return defineTool({
		name: "dataforge_ui_record_close",
		description: `关闭录制会话（浏览器窗口）。未停止的录制会被取消，不产出步骤。`,
		parameters: { session_id: {
			type: "string",
			required: true
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				const v = tighten(value);
				return [{
					type: "text",
					text: v.ok ? "🖥 录制会话已关闭" : `❌ ${v.error ?? "关闭失败"}`
				}];
			}
		},
		async execute(args) {
			return lossless(await closeRecordingForTool(deps, { sessionId: args.session_id }));
		}
	});
}
function renderUiRun(value) {
	const plan = value.plan;
	if (!value.ok) {
		const missing = value.missing === void 0 ? "" : `\n缺：${value.missing.join("、")}`;
		const versions = value.availableVersions === void 0 ? "" : `\n可用版本：${value.availableVersions.map((n) => `v${n}`).join(" / ")}`;
		return `❌ ${value.message ?? "回放未执行"}（${value.gate ?? value.code ?? "unknown"}）${missing}${versions}`;
	}
	if (value.gate === "confirm-required" || value.gate === "dry-run") return plan?.card ?? "🧪 回放计划（缺详情）";
	const result = value.result;
	if (result === void 0) return plan?.card ?? "🧪 回放完成（缺结果）";
	const head = result.success ? `✅ UI 回放通过：${result.site} / ${result.flow} v${result.version}（${result.stepsDone}/${result.totalSteps} 步 ${result.elapsedMs}ms）` : `❌ UI 回放失败：${result.site} / ${result.flow} v${result.version} ｜ 断在 ${result.failedStep?.id ?? "?"}（${result.stepsDone}/${result.totalSteps} 步）`;
	const lines = result.steps.map((step) => {
		const mark = step.ok ? "✓" : "✗";
		const asserts = step.assertions.length === 0 ? "" : ` ｜ 断言 ${step.assertions.filter((item) => item.ok).length}/${step.assertions.length}`;
		return `${mark} ${step.id} ${step.kind}${step.target === void 0 ? "" : ` @ ${step.target}`}（${step.elapsedMs}ms）${asserts}${step.error === void 0 ? "" : `\n   ${step.error}`}`;
	});
	return `${head}${result.screenshot === void 0 ? "" : `\n📸 失败截图：${result.screenshot}${result.dom === void 0 ? "" : `\n📄 现场 HTML：${result.dom}`}`}${result.cookiesApplied > 0 ? `\n🔐 已注入 ${result.cookiesApplied} 条会话 cookie（值不入回执）` : ""}\n${lines.join("\n")}`;
}
function defineUiRunTool(deps) {
	return defineTool({
		name: "dataforge_ui_run",
		description: `回放一个 UI 测试脚本（浏览器操作 + 页面断言）。**唯一执行入口**。

三道闸（与链路执行同款）：
- 必填：脚本 required 入参缺一 → missing-inputs，浏览器都不起；
- 确认：不带 confirm 只回计划卡（步骤 + 写操作数 + 起点），起浏览器前必须让用户确认；
- 开关：uiTestEnabled=false → ui-test-disabled（脚本读写/历史回看照常）。

执行：headless Chrome 打开 meta.startUrl → 逐步动作（选择器候选取第一个唯一命中）→ 每步断言
（visible/hidden/text/value/url/count，轮询到步骤超时）→ 失败即停，截 failure.png + 存 failure.html。
登录态：自动按起点域名从本地凭证 jar 注入 cookie（只报条数）。

运行记录：dataRoot/ui-runs/<runId>/（run.json + events.ndjson），用 dataforge_ui_runs 回看。
慢放：slow_mo_ms 给每步之间加延迟（0..10000），headless=false 可看窗口；两者不改变步超时预算。
点击动画：highlight_clicks（缺省 true）在点击落点画脉冲光圈，便于人工观察；批量可关掉。
幂等性：**不幂等**（真浏览器操作，click/submit 可能产生业务写入）。`,
		parameters: {
			site: {
				type: "string",
				required: true
			},
			flow: {
				type: "string",
				required: true
			},
			version: {
				type: "number",
				description: "脚本版本；缺省最新"
			},
			inputs: {
				type: "object",
				additionalProperties: true,
				description: "入参槽位运行值（键必须是脚本 inputs 声明过的）"
			},
			confirm: {
				type: "boolean",
				description: "闸2：用户确认后才允许 true；缺省只出计划卡"
			},
			dry_run: {
				type: "boolean",
				description: "只出计划卡并落 dry-run 说明，不起浏览器"
			},
			headless: {
				type: "boolean",
				description: "缺省 true；false = 可见窗口（联调首跑用）"
			},
			slow_mo_ms: {
				type: "number",
				description: "每步之间的慢放延迟（毫秒，0..10000）；人工观察回放过程用"
			},
			highlight_clicks: {
				type: "boolean",
				description: "点击时在页面落点画脉冲光圈（缺省 true；批量可关）"
			},
			hold_ms: {
				type: "number",
				description: "回放结束后停留多久再关浏览器（毫秒，0..30000；缺省 1200）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					gate: { type: "string" },
					code: { type: "string" },
					message: { type: "string" },
					missing: {
						type: "array",
						items: { type: "string" }
					},
					availableVersions: {
						type: "array",
						items: { type: "number" }
					},
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								target: { type: "string" },
								code: { type: "string" },
								reason: { type: "string" }
							}
						}
					},
					plan: {
						type: "object",
						additionalProperties: true
					},
					result: {
						type: "object",
						additionalProperties: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderUiRun(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await runUiScriptForTool(deps, exec, {
				site: args.site,
				flow: args.flow,
				...args.version === void 0 ? {} : { version: args.version },
				...args.inputs === void 0 ? {} : { inputs: normalizeStringMap(args.inputs) },
				...args.confirm === void 0 ? {} : { confirm: args.confirm },
				...args.dry_run === void 0 ? {} : { dryRun: args.dry_run },
				...args.headless === void 0 ? {} : { headless: args.headless }
			}));
		}
	});
}
function normalizeStringMap(raw) {
	const out = {};
	for (const [key, value] of Object.entries(raw)) if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = String(value);
	return out;
}
function renderUiRuns(value) {
	if (!value.ok) return `❌ ${value.message ?? "读取 UI 运行失败"}`;
	if (value.run !== void 0) {
		const run = value.run;
		const lines = (value.events ?? []).flatMap((event) => {
			if (event.event === "step") return [`${event.status === "done" ? "✓" : event.status === "error" ? "✗" : "…"} ${event.id ?? "?"} ${event.kind ?? ""}${event.elapsed === void 0 ? "" : `（${event.elapsed}ms）`}${event.error === void 0 ? "" : ` ｜ ${event.error}`}`];
			if (event.event === "assert") return [`  断言 ${event.kind ?? ""} ${event.status === "ok" ? "✓" : "✗"}${event.error === void 0 ? "" : ` ｜ ${event.error}`}`];
			if (event.event === "terminal") return [`终态：${event.success === true ? "成功" : "失败"}${event.message === void 0 ? "" : ` · ${event.message}`}`];
			return [];
		});
		return `🧪 ${run.site} / ${run.flow} v${run.version} ｜ ${run.status} ｜ ${run.startedAt === void 0 ? "" : new Date(run.startedAt).toLocaleString()}${run.screenshot === void 0 ? "" : `\n📸 ${run.screenshot}`}\n${lines.join("\n")}`;
	}
	const runs = value.runs ?? [];
	if (runs.length === 0) return "📭 还没有 UI 回放记录";
	const lines = runs.map((run) => `- ${run.runId} ｜ ${run.site} / ${run.flow} v${run.version} ｜ ${run.status}${run.failedStep === void 0 ? "" : ` ｜ 断在 ${run.failedStep}`}`);
	return `🧪 UI 运行 ${runs.length} 条：\n${lines.join("\n")}`;
}
function defineUiRunsTool(deps) {
	return defineTool({
		name: "dataforge_ui_runs",
		description: `查 UI 回放运行记录：给 run_id 回详情（事件流：每步状态/断言/终态/失败证据）；不给列最近运行。

状态以盘上为准（dataRoot/ui-runs/<runId>/run.json + events.ndjson），运行中途也能看到已完成步骤。`,
		parameters: {
			run_id: {
				type: "string",
				description: "缺省 = 列最近运行"
			},
			limit: {
				type: "number",
				description: "列表条数（缺省 20，上限 200）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					message: { type: "string" },
					runs: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					},
					run: {
						type: "object",
						additionalProperties: true
					},
					events: {
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
				text: renderUiRuns(tighten(value))
			}]
		},
		async execute(args) {
			return lossless(runsForTool(deps, {
				...args.run_id === void 0 ? {} : { runId: args.run_id },
				...args.limit === void 0 ? {} : { limit: args.limit }
			}));
		}
	});
}
function renderUiBatch(value) {
	if (!value.ok) return `❌ 批量回放未执行（${value.gate ?? value.code ?? "unknown"}）：${value.message ?? ""}`;
	if (value.gate === "confirm-required" || value.gate === "dry-run") return value.plan?.card ?? "🧪 批量回放计划（缺详情）";
	const result = value.result;
	if (result === void 0) return value.plan?.card ?? "🧪 批量回放完成（缺结果）";
	const head = result.failed === 0 && result.skipped === 0 ? `✅ UI 批量回归通过：${result.total} 条（${Math.round(result.elapsedMs / 1e3)}s）` : `❌ UI 批量回归：${result.total} 条 ｜ 通过 ${result.passed} / 失败 ${result.failed} / 跳过 ${result.skipped}（${Math.round(result.elapsedMs / 1e3)}s）`;
	const lines = result.items.filter((item) => item.success !== true).map((item) => {
		const where = item.skipped === true ? "跳过" : item.failedStep === void 0 ? "失败" : `断在 ${item.failedStep}`;
		return `- ${item.site} / ${item.flow}：${where}${item.error === void 0 ? "" : ` ｜ ${item.error}`}${item.runId === void 0 ? "" : ` ｜ run ${item.runId}`}${item.screenshot === void 0 ? "" : ` ｜ 📸 ${item.screenshot}`}`;
	});
	return `${head}${`\n📄 报告：${result.report}\n🧾 报告 JSON：${result.reportJson}`}${lines.length === 0 ? "" : `\n${lines.join("\n")}`}`;
}
function defineUiBatchRunTool(deps) {
	return defineTool({
		name: "dataforge_ui_batch_run",
		description: `批量回放 UI 脚本（回归）：选一组脚本逐条跑，汇总通过/失败并落报告。

选择方式（三选一，flows 优先）：
- flows: ["站点/流程", "站点/流程@版本"]（显式列表）；
- site: 某站点的全部脚本（取最新版本）；
- 都不给：工作区全部 UI 脚本（最多 limit 条，缺省 20，上限 50）。

三道闸：开关（ui-test-disabled）→ 计划（不带 confirm 只回计划卡，列出缺参保姆）→ confirm=true 执行。
执行默认**串行**（UI 回归要稳不要快）；每条脚本复用单次回放（runId/断言/截图一致），
缺必填入参的脚本记"跳过 + 原因"而不是悄悄消失；某条失败不中断整批。

报告落 dataRoot/ui-batches/<batchId>/：report.md（人看）+ report.json（CI 消费）。
幂等性：**不幂等**（真浏览器操作，click/submit/upload 可能产生业务写入）。`,
		parameters: {
			site: {
				type: "string",
				description: "按站点选脚本（与 flows 互斥，flows 优先）"
			},
			flows: {
				type: "array",
				items: { type: "string" },
				description: "显式流程列表：site/flow 或 site/flow@3"
			},
			inputs: {
				type: "object",
				additionalProperties: true,
				description: "所有脚本共用的入参槽位运行值"
			},
			limit: {
				type: "number",
				description: "最多跑多少条（缺省 20，硬上限 50）"
			},
			confirm: {
				type: "boolean",
				description: "闸2：用户确认后才允许 true；缺省只出计划卡"
			},
			dry_run: {
				type: "boolean",
				description: "只出计划卡并落 dry-run 说明，不起浏览器"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					gate: { type: "string" },
					code: { type: "string" },
					message: { type: "string" },
					plan: {
						type: "object",
						additionalProperties: true,
						properties: {
							selection: { type: "string" },
							site: { type: "string" },
							total: { type: "number" },
							limit: { type: "number" },
							writeSteps: { type: "number" },
							missingInputs: {
								type: "array",
								items: { type: "string" }
							},
							card: { type: "string" },
							items: {
								type: "array",
								items: {
									type: "object",
									additionalProperties: true
								}
							}
						}
					},
					result: {
						type: "object",
						additionalProperties: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderUiBatch(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await batchRunForTool(deps, exec, {
				...args.site === void 0 ? {} : { site: args.site },
				...args.flows === void 0 ? {} : { flows: args.flows },
				...args.inputs === void 0 ? {} : { inputs: normalizeStringMap(args.inputs) },
				...args.limit === void 0 ? {} : { limit: args.limit },
				...args.confirm === void 0 ? {} : { confirm: args.confirm },
				...args.dry_run === void 0 ? {} : { dryRun: args.dry_run }
			}));
		}
	});
}
function renderUiAgentOpen(value) {
	if (value.gate === "confirm-required" && value.plan !== void 0) return value.plan.card;
	if (!value.ok) return `❌ ${value.error ?? "打开代办录制会话失败"}`;
	return [
		`🤖 代办录制会话已打开：${value.sessionId}（runId: ${value.runId}）`,
		`当前页面：${value.pageUrl ?? "（未知）"}`,
		value.notice ?? ""
	].filter((line) => line !== "").join("\n");
}
function defineUiAgentOpenTool(deps) {
	return defineTool({
		name: "dataforge_ui_agent_open",
		description: `打开 AI 代办录制会话：AI 自主操作页面（打开/登录/干活），每个动作同步录成 UI 步骤，供人审查。

工作流：agent_open(confirm=true) → 反复 agent_act（先 inspect 观察页面再动作）→ agent_stop 落盘为**待审查脚本**（meta.review=pending + 原始任务描述）→ 人在面板逐步比对任务与步骤 → 确认转 confirmed。

三道闸之闸2：不带 confirm 只回计划卡（任务/起点/密钥键名/写操作提示），一个浏览器都不起。
引擎说明：代办会话用自己的可见 Chrome（playwright-core + 系统 Chrome），与 uiTestBrowser 配置的
录制/回放引擎相互独立——shared 引擎下人录走侧栏，代办录制仍拉自己的窗口。
登录（混合模式）：密码框 fill 必须给 valueFrom（服务端密钥表 uiAgentCredentials 的键名，open 回执列出可用键）；
act 每步后探测人机验证，检测到 challenge.detected=true 就**暂停叫人**，人在可见窗口过完验证码后继续 agent_act。`,
		parameters: {
			task: {
				type: "string",
				required: true,
				description: "要 AI 完成的工作内容（审查比对的基准，写清楚验收口径）"
			},
			start_url: {
				type: "string",
				required: true,
				description: "起点页面（http/https）"
			},
			headless: {
				type: "boolean",
				description: "缺省 false = 可见 Chrome（人可围观/接管/过验证码）"
			},
			confirm: {
				type: "boolean",
				description: "闸2：用户确认计划卡后才允许 true；缺省只出计划卡"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					gate: { type: "string" },
					plan: {
						type: "object",
						additionalProperties: true
					},
					sessionId: { type: "string" },
					runId: { type: "string" },
					pageUrl: { type: "string" },
					credentialKeys: {
						type: "array",
						items: { type: "string" }
					},
					notice: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderUiAgentOpen(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await openAgentSessionForTool(deps, exec, {
				task: args.task,
				startUrl: args.start_url,
				...args.headless === void 0 ? {} : { headless: args.headless },
				...args.confirm === void 0 ? {} : { confirm: args.confirm }
			}));
		}
	});
}
function renderUiAgentAct(value) {
	if (!value.ok) return `❌ ${value.error ?? "动作失败（未录步）"}`;
	const lines = [];
	if (value.inspect !== void 0) {
		lines.push(`👀 页面观察：${value.inspect.title || "（无标题）"} ${value.inspect.url}`);
		for (const el of value.inspect.elements.slice(0, 30)) lines.push(`  [${el.index}] <${el.tag}> ${el.text || "（无文本）"} → ${el.candidates[0] ?? "（无候选）"}`);
		if (value.inspect.elements.length > 30) lines.push(`  … 还有 ${value.inspect.elements.length - 30} 个`);
	}
	if (value.step !== void 0) lines.push(`✅ 已执行并录步 ${value.step.id}：${value.step.kind}${value.step.selector === void 0 ? "" : ` ${value.step.selector}`}`);
	if (value.valueMasked === true) lines.push("🔐 该值经服务端密钥注入，步骤里只记 {{槽位}}。");
	if (value.challenge?.detected === true) lines.push(`⚠️ 检测到人机验证（${value.challenge.markers.join("、")}）：暂停叫人，人在可见窗口完成验证后再继续 act。`);
	lines.push(`页面：${value.pageUrl ?? "（未知）"}；已录 ${value.stepsSoFar ?? 0} 步。`);
	return lines.join("\n");
}
function defineUiAgentActTool(deps) {
	return defineTool({
		name: "dataforge_ui_agent_act",
		description: `在代办录制会话上执行一个动作；动作进页面，步骤同步进缓冲（失败不录步）。

动作 kind：
- inspect：观察页面（URL/标题/可交互元素清单+候选选择器+人机验证探测），**不产生步骤**——自主规划先 inspect 再动作；
- goto {url} / wait {ms} / scroll {deltaY}（窗口滚动）；
- click {selector} / scroll {selector}（滚到元素）；
- fill {selector, value}；密码框或涉密值用 fill {selector, valueFrom}（键名见 open 回执 credentialKeys，值只在服务端过手，步骤记 {{槽位}}）；
- select {selector, value}；press {key, selector?}（不带 selector = 全局按键）。

selector 建议用 inspect 回执里的候选（元素描述同时录进步骤，回放有容错）。每个动作后回执都带 challenge：
detected=true 说明出现验证码/滑块，**立即停止叫人**，人过完验证再继续。`,
		parameters: {
			session_id: {
				type: "string",
				required: true,
				description: "dataforge_ui_agent_open 返回的 sessionId"
			},
			act: {
				type: "object",
				required: true,
				additionalProperties: false,
				description: "动作描述（kind 必填，其余按 kind 取用）",
				properties: {
					kind: {
						type: "string",
						required: true,
						enum: [
							"inspect",
							"goto",
							"click",
							"fill",
							"select",
							"press",
							"scroll",
							"wait"
						]
					},
					selector: {
						type: "string",
						description: "click/fill/select/scroll/press 的目标（优先用 inspect 给的候选）"
					},
					url: {
						type: "string",
						description: "goto 的目标地址"
					},
					value: {
						type: "string",
						description: "fill/select 的值（密码框禁用，见 valueFrom）"
					},
					value_from: {
						type: "string",
						description: "服务端密钥表键名：值只在服务端过手，步骤记 {{槽位}}"
					},
					key: {
						type: "string",
						description: "press 的键（Enter/Tab/Escape/ArrowDown…）"
					},
					delta_y: {
						type: "number",
						description: "scroll 的窗口滚动像素（正数向下；与 selector 二选一）"
					},
					ms: {
						type: "number",
						description: "wait 的毫秒数（0..60000）"
					}
				}
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					error: { type: "string" },
					pageUrl: { type: "string" },
					challenge: {
						type: "object",
						additionalProperties: true
					},
					step: {
						type: "object",
						additionalProperties: true
					},
					stepsSoFar: { type: "number" },
					inspect: {
						type: "object",
						additionalProperties: true
					},
					valueMasked: { type: "boolean" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderUiAgentAct(tighten(value))
			}]
		},
		async execute(args) {
			const act = args.act;
			const spec = toAgentActSpec(String(act["kind"] ?? ""), act);
			if (typeof spec === "string") return {
				ok: false,
				error: spec
			};
			return lossless(await agentActForTool(deps, {
				sessionId: args.session_id,
				act: spec
			}));
		}
	});
}
/** 工具参数（snake_case）→ AgentActSpec（camelCase）；缺字段给中文错误，不进会话。 */
function toAgentActSpec(kind, act) {
	const str = (key) => typeof act[key] === "string" && String(act[key]).trim() !== "" ? String(act[key]).trim() : void 0;
	const num = (key) => typeof act[key] === "number" && Number.isFinite(act[key]) ? act[key] : void 0;
	switch (kind) {
		case "inspect": return { kind: "inspect" };
		case "goto": {
			const url = str("url");
			return url === void 0 ? "goto 缺 url" : {
				kind: "goto",
				url
			};
		}
		case "click": {
			const selector = str("selector");
			return selector === void 0 ? "click 缺 selector" : {
				kind: "click",
				selector
			};
		}
		case "fill": {
			const selector = str("selector");
			if (selector === void 0) return "fill 缺 selector";
			const value = str("value");
			const valueFrom = str("value_from");
			if (value === void 0 && valueFrom === void 0) return "fill 缺 value / value_from";
			return {
				kind: "fill",
				selector,
				...value === void 0 ? {} : { value },
				...valueFrom === void 0 ? {} : { valueFrom }
			};
		}
		case "select": {
			const selector = str("selector");
			const value = str("value");
			if (selector === void 0) return "select 缺 selector";
			if (value === void 0) return "select 缺 value";
			return {
				kind: "select",
				selector,
				value
			};
		}
		case "press": {
			const key = str("key");
			if (key === void 0) return "press 缺 key";
			const selector = str("selector");
			return {
				kind: "press",
				key,
				...selector === void 0 ? {} : { selector }
			};
		}
		case "scroll": {
			const selector = str("selector");
			const deltaY = num("delta_y");
			if (selector === void 0 && deltaY === void 0) return "scroll 缺 selector / delta_y";
			return {
				kind: "scroll",
				...selector === void 0 ? {} : { selector },
				...deltaY === void 0 ? {} : { deltaY }
			};
		}
		case "wait": {
			const ms = num("ms");
			return ms === void 0 ? "wait 缺 ms" : {
				kind: "wait",
				ms
			};
		}
		default: return `未支持的 kind：${kind}（可选 inspect/goto/click/fill/select/press/scroll/wait）`;
	}
}
function renderUiAgentStop(value) {
	if (!value.ok) return `❌ ${value.notice ?? value.error ?? "停止代办录制失败"}`;
	const lines = [`⏹ 代办录制已停止：共录 ${value.stepCount ?? 0} 步。`];
	if (value.saved !== void 0) lines.push(`📦 已落盘 ${value.saved.site} / ${value.saved.flow} v${value.saved.version}（${value.saved.path}）—— 待审查。`);
	if (value.persistedCookies !== void 0) lines.push(`🍪 已持久化 ${value.persistedCookies} 条 cookie（回放带登录态）。`);
	if (value.notice !== void 0) lines.push(value.notice);
	return lines.join("\n");
}
function defineUiAgentStopTool(deps) {
	return defineTool({
		name: "dataforge_ui_agent_stop",
		description: `停止代办录制：步骤缓冲 → ui-script v1（review=pending 待审查 + 原始任务描述）→ 会话 cookie 落凭证 jar → 关浏览器。

站点/流程名留空自动命名（取当前页面 og:site_name/标题）。落盘后请叫人到面板「UI 测试」审查：
比对任务描述与步骤，确认后转 confirmed（待审查不影响回放，确认前也可 dataforge_ui_run 验证）。
没有录到步骤时不落盘（如实回 notice）。`,
		parameters: {
			session_id: {
				type: "string",
				required: true,
				description: "dataforge_ui_agent_open 返回的 sessionId"
			},
			site: {
				type: "string",
				description: "站点名（留空自动命名）"
			},
			flow: {
				type: "string",
				description: "流程名（留空自动命名）"
			},
			domain: {
				type: "string",
				description: "业务域（列表分组用）"
			},
			note: {
				type: "string",
				description: "版本说明"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					sessionId: { type: "string" },
					stepCount: { type: "number" },
					saved: {
						type: "object",
						additionalProperties: true
					},
					persistedCookies: { type: "number" },
					steps: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					},
					notice: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderUiAgentStop(tighten(value))
			}]
		},
		async execute(args, exec) {
			return lossless(await stopAgentSessionForTool(deps, exec, {
				sessionId: args.session_id,
				...args.site === void 0 ? {} : { site: args.site },
				...args.flow === void 0 ? {} : { flow: args.flow },
				...args.domain === void 0 ? {} : { domain: args.domain },
				...args.note === void 0 ? {} : { note: args.note }
			}));
		}
	});
}

//#endregion
//#region src/lookup/page-reader.ts
/**
* page 来源 lookup 的 Playwright 读取器。
*
* 只读：打开页面 → 等 items 选择器 → 按配置读取 text/attr → 返回候选；不点按钮、不填表。
* 登录态暂不注入（page 来源适合公开页面；需要登录时优先用 api 来源）。
*
* @module dsh-dataforge/lookup/page-reader
*/
/** 构造 page lookup reader；返回值可注入 lookup deps。 */
function createPageLookupReader(options = {}) {
	const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 15e3, 1e3), 6e4);
	return async (source) => {
		let browser;
		try {
			browser = await chromium.launch({
				headless: true,
				...options.channel === void 0 || options.channel === "" ? {} : { channel: options.channel }
			});
			const page = await browser.newPage();
			await page.goto(source.url, {
				waitUntil: "domcontentloaded",
				timeout: timeoutMs
			});
			const selector = source.items;
			if (!await page.waitForSelector(selector, {
				state: "attached",
				timeout: timeoutMs
			}).then(() => true).catch(() => false)) throw new Error(`page lookup 未找到 items 选择器：${selector}`);
			const expression = `(function (cfg) {
        const read = (element, spec) => {
          if (spec === 'text') return ((element.innerText || element.textContent || '') + '').replace(/\s+/g, ' ').trim()
          if (spec.startsWith('attr:')) return (element.getAttribute(spec.slice(5)) || '').trim()
          return ''
        }
        return Array.from(document.querySelectorAll(cfg.selector)).map((element) => {
          const values = {}
          Object.keys(cfg.map).forEach((key) => {
            const value = read(element, cfg.map[key])
            if (value !== '') values[key] = value
          })
          return { label: read(element, cfg.label), values: values }
        }).filter((item) => item.label !== '' && Object.keys(item.values).length > 0)
      })(${JSON.stringify({
				selector,
				label: source.label,
				map: source.map
			})})`;
			return await page.evaluate(expression);
		} finally {
			await browser?.close().catch(() => void 0);
		}
	};
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
const CARDS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS interface_cards (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), merge_key TEXT NOT NULL,
  name TEXT, url_template TEXT NOT NULL, method TEXT NOT NULL,
  request_template_json TEXT, response_template_json TEXT, auth_json TEXT,
  related_pages_json TEXT NOT NULL, sample_count INTEGER NOT NULL, created_at INTEGER NOT NULL
);`;
/**
* 卡片身份 = (capture_id, merge_key)。
*
* 早期把 merge_key 建成了全库 UNIQUE：第二次采到同一接口时会被并进**第一次运行**的那张卡，
* 卡的 capture_id / related_pages 张冠李戴，后一次运行的 cards 视图直接是空的。
* 索引把唯一性收进单个 run 内，跨 run 各留各的卡。
*/
const CARDS_INDEX_DDL = "CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_capture_merge ON interface_cards(capture_id, merge_key);";
const DDL = `
CREATE TABLE IF NOT EXISTS capture_runs (
  id TEXT PRIMARY KEY, task_type TEXT NOT NULL, entry_url TEXT NOT NULL,
  status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
  stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), url TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', visited_at INTEGER NOT NULL,
  title TEXT, site_name TEXT
);
CREATE TABLE IF NOT EXISTS request_samples (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), page_id TEXT, relation_id TEXT,
  page_url TEXT, ts INTEGER NOT NULL, seq INTEGER NOT NULL, url TEXT NOT NULL, method TEXT NOT NULL,
  status INTEGER, request_headers_json TEXT, request_body_path TEXT, request_body_preview TEXT,
  response_headers_json TEXT, response_body_path TEXT, response_preview TEXT, truncated INTEGER DEFAULT 0
);
${CARDS_TABLE_DDL}
CREATE TABLE IF NOT EXISTS credential_events (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), kind TEXT NOT NULL,
  url TEXT, name TEXT NOT NULL, value_json TEXT, obtained_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_sessions (
  id TEXT PRIMARY KEY, capture_id TEXT, origin TEXT NOT NULL, stored_body TEXT NOT NULL, stored_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS page_card_relations (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), card_id TEXT NOT NULL,
  page_id TEXT, page_url TEXT NOT NULL, params_fingerprint TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, sample_count INTEGER NOT NULL DEFAULT 1
);`;
const RELATIONS_INDEX_DDL = "CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_card_page_fp ON page_card_relations(card_id, page_url, params_fingerprint);";
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
		this.migrateLegacyCardScope();
		this.db.exec(CARDS_INDEX_DDL);
		this.db.exec(RELATIONS_INDEX_DDL);
		this.ensureRunsNoticeColumn();
		this.ensurePagesMetaColumns();
		this.ensureSamplesRelationColumn();
		this.backfillLegacyRelations();
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
	finishRun(id, status, error, stats, notice) {
		const existing = this.getRun(id);
		if (existing === void 0) throw new Error(`capture ${id} 不存在，无法 finish`);
		const finalStats = stats ?? existing.stats;
		this.db.prepare(`UPDATE capture_runs SET status=?, ended_at=?, error=?, stats_json=?, notice=COALESCE(?, notice) WHERE id=?`).run(status, Date.now(), error ?? null, JSON.stringify(finalStats), notice ?? null, id);
		this.appendEvent({
			kind: "terminal",
			phase: "end",
			captureId: id,
			status,
			error
		});
	}
	setRunNotice(id, notice) {
		this.db.prepare(`UPDATE capture_runs SET notice=? WHERE id=?`).run(notice, id);
		this.appendEvent({
			kind: "stats",
			captureId: id,
			notice
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
			error: row["error"] === null || row["error"] === void 0 ? void 0 : String(row["error"]),
			notice: optString(row["notice"])
		};
	}
	listRuns(limit = 10) {
		return this.db.prepare("SELECT id FROM capture_runs ORDER BY started_at DESC LIMIT ?").all(limit).flatMap((r) => {
			const run = this.getRun(r.id);
			return run === void 0 ? [] : [run];
		});
	}
	/**
	* 页面行幂等写入（按 `(capture_id, url)` 唯一）。
	*
	* 同一页面会从多条证据重复写入：旁路样本首次见到的 pageUrl（wireToStore）、爬行的 page 事件、
	* browser 的标题上报（onPageMeta）。早期每次 INSERT 新行，pages 表里同一页会出现多行、
	* 页数统计虚高；现在把 `(capture_id, url)` 当身份：
	*   - 已存在 → 只刷新 visited_at/status 与**非空**标题/站点名，不重复 bump 统计；
	*   - 不存在 → INSERT 并 bump `pages` 统计。
	*
	* url 由调用方传页面身份（`shared/page-url`）；历史字面 URL 行保持原样，由出口投影归并。
	*/
	upsertPage(captureId, url, depth, status, meta) {
		const title = cleanMetaText(meta?.title);
		const siteName = cleanMetaText(meta?.siteName);
		const existing = this.db.prepare("SELECT id FROM pages WHERE capture_id=? AND url=?").get(captureId, url);
		if (existing !== void 0) {
			this.db.prepare(`UPDATE pages SET visited_at=?,
             status=?,
             title=CASE WHEN ?<>'' THEN ? ELSE title END,
             site_name=CASE WHEN ?<>'' THEN ? ELSE site_name END
           WHERE id=?`).run(Date.now(), status, title, title, siteName, siteName, existing.id);
			return existing.id;
		}
		const id = `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		this.db.prepare("INSERT INTO pages(id,capture_id,url,depth,status,visited_at,title,site_name) VALUES (?,?,?,?,?,?,?,?)").run(id, captureId, url, depth, status, Date.now(), title === "" ? null : title, siteName === "" ? null : siteName);
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
	/**
	* 页面清单（按页面身份去重，最近访问为准）。
	*
	* 新写入的 pages.url 本身就是页面身份（见 application 桥）；历史库存的是字面 URL，
	* 同一 SPA 页面的 hash/反缓存戳变体会是多行 —— 出口按同一口径归并，避免工具回执
	* 把「同一个页面」报成多页。归并只影响投影，不改历史行（证据仍在 request_samples）。
	*/
	listPages(captureId, limit = 50) {
		const rows = this.db.prepare("SELECT * FROM pages WHERE capture_id=? ORDER BY visited_at DESC").all(captureId);
		const seen = /* @__PURE__ */ new Set();
		const pages = [];
		for (const row of rows) {
			const pageUrl = pageIdentityOf(String(row["url"]));
			if (seen.has(pageUrl)) continue;
			seen.add(pageUrl);
			const title = cleanMetaText(optString(row["title"]));
			const siteName = cleanMetaText(optString(row["site_name"]));
			pages.push({
				id: String(row["id"]),
				captureId: String(row["capture_id"]),
				url: pageUrl,
				depth: Number(row["depth"]),
				status: String(row["status"]),
				...title === "" ? {} : { title },
				...siteName === "" ? {} : { siteName }
			});
			if (pages.length >= limit) break;
		}
		return pages;
	}
	/**
	* 全库页面元信息（/page-meta 数据面）：按页面身份归并、visitedAt 最新者胜、跳过非 http(s)。
	*
	* 多取 `limit × 4` 原始行再归并：历史字面 URL 变体（hash/反缓存戳）会占多行，
	* 只取 limit 行会让同一身份把后面别的页面挤掉。归并只影响投影，不改历史行。
	*
	* 同一身份的旧行只**补缺**标题/站点名（不拿旧值覆盖最新行的非空值）：标题与站点名可能
	* 分两次上报（先 title 后 siteName，毫秒相同则 SQL 排序不定），纯「取第一行」会让另一个字段丢失。
	*/
	listPageMeta(limit = 500) {
		const fetchLimit = Math.max(1, limit) * 4;
		const rows = this.db.prepare("SELECT url, title, site_name, visited_at FROM pages ORDER BY visited_at DESC LIMIT ?").all(fetchLimit);
		const byIdentity = /* @__PURE__ */ new Map();
		const order = [];
		for (const row of rows) {
			const rawUrl = String(row["url"] ?? "");
			if (!/^https?:/i.test(rawUrl.trim())) continue;
			const identity = pageIdentityOf(rawUrl);
			const title = cleanMetaText(optString(row["title"]));
			const siteName = cleanMetaText(optString(row["site_name"]));
			const existing = byIdentity.get(identity);
			if (existing === void 0) {
				if (order.length >= limit) continue;
				byIdentity.set(identity, {
					url: identity,
					...title === "" ? {} : { title },
					...siteName === "" ? {} : { siteName },
					visitedAt: Number(row["visited_at"])
				});
				order.push(identity);
				continue;
			}
			if (existing.title === void 0 && title !== "") existing.title = title;
			if (existing.siteName === void 0 && siteName !== "") existing.siteName = siteName;
		}
		return order.flatMap((identity) => {
			const row = byIdentity.get(identity);
			return row === void 0 ? [] : [row];
		});
	}
	/**
	* 按页面身份回写标题/站点名（旧页面补抓的落点）：匹配**所有**同一身份的历史行。
	*
	* 空值不覆盖旧值（补抓只补缺：读不到标题时不该把已有标题清空）。
	* 返回实际被更新的行数（调用方据此判断目标是否在 pages 表里存在）。
	*/
	applyPageMeta(url, title, siteName) {
		const cleanTitle = cleanMetaText(title);
		const cleanSite = cleanMetaText(siteName);
		if (cleanTitle === "" && cleanSite === "") return 0;
		const target = pageIdentityOf(url);
		if (target === "") return 0;
		const rows = this.db.prepare("SELECT id, url FROM pages").all();
		const update = this.db.prepare(`UPDATE pages SET
         title=CASE WHEN ?<>'' THEN ? ELSE title END,
         site_name=CASE WHEN ?<>'' THEN ? ELSE site_name END
       WHERE id=?`);
		let updated = 0;
		this.db.transaction(() => {
			for (const row of rows) {
				if (pageIdentityOf(row.url) !== target) continue;
				update.run(cleanTitle, cleanTitle, cleanSite, cleanSite, row.id);
				updated += 1;
			}
		})();
		return updated;
	}
	/** kind='cookie' 的 value_json 原文（补抓复用登录态；值只在服务端内存过手，不出壳）。 */
	listCookieJson(limit = 500) {
		return this.db.prepare(`SELECT value_json FROM credential_events WHERE kind='cookie' AND value_json IS NOT NULL ORDER BY obtained_at DESC LIMIT ?`).all(Math.max(1, limit)).map((row) => String(row["value_json"]));
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
			ts: Number(row["ts"]),
			relationId: optString(row["relation_id"])
		}));
	}
	readBinary(relPath) {
		const abs = join(this.io.samplesDir, relPath);
		return existsSync(abs) ? readFileSync(abs) : void 0;
	}
	/** 按 (capture_id, merge_key) 幂等：同 run 已有卡 → 追加页面引用 + 样本计数 +1；新卡 → 建行。 */
	upsertCard(captureId, input) {
		const existing = this.db.prepare("SELECT id FROM interface_cards WHERE capture_id=? AND merge_key=?").get(captureId, input.mergeKey);
		if (existing !== void 0) {
			this.db.prepare("UPDATE interface_cards SET related_pages_json=?, sample_count=sample_count+1 WHERE id=?").run(JSON.stringify(input.relatedPageUrls), existing.id);
			if (input.requestTemplate !== void 0) this.db.prepare("UPDATE interface_cards SET request_template_json=? WHERE id=?").run(JSON.stringify(input.requestTemplate), existing.id);
			if (input.responseTemplate !== void 0) this.db.prepare("UPDATE interface_cards SET response_template_json=? WHERE id=?").run(JSON.stringify(input.responseTemplate), existing.id);
			if (input.authBinding !== void 0 || input.authType !== void 0 || input.authEvidence !== void 0) {
				const merged = mergeAuthJson(this.getCard(existing.id), input);
				this.db.prepare("UPDATE interface_cards SET auth_json=? WHERE id=?").run(JSON.stringify(merged), existing.id);
			}
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
		const authJson = {
			...input.authBinding === void 0 ? {} : input.authBinding,
			...input.authType === void 0 ? {} : { authType: input.authType },
			...input.authEvidence === void 0 ? {} : { authEvidence: input.authEvidence }
		};
		this.db.prepare(`INSERT INTO interface_cards(id,capture_id,merge_key,name,url_template,method,
          request_template_json,response_template_json,auth_json,related_pages_json,sample_count,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`).run(id, captureId, input.mergeKey, input.name ?? null, input.urlTemplate, input.method, input.requestTemplate === void 0 ? null : JSON.stringify(input.requestTemplate), input.responseTemplate === void 0 ? null : JSON.stringify(input.responseTemplate), Object.keys(authJson).length === 0 ? null : JSON.stringify(authJson), JSON.stringify(input.relatedPageUrls), Date.now());
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
	/** 接口库页面跨 run 列卡（created_at 降序，LIMIT/OFFSET 分页）；listCards 是 per-capture 视角，两条含义不同，都在场。 */
	listAllCards(limit = 200, offset = 0) {
		return this.db.prepare("SELECT * FROM interface_cards ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset).map(rowToCard);
	}
	/** 接口库卡片总数（分页器算页数用；与 listAllCards 同一筛选面，无额外条件）。 */
	countAllCards() {
		const row = this.db.prepare("SELECT COUNT(*) AS n FROM interface_cards").get();
		return Number(row.n);
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
	/**
	* 幂等关系行：唯一键 (card_id, page_url, params_fingerprint)。
	* 已存在 → last_seen_at 前移 + sample_count+1（同形态重复调用聚一行）；
	* 指纹不同 → 同一卡片下新增一行（调用形态可区分，正是规格要的），不并卡。
	*/
	upsertRelation(captureId, cardId, pageUrl, paramsFingerprint, pageId) {
		const existing = this.db.prepare(`SELECT id FROM page_card_relations WHERE card_id=? AND page_url=? AND params_fingerprint=?`).get(cardId, pageUrl, paramsFingerprint);
		const now = Date.now();
		if (existing !== void 0) {
			this.db.prepare(`UPDATE page_card_relations SET last_seen_at=?, sample_count=sample_count+1, page_id=COALESCE(?, page_id) WHERE id=?`).run(now, pageId ?? null, existing.id);
			return existing.id;
		}
		const id = `pr_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		this.db.prepare(`INSERT INTO page_card_relations(id,capture_id,card_id,page_id,page_url,params_fingerprint,first_seen_at,last_seen_at,sample_count)
         VALUES (?,?,?,?,?,?,?, ?,1)`).run(id, captureId, cardId, pageId ?? null, pageUrl, paramsFingerprint, now, now);
		this.appendEvent({
			kind: "relation",
			captureId,
			cardId,
			pageUrl,
			fingerprint: paramsFingerprint
		});
		return id;
	}
	listRelations(captureId, limit = 500) {
		return this.db.prepare(`SELECT * FROM page_card_relations WHERE capture_id=? ORDER BY last_seen_at DESC LIMIT ?`).all(captureId, limit).map(rowToRelation);
	}
	/** 单卡的关系行（「这个接口在哪些页面的哪些形态下被调用过」）。 */
	listRelationsByCard(cardId, limit = 200) {
		return this.db.prepare(`SELECT * FROM page_card_relations WHERE card_id=? ORDER BY last_seen_at DESC LIMIT ?`).all(cardId, limit).map(rowToRelation);
	}
	/** 样本回指关系行：一条请求属于「哪个页面 × 哪个接口 × 哪种形态」。 */
	attachSampleRelation(sampleId, relationId) {
		this.db.prepare("UPDATE request_samples SET relation_id=? WHERE id=?").run(relationId, sampleId);
	}
	saveSession(origin, captureId, body) {
		const id = `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		this.db.prepare("INSERT INTO login_sessions(id,capture_id,origin,stored_body,stored_at) VALUES (?,?,?,?,?)").run(id, captureId ?? null, origin, JSON.stringify(body), Date.now());
		return id;
	}
	/**
	* 老库迁移：检测 interface_cards 是否还带着 `merge_key TEXT UNIQUE`（全库唯一）。
	*
	* SQLite 无法直接 DROP 表级约束，只能重建：列与顺序原样搬运（旧数据里已经没有重复 merge_key，
	* 搬过去必然满足新的 (capture_id, merge_key) 唯一），改名后由 CARDS_INDEX_DDL 补索引。
	*/
	migrateLegacyCardScope() {
		const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='interface_cards'").get();
		const sql = typeof row?.["sql"] === "string" ? row["sql"] : "";
		if (!/merge_key\s+TEXT\s+UNIQUE/i.test(sql)) return;
		const columns = "id,capture_id,merge_key,name,url_template,method,request_template_json,response_template_json,auth_json,related_pages_json,sample_count,created_at";
		this.db.exec(`
      BEGIN;
      DROP TABLE IF EXISTS interface_cards_migrated;
      ${CARDS_TABLE_DDL.replace("interface_cards", "interface_cards_migrated")}
      INSERT INTO interface_cards_migrated(${columns}) SELECT ${columns} FROM interface_cards;
      DROP TABLE interface_cards;
      ALTER TABLE interface_cards_migrated RENAME TO interface_cards;
      COMMIT;
    `);
	}
	/**
	* 老库迁移：`request_samples` 无 relation_id 列（关系模型引入前建的库）→ ALTER 补齐。
	* 历史样本的 relation 留空是诚实结果：当时就没记关系，不能倒推猜测。
	*/
	ensureSamplesRelationColumn() {
		const row = this.db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('request_samples') WHERE name='relation_id'").get();
		if (Number(row.n) > 0) return;
		this.db.exec("ALTER TABLE request_samples ADD COLUMN relation_id TEXT");
	}
	/**
	* 老卡补 legacy 关系行（幂等）：关系模型引入前沉淀的卡只有 related_pages_json 这个冗余缓存，
	* 不补的话「页面 → 接口」视图里历史卡等于不存在。指纹记 'legacy' 表示「当时没采到入参形态」。
	*/
	backfillLegacyRelations() {
		const cards = this.db.prepare(`SELECT c.id, c.capture_id, c.related_pages_json FROM interface_cards c
                WHERE NOT EXISTS (SELECT 1 FROM page_card_relations r WHERE r.card_id = c.id)`).all();
		if (cards.length === 0) return;
		const pageOf = this.db.prepare("SELECT id FROM pages WHERE capture_id=? AND url=? LIMIT 1");
		const insert = this.db.prepare(`INSERT OR IGNORE INTO page_card_relations
        (id,capture_id,card_id,page_id,page_url,params_fingerprint,first_seen_at,last_seen_at,sample_count)
       VALUES (?,?,?,?,?,?,?,?,1)`);
		const now = Date.now();
		for (const card of cards) {
			let urls = [];
			try {
				urls = JSON.parse(card.related_pages_json);
			} catch {
				urls = [];
			}
			if (!Array.isArray(urls)) continue;
			for (const url of urls) {
				if (typeof url !== "string" || url.length === 0) continue;
				const page = pageOf.get(card.capture_id, url);
				insert.run(`pr_legacy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, card.capture_id, card.id, page?.id ?? null, url, "legacy", now, now);
			}
		}
	}
	/** 老库（2026-10-17 前建）capture_runs 无 notice 列：ALTER 补齐，已存在则跳过。 */
	ensureRunsNoticeColumn() {
		const row = this.db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('capture_runs') WHERE name='notice'").get();
		if (Number(row.n) > 0) return;
		this.db.exec("ALTER TABLE capture_runs ADD COLUMN notice TEXT");
	}
	/**
	* 老库迁移：pages 无 title/site_name 列（名称数据面引入前建的库）→ ALTER 补齐。
	*
	* 只加列、不动历史行：历史页面标题靠面板「补抓名称」动作（TitleBackfillService）重访回填；
	* 库仍可被旧版本插件打开（新列全为 NULL，旧查询不受影响）。
	*/
	ensurePagesMetaColumns() {
		const hasColumn = (column) => {
			const row = this.db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('pages') WHERE name=?").get(column);
			return Number(row.n) > 0;
		};
		if (!hasColumn("title")) this.db.exec("ALTER TABLE pages ADD COLUMN title TEXT");
		if (!hasColumn("site_name")) this.db.exec("ALTER TABLE pages ADD COLUMN site_name TEXT");
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
/** 页面元信息清洗：压空白、去首尾；缺席/非字符串 → 空串（调用方统一当「没有值」）。 */
function cleanMetaText(value) {
	if (typeof value !== "string") return "";
	return value.replace(/\s+/g, " ").trim();
}
function rowToCard(row) {
	const auth = optRecord(row["auth_json"]);
	const authType = typeof auth?.["authType"] === "string" ? auth["authType"] : void 0;
	const authEvidence = typeof auth?.["authEvidence"] === "string" ? auth["authEvidence"] : void 0;
	const authBinding = auth === void 0 ? void 0 : Object.fromEntries(Object.entries(auth).filter(([k]) => k === "cookies" || k === "storageKeys"));
	return {
		id: String(row["id"]),
		captureId: String(row["capture_id"]),
		name: optString(row["name"]),
		mergeKey: optString(row["merge_key"]),
		urlTemplate: String(row["url_template"]),
		method: String(row["method"]),
		requestTemplate: optTemplate(row["request_template_json"]),
		responseTemplate: optTemplate(row["response_template_json"]),
		...Object.keys(authBinding ?? {}).length === 0 ? {} : { authBinding },
		...authType === void 0 ? {} : { authType },
		...authEvidence === void 0 ? {} : { authEvidence },
		relatedPageUrls: parseArray(row["related_pages_json"]),
		sampleCount: Number(row["sample_count"]),
		createdAt: Number(row["created_at"])
	};
}
function mergeAuthJson(card, input) {
	return {
		...card?.authBinding ?? {},
		...input.authBinding ?? {},
		...input.authType === void 0 ? card?.authType === void 0 ? {} : { authType: card.authType } : { authType: input.authType },
		...input.authEvidence === void 0 ? card?.authEvidence === void 0 ? {} : { authEvidence: card.authEvidence } : { authEvidence: input.authEvidence }
	};
}
function rowToRelation(row) {
	return {
		id: String(row["id"]),
		captureId: String(row["capture_id"]),
		cardId: String(row["card_id"]),
		pageId: optString(row["page_id"]),
		pageUrl: String(row["page_url"]),
		paramsFingerprint: String(row["params_fingerprint"]),
		firstSeenAt: Number(row["first_seen_at"]),
		lastSeenAt: Number(row["last_seen_at"]),
		sampleCount: Number(row["sample_count"])
	};
}
function optTemplate(raw) {
	if (typeof raw !== "string" || raw.trim().startsWith("{") === false) return void 0;
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
	const record = parsed;
	const fields = Array.isArray(record["fields"]) ? record["fields"] : [];
	const codePath = typeof record["codePath"] === "string" ? record["codePath"] : void 0;
	const pathParams = Array.isArray(record["pathParams"]) ? record["pathParams"].map(String) : void 0;
	return {
		fields,
		...codePath === void 0 ? {} : { codePath },
		...pathParams === void 0 ? {} : { pathParams }
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
//#region src/capture/credentials.ts
/**
* 采集库 → 执行期凭证的只读适配器（R-4 M1/M3）。
*
* 为什么单独一层：执行层（`execute/*`）不认识 SQLite、不认识采集表；它只认
* `CredentialProvider` 这个函数形状。本模块把「一期采集库」翻译成那个形状，
* 读路径全程 `readonly`——不建表、不迁移、不写事件（与 `library/import.ts` 同一纪律）。
*
* 安全边界：
*   - 只按卡的 `sources[].captureId` 查，**不做全库兜底扫描**（避免把 A 站凭证发给 B 站）；
*   - cookie 型只取 `kind='cookie'`；token 型（M3）只取 `kind='token'`，且只按卡声明的
*     `auth` 与 evidence 名匹配，不猜 Authorization 的 scheme；
*   - body token 本期**不注入**，如实标 `unsupported`（注入语义与 query/header 不同）；
*   - 返回值里的摘要只含名字/域/来源，值只进 `headers.*` 或 `query` 这一条出站请求。
*
* 运行级缓存（M3）：
*   - `cache: true` 时按「db 文件 mtimeMs+size」与「持久化 jar 文件 mtimeMs+size」做键缓存行；
*   - 文件内容变化 → 自动失效并重读；文件被删除 → 沿用缓存（同一运行内不因中途删库丢凭证）；
*   - 缺省关闭，保证不传 `cache` 的调用方行为与 M1 完全一致。
*
* @module dsh-dataforge/capture/credentials
*/
function messageOf$3(error) {
	return error instanceof Error ? error.message : String(error);
}
/** 卡来源里的 captureId（去重、保序、去掉空串）。 */
function captureIdsOf(card) {
	const ids = /* @__PURE__ */ new Set();
	for (const source of card.sources ?? []) if (typeof source.captureId === "string" && source.captureId !== "") ids.add(source.captureId);
	return [...ids];
}
function hostOf$1(url) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
/**
* 文件签名（缓存键）：`mtimeMs:size`；不存在返回 `missing`。
*
* 采集库是 SQLite WAL：提交只写 `-wal` 边车文件，主库文件的 mtime/size 可能长期不变。
* 所以 db 的签名 = 主库 + `-wal` 两个文件；否则一次运行写入的新 token 会被缓存挡住，
* 变成「跨 run 陈旧数据」。运行级缓存的语义是「同一份采集库内容内不重复开库」，不是永久缓存。
*/
function fileSignature(path) {
	try {
		const stat = statSync(path);
		return `${stat.mtimeMs}:${stat.size}`;
	} catch {
		return "missing";
	}
}
/** 缓存命中判据：文件现在不存在（运行中被删）或与缓存时签名一致。 */
function signatureStillValid(current, cached) {
	return current === "missing" || current === cached;
}
/** 只读打开采集库，一次查询取回 cookie 与 token 行；读不到就抛给调用方折成降级。 */
function readCredentialRows(dbPath, captureIds) {
	const db = new Database(dbPath, {
		readonly: true,
		fileMustExist: true
	});
	try {
		const placeholders = captureIds.map(() => "?").join(",");
		const select = (kind) => db.prepare(`SELECT capture_id, url, name, value_json, obtained_at
           FROM credential_events
           WHERE capture_id IN (${placeholders}) AND kind = ?
           ORDER BY obtained_at ASC`).all(...captureIds, kind);
		return {
			cookieRows: select("cookie"),
			tokenRows: select("token")
		};
	} finally {
		db.close();
	}
}
/** Playwright `expires`（秒）→ 毫秒；`-1`/`0`/缺失 = 会话 cookie。 */
function expiresAtOf(raw) {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return void 0;
	return raw > 0xe8d4a51000 ? raw : raw * 1e3;
}
/**
* 一行 → 0..1 条 cookie。坏 JSON / 缺名缺值一律跳过——一条坏行不该炸整条链。
*/
function cookieOfRow(row) {
	if (row.value_json === null || row.value_json === "") return void 0;
	let raw;
	try {
		raw = JSON.parse(row.value_json);
	} catch {
		return;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
	const record = raw;
	const name = typeof record["name"] === "string" && record["name"] !== "" ? record["name"] : row.name;
	const value = typeof record["value"] === "string" ? record["value"] : "";
	if (name === "" || value === "") return void 0;
	const domain = typeof record["domain"] === "string" && record["domain"] !== "" ? record["domain"] : row.url ?? "";
	if (domain === "") return void 0;
	return {
		name,
		value,
		domain,
		path: typeof record["path"] === "string" && record["path"] !== "" ? record["path"] : "/",
		secure: record["secure"] === true,
		expiresAt: expiresAtOf(record["expires"]),
		captureId: row.capture_id,
		obtainedAt: row.obtained_at
	};
}
/** 一行 → token（坏 JSON/缺字段跳过）。 */
function tokenOfRow(row) {
	const value = tokenValueOfJson(row.value_json);
	if (value === void 0) return void 0;
	return {
		...value,
		captureId: row.capture_id,
		obtainedAt: row.obtained_at
	};
}
/** 取 `obtainedAt` 最新的一条（同时间取后出现者，与 SQL ASC 顺序对齐）。 */
function latestOf(items) {
	let best;
	for (const item of items) if (best === void 0 || item.obtainedAt >= best.obtainedAt) best = item;
	return best;
}
/**
* 读卡的鉴权证据名（如 `header:authorization` / `query:access_token`）。
*
* 卡 schema 从 R-4 M3 起显式收 `authEvidence`（只存名字）；老卡没有该字段时
* 返回 undefined，由 provider 按 token 位置的缺省名兜底。
*/
function authEvidenceOf(card) {
	const raw = card.authEvidence;
	return typeof raw === "string" && raw !== "" ? raw : void 0;
}
/** `evidence` 前缀匹配：`header:authorization` + kind=`header` → `authorization`。 */
function evidenceNameOf(evidence, kind) {
	if (evidence === void 0) return void 0;
	const prefix = `${kind}:`;
	if (!evidence.toLowerCase().startsWith(prefix)) return void 0;
	const name = evidence.slice(prefix.length).trim();
	return name === "" ? void 0 : name;
}
function none(reason, captureIds) {
	return {
		headers: {},
		application: emptyCredentialApplication("none", reason, captureIds)
	};
}
/** 卡声明了 token 型鉴权，但采集库里没有可注入的值：如实 unsupported + 原因。 */
function unsupportedReason(reason, captureIds) {
	return {
		headers: {},
		application: emptyCredentialApplication("unsupported", reason, captureIds)
	};
}
function unsupported(card, captureIds) {
	return unsupportedReason(`未知鉴权类型「${String(card.auth)}」：不注入`, captureIds);
}
/** token 型注入摘要（只留头/参数名，不含值）。 */
function appliedTokenApplication(header, names, captureIds) {
	return {
		status: "applied",
		source: "capture",
		header,
		names: [...names],
		domains: [],
		captureIds: [...captureIds],
		expired: 0
	};
}
/**
* 创建执行期凭证 provider。
*
* 缺省每次调用按需只读打开/关闭 SQLite（节点量级几十到几百，打开开销可接受）；
* `cache: true` 时按文件签名复用行（M3 运行级缓存）。
*/
function createCaptureCredentialProvider(options) {
	const now = options.now ?? (() => Date.now());
	const useCache = options.cache === true;
	const rowCache = /* @__PURE__ */ new Map();
	const storeSig = () => options.storePath === void 0 ? "absent" : fileSignature(options.storePath);
	const loadRows = (captureIds) => {
		if (captureIds.length === 0) return {
			cookieRows: [],
			tokenRows: []
		};
		const key = captureIds.join("\0");
		const dbSig = fileSignature(options.dbPath);
		const dbWalSig = fileSignature(`${options.dbPath}-wal`);
		const jarSig = storeSig();
		if (useCache) {
			const hit = rowCache.get(key);
			if (hit !== void 0 && signatureStillValid(dbSig, hit.dbSig) && signatureStillValid(dbWalSig, hit.dbWalSig) && signatureStillValid(jarSig, hit.storeSig)) return hit;
		}
		try {
			const rows = readCredentialRows(options.dbPath, captureIds);
			if (useCache) rowCache.set(key, {
				dbSig,
				dbWalSig,
				storeSig: jarSig,
				...rows
			});
			return rows;
		} catch (error) {
			return {
				cookieRows: [],
				tokenRows: [],
				databaseError: messageOf$3(error)
			};
		}
	};
	const resolveCookies = (need, captureIds, rows) => {
		const entries = [];
		for (const row of rows.cookieRows) {
			const cookie = cookieOfRow(row);
			if (cookie !== void 0) entries.push(cookie);
		}
		const databaseError = rows.databaseError;
		if (options.storePath !== void 0) {
			const origin = originOfUrl(need.url);
			if (origin !== void 0) entries.push(...readPersistedCookies(options.storePath, origin, now()));
		}
		if (entries.length === 0) {
			if (captureIds.length === 0) return none(databaseError === void 0 ? "卡没有采集来源（sources[].captureId 为空）" : `采集库不可用：${databaseError}`, []);
			return databaseError === void 0 ? none(`没有匹配 ${hostOf$1(need.url)} 的 cookie`, captureIds) : none(`采集库不可用：${databaseError}`, captureIds);
		}
		const selection = selectCookies(entries, need.url, now());
		const header = cookieHeaderOf(selection.selected);
		if (header === void 0) {
			if (selection.matched.length > 0) return {
				headers: {},
				application: {
					...emptyCredentialApplication("expired", "匹配到的 cookie 全部过期", captureIds),
					expired: selection.matched.length
				}
			};
			return none(`没有匹配 ${hostOf$1(need.url)} 的 cookie`, captureIds);
		}
		const application = appliedCredentialApplication(selection, captureIds);
		const persistedUsed = selection.selected.filter((cookie) => cookie.captureId === "persisted").length;
		if (persistedUsed > 0) application.persisted = persistedUsed;
		if (databaseError !== void 0) application.reason = `采集库不可用（已用持久化凭证兜底）：${databaseError}`;
		return {
			headers: { cookie: header },
			application
		};
	};
	/** token-header：按 evidence 名取最新 token（缺省 `authorization`），值原样注入。 */
	const resolveTokenHeader = (captureIds, tokens, evidence) => {
		const proposed = evidenceNameOf(evidence, "header");
		const headerTokens = tokens.filter((token) => token.location === "header");
		const wanted = (proposed ?? "authorization").toLowerCase();
		let headerName = wanted;
		let pick = latestOf(headerTokens.filter((token) => token.name.toLowerCase() === wanted));
		if (pick === void 0 && proposed === void 0) {
			pick = latestOf(headerTokens);
			if (pick !== void 0) headerName = pick.name.toLowerCase();
		}
		if (pick === void 0) return unsupportedReason(`token 型凭证未采集：采集库里没有 ${wanted} 头，需重新采集登录态站点（不猜 Authorization scheme）`, captureIds);
		return {
			headers: { [headerName]: pick.value },
			application: appliedTokenApplication("authorization", [headerName], captureIds)
		};
	};
	/** token-param：按 evidence 名取最新 query token；body token 如实 unsupported。 */
	const resolveTokenParam = (captureIds, tokens, evidence) => {
		if (evidence !== void 0 && evidence.toLowerCase().startsWith("body:")) return unsupportedReason(`token 型凭证暂不支持 body 注入（证据 ${evidence}）：body 字段不是 query 参数，本期只注入 header/query token`, captureIds);
		const proposed = evidenceNameOf(evidence, "query");
		const queryTokens = tokens.filter((token) => token.location === "query");
		const wanted = proposed?.toLowerCase();
		let pick = wanted === void 0 ? latestOf(queryTokens) : latestOf(queryTokens.filter((token) => token.name.toLowerCase() === wanted));
		if (pick === void 0 && proposed === void 0 && queryTokens.length > 0) pick = latestOf(queryTokens);
		if (pick === void 0) {
			const bodyTokens = tokens.filter((token) => token.location === "body");
			if (proposed === void 0 && bodyTokens.length > 0) return unsupportedReason(`token 型凭证暂不支持 body 注入（采到 ${bodyTokens.length} 条 body token）：本期只注入 header/query token`, captureIds);
			return unsupportedReason(`token 型凭证未采集：采集库里没有 ${proposed ?? "query token"} 参数，需重新采集登录态站点`, captureIds);
		}
		const paramName = pick.name;
		return {
			headers: {},
			query: { [paramName]: pick.value },
			application: appliedTokenApplication("query", [paramName], captureIds)
		};
	};
	const resolveToken = (card, captureIds, rows) => {
		if (captureIds.length === 0) return unsupportedReason("卡没有采集来源（sources[].captureId 为空），无法补采 token", captureIds);
		if (rows.databaseError !== void 0) return unsupportedReason(`采集库不可用，无法补采 token：${rows.databaseError}`, captureIds);
		const tokens = [];
		for (const row of rows.tokenRows) {
			const token = tokenOfRow(row);
			if (token !== void 0) tokens.push(token);
		}
		const evidence = authEvidenceOf(card);
		return card.auth === "token-header" ? resolveTokenHeader(captureIds, tokens, evidence) : resolveTokenParam(captureIds, tokens, evidence);
	};
	return (need) => {
		const card = need.card;
		const captureIds = captureIdsOf(card);
		if (card.auth === void 0 || card.auth === "none") return none("该卡无鉴权", captureIds);
		if (card.auth === "unknown") return none("鉴权标志未判定，不注入", captureIds);
		const tokenAuth = card.auth === "token-header" || card.auth === "token-param";
		if (card.auth !== "cookie-session" && !tokenAuth) return unsupported(card, captureIds);
		const rows = loadRows(captureIds);
		return tokenAuth ? resolveToken(card, captureIds, rows) : resolveCookies(need, captureIds, rows);
	};
}

//#endregion
//#region src/capture/names.ts
/**
* 面板三级手工名覆盖（网站 / 页面 / 接口）的持久化。
*
* 自动名是「采集时记录 + URL 规则生成」的兜底；用户手工改名要跨重采存活，所以单独落在
* `dataRoot/capture/names.yaml`（不写采集库：采集库按 run 隔离，重采会生成新行）。
*
* 键口径（与面板数据面契约一致）：
*   - site → 小写 host（`Example.COM` 与 `example.com` 是同一个网站）；
*   - page → `pageIdentityOf` 页面身份（hash 路由/反缓存戳变体同名）；
*   - interface → `mergeKey` 原样 trim（值不入键，跨参数值/跨采集稳定）。
*
* 写路径：tmp + rename 原子写（半截文件不会被下一次读取当真）；缺文件/坏文件一律降级为空快照，
* 绝不因为名称覆盖文件坏掉而让面板接口 500 —— 覆盖是可再生的展示增强，不是事实源。
*
* @module dsh-dataforge/capture/names
*/
/** 手工名长度上限（与面板 POST /names 的 400 校验同一口径）。 */
const NAME_MAX_CHARS = 80;
const KINDS = [
	"site",
	"page",
	"interface"
];
function isCaptureNameKind(value) {
	return typeof value === "string" && KINDS.includes(value);
}
/** 键归一：site → 小写 host；page → 页面身份；interface → 原样 trim。 */
function normalizeNameKey(kind, key) {
	const trimmed = key.trim();
	if (kind === "site") return trimmed.toLowerCase();
	if (kind === "page") return pageIdentityOf(trimmed);
	return trimmed;
}
/** 名称清洗：压空白、去首尾（空串 = 删除该条覆盖）。 */
function cleanName(value) {
	return value.replace(/\s+/g, " ").trim();
}
function emptySnapshot() {
	return {
		sites: {},
		pages: {},
		interfaces: {}
	};
}
function bucketOf(snapshot, kind) {
	if (kind === "site") return snapshot.sites;
	if (kind === "page") return snapshot.pages;
	return snapshot.interfaces;
}
/** YAML 文档 → 快照：非对象/坏段如实丢弃（逐段降级，不整份作废）。 */
function sanitizeSnapshot(doc) {
	const snapshot = emptySnapshot();
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return snapshot;
	const record = doc;
	const sections = [
		["sites", record["sites"]],
		["pages", record["pages"]],
		["interfaces", record["interfaces"]]
	];
	for (const [section, raw] of sections) {
		if (raw === null || raw === void 0 || typeof raw !== "object" || Array.isArray(raw)) continue;
		for (const [key, value] of Object.entries(raw)) {
			if (key.trim() === "" || typeof value !== "string") continue;
			const name = cleanName(value);
			if (name === "") continue;
			snapshot[section][key] = name.slice(0, 80);
		}
	}
	return snapshot;
}
var CaptureNamesStore = class {
	filePath;
	data;
	constructor(filePath) {
		this.filePath = filePath;
		this.data = this.load();
	}
	/** 最新快照（深拷贝：调用方改返回值不会污染存储）。 */
	snapshot() {
		return {
			sites: { ...this.data.sites },
			pages: { ...this.data.pages },
			interfaces: { ...this.data.interfaces }
		};
	}
	/**
	* 写一条覆盖：`name` trim 后为空 = 删除该键；否则覆盖。返回**最新**快照。
	*
	* 先算下一份再落盘、成功后才替换内存态：写失败不会留下「内存已改、盘上没改」的半态。
	*/
	set(kind, key, name) {
		const normalizedKey = normalizeNameKey(kind, key);
		if (normalizedKey === "") return this.snapshot();
		const next = this.snapshot();
		const clean = cleanName(name);
		if (clean === "") delete bucketOf(next, kind)[normalizedKey];
		else bucketOf(next, kind)[normalizedKey] = clean.slice(0, 80);
		this.persist(next);
		this.data = next;
		return this.snapshot();
	}
	/** 读文件：缺文件/坏文件/坏形状一律空快照（不抛）。 */
	load() {
		let text;
		try {
			text = readFileSync(this.filePath, "utf8");
		} catch {
			return emptySnapshot();
		}
		try {
			return sanitizeSnapshot(yaml.load(text));
		} catch {
			return emptySnapshot();
		}
	}
	/** 原子写：同目录 tmp 文件写完再 rename（跨进程读取不会看到半截 YAML）。 */
	persist(snapshot) {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const text = yaml.dump(snapshot, {
			lineWidth: 120,
			noRefs: true,
			sortKeys: true
		});
		const tmp = `${this.filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
		writeFileSync(tmp, text, "utf8");
		renameSync(tmp, this.filePath);
	}
};

//#endregion
//#region src/capture/panel-routes.ts
const PANEL_API_PREFIX = "/dashboard/api/dataforge";
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 500;
const RUN_DETAIL_CARDS_LIMIT = 200;
const RUN_DETAIL_RELATIONS_LIMIT = 500;
/** /page-meta 缺省与上限（面板一次要全量页面名；采集库页面规模就几百量级）。 */
const PAGE_META_LIMIT = 500;
/** 写入口请求体上限（面板只需要小 JSON），超过这个尺寸一律 413。 */
const MAX_WRITE_BODY_BYTES = 8192;
/** retitle 未装配时的零状态（GET /retitle/status 不 5xx，如实显示「没在跑」）。 */
const EMPTY_RETITLE_STATUS = {
	running: false,
	targets: 0,
	tried: 0,
	updated: 0,
	failed: 0,
	skipped: 0
};
/**
* 是不是该交给编排子路由。
*
* 两种 URL 形态都要认（宿主可能传完整路径，也可能传剥好前缀的剩余路径）：
* 完整 `/dashboard/api/dataforge/orchestration/...` 与剩余 `/orchestration/...`。
* 采集路由是 /runs /cards /captures，与 /orchestration 无交集。
*/
function isOrchestrationRequest(url) {
	const path = new URL(url ?? "/", "http://panel.localhost").pathname;
	return path.includes("/dataforge/orchestration") || path.startsWith("/orchestration");
}
/**
* 构造面板数据 handler。
*
* URL 两种形态都接受：宿主可能传完整路径（前缀含在 url 里）或剥好前缀的剩余路径。
* GET 面只读；写入口仅 POST /captures、/names、/retitle，其余方法一律 405。
*/
function createCapturePanelHandler(deps) {
	return (req, res) => {
		try {
			const method = (req.method ?? "GET").toUpperCase();
			const url = new URL(req.url ?? "/", "http://panel.localhost");
			const suffix = url.pathname.startsWith("/dashboard/api/dataforge") ? url.pathname.slice(24) : url.pathname;
			if (method === "POST") {
				if (suffix === "/captures") {
					handleStartCapture(deps, req, res);
					return;
				}
				if (suffix === "/names") {
					handleSetName(deps, req, res);
					return;
				}
				if (suffix === "/retitle") {
					handleRetitle(deps, res);
					return;
				}
				fail$3(res, 405, `面板路由不支持 ${method} ${suffix}（写入口仅 POST /captures、/names、/retitle）`, "method-not-allowed");
				return;
			}
			if (method !== "GET") {
				fail$3(res, 405, `面板路由只支持 GET 与 POST /captures、/names、/retitle，收到 ${method}`, "method-not-allowed");
				return;
			}
			if (suffix === "/page-meta") {
				const limit = clampLimit$1(url.searchParams.get("limit"), PAGE_META_LIMIT, PAGE_META_LIMIT);
				ok$3(res, {
					generatedAt: Date.now(),
					pages: deps.store.listPageMeta(limit)
				});
				return;
			}
			if (suffix === "/names") {
				ok$3(res, deps.names?.snapshot() ?? {
					sites: {},
					pages: {},
					interfaces: {}
				});
				return;
			}
			if (suffix === "/retitle/status") {
				ok$3(res, deps.retitle?.status() ?? { ...EMPTY_RETITLE_STATUS });
				return;
			}
			if (suffix === "/runs") {
				ok$3(res, {
					generatedAt: Date.now(),
					runs: deps.store.listRuns(clampLimit$1(url.searchParams.get("limit"), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT))
				});
				return;
			}
			if (suffix.startsWith("/runs/")) {
				const id = decodeURIComponent(suffix.slice(6));
				if (id.length === 0 || id.includes("/")) {
					fail$3(res, 404, `不认识的路径：${suffix}`, "unknown-path");
					return;
				}
				const run = deps.store.getRun(id);
				if (run === void 0) {
					fail$3(res, 404, `采集运行 ${id} 不存在`, "not-found");
					return;
				}
				ok$3(res, {
					generatedAt: Date.now(),
					run,
					pages: deps.store.listPages(id, MAX_LIST_LIMIT),
					samples: deps.store.listSamples(id, MAX_LIST_LIMIT).map(sanitizeSample),
					credentials: deps.store.listCredentials(id, MAX_LIST_LIMIT).map(({ valueJson: _valueStaysInDb, ...rest }) => rest),
					cards: deps.store.listCards(id, RUN_DETAIL_CARDS_LIMIT).map((card) => projectCard(card, deps.names?.snapshot())),
					relations: deps.store.listRelations(id, RUN_DETAIL_RELATIONS_LIMIT)
				});
				return;
			}
			if (suffix === "/cards") {
				const names = deps.names?.snapshot();
				ok$3(res, {
					generatedAt: Date.now(),
					cards: deps.store.listAllCards(clampLimit$1(url.searchParams.get("limit"), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT), clampOffset(url.searchParams.get("offset"))).map((card) => projectCard(card, names)),
					total: deps.store.countAllCards()
				});
				return;
			}
			fail$3(res, 404, `不认识的路径：${suffix}`, "unknown-path");
		} catch (err) {
			fail$3(res, 500, String(err?.message ?? err), "internal");
		}
	};
}
/**
* 卡片出口投影：mergeKey / name / nameSource。
*
* name = 手工覆盖（按 mergeKey，来自 names.yaml）?? 改进后的 semanticName（方法+模板实时生成）。
* 注意**不用**卡行上落库的 name 字段：那是采集期旧口径（v1 语义名），会与改进后的规则长期不一致；
* 卡行 name 仍保留作审计，展示以本投影为准。
*/
function projectCard(card, names) {
	const mergeKey = card.mergeKey !== void 0 && card.mergeKey !== "" ? card.mergeKey : mergeKeyOf(card.method, card.urlTemplate);
	const manual = names?.interfaces[mergeKey];
	const manualName = manual !== void 0 && manual !== "" ? manual : void 0;
	return {
		...card,
		mergeKey,
		name: manualName ?? semanticName(card.method, card.urlTemplate),
		nameSource: manualName === void 0 ? "auto" : "manual"
	};
}
/** POST /captures：发起单页采集。FR-7.6 边界在闸内：body 里 taskType 只认 single_page，其余 400。 */
async function handleStartCapture(deps, req, res) {
	let body;
	try {
		body = JSON.parse(await readBody$2(req, MAX_WRITE_BODY_BYTES) || "{}");
	} catch (err) {
		if (err instanceof BodyTooLargeError$1) {
			fail$3(res, 413, `请求体超过 ${MAX_WRITE_BODY_BYTES} 字节`, "body-too-large");
			return;
		}
		fail$3(res, 400, "请求体不是合法 JSON", "bad-json");
		return;
	}
	const record = typeof body === "object" && body !== null ? body : {};
	const taskType = record["taskType"] === void 0 ? "single_page" : record["taskType"];
	if (taskType !== "single_page") {
		fail$3(res, 400, `面板只能发起 single_page 采集，收到 ${String(taskType)}（写操作/爬取走 agent 入口 dataforge_capture）`, "bad-task-type");
		return;
	}
	if (typeof record["entryUrl"] !== "string" || record["entryUrl"].length === 0) {
		fail$3(res, 400, "缺少 entryUrl（字符串）", "bad-entry-url");
		return;
	}
	const entryUrl = record["entryUrl"];
	let entry;
	try {
		entry = new URL(entryUrl);
	} catch {
		fail$3(res, 400, `entryUrl 不是合法 URL：${entryUrl.slice(0, 200)}`, "bad-entry-url");
		return;
	}
	if (entry.protocol !== "http:" && entry.protocol !== "https:") {
		fail$3(res, 400, `只支持 http/https 入口，收到 ${entry.protocol}`, "bad-entry-url");
		return;
	}
	const blocked = blockedTargetReason(entry.hostname);
	if (blocked !== void 0) {
		fail$3(res, 400, `拒绝采集 ${entry.hostname}：${blocked}`, "blocked-target");
		return;
	}
	const busy = deps.store.listRuns(200).find((run) => run.status === "running" && sameHost(run.entryUrl, entry));
	if (busy !== void 0) {
		fail$3(res, 409, `该站点已有进行中的采集（${busy.id}），等它收口后再发起`, "host-busy");
		return;
	}
	if (deps.startCapture === void 0) {
		fail$3(res, 503, "采集发起未装配（startCapture 未注入）", "capture-not-wired");
		return;
	}
	let result;
	try {
		result = await deps.startCapture({
			taskType,
			entryUrl
		});
	} catch (err) {
		fail$3(res, 500, String(err?.message ?? err), "capture-start-failed");
		return;
	}
	ok$3(res, {
		accepted: result.accepted,
		gate: result.gate,
		captureId: result.captureId,
		...result.degradedNotice === void 0 ? {} : { degradedNotice: result.degradedNotice },
		card: result.card
	});
}
/**
* POST /names：写一条三级手工名覆盖。
*
* body `{kind:'site'|'page'|'interface', key:string, name:string}`；name trim 后空串 = 删除该条覆盖。
* 校验：kind 合法、key 非空字符串、name 字符串且 ≤80 字符，否则 400 信封错误。
* 回执 data `{kind,key,name?}`：key 是**归一后**的键（site 小写 / page 身份 / interface trim）。
*/
async function handleSetName(deps, req, res) {
	let body;
	try {
		body = JSON.parse(await readBody$2(req, MAX_WRITE_BODY_BYTES) || "{}");
	} catch (err) {
		if (err instanceof BodyTooLargeError$1) {
			fail$3(res, 413, `请求体超过 ${MAX_WRITE_BODY_BYTES} 字节`, "body-too-large");
			return;
		}
		fail$3(res, 400, "请求体不是合法 JSON", "bad-json");
		return;
	}
	const record = typeof body === "object" && body !== null ? body : {};
	const kindRaw = record["kind"];
	if (!isCaptureNameKind(kindRaw)) {
		fail$3(res, 400, `kind 非法：${String(kindRaw)}（可选 site/page/interface）`, "bad-name-kind");
		return;
	}
	const keyRaw = record["key"];
	if (typeof keyRaw !== "string" || keyRaw.trim() === "") {
		fail$3(res, 400, "缺少 key（非空字符串）", "bad-name-key");
		return;
	}
	const nameRaw = record["name"];
	if (typeof nameRaw !== "string") {
		fail$3(res, 400, "name 必须是字符串（空串 = 删除该条覆盖）", "bad-name-value");
		return;
	}
	const name = cleanName(nameRaw);
	if (name.length > 80) {
		fail$3(res, 400, `name 超过 ${80} 字符`, "name-too-long");
		return;
	}
	const normalizedKey = normalizeNameKey(kindRaw, keyRaw);
	if (normalizedKey === "") {
		fail$3(res, 400, `key 归一后为空：${keyRaw.slice(0, 200)}`, "bad-name-key");
		return;
	}
	if (deps.names === void 0) {
		fail$3(res, 503, "名称覆盖存储未装配（names 未注入）", "names-not-wired");
		return;
	}
	try {
		deps.names.set(kindRaw, keyRaw, name);
	} catch (err) {
		fail$3(res, 500, `名称覆盖写入失败：${String(err?.message ?? err)}`, "names-write-failed");
		return;
	}
	ok$3(res, name === "" ? {
		kind: kindRaw,
		key: normalizedKey
	} : {
		kind: kindRaw,
		key: normalizedKey,
		name
	});
}
/**
* POST /retitle：启动旧页面标题补抓。
*
* 操作反馈用 200 信封表达（accepted=false + reason='busy'|'no-targets'|'capture-running'），
* 不用 4xx/5xx —— 这些不是请求错误，而是「现在不能跑」。未装配属装配问题，才回 503。
*/
function handleRetitle(deps, res) {
	if (deps.retitle === void 0) {
		fail$3(res, 503, "标题补抓未装配（retitle 未注入）", "retitle-not-wired");
		return;
	}
	try {
		ok$3(res, deps.retitle.start());
	} catch (err) {
		fail$3(res, 500, `标题补抓启动失败：${String(err?.message ?? err)}`, "retitle-start-failed");
	}
}
/** 本机 / 链路本地 / 云元数据地址：面板写入口不接受（agent 工具面不受此限，便于本地调试）。 */
function blockedTargetReason(hostname) {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost")) return "本机回环地址";
	if (host === "::1" || host === "0.0.0.0") return "本机回环地址";
	if (/^127\./.test(host)) return "本机回环地址";
	if (/^169\.254\./.test(host)) return "链路本地/云元数据地址";
}
function sameHost(left, right) {
	try {
		return new URL(left).host === right.host;
	} catch {
		return false;
	}
}
var BodyTooLargeError$1 = class extends Error {};
function readBody$2(req, maxBytes) {
	return new Promise((resolve, reject) => {
		let total = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			total += chunk.length;
			if (total > maxBytes) {
				reject(new BodyTooLargeError$1("request body too large"));
				if (typeof req.resume === "function") req.resume();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}
/**
* 把面板路由注册到宿主 webServer，返回幂等 disposer。
*
* 半注册规避（对齐 pm legacy-board-route 纪律）：register 抛错时撤销已注册者再向上抛，
* 不留「没有 disposer 的泄漏注册」。
*/
function registerCapturePanelRoutes(webServer, deps) {
	const captureHandler = createCapturePanelHandler(deps);
	const orchestration = deps.orchestration;
	const uiTest = deps.uiTest;
	const artifacts = deps.artifacts;
	const handler = orchestration === void 0 && uiTest === void 0 && artifacts === void 0 ? captureHandler : (req, res) => {
		if (artifacts !== void 0 && artifacts(req, res) === true) return;
		if (uiTest !== void 0 && uiTest(req, res) === true) return;
		if (orchestration !== void 0 && isOrchestrationRequest(req.url)) orchestration(req, res);
		else captureHandler(req, res);
	};
	const dispose = webServer.register({
		kind: "prefix",
		path: PANEL_API_PREFIX,
		handler
	});
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		dispose();
	};
}
function ok$3(res, data) {
	send$2(res, 200, {
		success: true,
		data
	});
}
/** 样本出口投影：header 记录（Cookie/Set-Cookie 与 value_json 同级的凭据载体）与服务端内部文件路径不出壳；预览正文保留。 */
function sanitizeSample(sample) {
	return {
		id: sample.id,
		captureId: sample.captureId,
		pageUrl: sample.pageUrl,
		seq: sample.seq,
		url: sample.url,
		method: sample.method,
		status: sample.status,
		requestBodyPreview: sample.requestBodyPreview,
		responsePreview: sample.responsePreview,
		truncated: sample.truncated,
		ts: sample.ts
	};
}
function fail$3(res, status, error, code) {
	send$2(res, status, code === void 0 ? {
		success: false,
		error
	} : {
		success: false,
		error,
		code
	});
}
function send$2(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}
function clampLimit$1(raw, fallback, max) {
	const parsed = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(parsed, max);
}
function clampOffset(raw) {
	const parsed = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(parsed) || parsed < 0) return 0;
	return parsed;
}

//#endregion
//#region src/capture/retitle.ts
/** 单轮补抓目标上限（旧页面很多时只补最需要的，不无限开浏览器）。 */
const RETITLE_MAX_TARGETS = 60;
const RUN_SCAN_LIMIT = 500;
const PAGE_META_SCAN_LIMIT = 1e3;
const CARD_SCAN_LIMIT = 2e3;
const COOKIE_LIMIT = 1e3;
const NAV_TIMEOUT_MS = 15e3;
const NETWORK_IDLE_TIMEOUT_MS = 3e3;
var TitleBackfillService = class {
	data = emptyStatus();
	deps;
	constructor(deps) {
		this.deps = deps;
	}
	status() {
		return { ...this.data };
	}
	/**
	* 启动一轮补抓（异步：立即返回受理结果，浏览器在后台跑）。
	*
	* 闸顺序：已有补抓在跑 → busy；目标里没有可跑的（全被 host 级采集闸挡下/本来就没有）时，
	* 有 running 采集 → capture-running，否则 → no-targets。
	* host 级采集闸：正在采集的 host 本轮跳过（避免同站抢浏览器/登录态），其余 host 照常跑。
	*/
	start() {
		if (this.data.running) return {
			accepted: false,
			targets: 0,
			hosts: 0,
			reason: "busy"
		};
		const runningHosts = new Set(this.deps.store.listRuns(RUN_SCAN_LIMIT).filter((run) => run.status === "running").map((run) => hostOf(run.entryUrl)).filter((host) => host !== ""));
		const plan = this.plan(runningHosts);
		if (plan.targets.length === 0) return {
			accepted: false,
			targets: 0,
			hosts: 0,
			reason: runningHosts.size > 0 ? "capture-running" : "no-targets"
		};
		this.data = {
			running: true,
			targets: plan.targets.length,
			tried: 0,
			updated: 0,
			failed: 0,
			skipped: 0,
			startedAt: Date.now()
		};
		this.run(plan.targets).catch(() => void 0);
		return {
			accepted: true,
			targets: plan.targets.length,
			hosts: plan.hosts
		};
	}
	/** 计划补抓目标：入口页 → 卡上页面引用 → pages 表，按身份去重；只取缺标题/缺站点名的入口页。 */
	plan(runningHosts) {
		const runs = this.deps.store.listRuns(RUN_SCAN_LIMIT);
		const metaRows = this.deps.store.listPageMeta(PAGE_META_SCAN_LIMIT);
		const titleByIdentity = /* @__PURE__ */ new Map();
		const siteNameHosts = /* @__PURE__ */ new Set();
		for (const row of metaRows) {
			const host = hostOf(row.url);
			titleByIdentity.set(row.url, row.title !== void 0 && row.title !== "");
			if (host !== "" && row.siteName !== void 0 && row.siteName !== "") siteNameHosts.add(host);
		}
		const candidates = [];
		for (const run of runs) candidates.push({
			raw: run.entryUrl,
			isEntry: true
		});
		for (const card of this.deps.store.listAllCards(CARD_SCAN_LIMIT, 0)) for (const pageUrl of card.relatedPageUrls) candidates.push({
			raw: pageUrl,
			isEntry: false
		});
		for (const row of metaRows) candidates.push({
			raw: row.url,
			isEntry: false
		});
		const seen = /* @__PURE__ */ new Set();
		const hosts = /* @__PURE__ */ new Set();
		const targets = [];
		for (const candidate of candidates) {
			if (targets.length >= 60) break;
			const raw = candidate.raw.trim();
			if (!/^https?:/i.test(raw)) continue;
			const identity = pageIdentityOf(raw);
			if (identity === "" || seen.has(identity)) continue;
			const host = hostOf(identity);
			if (host === "") continue;
			if (runningHosts.has(host)) continue;
			seen.add(identity);
			const hasTitle = titleByIdentity.get(identity) === true;
			const needsSiteName = candidate.isEntry && !siteNameHosts.has(host);
			if (hasTitle && !needsSiteName) continue;
			targets.push({
				identity,
				url: raw,
				host
			});
			hosts.add(host);
		}
		return {
			targets,
			hosts: hosts.size
		};
	}
	/** 后台执行体：一次浏览器、逐目标导航；无论成败 finally 关浏览器并收口状态。 */
	async run(targets) {
		let handle;
		let currentHost = "";
		try {
			const cookies = this.loadCookies();
			handle = await this.deps.openPage(this.deps.channel, () => void 0, { headless: true });
			for (const target of targets) {
				if (target.host !== currentHost) {
					currentHost = target.host;
					if (typeof handle.context.clearCookies === "function") await handle.context.clearCookies().catch(() => void 0);
					const matched = cookies.filter((cookie) => cookieMatchesHost(cookie.domain, target.host));
					if (matched.length > 0 && typeof handle.context.addCookies === "function") await handle.context.addCookies(matched).catch(() => void 0);
				}
				this.data.tried += 1;
				await this.backfillOne(handle, target);
			}
		} catch (err) {
			this.data.error = errText(err);
		} finally {
			await handle?.browser.close().catch(() => void 0);
			this.data.skipped = Math.max(0, this.data.targets - this.data.tried);
			this.data.running = false;
			this.data.finishedAt = Date.now();
		}
	}
	/** 单目标：导航 → 读 meta → 身份校验 → 回写（所有异常落 failed，不打断整轮）。 */
	async backfillOne(handle, target) {
		try {
			await handle.page.goto(target.url, {
				waitUntil: "domcontentloaded",
				timeout: NAV_TIMEOUT_MS
			}).catch(() => void 0);
			await handle.page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => void 0);
			const meta = await readPageMeta(handle.page);
			if (meta.url === "" || pageIdentityOf(meta.url) !== target.identity) {
				this.data.failed += 1;
				return;
			}
			if (meta.title === void 0 && meta.siteName === void 0) {
				this.data.failed += 1;
				return;
			}
			let updatedRows = this.deps.store.applyPageMeta(meta.url, meta.title, meta.siteName);
			if (updatedRows === 0) {
				const captureId = this.latestCaptureIdOfHost(target.host);
				if (captureId !== void 0) {
					this.deps.store.upsertPage(captureId, target.identity, 0, "ok", {
						...meta.title === void 0 ? {} : { title: meta.title },
						...meta.siteName === void 0 ? {} : { siteName: meta.siteName }
					});
					updatedRows = 1;
				}
			}
			if (updatedRows > 0) this.data.updated += 1;
			else this.data.failed += 1;
		} catch {
			this.data.failed += 1;
		}
	}
	/** 从 credential_events 读已存 cookie（同 domain/path/name 以最近一次为准，过期丢弃）。 */
	loadCookies() {
		const nowSeconds = Date.now() / 1e3;
		const byKey = /* @__PURE__ */ new Map();
		for (const json of this.deps.store.listCookieJson(COOKIE_LIMIT)) {
			let raw;
			try {
				raw = JSON.parse(json);
			} catch {
				continue;
			}
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
			const record = raw;
			const name = typeof record["name"] === "string" ? record["name"] : "";
			const value = typeof record["value"] === "string" ? record["value"] : "";
			const domain = typeof record["domain"] === "string" ? record["domain"] : "";
			if (name === "" || domain === "") continue;
			const expires = typeof record["expires"] === "number" && Number.isFinite(record["expires"]) ? record["expires"] : -1;
			if (expires > 0 && expires < nowSeconds) continue;
			const path = typeof record["path"] === "string" && record["path"] !== "" ? record["path"] : "/";
			const sameSiteRaw = typeof record["sameSite"] === "string" ? record["sameSite"] : "Lax";
			const sameSite = sameSiteRaw === "Strict" || sameSiteRaw === "Lax" || sameSiteRaw === "None" ? sameSiteRaw : "Lax";
			const cookie = {
				name,
				value,
				domain,
				path,
				expires,
				httpOnly: record["httpOnly"] === true,
				secure: record["secure"] === true,
				sameSite
			};
			byKey.set(`${domain}|${path}|${name}`, cookie);
		}
		return [...byKey.values()];
	}
	/** 该 host 最近一次采集的 captureId（目标不在 pages 表时补行用）；没有则 undefined。 */
	latestCaptureIdOfHost(host) {
		return this.deps.store.listRuns(RUN_SCAN_LIMIT).find((run) => hostOf(run.entryUrl) === host)?.id;
	}
};
/** URL → host（解析失败返回空串，调用方按无 host 跳过）。 */
function hostOf(url) {
	try {
		return new URL(url).host.toLowerCase();
	} catch {
		return "";
	}
}
/** cookie domain（可带前导点）是否覆盖 host：`example.com` 覆盖 `a.example.com`。 */
function cookieMatchesHost(cookieDomain, host) {
	const domain = cookieDomain.trim().toLowerCase().replace(/^\./, "");
	const target = host.trim().toLowerCase();
	return domain !== "" && (target === domain || target.endsWith(`.${domain}`));
}
function errText(err) {
	const message = err?.message;
	return (typeof message === "string" && message.length > 0 ? message : String(err)).slice(0, 300);
}
function emptyStatus() {
	return {
		running: false,
		targets: 0,
		tried: 0,
		updated: 0,
		failed: 0,
		skipped: 0
	};
}

//#endregion
//#region src/orchestration/panel-routes.ts
const ORCHESTRATION_API_PREFIX = "/orchestration";
/** 画布保存请求体上限：链 YAML 可能不小，但也不该是任意大。 */
const MAX_SAVE_BODY_BYTES = 524288;
/** 构造编排面板 handler。 */
function createOrchestrationPanelHandler(deps) {
	return (req, res) => {
		handle(deps, req, res);
	};
}
async function handle(deps, req, res) {
	try {
		const method = (req.method ?? "GET").toUpperCase();
		const url = new URL(req.url ?? "/", "http://panel.localhost");
		const suffix = stripPrefix$2(url.pathname);
		if (method === "POST") {
			if (suffix === "/graph") {
				await handleSave(deps, req, res, url);
				return;
			}
			if (suffix === "/rename") {
				await handleRename(deps, req, res, url);
				return;
			}
			fail$2(res, 405, `编排路由不支持 POST ${suffix}（写入口仅 /graph 与 /rename）`, "method-not-allowed");
			return;
		}
		if (method !== "GET") {
			fail$2(res, 405, `编排路由只支持 GET/POST，收到 ${method}`, "method-not-allowed");
			return;
		}
		if (suffix === "/overview") {
			ok$2(res, await buildOverview(deps, url));
			return;
		}
		if (suffix === "/graph") {
			await handleGraph(deps, url, res);
			return;
		}
		if (suffix === "/palette") {
			ok$2(res, await buildPalette(deps, url));
			return;
		}
		fail$2(res, 404, `不认识的路径：${suffix}`, "unknown-path");
	} catch (error) {
		fail$2(res, 500, error instanceof Error ? error.message : String(error), "internal");
	}
}
/** 前缀剥离：宿主可能传含前缀的完整路径，也可能传已剥好的剩余路径。 */
function stripPrefix$2(pathname) {
	const full = `/dashboard/api/dataforge${ORCHESTRATION_API_PREFIX}`;
	if (pathname.startsWith(full)) return pathname.slice(full.length) || "/";
	if (pathname.startsWith("/orchestration")) return pathname.slice(14) || "/";
	return pathname;
}
/**
* 本次请求要读哪个工作区。
*
* 面板属于某个工作区，而宿主进程的 cwd 往往是 **profile 目录**（
* `~/.dsh/profiles/desktop`），拿它当工作区会把 `.dsh/dataforge/chains` 指到空目录
* （现象：面板永远显示「还没有任何编排流程」）。所以面板显式带 `?workspace=<绝对路径>`；
* 只接受「绝对路径 + 真实存在的目录」，其余一律回落宿主解析器，不做路径注入的入口。
*/
async function resolveRoot$1(deps, url) {
	const raw = url.searchParams.get("workspace")?.trim();
	if (raw !== void 0 && raw.length > 0 && isAbsolute(raw)) try {
		if (statSync(raw).isDirectory()) {
			if (deps.fallbackWorkspaceRoot !== void 0 && !existsSync(join(raw, ".dsh", "dataforge"))) {
				const fallback = await deps.fallbackWorkspaceRoot();
				if (fallback !== void 0 && fallback !== "") return fallback;
			}
			return raw;
		}
	} catch {}
	return deps.resolveWorkspaceRoot();
}
async function buildOverview(deps, url) {
	const workspaceRoot = await resolveRoot$1(deps, url);
	const siteFilter = url.searchParams.get("site");
	const chains = listChains(workspaceRoot);
	const flows = [];
	for (const chain of chains) {
		if (siteFilter !== null && siteFilter.length > 0 && chain.site !== siteFilter) continue;
		const infos = listChainVersionInfos(workspaceRoot, chain.site, chain.flow);
		const latest = chain.latest;
		flows.push({
			site: chain.site,
			flow: chain.flow,
			...chain.kind === void 0 ? {} : { kind: chain.kind },
			...chain.domain === void 0 ? {} : { domain: chain.domain },
			...chain.note === void 0 ? {} : { note: chain.note },
			...latest === void 0 ? {} : { latest },
			...chain.updatedAt === void 0 ? {} : { updatedAt: chain.updatedAt },
			...chain.nodeCount === void 0 ? {} : { nodeCount: chain.nodeCount },
			...chain.edgeCount === void 0 ? {} : { edgeCount: chain.edgeCount },
			...chain.hosts === void 0 ? {} : { hosts: chain.hosts },
			...chain.unreadable === void 0 ? {} : { unreadable: chain.unreadable },
			versions: infos.map((info) => ({
				version: info.version,
				...info.created === void 0 ? {} : { created: info.created },
				...info.source === void 0 ? {} : { source: info.source },
				...info.note === void 0 ? {} : { note: info.note },
				...info.nodeCount === void 0 ? {} : { nodeCount: info.nodeCount },
				...info.edgeCount === void 0 ? {} : { edgeCount: info.edgeCount },
				superseded: latest !== void 0 && info.version < latest,
				...info.unreadable === void 0 ? {} : { unreadable: info.unreadable }
			}))
		});
	}
	return {
		sites: foldSites(flows),
		flows,
		chainsRootHint: `${workspaceRoot}/.dsh/dataforge/chains`
	};
}
/**
* 流程行 → 网站行。
*
* 站点名取链文件里的 meta.site（目录是 slug，可能与原名不同）——这里用目录名做 key、
* 用任一版本的 meta 原名做展示名；两者不同时以文件为准（与 store 的说明一致）。
*/
function foldSites(flows) {
	const bySite = /* @__PURE__ */ new Map();
	for (const flow of flows) {
		const row = bySite.get(flow.site) ?? {
			site: flow.site,
			pageFlows: 0,
			apiFlows: 0,
			flows: 0,
			domains: [],
			hosts: []
		};
		row.flows += 1;
		if (flow.kind === "page-chain") row.pageFlows += 1;
		if (flow.kind === "interface-chain") row.apiFlows += 1;
		if (flow.domain !== void 0 && !row.domains.includes(flow.domain)) row.domains.push(flow.domain);
		for (const host of flow.hosts ?? []) if (!row.hosts.includes(host)) row.hosts.push(host);
		if (flow.updatedAt !== void 0 && (row.updatedAt === void 0 || flow.updatedAt > row.updatedAt)) row.updatedAt = flow.updatedAt;
		bySite.set(flow.site, row);
	}
	return [...bySite.values()].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}
async function handleGraph(deps, url, res) {
	const site = url.searchParams.get("site") ?? "";
	const flow = url.searchParams.get("flow") ?? "";
	const rawVersion = url.searchParams.get("version");
	const version = rawVersion === null || rawVersion.length === 0 ? void 0 : Number.parseInt(rawVersion, 10);
	if (site.length === 0 || flow.length === 0) {
		fail$2(res, 400, "缺少 site / flow 查询参数（链按「站点 / 流程」归档）", "missing-param");
		return;
	}
	if (version !== void 0 && (!Number.isInteger(version) || version < 1)) {
		fail$2(res, 400, `version 必须是正整数，收到 ${rawVersion}`, "bad-param");
		return;
	}
	const workspaceRoot = await resolveRoot$1(deps, url);
	const loaded = loadChain(workspaceRoot, site, flow, version === void 0 ? {} : { version });
	if (!loaded.ok) {
		fail$2(res, loaded.code === "chain-not-found" ? 404 : 422, loaded.message, loaded.code);
		return;
	}
	const text = readChainText(workspaceRoot, site, flow, loaded.version);
	const { meta } = loaded.doc;
	ok$2(res, {
		site: loaded.doc.meta.site,
		flow: loaded.doc.meta.flow,
		version: loaded.version,
		kind: loaded.doc.kind,
		...meta.domain === void 0 ? {} : { domain: meta.domain },
		...meta.note === void 0 ? {} : { note: meta.note },
		...meta.source === void 0 ? {} : { source: meta.source },
		...meta.created === void 0 ? {} : { created: meta.created },
		chainYaml: text?.text ?? "",
		doc: loaded.doc,
		cards: resolveCardIdentities(workspaceRoot, loaded.doc),
		versions: listChainVersions(workspaceRoot, site, flow)
	});
}
const MAX_PALETTE_CARDS = 500;
const MAX_PALETTE_PAGES = 200;
async function buildPalette(deps, url) {
	const workspaceRoot = await resolveRoot$1(deps, url);
	let cards = [];
	try {
		cards = listCards(workspaceRoot);
	} catch {
		cards = [];
	}
	const pages = /* @__PURE__ */ new Map();
	for (const card of cards) for (const source of card.sources ?? []) for (const page of source.pages ?? []) {
		if (page.length === 0) continue;
		const key = pageIdentityOf(page);
		if (!pages.has(key)) pages.set(key, page);
	}
	const truncated = cards.length > MAX_PALETTE_CARDS ? `接口库有 ${cards.length} 张卡，调色板只列前 ${MAX_PALETTE_CARDS} 张（用搜索框缩小范围）` : void 0;
	return {
		cards: cards.slice(0, MAX_PALETTE_CARDS).map((card) => ({
			cardId: card.cardId,
			...card.name === void 0 ? {} : { name: card.name },
			method: card.identity.method,
			urlTemplate: card.identity.urlTemplate,
			inputCount: card.inputs.length,
			outputCount: card.outputs.length
		})),
		pages: [...pages.values()].slice(0, MAX_PALETTE_PAGES),
		...truncated === void 0 ? {} : { truncated }
	};
}
/** 节点引用的卡身份投影（读不到的卡不出现在表里，画布降级显示 cardId）。 */
function resolveCardIdentities(workspaceRoot, doc) {
	const cards = {};
	for (const node of doc.nodes) {
		if (node.card === void 0 || cards[node.card] !== void 0) continue;
		const card = readCard(workspaceRoot, node.card);
		if (card === void 0) continue;
		cards[node.card] = {
			...card.name === void 0 ? {} : { name: card.name },
			method: card.identity.method,
			urlTemplate: card.identity.urlTemplate,
			inputs: card.inputs.map((field) => ({
				path: field.path,
				type: field.type,
				...field.required === void 0 ? {} : { required: field.required }
			})),
			outputs: card.outputs.map((field) => ({
				path: field.path,
				type: field.type,
				...field.required === void 0 ? {} : { required: field.required }
			}))
		};
	}
	return cards;
}
/** 画布保存：只接受链 YAML 文本，交给 saveChain（唯一写入口），来源标 canvas。 */
async function handleSave(deps, req, res, url) {
	const body = await readBody$1(req);
	if (body === void 0) {
		fail$2(res, 413, `请求体超过 ${MAX_SAVE_BODY_BYTES} 字节上限`, "payload-too-large");
		return;
	}
	let input;
	let source = "canvas";
	try {
		const parsed = JSON.parse(body);
		if (typeof parsed.chainYaml === "string" && parsed.chainYaml.trim().length > 0) input = parsed.chainYaml;
		else if (parsed.doc !== null && typeof parsed.doc === "object") input = parsed.doc;
		else {
			fail$2(res, 400, "请求体必须形如 {\"doc\": {…链文档…}} 或 {\"chainYaml\": \"<链 YAML 文本>\"}", "bad-param");
			return;
		}
		if (parsed.source === "import") source = "import";
		else if (parsed.source !== void 0 && parsed.source !== "canvas") {
			fail$2(res, 400, `source 只接受 canvas / import，收到 ${String(parsed.source)}`, "bad-param");
			return;
		}
	} catch {
		fail$2(res, 400, "请求体不是合法 JSON", "bad-json");
		return;
	}
	const workspaceRoot = await resolveRoot$1(deps, url);
	const saved = saveChain(workspaceRoot, input, { source });
	if (!saved.ok) {
		ok$2(res, {
			ok: false,
			code: saved.issues.some((issue) => issue.code === "card-not-imported") ? "card-not-imported" : "invalid-chain",
			issues: toIssues(saved.issues)
		});
		return;
	}
	ok$2(res, {
		ok: true,
		version: saved.version,
		path: saved.path,
		warnings: toIssues(saved.warnings)
	});
}
/**
* POST /orchestration/rename
*
* body：{ kind: 'flow'|'domain', site, flow?, domain?, newName }
* 改名语义与「不改内容、不改版本号」的边界见 `chains/store.ts` 的 renameChainFlow / renameChainDomain。
*/
async function handleRename(deps, req, res, url) {
	const body = await readBody$1(req);
	if (body === void 0) {
		fail$2(res, 413, `请求体超过 ${MAX_SAVE_BODY_BYTES} 字节`, "too-large");
		return;
	}
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		fail$2(res, 400, "请求体不是合法 JSON", "bad-json");
		return;
	}
	const site = typeof parsed.site === "string" ? parsed.site.trim() : "";
	const newName = typeof parsed.newName === "string" ? parsed.newName.trim() : "";
	if (site === "" || newName === "") {
		fail$2(res, 400, "site 与 newName 必须是非空字符串", "bad-param");
		return;
	}
	const workspaceRoot = await resolveRoot$1(deps, url);
	if (parsed.kind === "flow") {
		const flow = typeof parsed.flow === "string" ? parsed.flow.trim() : "";
		if (flow === "") {
			fail$2(res, 400, "kind=flow 时必须给 flow", "bad-param");
			return;
		}
		const result = renameChainFlow(workspaceRoot, site, flow, newName);
		if (!result.ok) {
			failRename(res, result);
			return;
		}
		ok$2(res, result);
		return;
	}
	if (parsed.kind === "domain") {
		const domain = typeof parsed.domain === "string" ? parsed.domain.trim() : "";
		if (domain === "") {
			fail$2(res, 400, "kind=domain 时必须给 domain", "bad-param");
			return;
		}
		const result = renameChainDomain(workspaceRoot, site, domain, newName);
		if (!result.ok) {
			failRename(res, result);
			return;
		}
		ok$2(res, result);
		return;
	}
	fail$2(res, 400, `kind 只接受 flow / domain，收到 ${String(parsed.kind)}`, "bad-param");
}
/** 改名失败码 → HTTP 状态（错误的可读消息原样透出给面板）。 */
function failRename(res, result) {
	const status = result.code === "rename-not-found" ? 404 : result.code === "rename-conflict" ? 409 : 400;
	res.writeHead(status);
	res.end(JSON.stringify({
		success: false,
		error: result.message,
		code: result.code,
		...result.issues === void 0 ? {} : { issues: toIssues(result.issues) }
	}));
}
function toIssues(issues) {
	return issues.map((issue) => ({
		target: issue.target,
		code: issue.code,
		reason: issue.reason
	}));
}
function readBody$1(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_SAVE_BODY_BYTES) {
				resolve(void 0);
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}
function ok$2(res, data) {
	send$1(res, 200, {
		success: true,
		data
	});
}
function fail$2(res, status, error, code) {
	send$1(res, status, code === void 0 ? {
		success: false,
		error
	} : {
		success: false,
		error,
		code
	});
}
function send$1(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}

//#endregion
//#region src/uitest/panel-routes.ts
/**
* UI 测试面板数据面：`/dashboard/api/dataforge/ui-tests/*`。
*
* 与采集/编排同一前缀、同一套信封（200 {success:true,data} / 4xx {success:false,error,code}），
* 由同一份 `PanelRouteRegistrar` 注册；入口在采集 handler 里分派（见 capture/panel-routes 的
* 说明：同一前缀只注册一次，子路径在自己代码里分派）。
*
* 路由面（读为主 + 用户显式操作）：
*   GET  /ui-tests/overview                     网站/流程/版本摘要 + 最近运行 + 录制会话
*   GET  /ui-tests/script?site&flow&version     单版本脚本（doc + yaml + 版本列表）
*   POST /ui-tests/script                       手写/导入脚本（只经 saveUiScript 落新版本）
*   POST /ui-tests/record/open                  开可见 Chrome（不开始录，先登录）
*   POST /ui-tests/record/start                 开始录制
*   POST /ui-tests/record/stop                  停止录制（可选保存为脚本）
*   POST /ui-tests/record/close                 关闭录制会话
*   GET  /ui-tests/record/sessions              录制会话列表
*   POST /ui-tests/run                          回放：不带 confirm 只回计划卡
*   GET  /ui-tests/runs                         最近运行
*   GET  /ui-tests/runs/:id                     运行详情（事件流）
*   GET  /ui-tests/runs/:id/evidence?name=…     失败截图/现场 HTML（白名单文件名）
*
* 纪律：脚本落盘只经 saveUiScript（校验全过才落新版本）；cookie 值永不出壳；
* 运行证据只允许 failure.png / failure.html（防路径穿越）。
*
* @module dsh-dataforge/uitest/panel-routes
*/
const UI_TEST_API_PREFIX = "/ui-tests";
/** 脚本 YAML 可能不小；录制/回放请求都是小 JSON。 */
const MAX_SCRIPT_BODY_BYTES = 1048576;
const MAX_SMALL_BODY_BYTES = 65536;
/** 是否本模块的请求（两种 URL 形态都认）。 */
function isUiTestRequest(url) {
	const pathname = new URL(url ?? "/", "http://panel.localhost").pathname;
	return pathname.includes("/dataforge/ui-tests") || pathname.startsWith("/ui-tests");
}
/**
* 构造 UI 测试面板 handler。
*
* 返回 true = 本 handler 已接管（含 405/404），false = 不是本模块路径，交回上层分派。
*/
function createUiTestPanelHandler(deps) {
	return (req, res) => {
		const url = new URL(req.url ?? "/", "http://panel.localhost");
		if (!isUiTestRequest(req.url)) return false;
		const suffix = stripPrefix$1(url.pathname);
		try {
			dispatch(deps, req, res, url, suffix, (req.method ?? "GET").toUpperCase());
		} catch (error) {
			fail$1(res, 500, String(error?.message ?? error), "internal");
		}
		return true;
	};
}
async function dispatch(panel, req, res, url, suffix, method) {
	const workspaceRoot = await resolveRoot(panel, url);
	const deps = {
		...panel.deps,
		resolveWorkspaceRoot: async () => workspaceRoot
	};
	if (method === "POST") {
		if (suffix === "/script") {
			const body = await readJson(req, MAX_SCRIPT_BODY_BYTES);
			if (body === void 0) return fail$1(res, 400, "请求体不是合法 JSON", "bad-json");
			const record = asRecord(body);
			const yamlRaw = record["yaml"];
			const docRaw = record["doc"];
			let saved;
			if (typeof yamlRaw === "string" && yamlRaw.trim() !== "") saved = await saveUiScriptForPanel(deps, workspaceRoot, yamlRaw, "agent");
			else if (docRaw !== void 0) saved = saveUiScriptDocForPanel(workspaceRoot, docRaw, "canvas");
			else return fail$1(res, 400, "缺 yaml 或 doc 字段", "bad-body");
			if (!saved.ok) return fail$1(res, 400, `脚本未通过校验：${saved.issues.map((item) => `${item.target}：${item.reason}`).join("；")}`, "invalid-ui-script");
			return ok$1(res, {
				site: saved.doc.meta.site,
				flow: saved.doc.meta.flow,
				version: saved.version,
				path: saved.path
			});
		}
		if (suffix === "/record/pick") {
			const record = asRecord(await readJson(req, MAX_SMALL_BODY_BYTES));
			const sessionId = stringField(record, "sessionId");
			if (sessionId === void 0) return fail$1(res, 400, "缺 sessionId", "bad-body");
			const timeout = typeof record["timeoutMs"] === "number" && record["timeoutMs"] > 0 ? Math.min(record["timeoutMs"], 6e5) : void 0;
			return ok$1(res, await pickSelectorForTool(deps, {
				sessionId,
				...timeout === void 0 ? {} : { timeoutMs: timeout }
			}));
		}
		if (suffix === "/record/open") {
			const record = asRecord(await readJson(req, MAX_SMALL_BODY_BYTES));
			const startUrl = typeof record["startUrl"] === "string" ? record["startUrl"] : "";
			if (startUrl === "") return fail$1(res, 400, "缺 startUrl", "bad-body");
			const sessionOwner = url.searchParams.get("session")?.trim();
			const opened = await openRecordingForTool(deps, {
				startUrl,
				...typeof record["headless"] === "boolean" ? { headless: record["headless"] } : {},
				...sessionOwner === void 0 || sessionOwner === "" ? {} : { ownerSessionId: sessionOwner }
			});
			return opened.ok ? ok$1(res, opened) : fail$1(res, 400, opened.error ?? "打开录制会话失败", "record-open-failed");
		}
		if (suffix === "/record/start") {
			const sessionId = stringField(asRecord(await readJson(req, MAX_SMALL_BODY_BYTES)), "sessionId");
			if (sessionId === void 0) return fail$1(res, 400, "缺 sessionId", "bad-body");
			const started = await startRecordingForTool(deps, { sessionId });
			return started.ok ? ok$1(res, started) : fail$1(res, 400, started.error ?? "开始录制失败", "record-start-failed");
		}
		if (suffix === "/record/stop") {
			const record = asRecord(await readJson(req, MAX_SMALL_BODY_BYTES));
			const sessionId = stringField(record, "sessionId");
			if (sessionId === void 0) return fail$1(res, 400, "缺 sessionId", "bad-body");
			const stopped = await stopRecordingForTool(deps, void 0, {
				sessionId,
				...stringField(record, "site") === void 0 ? {} : { site: stringField(record, "site") },
				...stringField(record, "flow") === void 0 ? {} : { flow: stringField(record, "flow") },
				...stringField(record, "domain") === void 0 ? {} : { domain: stringField(record, "domain") },
				...stringField(record, "note") === void 0 ? {} : { note: stringField(record, "note") },
				...typeof record["save"] === "boolean" ? { save: record["save"] } : {}
			});
			return stopped.ok ? ok$1(res, stopped) : fail$1(res, 400, stopped.error ?? "停止录制失败", "record-stop-failed");
		}
		if (suffix === "/record/close") {
			const sessionId = stringField(asRecord(await readJson(req, MAX_SMALL_BODY_BYTES)), "sessionId");
			if (sessionId === void 0) return fail$1(res, 400, "缺 sessionId", "bad-body");
			const closed = await closeRecordingForTool(deps, { sessionId });
			return closed.ok ? ok$1(res, closed) : fail$1(res, 400, closed.error ?? "关闭失败", "record-close-failed");
		}
		if (suffix === "/agent-review") {
			const record = asRecord(await readJson(req, MAX_SMALL_BODY_BYTES));
			const site = stringField(record, "site");
			const flow = stringField(record, "flow");
			if (site === void 0 || flow === void 0) return fail$1(res, 400, "缺 site / flow", "bad-body");
			const versionRaw = record["version"];
			const result = await confirmAgentReviewForTool(workspaceRoot, {
				site,
				flow,
				...typeof versionRaw === "number" ? { version: versionRaw } : {},
				...stringField(record, "note") === void 0 ? {} : { note: stringField(record, "note") }
			});
			return result.ok ? ok$1(res, result) : fail$1(res, 404, result.error ?? "审查确认失败", "review-failed");
		}
		if (suffix === "/batch/run") {
			const record = asRecord(await readJson(req, MAX_SMALL_BODY_BYTES));
			const inputsRaw = record["inputs"];
			const inputs = {};
			if (typeof inputsRaw === "object" && inputsRaw !== null && !Array.isArray(inputsRaw)) {
				for (const [key, value] of Object.entries(inputsRaw)) if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") inputs[key] = String(value);
			}
			const flowsRaw = record["flows"];
			const flows = Array.isArray(flowsRaw) ? flowsRaw.filter((item) => typeof item === "string") : void 0;
			return ok$1(res, await batchRunForTool(deps, void 0, {
				...stringField(record, "site") === void 0 ? {} : { site: stringField(record, "site") },
				...flows === void 0 ? {} : { flows },
				inputs,
				...typeof record["limit"] === "number" ? { limit: record["limit"] } : {},
				confirm: record["confirm"] === true,
				...record["dryRun"] === true ? { dryRun: true } : {}
			}));
		}
		if (suffix === "/run") {
			const record = asRecord(await readJson(req, MAX_SMALL_BODY_BYTES));
			const site = stringField(record, "site");
			const flow = stringField(record, "flow");
			if (site === void 0 || flow === void 0) return fail$1(res, 400, "缺 site / flow", "bad-body");
			const inputsRaw = record["inputs"];
			const inputs = {};
			if (typeof inputsRaw === "object" && inputsRaw !== null && !Array.isArray(inputsRaw)) {
				for (const [key, value] of Object.entries(inputsRaw)) if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") inputs[key] = String(value);
			}
			const sessionOwner = url.searchParams.get("session")?.trim();
			return ok$1(res, await runUiScriptForTool(deps, void 0, {
				site,
				flow,
				...typeof record["version"] === "number" ? { version: record["version"] } : {},
				inputs,
				confirm: record["confirm"] === true,
				...record["dryRun"] === true ? { dryRun: true } : {},
				...typeof record["headless"] === "boolean" ? { headless: record["headless"] } : {},
				...typeof record["slowMoMs"] === "number" ? { slowMoMs: record["slowMoMs"] } : {},
				...typeof record["highlightClicks"] === "boolean" ? { highlightClicks: record["highlightClicks"] } : {},
				...typeof record["holdMs"] === "number" ? { holdMs: record["holdMs"] } : {},
				...sessionOwner === void 0 || sessionOwner === "" ? {} : { ownerSessionId: sessionOwner }
			}));
		}
		return fail$1(res, 405, `UI 测试面板不支持 ${method} ${suffix}`, "method-not-allowed");
	}
	if (method !== "GET") return fail$1(res, 405, `UI 测试面板只支持 GET 与 POST，收到 ${method}`, "method-not-allowed");
	if (suffix === "/overview") {
		const scripts = listUiScripts(workspaceRoot);
		return ok$1(res, {
			generatedAt: Date.now(),
			scripts: scripts.map((script) => ({
				...script,
				versions: uiVersionInfosForPanel(workspaceRoot, script.site, script.flow)
			})),
			runs: listUiRuns(deps.dataRoot, 10),
			sessions: recordingSessionsOf(deps),
			agentSessions: agentSessionsOf(deps),
			uiTestsRootHint: `${workspaceRoot}/.dsh/dataforge/ui-tests`,
			browser: (() => {
				const selection = deps.resolveEngine();
				return {
					engine: selection.engine.kind,
					label: selection.engine.label,
					available: selection.engine.available(),
					...selection.degraded === void 0 ? {} : { degraded: selection.degraded },
					installCommand: "dsh plugin --profile desktop add dsh-builtin-browser@0.4.13"
				};
			})()
		});
	}
	if (suffix === "/record/sessions") return ok$1(res, { sessions: recordingSessionsOf(deps) });
	if (suffix === "/runs") return ok$1(res, { runs: listUiRuns(deps.dataRoot, clampLimit(url.searchParams.get("limit"), 20, 200)) });
	if (suffix === "/batch/runs") return ok$1(res, { batches: listUiBatches(deps.dataRoot, clampLimit(url.searchParams.get("limit"), 20, 100)) });
	if (suffix.startsWith("/batch/")) {
		const [idRaw, extra] = suffix.slice(7).split("/");
		const batchId = decodeURIComponent(idRaw ?? "");
		if (batchId === "") return fail$1(res, 404, "缺 batchId", "unknown-path");
		if (extra === "report") {
			const format = url.searchParams.get("format") === "json" ? "json" : "md";
			const path = batchReportPath(deps.dataRoot, batchId, format);
			if (path === void 0) return fail$1(res, 404, "报告不存在", "not-found");
			return serveReport(res, path, format);
		}
		if (extra !== void 0) return fail$1(res, 404, `不认识的路径：${suffix}`, "unknown-path");
		const batch = readUiBatch(deps.dataRoot, batchId);
		if (batch === void 0) return fail$1(res, 404, `UI 批次 ${batchId} 不存在`, "not-found");
		return ok$1(res, { batch });
	}
	if (suffix.startsWith("/runs/")) {
		const [runIdRaw, extra] = suffix.slice(6).split("/");
		const runId = decodeURIComponent(runIdRaw ?? "");
		if (runId === "") return fail$1(res, 404, "缺 runId", "unknown-path");
		if (extra === "evidence") {
			const name = url.searchParams.get("name") ?? "";
			const path = evidencePathOf(deps.dataRoot, runId, name);
			if (path === void 0) return fail$1(res, 400, "证据文件名只支持 success.png / failure.png / failure.html", "bad-evidence");
			return serveEvidence(res, path, name);
		}
		if (extra !== void 0) return fail$1(res, 404, `不认识的路径：${suffix}`, "unknown-path");
		const run = readUiRunRecord(deps.dataRoot, runId);
		if (run === void 0) return fail$1(res, 404, `UI 运行 ${runId} 不存在`, "not-found");
		return ok$1(res, {
			run,
			events: readUiRunEvents(deps.dataRoot, runId)
		});
	}
	if (suffix === "/script") {
		const site = url.searchParams.get("site") ?? "";
		const flow = url.searchParams.get("flow") ?? "";
		if (site === "" || flow === "") return fail$1(res, 400, "缺 site / flow", "bad-query");
		const versionRaw = url.searchParams.get("version");
		const version = versionRaw === null ? void 0 : Number(versionRaw);
		const loaded = loadUiScriptForPanel(workspaceRoot, site, flow, Number.isFinite(version) ? version : void 0);
		if (!loaded.ok) return fail$1(res, 404, loaded.message, loaded.code, {
			availableVersions: loaded.availableVersions,
			...loaded.issues === void 0 ? {} : { issues: loaded.issues }
		});
		return ok$1(res, {
			site,
			flow,
			version: loaded.version,
			availableVersions: loaded.availableVersions,
			yaml: loaded.yaml,
			doc: loaded.doc
		});
	}
	return fail$1(res, 404, `不认识的路径：${suffix}`, "unknown-path");
}
/** 前缀剥离：完整路径与剩余路径两种形态。 */
function stripPrefix$1(pathname) {
	const full = `/dashboard/api/dataforge${UI_TEST_API_PREFIX}`;
	if (pathname.startsWith(full)) return pathname.slice(full.length) || "/";
	if (pathname.startsWith("/ui-tests")) return pathname.slice(9) || "/";
	return pathname;
}
async function resolveRoot(panel, url) {
	const raw = url.searchParams.get("workspace")?.trim();
	if (raw !== void 0 && raw.length > 0 && isAbsolute(raw)) try {
		if (statSync(raw).isDirectory()) return raw;
	} catch {}
	return panel.resolveWorkspaceRoot();
}
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function stringField(record, key) {
	const value = record[key];
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function clampLimit(raw, fallback, max) {
	const value = raw === null ? NaN : Number(raw);
	if (!Number.isFinite(value) || value <= 0) return fallback;
	return Math.min(Math.floor(value), max);
}
function serveEvidence(res, path, name) {
	let data;
	try {
		data = readFileSync(path);
	} catch {
		fail$1(res, 404, "证据文件不存在", "not-found");
		return;
	}
	res.statusCode = 200;
	res.setHeader("content-type", name.endsWith(".png") ? "image/png" : "text/html; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(data);
}
function serveReport(res, path, format) {
	let data;
	try {
		data = readFileSync(path);
	} catch {
		fail$1(res, 404, "报告不存在", "not-found");
		return;
	}
	res.statusCode = 200;
	res.setHeader("content-type", format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(data);
}
function send(res, status, body) {
	const text = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(text);
}
function ok$1(res, data) {
	send(res, 200, {
		success: true,
		data
	});
}
function fail$1(res, status, error, code, extra) {
	send(res, status, {
		success: false,
		error,
		...code === void 0 ? {} : { code },
		...extra ?? {}
	});
}
var BodyTooLargeError = class extends Error {};
function readJson(req, limit) {
	return readBody(req, limit).then((text) => {
		try {
			return JSON.parse(text === "" ? "{}" : text);
		} catch {
			return;
		}
	}).catch(() => void 0);
}
function readBody(req, limit) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new BodyTooLargeError(`请求体超过 ${limit} 字节`));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

//#endregion
//#region src/datasets/panel-routes.ts
const ARTIFACTS_API_PREFIX = "/artifacts";
function sendJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}
function ok(res, data) {
	sendJson(res, 200, {
		success: true,
		data
	});
}
function fail(res, status, error, code) {
	sendJson(res, status, {
		success: false,
		error,
		...code === void 0 ? {} : { code }
	});
}
function stripPrefix(pathname) {
	const full = `/dashboard/api/dataforge${ARTIFACTS_API_PREFIX}`;
	if (pathname.startsWith(full)) return pathname.slice(full.length) || "/";
	if (pathname.startsWith("/artifacts")) return pathname.slice(10) || "/";
}
function readDataset(dataRoot, runId) {
	const path = join(dataRoot, "datasets", `${runId}.json`);
	if (!existsSync(path)) return void 0;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
function kindOf(dataset) {
	const kind = dataset?.["kind"];
	if (kind === "ui-run-dataset") return "ui";
	if (kind === "run-dataset") return "chain";
	return "unknown";
}
function listArtifacts(dataRoot) {
	const runIds = /* @__PURE__ */ new Set();
	const datasetDir = join(dataRoot, "datasets");
	if (existsSync(datasetDir)) {
		for (const name of readdirSync(datasetDir)) if (name.endsWith(".json")) runIds.add(name.slice(0, -5));
	}
	const evidenceDir = join(dataRoot, "evidence");
	if (existsSync(evidenceDir)) for (const name of readdirSync(evidenceDir)) try {
		if (statSync(join(evidenceDir, name)).isDirectory()) runIds.add(name);
	} catch {}
	const rows = [];
	for (const runId of runIds) {
		if (!/^[A-Za-z0-9._-]+$/.test(runId)) continue;
		const dataset = readDataset(dataRoot, runId);
		let datasetSize;
		try {
			datasetSize = statSync(join(datasetDir, `${runId}.json`)).size;
		} catch {
			datasetSize = void 0;
		}
		const reportPath = join(evidenceDir, runId, "report.html");
		rows.push({
			runId,
			kind: kindOf(dataset),
			...typeof dataset?.["status"] === "string" ? { status: dataset["status"] } : {},
			...typeof dataset?.["site"] === "string" ? { site: dataset["site"] } : {},
			...typeof dataset?.["flow"] === "string" ? { flow: dataset["flow"] } : {},
			...typeof dataset?.["createdAt"] === "string" ? { createdAt: dataset["createdAt"] } : {},
			hasDataset: dataset !== void 0,
			hasReport: existsSync(reportPath),
			...datasetSize === void 0 ? {} : { datasetSize }
		});
	}
	return rows.sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}
function sendFile(res, path, contentType) {
	if (!existsSync(path)) {
		fail(res, 404, "产物不存在", "not-found");
		return;
	}
	res.writeHead(200, {
		"content-type": contentType,
		"cache-control": "no-store"
	});
	res.end(readFileSync(path));
}
/**
* 构造 artifacts handler；返回 true = 已接管，false = 不是 /artifacts 路径。
*/
function createArtifactsPanelHandler(deps) {
	return (req, res) => {
		const url = new URL(req.url ?? "/", "http://panel.localhost");
		const suffix = stripPrefix(url.pathname);
		if (suffix === void 0) return false;
		if ((req.method ?? "GET").toUpperCase() !== "GET") {
			fail(res, 405, "运行产物只读：只支持 GET", "method-not-allowed");
			return true;
		}
		if (suffix === "/" || suffix === "") {
			const all = listArtifacts(deps.dataRoot);
			const kind = url.searchParams.get("kind");
			const status = url.searchParams.get("status");
			const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
			const filtered = all.filter((row) => {
				if (kind !== null && kind !== "" && row.kind !== kind) return false;
				if (status !== null && status !== "" && row.status !== status) return false;
				if (q !== "" && !`${row.runId} ${row.site ?? ""} ${row.flow ?? ""}`.toLowerCase().includes(q)) return false;
				return true;
			});
			const limitRaw = Number(url.searchParams.get("limit") ?? "50");
			const offsetRaw = Number(url.searchParams.get("offset") ?? "0");
			const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50;
			const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;
			ok(res, {
				artifacts: filtered.slice(offset, offset + limit),
				total: filtered.length,
				limit,
				offset
			});
			return true;
		}
		const match = /^\/([A-Za-z0-9._-]+)\/(report|dataset|asset|success\.png|failure\.png|failure\.html)$/.exec(suffix);
		if (match === null) {
			fail(res, 404, `不认识的产物路径：${suffix}`, "unknown-path");
			return true;
		}
		const runId = match[1];
		const kind = match[2];
		if (kind === "success.png" || kind === "failure.png" || kind === "failure.html") {
			sendFile(res, join(deps.dataRoot, "evidence", runId, kind), kind.endsWith(".html") ? "text/html; charset=utf-8" : "image/png");
			return true;
		}
		if (kind === "report") {
			sendFile(res, join(deps.dataRoot, "evidence", runId, "report.html"), "text/html; charset=utf-8");
			return true;
		}
		if (kind === "dataset") {
			sendFile(res, join(deps.dataRoot, "datasets", `${runId}.json`), "application/json; charset=utf-8");
			return true;
		}
		const name = url.searchParams.get("name") ?? "";
		if (name !== "success.png" && name !== "failure.png" && name !== "failure.html") {
			fail(res, 400, "证据文件名只支持 success.png / failure.png / failure.html", "bad-evidence");
			return true;
		}
		sendFile(res, join(deps.dataRoot, "evidence", runId, name), name.endsWith(".html") ? "text/html; charset=utf-8" : "image/png");
		return true;
	};
}

//#endregion
//#region src/uitest/selector-script.ts
/**
* 页面内选择器候选生成器（录制器与点选器共用）。
*
* 为什么单独成字符串常量：
*   - 录制器要它把用户操作的元素变成候选链；
*   - 面板「从页面点选元素加断言」也要它（否则一套选择器逻辑会分裂成两份，必然漂移）。
* 页面脚本里挂 `window.__dfUiSelectorCandidates(el)`，幂等（已存在就跳过），
* 多个模块重复注入不会重复定义。
*
* 候选顺序就是回放优先级：testid → id → name → aria-label → 文本 → CSS 路径。
* 只生成「当前页面唯一命中」的候选；Playwright 专属选择器（`:has-text` / `text=`）
* 在页面内 `querySelectorAll` 校验不了，由 stopping/回放阶段的 Playwright 引擎二次校验。
*
* @module dsh-dataforge/uitest/selector-script
*/
const SELECTOR_HELPER_SCRIPT = `(() => {
  var VERSION = 2
  if (typeof window.__dfUiSelectorCandidates === 'function' && window.__dfUiSelectorVersion === VERSION) return
  window.__dfUiSelectorVersion = VERSION

  function esc(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value)
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&')
  }
  function textOf(el) {
    return ((el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 40)
  }
  function unique(selector) {
    try { return document.querySelectorAll(selector).length === 1 } catch (err) { return false }
  }
  function cssPath(el) {
    var parts = []
    var cur = el
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id && unique('#' + esc(cur.id))) { parts.unshift('#' + esc(cur.id)); break }
      var part = cur.tagName.toLowerCase()
      var parent = cur.parentElement
      if (parent) {
        var same = []
        for (var i = 0; i < parent.children.length; i += 1) {
          if (parent.children[i].tagName === cur.tagName) same.push(parent.children[i])
        }
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')'
      }
      parts.unshift(part)
      if (parts.length >= 8) break
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }
  function addCandidate(out, selector) {
    // Playwright 专属选择器（text= / :has-text）页面里校验不了唯一性，先收进来，
    // 由回放阶段校验；纯 CSS 仍要求当前页唯一，避免录进歧义选择器。
    var playwrightOnly = /^text=|:has-text\\(/.test(selector)
    if (selector && out.indexOf(selector) < 0 && (playwrightOnly || unique(selector))) out.push(selector)
  }
  function quote(value) {
    return String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"')
  }
  function candidatesFor(el) {
    var out = []
    if (!el || el.nodeType !== 1) return out
    var attrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa']
    for (var i = 0; i < attrs.length; i += 1) {
      var testId = el.getAttribute(attrs[i])
      if (testId) addCandidate(out, '[' + attrs[i] + '="' + quote(testId) + '"]')
    }
    if (el.id) addCandidate(out, '#' + esc(el.id))
    if (el.name && /^(INPUT|SELECT|TEXTAREA|FORM)$/.test(el.tagName)) {
      addCandidate(out, el.tagName.toLowerCase() + '[name="' + quote(el.name) + '"]')
    }
    var aria = el.getAttribute('aria-label')
    if (aria) addCandidate(out, el.tagName.toLowerCase() + '[aria-label="' + quote(aria) + '"]')
    var placeholder = el.getAttribute('placeholder')
    if (placeholder) addCandidate(out, el.tagName.toLowerCase() + '[placeholder="' + quote(placeholder) + '"]')
    var title = el.getAttribute('title')
    if (title) addCandidate(out, el.tagName.toLowerCase() + '[title="' + quote(title) + '"]')
    var alt = el.getAttribute('alt')
    if (alt && el.tagName === 'IMG') addCandidate(out, 'img[alt="' + quote(alt) + '"]')
    var href = el.getAttribute('href')
    if (href && el.tagName === 'A') addCandidate(out, 'a[href="' + quote(href) + '"]')
    var role = el.getAttribute('role')
    if (role) addCandidate(out, '[role="' + quote(role) + '"]')
    var text = textOf(el)
    if (text !== '' && (/^(BUTTON|A|LABEL)$/.test(el.tagName) || role)) {
      if (role) addCandidate(out, '[role="' + quote(role) + '"]:has-text("' + quote(text) + '")')
      addCandidate(out, el.tagName.toLowerCase() + ':has-text("' + quote(text) + '")')
      addCandidate(out, 'text="' + quote(text) + '"')
    }
    var path = cssPath(el)
    if (path) addCandidate(out, path)
    return out.slice(0, 8)
  }
  window.__dfUiSelectorCandidates = candidatesFor
})()`;
/**
* 点选器：让用户在可见会话里点一个元素，页面返回该元素的候选选择器。
*
* 是一个 Promise 表达式（Playwright `evaluate` 会 await 返回的 Promise）：
*   - 捕获阶段吞掉 click/mousemove/keydown，避免误触页面业务（导航/提交）；
*   - Esc 取消并 resolve `{ ok: false, cancelled: true }`；
*   - 清理函数挂在 window 上，Node 侧超时可主动 cancel（避免 evaluate 永远挂着）。
*/
const PICKER_SCRIPT = `new Promise((resolve) => {
  if (typeof window.__dfUiSelectorCandidates !== 'function') {
    resolve({ ok: false, error: 'selector helper 未注入（请先打开/刷新会话页面）' })
    return
  }
  if (typeof window.__dfUiPickerCancel === 'function') {
    try { window.__dfUiPickerCancel() } catch (err) {}
  }
  var highlighted = null
  var previousOutline = ''
  var previousOffset = ''

  function highlight(el) {
    if (highlighted === el) return
    restoreHighlight()
    if (!el || el.nodeType !== 1) return
    highlighted = el
    previousOutline = el.style.outline
    previousOffset = el.style.outlineOffset
    el.style.outline = '2px solid #2563eb'
    el.style.outlineOffset = '2px'
  }
  function restoreHighlight() {
    if (!highlighted) return
    highlighted.style.outline = previousOutline
    highlighted.style.outlineOffset = previousOffset
    highlighted = null
  }
  function cleanup() {
    restoreHighlight()
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('keydown', onKey, true)
    window.__dfUiPickerCancel = null
  }
  function resolveWith(payload) {
    cleanup()
    resolve(payload)
  }
  function onMove(event) {
    event.preventDefault()
    event.stopPropagation()
    var el = event.target
    if (typeof el.closest === 'function') {
      el = el.closest('a,button,input,textarea,select,label,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"]') || el
    }
    highlight(el)
  }
  function onClick(event) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    var el = event.target
    if (typeof el.closest === 'function') {
      el = el.closest('a,button,input,textarea,select,label,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"]') || el
    }
    var candidates = []
    try { candidates = window.__dfUiSelectorCandidates(el) || [] } catch (err) {}
    resolveWith({
      ok: true,
      pageUrl: location.href,
      candidates: candidates,
      selector: candidates.length > 0 ? candidates[0] : '',
      element: {
        tag: el.tagName,
        id: el.id || '',
        text: ((el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 60)
      }
    })
  }
  function onKey(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    resolveWith({ ok: false, cancelled: true })
  }

  window.__dfUiPickerCancel = function () {
    resolveWith({ ok: false, cancelled: true })
  }
  window.addEventListener('click', onClick, true)
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('keydown', onKey, true)
})`;

//#endregion
//#region src/uitest/recorder-core.ts
var RecorderCore = class {
	raw = [];
	seenAt = [];
	skippedSecrets = 0;
	skippedUploads = 0;
	lastSecretAt = 0;
	singleCandidateSteps = 0;
	now;
	constructor(options = {}) {
		this.now = options.now ?? Date.now;
	}
	/** 原始载荷 → 步骤（去重在这里做，页面脚本保持无状态）。 */
	ingest(payload) {
		if (typeof payload !== "object" || payload === null) return;
		const record = payload;
		const kind = typeof record.kind === "string" ? record.kind : "";
		if (kind === "skip-secret") {
			const now = this.now();
			if (now - this.lastSecretAt > 2e3) this.skippedSecrets += 1;
			this.lastSecretAt = now;
			return;
		}
		const candidates = normalizeCandidateList(record.candidates);
		const at = typeof record.at === "string" && record.at.length > 0 ? record.at.slice(0, 2e3) : void 0;
		const now = this.now();
		if (kind === "fill") {
			const value = typeof record.value === "string" ? record.value : "";
			if (candidates.length === 0) return;
			const last = this.raw[this.raw.length - 1];
			if (last !== void 0 && last.kind === "fill" && sameCandidates(normalizeCandidateList(last.candidates), candidates)) {
				last.value = value;
				last.at = at;
				this.seenAt[this.seenAt.length - 1] = now;
				return;
			}
			const fillFeatures = featuresFor(record);
			this.push({
				kind: "fill",
				candidates,
				value,
				...fillFeatures === void 0 ? {} : { features: fillFeatures },
				...at === void 0 ? {} : { at }
			}, now);
			return;
		}
		if (kind === "click") {
			if (candidates.length === 0) return;
			const clickPoint = normalizeClickPoint(record.clickPoint);
			const features = normalizeFeatures(record.features);
			const last = this.raw[this.raw.length - 1];
			if (last !== void 0 && last.kind === "click" && sameCandidates(normalizeCandidateList(last.candidates), candidates) && now - (this.seenAt[this.seenAt.length - 1] ?? 0) < 500) return;
			this.push({
				kind: "click",
				candidates,
				isSubmitter: record.isSubmitter === true,
				...clickPoint === void 0 ? {} : { clickPoint },
				...features === void 0 ? {} : { features },
				...at === void 0 ? {} : { at }
			}, now);
			return;
		}
		if (kind === "select") {
			const value = typeof record.value === "string" ? record.value : "";
			if (candidates.length === 0) return;
			const selectFeatures = featuresFor(record);
			this.push({
				kind: "select",
				candidates,
				value,
				...selectFeatures === void 0 ? {} : { features: selectFeatures },
				...at === void 0 ? {} : { at }
			}, now);
			return;
		}
		if (kind === "submit") {
			const last = this.raw[this.raw.length - 1];
			const lastAt = this.seenAt[this.seenAt.length - 1] ?? 0;
			if (last !== void 0 && last.kind === "click" && last.isSubmitter === true && now - lastAt < 1500) return;
			const submitter = normalizeCandidateList(record.submitter);
			this.push({
				kind: "submit",
				candidates: candidates.length > 0 ? candidates : submitter,
				...at === void 0 ? {} : { at }
			}, now);
			return;
		}
		if (kind === "press") {
			const key = typeof record.key === "string" ? record.key : "";
			if (key === "") return;
			const last = this.raw[this.raw.length - 1];
			if (last !== void 0 && last.kind === "press" && last.key === key && now - (this.seenAt[this.seenAt.length - 1] ?? 0) < 500) return;
			this.push({
				kind: "press",
				key,
				candidates,
				...at === void 0 ? {} : { at }
			}, now);
		}
	}
	push(payload, now) {
		this.raw.push(payload);
		this.seenAt.push(now);
	}
	/** 文件选择只计数（浏览器不暴露本地路径）。 */
	recordUploadSkip() {
		this.skippedUploads += 1;
	}
	/** 已收到的原始事件数（诊断用）。 */
	get eventCount() {
		return this.raw.length;
	}
	/** 原始事件 → 步骤（候选校验由调用方注入，核心不依赖浏览器实现）。 */
	async finalize(validate) {
		const steps = [];
		let singleCandidate = 0;
		for (const raw of this.raw) {
			const kind = raw.kind;
			if (kind !== "click" && kind !== "fill" && kind !== "select" && kind !== "submit" && kind !== "press") continue;
			const checked = await validate(normalizeCandidateList(raw.candidates));
			if (checked.length === 1) singleCandidate += 1;
			const step = {
				id: `s${steps.length + 1}`,
				kind,
				...checked.length > 0 ? { selector: checked[0] } : {},
				...checked.length > 0 ? { candidates: checked } : {}
			};
			if (kind === "fill" || kind === "select") step.value = typeof raw.value === "string" ? raw.value : "";
			if (kind === "press") step.key = typeof raw.key === "string" ? raw.key : "";
			if (typeof raw.at === "string" && raw.at.length > 0) step.at = raw.at;
			steps.push(step);
		}
		this.singleCandidateSteps = singleCandidate;
		return steps;
	}
	/** 生成录制回执（文案与 Playwright 路径共用）。 */
	result(steps, meta) {
		const notices = [];
		if (this.skippedSecrets > 0) notices.push(`跳过 ${this.skippedSecrets} 次密码输入（凭证不入脚本，回放请带 cookie）`);
		if (this.skippedUploads > 0) notices.push(`跳过 ${this.skippedUploads} 次文件选择（浏览器不暴露本地路径，upload 步骤请手写）`);
		if (this.raw.length > 0 && steps.length === 0) notices.push("没有录到可回放的步骤（可能只做了聚焦/滚动）");
		return {
			startUrl: meta.startUrl,
			viewport: meta.viewport,
			steps,
			skippedSecrets: this.skippedSecrets,
			skippedUploads: this.skippedUploads,
			singleCandidateSteps: this.singleCandidateSteps,
			totalSteps: steps.length,
			...notices.length === 0 ? {} : { notice: notices.join("；") }
		};
	}
};
function featuresFor(record) {
	return normalizeFeatures(record.features);
}
/** 收口点击坐标：数字/范围不合法就丢弃（旧客户端没有该字段时不影响录制）。 */
function normalizeClickPoint(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return void 0;
	const value = raw;
	const num = (key) => {
		const item = value[key];
		return typeof item === "number" && Number.isFinite(item) ? item : void 0;
	};
	const fx = num("fx");
	const fy = num("fy");
	const x = num("x");
	const y = num("y");
	const vw = num("vw");
	const vh = num("vh");
	if (fx === void 0 || fy === void 0 || x === void 0 || y === void 0) return void 0;
	if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || vw === void 0 || vh === void 0 || vw <= 0 || vh <= 0) return void 0;
	const tag = typeof value["tag"] === "string" && value["tag"] !== "" ? value["tag"] : void 0;
	const bbox = [
		"bx",
		"by",
		"bw",
		"bh"
	].map((key) => num(key));
	const hasBox = bbox.every((item) => item !== void 0);
	const name = typeof value["name"] === "string" && value["name"].trim() !== "" ? value["name"].trim().slice(0, 120) : void 0;
	return {
		fx,
		fy,
		x,
		y,
		vw,
		vh,
		...tag === void 0 ? {} : { tag },
		...hasBox ? {
			bx: bbox[0],
			by: bbox[1],
			bw: bbox[2],
			bh: bbox[3]
		} : {},
		...name === void 0 ? {} : { name }
	};
}
/** 候选列表清洗：去非字符串/空/重复/超长，最多 8 条。 */
function normalizeCandidateList(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const candidate = item.trim();
		if (candidate.length === 0 || candidate.length > 2e3) continue;
		if (out.includes(candidate)) continue;
		out.push(candidate);
		if (out.length >= 8) break;
	}
	return out;
}
/** 两个候选链是否指向同一元素（以首候选为准——录制器按优先级排序）。 */
function sameCandidates(left, right) {
	if (left.length === 0 || right.length === 0) return false;
	return left[0] === right[0];
}

//#endregion
//#region src/uitest/recorder.ts
/** 页面内记录器：只认 DOM 事件，不碰网络、不碰存储；选择器候选交给共享 helper。 */
const RECORDER_SCRIPT = `(() => {
  var VERSION = ${JSON.stringify(4)}
  var existing = window.__dfUiRecorder
  // 同版本：只重新激活；旧版本：先停掉旧监听器（它们都检查 state.active），再装新脚本。
  if (existing !== undefined && existing.version === VERSION) { existing.active = true; return }
  if (existing !== undefined) { try { existing.active = false } catch (err) {} }
  var state = { active: true, version: VERSION }
  window.__dfUiRecorder = state

  function pageUrl() {
    try { return location.href.slice(0, 2000) } catch (err) { return '' }
  }
  var candidatesFor = window.__dfUiSelectorCandidates || function () { return [] }

  function nameOf(el) {
    var aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim().slice(0, 80)
    var text = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 80)
    var value = el.getAttribute('value')
    if (value && /^(INPUT|BUTTON)$/.test(el.tagName)) return value.trim().slice(0, 80)
    var title = el.getAttribute('title')
    if (title && title.trim()) return title.trim().slice(0, 80)
    var placeholder = el.getAttribute('placeholder')
    if (placeholder && placeholder.trim()) return placeholder.trim().slice(0, 80)
    var alt = el.getAttribute('alt')
    if (alt && alt.trim()) return alt.trim().slice(0, 80)
    var nameAttr = el.getAttribute('name')
    if (nameAttr && nameAttr.trim()) return nameAttr.trim().slice(0, 80)
    return ''
  }

  function featuresFor(el) {
    var f = { tag: String(el.tagName || '').toLowerCase() }
    if (!f.tag) return f
    var attrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa']
    for (var i = 0; i < attrs.length; i += 1) {
      var testId = el.getAttribute(attrs[i])
      if (testId) { f.testId = testId; break }
    }
    if (el.id) f.id = el.id
    if (el.getAttribute('name')) f.name = el.getAttribute('name')
    var aria = el.getAttribute('aria-label')
    if (aria) f.ariaLabel = aria
    var placeholder = el.getAttribute('placeholder')
    if (placeholder) f.placeholder = placeholder
    var role = el.getAttribute('role')
    if (role) f.role = role
    var type = el.getAttribute('type')
    if (type) f.type = type
    var title = el.getAttribute('title')
    if (title) f.title = title
    var alt = el.getAttribute('alt')
    if (alt) f.alt = alt
    if (f.tag === 'a' && el.getAttribute('href')) f.href = el.getAttribute('href')
    if (f.tag === 'canvas') {
      try {
        var canvases = document.querySelectorAll('canvas')
        var index = Array.prototype.indexOf.call(canvases, el)
        if (index >= 0) f.canvasIndex = index
      } catch (err) {}
    }
    if (/^(BUTTON|A|LABEL|SUMMARY)$/.test(el.tagName) || role) {
      var text = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim().slice(0, 80)
      if (text) f.text = text
    }
    try {
      var label = el.labels && el.labels[0]
      if (!label && el.closest) label = el.closest('label')
      if (label) {
        var labelText = ((label.innerText || label.textContent || '') + '').replace(/\s+/g, ' ').trim().slice(0, 80)
        if (labelText) f.label = labelText
      }
    } catch (err) {}
    return f
  }

  function interactive(el) {
    if (!el || el.nodeType !== 1) return null
    return el.closest('a,button,input,textarea,select,label,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"]') || el
  }
  function isTextInput(el) {
    if (!el || el.tagName !== 'INPUT') return false
    var type = (el.type || 'text').toLowerCase()
    return ['text', 'search', 'email', 'password', 'tel', 'url', 'number', 'date',
      'datetime-local', 'month', 'week', 'time', 'color', 'range'].indexOf(type) >= 0
  }
  function isPassword(el) {
    return !!el && el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'password'
  }
  function isSubmitControl(el) {
    if (!el || el.nodeType !== 1) return false
    if (el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'submit') return true
    if (el.tagName === 'BUTTON') {
      var type = (el.getAttribute('type') || 'submit').toLowerCase()
      return type === 'submit' && el.closest('form') !== null
    }
    return false
  }
  function send(payload) {
    try {
      if (window.__dfUiRecordStep) { window.__dfUiRecordStep(payload); return }
      // seam 载体（共享浏览器）：没有 binding，事件进页面队列，由宿主轮询 drain。
      if (!window.__dfUiSeamQueue) window.__dfUiSeamQueue = []
      window.__dfUiSeamQueue.push(payload)
      if (window.__dfUiSeamQueue.length > 500) window.__dfUiSeamQueue.splice(0, window.__dfUiSeamQueue.length - 500)
    } catch (err) {}
  }

  document.addEventListener('click', function (event) {
    if (!state.active) return
    var el = interactive(event.target)
    if (!el) return
    if (isPassword(el)) { send({ kind: 'skip-secret', at: pageUrl() }); return }
    if (isTextInput(el)) return
    // canvas 图表只能按坐标命中：把真实点击位置（元素内比例 + 视口坐标）一并录下来。
    var rect = null
    try { rect = el.getBoundingClientRect() } catch (err) { rect = null }
    var clickPoint = rect && rect.width > 0 && rect.height > 0 ? {
      x: event.clientX,
      y: event.clientY,
      fx: (event.clientX - rect.left) / rect.width,
      fy: (event.clientY - rect.top) / rect.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
      tag: el.tagName,
      bx: rect.left,
      by: rect.top,
      bw: rect.width,
      bh: rect.height,
      ...(nameOf(el) ? { name: nameOf(el) } : {})
    } : undefined
    send({
      kind: 'click',
      tag: el.tagName,
      candidates: candidatesFor(el),
      features: featuresFor(el),
      isSubmitter: isSubmitControl(el),
      ...(clickPoint ? { clickPoint: clickPoint } : {}),
      at: pageUrl()
    })
  }, true)

  document.addEventListener('input', function (event) {
    if (!state.active) return
    var el = event.target
    if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return
    if (isPassword(el)) { send({ kind: 'skip-secret', at: pageUrl() }); return }
    if (el.tagName === 'INPUT' && isTextInput(el) === false) return
    // 不做去抖：去抖会让「输入 → 立刻点击」在事件流里倒序（点击先到、输入后到），
    // 回放时就会先点空表单再填值。连续输入由 Node 侧合并成最后一次值（同元素相邻 fill）。
    send({ kind: 'fill', tag: el.tagName, candidates: candidatesFor(el), features: featuresFor(el), value: el.value, at: pageUrl() })
  }, true)

  document.addEventListener('change', function (event) {
    if (!state.active) return
    var el = event.target
    if (!el || el.tagName !== 'SELECT') return
    send({ kind: 'select', tag: el.tagName, candidates: candidatesFor(el), features: featuresFor(el), value: el.value, at: pageUrl() })
  }, true)

  document.addEventListener('submit', function (event) {
    if (!state.active) return
    var form = event.target
    if (!form || form.tagName !== 'FORM') return
    var submitter = event.submitter
    send({
      kind: 'submit',
      tag: 'FORM',
      candidates: candidatesFor(form),
      features: featuresFor(form),
      submitter: submitter ? candidatesFor(submitter) : [],
      at: pageUrl()
    })
  }, true)

  document.addEventListener('keydown', function (event) {
    if (!state.active) return
    var target = event.target
    var key = event.key
    if (key !== 'Escape' && key !== 'Tab' && key !== 'Enter') return
    if (key === 'Enter') {
      if (target && (isTextInput(target) || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      if (isSubmitControl(target)) return
    }
    send({ kind: 'press', key: key, candidates: target ? candidatesFor(target) : [], ...(target ? { features: featuresFor(target) } : {}), at: pageUrl() })
  }, true)
})()`;
/** 录制器实例：一个页面同时只允许一个。 */
var UiRecorder = class UiRecorder {
	page;
	context;
	startUrl;
	viewport;
	core = new RecorderCore();
	stopped = false;
	constructor(page, context, startUrl, viewport) {
		this.page = page;
		this.context = context;
		this.startUrl = startUrl;
		this.viewport = viewport;
	}
	/** 开始录制：注入页面脚本 + 绑定事件回传 + 监听文件选择（只计数，不录路径）。 */
	static async start(page, context) {
		const state = PAGE_STATE.get(page);
		if (state?.current !== void 0) return state.current;
		const ctx = context ?? page.context();
		let viewport = {
			width: 1280,
			height: 720
		};
		try {
			const size = page.viewportSize();
			if (size !== null && size.width > 0 && size.height > 0) viewport = {
				width: size.width,
				height: size.height
			};
		} catch {}
		const recorder = new UiRecorder(page, ctx, safePageUrl(page), viewport);
		await recorder.install();
		const installedState = PAGE_STATE.get(page);
		if (installedState !== void 0) installedState.current = recorder;
		return recorder;
	}
	async install() {
		let state = PAGE_STATE.get(this.page);
		if (state === void 0) {
			state = { installed: false };
			PAGE_STATE.set(this.page, state);
		}
		if (!state.installed) {
			state.installed = true;
			await this.page.exposeBinding("__dfUiRecordStep", (_source, payload) => {
				PAGE_STATE.get(this.page)?.current?.ingest(payload);
			});
		}
		await this.page.evaluate(SELECTOR_HELPER_SCRIPT).catch(() => void 0);
		await this.page.evaluate(RECORDER_SCRIPT).catch(() => void 0);
		await this.context.addInitScript(SELECTOR_HELPER_SCRIPT).catch(() => void 0);
		await this.context.addInitScript(RECORDER_SCRIPT).catch(() => void 0);
		this.page.on("filechooser", () => {
			this.core.recordUploadSkip();
		});
	}
	/** 原始载荷 → 核心（去重/脱敏都在 RecorderCore）。 */
	ingest(payload) {
		if (this.stopped) return;
		this.core.ingest(payload);
	}
	/** 停止录制：等一拍 → 停用页面监听 → 候选校验 → 生成步骤。 */
	async stop() {
		if (this.stopped) return this.core.result([], {
			startUrl: this.startUrl,
			viewport: this.viewport
		});
		await sleep$1(50);
		this.stopped = true;
		if (PAGE_STATE.get(this.page)?.current === this) PAGE_STATE.get(this.page).current = void 0;
		await this.page.evaluate(`(() => { if (window.__dfUiRecorder) window.__dfUiRecorder.active = false })()`).catch(() => void 0);
		const steps = await this.core.finalize((candidates) => this.checkCandidates(candidates));
		return this.core.result(steps, {
			startUrl: this.startUrl,
			viewport: this.viewport
		});
	}
	/** 取消录制：不生成步骤（用于异常路径）。 */
	async cancel() {
		if (this.stopped) return;
		this.stopped = true;
		if (PAGE_STATE.get(this.page)?.current === this) PAGE_STATE.get(this.page).current = void 0;
		await this.page.evaluate(`(() => { if (window.__dfUiRecorder) window.__dfUiRecorder.active = false })()`).catch(() => void 0);
	}
	/** 候选唯一性校验：只留当前页面唯一命中的候选；页面已销毁/选择器非法就保留原样。 */
	async checkCandidates(candidates) {
		if (candidates.length === 0) return [];
		const kept = [];
		for (const candidate of candidates) try {
			if (await this.page.locator(candidate).count() === 1) kept.push(candidate);
		} catch {
			return candidates;
		}
		return kept.length > 0 ? kept : candidates;
	}
};
/** 页面 → 录制器状态（同一页面重复 start 返回同一个实例；binding 只注册一次）。 */
const PAGE_STATE = /* @__PURE__ */ new WeakMap();
function sleep$1(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function safePageUrl(page) {
	try {
		return page.url();
	} catch {
		return "";
	}
}
/** 页面脚本原文（测试编译校验用；业务不要直接 eval）。 */
const RECORDER_SOURCE = RECORDER_SCRIPT;

//#endregion
//#region src/uitest/picker.ts
/** 缺省点选等待（用户手动点，给足时间）。 */
const PICKER_TIMEOUT_MS = 12e4;
/**
* 在页面上等待用户点选一个元素，返回候选选择器。
*
* - 页面里按 Esc / 超时 → `{ ok:false, cancelled/error }`；
* - 页面脚本缺失（页面未打开/重定向到无 helper 的文档）→ 返回 error，不抛；
* - 点选期间页面点击被捕获阶段吞掉（不会触发业务导航/提交）。
*/
async function pickOnPage(page, timeoutMs = PICKER_TIMEOUT_MS) {
	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => {
			page.evaluate(`(() => { if (typeof window.__dfUiPickerCancel === 'function') window.__dfUiPickerCancel() })()`).catch(() => void 0);
			resolve({
				ok: false,
				error: `点选超时（${Math.round(timeoutMs / 1e3)}s）：请在浏览器里点一个元素，或按 Esc 取消`
			});
		}, timeoutMs);
	});
	try {
		return await Promise.race([page.evaluate("new Promise((resolve) => {\n  if (typeof window.__dfUiSelectorCandidates !== 'function') {\n    resolve({ ok: false, error: 'selector helper 未注入（请先打开/刷新会话页面）' })\n    return\n  }\n  if (typeof window.__dfUiPickerCancel === 'function') {\n    try { window.__dfUiPickerCancel() } catch (err) {}\n  }\n  var highlighted = null\n  var previousOutline = ''\n  var previousOffset = ''\n\n  function highlight(el) {\n    if (highlighted === el) return\n    restoreHighlight()\n    if (!el || el.nodeType !== 1) return\n    highlighted = el\n    previousOutline = el.style.outline\n    previousOffset = el.style.outlineOffset\n    el.style.outline = '2px solid #2563eb'\n    el.style.outlineOffset = '2px'\n  }\n  function restoreHighlight() {\n    if (!highlighted) return\n    highlighted.style.outline = previousOutline\n    highlighted.style.outlineOffset = previousOffset\n    highlighted = null\n  }\n  function cleanup() {\n    restoreHighlight()\n    window.removeEventListener('click', onClick, true)\n    window.removeEventListener('mousemove', onMove, true)\n    window.removeEventListener('keydown', onKey, true)\n    window.__dfUiPickerCancel = null\n  }\n  function resolveWith(payload) {\n    cleanup()\n    resolve(payload)\n  }\n  function onMove(event) {\n    event.preventDefault()\n    event.stopPropagation()\n    var el = event.target\n    if (typeof el.closest === 'function') {\n      el = el.closest('a,button,input,textarea,select,label,[role=\"button\"],[role=\"link\"],[role=\"tab\"],[role=\"checkbox\"],[role=\"menuitem\"]') || el\n    }\n    highlight(el)\n  }\n  function onClick(event) {\n    event.preventDefault()\n    event.stopPropagation()\n    event.stopImmediatePropagation()\n    var el = event.target\n    if (typeof el.closest === 'function') {\n      el = el.closest('a,button,input,textarea,select,label,[role=\"button\"],[role=\"link\"],[role=\"tab\"],[role=\"checkbox\"],[role=\"menuitem\"]') || el\n    }\n    var candidates = []\n    try { candidates = window.__dfUiSelectorCandidates(el) || [] } catch (err) {}\n    resolveWith({\n      ok: true,\n      pageUrl: location.href,\n      candidates: candidates,\n      selector: candidates.length > 0 ? candidates[0] : '',\n      element: {\n        tag: el.tagName,\n        id: el.id || '',\n        text: ((el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 60)\n      }\n    })\n  }\n  function onKey(event) {\n    if (event.key !== 'Escape') return\n    event.preventDefault()\n    event.stopPropagation()\n    event.stopImmediatePropagation()\n    resolveWith({ ok: false, cancelled: true })\n  }\n\n  window.__dfUiPickerCancel = function () {\n    resolveWith({ ok: false, cancelled: true })\n  }\n  window.addEventListener('click', onClick, true)\n  window.addEventListener('mousemove', onMove, true)\n  window.addEventListener('keydown', onKey, true)\n})"), timeout]) ?? {
			ok: false,
			error: "点选没有返回值"
		};
	} catch (error) {
		return {
			ok: false,
			error: String(error?.message ?? error).slice(0, 500)
		};
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}

//#endregion
//#region src/uitest/sessions.ts
/** 录制会话 registry：进程内、关闭即释放；不落盘（脚本才是资产）。 */
var UiRecordingSessions = class {
	sessions = /* @__PURE__ */ new Map();
	openBrowser;
	constructor(io = {}) {
		this.openBrowser = io.openBrowser ?? openUiBrowser;
	}
	/** 打开一个可见浏览器窗口（不自动开始录制——先让用户登录，再手动开始录）。 */
	async open(args) {
		const sessionId = `uis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		try {
			const viewport = args.viewport ?? {
				width: 1280,
				height: 720
			};
			const opened = await this.openBrowser({
				headless: args.headless ?? false,
				viewport,
				channel: args.channel
			});
			this.sessions.set(sessionId, {
				...opened,
				startedAt: Date.now()
			});
			await opened.page.evaluate(SELECTOR_HELPER_SCRIPT).catch(() => void 0);
			await opened.context.addInitScript(SELECTOR_HELPER_SCRIPT).catch(() => void 0);
			if (args.cookies !== void 0 && args.cookies.length > 0) await opened.context.addCookies(args.cookies.map(toPlaywrightCookie$1)).catch(() => void 0);
			const timeout = args.navigationTimeoutMs ?? 2e4;
			await opened.page.goto(args.startUrl, {
				waitUntil: "domcontentloaded",
				timeout
			}).catch(() => void 0);
			return {
				ok: true,
				sessionId,
				pageUrl: safeUrl$1(opened.page)
			};
		} catch (error) {
			return {
				ok: false,
				error: messageOf$2(error)
			};
		}
	}
	/** 开始录制（页面脚本注入 + 事件绑定）；重复调用返回已在录。 */
	async start(sessionId) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return {
			ok: false,
			error: `会话 ${sessionId} 不存在（可能已关闭）`
		};
		const already = record.recorder !== void 0;
		try {
			record.recorder = await UiRecorder.start(record.page, record.context);
			return {
				ok: true,
				pageUrl: safeUrl$1(record.page),
				...already ? { alreadyRecording: true } : {}
			};
		} catch (error) {
			return {
				ok: false,
				error: messageOf$2(error)
			};
		}
	}
	/** 停止录制并返回步骤（会话保留，可继续录下一个流程）。 */
	async stop(sessionId) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return {
			ok: false,
			error: `会话 ${sessionId} 不存在（可能已关闭）`
		};
		if (record.recorder === void 0) return {
			ok: false,
			error: `会话 ${sessionId} 没有在录制`
		};
		try {
			const result = await record.recorder.stop();
			record.recorder = void 0;
			return {
				ok: true,
				result
			};
		} catch (error) {
			record.recorder = void 0;
			return {
				ok: false,
				error: messageOf$2(error)
			};
		}
	}
	/**
	* 在会话页面上点选一个元素（录制结束后补断言/改步骤用）。
	*
	* 录制中拒绝：点选也会产生点击，混进录制步骤会污染脚本。
	*/
	async pickSelector(sessionId, timeoutMs) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return {
			ok: false,
			error: `会话 ${sessionId} 不存在（可能已关闭）`
		};
		if (record.recorder !== void 0) return {
			ok: false,
			error: "正在录制：先停止录制再点选元素（点选本身也会产生点击）"
		};
		return {
			...await pickOnPage(record.page, timeoutMs),
			sessionId
		};
	}
	/** 读当前页面的 URL/标题/站点名（自动命名用；读不到就返回空对象，绝不抛）。 */
	async pageMetaOf(sessionId) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return {};
		try {
			const url = safeUrl$1(record.page);
			const title = await record.page.title().catch(() => "");
			const siteName = await record.page.evaluate(`(() => {
        const contentOf = (selector) => {
          try { const el = document.querySelector(selector); return el && el.getAttribute('content') ? el.getAttribute('content') : '' } catch (err) { return '' }
        }
        return contentOf('meta[property="og:site_name"]') || contentOf('meta[name="application-name"]') || contentOf('meta[name="apple-mobile-web-app-title"]')
      })()`).catch(() => "");
			return {
				url,
				...typeof title === "string" && title !== "" ? { title } : {},
				...typeof siteName === "string" && siteName !== "" ? { siteName } : {}
			};
		} catch {
			return {};
		}
	}
	/** 取会话 cookie（录制结束持久化用；值只交给调用方，不回任何回执）。 */
	async cookiesOf(sessionId) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return [];
		return (await record.context.cookies().catch(() => [])).map((cookie) => ({
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain,
			path: cookie.path,
			secure: cookie.secure,
			...cookie.expires > 0 ? { expires: cookie.expires } : {}
		}));
	}
	/** 关闭会话（先取消未结束的录制，再关浏览器）。 */
	async close(sessionId) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return { ok: false };
		this.sessions.delete(sessionId);
		await record.recorder?.cancel().catch(() => void 0);
		await record.browser.close().catch(() => void 0);
		return { ok: true };
	}
	/** 会话视图（面板轮询录制状态用）。 */
	list() {
		return [...this.sessions.entries()].map(([sessionId, record]) => ({
			sessionId,
			pageUrl: safeUrl$1(record.page),
			recording: record.recorder !== void 0,
			startedAt: record.startedAt
		}));
	}
	pageUrlOf(sessionId) {
		const record = this.sessions.get(sessionId);
		return record === void 0 ? void 0 : safeUrl$1(record.page);
	}
	has(sessionId) {
		return this.sessions.has(sessionId);
	}
	/** 关掉全部会话（插件卸载/测试清理用）。 */
	async closeAll() {
		const ids = [...this.sessions.keys()];
		await Promise.all(ids.map((id) => this.close(id)));
	}
};
function toPlaywrightCookie$1(cookie) {
	return {
		name: cookie.name,
		value: cookie.value,
		domain: cookie.domain,
		path: cookie.path ?? "/",
		secure: cookie.secure ?? false,
		...cookie.expires === void 0 ? {} : { expires: cookie.expires }
	};
}
function safeUrl$1(page) {
	try {
		return page.url();
	} catch {
		return "";
	}
}
function messageOf$2(error) {
	return String(error?.message ?? error).slice(0, 500);
}

//#endregion
//#region src/uitest/agentrec.ts
/**
* AI 代办录制（agent-driven recording）：AI 自主操作页面，动作同步录成 UI 步骤。
*
* 与「人录」（recorder/sessions）的关系：同一批资产（ui-script），同一种步骤语义，
* 但动作的触发方从「页面 DOM 事件」换成「AI 通过工具下发的意图」：
*   - 人录：DOM 事件 → RecorderCore 去重 → 步骤；
*   - 代办：AI 给一个动作（click/fill/scroll/…）→ 本模块定位元素 → 执行 →
*     用与人录同一套口径收集候选/特征/落点 → 步骤。
* 两套产物互相可回放：步骤都进同一个 ui-script schema。
*
* 纪律（与录制器一致，不另造）：
*   - 密码字段：实际值永远只进浏览器 context，步骤里记 `{{password}}` 槽位（回放时人填）；
*   - valueFrom：从服务端配置注入的密钥取值，模型上下文只见键名不见值；
*   - 每个 act 后探测人机验证（验证码/滑块）：检测到就回报 challenge，AI 应暂停叫人，
*     浏览器窗口保持可见，人过完验证码 AI 继续（混合登录）；
*   - 全量留痕 dataRoot/ui-agent-runs/<runId>/（run.json + events.ndjson），
*     事件里只有选择器/步骤形状，没有值。
*
* 引擎边界：代办录制需要直接持有 Playwright Page（执行 + 元素描述），
* 因此只支持 playwright 引擎；配置指向 shared 时由应用层明确报错并给出切换指引。
*
* @module dsh-dataforge/uitest/agentrec
*/
const HELPER_VERSION = 1;
/**
* 代办执行面注入的页面脚本：在 __dfUiSelectorCandidates 之上补三个函数。
* 幂等（版本守卫），重复注入不重复定义。
*/
const AGENT_HELPER_SCRIPT = `(() => {
  var VERSION = ${HELPER_VERSION}
  if (window.__dfUiAgentVersion === VERSION) return
  window.__dfUiAgentVersion = VERSION

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\\s+/g, ' ').trim()
  }
  function pickTestId(el) {
    var attrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa']
    for (var i = 0; i < attrs.length; i += 1) {
      var value = el.getAttribute(attrs[i])
      if (value) return value
    }
    return ''
  }
  function labelTextOf(el) {
    try {
      if (el.labels && el.labels.length > 0) return cleanText(el.labels[0].textContent).slice(0, 80)
    } catch (err) {}
    return ''
  }
  function describeElement(el) {
    var rect = el.getBoundingClientRect()
    var features = { tag: el.tagName.toLowerCase() }
    var id = pickTestId(el); if (id) features.testId = id
    if (el.id) features.id = el.id
    if (el.name) features.name = String(el.name)
    var aria = el.getAttribute('aria-label'); if (aria) features.ariaLabel = aria
    var placeholder = el.getAttribute('placeholder'); if (placeholder) features.placeholder = placeholder
    var role = el.getAttribute('role'); if (role) features.role = role
    if (el.type) features.type = String(el.type)
    var title = el.getAttribute('title'); if (title) features.title = title
    var alt = el.getAttribute('alt'); if (alt) features.alt = alt
    var href = el.getAttribute('href'); if (href) features.href = href
    var label = labelTextOf(el); if (label) features.label = label
    var text = cleanText(el.innerText || el.textContent).slice(0, 80)
    if (text) features.text = text
    return {
      found: true,
      tag: el.tagName,
      isPassword: el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'password',
      text: text.slice(0, 60),
      candidates: (window.__dfUiSelectorCandidates ? window.__dfUiSelectorCandidates(el) : []) || [],
      features: features,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      vw: window.innerWidth,
      vh: window.innerHeight
    }
  }
  /** 按 CSS 选择器描述第一个命中元素（AI 多数时候给的就是 CSS）。 */
  window.__dfUiDescribe = function (selector) {
    var el = null
    try { el = document.querySelector(selector) } catch (err) { return { found: false, error: String(err && err.message ? err.message : err) } }
    if (!el) return { found: false }
    return describeElement(el)
  }
  /** 人机验证探测：验证码 iframe / 滑块 / 验证码输入框 / 验证文案。 */
  window.__dfUiChallenge = function () {
    var markers = []
    var push = function (marker) { if (markers.indexOf(marker) < 0) markers.push(marker) }
    try {
      if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="captcha"]')) push('captcha-iframe')
      if (document.querySelector('#captcha, .geetest_panel, [id*="geetest"], [class*="geetest"], [class*="verify-slider"], [id*="slideVerify"]')) push('captcha-element')
      if (document.querySelector('input[name*="captcha"], input[id*="captcha"], input[placeholder*="验证码"], input[placeholder*="验证"]')) push('captcha-input')
      if (window.grecaptcha || window.hcaptcha || window.turnstile) push('captcha-global')
      var bodyText = document.body ? cleanText(document.body.innerText || document.body.textContent).slice(0, 2000) : ''
      if (/安全验证|请完成验证|拖动滑块|滑块验证|人机验证|输入验证码|向右滑动|verification code|verify you are human/i.test(bodyText)) push('captcha-text')
    } catch (err) {}
    return { detected: markers.length > 0, markers: markers }
  }
  /** 页面观察：URL/标题 + 可交互元素清单（AI 自主规划的眼睛；不产生步骤）。 */
  window.__dfUiInspect = function () {
    var nodes = document.querySelectorAll('a,button,input,textarea,select,label,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"],h1,h2,[data-testid]')
    var elements = []
    for (var i = 0; i < nodes.length && elements.length < 60; i += 1) {
      var el = nodes[i]
      var text = cleanText(el.innerText || el.textContent).slice(0, 60)
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        text = cleanText(el.getAttribute('placeholder') || el.name || el.id || el.tagName).slice(0, 60)
      }
      var candidates = []
      try { candidates = (window.__dfUiSelectorCandidates ? window.__dfUiSelectorCandidates(el) : []) || [] } catch (err) {}
      elements.push({ index: i, tag: el.tagName.toLowerCase(), text: text, candidates: candidates.slice(0, 3) })
    }
    var challenge = window.__dfUiChallenge()
    return { url: location.href, title: document.title, elements: elements, challenge: challenge }
  }
})()`;
/** click 的落点：元素中心按视口坐标 + 元素内比例（canvas/结构漂移兜底，与人录同口径）。 */
function clickPointOfDesc(desc) {
	const rect = desc.rect;
	const vw = desc.vw;
	const vh = desc.vh;
	if (rect === void 0 || vw === void 0 || vh === void 0 || vw <= 0 || vh <= 0) return void 0;
	if (rect.width <= 0 || rect.height <= 0) return void 0;
	return {
		fx: .5,
		fy: .5,
		x: rect.x + rect.width / 2,
		y: rect.y + rect.height / 2,
		vw,
		vh,
		...desc.tag === void 0 ? {} : { tag: desc.tag },
		bx: rect.x,
		by: rect.y,
		bw: rect.width,
		bh: rect.height,
		...desc.text === void 0 || desc.text === "" ? {} : { name: desc.text.slice(0, 120) }
	};
}
const AGENT_PASSWORD_SLOT = "password";
/**
* 动作 + 元素描述 → UI 步骤（执行成功后调用）。
*
* 密钥纪律在这里收口：
*   - valueFrom 的字段：步骤值记 `{{slot}}`（slot = 键名消毒后的槽位名），实际值不进步骤；
*   - 密码字段：必须走 valueFrom（明文值根本不进密码框），步骤值同样只写槽位。
*/
function buildAgentStep(seq, spec, desc, pageUrl, slot) {
	const id = `s${seq}`;
	const at = pageUrl === "" ? void 0 : pageUrl.slice(0, 2e3);
	const target = () => {
		const candidates = (desc?.candidates ?? []).filter((item) => typeof item === "string" && item !== "");
		if (candidates.length === 0) return {};
		return {
			selector: candidates[0],
			candidates
		};
	};
	const features = normalizeFeatures(desc?.features);
	const withCommon = (step) => ({
		...step,
		...features === void 0 ? {} : { features },
		...at === void 0 ? {} : { at }
	});
	switch (spec.kind) {
		case "goto": return {
			id,
			kind: "goto",
			url: spec.url
		};
		case "wait": return {
			id,
			kind: "wait",
			ms: spec.ms
		};
		case "scroll":
			if (spec.selector === void 0 || spec.selector === "") return {
				id,
				kind: "scroll",
				deltaY: spec.deltaY ?? 0
			};
			return withCommon({
				id,
				kind: "scroll",
				...target()
			});
		case "click": return withCommon({
			id,
			kind: "click",
			...target(),
			...desc === void 0 ? {} : { clickPoint: clickPointOfDesc(desc) }
		});
		case "fill": {
			const masked = desc?.isPassword === true || spec.valueFrom !== void 0;
			const slotName = slot ?? (spec.valueFrom !== void 0 ? slotNameOf(spec.valueFrom) : "password");
			return withCommon({
				id,
				kind: "fill",
				...target(),
				value: masked ? `{{${slotName}}}` : spec.value ?? ""
			});
		}
		case "select": return withCommon({
			id,
			kind: "select",
			...target(),
			value: spec.value
		});
		case "press":
			if (spec.selector === void 0 || spec.selector === "") return {
				id,
				kind: "press",
				key: spec.key
			};
			return withCommon({
				id,
				kind: "press",
				...target(),
				key: spec.key
			});
		case "inspect": throw new Error("inspect 动作不产生步骤");
	}
}
const NO_CHALLENGE = {
	detected: false,
	markers: []
};
function messageOf$1(error) {
	return String(error?.message ?? error).slice(0, 800);
}
/** 代办录制会话 registry：进程内；脚本才是资产，会话只活在执行期。 */
var AgentRecordingSessions = class {
	sessions = /* @__PURE__ */ new Map();
	openBrowser;
	dataRoot;
	now;
	constructor(io = {}) {
		this.openBrowser = io.openBrowser ?? openUiBrowser;
		this.dataRoot = io.dataRoot;
		this.now = io.now ?? Date.now;
	}
	async open(args) {
		const sessionId = `uia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		const runId = `uiar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		try {
			const viewport = args.viewport ?? {
				width: 1280,
				height: 720
			};
			const opened = await this.openBrowser({
				headless: args.headless ?? false,
				viewport,
				channel: ""
			});
			const record = {
				sessionId,
				runId,
				task: args.task.slice(0, 4e3),
				startUrl: args.startUrl,
				viewport,
				browser: opened.browser,
				context: opened.context,
				page: opened.page,
				steps: [],
				secretSlots: /* @__PURE__ */ new Set(),
				startedAt: this.now()
			};
			this.sessions.set(sessionId, record);
			await opened.page.evaluate(SELECTOR_HELPER_SCRIPT).catch(() => void 0);
			await opened.page.evaluate(AGENT_HELPER_SCRIPT).catch(() => void 0);
			await opened.context.addInitScript(SELECTOR_HELPER_SCRIPT).catch(() => void 0);
			await opened.context.addInitScript(AGENT_HELPER_SCRIPT).catch(() => void 0);
			if (args.cookies !== void 0 && args.cookies.length > 0) await opened.context.addCookies(args.cookies.map(toPlaywrightCookie)).catch(() => void 0);
			this.initTrace(record);
			const timeout = args.navigationTimeoutMs ?? 2e4;
			await opened.page.goto(args.startUrl, {
				waitUntil: "domcontentloaded",
				timeout
			}).catch(() => void 0);
			this.appendTrace(record, {
				at: this.now(),
				event: "open",
				startUrl: args.startUrl
			});
			return {
				ok: true,
				sessionId,
				runId,
				pageUrl: safeUrl(opened.page)
			};
		} catch (error) {
			this.sessions.delete(sessionId);
			return {
				ok: false,
				error: messageOf$1(error)
			};
		}
	}
	has(sessionId) {
		return this.sessions.has(sessionId);
	}
	pageUrlOf(sessionId) {
		const record = this.sessions.get(sessionId);
		return record === void 0 ? void 0 : safeUrl(record.page);
	}
	taskOf(sessionId) {
		return this.sessions.get(sessionId)?.task;
	}
	stepsOf(sessionId) {
		const record = this.sessions.get(sessionId);
		return record === void 0 ? void 0 : [...record.steps];
	}
	/** 已用到的密钥槽位（落盘 inputs 用；顺序稳定，先 password 兜底键后按插入序）。 */
	secretSlotsOf(sessionId) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return [];
		return [...record.secretSlots];
	}
	runIdOf(sessionId) {
		return this.sessions.get(sessionId)?.runId;
	}
	/** 会话打开时的起点 URL（脚本 meta.startUrl 用当前页会带上登录跳转变迁）。 */
	startUrlOf(sessionId) {
		return this.sessions.get(sessionId)?.startUrl;
	}
	viewportOf(sessionId) {
		return this.sessions.get(sessionId)?.viewport;
	}
	list() {
		return [...this.sessions.values()].map((record) => ({
			sessionId: record.sessionId,
			runId: record.runId,
			pageUrl: safeUrl(record.page),
			task: record.task,
			steps: record.steps.length,
			startedAt: record.startedAt
		}));
	}
	/** 执行一个动作并同步录步；任何一步失败都不进步骤缓冲（执行与录制不脱节）。 */
	async act(sessionId, spec, secrets = {}) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return {
			ok: false,
			error: `会话 ${sessionId} 不存在（可能已关闭）`
		};
		const page = record.page;
		const validateError = validateAct(spec);
		if (validateError !== void 0) return {
			ok: false,
			error: validateError,
			pageUrl: safeUrl(page)
		};
		try {
			if (spec.kind === "inspect") {
				const inspect = await page.evaluate(`(window.__dfUiInspect ? window.__dfUiInspect() : null)`);
				if (inspect === null) return {
					ok: false,
					error: "页面脚本未注入（请刷新会话页面或重开会话）",
					pageUrl: safeUrl(page)
				};
				this.appendTrace(record, {
					at: this.now(),
					event: "act",
					kind: "inspect",
					url: inspect.url
				});
				return {
					ok: true,
					pageUrl: inspect.url,
					inspect
				};
			}
			if (spec.kind === "goto") {
				await page.goto(spec.url, {
					waitUntil: "domcontentloaded",
					timeout: 2e4
				});
				const step = buildAgentStep(record.steps.length + 1, spec, void 0, safeUrl(page));
				record.steps.push(step);
				this.appendTrace(record, {
					at: this.now(),
					event: "act",
					kind: "goto",
					url: spec.url,
					step: step.id
				});
				return this.finishAct(record, step);
			}
			if (spec.kind === "wait") {
				await page.waitForTimeout(Math.min(Math.max(spec.ms, 0), 6e4));
				const step = buildAgentStep(record.steps.length + 1, spec, void 0, safeUrl(page));
				record.steps.push(step);
				this.appendTrace(record, {
					at: this.now(),
					event: "act",
					kind: "wait",
					ms: step.ms
				});
				return this.finishAct(record, step);
			}
			if (spec.kind === "scroll" && (spec.selector === void 0 || spec.selector === "")) {
				const deltaY = Math.min(Math.max(Math.round(spec.deltaY ?? 0), -1e4), 1e4);
				await page.mouse.wheel(0, deltaY);
				const step = buildAgentStep(record.steps.length + 1, {
					...spec,
					deltaY
				}, void 0, safeUrl(page));
				record.steps.push(step);
				this.appendTrace(record, {
					at: this.now(),
					event: "act",
					kind: "scroll",
					deltaY
				});
				return this.finishAct(record, step);
			}
			const selector = actSelectorOf(spec);
			if (selector === void 0) return {
				ok: false,
				error: "动作缺 selector",
				pageUrl: safeUrl(page)
			};
			const described = await this.describe(record, selector);
			const locator = await this.resolveLocator(record, selector, described);
			if (locator === void 0) return {
				ok: false,
				error: described?.found === false && described.error !== void 0 ? `selector 语法错误：${described.error}` : `定位不到元素：${selector}（可先 inspect 看页面结构）`,
				pageUrl: safeUrl(page)
			};
			const desc = described?.found === true ? described : await this.describeLocator(locator);
			let value;
			let valueMasked = false;
			let slot;
			if (spec.kind === "fill") {
				if (spec.valueFrom !== void 0) {
					value = secrets[spec.valueFrom];
					if (value === void 0) return {
						ok: false,
						error: `valueFrom 键 ${spec.valueFrom} 不在服务端密钥表（uiAgentCredentials 可用键：${Object.keys(secrets).join("、") || "（未配置）"}）`,
						pageUrl: safeUrl(page)
					};
					slot = slotNameOf(spec.valueFrom);
					record.secretSlots.add(slot);
					valueMasked = true;
				} else if (desc.isPassword === true) return {
					ok: false,
					error: "目标是密码字段：请用 valueFrom 从服务端密钥表取值（明文值不允许进密码框，也不进脚本）",
					pageUrl: safeUrl(page)
				};
				else value = spec.value ?? "";
			}
			const timeout = 15e3;
			switch (spec.kind) {
				case "click":
					await locator.click({ timeout });
					break;
				case "fill":
					await locator.fill(value ?? "", { timeout });
					break;
				case "select":
					await locator.selectOption(spec.value, { timeout });
					break;
				case "press":
					await locator.press(spec.key, { timeout });
					break;
				case "scroll":
					await locator.scrollIntoViewIfNeeded({ timeout });
					break;
				default: return {
					ok: false,
					error: `未支持的动作：${spec.kind}`,
					pageUrl: safeUrl(page)
				};
			}
			const step = buildAgentStep(record.steps.length + 1, spec, desc, safeUrl(page), slot);
			record.steps.push(step);
			this.appendTrace(record, {
				at: this.now(),
				event: "act",
				kind: spec.kind,
				selector: step.selector,
				step: step.id,
				...valueMasked ? { valueMasked: true } : {}
			});
			return {
				...await this.finishAct(record, step),
				...valueMasked ? { valueMasked: true } : {}
			};
		} catch (error) {
			return {
				ok: false,
				error: messageOf$1(error),
				pageUrl: safeUrl(page)
			};
		}
	}
	/** 动作收尾：探测人机验证 + 组装回执（challenge 永远尽力而为，探测失败不遮动作结果）。 */
	async finishAct(record, step) {
		const challenge = await this.detectChallenge(record).catch(() => NO_CHALLENGE);
		return {
			ok: true,
			pageUrl: safeUrl(record.page),
			challenge,
			step,
			stepsSoFar: record.steps.length
		};
	}
	async detectChallenge(record) {
		const result = await record.page.evaluate("(window.__dfUiChallenge ? window.__dfUiChallenge() : null)").catch(() => null);
		if (result === null || typeof result !== "object") return NO_CHALLENGE;
		const value = result;
		return {
			detected: value.detected === true,
			markers: Array.isArray(value.markers) ? value.markers.filter((item) => typeof item === "string") : []
		};
	}
	/** CSS describe：返回页面脚本描述（未命中返回 found:false，不抛）。 */
	async describe(record, selector) {
		const expr = `(window.__dfUiDescribe ? window.__dfUiDescribe(${JSON.stringify(selector)}) : null)`;
		const result = await record.page.evaluate(expr).catch(() => null);
		if (result === null || typeof result !== "object") return void 0;
		return result;
	}
	/** Playwright 专属选择器（text= 等）路径：动作由 locator 执行，描述事后从元素上现取。 */
	async describeLocator(locator) {
		const collected = await locator.evaluate((el) => {
			const win = globalThis;
			return {
				candidates: typeof win.__dfUiSelectorCandidates === "function" ? win.__dfUiSelectorCandidates(el) ?? [] : [],
				tag: el?.tagName ?? ""
			};
		}).catch(() => ({
			candidates: [],
			tag: ""
		}));
		const rect = await locator.boundingBox().catch(() => null);
		return {
			found: true,
			tag: collected.tag,
			candidates: collected.candidates,
			...rect === null ? {} : { rect }
		};
	}
	async resolveLocator(record, selector, described) {
		const page = record.page;
		const candidates = described?.found === true ? described.candidates ?? [] : [];
		for (const candidate of candidates.length > 0 ? candidates : [selector]) {
			const locator = page.locator(candidate).first();
			try {
				await locator.waitFor({
					state: "attached",
					timeout: 2e3
				});
				return locator;
			} catch {}
		}
	}
	/** 读当前页面元信息（自动命名用；读不到返回空对象，绝不抛）。 */
	async pageMetaOf(sessionId) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return {};
		try {
			const url = safeUrl(record.page);
			const title = await record.page.title().catch(() => "");
			const siteName = await record.page.evaluate(`(() => {
        const contentOf = (selector) => {
          try { const el = document.querySelector(selector); return el && el.getAttribute('content') ? el.getAttribute('content') : '' } catch (err) { return '' }
        }
        return contentOf('meta[property="og:site_name"]') || contentOf('meta[name="application-name"]') || contentOf('meta[name="apple-mobile-web-app-title"]')
      })()`).catch(() => "");
			return {
				url,
				...typeof title === "string" && title !== "" ? { title } : {},
				...typeof siteName === "string" && siteName !== "" ? { siteName } : {}
			};
		} catch {
			return {};
		}
	}
	/** 取会话 cookie（落凭证 jar 用；值只交给调用方，不进任何回执）。 */
	async cookiesOf(sessionId) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return [];
		return (await record.context.cookies().catch(() => [])).map((cookie) => ({
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain,
			path: cookie.path,
			secure: cookie.secure,
			...cookie.expires > 0 ? { expires: cookie.expires } : {}
		}));
	}
	/** 关闭会话并写留痕终态。 */
	async close(sessionId) {
		const record = this.sessions.get(sessionId);
		if (record === void 0) return { ok: false };
		this.sessions.delete(sessionId);
		this.appendTrace(record, {
			at: this.now(),
			event: "close",
			steps: record.steps.length
		});
		this.finishTrace(record);
		await record.browser.close().catch(() => void 0);
		return { ok: true };
	}
	async closeAll() {
		await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
	}
	initTrace(record) {
		if (this.dataRoot === void 0) return;
		const dir = join(this.dataRoot, "ui-agent-runs", record.runId);
		record.traceDir = dir;
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "run.json"), JSON.stringify({
				runId: record.runId,
				sessionId: record.sessionId,
				task: record.task,
				startUrl: record.startUrl,
				viewport: record.viewport,
				startedAt: record.startedAt
			}, null, 2), "utf8");
		} catch {
			record.traceDir = void 0;
		}
	}
	appendTrace(record, event) {
		if (record.traceDir === void 0) return;
		try {
			appendFileSync(join(record.traceDir, "events.ndjson"), `${JSON.stringify(event)}\n`, "utf8");
		} catch {}
	}
	finishTrace(record) {
		if (record.traceDir === void 0) return;
		try {
			writeFileSync(join(record.traceDir, "run.json"), JSON.stringify({
				runId: record.runId,
				sessionId: record.sessionId,
				task: record.task,
				startUrl: record.startUrl,
				viewport: record.viewport,
				startedAt: record.startedAt,
				finishedAt: this.now(),
				steps: record.steps.length,
				secretsUsed: record.secretSlots.size
			}, null, 2), "utf8");
		} catch {}
	}
};
function validateAct(spec) {
	switch (spec.kind) {
		case "inspect":
		case "wait": return;
		case "goto": return isHttpUrl(spec.url) ? void 0 : `goto 的 url 必须是 http/https：${spec.url}`;
		case "click": return spec.selector.trim() === "" ? "click 缺 selector" : void 0;
		case "fill":
			if (spec.selector.trim() === "") return "fill 缺 selector";
			if (spec.value === void 0 && spec.valueFrom === void 0) return "fill 需要 value 或 valueFrom";
			return;
		case "select":
			if (spec.selector.trim() === "") return "select 缺 selector";
			return spec.value.trim() === "" ? "select 缺 value（选项值或可见文本）" : void 0;
		case "press": return spec.key.trim() === "" ? "press 缺 key（Enter/Tab/…）" : void 0;
		case "scroll":
			if (spec.selector !== void 0 && spec.selector.trim() !== "") return void 0;
			if (spec.deltaY === void 0 || !Number.isFinite(spec.deltaY)) return "scroll 需要 selector 或 deltaY";
			return;
		default: return `未支持的动作：${spec.kind}`;
	}
}
function actSelectorOf(spec) {
	if ("selector" in spec && typeof spec.selector === "string") return spec.selector.trim();
}
/** valueFrom 键名 → 合法槽位名（字母/数字/下划线，字母开头；映射稳定，录进脚本/回放同一入口）。 */
function slotNameOf(key) {
	const cleaned = key.replace(/[^A-Za-z0-9_]/g, "_");
	return (/^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`) || "password";
}
function isHttpUrl(value) {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}
function safeUrl(page) {
	try {
		return page.url();
	} catch {
		return "";
	}
}
function toPlaywrightCookie(cookie) {
	return {
		name: cookie.name,
		value: cookie.value,
		domain: cookie.domain,
		path: cookie.path ?? "/",
		secure: cookie.secure ?? false,
		...cookie.expires === void 0 ? {} : { expires: cookie.expires }
	};
}

//#endregion
//#region src/uitest/engines/playwright.ts
var PlaywrightBrowserEngine = class {
	io;
	kind = "playwright";
	label = "独立 Chrome（Playwright）";
	managesCookies = false;
	constructor(io) {
		this.io = io;
	}
	available() {
		return true;
	}
	open(args) {
		return this.io.sessions.open({
			...args,
			channel: this.io.channel
		});
	}
	start(sessionId) {
		return this.io.sessions.start(sessionId);
	}
	stop(sessionId) {
		return this.io.sessions.stop(sessionId);
	}
	pickSelector(sessionId, timeoutMs) {
		return this.io.sessions.pickSelector(sessionId, timeoutMs);
	}
	pageMeta(sessionId) {
		return this.io.sessions.pageMetaOf(sessionId);
	}
	cookiesOf(sessionId) {
		return this.io.sessions.cookiesOf(sessionId);
	}
	close(sessionId) {
		return this.io.sessions.close(sessionId);
	}
	list() {
		return this.io.sessions.list();
	}
	pageUrlOf(sessionId) {
		return this.io.sessions.pageUrlOf(sessionId);
	}
	has(sessionId) {
		return this.io.sessions.has(sessionId);
	}
	closeAll() {
		return this.io.sessions.closeAll();
	}
	run(doc, inputs, options) {
		return this.io.run(doc, inputs, options);
	}
};

//#endregion
//#region src/uitest/engines/shared-run.ts
/**
* 共享浏览器引擎的回放器（seam 版 `runUiScript`）。
*
* 语义与 Playwright 版逐项对齐（步骤/断言/失败证据/run.json + events.ndjson），
* 差别只在"动作怎么发出去"：这里走 seam 的 navigate/click/setValue/key/execute/screenshot。
*
* 目标解析：ui-script 的候选链是 Playwright 优先的；本引擎把 `text="…"` / `tag:has-text("…")`
* 映射成 seam 的 text 定位，其余按 CSS。CSS 是页面内 `querySelectorAll`，不支持的选择器
* 会被跳过验证（录制阶段已尽力保留候选）。
*
* 边界：`upload` 步骤在共享引擎上不支持（seam 没有文件选择通道）——失败信息会指回 Playwright 引擎。
*
* @module dsh-dataforge/uitest/engines/shared-run
*/
const SUPPORTED_KEYS = /* @__PURE__ */ new Set([
	"Enter",
	"Tab",
	"Escape",
	"Backspace",
	"Delete",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Space"
]);
/** 目标解析：优先 Playwright 候选，映射成 seam 的 css/text/xpath。 */
function seamTargetsOf(step) {
	const inputs = [step.selector, ...step.candidates ?? []].filter((item) => typeof item === "string" && item.trim() !== "");
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const add = (target) => {
		const key = `${target.by}:${target.value}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push(target);
	};
	for (const candidate of inputs) {
		if (candidate.startsWith("text=")) {
			add({
				by: "text",
				value: unquote(candidate.slice(5))
			});
			continue;
		}
		if (candidate.startsWith("xpath=")) {
			add({
				by: "xpath",
				value: candidate.slice(6)
			});
			continue;
		}
		const hasText = /:has-text\("([\s\S]*)"\)\s*$/.exec(candidate);
		if (hasText !== null) {
			add({
				by: "text",
				value: unescapeQuoted(hasText[1])
			});
			continue;
		}
		add({
			by: "css",
			value: candidate
		});
	}
	for (const candidate of featureCandidates(step.features)) {
		if (candidate.startsWith("text=")) {
			add({
				by: "text",
				value: unquote(candidate.slice(5))
			});
			continue;
		}
		const hasText = /:has-text\("([\s\S]*)"\)\s*$/.exec(candidate);
		if (hasText !== null) {
			add({
				by: "text",
				value: unescapeQuoted(hasText[1])
			});
			continue;
		}
		add({
			by: "css",
			value: candidate
		});
	}
	const name = step.clickPoint?.name;
	if (name !== void 0 && name !== "") add({
		by: "text",
		value: name
	});
	return out;
}
function unquote(value) {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && (trimmed.startsWith("\"") && trimmed.endsWith("\"") || trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
	return trimmed;
}
function unescapeQuoted(value) {
	return value.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}
/** CSS 候选（submit/focus 这类只能用页面内 querySelector 的动作用）。 */
function cssCandidatesOf(step) {
	return [step.selector, ...step.candidates ?? []].filter((item) => typeof item === "string").filter((item) => !item.startsWith("text=") && !item.startsWith("xpath=") && !item.includes(":has-text("));
}
async function runUiScriptOnSeam(io, doc, inputs, options = {}) {
	const slowMoMs = Math.min(Math.max(Math.floor(options.slowMoMs ?? 0), 0), 1e4);
	const holdMs = Math.min(Math.max(Math.floor(io.holdMs ?? options.holdMs ?? 0), 0), 3e4);
	const runId = `uir_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	const startUrl = substituteInputs(doc.meta.startUrl, inputs);
	const startedAt = Date.now();
	let sessionId;
	const stepResults = [];
	startUiRun(io.dataRoot, runId, {
		site: doc.meta.site,
		flow: doc.meta.flow,
		version: doc.meta.version,
		startUrl,
		engine: "shared",
		totalSteps: doc.steps.length
	});
	const emit = (event) => appendUiRunEvent(io.dataRoot, runId, event);
	emit({
		event: "meta",
		site: doc.meta.site,
		flow: doc.meta.flow,
		version: doc.meta.version,
		startUrl
	});
	try {
		sessionId = await io.seam.open(io.owner);
		await io.seam.navigate(sessionId, { url: startUrl });
		await io.seam.waitFor(sessionId, {
			url: startUrl,
			loaded: true,
			timeoutMs: io.stepTimeoutMs
		}).catch(() => void 0);
		for (const step of doc.steps) {
			if (slowMoMs > 0) await sleep(slowMoMs);
			const result = await runStep(io, sessionId, step, inputs, emit, doc);
			stepResults.push(result);
			if (!result.ok) {
				const evidence = await captureFailure(io, sessionId, runId);
				const elapsedMs = Date.now() - startedAt;
				emit({
					event: "terminal",
					success: false,
					message: result.error,
					...evidence.screenshot === void 0 ? {} : { screenshot: evidence.screenshot },
					...evidence.dom === void 0 ? {} : { dom: evidence.dom },
					elapsed: elapsedMs
				});
				finishUiRun(io.dataRoot, runId, {
					status: "failed",
					finishedAt: Date.now(),
					stepsDone: stepResults.length - 1,
					failedStep: result.id,
					...result.error === void 0 ? {} : { error: result.error },
					...evidence.screenshot === void 0 ? {} : { screenshot: evidence.screenshot },
					elapsedMs
				});
				return {
					runId,
					site: doc.meta.site,
					flow: doc.meta.flow,
					version: doc.meta.version,
					startUrl,
					success: false,
					totalSteps: doc.steps.length,
					stepsDone: stepResults.length - 1,
					steps: stepResults,
					failedStep: result,
					...evidence.screenshot === void 0 ? {} : { screenshot: evidence.screenshot },
					...evidence.dom === void 0 ? {} : { dom: evidence.dom },
					...result.error === void 0 ? {} : { error: result.error },
					elapsedMs,
					cookiesApplied: 0,
					notice: "共享浏览器引擎（dsh-builtin-browser seam）"
				};
			}
		}
		const elapsedMs = Date.now() - startedAt;
		emit({
			event: "terminal",
			success: true,
			message: `全部 ${doc.steps.length} 步通过`,
			elapsed: elapsedMs
		});
		finishUiRun(io.dataRoot, runId, {
			status: "success",
			finishedAt: Date.now(),
			stepsDone: stepResults.length,
			elapsedMs
		});
		return {
			runId,
			site: doc.meta.site,
			flow: doc.meta.flow,
			version: doc.meta.version,
			startUrl,
			success: true,
			totalSteps: doc.steps.length,
			stepsDone: stepResults.length,
			steps: stepResults,
			elapsedMs,
			cookiesApplied: 0,
			notice: "共享浏览器引擎（dsh-builtin-browser seam）"
		};
	} catch (error) {
		const message = String(error?.message ?? error).slice(0, 1e3);
		const elapsedMs = Date.now() - startedAt;
		emit({
			event: "terminal",
			success: false,
			message,
			elapsed: elapsedMs
		});
		finishUiRun(io.dataRoot, runId, {
			status: "failed",
			finishedAt: Date.now(),
			stepsDone: stepResults.length,
			error: message,
			elapsedMs
		});
		return {
			runId,
			site: doc.meta.site,
			flow: doc.meta.flow,
			version: doc.meta.version,
			startUrl,
			success: false,
			totalSteps: doc.steps.length,
			stepsDone: stepResults.length,
			steps: stepResults,
			error: message,
			elapsedMs,
			cookiesApplied: 0,
			notice: "共享浏览器引擎（dsh-builtin-browser seam）"
		};
	} finally {
		if (sessionId !== void 0 && holdMs > 0) await sleep(holdMs);
		if (sessionId !== void 0) await io.seam.close(sessionId).catch(() => void 0);
	}
}
async function runStep(io, sessionId, step, inputs, emit, doc) {
	const startedAt = Date.now();
	const targetText = step.selector ?? step.candidates?.[0] ?? step.url;
	const result = {
		id: step.id,
		kind: step.kind,
		ok: false,
		elapsedMs: 0,
		assertions: []
	};
	emit({
		event: "step",
		id: step.id,
		kind: step.kind,
		status: "start",
		...targetText === void 0 ? {} : { target: targetText }
	});
	try {
		if (step.kind === "wait") await sleep(Math.min(step.ms ?? 0, io.stepTimeoutMs));
		else if (step.kind === "goto") {
			const url = substituteInputs(step.url ?? "", inputs);
			await io.seam.navigate(sessionId, { url });
			await io.seam.waitFor(sessionId, {
				url,
				loaded: true,
				timeoutMs: io.stepTimeoutMs
			}).catch(() => void 0);
		} else if (step.kind === "upload") throw new Error("共享浏览器引擎不支持 upload 步骤（seam 无文件选择通道）：请把该脚本切回 Playwright 引擎，或手写上传步骤");
		else if (step.kind === "press" && seamTargetsOf(step).length === 0) {
			const key = substituteInputs(step.key ?? "", inputs);
			assertKey(key);
			await io.seam.key(sessionId, { key });
		} else if (step.kind === "scroll") {
			if (step.selector !== void 0) await io.seam.scroll(sessionId, { selector: step.selector });
			else await io.seam.scroll(sessionId, { deltaY: step.deltaY ?? 0 });
		} else if (step.kind === "submit") {
			const selector = cssCandidatesOf(step)[0];
			if (selector === void 0) throw new Error("submit 步骤没有 CSS selector（共享引擎只能用 CSS 触发表单提交）");
			const submitted = await io.seam.execute(sessionId, {
				script: `return (function (selector) {
          const form = document.querySelector(selector)
          if (!form) return 'not-found'
          if (typeof form.requestSubmit === 'function') { form.requestSubmit(); return 'ok' }
          if (typeof form.submit === 'function') { form.submit(); return 'submitted' }
          return 'not-a-form'
        })(arguments[0])`,
				args: [selector],
				timeoutMs: io.stepTimeoutMs
			});
			if (!submitted.ok) throw new Error(submitted.exception);
			if (submitted.value !== "ok" && submitted.value !== "submitted") throw new Error(`提交失败：${String(submitted.value)}`);
		} else await performTargetedAction(io, sessionId, step, inputs, result);
		for (const expect of step.expect ?? []) {
			const assertion = await runExpect(io, sessionId, expect);
			result.assertions.push(assertion);
			emit({
				event: "assert",
				stepId: step.id,
				kind: assertion.kind,
				status: assertion.ok ? "ok" : "error",
				...assertion.selector === void 0 ? {} : { selector: assertion.selector },
				...assertion.expected === void 0 ? {} : { expected: assertion.expected },
				...assertion.actual === void 0 ? {} : { actual: assertion.actual },
				elapsed: assertion.elapsedMs,
				...assertion.error === void 0 ? {} : { error: assertion.error }
			});
			if (!assertion.ok) {
				result.error = `断言失败：${assertion.error ?? "未知原因"}`;
				result.elapsedMs = Date.now() - startedAt;
				return result;
			}
		}
		result.ok = true;
		result.elapsedMs = Date.now() - startedAt;
		return result;
	} catch (error) {
		result.error = String(error?.message ?? error).slice(0, 800);
		result.elapsedMs = Date.now() - startedAt;
		return result;
	} finally {
		emit({
			event: "step",
			id: step.id,
			kind: step.kind,
			status: result.ok ? "done" : "error",
			elapsed: result.elapsedMs,
			...result.target === void 0 ? {} : { target: result.target },
			...result.error === void 0 ? {} : { error: result.error }
		});
	}
}
async function performTargetedAction(io, sessionId, step, inputs, result) {
	const targets = seamTargetsOf(step);
	if (targets.length === 0) throw new Error(`${step.kind} 步骤没有 selector/candidates`);
	const attempts = [];
	const attemptAll = async () => {
		for (const target of targets) try {
			if (step.kind === "click") await clickTarget(io, sessionId, step, target);
			else if (step.kind === "fill") await io.seam.setValue(sessionId, {
				target,
				value: substituteInputs(step.value ?? "", inputs)
			});
			else if (step.kind === "select") await io.seam.selectOption(sessionId, {
				target,
				optionValue: substituteInputs(step.value ?? "", inputs)
			});
			else if (step.kind === "press") {
				await focusTarget(io, sessionId, target);
				const key = substituteInputs(step.key ?? "", inputs);
				assertKey(key);
				await io.seam.key(sessionId, { key });
			} else throw new Error(`共享引擎不支持步骤类型：${step.kind}`);
			result.target = target.by === "css" ? target.value : `${target.by}=${target.value}`;
			return true;
		} catch (error) {
			attempts.push(`${target.by}:${target.value}（${String(error?.message ?? error).slice(0, 120)}）`);
		}
		return false;
	};
	if (await attemptAll()) return;
	const at = typeof step.at === "string" && /^https?:\/\//.test(step.at) ? step.at : void 0;
	if (at !== void 0) {
		if (await activeUrl(io, sessionId) !== at) try {
			await io.seam.navigate(sessionId, { url: at });
			await io.seam.waitFor(sessionId, {
				loaded: true,
				timeoutMs: 15e3
			}).catch(() => void 0);
			attempts.push(`重新导航到录制页 ${at}`);
			if (await attemptAll()) return;
		} catch (error) {
			attempts.push(`导航到 ${at} 失败（${String(error?.message ?? error).slice(0, 120)}）`);
		}
	}
	throw new Error(`找不到可用目标：${attempts.join("；")}`);
}
async function activeUrl(io, sessionId) {
	const tabs = await io.seam.listTabs(sessionId).catch(() => []);
	return (tabs.find((tab) => tab.active) ?? tabs[0])?.url ?? "";
}
/**
* 点击：canvas 图表必须按坐标点（元素中心落在空白处不会触发图表交互）；
* 普通元素先走语义点击，失败且录了坐标时按坐标兜底。点完等一小段导航落定。
*/
async function clickTarget(io, sessionId, step, target) {
	const point = step.clickPoint;
	const info = target.by === "css" ? await elementInfo(io, sessionId, target.value) : void 0;
	if (point !== void 0) {
		const tagMatches = info !== void 0 && (step.features?.tag === void 0 || info.tag.toLowerCase() === step.features.tag.toLowerCase());
		if (info !== void 0 && info.tag === "CANVAS" && tagMatches) {
			await clickAt(io, sessionId, point, info);
			await settleAfterClick(io, sessionId);
			return;
		}
		if (info === void 0 || !tagMatches) {
			const resolved = await featureInfo(io, sessionId, step.features);
			if (resolved !== void 0) {
				await clickAt(io, sessionId, point, resolved);
				await settleAfterClick(io, sessionId);
				return;
			}
		}
	}
	if (info !== void 0 && io.highlightClicks !== false) await highlightAt(io, sessionId, info.x + info.w / 2, info.y + info.h / 2);
	try {
		await io.seam.click(sessionId, { target });
	} catch (error) {
		if (point === void 0) throw error;
		await clickAt(io, sessionId, point, info);
	}
	await settleAfterClick(io, sessionId);
}
/**
* 用录制特征在当前页面找回元素并返回最新几何。
*
* 只用于"选择器失效但录了落点"的场景：分数最高且至少命中一个稳定属性才采用，
* 避免只按 tag 乱点。
*/
async function featureInfo(io, sessionId, features) {
	if (features === void 0) return void 0;
	const result = await io.seam.execute(sessionId, {
		script: `return (function (f) {
      const norm = (value) => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim()
      let nodes = []
      try { nodes = document.querySelectorAll(f.tag || '*') } catch (err) { nodes = [] }
      let best = null
      let bestScore = 0
      const canvases = document.querySelectorAll('canvas')
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i]
        let score = 0
        if (f.id && el.id === f.id) score += 8
        if (f.testId) {
          const attrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa']
          for (let a = 0; a < attrs.length; a += 1) { if (el.getAttribute(attrs[a]) === f.testId) { score += 8; break } }
        }
        if (f.name && el.getAttribute('name') === f.name) score += 4
        if (f.ariaLabel && el.getAttribute('aria-label') === f.ariaLabel) score += 6
        if (f.placeholder && el.getAttribute('placeholder') === f.placeholder) score += 6
        if (f.role && el.getAttribute('role') === f.role) score += 2
        if (f.title && el.getAttribute('title') === f.title) score += 2
        if (f.alt && el.getAttribute('alt') === f.alt) score += 2
        if (f.text && norm(el.innerText || el.textContent).indexOf(f.text) >= 0) score += 3
        if (f.canvasIndex !== undefined && el.tagName === 'CANVAS') {
          const index = Array.prototype.indexOf.call(canvases, el)
          if (index === f.canvasIndex) score += 6
        }
        if (score > bestScore) { bestScore = score; best = el }
      }
      if (!best) return null
      const r = best.getBoundingClientRect()
      return { tag: best.tagName, x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }
    })(arguments[0])`,
		args: [features],
		timeoutMs: io.stepTimeoutMs
	}).catch(() => void 0);
	if (result === void 0 || !result.ok || result.value === null || typeof result.value !== "object") return void 0;
	return readElementInfo(result.value);
}
function readElementInfo(value) {
	if (value === null || typeof value !== "object") return void 0;
	const record = value;
	const num = (key) => typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : void 0;
	const tag = typeof record["tag"] === "string" ? record["tag"] : void 0;
	const x = num("x");
	const y = num("y");
	const w = num("w");
	const h = num("h");
	const vw = num("vw");
	const vh = num("vh");
	if (tag === void 0 || x === void 0 || y === void 0 || w === void 0 || h === void 0 || vw === void 0 || vh === void 0) return void 0;
	return {
		tag,
		x,
		y,
		w,
		h,
		vw,
		vh
	};
}
async function elementInfo(io, sessionId, selector) {
	const result = await io.seam.execute(sessionId, {
		script: `return (function (selector) {
      const el = document.querySelector(selector)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { tag: el.tagName, x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }
    })(arguments[0])`,
		args: [selector],
		timeoutMs: io.stepTimeoutMs
	}).catch(() => void 0);
	if (result === void 0 || !result.ok) return void 0;
	return readElementInfo(result.value);
}
/** 元素内比例坐标 → 视口坐标；元素找不到时按录制视口等比缩放兜底。 */
async function clickAt(io, sessionId, point, info) {
	let x;
	let y;
	if (info !== void 0 && sameBox(point, info)) {
		x = point.x;
		y = point.y;
	} else if (info !== void 0 && info.w > 0 && info.h > 0) {
		x = info.x + point.fx * info.w;
		y = info.y + point.fy * info.h;
	} else {
		const viewport = await io.seam.execute(sessionId, {
			script: "return { vw: window.innerWidth, vh: window.innerHeight }",
			timeoutMs: io.stepTimeoutMs
		}).catch(() => void 0);
		const raw = viewport !== void 0 && viewport.ok && typeof viewport.value === "object" && viewport.value !== null ? viewport.value : {};
		const vw = typeof raw["vw"] === "number" && raw["vw"] > 0 ? raw["vw"] : point.vw;
		const vh = typeof raw["vh"] === "number" && raw["vh"] > 0 ? raw["vh"] : point.vh;
		x = vw > 0 && point.vw > 0 ? point.x * (vw / point.vw) : point.x;
		y = vh > 0 && point.vh > 0 ? point.y * (vh / point.vh) : point.y;
	}
	if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("点击坐标无效");
	if (io.highlightClicks !== false) await highlightAt(io, sessionId, x, y);
	await io.seam.click(sessionId, {
		x: Math.round(x),
		y: Math.round(y)
	});
}
function sameBox(point, info) {
	if (point.bx === void 0 || point.by === void 0 || point.bw === void 0 || point.bh === void 0) return false;
	const near = (left, right) => Math.abs(left - right) <= 1.5;
	return near(point.bx, info.x) && near(point.by, info.y) && near(point.bw, info.w) && near(point.bh, info.h);
}
/** 点击提示：注入脉冲光圈（失败不影响点击）。 */
async function highlightAt(io, sessionId, x, y) {
	await io.seam.execute(sessionId, {
		script: highlightClickExpression(x, y),
		timeoutMs: 2e3
	}).catch(() => void 0);
}
/** 点击后等页面加载落定（不阻塞失败；导航由下一步的元素等待兜底）。 */
async function settleAfterClick(io, sessionId) {
	await io.seam.waitFor(sessionId, {
		loaded: true,
		timeoutMs: 1500
	}).catch(() => void 0);
}
function assertKey(key) {
	if (!SUPPORTED_KEYS.has(key)) throw new Error(`共享浏览器引擎不支持按键 ${key}（支持：${[...SUPPORTED_KEYS].join("/")}）`);
}
async function focusTarget(io, sessionId, target) {
	if (target.by !== "css") return;
	await io.seam.execute(sessionId, {
		script: "return (function (selector) { const el = document.querySelector(selector); if (el && typeof el.focus === \"function\") { el.focus(); return true } return false })(arguments[0])",
		args: [target.value],
		timeoutMs: io.stepTimeoutMs
	}).catch(() => void 0);
}
/** 页面内断言求值（同一段脚本同时支持 CSS / text= / *:has-text）。 */
const EVALUATE_EXPECT = `return (function (kind, selector, equals, contains) {
  const normalize = (value) => String(value == null ? '' : value).replace(/\\s+/g, ' ').trim()
  const visible = (el) => {
    if (!el) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = window.getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  const matches = (sel) => {
    if (sel.startsWith('text="') && sel.endsWith('"')) {
      const text = sel.slice(6, -1)
      return Array.from(document.querySelectorAll('*')).filter((el) => normalize(el.innerText || el.textContent).includes(text))
    }
    const m = /:has-text\\("([\\s\\S]*)"\\)\\s*$/.exec(sel)
    if (m) {
      const tag = sel.slice(0, m.index).trim() || '*'
      return Array.from(document.querySelectorAll(tag)).filter((el) => normalize(el.innerText || el.textContent).includes(m[1]))
    }
    try { return Array.from(document.querySelectorAll(sel)) } catch (err) { return [] }
  }
  if (kind === 'url') {
    const url = location.href
    return { ok: equals != null && equals !== '' ? url === String(equals) : url.includes(String(contains)), actual: url }
  }
  if (kind === 'count') {
    const count = matches(selector).length
    return { ok: count === Number(equals), actual: String(count) }
  }
  const el = matches(selector)[0]
  if (kind === 'visible') return { ok: visible(el), actual: visible(el) ? 'visible' : 'hidden' }
  if (kind === 'hidden') return { ok: !visible(el), actual: visible(el) ? 'visible' : 'hidden' }
  if (kind === 'value') {
    const value = el ? String(el.value == null ? '' : el.value) : ''
    return { ok: equals != null ? value === String(equals) : value.includes(String(contains)), actual: value }
  }
  const text = el ? normalize(el.innerText || el.textContent) : ''
  return { ok: equals != null ? text === String(equals) : text.includes(String(contains)), actual: text }
})(arguments[0], arguments[1], arguments[2], arguments[3])`;
async function runExpect(io, sessionId, expect) {
	const startedAt = Date.now();
	const deadline = startedAt + io.stepTimeoutMs;
	const selector = expect.selector;
	const expected = expect.equals === void 0 ? expect.contains : String(expect.equals);
	const result = {
		kind: expect.kind,
		...selector === void 0 ? {} : { selector },
		ok: false,
		elapsedMs: 0,
		...expected === void 0 ? {} : { expected }
	};
	let actual = "";
	for (;;) {
		const evaluated = await io.seam.execute(sessionId, {
			script: EVALUATE_EXPECT,
			args: [
				expect.kind,
				selector ?? "",
				expect.equals ?? null,
				expect.contains ?? null
			],
			timeoutMs: io.stepTimeoutMs
		}).catch((error) => ({
			ok: false,
			exception: String(error?.message ?? error)
		}));
		if (evaluated.ok) {
			const value = evaluated.value;
			actual = value !== null && typeof value === "object" ? String(value.actual ?? "") : "";
			if (value !== null && typeof value === "object" && value.ok === true) {
				result.ok = true;
				result.elapsedMs = Date.now() - startedAt;
				return result;
			}
		} else actual = evaluated.exception;
		if (Date.now() >= deadline) break;
		await sleep(120);
	}
	result.elapsedMs = Date.now() - startedAt;
	result.actual = actual.slice(0, 500);
	result.error = expect.kind === "url" ? `URL 期望 ${expect.equals === void 0 ? `包含 ${String(expect.contains)}` : `等于 ${String(expect.equals)}`}，实际 ${actual.slice(0, 200)}` : expect.kind === "count" ? `元素数期望 ${String(expect.equals)}，实际 ${actual}` : expect.kind === "visible" || expect.kind === "hidden" ? `元素可见性期望 ${expect.kind}，实际不满足（${selector ?? "?"}）` : `期望 ${expected ?? ""}，实际 ${actual.slice(0, 200)}`;
	return result;
}
async function captureFailure(io, sessionId, runId) {
	const dir = uiRunDir(io.dataRoot, runId);
	const evidence = {};
	try {
		const payload = (await io.seam.screenshot(sessionId, { format: "png" })).dataUrl.split(",")[1] ?? "";
		writeFileSync(join(dir, "failure.png"), Buffer.from(payload, "base64"));
		evidence.screenshot = join("ui-runs", runId, "failure.png");
	} catch {}
	try {
		const dom = await io.seam.execute(sessionId, {
			script: "return document.documentElement ? document.documentElement.outerHTML : \"\"",
			timeoutMs: io.stepTimeoutMs
		});
		const html = dom.ok ? String(dom.value ?? "") : "";
		if (html !== "") {
			writeFileSync(join(dir, "failure.html"), html.slice(0, 2097152), "utf8");
			evidence.dom = join("ui-runs", runId, "failure.html");
		}
	} catch {}
	return evidence;
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

//#endregion
//#region src/uitest/engines/shared.ts
/** 页面里 drain 事件队列 + 返回诊断信息（URL / 是否仍安装）。 */
const DRAIN_EXPRESSION = `(() => {
  const queue = window.__dfUiSeamQueue
  window.__dfUiSeamQueue = []
  return {
    installed: !!window.__dfUiRecorder,
    events: Array.isArray(queue) ? queue : [],
    url: (() => { try { return location.href } catch (err) { return '' } })()
  }
})()`;
/** 候选唯一性校验（页面内，纯 CSS；Playwright 专属选择器会整体回退原候选）。 */
const CHECK_CANDIDATES_EXPRESSION = `return (function (candidates) {
  const kept = []
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]
    try {
      if (document.querySelectorAll(candidate).length === 1) kept.push(candidate)
    } catch (err) {
      return candidates
    }
  }
  return kept.length > 0 ? kept : candidates
})(arguments[0])`;
/** 共享浏览器引擎：录制/点选走 seam，回放交给 shared-run。 */
var SharedBrowserEngine = class {
	io;
	kind = "shared";
	label = "共享浏览器（dsh-builtin-browser）";
	managesCookies = true;
	sessions = /* @__PURE__ */ new Map();
	constructor(io) {
		this.io = io;
	}
	available() {
		return this.io.resolveSeam() !== void 0;
	}
	async open(args) {
		const seam = this.io.resolveSeam();
		if (seam === void 0) return {
			ok: false,
			error: "共享浏览器不可用（宿主没有注册 ctx.browser：请安装/启用 dsh-builtin-browser）"
		};
		const owner = args.owner ?? this.io.resolveOwner();
		if (owner === void 0 || owner === "") return {
			ok: false,
			error: "无法确定当前 DSH 对话 id（ctx.agents 不可用）：共享浏览器需要按对话打开右侧栏面板；请改用 uiTestBrowser=playwright，或重启 DSH 后重试"
		};
		let sessionId;
		try {
			sessionId = await seam.open(owner);
		} catch (error) {
			return {
				ok: false,
				error: messageOf(error)
			};
		}
		const session = {
			seam,
			sessionId,
			startUrl: args.startUrl,
			viewport: args.viewport ?? {
				width: 1280,
				height: 720
			},
			startedAt: Date.now(),
			lastUrl: args.startUrl,
			recording: false,
			lastInjectAt: 0,
			polling: false
		};
		this.sessions.set(sessionId, session);
		try {
			await seam.openUrl(sessionId, { url: args.startUrl });
			await seam.waitFor(sessionId, {
				loaded: true,
				timeoutMs: args.navigationTimeoutMs ?? 2e4
			}).catch(() => void 0);
			session.lastUrl = await this.activeUrl(seam, sessionId) ?? args.startUrl;
		} catch (error) {
			this.sessions.delete(sessionId);
			await seam.close(sessionId).catch(() => void 0);
			return {
				ok: false,
				error: `共享浏览器打开页面失败：${messageOf(error)}`
			};
		}
		return {
			ok: true,
			sessionId,
			pageUrl: session.lastUrl
		};
	}
	async start(sessionId) {
		const session = this.sessions.get(sessionId);
		if (session === void 0) return {
			ok: false,
			error: `会话 ${sessionId} 不存在（可能已关闭）`
		};
		if (session.recording) return {
			ok: true,
			pageUrl: session.lastUrl,
			alreadyRecording: true
		};
		const injected = await this.injectRecorder(session);
		if (!injected.ok) return {
			ok: false,
			error: injected.error
		};
		session.core = new RecorderCore();
		session.recording = true;
		const interval = Math.max(50, this.io.pollIntervalMs ?? 350);
		session.timer = setInterval(() => {
			this.poll(session);
		}, interval);
		return {
			ok: true,
			pageUrl: session.lastUrl
		};
	}
	async stop(sessionId) {
		const session = this.sessions.get(sessionId);
		if (session === void 0) return {
			ok: false,
			error: `会话 ${sessionId} 不存在（可能已关闭）`
		};
		if (!session.recording) return {
			ok: false,
			error: `会话 ${sessionId} 没有在录制`
		};
		session.recording = false;
		if (session.timer !== void 0) clearInterval(session.timer);
		session.timer = void 0;
		const idleDeadline = Date.now() + 1e3;
		while (session.polling && Date.now() < idleDeadline) await new Promise((resolve) => setTimeout(resolve, 10));
		await this.execute(session, "(() => { if (window.__dfUiRecorder) window.__dfUiRecorder.active = false })()").catch(() => void 0);
		await this.poll(session);
		const core = session.core ?? new RecorderCore();
		const steps = await core.finalize((candidates) => this.checkCandidates(session, candidates));
		const result = core.result(steps, {
			startUrl: session.startUrl,
			viewport: session.viewport
		});
		session.core = void 0;
		return {
			ok: true,
			result
		};
	}
	async pickSelector(sessionId, timeoutMs) {
		const session = this.sessions.get(sessionId);
		if (session === void 0) return {
			ok: false,
			error: `会话 ${sessionId} 不存在（可能已关闭）`
		};
		if (session.recording) return {
			ok: false,
			error: "正在录制：先停止录制再点选元素（点选本身也会产生点击）"
		};
		await this.execute(session, SELECTOR_HELPER_SCRIPT).catch(() => void 0);
		const budget = Math.min(Math.max(timeoutMs ?? 12e4, 1e3), 12e4);
		const result = await session.seam.execute(session.sessionId, {
			script: PICKER_SCRIPT,
			timeoutMs: budget
		}).catch((error) => ({
			ok: false,
			exception: messageOf(error)
		}));
		if (!result.ok) return {
			ok: false,
			error: result.exception
		};
		const value = result.value;
		if (typeof value !== "object" || value === null) return {
			ok: false,
			error: "点选没有返回值"
		};
		return value;
	}
	async pageMeta(sessionId) {
		const session = this.sessions.get(sessionId);
		if (session === void 0) return {};
		const result = await this.execute(session, `(() => {
      const contentOf = (selector) => {
        try { const el = document.querySelector(selector); return el && el.getAttribute('content') ? el.getAttribute('content') : '' } catch (err) { return '' }
      }
      return {
        url: (() => { try { return location.href } catch (err) { return '' } })(),
        title: (() => { try { return document.title || '' } catch (err) { return '' } })(),
        siteName: contentOf('meta[property="og:site_name"]') || contentOf('meta[name="application-name"]') || contentOf('meta[name="apple-mobile-web-app-title"]')
      }
    })()`);
		if (!result.ok || typeof result.value !== "object" || result.value === null) return {};
		const value = result.value;
		return {
			...typeof value.url === "string" && value.url !== "" ? { url: value.url } : {},
			...typeof value.title === "string" && value.title !== "" ? { title: value.title } : {},
			...typeof value.siteName === "string" && value.siteName !== "" ? { siteName: value.siteName } : {}
		};
	}
	async cookiesOf(sessionId) {
		return [];
	}
	async close(sessionId) {
		const session = this.sessions.get(sessionId);
		if (session === void 0) return {
			ok: false,
			error: `会话 ${sessionId} 不存在（可能已关闭）`
		};
		if (session.timer !== void 0) clearInterval(session.timer);
		session.recording = false;
		this.sessions.delete(sessionId);
		try {
			await session.seam.close(sessionId);
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				error: messageOf(error)
			};
		}
	}
	list() {
		return [...this.sessions.values()].map((session) => ({
			sessionId: session.sessionId,
			pageUrl: session.lastUrl,
			recording: session.recording,
			startedAt: session.startedAt
		}));
	}
	pageUrlOf(sessionId) {
		return this.sessions.get(sessionId)?.lastUrl;
	}
	has(sessionId) {
		return this.sessions.has(sessionId);
	}
	async closeAll() {
		for (const sessionId of [...this.sessions.keys()]) await this.close(sessionId);
	}
	async run(doc, inputs, options) {
		const seam = this.io.resolveSeam();
		if (seam === void 0) throw new Error("共享浏览器不可用（宿主没有注册 ctx.browser）");
		const owner = options?.owner ?? this.io.resolveOwner();
		if (owner === void 0 || owner === "") throw new Error("无法确定当前 DSH 对话 id（共享浏览器需要按对话挂右侧栏面板）");
		return runUiScriptOnSeam({
			seam,
			owner,
			dataRoot: this.io.dataRoot,
			stepTimeoutMs: this.io.stepTimeoutMs
		}, doc, inputs, {
			slowMoMs: options?.slowMoMs ?? 0,
			highlightClicks: options?.highlightClicks ?? true,
			...options?.holdMs === void 0 ? {} : { holdMs: options.holdMs }
		});
	}
	async injectRecorder(session) {
		const helper = await this.execute(session, SELECTOR_HELPER_SCRIPT);
		if (!helper.ok) return {
			ok: false,
			error: `注入选择器脚本失败：${helper.exception}`
		};
		const recorder = await this.execute(session, RECORDER_SOURCE);
		if (!recorder.ok) return {
			ok: false,
			error: `注入录制脚本失败：${recorder.exception}`
		};
		session.lastInjectAt = Date.now();
		return { ok: true };
	}
	async poll(session) {
		if (session.polling) return;
		session.polling = true;
		try {
			const result = await this.execute(session, DRAIN_EXPRESSION);
			if (!result.ok) return;
			const value = result.value;
			if (typeof value !== "object" || value === null) return;
			const record = value;
			if (typeof record.url === "string" && record.url !== "") session.lastUrl = record.url;
			const events = Array.isArray(record.events) ? record.events : [];
			for (const event of events) session.core?.ingest(event);
			if (session.recording && record.installed !== true && Date.now() - session.lastInjectAt > 1e3) await this.injectRecorder(session);
		} finally {
			session.polling = false;
		}
	}
	async checkCandidates(session, candidates) {
		if (candidates.length === 0) return [];
		const result = await this.execute(session, CHECK_CANDIDATES_EXPRESSION, [candidates]);
		if (!result.ok) return candidates;
		const value = result.value;
		if (!Array.isArray(value)) return candidates;
		return normalizeCandidateList(value);
	}
	execute(session, script, args) {
		return session.seam.execute(session.sessionId, {
			script,
			...args === void 0 ? {} : { args },
			timeoutMs: this.io.stepTimeoutMs
		});
	}
	async activeUrl(seam, sessionId) {
		try {
			const tabs = await seam.listTabs(sessionId);
			return tabs.find((tab) => tab.active)?.url ?? tabs[0]?.url;
		} catch {
			return;
		}
	}
};
function messageOf(error) {
	return String(error?.message ?? error).slice(0, 500);
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
			this.sessions.get(sessionId)?.sink?.onSample(w);
		}, {
			...o.headless === void 0 ? {} : { headless: o.headless },
			...o.cookies === void 0 ? {} : { cookies: o.cookies },
			onPageMeta: (meta) => {
				const s = this.sessions.get(sessionId);
				if (s === void 0) return;
				if (s.sink?.onPageMeta !== void 0) s.sink.onPageMeta(meta);
				else s.pendingMeta = meta;
			}
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
	/** 绑定事件侧；兼容旧调用形态（只给 onSample 函数）与新形态（Sink 对象，含 onPageMeta）。 */
	bindSink(sessionId, sink) {
		const s = this.sessions.get(sessionId);
		if (s === void 0) return;
		const normalized = typeof sink === "function" ? { onSample: sink } : sink;
		s.sink = normalized;
		if (s.pendingMeta !== void 0) {
			const meta = s.pendingMeta;
			s.pendingMeta = void 0;
			normalized.onPageMeta?.(meta);
		}
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
			else if (spec.kind === "upload") await s.page.setInputFiles(spec.selector, spec.files, { timeout: 2e4 });
			else if (spec.kind === "eval") {
				const value = await s.page.evaluate(spec.script);
				return {
					ok: true,
					pageUrl: s.page.url(),
					value
				};
			} else if (spec.kind === "press") await s.page.keyboard.press(spec.key);
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
		const raw = await s.context.cookies();
		await s.browser.close().catch(() => void 0);
		this.sessions.delete(sessionId);
		return s.captureId === void 0 ? {
			ok: true,
			cookies: raw
		} : {
			ok: true,
			cookies: raw,
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
/** UI 测试纪律：录制/回放都是真浏览器操作，写操作必须用户确认。 */
const UI_TEST_POLICY = [
	"## dataforge-ui-test（浏览器录制 + 回放）",
	"- 录制分两步：先 dataforge_ui_record_open 让用户登录/导航，再 dataforge_ui_record_start；登录动作不要进脚本。",
	"- 停止录制用 dataforge_ui_record_stop（给 site/flow 默认落新版本）；密码/上传不进脚本，如实转述回执里的跳过计数。",
	"- 回放 dataforge_ui_run 不带 confirm 只出计划卡；click/submit/upload 可能产生真实业务写入，必须用户确认后带 confirm=true。",
	"- 失败先 dataforge_ui_runs(run_id) 看断在哪个步骤/断言，截图与现场 HTML 在回执里；不要盲目重跑写操作。",
	"- UI 脚本是项目资产（工作区 .dsh/dataforge/ui-tests），改脚本只经 dataforge_ui_script_upsert，不手改运行记录。"
].join("\n");
/** Trace → 自动编排纪律：草稿不执行，业务值不写死。 */
const TRACE_POLICY = [
	"## dataforge-trace（采集 → 自动编排草稿）",
	"- 自动编排先 dataforge_trace_get / dataforge_trace_analyze；低置信度绑定、动态值、正文截断都按 warning 如实转述。",
	"- dataforge_chain_draft 只生成草稿，不落盘、不执行；先审阅 warnings/validation，再让用户确认。",
	"- 保存用 dataforge_chain_upsert；执行用 dataforge_chain_run，不带 confirm 只出计划卡，写操作必须用户确认。",
	"- 业务值不写死：未绑定字段用 $inputs.<name>；组织/供应商/物料等映射走 dataforge_lookup，不手编编码。",
	"- 运行成功后用 dataforge_dataset_export(run_id) 导出 dataset/evidence；失败也要导出已有摘要。",
	"- UI 验收先 dataforge_ui_run（成功 success.png / 失败 failure.png+failure.html），再 dataset_export(ui_run_id) 生成截图证据。"
].join("\n");
/** 探索执行纪律：值来源必须诚实标注，写操作必须用户确认。 */
const EXPLORE_POLICY = [
	"## dataforge-explore（首跑试探）",
	"- 首跑用 dataforge_chain_probe 单节点试探；不要把整条不完整的链反复整链重跑。",
	"- probe 的 values 必须带 source：user / agent-inferred / upstream；agent-inferred 与 upstream 必须写 evidence，禁止把猜测标成 user。",
	"- 写操作（POST/PUT/PATCH/DELETE）必须经用户确认后带 confirm=true；没有确认只出计划卡。",
	"- probe 返回的 outputs 用来发现绑定边；回写只走 dataforge_chain_bind（只给边，自增版本；仍过 R-1 校验），不要手抄整份 YAML。",
	"- 复跑前后要对照时用 dataforge_chain_compare(runIds) 看入参/节点出参/状态差异，先对照再解释。",
	"- 结晶只经 dataforge_chain_crystallize：upstream 值绝不冻常量；agent-inferred 必须用户确认；复跑用 dataforge_chain_run.inputs。",
	"- 复跑失败先用 dataforge_chain_diagnose(run_id) 读断点/绑定边，再决定 probe 还是修链；不要盲目重跑写链。"
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
	let browserService;
	anyCtx.inject?.(["browser"], (svc) => {
		browserService = svc["browser"];
	});
	let agentsService;
	anyCtx.inject?.(["agents"], (svc) => {
		agentsService = svc["agents"];
	});
	const currentConversationId = () => {
		try {
			const list = agentsService?.list?.();
			const first = Array.isArray(list) ? list[0] : void 0;
			return typeof first?.id === "string" && first.id !== "" ? first.id : void 0;
		} catch {
			return;
		}
	};
	/**
	* 面板工作区的服务端兜底（R-2 编排页「白板」修复）。
	*
	* 面板请求没有 session 上下文；客户端会尽量带 `?workspace=`，但工作区快照到达前
	* （或宿主未注入 useWorkspaces 时）会缺参。此时不能回落到 DSH 进程 cwd（那是
	* profile 目录，永远没有链），而是取工作区注册表里最近更新的那个。
	*/
	let workspaceRegistryService;
	anyCtx.inject?.(["workspaceRegistry"], (svc) => {
		workspaceRegistryService = svc["workspaceRegistry"];
	});
	const latestWorkspacePath = () => {
		const rows = workspaceRegistryService?.list?.();
		if (!Array.isArray(rows) || rows.length === 0) return void 0;
		const valid = rows.filter((row) => typeof row?.path === "string" && row.path !== "");
		if (valid.length === 0) return void 0;
		valid.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
		return typeof valid[0]?.path === "string" ? valid[0].path : void 0;
	};
	/**
	* 面板兜底工作区：优先最近更新、且真的存在 dataforge 数据目录的工作区。
	*
	* 只取“最近更新”会把刚有活动的其他项目当成当前工作区，面板于是全空。
	* 这里只在兜底路径使用（客户端正常会带 workspace）；找不到 dataforge 数据时
	* 才退回最新工作区，保持诚实而不是猜。
	*/
	const latestDataforgeWorkspacePath = () => {
		const rows = workspaceRegistryService?.list?.();
		if (!Array.isArray(rows) || rows.length === 0) return latestWorkspacePath();
		const valid = rows.filter((row) => typeof row?.path === "string" && row.path !== "").filter((row) => existsSync(join(row.path, ".dsh", "dataforge")));
		if (valid.length === 0) return latestWorkspacePath();
		valid.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
		return typeof valid[0]?.path === "string" ? valid[0].path : latestWorkspacePath();
	};
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
	const traceDeps = {
		captureDbPath: join(config.dataRoot, "capture", "capture.sqlite"),
		samplesDir: join(config.dataRoot, "capture", "samples")
	};
	const chainDraftDeps = {
		...traceDeps,
		resolveWorkspaceRoot
	};
	const lookupDeps = {
		dataRoot: config.dataRoot,
		resolveWorkspaceRoot,
		pageReader: createPageLookupReader({
			channel: config.captureChromeChannel,
			timeoutMs: 15e3
		})
	};
	const captureNames = new CaptureNamesStore(join(config.dataRoot, "capture", "names.yaml"));
	const titleBackfill = new TitleBackfillService({
		store: captureDeps.store,
		openPage: openCapturingPage,
		channel: config.captureChromeChannel
	});
	const orchestrationDeps = {
		captureDbPath: join(config.dataRoot, "capture", "capture.sqlite"),
		resolveWorkspaceRoot
	};
	const credentialStorePath = config.chainCredentialPersistence ? join(config.dataRoot, "credentials", "cookies.json") : void 0;
	const chainRunDeps = {
		...orchestrationDeps,
		dataRoot: config.dataRoot,
		chain: {
			enabled: config.chainRunEnabled,
			nodeTimeoutSeconds: config.chainNodeTimeoutSeconds,
			concurrency: config.chainConcurrency,
			responseLimitBytes: config.chainResponseLimitBytes,
			foregroundTimeoutSeconds: config.timeoutSeconds
		},
		resolveJobs: () => jobsService,
		credentials: createCaptureCredentialProvider({
			dbPath: orchestrationDeps.captureDbPath,
			...credentialStorePath === void 0 ? {} : { storePath: credentialStorePath },
			cache: true
		}),
		...credentialStorePath === void 0 ? {} : { credentialStorePath }
	};
	const uiSessions = new UiRecordingSessions();
	const playwrightEngine = new PlaywrightBrowserEngine({
		sessions: uiSessions,
		channel: config.captureChromeChannel,
		run: (doc, inputs, options) => runUiScript({
			dataRoot: config.dataRoot,
			channel: config.captureChromeChannel,
			stepTimeoutMs: config.uiStepTimeoutSeconds * 1e3,
			loadCookies: (startUrl) => loadCookiesForStart(uiTestDeps, startUrl)
		}, {
			doc,
			inputs,
			...options?.headless === void 0 ? {} : { headless: options.headless },
			...options?.slowMoMs === void 0 ? {} : { slowMoMs: options.slowMoMs },
			...options?.highlightClicks === void 0 ? {} : { highlightClicks: options.highlightClicks },
			...options?.holdMs === void 0 ? {} : { holdMs: options.holdMs }
		})
	});
	const sharedEngine = new SharedBrowserEngine({
		resolveSeam: () => browserService,
		resolveOwner: currentConversationId,
		dataRoot: config.dataRoot,
		stepTimeoutMs: config.uiStepTimeoutSeconds * 1e3
	});
	const agentSessions = new AgentRecordingSessions({
		dataRoot: config.dataRoot,
		openBrowser: (options) => openUiBrowser({
			...options,
			channel: config.captureChromeChannel
		})
	});
	/** 按配置选当前引擎；显式选择不可用/未实现时带回退说明（application 会如实报错或降级）。 */
	const resolveUiEngine = () => {
		if (config.uiTestBrowser === "playwright") return { engine: playwrightEngine };
		if (config.uiTestBrowser === "shared") return sharedEngine.available() ? { engine: sharedEngine } : {
			engine: sharedEngine,
			degraded: "共享浏览器不可用：安装/启用 dsh-builtin-browser，或把 uiTestBrowser 改为 playwright"
		};
		if (config.uiTestBrowser === "cdp") return {
			engine: playwrightEngine,
			degraded: "cdp 引擎尚未实现：已回退 Playwright（实现同一 UiBrowserEngine 契约后在此切换）"
		};
		return sharedEngine.available() ? { engine: sharedEngine } : { engine: playwrightEngine };
	};
	let uiTestDeps;
	uiTestDeps = {
		resolveWorkspaceRoot,
		dataRoot: config.dataRoot,
		enabled: config.uiTestEnabled,
		...credentialStorePath === void 0 ? {} : { credentialStorePath },
		resolveEngine: resolveUiEngine,
		batchEngine: playwrightEngine,
		agentSessions,
		agentSecrets: config.uiAgentCredentials ?? {}
	};
	chainRunDeps.verifyUi = async (request) => {
		const value = await runUiScriptForTool(uiTestDeps, void 0, {
			site: request.site,
			flow: request.flow,
			...request.version === void 0 ? {} : { version: request.version },
			inputs: request.inputs,
			confirm: true,
			headless: true
		});
		const result = value.result;
		return {
			...result?.runId === void 0 ? {} : { runId: result.runId },
			...result === void 0 ? {} : { success: result.success },
			status: value.ok ? result?.success === true ? "success" : "failed" : "failed",
			...result?.screenshot === void 0 ? {} : { screenshot: result.screenshot },
			...value.message === void 0 ? {} : { message: value.message }
		};
	};
	anyCtx.inject?.(["webServer"], (webSvc) => {
		const effect = webSvc["effect"];
		const webServer = webSvc["webServer"];
		if (webServer === void 0 || typeof webServer.register !== "function") {
			logger?.info?.("webServer 服务不可用：采集面板数据路由未注册（工具面照常）");
			return;
		}
		const install = () => registerCapturePanelRoutes(webServer, {
			store: captureDeps.store,
			startCapture: (args) => startCapture(captureDeps, args),
			names: captureNames,
			retitle: titleBackfill,
			orchestration: createOrchestrationPanelHandler({
				resolveWorkspaceRoot: async () => latestDataforgeWorkspacePath() ?? await resolveWorkspaceRoot(void 0) ?? process.cwd(),
				fallbackWorkspaceRoot: async () => latestDataforgeWorkspacePath()
			}),
			uiTest: createUiTestPanelHandler({
				deps: uiTestDeps,
				resolveWorkspaceRoot: async () => latestDataforgeWorkspacePath() ?? await resolveWorkspaceRoot(void 0) ?? process.cwd()
			}),
			artifacts: createArtifactsPanelHandler({ dataRoot: config.dataRoot })
		});
		if (typeof effect === "function") effect(install, `${name}: capture panel routes`);
		else install();
		logger?.info?.(`采集面板数据路由已注册：${PANEL_API_PREFIX}（runs / cards / page-meta / names / retitle / captures / orchestration）`);
	});
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
			defineTraceGetTool(traceDeps),
			defineTraceAnalyzeTool(traceDeps),
			defineChainDraftTool(chainDraftDeps),
			defineLookupTool(lookupDeps),
			defineDatasetExportTool(config.dataRoot),
			defineBrowserOpenTool(captureDeps),
			defineBrowserActTool(captureDeps),
			defineBrowserSnapshotTool(captureDeps),
			defineBrowserCloseTool(captureDeps),
			defineLibraryImportTool(orchestrationDeps),
			defineChainUpsertTool(orchestrationDeps),
			defineChainGetTool(orchestrationDeps),
			defineChainBindTool(orchestrationDeps),
			defineChainRunTool(chainRunDeps),
			defineChainRunsTool(chainRunDeps),
			defineChainProbeTool(chainRunDeps),
			defineChainCrystalTool(chainRunDeps),
			defineChainDiagnoseTool(chainRunDeps),
			defineChainCompareTool(chainRunDeps),
			defineUiScriptGetTool(uiTestDeps),
			defineUiScriptUpsertTool(uiTestDeps),
			defineUiRecordOpenTool(uiTestDeps),
			defineUiRecordStartTool(uiTestDeps),
			defineUiRecordStopTool(uiTestDeps),
			defineUiRecordCloseTool(uiTestDeps),
			defineUiRunTool(uiTestDeps),
			defineUiRunsTool(uiTestDeps),
			defineUiBatchRunTool(uiTestDeps),
			defineUiAgentOpenTool(uiTestDeps),
			defineUiAgentActTool(uiTestDeps),
			defineUiAgentStopTool(uiTestDeps)
		]) tools.register(tool);
		logger?.info?.(`已注册 35 个工具：flows/run/status + capture/status/result/cancel + trace_get/trace_analyze/chain_draft/lookup/dataset_export + browser_open/act/snapshot/close + library_import/chain_upsert/chain_get/chain_bind/chain_run/chain_runs/chain_probe/chain_crystallize/chain_diagnose/chain_compare + ui_script_get/ui_script_upsert/ui_record_open/ui_record_start/ui_record_stop/ui_record_close/ui_run/ui_runs/ui_batch_run（引擎：${config.engineRoot}；数据根：${config.dataRoot}）`);
		if (!config.uiTestEnabled) logger?.info?.("UI 回放开关 uiTestEnabled=false：dataforge_ui_run 一律 ui-test-disabled");
		const selected = resolveUiEngine();
		logger?.info?.(`UI 测试浏览器引擎：${selected.engine.label}${selected.degraded === void 0 ? "" : `（${selected.degraded}）`}；共享浏览器${sharedEngine.available() ? "已就绪" : "未启用（安装/启用 dsh-builtin-browser 可切换）"}；批量回归固定 Playwright 无头`);
		if (!config.chainRunEnabled) logger?.info?.("执行开关 chainRunEnabled=false：dataforge_chain_run 一律 execution-disabled");
	});
	if (config.injectPolicy) try {
		const policy = loadPolicyText(config.engineRoot);
		const combined = `${policy.text}\n\n${CAPTURE_POLICY}\n\n${TRACE_POLICY}\n\n${EXPLORE_POLICY}\n\n${UI_TEST_POLICY}`;
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