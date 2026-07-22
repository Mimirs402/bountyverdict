import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitHubPrStatus = {
  url: string;
  http_status?: 200;
  status: "open" | "closed" | "merged" | "request_failed";
  merged_at?: string | null;
  draft?: boolean;
  mergeable?: boolean | null;
  merge_state_status?: string | null;
  review_decision?: string | null;
  checks_total?: number;
  checks_pending?: number;
  checks_succeeded?: number;
  checks_neutral_or_skipped?: number;
  checks_failed?: number;
  checks_cancelled_or_stale?: number;
  checks_action_required?: number;
  failed_check_names?: string[];
  action_required_check_names?: string[];
  workflow_runs_total?: number;
  workflow_runs_pending?: number;
  workflow_runs_succeeded?: number;
  workflow_runs_neutral_or_skipped?: number;
  workflow_runs_failed?: number;
  workflow_runs_cancelled_or_stale?: number;
  workflow_runs_action_required?: number;
  failed_workflow_names?: string[];
  action_required_workflow_names?: string[];
  error?: string;
};

export type GitHubCliRunner = (args: readonly string[], timeoutMs: number) => Promise<string>;

const defaultRunner: GitHubCliRunner = async (args, timeoutMs) => {
  const { stdout } = await execFileAsync("gh", [...args], {
    timeout: timeoutMs,
    maxBuffer: 1_000_000,
    encoding: "utf8",
  });
  return String(stdout);
};

const CHECK_STATUSES = new Set(["COMPLETED", "IN_PROGRESS", "PENDING", "QUEUED", "REQUESTED", "WAITING"]);
const CHECK_CONCLUSIONS = new Set([
  "ACTION_REQUIRED", "CANCELLED", "FAILURE", "NEUTRAL", "SKIPPED", "STALE",
  "STARTUP_FAILURE", "SUCCESS", "TIMED_OUT",
]);
const CONTEXT_STATES = new Set(["ERROR", "EXPECTED", "FAILURE", "PENDING", "SUCCESS"]);
const WORKFLOW_STATUSES = new Set(["completed", "in_progress", "pending", "queued", "requested", "waiting"]);
const WORKFLOW_CONCLUSIONS = new Set([
  "action_required", "cancelled", "failure", "neutral", "skipped", "stale",
  "startup_failure", "success", "timed_out",
]);

type GateOutcome = {
  name: string;
  pending: boolean;
  succeeded: boolean;
  neutralOrSkipped: boolean;
  failed: boolean;
  cancelledOrStale: boolean;
  actionRequired: boolean;
};

function outcome(name: string, conclusion: string | null, pending: boolean, lowercase = false): GateOutcome {
  const exact = (value: string): boolean => conclusion === (lowercase ? value.toLowerCase() : value);
  return {
    name,
    pending,
    succeeded: !pending && exact("SUCCESS"),
    neutralOrSkipped: !pending && (exact("NEUTRAL") || exact("SKIPPED")),
    failed: !pending && (exact("FAILURE") || exact("STARTUP_FAILURE") || exact("TIMED_OUT") || exact("ERROR")),
    cancelledOrStale: !pending && (exact("CANCELLED") || exact("STALE")),
    actionRequired: !pending && exact("ACTION_REQUIRED"),
  };
}

