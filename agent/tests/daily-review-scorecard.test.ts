import assert from "node:assert/strict";
import test from "node:test";
import {
  DAILY_REVIEW_SCORECARD_MAX_BYTES,
  applyDailyReviewModelBudget,
  buildDailyReviewGate,
  buildDailyReviewScorecard,
} from "../src/daily-review-scorecard.ts";
import {
  createFunnelSnapshot,
  recordDiscoveryObservation,
  recordMcpObservation,
} from "../src/funnel-telemetry.ts";

const now = "2026-07-27T12:00:00.000Z";

function functional() {
  return {
    healthy: true,
    checks: Array.from({ length: 7 }, (_, index) => ({ product: `p${index}`, ok: true })),
    mcp_contract: {
      healthy: true,
      endpoint: "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp",
      payment_or_signing_attempted: false,
      checks: [
        { kind: "free_selector", ok: true, contract: "1.0" },
        { kind: "unsigned_paid_handoff_v2", ok: true, contract: "1.0" },
      ],
    },
  };
}

function distribution() {
  return {
    healthy: true,
    errors: [],
    commerce: {
      genuine_purchases: 0,
      customer_revenue_usdc: "0",
      tracked_costs_usdc: "1.012",
    },
    functional: functional(),
    funnel: {
      trusted_measurement_eligible: true,
      learning_stage: "discovery_surface_without_paid_route",
      mcp_learning_stage: "mcp_catalog_discovery_only",
    },
  };
}

function snapshot() {
  const value = createFunnelSnapshot(now);
  recordMcpObservation(value, {
    observed_at: now,
    stage: "tools_list",
    product: null,
    source: "owner_automation",
    client_class: "owner_automation",
    client_family: "owner_automation",
    validation_kind: "not_applicable",
    channel: "owner_automation",
  });
  recordMcpObservation(value, {
    observed_at: now,
    stage: "selection_preview",
    product: "run",
    source: "unknown",
    client_class: "agent_runtime",
    client_family: "codex",
    validation_kind: "not_applicable",
    channel: "direct_or_hidden",
  });
  recordDiscoveryObservation(value, {
    observed_at: now,
    surface: "homepage",
    source: "owner_automation",
    client_class: "owner_automation",
    channel: "owner_automation",
    response_preference: "browser_html",
    outcome: "unsigned_success",
    signed_request: false,
  });
  recordDiscoveryObservation(value, {
    observed_at: now,
    surface: "skill_md_probe",
    source: "unknown",
    client_class: "agent_runtime",
    channel: "direct_or_hidden",
    response_preference: "unspecified_or_other",
    outcome: "unsigned_success",
    signed_request: false,
  });
  return value;
}

test("scorecard stays bounded and derives buyer counters with owner exclusions", () => {
  const scorecard = buildDailyReviewScorecard({
    distribution: distribution(),
    functional: functional(),
    funnel: snapshot(),
    demand: { errors: [] },
    acquisitionExperiment: {
      name: "skillverdict_earned_directory_placement",
      started_at: "2026-07-27T00:00:00.000Z",
      ends_at: "2026-07-28T00:00:00.000Z",
      terminal_result: null,
    },
  }, now);
  assert.equal(scorecard.healthy, true);
  assert.equal(scorecard.funnel.provenance, "raw_funnel_with_owner_exclusions");
  assert.equal(scorecard.funnel.mcp.events, 1);
  assert.equal(scorecard.funnel.mcp.tools_list, 0);
  assert.equal(scorecard.funnel.mcp.selection_preview, 1);
  assert.equal(scorecard.funnel.discovery.requests, 1);
  assert.equal(scorecard.accounting.genuine_purchases, 0);
  assert.deepEqual(scorecard.acquisition_experiment, {
    name: "skillverdict_earned_directory_placement",
    status: "running",
  });
  assert.match(scorecard.accounting.authority, /verified non-owner settlement only/);
  assert.ok(Buffer.byteLength(JSON.stringify(scorecard)) <= DAILY_REVIEW_SCORECARD_MAX_BYTES);
});

test("healthy baseline and immaterial reach growth skip Codex", () => {
  const firstSnapshot = snapshot();
  for (let index = 0; index < 25; index += 1) {
    recordMcpObservation(firstSnapshot, {
      observed_at: now,
      stage: "initialize",
      product: null,
      source: "unknown",
      client_class: "agent_runtime",
      client_family: "codex",
      validation_kind: "not_applicable",
      channel: "direct_or_hidden",
    });
  }
  const first = buildDailyReviewScorecard({
    distribution: distribution(),
    functional: functional(),
    funnel: firstSnapshot,
    demand: { errors: [] },
  }, now);
  assert.equal(buildDailyReviewGate(first, null).reason, "healthy_baseline_created");
  assert.equal(buildDailyReviewGate(first, null).action, "skip_codex");

  recordMcpObservation(firstSnapshot, {
    observed_at: now,
    stage: "initialize",
    product: null,
    source: "unknown",
    client_class: "agent_runtime",
    client_family: "codex",
    validation_kind: "not_applicable",
    channel: "direct_or_hidden",
  });
  const second = buildDailyReviewScorecard({
    distribution: distribution(),
    functional: functional(),
    funnel: firstSnapshot,
    demand: { errors: [] },
  }, "2026-07-28T12:00:00.000Z");
  const gate = buildDailyReviewGate(second, first);
  assert.equal(gate.action, "skip_codex");
  assert.equal(gate.reason, "healthy_materially_unchanged");
  assert.equal(gate.prompt, null);
});

