import {ConverterRace} from "../converter/converter-race.js";
import {ConverterSpell} from "../converter/converter-spell.js";
import {ConverterItem} from "../converter/converter-item.js";
import {ConverterFeat} from "../converter/converter-feat.js";
import {ConverterBackground} from "../converter/converter-background.js";
import {ConverterCreature} from "../converter/converter-creature.js";
import {ConverterTable} from "../converter/converter-table.js";
import {AcConvert, AttachedItemTag, MiscTag, SpellcastingTraitConvert} from "../converter/converterutils-creature.js";
import {TagCondition, TaggerUtils} from "../converter/converterutils-tags.js";
import {TagJsons} from "../converter/converterutils-entries.js";
import {RaceTraitTag} from "../converter/converterutils-race.js";
import {InstrumentBaseItemTag} from "../converter/converterutils-item.js";
import {buildWorkshopBrew, metaFor} from "./workshop-model.js";

let ready;
export function initConverters () {
	return ready ||= (async () => {
		const [spells, items, itemsRaw, legendaryGroups, classes, brew] = await Promise.all([DataUtil.spell.pLoadAll(), Renderer.item.pBuildList(), DataUtil.item.loadRawJSON(), DataUtil.legendaryGroup.pLoadAll(), DataUtil.class.loadJSON(), BrewUtil2.pGetBrewProcessed()]);
		const itemsNoGroups = items.filter(it => !it._isItemGroup);
		SpellcastingTraitConvert.init(spells);
		ConverterItem.init(itemsNoGroups, classes);
		AcConvert.init(itemsNoGroups);
		TaggerUtils.init({legendaryGroups, spells});
		await TagJsons.pInit({spells});
		RaceTraitTag.init({itemsRaw});
		MiscTag.init({items});
		AttachedItemTag.init({items});
		await TagCondition.pInit({conditionsBrew: brew.condition});
		InstrumentBaseItemTag.init({items: itemsNoGroups});
	})().catch(error => { ready = null; throw error; });
}

export function parseClassSection (section, source) {
	const text = section.text;
	const read = key => text.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim();
	const hitDie = read("Hit Dice")?.match(/d(6|8|10|12)\b/)?.[1];
	const saves = (read("Saving Throws") || "").split(/,| and /i).map(it => it.trim().slice(0, 3).toLowerCase()).filter(Boolean);
	const re = /^(?:#{1,4}\s*)?(?:Level\s+(\d{1,2})\s*[:—–-]\s*(.+)|(.+?)\s*\((\d{1,2})(?:st|nd|rd|th)[- ]level\))\s*$/gm;
	const matches = [...text.matchAll(re)];
	if (!matches.length) throw new Error("No explicit level-feature headings found. Use the guided editor to assign each feature its correct level.");
	const features = matches.map((match, i) => ({name: match[2] || match[3], level: match[1] || match[4], description: text.slice(match.index + match[0].length, matches[i + 1]?.index ?? text.length).trim()}));
	const brew = buildWorkshopBrew({kind: section.kind, name: section.name.replace(/^(?:Class|Subclass):\s*/i, ""), sourceId: source.json, sourceName: source.full, sourceAbbreviation: source.abbreviation, author: source.authors?.join(", "), description: text.slice(0, matches[0].index).trim(), page: section.page, hitDie, saves, className: read("Class"), classSource: read("Class Source"), features});
	return {brew, warnings: ["Class parsing only extracted explicit level headings and basic metadata. Check every feature, starting proficiency, equipment choice, subclass grant, and progression table. Complete missing details in the editor."]};
}

export async function convertSection (section, source, edition = "classic") {
	if (["class", "subclass"].includes(section.kind)) return parseClassSection(section, source);
	const converters = {race: ConverterRace, spell: ConverterSpell, item: ConverterItem, feat: ConverterFeat, background: ConverterBackground, monster: ConverterCreature, table: ConverterTable};
	const converter = converters[section.kind];
	if (!converter) throw new Error("Choose the content type, or exclude this section as book text. No rules will be guessed.");
	await initConverters();
	const output = [];
	const warnings = [];
	const options = {source: source.json, page: section.page, styleHint: edition, isAppend: false, titleCaseFields: [], isTitleCase: false, cbOutput: entry => output.push(entry), cbWarning: warning => warnings.push(warning)};
	let text = section.text.replace(/^(?:#{1,2}\s*)?(?:Spell|Item|Weapon|Armor|Race|Species|Feat|Background|Monster|Creature|Table)\s*:\s*/i, "");
	const markdown = /^#{1,6}\s/m.test(text);
	if (section.kind === "table") {
		if (!text.includes("|")) throw new Error("Tables need verified Markdown rows (| separated columns). Check the PDF cells and edit the text before converting.");
		converter.doParseMarkdown(text, options);
	} else if (markdown && typeof converter.doParseMarkdown === "function") converter.doParseMarkdown(text, options);
	else {
		text = text.replace(/^#{1,6}\s+/gm, "");
		converter.doParseText(text, options);
	}
	for (const entry of output) {
		entry.source = source.json;
		entry.page = section.page;
		if (section.kind === "table") entry.name ||= entry.caption || section.name;
	}
	if (!output.length) throw new Error("No entry was produced. Check the section boundaries and text format, or use the guided editor.");
	return {brew: {_meta: metaFor(source, edition), [section.kind]: output}, warnings};
}
