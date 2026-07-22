import assert from "node:assert/strict";
import test from "node:test";
import { updateSelectionPreviewExperiment, type SelectionExperimentCounters } from "../src/selection-experiment.ts";

const prefix: SelectionExperimentCounters = {
  initialize: 110,
  tools_list: 109,
  protocol_error: 0,
  tool_not_found: 0,
  validation_error: 0,
  capacity_rejected: 0,
  payment_required: 0,
  payment_present: 0,
  paid_success: 0,
  paid_error: 0,
};
const clean = (overrides: Partial<SelectionExperimentCounters> = {}): SelectionExperimentCounters => ({
  initialize: 0,
  tools_list: 0,
  protocol_error: 0,
  tool_not_found: 0,
  validation_error: 0,
  capacity_rejected: 0,
  payment_required: 0,
  payment_present: 0,
  paid_success: 0,
  paid_error: 0,
  ...overrides,
});
const update = (overrides: Record<string, unknown> = {}) => updateSelectionPreviewExperiment({
  id: "mcp-selection-preview-parity-v2",
  observedAt: "2026-07-22T02:50:00Z",
  targetToolsList: 150,
  resumeEpochId: 37,
  eligiblePrefix: prefix,
  rawDelta: clean({ initialize: 114, tools_list: 113 }),
  currentEpochId: 36,
  measurementEligible: false,
  cleanEpochDelta: null,
  attributableRuntimeDelta: clean(),
  previous: null,
  ...overrides,
});

test("pauses during an audited drain and excludes post-prefix activity", () => {
  const result = update();
  assert.equal(result.status, "paused_audited_drain");
  assert.equal(result.remaining_eligible_tools_list, 41);
  assert.deepEqual(result.eligible_delta, prefix);
  assert.equal((result.ineligible_or_draining_delta as SelectionExperimentCounters).tools_list, 4);
});

test("adds only clean active-epoch deltas after the drain activates", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 2, tools_list: 2 }),
  });
  assert.equal(result.status, "running_clean_epoch");
  assert.equal((result.eligible_delta as SelectionExperimentCounters).tools_list, 111);
  assert.equal(result.clean_active_epoch_id, 37);
});

test("same-epoch refresh replaces rather than double-counts the clean delta", () => {
  const first = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 2, tools_list: 2 }),
  });
  const second = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 4, tools_list: 3, validation_error: 1 }),
    rawDelta: clean({ initialize: 118, tools_list: 116, validation_error: 1 }),
    previous: { id: "mcp-selection-preview-parity-v2", ...first },
  });
  assert.equal((second.eligible_delta as SelectionExperimentCounters).tools_list, 112);
  assert.equal((second.eligible_delta as SelectionExperimentCounters).validation_error, 1);
});

test("a later drain freezes the last eligible active-epoch delta", () => {
  const active = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 4, tools_list: 3 }),
  });
  const paused = update({
    currentEpochId: 37,
    measurementEligible: false,
    cleanEpochDelta: null,
    rawDelta: clean({ initialize: 120, tools_list: 118 }),
    previous: { id: "mcp-selection-preview-parity-v2", ...active },
  });
  assert.equal(paused.status, "paused_audited_drain");
  assert.equal((paused.eligible_delta as SelectionExperimentCounters).tools_list, 112);
});

test("a new clean epoch carries the prior epoch forward exactly once", () => {
  const epoch37 = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 8, tools_list: 6 }),
    rawDelta: clean({ initialize: 122, tools_list: 119 }),
  });
  const epoch38 = update({
    currentEpochId: 38,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 2, tools_list: 2 }),
    attributableRuntimeDelta: clean({ tools_list: 1 }),
    rawDelta: clean({ initialize: 125, tools_list: 120 }),
    previous: { id: "mcp-selection-preview-parity-v2", ...epoch37 },
  });
  assert.equal((epoch38.eligible_delta as SelectionExperimentCounters).tools_list, 117);
  assert.equal(epoch38.attributable_runtime_tools_list, 1);
  assert.equal(epoch38.clean_active_epoch_id, 38);
});

