import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("service worker template", () => {
  it("forces fresh app shell and script updates", () => {
    const worker = readFileSync(new URL("../../public/sw.template.js", import.meta.url), "utf8");

    assert.match(worker, /cache: "reload"/);
    assert.match(worker, /self\.skipWaiting\(\)/);
    assert.match(worker, /self\.clients\.claim\(\)/);
    assert.match(worker, /const isScript = url\.pathname\.endsWith\("\.js"\)/);
    assert.match(worker, /networkFirst\(request\)/);
    assert.match(worker, /cache: "no-cache"/);
  });
});