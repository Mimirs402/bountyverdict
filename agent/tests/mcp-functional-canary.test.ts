import assert from "node:assert/strict";
import test from "node:test";
import { probeMcpReleaseIdentity, runMcpContractCanary } from "../src/mcp-functional-canary.ts";
import {
  MCP_HTTP_PAYMENT_HANDOFF_EXTENSION,
  PAYMENT_NEXT_ACTION,
} from "../src/payment-handoff.ts";

const origin = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const workerVersionId = "12345678-1234-1234-1234-123456789abc";
const args = { run_url: "https://github.com/owner/repo/actions/runs/1" };

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-BountyVerdict-Worker-Version": workerVersionId,
      ...headers,
    },
  });
}

function selectorResponse(): Response {
  const route = {
    selector_call_payment_required: false,
    total_price_usdc: "0.04",
    next_call: {
      tool_name: "diagnose_github_actions_run",
      required_fields: ["run_url"],
      payment_required: true,
      authorization_required_before_settlement: true,
      unsigned_call_action: "inspect_quote_then_authorize_or_stop",
      preserve_arguments_on_retry: true,
    },
  };
  return jsonResponse({
    jsonrpc: "2.0",
    id: 901,
    result: {
      content: [{ type: "text", text: JSON.stringify(route) }],
      structuredContent: route,
    },
  });
}

function initializeResponse(version = "1.1.23"): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: 900,
    result: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      serverInfo: { name: "BountyVerdict", version },
    },
  });
}

function handoffResponse(): Response {
  const bodyHash = "308edd07fa01b2765dfb5989941992ca6cbd4e93ee5fdbe4ca0e21236f8d58da";
  const walletMcp = {
    tool_name: "make_http_request_with_x402",
    execution_kind: "equivalent_rest_request",
    arguments: {
      baseURL: origin,
      path: "/api/github-actions-run-diagnosis",
      method: "POST",
      body: args,
      maxAmountPerRequest: 40000,
      preferredNetwork: "base",
    },
  };
  const payment = {
    charge_state: "unsigned_not_charged",
    next_action: PAYMENT_NEXT_ACTION,
    inspect_challenge_before_signing: true,
    max_amount_atomic: "40000",
    exact_request: {
      method: "POST",
      url: `${origin}/api/github-actions-run-diagnosis`,
      body: args,
      normalized_body_sha256: `sha256:${bodyHash}`,
    },
    authorization_scope: "resource_url_not_post_body",
    coinbase_wallet_mcp: walletMcp,
    agentic_wallet: {
      executable: "npx",
      argv: [
        "awal@2.12.0", "x402", "pay", `${origin}/api/github-actions-run-diagnosis`,
        "-X", "POST", "-d", JSON.stringify(args), "--max-amount", "40000", "--json",
      ],
      execute_as_argument_vector: true,
      do_not_join_into_shell_string: true,
    },
    retry_semantics: {
      transport: "rest_http",
      reuse_exact_method_url_and_body: true,
      payment_header: "Payment-Signature",
      expected_success_status: 200,
      never_raise_max_amount_without_new_authorization: true,
    },
  };
  const challenge = {
    accepts: [{ amount: "40000", network: "eip155:8453" }],
    resource: { url: "mcp://tool/diagnose_github_actions_run" },
    extensions: {
      bazaar: { info: { input: { toolName: "diagnose_github_actions_run" } } },
      [MCP_HTTP_PAYMENT_HANDOFF_EXTENSION]: {
        info: {
          version: "2",
          direct_mcp: { automatic_payment_requires: "@x402/mcp" },
          wallet_mcp: walletMcp,
          payment,
        },
      },
    },
  };
  return jsonResponse({
    jsonrpc: "2.0",
    id: 902,
    result: {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify(challenge) },
        { type: "text", text: "PAYMENT REQUIRED: obtain explicit authorization; otherwise stop." },
      ],
    },
  });
}

