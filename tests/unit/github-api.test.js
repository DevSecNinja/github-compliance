import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitHubClient } from "../../src/js/github-api.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("GitHubClient", () => {
  it("aborts requests with the caller signal", async () => {
    const controller = new AbortController();
    const client = new GitHubClient("token", {
      fetcher: async (url, options) => {
        assert.equal(url, "https://api.github.com/user");

        return new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new DOMException("Scan paused.", "AbortError")), { once: true });
        });
      }
    });

    const request = client.request("/user", { signal: controller.signal });
    controller.abort();

    await assert.rejects(request, { name: "AbortError" });
  });

  it("fetches custom repositories and flags missing ones", async () => {
    const client = new GitHubClient("token", {
      fetcher: async (url) => {
        const path = new URL(url).pathname;

        if (path === "/repos/other-org/widget") {
          return jsonResponse({ id: 7, name: "widget", full_name: "other-org/widget", owner: { login: "other-org" } });
        }

        return jsonResponse({ message: "Not found" }, { status: 404 });
      }
    });

    const repositories = await client.fetchCustomRepositories(["other-org/widget", "other-org/missing", "other-org/widget"]);

    assert.equal(repositories.length, 2);
    assert.equal(repositories[0].full_name, "other-org/widget");
    assert.equal(repositories[0].custom, true);
    assert.equal(repositories[1].full_name, "other-org/missing");
    assert.equal(repositories[1].custom, true);
    assert.match(repositories[1].fetchError, /not found/i);
  });

  it("includes custom repositories from other owners in Renovate searches", async () => {
    const searchedQueries = [];
    const client = new GitHubClient("token", {
      fetcher: async (url) => {
        const requestUrl = new URL(url);
        const path = requestUrl.pathname;
        const query = requestUrl.searchParams.get("q") ?? "";

        if (path === "/search/issues") {
          searchedQueries.push(query);

          if (query.includes("org:DevSecNinja")) {
            return jsonResponse({
              total_count: 1,
              items: [{ id: 1, number: 10, pull_request: {}, repository_url: "https://api.github.com/repos/DevSecNinja/app", user: { login: "renovate[bot]" }, title: "Owner PR" }]
            });
          }

          return jsonResponse({
            total_count: 1,
            items: [{ id: 2, number: 11, pull_request: {}, repository_url: "https://api.github.com/repos/other-org/widget", user: { login: "renovate[bot]" }, title: "Custom PR" }]
          });
        }

        if (path.endsWith("/comments")) {
          return jsonResponse([]);
        }

        return jsonResponse({ body: "Automerge: enabled", labels: [] });
      }
    });

    const summary = await client.getRenovatePullRequests("DevSecNinja", [
      { full_name: "DevSecNinja/app" },
      { full_name: "other-org/widget" }
    ]);

    assert.equal(summary.total, 2);
    assert.ok(searchedQueries.some((query) => query.includes("org:DevSecNinja")));
    assert.ok(searchedQueries.some((query) => query.includes("repo:other-org/widget")));
  });
});