test("completes without overclaiming copy failure as workflow reach", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41 }),
    rawDelta: clean({ initialize: 157, tools_list: 154 }),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.decision, "copy_hypothesis_rejected_but_workflow_runtime_reach_unproven");
  assert.equal((result.boundary as Record<string, unknown>).attributable_runtime_tools_list, 0);
});

test("distinguishes attributable runtime reach with no valid call", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41 }),
    attributableRuntimeDelta: clean({ tools_list: 3 }),
    rawDelta: clean({ initialize: 157, tools_list: 154 }),
  });
  assert.equal(result.decision, "copy_hypothesis_rejected_after_attributable_runtime_reach");
});

test("freezes the first terminal boundary on later reports", () => {
  const completed = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41 }),
    rawDelta: clean({ initialize: 157, tools_list: 154 }),
  });
  const later = update({
    observedAt: "2026-07-22T03:00:00Z",
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 47, tools_list: 45, payment_required: 1 }),
    rawDelta: clean({ initialize: 161, tools_list: 158, payment_required: 1 }),
    previous: { id: "mcp-selection-preview-parity-v2", ...completed },
  });
  assert.equal(later.status, "completed");
  assert.deepEqual(later.boundary, completed.boundary);
  assert.equal(later.decision, completed.decision);
});

test("paid success dominates every other terminal signal", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({
      initialize: 43,
      tools_list: 41,
      validation_error: 1,
      capacity_rejected: 1,
      payment_required: 1,
      payment_present: 2,
      paid_success: 1,
      paid_error: 1,
    }),
    attributableRuntimeDelta: clean({ tools_list: 3, validation_error: 1 }),
    rawDelta: clean({
      initialize: 157,
      tools_list: 154,
      validation_error: 1,
      capacity_rejected: 1,
      payment_required: 1,
      payment_present: 2,
      paid_success: 1,
      paid_error: 1,
    }),
  });
  assert.equal(result.decision, "paid_conversion_observed");
});

test("holds a paid error as ambiguous between execution and settlement", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41, payment_present: 1, paid_error: 1 }),
    rawDelta: clean({ initialize: 157, tools_list: 154, payment_present: 1, paid_error: 1 }),
  });
  assert.equal(result.decision, "paid_execution_or_settlement_error_observed");
});

test("holds an unmatched payment presentation as an unresolved outcome", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41, payment_present: 1 }),
    rawDelta: clean({ initialize: 157, tools_list: 154, payment_present: 1 }),
  });
  assert.equal(result.decision, "signed_payment_outcome_unresolved");
});

test("does not mislabel a signed Flake capacity rejection as payment friction", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41, capacity_rejected: 1, payment_present: 1 }),
    rawDelta: clean({ initialize: 157, tools_list: 154, capacity_rejected: 1, payment_present: 1 }),
  });
  assert.equal(result.decision, "service_capacity_friction_after_valid_call");
});

test("classifies an unsigned valid call as payment-handoff interest", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41, payment_required: 1 }),
    rawDelta: clean({ initialize: 157, tools_list: 154, payment_required: 1 }),
  });
  assert.equal(result.decision, "valid_call_interest_observed_without_payment_presentation");
});

test("distinguishes attributable schema friction from copy rejection", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41, validation_error: 1 }),
    attributableRuntimeDelta: clean({ tools_list: 3, validation_error: 1 }),
    rawDelta: clean({ initialize: 157, tools_list: 154, validation_error: 1 }),
  });
  assert.equal(result.decision, "schema_friction_after_attributable_runtime_selection");
});

test("holds on unattributed input friction instead of declaring copy failure", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41, validation_error: 1 }),
    rawDelta: clean({ initialize: 157, tools_list: 154, validation_error: 1 }),
  });
  assert.equal(result.decision, "input_friction_observed_without_attributable_runtime");
});

