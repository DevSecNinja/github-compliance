import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitHubClient } from "../../src/js/github-api.js";

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
});