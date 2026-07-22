import assert from "node:assert/strict";
import test from "node:test";
import {
  X402_ARENA_AGENT_ID,
  X402_ARENA_PRICE_USDC,
  parseX402ArenaTelemetry,
} from "../src/x402arena.ts";

function agent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: X402_ARENA_AGENT_ID,
    status: "active",
    priceUsdc: X402_ARENA_PRICE_USDC,
    totalRevenue: 0,
    organicRevenue: 0,
    houseRevenue: 0,
    queryCount: 0,
    uniqueBuyers: 0,
    lastEventAt: "2026-07-22 16:13:36",
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}): unknown {
  return { agents: [agent(overrides)] };
}

test("parses the exact active RunVerdict Arena listing", () => {
  assert.deepEqual(parseX402ArenaTelemetry(response()), {
    agentId: X402_ARENA_AGENT_ID,
    status: "active",
    priceUsdc: X402_ARENA_PRICE_USDC,
    totalRevenue: 0,
    organicRevenue: 0,
    houseRevenue: 0,
    queryCount: 0,
    uniqueBuyers: 0,
    lastEventAt: "2026-07-22 16:13:36",
  });
});

test("rejects missing, duplicate, inactive, and drifted Arena listings", () => {
  assert.throws(() => parseX402ArenaTelemetry({ agents: [] }), /missing or ambiguous/);
  assert.throws(() => parseX402ArenaTelemetry({ agents: [agent(), agent()] }), /missing or ambiguous/);
  assert.throws(() => parseX402ArenaTelemetry(response({ status: "error" })), /not active/);
  assert.throws(() => parseX402ArenaTelemetry(response({ priceUsdc: 0.05 })), /price drifted/);
  assert.throws(() => parseX402ArenaTelemetry(response({ queryCount: 1.5 })), /query count/);
});
