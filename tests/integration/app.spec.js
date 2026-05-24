import { expect, test } from "@playwright/test";

test("signs in with device flow, scans repositories, and renders results", async ({ page }) => {
  await mockGitHub(page);
  await page.goto("/");

  await page.getByRole("main", { name: "Sign in to review your repositories." }).getByLabel("Owner").fill("DevSecNinja");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();

  await expect(page.getByText("Signed in as")).toBeVisible();
  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByRole("link", { name: "travel-prep" })).toBeVisible();
  await expect(page.getByText("Renovate extends central config")).toBeVisible();
  await expect(page.getByText("Protection not checked in fast scan")).toBeVisible();
  await expect(page.getByText("Found 2 repositories; showing 1, excluding 1 archived.")).toBeVisible();
  await expect(page.getByText("1 open. 1 auto-merge, 0 manual, 0 unknown.")).toBeVisible();
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
  await expect(page.getByText(/Scan failed:/)).toBeVisible();
});

test("stops new repository requests when rate limit is reached", async ({ page }) => {
  await mockGitHub(page, { rateLimitedRepo: "wazzup" });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByRole("link", { name: "travel-prep" })).toBeVisible();
  await expect(page.getByText(/skipped by rate limit/i)).toBeVisible();
  await expect(page.getByText(/Skipped because GitHub rate limit was reached/i)).toBeVisible();
});

async function mockGitHub(page, { installationOwner = "DevSecNinja", failingRepo, rateLimitedRepo } = {}) {
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
      await route.fulfill({ json: { tree: tree() } });
      return;
    }

    if (path.endsWith("/rulesets")) {
      await route.fulfill({ json: [ruleset()] });
      return;
    }

    if (path === "/search/issues" && query.includes("is:pr")) {
      await route.fulfill({
        json: {
          total_count: 1,
          items: [
            {
              id: 100,
              number: 22,
              title: "Update dependency vite",
              body: "Automerge: enabled",
              html_url: "https://github.com/DevSecNinja/travel-prep/pull/22",
              repository_url: "https://api.github.com/repos/DevSecNinja/travel-prep",
              updated_at: "2026-05-24T10:00:00Z",
              user: { login: "renovate[bot]" },
              pull_request: {}
            }
          ]
        }
      });
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
    pushed_at: "2026-05-24T10:00:00Z",
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
