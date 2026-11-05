import {clone, mergeBrews, paragraphs, metaFor} from "./workshop-model.js";

export const BOOK_KINDS = {unknown: "Unclassified / book text", spell: "Spell", item: "Item / weapon / armor", race: "Race / species", feat: "Feat", background: "Background", monster: "Creature", class: "Class", subclass: "Subclass", table: "Table"};
const aliases = {weapon: "item", armor: "item", species: "race", creature: "monster"};
const category = {spells: "spell", items: "item", weapons: "item", armor: "item", races: "race", species: "race", feats: "feat", backgrounds: "background", creatures: "monster", monsters: "monster", classes: "class", subclasses: "subclass", tables: "table"};
export function guessKind (text) {
	if (/^Casting Time\s*:/im.test(text) && /^Range\s*:/im.test(text)) return "spell";
	if (/^Armor Class\s*\d/im.test(text) && /^Hit Points\s*\d/im.test(text)) return "monster";
	if (/^(?:Wondrous item|Weapon\s*\(|Armor\s*\(|Potion,|Ring,|Rod,|Staff,|Wand,)/im.test(text)) return "item";
	if (/^Hit Dice\s*:/im.test(text)) return "class";
	return "unknown";
}

export function segmentPages (pages) {
	const sections = [];
	let inherited = "unknown";
	for (const page of pages) {
		const lines = page.text.replace(/\r\n?/g, "\n").split("\n");
		const starts = new Map([[0, {kind: "unknown", title: ""}]]);
		const nextNonEmpty = new Array(lines.length);
		let nextLine = "";
		for (let i = lines.length - 1; i >= 0; i--) { nextNonEmpty[i] = nextLine; if (lines[i].trim()) nextLine = lines[i].trim(); }
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			const explicit = line.match(/^(?:#{1,2}\s*)?(Spell|Item|Weapon|Armor|Race|Species|Feat|Background|Monster|Creature|Class|Subclass|Table)\s*:\s*(.+)$/i);
			const markdown = line.match(/^#{1,2}\s+(.+)$/);
			if (explicit) {
				const raw = explicit[1].toLowerCase();
				starts.set(i, {kind: aliases[raw] || raw, title: explicit[2]});
			} else if (markdown) {
				const title = markdown[1].trim();
				if (category[title.toLowerCase()]) inherited = category[title.toLowerCase()];
				starts.set(i, {kind: category[title.toLowerCase()] ? "unknown" : inherited, title});
			} else if (line && line.length < 100) {
				const next = nextNonEmpty[i];
				if (/^(?:(?:\d+(?:st|nd|rd|th)[- ]level|Level \d+)\s+(?:abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)|(?:abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)\s+cantrip)/i.test(next)) starts.set(i, {kind: "spell", title: line});
				else if (/^(?:Wondrous item|Weapon\s*\(|Armor\s*\(|Potion,|Ring,|Rod,|Staff,|Wand,)/i.test(next)) starts.set(i, {kind: "item", title: line});
				else if (/^(?:Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(?:aberration|beast|celestial|construct|dragon|elemental|fey|fiend|giant|humanoid|monstrosity|ooze|plant|undead)/i.test(next)) starts.set(i, {kind: "monster", title: line});
			}
		}
		const boundaries = [...starts.keys()].sort((a, b) => a - b);
		for (let i = 0; i < boundaries.length; i++) {
			const start = boundaries[i];
			const end = boundaries[i + 1] ?? lines.length;
			const text = lines.slice(start, end).join("\n").trim();
			if (!text) continue;
			const match = starts.get(start);
			sections.push({id: `section-${sections.length + 1}`, name: match.title || text.split("\n")[0].slice(0, 100), kind: match.kind === "unknown" ? guessKind(text) : match.kind, text, originalText: text, page: page.page, endPage: page.page, ...(page.pdfPage != null ? {pdfPage: page.pdfPage} : {}), status: "pending", warnings: [...(page.warnings || [])], brew: null});
		}
	}
	return sections;
}

// Preserve every text item. Column ordering is an explicit user choice, never a silent guess.
export function textItemsToPage (items, width, layout = "single") {
	const visible = items.filter(it => typeof it.str === "string" && it.str.trim()).map(it => ({text: it.str, x: it.transform[4], y: it.transform[5], width: it.width || 0, height: Math.abs(it.height || it.transform[3]) || 10}));
	const warnings = [];
	if (!visible.length) return {text: "", rawText: "", warnings: ["No selectable text found. This page needs OCR or manual transcription before it can be imported accurately."]};
	const toLines = entries => {
		const rows = [];
		for (const item of [...entries].sort((a, b) => b.y - a.y || a.x - b.x)) {
			let row = rows.at(-1);
			if (!row || Math.abs(row.y - item.y) > Math.max(2, Math.min(row.height, item.height) * 0.35)) { row = {y: item.y, height: item.height, items: []}; rows.push(row); }
			row.items.push(item);
		}
		return rows.map(row => row.items.sort((a, b) => a.x - b.x).map(it => it.text).join(" ")).join("\n");
	};
	let text;
	if (layout === "two") {
		const left = visible.filter(it => it.x < width / 2);
		const right = visible.filter(it => it.x >= width / 2);
		text = [toLines(left), toLines(right)].filter(Boolean).join("\n\n");
		if (left.some(it => it.x + it.width > width / 2 + 20)) warnings.push("Text crosses the column boundary. Check full-width headings and tables in the original page.");
	} else text = toLines(visible);
	if (text.includes("�")) warnings.push("Replacement characters found; check embedded fonts against the PDF.");
	if (/\b[Il]d\d|\bd[IlO]\b/.test(text)) warnings.push("Possible ambiguous dice characters. Compare the original page before correcting.");
	warnings.push("Check reading order, table cells, symbols, and page breaks against the PDF.");
	return {text, rawText: items.filter(it => typeof it.str === "string").map(it => it.str + (it.hasEOL ? "\n" : " ")).join(""), warnings};
}

export function makeBookBrew (source, pages, {published = new Date().toISOString().slice(0, 10), edition = "classic"} = {}) {
	if (!pages.length) throw new Error("No book pages loaded.");
	const id = source.json;
	return {
		_meta: metaFor(source, edition),
		book: [{name: source.full, id, source: source.json, group: "homebrew", published, author: source.authors?.join(", ") || "Homebrew", contents: pages.map(page => ({name: `Page ${page.page}`}))}],
		bookData: [{id, source: source.json, data: pages.map(page => ({type: "section", name: `Page ${page.page}`, page: page.page, entries: paragraphs(page.text)}))}],
	};
}

export function buildReviewedBook (project, {includeBook = false} = {}) {
	if (!project.sections.length) throw new Error("No sections to import.");
	const pending = project.sections.filter(it => !["approved", "excluded"].includes(it.status));
	if (pending.length) throw new Error(`Review or explicitly exclude ${pending.length} remaining sections first.`);
	const brews = project.sections.filter(it => it.status === "approved").map(it => {
		if (!it.brew) throw new Error(`No converted data for ${it.name}.`);
		return it.brew;
	});
	if (includeBook) {
		if (!project.pagesReviewed) throw new Error("Confirm that you checked the page text before including the readable book.");
		if (project.pages.some(page => !page.text.trim())) throw new Error("Some pages have no text. Transcribe them or omit the readable book.");
		brews.push(makeBookBrew(project.source, project.pages, {edition: project.edition || "classic"}));
	}
	if (!brews.length) throw new Error("Approve at least one entry or include the readable book.");
	return mergeBrews(brews);
}

export function readProject (raw) {
	const project = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
	if (project?.format !== "5etools-book-review" || project.version !== 1 || !Array.isArray(project.pages) || !Array.isArray(project.sections) || !project.source?.json) throw new Error("This is not a Homebrew Workshop review project.");
	if (project.pages.length > 2000 || project.sections.length > 10000) throw new Error("Project is too large.");
	const ids = new Set();
	for (const page of project.pages) if (typeof page.text !== "string" || !Number.isInteger(page.page) || page.page < 0) throw new Error("Invalid page in review project.");
	for (const section of project.sections) {
		if (typeof section.id !== "string" || ids.has(section.id) || typeof section.text !== "string" || typeof section.name !== "string" || !BOOK_KINDS[section.kind]) throw new Error("Invalid or duplicate review section.");
		ids.add(section.id);
		if (!["pending", "parsed", "approved", "excluded"].includes(section.status)) throw new Error("Invalid review status.");
	}
	return project;
}
