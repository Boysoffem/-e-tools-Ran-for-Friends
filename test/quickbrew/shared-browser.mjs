import {chromium} from "playwright";
import {spawn} from "node:child_process";
import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import assert from "node:assert/strict";
const directory = await mkdtemp(path.join(tmpdir(), "shared-homebrew-browser-"));
const port = 3139;
const base = `http://127.0.0.1:${port}`;
let server;
let browser;
async function start () {
	server = spawn(process.execPath, ["server.js"], {env: {...process.env, PORT: String(port), HOMEBREW_STORAGE_DIR: directory, DISABLE_AUTO_UPDATE: "1", AUTH_ENABLED: "0"}, stdio: "pipe"});
	let errors = ""; server.stderr.on("data", data => { errors += data; });
	for (let i = 0; i < 100; i++) { if (server.exitCode != null) throw new Error(errors); try { if ((await fetch(`${base}/api/shared-homebrew`)).ok) return; } catch { /* Retry while the isolated test server starts. */ } await new Promise(resolve => setTimeout(resolve, 100)); }
	throw new Error("Test server did not start");
}
async function stop () { if (!server || server.exitCode != null || server.signalCode != null) return; const exited = new Promise(resolve => server.once("exit", resolve)); server.kill("SIGTERM"); await exited; server = null; }
try {
	await start(); browser = await chromium.launch({headless: true});
	const a = await browser.newContext(); const b = await browser.newContext();
	const alice = await a.newPage(); const bob = await b.newPage();
	const errors = []; for (const page of [alice, bob]) { page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message)); }
	await Promise.all([alice.goto(`${base}/managebrew.html`), bob.goto(`${base}/feats.html`)]);
	await alice.waitForFunction(() => document.querySelector("[name=parentClass]")?.options.length > 1);
	await bob.waitForFunction(() => globalThis.BrewUtil2?._sharedClient?.state?.revision === 0);
	await alice.locator("[data-editor] [name=kind]").selectOption("feat");
	await alice.locator("[data-editor] [name=name]").fill("Shared Moon Gift");
	await alice.locator("[data-editor] [name=description]").fill("You can see moonlight through clouds.");
	await alice.getByRole("button", {name: "Check & preview", exact: true}).click();
	await alice.waitForFunction(() => !document.querySelector("[data-save]").disabled);
	await alice.locator("[data-save]").click();
	await alice.waitForFunction(() => document.querySelector("[data-status]").textContent.includes("Shared 1 records"));
	await bob.evaluate(() => BrewUtil2._sharedClient.poll());
	await bob.waitForSelector("#shared-homebrew-notice button");
	await bob.locator("#shared-homebrew-notice button").click();
	await bob.waitForFunction(() => document.body.textContent.includes("Shared Moon Gift"));
	console.log("PASS: a second independent browser sees the shared feat and receives an update notice");
	// Regular file imports use the same shared storage, not just Workshop saves.
	await alice.evaluate(async () => {
		await BrewUtil2.pAddBrewsFromFiles([{name: "friends.json", json: {_meta: {sources: [{json: "FriendsTest", full: "Friends Test", abbreviation: "FT"}]}, race: [{name: "Moonfolk", source: "FriendsTest", size: ["M"], speed: 30, entries: ["Friends of the moon."]}]}}]);
	});
	await bob.goto(`${base}/races.html`);
	await bob.waitForFunction(() => document.body.textContent.includes("Moonfolk"));
	assert.equal(await alice.evaluate(async () => (await BrewUtil2.pGetBrewProcessed()).race.filter(it => it.name === "Moonfolk").length), 1);
	console.log("PASS: standard imports are shared and do not duplicate local copies");
	await alice.evaluate(async () => {
		await BrewUtil2.pAddSource({json: "BuilderTest", full: "Builder Test", abbreviation: "BT"});
		await BrewUtil2.pPersistEditableBrewEntity("feat", {name: "Builder Gift", source: "BuilderTest", entries: ["A builder entry."], uniqueId: "builder-test-id"});
	});
	await bob.goto(`${base}/feats.html`); await bob.waitForFunction(() => document.body.textContent.includes("Builder Gift"));
	console.log("PASS: existing builder saves are shared");
	await stop(); await start();
	const fresh = await browser.newContext(); const newcomer = await fresh.newPage();
	await newcomer.goto(`${base}/feats.html`); await newcomer.waitForFunction(() => document.body.textContent.includes("Shared Moon Gift") && document.body.textContent.includes("Builder Gift"));
	console.log("PASS: new visitors receive the library after a server restart");
	await stop();
	await alice.locator("[data-editor] [name=name]").fill("Offline Gift");
	await alice.getByRole("button", {name: "Check & preview", exact: true}).click();
	await alice.waitForFunction(() => !document.querySelector("[data-save]").disabled);
	await alice.locator("[data-save]").click(); await alice.waitForFunction(() => document.querySelector("[data-status]").textContent.includes("Could not save"));
	assert.equal(await alice.locator("[data-editor] [name=name]").inputValue(), "Offline Gift");
	console.log("PASS: failed publication keeps the draft and never claims success");
	assert.deepEqual(errors, []);
} finally { if (browser) await browser.close(); await stop(); await rm(directory, {recursive: true, force: true}); }
