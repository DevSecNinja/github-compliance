# Architecture

## Overview

GitHub Compliance is a static, local-first PWA. It keeps runtime dependencies minimal and organizes the app into small browser modules.

- `index.html` defines the authenticated app shell.
- `src/js/main.js` coordinates auth, scanning, rendering, theme, and PWA updates.
- `src/js/auth-device-flow.js` implements GitHub App device flow and refresh-token handling.
- `src/js/github-api.js` wraps GitHub REST calls, pagination, rate-limit state, repository scanning, and Renovate PR search.
- `src/js/compliance.js` contains pure repository compliance rules.
- `src/js/renovate-prs.js` classifies Renovate PRs from pull request text.
- `src/js/export.js` serializes scan results (repositories and Renovate PRs) to JSON, YAML, and CSV.
- `src/js/storage.js` stores settings in `localStorage` and scan snapshots in IndexedDB.
- `public/sw.template.js` becomes `public/sw.js` during build so the cache version changes with every commit.

## Authentication

The GitHub App ID is `3844070`. The public device-flow Client ID is hardcoded in [src/js/config.js](../src/js/config.js).

Device flow was chosen because a static GitHub Pages app cannot safely hold a GitHub App private key or client secret. Installation tokens require a private-key-signed JWT, and GitHub App web-flow token exchange requires a client secret. Device flow needs only the public Client ID.

Browsers cannot reliably call GitHub's OAuth token endpoints directly from a static page because those responses are not exposed with browser CORS headers. The app therefore calls broker-style paths:

- `/github-auth/device-code`
- `/github-auth/access-token`

During local development, Vite proxies those paths to GitHub. In production, set `VITE_GITHUB_AUTH_BROKER_URL` to a small serverless broker origin that forwards the same two requests.

The browser stores token metadata locally. Session storage is the default. The remember-device option writes the same auth state to local storage. Expiring user access tokens can be refreshed locally until the refresh token expires, is revoked, or browser storage is cleared.

The broker should only exchange device codes and refresh tokens. Repository data should not leave the browser.

## Data Storage

All repository data is local to the browser:

- Settings: `localStorage`
- Session auth: `sessionStorage`
- Remembered auth: `localStorage`
- Scan snapshots: IndexedDB object store `scans`

IndexedDB is used for scan results because 92+ repositories and pull request bodies can exceed comfortable `localStorage` limits.

## Exporting Results

Scan results can be exported to a local file from the control strip. The export combines both compliance results for every scanned repository and the open Renovate pull requests into a single payload, so the data can be handed to other tools or agents.

- JSON and YAML keep the nested structure (`summary`, `repositories`, `renovatePullRequests`).
- CSV flattens repositories and Renovate PRs into one table with a `recordType` column to distinguish the two record types.

YAML is generated with [`js-yaml`](https://github.com/nodeca/js-yaml) and CSV with [`papaparse`](https://github.com/mholt/PapaParse). Both libraries are bundled into the static app, so export runs entirely in the browser and repository data never leaves the device.

## GitHub API Calls

The app uses the REST API with `X-GitHub-Api-Version: 2022-11-28`.

- `GET /user` validates the token and shows the viewer.
- `GET /user/installations` finds the `DevSecNinja` installation.
- `GET /user/installations/{installation_id}/repositories` lists repositories available to the app and user.
- `GET /repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1` checks CODEOWNERS, license, README, workflow presence, and whether Renovate config exists.
- `GET /repos/{owner}/{repo}/contents/{renovate_path}` downloads Renovate config only when the tree shows one exists.
- Branch rulesets and open issue counts are intentionally skipped in the fast scan to avoid exhausting REST API limits across many repositories.
- `GET /search/issues?q=org:{owner} is:pr is:open renovate` finds open Renovate PRs.

Repository scanning runs with a concurrency of one to reduce rate-limit pressure. If GitHub returns a rate-limit response, the app stops starting new repository requests, marks the remaining repositories as skipped, and shows the reset time when available.

If `GET /user/installations` does not include `DevSecNinja`, the app shows the installation accounts GitHub did return. That means the signed-in user token is valid, but the requested owner is not visible to that user/app installation combination.

## Compliance Rules

Required checks:

- Repository name is lowercase with hyphens.
- Description is set.
- CODEOWNERS exists.
- Renovate config exists and extends `DevSecNinja/.github`.
- License exists.
- README exists.
- GitHub Actions workflow exists.
- GitHub Actions workflow exists.

Report-only observations:

- Last push age.
- Open issue count is unknown in fast scan.
- Branch protection is unknown in fast scan.

## PWA Updates

`scripts/write-build-meta.mjs` writes `public/build-meta.json` and generates `public/sw.js` with the current commit SHA. The service worker uses that SHA in the cache name. When a new worker activates, the app reloads so installed PWA clients move to the newest deployed commit.

## Testing

- Unit tests cover pure compliance and Renovate PR parsing, and result export serialization.
- Integration tests mock GitHub device-flow and REST endpoints in Playwright.
- Accessibility tests inject axe-core into the app and fail on serious or critical issues.

## Shared DevSecNinja Automation

This repository consumes central automation from `DevSecNinja/.github`:

- Reusable Pages workflow for PR validation and Cloudflare Pages deployment.
- Cloudflare Pages Worker in `public/_worker.js` for same-origin GitHub device-flow auth forwarding.
- Reusable lint workflow for shared repository hygiene checks.
- Reusable config-sync workflow for central config drift PRs.
- Shared Renovate presets through `renovate.json5`.
- Shared labeler config and formatter/linter config files.
- Local CODEOWNERS for repository-specific review ownership.

Reusable workflow refs are pinned to release SHAs and include Renovate comments so updates arrive as normal dependency PRs.
