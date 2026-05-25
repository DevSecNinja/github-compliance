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

The GitHub Pages workflow runs on pull requests and every commit to `main`. Pull requests run tests and build. Pushes to `main` also deploy `dist` to GitHub Pages.

<<<<<<< Updated upstream
GitHub Pages is static, so production sign-in needs a tiny auth broker for the two device-flow token endpoints. Set a repository or environment variable named `VITE_GITHUB_AUTH_BROKER_URL` before the Pages build so Vite can embed the broker origin. The broker must expose:
||||||| Stash base
GitHub Pages is static, so production sign-in needs a tiny auth broker for the two device-flow token endpoints. Set `VITE_GITHUB_AUTH_BROKER_URL` during the Pages build to the broker origin. The broker must expose:
=======
This repository uses the central `DevSecNinja/.github` reusable Pages workflow, lint workflow, config-sync workflow, Renovate presets, and config files. Reusable workflow refs are pinned to a release SHA and annotated for Renovate updates.

GitHub Pages is static, so production sign-in needs a tiny auth broker for the two device-flow token endpoints. Set `VITE_GITHUB_AUTH_BROKER_URL` during the Pages build to the broker origin. The broker must expose:
>>>>>>> Stashed changes

- `POST /github-auth/device-code` -> `https://github.com/login/device/code`
- `POST /github-auth/access-token` -> `https://github.com/login/oauth/access_token`

## Security Notes

The browser never receives a GitHub App private key or client secret. Device flow uses the public Client ID. The auth broker forwards device-code and refresh-token exchange only. Repository scan data still remains local in the browser.
