import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {mkdtemp, rm, stat, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {generateKeyPair} from "jose";
import {readAuthConfig, normalizeEmail} from "../../server/auth-config.js";
import {AuthStore, hashToken, randomToken} from "../../server/auth-store.js";
import {createAuthHandler} from "../../server/auth.js";
import {exchangeProfile, authorizeUrl} from "../../server/auth-providers.js";
import {createProviderFixture} from "./provider-fixture.mjs";

const fixture = await createProviderFixture();
function configFor (origin = "http://127.0.0.1:9999", directory) {
	return readAuthConfig({AUTH_ENABLED: "1",
		AUTH_BASE_URL: origin,
		AUTH_STORAGE_DIR: directory,
		AUTH_ADMIN_EMAILS: "admin@example.com",
		GOOGLE_CLIENT_ID: "google-id",
		GOOGLE_CLIENT_SECRET: "google-secret",
		GITHUB_CLIENT_ID: "github-id",
		GITHUB_CLIENT_SECRET: "github-secret"});
}
async function setup (t) {
	const directory = await mkdtemp(path.join(tmpdir(), "five-auth-test-"));
	const store = new AuthStore(directory);
	let handler;
	const server = http.createServer((req, res) => handler(req, res));
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const config = configFor(origin, directory);
	handler = createAuthHandler(config, {store, exchange: (provider, code, transaction, conf) => exchangeProfile(provider, code, transaction, conf, fixture)});
	t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); await rm(directory, {recursive: true, force: true}); });
	const request = (route, options = {}) => fetch(origin + route, {redirect: "manual", ...options});
	const start = async (provider = "google", options = {}) => {
		const response = await request(`/auth/${provider}/start`, {method: "POST", headers: {Origin: origin, "Content-Type": "application/x-www-form-urlencoded"}, body: "consent=1", ...options});
		assert.equal(response.status, 303);
		return {url: new URL(response.headers.get("location")), cookie: response.headers.getSetCookie()[0]?.split(";")[0], response};
	};
	const complete = async (flow, profile = {}, provider = "google", headers = {}) => request(`/auth/${provider}/callback?${new URLSearchParams({state: flow.url.searchParams.get("state"), code: fixture.encode({email: "player@example.com", nonce: flow.url.searchParams.get("nonce"), ...profile})})}`, {headers: {Cookie: flow.cookie, ...headers}});
	return {directory, store, config, request, start, complete, origin};
}

test("configuration requires HTTPS outside localhost and sanitizes email addresses", () => {
	assert.throws(() => readAuthConfig({AUTH_BASE_URL: "http://example.com"}));
	for (const value of ["https://example.com/path", "https://me:password@example.com", "https://example.com?x=1"]) assert.throws(() => readAuthConfig({AUTH_BASE_URL: value}));
	assert.equal(normalizeEmail("  Player@Example.COM "), "player@example.com");
	for (const value of ["noemail", "x@example.com\r\nBCC:evil@example.org", "<script>@example.com", "x@ex ample.com"]) assert.equal(normalizeEmail(value), null);
	assert.equal(readAuthConfig({}).enabled, false);
});

test("Google checks signature, issuer, audience, nonce, expiry, and verification", async () => {
	const config = configFor();
	const transaction = {nonce: "nonce", verifier: randomToken()};
	const profile = {email: " Player@Example.com ", nonce: "nonce"};
	const good = await exchangeProfile("google", fixture.encode(profile), transaction, config, fixture);
	assert.equal(good.email, "player@example.com");
	assert.equal((await exchangeProfile("google", fixture.encode({...profile, verified: false}), transaction, config, fixture)).email, null);
	for (const claims of [{iss: "https://attacker.example"}, {aud: "another-app"}, {nonce: "wrong"}, {exp: 1}, {azp: "other-client"}, {at_hash: "wrong"}, {sub: ""}]) {
		await assert.rejects(() => exchangeProfile("google", fixture.encode({...profile, claims}), transaction, config, fixture));
	}
	const {privateKey} = await generateKeyPair("RS256");
	const forged = await fixture.sign({iss: "https://accounts.google.com", sub: "attacker", aud: "google-id", exp: Date.now() / 1000 + 3600, iat: Date.now() / 1000, nonce: "nonce"}, privateKey);
	await assert.rejects(() => exchangeProfile("google", "irrelevant", transaction, config, {...fixture, fetcher: async () => new Response(JSON.stringify({access_token: "token", id_token: forged}))}));
});

