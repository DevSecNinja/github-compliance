import { appConfig } from "./config.js";
import { evaluateRepository } from "./compliance.js";
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
    let response;

    try {
      response = await this.fetcher(url, {
        ...options,
        signal: options.signal ?? controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": appConfig.githubApiVersion,
          ...(options.headers ?? {})
        }
      });
    } catch (error) {
      if (error?.name === "AbortError") {
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

  async paginate(path) {
    const items = [];
    let next = path;

    while (next) {
      const response = await this.request(next);
      if (!response) {
        break;
      }

      items.push(...(await response.json()));
      next = getNextLink(response.headers.get("Link"));
    }

    return items;
  }

  async paginateCollection(path, key) {
    const items = [];
    let next = path;

    while (next) {
      const response = await this.request(next);
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

  async requireInstallationForOwner(owner) {
    const installations = await this.listInstallations();
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

  async getInstallationRepositoryInventory({ owner, includeArchived }) {
    const installation = await this.requireInstallationForOwner(owner);
    const allRepositories = await this.paginateCollection(`/user/installations/${installation.id}/repositories?per_page=100`, "repositories");
    const repositories = includeArchived ? allRepositories : allRepositories.filter((repo) => !repo.archived);

    return {
      installation,
      totalCount: allRepositories.length,
      archivedCount: allRepositories.filter((repo) => repo.archived).length,
      repositories: repositories.sort((left, right) => new Date(right.pushed_at ?? 0) - new Date(left.pushed_at ?? 0))
    };
  }

  async scanRepositories({ owner, includeArchived, onProgress }) {
    const inventory = await this.getInstallationRepositoryInventory({ owner, includeArchived });
    const repositories = inventory.repositories;
    let completed = 0;
    let rateLimitError = null;

    onProgress?.({ completed, total: repositories.length, repo: null, inventory });

    const results = await mapLimit(repositories, appConfig.scanConcurrency, async (repo) => {
      if (rateLimitError) {
        return buildSkippedRepository(repo, rateLimitError);
      }

      let result;

      try {
        result = await this.scanRepository(repo);
      } catch (error) {
        if (error.isRateLimit) {
          rateLimitError = error;
          result = buildSkippedRepository(repo, error);
        } else {
          result = buildFailedRepository(repo, error);
        }
      }

      completed += 1;
      onProgress?.({ completed, total: repositories.length, repo: repo.name });
      return result;
    });

    const renovatePullRequests = await this.getRenovatePullRequestsSafely(owner);

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

  async getRenovatePullRequestsSafely(owner) {
    try {
      return await this.getRenovatePullRequests(owner);
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

  async scanRepository(repo) {
    const files = await this.getComplianceFiles(repo);

    return evaluateRepository({ repo, files, rulesets: null, issueCount: null });
  }

  async getComplianceFiles(repo) {
    const owner = repo.owner.login;
    const name = repo.name;
    const ref = repo.default_branch;
    const tree = await this.getRepositoryTree(owner, name, ref);
    const paths = new Set(tree.map((item) => item.path));
    const renovatePath = findFirstPath(paths, ["renovate.json5", "renovate.json", ".github/renovate.json5", ".github/renovate.json"]);
    const renovate = renovatePath ? await this.getFirstFile(owner, name, [renovatePath], ref) : null;

    return {
      codeowners: findFirstPath(paths, ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"]),
      renovate,
      license: findFirstPath(paths, ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]),
      readme: findFirstPath(paths, ["README.md", "README"]),
      workflows: tree.some((item) => item.path.startsWith(".github/workflows/") && item.type === "blob")
    };
  }

  async getRepositoryTree(owner, repo, ref) {
    const result = await this.json(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    return result?.tree ?? [];
  }

  async getFirstFile(owner, repo, paths, ref) {
    for (const path of paths) {
      const file = await this.getContent(owner, repo, path, ref);
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

  getContent(owner, repo, path, ref) {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return this.json(`/repos/${owner}/${repo}/contents/${encodePath(path)}${query}`);
  }

  async getRulesets(owner, repo) {
    return (await this.json(`/repos/${owner}/${repo}/rulesets?targets=branch&per_page=100`)) ?? [];
  }

  async getOpenIssueCount(owner, repo) {
    const query = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open`);
    const result = await this.json(`/search/issues?q=${query}&per_page=1`);
    return result?.total_count ?? null;
  }

  async getRenovatePullRequests(owner) {
    const query = encodeURIComponent(`org:${owner} is:pr is:open author:renovate[bot]`);
    const result = await this.paginateCollection(`/search/issues?q=${query}&per_page=100`, "items");
    const pullRequests = result.filter((item) => item.pull_request);
    return summarizeRenovatePullRequests(pullRequests);
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

function getNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const next = linkHeader.split(",").find((link) => link.includes('rel="next"'));
  return next ? next.match(/<([^>]+)>/)?.[1] ?? null : null;
}

async function mapLimit(items, limit, iteratee) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
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

function formatMissingInstallationMessage(owner, installations) {
  const visibleOwners = installations.map((installation) => installation.account?.login).filter(Boolean).sort((left, right) => left.localeCompare(right));

  if (visibleOwners.length === 0) {
    return `No GitHub App installations are visible to this sign-in. Install the GitHub App on ${owner}, or sign in with a user who can access that installation.`;
  }

  return `No GitHub App installation found for ${owner}. Visible installations: ${visibleOwners.join(", ")}. Install the app on ${owner}, update Owner to one of those accounts, or sign in with a user who can access ${owner}.`;
}
