import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Pages workflow", () => {
  it("passes the auth broker variable into the production build", () => {
    const workflow = readFileSync(new URL("../../.github/workflows/pages.yml", import.meta.url), "utf8");

    assert.match(workflow, /uses: DevSecNinja\/\.github\/\.github\/workflows\/pages\.yml@827f77131e6a52e247ed5e33234eee538ff31b17/);
    assert.match(workflow, /VITE_GITHUB_AUTH_BROKER_URL="\$\{\{ vars\.VITE_GITHUB_AUTH_BROKER_URL \}\}"/);
    assert.match(workflow, /github-pages: false/);
    assert.match(workflow, /cloudflare-preview: true/);
    assert.match(workflow, /cloudflare-production: true/);
    assert.match(workflow, /cloudflare-project-name: "github-compliance"/);
    assert.match(workflow, /cloudflare-production-branch: "main"/);
    assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
    assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
    assert.doesNotMatch(workflow, /<<<<<<<|=======|>>>>>>>/);
  });
});
