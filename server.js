import http from "http";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { fileURLToPath } from "url";
import os from "os";
import {SharedHomebrewStore, createSharedHomebrewHandler} from "./server/shared-homebrew.js";
import {readAuthConfig} from "./server/auth-config.js";
import {createAuthHandler} from "./server/auth.js";
import {AccountReporter, readReportConfig} from "./server/account-reports.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authConfigFile = process.env.AUTH_CONFIG_FILE || path.join(__dirname, ".env.auth");
if (fs.existsSync(authConfigFile)) process.loadEnvFile(authConfigFile);
const authConfig = readAuthConfig(process.env, __dirname);
const accountReporter = new AccountReporter(readReportConfig(process.env, authConfig), () => authHandler.getStore());
const authHandler = createAuthHandler(authConfig, {reportStatus: () => accountReporter.status()});
accountReporter.start();

function getAsciiFallbackName (name) {
	return name
		.replace(/æ/gi, m => (m === "Æ" ? "Ae" : "ae"))
		.replace(/œ/gi, m => (m === "Œ" ? "Oe" : "oe"))
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "");
}

function getFallbackFilePath (filePath) {
	const parsed = path.parse(filePath);
	const altBaseName = getAsciiFallbackName(parsed.name);
	if (!altBaseName || altBaseName === parsed.name) return null;
	return path.join(parsed.dir, `${altBaseName}${parsed.ext}`);
}

