/* eslint-disable no-console -- Local administrator command. */
import path from "node:path";
import {fileURLToPath} from "node:url";
import {existsSync} from "node:fs";
import {AuthStore} from "../server/auth-store.js";
import {readAuthConfig, normalizeEmail} from "../server/auth-config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = process.env.AUTH_CONFIG_FILE || path.join(root, ".env.auth");
if (existsSync(filename)) process.loadEnvFile(filename);
const config = readAuthConfig(process.env, root);
const store = new AuthStore(config.directory);
try {
	if (process.argv[2] === "--remove") {
		const email = normalizeEmail(process.argv[3]);
		if (!email) throw new Error("Usage: npm run auth:accounts -- --remove person@example.com");
		const result = store.db.prepare("DELETE FROM accounts WHERE email = ?").run(email);
		console.log(`Removed ${result.changes} account record(s) and their sessions. Signing in again creates a new record.`);
	} else if (process.argv.length === 2) {
		console.table(store.db.prepare("SELECT provider, subject, name, email, login_count FROM accounts ORDER BY last_login DESC").all());
	} else throw new Error("Usage: npm run auth:accounts [-- --remove person@example.com]");
} finally { store.close(); }
