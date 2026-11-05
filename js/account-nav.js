export async function initAccountNav (navbar) {
	if (!navbar || navbar.querySelector("[data-account-nav]")) return;
	const item = document.createElement("li");
	item.className = "page__account-nav";
	item.dataset.accountNav = "";
	item.setAttribute("role", "presentation");
	const link = document.createElement("a");
	link.className = "nav__link";
	link.href = "/login.html";
	link.textContent = "Sign up / Log in";
	link.title = "Create an account or log in with Google or GitHub";
	item.append(link); navbar.prepend(item);
	try {
		const response = await fetch("/api/auth/session", {cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(8000)});
		if (!response.ok) return;
		const session = await response.json();
		if (session.enabled === false) { item.remove(); return; }
		if (session.user) {
			link.textContent = "My account";
			link.title = "View your account or sign out";
		}
	} catch { /* Keep the login page reachable when the account-status request fails. */ }
}
