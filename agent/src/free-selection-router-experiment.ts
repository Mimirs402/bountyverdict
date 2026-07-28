import {
  type DescriptionExperimentId,
  FREE_SELECTION_ROUTER_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
  TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
  type TaskLeadingDescriptionActivation,
} from "./task-leading-description-experiment.ts";

export type FreeSelectionRouterReleaseCoordinates = {
  releaseCommit: string;
  productionActivationCommit: string;
  productionActivatedAt: string;
  drainRotationId: string;
};

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

export function activationFromVerifiedFreeSelectionEpoch(
  value: unknown,
  coordinates: FreeSelectionRouterReleaseCoordinates,
  experimentId: DescriptionExperimentId = FREE_SELECTION_ROUTER_EXPERIMENT_ID,
): TaskLeadingDescriptionActivation | null {
  const ledger = record(value, "Trusted funnel epoch ledger");
  if (ledger.schema_version !== 2 || !Number.isSafeInteger(ledger.active_epoch_id) || !Array.isArray(ledger.epochs)) {
    throw new Error("Trusted funnel epoch ledger shape is invalid.");
  }
  const rotation = ledger.rotation;
  if (!rotation || typeof rotation !== "object" || Array.isArray(rotation)) return null;
  if (rotation.id !== coordinates.drainRotationId || rotation.status !== "activated") return null;
  if (!Number.isSafeInteger(rotation.target_epoch_id) || rotation.target_epoch_id < 1) {
    throw new Error("Free selection router rotation target is invalid.");
  }
  if (ledger.active_epoch_id !== rotation.target_epoch_id) {
    throw new Error("Verified free selection router rotation is no longer the active measurement epoch.");
  }
  if (typeof rotation.activated_at !== "string" || new Date(rotation.activated_at).toISOString() !== rotation.activated_at) {
    throw new Error("Verified free selection router rotation activation time is invalid.");
  }
  const epoch = ledger.epochs.find((candidate: Record<string, unknown>) => candidate?.id === rotation.target_epoch_id);
  const active = record(epoch, "Verified free selection router active epoch");
  const baseline = record(active.baseline, "Verified free selection router active baseline");
  if (active.status !== "active" || active.conversion_eligible !== true ||
      active.started_at !== rotation.activated_at || baseline.epoch_id !== rotation.target_epoch_id ||
      baseline.initialized_at !== rotation.activated_at) {
    throw new Error("Verified free selection router epoch does not match its activated rotation boundary.");
  }

  return parseTaskLeadingDescriptionActivation({
    schema_version: 1,
    experiment_id: experimentId,
    release_commit: coordinates.releaseCommit,
    production_activation_commit: coordinates.productionActivationCommit,
    production_activated_at: coordinates.productionActivatedAt,
    drain_rotation_id: coordinates.drainRotationId,
    measurement_epoch_id: rotation.target_epoch_id,
    epoch_activated_at: rotation.activated_at,
    target_tools_list: TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
  }, experimentId);
}
