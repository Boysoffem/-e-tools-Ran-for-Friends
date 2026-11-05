import {test} from "node:test";
import assert from "node:assert/strict";
import {buildQuickBrew} from "../../js/quickbrew.js";

const base = {name: "  Star Lantern  ", description: "First paragraph.\n\nSecond paragraph."};
test("all quick types export a source and paragraph entries", () => {
	for (const kind of ["item", "feat", "background"]) {
		const brew = buildQuickBrew({...base, kind});
		assert.equal(brew[kind][0].source, brew._meta.sources[0].json);
		assert.equal(brew[kind][0].name, "Star Lantern");
		assert.deepEqual(brew[kind][0].entries, ["First paragraph.", "Second paragraph."]);
	}
});
test("items preserve rarity and attunement", () => {
	const {item: [item]} = buildQuickBrew({...base, kind: "item", rarity: "rare", attunement: "on"});
	assert.equal(item.rarity, "rare");
	assert.equal(item.reqAttune, true);
	assert.equal(item.wondrous, true);
});
const spell = {...base, kind: "spell", level: "0", school: "V", casting: "bonus", rangeType: "feet", range: "60", duration: "instant", verbal: "on"};
test("cantrips include required casting, range, components, and duration data", () => {
	const {spell: [entry]} = buildQuickBrew(spell);
	assert.equal(entry.level, 0);
	assert.deepEqual(entry.time, [{number: 1, unit: "bonus"}]);
	assert.deepEqual(entry.range, {type: "point", distance: {type: "feet", amount: 60}});
	assert.deepEqual(entry.components, {v: true});
	assert.deepEqual(entry.duration, [{type: "instant"}]);
});
test("touch spells support material components and concentration", () => {
	const {spell: [entry]} = buildQuickBrew({...spell, rangeType: "touch", duration: "minute", durationAmount: "10", concentration: "on", material: "a pearl"});
	assert.deepEqual(entry.range.distance, {type: "touch"});
	assert.equal(entry.components.m, "a pearl");
	assert.deepEqual(entry.duration, [{type: "timed", duration: {type: "minute", amount: 10}, concentration: true}]);
});
test("invalid input cannot be exported", () => {
	for (const patch of [{name: " "}, {description: " "}, {kind: "unknown"}, {level: "10"}, {range: "-1"}, {duration: "minute", durationAmount: "0"}]) {
		assert.throws(() => buildQuickBrew({...spell, ...patch}));
	}
});
