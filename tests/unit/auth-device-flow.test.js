import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeviceFlowAuth } from "../../src/js/auth-device-flow.js";

describe("device flow auth", () => {
  it("explains the required auth route when static hosting rejects token posts", async () => {
    const auth = new DeviceFlowAuth({
      fetcher: async () => ({ ok: false, status: 405 })
    });

    await assert.rejects(
      auth.postForm("/github-auth/device-code", new URLSearchParams({ client_id: "test" })),
      /GitHub sign-in endpoint is unavailable/
    );
  });
});
