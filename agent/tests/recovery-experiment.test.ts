import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOVERY_EXPERIMENT_COUNTER_KEYS,
  updateUnknownToolRecoveryExperiment,
  zeroRecoveryExperimentCounters,
  type RecoveryExperimentCounters,
} from "../src/recovery-experiment.ts";

const clean = (overrides: Partial<RecoveryExperimentCounters> = {}): RecoveryExperimentCounters => ({
  ...zeroRecoveryExperimentCounters(),
  ...overrides,
});

const update = (overrides: Record<string, unknown> = {}) => updateUnknownToolRecoveryExperiment({
  id: "mcp-unknown-tool-recovery-epoch46-v1",
  observedAt: "2026-07-22T13:30:00.000Z",
  targetToolsList: 25,
  measurementEpochId: 46,
  currentEpochId: 45,
  measurementEligible: false,
  cleanEpochDelta: null,
  previous: null,
  ...overrides,
});

test("waits with a frozen zero prefix until epoch 46 is active and eligible", () => {
  const result = update();
  assert.equal(result.status, "awaiting_active_eligible_epoch");
  assert.deepEqual(result.eligible_prefix, clean());
  assert.deepEqual(result.eligible_delta, clean());
  assert.equal(result.remaining_eligible_tools_list, 25);
});

test("does not count an audited drain even if the active epoch number is 46", () => {
  const result = update({
    currentEpochId: 46,
    measurementEligible: false,
    cleanEpochDelta: clean({ tools_list: 20, tool_not_found: 1 }),
  });
  assert.equal(result.status, "paused_audited_drain");
  assert.deepEqual(result.eligible_delta, clean());
});

test("starts from the exact clean epoch 46 delta and carries every schema-3 counter", () => {
  const eligible = clean({ initialize: 4, tools_list: 3, protocol_error: 1, tool_not_found: 1,
    validation_error: 1, capacity_rejected: 1, payment_required: 1, payment_present: 1,
    paid_success: 1, paid_error: 1 });
  const result = update({ currentEpochId: 46, measurementEligible: true, cleanEpochDelta: eligible });
  assert.equal(result.status, "running_clean_epoch");
  assert.deepEqual(result.eligible_delta, eligible);
  assert.deepEqual(Object.keys(result.eligible_delta as object), [...RECOVERY_EXPERIMENT_COUNTER_KEYS]);
});

test("same-epoch refresh replaces rather than double counts and rejects regression", () => {
  const first = update({ currentEpochId: 46, measurementEligible: true, cleanEpochDelta: clean({ tools_list: 4 }) });
  const previous = { id: "mcp-unknown-tool-recovery-epoch46-v1", ...first };
  const second = update({ currentEpochId: 46, measurementEligible: true, cleanEpochDelta: clean({ tools_list: 6 }), previous });
  assert.equal((second.eligible_delta as RecoveryExperimentCounters).tools_list, 6);
  assert.throws(() => update({ currentEpochId: 46, measurementEligible: true, cleanEpochDelta: clean({ tools_list: 3 }), previous }), /regressed/);
});

test("freezes the first report at or above 25 tools/list events", () => {
  const completed = update({ currentEpochId: 46, measurementEligible: true, cleanEpochDelta: clean({ tools_list: 26, tool_not_found: 1 }) });
  const later = update({
    observedAt: "2026-07-22T13:40:00.000Z",
    currentEpochId: 46,
    measurementEligible: true,
    cleanEpochDelta: clean({ tools_list: 30, tool_not_found: 1, payment_required: 1 }),
    previous: { id: "mcp-unknown-tool-recovery-epoch46-v1", ...completed },
  });
  assert.equal(completed.status, "completed");
  assert.equal((completed.boundary as Record<string, unknown>).observation_rule, "first_monitor_report_at_or_above_25_eligible_epoch_46_tools_list_events");
  assert.deepEqual(later.boundary, completed.boundary);
  assert.deepEqual(later.eligible_delta, completed.eligible_delta);
  assert.deepEqual(later.event_ratios, completed.event_ratios);
  assert.equal(later.remaining_eligible_tools_list, completed.remaining_eligible_tools_list);
  assert.equal(later.decision, "unknown_tool_recovery_outcome_unresolved");

  const epoch47 = update({
    observedAt: "2026-07-22T14:00:00.000Z",
    currentEpochId: 47,
    measurementEligible: true,
    cleanEpochDelta: clean({ tools_list: 100, payment_present: 1, paid_success: 1 }),
    previous: { id: "mcp-unknown-tool-recovery-epoch46-v1", ...later },
  });
  assert.deepEqual(epoch47.boundary, completed.boundary);
  assert.deepEqual(epoch47.eligible_delta, completed.eligible_delta);
  assert.deepEqual(epoch47.event_ratios, completed.event_ratios);
  assert.equal(epoch47.remaining_eligible_tools_list, completed.remaining_eligible_tools_list);
  assert.equal(epoch47.decision, completed.decision);
});

