import {createHash} from "node:crypto";
import {createRemoteJWKSet, jwtVerify} from "jose";
import {normalizeEmail} from "./auth-config.js";

const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {timeoutDuration: 10000});
const PROVIDERS = {
	google: {authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "openid profile email"},
	github: {authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", scope: "user:email"},
};

export function authorizeUrl (provider, config, transaction) {
	const url = new URL(PROVIDERS[provider].authorize);
	url.search = new URLSearchParams({
		client_id: config.providers[provider].clientId,
		redirect_uri: `${config.origin}/auth/${provider}/callback`,
		response_type: "code",
		scope: PROVIDERS[provider].scope,
		state: transaction.state,
		code_challenge: createHash("sha256").update(transaction.verifier).digest("base64url"),
		code_challenge_method: "S256",
		...(provider === "google" ? {nonce: transaction.nonce, prompt: "select_account"} : {}),
	}).toString();
	return url.href;
}

async function jsonRequest (fetcher, url, options) {
	const response = await fetcher(url, {...options, redirect: "error", signal: AbortSignal.timeout(10000)});
	if (!response.ok) throw new Error("The sign-in provider could not be reached.");
	const data = await response.json();
	if (data.error) throw new Error("The sign-in provider rejected the request.");
	return data;
}

// Injectable transport/keys are for isolated tests only; production endpoints are fixed above.
export async function exchangeProfile (provider, code, transaction, config, {fetcher = fetch, googleKeys = GOOGLE_KEYS} = {}) {
	const credentials = config.providers[provider];
	const tokens = await jsonRequest(fetcher, PROVIDERS[provider].token, {
		method: "POST",
		headers: {"Content-Type": "application/x-www-form-urlencoded", Accept: "application/json"},
		body: new URLSearchParams({client_id: credentials.clientId,
			client_secret: credentials.clientSecret,
			code,
			grant_type: "authorization_code",
			code_verifier: transaction.verifier,
			redirect_uri: `${config.origin}/auth/${provider}/callback`}),
	});
	if (typeof tokens.access_token !== "string" || !tokens.access_token) throw new Error("Missing access token.");
	let subject; let name; let email;
	if (provider === "google") {
		const {payload} = await jwtVerify(tokens.id_token, googleKeys, {
			issuer: ["https://accounts.google.com", "accounts.google.com"],
			audience: credentials.clientId,
			algorithms: ["RS256"],
			requiredClaims: ["iss", "sub", "aud", "exp", "iat", "nonce"],
			clockTolerance: 5,
		});
		if (payload.nonce !== transaction.nonce || (payload.azp && payload.azp !== credentials.clientId)
			|| (Array.isArray(payload.aud) && payload.aud.length > 1 && !payload.azp)) throw new Error("Invalid identity token.");
		if (payload.at_hash && payload.at_hash !== createHash("sha256").update(tokens.access_token).digest().subarray(0, 16).toString("base64url")) throw new Error("Invalid access token binding.");
		subject = payload.sub; name = payload.name;
		email = payload.email_verified === true ? normalizeEmail(payload.email) : null;
	} else {
		const headers = {Authorization: `Bearer ${tokens.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "5etools-optional-login", "X-GitHub-Api-Version": "2026-03-10"};
		const [profile, emails] = await Promise.all([
			jsonRequest(fetcher, "https://api.github.com/user", {headers}),
			jsonRequest(fetcher, "https://api.github.com/user/emails?per_page=100", {headers}),
		]);
		if (!Number.isSafeInteger(profile.id) || profile.id <= 0) throw new Error("Invalid GitHub identity.");
		subject = String(profile.id); name = profile.name || profile.login;
		// Record only the verified primary address, not the user's entire email history.
		email = Array.isArray(emails) ? normalizeEmail(emails.find(it => it.primary === true && it.verified === true)?.email) : null;
	}
	if (typeof subject !== "string" || !subject || subject.length > 255) throw new Error("Invalid account identity.");
	// eslint-disable-next-line no-control-regex -- Remove controls from provider-supplied display names.
	return {provider, subject, email, name: typeof name === "string" ? name.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 120) || "Player" : "Player"};
}
