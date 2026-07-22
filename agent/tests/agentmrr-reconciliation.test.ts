import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENTMRR_PREVIOUS_CODE_RELEASE,
  AGENTMRR_PREVIOUS_RECEIPT_SHA256,
  AGENTMRR_PREVIOUS_RELEASE_SOURCE,
  AGENTMRR_PRODUCTION_ACTIVATION,
  AGENTMRR_PRODUCTION_RELEASE,
  buildAgentMrrReconciledCodeRelease,
  exactSuccessfulRun,
  parseAgentMrrPublicationCommandResult,
  parseAgentMrrReconciliationCommandResult,
  validateAgentMrrReconciledCodeRelease,
} from "../src/agentmrr-reconciliation.ts";
import {
  AGENTMRR_CODE_GATE_COMMIT,
  AGENTMRR_CODE_RELEASE_CONTRACT,
  AGENTMRR_REVIEWED_SOURCE_COMMIT,
  validateAgentMrrCodeReleaseState,
} from "../src/agentmrr.ts";

const current = "a".repeat(40);
const previous = {
  schema_version: 1,
  status: "complete",
  completed_at: "2026-07-22T09:15:12.000Z",
  source_head: AGENTMRR_CODE_GATE_COMMIT,
  release_source_head: AGENTMRR_PREVIOUS_RELEASE_SOURCE,
  reviewed_source: AGENTMRR_REVIEWED_SOURCE_COMMIT,
  code_contract: AGENTMRR_CODE_RELEASE_CONTRACT,
  release_commit: AGENTMRR_PREVIOUS_CODE_RELEASE,
  remote_main: AGENTMRR_PREVIOUS_CODE_RELEASE,
};

function run(workflowName: string, event: string, headSha: string, id: number) {
  return {
    workflowName,
    status: "completed",
    conclusion: "success",
    event,
    headBranch: "main",
    headSha,
    databaseId: id,
    url: `https://github.com/Mimirs402/bountyverdict/actions/runs/${id}`,
    createdAt: "2026-07-22T10:39:10.000Z",
    updatedAt: "2026-07-22T10:40:08.000Z",
  };
}

const evidence = {
  previousReceipt: previous,
  previousReceiptSha256: AGENTMRR_PREVIOUS_RECEIPT_SHA256,
  previousReceiptMode: 0o600,
  previousReceiptOwnerUid: 1000,
  expectedUid: 1000,
  currentCommit: current,
  currentReleaseSourceCommit: "f".repeat(40),
  currentTree: "b".repeat(40),
  ciRun: run("CI", "push", current, 101),
  pagesRun: run("pages-build-deployment", "dynamic", current, 102),
  productionDeployRun: run("Deploy paid Worker", "workflow_dispatch", AGENTMRR_PRODUCTION_RELEASE, 103),
  now: new Date("2026-07-22T10:41:00.000Z"),
};

test("reconciles an older exact release to current clean main and deployed production", () => {
  const receipt = buildAgentMrrReconciledCodeRelease(evidence);
  assert.equal(receipt.release_commit, current);
  assert.equal(receipt.remote_main, current);
  assert.equal(receipt.release_source_head, evidence.currentReleaseSourceCommit);
  assert.equal(receipt.production.release_commit, AGENTMRR_PRODUCTION_RELEASE);
  assert.equal(receipt.production.activation_commit, AGENTMRR_PRODUCTION_ACTIVATION);
  assert.equal(receipt.supersedes.release_commit, AGENTMRR_PREVIOUS_CODE_RELEASE);
  assert.equal(receipt.supersedes.receipt_sha256, evidence.previousReceiptSha256);
  assert.doesNotThrow(() => validateAgentMrrCodeReleaseState(
    receipt, 0o600, 1000, 1000, current, evidence.currentReleaseSourceCommit,
  ));
  assert.doesNotThrow(() => validateAgentMrrReconciledCodeRelease(
    receipt, 0o600, 1000, 1000, current, evidence.currentReleaseSourceCommit,
    evidence.currentTree, evidence.previousReceiptSha256,
    evidence.ciRun, evidence.pagesRun, evidence.productionDeployRun, evidence.now,
  ));
});

