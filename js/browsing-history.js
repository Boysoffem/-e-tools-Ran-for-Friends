// History stays in this browser. Only the existing session endpoint is contacted;
// page URLs, titles, timestamps, and preferences are never uploaded.
export const HISTORY_PREFIX = "five:browsing-history:v1:";
export const ACCOUNT_STATE_KEY = "five:history-account:v1";
export const HISTORY_LIMIT = 100;

export function historyKeyFor (user) {
	return /^[a-f0-9]{64}$/.test(user?.historyKey || "") ? `${HISTORY_PREFIX}${user.historyKey}` : null;
}

export function syncHistoryAccount (user) {
	try {
		const key = historyKeyFor(user) || "";
		if (localStorage.getItem(ACCOUNT_STATE_KEY) !== key) localStorage.setItem(ACCOUNT_STATE_KEY, key);
	} catch { /* Browsing and sign-in still work when local storage is blocked. */ }
}

export async function fetchAccountSession () {
	const response = await fetch("/api/auth/session", {cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000)});
	if (!response.ok) throw new Error("Account status is unavailable.");
	const session = await response.json();
	syncHistoryAccount(session.user);
	return session;
}

export function historyUrl (value, origin = location.origin) {
	if (typeof value !== "string" || value.length > 2000) return null;
	try {
		const url = new URL(value, origin);
		if (url.origin !== origin || url.username || url.password) return null;
		const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
		if (!/^\/[a-z0-9-]+\.html$/i.test(pathname) || /^\/(?:login|admin-accounts)\.html$/i.test(pathname)) return null;
		// Search strings can contain credentials or other transient form values.
		return pathname + url.hash;
	} catch { return null; }
}

export function readHistory (key) {
	if (!key?.startsWith(HISTORY_PREFIX)) throw new Error("Sign in to view history.");
	const raw = localStorage.getItem(key);
	let saved;
	try { saved = raw ? JSON.parse(raw) : {}; } catch { saved = {}; }
	const seen = new Set();
	const entries = (Array.isArray(saved?.entries) ? saved.entries : []).flatMap(entry => {
		const url = historyUrl(entry?.url);
		if (!url || seen.has(url) || typeof entry.title !== "string" || !Number.isSafeInteger(entry.visitedAt) || entry.visitedAt <= 0 || entry.visitedAt > Date.now() + 60_000) return [];
		seen.add(url);
		return [{url, title: entry.title.slice(0, 300), visitedAt: entry.visitedAt}];
	}).sort((a, b) => b.visitedAt - a.visitedAt).slice(0, HISTORY_LIMIT);
	return {paused: saved?.paused === true, entries};
}

export function changeHistory (key, change) {
	const saved = readHistory(key);
	change(saved);
	localStorage.setItem(key, JSON.stringify(saved));
	return saved;
}

export function startBrowsingHistory (user) {
	const key = historyKeyFor(user);
	if (!key) return;
	let timer;
	let generation = 0;
	let pendingVisit = false;
	const schedule = (isVisit = false) => {
		clearTimeout(timer);
		pendingVisit ||= isVisit;
		const currentGeneration = ++generation;
		const url = historyUrl(location.href);
		if (!url || document.visibilityState === "hidden") return;
		timer = setTimeout(async () => {
			const isNewVisit = pendingVisit;
			try {
				// Re-check expiry and account switches before every write. An old tab
				// must never assign the previous person's page to a different account.
				const session = await fetchAccountSession();
				if (currentGeneration !== generation || key !== historyKeyFor(session.user) || url !== historyUrl(location.href)) return;
				pendingVisit = false;
				changeHistory(key, saved => {
					if (saved.paused) return;
					const title = document.title.trim().slice(0, 300) || url;
					const existing = saved.entries.find(entry => entry.url === url);
					if (!isNewVisit) {
						// Late title updates do not resurrect a removed or cleared visit.
						if (existing) existing.title = title;
						return;
					}
					saved.entries = [{url, title, visitedAt: Date.now()}, ...saved.entries.filter(entry => entry.url !== url)].slice(0, HISTORY_LIMIT);
				});
			} catch { /* Never fall back to server storage or interrupt the page. */ }
		}, 250);
	};
	const cancel = () => { clearTimeout(timer); generation++; pendingVisit = false; };
	window.addEventListener("hashchange", () => schedule(true));
	window.addEventListener("popstate", () => schedule(true));
	window.addEventListener("pagehide", cancel);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") { clearTimeout(timer); generation++; } else if (pendingVisit) schedule();
	});
	window.addEventListener("storage", event => {
		if (event.key === ACCOUNT_STATE_KEY || event.key === null) { cancel(); return; }
		if (event.key !== key) return;
		try {
			const previous = JSON.parse(event.oldValue || "{}");
			const next = JSON.parse(event.newValue || "{}");
			const url = historyUrl(location.href);
			if (next.paused || !next.entries?.length || (previous.entries?.some(entry => entry.url === url) && !next.entries.some(entry => entry.url === url))) cancel();
		} catch { cancel(); }
	});
	window.addEventListener("pageshow", event => { if (event.persisted) schedule(true); });
	const title = document.querySelector("title");
	if (title) new MutationObserver(() => schedule()).observe(title, {childList: true, characterData: true, subtree: true});
	schedule(true);
}
