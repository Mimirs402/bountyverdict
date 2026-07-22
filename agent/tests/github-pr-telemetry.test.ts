import assert from "node:assert/strict";
import test from "node:test";
import { githubPrFields, githubPrSnapshot, readGitHubPrStatus, type GitHubCliRunner } from "../src/github-pr-telemetry.ts";

const url = "https://github.com/example/catalog/pull/42";
const headRefName = "add-example";
const headRefOid = "0123456789abcdef0123456789abcdef01234567";

const validPrPayload = {
  number: 42,
  url,
  state: "OPEN",
  mergedAt: null,
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "BEHIND",
  reviewDecision: "REVIEW_REQUIRED",
  headRefName,
  headRefOid,
  statusCheckRollup: [],
};

const workflowRun = (
  databaseId: number,
  name: string,
  status: string,
  conclusion: string | null,
) => ({
  databaseId,
  name,
  status,
  conclusion,
  headSha: headRefOid,
  event: "pull_request",
  url: `https://github.com/example/catalog/actions/runs/${databaseId}`,
});

test("authenticated GitHub PR telemetry validates identity and separates every gate outcome", async () => {
  const received: Array<{ args: readonly string[]; timeoutMs: number }> = [];
  const run: GitHubCliRunner = async (args, timeoutMs) => {
    received.push({ args, timeoutMs });
    if (args[0] === "pr") {
      return JSON.stringify({
        ...validPrPayload,
        statusCheckRollup: [
          { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
          { __typename: "CheckRun", name: "catalog", status: "IN_PROGRESS", conclusion: null },
          { __typename: "CheckRun", name: "security", status: "COMPLETED", conclusion: "FAILURE" },
          { __typename: "StatusContext", context: "legacy/deploy", state: "SUCCESS" },
          { __typename: "StatusContext", context: "legacy/scan", state: "PENDING" },
          { __typename: "StatusContext", context: "legacy/policy", state: "ERROR" },
          { __typename: "CheckRun", name: "docs", status: "COMPLETED", conclusion: "NEUTRAL" },
          { __typename: "CheckRun", name: "approval", status: "COMPLETED", conclusion: "ACTION_REQUIRED" },
          { __typename: "CheckRun", name: "obsolete", status: "COMPLETED", conclusion: "CANCELLED" },
        ],
      });
    }
    return JSON.stringify([
      workflowRun(1, "CI", "completed", "success"),
      workflowRun(2, "Docs", "completed", "skipped"),
      workflowRun(3, "Security", "completed", "failure"),
      workflowRun(4, "Old", "completed", "stale"),
      workflowRun(5, "Fork approval", "completed", "action_required"),
      workflowRun(6, "Integration", "queued", null),
    ]);
  };
  const result = await readGitHubPrStatus("example", "catalog", 42, url, 12_345, run);

  assert.deepEqual(received, [
    {
      args: [
        "pr", "view", "42", "--repo", "example/catalog", "--json",
        "number,url,state,mergedAt,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,headRefOid,statusCheckRollup",
      ],
      timeoutMs: 12_345,
    },
    {
      args: [
        "run", "list", "--repo", "example/catalog", "--branch", headRefName, "--limit", "101",
        "--json", "databaseId,name,status,conclusion,headSha,event,url",
      ],
      timeoutMs: 12_345,
    },
  ]);
  assert.deepEqual(result, {
    url,
    http_status: 200,
    status: "open",
    merged_at: null,
    draft: false,
    mergeable: true,
    merge_state_status: "BEHIND",
    review_decision: "REVIEW_REQUIRED",
    checks_total: 9,
    checks_pending: 2,
    checks_succeeded: 2,
    checks_neutral_or_skipped: 1,
    checks_failed: 2,
    checks_cancelled_or_stale: 1,
    checks_action_required: 1,
    failed_check_names: ["legacy/policy", "security"],
    action_required_check_names: ["approval"],
    workflow_runs_total: 6,
    workflow_runs_pending: 1,
    workflow_runs_succeeded: 1,
    workflow_runs_neutral_or_skipped: 1,
    workflow_runs_failed: 1,
    workflow_runs_cancelled_or_stale: 1,
    workflow_runs_action_required: 1,
    failed_workflow_names: ["Security"],
    action_required_workflow_names: ["Fork approval"],
  });
  assert.deepEqual(githubPrFields(result), {
    pr_merged_at: null,
    pr_draft: false,
    pr_mergeable: true,
    pr_merge_state_status: "BEHIND",
    pr_review_decision: "REVIEW_REQUIRED",
    pr_checks_total: 9,
    pr_checks_pending: 2,
    pr_checks_succeeded: 2,
    pr_checks_neutral_or_skipped: 1,
    pr_checks_failed: 2,
    pr_checks_cancelled_or_stale: 1,
    pr_checks_action_required: 1,
    pr_failed_check_names: ["legacy/policy", "security"],
    pr_action_required_check_names: ["approval"],
    pr_workflow_runs_total: 6,
    pr_workflow_runs_pending: 1,
    pr_workflow_runs_succeeded: 1,
    pr_workflow_runs_neutral_or_skipped: 1,
    pr_workflow_runs_failed: 1,
    pr_workflow_runs_cancelled_or_stale: 1,
    pr_workflow_runs_action_required: 1,
    pr_failed_workflow_names: ["Security"],
    pr_action_required_workflow_names: ["Fork approval"],
    pr_error: null,
  });
  assert.deepEqual(githubPrSnapshot(result), {
    pr_url: url,
    pr_status: "open",
    ...githubPrFields(result),
  });
});

test("canonical Cline skill and MCP pull requests remain distinct snapshots", () => {
  const skillUrl = "https://github.com/cline/marketplace/pull/15";
  const mcpUrl = "https://github.com/cline/marketplace/pull/16";
  const base = {
    status: "open" as const,
    checks_total: 0,
    workflow_runs_total: 0,
  };
  const skill = githubPrSnapshot({ ...base, url: skillUrl });
  const mcp = githubPrSnapshot({ ...base, url: mcpUrl });
  assert.equal(skill.pr_url, skillUrl);
  assert.equal(mcp.pr_url, mcpUrl);
  assert.notDeepEqual(skill, mcp);
});

test("GitHub PR telemetry fails closed on malformed identities, enums, and workflow runs", async () => {
  const firstResponseCases = [
    "not-json",
    JSON.stringify({ ...validPrPayload, number: 41 }),
    JSON.stringify({ ...validPrPayload, state: "UNKNOWN" }),
    JSON.stringify({ ...validPrPayload, headRefOid: "bad" }),
    JSON.stringify({ ...validPrPayload, statusCheckRollup: [{ __typename: "Unknown", name: "bad" }] }),
    JSON.stringify({ ...validPrPayload, statusCheckRollup: [{ __typename: "CheckRun", name: "bad", status: "UNKNOWN", conclusion: null }] }),
    JSON.stringify({ ...validPrPayload, statusCheckRollup: [{ __typename: "CheckRun", name: "bad", status: "COMPLETED", conclusion: "UNKNOWN" }] }),
    JSON.stringify({ ...validPrPayload, statusCheckRollup: [{ __typename: "StatusContext", context: "bad", state: "UNKNOWN" }] }),
  ];
  const secondResponseCases = [
    "not-json",
    JSON.stringify({}),
    JSON.stringify([workflowRun(1, "CI", "unknown", null)]),
    JSON.stringify([workflowRun(1, "CI", "completed", "unknown")]),
    JSON.stringify([{ ...workflowRun(1, "CI", "completed", "success"), headSha: "bad" }]),
    JSON.stringify(Array.from({ length: 101 }, (_, index) => workflowRun(index + 1, `CI ${index}`, "completed", "success"))),
  ];
  const cases: GitHubCliRunner[] = [
    ...firstResponseCases.map((response) => async () => response),
    ...secondResponseCases.map((response) => async (args: readonly string[]) =>
      args[0] === "pr" ? JSON.stringify(validPrPayload) : response),
    async () => { throw new Error("gh auth required"); },
    async () => { throw new Error("spawn gh ENOENT"); },
    async () => { throw new Error("Command timed out"); },
  ];
  for (const run of cases) {
    const result = await readGitHubPrStatus("example", "catalog", 42, url, 1, run);
    assert.equal(result.status, "request_failed");
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0);
    assert.equal(githubPrFields(result).pr_error, result.error);
  }
});

