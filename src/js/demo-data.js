// Demo data mode.
//
// Provides a self-contained, in-browser mock of the GitHub REST endpoints the
// app calls so that pull request preview deployments (for example Cloudflare
// Pages PR builds) can be exercised without signing in or spending real GitHub
// API calls. The responses mirror the shape of the real GitHub API so the rest
// of the app behaves exactly as it would against live data.

export const DEMO_OWNER = "demo-org";
export const DEMO_TOKEN = "demo-token";
export const DEMO_VIEWER = { login: "octodemo" };

const INSTALLATION_ID = 1;

// Stable "now" anchored relative timestamps so the demo always looks fresh.
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function encodeContent(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

const centralRenovate = 'extends: ["github>DevSecNinja/.github//.renovate/base.json5"]';
const localRenovate = '{ "extends": ["config:recommended"] }';

const fullRuleset = {
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
  rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "pull_request" }, { type: "required_status_checks" }]
};

const weakRuleset = {
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
  rules: [{ type: "pull_request" }]
};

// Each entry models one repository plus the supporting tree, file contents,
// rulesets, and open issue count the scanner reads for it.
const repositories = [
  {
    id: 101,
    name: "homelab-gitops",
    description: "GitOps manifests for the home lab cluster",
    archived: false,
    private: false,
    pushedAt: daysAgo(1),
    license: "MIT",
    tree: ["CODEOWNERS", "renovate.json5", "LICENSE", "README.md", ".github/workflows/ci.yml"],
    contents: { "renovate.json5": centralRenovate },
    rulesets: [fullRuleset],
    openIssues: 3
  },
  {
    id: 102,
    name: "travel-prep",
    description: "Trip planning tools and checklists",
    archived: false,
    private: true,
    pushedAt: daysAgo(4),
    license: "MIT",
    tree: ["CODEOWNERS", "renovate.json5", "LICENSE", "README.md", ".github/workflows/deploy.yml"],
    contents: { "renovate.json5": centralRenovate },
    rulesets: [fullRuleset],
    openIssues: 1
  },
  {
    id: 103,
    name: "dotfiles",
    description: "Personal shell and editor configuration",
    archived: false,
    private: false,
    pushedAt: daysAgo(9),
    license: null,
    tree: ["README.md", "LICENSE", ".github/workflows/lint.yml", "renovate.json"],
    contents: { "renovate.json": localRenovate },
    rulesets: [weakRuleset],
    openIssues: 12
  },
  {
    id: 104,
    name: "Personal-Website",
    description: "Static portfolio site",
    archived: false,
    private: false,
    pushedAt: daysAgo(21),
    license: "MIT",
    tree: ["CODEOWNERS", "renovate.json5", "LICENSE", "README.md", ".github/workflows/pages.yml"],
    contents: { "renovate.json5": centralRenovate },
    rulesets: [fullRuleset],
    openIssues: 0
  },
  {
    id: 105,
    name: "notes",
    description: "",
    archived: false,
    private: false,
    pushedAt: daysAgo(45),
    license: null,
    tree: ["CODEOWNERS", "renovate.json5", "README.md"],
    contents: { "renovate.json5": centralRenovate },
    rulesets: [],
    openIssues: 5
  },
  {
    id: 106,
    name: "legacy-backup",
    description: "Archived backup scripts",
    archived: true,
    private: false,
    pushedAt: daysAgo(540),
    license: null,
    tree: ["README.md"],
    contents: {},
    rulesets: [],
    openIssues: 0
  }
];

const renovatePullRequests = [
  {
    repo: "homelab-gitops",
    number: 41,
    title: "Update dependency vite to v8",
    issueBody: "🚦 Automerge: Enabled.",
    comments: ["Dependency review passed."],
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1)
  },
  {
    repo: "travel-prep",
    number: 18,
    title: "Update actions/checkout action to v5",
    issueBody: "Automerge: Disabled. Please merge this manually.",
    comments: [],
    createdAt: daysAgo(3),
    updatedAt: daysAgo(2)
  },
  {
    repo: "dotfiles",
    number: 7,
    title: "Update dependency eslint to v9",
    issueBody: "This PR contains the following updates.",
    comments: [],
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2)
  }
];

