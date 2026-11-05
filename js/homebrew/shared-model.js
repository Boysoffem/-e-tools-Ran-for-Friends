// Identity and comparison shared by the browser and server. Internal editor IDs are browser-local.
export const SHARED_URL = "/api/shared-homebrew";
export function cleanEntry (entry) {
	const out = structuredClone(entry);
	delete out.uniqueId;
	return out;
}
export function stable (value) {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}
export function sharedKey (prop, entry) {
	const parts = [prop, entry.name || entry.id, entry.source];
	if (["subclass", "classFeature", "subclassFeature"].includes(prop)) parts.push(entry.className, entry.classSource || "PHB");
	if (prop === "subclassFeature") parts.push(entry.subclassShortName, entry.subclassSource || "PHB");
	if (["classFeature", "subclassFeature"].includes(prop)) parts.push(entry.level);
	return JSON.stringify(parts.map(value => String(value ?? "").toLowerCase()));
}
export function entriesOf (brew) {
	return Object.entries(brew || {}).filter(([prop, entries]) => prop !== "_meta" && Array.isArray(entries)).flatMap(([prop, entries]) => entries.map(entry => ({prop, entry: cleanEntry(entry), key: sharedKey(prop, entry)})));
}
export function changesBetween (before, after) {
	const previous = new Map(before.flatMap(doc => entriesOf(doc.body)).map(record => [record.key, record.entry]));
	const brew = {_meta: {sources: []}};
	const sources = new Map();
	const expected = {};
	for (const doc of after) {
		for (const record of entriesOf(doc.body)) {
			const old = previous.get(record.key);
			if (old && stable(old) === stable(record.entry)) continue;
			(brew[record.prop] ||= []).push(record.entry);
			expected[record.key] = old || null;
			for (const source of doc.body._meta?.sources || []) sources.set(source.json, source);
			Object.assign(brew._meta, doc.body._meta, {sources: []});
		}
	}
	const used = new Set(entriesOf(brew).map(record => record.entry.source));
	brew._meta.sources = [...sources.values()].filter(source => used.has(source.json));
	return {brew, expected};
}
