import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
  TASK_LEADING_DESCRIPTION_COUNTER_KEYS,
  TASK_LEADING_DESCRIPTION_EXPERIMENT_ID,
  updateTaskLeadingDescriptionExperiment,
  zeroTaskLeadingDescriptionCounters,
  type TaskLeadingDescriptionActivation,
  type TaskLeadingDescriptionCounters,
} from "../src/task-leading-description-experiment.ts";

const activation: TaskLeadingDescriptionActivation = {
  schema_version: 1,
  experiment_id: TASK_LEADING_DESCRIPTION_EXPERIMENT_ID,
  release_commit: "1".repeat(40),
  production_activation_commit: "2".repeat(40),
  production_activated_at: "2026-07-22T15:00:00.000Z",
  drain_rotation_id: "task-leading-release-20260722",
  measurement_epoch_id: 47,
  epoch_activated_at: "2026-07-22T15:20:00.000Z",
  target_tools_list: 25,
};

const rotation = {
  id: activation.drain_rotation_id,
  status: "activated",
  target_epoch_id: activation.measurement_epoch_id,
  activated_at: activation.epoch_activated_at,
};

const clean = (overrides: Partial<TaskLeadingDescriptionCounters> = {}): TaskLeadingDescriptionCounters => ({
  ...zeroTaskLeadingDescriptionCounters(),
  ...overrides,
});

const update = (overrides: Record<string, unknown> = {}) => updateTaskLeadingDescriptionExperiment({
  observedAt: "2026-07-22T15:30:00.000Z",
  activation,
  currentEpochId: 47,
  measurementEligible: true,
  cleanEpochDelta: clean(),
  trustedBaselineInitializedAt: activation.epoch_activated_at,
  trustedRotation: rotation,
  previous: null,
  ...overrides,
});

test("fails closed at a frozen zero prefix until reviewed activation coordinates are supplied", () => {
  const result = update({
    activation: null,
    cleanEpochDelta: clean({ tools_list: 100, payment_required: 2 }),
    previous: {
      id: TASK_LEADING_DESCRIPTION_EXPERIMENT_ID,
      accounting_schema_version: 1,
      activation: null,
      eligible_delta: clean({ tools_list: 100, payment_required: 2 }),
    },
  });
  assert.equal(result.status, "awaiting_activation_coordinates");
  assert.equal(result.activation_required, true);
  assert.deepEqual(result.eligible_prefix, clean());
  assert.deepEqual(result.eligible_delta, clean());
  assert.equal(result.remaining_eligible_tools_list, 25);
});

test("activation parser requires exact release, production, drain, epoch, and N=25 coordinates", () => {
  assert.deepEqual(parseTaskLeadingDescriptionActivation(activation), activation);
  assert.throws(() => parseTaskLeadingDescriptionActivation({ ...activation, release_commit: "pending" }), /commits are invalid/);
  assert.throws(() => parseTaskLeadingDescriptionActivation({ ...activation, measurement_epoch_id: 0 }), /measurement epoch is invalid/);
  assert.throws(() => parseTaskLeadingDescriptionActivation({ ...activation, target_tools_list: 26 }), /frozen 25/);
  assert.throws(() => parseTaskLeadingDescriptionActivation({
    ...activation,
    production_activated_at: "2026-07-22T16:00:00.000Z",
  }), /predates production activation/);
  assert.throws(() => parseTaskLeadingDescriptionActivation({ ...activation, unexpected: true }), /fields are invalid/);
});

test("a v3 question-shaped treatment is isolated from the completed v2 experiment", () => {
  const questionActivation = {
    ...activation,
    experiment_id: AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID,
    drain_rotation_id: "mcp_agent_questions_v3_20260722",
    measurement_epoch_id: 51,
  } as const;
  assert.deepEqual(
    parseTaskLeadingDescriptionActivation(
      questionActivation,
      AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID,
    ),
    questionActivation,
  );
  assert.throws(
    () => parseTaskLeadingDescriptionActivation(questionActivation),
    /activation identity is invalid/,
  );
  const result = updateTaskLeadingDescriptionExperiment({
    experimentId: AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID,
    observedAt: "2026-07-22T16:00:00.000Z",
    activation: null,
    currentEpochId: 50,
    measurementEligible: false,
    cleanEpochDelta: clean({ tools_list: 25 }),
    trustedBaselineInitializedAt: activation.epoch_activated_at,
    trustedRotation: null,
    previous: null,
  });
  assert.equal(result.id, AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID);
  assert.equal(result.status, "awaiting_activation_coordinates");
  assert.deepEqual(result.eligible_delta, clean());
});

test("review template cannot accidentally activate the experiment", async () => {
  const template = JSON.parse(await readFile(
    new URL("../config/task-leading-description-experiment.activation.template.json", import.meta.url),
    "utf8",
  ));
  assert.equal(template.experiment_id, TASK_LEADING_DESCRIPTION_EXPERIMENT_ID);
  assert.equal(template.target_tools_list, 25);
  assert.equal(template.measurement_epoch_id, 0);
  assert.throws(() => parseTaskLeadingDescriptionActivation(template), /commits are invalid/);
});

