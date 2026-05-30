# GitHub Compliance

GitHub Compliance is a local-first PWA for reviewing repository governance across the `DevSecNinja` GitHub App installation. It uses plain HTML, CSS, and JavaScript. Vite is used only for local development and production builds.

## Features

- Requires GitHub sign-in before repository data is shown.
- Uses GitHub App device flow for App ID `3844070`.
- Stores settings, tokens, scan results, and Renovate snapshots locally in this browser.
- Excludes archived repositories by default, with an include toggle.
- Fast scan checks repository names, descriptions, last push age, CODEOWNERS, Renovate config, central `DevSecNinja/.github` Renovate extension, license, README, and workflows.
- Open issue counts and branch rulesets are shown as unknown in the fast scan to avoid hitting GitHub REST API rate limits across many repositories.
- Shows open Renovate pull requests and classifies auto-merge or manual merge from pull request text.
- Supports light, dark, and automatic themes.
- Supports offline loading of the app shell and previously cached scan data.
- Refreshes installed PWA clients after every deployed commit through commit-versioned service worker caches.
- Includes a no-login demo mode with realistic mocked data for quickly testing preview deployments.

## GitHub App Setup

The GitHub App ID is `3844070`. The device-flow Client ID is configured in [src/js/config.js](src/js/config.js), so users do not need to enter it at sign-in.

Required repository permissions:

- Actions: read-only
- Administration: read-only
- Contents: read-only
- Issues: read-only
- Pull requests: read-only

Enable Device Flow on the GitHub App. Expiring user access tokens are recommended because refresh tokens let the PWA renew access without asking you to sign in every 8 hours.

GitHub App user access tokens can only read repositories that both the app installation and the signed-in user can access. That is useful for governance, but users with partial organization access will see partial results.

If the app says no installation was found for `DevSecNinja`, GitHub did not return that account from `GET /user/installations` for the signed-in user. Confirm that the app is installed on `DevSecNinja`, that repository access was granted during installation, and that you signed in with a user who can access that installation.

## Local Development

```bash
npm install
npm run dev
```

Open the URL printed by Vite. The local Vite server proxies the GitHub device-flow token calls through `/github-auth/*`, because browsers cannot read those GitHub OAuth responses directly from a static page. Browser storage holds local settings and scan snapshots.

In VS Code, run **Open web page** from the task picker. It starts the web server in the background and opens the app.

## Scan Behavior

The dashboard uses a rate-limit-conscious fast scan. For each repository it fetches the default-branch Git tree and only downloads the Renovate config file when present. That keeps the scan to roughly two repository-specific requests per repository instead of many separate file, issue, and ruleset requests.

If GitHub returns a rate-limit response, the app stops starting new repository checks, marks the remaining repositories as skipped, and shows the reset time when GitHub provides one.

## Demo Mode

To explore the dashboard without signing in or spending GitHub API calls, open the app with a `?demo` query parameter (for example `https://<preview-url>/?demo`) or click **View demo with sample data** on the sign-in screen.

Demo mode serves a fixed sample dataset through a local mock of the GitHub REST API, so scanning, compliance checks, and Renovate PR classification behave just like a real run. It is ephemeral and does not read or write any local settings, tokens, or scan snapshots. This makes it convenient for validating Cloudflare Pages pull request preview deployments. Use the **Exit demo** banner action to return to the sign-in screen.

## Tests

```bash
npm test
```

The test suite includes Node unit tests, Playwright integration tests with mocked GitHub endpoints, and axe-core accessibility checks.

## Build

```bash
npm run build
```

The build script writes `public/build-meta.json` and generates `public/sw.js` from `public/sw.template.js`. The current commit SHA becomes the service worker cache version.

## Deployment

The Pages workflow runs on pull requests and every commit to `main`. Pull requests run tests and deploy Cloudflare previews. Pushes to `main` deploy `dist` to Cloudflare Pages.

This repository uses the central `DevSecNinja/.github` reusable Pages workflow, lint workflow, config-sync workflow, Renovate presets, and config files. Reusable workflow refs are pinned to a release SHA and annotated for Renovate updates.

Cloudflare Pages serves `public/_worker.js` as the same-origin auth broker for the two device-flow token endpoints:

- `POST /github-auth/device-code` -> `https://github.com/login/device/code`
- `POST /github-auth/access-token` -> `https://github.com/login/oauth/access_token`

`VITE_GITHUB_AUTH_BROKER_URL` is optional. Leave it empty for same-origin Cloudflare Pages routing, or set it when using a separate broker origin.

Required repository secrets for Cloudflare deployment:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The Cloudflare token needs permission to create and deploy Cloudflare Pages projects for the account. The workflow creates the `github-compliance` Pages project if it does not already exist and deploys `main` as the production branch. If either Cloudflare secret is missing, the production deploy fails clearly instead of silently skipping.

## Security Notes

The browser never receives a GitHub App private key or client secret. Device flow uses the public Client ID. The Cloudflare Pages Worker forwards device-code and refresh-token exchange only. Repository scan data still remains local in the browser.
