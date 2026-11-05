import {KINDS, buildWorkshopBrew, sourceFrom, validateBrew, persistBrew, clone} from "./workshop-model.js";
import {renderBrewPreview} from "./preview.js";
import {initBookImporter} from "./book-ui.js";

export const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c]));
const input = (name, label, value = "", attrs = "") => `<label>${label}<input class="form-control" name="${name}" value="${escape(value)}" ${attrs}></label>`;
const area = (name, label, placeholder = "", rows = 3) => `<label class="hb-wide">${label}<textarea class="form-control" name="${name}" rows="${rows}" placeholder="${escape(placeholder)}"></textarea></label>`;
const select = (name, label, choices) => `<label>${label}<select class="form-control" name="${name}">${choices.map(choice => { const [v, text] = Array.isArray(choice) ? choice : [choice, choice]; return `<option value="${escape(v)}">${escape(text)}</option>`; }).join("")}</select></label>`;
const check = (name, label, value = "on") => `<label class="hb-check"><input type="checkbox" name="${name}" value="${value}"> ${label}</label>`;
const abilities = [["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"], ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"]];
const fieldset = (kinds, title, body) => `<fieldset data-kinds="${kinds}"><legend>${title}</legend><div class="hb-grid">${body}</div></fieldset>`;

export async function initWorkshop ({onSave}) {
	const css = document.createElement("link");
	css.rel = "stylesheet";
	css.href = "css/homebrew-workshop.css";
	document.head.append(css);
	const root = document.createElement("section");
	root.className = "hb-workshop";
	root.innerHTML = `
		<header class="hb-header"><div><p class="hb-eyebrow">YOUR TABLE. YOUR RULES.</p><h2>Homebrew Workshop</h2><p>Create something new, or bring in a book one reviewed entry at a time.</p></div><a href="makebrew.html">Creature builder ↗</a></header>
		<div class="hb-tabs" role="tablist" aria-label="Homebrew tools"><button role="tab" aria-selected="true" aria-controls="hb-create" id="hb-create-tab">Create an entry</button><button role="tab" aria-selected="false" aria-controls="hb-books" id="hb-books-tab" tabindex="-1">Import a book</button></div>
		<details class="hb-source"><summary>Collection details <span data-source-summary></span></summary><form data-source class="hb-grid">
			${input("sourceName", "Collection / book title", "My Quick Homebrew", "required")}${input("sourceId", "Short source ID", "QuickHomebrew", "required")}${input("sourceAbbreviation", "Display abbreviation", "QHB")}${input("author", "Author (optional)")}${select("edition", "Rules edition", [["classic", "2014 rules"], ["one", "2024 rules"]])}
		</form><p class="hb-help">Give each book its own source ID. Keep it the same when adding more entries from that book.</p></details>
		<div role="tabpanel" id="hb-create" aria-labelledby="hb-create-tab">
			<form data-editor>
				<div class="hb-grid">${select("kind", "1 · Choose a type", Object.entries(KINDS))}${input("name", "2 · Give it a name", "", "required maxlength=150")}${input("page", "Book page (optional)", "", "type=\"number\" min=\"0\" max=\"99999\"")}</div>
				${fieldset("item weapon armor", "Item basics", select("rarity", "Rarity", ["none", "common", "uncommon", "rare", "very rare", "legendary", "artifact"]) + input("weight", "Weight (lb)", "", "type=\"number\" min=\"0\" step=\"any\"") + input("price", "Price (gp)", "", "type=\"number\" min=\"0\" step=\"any\"") + check("attunement", "Requires attunement"))}
				${fieldset("weapon", "Weapon stats", `${select("weaponType", "Attack type", [["M", "Melee"], ["R", "Ranged"]]) + select("weaponCategory", "Proficiency", ["simple", "martial"]) + input("damage", "Damage dice", "1d8", "required") + select("damageType", "Damage type", [["S", "Slashing"], ["P", "Piercing"], ["B", "Bludgeoning"], ["F", "Fire"], ["C", "Cold"], ["L", "Lightning"], ["A", "Acid"], ["N", "Necrotic"], ["R", "Radiant"], ["O", "Force"], ["Y", "Psychic"], ["I", "Poison"], ["T", "Thunder"]])}<div class="hb-wide hb-checks">${[["F", "Finesse"], ["L", "Light"], ["H", "Heavy"], ["R", "Reach"], ["2H", "Two-handed"], ["V", "Versatile"], ["T", "Thrown"], ["A", "Ammunition"], ["LD", "Loading"]].map(([v, n]) => check("properties", n, v)).join("")}</div>${input("versatile", "Versatile damage", "1d10")}${input("rangeNormal", "Normal range (ft)", "20", "type=\"number\" min=\"1\"")}${input("rangeLong", "Long range (ft)", "60", "type=\"number\" min=\"1\"")}`)}
				${fieldset("armor", "Armor stats", select("armorType", "Armor category", [["LA", "Light armor"], ["MA", "Medium armor"], ["HA", "Heavy armor"], ["S", "Shield"]]) + input("ac", "Base AC (shield: AC bonus)", "12", "type=\"number\" min=\"0\" max=\"30\" required") + input("strength", "Strength requirement (optional)", "", "type=\"number\" min=\"1\" max=\"30\"") + check("stealth", "Disadvantage on Stealth"))}
				${fieldset("race", "Race / species traits", `${select("size", "Size", [["M", "Medium"], ["S", "Small"], ["T", "Tiny"], ["L", "Large"]]) + input("speed", "Walking speed (ft)", "30", "type=\"number\" min=\"0\" max=\"300\" required") + select("creatureType", "Creature type", ["humanoid", "fey", "construct", "undead", "celestial", "fiend", "dragon", "elemental", "aberration", "beast", "giant", "monstrosity", "ooze", "plant"]) + input("darkvision", "Darkvision (ft, optional)", "", "type=\"number\" min=\"0\" max=\"300\"") + input("flySpeed", "Flying speed (ft, optional)", "", "type=\"number\" min=\"0\" max=\"300\"") + input("swimSpeed", "Swimming speed (ft, optional)", "", "type=\"number\" min=\"0\" max=\"300\"") + input("climbSpeed", "Climbing speed (ft, optional)", "", "type=\"number\" min=\"0\" max=\"300\"") + area("languages", "Languages", "You can speak, read, and write Common and…")}<details class="hb-wide"><summary>Fixed ability score bonuses (optional, usually 2014 rules)</summary><div class="hb-grid">${abilities.map(([key, label]) => input(`bonus_${key}`, label, "0", "type=\"number\" min=\"-5\" max=\"5\"")).join("")}</div><p class="hb-help">For flexible choices, explain the options in a trait instead.</p></details>`)}
				${fieldset("class", "Class foundations", `${select("hitDie", "Hit die", [["8", "d8"], ["6", "d6"], ["10", "d10"], ["12", "d12"]]) + input("subclassTitle", "Subclass group name", "Subclass")}<div class="hb-wide">Saving throws · choose two<div class="hb-checks">${abilities.map(([v, n]) => check("saves", n, v)).join("")}</div></div>${input("armorProficiencies", "Armor proficiencies (comma separated)", "")}${input("weaponProficiencies", "Weapon proficiencies (comma separated)", "")}${input("toolProficiencies", "Tool proficiencies (comma separated)", "")}${input("skillCount", "Number of skill choices", "0", "type=\"number\" min=\"0\" max=\"18\"")}${input("skillChoices", "Choose skills from (comma separated)", "", "placeholder=\"Arcana, History, Insight\"")}${area("equipment", "Starting equipment", "Describe the equipment choices and any starting gold.")}`)}
				${fieldset("subclass", "Parent class", select("parentClass", "Attach to a class / edition", [["", "Choose a class…"]]) + input("className", "Parent class name", "", "required") + input("classSource", "Parent source ID", "", "required") + input("shortName", "Short subclass name (optional)"))}
				${fieldset("class subclass", "Spellcasting & progression (optional)", `${select("spellcastingAbility", "Spellcasting ability", [["", "None / not specified"], ...abilities]) + select("casterProgression", "Caster progression", [["", "None / custom"], ["full", "Full caster"], ["1/2", "Half caster"], ["1/3", "Third caster"], ["pact", "Pact caster"]]) + area("progression", "Custom class table", "Points | Uses\n2 | 1\n3 | 1\n…one row per level, through level 20", 4)}<p class="hb-help hb-wide">Optional table: separate columns with |, then add 20 rows for levels 1–20. Include your spell slots, cantrips, or resource progression here; selecting a caster type does not invent them.</p>`)}
				${fieldset("spell", "Spell details", `${select("level", "Level", Array.from({length: 10}, (_, i) => [i, i ? `Level ${i}` : "Cantrip"])) + select("school", "School", [["A", "Abjuration"], ["C", "Conjuration"], ["D", "Divination"], ["E", "Enchantment"], ["V", "Evocation"], ["I", "Illusion"], ["N", "Necromancy"], ["T", "Transmutation"]]) + select("casting", "Casting time", [["action", "1 action"], ["bonus", "1 bonus action"], ["reaction", "1 reaction (write trigger below)"], ["minute", "1 minute"], ["hour", "1 hour"]]) + select("rangeType", "Range", [["feet", "Distance"], ["self", "Self"], ["touch", "Touch"]]) + input("range", "Range in feet", "60", "type=\"number\" min=\"0\"") + select("duration", "Duration", [["instant", "Instantaneous"], ["round", "Rounds"], ["minute", "Minutes"], ["hour", "Hours"]]) + input("durationAmount", "Duration amount", "1", "type=\"number\" min=\"1\"")}<div class="hb-checks">${check("verbal", "Verbal")}${check("somatic", "Somatic")}${check("concentration", "Concentration")}</div>${input("material", "Material components (optional)")}`)}
				${area("description", "3 · Description and rules", "Write the rules in plain language. Separate paragraphs with a blank line. Include any prerequisites, ability score choices, skills, or special rules.", 5)}
				<fieldset data-kinds="race class subclass"><legend data-features-title>Features</legend><div data-features></div><button class="ve-btn ve-btn-default" type="button" data-add-feature>Add a feature</button><p class="hb-help">Add each trait or level feature separately. For classes, mark the levels that grant subclass features.</p></fieldset>
				<div class="hb-actions"><button type="submit" class="ve-btn ve-btn-primary">Check & preview</button><button type="button" data-reset class="ve-btn ve-btn-default">New entry</button><span data-draft-status class="hb-help"></span></div>
			</form>
			<div data-result hidden class="hb-result"><h3>Review your entry</h3><div data-preview></div><pre data-validation class="hb-message" role="status"></pre><details><summary>Advanced: 5etools JSON</summary><textarea data-json class="form-control hb-code" rows="12" aria-label="Generated homebrew JSON"></textarea><button type="button" data-revalidate class="ve-btn ve-btn-default">Check JSON changes</button></details><label class="hb-check">${"<input type=\"checkbox\" data-overwrite>"} Update matching shared entries</label><div class="hb-actions"><button type="button" data-save class="ve-btn ve-btn-primary">Save & share with everyone</button><button type="button" data-download class="ve-btn ve-btn-default">Download homebrew</button><button type="button" data-use-book class="ve-btn ve-btn-default" hidden>Use for selected book section</button></div></div>
			<p data-status role="status" aria-live="polite"></p>
		</div><div role="tabpanel" id="hb-books" aria-labelledby="hb-books-tab" hidden></div>
		<p class="hb-footer">Saved homebrew is shared with everyone using this site. Form drafts and book review projects stay in your browser until you publish.</p>`;
	document.querySelector("#manager").before(root);
	const form = root.querySelector("[data-editor]");
	root.addEventListener("invalid", event => { const details = event.target.closest("details"); if (details) details.open = true; }, true);
	const sourceForm = root.querySelector("[data-source]");
	const status = root.querySelector("[data-status]");
	const result = root.querySelector("[data-result]");
	const json = root.querySelector("[data-json]");
	const validation = root.querySelector("[data-validation]");
	const features = root.querySelector("[data-features]");
	let current = null;
	let revision = 0;
	let selectedBookSection = null;
	let knownClasses = [];
	const tabs = [...root.querySelectorAll("[role=\"tab\"]")];
	const showTab = id => tabs.forEach(tab => {
		const active = tab.getAttribute("aria-controls") === id;
		tab.setAttribute("aria-selected", String(active));
		tab.tabIndex = active ? 0 : -1;
		root.querySelector(`#${tab.getAttribute("aria-controls")}`).hidden = !active;
	});
	tabs.forEach((tab, i) => {
		tab.onclick = () => showTab(tab.getAttribute("aria-controls"));
		tab.onkeydown = e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = tabs[e.key === "Home" ? 0 : e.key === "End" ? 1 : 1 - i]; next.click(); next.focus(); } };
	});
	const addFeature = (value = {}) => {
		const row = document.createElement("div");
		row.className = "hb-feature";
		row.innerHTML = `<div class="hb-grid">${input("featureName", "Feature / trait name", value.name || "", "required")}${input("featureLevel", "Level", value.level || 1, "type=\"number\" min=\"1\" max=\"20\" required")}${check("subclassGrant", "Grants a subclass feature")}${area("featureDescription", "Feature rules", "Describe exactly what this feature does.")}</div><button type="button" class="ve-btn ve-btn-default" data-remove>Remove feature</button>`;
		row.querySelector("[name=\"featureDescription\"]").value = value.description || "";
		row.querySelector("[name=\"subclassGrant\"]").checked = !!value.subclassGrant;
		row.querySelector("[data-remove]").onclick = () => { row.remove(); changed(); };
		features.append(row);
		sync();
	};
	const getSource = () => Object.fromEntries(new FormData(sourceForm));
	const values = () => {
		const out = {...getSource(), ...Object.fromEntries(new FormData(form))};
		for (const key of ["properties", "saves"]) out[key] = new FormData(form).getAll(key);
		out.features = [...features.children].map(row => ({name: row.querySelector("[name=\"featureName\"]").value, level: row.querySelector("[name=\"featureLevel\"]").value, description: row.querySelector("[name=\"featureDescription\"]").value, subclassGrant: row.querySelector("[name=\"subclassGrant\"]").checked}));
		return out;
	};
	const sync = () => {
		const kind = form.elements.kind.value;
		form.querySelectorAll("[data-kinds]").forEach(fs => { fs.hidden = !fs.dataset.kinds.split(" ").includes(kind); fs.disabled = fs.hidden; });
		for (const row of features.children) {
			row.querySelector("[name=\"featureLevel\"]").closest("label").hidden = kind === "race";
			row.querySelector("[name=\"subclassGrant\"]").closest("label").hidden = kind !== "class";
		}
		form.elements.range.disabled = kind !== "spell" || form.elements.rangeType.value !== "feet";
		form.elements.durationAmount.disabled = kind !== "spell" || form.elements.duration.value === "instant";
		form.elements.concentration.disabled = form.elements.durationAmount.disabled;
		root.querySelector("[data-source-summary]").textContent = ` · ${sourceForm.elements.sourceName.value}`;
	};
	const stash = () => {
		try { localStorage.setItem("homebrew-workshop-draft-v1", JSON.stringify(values())); root.querySelector("[data-draft-status]").textContent = "Draft saved in this browser"; } catch { root.querySelector("[data-draft-status]").textContent = "Draft storage unavailable. Download a copy before leaving."; }
	};
	const changed = () => { revision++; current = null; result.hidden = true; sync(); stash(); };
	const hydrate = value => {
		form.reset();
		for (const target of [form, sourceForm]) {
			for (const control of target.elements) {
				if (!control.name || !(control.name in value)) continue;
				if (control.type === "checkbox") control.checked = Array.isArray(value[control.name]) ? value[control.name].includes(control.value) : !!value[control.name];
				else control.value = value[control.name] ?? "";
			}
		}
		features.replaceChildren();
		for (const feature of value.features || []) addFeature(feature);
		sync();
	};
	form.addEventListener("input", changed);
	form.addEventListener("change", changed);
	sourceForm.addEventListener("input", changed);
	sourceForm.addEventListener("change", changed);
	form.elements.parentClass.onchange = () => {
		if (!form.elements.parentClass.value) return;
		const parent = knownClasses[Number(form.elements.parentClass.value)];
		if (!parent) return;
		form.elements.className.value = parent.name;
		form.elements.classSource.value = parent.source;
		changed();
	};
	root.querySelector("[data-add-feature]").onclick = () => { addFeature(); changed(); };
	root.querySelector("[data-reset]").onclick = () => {
		if (form.elements.name.value && !confirm("Start a new entry? Your current form draft will be cleared.")) return;
		hydrate({...getSource(), kind: "item"}); selectedBookSection = null; changed(); status.textContent = "Ready for a new entry.";
	};
	const checkBrew = async brew => {
		const checkRevision = ++revision;
		current = null;
		result.hidden = false;
		validation.textContent = "Checking 5etools format and feature links…";
		root.querySelector("[data-save]").disabled = root.querySelector("[data-download]").disabled = root.querySelector("[data-use-book]").disabled = true;
		const report = await validateBrew(brew, {knownClasses});
		if (checkRevision !== revision) return;
		validation.textContent = report.errors.length ? `Fix before saving:\n${report.errors.join("\n")}` : `Format and links checked.${report.warnings.length ? `\nReview notes:\n${report.warnings.join("\n")}` : ""}`;
		json.value = JSON.stringify(brew, null, 2);
		renderBrewPreview(root.querySelector("[data-preview]"), brew);
		if (!report.errors.length) current = clone(brew);
		root.querySelector("[data-save]").disabled = root.querySelector("[data-download]").disabled = root.querySelector("[data-use-book]").disabled = !current;
		root.querySelector("[data-use-book]").hidden = !selectedBookSection;
	};
	form.onsubmit = async e => { e.preventDefault(); try { if (!sourceForm.reportValidity()) return; await checkBrew(buildWorkshopBrew(values())); status.textContent = ""; } catch (error) { status.textContent = error.message; } };
	json.oninput = () => { revision++; current = null; root.querySelector("[data-save]").disabled = root.querySelector("[data-download]").disabled = root.querySelector("[data-use-book]").disabled = true; validation.textContent = "JSON changed. Check it again before saving."; };
	root.querySelector("[data-revalidate]").onclick = async () => { try { await checkBrew(JSON.parse(json.value)); } catch (error) { validation.textContent = error.message; } };
	root.querySelector("[data-save]").onclick = async e => {
		if (!current) return;
		e.currentTarget.disabled = true;
		try {
			const count = await persistBrew(current, {overwrite: root.querySelector("[data-overwrite]").checked}); status.textContent = `Shared ${count} records with everyone on this site. Open the matching 5etools page to view them.`; const links = {item: ["items.html", "Items"], race: ["races.html", "Races"], class: ["classes.html", "Classes"], subclass: ["classes.html", "Classes"], spell: ["spells.html", "Spells"], feat: ["feats.html", "Feats"], background: ["backgrounds.html", "Backgrounds"]};
			for (const prop of Object.keys(current)) if (links[prop]) { const a = document.createElement("a"); a.href = links[prop][0]; a.textContent = ` Open ${links[prop][1]}`; status.append(a); }
			await onSave(); await loadClasses();
		} catch (error) { status.textContent = `Could not save: ${error.message}`; } finally { root.querySelector("[data-save]").disabled = !current; }
	};
	root.querySelector("[data-download]").onclick = () => { if (current) DataUtil.userDownload(`${current._meta.sources[0].json}-homebrew`, current, {isSkipAdditionalMetadata: true}); };
	const loadClasses = async () => {
		try {
			const [official, brew] = await Promise.all([DataUtil.class.loadJSON(), BrewUtil2.pGetBrewProcessed()]);
			knownClasses = [...(official.class || []), ...(brew.class || [])].sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
			form.elements.parentClass.innerHTML = `<option value="">Choose a class…</option>${knownClasses.map((it, i) => `<option value="${i}">${escape(it.name)} (${escape(it.source)})</option>`).join("")}`;
		} catch { status.textContent = "Class list could not load. You can enter a parent class and source manually; validation will flag unresolved parents."; }
	};
	const book = initBookImporter(root.querySelector("#hb-books"), {
		getSource: () => sourceFrom(getSource()),
		getEdition: () => sourceForm.elements.edition.value,
		getKnownClasses: () => knownClasses,
		onSave,
		openEditor: ({id, name, kind, text, page}) => {
			if (form.elements.name.value && !confirm("Load this section into the editor? This replaces the current form draft.")) return;
			selectedBookSection = id;
			hydrate({...getSource(), kind: KINDS[kind] ? kind : "item", name, description: text, page});
			changed(); showTab("hb-create"); status.textContent = "Complete the fields, add any level features, then check and use this entry for the book section.";
		},
		setSource: source => { sourceForm.elements.sourceId.value = source.json; sourceForm.elements.sourceName.value = source.full; sourceForm.elements.sourceAbbreviation.value = source.abbreviation; sourceForm.elements.author.value = source.authors?.join(", ") || ""; sync(); },
	});
	root.querySelector("[data-use-book]").onclick = () => { if (current && selectedBookSection) { book.setSectionBrew(selectedBookSection, current); showTab("hb-books"); } };
	try { const draft = JSON.parse(localStorage.getItem("homebrew-workshop-draft-v1")); if (draft) { hydrate(draft); root.querySelector("[data-draft-status]").textContent = "Previous draft restored"; } } catch { /* Form remains usable without draft storage. */ }
	sync();
	await loadClasses();
}
