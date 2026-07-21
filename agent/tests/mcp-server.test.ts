import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/index.ts";
import { classifyMcpClientFamily, MCP_DISTRIBUTED_TOOL_NAMES } from "../src/mcp-server.ts";
import { mcpDriftExampleInput } from "../src/mcp-drift-discovery.ts";

const origin = "https://bountyverdict.example";
const payTo = "0x1111111111111111111111111111111111111111";
const env = {
  PAY_TO_ADDRESS: payTo,
  X402_NETWORK: "eip155:84532",
  X402_FACILITATOR_URL: "https://facilitator.invalid",
  FLAKE_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const headers = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "MCP-Protocol-Version": "2025-11-25",
  "User-Agent": "bountyverdict-owner-audit/1.0",
};

async function rpc(id: number, method: string, params: Record<string, unknown> = {}, requestHeaders = headers) {
  return app.request(`${origin}/mcp`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }, env);
}

async function rpcBody(id: number, method: string, params: Record<string, unknown> = {}) {
  const response = await rpc(id, method, params);
  assert.equal(response.status, 200);
  return response.json() as Promise<any>;
}

test("MCP initializes as a stateless 2025-11-25 server", async () => {
  const body = await rpcBody(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  });
  assert.equal(body.result.protocolVersion, "2025-11-25");
  assert.equal(body.result.serverInfo.name, "BountyVerdict");
  assert.equal(body.result.serverInfo.version, "1.0.1");
  assert.deepEqual(body.result.capabilities, { tools: { listChanged: true } });
  assert.match(body.result.instructions, /one bounty -> check_github_bounty/);
  assert.match(body.result.instructions, /retry once versus fix.*classify_github_actions_flake/);
  assert.match(body.result.instructions, /Payment identifies the fixed-price tool, not its arguments/);
});

test("MCP tools/list exposes exactly six executable paid tools and excludes SkillVerdict", async () => {
  const body = await rpcBody(2, "tools/list");
  assert.deepEqual(body.result.tools.map((tool: any) => tool.name), MCP_DISTRIBUTED_TOOL_NAMES);
  assert.equal(body.result.tools.length, 6);
  assert.equal(body.result.tools.some((tool: any) => /skillverdict/i.test(`${tool.name} ${tool.title} ${tool.description}`)), false);
  for (const tool of body.result.tools) {
    assert.match(tool.description, /Costs \$0\.\d+ USDC on Base via x402/);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    assert.equal(tool.inputSchema.type, "object");
  }
  const drift = body.result.tools.find((tool: any) => tool.name === "check_mcp_tool_drift");
  assert.deepEqual(drift.inputSchema.required, ["contract_version", "subject", "annotation_source_trust", "baseline", "current"]);
  assert.equal(drift.inputSchema.additionalProperties, false);
  assert.equal(drift.inputSchema.properties.baseline.properties.protocol_version.const, "2025-11-25");
  assert.equal(drift.inputSchema.properties.baseline.properties.complete.const, true);
  assert.equal(drift.inputSchema.properties.baseline.properties.tools.maxItems, 128);
  assert.deepEqual(drift.inputSchema.properties.baseline.properties.tools.items.required, ["name", "inputSchema"]);
  const single = body.result.tools.find((tool: any) => tool.name === "check_github_bounty");
  assert.match(single.inputSchema.properties.issue_url.pattern, /github/);
  assert.match(single.inputSchema.properties.issue_url.description, /Canonical public GitHub issue URL/);
  const portfolio = body.result.tools.find((tool: any) => tool.name === "rank_github_bounties");
  assert.equal(portfolio.inputSchema.properties.issue_urls.minItems, 2);
  assert.equal(portfolio.inputSchema.properties.issue_urls.maxItems, 10);
  assert.match(portfolio.inputSchema.properties.issue_urls.description, /distinct/);
  const run = body.result.tools.find((tool: any) => tool.name === "diagnose_github_actions_run");
  const flake = body.result.tools.find((tool: any) => tool.name === "classify_github_actions_flake");
  assert.match(run.description, /root cause/);
  assert.match(run.description, /classify_github_actions_flake/);
  assert.match(flake.description, /retried once or fixed/);
  assert.match(flake.description, /diagnose_github_actions_run/);
});

test("MCP rejects invalid semantic input before producing payment requirements", async () => {
  const body = await rpcBody(3, "tools/call", {
    name: "check_github_bounty",
    arguments: { issue_url: "not-a-github-issue" },
  });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /validation error/i);
  assert.equal(body.result.structuredContent, undefined);
  assert.doesNotMatch(body.result.content[0].text, /accepts|payment/i);
});

test("MCP client identity is reduced to a privacy-safe allowlisted family", () => {
  const initialize = (name?: string) => ({ method: "initialize", params: { clientInfo: name === undefined ? {} : { name, version: "private-build-123" } } });
  assert.equal(classifyMcpClientFamily(initialize("Claude Desktop nightly")), "claude");
  assert.equal(classifyMcpClientFamily(initialize("Codex CLI")), "codex");
  assert.equal(classifyMcpClientFamily(initialize("unknown-private-client")), "other_declared");
  assert.equal(classifyMcpClientFamily(initialize()), "missing");
  assert.equal(classifyMcpClientFamily({ method: "tools/list" }), "not_applicable");
  assert.equal(classifyMcpClientFamily(initialize("Codex CLI"), true), "owner_automation");
});

