import { expect, test } from "@playwright/test";

test("signs in with device flow, scans repositories, and renders results", async ({ page }) => {
  await mockGitHub(page);
  await page.goto("/");

  await page.getByRole("main", { name: "Sign in to review your repositories." }).getByLabel("Owner").fill("DevSecNinja");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();

  await expect(page.getByText("Signed in as")).toBeVisible();
  await expect(page.getByRole("button", { name: "Advanced scan" })).toBeDisabled();
  await expect(page.locator("#refresh-renovate-button")).toBeDisabled();
  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByRole("link", { name: "travel-prep" })).toBeVisible();
  const repoRows = page.locator("#repo-rows");
  await expect(repoRows.getByText("Renovate extends central config")).toBeVisible();
  await expect(repoRows.getByText("Protection not checked in fast scan")).toBeVisible();
  await expect(repoRows.getByText("Open issues not checked in fast scan")).toBeVisible();
  await expect(page.getByText("Found 2 repositories; showing 1, excluding 1 archived.")).toBeVisible();
  await expect(page.getByText("search: 29 of 30 left")).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Renovate PRs" })).toBeHidden();
  await page.getByRole("tab", { name: "Renovate PRs" }).click();
  await expect(page.getByRole("tabpanel", { name: "Renovate PRs" })).toBeVisible();
  await expect(page.getByText("1 open. 1 auto-merge, 0 manual, 0 unknown.")).toBeVisible();
  await expect(page.getByText("No Renovate pull requests match these filters.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Update dependency vite" })).toHaveCount(0);
  await page.getByLabel("Merge type").selectOption("all");
  await expect(page.getByRole("link", { name: "Update dependency vite" })).toBeVisible();
  await page.getByLabel("Merge type").selectOption("auto");
  await expect(page.getByRole("link", { name: "Update dependency vite" })).toBeVisible();
  await page.getByLabel("Merge type").selectOption("actionable");
  await page.getByRole("tab", { name: "Repositories" }).click();
  await expect(page.getByRole("tabpanel", { name: "Repositories" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Update archived dependency" })).toHaveCount(0);
  await expect(page.getByLabel("Check").locator("option", { hasText: /Last push/ })).toHaveCount(0);
  const repositoryFilters = page.locator(".filter-strip");
  await repositoryFilters.getByLabel("Last push").selectOption("today");
  await expect(page.getByRole("link", { name: "travel-prep" })).toBeVisible();
  await repositoryFilters.getByLabel("Last push").selectOption("older");
  await expect(page.getByRole("link", { name: "travel-prep" })).toHaveCount(0);
  await repositoryFilters.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("tab", { name: "Renovate PRs" }).click();
  await expect(page.getByRole("button", { name: "Refresh PRs" })).toBeEnabled();
  await page.getByRole("button", { name: "Refresh PRs" }).click();
  await expect(page.getByText("1 open. 1 auto-merge, 0 manual, 0 unknown.")).toBeVisible();

  await expect(page.getByRole("button", { name: "Advanced scan" })).toBeEnabled();
  await page.getByRole("button", { name: "Advanced scan" }).click();

  await expect(repoRows.getByText("Protection rulesets unavailable for private repositories")).toBeVisible();
  await expect(repoRows.getByText("2 open issues")).toBeVisible();
});

test("keeps issue counts when rulesets are unavailable", async ({ page }) => {
  await mockGitHub(page, { rulesetsUnavailable: true });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await page.getByRole("button", { name: "Scan repositories" }).click();
  await page.getByRole("button", { name: "Advanced scan" }).click();

  const repoRows = page.locator("#repo-rows");
  await expect(repoRows.getByText("2 open issues")).toBeVisible();
  await expect(repoRows.getByText("Protection rulesets unavailable for private repositories")).toBeVisible();
  await expect(repoRows.getByText(/Advanced scan failed/)).toHaveCount(0);
});

test("excludes archived repositories by default and includes them on request", async ({ page }) => {
  await mockGitHub(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByRole("link", { name: "travel-prep" })).toBeVisible();
  await expect(page.getByRole("link", { name: "old-tool" })).toHaveCount(0);

  await page.getByRole("button", { name: "Include archived" }).click();
  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByRole("link", { name: "old-tool" })).toBeVisible();
});

test("shows visible installations when the configured owner is missing", async ({ page }) => {
  await mockGitHub(page, { installationOwner: "OtherOrg" });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with GitHub" }).click();

  await expect(page.getByText("No DevSecNinja installation is visible. Available: OtherOrg.")).toBeVisible();

  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByText("No GitHub App installation found for DevSecNinja. Visible installations: OtherOrg.")).toBeVisible();
});

