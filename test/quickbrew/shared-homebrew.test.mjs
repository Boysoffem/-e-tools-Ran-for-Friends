import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import http from "node:http";
import {SharedHomebrewStore, createSharedHomebrewHandler} from "../../server/shared-homebrew.js";
import {buildWorkshopBrew} from "../../js/homebrew/workshop-model.js";
import {changesBetween, sharedKey} from "../../js/homebrew/shared-model.js";
const brew = name => buildWorkshopBrew({kind: "feat", name, description: "You gain a new ability.", sourceId: "SharedTest", sourceName: "Shared Test"});
async function fixture (fn) { const dir = await mkdtemp(path.join(tmpdir(), "shared-brew-")); try { await fn(new SharedHomebrewStore(dir), dir); } finally { await rm(dir, {recursive: true, force: true}); } }
test("shared saves survive restarts and preserve simultaneous additions", () => fixture(async (store, dir) => {
	await Promise.all([store.publish({brew: brew("One")}), store.publish({brew: brew("Two")})]);
	const state = await new SharedHomebrewStore(dir).read();
	assert.equal(state.revision, 2); assert.equal(state.brew.feat.length, 2);
	assert.equal(JSON.parse(await readFile(`${store.file}.backup`, "utf8")).revision, 1);
}));
test("same-content retries are idempotent; concurrent edits conflict without partial writes", () => fixture(async store => {
	const first = await store.publish({brew: brew("One")});
	assert.equal((await store.publish({brew: brew("One")})).revision, 1);
	const edited = brew("One"); edited.feat[0].entries = ["Updated rules"];
	const expected = {[sharedKey("feat", first.brew.feat[0])]: first.brew.feat[0]};
	await store.publish({brew: edited, expected});
	const stale = brew("One"); stale.feat[0].entries = ["Stale edit"]; stale.feat.push({...brew("Another").feat[0]});
	await assert.rejects(store.publish({brew: stale, expected}), error => error.status === 409);
	assert.equal((await store.read()).brew.feat.length, 1);
	assert.deepEqual((await store.read()).brew.feat[0].entries, ["Updated rules"]);
}));
test("malformed, unsafe, duplicate, and conflicting-source data cannot publish", () => fixture(async store => {
	for (const input of [{}, {feat: []}, {...brew("Bad"), feat: [{...brew("Bad").feat[0], entries: ["<img src=x onerror=\"alert(1)\">"]}]}, {...brew("Dupe"), feat: [brew("Dupe").feat[0], brew("Dupe").feat[0]]}]) await assert.rejects(store.publish({brew: input}));
	await store.publish({brew: brew("Good")});
	const other = brew("Second"); other._meta.sources[0].full = "Different book";
	await assert.rejects(store.publish({brew: other}), error => error.status === 409);
	assert.equal((await store.read()).brew.feat.length, 1);
}));
test("only additions and edits are published, never historical content or browser deletions", () => {
	const before = [{body: brew("Private") }];
	const after = structuredClone(before); after[0].body.feat.push(brew("New").feat[0]);
	const diff = changesBetween(before, after);
	assert.deepEqual(diff.brew.feat.map(it => it.name), ["New"]);
	assert.equal(changesBetween(before, []).brew.feat, undefined);
	const idOnly = structuredClone(before); idOnly[0].body.feat[0].uniqueId = "browser-id";
	assert.equal(changesBetween(before, idOnly).brew.feat, undefined);
});
test("HTTP API blocks cross-site writes, disables caching, and shares valid saves", () => fixture(async store => {
	const handler = createSharedHomebrewHandler(store);
	const server = http.createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}/api/shared-homebrew`;
	try {
		const headers = {"Content-Type": "application/json", "X-Homebrew-Share": "1"};
		const cross = await fetch(url, {method: "POST", headers: {...headers, Origin: "https://another-site.test"}, body: JSON.stringify({brew: brew("Blocked")})}); assert.equal(cross.status, 403);
		const saved = await fetch(url, {method: "POST", headers, body: JSON.stringify({brew: brew("Public")})}); assert.equal(saved.status, 200);
		const read = await fetch(url); assert.equal(read.headers.get("cache-control"), "no-store"); assert.equal((await read.json()).brew.feat[0].name, "Public");
		assert.equal((await (await fetch(`${url}/revision`)).json()).revision, 1);
	} finally { await new Promise(resolve => server.close(resolve)); }
}));
