import { appConfig } from "./config.js";
import { applyAdvancedChecks, evaluateRepository } from "./compliance.js";
import { summarizeRenovatePullRequests } from "./renovate-prs.js";

const apiBase = "https://api.github.com";

export class GitHubClient {
  constructor(token, { fetcher = (...args) => fetch(...args), onRateLimit } = {}) {
    this.token = token;
    this.fetcher = fetcher;
    this.onRateLimit = onRateLimit;
  }

  async request(path, options = {}) {
    const url = path.startsWith("http") ? path : `${apiBase}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), appConfig.requestTimeoutMs);
    const signal = combineSignals(options.signal, controller.signal);
    let response;

    try {
      response = await this.fetcher(url, {
        ...options,
        signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": appConfig.githubApiVersion,
          ...(options.headers ?? {})
        }
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        if (options.signal?.aborted) {
          throw abortError();
        }

        throw new Error(`GitHub request timed out after ${Math.round(appConfig.requestTimeoutMs / 1000)} seconds: ${new URL(url).pathname}`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    this.captureRateLimit(response);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const message = await response.text();
      const error = new Error(`GitHub returned ${response.status}: ${message || response.statusText}`);
      error.status = response.status;
      error.rateLimit = parseRateLimit(response);
      error.isRateLimit = response.status === 403 && /rate limit exceeded/i.test(message);
      throw error;
    }

    if (response.status === 204) {
      return null;
    }

    return response;
  }

  async json(path, options) {
    const response = await this.request(path, options);
    return response ? response.json() : null;
  }

  async paginate(path, options = {}) {
    const items = [];
    let next = path;

    while (next) {
      throwIfAborted(options.signal);
      const response = await this.request(next, options);
      if (!response) {
        break;
      }

      items.push(...(await response.json()));
      next = getNextLink(response.headers.get("Link"));
    }

    return items;
  }

  async paginateCollection(path, key, options = {}) {
    const items = [];
    let next = path;

    while (next) {
      throwIfAborted(options.signal);
      const response = await this.request(next, options);
      if (!response) {
        break;
      }

      const payload = await response.json();
      items.push(...(payload[key] ?? []));
      next = getNextLink(response.headers.get("Link"));
    }

    return items;
  }

  getViewer() {
    return this.json("/user");
  }

  listInstallations() {
    return this.paginateCollection("/user/installations?per_page=100", "installations");
  }

  async getInstallationForOwner(owner, installations) {
    const visibleInstallations = installations ?? (await this.listInstallations());
    return visibleInstallations.find((installation) => installation.account?.login?.toLowerCase() === owner.toLowerCase());
  }

  async getInstallationOwners() {
    const installations = await this.listInstallations();
    return installations.map((installation) => installation.account?.login).filter(Boolean).sort((left, right) => left.localeCompare(right));
  }

  async requireInstallationForOwner(owner, options = {}) {
    const installations = await this.paginateCollection("/user/installations?per_page=100", "installations", options);
    const installation = await this.getInstallationForOwner(owner, installations);

    if (!installation) {
      throw new Error(formatMissingInstallationMessage(owner, installations));
    }

    return installation;
  }

  async listInstallationRepositories({ owner, includeArchived }) {
    const installation = await this.requireInstallationForOwner(owner);

    const repositories = await this.paginateCollection(`/user/installations/${installation.id}/repositories?per_page=100`, "repositories");
    return (includeArchived ? repositories : repositories.filter((repo) => !repo.archived)).sort((left, right) => new Date(right.pushed_at ?? 0) - new Date(left.pushed_at ?? 0));
  }

  async getInstallationRepositoryInventory({ owner, includeArchived, signal, customRepositories = [] }) {
    let installationRepositories = [];
    let installation = null;
    let installationError = null;

    try {
      installation = await this.requireInstallationForOwner(owner, { signal });
      installationRepositories = await this.paginateCollection(`/user/installations/${installation.id}/repositories?per_page=100`, "repositories", { signal });
    } catch (error) {
      if (!customRepositories.length) {
        throw error;
      }

      installationError = error;
    }

    const customRepos = await this.fetchCustomRepositories(customRepositories, { signal });

    const byId = new Map();
    for (const repo of installationRepositories) {
      byId.set(String(repo.id), repo);
    }
    for (const repo of customRepos) {
      byId.set(String(repo.id), repo);
    }

    const allRepositories = [...byId.values()];
    // Custom repositories were added explicitly, so they are scanned even when
    // archived repositories are otherwise excluded.
    const repositories = includeArchived ? allRepositories : allRepositories.filter((repo) => repo.custom || !repo.archived);

    return {
      installation,
      installationError,
      totalCount: allRepositories.length,
      archivedCount: allRepositories.filter((repo) => repo.archived).length,
      repositories: repositories.sort((left, right) => new Date(right.pushed_at ?? 0) - new Date(left.pushed_at ?? 0))
    };
  }

  async fetchCustomRepositories(customRepositories = [], options = {}) {
    const fullNames = normalizeFullNames(customRepositories);

    return mapLimit(fullNames, appConfig.scanConcurrency, async (fullName) => {
      throwIfAborted(options.signal);

      try {
        const repo = await this.getRepository(fullName, options);

        if (repo) {
          return { ...repo, custom: true };
        }

        return buildMissingCustomRepository(fullName, "Repository not found, or the GitHub App is not installed or authorized for it.");
      } catch (error) {
        if (error?.name === "AbortError") {
          throw error;
        }

        return buildMissingCustomRepository(fullName, cleanError(error));
      }
    }, options.signal);
  }

  getRepository(fullName, options = {}) {
    const [owner, repo] = fullName.split("/");
    return this.json(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, options);
  }

  async scanRepositories({ owner, includeArchived, customRepositories = [], signal, onProgress, onRepositoryResult }) {
    const inventory = await this.getInstallationRepositoryInventory({ owner, includeArchived, signal, customRepositories });
    const repositories = inventory.repositories;
    let completed = 0;
    let rateLimitError = null;

    onProgress?.({ completed, total: repositories.length, repo: null, inventory });

    const results = await mapLimit(repositories, appConfig.scanConcurrency, async (repo) => {
      throwIfAborted(signal);

      if (repo.fetchError) {
        const result = buildFailedRepository(repo, new Error(repo.fetchError));
        completed += 1;
        onRepositoryResult?.(result, { completed, total: repositories.length });
        onProgress?.({ completed, total: repositories.length, repo: repo.name });
        return result;
      }

      if (rateLimitError) {
        return buildSkippedRepository(repo, rateLimitError);
      }

      let result;

      try {
        result = await this.scanRepository(repo, { signal });
      } catch (error) {
        if (error.isRateLimit) {
          rateLimitError = error;
          result = buildSkippedRepository(repo, error);
        } else {
          result = buildFailedRepository(repo, error);
        }
      }

      completed += 1;
      onRepositoryResult?.(result, { completed, total: repositories.length });
      onProgress?.({ completed, total: repositories.length, repo: repo.name });
      return result;
    });

    throwIfAborted(signal);
    const renovatePullRequests = await this.getRenovatePullRequestsSafely(owner, repositories, { signal });

    return {
      owner,
      includeArchived,
      scannedAt: new Date().toISOString(),
      inventory: {
        totalCount: inventory.totalCount,
        archivedCount: inventory.archivedCount,
        scannedCount: completed,
        rateLimited: Boolean(rateLimitError),
        rateLimitResetAt: rateLimitError?.rateLimit?.reset ?? null
      },
      repositories: results,
      renovate: renovatePullRequests
    };
  }

  async getRenovatePullRequestsSafely(owner, repositories, options = {}) {
    try {
      return await this.getRenovatePullRequests(owner, repositories, options);
    } catch (error) {
      return {
        total: 0,
        auto: 0,
        manual: 0,
        unknown: 0,
        pullRequests: [],
        error: cleanError(error)
      };
    }
  }

  async scanRepository(repo, options = {}) {
    const files = await this.getComplianceFiles(repo, options);

    return evaluateRepository({ repo, files, rulesets: null, issueCount: null });
  }

  async advancedScanRepositories({ repositories, signal, onProgress, onRepositoryResult }) {
    let completed = 0;
    let rateLimitError = null;

    const results = await mapLimit(repositories, appConfig.scanConcurrency, async (repository) => {
      throwIfAborted(signal);

      let result;

      if (rateLimitError) {
        result = markAdvancedSkipped(repository, rateLimitError);
      } else {
        try {
          result = await this.advancedScanRepository(repository, { signal });
        } catch (error) {
          if (error.isRateLimit) {
            rateLimitError = error;
            result = markAdvancedSkipped(repository, error);
          } else {
            result = markAdvancedFailed(repository, error);
          }
        }
      }

      completed += 1;
      onRepositoryResult?.(result, { completed, total: repositories.length });
      onProgress?.({ completed, total: repositories.length, repo: repository.name });
      return result;
    });

    return {
      repositories: results,
      rateLimited: Boolean(rateLimitError),
      rateLimitResetAt: rateLimitError?.rateLimit?.reset ?? null
    };
  }

  async advancedScanRepository(repository, options = {}) {
    const [owner, repo] = repository.fullName.split("/");
    const [rulesets, issueCount] = await Promise.all([
      repository.private
        ? "Protection rulesets unavailable for private repositories"
        : this.getRulesetsForAdvancedScan(owner, repo, options),
      this.getOpenIssueCount(owner, repo, options)
    ]);

    return applyAdvancedChecks(repository, { rulesets, issueCount });
  }

  async getRulesetsForAdvancedScan(owner, repo, options = {}) {
    try {
      return await this.getRulesets(owner, repo, options);
    } catch (error) {
      if (rulesetsUnavailable(error)) {
        return "Protection rulesets unavailable for this repository";
      }

      throw error;
    }
  }

  async getComplianceFiles(repo, options = {}) {
    const owner = repo.owner.login;
    const name = repo.name;
    const ref = repo.default_branch;
    const tree = await this.getRepositoryTree(owner, name, ref, options);
    const paths = new Set(tree.map((item) => item.path));
    const renovatePath = findFirstPath(paths, ["renovate.json5", "renovate.json", ".github/renovate.json5", ".github/renovate.json"]);
    const renovate = renovatePath ? await this.getFirstFile(owner, name, [renovatePath], ref, options) : null;

    return {
      codeowners: findFirstPath(paths, ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"]),
      renovate,
      license: findFirstPath(paths, ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]),
      readme: findFirstPath(paths, ["README.md", "README"]),
      devcontainer: tree.some((item) => item.type === "blob" && (item.path === ".devcontainer.json" || /^\.devcontainer\/(?:[^/]+\/)?devcontainer\.json$/.test(item.path))),
      workflows: tree.some((item) => item.path.startsWith(".github/workflows/") && item.type === "blob")
    };
  }

  async getRepositoryTree(owner, repo, ref, options = {}) {
    const result = await this.json(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, options);
    return result?.tree ?? [];
  }

  async getFirstFile(owner, repo, paths, ref, options = {}) {
    for (const path of paths) {
      throwIfAborted(options.signal);
      const file = await this.getContent(owner, repo, path, ref, options);
      if (file?.type === "file") {
        return { path, content: decodeContent(file.content) };
      }
    }

    return null;
  }

  async getDirectory(owner, repo, path, ref) {
    const content = await this.getContent(owner, repo, path, ref);
    return Array.isArray(content) && content.length > 0 ? content : null;
  }

  getContent(owner, repo, path, ref, options = {}) {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return this.json(`/repos/${owner}/${repo}/contents/${encodePath(path)}${query}`, options);
  }

  async getRulesets(owner, repo, options = {}) {
    return (await this.json(`/repos/${owner}/${repo}/rulesets?targets=branch&per_page=100`, options)) ?? [];
  }

  async getOpenIssueCount(owner, repo, options = {}) {
    const query = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open`);
    const result = await this.json(`/search/issues?q=${query}&per_page=1`, options);
    return result?.total_count ?? null;
  }

  async getRenovatePullRequests(owner, repositories, options = {}) {
    const allowedRepositories = new Set(repositories.map((repo) => repo.full_name ?? repo.fullName).filter(Boolean));
    const ownerItems = await this.searchRenovatePullRequestsForOwner(owner, options);

    // Repositories outside the primary owner (manually added custom repos) are
    // not covered by the owner-scoped search, so query them by repository.
    const extraFullNames = [...allowedRepositories].filter((fullName) => repositoryOwner(fullName).toLowerCase() !== owner.toLowerCase());
    const extraItems = await this.searchRenovatePullRequestsForRepositories(extraFullNames, options);

    const items = dedupeById([...ownerItems, ...extraItems]);
    const pullRequests = items.filter((item) => item.pull_request && allowedRepositories.has(repositoryFromApiUrl(item.repository_url)));
    const hydratedPullRequests = await mapLimit(pullRequests, 2, (pullRequest) => this.hydratePullRequestIssue(pullRequest, options), options.signal);
    return summarizeRenovatePullRequests(hydratedPullRequests);
  }

  searchRenovatePullRequestsForOwner(owner, options = {}) {
    const query = encodeURIComponent(`org:${owner} is:pr is:open author:renovate[bot]`);
    return this.paginateCollection(`/search/issues?q=${query}&per_page=100`, "items", options);
  }

  async searchRenovatePullRequestsForRepositories(fullNames, options = {}) {
    if (!fullNames.length) {
      return [];
    }

    const items = [];

    for (const batch of chunk(fullNames, 5)) {
      throwIfAborted(options.signal);
      const repoQualifiers = batch.map((fullName) => `repo:${fullName}`).join(" ");
      const query = encodeURIComponent(`${repoQualifiers} is:pr is:open author:renovate[bot]`);
      items.push(...(await this.paginateCollection(`/search/issues?q=${query}&per_page=100`, "items", options)));
    }

    return items;
  }

  async hydratePullRequestIssue(pullRequest, options = {}) {
    const [issue, comments] = await Promise.all([
      this.json(`${pullRequest.repository_url}/issues/${pullRequest.number}`, options),
      this.paginate(`${pullRequest.repository_url}/issues/${pullRequest.number}/comments?per_page=100`, options)
    ]);

    return { ...pullRequest, ...(issue ?? {}), comments };
  }

  captureRateLimit(response) {
    const limit = response.headers.get("X-RateLimit-Limit");
    const remaining = response.headers.get("X-RateLimit-Remaining");

    if (limit && remaining) {
      this.onRateLimit?.(parseRateLimit(response));
    }
  }
}