test("MCP rejects schema-invalid and unknown tool calls before payment", async () => {
  const missing = await rpcBody(4, "tools/call", { name: "check_github_bounty", arguments: {} });
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /validation error/i);
  const unknown = await rpcBody(5, "tools/call", { name: "invented_tool", arguments: {} });
  assert.equal(unknown.result.isError, true);
  assert.match(unknown.result.content[0].text, /not found/i);
});

const challengeCases = [
  ["check_github_bounty", { issue_url: "https://github.com/owner/repo/issues/1" }, "50000"],
  ["rank_github_bounties", { issue_urls: ["https://github.com/owner/repo/issues/1", "https://github.com/owner/repo/issues/2"] }, "400000"],
  ["audit_agent_harness", { repo_url: "https://github.com/owner/repo" }, "30000"],
  ["diagnose_github_actions_run", { run_url: "https://github.com/owner/repo/actions/runs/1" }, "40000"],
  ["classify_github_actions_flake", { run_url: "https://github.com/owner/repo/actions/runs/1", attempt: 1 }, "70000"],
  ["check_mcp_tool_drift", mcpDriftExampleInput, "20000"],
] as const;

for (const [name, args, amount] of challengeCases) {
  test(`${name} returns an exact spec-shaped unpaid MCP payment challenge`, async () => {
    const body = await rpcBody(10, "tools/call", { name, arguments: args });
    assert.equal(body.result.isError, true);
    assert.deepEqual(JSON.parse(body.result.content[0].text), body.result.structuredContent);
    const challenge = body.result.structuredContent;
    assert.equal(challenge.x402Version, 2);
    assert.equal(challenge.resource.url, `mcp://tool/${name}`);
    assert.match(challenge.resource.description, /Advisory normalized arguments hash sha256:[a-f0-9]{64}/);
    assert.match(challenge.resource.description, /does not cryptographically bind arguments/);
    assert.equal(challenge.accepts.length, 1);
    assert.equal(challenge.accepts[0].amount, amount);
    assert.equal(challenge.accepts[0].network, "eip155:84532");
    assert.equal(challenge.accepts[0].payTo, payTo);
    assert.equal(challenge.extensions.bazaar.info.input.type, "mcp");
    assert.equal(challenge.extensions.bazaar.info.input.toolName, name);
    assert.equal(challenge.extensions.bazaar.info.input.transport, "streamable-http");
  });
}

test("MCP advisory argument hash changes when normalized arguments change", async () => {
  const first = await rpcBody(20, "tools/call", { name: "check_github_bounty", arguments: { issue_url: "https://github.com/owner/repo/issues/1" } });
  const second = await rpcBody(21, "tools/call", { name: "check_github_bounty", arguments: { issue_url: "https://github.com/owner/repo/issues/2" } });
  const hash = (body: any) => body.result.structuredContent.resource.description.match(/sha256:[a-f0-9]{64}/)?.[0];
  assert.ok(hash(first));
  assert.ok(hash(second));
  assert.notEqual(hash(first), hash(second));
});

test("MCP validates Origin and body size before constructing a server", async () => {
  const foreign = await rpc(30, "tools/list", {}, { ...headers, Origin: "https://evil.example" });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json() as any).error.message, "Forbidden Origin");

  const oversized = await app.request(`${origin}/mcp`, {
    method: "POST",
    headers: { ...headers, "Content-Length": "999999" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 31, method: "tools/list", params: {} }),
  }, env);
  assert.equal(oversized.status, 413);

  const preflight = await app.request(`${origin}/mcp`, {
    method: "OPTIONS",
    headers: { Origin: "https://playground.ai.cloudflare.com" },
  }, env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://playground.ai.cloudflare.com");
  assert.match(preflight.headers.get("Access-Control-Allow-Headers") || "", /MCP-Protocol-Version/);

  const browser = await rpc(31, "tools/list", {}, { ...headers, Origin: "https://playground.ai.cloudflare.com" });
  assert.equal(browser.status, 200);
  assert.equal(browser.headers.get("Access-Control-Allow-Origin"), "https://playground.ai.cloudflare.com");
});

test("MCP enforces Streamable HTTP negotiation before recording a valid interaction", async () => {
  const notification = await app.request(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }, env);
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), "");
  assert.equal(notification.headers.get("MCP-Protocol-Version"), "2025-11-25");

  const wrongContentType = await rpc(32, "tools/list", {}, { ...headers, "Content-Type": "text/plain" });
  assert.equal(wrongContentType.status, 415);
  const incompleteAccept = await rpc(33, "tools/list", {}, { ...headers, Accept: "application/json" });
  assert.equal(incompleteAccept.status, 406);
  const wrongProtocol = await rpc(34, "tools/list", {}, { ...headers, "MCP-Protocol-Version": "2024-11-05" });
  assert.equal(wrongProtocol.status, 400);
  const put = await app.request(`${origin}/mcp`, { method: "PUT", headers, body: "{}" }, env);
  assert.equal(put.status, 405);
});

test("stateless MCP declines standalone GET and DELETE streams", async () => {
  for (const method of ["GET", "DELETE"]) {
    const response = await app.request(`${origin}/mcp`, {
      method,
      headers: { Accept: "text/event-stream", "User-Agent": "bountyverdict-owner-audit/1.0" },
    }, env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.has("mcp-session-id"), false);
  }
});

test("unpaid MCP challenges never fetch facilitator /supported", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("unexpected facilitator request"); }) as typeof fetch;
  try {
    const body = await rpcBody(40, "tools/call", { name: "check_github_bounty", arguments: { issue_url: "https://github.com/owner/repo/issues/40" } });
    assert.equal(body.result.structuredContent.accepts[0].amount, "50000");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
