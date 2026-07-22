export const SELECTION_EXPERIMENT_COUNTER_KEYS = Object.freeze([
  "initialize",
  "tools_list",
  "validation_error",
  "capacity_rejected",
  "payment_required",
  "payment_present",
  "paid_success",
  "paid_error",
] as const);

export type SelectionExperimentCounter = typeof SELECTION_EXPERIMENT_COUNTER_KEYS[number];
export type SelectionExperimentCounters = Record<SelectionExperimentCounter, number>;

export type SelectionExperimentInput = {
  id: string;
  observedAt: string;
  targetToolsList: number;
  resumeEpochId: number;
  eligiblePrefix: SelectionExperimentCounters;
  rawDelta: Record<string, unknown>;
  currentEpochId: number;
  measurementEligible: boolean;
  cleanEpochDelta: Record<string, unknown> | null;
  attributableRuntimeDelta: Record<string, unknown> | null;
  previous: unknown;
};

function zeroCounters(): SelectionExperimentCounters {
  return Object.fromEntries(SELECTION_EXPERIMENT_COUNTER_KEYS.map((key) => [key, 0])) as SelectionExperimentCounters;
}

function counters(value: unknown, label: string, allowLegacyPaidError = false): SelectionExperimentCounters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} counters are missing.`);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(SELECTION_EXPERIMENT_COUNTER_KEYS.map((key) => {
    const count = allowLegacyPaidError && key === "paid_error" && record[key] === undefined
      ? 0
      : Number(record[key]);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${label} ${key} is invalid.`);
    return [key, count];
  })) as SelectionExperimentCounters;
}

function addCounters(left: SelectionExperimentCounters, right: SelectionExperimentCounters): SelectionExperimentCounters {
  return Object.fromEntries(SELECTION_EXPERIMENT_COUNTER_KEYS.map((key) => {
    const sum = left[key] + right[key];
    if (!Number.isSafeInteger(sum)) throw new Error(`Selection experiment ${key} overflowed.`);
    return [key, sum];
  })) as SelectionExperimentCounters;
}

function subtractCounters(total: SelectionExperimentCounters, eligible: SelectionExperimentCounters): SelectionExperimentCounters {
  return Object.fromEntries(SELECTION_EXPERIMENT_COUNTER_KEYS.map((key) => {
    const difference = total[key] - eligible[key];
    if (!Number.isSafeInteger(difference) || difference < 0) {
      throw new Error(`Selection experiment eligible ${key} exceeds the raw rollout delta.`);
    }
    return [key, difference];
  })) as SelectionExperimentCounters;
}

function countersMonotonic(current: SelectionExperimentCounters, previous: SelectionExperimentCounters): boolean {
  return SELECTION_EXPERIMENT_COUNTER_KEYS.every((key) => current[key] >= previous[key]);
}

function validPrevious(value: unknown, id: string): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, any>;
  return record.id === id && (record.accounting_schema_version === 1 || record.accounting_schema_version === 2)
    ? record
    : null;
}

function legacyRuntimeCounters(previous: Record<string, any>, phase: "completed" | "active"): SelectionExperimentCounters {
  const migrated = zeroCounters();
  const toolsList = Number(previous[`attributable_runtime_tools_list_${phase}`] || 0);
  if (!Number.isSafeInteger(toolsList) || toolsList < 0) {
    throw new Error("Selection experiment previous runtime evidence is invalid.");
  }
  migrated.tools_list = toolsList;
  return migrated;
}

function decisionFor(delta: SelectionExperimentCounters, attributableRuntime: SelectionExperimentCounters): string {
  if (delta.paid_success > 0) return "paid_conversion_observed";
  if (delta.paid_error > 0) return "paid_execution_or_settlement_error_observed";
  if (delta.payment_present > delta.capacity_rejected) return "signed_payment_outcome_unresolved";
  if (delta.capacity_rejected > 0) return "service_capacity_friction_after_valid_call";
  if (delta.payment_required > 0) return "valid_call_interest_observed_without_payment_presentation";
  if (attributableRuntime.validation_error > 0) return "schema_friction_after_attributable_runtime_selection";
  if (delta.validation_error > 0) return "input_friction_observed_without_attributable_runtime";
  return attributableRuntime.tools_list > 0
    ? "copy_hypothesis_rejected_after_attributable_runtime_reach"
    : "copy_hypothesis_rejected_but_workflow_runtime_reach_unproven";
}

