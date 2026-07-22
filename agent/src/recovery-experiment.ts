export const RECOVERY_EXPERIMENT_COUNTER_KEYS = Object.freeze([
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

export type RecoveryExperimentCounter = typeof RECOVERY_EXPERIMENT_COUNTER_KEYS[number];
export type RecoveryExperimentCounters = Record<RecoveryExperimentCounter, number>;

export type RecoveryExperimentInput = {
  id: string;
  observedAt: string;
  targetToolsList: number;
  measurementEpochId: number;
  currentEpochId: number;
  measurementEligible: boolean;
  cleanEpochDelta: Record<string, unknown> | null;
  previous: unknown;
};

export function zeroRecoveryExperimentCounters(): RecoveryExperimentCounters {
  return Object.fromEntries(
    RECOVERY_EXPERIMENT_COUNTER_KEYS.map((key) => [key, 0]),
  ) as RecoveryExperimentCounters;
}

function counters(value: unknown, label: string): RecoveryExperimentCounters {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} counters are missing.`);
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(RECOVERY_EXPERIMENT_COUNTER_KEYS.map((key) => {
    const count = Number(record[key]);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`${label} ${key} is invalid.`);
    }
    return [key, count];
  })) as RecoveryExperimentCounters;
}

function countersMonotonic(
  current: RecoveryExperimentCounters,
  previous: RecoveryExperimentCounters,
): boolean {
  return RECOVERY_EXPERIMENT_COUNTER_KEYS.every((key) => current[key] >= previous[key]);
}

function validPrevious(
  value: unknown,
  id: string,
  measurementEpochId: number,
  targetToolsList: number,
): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, any>;
  if (record.id !== id || record.accounting_schema_version !== 3) return null;
  if (record.measurement_epoch_id !== measurementEpochId || record.target_tools_list !== targetToolsList) {
    throw new Error("Recovery experiment configuration changed after measurement state was created.");
  }
  return record;
}

function decisionFor(delta: RecoveryExperimentCounters): {
  decision: string;
  task_first_release_recommendation: string;
  interpretation: string;
} {
  if (delta.paid_success > 0) {
    return {
      decision: "paid_conversion_observed",
      task_first_release_recommendation: "may_proceed_conversion_observed",
      interpretation: "A paid success occurred in the clean sample; this is conversion evidence, not proof that unknown-tool recovery caused it.",
    };
  }
  if (delta.paid_error > 0) {
    return {
      decision: "paid_execution_or_settlement_error_observed",
      task_first_release_recommendation: "hold_and_diagnose_deeper_service_or_payment_friction",
      interpretation: "A paid execution or settlement error occurred and requires diagnosis before another treatment.",
    };
  }
  if (delta.payment_present > delta.capacity_rejected) {
    return {
      decision: "signed_payment_outcome_unresolved",
      task_first_release_recommendation: "hold_and_diagnose_deeper_service_or_payment_friction",
      interpretation: "At least one payment presentation has no classified terminal outcome in the aggregate counters.",
    };
  }
  if (delta.capacity_rejected > 0) {
    return {
      decision: "service_capacity_friction_after_valid_call",
      task_first_release_recommendation: "hold_and_diagnose_deeper_service_or_payment_friction",
      interpretation: "A valid call reached a capacity gate; recovery is no longer the nearest observed blocker.",
    };
  }
  if (delta.payment_required > 0) {
    return {
      decision: "known_valid_tool_interest_observed",
      task_first_release_recommendation: "may_proceed_known_tool_interest_observed_without_recovery_claim",
      interpretation: "A known structurally valid tool call reached its payment challenge, but aggregate telemetry cannot attribute it to an earlier recovery response.",
    };
  }
  if (delta.validation_error > 0) {
    return {
      decision: "known_tool_input_friction_observed",
      task_first_release_recommendation: "may_proceed_only_if_input_friction_is_accepted_without_recovery_claim",
      interpretation: "A known tool was selected with invalid input; input friction remains a separate observed blocker.",
    };
  }
  if (delta.tool_not_found > 0) {
    return {
      decision: "unknown_tool_recovery_outcome_unresolved",
      task_first_release_recommendation: "hold_task_first_release_recovery_opportunity_unresolved",
      interpretation: "An unknown-tool recovery opportunity occurred, but aggregate telemetry cannot link it to a later tools/list refresh or known-tool retry.",
    };
  }
  if (delta.protocol_error > 0) {
    return {
      decision: "mcp_protocol_friction_observed",
      task_first_release_recommendation: "hold_and_diagnose_protocol_friction",
      interpretation: "Protocol-level friction occurred before a known valid tool call was observed.",
    };
  }
  return {
    decision: "no_unknown_tool_recurrence_in_clean_sample",
    task_first_release_recommendation: "may_proceed_on_non_recurrence_only_without_recovery_claim",
    interpretation: "No unknown-tool recurrence or deeper call event occurred in this clean sample; this is only a safety and non-recurrence result.",
  };
}

const CAUSALITY_LIMIT = "Aggregate privacy-preserving counters have no session or retry linkage. They cannot establish that one agent received the recovery response, refreshed tools/list, and retried a known tool, so this experiment never reports a causal recovery rate.";

export function updateUnknownToolRecoveryExperiment(input: RecoveryExperimentInput): Record<string, unknown> {
  if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(input.id)) throw new Error("Recovery experiment ID is invalid.");
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("Recovery experiment observation time is invalid.");
  if (!Number.isSafeInteger(input.targetToolsList) || input.targetToolsList !== 25) {
    throw new Error("Recovery experiment target must remain the frozen 25 tools/list events.");
  }
  if (!Number.isSafeInteger(input.measurementEpochId) || input.measurementEpochId !== 46 ||
    !Number.isSafeInteger(input.currentEpochId) || input.currentEpochId < 1) {
    throw new Error("Recovery experiment epoch is invalid.");
  }

  const previous = validPrevious(input.previous, input.id, input.measurementEpochId, input.targetToolsList);
  const previousDelta = previous
    ? counters(previous.eligible_delta, "Recovery experiment previous eligible")
    : zeroRecoveryExperimentCounters();
  const previousBoundary = previous?.boundary && typeof previous.boundary === "object" && !Array.isArray(previous.boundary)
    ? previous.boundary as Record<string, unknown>
    : null;
  const frozenBoundaryDelta = previousBoundary
    ? counters(previousBoundary.eligible_delta, "Recovery experiment frozen boundary eligible")
    : null;
  let eligible = frozenBoundaryDelta || previousDelta;
  let status: string;

  if (previousBoundary) {
    status = "completed";
  } else if (input.currentEpochId < input.measurementEpochId) {
    if (previous) throw new Error("Recovery experiment epoch regressed.");
    status = "awaiting_active_eligible_epoch";
  } else if (input.currentEpochId > input.measurementEpochId) {
    status = previous
      ? "measurement_epoch_closed_before_target"
      : "measurement_history_gap";
  } else if (!input.measurementEligible) {
    status = "paused_audited_drain";
  } else {
    const clean = counters(input.cleanEpochDelta, "Recovery experiment clean epoch");
    if (!countersMonotonic(clean, previousDelta)) {
      throw new Error("Recovery experiment clean epoch counters regressed.");
    }
    eligible = clean;
    status = "running_clean_epoch";
  }

  const reached = eligible.tools_list >= input.targetToolsList;
  const terminal = decisionFor(eligible);
  const boundary = previousBoundary || (reached ? {
    observed_at: input.observedAt,
    observation_rule: "first_monitor_report_at_or_above_25_eligible_epoch_46_tools_list_events",
    measurement_epoch_id: input.measurementEpochId,
    eligible_prefix: zeroRecoveryExperimentCounters(),
    eligible_delta: eligible,
    ...terminal,
    causal_recovery_claim: false,
    causality_limit: CAUSALITY_LIMIT,
  } : null);

  if (boundary) status = "completed";
  const remaining = Math.max(0, input.targetToolsList - eligible.tools_list);
  const currentDecision = boundary
    ? String(boundary.decision)
    : status === "measurement_history_gap"
      ? "manual_reconciliation_required_epoch_46_was_not_observed"
      : status === "measurement_epoch_closed_before_target"
        ? "epoch_46_closed_before_target"
        : status === "running_clean_epoch"
          ? "awaiting_eligible_epoch_46_tools_list_target"
          : "awaiting_active_eligible_epoch_46";
  const validCallEvents = eligible.payment_required + eligible.payment_present +
    Math.max(0, eligible.capacity_rejected - eligible.payment_present);

  return {
    accounting_schema_version: 3,
    status,
    decision: currentDecision,
    measurement_epoch_id: input.measurementEpochId,
    target_tools_list: input.targetToolsList,
    remaining_eligible_tools_list: remaining,
    eligible_prefix: zeroRecoveryExperimentCounters(),
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
    causal_recovery_claim: false,
    causality_limit: CAUSALITY_LIMIT,
    measurement: "exact active eligible epoch 46 buyer-candidate aggregate events only; frozen zero prefix; audited drains, owner automation, registry, Glama release, and x402 observer channels are excluded; counts are not unique agents, purchases, or revenue",
  };
}
