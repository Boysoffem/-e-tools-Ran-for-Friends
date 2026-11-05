import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import validate from "../js/homebrew/schema-validator.js";
import {entriesOf, sharedKey, stable} from "../js/homebrew/shared-model.js";

const fail = (status, message) => Object.assign(new Error(message), {status});
const MAX_BODY = 25 * 1024 * 1024;
function assertSafe (value) {
	if (typeof value === "string" && (/<\/?[a-z][^>]*>/i.test(value) || /(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i.test(value))) throw fail(400, "Shared homebrew cannot contain raw HTML or executable links. Use 5etools formatting tags instead.");
	if (Array.isArray(value)) for (const item of value) assertSafe(item);
	else if (value && typeof value === "object") {
		for (const [key, item] of Object.entries(value)) {
			if (["__proto__", "prototype", "constructor"].includes(key)) throw fail(400, "Invalid object key.");
			assertSafe(item);
		}
	}
}
export function normalizeBrew (input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw fail(400, "Homebrew must be an object.");
	assertSafe(input);
	const brew = structuredClone(input);
	delete brew.siteVersion; delete brew.fileType;
	const now = Math.floor(Date.now() / 1000);
	brew._meta = {dateAdded: now, dateLastModified: now, edition: "classic", ...brew._meta};
	if (!Array.isArray(brew._meta.sources) || !brew._meta.sources.length) throw fail(400, "Homebrew needs source details.");
	brew._meta.sources = brew._meta.sources.map(source => ({version: "1.0.0", ...source}));
	const records = entriesOf(brew);
	if (!records.length) throw fail(400, "No homebrew entries to share.");
	const keys = new Set();
	const sources = new Set(brew._meta.sources.map(source => source.json));
	for (const {prop, entry, key} of records) {
		if (!(entry.name || entry.id) || !sources.has(entry.source)) throw fail(400, `${prop}: every entry needs an identity and matching source details.`);
		if (keys.has(key)) throw fail(400, `Duplicate entry: ${entry.name || entry.id}.`);
		keys.add(key);
	}
	for (const [prop, items] of Object.entries(brew)) if (prop !== "_meta" && Array.isArray(items)) brew[prop] = items.map(item => { const out = {...item}; delete out.uniqueId; return out; });
	if (!validate(brew)) throw fail(400, `Invalid 5etools homebrew: ${validate.errors.slice(0, 4).map(error => `${error.instancePath}: ${error.message}`).join("; ")}`);
	return brew;
}
export class SharedHomebrewStore {
	constructor (directory) { this.directory = path.resolve(directory); this.file = path.join(this.directory, "library.json"); this.queue = Promise.resolve(); }
	async read () {
		if (this._state) return this._state;
		try {
			const state = JSON.parse(await fs.readFile(this.file, "utf8"));
			if (state.version !== 1 || !Number.isInteger(state.revision) || !state.brew?._meta?.sources) throw new Error("Invalid shared library file");
			return this._state = state;
		} catch (error) {
			if (error.code === "ENOENT") return this._state = {version: 1, revision: 0, brew: {_meta: {sources: []}}};
			throw error;
		}
	}
	publish (payload) {
		const operation = this.queue.then(() => this._publish(payload));
		this.queue = operation.catch(() => {});
		return operation;
	}
	async _publish ({brew: input, expected = {}} = {}) {
		const incoming = normalizeBrew(input);
		if (!expected || typeof expected !== "object" || Array.isArray(expected)) throw fail(400, "Invalid change baseline.");
		const state = await this.read();
		const next = structuredClone(state);
		const existing = new Map(entriesOf(next.brew).map(record => [record.key, record]));
		let changed = 0;
		for (const record of entriesOf(incoming)) {
			const old = existing.get(record.key);
			if (old && stable(old.entry) === stable(record.entry)) continue;
			if (old && (!expected[record.key] || stable(old.entry) !== stable(expected[record.key]))) throw fail(409, `“${record.entry.name || record.entry.id}” already exists or was changed by someone else. Refresh to get the latest version before updating it.`);
			const list = next.brew[record.prop] ||= [];
			const index = list.findIndex(entry => sharedKey(record.prop, entry) === record.key);
			if (index < 0) list.push(record.entry); else list[index] = record.entry;
			changed++;
		}
		for (const source of incoming._meta.sources) {
			const old = next.brew._meta.sources.find(it => it.json.toLowerCase() === source.json.toLowerCase());
			if (old && (old.json !== source.json || old.full !== source.full)) throw fail(409, `Source ID ${source.json} already belongs to “${old.full}”. Choose a different source ID.`);
			if (!old) next.brew._meta.sources.push(source);
		}
		// Preserve custom metadata needed to render entries; reject conflicting definitions.
		for (const [key, value] of Object.entries(incoming._meta)) {
			if (["sources", "dateAdded", "dateLastModified", "edition"].includes(key)) continue;
			if (next.brew._meta[key] && stable(next.brew._meta[key]) !== stable(value)) throw fail(409, `Shared source metadata differs (${key}). Use a separate collection or resolve it with the site owner.`);
			next.brew._meta[key] = value;
		}
		if (!changed) return state;
		const now = Math.floor(Date.now() / 1000);
		next.brew._meta.dateAdded ||= now;
		next.brew._meta.dateLastModified = now;
		next.brew._meta.edition ||= incoming._meta.edition;
		next.revision++;
		const serialized = JSON.stringify(next);
		if (Buffer.byteLength(serialized) > 150 * 1024 * 1024) throw fail(413, "The shared library has reached its storage limit. Ask the site owner to archive older content.");
		await fs.mkdir(this.directory, {recursive: true});
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		try {
			const handle = await fs.open(temporary, "wx", 0o600);
			try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
			try { await fs.copyFile(this.file, `${this.file}.backup`); } catch (error) { if (error.code !== "ENOENT") throw error; }
			await fs.rename(temporary, this.file);
		} finally { await fs.rm(temporary, {force: true}); }
		this._state = next;
		return next;
	}
}
export function createSharedHomebrewHandler (store) {
	return async (req, res) => {
		const pathname = new URL(req.url, "http://localhost").pathname;
		if (!["/api/shared-homebrew", "/api/shared-homebrew/revision"].includes(pathname)) return false;
		const send = (code, data) => { res.writeHead(code, {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}); res.end(JSON.stringify(data)); };
		try {
			if (req.method === "GET") { const state = await store.read(); send(200, pathname.endsWith("/revision") ? {revision: state.revision} : state); return true; }
			if (req.method !== "POST" || pathname.endsWith("/revision")) { send(405, {error: "Method not allowed"}); return true; }
			if (req.headers["x-homebrew-share"] !== "1" || !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw fail(403, "Use the homebrew tools on this site to publish.");
			if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw fail(403, "Cross-site publishing is not allowed.");
			if (req.headers["sec-fetch-site"] === "cross-site") throw fail(403, "Cross-site publishing is not allowed.");
			if (Number(req.headers["content-length"]) > MAX_BODY) throw fail(413, "Homebrew upload is over 25 MB. Split it into smaller collections.");
			let size = 0; const chunks = [];
			for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw fail(413, "Homebrew upload is over 25 MB. Split it into smaller collections."); chunks.push(chunk); }
			let payload;
			try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw fail(400, "Invalid JSON."); }
			const state = await store.publish(payload);
			send(200, state);
		} catch (error) { send(error.status || 500, {error: error.status ? error.message : "Shared library could not be read or saved. Nothing was published; please try again."}); }
		return true;
	};
}
