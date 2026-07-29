import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const image = process.env.GLAMA_RELEASE_IMAGE || "bountyverdict-glama-verify:local";
const endpoint = "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=glama-release";
const entrypoint = "./node_modules/.bin/mcp-remote";
const expectedPaidTools = Object.freeze([
  "audit_agent_harness",
  "check_github_bounty",
  "check_mcp_tool_drift",
  "classify_github_actions_flake",
  "diagnose_github_actions_run",
  "rank_github_bounties",
]);
const expectedTools = Object.freeze([
  ...(process.env.GLAMA_EXPECT_FREE_SELECTOR === "NO" ? [] : ["choose_github_agent_decision"]),
  ...expectedPaidTools,
]);
const expectedTaskOpeners = Object.freeze({
  // The release image bridges the currently deployed remote. During the
  // v1.1.12 -> v1.1.13 rollout, either exact reviewed selector description is
  // valid; Worker contract tests independently pin the v1.1.13 catalog copy.
  choose_github_agent_decision: /^(?:Call with no arguments for a free six-tool catalog|Choose the economical next call)/,
  check_github_bounty: /^Is this public GitHub issue bounty still claimable/,
  rank_github_bounties: /^Which public GitHub bounty should I work on next/,
  audit_agent_harness: /^Can a coding agent safely work in this public repository/,
  diagnose_github_actions_run: /^Why did this public GitHub Actions run fail/,
  classify_github_actions_flake: /^Is this failed GitHub Actions run flaky/,
  check_mcp_tool_drift: /^Will upgrading to this complete MCP tools\/list break my agent/,
} as const);
const expectedPaidProof = Object.freeze({
  check_github_bounty: ["/api/sample", "0.05"],
  rank_github_bounties: ["/api/portfolio/sample", "0.40"],
  audit_agent_harness: ["/api/harness/sample", "0.03"],
  diagnose_github_actions_run: ["/api/run/sample", "0.04"],
  classify_github_actions_flake: ["/api/flake/sample", "0.07"],
  check_mcp_tool_drift: ["/api/mcp-drift/sample", "0.02"],
} as const);
const expectPaidProof = process.env.GLAMA_EXPECT_PAID_PROOF === "YES";
const versionOverride = process.env.CLOUDFLARE_WORKER_VERSION_OVERRIDE?.trim();
if (versionOverride) {
  assert.match(versionOverride, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
}
const remoteHeaders = Object.freeze([
  "--header",
  "User-Agent:bountyverdict-owner-audit/1.0",
  ...(versionOverride
    ? [
        "--header",
        `Cloudflare-Workers-Version-Overrides:bountyverdict-agent-production="${versionOverride}"`,
      ]
    : []),
]);

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
    ...remoteHeaders,
  ],
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
const client = new Client({ name: "bountyverdict-owner-audit", version: "1.0.0" });
const timeout = setTimeout(() => void transport.close(), 60_000);
try {
  await client.connect(transport);
  const expectedNames = [...expectedTools].sort();
  let result = await client.listTools();
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const names = result.tools.map(({ name }) => name).sort();
    if (JSON.stringify(names) === JSON.stringify(expectedNames)) break;
    if (attempt === 30) assert.deepEqual(names, expectedNames);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    result = await client.listTools();
  }
  const names = result.tools.map(({ name }) => name).sort();
  assert.deepEqual(names, [...expectedTools].sort());
  for (const tool of result.tools) {
    assert.equal(typeof tool.description, "string");
    assert.match(
      tool.description || "",
      expectedTaskOpeners[tool.name as keyof typeof expectedTaskOpeners],
    );
    assert.doesNotMatch(tool.description || "", /\bx402\b|payment quote|authorized signed retry/i);
    if (expectPaidProof && tool.name !== "choose_github_agent_decision") {
      const description = tool.description || "";
      const [samplePath, price] = expectedPaidProof[tool.name as keyof typeof expectedPaidProof];
      assert.match(description, /Inspect a representative result before paying:/);
      assert.match(
        description,
        new RegExp(`https://bountyverdict-agent-production\\.mimirslab\\.workers\\.dev${samplePath.replaceAll("/", "\\/")}`),
      );
      assert.match(description, new RegExp(`Exact authorization cap: ${price.replace(".", "\\.")} USDC\\.$`));
    }
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
