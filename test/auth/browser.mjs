import {chromium} from "playwright";
import {spawn} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {checkBrowsingHistory} from "./browser-history.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "five-auth-browser-"));
const port = 3142;
const base = `http://127.0.0.1:${port}`;
const configuration = path.join(directory, "secrets.env");
await writeFile(configuration, "GOOGLE_CLIENT_SECRET=\"test-secret\"\nGITHUB_CLIENT_SECRET=\"test-secret\"\n", {mode: 0o600});
let server; let browser; let serverErrors = "";
async function start (overrides = {}) {
	server = spawn(process.execPath, ["--import", "./test/auth/mock-provider-preload.mjs", "server.js"], {
		env: {...process.env,
			PORT: String(port),
			DISABLE_AUTO_UPDATE: "1",
			HOMEBREW_STORAGE_DIR: path.join(directory, "homebrew"),
			AUTH_ENABLED: "1",
			AUTH_REPORT_ENABLED: "0",
			AUTH_CONFIG_FILE: configuration,
			AUTH_STORAGE_DIR: path.join(directory, "accounts"),
			AUTH_BASE_URL: base,
			AUTH_ADMIN_EMAILS: "admin@example.com",
			GOOGLE_CLIENT_ID: "google-test",
			GITHUB_CLIENT_ID: "github-test",
			...overrides},
		stdio: "pipe",
	});
	server.stderr.on("data", chunk => { serverErrors += chunk; });
	for (let i = 0; i < 100; i++) {
		if (server.exitCode != null) throw new Error(serverErrors);
		try { if ((await fetch(`${base}/api/auth/session`)).ok) return; } catch { /* Retry while the isolated server starts. */ }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error("Isolated auth server did not start.");
}
async function stop () {
	if (!server || server.exitCode != null || server.signalCode != null) return;
	const exited = new Promise(resolve => server.once("exit", resolve));
	server.kill("SIGTERM"); await exited; server = null;
}
async function mockProvider (page, provider, profile) {
	// Complete the real start request, then simulate the provider's response in a
	// separate document. Playwright does not reroute an in-flight redirect chain.
	await page.route(`${base}/auth/${provider}/start`, async route => {
		const response = await route.fetch({maxRedirects: 0});
		assert.equal(response.status(), 303);
		const url = new URL(response.headers().location);
		assert.equal(url.hostname, provider === "google" ? "accounts.google.com" : "github.com");
		assert.equal(url.searchParams.get("code_challenge_method"), "S256");
		assert.equal(url.searchParams.get("redirect_uri"), `${base}/auth/${provider}/callback`);
		const callback = new URL(url.searchParams.get("redirect_uri"));
		callback.search = new URLSearchParams({state: url.searchParams.get("state"),
			...(profile.cancel ? {error: "access_denied"} : {code: Buffer.from(JSON.stringify({...profile, nonce: url.searchParams.get("nonce")})).toString("base64url")}),
		}).toString();
		const headers = {...response.headers(), "content-type": "text/html"};
		delete headers.location;
		await route.fulfill({status: 200, headers, body: `<html><body>Simulated sign-in provider<script>location.replace(${JSON.stringify(callback.href)})</script></body></html>`});
	});
}
async function login (page, provider, profile) {
	await mockProvider(page, provider, profile);
	await page.goto(`${base}/login.html`);
	await page.locator("[name=consent]").check();
	await page.locator(`[data-provider=${provider}]`).click();
	try { await page.locator("#signed-in").waitFor({state: "visible"}); } catch (error) { console.error("Simulated sign-in stopped at:", await page.locator("body").innerText()); throw error; }
}
try {
	await start(); browser = await chromium.launch({headless: true});
	const adminContext = await browser.newContext(); const visitorContext = await browser.newContext();
	const admin = await adminContext.newPage(); const visitor = await visitorContext.newPage();
	const errors = [];
	for (const page of [admin, visitor]) {
		page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
		page.on("console", message => { if (message.type() === "error" && !message.text().includes("404")) console.error(message.text()); });
	}
	await admin.goto(`${base}/login.html`);
	await admin.locator("#signed-out").waitFor({state: "visible"});
	await admin.locator("[data-provider=google]").click();
	assert.equal(new URL(admin.url()).pathname, "/login.html");
	assert.equal(await admin.locator("[name=consent]").evaluate(el => el.validity.valueMissing), true);
	await login(admin, "google", {email: "ADMIN@Example.com", name: "Site Owner", subject: "owner-id"});
	assert.equal(await admin.locator("#profile-email").innerText(), "admin@example.com");
	assert.equal(await admin.locator("#admin-link").isVisible(), true);
	assert.equal((await adminContext.cookies()).find(it => it.name === "five_session").httpOnly, true);
	assert.equal(await admin.evaluate(() => document.cookie.includes("five_session")), false);
	await admin.locator("#admin-link").click();
	await admin.locator("#accounts tr").waitFor();
	assert.match(await admin.locator("#accounts").innerText(), /admin@example.com/);
	console.log("PASS: real account UI requires consent and completes a simulated Google authorization with signed-token validation");
	assert.equal((await visitor.request.get(`${base}/api/auth/accounts`)).status(), 401);
	await visitor.goto(`${base}/admin-accounts.html`);
	assert.equal(new URL(visitor.url()).pathname, "/login.html");
	await login(visitor, "github", {email: "friend@example.com", name: "<img src=x onerror=\"alert(1)\"> Friend", subject: "9876"});
	assert.equal(await visitor.locator("#profile-email").innerText(), "friend@example.com");
	assert.equal(await visitor.locator("#admin-link").isVisible(), false);
	assert.equal((await visitor.request.get(`${base}/api/auth/accounts`)).status(), 403);
	assert.equal(await visitor.locator("#profile-name img").count(), 0);
	await admin.locator("#refresh").click();
	await admin.waitForFunction(() => document.querySelectorAll("#accounts tr").length === 2);
	assert.match(await admin.locator("#accounts").innerText(), /friend@example.com/);
	assert.equal(await admin.locator("#accounts img").count(), 0);
	console.log("PASS: GitHub emails are private; only the designated administrator can see the list; profile HTML is displayed as text");
	await admin.setViewportSize({width: 390, height: 844});
	assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await admin.screenshot({path: path.join(tmpdir(), "five-private-accounts-mobile.png"), fullPage: true});
	await admin.setViewportSize({width: 1280, height: 900});
	await admin.screenshot({path: path.join(tmpdir(), "five-private-accounts.png"), fullPage: true});
	await stop(); await start();
	await admin.reload(); await admin.locator("#accounts tr").first().waitFor();
	assert.equal(await admin.locator("#accounts tr").count(), 2);
	console.log("PASS: private records and sessions survive a server restart");
	for (const route of ["/.env.auth", "/%2eenv.auth", "/.private-auth/accounts.sqlite", "/.git/config", "/server/auth.js", "/test/auth/mock-provider-preload.mjs", "/analytics", "/analytics.json", "/analytics.local.backup.json", "/LOCAL-SETUP.md", "/..%2f..%2fetc/passwd"]) {
		assert.equal((await fetch(base + route)).status, 404, route);
	}
	const adminResponse = await admin.request.get(`${base}/api/auth/accounts`);
	assert.match(adminResponse.headers()["cache-control"], /no-store/);
	assert.match((await admin.request.get(`${base}/admin-accounts.html`)).headers()["cache-control"], /no-store/);
	assert.ok(!JSON.stringify(await (await visitor.request.get(`${base}/api/shared-homebrew`)).json()).includes("@example.com"));
	console.log("PASS: private data and configuration cannot be downloaded as static files or appear in shared homebrew");
	await checkBrowsingHistory({admin, visitor, visitorContext, base, login});
	await visitor.goto(`${base}/login.html`); await visitor.locator("#signout").click();
	await visitor.locator("#signed-out").waitFor({state: "visible"});
	assert.equal((await visitor.request.get(`${base}/api/auth/session`).then(it => it.json())).user, null);
	await visitor.goto(`${base}/managebrew.html`);
	await visitor.waitForFunction(() => !!document.querySelector("[name=parentClass]")?.options.length);
	await visitor.locator("[data-account-nav] a").waitFor();
	assert.equal(await visitor.locator("[data-account-nav] a").innerText(), "Sign up / Log in");
	console.log("PASS: sign-out works and the workshop remains available anonymously with a sign-in link");
	const cancel = await visitorContext.newPage(); await mockProvider(cancel, "google", {cancel: true});
	await cancel.goto(`${base}/login.html`); await cancel.locator("[name=consent]").check(); await cancel.locator("[data-provider=google]").click();
	await cancel.waitForFunction(() => document.querySelector("#account-status")?.textContent.includes("cancelled"));
	assert.equal((await visitor.request.get(`${base}/api/auth/session`).then(it => it.json())).user, null);
	console.log("PASS: cancelling sign-in leaves the visitor anonymous and shows a useful message");
	await stop(); await start({AUTH_REPORT_ENABLED: "1", AUTH_REPORT_TO: "admin@example.com", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "admin@example.com", SMTP_FROM: "admin@example.com", SMTP_PASSWORD: ""});
	await admin.goto(`${base}/admin-accounts.html`);
	await admin.waitForFunction(() => document.querySelector("#report-status")?.textContent.includes("Waiting for the sender"));
	const reportStatus = await admin.request.get(`${base}/api/auth/accounts`).then(it => it.json());
	assert.equal(reportStatus.emailReports.enabled, true); assert.equal(reportStatus.emailReports.ready, false);
	assert.equal(reportStatus.emailReports.recipient, "admin@example.com");
	assert.equal(reportStatus.emailReports.pendingAccounts, 2);
	assert.ok(!JSON.stringify(reportStatus).includes("SMTP_PASSWORD"));
	assert.equal((await visitor.request.get(`${base}/api/auth/accounts`)).status(), 401);
	assert.ok(!JSON.stringify(await visitor.request.get(`${base}/api/auth/session`).then(it => it.json())).includes("admin@example.com"));
	console.log("PASS: only the administrator sees private email-report status; missing sender credentials cannot send reports");
	await stop(); await start({GOOGLE_CLIENT_ID: "", GITHUB_CLIENT_ID: ""});
	await visitor.goto(`${base}/login.html`);
	await visitor.waitForFunction(() => document.querySelector("#account-status")?.textContent.includes("being set up"));
	assert.equal(await visitor.locator("[data-provider=google]").isDisabled(), true);
	assert.equal(await visitor.locator("[data-provider=github]").isDisabled(), true);
	await visitor.setViewportSize({width: 390, height: 844});
	assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await visitor.screenshot({path: path.join(tmpdir(), "five-signin-mobile.png"), fullPage: true});
	await visitor.setViewportSize({width: 1280, height: 900});
	await visitor.screenshot({path: path.join(tmpdir(), "five-signin.png"), fullPage: true});
	await stop(); await start({AUTH_ENABLED: "0"});
	assert.equal((await admin.request.get(`${base}/api/auth/accounts`)).status(), 401);
	await visitor.goto(`${base}/managebrew.html`);
	await visitor.waitForFunction(() => !!document.querySelector("[name=parentClass]")?.options.length);
	assert.equal(await visitor.locator("[data-account-nav]").count(), 0);
	console.log("PASS: unconfigured providers are clearly marked; disabling the optional add-on hides it and closes admin access");
	assert.deepEqual(errors, []);
	assert.ok(!serverErrors.includes("test-secret"));
} finally { if (browser) await browser.close(); await stop(); await rm(directory, {recursive: true, force: true}); }
