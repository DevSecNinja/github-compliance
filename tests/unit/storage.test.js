import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRepositoryReference } from "../../src/js/storage.js";

describe("parseRepositoryReference", () => {
  it("accepts owner/repo shorthand", () => {
    assert.equal(parseRepositoryReference("octocat/hello-world"), "octocat/hello-world");
  });

  it("extracts owner/repo from GitHub URLs", () => {
    assert.equal(parseRepositoryReference("https://github.com/octocat/hello-world"), "octocat/hello-world");
    assert.equal(parseRepositoryReference("https://github.com/octocat/hello-world/tree/main"), "octocat/hello-world");
    assert.equal(parseRepositoryReference("github.com/octocat/hello-world.git"), "octocat/hello-world");
    assert.equal(parseRepositoryReference("git@github.com:octocat/hello-world.git"), "octocat/hello-world");
  });

  it("rejects values that are not repository references", () => {
    assert.equal(parseRepositoryReference("octocat"), null);
    assert.equal(parseRepositoryReference(""), null);
    assert.equal(parseRepositoryReference("   "), null);
    assert.equal(parseRepositoryReference(null), null);
  });
});
