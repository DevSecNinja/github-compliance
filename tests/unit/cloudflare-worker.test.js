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

function assetEnv() {
  return {
    ASSETS: {
      fetch: async () => new Response("asset response")
    }
  };
}
