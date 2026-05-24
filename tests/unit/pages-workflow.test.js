import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Pages workflow", () => {
  it("passes the auth broker variable into the production build", () => {
    const workflow = readFileSync(new URL("../../.github/workflows/pages.yml", import.meta.url), "utf8");
    const buildStep = workflow.match(/      - name: Build\n(?:        .*\n)+/)?.[0] ?? "";

    assert.match(buildStep, /VITE_GITHUB_AUTH_BROKER_URL: \$\{\{ vars\.VITE_GITHUB_AUTH_BROKER_URL \}\}/);
  });
});