test("does not count pre-release, mismatched, or still-draining epoch traffic", () => {
  const beforeEpoch = update({ currentEpochId: 46, cleanEpochDelta: clean({ tools_list: 30 }) });
  assert.equal(beforeEpoch.status, "awaiting_matching_fresh_epoch");
  assert.deepEqual(beforeEpoch.eligible_delta, clean());

  const mismatchedRotation = update({
    trustedRotation: { ...rotation, id: "different-drain-rotation" },
    cleanEpochDelta: clean({ tools_list: 30 }),
  });
  assert.equal(mismatchedRotation.status, "activation_coordinates_unverified");
  assert.deepEqual(mismatchedRotation.eligible_delta, clean());

  const mismatchedBaseline = update({
    trustedBaselineInitializedAt: "2026-07-22T15:21:00.000Z",
    cleanEpochDelta: clean({ tools_list: 30 }),
  });
  assert.equal(mismatchedBaseline.status, "activation_coordinates_unverified");
  assert.deepEqual(mismatchedBaseline.eligible_delta, clean());

  const draining = update({ measurementEligible: false, cleanEpochDelta: clean({ tools_list: 30 }) });
  assert.equal(draining.status, "paused_audited_drain");
  assert.deepEqual(draining.eligible_delta, clean());
});

test("starts only on the exact fresh eligible epoch and carries every privacy-safe counter", () => {
  const eligible = clean({ initialize: 4, tools_list: 3, protocol_error: 1, tool_not_found: 1,
    validation_error: 1, capacity_rejected: 1, payment_required: 1, payment_present: 1,
    paid_success: 1, paid_error: 1 });
  const result = update({ cleanEpochDelta: eligible });
  assert.equal(result.status, "running_clean_epoch");
  assert.equal(result.activation_verified, true);
  assert.deepEqual(result.eligible_delta, eligible);
  assert.deepEqual(Object.keys(result.eligible_delta as object), [...TASK_LEADING_DESCRIPTION_COUNTER_KEYS]);
});

test("same-epoch refresh replaces rather than double counts and rejects regression", () => {
  const first = update({ cleanEpochDelta: clean({ tools_list: 4 }) });
  const previous = first;
  const second = update({
    activation: null,
    cleanEpochDelta: clean({ tools_list: 6 }),
    previous,
  });
  assert.equal((second.eligible_delta as TaskLeadingDescriptionCounters).tools_list, 6);
  assert.throws(() => update({
    cleanEpochDelta: clean({ tools_list: 3 }),
    previous,
  }), /regressed/);
});

test("freezes the first report at or above 25 tools/list events", () => {
  const completed = update({ cleanEpochDelta: clean({ tools_list: 26, payment_required: 1 }) });
  const later = update({
    observedAt: "2026-07-22T15:40:00.000Z",
    cleanEpochDelta: clean({ tools_list: 40, payment_required: 2, paid_success: 1 }),
    previous: completed,
  });
  assert.equal(completed.status, "completed");
  assert.equal(
    (completed.boundary as Record<string, unknown>).observation_rule,
    "first_monitor_report_at_or_above_25_eligible_task_leading_description_tools_list_events",
  );
  assert.deepEqual(later.boundary, completed.boundary);
  assert.deepEqual(later.eligible_delta, completed.eligible_delta);
  assert.deepEqual(later.event_ratios, completed.event_ratios);
  assert.equal(later.decision, "known_valid_tool_interest_observed_without_task_copy_attribution");
});

test("does not blend a later epoch into an unfinished fresh-epoch sample", () => {
  const running = update({ cleanEpochDelta: clean({ tools_list: 10 }) });
  const later = update({
    currentEpochId: 48,
    cleanEpochDelta: clean({ tools_list: 40, paid_success: 1 }),
    trustedBaselineInitializedAt: "2026-07-22T16:00:00.000Z",
    trustedRotation: null,
    previous: running,
  });
  assert.equal(later.status, "measurement_epoch_closed_before_target");
  assert.equal(later.decision, "fresh_epoch_closed_before_target");
  assert.equal((later.eligible_delta as TaskLeadingDescriptionCounters).tools_list, 10);
});

test("reports a history gap when the configured fresh epoch was never observed", () => {
  const result = update({
    currentEpochId: 48,
    cleanEpochDelta: clean({ tools_list: 30 }),
    trustedBaselineInitializedAt: "2026-07-22T16:00:00.000Z",
    trustedRotation: null,
  });
  assert.equal(result.status, "measurement_history_gap");
  assert.equal(result.decision, "manual_reconciliation_required_fresh_epoch_was_not_observed");
  assert.deepEqual(result.eligible_delta, clean());
});

test("persisted activation is immutable and survives removal of the activation file", () => {
  const running = update({ cleanEpochDelta: clean({ tools_list: 5 }) });
  const continued = update({ activation: null, cleanEpochDelta: clean({ tools_list: 7 }), previous: running });
  assert.equal((continued.eligible_delta as TaskLeadingDescriptionCounters).tools_list, 7);
  assert.deepEqual(continued.activation, activation);
  assert.throws(() => update({
    activation: { ...activation, release_commit: "3".repeat(40) },
    previous: running,
  }), /activation changed/);
});

test("never claims session-level or causal copy conversion", () => {
  const result = update({ cleanEpochDelta: clean({ tools_list: 25, paid_success: 1 }) });
  assert.equal(result.causal_copy_claim, false);
  assert.equal((result.boundary as Record<string, unknown>).causal_copy_claim, false);
  assert.match(String(result.causality_limit), /no session, exposure, or retry linkage/);
  assert.match(String(result.causality_limit), /never reports a causal copy conversion rate/);
  assert.equal(result.decision, "paid_conversion_observed_without_task_copy_attribution");
});

test("rejects malformed persisted counters even after completion", () => {
  const completed = update({ cleanEpochDelta: clean({ tools_list: 25 }) });
  assert.throws(() => update({
    currentEpochId: 48,
    trustedBaselineInitializedAt: "2026-07-22T16:00:00.000Z",
    trustedRotation: null,
    previous: {
      ...completed,
      boundary: {
        ...(completed.boundary as Record<string, unknown>),
        eligible_delta: { ...(completed.eligible_delta as TaskLeadingDescriptionCounters), paid_success: -1 },
      },
    },
  }), /frozen boundary eligible paid_success is invalid/);
});
