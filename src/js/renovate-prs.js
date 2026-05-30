import { renovateMergeSignals, renovateStaleAutoMergeDays } from "./config.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isRenovatePullRequest(pullRequest) {
  const author = pullRequest.user?.login ?? "";

  return /^(renovate\[bot\]|renovate-bot|renovate)$/i.test(author);
}

export function classifyRenovatePullRequest(pullRequest, signals = renovateMergeSignals) {
  const body = pullRequest.body ?? "";
  const title = pullRequest.title ?? "";
  const labels = (pullRequest.labels ?? []).map((label) => label.name ?? label).join("\n");
  const comments = (pullRequest.comments ?? []).map((comment) => comment.body ?? "").join("\n");
  const text = `${title}\n${body}\n${labels}\n${comments}`;
  const normalizedText = text.replace(/[*_`]/g, "");
  const searchableText = `${text}\n${normalizedText}`;

  if (signals.manualMerge.some((pattern) => pattern.test(searchableText))) {
    return "manual";
  }

  if (signals.autoMerge.some((pattern) => pattern.test(searchableText))) {
    return "auto";
  }

  return "unknown";
}

export function isStaleAutoMergePullRequest(pullRequest, classification, options = {}) {
  if (classification !== "auto") {
    return false;
  }

  const { now = Date.now(), staleAutoMergeDays = renovateStaleAutoMergeDays } = options;
  const createdAt = pullRequest.created_at ?? pullRequest.createdAt;

  if (!createdAt) {
    return false;
  }

  const createdTime = new Date(createdAt).getTime();

  if (Number.isNaN(createdTime)) {
    return false;
  }

  return now - createdTime > staleAutoMergeDays * MS_PER_DAY;
}

export function summarizeRenovatePullRequests(pullRequests, options = {}) {
  const renovatePullRequests = pullRequests.filter(isRenovatePullRequest).map((pullRequest) => {
    const classification = classifyRenovatePullRequest(pullRequest);
    const stale = isStaleAutoMergePullRequest(pullRequest, classification, options);

    return {
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      repository: pullRequest.repository_url?.split("/repos/")[1] ?? pullRequest.base?.repo?.full_name ?? "Unknown repository",
      url: pullRequest.html_url,
      classification,
      stale,
      createdAt: pullRequest.created_at,
      updatedAt: pullRequest.updated_at
    };
  });

  return {
    total: renovatePullRequests.length,
    auto: renovatePullRequests.filter((pullRequest) => pullRequest.classification === "auto").length,
    manual: renovatePullRequests.filter((pullRequest) => pullRequest.classification === "manual").length,
    unknown: renovatePullRequests.filter((pullRequest) => pullRequest.classification === "unknown").length,
    stale: renovatePullRequests.filter((pullRequest) => pullRequest.stale).length,
    pullRequests: renovatePullRequests
  };
}