export async function readGitHubPrStatus(
  owner: string,
  repo: string,
  pull: number,
  url: string,
  timeoutMs: number,
  run: GitHubCliRunner = defaultRunner,
): Promise<GitHubPrStatus> {
  try {
    const stdout = await run([
      "pr", "view", String(pull),
      "--repo", `${owner}/${repo}`,
      "--json", "number,url,state,mergedAt,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,headRefOid,statusCheckRollup",
    ], timeoutMs);
    const payload = JSON.parse(stdout) as {
      number?: number;
      url?: string;
      state?: string;
      mergedAt?: string | null;
      isDraft?: boolean;
      mergeable?: string | null;
      mergeStateStatus?: string | null;
      reviewDecision?: string | null;
      headRefName?: string;
      headRefOid?: string;
      statusCheckRollup?: Array<Record<string, unknown>>;
    };
    const state = payload.state;
    if (payload.number !== pull || payload.url !== url || !state || !["OPEN", "CLOSED", "MERGED"].includes(state)) {
      throw new Error("GitHub PR telemetry is malformed or identity-mismatched.");
    }
    if (typeof payload.headRefName !== "string" || payload.headRefName.length < 1 || payload.headRefName.length > 255 ||
      typeof payload.headRefOid !== "string" || !/^[0-9a-f]{40}$/.test(payload.headRefOid)) {
      throw new Error("GitHub PR head telemetry is malformed or unbounded.");
    }
    const mergeable = payload.mergeable === "MERGEABLE"
      ? true
      : payload.mergeable === "CONFLICTING"
        ? false
        : null;
    const checks = payload.statusCheckRollup;
    if (!Array.isArray(checks) || checks.length > 100) {
      throw new Error("GitHub PR check telemetry is malformed or unbounded.");
    }
    const normalizedChecks = checks.map((check) => {
      const type = check?.__typename;
      if (type !== undefined && type !== "CheckRun" && type !== "StatusContext") {
        throw new Error("GitHub PR check telemetry contains an unknown check type.");
      }
      const isStatusContext = type === "StatusContext" ||
        (typeof check?.context === "string" && typeof check?.state === "string");
      if (isStatusContext) {
        const name = check?.context;
        const state = check?.state;
        if (typeof name !== "string" || name.length < 1 || name.length > 200 ||
          typeof state !== "string" || !CONTEXT_STATES.has(state)) {
          throw new Error("GitHub PR check telemetry is malformed or unbounded.");
        }
        const pending = ["PENDING", "EXPECTED"].includes(state);
        return outcome(name, state, pending);
      }

      const name = check?.name;
      const status = check?.status;
      const conclusion = check?.conclusion;
      if (typeof name !== "string" || name.length < 1 || name.length > 200 ||
        typeof status !== "string" || !CHECK_STATUSES.has(status) ||
        !(conclusion === null || conclusion === undefined ||
          (typeof conclusion === "string" && CHECK_CONCLUSIONS.has(conclusion)))) {
        throw new Error("GitHub PR check telemetry is malformed or unbounded.");
      }
      const pending = status !== "COMPLETED" || conclusion === null || conclusion === undefined;
      return outcome(name, typeof conclusion === "string" ? conclusion : null, pending);
    });
    const workflowStdout = await run([
      "run", "list",
      "--repo", `${owner}/${repo}`,
      "--branch", payload.headRefName,
      "--limit", "101",
      "--json", "databaseId,name,status,conclusion,headSha,event,url",
    ], timeoutMs);
    const workflowRuns = JSON.parse(workflowStdout) as Array<Record<string, unknown>>;
    if (!Array.isArray(workflowRuns) || workflowRuns.length > 100) {
      throw new Error("GitHub workflow-run telemetry is malformed or unbounded.");
    }
    const validatedWorkflowRuns = workflowRuns.map((run) => {
      const id = run?.databaseId;
      const name = run?.name;
      const status = run?.status;
      const conclusion = run?.conclusion;
      const event = run?.event;
      const runUrl = run?.url;
      const expectedUrl = `https://github.com/${owner}/${repo}/actions/runs/${String(id)}`;
      if (!Number.isSafeInteger(id) || Number(id) < 1 ||
        typeof name !== "string" || name.length < 1 || name.length > 200 ||
        typeof status !== "string" || !WORKFLOW_STATUSES.has(status) ||
        !(conclusion === null || (typeof conclusion === "string" && WORKFLOW_CONCLUSIONS.has(conclusion))) ||
        typeof event !== "string" || event.length < 1 || event.length > 50 ||
        typeof run?.headSha !== "string" || !/^[0-9a-f]{40}$/.test(run.headSha) || runUrl !== expectedUrl) {
        throw new Error("GitHub workflow-run telemetry is malformed or identity-mismatched.");
      }
      const pending = status !== "completed" || conclusion === null;
      return { headSha: run.headSha, gate: outcome(name, conclusion as string | null, pending, true) };
    });
    const normalizedWorkflowRuns = validatedWorkflowRuns
      .filter(({ headSha }) => headSha === payload.headRefOid)
      .map(({ gate }) => gate);
    return {
      url,
      http_status: 200,
      status: payload.mergedAt || state === "MERGED" ? "merged" : state.toLowerCase() as "open" | "closed",
      merged_at: payload.mergedAt || null,
      draft: payload.isDraft === true,
      mergeable,
      merge_state_status: payload.mergeStateStatus || null,
      review_decision: payload.reviewDecision || null,
      checks_total: normalizedChecks.length,
      checks_pending: normalizedChecks.filter(({ pending }) => pending).length,
      checks_succeeded: normalizedChecks.filter(({ succeeded }) => succeeded).length,
      checks_neutral_or_skipped: normalizedChecks.filter(({ neutralOrSkipped }) => neutralOrSkipped).length,
      checks_failed: normalizedChecks.filter(({ failed }) => failed).length,
      checks_cancelled_or_stale: normalizedChecks.filter(({ cancelledOrStale }) => cancelledOrStale).length,
      checks_action_required: normalizedChecks.filter(({ actionRequired }) => actionRequired).length,
      failed_check_names: normalizedChecks.filter(({ failed }) => failed).map(({ name }) => name).sort(),
      action_required_check_names: normalizedChecks.filter(({ actionRequired }) => actionRequired).map(({ name }) => name).sort(),
      workflow_runs_total: normalizedWorkflowRuns.length,
      workflow_runs_pending: normalizedWorkflowRuns.filter(({ pending }) => pending).length,
      workflow_runs_succeeded: normalizedWorkflowRuns.filter(({ succeeded }) => succeeded).length,
      workflow_runs_neutral_or_skipped: normalizedWorkflowRuns.filter(({ neutralOrSkipped }) => neutralOrSkipped).length,
      workflow_runs_failed: normalizedWorkflowRuns.filter(({ failed }) => failed).length,
      workflow_runs_cancelled_or_stale: normalizedWorkflowRuns.filter(({ cancelledOrStale }) => cancelledOrStale).length,
      workflow_runs_action_required: normalizedWorkflowRuns.filter(({ actionRequired }) => actionRequired).length,
      failed_workflow_names: normalizedWorkflowRuns.filter(({ failed }) => failed).map(({ name }) => name).sort(),
      action_required_workflow_names: normalizedWorkflowRuns.filter(({ actionRequired }) => actionRequired).map(({ name }) => name).sort(),
    };
  } catch (error) {
    return {
      url,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function githubPrFields(review: GitHubPrStatus): Record<string, unknown> {
  return {
    pr_merged_at: review.merged_at || null,
    pr_draft: review.draft === true,
    pr_mergeable: review.mergeable ?? null,
    pr_merge_state_status: review.merge_state_status || null,
    pr_review_decision: review.review_decision || null,
    pr_checks_total: review.checks_total ?? null,
    pr_checks_pending: review.checks_pending ?? null,
    pr_checks_succeeded: review.checks_succeeded ?? null,
    pr_checks_neutral_or_skipped: review.checks_neutral_or_skipped ?? null,
    pr_checks_failed: review.checks_failed ?? null,
    pr_checks_cancelled_or_stale: review.checks_cancelled_or_stale ?? null,
    pr_checks_action_required: review.checks_action_required ?? null,
    pr_failed_check_names: review.failed_check_names || [],
    pr_action_required_check_names: review.action_required_check_names || [],
    pr_workflow_runs_total: review.workflow_runs_total ?? null,
    pr_workflow_runs_pending: review.workflow_runs_pending ?? null,
    pr_workflow_runs_succeeded: review.workflow_runs_succeeded ?? null,
    pr_workflow_runs_neutral_or_skipped: review.workflow_runs_neutral_or_skipped ?? null,
    pr_workflow_runs_failed: review.workflow_runs_failed ?? null,
    pr_workflow_runs_cancelled_or_stale: review.workflow_runs_cancelled_or_stale ?? null,
    pr_workflow_runs_action_required: review.workflow_runs_action_required ?? null,
    pr_failed_workflow_names: review.failed_workflow_names || [],
    pr_action_required_workflow_names: review.action_required_workflow_names || [],
    pr_error: review.error || null,
  };
}

export function githubPrSnapshot(review: GitHubPrStatus): Record<string, unknown> {
  return {
    pr_url: review.url,
    pr_status: review.status,
    ...githubPrFields(review),
  };
}
