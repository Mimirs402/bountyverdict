import assert from "node:assert/strict";
import test from "node:test";
import { loadDistributionMonitorConfiguration } from "../src/monitor-configuration.ts";

const complete = Object.freeze({
  PRODUCTION_API_URL: "https://bountyverdict-agent-production.mimirslab.workers.dev",
  REVENUE_WALLET: "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
  START_BLOCK: "48876000",
  TRACKED_COSTS_USDC: "1.012",
  SETTLEMENT_BUYER_ADDRESS: "0x1111111111111111111111111111111111111111",
  SETTLEMENT_CANARY_ENABLED: "NO",
  THE402_API_KEY: "the402-secret",
  THE402_PARTICIPANT_ID: "participant-1",
  NEAR_MARKET_API_KEY: "near-secret",
  NEAR_MARKET_AGENT_ID: "near-agent",
  PAYAN_API_KEY: "payan-secret",
  PAYAN_AGENT_ID: "payan-agent",
  PAYAN_OFFER_MAP: "{}",
});

test("distribution monitor configuration preserves explicit accounting boundaries", () => {
  const parsed = loadDistributionMonitorConfiguration({ ...complete, REPORT_ONLY: "YES" });
  assert.equal(parsed.revenueWallet, complete.REVENUE_WALLET);
  assert.equal(parsed.startBlock, "48876000");
  assert.equal(parsed.trackedCostsUsdc, "1.012");
  assert.equal(parsed.settlementBuyerAddress, complete.SETTLEMENT_BUYER_ADDRESS);
  assert.equal(parsed.settlementCanaryEnabled, false);
  assert.equal(parsed.reportOnly, true);
});

test("distribution monitor refuses missing accounting exclusions before state can be overwritten", () => {
  assert.throws(() => loadDistributionMonitorConfiguration({}), /REVENUE_WALLET[\s\S]+TRACKED_COSTS_USDC[\s\S]+SETTLEMENT_BUYER_ADDRESS/);
  assert.throws(() => loadDistributionMonitorConfiguration({
    ...complete,
    SETTLEMENT_BUYER_ADDRESS: complete.REVENUE_WALLET,
  }), /SETTLEMENT_BUYER_ADDRESS/);
  assert.throws(() => loadDistributionMonitorConfiguration({
    ...complete,
    TRACKED_COSTS_USDC: "",
  }), /TRACKED_COSTS_USDC/);
  assert.throws(() => loadDistributionMonitorConfiguration({
    ...complete,
    REVENUE_WALLET: "0x2222222222222222222222222222222222222222",
  }), /REVENUE_WALLET/);
  assert.throws(() => loadDistributionMonitorConfiguration({
    ...complete,
    START_BLOCK: "48876001",
  }), /START_BLOCK/);
  assert.throws(() => loadDistributionMonitorConfiguration({
    ...complete,
    TRACKED_COSTS_USDC: "0",
  }), /TRACKED_COSTS_USDC/);
});

test("configuration errors name missing fields without echoing secret values", () => {
  const secret = "must-never-appear-in-an-error";
  assert.throws(() => loadDistributionMonitorConfiguration({
    ...complete,
    THE402_API_KEY: secret,
    PAYAN_API_KEY: "",
  }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /PAYAN_API_KEY/);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
});
