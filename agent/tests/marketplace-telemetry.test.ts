import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCdpMerchantQualityHistory,
  normalizeAgenticMarketQuality,
  normalizeCdpMerchantQuality,
  normalizeThe402CustomerSettlement,
  normalizeThe402ServiceOutcome,
  normalizeThe402WebhookHealth,
} from "../src/marketplace-telemetry.ts";

test("accepts pending and string-valued Agentic Market quality counters", () => {
  assert.deepEqual(normalizeAgenticMarketQuality(null), {
    quality_available: false,
    reported_calls_30d: 0,
    reported_unique_payers_30d: 0,
  });
  assert.deepEqual(normalizeAgenticMarketQuality({
    l30DaysTotalCalls: "3",
    l30DaysUniquePayers: "2",
  }), {
    quality_available: true,
    reported_calls_30d: 3,
    reported_unique_payers_30d: 2,
  });
});

test("rejects malformed or inconsistent Agentic Market quality counters", () => {
  assert.throws(() => normalizeAgenticMarketQuality({}), /calls/);
  assert.throws(() => normalizeAgenticMarketQuality({
    l30DaysTotalCalls: "1",
    l30DaysUniquePayers: "2",
  }), /inconsistent/);
  assert.throws(() => normalizeAgenticMarketQuality({
    l30DaysTotalCalls: "01",
    l30DaysUniquePayers: "0",
  }), /calls/);
});

const detail = {
  id: "svc_expected",
  listed_at: "2026-07-20T17:12:24.022Z",
  updated_at: "2026-07-20T19:43:15.566Z",
  service_reputation: {
    score: 75,
    confidence: 0.5,
    dimensions: { quality: 75, speed: 80, reliability: 70, communication: 75 },
    total_jobs: 3,
    successful_jobs: 1,
    failed_jobs: 1,
    disputed_jobs: 1,
  },
};

test("normalizes exact per-service marketplace outcomes", () => {
  assert.deepEqual(normalizeThe402ServiceOutcome(detail, "svc_expected"), {
    service_id: "svc_expected",
    listed_at: detail.listed_at,
    updated_at: detail.updated_at,
    score: 75,
    confidence: 0.5,
    dimensions: detail.service_reputation.dimensions,
    total_jobs: 3,
    successful_jobs: 1,
    failed_jobs: 1,
    disputed_jobs: 1,
  });
});

test("rejects wrong identities and inconsistent or malformed outcome telemetry", () => {
  assert.throws(() => normalizeThe402ServiceOutcome({ ...detail, id: "svc_other" }, "svc_expected"), /another service/);
  assert.throws(() => normalizeThe402ServiceOutcome({
    ...detail,
    service_reputation: { ...detail.service_reputation, total_jobs: 1 },
  }, "svc_expected"), /inconsistent/);
  assert.throws(() => normalizeThe402ServiceOutcome({
    ...detail,
    service_reputation: { ...detail.service_reputation, confidence: 2 },
  }, "svc_expected"), /confidence/);
  assert.throws(() => normalizeThe402ServiceOutcome({ ...detail, updated_at: "not-a-date" }, "svc_expected"), /updated_at/);
});

test("distinguishes a pre-sale unverified webhook from a failed webhook", () => {
  assert.deepEqual(
    normalizeThe402WebhookHealth([true, true], 1),
    { healthy: true, status: "healthy" },
  );
  assert.deepEqual(
    normalizeThe402WebhookHealth([false, false], 0),
    { healthy: false, status: "unverified_no_completed_jobs" },
  );
  assert.throws(
    () => normalizeThe402WebhookHealth([false, false], 1),
    /inconsistent with completed jobs/,
  );
  assert.throws(
    () => normalizeThe402WebhookHealth([true, false], 0),
    /inconsistent with completed jobs/,
  );
});

test("the402 revenue attribution excludes platform probes and incomplete jobs", () => {
  const settlement = {
    id: "earn_1",
    job_id: "job_1",
    amount_usd: 0.05035,
    created_at: "2026-07-23T16:30:31.000Z",
  };
  const job = {
    id: "job_1",
    service_id: "svc_1",
    agent_wallet: "0x1111111111111111111111111111111111111111",
    provider_amount_usd: 0.05035,
    status: "released",
    escrow_status: "released",
  };
  const services = new Set(["svc_1"]);
  const excluded = new Set(["0x2222222222222222222222222222222222222222"]);
  assert.deepEqual(normalizeThe402CustomerSettlement(settlement, job, services, excluded), {
    settlement_id: "earn_1",
    job_id: "job_1",
    service_id: "svc_1",
    buyer_wallet: job.agent_wallet,
    amount_usd: 0.05035,
    settled_at: settlement.created_at,
  });
  assert.equal(normalizeThe402CustomerSettlement(
    settlement,
    { ...job, agent_wallet: "0x2222222222222222222222222222222222222222" },
    services,
    excluded,
  ), null);
  assert.equal(normalizeThe402CustomerSettlement(
    settlement,
    { ...job, status: "dispatched" },
    services,
    excluded,
  ), null);
  assert.throws(
    () => normalizeThe402CustomerSettlement(
      settlement,
      { ...job, provider_amount_usd: 0.04 },
      services,
      excluded,
    ),
    /amount is inconsistent/,
  );
});