test("continues scanning when one repository fails", async ({ page }) => {
  await mockGitHub(page, { failingRepo: "wazzup" });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByRole("link", { name: "travel-prep" })).toBeVisible();
  await expect(page.getByRole("link", { name: "wazzup" })).toBeVisible();
  await expect(page.locator("#repo-rows").getByText(/Scan failed:/)).toBeVisible();

  const repositoryFilters = page.locator(".filter-strip");
  await repositoryFilters.getByLabel("Status").selectOption("fail");
  await expect(page.getByRole("link", { name: "wazzup" })).toBeVisible();
  await expect(page.getByRole("link", { name: "travel-prep" })).toHaveCount(0);

  await repositoryFilters.getByLabel("Search").fill("scan failed");
  await expect(page.getByRole("link", { name: "wazzup" })).toBeVisible();

  await repositoryFilters.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: "travel-prep" })).toBeVisible();
});

test("stops new repository requests when rate limit is reached", async ({ page }) => {
  await mockGitHub(page, { rateLimitedRepo: "wazzup" });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByRole("link", { name: "travel-prep" })).toBeVisible();
  await expect(page.getByText(/skipped by rate limit/i)).toBeVisible();
  await expect(page.locator("#repo-rows").getByText(/Skipped because GitHub rate limit was reached/i)).toBeVisible();
});

