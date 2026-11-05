import {AuthStore, hashToken, randomToken, SESSION_SECONDS} from "./auth-store.js";
import {authorizeUrl, exchangeProfile} from "./auth-providers.js";

function respond (res, status, body) {
	res.writeHead(status, {"Content-Type": "application/json; charset=utf-8"});
	res.end(JSON.stringify(body));
}

function cookies (req) {
	return Object.fromEntries((req.headers.cookie || "").split(";").map(it => {
		const index = it.indexOf("="); return [it.slice(0, index).trim(), it.slice(index + 1)];
	}));
}

function safeHeaders (res) {
	res.setHeader("Cache-Control", "no-store, private");
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Referrer-Policy", "no-referrer");
	res.setHeader("X-Frame-Options", "DENY");
}

export function createAuthHandler (config, {store: injectedStore, exchange = exchangeProfile, reportStatus = () => null} = {}) {
	let store = injectedStore;
	const getStore = () => store ||= new AuthStore(config.directory);
	const names = config.secure ? {session: "__Host-five_session", flow: "__Host-five_oauth"} : {session: "five_session", flow: "five_oauth"};
	const cookie = (name, token, seconds) => `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.secure ? "; Secure" : ""}`;
	const ready = provider => config.enabled && config.providers[provider]?.clientId && config.providers[provider]?.clientSecret;
	const isAdmin = account => !!account && (config.adminIdentities.has(`${account.provider}:${account.subject}`) || (account.email && config.adminEmails.has(account.email)));
	const accountFor = req => config.enabled ? getStore().account(cookies(req)[names.session]) : null;
	const sameOrigin = req => req.headers.origin === config.origin && req.headers.host === new URL(config.origin).host && req.headers["sec-fetch-site"] !== "cross-site";
	const redirect = (res, location) => { res.writeHead(303, {Location: location}); res.end(); };
	// Limit start requests per network address; do not retain or log addresses on disk.
	const attempts = new Map();
	function allowed (req) {
		const now = Date.now();
		for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
		const key = req.socket.remoteAddress || "unknown";
		if (!attempts.has(key)) {
			if (attempts.size >= 5000) return false;
			attempts.set(key, {count: 0, until: now + 60_000});
		}
		return ++attempts.get(key).count <= 60;
	}

	const handler = async (req, res) => {
		const url = new URL(req.url, "http://localhost");
		const pathname = url.pathname;
		const isPage = pathname === "/login.html" || pathname === "/admin-accounts.html";
		if (!isPage && !pathname.startsWith("/api/auth/") && !pathname.startsWith("/auth/")) return false;
		safeHeaders(res);
		if (isPage) {
			// Forms need their same-origin Origin header for CSRF checks; callbacks remain no-referrer.
			res.setHeader("Referrer-Policy", "same-origin");
			res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com https://github.com");
			if (pathname === "/admin-accounts.html" && !isAdmin(accountFor(req))) { redirect(res, "/login.html?notice=admin"); return true; }
			return false; // Serve the static shell; all private content comes from the guarded API.
		}
		try {
			if (pathname === "/api/auth/session" && req.method === "GET") {
				const account = accountFor(req);
				respond(res, 200, {enabled: config.enabled,
					origin: config.origin,
					providers: ["google", "github"].map(id => ({id, available: !!ready(id)})),
					// A stable, opaque browser namespace, never an access credential.
					// No browsing history is stored or accepted by the server.
					user: account ? {name: account.name, email: account.email, provider: account.provider, admin: !!isAdmin(account), historyKey: hashToken(`${account.provider}\0${account.subject}`)} : null});
				return true;
			}
			if (pathname === "/api/auth/accounts" && req.method === "GET") {
				const account = accountFor(req);
				if (!account) { respond(res, 401, {error: "Sign in to view this page."}); return true; }
				if (!isAdmin(account)) { respond(res, 403, {error: "This list is only available to the site administrator."}); return true; }
				const offset = Number(url.searchParams.get("offset") || 0);
				if (!Number.isSafeInteger(offset) || offset < 0) { respond(res, 400, {error: "Invalid page."}); return true; }
				respond(res, 200, {...getStore().list(offset), emailReports: reportStatus()}); return true;
			}
			if (pathname === "/api/auth/logout" && req.method === "POST") {
				if (!sameOrigin(req)) { respond(res, 403, {error: "Please sign out from this site's account page."}); return true; }
				if (config.enabled) getStore().logout(cookies(req)[names.session]);
				res.setHeader("Set-Cookie", [cookie(names.session, "", 0), cookie(names.flow, "", 0)]);
				respond(res, 200, {ok: true}); return true;
			}
			const route = pathname.match(/^\/auth\/(google|github)\/(start|callback)$/);
			if (!route) { respond(res, 404, {error: "Not found."}); return true; }
			const [, provider, action] = route;
			if (!ready(provider)) { redirect(res, "/login.html?error=unavailable"); return true; }
			if (req.headers.host !== new URL(config.origin).host) { respond(res, 400, {error: "Open the account page using the site's configured public address."}); return true; }
			if (action === "start" && req.method === "POST") {
				if (!sameOrigin(req)) { respond(res, 403, {error: "Start sign-in from this site's account page."}); return true; }
				if (!allowed(req)) { respond(res, 429, {error: "Please wait a minute before trying again."}); return true; }
				if (req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") { respond(res, 415, {error: "Use the sign-in form."}); return true; }
				let body = "";
				for await (const chunk of req) {
					body += chunk.toString();
					if (body.length > 2048) { respond(res, 413, {error: "Request too large."}); return true; }
				}
				if (new URLSearchParams(body).get("consent") !== "1") { redirect(res, "/login.html?error=consent"); return true; }
				const browserToken = randomToken();
				const transaction = getStore().start(provider, browserToken);
				res.setHeader("Set-Cookie", cookie(names.flow, browserToken, 600));
				redirect(res, authorizeUrl(provider, config, transaction)); return true;
			}
			if (action === "callback" && req.method === "GET") {
				const params = url.searchParams;
				if (["code", "state", "error", "iss"].some(key => params.getAll(key).length > 1)) { redirect(res, "/login.html?error=expired"); return true; }
				const transaction = getStore().consume(params.get("state"), cookies(req)[names.flow], provider);
				if (!transaction) { redirect(res, "/login.html?error=expired"); return true; }
				res.setHeader("Set-Cookie", cookie(names.flow, "", 0));
				if (params.has("error")) { redirect(res, "/login.html?error=cancelled"); return true; }
				const code = params.get("code");
				if (!code || code.length > 2048 || (provider === "google" && params.has("iss") && params.get("iss") !== "https://accounts.google.com")) { redirect(res, "/login.html?error=failed"); return true; }
				const profile = await exchange(provider, code, transaction, config);
				const token = getStore().login(profile, cookies(req)[names.session]);
				res.setHeader("Set-Cookie", [cookie(names.session, token, SESSION_SECONDS), cookie(names.flow, "", 0)]);
				redirect(res, "/login.html"); return true;
			}
			respond(res, 405, {error: "Method not allowed."}); return true;
		} catch {
			// Never echo provider responses, codes, tokens, cookies, or emails to logs/URLs.
			if (pathname.startsWith("/auth/")) redirect(res, "/login.html?error=failed");
			else respond(res, 503, {error: "Accounts are temporarily unavailable. You can still browse and share homebrew."});
			return true;
		}
	};
	handler.close = () => store?.close();
	handler.getStore = getStore;
	return handler;
}
