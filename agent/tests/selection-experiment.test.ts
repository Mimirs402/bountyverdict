import assert from "node:assert/strict";
import test from "node:test";
import { updateSelectionPreviewExperiment, type SelectionExperimentCounters } from "../src/selection-experiment.ts";

const prefix: SelectionExperimentCounters = {
  initialize: 110,
  tools_list: 109,
  validation_error: 6,
  capacity_rejected: 0,
  payment_required: 0,
  payment_present: 0,
  paid_success: 0,
};
const clean = (overrides: Partial<SelectionExperimentCounters> = {}): SelectionExperimentCounters => ({
  initialize: 0,
  tools_list: 0,
  validation_error: 0,
  capacity_rejected: 0,
  payment_required: 0,
  payment_present: 0,
  paid_success: 0,
  ...overrides,
});
const update = (overrides: Record<string, unknown> = {}) => updateSelectionPreviewExperiment({
  id: "mcp-selection-preview-parity-v2",
  observedAt: "2026-07-22T02:50:00Z",
  targetToolsList: 150,
  resumeEpochId: 37,
  eligiblePrefix: prefix,
  rawDelta: clean({ initialize: 114, tools_list: 113, validation_error: 6 }),
  currentEpochId: 36,
  measurementEligible: false,
  cleanEpochDelta: null,
  attributableRuntimeToolsList: 0,
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
    rawDelta: clean({ initialize: 118, tools_list: 116, validation_error: 7 }),
    previous: { id: "mcp-selection-preview-parity-v2", ...first },
  });
  assert.equal((second.eligible_delta as SelectionExperimentCounters).tools_list, 112);
  assert.equal((second.eligible_delta as SelectionExperimentCounters).validation_error, 7);
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
    rawDelta: clean({ initialize: 120, tools_list: 118, validation_error: 6 }),
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
    rawDelta: clean({ initialize: 122, tools_list: 119, validation_error: 6 }),
  });
  const epoch38 = update({
    currentEpochId: 38,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 2, tools_list: 2 }),
    attributableRuntimeToolsList: 1,
    rawDelta: clean({ initialize: 125, tools_list: 120, validation_error: 6 }),
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
    rawDelta: clean({ initialize: 157, tools_list: 154, validation_error: 6 }),
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
    attributableRuntimeToolsList: 3,
    rawDelta: clean({ initialize: 157, tools_list: 154, validation_error: 6 }),
  });
  assert.equal(result.decision, "copy_hypothesis_rejected_after_attributable_runtime_reach");
});

test("freezes the first terminal boundary on later reports", () => {
  const completed = update({
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 43, tools_list: 41 }),
    rawDelta: clean({ initialize: 157, tools_list: 154, validation_error: 6 }),
  });
  const later = update({
    observedAt: "2026-07-22T03:00:00Z",
    currentEpochId: 37,
    measurementEligible: true,
    cleanEpochDelta: clean({ initialize: 47, tools_list: 45, payment_required: 1 }),
    rawDelta: clean({ initialize: 161, tools_list: 158, validation_error: 6, payment_required: 1 }),
    previous: { id: "mcp-selection-preview-parity-v2", ...completed },
  });
  assert.equal(later.status, "completed");
  assert.deepEqual(later.boundary, completed.boundary);
  assert.equal(later.decision, completed.decision);
});
