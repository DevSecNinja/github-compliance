import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import worker from "../../public/_worker.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Cloudflare Pages Worker", () => {
  it("forwards device-code requests to GitHub", async () => {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://github.com/login/device/code");
      assert.equal(options.method, "POST");
      assert.equal(options.body, "client_id=test");

      return new Response(JSON.stringify({ user_code: "ABCD-1234" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const response = await worker.fetch(
      new Request("https://gh-compliance.ravensberg.org/github-auth/device-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://gh-compliance.ravensberg.org"
        },
        body: "client_id=test"
      }),
      assetEnv()
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://gh-compliance.ravensberg.org");
    assert.match(await response.text(), /ABCD-1234/);
  });

  it("serves static assets for non-auth routes", async () => {
    const response = await worker.fetch(new Request("https://gh-compliance.ravensberg.org/"), assetEnv());

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "asset response");
  });

  it("returns a JavaScript recovery module when a stale hashed asset falls through to HTML", async () => {
    const response = await worker.fetch(
      new Request("https://gh-compliance.ravensberg.org/assets/index-oldhash.js"),
      assetEnv(new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } }))
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/javascript; charset=utf-8");
    assert.equal(response.headers.get("X-Recovering-Asset"), "1");
    assert.match(await response.text(), /location\.replace/);
  });

  it("prevents index and service worker responses from being stored by browser caches", async () => {
    const response = await worker.fetch(new Request("https://gh-compliance.ravensberg.org/index.html"), assetEnv());

    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });

  it("blocks unexpected cross-origin auth calls", async () => {
    const response = await worker.fetch(
      new Request("https://gh-compliance.ravensberg.org/github-auth/device-code", {
        method: "POST",
        headers: { Origin: "https://example.com" },
        body: "client_id=test"
      }),
      assetEnv()
    );

    assert.equal(response.status, 403);
  });
});

function assetEnv(response = new Response("asset response")) {
  return {
    ASSETS: {
      fetch: async () => response
    }
  };
}
