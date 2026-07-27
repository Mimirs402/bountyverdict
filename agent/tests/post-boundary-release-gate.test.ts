import assert from "node:assert/strict";
import test from "node:test";
import {
  EARNED_PLACEMENT_BASELINE_GATE,
  EARNED_PLACEMENT_ENDS_AT,
  EARNED_PLACEMENT_EXPERIMENT_NAME,
  EARNED_PLACEMENT_PROVENANCE_GATE,
  POST_BOUNDARY_DRAIN_ID,
  POST_BOUNDARY_DRAIN_REASON,
  RELEASE_CANDIDATE_BRANCH,
  RELEASE_CANDIDATE_WORKTREE,
  SNAPSHOT_SERVICE_SHA256,
  SNAPSHOT_SOURCE_COMMIT,
  SNAPSHOT_SOURCE_WORKTREE,
  SNAPSHOT_TIMER_SHA256,
  verifyPostBoundaryReleaseGate,
} from "../src/post-boundary-release-gate.ts";

const frozenAt = "2026-07-27T16:38:00.000Z";
const terminal = {
  name: EARNED_PLACEMENT_EXPERIMENT_NAME,
  status: "reach_failure",
  baseline: EARNED_PLACEMENT_BASELINE_GATE,
  started_at: "2026-07-20T16:37:12.796Z",
  ends_at: EARNED_PLACEMENT_ENDS_AT,
  current: {
    total_installs: 8,
    router_installs: 2,
    skillverdict_installs: 1,
    skillverdict_registry_queries: 0,
    non_target_registry_queries: 0,
    skillverdict_purchases: 0,
    other_purchases: 0,
    genuine_purchases: 0,
  },
  delta: {
    installs: { total: 0, router: 0, skillverdict: 0 },
    skillverdict_purchases: 0,
    other_purchases: 0,
    genuine_purchases: 0,
  },
  measurement_valid: true,
  currently_healthy: true,
  elapsed_hours: 168,
  window_days: 7,
  primary_success: false,
  commercial_success: false,
  supporting_success: false,
  measurement_provenance: EARNED_PLACEMENT_PROVENANCE_GATE,
  next_action: { code: "expand_earned_reach", reason: "No reach." },
  frozen_at: frozenAt,
};
const experiment = {
  name: EARNED_PLACEMENT_EXPERIMENT_NAME,
  initialized_at: "2026-07-20T16:51:30.468Z",
  started_at: "2026-07-20T16:37:12.796345+00:00",
  ends_at: EARNED_PLACEMENT_ENDS_AT,
  baseline: EARNED_PLACEMENT_BASELINE_GATE,
  measurement_provenance: EARNED_PLACEMENT_PROVENANCE_GATE,
  terminal_result: terminal,
};
const report = {
  checked_at: frozenAt,
  healthy: true,
  errors: [],
  mode: "full_marketplace_retrieval_audit",
  network: "eip155:8453",
  acquisition: { experiment: terminal },
};
const ledger = {
  schema_version: 2,
  active_epoch_id: 56,
  epochs: [{
    id: 56,
    status: "draining",
    conversion_eligible: false,
    classification: "excluded_unattributed_owner_triggered_downstream_probe",
  }],
  rotation: {
    id: POST_BOUNDARY_DRAIN_ID,
    status: "draining",
    requested_at: "2026-07-27T16:37:15.000Z",
    target_epoch_id: 57,
    reason: POST_BOUNDARY_DRAIN_REASON,
  },
};
const service = {
  Result: "success",
  ExecMainStatus: "0",
  ActiveState: "inactive",
  SubState: "dead",
  InvocationID: "a".repeat(32),
  started_at: "2026-07-27T16:37:15.000Z",
  completed_at: "2026-07-27T16:38:05.000Z",
  NeedDaemonReload: "no",
  DropInPaths: "",
  FragmentPath: "/home/mcr/.config/systemd/user/bountyverdict-acquisition-snapshot.service",
  WorkingDirectory: `${SNAPSHOT_SOURCE_WORKTREE}/agent`,
  ExecStartCommands: [
    "/usr/bin/env AUDITED_MONITOR=directory node --experimental-strip-types scripts/run-audited-monitor.ts",
    "/usr/bin/env AUDITED_MONITOR=distribution node --experimental-strip-types scripts/run-audited-monitor.ts",
  ],
};
const timer = {
  last_trigger_at: "2026-07-27T16:37:15.000Z",
  NeedDaemonReload: "no",
  DropInPaths: "",
  FragmentPath: "/home/mcr/.config/systemd/user/bountyverdict-acquisition-snapshot.timer",
};
const source = {
  worktree: SNAPSHOT_SOURCE_WORKTREE,
  head: SNAPSHOT_SOURCE_COMMIT,
  porcelain: "",
};
const units = {
  service_sha256: SNAPSHOT_SERVICE_SHA256,
  timer_sha256: SNAPSHOT_TIMER_SHA256,
};
const releaseCandidate = {
  worktree: RELEASE_CANDIDATE_WORKTREE,
  branch: RELEASE_CANDIDATE_BRANCH,
  head: "b".repeat(40),
  remote_head: "b".repeat(40),
  porcelain: "",
};