test("classifies a buyer-candidate protocol failure before declaring copy rejection", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41, protocol_error: 1 }),
    rawDelta: clean({ initialize: 157, tools_list: 154, protocol_error: 1 }),
  });
  assert.equal(result.decision, "mcp_protocol_friction_observed");
});

test("classifies an unknown-tool attempt as an invocation without claiming session attribution", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41, tool_not_found: 1 }),
    rawDelta: clean({ initialize: 157, tools_list: 154, tool_not_found: 1 }),
  });
  assert.equal(result.decision, "unknown_tool_invocation_observed");
  assert.equal((result.event_ratios as Record<string, unknown>).invalid_call_share_percent, 100);
});

test("known-tool input evidence outranks unrelated unknown-tool and protocol failures", () => {
  const result = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({
      initialize: 43,
      tools_list: 41,
      protocol_error: 1,
      tool_not_found: 1,
      validation_error: 1,
    }),
    rawDelta: clean({
      initialize: 157,
      tools_list: 154,
      protocol_error: 1,
      tool_not_found: 1,
      validation_error: 1,
    }),
  });
  assert.equal(result.decision, "input_friction_observed_without_attributable_runtime");
});

test("migrates an in-flight schema-one report without losing its active epoch", () => {
  const schemaTwo = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 2, tools_list: 2 }),
    attributableRuntimeDelta: clean({ tools_list: 1 }),
  });
  const schemaOne = structuredClone(schemaTwo) as Record<string, any>;
  schemaOne.accounting_schema_version = 1;
  for (const field of ["raw_delta", "delta", "eligible_delta", "ineligible_or_draining_delta", "clean_completed_delta", "clean_active_epoch_delta"]) {
    delete schemaOne[field].paid_error;
    delete schemaOne[field].protocol_error;
    delete schemaOne[field].tool_not_found;
  }
  delete schemaOne.attributable_runtime_completed;
  delete schemaOne.attributable_runtime_active;
  delete schemaOne.attributable_runtime;

  const migrated = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 3, tools_list: 3 }),
    attributableRuntimeDelta: clean({ tools_list: 2 }),
    rawDelta: clean({ initialize: 117, tools_list: 116 }),
    previous: { id: "mcp-selection-preview-parity-v2", ...schemaOne },
  });
  assert.equal(migrated.accounting_schema_version, 3);
  assert.equal(migrated.attributable_runtime_tools_list, 2);
  assert.equal((migrated.eligible_delta as SelectionExperimentCounters).tools_list, 112);
});

test("migrates an in-flight schema-two report with new failure counters at zero", () => {
  const schemaThree = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 2, tools_list: 2 }),
    attributableRuntimeDelta: clean({ tools_list: 1 }),
  });
  const schemaTwo = structuredClone(schemaThree) as Record<string, any>;
  schemaTwo.accounting_schema_version = 2;
  for (const field of ["raw_delta", "delta", "eligible_delta", "ineligible_or_draining_delta", "clean_completed_delta", "clean_active_epoch_delta", "attributable_runtime_completed", "attributable_runtime_active", "attributable_runtime"]) {
    delete schemaTwo[field].protocol_error;
    delete schemaTwo[field].tool_not_found;
  }

  const migrated = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 3, tools_list: 3, tool_not_found: 1 }),
    attributableRuntimeDelta: clean({ tools_list: 2 }),
    rawDelta: clean({ initialize: 117, tools_list: 116, tool_not_found: 1 }),
    previous: { id: "mcp-selection-preview-parity-v2", ...schemaTwo },
  });
  assert.equal(migrated.accounting_schema_version, 3);
  assert.equal((migrated.eligible_delta as SelectionExperimentCounters).tool_not_found, 1);
  assert.equal(migrated.decision, "awaiting_eligible_tools_list_target");
});
