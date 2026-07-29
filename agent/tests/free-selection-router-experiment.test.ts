import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  activationFromVerifiedFreeSelectionEpoch,
  type FreeSelectionRouterReleaseCoordinates,
} from "../src/free-selection-router-experiment.ts";
import {
  CATALOG_FREE_PROOF_EXPERIMENT_ID,
  FREE_SELECTION_CATALOG_EXPERIMENT_ID,
  FREE_SELECTION_ROUTER_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
  updateTaskLeadingDescriptionExperiment,
  zeroTaskLeadingDescriptionCounters,
} from "../src/task-leading-description-experiment.ts";

const activatedAt = "2026-07-28T10:20:00.000Z";
const coordinates: FreeSelectionRouterReleaseCoordinates = {
  releaseCommit: "1".repeat(40),
  productionActivationCommit: "2".repeat(40),
  productionActivatedAt: "2026-07-28T10:00:00.000Z",
  drainRotationId: "free_router_release_epoch_60",
};
const ledger = {
  schema_version: 2,
  active_epoch_id: 60,
  epochs: [{
    id: 60,
    status: "active",
    started_at: activatedAt,
    conversion_eligible: true,
    baseline: { epoch_id: 60, initialized_at: activatedAt },
  }],
  rotation: {
    id: coordinates.drainRotationId,
    status: "activated",
    target_epoch_id: 60,
    activated_at: activatedAt,
  },
};

test("derives a free router activation only from the exact post-release clean epoch", () => {
  const activation = activationFromVerifiedFreeSelectionEpoch(ledger, coordinates);
  assert.equal(activation?.experiment_id, FREE_SELECTION_ROUTER_EXPERIMENT_ID);
  assert.equal(activation?.release_commit, coordinates.releaseCommit);
  assert.equal(activation?.production_activation_commit, coordinates.productionActivationCommit);
  assert.equal(activation?.measurement_epoch_id, 60);
  assert.equal(activation?.epoch_activated_at, activatedAt);
  assert.equal(
    activationFromVerifiedFreeSelectionEpoch(
      { ...ledger, rotation: { ...ledger.rotation, status: "draining" } },
      coordinates,
    ),
    null,
  );
  assert.equal(
    activationFromVerifiedFreeSelectionEpoch(
      { ...ledger, rotation: { ...ledger.rotation, id: "different_rotation" } },
      coordinates,
    ),
    null,
  );
  assert.throws(
    () => activationFromVerifiedFreeSelectionEpoch({ ...ledger, active_epoch_id: 61 }, coordinates),
    /no longer the active measurement epoch/,
  );
  assert.throws(
    () => activationFromVerifiedFreeSelectionEpoch({
      ...ledger,
      epochs: [{ ...ledger.epochs[0], conversion_eligible: false }],
    }, coordinates),
    /does not match/,
  );
});

test("zero-argument catalog activation has a distinct immutable experiment identity", () => {
  const activation = activationFromVerifiedFreeSelectionEpoch(
    ledger,
    coordinates,
    FREE_SELECTION_CATALOG_EXPERIMENT_ID,
  );
  assert.equal(activation?.experiment_id, FREE_SELECTION_CATALOG_EXPERIMENT_ID);
  assert.equal(activation?.measurement_epoch_id, 60);
  assert.throws(
    () => parseTaskLeadingDescriptionActivation(activation, FREE_SELECTION_ROUTER_EXPERIMENT_ID),
    /identity is invalid/,
  );
});

test("catalog free-proof activation has a distinct immutable experiment identity", () => {
  const activation = activationFromVerifiedFreeSelectionEpoch(
    ledger,
    coordinates,
    CATALOG_FREE_PROOF_EXPERIMENT_ID,
  );
  assert.equal(activation?.experiment_id, CATALOG_FREE_PROOF_EXPERIMENT_ID);
  assert.equal(activation?.measurement_epoch_id, 60);
  assert.throws(
    () => parseTaskLeadingDescriptionActivation(activation, FREE_SELECTION_CATALOG_EXPERIMENT_ID),
    /identity is invalid/,
  );
});

test("catalog free-proof experiment classifies the first valid paid-tool invocation", () => {
  const activation = activationFromVerifiedFreeSelectionEpoch(
    ledger,
    coordinates,
    CATALOG_FREE_PROOF_EXPERIMENT_ID,
  )!;
  const counters = {
    ...zeroTaskLeadingDescriptionCounters(),
    initialize: 25,
    tools_list: 25,
    payment_required: 1,
  };
  const result = updateTaskLeadingDescriptionExperiment({
    experimentId: CATALOG_FREE_PROOF_EXPERIMENT_ID,
    observedAt: "2026-07-28T11:00:00.000Z",
    activation,
    currentEpochId: 60,
    measurementEligible: true,
    cleanEpochDelta: counters,
    trustedBaselineInitializedAt: activatedAt,
    trustedRotation: ledger.rotation,
    previous: null,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.decision, "valid_tool_interest_observed_after_catalog_free_proof");
  assert.equal(
    (result.boundary as Record<string, unknown>).observation_rule,
    "first_monitor_report_at_or_above_25_eligible_catalog_free_proof_tools_list_events",
  );
  assert.equal(result.causal_copy_claim, false);
});

test("free router measurement starts at zero and freezes one bounded selector outcome", () => {
  const activation = activationFromVerifiedFreeSelectionEpoch(ledger, coordinates)!;
  const counters = {
    ...zeroTaskLeadingDescriptionCounters(),
    initialize: 25,
    tools_list: 25,
    selection_preview: 1,
  };
  const result = updateTaskLeadingDescriptionExperiment({
    experimentId: FREE_SELECTION_ROUTER_EXPERIMENT_ID,
    observedAt: "2026-07-28T11:00:00.000Z",
    activation,
    currentEpochId: 60,
    measurementEligible: true,
    cleanEpochDelta: counters,
    trustedBaselineInitializedAt: activatedAt,
    trustedRotation: ledger.rotation,
    previous: null,
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.eligible_prefix, zeroTaskLeadingDescriptionCounters());
  assert.deepEqual(result.eligible_delta, counters);
  assert.equal(result.decision, "free_selection_preview_observed");
  assert.equal(
    (result.boundary as Record<string, unknown>).observation_rule,
    "first_monitor_report_at_or_above_25_eligible_free_selection_router_tools_list_events",
  );
  assert.equal(result.causal_copy_claim, false);
});

test("free router activation template cannot be mistaken for live coordinates", async () => {
  const template = JSON.parse(await readFile(
    new URL("../config/free-selection-router-experiment.activation.template.json", import.meta.url),
    "utf8",
  ));
  assert.equal(template.experiment_id, FREE_SELECTION_ROUTER_EXPERIMENT_ID);
  assert.equal(template.measurement_epoch_id, 0);
  assert.throws(
    () => parseTaskLeadingDescriptionActivation(template, FREE_SELECTION_ROUTER_EXPERIMENT_ID),
    /commits are invalid/,
  );
});
