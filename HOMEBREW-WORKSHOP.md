# Homebrew Workshop

Open **Utilities → Homebrew Manager** (`managebrew.html`). The workshop has two tabs.

## Create an entry

1. Set collection details, including a distinct source ID for each book or collection.
2. Choose a wondrous item, weapon, armor, race/species, class, subclass, spell, feat, or background.
3. Fill in the fields. Races can have individual traits; classes and subclasses have individual features with explicit levels. Select the exact parent class and source for subclasses (for example, Fighter / PHB versus Fighter / XPHB).
4. **Check & preview**, then **Save & share with everyone** or **Download homebrew**.

The preview validates the generated data against the bundled 5etools homebrew schemas and checks feature links and subclass parents. Validation errors block saving. Notes about missing class levels or spell progression require your judgment: an empty level may be intentional.

Class tables are optional: enter column headings separated by `|`, followed by 20 rows for levels 1–20. Caster progression does not invent spell slots or spells-known tables. Put custom rules and choices in the description/features or edit the advanced JSON if necessary. Creature creation remains in the existing Homebrew Builder.

Form drafts save in this browser. Update matching shared entries is explicit; matching uses name, source, and class/feature identity where applicable. Renaming an entry creates a separate entry. The manager below can remove browser copies; shared removals are handled by the site owner. Published content is stored on this site’s server and loaded by everyone who visits it. The Workshop, standard file/URL imports, and existing builder saves all publish additions. Form drafts and unfinished book reviews remain private. Previously saved private entries are not automatically uploaded; use the Workshop to publish a copy, or save an edit, to share them. Removing a local browser copy does not delete server content.

## Import a selectable-text PDF

1. Open **Import a book** and select the PDF. Set single/two-column reading order, page range, and printed page offset. The default source is named from your PDF when still using the starter collection.
2. Load the file. Check extracted pages against the built-in original-page preview. Text and Markdown files or pasted text also work.
3. Correct page text if needed, then **Rebuild sections**. This explicitly resets section edits and approvals. Raw extraction remains available for comparison.
4. Convert recognized sections in a batch or individually. Choose a type for unclassified rules. Split at the text cursor or merge with the next section for entries that cross pages. Adjust printed page references when needed.
5. Review source text, readable preview, converter warnings, and JSON. Use **Complete in guided editor** for classes, subclasses, or any entry requiring manual fields. Transfer it back to the selected section.
6. Approve each entry only after checking the original. Explicitly exclude prose, contents, artwork, or unwanted entries from rules import. Excluded text remains in the project and optional readable book.
7. Confirm the PDF page review. Validate and download or import. Optionally include a readable text edition in **Books**.

All conversion and PDF processing run locally in the browser. No PDF is sent to an AI service. Publishing sends the approved homebrew JSON to your own site server, where other visitors can read it. Converter reference data and PDF assets are loaded from this site. Save a **review project** to preserve extracted pages, original text, edits, warnings, and decisions; it is separate from importable homebrew JSON. Projects also autosave using browser storage. Reattach the same original PDF after restoring a project for page previews. PDF bytes and artwork are not embedded in the project or homebrew export.

### Accuracy and limits

This is a review-assisted conversion workflow, not a guarantee of faithful automatic book conversion. It reuses the site's converters for creatures, spells, items, races, feats, backgrounds, and Markdown tables. It recognizes explicit typed headings, Markdown headings, and common spell/item/creature headers. Unrecognized text stays in the review queue. Classes/subclasses can parse explicit `Level 3: Feature Name` headings plus labeled metadata; otherwise use the guided editor. Tables need verified Markdown cells.

Schema validation checks format, not whether a rule matches the source. Verify numbers, dice, tables, exceptions, feature levels, column order, and cross-page continuations. The underlying converters may normalize text or add tags; original text is retained so you can compare. No accuracy percentage has been established for arbitrary books.

Scanned pages require separate OCR or manual transcription. Artwork, decorative layout, and embedded images are not converted. PDF extraction accepts up to 100 MB and 1,000 pages per operation; choose a page range for larger books. Mixed-column pages may need manual correction. Editing section text changes the entry, not the readable book's page text; edit page text separately if including the readable book.

## Maintenance and verification

- `npm run test:homebrew`: model, upstream-schema, linkage, persistence, extraction-order, and review-gate tests.
- Install Chromium once with `npx playwright install chromium`, then run `npm run test:homebrew:browser` and `npm run test:homebrew:shared`. Tests start isolated servers on ports 3140 and 3139 with temporary storage, isolated browsers, synthetic homebrew, and a generated two-page PDF. They never publish test content to your running site.
- `npm run build:homebrew-assets`: rebuild the bundled schema validator and PDF.js assets from pinned dependencies. The scene-schema dependency is vendored in `scripts/homebrew-scenes-schema.json` for reproducibility.

PDF.js is Apache-2.0 licensed; its license accompanies `lib/pdfjs`. The generated validator is derived from the installed 5etools-utils homebrew schema. Run the included Node server for sharing; a static-only host does not provide shared saves. No API keys are required.

## Shared library operation

Everyone with access to this site can publish homebrew; no account or approval queue is required. An [optional Google/GitHub account](LOGIN-SETUP.md) can record sign-ins in the administrator's private list; emails are never added to shared homebrew. New visits and page refreshes fetch the current library. Open tabs check every 20 seconds and offer Refresh when someone publishes, so they do not discard unsaved drafts. If the server is unavailable, a browser can use its last downloaded copy, but publishing fails visibly and leaves the draft intact.

Shared content is stored in `.shared-homebrew/library.json` (or the directory specified by `HOMEBREW_STORAGE_DIR`). Back up this directory separately from Git. Writes are serialized and replaced atomically; `library.json.backup` retains the previous successful version. Keep one Node server writing this directory. Concurrent changes to different entries merge; stale changes to the same entry are rejected until refreshed. Publishing identical data again does not create duplicates.

The runtime directory is excluded from Git and blocked from static serving. The read API intentionally exposes the shared content. Writes require same-site JSON requests and pass server-side schema/format checks; raw HTML and executable links are rejected. There is no remote deletion endpoint. To remove shared content, the site owner can stop the server, back up and edit the library file, increment its revision, and restart.
