# Optional Google and GitHub sign-in

The site's normal browsing, Homebrew Workshop, PDF review, and shared library work without signing in. Click **Sign up / Log in** in the top navigation, including on phones, to open `/login.html`. The first Google or GitHub sign-in creates an account; returning visitors use the same button and provider. After signing in, the navigation button reads **My account**. For the designated administrator, **Open private account list** opens `/admin-accounts.html`.

## Connect the providers once

Open a terminal in the project folder (the folder containing `package.json`) and run this command. It finds Node on your PATH or the bundled runtime next to the project:

```sh
sh scripts/setup-login.sh
```

Run setup as your normal user; **do not add `sudo`**. You do not need to install npm for this command. Setup asks for the public HTTPS site address, administrator email, and the client ID and secret for each provider. Existing settings are filled in automatically; press Enter to keep them. For a new installation, enter your public address and administrator email. Secret input is hidden. Either provider can be connected independently. Settings are saved with owner-only permissions in `.env.auth`, which is ignored by Git and blocked from web downloads. Existing environment variables take precedence over the file.

Replace `https://your-site.example` below with your own public HTTPS address. Setup prints your exact callback URLs; use those when registering the apps:

| Provider | Authorized callback / redirect URI |
| --- | --- |
| Google | `https://your-site.example/auth/google/callback` |
| GitHub | `https://your-site.example/auth/github/callback` |