function repositoryPayload(repo) {
  return {
    id: repo.id,
    name: repo.name,
    full_name: `${DEMO_OWNER}/${repo.name}`,
    html_url: `https://github.com/${DEMO_OWNER}/${repo.name}`,
    description: repo.description,
    archived: repo.archived,
    private: repo.private,
    default_branch: "main",
    pushed_at: repo.pushedAt,
    license: repo.license ? { spdx_id: repo.license } : null,
    owner: { login: DEMO_OWNER }
  };
}

function findRepository(name) {
  return repositories.find((repo) => repo.name === name);
}

function coreHeaders(remaining = 4985) {
  return {
    "X-RateLimit-Limit": "5000",
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Resource": "core",
    "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 3600)
  };
}

function searchHeaders(remaining = 29) {
  return {
    "X-RateLimit-Limit": "30",
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Resource": "search",
    "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60)
  };
}

function jsonResponse(body, { status = 200, headers = coreHeaders() } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function renovateSearchItems() {
  return renovatePullRequests.map((pullRequest, index) => ({
    id: 900 + index,
    number: pullRequest.number,
    title: pullRequest.title,
    body: null,
    html_url: `https://github.com/${DEMO_OWNER}/${pullRequest.repo}/pull/${pullRequest.number}`,
    repository_url: `https://api.github.com/repos/${DEMO_OWNER}/${pullRequest.repo}`,
    created_at: pullRequest.createdAt,
    updated_at: pullRequest.updatedAt,
    user: { login: "renovate[bot]" },
    pull_request: {}
  }));
}

// Returns a fetch-compatible function the GitHubClient uses in place of the
// real network call. It inspects the request URL and returns mocked responses
// that match the GitHub REST API.
export function createDemoFetcher() {
  return async function demoFetch(input, options = {}) {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const url = new URL(typeof input === "string" ? input : input.url);
    const path = url.pathname;
    const query = url.searchParams.get("q") ?? "";

    if (path === "/user") {
      return jsonResponse(DEMO_VIEWER);
    }

    if (path === "/user/installations") {
      return jsonResponse({ total_count: 1, installations: [{ id: INSTALLATION_ID, account: { login: DEMO_OWNER } }] });
    }

    if (path === `/user/installations/${INSTALLATION_ID}/repositories`) {
      return jsonResponse({ total_count: repositories.length, repositories: repositories.map(repositoryPayload) });
    }

    if (path === "/search/issues" && /is:pr/.test(query)) {
      return jsonResponse({ total_count: renovatePullRequests.length, items: renovateSearchItems() }, { headers: searchHeaders() });
    }

    if (path === "/search/issues") {
      const match = query.match(/repo:[^/]+\/(\S+)\s/);
      const repo = match ? findRepository(match[1]) : null;
      return jsonResponse({ total_count: repo?.openIssues ?? 0, items: [] }, { headers: searchHeaders(28) });
    }

    const repoMatch = path.match(/^\/repos\/[^/]+\/([^/]+)/);
    const repo = repoMatch ? findRepository(repoMatch[1]) : null;

    if (repo) {
      if (path.endsWith("/git/trees/main")) {
        return jsonResponse({ tree: repo.tree.map((item) => ({ path: item, type: "blob" })) });
      }

      if (path.endsWith("/rulesets")) {
        return jsonResponse(repo.rulesets);
      }

      const issueMatch = path.match(/\/issues\/(\d+)(\/comments)?$/);
      if (issueMatch) {
        const number = Number(issueMatch[1]);
        const pullRequest = renovatePullRequests.find((item) => item.repo === repo.name && item.number === number);

        if (issueMatch[2]) {
          return jsonResponse((pullRequest?.comments ?? []).map((body) => ({ body })));
        }

        return jsonResponse({ body: pullRequest?.issueBody ?? "", labels: [], created_at: pullRequest?.createdAt });
      }

      const contentsMatch = path.match(/\/contents\/(.+)$/);
      if (contentsMatch) {
        const file = decodeURIComponent(contentsMatch[1]);
        if (repo.contents[file] !== undefined) {
          return jsonResponse({ type: "file", content: encodeContent(repo.contents[file]) });
        }
      }
    }

    return jsonResponse({ message: "Not found" }, { status: 404 });
  };
}

// Demo mode is enabled with a `?demo` (or `?demo=1`) query parameter so a
// preview deployment can be shared as a ready-to-test link, and from the
// "View demo" button on the sign-in screen.
export function isDemoModeRequested(search = window.location.search) {
  return new URLSearchParams(search).has("demo");
}
