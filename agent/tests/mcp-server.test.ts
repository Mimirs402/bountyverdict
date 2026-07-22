import assert from "node:assert/strict";
import test from "node:test";
import { x402Client } from "@x402/core/client";
import { x402MCPClient } from "@x402/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import app from "../src/index.ts";
import { classifyMcpClientFamily, MCP_DISTRIBUTED_TOOL_NAMES } from "../src/mcp-server.ts";
import { mcpDriftExampleInput } from "../src/mcp-drift-discovery.ts";
import {
  LEGACY_MCP_HTTP_PAYMENT_HANDOFF_EXTENSION,
  MCP_HTTP_PAYMENT_HANDOFF_EXTENSION,
} from "../src/payment-handoff.ts";
import { PRODUCT_CATALOG } from "../src/product-catalog.ts";
import { PRODUCT_SELECTION_PREVIEWS } from "../src/selection-preview.ts";

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
  assert.equal(body.result.serverInfo.version, "1.1.10");
  assert.equal(
    body.result.serverInfo.description,
    "Diagnose failed GitHub Actions with cited evidence; decide retry versus fix, check GitHub bounties, audit agent instructions, and gate breaking MCP tool updates.",
  );
  assert.deepEqual(body.result.capabilities, { tools: { listChanged: true } });
  assert.match(body.result.instructions, /one bounty -> check_github_bounty/);
  assert.match(body.result.instructions, /retry once versus fix.*classify_github_actions_flake/);
  assert.match(body.result.instructions, /first unsigned call with real canonical input cannot charge/i);
  assert.match(body.result.instructions, /free payment quote, selection summary, and payment handoff/i);
  assert.match(body.result.instructions, /Never call with missing, invented, or placeholder arguments/);
  assert.match(body.result.instructions, /Payment identifies the fixed-price tool, not its arguments/);
});

