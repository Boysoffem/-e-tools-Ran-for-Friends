import {BOOK_KINDS, segmentPages, buildReviewedBook, readProject} from "./book-model.js";
import {clone, validateBrew, persistBrew} from "./workshop-model.js";
import {renderBrewPreview} from "./preview.js";
import {openPdf, extractPdf} from "./pdf-import.js";

const storageKey = "homebrew-book-review-v1";

export function initBookImporter (root, {getSource, getEdition, getKnownClasses, onSave, openEditor, setSource}) {
	root.innerHTML = `
		<h3>Bring in a homebrew book</h3><p>Extract → check page text → convert sections → review → import. Every section needs a decision before export.</p>
		<div class="hb-grid"><label>PDF, text, Markdown, or saved review project<input data-file type="file" accept=".pdf,.txt,.md,.json" class="form-control"></label><label>Column layout<select data-layout class="form-control"><option value="single">Single column / full-width</option><option value="two">Two columns · left then right</option></select></label><label>First PDF page<input data-start class="form-control" type="number" min="1" value="1"></label><label>Last PDF page (blank = last)<input data-end class="form-control" type="number" min="1"></label><label>Printed page offset<input data-offset class="form-control" type="number" value="0"></label></div>
		<p class="hb-help">Printed page = PDF page + offset. Example: PDF page 5 is printed page 1 → offset −4, first page 5. For mixed layouts, correct each page below. Text extraction does not read scanned images or reproduce artwork.</p>
		<div class="hb-actions"><button data-load class="ve-btn ve-btn-primary">Load file</button><button data-cancel class="ve-btn ve-btn-default" hidden>Cancel</button><button data-restore class="ve-btn ve-btn-default">Restore last review</button><button data-project class="ve-btn ve-btn-default">Download review project</button></div>
		<details><summary>Or paste text / Markdown</summary><textarea data-paste class="form-control" rows="7" aria-label="Book text" placeholder="Paste text here. Headings such as ## Spell: Starfire help separate entries."></textarea><button data-load-text class="ve-btn ve-btn-default">Start from pasted text</button></details>
		<p data-book-status role="status" aria-live="polite"></p><p data-storage-status class="hb-help"></p>
		<div data-project-body hidden>
			<h3 data-book-title></h3><p data-counts></p>
			<details data-pages-panel><summary>Check page text against the PDF</summary><div class="hb-actions"><label>Page <select data-page class="form-control"></select></label><button data-show-page class="ve-btn ve-btn-default">Show original page</button><button data-resplit class="ve-btn ve-btn-default">Rebuild sections from corrected pages</button></div><div class="hb-compare"><div><label>Extracted page text<textarea data-page-text class="form-control" rows="15"></textarea></label><pre data-page-warnings class="hb-message"></pre><details><summary>Original extraction (unchanged)</summary><pre data-raw-text class="hb-preview-text"></pre></details></div><div><canvas data-canvas class="hb-pdf-canvas" hidden></canvas><p data-pdf-note class="hb-help">The PDF stays on your device. Reopen the same PDF after restoring a review project to view its pages.</p><input data-attach-pdf type="file" accept=".pdf" aria-label="Attach original PDF for preview"></div></div></details>
			<div class="hb-actions"><button data-parse-all class="ve-btn ve-btn-default">Convert recognized sections</button><span class="hb-help">Conversions are drafts. They are never auto-approved.</span></div>
			<div class="hb-book-layout"><nav class="hb-queue" data-queue aria-label="Book review queue"></nav><div data-review>
				<div class="hb-grid"><label>Section name<input data-name class="form-control"></label><label>Content type<select data-kind class="form-control">${Object.entries(BOOK_KINDS).map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select></label></div>
				<div class="hb-grid"><label>First printed page<input data-section-page type="number" min="0" class="form-control"></label><label>Last printed page<input data-section-end type="number" min="0" class="form-control"></label></div><p data-provenance class="hb-help"></p><div class="hb-compare"><label>Source text (section edits affect this entry only)<textarea data-section-text class="form-control" rows="16"></textarea></label><label>Converted 5etools data<textarea data-section-json class="form-control hb-code" rows="16" spellcheck="false"></textarea></label></div>
				<div class="hb-actions"><button data-convert class="ve-btn ve-btn-primary">Convert section</button><button data-guided class="ve-btn ve-btn-default">Complete in guided editor</button><button data-split class="ve-btn ve-btn-default">Split text at cursor</button><button data-merge class="ve-btn ve-btn-default">Merge with next section</button></div>
				<details><summary>Readable conversion preview</summary><div data-book-preview></div></details><pre data-section-report class="hb-message" role="status"></pre><details><summary>Original section text</summary><pre data-original class="hb-preview-text"></pre></details>
				<label class="hb-check"><input data-reviewed type="checkbox"> I compared all rules, numbers, tables, and feature levels with the original.</label>
				<div class="hb-actions"><button data-approve class="ve-btn ve-btn-primary">Validate & approve</button><button data-exclude class="ve-btn ve-btn-default">Exclude from rules import</button></div><p class="hb-help">Exclude cover pages, contents, prose, or sections you do not want as game entries. Their text remains in this review project and optional readable book.</p>
			</div></div>
			<fieldset><legend>Finish the book</legend><label class="hb-check"><input data-include-book type="checkbox"> Also add the extracted pages to Books as a readable text edition</label><label class="hb-check"><input data-pages-reviewed type="checkbox"> I checked every included page’s text and reading order against the PDF</label><label class="hb-check"><input data-update type="checkbox"> Update matching shared entries</label><div class="hb-actions"><button data-export class="ve-btn ve-btn-default">Validate & download homebrew</button><button data-import class="ve-btn ve-btn-primary">Validate & share with everyone</button></div><pre data-final-report class="hb-message" role="status"></pre></fieldset>
		</div>`;
	const $ = selector => root.querySelector(selector);
	let project = null;
	let selected = null;
	let pdf = null;
	let pdfFingerprint = null;
	let controller = null;
	let busy = false;
	let persistChain = Promise.resolve();
	let saveTimer;
	let saveRevision = 0;
	let queueTimer;
	let pageEditsPending = false;
	let renderTask = null;
	const status = text => { $("[data-book-status]").textContent = text; };
	const current = () => project?.sections.find(it => it.id === selected);
	const stash = () => {
		if (!project) return;
		clearTimeout(saveTimer);
		const revision = ++saveRevision;
		$("[data-storage-status]").textContent = "Saving review…";
		saveTimer = setTimeout(() => {
			const snapshot = clone(project);
			persistChain = persistChain.catch(() => {}).then(() => localforage.setItem(storageKey, snapshot)).then(() => { if (revision !== saveRevision) return; $("[data-storage-status]").textContent = "Review saved in this browser."; }).catch(() => { $("[data-storage-status]").textContent = "Browser storage is full or unavailable. Download the review project to keep your work."; });
		}, 400);
	};

	const withBusy = async task => {
		if (busy) return;
		busy = true;
		root.querySelectorAll("button, input, select, textarea").forEach(el => { el.disabled = true; });
		$("[data-cancel]").disabled = false;
		try { await task(); } catch (error) { status(error.message); } finally { busy = false; root.querySelectorAll("button, input, select, textarea").forEach(el => { el.disabled = false; }); $("[data-cancel]").hidden = true; }
	};
	const queue = () => {
		if (!project) return;
		const counts = {approved: 0, excluded: 0, parsed: 0, pending: 0};
		for (const section of project.sections) counts[section.status]++;
		$("[data-counts]").textContent = `${project.pages.length} pages · ${project.sections.length} sections · ${counts.approved} approved · ${counts.excluded} excluded · ${counts.pending + counts.parsed} need review${pageEditsPending ? " · PAGE EDITS NEED REBUILD" : ""}`;
		$("[data-queue]").replaceChildren();
		for (const section of project.sections) {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = `${section.status === "approved" ? "✓" : section.status === "excluded" ? "−" : "○"} ${section.name}\nPage ${section.page} · ${BOOK_KINDS[section.kind]}`;
			button.setAttribute("aria-current", String(section.id === selected));
			button.onclick = () => { selected = section.id; renderSection(); };
			$("[data-queue]").append(button);
		}
	};
	const renderSection = () => {
		const section = current();
		$("[data-review]").hidden = !section;
		queue();
		if (!section) return;
		$("[data-name]").value = section.name;
		$("[data-kind]").value = section.kind;
		$("[data-section-page]").value = section.page;
		$("[data-section-end]").value = section.endPage;
		renderBrewPreview($("[data-book-preview]"), section.brew || {});
		$("[data-section-text]").value = section.text;
		$("[data-section-json]").value = section.jsonDraft ?? (section.brew ? JSON.stringify(section.brew, null, 2) : "");
		$("[data-original]").textContent = section.originalText;
		$("[data-provenance]").textContent = `Printed page ${section.page}${section.endPage !== section.page ? `–${section.endPage}` : ""}${section.pdfPage ? ` · PDF page ${section.pdfPage}` : ""} · ${section.status}`;
		$("[data-section-report]").textContent = section.report || (section.warnings || []).join("\n");
		$("[data-reviewed]").checked = section.status === "approved";
		if (section.pdfPage) {
			const index = project.pages.findIndex(page => page.pdfPage === section.pdfPage);
			if (index >= 0) { $("[data-page]").value = index; renderPage(); }
		}
	};
	const renderPage = () => {
		const page = project?.pages[Number($("[data-page]").value)];
		if (!page) return;
		$("[data-page-text]").value = page.text;
		$("[data-page-warnings]").textContent = page.warnings?.join("\n") || "Check this page against the original.";
		$("[data-raw-text]").textContent = page.rawText || page.text;
		if (renderTask) { renderTask.cancel(); renderTask = null; }
		$("[data-canvas]").hidden = true;
	};
	const render = () => {
		$("[data-project-body]").hidden = !project;
		if (!project) return;
		$("[data-book-title]").textContent = `${project.source.full} · ${project.filename}`;
		$("[data-page]").innerHTML = project.pages.map((page, i) => `<option value="${i}">Printed ${page.page}${page.pdfPage ? ` / PDF ${page.pdfPage}` : ""}</option>`).join("");
		$("[data-pages-reviewed]").checked = !!project.pagesReviewed;
		selected = project.sections.some(it => it.id === selected) ? selected : project.sections[0]?.id;
		renderPage(); renderSection();
	};
	const replaceAllowed = () => !project || confirm("Start a new review? Download the current review project first if you want to keep a separate copy.");
	const startProject = (pages, filename, fingerprint = null) => {
		if (getSource().json === "QuickHomebrew" && filename !== "Pasted text") {
			const title = filename.replace(/\.[^.]+$/, "");
			const id = `HB${title.replace(/[^A-Za-z0-9]/g, "").slice(0, 55) || "Book"}`;
			setSource({json: id, full: title, abbreviation: id, authors: [], version: "1.0.0"});
		}
		project = {format: "5etools-book-review", version: 1, source: getSource(), edition: getEdition(), filename, fingerprint, pages, sections: segmentPages(pages), pagesReviewed: false};
		pageEditsPending = false; selected = null; render(); stash();
		status(`Loaded ${pages.length} pages. Check extraction, then convert and review sections. No content has been imported.`);
	};
	$("[data-load]").onclick = () => withBusy(async () => {
		const file = $("[data-file]").files[0];
		if (!file) throw new Error("Choose a file first.");
		if (!replaceAllowed()) return;
		if (/\.json$/i.test(file.name)) {
			project = readProject(await file.text()); setSource(project.source); pageEditsPending = !!project.pageEditsPending; selected = null; render(); stash(); status("Review project loaded. Approvals are revalidated before import."); return;
		}
		if (/\.pdf$/i.test(file.name)) {
			status("Opening PDF…");
			const doc = await openPdf(file);
			controller = new AbortController(); $("[data-cancel]").hidden = false;
			try {
				const pages = await extractPdf(doc, {start: Number($("[data-start]").value), end: $("[data-end]").value ? Number($("[data-end]").value) : doc.numPages, offset: Number($("[data-offset]").value), layout: $("[data-layout]").value, signal: controller.signal, onProgress: (done, total) => status(`Extracting page ${done} of ${total}…`)});
				if (pdf) await pdf.destroy(); pdf = doc; pdfFingerprint = doc.fingerprints[0]; startProject(pages, file.name, pdfFingerprint);
			} catch (error) { await doc.destroy(); throw error; }
		} else if (/\.(txt|md)$/i.test(file.name)) {
			if (file.size > 20 * 1024 * 1024) throw new Error("Text file is over 20 MB. Split it into smaller files.");
			const text = await file.text(); if (!text.trim()) throw new Error("The text file is empty.");
			startProject(text.split("\f").map((text, i) => ({page: i + 1, text, rawText: text, warnings: []})), file.name);
		} else throw new Error("Choose a PDF, .txt, .md, or review-project .json file.");
	});
	$("[data-cancel]").onclick = () => controller?.abort();
	$("[data-load-text]").onclick = () => withBusy(async () => { const text = $("[data-paste]").value; if (!text.trim()) throw new Error("Paste some book text first."); if (!replaceAllowed()) return; startProject([{page: 1, text, rawText: text, warnings: []}], "Pasted text"); });
	$("[data-project]").onclick = () => { if (!project) return status("Load a book first."); DataUtil.userDownload(`${project.source.json}-review-project`, project, {isSkipAdditionalMetadata: true}); status("Review project downloaded, including original text and review decisions."); };
	$("[data-restore]").onclick = () => withBusy(async () => { const saved = await localforage.getItem(storageKey); if (!saved) throw new Error("No saved review in this browser."); if (!replaceAllowed()) return; project = readProject(saved); setSource(project.source); pageEditsPending = !!project.pageEditsPending; selected = null; render(); status("Last review restored. Reattach the original PDF for visual comparison."); });
	$("[data-page]").onchange = renderPage;
	$("[data-page-text]").oninput = () => {
		project.pages[Number($("[data-page]").value)].text = $("[data-page-text]").value;
		project.pagesReviewed = false; $("[data-pages-reviewed]").checked = false;
		project.pageEditsPending = pageEditsPending = true;
		queue(); stash();
	};
	$("[data-resplit]").onclick = () => {
		if (!confirm("Rebuild the section queue from corrected page text? This resets all section edits and approvals. The original page extraction is kept.")) return;
		project.sections = segmentPages(project.pages); project.pageEditsPending = pageEditsPending = false; selected = null; render(); stash();
	};
	$("[data-attach-pdf]").onchange = () => withBusy(async () => {
		const file = $("[data-attach-pdf]").files[0]; if (!file) return;
		const doc = await openPdf(file);
		if (project.fingerprint && doc.fingerprints[0] !== project.fingerprint) { await doc.destroy(); throw new Error("This PDF does not match the book used for this review."); }
		if (pdf) await pdf.destroy(); pdf = doc; pdfFingerprint = doc.fingerprints[0]; status("Original PDF attached for comparison.");
	});
	$("[data-show-page]").onclick = () => withBusy(async () => {
		const page = project.pages[Number($("[data-page]").value)];
		if (!pdf || !page.pdfPage || (project.fingerprint && pdfFingerprint !== project.fingerprint)) throw new Error("Attach the original PDF for this review first.");
		const pdfPage = await pdf.getPage(page.pdfPage);
		const viewport = pdfPage.getViewport({scale: 1.5}); const canvas = $("[data-canvas]");
		canvas.width = viewport.width; canvas.height = viewport.height; canvas.hidden = false;
		renderTask = pdfPage.render({canvasContext: canvas.getContext("2d"), viewport}); await renderTask.promise; renderTask = null;
	});
	const invalidate = section => { section.status = "pending"; section.report = "Changed since conversion or review. Convert or validate again before approval."; $("[data-reviewed]").checked = false; clearTimeout(queueTimer); queueTimer = setTimeout(queue, 150); stash(); };
	$("[data-name]").oninput = () => { const section = current(); section.name = $("[data-name]").value; invalidate(section); };
	for (const [selector, key] of [["[data-section-page]", "page"], ["[data-section-end]", "endPage"]]) {
		$(selector).onchange = () => {
			const section = current(); const value = Number($(selector).value);
			if (!Number.isInteger(value) || value < 0) { $(selector).value = section[key]; return status("Use a non-negative whole page number."); }
			section[key] = value; section.brew = null; delete section.jsonDraft; invalidate(section); renderSection();
		};
	}
	$("[data-kind]").onchange = () => { const section = current(); section.kind = $("[data-kind]").value; section.brew = null; delete section.jsonDraft; invalidate(section); renderSection(); };
	$("[data-section-text]").oninput = () => { const section = current(); section.text = $("[data-section-text]").value; section.brew = null; delete section.jsonDraft; $("[data-section-json]").value = ""; invalidate(section); };
	$("[data-section-json]").oninput = () => { const section = current(); section.jsonDraft = $("[data-section-json]").value; section.brew = null; invalidate(section); };
	const check = async brew => {
		const knownClasses = [...getKnownClasses(), ...project.sections.filter(it => it.brew).flatMap(it => it.brew.class || [])];
		const report = await validateBrew(brew, {knownClasses});
		if (brew._meta?.sources?.some(it => it.json !== project.source.json)) report.errors.push("Use this book’s source ID for converted entries.");
		return report;
	};
	const parse = async section => {
		const {convertSection} = await import("./book-converter.js");
		try {
			const {brew, warnings} = await convertSection(section, project.source, project.edition);
			section.brew = brew; delete section.jsonDraft; section.status = "parsed";
			const report = await check(brew);
			section.warnings = [...new Set([...(section.warnings || []), ...warnings])];
			section.report = [...report.errors.map(it => `FIX: ${it}`), ...report.warnings, ...section.warnings, "Draft only. Compare every rule with the source before approving."].join("\n");
		} catch (error) { section.brew = null; delete section.jsonDraft; section.status = "pending"; section.report = `Could not convert: ${error.message}`; }
	};
	$("[data-convert]").onclick = () => withBusy(async () => { if (pageEditsPending) throw new Error("Rebuild sections after page text edits first."); if (!current()) return; status("Loading converters and checking this section…"); await parse(current()); renderSection(); stash(); status("Conversion finished. Review the result and any issues below."); });
	$("[data-parse-all]").onclick = () => withBusy(async () => {
		if (pageEditsPending) throw new Error("Rebuild sections after page text edits first.");
		const candidates = project.sections.filter(it => it.kind !== "unknown" && it.status === "pending" && !it.jsonDraft && !it.brew);
		controller = new AbortController(); $("[data-cancel]").hidden = false;
		for (let i = 0; i < candidates.length; i++) { if (controller.signal.aborted) break; status(`Converting ${i + 1} of ${candidates.length}: ${candidates[i].name}`); await parse(candidates[i]); stash(); await new Promise(resolve => setTimeout(resolve, 0)); }
		renderSection(); status("Batch conversion stopped or finished. Every converted entry still needs review; unclassified sections remain in the queue.");
	});
	$("[data-guided]").onclick = () => { const section = current(); if (!section) return; setSource(project.source); openEditor(section); };
	$("[data-split]").onclick = () => {
		const section = current(); if (!section) return;
		const cursor = $("[data-section-text]").selectionStart;
		if (cursor <= 0 || cursor >= section.text.length) return status("Place the cursor between entries in the source text, then split.");
		const after = section.text.slice(cursor).trim(); const before = section.text.slice(0, cursor).trim();
		if (!after || !before) return status("Both sections need text.");
		const newSection = {...clone(section), id: `section-${CryptUtil.uid()}`, name: after.split("\n")[0].slice(0, 100), text: after, originalText: section.originalText, kind: "unknown", status: "pending", brew: null, report: "Split manually. Check both section boundaries and page references."}; delete newSection.jsonDraft;
		section.text = before; section.brew = null; delete section.jsonDraft; section.status = "pending";
		project.sections.splice(project.sections.indexOf(section) + 1, 0, newSection); renderSection(); stash();
	};
	$("[data-merge]").onclick = () => {
		const section = current(); const index = project.sections.indexOf(section); const next = project.sections[index + 1];
		if (!next) return status("There is no next section.");
		if (!confirm(`Merge with “${next.name}”? Both conversion results and approvals will reset.`)) return;
		section.text += `\n\n${next.text}`; section.originalText += `\n\n${next.originalText}`; section.endPage = next.endPage; section.brew = null; delete section.jsonDraft; section.status = "pending"; section.report = "Merged. Check boundaries before converting.";
		project.sections.splice(index + 1, 1); renderSection(); stash();
	};
	$("[data-approve]").onclick = () => withBusy(async () => {
		const section = current(); if (!section) return;
		if (pageEditsPending) throw new Error("Rebuild sections after page edits first.");
		if (!$("[data-reviewed]").checked) throw new Error("Compare the result with the original and check the review box first.");
		const brew = JSON.parse($("[data-section-json]").value || "null");
		if (!brew) throw new Error("Convert or complete this section in the editor first.");
		if (section.endPage < section.page) throw new Error("Last page must be at or after the first page.");
		const report = await check(brew);
		if (report.errors.length) { section.report = report.errors.join("\n"); renderSection(); throw new Error("This section still has validation errors."); }
		section.brew = brew; delete section.jsonDraft; section.status = "approved"; section.report = `Approved after review.${report.warnings.length ? `\n${report.warnings.join("\n")}` : ""}`;
		renderSection(); stash(); status(`Approved “${section.name}”.`);
	});
	$("[data-reviewed]").onchange = () => { const section = current(); if (section?.status === "approved" && !$("[data-reviewed]").checked) { section.status = "parsed"; section.report = "Review confirmation removed. Approve again before importing."; queue(); stash(); } };
	$("[data-exclude]").onclick = () => { const section = current(); if (!section) return; section.status = "excluded"; section.report = "Excluded from rules import. Original text is kept."; renderSection(); stash(); };
	$("[data-pages-reviewed]").onchange = () => { project.pagesReviewed = $("[data-pages-reviewed]").checked; stash(); };
	const finish = async isImport => {
		if (pageEditsPending) throw new Error("Rebuild sections from corrected pages before finishing.");
		if (project.fingerprint && !project.pagesReviewed) throw new Error("Check the extracted pages against the PDF and confirm the page-review checkbox before finishing.");
		const brew = buildReviewedBook(project, {includeBook: $("[data-include-book]").checked});
		const report = await validateBrew(brew, {knownClasses: getKnownClasses()});
		$("[data-final-report]").textContent = report.errors.length ? report.errors.join("\n") : `Format and links checked. ${report.warnings.join("\n")}`;
		if (report.errors.length) throw new Error("Fix the remaining validation errors before importing or downloading.");
		if (isImport) { const count = await persistBrew(brew, {overwrite: $("[data-update]").checked}); await onSave(); status(`Shared ${count} records from ${project.source.full} with everyone on this site.`); } else { DataUtil.userDownload(`${project.source.json}-homebrew`, brew, {isSkipAdditionalMetadata: true}); status("Validated homebrew downloaded. Import it with Homebrew Manager → Load from File."); }
	};
	$("[data-export]").onclick = () => withBusy(() => finish(false));
	$("[data-import]").onclick = () => withBusy(() => finish(true));
	return {setSectionBrew: (id, brew) => { const section = project?.sections.find(it => it.id === id); if (!section) throw new Error("The selected book section no longer exists."); section.brew = clone(brew); delete section.jsonDraft; section.status = "parsed"; section.report = "Completed in the guided editor. Compare with the source before approval."; selected = id; renderSection(); stash(); }};
}
