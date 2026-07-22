export const TASK_LEADING_DESCRIPTION_EXPERIMENT_ID = "mcp-task-leading-descriptions-v1";
export const TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST = 25;

export const TASK_LEADING_DESCRIPTION_COUNTER_KEYS = Object.freeze([
  "initialize",
  "tools_list",
  "protocol_error",
  "tool_not_found",
  "validation_error",
  "capacity_rejected",
  "payment_required",
  "payment_present",
  "paid_success",
  "paid_error",
] as const);

export type TaskLeadingDescriptionCounter = typeof TASK_LEADING_DESCRIPTION_COUNTER_KEYS[number];
export type TaskLeadingDescriptionCounters = Record<TaskLeadingDescriptionCounter, number>;

export type TaskLeadingDescriptionActivation = {
  schema_version: 1;
  experiment_id: typeof TASK_LEADING_DESCRIPTION_EXPERIMENT_ID;
  release_commit: string;
  production_activation_commit: string;
  production_activated_at: string;
  drain_rotation_id: string;
  measurement_epoch_id: number;
  epoch_activated_at: string;
  target_tools_list: typeof TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST;
};

export type TaskLeadingDescriptionExperimentInput = {
  observedAt: string;
  activation: unknown;
  currentEpochId: number;
  measurementEligible: boolean;
  cleanEpochDelta: Record<string, unknown> | null;
  trustedBaselineInitializedAt: string;
  trustedRotation: unknown;
  previous: unknown;
};

const ACTIVATION_KEYS = Object.freeze([
  "schema_version",
  "experiment_id",
  "release_commit",
  "production_activation_commit",
  "production_activated_at",
  "drain_rotation_id",
  "measurement_epoch_id",
  "epoch_activated_at",
  "target_tools_list",
] as const);

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const ROTATION_PATTERN = /^[a-z0-9][a-z0-9_-]{7,79}$/;