test("MCP tools/list exposes exactly six executable paid tools and excludes SkillVerdict", async () => {
  const body = await rpcBody(2, "tools/list");
  const taskLeadingDescriptions = {
    check_github_bounty: /^Is this public GitHub issue bounty still claimable/,
    rank_github_bounties: /^Which public GitHub bounty should I work on next/,
    audit_agent_harness: /^Can a coding agent safely work in this public repository/,
    diagnose_github_actions_run: /^Why did this public GitHub Actions run fail/,
    classify_github_actions_flake: /^Is this failed GitHub Actions run flaky/,
    check_mcp_tool_drift: /^Will upgrading to this complete MCP tools\/list break my agent/,
  } as const;
  assert.deepEqual(body.result.tools.map((tool: any) => tool.name), MCP_DISTRIBUTED_TOOL_NAMES);
  assert.equal(body.result.tools.length, 6);
  assert.equal(body.result.tools.some((tool: any) => /skillverdict/i.test(`${tool.name} ${tool.title} ${tool.description}`)), false);
  for (const tool of body.result.tools) {
    assert.match(tool.description, taskLeadingDescriptions[tool.name as keyof typeof taskLeadingDescriptions]);
    assert.doesNotMatch(tool.description, /\bx402\b|\bUSDC\b|payment quote|authorized signed retry/i);
    assert.doesNotMatch(tool.description, /https?:\/\//i);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: tool.name !== "check_mcp_tool_drift",
    });
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.outputSchema.type, "object");
    assert.ok(Array.isArray(tool.outputSchema.required));
    assert.equal(tool.outputSchema.additionalProperties, true);
    assert.ok(Buffer.byteLength(tool.description) <= 1_500, `${tool.name} description exceeds the tools/list context budget`);
  }
  assert.ok(body.result.tools.reduce((total: number, tool: any) => total + Buffer.byteLength(tool.description), 0) < 4_000);
  const drift = body.result.tools.find((tool: any) => tool.name === "check_mcp_tool_drift");
  assert.deepEqual(drift.inputSchema.required, ["contract_version", "subject", "annotation_source_trust", "baseline", "current"]);
  assert.equal(drift.inputSchema.additionalProperties, false);
  assert.equal(drift.inputSchema.properties.baseline.properties.protocol_version.const, "2025-11-25");
  assert.equal(drift.inputSchema.properties.baseline.properties.complete.const, true);
  assert.equal(drift.inputSchema.properties.baseline.properties.tools.maxItems, 128);
  assert.deepEqual(drift.inputSchema.properties.baseline.properties.tools.items.required, ["name", "inputSchema"]);
  assert.match(drift.description, /never fetches or invokes tools/i);
  const single = body.result.tools.find((tool: any) => tool.name === "check_github_bounty");
  assert.match(single.description, /^Is this public GitHub issue bounty still claimable/);
  assert.match(single.inputSchema.properties.issue_url.pattern, /github/);
  assert.match(single.inputSchema.properties.issue_url.description, /Canonical public GitHub issue URL/);
  const portfolio = body.result.tools.find((tool: any) => tool.name === "rank_github_bounties");
  assert.match(portfolio.description, /^Which public GitHub bounty should I work on next/);
  assert.match(portfolio.description, /strongest non-AVOID candidate or recommends none/);
  assert.equal(portfolio.inputSchema.properties.issue_urls.minItems, 2);
  assert.equal(portfolio.inputSchema.properties.issue_urls.maxItems, 10);
  assert.match(portfolio.inputSchema.properties.issue_urls.description, /distinct/);
  const run = body.result.tools.find((tool: any) => tool.name === "diagnose_github_actions_run");
  const flake = body.result.tools.find((tool: any) => tool.name === "classify_github_actions_flake");
  const harness = body.result.tools.find((tool: any) => tool.name === "audit_agent_harness");
  assert.match(harness.description, /^Can a coding agent safely work in this public repository/);
  assert.match(drift.description, /^Will upgrading to this complete MCP tools\/list break my agent/);
  assert.match(drift.description, /caller-supplied baseline and current snapshots/);
  assert.match(run.description, /^Why did this public GitHub Actions run fail/);
  assert.match(flake.description, /^Is this failed GitHub Actions run flaky/);
  assert.match(run.description, /what should I fix/);
  assert.match(run.description, /classify_github_actions_flake/);
  assert.match(flake.description, /retry it once or fix the code/);
  assert.match(flake.description, /diagnose_github_actions_run/);

  assert.deepEqual(single.outputSchema.properties.verdict.enum, ["AVOID", "CAUTION", "VIABLE"]);
  assert.ok(single.outputSchema.required.includes("service_reuse"));
  assert.ok(portfolio.outputSchema.required.includes("best_candidate"));
  assert.ok(run.outputSchema.required.includes("diagnosis"));
  assert.ok(flake.outputSchema.required.includes("decision"));
  assert.ok(drift.outputSchema.required.includes("action"));
});

test("MCP success contracts stay within the catalog context budget", async () => {
  const tools = (await rpcBody(2, "tools/list")).result.tools;
  const sizes = tools.map((tool: any) => ({
    name: tool.name,
    bytes: Buffer.byteLength(JSON.stringify(tool.outputSchema)),
  }));
  for (const { name, bytes } of sizes) assert.ok(bytes <= 2_048, `${name} output schema is ${bytes} bytes`);
  assert.ok(sizes.reduce((total: number, item: { bytes: number }) => total + item.bytes, 0) <= 12_000);
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
  assert.equal(unknown.result, undefined);
  assert.equal(unknown.error.code, -32602);
  assert.match(unknown.error.message, /tool not found/i);
  assert.match(unknown.error.message, /no payment was attempted/i);
  assert.match(unknown.error.message, /refresh tools\/list/i);
  assert.equal(unknown.error.data.recovery, "refresh_tools_list");
  assert.deepEqual(unknown.error.data.advertised_tools.map(({ name }: { name: string }) => name), MCP_DISTRIBUTED_TOOL_NAMES);
  for (const { name, task } of unknown.error.data.advertised_tools) {
    assert.equal(typeof task, "string");
    assert.ok(task.length > 0, `${name} is missing task routing`);
  }
  assert.doesNotMatch(JSON.stringify(unknown), /invented_tool/);
  assert.doesNotMatch(JSON.stringify(unknown), /x402|accepts|payment handoff/i);
});

