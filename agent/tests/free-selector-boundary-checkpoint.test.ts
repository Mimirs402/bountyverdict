import assert from "node:assert/strict";
import test from "node:test";
import { captureTrustedFunnelBaseline } from "../src/funnel-epoch.ts";
import { checkpointFreeSelectorBoundary } from "../src/free-selector-boundary-checkpoint.ts";
import { createFunnelSnapshot } from "../src/funnel-telemetry.ts";
import {
  CATALOG_FREE_PROOF_EXPERIMENT_ID,
  FREE_SELECTION_CATALOG_EXPERIMENT_ID,
  FREE_SELECTION_ROUTER_EXPERIMENT_ID,
  zeroTaskLeadingDescriptionCounters,
} from "../src/task-leading-description-experiment.ts";

const activatedAt = "2026-07-28T13:23:21.142Z";
const activation = {
  schema_version: 1,
  experiment_id: FREE_SELECTION_ROUTER_EXPERIMENT_ID,
  release_commit: "1".repeat(40),
  production_activation_commit: "2".repeat(40),
  production_activated_at: "2026-07-28T12:43:26.241Z",
  drain_rotation_id: "free-selection-router-v1-release-20260728",
  measurement_epoch_id: 58,
  epoch_activated_at: activatedAt,
  target_tools_list: 25,
} as const;

function fixture(toolsList: number) {
  const baselineState = createFunnelSnapshot("2026-07-20T20:51:34.014Z");
  baselineState.updated_at = activatedAt;
  baselineState.collector_heartbeat_at = activatedAt;
  const baseline = captureTrustedFunnelBaseline(
    baselineState,
    activatedAt,
    "A sufficiently descriptive free selector test measurement boundary.",
    58,
  );
  const current = structuredClone(baselineState);
  current.updated_at = "2026-07-28T14:20:00.000Z";
  current.collector_heartbeat_at = "2026-07-28T14:19:59.000Z";
  current.mcp_by_source.unknown.initialize = toolsList;
  current.mcp_by_source.unknown.tools_list = toolsList;
  current.mcp_by_source.unknown.events = toolsList * 2;
  current.mcp_by_product_source.single.unknown.initialize = toolsList;
  current.mcp_by_product_source.single.unknown.tools_list = toolsList;
  current.mcp_by_product_source.single.unknown.events = toolsList * 2;
  current.mcp_by_channel.direct_or_hidden.initialize = toolsList;
  current.mcp_by_channel.direct_or_hidden.tools_list = toolsList;
  current.mcp_by_channel.direct_or_hidden.events = toolsList * 2;
  current.mcp_totals.initialize = toolsList;
  current.mcp_totals.tools_list = toolsList;
  current.mcp_totals.events = toolsList * 2;
  return {
    observedAt: "2026-07-28T14:20:01.000Z",
    funnelState: current,
    trustedBaseline: baseline,
    trustedLedger: {
      schema_version: 2,
      active_epoch_id: 58,
      epochs: [{
        id: 58,
        status: "active",
        conversion_eligible: true,
        started_at: activatedAt,
        baseline,
      }],
      rotation: {
        id: activation.drain_rotation_id,
        status: "activated",
        target_epoch_id: 58,
        activated_at: activatedAt,
      },
    },
    activation,
    previous: null,
  };
}

function advancePastMeasurement(
  input: ReturnType<typeof fixture>,
  previous: Record<string, unknown>,
) {
  const nextStartedAt = "2026-07-28T15:00:00.000Z";
  const nextState = structuredClone(input.funnelState);
  nextState.updated_at = nextStartedAt;
  nextState.collector_heartbeat_at = nextStartedAt;
  const nextBaseline = captureTrustedFunnelBaseline(
    nextState,
    nextStartedAt,
    "A stable clean epoch after the boundary audit rotation completed.",
    59,
  );
  input.observedAt = "2026-07-28T15:01:00.000Z";
  input.trustedBaseline = nextBaseline;
  input.trustedLedger.epochs[0].status = "closed";
  input.trustedLedger.epochs[0].conversion_eligible = false;
  Object.assign(input.trustedLedger.epochs[0], { ended_at: nextStartedAt });
  input.trustedLedger.epochs.push({
    id: 59,
    status: "active",
    conversion_eligible: true,
    started_at: nextStartedAt,
    baseline: nextBaseline,
  });
  input.trustedLedger.active_epoch_id = 59;
  input.trustedLedger.rotation = {
    id: "marketplace-audit-epoch-59",
    status: "activated",
    target_epoch_id: 59,
    activated_at: nextStartedAt,
  };
  input.previous = previous;
  return input;
}

test("local free-selector checkpoint waits without marketplace retrieval", () => {
  const result = checkpointFreeSelectorBoundary(fixture(9));
  assert.equal(result.audit_ready, false);
  assert.equal(result.tools_list, 9);
  assert.equal(result.remaining_tools_list, 16);
  assert.equal(result.experiment.status, "running_clean_epoch");
  assert.deepEqual(result.experiment.eligible_delta, {
    ...zeroTaskLeadingDescriptionCounters(),
    initialize: 9,
    tools_list: 9,
  });
});

test("local free-selector checkpoint freezes the first observation at or above 25", () => {
  const result = checkpointFreeSelectorBoundary(fixture(26));
  assert.equal(result.audit_ready, true);
  assert.equal(result.tools_list, 26);
  assert.equal(result.remaining_tools_list, 0);
  assert.equal(result.experiment.status, "completed");
  assert.equal(result.experiment.decision, "catalog_reach_only_without_downstream_call");
});

