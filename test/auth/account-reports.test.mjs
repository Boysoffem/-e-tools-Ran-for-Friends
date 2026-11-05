import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {AuthStore} from "../../server/auth-store.js";
import {readAuthConfig} from "../../server/auth-config.js";
import {AccountReporter, AccountReportStore, reportPeriod, readReportConfig, createReportTransport} from "../../server/account-reports.js";

const initial = Date.parse("2026-11-04T15:00:00Z");
const due = Date.parse("2026-11-09T15:00:00Z");
const week = 7 * 24 * 60 * 60_000;
function configFor () {
	const env = {AUTH_ENABLED: "1",
		AUTH_REPORT_ENABLED: "1",
		AUTH_ADMIN_EMAILS: "owner@example.com",
		AUTH_BASE_URL: "https://friends.example.com",
		AUTH_REPORT_TO: "owner@example.com",
		SMTP_HOST: "smtp.example.com",
		SMTP_USER: "owner@example.com",
		SMTP_FROM: "owner@example.com",
		SMTP_PASSWORD: "test-secret"};
	return {env, auth: readAuthConfig(env), config: readReportConfig(env, readAuthConfig(env))};
}
async function setup (t) {
	const directory = await mkdtemp(path.join(tmpdir(), "five-report-test-"));
	let store = new AuthStore(directory);
	const {config} = configFor();
	const sent = [];
	const transport = {async sendMail (message) { sent.push(message); return {accepted: [config.to]}; }};
	let time = initial;
	const reporter = new AccountReporter(config, () => store, {transport, now: () => time});
	reporter.getStore();
	t.after(async () => { reporter.stop(); store.close(); await rm(directory, {recursive: true, force: true}); });
	return {directory,
		config,
		sent,
		reporter,
		transport,
		setTime: value => { time = value; },
		get store () { return store; },
		reopen () { store.close(); store = new AuthStore(directory); return new AccountReporter(config, () => store, {transport, now: () => time}); },
		add (subject, email = `${subject}@example.com`, provider = "google") { store.login({subject, email, provider, name: subject}, null); },
	};
}

test("weekly schedule uses Monday 9 a.m. Central, including both daylight-saving transitions", () => {
	for (const [timestamp, expected] of [
		["2026-11-09T14:59:59Z", "2026-11-02"], ["2026-11-09T15:00:00Z", "2026-11-09"],
		["2026-11-08T09:00:00Z", "2026-11-02"], ["2026-11-16T14:59:59Z", "2026-11-09"],
		["2026-03-09T13:59:59Z", "2026-03-02"], ["2026-03-09T14:00:00Z", "2026-03-09"],
		["2026-11-02T14:59:59Z", "2026-10-26"], ["2026-11-02T15:00:00Z", "2026-11-02"],
	]) assert.equal(reportPeriod(Date.parse(timestamp)), expected, timestamp);
});

test("mail config accepts only one admin recipient and transport requires TLS without logging secrets", () => {
	const {env, auth, config} = configFor();
	assert.equal(config.ready, true);
	for (const address of ["visitor@example.com", "owner@example.com,visitor@example.com", "owner@example.com\r\nBcc: visitor@example.com"]) assert.equal(readReportConfig({...env, AUTH_REPORT_TO: address}, auth).ready, false);
	assert.equal(readReportConfig({...env, SMTP_PASSWORD: ""}, auth).ready, false);
	assert.equal(readReportConfig({...env, SMTP_PORT: "bad"}, auth).ready, false);
	assert.equal(readReportConfig({...env, AUTH_REPORT_ENABLED: "0"}, auth).enabled, false);
	const transport = createReportTransport(config);
	assert.equal(transport.options.secure, true); assert.equal(transport.options.requireTLS, true);
	assert.equal(transport.options.logger, false); assert.equal(transport.options.debug, false);
	assert.equal(transport.options.disableFileAccess, true); assert.equal(transport.options.disableUrlAccess, true);
	const startTls = createReportTransport({...config, port: 587});
	assert.equal(startTls.options.secure, false); assert.equal(startTls.options.requireTLS, true);
	transport.close(); startTls.close();
});

test("weekly email includes only new accounts and is addressed only to the administrator", async t => {
	const api = await setup(t);
	api.add("Alice", "alice@example.com"); api.add("Bob", null, "github");
	await api.reporter.tick(); assert.equal(api.sent.length, 0);
	api.setTime(due - 1); await api.reporter.tick(); assert.equal(api.sent.length, 0);
	api.setTime(due); await api.reporter.tick();
	assert.equal(api.sent.length, 1);
	const message = api.sent[0];
	assert.deepEqual(message.envelope.to, ["owner@example.com"]);
	assert.deepEqual(message.to, {address: "owner@example.com"});
	assert.equal(message.cc, undefined); assert.equal(message.bcc, undefined); assert.equal(message.html, undefined);
	assert.match(message.text, /Name: Alice\nEmail: alice@example.com\nProvider: Google/);
	assert.match(message.text, /Name: Bob\nEmail: No verified primary email provided\nProvider: GitHub/);
	assert.ok(!message.text.includes("test-secret"));
	assert.equal(api.reporter.status().pendingAccounts, 0);
	await api.reporter.tick(); assert.equal(api.sent.length, 1);
	api.add("Alice", "alice@example.com");
	api.setTime(due + week); await api.reporter.tick(); assert.equal(api.sent.length, 1);
	api.add("Carol");
	await api.reporter.tick(); assert.equal(api.sent.length, 1); // This week's empty report was already skipped.
	api.setTime(due + 2 * week); await api.reporter.tick();
	assert.equal(api.sent.length, 2); assert.match(api.sent[1].text, /Carol/); assert.ok(!api.sent[1].text.includes("Alice"));
});

