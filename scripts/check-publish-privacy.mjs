/* eslint-disable no-console -- Local publishing check; never print matched private values. */
import {execFileSync} from "node:child_process";
import {readFileSync, existsSync} from "node:fs";
import {parseEnv} from "node:util";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staged = process.argv.includes("--staged");
const git = args => execFileSync("git", args, {cwd: root, maxBuffer: 64 * 1024 * 1024});
const files = [...new Set(git(staged ? ["ls-files", "-z"] : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean))];
const privateValues = new Set();
const privatePaths = [".env.auth", ".private-auth", ".shared-homebrew"];
const configPath = process.env.AUTH_CONFIG_FILE || path.join(root, ".env.auth");
let env = {...process.env};
if (existsSync(configPath)) env = {...parseEnv(readFileSync(configPath, "utf8")), ...env};
for (const [key, value] of Object.entries(env)) {
	if (!/^(?:AUTH_ADMIN_EMAILS|AUTH_REPORT_TO|AUTH_BASE_URL|SMTP_USER|SMTP_FROM|SMTP_PASSWORD|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GITHUB_CLIENT_ID|GITHUB_CLIENT_SECRET)$/.test(key)) continue;
	for (const part of value.split(",")) if (part.trim().length >= 6 && !/example\.(?:com|org|net)|\.example(?:[/:]|$)|localhost/.test(part)) privateValues.add(part.trim());
}
for (const value of [configPath, env.AUTH_STORAGE_DIR, env.HOMEBREW_STORAGE_DIR].filter(Boolean)) {
	const relative = path.relative(root, path.resolve(root, value)).split(path.sep).join("/");
	if (relative && !relative.startsWith("../")) privatePaths.push(relative);
}

const problems = [];
for (const filename of files) {
	const basename = path.posix.basename(filename);
	if (privatePaths.some(p => filename === p || filename.startsWith(`${p}/`))
		|| (/(?:^|\/)(?:\.env(?:\..*)?|LOCAL-SETUP\.md|analytics(?:\.[^/]*)?\.json|accounts\.csv|backups|exports|\.runtime)(?:\/|$)/i.test(filename) && basename !== ".env.example")
		|| /\.(?:sqlite|db)(?:-(?:wal|shm))?$|\.(?:backup|bak|pem|key)$/i.test(filename)) {
		problems.push([filename, "private configuration, records, or backup file"]); continue;
	}
	if (!staged && !existsSync(path.join(root, filename))) continue;
	const data = staged ? git(["show", `:${filename}`]) : readFileSync(path.join(root, filename));
	if ([...privateValues].some(value => data.includes(Buffer.from(value)))) problems.push([filename, "value from local private configuration"]);
	if (data.subarray(0, 8192).includes(0)) continue;
	const text = data.toString("utf8");
	if (/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|AIza[\w-]{35}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text)) problems.push([filename, "credential-shaped value"]);
	if (/(?:\/home\/|\/Users\/)[A-Za-z0-9_.-]+\/|[A-Z]:\\Users\\[^\\\r\n]+\\/.test(text)) problems.push([filename, "personal machine path"]);
	// Published vendor credits and lockfile metadata are retained. Application examples use reserved domains.
	if (!/^(?:lib\/|data\/|search\/|spellcheck\/)|(?:^|\/)(?:LICENSE[^/]*|package-lock\.json)$/.test(filename)) {
		const emails = text.match(/[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) || [];
		if (emails.some(email => !/@(?:[\w-]+\.)*(?:example\.(?:com|org|net|test)|localhost\.test|users\.noreply\.github\.com)$/i.test(email))) problems.push([filename, "email outside reserved examples or GitHub no-reply addresses"]);
	}
}
if (problems.length) {
	for (const [filename, reason] of problems) console.error(`${filename}: ${reason} (value hidden)`);
	console.error("Privacy check failed. Remove private content from the publishable files before committing or pushing.");
	process.exitCode = 1;
} else console.log(`Privacy check passed for ${files.length} ${staged ? "staged" : "publishable"} files. This is a guard against common leaks, not a guarantee against every kind of personal data.`);