test("paid-stage deltas and reliability alerts produce only a compact scorecard prompt", () => {
  const first = buildDailyReviewScorecard({
    distribution: distribution(),
    functional: functional(),
    funnel: snapshot(),
    demand: { errors: [] },
  }, now);
  const changedSnapshot = snapshot();
  recordMcpObservation(changedSnapshot, {
    observed_at: now,
    stage: "payment_required",
    product: "run",
    source: "unknown",
    client_class: "agent_runtime",
    client_family: "codex",
    validation_kind: "not_applicable",
    channel: "direct_or_hidden",
  });
  const changed = buildDailyReviewScorecard({
    distribution: distribution(),
    functional: functional(),
    funnel: changedSnapshot,
    demand: { errors: [] },
  }, "2026-07-28T12:00:00.000Z");
  const deltaGate = buildDailyReviewGate(changed, first);
  assert.equal(deltaGate.action, "invoke_codex");
  assert.equal(deltaGate.reason, "material_change");
  assert.match(deltaGate.prompt || "", /Review only this compact/);
  assert.doesNotMatch(deltaGate.prompt || "", /Read the repository/);
  assert.ok(Buffer.byteLength(deltaGate.prompt || "") < 12_000);

  const broken = buildDailyReviewScorecard({
    distribution: { ...distribution(), healthy: false, errors: ["canary stale"] },
    functional: { ...functional(), healthy: false },
    funnel: changedSnapshot,
    demand: { errors: [] },
  }, "2026-07-29T12:00:00.000Z");
  const alertGate = buildDailyReviewGate(broken, changed);
  assert.equal(alertGate.reason, "unhealthy");
  assert.equal(alertGate.action, "invoke_codex");
  assert.deepEqual(broken.alerts, [
    "distribution_monitor_unhealthy_or_missing",
    "distribution_monitor_errors",
    "functional_canary_unhealthy_or_missing",
  ]);

  const unchangedNextDay = buildDailyReviewScorecard({
    distribution: { ...distribution(), healthy: false, errors: ["canary stale"] },
    functional: { ...functional(), healthy: false },
    funnel: changedSnapshot,
    demand: { errors: [] },
  }, "2026-07-30T12:00:00.000Z");
  const unchangedGate = buildDailyReviewGate(unchangedNextDay, broken);
  assert.equal(unchangedGate.reason, "unhealthy_materially_unchanged");
  assert.equal(unchangedGate.action, "skip_codex");
  assert.equal(unchangedGate.prompt, null);

  const unchangedAfterWeek = buildDailyReviewScorecard({
    distribution: { ...distribution(), healthy: false, errors: ["canary stale"] },
    functional: { ...functional(), healthy: false },
    funnel: changedSnapshot,
    demand: { errors: [] },
  }, "2026-08-05T12:00:00.000Z");
  const reminderGate = buildDailyReviewGate(unchangedAfterWeek, broken);
  assert.equal(reminderGate.reason, "unhealthy_periodic_reminder");
  assert.equal(reminderGate.action, "invoke_codex");
  assert.match(reminderGate.prompt || "", /health alerts only/);
});

test("scheduled review is model-free unless an external budget gate opts in", () => {
  const first = buildDailyReviewScorecard({
    distribution: distribution(),
    functional: functional(),
    funnel: snapshot(),
    demand: { errors: [] },
  }, now);
  const changedSnapshot = snapshot();
  recordMcpObservation(changedSnapshot, {
    observed_at: now,
    stage: "payment_required",
    product: "run",
    source: "unknown",
    client_class: "agent_runtime",
    client_family: "codex",
    validation_kind: "not_applicable",
    channel: "direct_or_hidden",
  });
  const changed = buildDailyReviewScorecard({
    distribution: distribution(),
    functional: functional(),
    funnel: changedSnapshot,
    demand: { errors: [] },
  }, "2026-07-28T12:00:00.000Z");
  const gate = buildDailyReviewGate(changed, first);

  const held = applyDailyReviewModelBudget(gate, false);
  assert.equal(held.action, "skip_codex");
  assert.equal(held.reason, "model_budget_not_enabled");
  assert.equal(held.prompt, null);
  assert.equal(held.model_review_enabled, false);
  assert.equal(held.codex_suppressed, true);

  const enabled = applyDailyReviewModelBudget(gate, true);
  assert.equal(enabled.action, "invoke_codex");
  assert.equal(enabled.reason, "material_change");
  assert.match(enabled.prompt || "", /Review only this compact/);
  assert.equal(enabled.model_review_enabled, true);
  assert.equal(enabled.codex_suppressed, false);
});
