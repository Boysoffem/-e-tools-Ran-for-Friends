import {fetchAccountSession, startBrowsingHistory} from "./browsing-history.js";

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
		const session = await fetchAccountSession();
		if (session.enabled === false) { item.remove(); return; }
		if (session.user) {
			link.textContent = "My account";
			link.title = "View your browsing history, account, or sign out";
			startBrowsingHistory(session.user);
		}
	} catch { /* Keep the login page reachable when the account-status request fails. */ }
}