export function updateSelectionPreviewExperiment(input: SelectionExperimentInput): Record<string, unknown> {
  if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(input.id)) throw new Error("Selection experiment ID is invalid.");
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("Selection experiment observation time is invalid.");
  if (!Number.isSafeInteger(input.targetToolsList) || input.targetToolsList < 25 || input.targetToolsList > 10_000) {
    throw new Error("Selection experiment target is invalid.");
  }
  if (!Number.isSafeInteger(input.resumeEpochId) || input.resumeEpochId < 1 ||
    !Number.isSafeInteger(input.currentEpochId) || input.currentEpochId < 1) {
    throw new Error("Selection experiment epoch is invalid.");
  }
  const prefix = counters(input.eligiblePrefix, "Selection experiment eligible prefix");
  const raw = counters(input.rawDelta, "Selection experiment raw delta");
  const previous = validPrevious(input.previous, input.id);
  const legacyPrevious = previous?.accounting_schema_version === 1;
  let completed = previous
    ? counters(previous.clean_completed_delta, "Selection experiment completed clean epochs", legacyPrevious)
    : zeroCounters();
  let activeEpochId = previous?.clean_active_epoch_id === null || previous?.clean_active_epoch_id === undefined
    ? null
    : Number(previous.clean_active_epoch_id);
  let active = previous
    ? counters(previous.clean_active_epoch_delta, "Selection experiment active clean epoch", legacyPrevious)
    : zeroCounters();
  let runtimeCompleted = previous
    ? previous.accounting_schema_version === 2
      ? counters(previous.attributable_runtime_completed, "Selection experiment completed attributable runtime")
      : legacyRuntimeCounters(previous, "completed")
    : zeroCounters();
  let runtimeActive = previous
    ? previous.accounting_schema_version === 2
      ? counters(previous.attributable_runtime_active, "Selection experiment active attributable runtime")
      : legacyRuntimeCounters(previous, "active")
    : zeroCounters();
  if (activeEpochId !== null && (!Number.isSafeInteger(activeEpochId) || activeEpochId < input.resumeEpochId)) {
    throw new Error("Selection experiment previous epoch accounting is invalid.");
  }

  let historyGap = false;
  if (input.measurementEligible && input.currentEpochId >= input.resumeEpochId) {
    const clean = counters(input.cleanEpochDelta, "Selection experiment clean epoch");
    const runtime = counters(input.attributableRuntimeDelta, "Selection experiment attributable runtime epoch");
    if (activeEpochId === null) {
      if (!previous && input.currentEpochId > input.resumeEpochId) {
        historyGap = true;
      } else {
        activeEpochId = input.currentEpochId;
        active = clean;
        runtimeActive = runtime;
      }
    } else if (activeEpochId === input.currentEpochId) {
      if (!countersMonotonic(clean, active) || !countersMonotonic(runtime, runtimeActive)) {
        throw new Error("Selection experiment clean epoch counters regressed.");
      }
      active = clean;
      runtimeActive = runtime;
    } else if (input.currentEpochId > activeEpochId) {
      completed = addCounters(completed, active);
      runtimeCompleted = addCounters(runtimeCompleted, runtimeActive);
      activeEpochId = input.currentEpochId;
      active = clean;
      runtimeActive = runtime;
    } else {
      throw new Error("Selection experiment epoch regressed.");
    }
  }

  const eligible = addCounters(prefix, addCounters(completed, active));
  const ineligible = subtractCounters(raw, eligible);
  const attributableRuntime = addCounters(runtimeCompleted, runtimeActive);
  for (const key of SELECTION_EXPERIMENT_COUNTER_KEYS) {
    if (attributableRuntime[key] > eligible[key]) {
      throw new Error(`Selection experiment attributable runtime ${key} exceeds the eligible delta.`);
    }
  }
  const remainingToolsList = Math.max(0, input.targetToolsList - eligible.tools_list);
  const previousBoundary = previous?.boundary && typeof previous.boundary === "object" && !Array.isArray(previous.boundary)
    ? previous.boundary as Record<string, unknown>
    : null;
  const reached = eligible.tools_list >= input.targetToolsList;
  const boundary = previousBoundary || (reached ? {
    observed_at: input.observedAt,
    observation_rule: "first_monitor_report_at_or_above_the_eligible_tools_list_target",
    eligible_delta: eligible,
    attributable_runtime: attributableRuntime,
    attributable_runtime_tools_list: attributableRuntime.tools_list,
    decision: decisionFor(eligible, attributableRuntime),
  } : null);
  const status = boundary
    ? "completed"
    : historyGap
      ? "measurement_history_gap"
      : input.measurementEligible
        ? "running_clean_epoch"
        : "paused_audited_drain";
  const decision = boundary
    ? String(boundary.decision)
    : historyGap
      ? "manual_reconciliation_required_before_conclusion"
      : input.measurementEligible
        ? "awaiting_eligible_tools_list_target"
        : "audit_triggered_activity_excluded_until_clean_epoch_activation";
  const unpairedCapacityRejections = Math.max(0, eligible.capacity_rejected - eligible.payment_present);
  const validCallEvents = eligible.payment_required + eligible.payment_present + unpairedCapacityRejections;
  const callOpportunities = eligible.validation_error + validCallEvents;

  return {
    accounting_schema_version: 2,
    status,
    decision,
    target_tools_list: input.targetToolsList,
    remaining_eligible_tools_list: remainingToolsList,
    raw_delta: raw,
    delta: eligible,
    eligible_delta: eligible,
    ineligible_or_draining_delta: ineligible,
    clean_completed_delta: completed,
    clean_active_epoch_id: activeEpochId,
    clean_active_epoch_delta: active,
    attributable_runtime_completed: runtimeCompleted,
    attributable_runtime_active: runtimeActive,
    attributable_runtime: attributableRuntime,
    attributable_runtime_tools_list_completed: runtimeCompleted.tools_list,
    attributable_runtime_tools_list_active: runtimeActive.tools_list,
    attributable_runtime_tools_list: attributableRuntime.tools_list,
    boundary,
    event_ratios: {
      valid_call_per_tools_list_percent: eligible.tools_list > 0
        ? Math.round(validCallEvents / eligible.tools_list * 1_000) / 10
        : null,
      invalid_call_share_percent: callOpportunities > 0
        ? Math.round(eligible.validation_error / callOpportunities * 1_000) / 10
        : null,
      payment_present_per_valid_call_percent: validCallEvents > 0
        ? Math.round(eligible.payment_present / validCallEvents * 1_000) / 10
        : null,
    },
    measurement: "eligible aggregate events only; audited draining intervals, owner automation, registry, Glama release, and x402 observer channels are excluded; counts are not unique users or purchases",
  };
}
