import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRenovateContent, evaluateRepository, evaluateRulesets, isLowerHyphenName, relativeTime } from "../../src/js/compliance.js";

describe("compliance rules", () => {
  it("accepts lowercase hyphen repository names", () => {
    assert.equal(isLowerHyphenName("travel-prep"), true);
    assert.equal(isLowerHyphenName(".github"), true);
    assert.equal(isLowerHyphenName("Travel_Prep"), false);
  });

  it("summarizes relative push times", () => {
    assert.equal(relativeTime("2026-05-23T12:00:00Z", new Date("2026-05-24T12:00:00Z")), "1 day ago");
  });

  it("requires Renovate to extend the central repository", () => {
    assert.equal(evaluateRenovateContent('extends: ["github>DevSecNinja/.github//.renovate/base.json5"]').status, "pass");
    assert.equal(evaluateRenovateContent('{ "extends": ["config:recommended"] }').status, "fail");
  });

  it("requires deletion and force-push protection", () => {
    const result = evaluateRulesets([
      {
        target: "branch",
        enforcement: "active",
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
        rules: [{ type: "deletion" }, { type: "non_fast_forward" }]
      }
    ]);

    assert.equal(result.status, "pass");
  });

  it("builds a repository compliance result", () => {
    const repo = {
      id: 1,
      name: "bad_name",
      full_name: "DevSecNinja/bad_name",
      html_url: "https://github.com/DevSecNinja/bad_name",
      description: "",
      archived: false,
      private: true,
      default_branch: "main",
      pushed_at: "2026-05-24T10:00:00Z"
    };

    const result = evaluateRepository({
      repo,
      files: { codeowners: null, renovate: null, license: null, readme: { path: "README.md" }, workflows: null },
      rulesets: [],
      issueCount: 3,
      now: new Date("2026-05-24T12:00:00Z")
    });

    assert.equal(result.status, "fail");
    assert.equal(result.issueCount, 3);
  });
});
