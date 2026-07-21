import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedCopilotSkills = [
  "./skills/preflight-github-bounties/",
  "./skills/audit-agent-harness/",
  "./skills/diagnose-github-actions/",
  "./skills/classify-github-flakes/",
  "./skills/check-mcp-tool-drift/",
];

test("plugin manifests expose the existing engineering gates without changing SkillVerdict's experiment", async () => {
  const codex = JSON.parse(await readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"));
  const copilot = JSON.parse(await readFile(new URL("../.github/plugin/plugin.json", import.meta.url), "utf8"));

  assert.equal(codex.name, "bountyverdict");
  assert.equal(copilot.name, codex.name);
  assert.equal(copilot.version, codex.version);
  assert.equal(copilot.license, "MIT");
  assert.deepEqual(copilot.skills, expectedCopilotSkills);
  assert.ok(copilot.description.includes("x402"));
  assert.ok(!copilot.skills.some((path) => path.includes("preflight-agent-skills")));
  assert.ok(!copilot.skills.some((path) => path.includes("route-github-agent-checks")));

  for (const path of copilot.skills) {
    const source = await readFile(new URL(`../${path}SKILL.md`, import.meta.url), "utf8");
    assert.match(source, /^---\nname: [a-z0-9-]+\ndescription: /);
    assert.match(source, /x402/i);
  }
});

test("Glama release packaging bridges only the existing hosted MCP without secrets", async () => {
  const [dockerfile, dockerignore, glama, packageJson, packageLock, smoke, workflow] = await Promise.all([
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../.dockerignore", import.meta.url), "utf8"),
    readFile(new URL("../glama.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../glama/package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../glama/package-lock.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../agent/scripts/verify-glama-release.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);

  assert.deepEqual(glama, {
    $schema: "https://glama.ai/mcp/schemas/server.json",
    maintainers: ["Mimirs402"],
  });
  assert.match(dockerfile, /^FROM node:22\.23\.1-alpine3\.24@sha256:[0-9a-f]{64}$/m);
  assert.deepEqual(packageJson.dependencies, { "mcp-remote": "0.1.38" });
  assert.equal(packageLock.lockfileVersion, 3);
  assert.equal(packageLock.packages["node_modules/mcp-remote"].version, "0.1.38");
  assert.match(packageLock.packages["node_modules/mcp-remote"].integrity, /^sha512-/);
  assert.match(dockerfile, /COPY glama\/package\.json glama\/package-lock\.json/);
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /https:\/\/bountyverdict-agent-production\.mimirslab\.workers\.dev\/mcp\?source=glama-release/);
  assert.match(dockerfile, /"--transport", "http-only", "--silent"/);
  assert.doesNotMatch(dockerfile, /SkillVerdict|\/api\/skill|token|secret|private[_-]?key/i);
  assert.match(dockerignore, /^\*\*$/m);
  for (const allowed of ["Dockerfile", "glama.json", "glama/package.json", "glama/package-lock.json", "LICENSE", "README.md"]) {
    assert.match(dockerignore, new RegExp(`^!${allowed.replace(".", "\\.")}$`, "m"));
  }
  assert.match(smoke, /User-Agent:bountyverdict-owner-audit\/1\.0/);
  assert.match(smoke, /client\.listTools\(\)/);
  assert.match(smoke, /assert\.deepEqual\(names, expectedTools\)/);
  assert.match(workflow, /npm run glama:verify/);
});
