import { RELEASE_CANDIDATE_BRANCH, SNAPSHOT_SOURCE_COMMIT } from "./post-boundary-release-gate.ts";
import { FREE_SELECTION_ROUTER_EXPERIMENT_ID } from "./task-leading-description-experiment.ts";

export const POST_BOUNDARY_REPOSITORY = "Mimirs402/bountyverdict";
export const POST_BOUNDARY_PULL_REQUEST = 11;
export const DISTRIBUTION_MONITOR_WORKING_DIRECTORY =
  "/home/mcr/Projects/sandbox/bountyverdict/agent";

type WorkflowExpectation = {
  workflowName: string;
  event: "push" | "dynamic" | "workflow_dispatch";
  headSha: string;
};

export type ExactWorkflowRun = {
  workflowName: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string;
  event: string;
  headBranch: string;
  headSha: string;
  databaseId: number;
  url: string;
  createdAt: string;
  updatedAt: string;
};

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

function commit(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a full lowercase commit hash.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a timestamp.`);
  }
  return value;
}

export function validateOpenReleasePullRequest(value: unknown, releaseCommit: string): void {
  const pull = record(value, "Release pull request");
  if (pull.number !== POST_BOUNDARY_PULL_REQUEST || pull.state !== "OPEN" ||
      pull.baseRefName !== "main" || pull.headRefName !== RELEASE_CANDIDATE_BRANCH ||
      pull.baseRefOid !== SNAPSHOT_SOURCE_COMMIT ||
      pull.headRefOid !== commit(releaseCommit, "Release candidate") ||
      pull.mergeStateStatus !== "CLEAN" || !Array.isArray(pull.statusCheckRollup) ||
      pull.statusCheckRollup.length < 1) {
    throw new Error("Release pull request is not the exact clean reviewed candidate.");
  }
  const checks = pull.statusCheckRollup.map((value: unknown) => record(value, "Release pull request check"));
  if (!checks.some((check) => check.workflowName === "CI" && check.name === "verify") ||
      checks.some((check) => check.status !== "COMPLETED" || check.conclusion !== "SUCCESS")) {
    throw new Error("Release pull request checks are not all successful.");
  }
}

export function validateMergedReleasePullRequest(value: unknown, releaseCommit: string): string {
  const pull = record(value, "Merged release pull request");
  const merge = record(pull.mergeCommit, "Release merge commit");
  if (pull.number !== POST_BOUNDARY_PULL_REQUEST || pull.state !== "MERGED" ||
      pull.baseRefName !== "main" || pull.headRefName !== RELEASE_CANDIDATE_BRANCH ||
      pull.baseRefOid !== SNAPSHOT_SOURCE_COMMIT ||
      pull.headRefOid !== commit(releaseCommit, "Release candidate") ||
      typeof pull.mergedAt !== "string" || !Number.isFinite(Date.parse(pull.mergedAt))) {
    throw new Error("Release pull request is not the exact merged reviewed candidate.");
  }
  return commit(merge.oid, "Release merge commit");
}

export function exactWorkflowRun(value: unknown, expected: WorkflowExpectation): ExactWorkflowRun {
  const run = record(value, `${expected.workflowName} run`);
  const status = run.status;
  if (run.workflowName !== expected.workflowName || run.event !== expected.event ||
      run.headBranch !== "main" || run.headSha !== commit(expected.headSha, "Expected workflow head") ||
      (status !== "queued" && status !== "in_progress" && status !== "completed") ||
      !Number.isSafeInteger(run.databaseId) || Number(run.databaseId) < 1 ||
      typeof run.url !== "string" ||
      !/^https:\/\/github\.com\/Mimirs402\/bountyverdict\/actions\/runs\/[1-9][0-9]*$/.test(run.url) ||
      Number(run.url.split("/").at(-1)) !== Number(run.databaseId)) {
    throw new Error(`${expected.workflowName} run is not bound to the exact main release.`);
  }
  const conclusion = typeof run.conclusion === "string" ? run.conclusion : "";
  if (status === "completed" && conclusion !== "success") {
    throw new Error(`${expected.workflowName} run completed without success.`);
  }
  if (status !== "completed" && conclusion !== "") {
    throw new Error(`${expected.workflowName} active run has an unexpected conclusion.`);
  }
  return {
    workflowName: run.workflowName,
    status,
    conclusion,
    event: run.event,
    headBranch: run.headBranch,
    headSha: run.headSha,
    databaseId: Number(run.databaseId),
    url: run.url,
    createdAt: timestamp(run.createdAt, `${expected.workflowName} createdAt`),
    updatedAt: timestamp(run.updatedAt, `${expected.workflowName} updatedAt`),
  };
}

export function selectExactWorkflowRun(value: unknown, expected: WorkflowExpectation): ExactWorkflowRun | null {
  if (!Array.isArray(value) || value.length > 30) {
    throw new Error(`${expected.workflowName} run list is malformed.`);
  }
  const candidates = value.filter((candidate) => {
    const run = record(candidate, `${expected.workflowName} run candidate`);
    return run.workflowName === expected.workflowName && run.event === expected.event &&
      run.headBranch === "main" && run.headSha === expected.headSha;
  });
  if (candidates.length > 1) {
    throw new Error(`More than one ${expected.workflowName} run exists for the exact release.`);
  }
  return candidates.length === 1 ? exactWorkflowRun(candidates[0], expected) : null;
}

export function validateActivationCommit(value: unknown, releaseMergeCommit: string): string {
  const activation = record(value, "Production activation commit");
  const parents = activation.parents;
  const files = activation.files;
  if (!Array.isArray(parents) || parents.length !== 1 ||
      record(parents[0], "Production activation parent").sha !==
        commit(releaseMergeCommit, "Release merge commit") ||
      !Array.isArray(files) || files.length !== 1 ||
      record(files[0], "Production activation file").filename !== "agent-manifest.json" ||
      record(activation.author, "Production activation author").login !== "github-actions[bot]") {
    throw new Error("Production activation is not the exact manifest-only child of the release.");
  }
  return commit(activation.sha, "Production activation commit");
}

export function validateActivatedManifest(value: unknown): string {
  const manifest = record(value, "Activated agent manifest");
  if (manifest.schema_version !== "1.0" || manifest.product !== "BountyVerdict" ||
      manifest.status !== "active" ||
      manifest.production_api !== "https://bountyverdict-agent-production.mimirslab.workers.dev") {
    throw new Error("Activated agent manifest identity or production origin drifted.");
  }
  const updatedAt = timestamp(manifest.updated_at, "Activated agent manifest updated_at");
  if (new Date(updatedAt).toISOString() !== updatedAt) {
    throw new Error("Activated agent manifest updated_at is not canonical.");
  }
  return updatedAt;
}

export function validateDistributionMonitorHandoff(
  value: unknown,
  coordinates: {
    releaseCommit: string;
    productionActivationCommit: string;
    productionActivatedAt: string;
    notBefore: string;
  },
): {
  checkedAt: string;
  status: string;
  measurementEpochId: number;
} {
  const handoff = record(value, "Distribution monitor handoff");
  if (handoff.working_directory !== DISTRIBUTION_MONITOR_WORKING_DIRECTORY ||
      handoff.need_daemon_reload !== "no") {
    throw new Error("Distribution monitor did not load the canonical released worktree.");
  }
  const report = record(handoff.report, "Distribution monitor report");
  const checkedAt = timestamp(report.checked_at, "Distribution monitor checked_at");
  const notBefore = timestamp(coordinates.notBefore, "Distribution monitor handoff boundary");
  if (new Date(checkedAt).toISOString() !== checkedAt ||
      new Date(notBefore).toISOString() !== notBefore ||
      Date.parse(checkedAt) < Date.parse(notBefore) ||
      report.mode !== "report_only_without_semantic_retrieval") {
    throw new Error("Distribution monitor report is stale or not report-only.");
  }
  const funnel = record(report.funnel, "Distribution monitor funnel");
  const experiment = record(
    funnel.mcp_free_selection_router_experiment,
    "Free selection router experiment",
  );
  const activation = record(experiment.activation, "Free selection router activation");
  if (experiment.id !== FREE_SELECTION_ROUTER_EXPERIMENT_ID ||
      experiment.activation_verified !== true ||
      experiment.measurement_epoch_id !== 57 ||
      (experiment.status !== "running_clean_epoch" && experiment.status !== "completed") ||
      activation.release_commit !== commit(coordinates.releaseCommit, "Release commit") ||
      activation.production_activation_commit !==
        commit(coordinates.productionActivationCommit, "Production activation commit") ||
      activation.production_activated_at !==
        timestamp(coordinates.productionActivatedAt, "Production activated_at") ||
      activation.measurement_epoch_id !== 57) {
    throw new Error("Distribution monitor did not checkpoint the exact epoch-57 free router experiment.");
  }
  return {
    checkedAt,
    status: experiment.status,
    measurementEpochId: 57,
  };
}
