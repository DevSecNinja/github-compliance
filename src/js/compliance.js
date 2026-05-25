import { appConfig, renovateCentralPatterns } from "./config.js";

export function isLowerHyphenName(name) {
  if (name === ".github") {
    return true;
  }

  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

export function relativeTime(value, now = new Date()) {
  if (!value) {
    return "Never";
  }

  const then = new Date(value);
  if (Number.isNaN(then.getTime())) {
    return "Unknown";
  }

  const seconds = Math.max(1, Math.round((now.getTime() - then.getTime()) / 1000));
  const units = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60]
  ];

  for (const [unit, unitSeconds] of units) {
    if (seconds >= unitSeconds) {
      const count = Math.floor(seconds / unitSeconds);
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
    }
  }

  return "Just now";
}

export function isStalePush(value, now = new Date(), stalePushDays = appConfig.stalePushDays) {
  if (!value) {
    return true;
  }

  const then = new Date(value);
  if (Number.isNaN(then.getTime())) {
    return true;
  }

  const days = (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24);
  return days > stalePushDays;
}

export function evaluateRenovateContent(content) {
  if (!content) {
    return { present: false, central: false, status: "fail", label: "Missing Renovate config" };
  }

  const central = renovateCentralPatterns.some((pattern) => pattern.test(content));
  return {
    present: true,
    central,
    status: central ? "pass" : "fail",
    label: central ? "Renovate extends central config" : "Renovate config does not extend DevSecNinja/.github"
  };
}

export function evaluateRulesets(rulesets = [], defaultBranch = "main") {
  if (!Array.isArray(rulesets)) {
    return {
      status: "unknown",
      label: typeof rulesets === "string" ? rulesets : "Protection not checked in fast scan",
      missing: [],
      report: []
    };
  }

  const activeDefaultBranchRulesets = rulesets.filter((ruleset) => {
    if (ruleset.target && ruleset.target !== "branch") {
      return false;
    }

    if (ruleset.enforcement !== "active") {
      return false;
    }

    const includes = ruleset.conditions?.ref_name?.include ?? [];
    return includes.length === 0 || includes.some((pattern) => appliesToDefaultBranch(pattern, defaultBranch));
  });

  if (activeDefaultBranchRulesets.length === 0) {
    return {
      status: "fail",
      label: "No active default-branch ruleset",
      missing: ["deletion block", "force-push block"],
      report: []
    };
  }

  const ruleTypes = new Set(activeDefaultBranchRulesets.flatMap((ruleset) => (ruleset.rules ?? []).map((rule) => rule.type)));
  const missing = [];

  if (!ruleTypes.has("deletion")) {
    missing.push("deletion block");
  }

  if (!ruleTypes.has("non_fast_forward")) {
    missing.push("force-push block");
  }

  const report = [
    ruleTypes.has("pull_request") ? "Pull requests required" : "Pull request rule not detected",
    ruleTypes.has("required_status_checks") ? "Status checks required" : "Status checks not detected",
    ruleTypes.has("required_deployments") ? "Deployments required" : "Deployments not required"
  ];

  return {
    status: missing.length === 0 ? "pass" : "fail",
    label: missing.length === 0 ? "Force pushes and deletion are blocked" : `Ruleset missing ${missing.join(", ")}`,
    missing,
    report
  };
}

export function evaluateRepository({ repo, files, rulesets, issueCount, now = new Date() }) {
  const renovate = evaluateRenovateContent(files.renovate?.content);
  const protection = evaluateRulesets(rulesets, repo.default_branch);
  const checks = [
    buildCheck("name", isLowerHyphenName(repo.name), "Name uses lowercase hyphens", "Rename with lowercase letters, numbers, and hyphens"),
    buildCheck("description", Boolean(repo.description), "Description is set", "Add a short description"),
    buildCheck("codeowners", Boolean(files.codeowners), "CODEOWNERS is present", "Add CODEOWNERS"),
    buildCheck("renovate", renovate.status === "pass", renovate.label, renovate.label),
    ...(protection.status === "unknown" ? [] : [buildCheck("protection", protection.status === "pass", protection.label, protection.label)]),
    buildCheck("license", Boolean(repo.license || files.license), "License is set", "Add a license file"),
    buildCheck("readme", Boolean(files.readme), "README is present", "Add README"),
    buildCheck("workflows", Boolean(files.workflows), "GitHub Actions workflow exists", "Add a workflow")
  ];

  const observations = [
    {
      id: "last-push",
      status: isStalePush(repo.pushed_at, now) ? "warn" : "pass",
      label: `Last push ${relativeTime(repo.pushed_at, now)}`
    },
    {
      id: "issues",
      status: issueCount === null || issueCount === undefined ? "unknown" : "info",
      label: issueCount === null || issueCount === undefined ? "Open issues not checked in fast scan" : `${issueCount} open issue${issueCount === 1 ? "" : "s"}`
    },
    ...(protection.status === "unknown" ? [{ id: "protection", status: "unknown", label: protection.label }] : []),
    ...protection.report.map((label) => ({ id: label.toLowerCase().replaceAll(" ", "-"), status: "info", label }))
  ];

  const status = checks.some((check) => check.status === "fail") ? "fail" : observations.some((check) => check.status === "warn") ? "warn" : "pass";

  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description || "No description",
    archived: repo.archived,
    private: repo.private,
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
    pushedLabel: relativeTime(repo.pushed_at, now),
    issueCount: issueCount ?? null,
    status,
    checks,
    observations,
    protection
  };
}

export function applyAdvancedChecks(repository, { rulesets, issueCount }) {
  const protection = evaluateRulesets(rulesets, repository.defaultBranch);
  const checks = repository.checks.filter((check) => check.id !== "protection");

  if (protection.status !== "unknown") {
    checks.push(buildCheck("protection", protection.status === "pass", protection.label, protection.label));
  }

  const observations = repository.observations
    .filter((observation) => observation.id !== "issues" && observation.id !== "protection" && !observation.id.startsWith("protection-report-"))
    .concat([
      {
        id: "issues",
        status: issueCount === null || issueCount === undefined ? "unknown" : "info",
        label: issueCount === null || issueCount === undefined ? "Open issues not checked in fast scan" : `${issueCount} open issue${issueCount === 1 ? "" : "s"}`
      },
      ...(protection.status === "unknown" ? [{ id: "protection", status: "unknown", label: protection.label }] : []),
      ...protection.report.map((label, index) => ({ id: `protection-report-${index}`, status: "info", label }))
    ]);

  return {
    ...repository,
    issueCount: issueCount ?? null,
    status: summarizeStatus(checks, observations),
    checks,
    observations,
    protection
  };
}

function buildCheck(id, passed, passLabel, failLabel) {
  return {
    id,
    status: passed ? "pass" : "fail",
    label: passed ? passLabel : failLabel
  };
}

function summarizeStatus(checks, observations) {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }

  if (observations.some((observation) => observation.status === "warn")) {
    return "warn";
  }

  return "pass";
}

function appliesToDefaultBranch(pattern, defaultBranch) {
  return pattern === "~DEFAULT_BRANCH" || pattern === defaultBranch || pattern === `refs/heads/${defaultBranch}` || pattern === "*";
}
