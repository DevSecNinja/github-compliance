import { renovateMergeSignals } from "./config.js";

export function isRenovatePullRequest(pullRequest) {
  const author = pullRequest.user?.login ?? "";

  return /^(renovate\[bot\]|renovate-bot|renovate)$/i.test(author);
}

export function classifyRenovatePullRequest(pullRequest, signals = renovateMergeSignals) {
  const body = pullRequest.body ?? "";
  const title = pullRequest.title ?? "";
  const labels = (pullRequest.labels ?? []).map((label) => label.name ?? label).join("\n");
  const text = `${title}\n${body}\n${labels}`;

  if (signals.manualMerge.some((pattern) => pattern.test(text))) {
    return "manual";
  }

  if (signals.autoMerge.some((pattern) => pattern.test(text))) {
    return "auto";
  }

  return "unknown";
}

export function summarizeRenovatePullRequests(pullRequests) {
  const renovatePullRequests = pullRequests.filter(isRenovatePullRequest).map((pullRequest) => ({
    id: pullRequest.id,
    number: pullRequest.number,
    title: pullRequest.title,
    repository: pullRequest.repository_url?.split("/repos/")[1] ?? pullRequest.base?.repo?.full_name ?? "Unknown repository",
    url: pullRequest.html_url,
    classification: classifyRenovatePullRequest(pullRequest),
    updatedAt: pullRequest.updated_at
  }));

  return {
    total: renovatePullRequests.length,
    auto: renovatePullRequests.filter((pullRequest) => pullRequest.classification === "auto").length,
    manual: renovatePullRequests.filter((pullRequest) => pullRequest.classification === "manual").length,
    unknown: renovatePullRequests.filter((pullRequest) => pullRequest.classification === "unknown").length,
    pullRequests: renovatePullRequests
  };
}
