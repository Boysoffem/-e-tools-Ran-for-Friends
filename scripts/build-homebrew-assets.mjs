import fs from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";
import {build} from "esbuild";

const target = "lib/pdfjs";
await fs.mkdir(target, {recursive: true});
for (const name of ["pdf", "pdf.worker"]) await fs.copyFile(`node_modules/pdfjs-dist/build/${name}.mjs`, `${target}/${name}.js`);
for (const name of ["cmaps", "standard_fonts", "wasm"]) await fs.cp(`node_modules/pdfjs-dist/${name}`, `${target}/${name}`, {recursive: true});
await fs.copyFile("node_modules/pdfjs-dist/LICENSE", `${target}/LICENSE`);
await fs.writeFile(`${target}/README.md`, "Mozilla PDF.js 6.4.299 (Apache-2.0). Vendored from pdfjs-dist. Rebuild with node scripts/build-homebrew-assets.mjs. Module suffixes changed to .js for this server.\n");
const ajv = new Ajv2020({allowUnionTypes: true, allErrors: true, inlineRefs: false, code: {source: true, esm: true}, multipleOfPrecision: 8});
addFormats(ajv);
ajv.addKeyword({keyword: "version", valid: true});
ajv.addKeyword({keyword: "markdownDescription", valid: true});
ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
const root = "node_modules/5etools-utils/schema/brew";
async function load (dir) {
	for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) await load(file);
		else if (entry.name.endsWith(".json")) ajv.addSchema(JSON.parse(await fs.readFile(file, "utf8")), path.relative(root, file));
	}
}
await load(root);
const remoteUrl = "https://raw.githubusercontent.com/TheGiddyLimit/plutonium-scenes/main/test/schema/shared.json";
const remotePath = "scripts/homebrew-scenes-schema.json";
try { await fs.access(remotePath); } catch {
	const response = await fetch(remoteUrl);
	if (!response.ok) throw new Error("Could not download scene schema");
	await fs.writeFile(remotePath, await response.text());
}
ajv.addSchema(JSON.parse(await fs.readFile(remotePath, "utf8")), remoteUrl);
const full = JSON.parse(await fs.readFile(`${root}/homebrew.json`, "utf8"));
const allowed = Object.keys(full.properties);
const schema = {...full, properties: Object.fromEntries(allowed.map(key => [key, full.properties[key]])), additionalProperties: false};
const validate = ajv.compile(schema);
await fs.writeFile("js/homebrew/schema-generated.tmp.js", standaloneCode(ajv, validate));
await build({entryPoints: ["js/homebrew/schema-generated.tmp.js"], outfile: "js/homebrew/schema-validator.js", bundle: true, format: "esm", minify: true, banner: {js: "/* Generated from 5etools-utils 0.16.16 homebrew schemas. Run scripts/build-homebrew-assets.mjs. */"}});
await fs.unlink("js/homebrew/schema-generated.tmp.js");
console.log("Homebrew validator and PDF assets built.");
