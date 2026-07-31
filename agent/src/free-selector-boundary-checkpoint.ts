import {
  trustedFunnelBaseline,
  trustedBoundaryFingerprint,
  trustedMcpDelta,
  type TrustedFunnelBaseline,
} from "./funnel-epoch.ts";
import { loadFunnelSnapshot } from "./funnel-telemetry.ts";
import {
  CATALOG_FREE_PROOF_EXPERIMENT_ID,
  type DescriptionExperimentId,
  FREE_SELECTION_CATALOG_EXPERIMENT_ID,
  FREE_SELECTION_CATALOG_V1_EXPERIMENT_ID,
  FREE_SELECTION_ROUTER_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
  TASK_LEADING_DESCRIPTION_COUNTER_KEYS,
  TASK_LEADING_DESCRIPTION_EXPERIMENT_ID,
  TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
  type TaskLeadingDescriptionActivation,
  type TaskLeadingDescriptionCounters,
  updateTaskLeadingDescriptionExperiment,
} from "./task-leading-description-experiment.ts";

export type FreeSelectorBoundaryCheckpointInput = {
  experimentId?: DescriptionExperimentId;
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

function counters(value: unknown): TaskLeadingDescriptionCounters | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = [...TASK_LEADING_DESCRIPTION_COUNTER_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  const result = {} as TaskLeadingDescriptionCounters;
  for (const key of TASK_LEADING_DESCRIPTION_COUNTER_KEYS) {
    if (!Number.isSafeInteger(candidate[key]) || Number(candidate[key]) < 0) return null;
    result[key] = Number(candidate[key]);
  }
  return result;
}

function sameCounters(left: TaskLeadingDescriptionCounters, right: TaskLeadingDescriptionCounters): boolean {
  return TASK_LEADING_DESCRIPTION_COUNTER_KEYS.every((key) => left[key] === right[key]);
}

function zeroCounters(value: TaskLeadingDescriptionCounters): boolean {
  return TASK_LEADING_DESCRIPTION_COUNTER_KEYS.every((key) => value[key] === 0);
}

function sameActivation(
  left: TaskLeadingDescriptionActivation,
  right: TaskLeadingDescriptionActivation,
): boolean {
  return Object.keys(left).every((key) =>
    left[key as keyof TaskLeadingDescriptionActivation] === right[key as keyof TaskLeadingDescriptionActivation]
  );
}

function canonicalTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function expectedObservationRule(experimentId: DescriptionExperimentId): string {
  if (experimentId === TASK_LEADING_DESCRIPTION_EXPERIMENT_ID) {
    return "first_monitor_report_at_or_above_25_eligible_task_leading_description_tools_list_events";
  }
  if (experimentId === CATALOG_FREE_PROOF_EXPERIMENT_ID) {
    return "first_monitor_report_at_or_above_25_eligible_catalog_free_proof_tools_list_events";
  }
  if (experimentId === FREE_SELECTION_ROUTER_EXPERIMENT_ID ||
      experimentId === FREE_SELECTION_CATALOG_V1_EXPERIMENT_ID ||
      experimentId === FREE_SELECTION_CATALOG_EXPERIMENT_ID) {
    return "first_monitor_report_at_or_above_25_eligible_free_selection_router_tools_list_events";
  }
  return "first_monitor_report_at_or_above_25_eligible_agent_question_description_tools_list_events";
}

function completedCheckpointValid(
  value: unknown,
  experimentId: DescriptionExperimentId,
  activation: TaskLeadingDescriptionActivation,
  observedAt: string,
): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const checkpoint = value as Record<string, any>;
    if (checkpoint.id !== experimentId || checkpoint.accounting_schema_version !== 2 ||
        checkpoint.status !== "completed" || checkpoint.activation_verified !== true ||
        checkpoint.measurement_epoch_id !== activation.measurement_epoch_id ||
        checkpoint.target_tools_list !== TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST ||
        checkpoint.remaining_eligible_tools_list !== 0 || checkpoint.causal_copy_claim !== false) return false;
    const persistedActivation = parseTaskLeadingDescriptionActivation(checkpoint.activation, experimentId);
    if (!persistedActivation || !sameActivation(persistedActivation, activation)) return false;

    const eligiblePrefix = counters(checkpoint.eligible_prefix);
    const eligibleDelta = counters(checkpoint.eligible_delta);
    if (!eligiblePrefix || !zeroCounters(eligiblePrefix) || !eligibleDelta ||
        eligibleDelta.tools_list < TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST) return false;

    if (!checkpoint.boundary || typeof checkpoint.boundary !== "object" ||
        Array.isArray(checkpoint.boundary)) return false;
    const boundary = checkpoint.boundary as Record<string, any>;
    if (!canonicalTimestamp(boundary.observed_at) ||
        Date.parse(boundary.observed_at) < Date.parse(activation.epoch_activated_at) ||
        Date.parse(boundary.observed_at) > Date.parse(observedAt) ||
        boundary.observation_rule !== expectedObservationRule(experimentId) ||
        boundary.measurement_epoch_id !== activation.measurement_epoch_id ||
        boundary.decision !== checkpoint.decision || boundary.causal_copy_claim !== false ||
        typeof boundary.interpretation !== "string" || boundary.interpretation.length < 1 ||
        typeof boundary.causality_limit !== "string" ||
        boundary.causality_limit !== checkpoint.causality_limit) return false;
    const boundaryPrefix = counters(boundary.eligible_prefix);
    const boundaryDelta = counters(boundary.eligible_delta);
    return Boolean(boundaryPrefix && zeroCounters(boundaryPrefix) && boundaryDelta &&
      sameCounters(eligibleDelta, boundaryDelta));
  } catch {
    return false;
  }
}

