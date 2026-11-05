const byId = id => document.getElementById(id);
const providerName = id => id === "google" ? "Google" : "GitHub";
const messages = {
	unavailable: "This sign-in option hasn't been connected yet. You can keep using the site.",
	expired: "That sign-in link expired or was already used. Please start again.",
	cancelled: "Sign-in was cancelled. You can try again or continue without an account.",
	failed: "Sign-in couldn't be completed. Please try again.",
	consent: "Please agree to share your account details before signing in.",
};
const params = new URLSearchParams(location.search);
const initialMessage = messages[params.get("error")] || (params.get("notice") === "admin" ? "Sign in with the designated administrator account to view the private list." : "");
if (location.search) history.replaceState(null, "", location.pathname + location.hash);

async function load () {
	try {
		const response = await fetch("/api/auth/session", {cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10000)});
		if (!response.ok) throw new Error();
		const session = await response.json();
		const canonical = session.enabled && session.origin !== location.origin;
		byId("canonical-link").hidden = !canonical;
		if (canonical) byId("canonical-link").href = `${session.origin}/login.html`;
		byId("signed-out").hidden = !!session.user || !session.enabled || canonical;
		byId("signed-in").hidden = !session.user;
		if (session.user) {
			byId("account-title").textContent = "You're signed in.";
			byId("profile-name").textContent = session.user.name;
			byId("profile-email").textContent = session.user.email || "No verified primary email provided";
			byId("profile-provider").textContent = providerName(session.user.provider);
			byId("admin-link").hidden = !session.user.admin;
			byId("account-status").textContent = initialMessage || "Welcome back. Your account details are private.";
		} else {
			byId("account-title").textContent = "Sign up / Log in";
			for (const provider of session.providers) document.querySelector(`[data-provider="${provider.id}"]`).disabled = !provider.available;
			const missing = session.providers.filter(it => !it.available).map(it => providerName(it.id));
			byId("provider-note").textContent = missing.length ? `${missing.join(" and ")} sign-in is awaiting connection by the site owner.` : "Choose the account you prefer. No new password to remember.";
			byId("account-status").textContent = initialMessage || (!session.enabled ? "Optional sign-in is turned off. Everything else is ready to use." : canonical ? "Sign-in is available at the site's public address." : missing.length === 2 ? "Sign-in is being set up. You can keep using the site." : "Choose a sign-in option below.");
		}
	} catch { byId("account-status").textContent = "Accounts are temporarily unavailable. You can still browse and share homebrew."; }
}
byId("signout").addEventListener("click", async () => {
	byId("signout").disabled = true;
	try {
		const response = await fetch("/api/auth/logout", {method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(10000)});
		if (!response.ok) throw new Error();
		location.replace("/login.html");
	} catch { byId("account-status").textContent = "Could not sign out. Please try again."; byId("signout").disabled = false; }
});
window.addEventListener("pageshow", event => { if (event.persisted) load(); });
await load();
