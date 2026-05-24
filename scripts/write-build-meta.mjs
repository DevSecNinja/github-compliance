import { readFile, writeFile } from "node:fs/promises";

const sha = process.env.GITHUB_SHA || process.env.COMMIT_SHA || "local-dev";
const shortSha = sha.slice(0, 7);
const builtAt = new Date().toISOString();

await writeFile("public/build-meta.json", `${JSON.stringify({ sha, shortSha, builtAt }, null, 2)}\n`);

const template = await readFile("public/sw.template.js", "utf8");
await writeFile("public/sw.js", template.replaceAll("__BUILD_VERSION__", shortSha));
