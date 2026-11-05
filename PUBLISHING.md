# Publishing without local private data

The repository contains application code, test fixtures with reserved example addresses, and required upstream assets and credits. Your running site's credentials, account records, email reports, visitor data, and shared homebrew belong in local storage, outside Git.

## Before a commit or push

Run from the project folder:

```sh
npm run test:privacy
git status --short
git diff
```

After staging the files you intend to publish, check the actual staged contents:

```sh
npm run test:privacy -- --staged
git diff --cached --stat
```

The check blocks common private filenames, credentials copied from local settings, token patterns, personal machine paths, and unexpected email addresses in application files. It prints filenames and reasons, never the matching values. Review the diff too: automated checks cannot recognize every person's name, homebrew text, screenshot, or other private detail. Required public vendor credits are retained.

Use your GitHub no-reply email for commit authorship. Configure it locally from the address shown in your GitHub email settings. `.gitignore` does not remove a file already tracked by Git, and deleting a current file does not erase older commits. Rewriting shared history is a separate operation that changes commit IDs and requires coordination with anyone using the repository.

## Keep these local

- `.env.auth` and other `.env` files: provider credentials, administrator and sender email settings.
- `.private-auth/`: account records, sessions, and delivery state.
- `.shared-homebrew/`: visitor-contributed homebrew and its backup.
- Database files, exports, backups, logs, and `LOCAL-SETUP.md`.

If you change `AUTH_CONFIG_FILE`, `AUTH_STORAGE_DIR`, or `HOMEBREW_STORAGE_DIR`, keep the custom locations outside the checkout or explicitly ignored. The privacy check also inspects configured paths when that local configuration is available.

Existing legacy visitor logs remain local and ignored; the server no longer collects visitor IP analytics or serves the old analytics dashboard. Account records requested by the optional login feature remain available only to the authorized administrator.

GitHub checks run on main-branch pushes and pull requests. Release archives use Git's tracked files instead of recursively zipping the working directory, so local ignored settings and runtime records are excluded.
