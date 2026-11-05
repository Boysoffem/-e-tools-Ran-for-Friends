import {DatabaseSync} from "node:sqlite";
import {mkdirSync, chmodSync} from "node:fs";
import path from "node:path";
import {createHash, randomBytes} from "node:crypto";

export const randomToken = () => randomBytes(32).toString("base64url");
export const hashToken = value => createHash("sha256").update(value).digest("hex");
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

export class AuthStore {
	constructor (directory) {
		this.directory = path.resolve(directory);
		mkdirSync(this.directory, {recursive: true, mode: 0o700});
		chmodSync(this.directory, 0o700);
		const filename = path.join(this.directory, "accounts.sqlite");
		this.db = new DatabaseSync(filename);
		chmodSync(filename, 0o600);
		this.db.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA foreign_keys = ON;
			PRAGMA busy_timeout = 5000;
			CREATE TABLE IF NOT EXISTS accounts (
				id INTEGER PRIMARY KEY, provider TEXT NOT NULL, subject TEXT NOT NULL,
				name TEXT NOT NULL, email TEXT, first_login INTEGER NOT NULL,
				last_login INTEGER NOT NULL, login_count INTEGER NOT NULL DEFAULT 1,
				UNIQUE(provider, subject)
			);
			CREATE TABLE IF NOT EXISTS sessions (
				token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				expires INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS oauth_states (
				state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, provider TEXT NOT NULL,
				verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL
			);
		`);
		this.cleanup();
	}

	cleanup () {
		this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
		this.db.prepare("DELETE FROM oauth_states WHERE expires <= ?").run(Date.now());
	}

	start (provider, browserToken) {
		this.cleanup();
		// Bound abandoned flows. Cookies contain only unpredictable random values.
		if (this.db.prepare("SELECT count(*) AS count FROM oauth_states").get().count >= 1000) throw new Error("Sign-in is busy.");
		const state = randomToken(); const verifier = randomToken(); const nonce = randomToken();
		this.db.prepare("INSERT INTO oauth_states VALUES (?, ?, ?, ?, ?, ?)")
			.run(hashToken(state), hashToken(browserToken), provider, verifier, nonce, Date.now() + 10 * 60_000);
		return {state, verifier, nonce};
	}

	consume (state, browserToken, provider) {
		if (!/^[\w-]{43}$/.test(state || "") || !/^[\w-]{43}$/.test(browserToken || "")) return null;
		return this.db.prepare("DELETE FROM oauth_states WHERE state_hash = ? AND browser_hash = ? AND provider = ? AND expires > ? RETURNING *")
			.get(hashToken(state), hashToken(browserToken), provider, Date.now());
	}

	login (profile, oldToken) {
		const token = randomToken();
		const now = Date.now();
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const account = this.db.prepare(`INSERT INTO accounts (provider, subject, name, email, first_login, last_login)
				VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider, subject) DO UPDATE SET
				name = excluded.name, email = excluded.email, last_login = excluded.last_login, login_count = login_count + 1 RETURNING *`)
				.get(profile.provider, profile.subject, profile.name, profile.email, now, now);
			this.logout(oldToken);
			this.db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(hashToken(token), account.id, now + SESSION_SECONDS * 1000);
			this.db.exec("COMMIT");
			return token;
		} catch (error) { this.db.exec("ROLLBACK"); throw error; }
	}

	account (token) {
		if (!/^[\w-]{43}$/.test(token || "")) return null;
		return this.db.prepare("SELECT accounts.* FROM accounts JOIN sessions ON sessions.account_id = accounts.id WHERE token_hash = ? AND expires > ?")
			.get(hashToken(token), Date.now()) || null;
	}

	logout (token) {
		if (typeof token === "string") this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
	}

	list (offset = 0) {
		return {
			total: this.db.prepare("SELECT count(*) AS count FROM accounts").get().count,
			accounts: this.db.prepare("SELECT * FROM accounts ORDER BY last_login DESC, id DESC LIMIT 50 OFFSET ?").all(offset),
		};
	}

	close () { this.db.close(); }
}
