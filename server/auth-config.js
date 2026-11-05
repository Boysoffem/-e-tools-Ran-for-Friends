import path from "node:path";

export function normalizeEmail (value) {
	if (typeof value !== "string") return null;
	const email = value.trim().toLowerCase();
	// eslint-disable-next-line no-control-regex -- Reject control characters in account addresses.
	if (email.length > 254 || !/^[^\s<>"(),;:\\\x00-\x1f\x7f@]+@[^\s<>"(),;:\\\x00-\x1f\x7f@]+\.[^\s<>"(),;:\\\x00-\x1f\x7f@]+$/u.test(email)) return null;
	return email;
}

export function readAuthConfig (env = process.env, root = process.cwd()) {
	const enabled = /^(1|true)$/i.test(env.AUTH_ENABLED || "");
	const base = new URL(env.AUTH_BASE_URL || "http://localhost:3000");
	if (base.username || base.password || base.pathname !== "/" || base.search || base.hash
		|| (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))) {
		throw new Error("AUTH_BASE_URL must be an HTTPS origin (HTTP is allowed only on localhost).");
	}
	const adminEmails = (env.AUTH_ADMIN_EMAILS || "").split(",").map(it => it.trim()).filter(Boolean).map(it => {
		const email = normalizeEmail(it);
		if (!email) throw new Error("AUTH_ADMIN_EMAILS contains an invalid address.");
		return email;
	});
	return {
		enabled,
		origin: base.origin,
		secure: base.protocol === "https:",
		directory: path.resolve(root, env.AUTH_STORAGE_DIR || ".private-auth"),
		adminEmails: new Set(adminEmails),
		adminIdentities: new Set((env.AUTH_ADMIN_IDENTITIES || "").split(",").map(it => it.trim()).filter(Boolean)),
		providers: Object.fromEntries(["google", "github"].map(name => [name, {
			clientId: env[`${name.toUpperCase()}_CLIENT_ID`] || "",
			clientSecret: env[`${name.toUpperCase()}_CLIENT_SECRET`] || "",
		}])),
	};
}
