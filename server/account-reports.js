import {randomUUID} from "node:crypto";
import nodemailer from "nodemailer";
import {normalizeEmail} from "./auth-config.js";

const ZONE = "America/Chicago";
const calendar = new Intl.DateTimeFormat("en-US", {timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23"});

// A period begins each Monday at 09:00 Central, including across DST changes.
export function reportPeriod (now = Date.now()) {
	const parts = Object.fromEntries(calendar.formatToParts(now).map(it => [it.type, it.value]));
	const daysSinceMonday = {Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6}[parts.weekday];
	const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
	date.setUTCDate(date.getUTCDate() - daysSinceMonday - (daysSinceMonday === 0 && Number(parts.hour) < 9 ? 7 : 0));
	return date.toISOString().slice(0, 10);
}

export function readReportConfig (env, authConfig) {
	const enabled = /^(1|true)$/i.test(env.AUTH_REPORT_ENABLED || "");
	const to = normalizeEmail(env.AUTH_REPORT_TO || [...authConfig.adminEmails][0]);
	const from = normalizeEmail(env.SMTP_FROM || env.SMTP_USER);
	const host = (env.SMTP_HOST || "").trim();
	const port = Number(env.SMTP_PORT || 465);
	const user = env.SMTP_USER || "";
	const password = env.SMTP_PASSWORD || "";
	let issue = null;
	if (!to || !authConfig.adminEmails.has(to)) issue = "Choose one configured administrator email as the report recipient.";
	else if (!from || !host || !user || !password) issue = "Waiting for the sender's email settings and app password.";
	else if (!Number.isInteger(port) || port < 1 || port > 65535 || /[\s/@]/.test(host)) issue = "Check the SMTP host and port in the local settings.";
	return {enabled: enabled && authConfig.enabled, requested: enabled, ready: !issue, issue, to, from, host, port, user, password, origin: authConfig.origin};
}

export function createReportTransport (config) {
	return nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.port === 465,
		requireTLS: true,
		tls: {minVersion: "TLSv1.2"},
		auth: {user: config.user, pass: config.password},
		connectionTimeout: 15000,
		greetingTimeout: 15000,
		socketTimeout: 30000,
		dnsTimeout: 10000,
		logger: false,
		debug: false,
		disableFileAccess: true,
		disableUrlAccess: true,
		maxRecipients: 1,
	});
}

export function formatAccountReport (accounts, config, batch) {
	const dateFormat = new Intl.DateTimeFormat("en-US", {timeZone: ZONE, dateStyle: "medium", timeStyle: "short"});
	const lines = accounts.map(account => [
		`Name: ${account.name}`,
		`Email: ${account.email || "No verified primary email provided"}`,
		`Provider: ${account.provider === "google" ? "Google" : "GitHub"}`,
		`Account created: ${dateFormat.format(account.first_login)} (Central)`,
	].join("\n"));
	return {
		from: {name: "5etools for Friends", address: config.from},
		to: {address: config.to},
		// Addresses from the account list are body text only, never recipients.
		envelope: {from: config.from, to: [config.to]},
		subject: `5etools: ${accounts.length} new account${accounts.length === 1 ? "" : "s"} — weekly report`,
		messageId: `<5etools-accounts-${batch.id}@${config.from.split("@")[1]}>`,
		text: `New accounts for your 5etools site\nWeekly report scheduled for ${batch.period}\n\n${lines.join("\n\n")}\n\nPrivate account list: ${config.origin}/admin-accounts.html\n\nOnly newly created accounts are included. Repeat sign-ins are not new accounts.\nThis private report is sent only to your configured administrator email.\n`,
	};
}