1. **Google:** In [Google Auth Platform](https://console.cloud.google.com/auth/clients), configure the app name, support email, audience, and consent screen, then create an OAuth client with type **Web application**. Add the Google callback above as an **Authorized redirect URI**. While the app is in testing, add the people who will sign in as test users; choose the appropriate publishing status when ready for other visitors. Use only the `openid`, `profile`, and `email` scopes. Google's [OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect) covers registration and redirect URI matching.
2. **GitHub:** Open [Developer settings](https://github.com/settings/developers), choose **OAuth Apps → New OAuth App**, supply your site's homepage and the GitHub callback above, then generate a client secret. This integration requests only `user:email` for the signed-in person's verified primary email, alongside their basic identity. See [GitHub's OAuth app flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) and [email endpoint documentation](https://docs.github.com/en/rest/users/emails).
3. Enter the client IDs/secrets using the setup command above, then restart the server from the regular Linux Terminal: `systemctl --user restart 5etools.service`. Run this as your normal user, without `sudo`.
4. Open the **public** `/login.html`, agree to the account-details notice, and sign in. The configured administrator email must match the provider's verified primary email. The first person to sign in is never automatically made an administrator.

Check configuration without revealing secrets:

```sh
sh scripts/setup-login.sh --check
```

A configured credential pair still needs a real provider sign-in to confirm that the provider registration is correct. If the public hostname changes, update `AUTH_BASE_URL` and both provider registrations. For local development, HTTP is accepted only for `localhost`, `127.0.0.1`, or `[::1]`.

### Terminal command errors

- **`sudo: npm: command not found`:** run the `sh scripts/setup-login.sh` command above from the project folder, without `sudo`. It uses this project's bundled runtime.
- **`flatpak-spawn: command not found`:** you are using the regular Linux Terminal. Run `systemctl --user restart 5etools.service` directly. There is no need to install `flatpak-spawn`.
- **Restart fails inside a sandboxed editor terminal:** open the regular Linux Terminal and run the restart command there. Only when using a Flatpak editor terminal that provides `flatpak-spawn`, the equivalent is `flatpak-spawn --host systemctl --user restart 5etools.service`.

## Walkthrough if you have not created the apps before

Start with GitHub; it has the shorter form. You can connect it first and add Google later.

### GitHub

1. Open [Register a new OAuth application](https://github.com/settings/applications/new) while signed into your GitHub account.
2. For **Application name**, enter `5etools for Friends`.
3. For **Homepage URL**, enter `https://your-site.example`.
4. For **Authorization callback URL**, enter `https://your-site.example/auth/github/callback`.
5. Click **Register application**, then **Generate a new client secret**. Keep the page open; you'll enter its **Client ID** and **Client secret** in the local setup command. Leave Device Flow off. Expiring access tokens are fine: this site only uses the token while signing in. These fields follow [GitHub's registration instructions](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).

### Google

1. Open [Google Cloud Console](https://console.cloud.google.com/) while signed into your Google account. Select an existing project, or create one named `5etools for Friends` using the project selector at the top.
2. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in that project. If prompted, select **Get started**. Enter `5etools for Friends` as the app name and your email as the support/contact email. Choose an **External** audience so friends outside your organization can sign in.
3. Open **Audience**. While the app is in testing, add your own email and your friends' Google emails as **Test users**. Publishing the app for broader access is a separate Google setting.
4. Open **Clients → Create client**. Choose **Web application**, then name it `5etools website`.
5. Under **Authorized redirect URIs**, choose **Add URI** and enter `https://your-site.example/auth/google/callback`. This server flow does not need an Authorized JavaScript origin.
6. Click **Create** and keep the **Client ID** and **Client secret** available for the local setup command. The secret may only be shown when created. See [Google's client creation instructions](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred).

### Enter the credentials on this computer

From the project folder in your terminal, run:

```sh
sh scripts/setup-login.sh
```

Press Enter to keep the enabled setting, public address, and administrator email. Paste each provider's client ID and secret when prompted; secret input stays hidden. If you're starting with only GitHub, leave Google blank. After setup says **Saved**, restart the site with the command above. Open `/login.html` on the public site and try the provider you connected. Do not paste client secrets into chat.

## Optional configuration

The setup command writes these settings; alternatively edit `.env.auth` locally:

```dotenv
AUTH_ENABLED="1"
AUTH_BASE_URL="https://YOUR_PUBLIC_HOST"
AUTH_ADMIN_EMAILS="owner@example.com"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
```

Set `AUTH_ENABLED="0"` and restart to turn off accounts and hide the navigation link. The private admin API is also disabled. Account records remain on disk. Shared homebrew never requires login.

`AUTH_STORAGE_DIR` optionally changes the private storage directory (default `.private-auth/`). `AUTH_CONFIG_FILE` optionally selects another configuration file. `AUTH_ADMIN_IDENTITIES` optionally grants access by stable provider ID, for example `google:123456789,github:1234567`; `npm run auth:accounts` shows these IDs locally. Remove `AUTH_ADMIN_EMAILS` if you want to rely only on explicit provider IDs. Google and GitHub identities are never automatically linked by email.

## What is saved

### Personal browsing history

After signing in, **My account → Your browsing history** shows the last 100 distinct pages and entries opened in that browser. Reopening a page moves it to the top. People can pause recording, remove a single entry, or clear their list. Anonymous browsing, account pages, and URL query strings are not recorded.

History lives only in the person's browser storage, separated by Google/GitHub identity. Page titles, links, timestamps, and pause preferences are never uploaded to the account database, admin list, shared library, or email reports. The server supplies an opaque account namespace in the signed-in session response; it does not provide a history API. A session check precedes recording so expired sessions and an account switch in another tab cannot assign an old page to a different person.

History remains locally after sign-out and returns when the same identity signs in again. It does not sync across devices, browser profiles, or site addresses. Clearing browser site data removes it. Blocked storage disables history without blocking sign-in or browsing.

This keeps the saved list off the administrator's server; it is not an encrypted vault. Someone with access to the same browser profile or scripts running on the site can access browser storage. The feature does not hide ordinary page requests from the server, tunnel, or hosting provider. Use separate browser profiles on shared computers. No visitor analytics collection is added.

### Account records and reports

The private admin list includes **Logged in for**, showing the age of each person's oldest unexpired session and a count when they have multiple sessions. Accounts with no valid sessions show **No active session**. The list refreshes every minute while visible and has a manual **Refresh** button.

This is elapsed sign-in time, including time with the browser closed. It is not active browsing time or a lifetime total. Signing out removes that session; other sessions can remain until they sign out or reach the seven-day expiry. The duration comes from existing fixed-expiry session records, so it works for existing sign-ins without collecting page visits, activity heartbeats, or additional personal records. Durations are visible only in the admin list and are not added to weekly email reports.

Optional [weekly new-account email reports](EMAIL-REPORTS.md) send new account names, verified emails, providers, and creation dates to the designated administrator only. Use `sh scripts/setup-login.sh --email` to configure the sender. The sign-in notice discloses this use before the person agrees. Reports never email the listed account holders.

After the person agrees and completes sign-in, the private SQLite database saves their provider and account ID, display name, verified email if supplied, first/latest sign-in time, and total sign-ins. Emails are trimmed, lowercased, checked for invalid characters, and never added to public homebrew or ordinary server logs. GitHub contributes only its verified **primary** address; unverified/missing addresses stay blank and cannot grant administrator access by email. No unrelated emails are collected.

The database also holds hashed session identifiers (seven-day sessions) and temporary, single-use OAuth transactions (ten-minute expiry). State and PKCE bind callbacks to the initiating browser. Google identity tokens have signature, issuer, audience, expiration, and nonce checks. Cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. Provider tokens are used only during sign-in and are not stored. Account responses are never cached; rendering uses text content, including untrusted profile names. The site administrator and the server computer's owner can access the account records. Backups also contain private data.

To back up `.private-auth/`, stop the server and copy the entire directory (including any SQLite WAL files), then restart. To remove someone's account and sessions, run `npm run auth:accounts -- --remove person@example.com` on the server computer. This removes all providers for that email; their next voluntary sign-in creates a fresh record. Keep backups according to your own retention needs; removal does not rewrite older backups. Signing out removes the session, not the account record.

## Verification

`npm run test:auth` tests Google token verification, GitHub primary-email selection, state/PKCE, consent, replay rejection, session persistence/expiry, sign-out, and administrator access. `npm run test:auth:browser` exercises the account and admin pages against an isolated server and simulated providers. Tests never contact real sign-in providers or add test accounts to the live private list. Real sign-in requires the registered apps above.
