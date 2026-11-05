const byId = id => document.getElementById(id);
let offset = 0;
let loading = false;

function sessionDuration (account) {
	if (!account.active_session_count || account.current_session_duration_ms == null) return "No active session";
	const minutes = Math.floor(account.current_session_duration_ms / 60_000);
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor(minutes / 60) % 24;
	const duration = days ? `${days}d ${hours}h ${minutes % 60}m` : hours ? `${hours}h ${minutes % 60}m` : minutes ? `${minutes}m` : "Less than 1 minute";
	return account.active_session_count > 1 ? `${duration} (${account.active_session_count} sessions; longest shown)` : duration;
}

async function load () {
	if (loading) return;
	loading = true;
	byId("previous").disabled = byId("next").disabled = byId("refresh").disabled = true;
	byId("accounts").replaceChildren();
	try {
		const response = await fetch(`/api/auth/accounts?offset=${offset}`, {cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10000)});
		if (response.status === 401 || response.status === 403) { location.replace("/login.html?notice=admin"); return; }
		if (!response.ok) throw new Error();
		const data = await response.json();
		const report = data.emailReports;
		byId("report-status").textContent = !report?.enabled ? "Weekly email reports are turned off."
			: !report.ready ? `Weekly email reports: ${report.setupIssue}`
				: `${report.schedule} → ${report.recipient}. ${report.pendingAccounts} new account(s) awaiting a report. ${report.lastError || (report.lastSentAt ? `Last sent ${new Date(report.lastSentAt).toLocaleString()}.` : "No report sent yet.")}`;
		byId("admin-status").textContent = data.total ? `${data.total} account${data.total === 1 ? "" : "s"} · visible only to the administrator` : "No one has signed in yet. Accounts will appear here after sign-in.";
		for (const account of data.accounts) {
			const row = document.createElement("tr");
			for (const value of [account.name, account.email || "No verified primary email", account.provider === "google" ? "Google" : "GitHub", new Date(account.first_login).toLocaleString(), new Date(account.last_login).toLocaleString(), account.login_count]) {
				const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
			}
			const duration = document.createElement("td");
			duration.dataset.sessionDuration = "";
			duration.textContent = sessionDuration(account);
			row.append(duration);
			byId("accounts").append(row);
		}
		byId("page-number").textContent = `Page ${Math.floor(offset / 50) + 1} of ${Math.max(1, Math.ceil(data.total / 50))}`;
		byId("previous").disabled = offset === 0;
		byId("next").disabled = offset + 50 >= data.total;
	} catch { byId("admin-status").textContent = "Couldn't load the private list. Please try Refresh."; } finally { loading = false; byId("refresh").disabled = false; }
}
byId("previous").addEventListener("click", () => { offset = Math.max(0, offset - 50); load(); });
byId("next").addEventListener("click", () => { offset += 50; load(); });
byId("refresh").addEventListener("click", load);
// Recheck authorization after returning from another tab or browser history.
document.addEventListener("visibilitychange", () => {
	if (document.hidden) byId("accounts").replaceChildren(); else load();
});
window.addEventListener("pagehide", () => byId("accounts").replaceChildren());
window.addEventListener("pageshow", event => { if (event.persisted) load(); });
// Re-fetch session state rather than letting a timer run beyond logout/expiry.
setInterval(() => { if (!document.hidden) load(); }, 60_000);
await load();
