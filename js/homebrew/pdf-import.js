import {textItemsToPage} from "./book-model.js";

export async function openPdf (file) {
	if (file.size > 100 * 1024 * 1024) throw new Error("This PDF is over 100 MB. Split it into smaller books first.");
	const pdfjs = await import("../../lib/pdfjs/pdf.js");
	pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../lib/pdfjs/pdf.worker.js", import.meta.url).href;
	const root = new URL("../../lib/pdfjs/", import.meta.url).href;
	return pdfjs.getDocument({data: new Uint8Array(await file.arrayBuffer()), cMapUrl: `${root}cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}standard_fonts/`, wasmUrl: `${root}wasm/`, isEvalSupported: false}).promise;
}

export async function extractPdf (doc, {start = 1, end = doc.numPages, offset = 0, layout = "single", signal, onProgress = () => {}} = {}) {
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > doc.numPages || end - start >= 1000) throw new Error(`Choose a valid range of up to 1000 pages (this PDF has ${doc.numPages}).`);
	if (!Number.isInteger(offset) || start + offset < 0) throw new Error("Printed page offset must leave page numbers at zero or above.");
	const pages = [];
	for (let i = start; i <= end; i++) {
		if (signal?.aborted) throw new DOMException("Extraction cancelled. Previous project kept.", "AbortError");
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		const extracted = textItemsToPage(content.items, page.getViewport({scale: 1}).width, layout);
		pages.push({page: i + offset, pdfPage: i, ...extracted});
		page.cleanup();
		onProgress(i - start + 1, end - start + 1);
		await new Promise(resolve => setTimeout(resolve, 0));
	}
	return pages;
}