test("unknown-tool recovery does not bypass MCP request validation", async () => {
  const malformedBodies = [
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "invented_tool", arguments: [] } },
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "invented_tool", arguments: "private-argument" } },
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "invented_tool", task: "bad" } },
    { jsonrpc: "2.0", id: 9.5, method: "tools/call", params: { name: "invented_tool", arguments: {} } },
    { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "invented_tool", arguments: {}, _meta: "private-meta" } },
    { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "invented_tool", arguments: {} }, privateExtra: "discard-me" },
  ];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  try {
    for (const body of malformedBodies) {
      const response = await app.request(`${origin}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }, env);
      const value = await response.json() as any;
      assert.equal(value.result, undefined);
      assert.equal(typeof value.error?.code, "number");
      assert.notEqual(value.error.code, -32602);
      assert.equal(value.error.data?.recovery, undefined);
      assert.doesNotMatch(JSON.stringify(value), /advertised_tools|refresh_tools_list|private-argument|private-meta|discard-me/);
    }
  } finally {
    console.log = originalLog;
  }
  const events = logs.flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((event) => event.type === "bountyverdict_mcp_funnel");
  assert.equal(events.length, malformedBodies.length);
  assert.equal(events.every((event) => event.stage === "protocol_error"), true);
  assert.equal(events.some((event) => event.stage === "tool_not_found"), false);
});

test("unknown-tool recovery records one privacy-safe event without echoing the requested name", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  try {
    await rpcBody(6, "tools/call", { name: "private_invented_name", arguments: { private_value: "discard-me" } });
  } finally {
    console.log = originalLog;
  }
  const events = logs.flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((event) => event.type === "bountyverdict_mcp_funnel");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: "bountyverdict_mcp_funnel",
    schema_version: 3,
    stage: "tool_not_found",
    product: null,
    source: "owner_automation",
    client_family: "not_applicable",
    validation_kind: "not_applicable",
  });
  assert.doesNotMatch(JSON.stringify(events), /private_invented_name|discard-me/);
});

test("MCP records valid signed FlakeVerdict capacity rejection separately from invalid input", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  try {
    const response = await app.request(`${origin}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "classify_github_actions_flake",
          arguments: { run_url: "https://github.com/owner/repo/actions/runs/1", attempt: 1 },
          _meta: { "x402/payment": { payload: "synthetic-test-only" } },
        },
      }),
    }, { ...env, FLAKE_RATE_LIMITER: { limit: async () => ({ success: false }) } });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /FLAKE_RATE_LIMITED/);
  } finally {
    console.log = originalLog;
  }
  const events = logs.flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((event) => event.type === "bountyverdict_mcp_funnel");
  assert.equal(events.some((event) => event.stage === "payment_present" && event.product === "flake"), true);
  assert.equal(events.some((event) => event.stage === "capacity_rejected" && event.product === "flake" && event.validation_kind === "not_applicable"), true);
  assert.equal(events.some((event) => event.stage === "validation_error"), false);
});

const challengeCases = [
  ["check_github_bounty", { issue_url: "https://github.com/owner/repo/issues/1" }, "50000"],
  ["rank_github_bounties", { issue_urls: ["https://github.com/owner/repo/issues/1", "https://github.com/owner/repo/issues/2"] }, "400000"],
  ["audit_agent_harness", { repo_url: "https://github.com/owner/repo" }, "30000"],
  ["diagnose_github_actions_run", { run_url: "https://github.com/owner/repo/actions/runs/1" }, "40000"],
  ["classify_github_actions_flake", { run_url: "https://github.com/owner/repo/actions/runs/1", attempt: 1 }, "70000"],
  ["check_mcp_tool_drift", mcpDriftExampleInput, "20000"],
] as const;