const merchantResource = {
  resource: "https://example.test/api/verdict",
  lastUpdated: "2026-07-20T10:44:05.955Z",
  quality: {
    l30DaysTotalCalls: 2,
    l30DaysUniquePayers: 2,
    lastCalledAt: "2026-07-21T00:01:00.000Z",
  },
};

test("turns CDP merchant activity changes into reconciliation signals, never revenue", () => {
  const snapshot = normalizeCdpMerchantQuality(
    merchantResource,
    merchantResource.resource,
    "2026-07-21T00:02:00.000Z",
    {
      resource: merchantResource.resource,
      reported_calls_30d: 1,
      reported_unique_payers_30d: 1,
      last_called_at: "2026-07-20T10:44:05.648Z",
    },
  );
  assert.equal(snapshot.delta_calls_30d, 1);
  assert.equal(snapshot.delta_unique_payers_30d, 1);
  assert.equal(snapshot.call_recency_advanced, true);
  assert.equal(snapshot.requires_settlement_reconciliation, true);
  assert.equal(snapshot.quality_available, true);
  assert.equal(snapshot.baseline_owner_contaminated, true);
  assert.equal("revenue" in snapshot, false);
});

test("resets CDP quality deltas when a product migrates to a new canonical resource URL", () => {
  for (const [legacyPath, canonicalPath] of [
    ["/api/verdict", "/api/bounty-preflight"],
    ["/api/harness", "/api/repository-agent-instructions-audit"],
    ["/api/run", "/api/github-actions-run-diagnosis"],
    ["/api/flake", "/api/github-actions-flake-retry-gate"],
  ]) {
    const migrated = { ...merchantResource, resource: `https://example.test${canonicalPath}` };
    const snapshot = normalizeCdpMerchantQuality(
      migrated,
      migrated.resource,
      "2026-07-21T00:02:00.000Z",
      {
        resource: `https://example.test${legacyPath}`,
        reported_calls_30d: 99,
        reported_unique_payers_30d: 12,
        last_called_at: "2026-07-21T00:01:00.000Z",
      },
    );
    assert.equal(snapshot.delta_calls_30d, null);
    assert.equal(snapshot.delta_unique_payers_30d, null);
    assert.equal(snapshot.call_recency_advanced, false);
    assert.equal(snapshot.requires_settlement_reconciliation, false);
  }
});

test("accepts newly indexed CDP resources while quality counters are pending", () => {
  for (const resource of [
    { ...merchantResource, quality: null },
    { resource: merchantResource.resource, lastUpdated: merchantResource.lastUpdated },
  ]) {
    const pending = normalizeCdpMerchantQuality(
      resource,
      merchantResource.resource,
      "2026-07-21T00:00:00.000Z",
    );
    assert.equal(pending.quality_available, false);
    assert.equal(pending.reported_calls_30d, 0);
    assert.equal(pending.reported_unique_payers_30d, 0);
    assert.equal(pending.last_called_at, null);
    assert.equal(pending.requires_settlement_reconciliation, false);
  }
});

test("seeds owner-contaminated CDP baselines and retains only changed history points", () => {
  const baseline = normalizeCdpMerchantQuality(
    merchantResource,
    merchantResource.resource,
    "2026-07-21T00:00:00.000Z",
  );
  assert.equal(baseline.delta_calls_30d, null);
  assert.equal(baseline.requires_settlement_reconciliation, false);
  const first = appendCdpMerchantQualityHistory(undefined, { single: baseline });
  const unchanged = appendCdpMerchantQualityHistory(first, {
    single: { ...baseline, observed_at: "2026-07-21T00:05:00.000Z" },
  });
  assert.equal(unchanged.single.length, 1);
  const changed = appendCdpMerchantQualityHistory(unchanged, {
    single: { ...baseline, reported_calls_30d: 3, delta_calls_30d: 1 },
  });
  assert.equal(changed.single.length, 2);
});

test("rejects malformed CDP merchant counters and history", () => {
  assert.throws(() => normalizeCdpMerchantQuality(
    { ...merchantResource, quality: { ...merchantResource.quality, l30DaysUniquePayers: 3 } },
    merchantResource.resource,
    "2026-07-21T00:00:00.000Z",
  ), /inconsistent/);
  assert.throws(() => normalizeCdpMerchantQuality(
    merchantResource,
    "https://example.test/api/other",
    "2026-07-21T00:00:00.000Z",
  ), /identity/);
  assert.throws(() => appendCdpMerchantQualityHistory({ single: [null] }, {
    single: normalizeCdpMerchantQuality(merchantResource, merchantResource.resource, "2026-07-21T00:00:00.000Z"),
  }), /history/);
});
