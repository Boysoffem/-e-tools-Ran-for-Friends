import {test} from "node:test";
import assert from "node:assert/strict";
import {buildWorkshopBrew, validateBrew, persistBrew, mergeBrews, clone} from "../../js/homebrew/workshop-model.js";
import {segmentPages, textItemsToPage, buildReviewedBook, makeBookBrew, readProject} from "../../js/homebrew/book-model.js";

const base = {name: "Moon Warden", description: "A test entry.", sourceId: "TestBrew", sourceName: "Test Book", edition: "classic"};
const cases = {item: {}, weapon: {damage: "1d8", properties: ["V"], versatile: "1d10"}, armor: {ac: 14}, race: {speed: 30, features: [{name: "Moon Sight", description: "You see in dim light."}]}, class: {hitDie: 8, saves: ["con", "wis"], features: [{name: "Moonlight", level: 1, description: "You shed light.", subclassGrant: true}]}, subclass: {className: "Fighter", classSource: "PHB", features: [{name: "Moonlight", level: 3, description: "You shed light."}]}, feat: {}, background: {}, spell: {level: 1, school: "V", casting: "action", rangeType: "self", duration: "instant"}};
for (const [kind, extra] of Object.entries(cases)) {
	test(`${kind}: output passes upstream homebrew schema`, async () => {
		const brew = buildWorkshopBrew({...base, kind, ...extra});
		const {errors} = await validateBrew(brew, {knownClasses: [{name: "Fighter", source: "PHB"}]});
		assert.deepEqual(errors, []);
	});
}
test("class features are linked at explicit levels and subclass grant levels are retained", () => {
	const brew = buildWorkshopBrew({...base, kind: "class", ...cases.class});
	assert.equal(brew.class[0].classFeatures[0].gainSubclassFeature, true);
	assert.equal(brew.classFeature[0].level, 1);
	assert.match(brew.class[0].classFeatures[0].classFeature, /Moonlight\|Moon Warden\|TestBrew\|1\|TestBrew/);
});
test("missing feature and wrong parent edition are rejected", async () => {
	const brew = buildWorkshopBrew({...base, kind: "subclass", ...cases.subclass});
	delete brew.subclassFeature;
	const {errors} = await validateBrew(brew, {knownClasses: [{name: "Fighter", source: "XPHB"}]});
	assert.ok(errors.some(it => it.includes("missing linked feature")));
	assert.ok(errors.some(it => it.includes("parent class")));
});
test("numeric ranges, feature levels, and malformed tables cannot silently export", () => {
	assert.throws(() => buildWorkshopBrew({...base, kind: "weapon", damage: "1d8", weaponType: "R", rangeNormal: 80, rangeLong: 20}), /Long range/);
	assert.throws(() => buildWorkshopBrew({...base, kind: "class", ...cases.class, features: [{name: "Bad", level: 21, description: "Invalid."}]}), /Feature level/);
	assert.throws(() => buildWorkshopBrew({...base, kind: "class", ...cases.class, progression: "Points | Slots\n1 | 2"}), /20 rows/);
});
test("schema catches malformed damage and unsupported fields in edited JSON", async () => {
	const brew = buildWorkshopBrew({...base, kind: "weapon", ...cases.weapon});
	brew.item[0].dmgType = "WRONG";
	assert.ok((await validateBrew(brew)).errors.length);
});
test("duplicate matching keys cannot hide in a merged book", () => {
	const brew = buildWorkshopBrew({...base, kind: "race", ...cases.race});
	assert.throws(() => mergeBrews([brew, brew]), /Duplicate/);
});
test("save is a single update; collisions fail before writes and explicit updates preserve IDs", async () => {
	const brew = buildWorkshopBrew({...base, kind: "class", ...cases.class});
	let stored = {head: {docIdLocal: "local"}, body: {_meta: {sources: []}}};
	let writes = 0;
	globalThis.CryptUtil = {uid: () => `id-${Math.random()}`};
	const brewUtil = {pGetOrCreateEditableBrewDoc: async () => clone(stored), pGetBrew: async () => [clone(stored)], pSetEditableBrewDoc: async doc => { writes++; stored = doc; }};
	await persistBrew(brew, {brewUtil});
	assert.equal(writes, 1);
	const id = stored.body.class[0].uniqueId;
	await assert.rejects(persistBrew(brew, {brewUtil}), /already exists/);
	assert.equal(writes, 1);
	await persistBrew(brew, {brewUtil, overwrite: true});
	assert.equal(stored.body.class[0].uniqueId, id);
	assert.equal(stored.body.classFeature.length, 1);
});
const spellText = "Starfire\n1st-level evocation\nCasting Time: 1 action\nRange: 60 feet\nComponents: V, S\nDuration: Instantaneous\nDeal 2d6 fire damage.";
test("book segmentation preserves unrecognized text and page provenance", () => {
	const sections = segmentPages([{page: 7, pdfPage: 10, text: `Intro prose.\n\n${spellText}`}, {page: 8, pdfPage: 11, text: "Unclassified appendix."}]);
	assert.equal(sections.length, 3);
	assert.equal(sections[0].kind, "unknown");
	assert.equal(sections[1].kind, "spell");
	assert.equal(sections[1].pdfPage, 10);
	assert.equal(sections[2].text, "Unclassified appendix.");
});
test("two-column extraction preserves text without interleaving columns", () => {
	const item = (str, x, y) => ({str, transform: [10, 0, 0, 10, x, y], width: 20, height: 10});
	const page = textItemsToPage([item("Left1", 10, 90), item("Right1", 310, 90), item("Left2", 10, 70), item("Right2", 310, 70)], 600, "two");
	assert.equal(page.text, "Left1\nLeft2\n\nRight1\nRight2");
	assert.ok(textItemsToPage([], 600).warnings[0].includes("OCR"));
});
test("review gating requires decisions and original-page confirmation", async () => {
	const brew = buildWorkshopBrew({...base, kind: "feat"});
	const project = {source: brew._meta.sources[0], pages: [{page: 1, text: "Book text"}], sections: [{name: base.name, status: "pending", brew}]};
	assert.throws(() => buildReviewedBook(project), /remaining sections/);
	project.sections[0].status = "approved";
	assert.equal(buildReviewedBook(project).feat.length, 1);
	assert.throws(() => buildReviewedBook(project, {includeBook: true}), /page text/);
	project.pagesReviewed = true;
	assert.deepEqual((await validateBrew(buildReviewedBook(project, {includeBook: true}))).errors, []);
});
test("readable books validate and review projects survive round trips", async () => {
	const source = {json: "TestBrew", full: "Test Book", abbreviation: "TB", authors: [], version: "1.0.0"};
	const pages = [{page: 1, text: "A page of rules."}];
	assert.deepEqual((await validateBrew(makeBookBrew(source, pages))).errors, []);
	const project = {format: "5etools-book-review", version: 1, source, pages, sections: segmentPages(pages)};
	assert.deepEqual(readProject(JSON.stringify(project)), project);
	assert.throws(() => readProject("{\"spell\":[]}"), /not a Homebrew/);
});
test("race movement/bonuses and class skill choices produce structured data", async () => {
	const race = buildWorkshopBrew({...base, kind: "race", speed: 30, flySpeed: 40, swimSpeed: 20, bonus_dex: 2, bonus_wis: 1});
	assert.deepEqual(race.race[0].speed, {walk: 30, fly: 40, swim: 20});
	assert.deepEqual(race.race[0].ability, [{dex: 2, wis: 1}]);
	assert.deepEqual((await validateBrew(race)).errors, []);
	const cls = buildWorkshopBrew({...base, kind: "class", ...cases.class, skillCount: 2, skillChoices: "Arcana, History, Insight"});
	assert.deepEqual(cls.class[0].startingProficiencies.skills, [{choose: {from: ["arcana", "history", "insight"], count: 2}}]);
	assert.deepEqual((await validateBrew(cls)).errors, []);
});
test("collisions with imported sources never overwrite external documents", async () => {
	const brew = buildWorkshopBrew({...base, kind: "weapon", ...cases.weapon});
	let writes = 0;
	const local = {head: {docIdLocal: "local"}, body: {_meta: {sources: []}}};
	const brewUtil = {pGetOrCreateEditableBrewDoc: async () => local, pGetBrew: async () => [local, {head: {docIdLocal: "external"}, body: brew}], pSetEditableBrewDoc: async () => { writes++; }};
	await assert.rejects(persistBrew(brew, {brewUtil, overwrite: true}), /imported source/);
	assert.equal(writes, 0);
});