test("recurring MCP canary proves the free selector and handoff without credentials or payment", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const responses = [initializeResponse(), selectorResponse(), handoffResponse()];
  const report = await runMcpContractCanary(origin, {
    fetch: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return responses.shift()!;
    },
    monotonic: (() => {
      let value = 0;
      return () => value += 5;
    })(),
    workerVersionOverride: workerVersionId,
  });
  assert.equal(report.healthy, true);
  assert.equal(report.server_version, "1.1.23");
  assert.equal(report.worker_version_id, workerVersionId);
  assert.equal(report.payment_or_signing_attempted, false);
  assert.deepEqual(report.checks.map(({ kind, ok }) => ({ kind, ok })), [
    { kind: "free_selector", ok: true },
    { kind: "unsigned_paid_handoff_v2", ok: true },
  ]);
  assert.equal(requests.length, 3);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.url, `${origin}/mcp`);
    assert.equal(request.init.method, "POST");
    const headers = new Headers(request.init.headers);
    assert.equal(headers.has("Authorization"), false);
    assert.equal(headers.has("Payment-Signature"), false);
    assert.equal(headers.has("X-PAYMENT"), false);
    assert.equal(headers.get("User-Agent"), "bountyverdict-owner-audit/1.0");
    assert.equal(
      headers.get("Cloudflare-Workers-Version-Overrides"),
      `bountyverdict-agent-production="${workerVersionId}"`,
    );
    const rpc = JSON.parse(String(request.init.body));
    if (index === 0) {
      assert.equal(rpc.method, "initialize");
      assert.equal(rpc.params.clientInfo.name, "bountyverdict-functional-canary");
      continue;
    }
    assert.equal(rpc.method, "tools/call");
    assert.deepEqual(rpc.params, index === 1 ? {
      name: "choose_github_agent_decision",
      arguments: { task: "github_actions_root_cause" },
    } : {
      name: "diagnose_github_actions_run",
      arguments: args,
    });
  }
});

test("release probe verifies one pinned MCP initialize response without tool calls", async () => {
  const requests: RequestInit[] = [];
  const report = await probeMcpReleaseIdentity(origin, workerVersionId, {
    fetch: async (_url, init = {}) => {
      requests.push(init);
      return initializeResponse();
    },
  });
  assert.deepEqual(report, {
    server_version: "1.1.23",
    worker_version_id: workerVersionId,
  });
  assert.equal(requests.length, 1);
  assert.equal(
    new Headers(requests[0].headers).get("Cloudflare-Workers-Version-Overrides"),
    `bountyverdict-agent-production="${workerVersionId}"`,
  );
});

test("release probe treats a stale edge without exact response identity as unconverged", async () => {
  const stale = jsonResponse(await initializeResponse().json(), { "X-BountyVerdict-Worker-Version": "" });
  const report = await probeMcpReleaseIdentity(origin, workerVersionId, { fetch: async () => stale });
  assert.equal(report.server_version, null);
  assert.equal(report.worker_version_id, null);
  assert.match(report.error || "", /pinned Worker version/);
});

test("recurring MCP canary fails closed when the free selector asks for payment", async () => {
  const responses = [
    initializeResponse(),
    selectorResponse(),
    handoffResponse(),
  ];
  responses[1] = jsonResponse(await responses[1].json(), { "Payment-Required": "challenge" });
  const report = await runMcpContractCanary(origin, {
    fetch: async () => responses.shift()!,
    workerVersionOverride: workerVersionId,
  });
  assert.equal(report.healthy, false);
  assert.equal(report.checks[0].kind, "free_selector");
  assert.equal(report.checks[0].ok, false);
  assert.match(report.checks[0].error || "", /unexpectedly returned Payment-Required/);
  assert.equal(report.payment_or_signing_attempted, false);
});

test("recurring MCP canary fails closed when server release identity is invalid", async () => {
  const responses = [initializeResponse("next"), selectorResponse(), handoffResponse()];
  const report = await runMcpContractCanary(origin, {
    fetch: async () => responses.shift()!,
    workerVersionOverride: workerVersionId,
  });
  assert.equal(report.healthy, false);
  assert.equal(report.server_version, null);
  assert.match(report.server_identity_error || "", /invalid semantic version/);
  assert.equal(report.checks.every(({ ok }) => ok), true);
});

test("recurring MCP canary rejects responses from an unverified Worker version", async () => {
  const responses = [initializeResponse(), selectorResponse(), handoffResponse()];
  responses[0] = jsonResponse(await responses[0].json(), { "X-BountyVerdict-Worker-Version": "" });
  const report = await runMcpContractCanary(origin, {
    fetch: async () => responses.shift()!,
    workerVersionOverride: workerVersionId,
  });
  assert.equal(report.healthy, false);
  assert.equal(report.worker_version_id, null);
  assert.match(report.server_identity_error || "", /pinned Worker version/);
});

test("recurring MCP canary rejects an invalid Worker version override before requests", async () => {
  let requested = false;
  await assert.rejects(() => runMcpContractCanary(origin, {
    fetch: async () => {
      requested = true;
      return initializeResponse();
    },
    workerVersionOverride: "1.1.23",
  }), /lowercase UUID/);
  assert.equal(requested, false);
});
