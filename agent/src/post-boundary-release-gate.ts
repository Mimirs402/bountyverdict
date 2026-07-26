import { isDeepStrictEqual } from "node:util";

export const EARNED_PLACEMENT_EXPERIMENT_NAME = "skillverdict_earned_directory_placement";
export const EARNED_PLACEMENT_ENDS_AT = "2026-07-27T16:37:12.796Z";
export const EARNED_PLACEMENT_BASELINE_GATE = Object.freeze({
  total_installs: 8,
  router_installs: 2,
  skillverdict_installs: 1,
  skillverdict_registry_queries: 0,
  non_target_registry_queries: 0,
  skillverdict_purchases: 0,
  other_purchases: 0,
});
export const EARNED_PLACEMENT_PROVENANCE_GATE = Object.freeze({
  install_counters: {
    acquisition_field: "skills_sh_legacy_experiment",
    measurement_role: "frozen_skillverdict_experiment_only",
    source_repository: "cristianmoroaica/bountyverdict",
    source_url: "https://skills.sh/cristianmoroaica/bountyverdict",
    retrieval: "passive_exact_public_page_only",
    authenticated: false,
    mutated: false,
    search_requests: 0,
    canonical_business_distribution: false,
    askill_substitution: false,
  },
  registry_queries: {
    acquisition_field: "x402scout",
  },
  purchases: {
    source: "recognized_non_owner_onchain_settlements",
  },
});

const TERMINAL_STATUSES = new Set([
  "target_purchase_success",
  "off_target_purchase_success",
  "install_to_purchase_failure",
  "listing_to_install_failure",
  "off_target_reach",
  "reach_failure",
]);

export type SnapshotServiceState = {
  Result: string;
  ExecMainStatus: string | number;
  ActiveState: string;
  SubState: string;
};

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function exact(value: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(value, expected)) throw new Error(`${label} drifted.`);
}

function nonNegativeCounts(value: unknown, label: string): Record<string, number> {
  const input = record(value, label);
  const entries = Object.entries(input);
  if (!entries.length) throw new Error(`${label} is empty.`);
  for (const [key, count] of entries) {
    if (!Number.isSafeInteger(count) || Number(count) < 0) {
      throw new Error(`${label} ${key} is invalid.`);
    }
  }
  return input as Record<string, number>;
}

export function verifyPostBoundaryReleaseGate(input: {
  experiment: unknown;
  distributionReport: unknown;
  snapshotService: SnapshotServiceState;
}) {
  const experiment = record(input.experiment, "Acquisition experiment state");
  const report = record(input.distributionReport, "Distribution report");
  const service = record(input.snapshotService, "Snapshot service state");

  if (service.Result !== "success" || Number(service.ExecMainStatus) !== 0 ||
      service.ActiveState !== "inactive" || service.SubState !== "dead") {
    throw new Error("Acquisition snapshot service did not finish successfully.");
  }
  if (experiment.name !== EARNED_PLACEMENT_EXPERIMENT_NAME) {
    throw new Error("Acquisition experiment identity drifted.");
  }
  if (experiment.ends_at !== EARNED_PLACEMENT_ENDS_AT) {
    throw new Error("Acquisition experiment boundary drifted.");
  }
  exact(experiment.baseline, EARNED_PLACEMENT_BASELINE_GATE, "Persisted acquisition baseline");
  exact(
    experiment.measurement_provenance,
    EARNED_PLACEMENT_PROVENANCE_GATE,
    "Persisted acquisition measurement provenance",
  );

  const terminal = record(experiment.terminal_result, "Acquisition terminal result");
  if (terminal.name !== EARNED_PLACEMENT_EXPERIMENT_NAME ||
      terminal.ends_at !== EARNED_PLACEMENT_ENDS_AT ||
      !TERMINAL_STATUSES.has(String(terminal.status))) {
    throw new Error("Acquisition terminal result identity, boundary, or status is invalid.");
  }
  if (terminal.measurement_valid !== true || terminal.currently_healthy !== true) {
    throw new Error("Acquisition terminal result is unhealthy or measurement-invalid.");
  }
  exact(terminal.baseline, experiment.baseline, "Frozen acquisition baseline");
  exact(
    terminal.measurement_provenance,
    experiment.measurement_provenance,
    "Frozen acquisition measurement provenance",
  );
  const current = nonNegativeCounts(terminal.current, "Acquisition terminal current counters");
  const delta = record(terminal.delta, "Acquisition terminal delta");
  nonNegativeCounts(delta.installs, "Acquisition terminal install deltas");
  for (const key of ["skillverdict_purchases", "other_purchases", "genuine_purchases"]) {
    if (!Number.isSafeInteger(delta[key]) || Number(delta[key]) < 0) {
      throw new Error(`Acquisition terminal delta ${key} is invalid.`);
    }
  }
  if (Number(current.genuine_purchases) !== Number(delta.genuine_purchases)) {
    throw new Error("Acquisition terminal purchase counters do not reconcile.");
  }

  const frozenAt = canonicalTimestamp(terminal.frozen_at, "Acquisition frozen_at");
  if (Date.parse(frozenAt) < Date.parse(EARNED_PLACEMENT_ENDS_AT)) {
    throw new Error("Acquisition terminal result froze before the experiment boundary.");
  }
  if (report.healthy !== true || !Array.isArray(report.errors) || report.errors.length !== 0) {
    throw new Error("Distribution report is unhealthy.");
  }
  const checkedAt = canonicalTimestamp(report.checked_at, "Distribution report checked_at");
  if (checkedAt !== frozenAt) {
    throw new Error("Distribution report does not belong to the terminal freeze observation.");
  }
  const acquisition = record(report.acquisition, "Distribution acquisition section");
  exact(acquisition.experiment, terminal, "Distribution terminal experiment projection");

  return {
    ready: true,
    terminal_status: terminal.status as string,
    ends_at: EARNED_PLACEMENT_ENDS_AT,
    frozen_at: frozenAt,
    checked_at: checkedAt,
    measurement_valid: true,
    currently_healthy: true,
    genuine_purchases: Number(current.genuine_purchases),
    next_action: record(terminal.next_action, "Acquisition terminal next action").code,
  };
}
