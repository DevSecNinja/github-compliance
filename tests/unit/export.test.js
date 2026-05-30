import assert from "node:assert/strict";
import yaml from "js-yaml";
import { describe, it } from "node:test";
import { buildExportData, exportFormats, serializeExport, toCsv, toJson, toYaml } from "../../src/js/export.js";

const now = new Date("2026-05-30T08:00:00.000Z");

function sampleScan() {
  return {
    owner: "DevSecNinja",
    scannedAt: "2026-05-30T07:00:00.000Z",
    repositories: [
      {
        id: 1,
        name: "travel-prep",
        fullName: "DevSecNinja/travel-prep",
        url: "https://github.com/DevSecNinja/travel-prep",
        description: "Trip planning tools",
        archived: false,
        private: true,
        defaultBranch: "main",
        pushedAt: "2026-05-29T10:00:00.000Z",
        issueCount: 2,
        status: "warn",
        checks: [
          { id: "name", status: "pass", label: "Name uses lowercase hyphens" },
          { id: "license", status: "fail", label: "Add a license file" }
        ],
        observations: [{ id: "last-push", status: "pass", label: "Last push 1 day ago" }]
      },
      {
        id: 2,
        name: "old-tool",
        fullName: "DevSecNinja/old-tool",
        url: "https://github.com/DevSecNinja/old-tool",
        description: "Archived tool",
        archived: true,
        private: false,
        defaultBranch: "main",
        pushedAt: "2025-01-01T10:00:00.000Z",
        issueCount: null,
        status: "pass",
        checks: [{ id: "readme", status: "pass", label: "README is present" }],
        observations: []
      }
    ],
    renovate: {
      total: 1,
      auto: 1,
      manual: 0,
      unknown: 0,
      pullRequests: [
        {
          id: 100,
          number: 22,
          title: "Update dependency vite",
          repository: "DevSecNinja/travel-prep",
          url: "https://github.com/DevSecNinja/travel-prep/pull/22",
          classification: "auto",
          updatedAt: "2026-05-24T10:00:00.000Z"
        }
      ]
    }
  };
}

describe("export module", () => {
  it("builds structured export data with repositories and Renovate PRs", () => {
    const data = buildExportData(sampleScan(), { now });

    assert.equal(data.owner, "DevSecNinja");
    assert.equal(data.scannedAt, "2026-05-30T07:00:00.000Z");
    assert.equal(data.exportedAt, now.toISOString());
    assert.deepEqual(data.summary, {
      totalRepositories: 2,
      ready: 1,
      review: 1,
      needsWork: 0,
      renovate: { total: 1, auto: 1, manual: 0, unknown: 0 }
    });
    assert.equal(data.repositories.length, 2);
    assert.equal(data.repositories[0].visibility, "private");
    assert.equal(data.repositories[1].visibility, "public");
    assert.equal(data.renovatePullRequests.length, 1);
    assert.equal(data.renovatePullRequests[0].repository, "DevSecNinja/travel-prep");
  });

  it("serializes to valid JSON", () => {
    const parsed = JSON.parse(toJson(sampleScan(), { now }));

    assert.equal(parsed.repositories.length, 2);
    assert.equal(parsed.renovatePullRequests[0].number, 22);
  });

  it("serializes to valid YAML", () => {
    const parsed = yaml.load(toYaml(sampleScan(), { now }));

    assert.equal(parsed.owner, "DevSecNinja");
    assert.equal(parsed.repositories[0].checks[1].status, "fail");
    assert.equal(parsed.renovatePullRequests[0].classification, "auto");
  });

  it("serializes to CSV with a row per repository and pull request", () => {
    const csv = toCsv(sampleScan(), { now });
    const lines = csv.trim().split("\n");

    assert.equal(lines.length, 4);
    assert.match(lines[0], /^recordType,repository,name,status,classification/);
    assert.match(csv, /repository,DevSecNinja\/travel-prep/);
    assert.match(csv, /renovate_pr,DevSecNinja\/travel-prep/);
    assert.match(csv, /Add a license file/);
  });

  it("creates a descriptor with filename, mime type, and content", () => {
    const result = serializeExport(sampleScan(), "yaml", { now });

    assert.equal(result.filename, "github-compliance-DevSecNinja-2026-05-30.yaml");
    assert.equal(result.mimeType, exportFormats.yaml.mimeType);
    assert.ok(result.content.includes("owner: DevSecNinja"));
  });

  it("throws on an unsupported format", () => {
    assert.throws(() => serializeExport(sampleScan(), "xml", { now }), /Unsupported export format/);
  });

  it("handles empty scan results", () => {
    const data = buildExportData({ owner: "DevSecNinja" }, { now });

    assert.equal(data.summary.totalRepositories, 0);
    assert.deepEqual(data.repositories, []);
    assert.deepEqual(data.renovatePullRequests, []);
  });
});
