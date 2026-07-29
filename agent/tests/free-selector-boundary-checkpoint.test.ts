import assert from "node:assert/strict";
import test from "node:test";
import { captureTrustedFunnelBaseline } from "../src/funnel-epoch.ts";
import { checkpointFreeSelectorBoundary } from "../src/free-selector-boundary-checkpoint.ts";
import { createFunnelSnapshot } from "../src/funnel-telemetry.ts";
import {
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