function epochBaseline(value: unknown): TrustedFunnelBaseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return trustedFunnelBaseline((value as Record<string, unknown>).baseline);
}

function currentLedgerBaselineValid(
  ledger: Record<string, any>,
  baseline: TrustedFunnelBaseline,
): boolean {
  const current = ledger.epochs.find((candidate: Record<string, unknown>) =>
    candidate?.id === ledger.active_epoch_id);
  const embedded = epochBaseline(current);
  return Boolean(current && embedded &&
    ((current.status === "active" && current.conversion_eligible === true) ||
      (current.status === "draining" && current.conversion_eligible === false)) &&
    canonicalTimestamp(current.started_at) &&
    embedded.epoch_id === ledger.active_epoch_id &&
    embedded.initialized_at === current.started_at &&
    baseline.epoch_id === ledger.active_epoch_id &&
    baseline.initialized_at === current.started_at &&
    trustedBoundaryFingerprint(baseline) === trustedBoundaryFingerprint(embedded));
}

function historicalMeasurementValid(
  epoch: Record<string, any>,
  activation: TaskLeadingDescriptionActivation,
  boundaryObservedAt: string,
): boolean {
  const baseline = epochBaseline(epoch);
  if (!baseline || epoch.id !== activation.measurement_epoch_id ||
      epoch.started_at !== activation.epoch_activated_at ||
      baseline.epoch_id !== activation.measurement_epoch_id ||
      baseline.initialized_at !== activation.epoch_activated_at) return false;
  return epoch.status === "closed" && epoch.conversion_eligible === false &&
    canonicalTimestamp(epoch.ended_at) && Date.parse(epoch.ended_at) >= Date.parse(boundaryObservedAt);
}

export function checkpointFreeSelectorBoundary(
  input: FreeSelectorBoundaryCheckpointInput,
): FreeSelectorBoundaryCheckpoint {
  const experimentId = input.experimentId || FREE_SELECTION_ROUTER_EXPERIMENT_ID;
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    throw new Error("Free selector boundary observation time is invalid.");
  }
  const funnel = loadFunnelSnapshot(input.funnelState);
  if (!funnel) throw new Error("Free selector boundary funnel state is malformed.");
  const baseline = trustedFunnelBaseline(input.trustedBaseline);
  if (!baseline?.mcp) throw new Error("Free selector boundary trusted MCP baseline is missing.");
  const activation = parseTaskLeadingDescriptionActivation(
    input.activation,
    experimentId,
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
    experimentId,
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
  const completed = completedCheckpointValid(experiment, experimentId, activation, input.observedAt);
  const previousCompleted = completedCheckpointValid(
    input.previous,
    experimentId,
    activation,
    input.observedAt,
  );
  const previousBoundary = previousCompleted
    ? (input.previous as Record<string, any>).boundary as Record<string, any>
    : null;
  const retryableFrozenBoundary = Boolean(previousBoundary &&
    ledger.active_epoch_id > activation.measurement_epoch_id &&
    currentLedgerBaselineValid(ledger, baseline) &&
    historicalMeasurementValid(activeEpoch, activation, previousBoundary.observed_at));
  return {
    audit_ready: completed && (exactActiveMeasurement || retryableFrozenBoundary),
    tools_list: toolsList,
    remaining_tools_list: remaining,
    experiment,
  };
}
