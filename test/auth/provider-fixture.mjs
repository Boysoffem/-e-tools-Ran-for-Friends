import {generateKeyPair, exportJWK, SignJWT, createLocalJWKSet} from "jose";

export async function createProviderFixture () {
	const {privateKey, publicKey} = await generateKeyPair("RS256");
	const jwk = {...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig"};
	const keys = {keys: [jwk]};
	const requests = [];
	const encode = profile => Buffer.from(JSON.stringify(profile)).toString("base64url");
	const decode = code => JSON.parse(Buffer.from(code, "base64url").toString());
	const sign = async (claims, signingKey = privateKey) => new SignJWT(claims).setProtectedHeader({alg: "RS256", kid: "test-key"}).sign(signingKey);
	const json = value => new Response(JSON.stringify(value), {headers: {"Content-Type": "application/json"}});
	const fetcher = async (url, options = {}) => {
		requests.push({url: String(url), options});
		if (String(url) === "https://www.googleapis.com/oauth2/v3/certs") return json(keys);
		if (["https://oauth2.googleapis.com/token", "https://github.com/login/oauth/access_token"].includes(String(url))) {
			const body = new URLSearchParams(options.body);
			if (!body.get("client_secret") || !/^[\w-]{43}$/.test(body.get("code_verifier"))) return json({error: "invalid_request"});
			const code = body.get("code");
			const profile = decode(code);
			if (profile.fail) return json({error: "access_denied", error_description: "PRIVATE_PROVIDER_ERROR"});
			const now = Math.floor(Date.now() / 1000);
			return json({access_token: `test-${code}`,
				token_type: "bearer",
				id_token: await sign({
					iss: "https://accounts.google.com",
					aud: body.get("client_id"),
					iat: now,
					exp: now + 3600,
					sub: profile.subject || "google-user",
					name: profile.name || "Test Player",
					email: profile.email,
					email_verified: profile.verified !== false,
					nonce: profile.nonce,
					...profile.claims,
				})});
		}
		if (String(url).startsWith("https://api.github.com/")) {
			const profile = decode(options.headers.Authorization.replace("Bearer test-", ""));
			if (String(url) === "https://api.github.com/user") return json({id: Number(profile.subject || 1001), name: profile.name || "GitHub Player", login: "player"});
			if (String(url) === "https://api.github.com/user/emails?per_page=100") return json(profile.emails || [{email: profile.email, primary: true, verified: profile.verified !== false}]);
		}
		throw new Error(`Unexpected provider request: ${url}`);
	};
	return {fetcher, googleKeys: createLocalJWKSet(keys), keys, encode, sign, requests};
}
