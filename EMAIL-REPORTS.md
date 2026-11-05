# Weekly new-account email

Reports are scheduled for **Mondays at 9:00 a.m. America/Chicago (Central time)**, and only go out when new accounts are waiting. They contain the account name, verified primary email (or a clear indication that none was provided), Google/GitHub provider, and account creation date. Only the configured administrator receives the email; accounts listed in the report are never recipients.

Setup uses your configured administrator Gmail address as the default sender and recipient. **Mail cannot be sent until you add a Gmail app password locally.** Google and GitHub sign-in also need their OAuth app credentials before visitors can create accounts; see [login setup](LOGIN-SETUP.md).

## One-time Gmail setup

1. Sign into your sending Gmail account. Enable [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) if it is not already enabled.
2. Open [Google App Passwords](https://myaccount.google.com/apppasswords) and create an app password named `5etools weekly reports`. Google requires 2-Step Verification for app passwords; account restrictions can affect availability. See [Google's app-password instructions](https://support.google.com/accounts/answer/185833).
3. Open the regular Linux **Terminal** app. Open the project folder (the folder containing `package.json`) in that terminal, then run this command without `sudo`:

   ```sh
   sh scripts/setup-login.sh --email
   ```

4. At **Enable weekly reports?**, press Enter. Setup automatically selects your administrator email and fills in Gmail's connection settings. When you see **Gmail app password [hidden]**, paste the app password and press Enter. Spaces between its groups are fine. You will not see the password while entering it. Use the app password, not your regular Gmail password, and do not paste it into chat. If you have multiple administrators, setup also asks you to choose a report recipient. Settings are saved in `.env.auth` with owner-only permissions; setup does not send an email.
5. Check the connection and authentication without sending a message:

   ```sh
   sh scripts/setup-login.sh --email-verify
   ```

6. Restart the site from the regular Linux Terminal, without `sudo`:

   ```sh
   systemctl --user restart 5etools.service
   ```

   If you previously saw `flatpak-spawn: command not found`, use the command above directly. For problems inside an editor terminal, see [terminal command errors](LOGIN-SETUP.md#terminal-command-errors).

The private account page shows whether reports are configured, the destination, how many accounts are waiting, the last successful send, and a readable error if delivery fails. SMTP credentials are never returned to the browser. `sh scripts/setup-login.sh --check` also shows configuration status without secrets.

Connection verification does not prove inbox delivery or sender acceptance; Nodemailer's [verification documentation](https://nodemailer.com/smtp#verifying-the-configuration) explains that distinction. The first due report is the real delivery check.

## Schedule and delivery behavior

- New accounts, including existing accounts that have never been reported, are included at the next scheduled report. Signing in again or changing a display name does not make an account new.
- Empty weeks are skipped. An account created after an empty Monday check waits for the following Monday.
- A running site is required. If the server was offline at the due time, it sends the overdue report after restarting. Missed empty weeks do not produce messages.
- The queue and delivery history persist in the private account database. Routine restarts and overlapping scheduler checks do not resend completed reports.
- Failed sends retry after 15 minutes, then back off up to once a day. Pending accounts remain queued. If a delayed batch succeeds in a later week, later signups wait for the following weekly report.
- SMTP cannot guarantee exactly-once delivery if the mail server accepted a message but the connection or site failed before confirmation was saved. Retries reuse the same message ID, but that rare interruption can still produce a duplicate. A successful SMTP submission also does not guarantee inbox placement.
- Removing an account removes it from future queued reports; an email already sent or being transmitted cannot be recalled. Deleting an account does not delete copies already in the recipient's mailbox.

To disable reports, run the email setup command and answer **no** to the first question, or set `AUTH_REPORT_ENABLED="0"` in `.env.auth`, then restart. Turning off sign-in also stops reports. Disabling does not delete account records or report history. Re-enabling can send overdue pending accounts.

## Other SMTP services

For another SMTP provider or custom sender settings, run `sh scripts/setup-login.sh --email-custom` from the project folder. This opens the detailed hostname, port, username, sender, and password prompts. Existing non-Gmail configurations also keep these prompts when using `--email`. Port 465 uses TLS immediately; other ports require STARTTLS, with certificate verification enabled. The report recipient must be one of the configured administrator emails. Settings:

```dotenv
AUTH_REPORT_ENABLED="1"
AUTH_REPORT_TO="owner@example.com"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="465"
SMTP_USER="owner@example.com"
SMTP_FROM="owner@example.com"
SMTP_PASSWORD=""
```

Credentials stay in the private configuration file. Email bodies are not written to general server logs. Delivery metadata and which accounts have been reported are stored in `.private-auth/accounts.sqlite`, along with the existing private account records. The sign-in notice explains that new account details can be included in the administrator's private email reports.

## Tests

`npm run test:auth` includes weekly timing and DST checks, empty-week skips, new-account filtering, retries, restart persistence, concurrent workers, deleted accounts, fixed recipients, and redacted failures. `npm run test:auth:browser` checks private report status in the actual admin interface. Tests use temporary databases and simulated sending; they never send reports to real people.