test("reconciliation refresh is limited to its reviewed attestation files", async () => {
  const { AGENTMRR_RECONCILIATION_FILES } = await import("../src/agentmrr-reconciliation.ts");
  assert.deepEqual([...AGENTMRR_RECONCILIATION_FILES], [
    "JOURNAL.md",
    "agent/src/agentmrr-reconciliation.ts",
    "agent/tests/agentmrr-reconciliation.test.ts",
  ]);
});

test("rejects drifted prior receipts, workflow identities, and future evidence", () => {
  assert.throws(() => buildAgentMrrReconciledCodeRelease({
    ...evidence,
    previousReceipt: { ...previous, release_commit: "c".repeat(40) },
  }), /code release/);
  assert.throws(() => buildAgentMrrReconciledCodeRelease({
    ...evidence,
    ciRun: { ...evidence.ciRun, headSha: "c".repeat(40) },
  }), /exact successful release evidence/);
  assert.throws(() => buildAgentMrrReconciledCodeRelease({
    ...evidence,
    pagesRun: { ...evidence.pagesRun, conclusion: "failure" },
  }), /exact successful release evidence/);
  assert.throws(() => buildAgentMrrReconciledCodeRelease({
    ...evidence,
    productionDeployRun: { ...evidence.productionDeployRun, event: "push" },
  }), /exact successful release evidence/);
  assert.throws(() => buildAgentMrrReconciledCodeRelease({
    ...evidence,
    now: new Date("2026-07-22T10:39:00.000Z"),
  }), /future release evidence/);
  assert.throws(() => buildAgentMrrReconciledCodeRelease({
    ...evidence,
    previousReceiptSha256: "not-a-hash",
  }), /receipt hash/);
  const receipt = buildAgentMrrReconciledCodeRelease(evidence);
  assert.throws(() => validateAgentMrrReconciledCodeRelease(
    receipt, 0o600, 1000, 1000, current, evidence.currentReleaseSourceCommit,
    "c".repeat(40), evidence.previousReceiptSha256,
    evidence.ciRun, evidence.pagesRun, evidence.productionDeployRun, evidence.now,
  ), /not exact/);
  assert.throws(() => validateAgentMrrReconciledCodeRelease(
    receipt, 0o600, 1000, 1000, current, evidence.currentReleaseSourceCommit,
    evidence.currentTree, "e".repeat(64),
    evidence.ciRun, evidence.pagesRun, evidence.productionDeployRun, evidence.now,
  ), /not exact/);
});

test("successful run parser binds GitHub identity, main, commit, event, and status", () => {
  const valid = evidence.ciRun;
  assert.deepEqual(exactSuccessfulRun(valid, { workflowName: "CI", event: "push", headSha: current }), valid);
  for (const patch of [
    { headBranch: "feature" },
    { status: "in_progress" },
    { conclusion: "neutral" },
    { databaseId: 0 },
    { url: "https://example.com/101" },
    { url: "https://github.com/Mimirs402/bountyverdict/actions/runs/999" },
  ]) {
    assert.throws(() => exactSuccessfulRun({ ...valid, ...patch }, {
      workflowName: "CI", event: "push", headSha: current,
    }), /exact successful release evidence/);
  }
});

test("release handoff accepts only the exact reconciliation and RunVerdict publication", () => {
  assert.deepEqual(parseAgentMrrReconciliationCommandResult({
    status: "reconciled",
    release_commit: current,
    production_release: AGENTMRR_PRODUCTION_RELEASE,
  }), { status: "reconciled", releaseCommit: current });
  assert.deepEqual(parseAgentMrrPublicationCommandResult({
    action: "published",
    product_id: "123e4567-e89b-42d3-a456-426614174000",
    name: "RunVerdict",
  }), { action: "published", productId: "123e4567-e89b-42d3-a456-426614174000" });
  assert.throws(() => parseAgentMrrReconciliationCommandResult({
    status: "armed_not_reconciled",
    release_commit: current,
    production_release: AGENTMRR_PRODUCTION_RELEASE,
  }), /did not complete/);
  assert.throws(() => parseAgentMrrPublicationCommandResult({
    action: "existing",
    product_id: "123e4567-e89b-42d3-a456-426614174000",
    name: "BountyVerdict",
  }), /exact product/);
});