const challengeProducts = {
  check_github_bounty: "single",
  rank_github_bounties: "portfolio",
  audit_agent_harness: "harness",
  diagnose_github_actions_run: "run",
  classify_github_actions_flake: "flake",
  check_mcp_tool_drift: "mcpdrift",
} as const;

for (const [name, args, amount] of challengeCases) {
  test(`${name} returns an exact spec-shaped unpaid MCP payment challenge`, async () => {
    const body = await rpcBody(10, "tools/call", { name, arguments: args });
    assert.equal(body.result.isError, true);
    assert.equal(body.result.structuredContent, undefined);
    const challenge = JSON.parse(body.result.content[0].text);
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
    const handoff = challenge.extensions[MCP_HTTP_PAYMENT_HANDOFF_EXTENSION];
    assert.deepEqual(challenge.extensions[LEGACY_MCP_HTTP_PAYMENT_HANDOFF_EXTENSION], handoff);
    assert.equal(handoff.info.version, "1");
    assert.equal(handoff.info.direct_mcp.automatic_payment_requires, "@x402/mcp");
    assert.equal(handoff.info.direct_mcp.payment_meta_key, "x402/payment");
    assert.equal(handoff.info.wallet_mcp.capability, "make_x402_request");
    assert.equal(handoff.info.wallet_mcp.use_exact_request, true);
    const expectedPreview = PRODUCT_SELECTION_PREVIEWS[challengeProducts[name]];
    assert.equal(handoff.info.selection_preview.product, expectedPreview.product);
    assert.equal(handoff.info.selection_preview.price, PRODUCT_CATALOG[challengeProducts[name]].priceUsd);
    assert.equal(handoff.info.selection_preview.currency, "USDC");
    assert.equal(handoff.info.selection_preview.use_when, expectedPreview.useWhen);
    assert.equal(handoff.info.selection_preview.not_for, expectedPreview.notFor);
    assert.deepEqual(handoff.info.selection_preview.decision_returned, expectedPreview.decisionReturned);
    assert.equal(handoff.info.selection_preview.why_pay, expectedPreview.whyPay);
    assert.equal(handoff.info.selection_preview.free_sample, `${origin}${expectedPreview.samplePath}`);
    assert.equal(handoff.info.selection_preview.unsigned_call_can_charge, false);
    assert.equal(JSON.stringify(handoff.info.selection_preview).includes("owner/repo"), false);
    assert.equal(handoff.info.payment.max_amount_atomic, amount);
    assert.equal(handoff.info.payment.agentic_wallet.executable, "npx");
    assert.equal(handoff.info.payment.agentic_wallet.execute_as_argument_vector, true);
    assert.equal(handoff.info.payment.agentic_wallet.do_not_join_into_shell_string, true);
    assert.deepEqual(handoff.info.payment.agentic_wallet.argv.slice(-3), ["--max-amount", amount, "--json"]);
    assert.equal(handoff.schema.properties.version.const, "1");
    assert.equal(handoff.schema.properties.selection_preview.properties.unsigned_call_can_charge.const, false);
    assert.ok(handoff.schema.required.includes("selection_preview"));
  });
}

