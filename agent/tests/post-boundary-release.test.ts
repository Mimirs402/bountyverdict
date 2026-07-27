import assert from "node:assert/strict";
import test from "node:test";
import {
  POST_BOUNDARY_PULL_REQUEST,
  exactWorkflowRun,
  selectExactWorkflowRun,
  validateActivationCommit,
  validateMergedReleasePullRequest,
  validateOpenReleasePullRequest,
} from "../src/post-boundary-release.ts";
import {
  RELEASE_CANDIDATE_BRANCH,
  SNAPSHOT_SOURCE_COMMIT,
} from "../src/post-boundary-release-gate.ts";

const release = "a".repeat(40);
const merge = "b".repeat(40);
const activation = "c".repeat(40);
const openPull = {
  number: POST_BOUNDARY_PULL_REQUEST,
  state: "OPEN",
  baseRefName: "main",
  baseRefOid: SNAPSHOT_SOURCE_COMMIT,
  headRefName: RELEASE_CANDIDATE_BRANCH,
  headRefOid: release,
  mergeStateStatus: "CLEAN",
  statusCheckRollup: [{
    workflowName: "CI",
    name: "verify",
    status: "COMPLETED",
    conclusion: "SUCCESS",
  }],
  mergedAt: null,
  mergeCommit: null,
};
const run = {
  workflowName: "CI",
  status: "completed",
  conclusion: "success",
  event: "push",
  headBranch: "main",
  headSha: merge,
  databaseId: 123,
  url: "https://github.com/Mimirs402/bountyverdict/actions/runs/123",
  createdAt: "2026-07-27T16:40:00Z",
  updatedAt: "2026-07-27T16:41:00Z",
};

test("accepts only the exact clean checked release pull request", () => {
  assert.doesNotThrow(() => validateOpenReleasePullRequest(openPull, release));
  for (const patch of [
    { number: 12 },
    { baseRefOid: "d".repeat(40) },
    { headRefOid: "d".repeat(40) },
    { mergeStateStatus: "DIRTY" },
    { statusCheckRollup: [{ ...openPull.statusCheckRollup[0], conclusion: "FAILURE" }] },
  ]) {
    assert.throws(() => validateOpenReleasePullRequest({ ...openPull, ...patch }, release), /release pull request/i);
  }
});

test("binds the merged release to the same base and candidate", () => {
  const merged = {
    ...openPull,
    state: "MERGED",
    mergedAt: "2026-07-27T16:42:00Z",
    mergeCommit: { oid: merge },
  };
  assert.equal(validateMergedReleasePullRequest(merged, release), merge);
  assert.throws(() => validateMergedReleasePullRequest({
    ...merged,
    headRefOid: "d".repeat(40),
  }, release), /exact merged reviewed candidate/);
});

test("selects one exact successful workflow run and rejects ambiguous or failed evidence", () => {
  const expected = { workflowName: "CI", event: "push" as const, headSha: merge };
  assert.deepEqual(exactWorkflowRun(run, expected), run);
  assert.deepEqual(selectExactWorkflowRun([run], expected), run);
  assert.equal(selectExactWorkflowRun([], expected), null);
  assert.throws(() => selectExactWorkflowRun([run, { ...run, databaseId: 124, url:
    "https://github.com/Mimirs402/bountyverdict/actions/runs/124" }], expected), /More than one/);
  assert.throws(() => exactWorkflowRun({ ...run, conclusion: "failure" }, expected), /without success/);
  assert.throws(() => exactWorkflowRun({ ...run, headBranch: "release" }, expected), /exact main release/);
});

test("accepts only a bot-authored manifest-only activation child", () => {
  const payload = {
    sha: activation,
    parents: [{ sha: merge }],
    author: { login: "github-actions[bot]" },
    files: [{ filename: "agent-manifest.json" }],
  };
  assert.equal(validateActivationCommit(payload, merge), activation);
  assert.throws(() => validateActivationCommit({
    ...payload,
    files: [{ filename: "agent-manifest.json" }, { filename: "README.md" }],
  }, merge), /manifest-only child/);
  assert.throws(() => validateActivationCommit({
    ...payload,
    author: { login: "Mimirs402" },
  }, merge), /manifest-only child/);
});
