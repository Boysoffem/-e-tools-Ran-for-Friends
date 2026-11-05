const SOURCE = {json: "QuickHomebrew", abbreviation: "QHB", full: "My Quick Homebrew", authors: []};
const PAGES = {item: "items.html", spell: "spells.html", feat: "feats.html", background: "backgrounds.html"};

export function buildQuickBrew (values) {
	const {kind, name, description} = values;
	if (!PAGES[kind]) throw new Error("Choose a homebrew type.");
	if (!name?.trim() || !description?.trim()) throw new Error("Add a name and description first.");
	const entry = {name: name.trim(), source: SOURCE.json, entries: description.trim().split(/\n\s*\n/).map(it => it.trim())};
	if (kind === "item") {
		entry.wondrous = true;
		entry.rarity = values.rarity || "none";
		if (values.attunement) entry.reqAttune = true;
	}
	if (kind === "spell") {
		entry.level = Number(values.level);
		if (!Number.isInteger(entry.level) || entry.level < 0 || entry.level > 9) throw new Error("Spell level must be 0–9.");
		entry.school = values.school;
		entry.time = [{number: 1, unit: values.casting}];
		if (values.rangeType === "feet") {
			const amount = Number(values.range);
			if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid range in feet.");
			entry.range = {type: "point", distance: {type: "feet", amount}};
		} else entry.range = {type: "point", distance: {type: values.rangeType}};
		entry.components = {};
		if (values.verbal) entry.components.v = true;
		if (values.somatic) entry.components.s = true;
		if (values.material?.trim()) entry.components.m = values.material.trim();
		entry.duration = [{type: "instant"}];
		if (values.duration !== "instant") {
			const amount = Number(values.durationAmount);
			if (!Number.isInteger(amount) || amount < 1) throw new Error("Duration must be a positive whole number.");
			entry.duration = [{type: "timed", duration: {type: values.duration, amount}, ...(values.concentration ? {concentration: true} : {})}];
		}
	}
	return {_meta: {sources: [{...SOURCE}]}, [kind]: [entry]};
}
