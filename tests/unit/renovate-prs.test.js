import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRenovatePullRequest, isRenovatePullRequest, isStaleAutoMergePullRequest, summarizeRenovatePullRequests } from "../../src/js/renovate-prs.js";

describe("renovate pull request parsing", () => {
  it("detects Renovate pull requests", () => {
    assert.equal(isRenovatePullRequest({ user: { login: "renovate[bot]" }, title: "Update dependency", head: { ref: "main" } }), true);
    assert.equal(isRenovatePullRequest({ user: { login: "renovate-bot" }, title: "Update dependency", head: { ref: "main" } }), true);
    assert.equal(isRenovatePullRequest({ user: { login: "octocat" }, title: "Feature", head: { ref: "feature" } }), false);
    assert.equal(isRenovatePullRequest({ user: { login: "octocat" }, title: "Fix Renovate config", head: { ref: "renovate-config" } }), false);
  });

  it("classifies auto-merge and manual merge from text", () => {
    assert.equal(classifyRenovatePullRequest({ title: "Update vite", body: "Automerge: enabled" }), "auto");
    assert.equal(classifyRenovatePullRequest({ title: "Update devcontainer", body: "🚦 Automerge: Enabled." }), "auto");
    assert.equal(classifyRenovatePullRequest({ title: "Lock file maintenance", body: "🚦 **Automerge**: Enabled." }), "auto");
    assert.equal(classifyRenovatePullRequest({ title: "Update image", body: "", labels: [{ name: "merge: auto" }] }), "auto");
    assert.equal(classifyRenovatePullRequest({ title: "Lock file maintenance", body: "", comments: [{ body: "🚦 Automerge: Enabled." }] }), "auto");
    assert.equal(classifyRenovatePullRequest({ title: "Update node", body: "Requires manual merge" }), "manual");
    assert.equal(classifyRenovatePullRequest({ title: "Update docs", body: "Dependency update" }), "unknown");
  });

  it("summarizes Renovate pull request counts", () => {
    const summary = summarizeRenovatePullRequests([
      { id: 1, number: 10, title: "Update vite", body: "Automerge: enabled", user: { login: "renovate[bot]" }, repository_url: "https://api.github.com/repos/DevSecNinja/app" },
      { id: 2, number: 11, title: "Update node", body: "Requires manual merge", user: { login: "renovate[bot]" }, repository_url: "https://api.github.com/repos/DevSecNinja/app" },
      { id: 3, number: 75, title: "Fix Renovate docs", body: "Automerge: enabled", user: { login: "DevSecNinja" }, repository_url: "https://api.github.com/repos/DevSecNinja/.github" },
      { id: 3, number: 12, title: "Feature", body: "", user: { login: "octocat" }, repository_url: "https://api.github.com/repos/DevSecNinja/app" }
    ]);

    assert.equal(summary.total, 2);
    assert.equal(summary.auto, 1);
    assert.equal(summary.manual, 1);
  });

  it("flags auto-merge pull requests open for more than 7 days as stale", () => {
    const now = Date.parse("2024-01-20T00:00:00Z");

    assert.equal(
      isStaleAutoMergePullRequest({ created_at: "2024-01-10T00:00:00Z" }, "auto", { now }),
      true
    );
    assert.equal(
      isStaleAutoMergePullRequest({ created_at: "2024-01-15T00:00:00Z" }, "auto", { now }),
      false
    );
    assert.equal(
      isStaleAutoMergePullRequest({ created_at: "2024-01-01T00:00:00Z" }, "manual", { now }),
      false
    );
    assert.equal(
      isStaleAutoMergePullRequest({ created_at: "2024-01-01T00:00:00Z" }, "auto", { now, staleAutoMergeDays: 30 }),
      false
    );
    assert.equal(isStaleAutoMergePullRequest({}, "auto", { now }), false);
  });

  it("counts stale auto-merge pull requests in the summary", () => {
    const now = Date.parse("2024-01-20T00:00:00Z");
    const summary = summarizeRenovatePullRequests([
      { id: 1, number: 10, title: "Update vite", body: "Automerge: enabled", user: { login: "renovate[bot]" }, created_at: "2024-01-01T00:00:00Z", repository_url: "https://api.github.com/repos/DevSecNinja/app" },
      { id: 2, number: 11, title: "Update node", body: "Automerge: enabled", user: { login: "renovate[bot]" }, created_at: "2024-01-19T00:00:00Z", repository_url: "https://api.github.com/repos/DevSecNinja/app" }
    ], { now });

    assert.equal(summary.auto, 2);
    assert.equal(summary.stale, 1);
    assert.equal(summary.pullRequests.find((pullRequest) => pullRequest.number === 10).stale, true);
    assert.equal(summary.pullRequests.find((pullRequest) => pullRequest.number === 11).stale, false);
  });
});
