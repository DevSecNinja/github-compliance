import { expect, test } from "@playwright/test";

test("enters demo mode from the sign-in button without any GitHub calls", async ({ page }) => {
  const githubRequests = [];
  await page.route("https://api.github.com/**", (route) => {
    githubRequests.push(route.request().url());
    return route.abort();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "View demo with sample data" }).click();

  await expect(page.getByText("Signed in as")).toBeVisible();
  await expect(page.getByText("Demo mode.")).toBeVisible();
  await expect(page.getByText("Ready to scan demo-org.")).toBeVisible();

  await page.getByRole("button", { name: "Scan repositories" }).click();

  await expect(page.getByRole("link", { name: "homelab-gitops" })).toBeVisible();
  await expect(page.getByRole("link", { name: "dotfiles" })).toBeVisible();
  await expect(page.getByRole("link", { name: "legacy-backup" })).toHaveCount(0);
  await expect(page.getByText(/Found 6 repositories/)).toBeVisible();

  await page.getByRole("tab", { name: "Renovate PRs" }).click();
  await expect(page.getByText("3 open. 1 auto-merge, 1 manual, 1 unknown.")).toBeVisible();

  await page.getByRole("tab", { name: "Repositories" }).click();
  await expect(page.getByRole("button", { name: "Advanced scan" })).toBeEnabled();
  await page.getByRole("button", { name: "Advanced scan" }).click();
  await expect(page.locator("#repo-rows").getByText("12 open issues")).toBeVisible();
  await expect(page.locator("#repo-rows").getByText("Protection rulesets unavailable for private repositories")).toBeVisible();

  expect(githubRequests).toHaveLength(0);
});

test("auto-enters demo mode from the ?demo query parameter", async ({ page }) => {
  await page.goto("/?demo");

  await expect(page.getByText("Demo mode.")).toBeVisible();
  await expect(page.getByText("Signed in as")).toBeVisible();
  await expect(page.getByText("octodemo")).toBeVisible();
});

test("exits demo mode back to the sign-in screen", async ({ page }) => {
  await page.goto("/?demo");

  await expect(page.getByText("Demo mode.")).toBeVisible();
  await page.getByRole("button", { name: "Exit demo" }).click();

  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  await expect(page.getByText("Demo mode.")).toBeHidden();
});
