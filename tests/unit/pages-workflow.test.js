import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Pages workflow", () => {
  it("passes the auth broker variable into the production build", () => {
    const workflow = readFileSync(new URL("../../.github/workflows/pages.yml", import.meta.url), "utf8");

    assert.match(workflow, /uses: DevSecNinja\/\.github\/\.github\/workflows\/pages\.yml@998ff283c3a431bbcb74421180121826cca8fdd7/);
    assert.match(workflow, /VITE_GITHUB_AUTH_BROKER_URL="\$\{\{ vars\.VITE_GITHUB_AUTH_BROKER_URL \}\}"/);
    assert.doesNotMatch(workflow, /<<<<<<<|=======|>>>>>>>/);
  });
});
