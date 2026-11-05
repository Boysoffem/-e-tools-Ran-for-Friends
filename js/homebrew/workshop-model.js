import {buildQuickBrew} from "../quickbrew.js";

export const KINDS = {item: "Wondrous item", weapon: "Weapon", armor: "Armor", race: "Race / species", class: "Class", subclass: "Subclass", spell: "Spell", feat: "Feat", background: "Background"};
export const propFor = kind => ["weapon", "armor"].includes(kind) ? "item" : kind;
export const paragraphs = text => String(text || "").trim().split(/\n\s*\n/).map(it => it.trim()).filter(Boolean);
export const clone = value => JSON.parse(JSON.stringify(value));
export const sourceFrom = values => {
	const json = (values.sourceId || "QuickHomebrew").trim();
	if (!/^[A-Za-z][A-Za-z0-9_-]{1,59}$/.test(json)) throw new Error("Source ID must start with a letter and contain 2–60 letters, numbers, underscores, or hyphens.");
	return {json, version: "1.0.0", full: values.sourceName?.trim() || "My Homebrew", abbreviation: values.sourceAbbreviation?.trim() || json, authors: values.author?.trim() ? [values.author.trim()] : []};
};
export const metaFor = (source, edition = "classic") => ({sources: [{version: "1.0.0", ...clone(source)}], dateAdded: Math.floor(Date.now() / 1000), dateLastModified: Math.floor(Date.now() / 1000), edition});
const number = (value, label, min, max = Infinity, integer = false) => {
	if (value === "" || value == null) throw new Error(`${label} is required.`);
	const n = Number(value);
	if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${label} must be ${integer ? "a whole number " : ""}between ${min} and ${max === Infinity ? "a finite upper value" : max}.`);
	return n;
};
const list = value => String(value || "").split(",").map(it => it.trim()).filter(Boolean);
const cleanName = (value, label) => {
	const name = String(value || "").trim();
	if (!name || /[|{}]/.test(name)) throw new Error(`${label} is required and cannot contain |, {, or }.`);
	return name;
};
export function featureUid (prop, feature) {
	return prop === "classFeature"
		? [feature.name, feature.className, feature.classSource, feature.level, feature.source].join("|")
		: [feature.name, feature.className, feature.classSource, feature.subclassShortName, feature.subclassSource, feature.level, feature.source].join("|");
}
export function entityKey (prop, entry) {
	if (["classFeature", "subclassFeature"].includes(prop)) return `${prop}|${featureUid(prop, entry)}`.toLowerCase();
	if (prop === "subclass") return `${prop}|${entry.name}|${entry.source}|${entry.className}|${entry.classSource}`.toLowerCase();
	return `${prop}|${entry.name || entry.id}|${entry.source}`.toLowerCase();
}
export function buildWorkshopBrew (values) {
	const kind = values.kind;
	if (!KINDS[kind]) throw new Error("Choose a content type.");
	const source = sourceFrom(values);
	const name = cleanName(values.name, "Name");
	const entries = paragraphs(values.description);
	if (!entries.length) throw new Error("Write a description or rules text.");
	const prop = propFor(kind);
	let entry = {name, source: source.json, entries};
	const brew = {_meta: metaFor(source, values.edition || "classic")};
	if (["item", "spell", "feat", "background"].includes(kind)) entry = {...buildQuickBrew({...values, name})[kind][0], source: source.json};
	if (values.page !== "" && values.page != null) entry.page = number(values.page, "Page", 0, 99999, true);
	if (values.edition && ["race", "background", "class", "subclass"].includes(kind)) entry.edition = values.edition;
	if (["item", "weapon", "armor"].includes(kind)) {
		entry.rarity = values.rarity || "none";
		if (values.attunement) entry.reqAttune = true;
		if (values.weight !== "" && values.weight != null) entry.weight = number(values.weight, "Weight", 0);
		if (values.price !== "" && values.price != null) entry.value = Math.round(number(values.price, "Price", 0) * 100);
	}
	if (kind === "weapon") {
		entry.type = values.weaponType || "M";
		entry.weaponCategory = values.weaponCategory || "martial";
		if (!/^\d+d\d+(?:\s*[+-]\s*\d+)?$/.test(values.damage || "")) throw new Error("Weapon damage should look like 1d8 or 2d6 + 2.");
		entry.dmg1 = values.damage;
		entry.dmgType = values.damageType || "S";
		const properties = values.properties || [];
		if (properties.length) entry.property = properties;
		if (properties.includes("V")) {
			if (!/^\d+d\d+$/.test(values.versatile || "")) throw new Error("Add versatile damage, such as 1d10.");
			entry.dmg2 = values.versatile;
		}
		if (entry.type === "R" || properties.includes("T")) {
			const normal = number(values.rangeNormal, "Normal range", 1, 99999, true);
			const long = number(values.rangeLong, "Long range", normal, 99999, true);
			entry.range = `${normal}/${long}`;
		}
	}
	if (kind === "armor") {
		entry.type = values.armorType || "LA";
		entry.ac = number(values.ac, "Armor class", 0, 30, true);
		if (values.stealth) entry.stealth = true;
		if (values.strength) entry.strength = number(values.strength, "Strength requirement", 1, 30, true);
	}
	if (kind === "race") {
		entry.size = [values.size || "M"];
		entry.speed = number(values.speed, "Walking speed", 0, 300, true);
		for (const mode of ["fly", "swim", "climb"]) {
			if (values[`${mode}Speed`]) {
				if (typeof entry.speed === "number") entry.speed = {walk: entry.speed};
				entry.speed[mode] = number(values[`${mode}Speed`], `${mode} speed`, 0, 300, true);
			}
		}
		const bonuses = Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].filter(key => values[`bonus_${key}`] && Number(values[`bonus_${key}`]) !== 0).map(key => [key, number(values[`bonus_${key}`], `${key} bonus`, -5, 5, true)]));
		if (Object.keys(bonuses).length) entry.ability = [bonuses];
		entry.creatureTypes = [values.creatureType || "humanoid"];
		if (values.darkvision) entry.darkvision = number(values.darkvision, "Darkvision", 0, 300, true);
		if (values.languages?.trim()) entry.entries.push({type: "entries", name: "Languages", entries: [values.languages.trim()]});
		for (const trait of values.features || []) {
			if (!paragraphs(trait.description).length) throw new Error("Each trait needs its rules text.");
			entry.entries.push({type: "entries", name: cleanName(trait.name, "Trait name"), entries: paragraphs(trait.description)});
		}
	}
	if (["class", "subclass"].includes(kind)) {
		delete entry.entries;
		entry.fluff = {entries};
		const className = kind === "class" ? name : cleanName(values.className, "Parent class");
		const classSource = kind === "class" ? source.json : cleanName(values.classSource, "Parent class source");
		if (kind === "class") {
			entry.hd = {number: 1, faces: number(values.hitDie, "Hit die", 6, 12, true)};
			if (![6, 8, 10, 12].includes(entry.hd.faces)) throw new Error("Choose d6, d8, d10, or d12.");
			entry.proficiency = values.saves || [];
			if (entry.proficiency.length !== 2) throw new Error("Choose two saving throw proficiencies.");
			entry.startingProficiencies = {armor: list(values.armorProficiencies), weapons: list(values.weaponProficiencies), tools: list(values.toolProficiencies)};
			if (values.skillCount && Number(values.skillCount) > 0) {
				const from = list(values.skillChoices).map(it => it.toLowerCase());
				const count = number(values.skillCount, "Skill choices", 1, from.length, true);
				entry.startingProficiencies.skills = [{choose: {from, count}}];
			}
			entry.startingEquipment = {default: paragraphs(values.equipment)};
			entry.subclassTitle = values.subclassTitle?.trim() || "Subclass";
		} else Object.assign(entry, {className, classSource, shortName: cleanName(values.shortName || name, "Short subclass name")});
		if (values.spellcastingAbility) entry.spellcastingAbility = values.spellcastingAbility;
		if (values.casterProgression) entry.casterProgression = values.casterProgression;
		const featureProp = kind === "class" ? "classFeature" : "subclassFeature";
		const features = (values.features || []).map(feature => {
			const out = {name: cleanName(feature.name, "Feature name"), source: source.json, className, classSource, level: number(feature.level, "Feature level", 1, 20, true), entries: paragraphs(feature.description)};
			if (!out.entries.length) throw new Error(`Add rules text for ${out.name}.`);
			if (entry.page != null) out.page = entry.page;
			if (kind === "subclass") Object.assign(out, {subclassShortName: entry.shortName, subclassSource: source.json});
			return out;
		});
		if (!features.length) throw new Error("Add at least one level feature.");
		const featureRows = values.features || [];
		entry[`${kind}Features`] = features.map((f, i) => kind === "class" && featureRows[i].subclassGrant ? {classFeature: featureUid(featureProp, f), gainSubclassFeature: true} : featureUid(featureProp, f));
		brew[featureProp] = features;
		if (values.progression?.trim()) {
			const rows = values.progression.trim().split("\n").map(line => line.split("|").map(cell => cell.trim()));
			const headers = rows.shift();
			if (!headers.length || rows.length !== 20 || rows.some(row => row.length !== headers.length)) throw new Error("Progression table needs a header and exactly 20 rows, one per level, with the same number of | separated columns.");
			entry.classTableGroups = [{colLabels: headers, rows: rows.map(row => row.map(cell => /^\d+$/.test(cell) ? Number(cell) : cell))}];
		}
	}
	brew[prop] = [entry];
	return brew;
}

export function mergeBrews (brews) {
	const result = {_meta: {...metaFor({}, brews[0]?._meta?.edition || "classic"), sources: []}};
	const sources = new Map();
	const seen = new Set();
	for (const brew of brews) {
		for (const source of brew._meta?.sources || []) {
			if (sources.has(source.json) && JSON.stringify(sources.get(source.json)) !== JSON.stringify(source)) throw new Error(`Conflicting source details for ${source.json}.`);
			sources.set(source.json, clone(source));
		}
		for (const [prop, entries] of Object.entries(brew)) {
			if (prop === "_meta") continue;
			if (!Array.isArray(entries)) throw new Error(`${prop} must be a list.`);
			for (const entry of entries) {
				const key = entityKey(prop, entry);
				if (seen.has(key)) throw new Error(`Duplicate ${prop}: ${entry.name || entry.id}. Rename or exclude one copy.`);
				seen.add(key);
				(result[prop] ||= []).push(clone(entry));
			}
		}
	}
	result._meta.sources = [...sources.values()];
	return result;
}

export async function validateBrew (brew, {knownClasses = []} = {}) {
	const {default: validate} = await import("./schema-validator.js");
	const errors = [];
	const warnings = [];
	if (!validate(brew)) {
		for (const error of (validate.errors || []).slice(0, 12)) errors.push(`${error.instancePath || "Homebrew"}: ${error.message}${error.params?.missingProperty ? ` (${error.params.missingProperty})` : ""}${error.params?.additionalProperty ? ` (${error.params.additionalProperty})` : ""}`);
	}
	try { mergeBrews([brew]); } catch (e) { errors.push(e.message); }
	const sources = new Set(brew._meta?.sources?.map(it => it.json));
	for (const entries of Object.values(brew)) {
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (!sources.has(entry.source)) errors.push(`${entry.name || entry.id}: missing source metadata for ${entry.source}.`);
			if (entry._copy) errors.push(`${entry.name}: copied entries must be resolved before importing here.`);
		}
	}
	for (const kind of ["class", "subclass"]) {
		const featureProp = `${kind}Feature`;
		const featureKeys = new Set((brew[featureProp] || []).map(f => featureUid(featureProp, f).toLowerCase()));
		for (const entry of brew[kind] || []) {
			for (const ref of entry[`${kind}Features`] || []) {
				const uid = typeof ref === "string" ? ref : ref[featureProp];
				// Expand 5etools' optional source segments before comparison.
				const parts = uid?.split("|") || [];
				let feature;
				if (kind === "class") feature = {name: parts[0], className: parts[1], classSource: parts[2] || "PHB", level: Number(parts[3]), source: parts[4] || parts[2] || "PHB"};
				else feature = {name: parts[0], className: parts[1], classSource: parts[2] || "PHB", subclassShortName: parts[3], subclassSource: parts[4] || "PHB", level: Number(parts[5]), source: parts[6] || parts[4] || "PHB"};
				if (!featureKeys.has(featureUid(featureProp, feature).toLowerCase())) errors.push(`${entry.name}: missing linked feature ${uid}.`);
			}
			if (!(entry[`${kind}Features`]?.length)) errors.push(`${entry.name}: no level features.`);
			if (kind === "subclass" && ![...knownClasses, ...(brew.class || [])].some(c => c.name.toLowerCase() === entry.className?.toLowerCase() && c.source.toLowerCase() === entry.classSource?.toLowerCase())) errors.push(`${entry.name}: parent class ${entry.className} (${entry.classSource}) is not available. Select the right edition or import its class first.`);
		}
	}
	for (const entry of brew.class || []) {
		const levels = new Set((brew.classFeature || []).filter(f => f.className === entry.name && f.classSource === entry.source).map(f => f.level));
		const missing = Array.from({length: 20}, (_, i) => i + 1).filter(level => !levels.has(level));
		if (missing.length) warnings.push(`${entry.name}: no features at levels ${missing.join(", ")}. Check against the class table; some levels may intentionally be empty.`);
		if (entry.casterProgression) warnings.push(`${entry.name}: check spell slots, known/prepared spells, and cantrips against the book. Caster type alone does not fill every progression table.`);
	}
	return {errors: [...new Set(errors)], warnings};
}

export async function persistBrew (brew, {brewUtil = globalThis.BrewUtil2, overwrite = false} = {}) {
	if (brewUtil.pSaveSharedBrew) return brewUtil.pSaveSharedBrew(brew, {overwrite});
	const current = clone(await brewUtil.pGetOrCreateEditableBrewDoc());
	const all = await brewUtil.pGetBrew();
	const incoming = new Set();
	for (const [prop, entries] of Object.entries(brew)) if (Array.isArray(entries)) for (const entry of entries) incoming.add(entityKey(prop, entry));
	for (const doc of all) {
		if (doc.head.docIdLocal === current.head.docIdLocal) continue;
		for (const [prop, entries] of Object.entries(doc.body)) {
			if (!Array.isArray(entries)) continue;
			for (const entry of entries) if (incoming.has(entityKey(prop, entry))) throw new Error(`${entry.name || entry.id} already exists in an imported source. Manage that source before replacing it.`);
		}
	}
	current.body._meta ||= {};
	current.body._meta.sources ||= [];
	for (const source of brew._meta.sources) {
		const prior = current.body._meta.sources.find(it => it.json === source.json);
		if (prior && prior.full !== source.full) throw new Error(`Source ID ${source.json} already belongs to “${prior.full}”. Use a different source ID.`);
		if (!prior) current.body._meta.sources.push(clone(source));
	}
	let count = 0;
	for (const [prop, entries] of Object.entries(brew)) {
		if (prop === "_meta") continue;
		current.body[prop] ||= [];
		for (const entry of entries) {
			const key = entityKey(prop, entry);
			const index = current.body[prop].findIndex(it => entityKey(prop, it) === key);
			if (index >= 0 && !overwrite) throw new Error(`${entry.name || entry.id} already exists. Enable “Update matching entries” to replace it.`);
			const out = {...clone(entry), uniqueId: index >= 0 ? current.body[prop][index].uniqueId : globalThis.CryptUtil.uid()};
			if (index >= 0) current.body[prop][index] = out;
			else current.body[prop].push(out);
			count++;
		}
	}
	await brewUtil.pSetEditableBrewDoc(current);
	return count;
}