function decodeContent(content) {
  if (!content) {
    return "";
  }

  const binary = atob(content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function findFirstPath(paths, candidates) {
  return candidates.find((path) => paths.has(path)) ?? null;
}

function repositoryFromApiUrl(repositoryUrl) {
  return repositoryUrl?.split("/repos/")[1] ?? "";
}

function repositoryOwner(fullName) {
  return String(fullName ?? "").split("/")[0] ?? "";
}

function normalizeFullNames(fullNames) {
  const seen = new Set();
  const result = [];

  for (const value of fullNames ?? []) {
    const fullName = String(value ?? "").trim();
    const key = fullName.toLowerCase();

    if (/^[^/]+\/[^/]+$/.test(fullName) && !seen.has(key)) {
      seen.add(key);
      result.push(fullName);
    }
  }

  return result;
}

function chunk(items, size) {
  const result = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function dedupeById(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = item?.id ?? `${item?.repository_url}#${item?.number}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildMissingCustomRepository(fullName, message) {
  const [owner, name] = fullName.split("/");

  return {
    id: `custom:${fullName}`,
    name,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description: "",
    archived: false,
    private: false,
    default_branch: null,
    pushed_at: null,
    owner: { login: owner },
    custom: true,
    fetchError: message
  };
}

function getNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const next = linkHeader.split(",").find((link) => link.includes('rel="next"'));
  return next ? next.match(/<([^>]+)>/)?.[1] ?? null : null;
}

async function mapLimit(items, limit, iteratee, signal) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    throwIfAborted(signal);
    const promise = Promise.resolve().then(() => iteratee(item));
    results.push(promise);
    executing.add(promise);
    promise.finally(() => executing.delete(promise));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw abortError();
  }
}

function combineSignals(externalSignal, timeoutSignal) {
  if (!externalSignal) {
    return timeoutSignal;
  }

  if (externalSignal.aborted) {
    return externalSignal;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal.addEventListener("abort", abort, { once: true });
  timeoutSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function abortError() {
  return new DOMException("Scan paused.", "AbortError");
}

function buildFailedRepository(repo, error) {
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
    pushedLabel: repo.pushed_at ? new Date(repo.pushed_at).toLocaleDateString() : "Unknown",
    issueCount: null,
    status: "fail",
    checks: [
      {
        id: "scan",
        status: "fail",
        label: `Scan failed: ${cleanError(error)}`
      }
    ],
    observations: [],
    protection: { status: "unknown", label: "Not checked", missing: [], report: [] }
  };
}

function buildSkippedRepository(repo, error) {
  const resetText = error.rateLimit?.reset ? ` Try again after ${new Date(error.rateLimit.reset).toLocaleTimeString()}.` : " Try again later.";

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
    pushedLabel: repo.pushed_at ? new Date(repo.pushed_at).toLocaleDateString() : "Unknown",
    issueCount: null,
    status: "warn",
    checks: [
      {
        id: "rate-limit",
        status: "warn",
        label: `Skipped because GitHub rate limit was reached.${resetText}`
      }
    ],
    observations: [],
    protection: { status: "unknown", label: "Not checked", missing: [], report: [] }
  };
}

function markAdvancedFailed(repository, error) {
  return addObservation(repository, {
    id: "advanced-scan",
    status: "warn",
    label: `Advanced scan failed: ${cleanError(error)}`
  });
}

function markAdvancedSkipped(repository, error) {
  const resetText = error.rateLimit?.reset ? ` Try again after ${new Date(error.rateLimit.reset).toLocaleTimeString()}.` : " Try again later.";

  return addObservation(repository, {
    id: "advanced-scan",
    status: "warn",
    label: `Advanced scan skipped because GitHub rate limit was reached.${resetText}`
  });
}

function addObservation(repository, observation) {
  const observations = repository.observations.filter((item) => item.id !== observation.id).concat(observation);

  return {
    ...repository,
    status: repository.status === "fail" ? "fail" : "warn",
    observations
  };
}

function cleanError(error) {
  return error instanceof Error ? error.message.replace(/^GitHub returned \d+:\s*/, "") : "Unknown error";
}

function parseRateLimit(response) {
  const resetHeader = response.headers.get("X-RateLimit-Reset");

  return {
    limit: Number(response.headers.get("X-RateLimit-Limit") ?? 0),
    remaining: Number(response.headers.get("X-RateLimit-Remaining") ?? 0),
    resource: response.headers.get("X-RateLimit-Resource") || "core",
    reset: resetHeader ? Number(resetHeader) * 1000 : null
  };
}

function rulesetsUnavailable(error) {
  return error?.status === 403 && /Upgrade to GitHub Pro|enable this feature|rulesets/i.test(error.message);
}

function formatMissingInstallationMessage(owner, installations) {
  const visibleOwners = installations.map((installation) => installation.account?.login).filter(Boolean).sort((left, right) => left.localeCompare(right));

  if (visibleOwners.length === 0) {
    return `No GitHub App installations are visible to this sign-in. Install the GitHub App on ${owner}, or sign in with a user who can access that installation.`;
  }

  return `No GitHub App installation found for ${owner}. Visible installations: ${visibleOwners.join(", ")}. Install the app on ${owner}, update Owner to one of those accounts, or sign in with a user who can access ${owner}.`;
}