test("local free-selector checkpoint never audits after the clean epoch closes", () => {
  const input = fixture(26);
  input.trustedLedger.epochs[0].status = "closed";
  input.trustedLedger.epochs[0].conversion_eligible = false;
  const result = checkpointFreeSelectorBoundary(input);
  assert.equal(result.audit_ready, false);
  assert.equal(result.experiment.status, "paused_audited_drain");
});

test("a valid frozen checkpoint permits an idempotent audit retry after its epoch closes", () => {
  const initial = fixture(25);
  const frozen = checkpointFreeSelectorBoundary(initial);
  assert.equal(frozen.audit_ready, true);
  const retry = checkpointFreeSelectorBoundary(advancePastMeasurement(
    fixture(25),
    frozen.experiment,
  ));
  assert.equal(retry.audit_ready, true);
  assert.equal(retry.experiment.status, "completed");
  assert.deepEqual(retry.experiment.boundary, frozen.experiment.boundary);
});

test("an incomplete checkpoint stays fail-closed after its epoch closes", () => {
  const initial = fixture(24);
  const incomplete = checkpointFreeSelectorBoundary(initial);
  assert.equal(incomplete.audit_ready, false);
  const retry = checkpointFreeSelectorBoundary(advancePastMeasurement(
    fixture(24),
    incomplete.experiment,
  ));
  assert.equal(retry.audit_ready, false);
  assert.equal(retry.experiment.status, "measurement_epoch_closed_before_target");
});

test("a drifted frozen checkpoint stays fail-closed after its epoch closes", () => {
  const initial = fixture(25);
  const frozen = checkpointFreeSelectorBoundary(initial);
  const drifted = structuredClone(frozen.experiment);
  (drifted.boundary as Record<string, any>).measurement_epoch_id = 999;
  const retry = checkpointFreeSelectorBoundary(advancePastMeasurement(
    fixture(25),
    drifted,
  ));
  assert.equal(retry.audit_ready, false);
});

test("a frozen checkpoint cannot retry against drifted historical epoch coordinates", () => {
  const initial = fixture(25);
  const frozen = checkpointFreeSelectorBoundary(initial);
  const retryInput = advancePastMeasurement(fixture(25), frozen.experiment);
  retryInput.trustedLedger.epochs[0].started_at = "2026-07-28T13:24:00.000Z";
  const retry = checkpointFreeSelectorBoundary(retryInput);
  assert.equal(retry.audit_ready, false);
});

test("a frozen checkpoint cannot retry in the same epoch under an unrelated rotation", () => {
  const initial = fixture(25);
  const frozen = checkpointFreeSelectorBoundary(initial);
  const retryInput = fixture(25);
  retryInput.previous = frozen.experiment;
  retryInput.trustedLedger.rotation = {
    id: "unrelated-audit-rotation-999",
    status: "activated",
    target_epoch_id: 999,
    activated_at: retryInput.observedAt,
  };
  const retry = checkpointFreeSelectorBoundary(retryInput);
  assert.equal(retry.audit_ready, false);
});

test("a frozen checkpoint cannot retry with drifted current baseline coordinates", () => {
  const initial = fixture(25);
  const frozen = checkpointFreeSelectorBoundary(initial);
  const retryInput = advancePastMeasurement(fixture(25), frozen.experiment);
  retryInput.trustedLedger.epochs[1].baseline = {
    ...retryInput.trustedLedger.epochs[1].baseline,
    epoch_id: 999,
    initialized_at: "2026-07-28T15:00:01.000Z",
  };
  const retry = checkpointFreeSelectorBoundary(retryInput);
  assert.equal(retry.audit_ready, false);
});

test("local catalog checkpoint uses the fresh catalog identity without network activity", () => {
  const input = fixture(12) as ReturnType<typeof fixture> & { experimentId?: typeof FREE_SELECTION_CATALOG_EXPERIMENT_ID };
  input.experimentId = FREE_SELECTION_CATALOG_EXPERIMENT_ID;
  input.activation = {
    ...input.activation,
    experiment_id: FREE_SELECTION_CATALOG_EXPERIMENT_ID,
    drain_rotation_id: "free-selection-catalog-v2-clean-20260729",
  } as typeof input.activation;
  input.trustedLedger.rotation.id = input.activation.drain_rotation_id;
  const result = checkpointFreeSelectorBoundary(input);
  assert.equal(result.audit_ready, false);
  assert.equal(result.tools_list, 12);
  assert.equal(result.experiment.id, FREE_SELECTION_CATALOG_EXPERIMENT_ID);
  assert.equal(result.experiment.status, "running_clean_epoch");
});

test("local catalog free-proof checkpoint freezes only its exact fresh identity", () => {
  const input = fixture(25) as ReturnType<typeof fixture> & { experimentId?: typeof CATALOG_FREE_PROOF_EXPERIMENT_ID };
  input.experimentId = CATALOG_FREE_PROOF_EXPERIMENT_ID;
  input.activation = {
    ...input.activation,
    experiment_id: CATALOG_FREE_PROOF_EXPERIMENT_ID,
    drain_rotation_id: "catalog-free-proof-v1-clean-20260729",
  } as typeof input.activation;
  input.trustedLedger.rotation.id = input.activation.drain_rotation_id;
  const result = checkpointFreeSelectorBoundary(input);
  assert.equal(result.audit_ready, true);
  assert.equal(result.tools_list, 25);
  assert.equal(result.experiment.id, CATALOG_FREE_PROOF_EXPERIMENT_ID);
  assert.equal(
    (result.experiment.boundary as Record<string, unknown>).observation_rule,
    "first_monitor_report_at_or_above_25_eligible_catalog_free_proof_tools_list_events",
  );
});
