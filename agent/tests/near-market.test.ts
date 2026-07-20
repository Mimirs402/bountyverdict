import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/index.ts";
import {
  NEAR_MARKET_LISTINGS,
  NEAR_MARKET_PROVIDER_ID,
  parseNearMarketInput,
  parseNearMarketProduct,
} from "../src/near-market.ts";
import { mcpDriftExampleInput } from "../src/mcp-drift-discovery.ts";

test("NEAR Market publishes only the six frozen automated products", () => {
  assert.match(NEAR_MARKET_PROVIDER_ID, /^[a-f0-9-]{36}$/);
  assert.deepEqual(NEAR_MARKET_LISTINGS.map(({ product }) => product).sort(), [
    "flake", "harness", "mcpdrift", "portfolio", "run", "single",
  ]);
  assert.equal(new Set(NEAR_MARKET_LISTINGS.map(({ endpoint_url }) => endpoint_url)).size, 6);
  for (const listing of NEAR_MARKET_LISTINGS) {
    assert.equal(listing.price_amount, "1");
    assert.equal(listing.price_token, "USDC");
    assert.equal(listing.pricing_model, "fixed");
    assert.equal(listing.enabled, true);
    assert.match(listing.endpoint_url, /^https:\/\/bountyverdict-agent-production\.mimirslab\.workers\.dev\/api\/near-market\//);
  }
});

test("NEAR Market request parsing accepts platform-wrapped and direct inputs", () => {
  assert.deepEqual(parseNearMarketInput(JSON.stringify({ input: { repo_url: "https://github.com/a/b" }, job_id: "ignored" })), {
    repo_url: "https://github.com/a/b",
  });
  assert.deepEqual(parseNearMarketInput(JSON.stringify({ issue_url: "https://github.com/a/b/issues/1" })), {
    issue_url: "https://github.com/a/b/issues/1",
  });
  assert.equal(parseNearMarketProduct("harness"), "harness");
  assert.equal(parseNearMarketProduct("skill"), null);
  assert.throws(() => parseNearMarketInput("[]"), /JSON object/);
  assert.throws(() => parseNearMarketInput(JSON.stringify({ input: "nope" })), /JSON object/);
});

test("NEAR Market endpoint fulfills a wrapped deterministic MCP drift request", async () => {
  const response = await app.request("/api/near-market/mcpdrift", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: mcpDriftExampleInput, job_id: "market-job" }),
  }, {
    NEAR_MARKET_RATE_LIMITER: { limit: async () => ({ success: true }) },
  });
  assert.equal(response.status, 200);
  const output = await response.json() as Record<string, unknown>;
  assert.equal(output.service, "MCPDriftVerdict");
  assert.equal(output.contract_version, "mcp-drift/1");
});
