// Render plain-language previews with DOM text nodes, never by inserting user HTML.
export function renderEntries (parent, entries) {
	const plain = text => typeof globalThis.Renderer !== "undefined" ? Renderer.stripTags(String(text)) : String(text);
	for (const entry of Array.isArray(entries) ? entries : [entries]) {
		if (entry == null) continue;
		if (typeof entry !== "object") { const p = document.createElement("p"); p.textContent = plain(entry); parent.append(p); continue; }
		if (entry.name) { const h = document.createElement("strong"); h.textContent = plain(entry.name); parent.append(h); }
		if (entry.type === "table") {
			const table = document.createElement("table"); table.className = "hb-preview-table";
			if (entry.colLabels) { const row = table.insertRow(); for (const label of entry.colLabels) { const th = document.createElement("th"); th.textContent = plain(label); row.append(th); } }
			for (const cells of entry.rows || []) { const row = table.insertRow(); for (const cell of cells.row || cells) { const td = row.insertCell(); td.textContent = typeof cell === "object" ? plain(cell.entry ?? cell.roll?.exact ?? `${cell.roll?.min ?? ""}–${cell.roll?.max ?? ""}`) : plain(cell); } }
			parent.append(table);
		} else if (entry.items) {
			const ul = document.createElement("ul"); for (const item of entry.items) { const li = document.createElement("li"); renderEntries(li, item); ul.append(li); } parent.append(ul);
		} else if (entry.entries || entry.entry) renderEntries(parent, entry.entries || entry.entry);
		else { const p = document.createElement("p"); p.textContent = "See advanced data for this structured detail."; parent.append(p); }
	}
}
export function renderBrewPreview (parent, brew) {
	parent.replaceChildren();
	for (const [prop, entries] of Object.entries(brew)) {
		if (Array.isArray(entries)) {
			for (const entry of entries) {
				const card = document.createElement("article"); card.className = "hb-preview-card";
				const heading = document.createElement("h4"); heading.textContent = `${entry.name || entry.id}${entry.level != null ? ` · Level ${entry.level}` : ""}`; card.append(heading);
				const stats = [];
				if (entry.rarity) stats.push(entry.rarity);
				if (entry.dmg1) stats.push(`Damage ${entry.dmg1} ${globalThis.Parser?.dmgTypeToFull(entry.dmgType) || entry.dmgType}`);
				if (entry.dmg2) stats.push(`Versatile ${entry.dmg2}`);
				if (entry.ac != null) stats.push(`AC ${entry.ac}`);
				if (entry.hd) stats.push(`Hit die d${entry.hd.faces}`);
				if (entry.className) stats.push(`${entry.className} (${entry.classSource})`);
				if (entry.size) stats.push(`Size ${entry.size.map(it => globalThis.Parser?.sizeAbvToFull(it) || it).join(" / ")}`);
				if (typeof entry.speed === "number") stats.push(`Speed ${entry.speed} ft`);
				if (entry.reqAttune) stats.push("Requires attunement");
				if (entry.school) stats.push(globalThis.Parser?.spSchoolAbvToFull(entry.school) || entry.school);
				if (entry.page != null) stats.push(`Page ${entry.page}`);
				const meta = document.createElement("p"); meta.className = "hb-help"; meta.textContent = stats.join(" · "); card.append(meta);
				if (entry.entries || entry.fluff) renderEntries(card, entry.entries || (Array.isArray(entry.fluff) ? entry.fluff : entry.fluff.entries));
				if (prop === "table") renderEntries(card, {...entry, type: "table", name: undefined});
				if (entry.classTableGroups) for (const group of entry.classTableGroups) renderEntries(card, {...group, type: "table"});
				parent.append(card);
			}
		}
	}
}
