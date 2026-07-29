import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaymentHandoff,
  exactRestRequestForProduct,
  PAYMENT_NEXT_ACTION,
} from "../src/payment-handoff.ts";

const origin = "https://bountyverdict-agent-production.mimirslab.workers.dev";

test("canonical migrated products use exact POST bodies without query leakage", () => {
  assert.deepEqual(exactRestRequestForProduct(origin, "harness", {
    repo_url: "https://github.com/openai/codex",
  }), {
    method: "POST",
    url: `${origin}/api/repository-agent-instructions-audit`,
    body: { repo_url: "https://github.com/openai/codex" },
  });
  assert.deepEqual(exactRestRequestForProduct(origin, "run", {
    run_url: "https://github.com/openai/codex/actions/runs/29728148711",
  }), {
    method: "POST",
    url: `${origin}/api/github-actions-run-diagnosis`,
    body: { run_url: "https://github.com/openai/codex/actions/runs/29728148711" },
  });
  assert.deepEqual(exactRestRequestForProduct(origin, "skill", {
    repo_url: "https://github.com/openai/codex",
    skill_path: "skills/review",
  }), {
    method: "POST",
    url: `${origin}/api/skill`,
    body: {
      repo_url: "https://github.com/openai/codex",
      skill_path: "skills/review",
    },
  });
  assert.deepEqual(exactRestRequestForProduct(origin, "flake", {
    run_url: "https://github.com/actions/runner/actions/runs/29423388605",
    attempt: 1,
  }), {
    method: "POST",
    url: `${origin}/api/github-actions-flake-retry-gate`,
    body: {
      run_url: "https://github.com/actions/runner/actions/runs/29423388605",
      attempt: 1,
    },
  });
});

test("canonical POST handoffs disclose advisory body hashes and pinned awal argv", async () => {
  for (const [product, args, expectedBody] of [
    ["harness", { repo_url: "https://github.com/openai/codex" }, { repo_url: "https://github.com/openai/codex" }],
    ["skill", {
      repo_url: "https://github.com/openai/codex",
      skill_path: "skills/review",
    }, {
      repo_url: "https://github.com/openai/codex",
      skill_path: "skills/review",
    }],
    ["run", { run_url: "https://github.com/openai/codex/actions/runs/29728148711" }, { run_url: "https://github.com/openai/codex/actions/runs/29728148711" }],
    ["flake", { run_url: "https://github.com/actions/runner/actions/runs/29423388605", attempt: 1 }, {
      run_url: "https://github.com/actions/runner/actions/runs/29423388605",
      attempt: 1,
    }],
  ] as const) {
    const request = exactRestRequestForProduct(origin, product, args);
    const handoff = await buildPaymentHandoff(request, "70000", "eip155:8453");
    assert.equal(handoff.network, "Base");
    assert.equal(handoff.charge_state, "unsigned_not_charged");
    assert.equal(handoff.next_action, PAYMENT_NEXT_ACTION);
    assert.equal(handoff.authorization_scope, "resource_url_not_post_body");
    assert.deepEqual(handoff.exact_request.body, expectedBody);
    assert.match(handoff.exact_request.normalized_body_sha256 || "", /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(handoff.coinbase_wallet_mcp, {
      tool_name: "make_http_request_with_x402",
      execution_kind: "equivalent_rest_request",
      arguments: {
        baseURL: origin,
        path: new URL(request.url).pathname,
        method: "POST",
        body: expectedBody,
        maxAmountPerRequest: 70000,
        preferredNetwork: "base",
      },
    });
    assert.deepEqual(handoff.agentic_wallet.argv, [
      "awal@2.12.0",
      "x402",
      "pay",
      request.url,
      "-X",
      "POST",
      "-d",
      JSON.stringify(expectedBody),
      "--max-amount",
      "70000",
      "--json",
    ]);
    assert.equal(handoff.retry_semantics.transport, "rest_http");
  }
});

test("legacy GET handoffs split the exact URL into Coinbase wallet MCP query arguments", async () => {
  const request = {
    method: "GET" as const,
    url: `${origin}/api/skill?repo_url=${encodeURIComponent("https://github.com/openai/codex")}&skill_path=skills%2Freview`,
  };
  const handoff = await buildPaymentHandoff(request, "60000", "eip155:8453");
  assert.deepEqual(handoff.coinbase_wallet_mcp, {
    tool_name: "make_http_request_with_x402",
    execution_kind: "equivalent_rest_request",
    arguments: {
      baseURL: origin,
      path: "/api/skill",
      method: "GET",
      queryParams: {
        repo_url: "https://github.com/openai/codex",
        skill_path: "skills/review",
      },
      maxAmountPerRequest: 60000,
      preferredNetwork: "base",
    },
  });
  assert.equal(handoff.exact_request.url, request.url);
  assert.equal(handoff.exact_request.body, undefined);
});

test("wallet MCP numeric caps fail closed beyond JavaScript safe integers", async () => {
  await assert.rejects(
    buildPaymentHandoff({
      method: "POST",
      url: `${origin}/api/bounty-preflight`,
      body: { issue_url: "https://github.com/owner/repo/issues/1" },
    }, (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(), "eip155:8453"),
    /safe integer range/,
  );
});

test("wallet MCP mapping fails closed when an exact URL cannot be represented losslessly", async () => {
  await assert.rejects(
    buildPaymentHandoff({
      method: "GET",
      url: `${origin}/api/skill?repo_url=one&repo_url=two`,
    }, "60000", "eip155:8453"),
    /duplicate query parameter names/,
  );
  await assert.rejects(
    buildPaymentHandoff({
      method: "GET",
      url: `${origin}/api/skill#fragment`,
    }, "60000", "eip155:8453"),
    /URL fragment/,
  );
});

test("wallet MCP network is derived from the exact x402 challenge network", async () => {
  const request = {
    method: "POST" as const,
    url: `${origin}/api/bounty-preflight`,
    body: { issue_url: "https://github.com/owner/repo/issues/1" },
  };
  const testnet = await buildPaymentHandoff(request, "50000", "eip155:84532");
  assert.equal(testnet.network, "Base Sepolia");
  assert.equal(testnet.coinbase_wallet_mcp.arguments.preferredNetwork, "base-sepolia");

  await assert.rejects(
    buildPaymentHandoff(request, "50000", "eip155:1"),
    /Coinbase wallet-compatible Base network/,
  );
});

test("flake handoff rejects invalid attempts before any payment request is built", () => {
  assert.throws(() => exactRestRequestForProduct(origin, "flake", {
    run_url: "https://github.com/actions/runner/actions/runs/29423388605",
    attempt: 0,
  }), /Invalid normalized attempt/);
});