test("empty PR rollup still surfaces an approval-blocked workflow run", async () => {
  const run: GitHubCliRunner = async (args) => args[0] === "pr"
    ? JSON.stringify(validPrPayload)
    : JSON.stringify([workflowRun(7, "CI", "completed", "action_required")]);
  const result = await readGitHubPrStatus("example", "catalog", 42, url, 1_000, run);
  assert.equal(result.checks_total, 0);
  assert.equal(result.workflow_runs_total, 1);
  assert.equal(result.workflow_runs_action_required, 1);
  assert.deepEqual(result.action_required_workflow_names, ["CI"]);
});

test("workflow history for an older branch head is bounded but excluded", async () => {
  const oldHead = "fedcba9876543210fedcba9876543210fedcba98";
  const run: GitHubCliRunner = async (args) => args[0] === "pr"
    ? JSON.stringify(validPrPayload)
    : JSON.stringify([
        { ...workflowRun(7, "Old CI", "completed", "failure"), headSha: oldHead },
        workflowRun(8, "Current CI", "completed", "success"),
      ]);
  const result = await readGitHubPrStatus("example", "catalog", 42, url, 1_000, run);
  assert.equal(result.workflow_runs_total, 1);
  assert.equal(result.workflow_runs_failed, 0);
  assert.equal(result.workflow_runs_succeeded, 1);
});
