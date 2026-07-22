import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const image = process.env.GLAMA_RELEASE_IMAGE || "bountyverdict-glama-verify:local";
const endpoint = "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=glama-release";
const entrypoint = "./node_modules/.bin/mcp-remote";
const expectedTools = Object.freeze([
  "audit_agent_harness",
  "check_github_bounty",
  "check_mcp_tool_drift",
  "classify_github_actions_flake",
  "diagnose_github_actions_run",
  "rank_github_bounties",
]);
const expectedTaskOpeners = Object.freeze({
  check_github_bounty: /^Is this public GitHub issue bounty still claimable/,
  rank_github_bounties: /^Which public GitHub bounty should I work on next/,
  audit_agent_harness: /^Can a coding agent safely work in this public repository/,
  diagnose_github_actions_run: /^Why did this public GitHub Actions run fail/,
  classify_github_actions_flake: /^Is this failed GitHub Actions run flaky/,
  check_mcp_tool_drift: /^Will upgrading to this complete MCP tools\/list break my agent/,
} as const);

await execFileAsync("docker", ["build", "--pull", "--tag", image, ".."], {
  timeout: 180_000,
  maxBuffer: 10_000_000,
});

const { stdout: inspectOutput } = await execFileAsync("docker", [
  "image", "inspect", image, "--format", "{{json .Config}}",
], { timeout: 30_000, maxBuffer: 1_000_000, encoding: "utf8" });
const config = JSON.parse(String(inspectOutput)) as {
  User?: string;
  Entrypoint?: string[];
  Env?: string[];
};
assert.equal(config.User, "node");
assert.deepEqual(config.Entrypoint, [entrypoint, endpoint, "--transport", "http-only", "--silent"]);
assert.equal((config.Env || []).some((value) => /secret|token|private[_-]?key|api[_-]?key/i.test(value)), false);

const { stdout: runtimeOutput } = await execFileAsync("docker", [
  "run", "--rm", "--entrypoint", "sh", image, "-lc",
  "test \"$(id -u)\" = 1000 && npm ls --omit=dev --depth=0 --json",
], { timeout: 30_000, maxBuffer: 2_000_000, encoding: "utf8" });
const runtime = JSON.parse(String(runtimeOutput)) as { dependencies?: Record<string, { version?: string }> };
assert.equal(runtime.dependencies?.["mcp-remote"]?.version, "0.1.38");

const transport = new StdioClientTransport({
  command: "docker",
  args: [
    "run", "--rm", "-i", "--entrypoint", entrypoint, image,
    endpoint,
    "--transport", "http-only", "--silent",
    "--header", "User-Agent:bountyverdict-owner-audit/1.0",
  ],
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
const client = new Client({ name: "bountyverdict-owner-audit", version: "1.0.0" });
const timeout = setTimeout(() => void transport.close(), 30_000);
try {
  await client.connect(transport);
  const result = await client.listTools();
  const names = result.tools.map(({ name }) => name).sort();
  assert.deepEqual(names, expectedTools);
  for (const tool of result.tools) {
    assert.equal(typeof tool.description, "string");
    assert.match(
      tool.description || "",
      expectedTaskOpeners[tool.name as keyof typeof expectedTaskOpeners],
    );
    assert.doesNotMatch(tool.description || "", /\bx402\b|\bUSDC\b|payment quote|authorized signed retry|https?:\/\//i);
  }
} catch (error) {
  if (stderr) console.error(stderr.slice(0, 4_000));
  throw error;
} finally {
  clearTimeout(timeout);
  await client.close();
}

console.log(JSON.stringify({
  ok: true,
  image,
  user: config.User,
  dependency: "mcp-remote@0.1.38",
  tool_count: expectedTools.length,
  tools: expectedTools,
}, null, 2));