export class AccountReportStore {
	constructor (authStore, now = Date.now()) {
		this.db = authStore.db;
		const columns = new Set(this.db.prepare("PRAGMA table_info(accounts)").all().map(it => it.name));
		if (!columns.has("report_batch_id")) this.db.exec("ALTER TABLE accounts ADD COLUMN report_batch_id TEXT");
		if (!columns.has("reported_at")) this.db.exec("ALTER TABLE accounts ADD COLUMN reported_at INTEGER");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS account_report_state (
				id INTEGER PRIMARY KEY CHECK (id = 1), last_period TEXT NOT NULL, last_sent_at INTEGER, last_error TEXT
			);
			CREATE TABLE IF NOT EXISTS account_report_batches (
				id TEXT PRIMARY KEY, period TEXT NOT NULL, status TEXT NOT NULL,
				attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
				lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
				sent_at INTEGER, account_count INTEGER NOT NULL DEFAULT 0
			);
			CREATE UNIQUE INDEX IF NOT EXISTS one_pending_account_report ON account_report_batches(status) WHERE status = 'pending';
		`);
		// Enabling reports starts the weekly schedule; existing accounts are included at the next due date.
		this.db.prepare("INSERT OR IGNORE INTO account_report_state (id, last_period) VALUES (1, ?)").run(reportPeriod(now));
	}

	claim (now) {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const period = reportPeriod(now);
			let batch = this.db.prepare("SELECT * FROM account_report_batches WHERE status = 'pending'").get();
			if (!batch) {
				const state = this.state();
				if (period <= state.last_period) { this.db.exec("COMMIT"); return null; }
				if (!this.db.prepare("SELECT 1 FROM accounts WHERE reported_at IS NULL LIMIT 1").get()) {
					this.db.prepare("UPDATE account_report_state SET last_period = ?, last_error = NULL WHERE id = 1").run(period);
					this.db.exec("COMMIT"); return null;
				}
				const id = randomUUID();
				this.db.prepare("INSERT INTO account_report_batches (id, period, status) VALUES (?, ?, 'pending')").run(id, period);
				this.db.prepare("UPDATE accounts SET report_batch_id = ? WHERE reported_at IS NULL AND report_batch_id IS NULL").run(id);
				batch = this.db.prepare("SELECT * FROM account_report_batches WHERE id = ?").get(id);
			}
			if (batch.retry_at > now || batch.lease_until > now) { this.db.exec("COMMIT"); return null; }
			const lease = randomUUID();
			this.db.prepare("UPDATE account_report_batches SET lease_token = ?, lease_until = ?, attempts = attempts + 1 WHERE id = ?").run(lease, now + 10 * 60_000, batch.id);
			const accounts = this.db.prepare("SELECT name, email, provider, first_login FROM accounts WHERE report_batch_id = ? AND reported_at IS NULL ORDER BY first_login, id").all(batch.id);
			this.db.exec("COMMIT");
			return {...batch, lease_token: lease, attempts: batch.attempts + 1, accounts};
		} catch (error) { this.db.exec("ROLLBACK"); throw error; }
	}

	complete (batch, now) {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const updated = this.db.prepare("UPDATE account_report_batches SET status = ?, sent_at = ?, account_count = ?, lease_until = 0 WHERE id = ? AND lease_token = ? AND status = 'pending'")
				.run(batch.accounts.length ? "sent" : "skipped", batch.accounts.length ? now : null, batch.accounts.length, batch.id, batch.lease_token);
			if (!updated.changes) throw new Error("Report lease no longer belongs to this worker.");
			this.db.prepare("UPDATE accounts SET reported_at = ?, report_batch_id = NULL WHERE report_batch_id = ?").run(now, batch.id);
			this.db.prepare("UPDATE account_report_state SET last_period = ?, last_sent_at = CASE WHEN ? > 0 THEN ? ELSE last_sent_at END, last_error = NULL WHERE id = 1")
				.run(reportPeriod(now), batch.accounts.length, now);
			this.db.exec("COMMIT");
		} catch (error) { this.db.exec("ROLLBACK"); throw error; }
	}

	fail (batch, now, reason) {
		const delay = Math.min(24 * 60, 15 * 2 ** Math.min(batch.attempts - 1, 7)) * 60_000;
		const updated = this.db.prepare("UPDATE account_report_batches SET retry_at = ?, lease_until = 0 WHERE id = ? AND lease_token = ? AND status = 'pending'").run(now + delay, batch.id, batch.lease_token);
		if (updated.changes) this.db.prepare("UPDATE account_report_state SET last_error = ? WHERE id = 1").run(reason);
	}

	state () { return this.db.prepare("SELECT * FROM account_report_state WHERE id = 1").get(); }
	status () {
		const state = this.state();
		const batch = this.db.prepare("SELECT retry_at, lease_until FROM account_report_batches WHERE status = 'pending'").get();
		return {lastSentAt: state.last_sent_at, lastError: state.last_error, pendingAccounts: this.db.prepare("SELECT count(*) AS count FROM accounts WHERE reported_at IS NULL").get().count, retryAt: batch?.retry_at || null};
	}
}

export class AccountReporter {
	constructor (config, getAuthStore, {transport, now = Date.now} = {}) {
		this.config = config; this.getAuthStore = getAuthStore; this.transport = transport; this.now = now;
	}
	getStore () { return this.store ||= new AccountReportStore(this.getAuthStore(), this.now()); }
	getTransport () { return this.transport ||= createReportTransport(this.config); }
	status () {
		return {enabled: this.config.enabled,
			ready: this.config.ready,
			schedule: "Mondays at 9:00 a.m. Central",
			recipient: this.config.to,
			setupIssue: this.config.issue,
			...(this.config.enabled ? this.getStore().status() : {})};
	}
	async tick () {
		if (this.busy || !this.config.enabled || !this.config.ready) return;
		this.busy = true;
		let batch;
		try {
			batch = this.getStore().claim(this.now());
			if (!batch) return;
			if (batch.accounts.length) {
				const result = await this.getTransport().sendMail(formatAccountReport(batch.accounts, this.config, batch));
				if (!result.accepted?.some(it => normalizeEmail(typeof it === "string" ? it : it.address) === this.config.to)) throw new Error("Recipient not accepted.");
			}
			this.getStore().complete(batch, this.now());
		} catch (error) {
			// Store only fixed messages. SMTP responses may contain addresses or credentials.
			const reason = error.code === "EAUTH" ? "Email sign-in failed. Check the sender's app password." : "The report could not be sent. It will be retried automatically.";
			try { if (batch) this.getStore().fail(batch, this.now(), reason); } catch { /* Keep the durable lease for recovery after restart. */ }
		} finally { this.busy = false; }
	}
	start () {
		if (!this.config.enabled || this.timer) return;
		this.getStore();
		void this.tick();
		this.timer = setInterval(() => { void this.tick(); }, 60_000);
		this.timer.unref();
	}
	stop () { clearInterval(this.timer); this.timer = null; this.transport?.close?.(); }
}
