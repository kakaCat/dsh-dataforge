import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { createHash } from "node:crypto";
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
/** 语义化名称（§6.3 六要素之一）：method + 最后一个具名路径段（先过 {@link normalizeUrlForTemplate} 抽 {p}），全抽象时退回 host。 */
function semanticName(method, urlTemplate) {
	const pathOnly = normalizeUrlForTemplate(urlTemplate).urlTemplate.split("?")[0];
	let host = "";
	try {
		host = new URL(pathOnly, "http://capture.local").host;
	} catch {
		host = "";
	}
	const named = pathSegmentsOf(pathOnly).filter((s) => s !== "{p}");
	const last = named[named.length - 1] ?? "";
	return last === "" ? `${method} ${host}` : `${method} ${last}`;
}
const TOKEN_HEADERS = /* @__PURE__ */ new Set(["authorization", "proxy-authorization"]);
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
	const authHeader = [...lowerHeaders.keys()].find((k) => TOKEN_HEADERS.has(k));
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
	return {
		browser,
		context,
		page
	};
}

//#endregion
//#region src/capture/application.ts
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
/**
* 单次采集样本上限（§11 A9）：一次 run 至多入库 1000 条样本，超出如实弃采并在 run 上附 notice。
* 用模块常量而非 config 项——上限是采集纪律（验收基准），不是部署调参。
*/
const SAMPLE_LIMIT_PER_RUN = 1e3;
function newCardAcc() {
	return {
		acc: newRequestSamplesAcc(),
		responseTexts: [],
		pageUrls: /* @__PURE__ */ new Set(),
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
		const pageId = pageIdOf(w.pageUrl);
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
		cardAcc.pageUrls.add(w.pageUrl);
		cardAcc.sampleTotal += 1;
		if (typeof raw.responseBody === "string" && raw.responseBody !== "") pushCapped(cardAcc.responseTexts, raw.responseBody, CARD_ACC_SAMPLE_CAP);
		const auth = classifyAuth(raw.url, w.requestHeaders, raw.requestBody);
		const cardId = deps.store.upsertCard(captureId, {
			mergeKey,
			method: raw.method,
			urlTemplate,
			name: semanticName(raw.method, urlTemplate),
			relatedPageUrls: [...cardAcc.pageUrls],
			requestTemplate: buildRequestTemplate({
				acc: cardAcc.acc,
				sampleTotal: cardAcc.sampleTotal
			}),
			responseTemplate: buildResponseTemplate(cardAcc.responseTexts),
			...auth.authType === void 0 ? {} : { authType: auth.authType },
			...auth.evidence === void 0 ? {} : { authEvidence: auth.evidence }
		});
		const relationId = deps.store.upsertRelation(captureId, cardId, w.pageUrl, paramsFingerprintOf(raw.url, raw.requestBody), pageId);
		deps.store.attachSampleRelation(sampleId, relationId);
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
		return { failure: errText(err) };
	}
	if (started === void 0 || started === null) return { failure: "empty-handle" };
	const maybeThenable = started;
	if (typeof maybeThenable.then === "function" && typeof maybeThenable.catch === "function") maybeThenable.catch((err) => {
		onAsyncFailure(errText(err));
	});
	return { started };
}
function errText(err) {
	const message = err?.message;
	return (typeof message === "string" && message.length > 0 ? message : String(err)).slice(0, 200);
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
		deps.registry.bindSink(sessionId, wireToStore(deps, captureId, /* @__PURE__ */ new Map()));
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
								if (e.kind === "page") {
									const pageId = deps.store.upsertPage(captureId, e.url, 0, "ok");
									if (!pageIds.has(e.url)) pageIds.set(e.url, pageId);
								}
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
function fieldTypeOf(value) {
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
		type: fieldTypeOf(record["type"]),
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
		type: fieldTypeOf(record["type"])
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
function parseJson(text) {
	if (text === null || text === "") return void 0;
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
}
function parseStringArray(text) {
	const parsed = parseJson(text);
	return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
}
/** 模板 JSON → Template；**存在但解析不出形状**返回 'broken'（调用方按坏卡跳过）。 */
function parseTemplate(text) {
	if (text === null || text === "") return void 0;
	const parsed = parseJson(text);
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
	const parsed = parseJson(text);
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
function projectCard(card, relations) {
	if (card.method === "") return { reason: "采集卡缺 method" };
	if (card.urlTemplate === "") return { reason: "采集卡缺 urlTemplate" };
	const requestTemplate = parseTemplate(card.requestTemplateJson ?? null);
	if (requestTemplate === "broken") return { reason: "请求模板 JSON 结构损坏" };
	const responseTemplate = parseTemplate(card.responseTemplateJson ?? null);
	if (responseTemplate === "broken") return { reason: "响应模板 JSON 结构损坏" };
	const urlTemplate = normalizeUrlForTemplate(card.urlTemplate).urlTemplate;
	const mergeKey = mergeKeyOf(card.method, urlTemplate);
	if (mergeKey === "") return { reason: "归并键为空" };
	const pages = [.../* @__PURE__ */ new Set([...parseStringArray(card.relatedPagesJson), ...relations.map((row) => row.pageUrl)])].filter((page) => page !== "");
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
		hit.pages = [.../* @__PURE__ */ new Set([...hit.pages, ...source.pages])];
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
		const projection = projectCard(raw, relationsByCard.get(raw.id) ?? []);
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
	sources: Schema.array(CardSourceSchema),
	name: Schema.string()
});
/** 常量值允许裸写数字/布尔（YAML 里 2120 不是字符串），落地时统一成字符串。 */
const ConstantValueSchema = Schema.union([
	Schema.string(),
	Schema.number(),
	Schema.boolean()
]);
const NodeSchema = Schema.object({
	id: Schema.string().required(),
	card: Schema.string(),
	page: Schema.string(),
	constants: Schema.dict(ConstantValueSchema).default({}),
	retry: Schema.number().min(0),
	timeoutSeconds: Schema.number().min(0)
});
const EdgeSchema = Schema.object({
	from: Schema.string().required(),
	to: Schema.string().required(),
	suggested: Schema.boolean()
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
	created: Schema.string().required()
});
const ChainSchema = Schema.object({
	apiVersion: Schema.string().required(),
	kind: Schema.union([Schema.const("interface-chain"), Schema.const("page-chain")]).required(),
	meta: MetaSchema.required(),
	inputs: Schema.array(InputSchema).default([]),
	nodes: Schema.array(NodeSchema).required(),
	edges: Schema.array(EdgeSchema).default([])
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
function issueOfSchemaFailure(error) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		target: issueTargetOf(schemaErrorPath(message)),
		code: "invalid-chain",
		reason: `schema 校验失败：${message}`
	};
}
/** 把 schema 产物收敛成规范化的 ChainDoc（默认值补齐 + 常量统一成字符串）。 */
function normalizeDoc(raw) {
	const doc = raw;
	return {
		...unknownKeysOf(doc),
		apiVersion: doc.apiVersion,
		kind: doc.kind,
		meta: {
			...unknownKeysOf(doc.meta),
			site: doc.meta.site,
			flow: doc.meta.flow,
			version: doc.meta.version,
			created: toIsoString(doc.meta.created)
		},
		inputs: (doc.inputs ?? []).map((input) => ({
			...unknownKeysOf(input),
			name: input.name,
			type: input.type,
			required: input.required === true,
			...input.example === void 0 ? {} : { example: input.example }
		})),
		nodes: (doc.nodes ?? []).map((node) => ({
			...unknownKeysOf(node),
			id: node.id,
			...node.card === void 0 ? {} : { card: node.card },
			...node.page === void 0 ? {} : { page: node.page },
			constants: Object.fromEntries(Object.entries(node.constants ?? {}).map(([key, value]) => [key, String(value)])),
			...node.retry === void 0 ? {} : { retry: node.retry },
			...node.timeoutSeconds === void 0 ? {} : { timeoutSeconds: node.timeoutSeconds }
		})),
		edges: (doc.edges ?? []).map((edge) => ({
			...unknownKeysOf(edge),
			from: edge.from,
			to: edge.to,
			...edge.suggested === true ? { suggested: true } : {}
		}))
	};
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
		raw = loadYamlValue(text);
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
function loadYamlValue(text) {
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
		constantsOf.set(node.id, keys);
	});
	if (doc.kind === "page-chain") checkPageEdges(doc, nodeIds, issues);
	else checkInterfaceEdges(doc, nodeIds, cards, constantsOf, declaredSlots, referencedSlots, issues);
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
				if (card && !isFieldDeclared(from.fieldPath, card.outputs)) issues.push({
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
function requireSlug(name, what) {
	const slug = slugOf(name);
	if (slug.length === 0) throw Object.assign(/* @__PURE__ */ new Error(`${what} "${String(name)}" 不能作为目录名（为空或只含路径分隔符）`), { code: "invalid-chain" });
	return slug;
}
/** 链版本目录：`chains/<siteSlug>/<flowSlug>`。 */
function chainDir(workspaceRoot, site, flow) {
	return join(chainsRoot(workspaceRoot), requireSlug(site, "site"), requireSlug(flow, "flow"));
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
	const finalDoc = {
		...doc,
		meta: {
			...doc.meta,
			version,
			created
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
			const parsed = loadYamlValue(readFileSync(path, "utf8"));
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
/** 逐条问题时给模型看的行：`nodes[0]: reason`。 */
function issueLines(issues) {
	return issues.map((issue) => `${issue.target}：${issue.reason}`);
}
function toChainIssues(issues) {
	return issues.map((issue) => ({
		target: issue.target,
		code: issue.code,
		reason: issue.reason
	}));
}
function messageOf(error) {
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
			message: `解析工作区根失败：${messageOf(error)}`,
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
			message: `导入接口库失败：${messageOf(error)}`,
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
		const saved = saveChain(workspaceRoot, args.chainYaml);
		if (!saved.ok) return {
			ok: false,
			code: saved.issues.some((issue) => issue.code === "card-not-imported") ? "card-not-imported" : "invalid-chain",
			message: saved.issues.some((issue) => issue.code === "card-not-imported") ? "链引用的接口卡不在项目接口库：先跑 dataforge_library_import" : `链未通过校验（${saved.issues.length} 条）：修好再提交，没有落盘`,
			issues: toChainIssues(saved.issues)
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
			message: `落盘链失败：${messageOf(error)}`
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
		..."issues" in loaded && loaded.issues !== void 0 ? { issues: toChainIssues(loaded.issues) } : {},
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
			return lossless(runStatus(deps, args.run_id));
		}
	});
}
function renderCapture(value) {
	if (!value.accepted) return value.card ?? "❌ 采集请求未被接受（缺细节）";
	if (value.sessionId !== void 0) return `✅ 已开会话 ${value.sessionId}（captureId ${value.captureId ?? "?"}）：用 dataforge_browser_snapshot 看 UI、dataforge_browser_act 交互；结束后 dataforge_browser_close 收 cookie。`;
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
				...args.max_pages === void 0 ? {} : { maxPages: args.max_pages }
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
			return lossless(deps.registry.open(args.entry_url === void 0 ? {} : { entryUrl: args.entry_url }));
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
			const closed = await deps.registry.close(args.session_id);
			if (closed.captureId !== void 0) {
				for (const c of closed.cookies) deps.store.upsertCredential(closed.captureId, "cookie", String(c["domain"] ?? ""), String(c["name"] ?? ""), Date.now(), c);
				if (deps.store.getRun(closed.captureId)?.status === "running") deps.store.finishRun(closed.captureId, "done");
			}
			const summarized = {
				ok: closed.ok,
				cookies: closed.cookies.map((c) => ({
					name: String(c["name"] ?? ""),
					domain: String(c["domain"] ?? "")
				})),
				...closed.captureId === void 0 ? {} : { captureId: closed.captureId }
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
  depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', visited_at INTEGER NOT NULL
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
	const auth = optRecord(row["auth_json"]);
	const authType = typeof auth?.["authType"] === "string" ? auth["authType"] : void 0;
	const authEvidence = typeof auth?.["authEvidence"] === "string" ? auth["authEvidence"] : void 0;
	const authBinding = auth === void 0 ? void 0 : Object.fromEntries(Object.entries(auth).filter(([k]) => k === "cookies" || k === "storageKeys"));
	return {
		id: String(row["id"]),
		captureId: String(row["capture_id"]),
		name: optString(row["name"]),
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
//#region src/capture/panel-routes.ts
const PANEL_API_PREFIX = "/dashboard/api/dataforge";
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 500;
const RUN_DETAIL_CARDS_LIMIT = 200;
const RUN_DETAIL_RELATIONS_LIMIT = 500;
/** 写入口请求体上限：面板只需要 {taskType, entryUrl}，超过这个尺寸一律 413。 */
const MAX_CAPTURE_BODY_BYTES = 8192;
/**
* 构造面板数据 handler。
*
* URL 两种形态都接受：宿主可能传完整路径（前缀含在 url 里）或剥好前缀的剩余路径。
* GET 面只读；唯一的写入口 POST /captures（发起单页采集），其余方法一律 405。
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
				fail(res, 405, `面板路由不支持 ${method} ${suffix}（写入口仅 POST /captures）`, "method-not-allowed");
				return;
			}
			if (method !== "GET") {
				fail(res, 405, `面板路由只支持 GET/POST /captures，收到 ${method}`, "method-not-allowed");
				return;
			}
			if (suffix === "/runs") {
				ok(res, {
					generatedAt: Date.now(),
					runs: deps.store.listRuns(clampLimit(url.searchParams.get("limit"), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT))
				});
				return;
			}
			if (suffix.startsWith("/runs/")) {
				const id = decodeURIComponent(suffix.slice(6));
				if (id.length === 0 || id.includes("/")) {
					fail(res, 404, `不认识的路径：${suffix}`, "unknown-path");
					return;
				}
				const run = deps.store.getRun(id);
				if (run === void 0) {
					fail(res, 404, `采集运行 ${id} 不存在`, "not-found");
					return;
				}
				ok(res, {
					generatedAt: Date.now(),
					run,
					pages: deps.store.listPages(id, MAX_LIST_LIMIT),
					samples: deps.store.listSamples(id, MAX_LIST_LIMIT).map(sanitizeSample),
					credentials: deps.store.listCredentials(id, MAX_LIST_LIMIT).map(({ valueJson: _valueStaysInDb, ...rest }) => rest),
					cards: deps.store.listCards(id, RUN_DETAIL_CARDS_LIMIT),
					relations: deps.store.listRelations(id, RUN_DETAIL_RELATIONS_LIMIT)
				});
				return;
			}
			if (suffix === "/cards") {
				ok(res, {
					generatedAt: Date.now(),
					cards: deps.store.listAllCards(clampLimit(url.searchParams.get("limit"), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT), clampOffset(url.searchParams.get("offset"))),
					total: deps.store.countAllCards()
				});
				return;
			}
			fail(res, 404, `不认识的路径：${suffix}`, "unknown-path");
		} catch (err) {
			fail(res, 500, String(err?.message ?? err), "internal");
		}
	};
}
/** POST /captures：发起单页采集。FR-7.6 边界在闸内：body 里 taskType 只认 single_page，其余 400。 */
async function handleStartCapture(deps, req, res) {
	let body;
	try {
		body = JSON.parse(await readBody(req, MAX_CAPTURE_BODY_BYTES) || "{}");
	} catch (err) {
		if (err instanceof BodyTooLargeError) {
			fail(res, 413, `请求体超过 ${MAX_CAPTURE_BODY_BYTES} 字节`, "body-too-large");
			return;
		}
		fail(res, 400, "请求体不是合法 JSON", "bad-json");
		return;
	}
	const record = typeof body === "object" && body !== null ? body : {};
	const taskType = record["taskType"] === void 0 ? "single_page" : record["taskType"];
	if (taskType !== "single_page") {
		fail(res, 400, `面板只能发起 single_page 采集，收到 ${String(taskType)}（写操作/爬取走 agent 入口 dataforge_capture）`, "bad-task-type");
		return;
	}
	if (typeof record["entryUrl"] !== "string" || record["entryUrl"].length === 0) {
		fail(res, 400, "缺少 entryUrl（字符串）", "bad-entry-url");
		return;
	}
	const entryUrl = record["entryUrl"];
	let entry;
	try {
		entry = new URL(entryUrl);
	} catch {
		fail(res, 400, `entryUrl 不是合法 URL：${entryUrl.slice(0, 200)}`, "bad-entry-url");
		return;
	}
	if (entry.protocol !== "http:" && entry.protocol !== "https:") {
		fail(res, 400, `只支持 http/https 入口，收到 ${entry.protocol}`, "bad-entry-url");
		return;
	}
	const blocked = blockedTargetReason(entry.hostname);
	if (blocked !== void 0) {
		fail(res, 400, `拒绝采集 ${entry.hostname}：${blocked}`, "blocked-target");
		return;
	}
	const busy = deps.store.listRuns(200).find((run) => run.status === "running" && sameHost(run.entryUrl, entry));
	if (busy !== void 0) {
		fail(res, 409, `该站点已有进行中的采集（${busy.id}），等它收口后再发起`, "host-busy");
		return;
	}
	if (deps.startCapture === void 0) {
		fail(res, 503, "采集发起未装配（startCapture 未注入）", "capture-not-wired");
		return;
	}
	let result;
	try {
		result = await deps.startCapture({
			taskType,
			entryUrl
		});
	} catch (err) {
		fail(res, 500, String(err?.message ?? err), "capture-start-failed");
		return;
	}
	ok(res, {
		accepted: result.accepted,
		gate: result.gate,
		captureId: result.captureId,
		...result.degradedNotice === void 0 ? {} : { degradedNotice: result.degradedNotice },
		card: result.card
	});
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
var BodyTooLargeError = class extends Error {};
function readBody(req, maxBytes) {
	return new Promise((resolve, reject) => {
		let total = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			total += chunk.length;
			if (total > maxBytes) {
				reject(new BodyTooLargeError("request body too large"));
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
	const dispose = webServer.register({
		kind: "prefix",
		path: PANEL_API_PREFIX,
		handler: createCapturePanelHandler(deps)
	});
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		dispose();
	};
}
function ok(res, data) {
	send(res, 200, {
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
function fail(res, status, error, code) {
	send(res, status, code === void 0 ? {
		success: false,
		error
	} : {
		success: false,
		error,
		code
	});
}
function send(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}
function clampLimit(raw, fallback, max) {
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
	const orchestrationDeps = {
		captureDbPath: join(config.dataRoot, "capture", "capture.sqlite"),
		resolveWorkspaceRoot
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
			startCapture: (args) => startCapture(captureDeps, args)
		});
		if (typeof effect === "function") effect(install, `${name}: capture panel routes`);
		else install();
		logger?.info?.(`采集面板数据路由已注册：${PANEL_API_PREFIX}（runs / cards / captures）`);
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
			defineBrowserOpenTool(captureDeps),
			defineBrowserActTool(captureDeps),
			defineBrowserSnapshotTool(captureDeps),
			defineBrowserCloseTool(captureDeps),
			defineLibraryImportTool(orchestrationDeps),
			defineChainUpsertTool(orchestrationDeps),
			defineChainGetTool(orchestrationDeps)
		]) tools.register(tool);
		logger?.info?.(`已注册 14 个工具：flows/run/status + capture/status/result/cancel + browser_open/act/snapshot/close + library_import/chain_upsert/chain_get（引擎：${config.engineRoot}；数据根：${config.dataRoot}）`);
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