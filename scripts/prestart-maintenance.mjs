import fs from "fs";
import path from "path";
import {execSync} from "child_process";

const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, ".maintenance-state.json");
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function run(command, {allowFail = false, stdio = "pipe"} = {}) {
	try {
		const out = execSync(command, {cwd: ROOT, stdio});
		return {ok: true, out: out?.toString?.() ?? ""};
	} catch (err) {
		if (!allowFail) throw err;
		const stderr = err?.stderr?.toString?.() || err?.message || "";
		return {ok: false, out: stderr};
	}
}

function readState() {
	if (!fs.existsSync(STATE_FILE)) return null;
	try {
		return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
	} catch {
		return null;
	}
}

function writeState(payload) {
	fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
}

function removeAccidentalFiles() {
	const accidental = ["{", "console.log('Tunnel"];
	const removed = [];
	for (const rel of accidental) {
		const abs = path.join(ROOT, rel);
		if (!fs.existsSync(abs)) continue;
		try {
			fs.unlinkSync(abs);
			removed.push(rel);
		} catch {
			// Ignore file-delete failures; startup should continue.
		}
	}
	return removed;
}

function main() {
	const now = Date.now();
	const prev = readState();
	const lastRun = prev?.lastRunTs ?? 0;
	const delta = now - lastRun;

	if (delta < TWO_WEEKS_MS) {
		const daysLeft = Math.ceil((TWO_WEEKS_MS - delta) / (24 * 60 * 60 * 1000));
		console.log(`[maintenance] Skipped (next full run in ~${daysLeft} day(s)).`);
		return;
	}

	console.log("[maintenance] Running 2-week startup maintenance...");

	const summary = {
		lastRunTs: now,
		lastRunIso: new Date(now).toISOString(),
		removedFiles: [],
		git: {
			cleanWorkingTree: null,
			didPruneOrigin: false,
			didPruneUpstream: false,
			didPullOriginMain: false,
		},
		imageAudit: {
			ran: false,
			ok: false,
		},
	};

	summary.removedFiles = removeAccidentalFiles();

	const statusOut = run("git status --porcelain", {allowFail: true});
	const isClean = statusOut.ok && !statusOut.out.trim();
	summary.git.cleanWorkingTree = isClean;

	run("git remote prune origin", {allowFail: true, stdio: "pipe"});
	summary.git.didPruneOrigin = true;

	const remotes = run("git remote", {allowFail: true});
	if (remotes.ok && remotes.out.split(/\r?\n/).includes("upstream")) {
		run("git remote prune upstream", {allowFail: true, stdio: "pipe"});
		summary.git.didPruneUpstream = true;
	}

	if (isClean) {
		run("git pull --ff-only origin main", {allowFail: true, stdio: "inherit"});
		summary.git.didPullOriginMain = true;
	} else {
		console.log("[maintenance] Working tree not clean; skipped auto-pull.");
	}

	const auditScript = path.join(ROOT, "scripts", "audit-images.mjs");
	if (fs.existsSync(auditScript)) {
		const audit = run(`node ${JSON.stringify(auditScript)}`, {allowFail: true, stdio: "pipe"});
		summary.imageAudit.ran = true;
		summary.imageAudit.ok = audit.ok;
		if (audit.out) console.log(audit.out.trim());
	}

	writeState(summary);
	console.log("[maintenance] Complete.");
}

try {
	main();
} catch (err) {
	console.error("[maintenance] Non-fatal error:", err?.message || err);
	// Never block startup.
}
