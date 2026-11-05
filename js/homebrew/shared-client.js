import {SHARED_URL, entriesOf, changesBetween, stable} from "./shared-model.js";

const CACHE_KEY = "SHARED_HOMEBREW_CACHE_V1";
export class SharedHomebrewClient {
	constructor (brewUtil) { this.util = brewUtil; this.state = null; this.initializing = null; }
	async request (url, options = {}) {
		let response;
		try { response = await fetch(url, {...options, cache: "no-store", signal: AbortSignal.timeout(20000)}); } catch { throw new Error("Cannot reach the shared library. Your homebrew has not been published; keep your draft and try again."); }
		let result;
		try { result = await response.json(); } catch { throw new Error("Shared homebrew is unavailable on this server. Ask the site owner to start the updated server."); }
		if (!response.ok) throw new Error(result.error || "The shared library could not save this homebrew.");
		return result;
	}
	async init () {
		if (typeof window === "undefined" || globalThis.IS_VTT) return;
		return this.initializing ||= (async () => {
			try { this.state = await this.request(SHARED_URL); await this.cache(); } catch (error) {
				try { this.state = await localforage.getItem(CACHE_KEY); } catch { /* Offline cache is optional. */ }
				this.notice(this.state ? "Shared library is offline. Showing the last downloaded copy." : "Shared library unavailable. New saves need a connection to this site's server.");
			}
			this.timer = setInterval(() => this.poll(), 20000);
			document.addEventListener("visibilitychange", () => { if (!document.hidden) this.poll(); });
		})();
	}
	async cache () { try { await localforage.setItem(CACHE_KEY, this.state); } catch { /* A cache failure must not turn a successful server save into a reported failure. */ } }
	doc () {
		if (!this.state?.brew?._meta?.sources?.length) return null;
		return this.util._getBrewDoc({json: structuredClone(this.state.brew), url: SHARED_URL, filename: "Shared site homebrew", isLocal: true});
	}
	attach (docs) {
		const out = docs.filter(doc => doc.head.url !== SHARED_URL);
		const shared = this.doc(); if (shared) out.push(shared);
		return out;
	}
	dedupe (docs) {
		const shared = docs.find(doc => doc.head.url === SHARED_URL);
		if (!shared) return docs;
		const keys = new Set(entriesOf(shared.body).map(record => record.key));
		return docs.map(doc => {
			if (doc === shared) return doc;
			const copy = {...doc, body: {...doc.body}};
			for (const [prop, entries] of Object.entries(copy.body)) {
				if (prop !== "_meta" && Array.isArray(entries)) {
					copy.body[prop] = entries.filter(entry => !keys.has(entriesOf({[prop]: [entry]})[0].key));
					if (!copy.body[prop].length) delete copy.body[prop];
				}
			}
			return copy;
		});
	}
	async accept (state) {
		this.state = state;
		this.util._cache_brewsLocal = this.attach(this.util._cache_brewsLocal || []);
		this.util._cache_brews = this.util._cache_brewsProc = this.util._cache_metas = this.util._cache_sourceStyles = null;
		this.util._cache_iteration++;
		await this.cache();
		document.querySelector("#shared-homebrew-notice")?.remove();
		window.dispatchEvent(new CustomEvent("sharedHomebrewSaved", {detail: {revision: state.revision}}));
	}
	async publishChanges (before, after) {
		const payload = changesBetween(before, after);
		if (!entriesOf(payload.brew).length) return;
		await this.init();
		const state = await this.request(SHARED_URL, {method: "POST", headers: {"Content-Type": "application/json", "X-Homebrew-Share": "1"}, body: JSON.stringify(payload)});
		await this.accept(state);
	}
	async save (brew, {overwrite = false} = {}) {
		await this.init();
		const prior = new Map(entriesOf(this.state?.brew).map(record => [record.key, record.entry]));
		const expected = {};
		for (const record of entriesOf(brew)) {
			const old = prior.get(record.key);
			if (old && stable(old) !== stable(record.entry) && !overwrite) throw new Error(`“${record.entry.name || record.entry.id}” already exists in the shared library. Enable “Update matching shared entries” to replace the version you have loaded.`);
			expected[record.key] = overwrite ? old || null : null;
		}
		const state = await this.request(SHARED_URL, {method: "POST", headers: {"Content-Type": "application/json", "X-Homebrew-Share": "1"}, body: JSON.stringify({brew, expected})});
		await this.accept(state);
		return entriesOf(brew).length;
	}
	notice (message, reload = false) {
		let element = document.querySelector("#shared-homebrew-notice");
		if (!element) {
			element = document.createElement("div"); element.id = "shared-homebrew-notice"; element.setAttribute("role", "status");
			element.style.cssText = "position:fixed;bottom:12px;left:12px;max-width:min(480px,90vw);padding:12px;background:#234b70;color:white;border-radius:6px;z-index:10000;box-shadow:0 2px 8px #0005";
			document.body.append(element);
		}
		element.textContent = message;
		if (reload) { const button = document.createElement("button"); button.className = "ve-btn ve-btn-default ve-ml-2"; button.textContent = "Refresh"; button.onclick = () => location.reload(); element.append(button); }
	}
	async poll () {
		if (document.hidden || this.polling) return;
		this.polling = true;
		try {
			const {revision} = await this.request(`${SHARED_URL}/revision`);
			if (revision !== this.state?.revision) this.notice("Someone updated the shared homebrew library. Refresh to load their changes. Save any unfinished work first.", true);
			else document.querySelector("#shared-homebrew-notice")?.remove();
		} catch { /* Browsing continues using the cached library. Publishing still reports failures. */ } finally { this.polling = false; }
	}
}
