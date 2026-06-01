import yaml from "js-yaml";
import Papa from "papaparse";

export const exportFormats = {
  json: { label: "JSON", extension: "json", mimeType: "application/json" },
  yaml: { label: "YAML", extension: "yaml", mimeType: "application/x-yaml" },
  csv: { label: "CSV", extension: "csv", mimeType: "text/csv" }
};

const csvColumns = [
  "recordType",
  "repository",
  "name",
  "status",
  "classification",
  "number",
  "title",
  "url",
  "description",
  "topics",
  "visibility",
  "archived",
  "defaultBranch",
  "pushedAt",
  "issueCount",
  "failingChecks",
  "checks"
];

export function buildExportData(scanResult, { now = new Date() } = {}) {
  const repositories = scanResult?.repositories ?? [];
  const renovate = scanResult?.renovate ?? {};
  const pullRequests = renovate.pullRequests ?? [];

  return {
    owner: scanResult?.owner ?? null,
    scannedAt: scanResult?.scannedAt ?? null,
    exportedAt: now.toISOString(),
    summary: {
      totalRepositories: repositories.length,
      ready: repositories.filter((repo) => repo.status === "pass").length,
      review: repositories.filter((repo) => repo.status === "warn").length,
      needsWork: repositories.filter((repo) => repo.status === "fail").length,
      renovate: {
        total: renovate.total ?? pullRequests.length,
        auto: renovate.auto ?? 0,
        manual: renovate.manual ?? 0,
        unknown: renovate.unknown ?? 0
      }
    },
    repositories: repositories.map(toRepositoryRecord),
    renovatePullRequests: pullRequests.map(toPullRequestRecord)
  };
}

function toRepositoryRecord(repo) {
  return {
    name: repo.name ?? null,
    fullName: repo.fullName ?? null,
    url: repo.url ?? null,
    description: repo.description ?? null,
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    visibility: repo.private ? "private" : "public",
    archived: Boolean(repo.archived),
    defaultBranch: repo.defaultBranch ?? null,
    pushedAt: repo.pushedAt ?? null,
    issueCount: repo.issueCount ?? null,
    status: repo.status ?? null,
    checks: (repo.checks ?? []).map((check) => ({ id: check.id, status: check.status, label: check.label })),
    observations: (repo.observations ?? []).map((observation) => ({ id: observation.id, status: observation.status, label: observation.label }))
  };
}

function toPullRequestRecord(pullRequest) {
  return {
    repository: pullRequest.repository ?? null,
    number: pullRequest.number ?? null,
    title: pullRequest.title ?? null,
    url: pullRequest.url ?? null,
    classification: pullRequest.classification ?? null,
    updatedAt: pullRequest.updatedAt ?? null
  };
}

export function toJson(scanResult, options = {}) {
  return `${JSON.stringify(buildExportData(scanResult, options), null, 2)}\n`;
}

export function toYaml(scanResult, options = {}) {
  return yaml.dump(buildExportData(scanResult, options), { lineWidth: -1, noRefs: true });
}

export function toCsv(scanResult, options = {}) {
  const data = buildExportData(scanResult, options);
  const rows = [
    ...data.repositories.map((repo) => ({
      recordType: "repository",
      repository: repo.fullName,
      name: repo.name,
      status: repo.status,
      classification: "",
      number: "",
      title: "",
      url: repo.url,
      description: repo.description,
      topics: (repo.topics ?? []).join("; "),
      visibility: repo.visibility,
      archived: repo.archived,
      defaultBranch: repo.defaultBranch,
      pushedAt: repo.pushedAt,
      issueCount: repo.issueCount,
      failingChecks: repo.checks.filter((check) => check.status === "fail").map((check) => check.label).join("; "),
      checks: repo.checks.map((check) => `${check.id}:${check.status}`).join("; ")
    })),
    ...data.renovatePullRequests.map((pullRequest) => ({
      recordType: "renovate_pr",
      repository: pullRequest.repository,
      name: "",
      status: "",
      classification: pullRequest.classification,
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      description: "",
      visibility: "",
      archived: "",
      defaultBranch: "",
      pushedAt: pullRequest.updatedAt,
      issueCount: "",
      failingChecks: "",
      checks: ""
    }))
  ];

  return `${Papa.unparse({ fields: csvColumns, data: rows }, { newline: "\n" })}\n`;
}

export function serializeExport(scanResult, format, options = {}) {
  const descriptor = exportFormats[format];

  if (!descriptor) {
    throw new Error(`Unsupported export format: ${format}`);
  }

  const content = format === "yaml" ? toYaml(scanResult, options) : format === "csv" ? toCsv(scanResult, options) : toJson(scanResult, options);
  const owner = scanResult?.owner ?? "scan";
  const datePart = new Date(options.now ?? Date.now()).toISOString().slice(0, 10);
  const filename = `github-compliance-${owner}-${datePart}.${descriptor.extension}`;

  return { filename, mimeType: descriptor.mimeType, content };
}
