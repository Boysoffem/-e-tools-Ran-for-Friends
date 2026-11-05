/* eslint-disable no-console -- Interactive local setup command. */
import {createInterface} from "node:readline/promises";
import {Writable} from "node:stream";
import {readFile, writeFile, chmod, rename} from "node:fs/promises";
import {parseEnv} from "node:util";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {readAuthConfig, normalizeEmail} from "../server/auth-config.js";
import {readReportConfig, createReportTransport} from "../server/account-reports.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = process.env.AUTH_CONFIG_FILE || path.join(root, ".env.auth");
let existing = {};
try { existing = parseEnv(await readFile(filename, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (process.argv.includes("--email-verify")) {
	const env = {...existing, ...process.env};
	const config = readReportConfig(env, readAuthConfig(env, root));
	if (!config.enabled || !config.ready) { console.error(config.issue || "Email reports are turned off."); process.exit(1); }
	const transport = createReportTransport(config);
	try { await transport.verify(); console.log("Email connection and sign-in verified. No email was sent."); } catch { console.error("Email connection failed. Check the SMTP settings and app password locally."); process.exitCode = 1; } finally { transport.close(); }
	process.exit(process.exitCode || 0);
}
if (process.argv.includes("--check")) {
	const env = {...existing, ...process.env};
	const config = readAuthConfig(env, root);
	console.log(`Optional sign-in: ${config.enabled ? "on" : "off"}\nPublic address: ${config.origin}\nAdministrator: ${config.adminEmails.size || config.adminIdentities.size ? "configured" : "not configured"}`);
	for (const [name, value] of Object.entries(config.providers)) console.log(`${name}: ${value.clientId && value.clientSecret ? "credentials configured" : "needs client ID and client secret"}\nCallback: ${config.origin}/auth/${name}/callback`);
	const report = readReportConfig(env, config);
	console.log(`Weekly email reports: ${!report.enabled ? "off" : report.ready ? "configured for Mondays at 9 a.m. Central" : report.issue}`);
	process.exit(0);
}
if (!process.stdin.isTTY) throw new Error("Run npm run auth:setup in an interactive terminal, or edit .env.auth locally.");
let muted = false;
const output = new Writable({write (chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); }});
const rl = createInterface({input: process.stdin, output, terminal: true});
rl.on("SIGINT", () => { process.stdout.write("\nSetup cancelled; nothing saved.\n"); process.exit(1); });
const ask = async (label, fallback = "") => (await rl.question(`${label}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback;
const secret = async (label, fallback = "") => {
	process.stdout.write(`${label}${fallback ? " [press Enter to keep existing]" : " [hidden]"}: `);
	muted = true;
	try { return (await rl.question("")).trim() || fallback; } finally { muted = false; process.stdout.write("\n"); }
};
try {
	const customEmail = process.argv.includes("--email-custom");
	const emailOnly = process.argv.includes("--email") || customEmail;
	console.log(emailOnly ? "Weekly account reports. Email credentials stay in .env.auth on this computer." : "Optional Google / GitHub sign-in. Credentials are saved only in .env.auth on this computer.");
	const next = {...existing};
	if (emailOnly) {
		next.AUTH_REPORT_ENABLED = /^(n|no|0)$/i.test(await ask("Enable weekly reports? yes/no", existing.AUTH_REPORT_ENABLED === "0" ? "no" : "yes")) ? "0" : "1";
		if (next.AUTH_REPORT_ENABLED === "1") {
			const authConfig = readAuthConfig(next, root);
			const administrators = [...authConfig.adminEmails];
			if (!administrators.length) throw new Error("No administrator email is configured. Run sh scripts/setup-login.sh first to set your administrator email, then run email setup again.");
			if (administrators.length === 1) next.AUTH_REPORT_TO = administrators[0];
			else {
				const savedRecipient = normalizeEmail(existing.AUTH_REPORT_TO);
				const defaultRecipient = authConfig.adminEmails.has(savedRecipient) ? savedRecipient : administrators[0];
				console.log(`Configured administrator emails: ${administrators.join(", ")}`);
				while (true) {
					const recipient = normalizeEmail(await ask("Send reports to administrator email", defaultRecipient));
					if (recipient && authConfig.adminEmails.has(recipient)) { next.AUTH_REPORT_TO = recipient; break; }
					console.log("Choose one of the administrator emails shown above, or press Enter to keep the suggested address. The app password is requested later.");
				}
			}
			console.log(`Reports will be sent to ${next.AUTH_REPORT_TO}.`);
			const useGmail = !customEmail && (!existing.SMTP_HOST || existing.SMTP_HOST === "smtp.gmail.com");
			if (useGmail) {
				next.SMTP_HOST = "smtp.gmail.com";
				next.SMTP_PORT = "465";
				next.SMTP_USER = normalizeEmail(existing.SMTP_USER) || next.AUTH_REPORT_TO;
				next.SMTP_FROM = next.SMTP_USER;
				console.log(`Sending from Gmail: ${next.SMTP_USER}. Connection settings are filled in automatically.`);
				console.log("Create a Gmail app password at https://myaccount.google.com/apppasswords. Paste it only at the hidden prompt below. Use the app password, not your normal Gmail password.");
				while (true) {
					const password = (await secret("Gmail app password", existing.SMTP_PASSWORD)).replace(/\s/g, "");
					if (/^[a-z0-9]{16}$/i.test(password)) { next.SMTP_PASSWORD = password; break; }
					console.log("Please paste Google's 16-character app password. Spaces between groups are fine. Your entry stays hidden. Press Ctrl+C to cancel without saving.");
				}
			} else {
				next.SMTP_HOST = await ask("SMTP host", existing.SMTP_HOST || "smtp.gmail.com");
				next.SMTP_PORT = await ask("SMTP port (465 for TLS, 587 for STARTTLS)", existing.SMTP_PORT || "465");
				next.SMTP_USER = await ask("Sending mailbox / SMTP username", existing.SMTP_USER || next.AUTH_REPORT_TO);
				next.SMTP_FROM = await ask("Sender email", existing.SMTP_FROM || next.SMTP_USER);
				if (next.SMTP_HOST === "smtp.gmail.com") console.log("Use a Gmail app password at the hidden prompt below, not your normal Gmail password.");
				next.SMTP_PASSWORD = await secret("Email app password / SMTP password", existing.SMTP_PASSWORD);
				if (next.SMTP_HOST === "smtp.gmail.com") next.SMTP_PASSWORD = next.SMTP_PASSWORD.replace(/\s/g, "");
			}
			const report = readReportConfig(next, authConfig);
			if (!report.ready) throw new Error(report.issue);
		}
	} else {
		next.AUTH_ENABLED = /^(n|no|0)$/i.test(await ask("Enable optional sign-in? yes/no", existing.AUTH_ENABLED === "0" ? "no" : "yes")) ? "0" : "1";
	}
	if (!emailOnly && next.AUTH_ENABLED === "1") {
		next.AUTH_BASE_URL = await ask("Public HTTPS address (no trailing path)", existing.AUTH_BASE_URL || "http://localhost:3000");
		next.AUTH_ADMIN_EMAILS = await ask("Administrator email (comma-separated for more than one)", existing.AUTH_ADMIN_EMAILS);
		// Validate the public address and administrator before displaying callbacks.
		const config = readAuthConfig(next, root);
		for (const name of ["google", "github"]) {
			console.log(`\n${name === "google" ? "Google: https://console.cloud.google.com/auth/clients" : "GitHub: https://github.com/settings/developers"}\nCallback: ${config.origin}/auth/${name}/callback`);
			const prefix = name.toUpperCase();
			next[`${prefix}_CLIENT_ID`] = await ask(`${name} client ID (blank to leave disconnected)`, existing[`${prefix}_CLIENT_ID`]);
			if (next[`${prefix}_CLIENT_ID`]) next[`${prefix}_CLIENT_SECRET`] = await secret(`${name} client secret`, existing[`${prefix}_CLIENT_SECRET`]);
		}
	}
	readAuthConfig(next, root);
	const entries = Object.entries(next).map(([key, value]) => {
		// eslint-disable-next-line no-control-regex -- Do not permit NUL bytes in environment files.
		if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /["\r\n\x00]/.test(value)) throw new Error("Configuration values cannot contain quotes or line breaks.");
		return `${key}="${value}"`;
	});
	const temporary = `${filename}.tmp`;
	await writeFile(temporary, `# Private optional sign-in configuration. Never commit or share this file.\n${entries.join("\n")}\n`, {mode: 0o600});
	await chmod(temporary, 0o600);
	await rename(temporary, filename);
	console.log(emailOnly ? "\nSaved. Run this command with --email-verify to check the connection, then restart the server. Reports go out Mondays at 9 a.m. Central, only when new accounts exist. No email was sent by setup." : "\nSaved. Restart the server, then open /login.html. The site remains usable without signing in.");
} catch (error) {
	console.error(`Setup was not saved. ${error.message}`);
	process.exitCode = 1;
} finally { rl.close(); }