test("all MCP payment handoffs exactly match the equivalent protected REST challenge", async () => {
  for (const [name, args] of challengeCases) {
    const call = await rpcBody(14, "tools/call", { name, arguments: args });
    const challenge = JSON.parse(call.result.content[0].text);
    const payment = challenge.extensions[MCP_HTTP_PAYMENT_HANDOFF_EXTENSION].info.payment;
    const exact = payment.exact_request;
    const response = await app.request(exact.url, {
      method: exact.method,
      headers: exact.method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: exact.method === "POST" ? JSON.stringify(exact.body) : undefined,
    }, env);
    assert.equal(response.status, 402, name);
    const rest = await response.json() as any;
    assert.deepEqual(rest.payment, payment, name);
    if (exact.method === "POST") {
      assert.match(exact.normalized_body_sha256, /^sha256:[a-f0-9]{64}$/);
      assert.match(payment.request_binding, /authorizes the resource URL, not the POST body/);
      assert.ok(payment.agentic_wallet.argv.includes(JSON.stringify(exact.body)));
    } else {
      assert.equal(exact.body, undefined);
      assert.equal(exact.normalized_body_sha256, undefined);
      assert.match(exact.url, /^https:\/\/bountyverdict\.example\/api\//);
    }
  }
});

test("Bazaar payment discovery preserves the live MCP input boundaries", async () => {
  const listed = (await rpcBody(11, "tools/list")).result.tools;
  for (const [name, args] of challengeCases) {
    const call = await rpcBody(12, "tools/call", { name, arguments: args });
    const challenge = JSON.parse(call.result.content[0].text);
    const bazaar = challenge.extensions.bazaar.info.input.inputSchema;
    const live = listed.find((tool: any) => tool.name === name).inputSchema;
    assert.deepEqual(bazaar.required, live.required, `${name} required fields drifted`);
    assert.equal(bazaar.additionalProperties, false);

    if (name === "check_github_bounty") {
      assert.equal(bazaar.properties.issue_url.pattern, live.properties.issue_url.pattern);
      assert.equal(bazaar.properties.issue_url.description, live.properties.issue_url.description);
    } else if (name === "rank_github_bounties") {
      assert.equal(bazaar.properties.issue_urls.minItems, live.properties.issue_urls.minItems);
      assert.equal(bazaar.properties.issue_urls.maxItems, live.properties.issue_urls.maxItems);
      assert.equal(bazaar.properties.issue_urls.uniqueItems, true);
      assert.equal(bazaar.properties.issue_urls.items.pattern, live.properties.issue_urls.items.pattern);
      assert.equal(bazaar.properties.issue_urls.description, live.properties.issue_urls.description);
    } else if (name === "audit_agent_harness") {
      assert.equal(bazaar.properties.repo_url.pattern, live.properties.repo_url.pattern);
      assert.equal(bazaar.properties.repo_url.description, live.properties.repo_url.description);
    } else if (name === "diagnose_github_actions_run") {
      assert.equal(bazaar.properties.run_url.pattern, live.properties.run_url.pattern);
      assert.equal(bazaar.properties.run_url.description, live.properties.run_url.description);
    } else if (name === "classify_github_actions_flake") {
      assert.equal(bazaar.properties.run_url.pattern, live.properties.run_url.pattern);
      assert.equal(bazaar.properties.attempt.minimum, 1);
      assert.equal(live.properties.attempt.exclusiveMinimum, 0);
      assert.equal(bazaar.properties.attempt.description, live.properties.attempt.description);
    } else {
      assert.equal(bazaar.properties.contract_version.const, live.properties.contract_version.const);
      assert.equal(bazaar.properties.baseline.properties.tools.maxItems, live.properties.baseline.properties.tools.maxItems);
    }
  }
});

test("all six MCP tools reject representative boundary violations before payment", async () => {
  const invalidCases = [
    ["check_github_bounty", { issue_url: "https://github.com/owner/repo/issues/1?tab=comments" }],
    ["rank_github_bounties", { issue_urls: ["https://github.com/owner/repo/issues/1", "https://github.com/owner/repo/issues/1"] }],
    ["audit_agent_harness", { repo_url: "https://github.com/owner/repo/tree/main" }],
    ["diagnose_github_actions_run", { run_url: "https://github.com/owner/repo/actions/runs/1/job/2" }],
    ["classify_github_actions_flake", { run_url: "https://github.com/owner/repo/actions/runs/1", attempt: 0 }],
    ["check_mcp_tool_drift", { ...mcpDriftExampleInput, contract_version: "mcp-drift/2" }],
  ] as const;
  for (const [name, args] of invalidCases) {
    const body = await rpcBody(13, "tools/call", { name, arguments: args });
    assert.equal(body.result.isError, true, name);
    assert.equal(body.result.structuredContent, undefined, name);
    assert.doesNotMatch(body.result.content[0].text, /"accepts"|"x402Version"/, name);
    assert.doesNotMatch(body.result.content[0].text, /http-payment-handoff|agentic_wallet/, name);
  }
});

test("official MCP and x402 clients can read an unpaid challenge after output discovery", async () => {
  const client = new Client({ name: "bountyverdict-owner-audit-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { "User-Agent": "bountyverdict-owner-audit/1.0" } },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const forwardedHeaders = new Headers(request.headers);
      forwardedHeaders.set("User-Agent", "bountyverdict-owner-audit/1.0");
      return app.fetch(new Request(request, { headers: forwardedHeaders }), env);
    },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.every((tool) => tool.outputSchema?.type === "object"), true);

    const paidClient = new x402MCPClient(client, new x402Client(), { autoPayment: false });
    const challenge = await paidClient.getToolPaymentRequirements("check_github_bounty", {
      issue_url: "https://github.com/owner/repo/issues/1",
    });
    assert.equal(challenge?.x402Version, 2);
    assert.equal(challenge?.accepts[0]?.amount, "50000");
    assert.equal(
      (challenge?.extensions?.[MCP_HTTP_PAYMENT_HANDOFF_EXTENSION] as any)?.info?.payment?.max_amount_atomic,
      "50000",
    );
  } finally {
    await client.close();
  }
});