test("empty weeks send nothing; an offline server catches up once; restarts do not resend", async t => {
	const api = await setup(t);
	api.setTime(due); await api.reporter.tick(); assert.equal(api.sent.length, 0);
	api.add("New Player");
	api.setTime(due + 2 * week + 3 * 60 * 60_000);
	let reporter = api.reopen(); await reporter.tick(); assert.equal(api.sent.length, 1);
	reporter = api.reopen(); await reporter.tick(); assert.equal(api.sent.length, 1);
	assert.equal(reporter.status().pendingAccounts, 0);
});

test("failed delivery stays queued, backs off, redacts errors, and retries the same message after restart", async t => {
	const api = await setup(t); api.add("Queued"); api.setTime(due);
	let attempts = 0;
	api.transport.sendMail = async message => {
		api.sent.push(message);
		if (++attempts === 1) throw Object.assign(new Error("SMTP rejected test-secret and private@example.com"), {code: "EAUTH"});
		return {accepted: [api.config.to]};
	};
	await api.reporter.tick(); assert.equal(api.reporter.status().pendingAccounts, 1);
	assert.equal(api.reporter.status().lastSentAt, null);
	assert.equal(api.reporter.status().lastError, "Email sign-in failed. Check the sender's app password.");
	api.setTime(due + 14 * 60_000); await api.reporter.tick(); assert.equal(api.sent.length, 1);
	api.setTime(due + 15 * 60_000);
	const restarted = api.reopen(); await restarted.tick();
	assert.equal(api.sent.length, 2); assert.equal(api.sent[0].messageId, api.sent[1].messageId);
	assert.equal(restarted.status().pendingAccounts, 0); assert.equal(restarted.status().lastError, null);
});

test("concurrent workers and overlapping ticks claim a batch only once", async t => {
	const api = await setup(t); api.add("One"); api.setTime(due);
	let release;
	api.transport.sendMail = async message => { api.sent.push(message); await new Promise(resolve => { release = resolve; }); return {accepted: [api.config.to]}; };
	const pending = api.reporter.tick();
	const other = new AccountReporter(api.config, () => api.store, {transport: api.transport, now: () => due});
	await Promise.all([api.reporter.tick(), other.tick()]);
	assert.equal(api.sent.length, 1);
	release(); await pending;
	await other.tick(); assert.equal(api.sent.length, 1);
});

test("new signups during delivery wait for next week, and deleting a queued account does not mark a reused ID as sent", async t => {
	const api = await setup(t); api.add("Before"); api.setTime(due);
	api.transport.sendMail = async message => {
		api.sent.push(message); api.add("During"); return {accepted: [api.config.to]};
	};
	await api.reporter.tick(); assert.equal(api.reporter.status().pendingAccounts, 1);
	assert.ok(!api.sent[0].text.includes("During"));
	api.transport.sendMail = async () => { throw new Error("Network unavailable"); };
	api.setTime(due + week); await api.reporter.tick();
	api.store.db.prepare("DELETE FROM accounts WHERE subject = ?").run("During");
	api.add("Replacement");
	api.transport.sendMail = async message => { api.sent.push(message); return {accepted: [api.config.to]}; };
	api.setTime(due + week + 15 * 60_000); await api.reporter.tick();
	assert.equal(api.sent.length, 1); assert.equal(api.reporter.status().pendingAccounts, 1);
	api.setTime(due + 2 * week); await api.reporter.tick();
	assert.equal(api.sent.length, 2); assert.match(api.sent[1].text, /Replacement/);
});

test("missing credentials or disabled reports never send; recipient rejection never marks success", async t => {
	const api = await setup(t); api.add("Waiting"); api.setTime(due);
	api.reporter.config.ready = false; await api.reporter.tick(); assert.equal(api.sent.length, 0);
	api.reporter.config.ready = true; api.reporter.config.enabled = false; await api.reporter.tick(); assert.equal(api.sent.length, 0);
	api.reporter.config.enabled = true; api.transport.sendMail = async () => ({accepted: [], rejected: [api.config.to]});
	await api.reporter.tick(); assert.equal(api.reporter.status().pendingAccounts, 1); assert.equal(api.reporter.status().lastSentAt, null);
});

test("stale worker leases recover after a crash without changing the report ID", async t => {
	const api = await setup(t); api.add("Recover");
	const firstStore = api.reporter.getStore();
	const claimed = firstStore.claim(due);
	assert.ok(claimed);
	const otherStore = new AccountReportStore(api.store, due);
	assert.equal(otherStore.claim(due + 60_000), null);
	const recovered = otherStore.claim(due + 10 * 60_000);
	assert.equal(recovered.id, claimed.id); assert.notEqual(recovered.lease_token, claimed.lease_token);
	assert.throws(() => firstStore.complete(claimed, due + 10 * 60_000));
	otherStore.complete(recovered, due + 10 * 60_000);
	assert.equal(otherStore.status().pendingAccounts, 0);
});