test("GitHub stores only the verified primary email and requests minimum email scope", async () => {
	const config = configFor();
	const transaction = {nonce: "nonce", verifier: randomToken(), state: randomToken()};
	const emails = [{email: "old@example.com", verified: true, primary: false}, {email: " MAIN@Example.com ", verified: true, primary: true}];
	const profile = await exchangeProfile("github", fixture.encode({subject: "4321", emails}), transaction, config, fixture);
	assert.equal(profile.subject, "4321"); assert.equal(profile.email, "main@example.com");
	emails[1].verified = false;
	assert.equal((await exchangeProfile("github", fixture.encode({emails}), transaction, config, fixture)).email, null);
	const url = new URL(authorizeUrl("github", config, transaction));
	assert.equal(url.searchParams.get("scope"), "user:email");
	assert.equal(url.searchParams.get("code_challenge_method"), "S256");
	assert.equal(url.searchParams.get("code_challenge"), Buffer.from(hashToken(transaction.verifier), "hex").toString("base64url"));
});

test("Google sign-in persists a private account, hashed session, and sanitized profile", async t => {
	const api = await setup(t);
	const flow = await api.start();
	assert.match(flow.response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
	assert.equal(flow.url.searchParams.get("redirect_uri"), `${api.origin}/auth/google/callback`);
	const complete = await api.complete(flow, {email: " Admin@Example.COM ", name: "Player\nName"});
	assert.equal(complete.headers.get("location"), "/login.html");
	const cookie = complete.headers.getSetCookie()[0].split(";")[0];
	const response = await api.request("/api/auth/session", {headers: {Cookie: cookie}});
	assert.match(response.headers.get("cache-control"), /no-store/);
	assert.deepEqual((await response.json()).user, {name: "PlayerName", email: "admin@example.com", provider: "google", admin: true, historyKey: hashToken("google\0google-user")});
	assert.equal(api.store.db.prepare("SELECT token_hash FROM sessions").get().token_hash, hashToken(cookie.split("=")[1]));
	assert.equal(api.store.db.prepare("SELECT count(*) AS count FROM oauth_states").get().count, 0);
	assert.equal((await stat(path.join(api.directory, "accounts.sqlite"))).mode & 0o777, 0o600);
	assert.equal((await stat(api.directory)).mode & 0o777, 0o700);
	const secondStore = new AuthStore(api.directory);
	assert.equal(secondStore.account(cookie.split("=")[1]).email, "admin@example.com"); secondStore.close();
	assert.equal((await api.request("/api/auth/accounts", {headers: {Cookie: cookie}})).status, 200);
	assert.ok(!(await readFile(path.join(api.directory, "accounts.sqlite"))).includes(Buffer.from(cookie.split("=")[1])));
});

test("consent and same-origin requests are required; invalid state, browser, and provider cannot log in", async t => {
	const api = await setup(t);
	assert.equal((await api.request("/auth/google/start", {method: "POST", headers: {Origin: "https://attacker.example"}})).status, 403);
	assert.equal((await api.request("/auth/google/start", {method: "POST", headers: {Origin: api.origin, "Content-Type": "application/x-www-form-urlencoded"}, body: "consent=0"})).headers.get("location"), "/login.html?error=consent");
	const flow = await api.start();
	assert.equal((await api.complete(flow, {}, "google", {Cookie: ""})).headers.get("location"), "/login.html?error=expired");
	assert.equal((await api.complete(flow, {}, "github")).headers.get("location"), "/login.html?error=expired");
	const realState = flow.url.searchParams.get("state");
	flow.url.searchParams.set("state", randomToken());
	assert.equal((await api.complete(flow)).headers.get("location"), "/login.html?error=expired");
	flow.url.searchParams.set("state", realState);
	const duplicate = await api.request(`/auth/google/callback?state=${realState}&state=${realState}&code=x`, {headers: {Cookie: flow.cookie}});
	assert.equal(duplicate.headers.get("location"), "/login.html?error=expired");
	assert.equal((await api.complete(flow)).headers.get("location"), "/login.html");
	assert.equal((await api.complete(flow)).headers.get("location"), "/login.html?error=expired");
});

test("cancellation, expired transactions, and provider failures never create accounts or leak provider errors", async t => {
	const api = await setup(t);
	let flow = await api.start();
	const cancelled = await api.request(`/auth/google/callback?state=${flow.url.searchParams.get("state")}&error=access_denied&error_description=secret`, {headers: {Cookie: flow.cookie}});
	assert.equal(cancelled.headers.get("location"), "/login.html?error=cancelled");
	flow = await api.start(); api.store.db.exec("UPDATE oauth_states SET expires = 1");
	assert.equal((await api.complete(flow)).headers.get("location"), "/login.html?error=expired");
	flow = await api.start();
	const failed = await api.complete(flow, {fail: true});
	assert.equal(failed.headers.get("location"), "/login.html?error=failed");
	assert.equal(await failed.text(), ""); assert.equal(api.store.list().total, 0);
});

test("anonymous, ordinary, and unverified users cannot read the admin list; logout and expiry revoke access", async t => {
	const api = await setup(t);
	assert.equal((await api.request("/api/auth/accounts")).status, 401);
	assert.equal((await api.request("/api/auth/session")).headers.get("access-control-allow-origin"), null);
	for (const profile of [{email: "ordinary@example.com"}, {email: "admin@example.com", verified: false}]) {
		const complete = await api.complete(await api.start(), profile);
		const cookie = complete.headers.getSetCookie()[0].split(";")[0];
		assert.equal((await api.request("/api/auth/accounts", {headers: {Cookie: cookie}})).status, 403);
	}
	const complete = await api.complete(await api.start(), {email: "admin@example.com"});
	const cookie = complete.headers.getSetCookie()[0].split(";")[0];
	assert.equal((await api.request("/api/auth/logout", {method: "POST", headers: {Cookie: cookie, Origin: "https://attacker.example"}})).status, 403);
	assert.equal((await api.request("/api/auth/accounts", {headers: {Cookie: cookie}})).status, 200);
	assert.equal((await api.request("/api/auth/logout", {method: "POST", headers: {Cookie: cookie, Origin: api.origin}})).status, 200);
	assert.equal((await api.request("/api/auth/accounts", {headers: {Cookie: cookie}})).status, 401);
	const expired = await api.complete(await api.start(), {email: "admin@example.com"});
	api.store.db.exec("UPDATE sessions SET expires = 1");
	assert.equal((await api.request("/api/auth/session", {headers: {Cookie: expired.headers.getSetCookie()[0].split(";")[0]}}).then(it => it.json())).user, null);
});

test("repeat sign-ins update one account, separate providers stay separate, and removed accounts lose all sessions", async t => {
	const api = await setup(t);
	const profile = {subject: "1001", email: "same@example.com"};
	const first = await api.complete(await api.start(), profile);
	const oldCookie = first.headers.getSetCookie()[0].split(";")[0];
	const firstKey = (await api.request("/api/auth/session", {headers: {Cookie: oldCookie}}).then(it => it.json())).user.historyKey;
	assert.match(firstKey, /^[a-f0-9]{64}$/);
	// Repeat through a complete fresh flow, retaining the previous session for rotation.
	const flow = await api.start();
	const second = await api.complete(flow, profile, "google", {Cookie: `${flow.cookie}; ${oldCookie}`});
	assert.equal(second.headers.get("location"), "/login.html");
	assert.equal(api.store.account(oldCookie.split("=")[1]), null);
	assert.equal(api.store.list().total, 1);
	assert.equal(api.store.list().accounts[0].login_count, 2);
	const secondCookie = second.headers.getSetCookie()[0].split(";")[0];
	assert.equal((await api.request("/api/auth/session", {headers: {Cookie: secondCookie}}).then(it => it.json())).user.historyKey, firstKey);
	const github = await api.complete(await api.start("github"), profile, "github");
	const githubCookie = github.headers.getSetCookie()[0].split(";")[0];
	assert.notEqual((await api.request("/api/auth/session", {headers: {Cookie: githubCookie}}).then(it => it.json())).user.historyKey, firstKey);
	assert.ok(!JSON.stringify(api.store.list()).includes("historyKey"));
	assert.equal(api.store.list().total, 2);
	api.store.db.prepare("DELETE FROM accounts WHERE email = ?").run(profile.email);
	assert.equal(api.store.db.prepare("SELECT count(*) AS count FROM sessions").get().count, 0);
});

test("disabled add-on cannot authenticate or reveal records; HTTPS cookies are Secure and host-only", async t => {
	const api = await setup(t);
	api.config.enabled = false;
	assert.equal((await api.request("/api/auth/session").then(it => it.json())).enabled, false);
	assert.equal((await api.request("/api/auth/accounts")).status, 401);
	assert.equal((await api.request("/auth/github/start", {method: "POST"})).headers.get("location"), "/login.html?error=unavailable");
	const config = configFor("https://example.com", api.directory);
	const handler = createAuthHandler(config, {store: api.store});
	const headers = new Map();
	const req = {url: "/auth/google/start", method: "POST", headers: {host: "example.com", origin: "https://example.com", "content-type": "application/x-www-form-urlencoded"}, socket: {remoteAddress: "test"}, async* [Symbol.asyncIterator] () { yield Buffer.from("consent=1"); }};
	const res = {setHeader: (name, value) => headers.set(name, value), writeHead () {}, end () {}};
	await handler(req, res);
	assert.match(headers.get("Set-Cookie"), /^__Host-five_oauth=/);
	assert.match(headers.get("Set-Cookie"), /; Secure$/);
	assert.ok(!headers.get("Set-Cookie").includes("Domain="));
});
