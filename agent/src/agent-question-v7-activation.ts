import {
  AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
  TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
  type TaskLeadingDescriptionActivation,
} from "./task-leading-description-experiment.ts";

export const AGENT_QUESTION_V7_RELEASE = "3f0b7d046e06b9569302069476fb4553f3698bb2";
export const AGENT_QUESTION_V7_PRODUCTION_ACTIVATION = "22dbff80a09276098287249d5b8f992dec5cfa0e";
export const AGENT_QUESTION_V7_PRODUCTION_ACTIVATED_AT = "2026-07-22T21:28:08.590Z";
export const AGENT_QUESTION_V7_ROTATION = "agent_finder_contract_epoch_55";
export const AGENT_QUESTION_V7_EPOCH = 55;

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

export function activationFromVerifiedEpoch55(value: unknown): TaskLeadingDescriptionActivation | null {
  const ledger = record(value, "Trusted funnel epoch ledger");
  if (ledger.schema_version !== 2 || !Number.isSafeInteger(ledger.active_epoch_id) || !Array.isArray(ledger.epochs)) {
    throw new Error("Trusted funnel epoch ledger shape is invalid.");
  }
  const rotation = ledger.rotation;
  if (!rotation || typeof rotation !== "object" || Array.isArray(rotation)) return null;
  if (rotation.id !== AGENT_QUESTION_V7_ROTATION || rotation.target_epoch_id !== AGENT_QUESTION_V7_EPOCH) {
    return null;
  }
  if (rotation.status !== "activated") return null;
  if (ledger.active_epoch_id !== AGENT_QUESTION_V7_EPOCH) {
    throw new Error("Verified v7 rotation is no longer the active measurement epoch.");
  }
  if (typeof rotation.activated_at !== "string" || new Date(rotation.activated_at).toISOString() !== rotation.activated_at) {
    throw new Error("Verified v7 rotation activation time is invalid.");
  }
  const epoch = ledger.epochs.find((candidate: Record<string, unknown>) => candidate?.id === AGENT_QUESTION_V7_EPOCH);
  const active = record(epoch, "Verified v7 active epoch");
  const baseline = record(active.baseline, "Verified v7 active baseline");
  if (active.status !== "active" || active.conversion_eligible !== true ||
      active.started_at !== rotation.activated_at || baseline.epoch_id !== AGENT_QUESTION_V7_EPOCH ||
      baseline.initialized_at !== rotation.activated_at) {
    throw new Error("Verified v7 active epoch does not match its activated rotation boundary.");
  }

  return parseTaskLeadingDescriptionActivation({
    schema_version: 1,
    experiment_id: AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID,
    release_commit: AGENT_QUESTION_V7_RELEASE,
    production_activation_commit: AGENT_QUESTION_V7_PRODUCTION_ACTIVATION,
    production_activated_at: AGENT_QUESTION_V7_PRODUCTION_ACTIVATED_AT,
    drain_rotation_id: AGENT_QUESTION_V7_ROTATION,
    measurement_epoch_id: AGENT_QUESTION_V7_EPOCH,
    epoch_activated_at: rotation.activated_at,
    target_tools_list: TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
  }, AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID);
}