test("the conservative terminal ladder prioritizes conversion and deeper friction", () => {
  const decision = (overrides: Partial<RecoveryExperimentCounters>) => update({
    currentEpochId: 46,
    measurementEligible: true,
    cleanEpochDelta: clean({ tools_list: 25, ...overrides }),
  }).decision;
  assert.equal(decision({ paid_success: 1, paid_error: 1, tool_not_found: 1 }), "paid_conversion_observed");
  assert.equal(decision({ paid_error: 1, tool_not_found: 1 }), "paid_execution_or_settlement_error_observed");
  assert.equal(decision({ payment_present: 1 }), "signed_payment_outcome_unresolved");
  assert.equal(decision({ payment_present: 1, capacity_rejected: 1 }), "service_capacity_friction_after_valid_call");
  assert.equal(decision({ payment_required: 1, tool_not_found: 1 }), "known_valid_tool_interest_observed");
  assert.equal(decision({ validation_error: 1, tool_not_found: 1 }), "known_tool_input_friction_observed");
  assert.equal(decision({ tool_not_found: 1, protocol_error: 1 }), "unknown_tool_recovery_outcome_unresolved");
  assert.equal(decision({ protocol_error: 1 }), "mcp_protocol_friction_observed");
  assert.equal(decision({}), "no_unknown_tool_recurrence_in_clean_sample");
});

test("never makes a causal recovery claim from aggregate telemetry", () => {
  const result = update({ currentEpochId: 46, measurementEligible: true, cleanEpochDelta: clean({ tools_list: 25, payment_required: 1 }) });
  assert.equal(result.causal_recovery_claim, false);
  assert.equal((result.boundary as Record<string, unknown>).causal_recovery_claim, false);
  assert.match(String(result.causality_limit), /no session or retry linkage/);
  assert.match(String(result.causality_limit), /never reports a causal recovery rate/);
});

test("does not silently blend a later epoch into an unfinished epoch-46 sample", () => {
  const running = update({ currentEpochId: 46, measurementEligible: true, cleanEpochDelta: clean({ tools_list: 10 }) });
  const result = update({
    currentEpochId: 47,
    measurementEligible: true,
    cleanEpochDelta: clean({ tools_list: 40 }),
    previous: { id: "mcp-unknown-tool-recovery-epoch46-v1", ...running },
  });
  assert.equal(result.status, "measurement_epoch_closed_before_target");
  assert.equal(result.decision, "epoch_46_closed_before_target");
  assert.equal((result.eligible_delta as RecoveryExperimentCounters).tools_list, 10);
});

test("reports a history gap if the first observation arrives after epoch 46", () => {
  const result = update({ currentEpochId: 47, measurementEligible: true, cleanEpochDelta: clean({ tools_list: 30 }) });
  assert.equal(result.status, "measurement_history_gap");
  assert.equal(result.decision, "manual_reconciliation_required_epoch_46_was_not_observed");
});

test("rejects configuration drift in persisted state", () => {
  assert.throws(() => update({
    previous: {
      id: "mcp-unknown-tool-recovery-epoch46-v1",
      accounting_schema_version: 3,
      measurement_epoch_id: 45,
      target_tools_list: 25,
      eligible_delta: clean(),
    },
  }), /configuration changed/);
  assert.throws(() => update({ targetToolsList: 26 }), /frozen 25/);
});

test("rejects malformed counters in an otherwise completed boundary", () => {
  const completed = update({
    currentEpochId: 46,
    measurementEligible: true,
    cleanEpochDelta: clean({ tools_list: 25 }),
  });
  assert.throws(() => update({
    currentEpochId: 47,
    measurementEligible: true,
    cleanEpochDelta: clean({ tools_list: 40 }),
    previous: {
      id: "mcp-unknown-tool-recovery-epoch46-v1",
      ...completed,
      boundary: {
        ...(completed.boundary as Record<string, unknown>),
        eligible_delta: { ...(completed.eligible_delta as RecoveryExperimentCounters), paid_success: -1 },
      },
    },
  }), /frozen boundary eligible paid_success is invalid/);
});
