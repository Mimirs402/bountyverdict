import {
  trustedFunnelBaseline,
  trustedMcpDelta,
} from "./funnel-epoch.ts";
import { loadFunnelSnapshot } from "./funnel-telemetry.ts";
import {
  FREE_SELECTION_ROUTER_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
  updateTaskLeadingDescriptionExperiment,
} from "./task-leading-description-experiment.ts";

export type FreeSelectorBoundaryCheckpointInput = {
  observedAt: string;
  funnelState: unknown;
  trustedBaseline: unknown;
  trustedLedger: unknown;
  activation: unknown;
  previous: unknown;
};

export type FreeSelectorBoundaryCheckpoint = {
  audit_ready: boolean;
  tools_list: number;
  remaining_tools_list: number;
  experiment: Record<string, unknown>;
};

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

export function checkpointFreeSelectorBoundary(
  input: FreeSelectorBoundaryCheckpointInput,
): FreeSelectorBoundaryCheckpoint {
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    throw new Error("Free selector boundary observation time is invalid.");
  }
  const funnel = loadFunnelSnapshot(input.funnelState);
  if (!funnel) throw new Error("Free selector boundary funnel state is malformed.");
  const baseline = trustedFunnelBaseline(input.trustedBaseline);
  if (!baseline?.mcp) throw new Error("Free selector boundary trusted MCP baseline is missing.");
  const activation = parseTaskLeadingDescriptionActivation(
    input.activation,
    FREE_SELECTION_ROUTER_EXPERIMENT_ID,
  );
  if (!activation) throw new Error("Free selector boundary activation is missing.");

  const ledger = record(input.trustedLedger, "Free selector boundary trusted ledger");
  if (ledger.schema_version !== 2 || !Number.isSafeInteger(ledger.active_epoch_id) ||
      !Array.isArray(ledger.epochs)) {
    throw new Error("Free selector boundary trusted ledger shape is invalid.");
  }
  const epoch = ledger.epochs.find((candidate: Record<string, unknown>) =>
    candidate?.id === activation.measurement_epoch_id);
  const activeEpoch = record(epoch, "Free selector boundary measurement epoch");
  const rotation = record(ledger.rotation, "Free selector boundary rotation");
  const exactActiveMeasurement =
    ledger.active_epoch_id === activation.measurement_epoch_id &&
    baseline.epoch_id === activation.measurement_epoch_id &&
    baseline.initialized_at === activation.epoch_activated_at &&
    activeEpoch.status === "active" &&
    activeEpoch.conversion_eligible === true &&
    activeEpoch.started_at === activation.epoch_activated_at &&
    rotation.id === activation.drain_rotation_id &&
    rotation.status === "activated" &&
    rotation.target_epoch_id === activation.measurement_epoch_id &&
    rotation.activated_at === activation.epoch_activated_at;
  const cleanDelta = trustedMcpDelta(funnel, baseline.mcp).buyer_candidate_totals;
  const experiment = updateTaskLeadingDescriptionExperiment({
    experimentId: FREE_SELECTION_ROUTER_EXPERIMENT_ID,
    observedAt: input.observedAt,
    activation,
    currentEpochId: Number(ledger.active_epoch_id),
    measurementEligible: exactActiveMeasurement,
    cleanEpochDelta: exactActiveMeasurement ? cleanDelta : null,
    trustedBaselineInitializedAt: baseline.initialized_at,
    trustedRotation: rotation,
    previous: input.previous,
  });
  const toolsList = Number((experiment.eligible_delta as Record<string, unknown>)?.tools_list || 0);
  const remaining = Number(experiment.remaining_eligible_tools_list);
  if (!Number.isSafeInteger(toolsList) || toolsList < 0 ||
      !Number.isSafeInteger(remaining) || remaining < 0) {
    throw new Error("Free selector boundary checkpoint counters are invalid.");
  }
  return {
    audit_ready: exactActiveMeasurement &&
      experiment.status === "completed" &&
      experiment.activation_verified === true &&
      experiment.boundary !== null,
    tools_list: toolsList,
    remaining_tools_list: remaining,
    experiment,
  };
}