export function zeroTaskLeadingDescriptionCounters(): TaskLeadingDescriptionCounters {
  return Object.fromEntries(
    TASK_LEADING_DESCRIPTION_COUNTER_KEYS.map((key) => [key, 0]),
  ) as TaskLeadingDescriptionCounters;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`Task-leading description ${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

export function parseTaskLeadingDescriptionActivation(value: unknown): TaskLeadingDescriptionActivation | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Task-leading description activation must be an object.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [...ACTIVATION_KEYS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("Task-leading description activation fields are invalid.");
  }
  if (record.schema_version !== 1 || record.experiment_id !== TASK_LEADING_DESCRIPTION_EXPERIMENT_ID) {
    throw new Error("Task-leading description activation identity is invalid.");
  }
  if (typeof record.release_commit !== "string" || !COMMIT_PATTERN.test(record.release_commit) ||
      typeof record.production_activation_commit !== "string" || !COMMIT_PATTERN.test(record.production_activation_commit)) {
    throw new Error("Task-leading description activation commits are invalid.");
  }
  const productionActivatedAt = canonicalTimestamp(record.production_activated_at, "production activation");
  const epochActivatedAt = canonicalTimestamp(record.epoch_activated_at, "epoch activation");
  if (Date.parse(epochActivatedAt) < Date.parse(productionActivatedAt)) {
    throw new Error("Task-leading description epoch activation predates production activation.");
  }
  if (typeof record.drain_rotation_id !== "string" || !ROTATION_PATTERN.test(record.drain_rotation_id)) {
    throw new Error("Task-leading description drain rotation ID is invalid.");
  }
  if (!Number.isSafeInteger(record.measurement_epoch_id) || Number(record.measurement_epoch_id) < 1) {
    throw new Error("Task-leading description measurement epoch is invalid.");
  }
  if (record.target_tools_list !== TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST) {
    throw new Error("Task-leading description target must remain the frozen 25 tools/list events.");
  }
  return record as TaskLeadingDescriptionActivation;
}

function counters(value: unknown, label: string): TaskLeadingDescriptionCounters {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} counters are missing.`);
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(TASK_LEADING_DESCRIPTION_COUNTER_KEYS.map((key) => {
    const count = Number(record[key]);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${label} ${key} is invalid.`);
    return [key, count];
  })) as TaskLeadingDescriptionCounters;
}

function countersMonotonic(
  current: TaskLeadingDescriptionCounters,
  previous: TaskLeadingDescriptionCounters,
): boolean {
  return TASK_LEADING_DESCRIPTION_COUNTER_KEYS.every((key) => current[key] >= previous[key]);
}

function validPrevious(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, any>;
  return record.id === TASK_LEADING_DESCRIPTION_EXPERIMENT_ID && record.accounting_schema_version === 1
    ? record
    : null;
}

function sameActivation(left: TaskLeadingDescriptionActivation, right: TaskLeadingDescriptionActivation): boolean {
  return ACTIVATION_KEYS.every((key) => left[key] === right[key]);
}

function matchingFreshEpoch(
  activation: TaskLeadingDescriptionActivation,
  currentEpochId: number,
  baselineInitializedAt: string,
  rotation: unknown,
): boolean {
  if (currentEpochId !== activation.measurement_epoch_id || baselineInitializedAt !== activation.epoch_activated_at ||
      !rotation || typeof rotation !== "object" || Array.isArray(rotation)) return false;
  const record = rotation as Record<string, unknown>;
  return record.id === activation.drain_rotation_id &&
    record.status === "activated" &&
    record.target_epoch_id === activation.measurement_epoch_id &&
    record.activated_at === activation.epoch_activated_at;
}

function decisionFor(delta: TaskLeadingDescriptionCounters): { decision: string; interpretation: string } {
  if (delta.paid_success > 0) return {
    decision: "paid_conversion_observed_without_task_copy_attribution",
    interpretation: "A paid success occurred in the post-release sample; aggregate counters cannot attribute it to task-leading descriptions.",
  };
  if (delta.paid_error > 0) return {
    decision: "paid_execution_or_settlement_error_observed",
    interpretation: "A paid execution or settlement error occurred and requires diagnosis before another copy treatment.",
  };
  if (delta.payment_present > delta.capacity_rejected) return {
    decision: "signed_payment_outcome_unresolved",
    interpretation: "At least one payment presentation has no classified terminal outcome in the aggregate counters.",
  };
  if (delta.capacity_rejected > 0) return {
    decision: "service_capacity_friction_after_valid_call",
    interpretation: "A valid call reached a capacity gate; copy is not the nearest observed blocker.",
  };
  if (delta.payment_required > 0) return {
    decision: "known_valid_tool_interest_observed_without_task_copy_attribution",
    interpretation: "A known valid tool call reached payment, but aggregate telemetry cannot attribute selection to task-leading descriptions.",
  };
  if (delta.validation_error > 0) return {
    decision: "known_tool_input_friction_observed",
    interpretation: "A known tool was selected with invalid input; this does not measure a description-caused selection rate.",
  };
  if (delta.tool_not_found > 0) return {
    decision: "unknown_tool_invocation_observed",
    interpretation: "An unknown tool name was attempted; recovery remains measured separately and no session path is inferred.",
  };
  if (delta.protocol_error > 0) return {
    decision: "mcp_protocol_friction_observed",
    interpretation: "Protocol friction occurred before a known valid call was observed.",
  };
  return {
    decision: "catalog_reach_only_without_downstream_call",
    interpretation: "The sample reached tools/list without a downstream call; this cannot establish whether the descriptions influenced selection.",
  };
}

const CAUSALITY_LIMIT = "Privacy-preserving aggregate counters have no session, exposure, or retry linkage. They cannot establish that one agent read a task-leading description and then selected or paid for that tool, so this experiment never reports a causal copy conversion rate.";

function inactive(status: string, decision: string): Record<string, unknown> {
  const eligible = zeroTaskLeadingDescriptionCounters();
  return {
    id: TASK_LEADING_DESCRIPTION_EXPERIMENT_ID,
    accounting_schema_version: 1,
    status,
    decision,
    activation_required: true,
    activation: null,
    activation_verified: false,
    measurement_epoch_id: null,
    target_tools_list: TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
    remaining_eligible_tools_list: TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
    eligible_prefix: zeroTaskLeadingDescriptionCounters(),
    eligible_delta: eligible,
    boundary: null,
    causal_copy_claim: false,
    causality_limit: CAUSALITY_LIMIT,
    measurement: "inactive until reviewed release, production activation, completed drain rotation, and fresh epoch coordinates are supplied",
  };
}

export function updateTaskLeadingDescriptionExperiment(
  input: TaskLeadingDescriptionExperimentInput,
): Record<string, unknown> {
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("Task-leading description observation time is invalid.");
  if (!Number.isSafeInteger(input.currentEpochId) || input.currentEpochId < 1) {
    throw new Error("Task-leading description current epoch is invalid.");
  }
  const previous = validPrevious(input.previous);
  const suppliedActivation = parseTaskLeadingDescriptionActivation(input.activation);
  const persistedActivation = previous?.activation
    ? parseTaskLeadingDescriptionActivation(previous.activation)
    : null;
  if (suppliedActivation && persistedActivation && !sameActivation(suppliedActivation, persistedActivation)) {
    throw new Error("Task-leading description activation changed after measurement state was created.");
  }
  const activation = suppliedActivation || persistedActivation;
  if (!activation) {
    return inactive(
      "awaiting_activation_coordinates",
      "supply_reviewed_release_activation_and_fresh_epoch_coordinates",
    );
  }

  const previousVerified = previous?.activation_verified === true;
  const initialEpochMatches = matchingFreshEpoch(
    activation,
    input.currentEpochId,
    input.trustedBaselineInitializedAt,
    input.trustedRotation,
  );
  let eligible = previous
    ? counters(previous.eligible_delta, "Task-leading description previous eligible")
    : zeroTaskLeadingDescriptionCounters();
  const previousBoundary = previous?.boundary && typeof previous.boundary === "object" && !Array.isArray(previous.boundary)
    ? previous.boundary as Record<string, unknown>
    : null;
  const frozenBoundaryDelta = previousBoundary
    ? counters(previousBoundary.eligible_delta, "Task-leading description frozen boundary eligible")
    : null;
  if (frozenBoundaryDelta) eligible = frozenBoundaryDelta;

  let status: string;
  let activationVerified = previousVerified;
  if (previousBoundary) {
    status = "completed";
  } else if (input.currentEpochId < activation.measurement_epoch_id) {
    if (previousVerified) throw new Error("Task-leading description epoch regressed.");
    status = "awaiting_matching_fresh_epoch";
  } else if (input.currentEpochId > activation.measurement_epoch_id) {
    status = previousVerified
      ? "measurement_epoch_closed_before_target"
      : "measurement_history_gap";
  } else if (!previousVerified && !initialEpochMatches) {
    status = "activation_coordinates_unverified";
  } else if (!input.measurementEligible) {
    status = "paused_audited_drain";
  } else {
    const clean = counters(input.cleanEpochDelta, "Task-leading description clean epoch");
    if (!countersMonotonic(clean, eligible)) {
      throw new Error("Task-leading description clean epoch counters regressed.");
    }
    eligible = clean;
    activationVerified = true;
    status = "running_clean_epoch";
  }

  const reached = eligible.tools_list >= TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST;
  const terminal = decisionFor(eligible);
  const boundary = previousBoundary || (activationVerified && reached ? {
    observed_at: input.observedAt,
    observation_rule: "first_monitor_report_at_or_above_25_eligible_task_leading_description_tools_list_events",
    measurement_epoch_id: activation.measurement_epoch_id,
    eligible_prefix: zeroTaskLeadingDescriptionCounters(),
    eligible_delta: eligible,
    ...terminal,
    causal_copy_claim: false,
    causality_limit: CAUSALITY_LIMIT,
  } : null);
  if (boundary) status = "completed";

  const remaining = Math.max(0, TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST - eligible.tools_list);
  const decision = boundary
    ? String(boundary.decision)
    : status === "measurement_history_gap"
      ? "manual_reconciliation_required_fresh_epoch_was_not_observed"
      : status === "measurement_epoch_closed_before_target"
        ? "fresh_epoch_closed_before_target"
        : status === "activation_coordinates_unverified"
          ? "wait_for_exact_activated_rotation_and_epoch_baseline"
          : status === "running_clean_epoch"
            ? "awaiting_25_eligible_tools_list_events"
            : status === "paused_audited_drain"
              ? "audit_triggered_activity_excluded"
              : "awaiting_matching_fresh_epoch";
  const validCallEvents = eligible.payment_required + eligible.payment_present +
    Math.max(0, eligible.capacity_rejected - eligible.payment_present);

  return {
    id: TASK_LEADING_DESCRIPTION_EXPERIMENT_ID,
    accounting_schema_version: 1,
    status,
    decision,
    activation_required: false,
    activation,
    activation_verified: activationVerified,
    measurement_epoch_id: activation.measurement_epoch_id,
    target_tools_list: TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
    remaining_eligible_tools_list: remaining,
    eligible_prefix: zeroTaskLeadingDescriptionCounters(),
    eligible_delta: eligible,
    boundary,
    event_ratios: {
      valid_call_per_tools_list_percent: eligible.tools_list > 0
        ? Math.round(validCallEvents / eligible.tools_list * 1_000) / 10
        : null,
      payment_present_per_valid_call_percent: validCallEvents > 0
        ? Math.round(eligible.payment_present / validCallEvents * 1_000) / 10
        : null,
    },
    causal_copy_claim: false,
    causality_limit: CAUSALITY_LIMIT,
    measurement: "exact fresh active eligible epoch buyer-candidate aggregate events only; frozen zero prefix; audited drains, owner automation, registry, Glama release, and x402 observer channels are excluded; counts are not unique agents, purchases, or revenue",
  };
}