const verify = (overrides: Record<string, unknown> = {}) => verifyPostBoundaryReleaseGate({
  experiment,
  distributionReport: report,
  trustedFunnelLedger: ledger,
  snapshotService: service,
  snapshotTimer: timer,
  snapshotSource: source,
  snapshotUnits: units,
  releaseCandidate,
  ...overrides,
});

test("accepts one exact healthy terminal snapshot after the immutable boundary", () => {
  assert.deepEqual(verify(), {
    ready: true,
    terminal_status: "reach_failure",
    ends_at: EARNED_PLACEMENT_ENDS_AT,
    frozen_at: frozenAt,
    checked_at: frozenAt,
    measurement_valid: true,
    currently_healthy: true,
    genuine_purchases: 0,
    next_action: "expand_earned_reach",
    drain_rotation_id: POST_BOUNDARY_DRAIN_ID,
    drain_status: "draining",
    release_candidate_commit: "b".repeat(40),
  });
});

test("rejects early, inconclusive, unhealthy, stale, and service-failed snapshots", () => {
  assert.throws(() => verify({
    snapshotService: { ...service, Result: "failed", ExecMainStatus: "1" },
  }), /did not finish successfully/);
  assert.throws(() => verify({
    snapshotService: { ...service, InvocationID: "" },
  }), /definition or invocation evidence drifted/);
  assert.throws(() => verify({
    snapshotTimer: { ...timer, last_trigger_at: "2026-07-20T16:37:15.000Z" },
  }), /did not execute from the post-boundary timer/);
  assert.throws(() => verify({
    snapshotSource: { ...source, porcelain: " M agent/src/index.ts\n" },
  }), /dirty or no longer at the reviewed commit/);
  assert.throws(() => verify({
    snapshotUnits: { ...units, service_sha256: "0".repeat(64) },
  }), /unit hashes drifted/);
  assert.throws(() => verify({
    releaseCandidate: { ...releaseCandidate, porcelain: " M agent/src/index.ts\n" },
  }), /Release candidate is dirty/);
  assert.throws(() => verify({
    releaseCandidate: { ...releaseCandidate, remote_head: "c".repeat(40) },
  }), /not synchronized/);
  assert.throws(() => verify({
    releaseCandidate: { ...releaseCandidate, branch: "main" },
  }), /wrong branch/);
  assert.throws(() => verify({
    snapshotService: { ...service, completed_at: "2026-07-27T16:37:59.000Z" },
  }), /did not execute from the post-boundary timer/);
  assert.throws(() => verify({
    experiment: { ...experiment, ends_at: "2026-07-28T16:37:12.796Z" },
  }), /boundary drifted/);
  assert.throws(() => verify({
    experiment: {
      ...experiment,
      terminal_result: { ...terminal, status: "inconclusive_measurement" },
    },
  }), /status is invalid/);
  assert.throws(() => verify({
    experiment: {
      ...experiment,
      terminal_result: { ...terminal, measurement_valid: false },
    },
  }), /measurement-invalid/);
  assert.throws(() => verify({
    experiment: {
      ...experiment,
      terminal_result: { ...terminal, frozen_at: "2026-07-27T16:37:00.000Z" },
    },
  }), /froze before/);
  assert.throws(() => verify({
    distributionReport: { ...report, checked_at: "2026-07-27T16:39:00.000Z" },
  }), /does not belong/);
  assert.throws(() => verify({
    experiment: {
      ...experiment,
      terminal_result: { ...terminal, frozen_at: "2026-07-27T16:43:00.000Z" },
    },
    snapshotService: { ...service, completed_at: "2026-07-27T16:43:05.000Z" },
  }), /too long after/);
  assert.throws(() => verify({
    distributionReport: { ...report, mode: "report_only_without_semantic_retrieval" },
  }), /unhealthy/);
});

test("rejects baseline, provenance, report projection, and purchase reconciliation drift", () => {
  assert.throws(() => verify({
    experiment: {
      ...experiment,
      baseline: { ...EARNED_PLACEMENT_BASELINE_GATE, total_installs: 9 },
    },
  }), /baseline drifted/);
  assert.throws(() => verify({
    experiment: {
      ...experiment,
      measurement_provenance: {
        ...EARNED_PLACEMENT_PROVENANCE_GATE,
        purchases: { source: "marketplace_counter" },
      },
    },
  }), /provenance drifted/);
  assert.throws(() => verify({
    distributionReport: {
      ...report,
      acquisition: { experiment: { ...terminal, status: "off_target_reach" } },
    },
  }), /projection drifted/);
  assert.throws(() => verify({
    experiment: {
      ...experiment,
      terminal_result: {
        ...terminal,
        current: { ...terminal.current, genuine_purchases: 1 },
      },
    },
  }), /do not reconcile/);
  assert.throws(() => verify({
    trustedFunnelLedger: {
      ...ledger,
      rotation: { ...ledger.rotation, status: "activated" },
    },
  }), /not the exact draining/);
  assert.throws(() => verify({
    experiment: {
      ...experiment,
      terminal_result: {
        ...terminal,
        status: "off_target_reach",
        next_action: { code: "focus_reached_product" },
      },
    },
  }), /status does not reconcile/);
});