test("MCP advisory argument hash changes when normalized arguments change", async () => {
  const first = await rpcBody(20, "tools/call", { name: "check_github_bounty", arguments: { issue_url: "https://github.com/owner/repo/issues/1" } });
  const second = await rpcBody(21, "tools/call", { name: "check_github_bounty", arguments: { issue_url: "https://github.com/owner/repo/issues/2" } });
  const hash = (body: any) => JSON.parse(body.result.content[0].text).resource.description.match(/sha256:[a-f0-9]{64}/)?.[0];
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

test("MCP accepts every SDK-supported negotiated protocol and rejects an unknown one", async () => {
  const compatibleHeaders = { ...headers, "MCP-Protocol-Version": "2025-06-18" };
  const initialized = await rpc(29, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "compatibility-client", version: "1.0.0" },
  }, compatibleHeaders);
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json() as any).result.protocolVersion, "2025-06-18");
  assert.equal(initialized.headers.get("MCP-Protocol-Version"), null);

  const notification = await app.request(`${origin}/mcp`, {
    method: "POST",
    headers: compatibleHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }, env);
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), "");
  assert.equal(notification.headers.get("MCP-Protocol-Version"), null);

  const listed = await rpc(30, "tools/list", {}, compatibleHeaders);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json() as any).result.tools.length, 6);

  const wrongContentType = await rpc(32, "tools/list", {}, { ...headers, "Content-Type": "text/plain" });
  assert.equal(wrongContentType.status, 415);
  const incompleteAccept = await rpc(33, "tools/list", {}, { ...headers, Accept: "application/json" });
  assert.equal(incompleteAccept.status, 406);
  const wrongProtocol = await rpc(34, "tools/list", {}, { ...headers, "MCP-Protocol-Version": "2099-01-01" });
  assert.equal(wrongProtocol.status, 400);
  assert.match((await wrongProtocol.json() as any).error.message, /Unsupported protocol version/);
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
    assert.equal(body.result.structuredContent, undefined);
    assert.equal(JSON.parse(body.result.content[0].text).accepts[0].amount, "50000");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
