import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

test("auth screen has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ path: axePath });

  const results = await page.evaluate(async () => axe.run(document, { resultTypes: ["violations"] }));
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));

  expect(serious).toEqual([]);
});

test("dark theme auth screen has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await page.locator("html").evaluate((html) => {
    html.dataset.theme = "dark";
  });
  await page.addScriptTag({ path: axePath });

  const results = await page.evaluate(async () => axe.run(document, { resultTypes: ["violations"] }));
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));

  expect(serious).toEqual([]);
});