const sharedStore = new SharedHomebrewStore(process.env.HOMEBREW_STORAGE_DIR || path.join(__dirname, ".shared-homebrew"));
const sharedHandler = createSharedHomebrewHandler(sharedStore);
const server = http.createServer(async (req, res) => {
	try {
		if (await authHandler(req, res)) return;
	} catch {
		res.writeHead(503, {"Cache-Control": "no-store"});
		res.end("Accounts are temporarily unavailable.");
		return;
	}
	if (await sharedHandler(req, res)) return;
	const parsedUrl = new URL(req.url, "http://localhost");
	let pathname = parsedUrl.pathname;
	// Decode encoded URL segments so files with spaces/special chars resolve correctly.
	try {
		pathname = decodeURIComponent(pathname);
	} catch {
		// Keep original pathname if decoding fails.
	}

	let filePath = path.join(__dirname, pathname === "/" ? "index.html" : pathname);
	const privateDirectories = [sharedStore.directory, authConfig.directory];
	const isPrivate = candidate => privateDirectories.some(directory => candidate === directory || candidate.startsWith(directory + path.sep))
        || candidate === path.resolve(authConfigFile);
	// Auth configuration, account databases, and dotfiles must never become static downloads.
	const relativePath = path.relative(__dirname, filePath);
	if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || pathname.includes("\\")
        || pathname.split("/").some(part => part.startsWith("."))
        || isPrivate(path.resolve(filePath))
		|| ["node_modules", "server", "scripts", "test", "backups", "exports"].includes(relativePath.split(path.sep)[0])
		|| relativePath === "LOCAL-SETUP.md"
		|| /^analytics(?:\.[^/]*)?\.json$/i.test(relativePath)
		|| /\.(?:sqlite|db)(?:-(?:wal|shm))?$|\.(?:backup|bak|pem|key)$/i.test(relativePath)) {
		res.writeHead(404); res.end("File not found"); return;
	}
	let realFilePath;
	try { realFilePath = fs.realpathSync(filePath); } catch { /* Missing files are handled below. */ }
	if (realFilePath && isPrivate(realFilePath)) {
		res.writeHead(404); res.end("File not found"); return;
	}

	// Get the file extension
	const ext = path.extname(filePath);

	// Set content type based on extension
	let contentType = "text/html";
	switch (ext) {
		case ".js":
			contentType = "text/javascript";
			break;
		case ".css":
			contentType = "text/css";
			break;
		case ".json":
			contentType = "application/json";
			break;
		case ".png":
			contentType = "image/png";
			break;
		case ".jpg":
		case ".jpeg":
			contentType = "image/jpeg";
			break;
		case ".gif":
			contentType = "image/gif";
			break;
		case ".svg":
			contentType = "image/svg+xml";
			break;
		case ".ico":
			contentType = "image/x-icon";
			break;
		case ".xml":
			contentType = "application/xml";
			break;
		case ".pdf":
			contentType = "application/pdf";
			break;
		default:
			contentType = "text/html";
	}

	fs.readFile(filePath, (err, data) => {
		if (err) {
			if (err.code !== "ENOENT") {
				res.writeHead(500);
				res.end("Server error");
				return;
			}

			// Some image packs use ASCII filenames where source data contains accented names.
			const fallbackFilePath = getFallbackFilePath(filePath);
			if (!fallbackFilePath) {
				res.writeHead(404);
				res.end("File not found");
				return;
			}

			fs.readFile(fallbackFilePath, (fallbackErr, fallbackData) => {
				if (fallbackErr) {
					res.writeHead(404);
					res.end("File not found");
					return;
				}

				data = fallbackData;
				const etag = `"${crypto.createHash("md5").update(data).digest("hex")}"`;
				if (req.headers["if-none-match"] === etag) {
					res.writeHead(304);
					res.end();
					return;
				}

				const isHtml = ext === ".html" || ext === "";
				const cacheControl = res.hasHeader("Cache-Control") ? res.getHeader("Cache-Control") : isHtml
					? "no-cache"
					: /\.(?:js|css|json)$/.test(filePath) ? "no-cache" : "public, max-age=604800";

				const headers = {
					"Content-Type": contentType,
					"Cache-Control": cacheControl,
					"ETag": etag,
				};

				const compressible = /json|javascript|css|html|xml|svg|text/.test(contentType);
				const acceptsGzip = /gzip/.test(req.headers["accept-encoding"] || "");

				if (compressible && acceptsGzip) {
					zlib.gzip(data, (gzErr, compressed) => {
						if (gzErr) {
							res.writeHead(200, headers);
							res.end(data);
							return;
						}
						res.writeHead(200, { ...headers, "Content-Encoding": "gzip" });
						res.end(compressed);
					});
				} else {
					res.writeHead(200, headers);
					res.end(data);
				}
			});
			return;
		}

		// ETag for conditional requests
		const etag = `"${crypto.createHash("md5").update(data).digest("hex")}"`;
		if (req.headers["if-none-match"] === etag) {
			res.writeHead(304);
			res.end();
			return;
		}

		// Revalidate application code so clients receive sharing and persistence fixes.
		const isHtml = ext === ".html" || ext === "";
		const cacheControl = res.hasHeader("Cache-Control") ? res.getHeader("Cache-Control") : isHtml
			? "no-cache"
			: /\.(?:js|css|json)$/.test(filePath) ? "no-cache" : "public, max-age=604800";

		const headers = {
			"Content-Type": contentType,
			"Cache-Control": cacheControl,
			"ETag": etag,
		};

		// Gzip for text-based types
		const compressible = /json|javascript|css|html|xml|svg|text/.test(contentType);
		const acceptsGzip = /gzip/.test(req.headers["accept-encoding"] || "");

		if (compressible && acceptsGzip) {
			zlib.gzip(data, (gzErr, compressed) => {
				if (gzErr) {
					res.writeHead(200, headers);
					res.end(data);
					return;
				}
				res.writeHead(200, { ...headers, "Content-Encoding": "gzip" });
				res.end(compressed);
			});
		} else {
			res.writeHead(200, headers);
			res.end(data);
		}
	});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
	const interfaces = os.networkInterfaces();
	let localIP = "localhost";
	for (const name of Object.keys(interfaces)) {
		for (const iface of interfaces[name]) {
			if (iface.family === "IPv4" && !iface.internal) {
				localIP = iface.address;
				break;
			}
		}
		if (localIP !== "localhost") break;
	}
	console.log(`Server running at http://localhost:${PORT}/ and http://${localIP}:${PORT}/`);
});
