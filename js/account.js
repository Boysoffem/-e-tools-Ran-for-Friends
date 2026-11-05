import {ACCOUNT_STATE_KEY, changeHistory, fetchAccountSession, historyKeyFor, readHistory, syncHistoryAccount} from "./browsing-history.js";

const byId = id => document.getElementById(id);
const providerName = id => id === "google" ? "Google" : "GitHub";
const messages = {
	unavailable: "This sign-in option hasn't been connected yet. You can keep using the site.",
	expired: "That sign-in link expired or was already used. Please start again.",
	cancelled: "Sign-in was cancelled. You can try again or continue without an account.",
	failed: "Sign-in couldn't be completed. Please try again.",
	consent: "Please agree to share your account details before signing in.",
};
const params = new URLSearchParams(location.search);
const initialMessage = messages[params.get("error")] || (params.get("notice") === "admin" ? "Sign in with the designated administrator account to view the private list." : "");
if (location.search) history.replaceState(null, "", location.pathname + location.hash);
let currentHistoryKey = null;
let loadVersion = 0;

function hideHistory () {
	currentHistoryKey = null;
	byId("browsing-history").hidden = true;
	byId("history-list").replaceChildren();
}

function renderHistory () {
	if (!currentHistoryKey) return;
	byId("browsing-history").hidden = false;
	byId("history-list").replaceChildren();
	try {
		const saved = readHistory(currentHistoryKey);
		byId("history-pause").disabled = false;
		byId("history-pause").textContent = saved.paused ? "Resume history" : "Pause history";
		byId("history-pause").setAttribute("aria-pressed", String(saved.paused));
		byId("history-clear").disabled = !saved.entries.length;
		byId("history-status").textContent = saved.paused ? "History is paused. New visits will not be saved." : saved.entries.length ? `${saved.entries.length} recent ${saved.entries.length === 1 ? "page" : "pages"} on this browser.` : "No history yet. Pages you open while signed in will appear here.";
		for (const entry of saved.entries) {
			const row = document.createElement("li");
			const details = document.createElement("div");
			const link = document.createElement("a");
			link.href = entry.url; link.textContent = entry.title; link.referrerPolicy = "no-referrer";
			const time = document.createElement("time");
			time.dateTime = new Date(entry.visitedAt).toISOString(); time.textContent = new Date(entry.visitedAt).toLocaleString();
			const remove = document.createElement("button");
			remove.type = "button"; remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove ${entry.title} from history`);
			remove.addEventListener("click", () => updateHistory(saved => { saved.entries = saved.entries.filter(it => it.url !== entry.url); }));
			details.append(link, time); row.append(details, remove); byId("history-list").append(row);
		}
	} catch {
		byId("history-pause").disabled = true; byId("history-clear").disabled = true;
		byId("history-status").textContent = "This browser is blocking local storage. History cannot be saved here; you can still use the site.";
	}
}

async function updateHistory (change) {
	const expectedKey = currentHistoryKey;
	if (!expectedKey) return;
	try {
		const session = await fetchAccountSession();
		if (expectedKey !== currentHistoryKey || expectedKey !== historyKeyFor(session.user)) { await load(); return; }
		changeHistory(expectedKey, change);
		renderHistory();
	} catch { byId("history-status").textContent = "Could not update history. Check your connection and browser storage, then try again."; }
}

byId("history-pause").addEventListener("click", () => updateHistory(saved => { saved.paused = !saved.paused; }));
byId("history-clear").addEventListener("click", () => {
	if (confirm("Clear this account's browsing history on this browser?")) updateHistory(saved => { saved.entries = []; });
});

async function load () {
	const version = ++loadVersion;
	hideHistory();
	byId("signed-in").hidden = true;
	try {
		const session = await fetchAccountSession();
		if (version !== loadVersion) return;
		const canonical = session.enabled && session.origin !== location.origin;
		byId("canonical-link").hidden = !canonical;
		if (canonical) byId("canonical-link").href = `${session.origin}/login.html`;
		byId("signed-out").hidden = !!session.user || !session.enabled || canonical;
		byId("signed-in").hidden = !session.user;
		if (session.user) {
			byId("account-title").textContent = "You're signed in.";
			byId("profile-name").textContent = session.user.name;
			byId("profile-email").textContent = session.user.email || "No verified primary email provided";
			byId("profile-provider").textContent = providerName(session.user.provider);
			byId("admin-link").hidden = !session.user.admin;
			byId("account-status").textContent = initialMessage || "Welcome back. Your account details are private.";
			currentHistoryKey = historyKeyFor(session.user);
			renderHistory();
		} else {
			byId("account-title").textContent = "Sign up / Log in";
			for (const provider of session.providers) document.querySelector(`[data-provider="${provider.id}"]`).disabled = !provider.available;
			const missing = session.providers.filter(it => !it.available).map(it => providerName(it.id));
			byId("provider-note").textContent = missing.length ? `${missing.join(" and ")} sign-in is awaiting connection by the site owner.` : "Choose the account you prefer. No new password to remember.";
			byId("account-status").textContent = initialMessage || (!session.enabled ? "Optional sign-in is turned off. Everything else is ready to use." : canonical ? "Sign-in is available at the site's public address." : missing.length === 2 ? "Sign-in is being set up. You can keep using the site." : "Choose a sign-in option below.");
		}
	} catch { if (version === loadVersion) byId("account-status").textContent = "Accounts are temporarily unavailable. You can still browse and share homebrew."; }
}
byId("signout").addEventListener("click", async () => {
	byId("signout").disabled = true;
	try {
		const response = await fetch("/api/auth/logout", {method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(10000)});
		if (!response.ok) throw new Error();
		syncHistoryAccount(null);
		hideHistory();
		location.replace("/login.html");
	} catch { byId("account-status").textContent = "Could not sign out. Please try again."; byId("signout").disabled = false; }
});
window.addEventListener("pageshow", event => { if (event.persisted) load(); });
window.addEventListener("pagehide", () => { loadVersion++; hideHistory(); byId("signed-in").hidden = true; });
window.addEventListener("focus", () => load());
window.addEventListener("storage", event => {
	if (event.key === ACCOUNT_STATE_KEY || event.key === null) load();
	else if (event.key === currentHistoryKey) renderHistory();
});
await load();