test("pauses a running fast scan", async ({ page }) => {
  await mockGitHub(page, { delayTree: true });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByRole("button", { name: "Pause scan" })).toBeVisible();
  await page.getByRole("button", { name: "Pause scan" }).click();

  await expect(page.getByText(/Fast scan paused/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan repositories" })).toBeVisible();
});

test("exports scan results to a downloadable file", async ({ page }) => {
  await mockGitHub(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page.getByRole("button", { name: "Export results" })).toBeDisabled();

  await page.getByRole("button", { name: "Scan repositories" }).click();
  await expect(page.getByRole("link", { name: "travel-prep" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export results" })).toBeEnabled();

  await page.getByLabel("Export").selectOption("yaml");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export results" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^github-compliance-DevSecNinja-\d{4}-\d{2}-\d{2}\.yaml$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString("utf8");
  expect(content).toContain("owner: DevSecNinja");
  expect(content).toContain("renovatePullRequests:");
  expect(content).toContain("travel-prep");
});

async function mockGitHub(page, { installationOwner = "DevSecNinja", failingRepo, rateLimitedRepo, delayTree = false, rulesetsUnavailable = false } = {}) {
  const encodedRenovate = btoa('extends: ["github>DevSecNinja/.github//.renovate/base.json5"]');
  const encodedReadme = btoa("# Travel Prep");
  const encodedLicense = btoa("MIT");
  const encodedCodeowners = btoa("* @DevSecNinja/admins");

  await page.route("**/github-auth/device-code", async (route) => {
    await route.fulfill({
      json: {
        device_code: "device-code",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 0
      }
    });
  });

  await page.route("**/github-auth/access-token", async (route) => {
    await route.fulfill({
      json: {
        access_token: "ghu_test",
        token_type: "bearer",
        expires_in: 28800,
        refresh_token: "ghr_test",
        refresh_token_expires_in: 15897600
      }
    });
  });

  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const query = url.searchParams.get("q") ?? "";

    if (path === "/user") {
      await route.fulfill({ json: { login: "octocat" } });
      return;
    }

    if (path === "/user/installations") {
      await route.fulfill({ json: { total_count: 1, installations: [{ id: 10, account: { login: installationOwner } }] } });
      return;
    }

    if (path === "/user/installations/10/repositories") {
      await route.fulfill({
        json: {
          total_count: 2,
          repositories: [repository("travel-prep", false), repository("old-tool", true), ...(failingRepo ? [repository(failingRepo, false)] : []), ...(rateLimitedRepo ? [repository(rateLimitedRepo, false)] : [])]
        }
      });
      return;
    }

    if (rateLimitedRepo && path.includes(`/repos/DevSecNinja/${rateLimitedRepo}/`)) {
      await route.fulfill({
        status: 403,
        headers: { "X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60) },
        json: { message: "API rate limit exceeded for user ID 14926452.", status: "403" }
      });
      return;
    }

    if (failingRepo && path.includes(`/repos/DevSecNinja/${failingRepo}/`)) {
      await route.fulfill({ status: 500, json: { message: "Repository scan test failure" } });
      return;
    }

    if (path.endsWith("/git/trees/main")) {
      if (delayTree) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await route.fulfill({ json: { tree: tree() } });
      return;
    }

    if (path.endsWith("/rulesets")) {
      if (rulesetsUnavailable) {
        await route.fulfill({
          status: 403,
          json: {
            message: "Upgrade to GitHub Pro or make this repository public to enable this feature.",
            documentation_url: "https://docs.github.com/rest/repos/rules#get-all-repository-rulesets",
            status: "403"
          }
        });
        return;
      }

      await route.fulfill({ json: [ruleset()] });
      return;
    }

    if (path === "/search/issues" && query.includes("is:pr")) {
      expect(query).toContain("author:renovate[bot]");
      await route.fulfill({
        headers: {
          "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Resource",
          "X-RateLimit-Limit": "30",
          "X-RateLimit-Remaining": "29",
          "X-RateLimit-Resource": "search"
        },
        json: {
          total_count: 2,
          items: [
            {
              id: 100,
              number: 22,
              title: "Update dependency vite",
              body: null,
              html_url: "https://github.com/DevSecNinja/travel-prep/pull/22",
              repository_url: "https://api.github.com/repos/DevSecNinja/travel-prep",
              updated_at: "2026-05-24T10:00:00Z",
              user: { login: "renovate[bot]" },
              pull_request: {}
            },
            {
              id: 102,
              number: 23,
              title: "Update archived dependency",
              body: "Automerge: enabled",
              html_url: "https://github.com/DevSecNinja/old-tool/pull/23",
              repository_url: "https://api.github.com/repos/DevSecNinja/old-tool",
              updated_at: "2026-05-24T10:00:00Z",
              user: { login: "renovate[bot]" },
              pull_request: {}
            },
            {
              id: 101,
              number: 75,
              title: "Fix Renovate config",
              body: "Automerge: enabled",
              html_url: "https://github.com/DevSecNinja/.github/pull/75",
              repository_url: "https://api.github.com/repos/DevSecNinja/.github",
              updated_at: "2026-05-24T10:00:00Z",
              user: { login: "DevSecNinja" },
              pull_request: {}
            }
          ]
        }
      });
      return;
    }

    if (path === "/repos/DevSecNinja/travel-prep/issues/22") {
      await route.fulfill({ json: { body: "🚦 Automerge: Enabled.", labels: [] } });
      return;
    }

    if (path === "/repos/DevSecNinja/travel-prep/issues/22/comments") {
      await route.fulfill({ json: [{ body: "Dependency review passed." }] });
      return;
    }

    if (path === "/search/issues") {
      await route.fulfill({ json: { total_count: 2, items: [] } });
      return;
    }

    const contents = new Map([
      ["/repos/DevSecNinja/travel-prep/contents/CODEOWNERS", encodedCodeowners],
      ["/repos/DevSecNinja/travel-prep/contents/renovate.json5", encodedRenovate],
      ["/repos/DevSecNinja/travel-prep/contents/LICENSE", encodedLicense],
      ["/repos/DevSecNinja/travel-prep/contents/README.md", encodedReadme],
      ["/repos/DevSecNinja/old-tool/contents/CODEOWNERS", encodedCodeowners],
      ["/repos/DevSecNinja/old-tool/contents/renovate.json5", encodedRenovate],
      ["/repos/DevSecNinja/old-tool/contents/LICENSE", encodedLicense],
      ["/repos/DevSecNinja/old-tool/contents/README.md", encodedReadme]
    ]);

    if (path.endsWith("/contents/.github/workflows")) {
      await route.fulfill({ json: [{ type: "file", name: "pages.yml" }] });
      return;
    }

    if (contents.has(path)) {
      await route.fulfill({ json: { type: "file", content: contents.get(path) } });
      return;
    }

    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });
}

function repository(name, archived) {
  return {
    id: name === "travel-prep" ? 42 : 43,
    name,
    full_name: `DevSecNinja/${name}`,
    html_url: `https://github.com/DevSecNinja/${name}`,
    description: archived ? "Archived tool" : "Trip planning tools",
    archived,
    private: true,
    default_branch: "main",
    pushed_at: new Date().toISOString(),
    license: { spdx_id: "MIT" },
    owner: { login: "DevSecNinja" }
  };
}

function ruleset() {
  return {
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "pull_request" }, { type: "required_status_checks" }]
  };
}

function tree() {
  return [
    { path: "CODEOWNERS", type: "blob" },
    { path: "renovate.json5", type: "blob" },
    { path: "LICENSE", type: "blob" },
    { path: "README.md", type: "blob" },
    { path: ".github/workflows/pages.yml", type: "blob" }
  ];
}
