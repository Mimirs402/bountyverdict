import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { keccak256, toBytes } from "viem";
import {
  buildOpportunityTrigger,
  type OpportunityCandidate,
  type OpportunityPreparationResult,
} from "../src/opportunity-agent-workflow.ts";
import {
  admitTaskmarketSubmission,
  parseTaskmarketCliIdentity,
  parseTaskmarketSubmissionIntent,
  reconcileTaskmarketSubmissionIntent,
  revalidateTaskmarketSubmissionArtifacts,
  validateTaskmarketIntentAgainstFreshTask,
  verifyTaskmarketSubmissionReceipt,
} from "../src/opportunity-taskmarket-submission.ts";
import {
  taskmarketTaskSnapshotSha256,
  type TaskmarketTask,
} from "../src/taskmarket-demand.ts";

const task: TaskmarketTask = {
  id: `0x${"a".repeat(64)}`,
  requester: "0x1111111111111111111111111111111111111111",
  description: "Produce a verified compatibility report.",
  rewardAtomic: "6000000",
  netRewardAtomic: "5550000",
  escrowTxHash: `0x${"b".repeat(64)}`,
  createdAt: "2026-07-21T11:30:00.000Z",
  expiryTime: "2026-07-21T18:00:00.000Z",
  status: "open",
  tags: ["research"],
  mode: "bounty",
  claimedBy: null,
  submissionWindowOpen: true,
  submissionCount: 1,
  pitchCount: 0,
  pitchDeadline: null,
  submissionVisibility: "public",
  taskVisibility: "public",
  hooks: [],
  evaluator: null,
};

const candidate: OpportunityCandidate = {
  market: "taskmarket",
  task_id: task.id,
  title: "Produce a verified compatibility report.",
  mode: "bounty",
  gross_reward_usdc: "6",
  net_reward_usdc: "5.55",
  submission_count: 1,
  created_at: task.createdAt,
  deadline_at: task.expiryTime,
  hours_remaining: 6,
  escrow_tx_hash: task.escrowTxHash,
  requester: task.requester,
  task_snapshot_sha256: taskmarketTaskSnapshotSha256(task),
  opportunity_score_usdc_per_current_entry: "2.775",
  requires_agent_fit_review: true,
  selection_basis: "onchain verified",
};

const taskCreatedTopic = "0xe0dc4072f8420c56e984e9c6eec7bad2e5616825f0d1ca581bd96ff3e8eec948";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const diamond = "0xddc6cc3e4d11c1f3527b867c7dad4ed9869c33f7";
const payer = "0x2222222222222222222222222222222222222222";
const topicAddress = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
const word = (value: bigint) => value.toString(16).padStart(64, "0");

function fundingReceipt(status = "0x1") {
  const reward = BigInt(task.rewardAtomic);
  const expiry = BigInt(Math.floor(Date.parse(task.expiryTime) / 1_000));
  return {
    transaction_hash: task.escrowTxHash,
    task_id: task.id,
    task_result: `0x${[
      task.id.slice(2),
      topicAddress(task.requester).slice(2),
      "0".repeat(64),
      word(0n),
      `a81913a5${"0".repeat(56)}`,
      word(reward),
      word(expiry),
      word(0n),
      word(750n),
      "0".repeat(64),
      word(0n),
      "0".repeat(64),
      word(0n),
      word(0n),
    ].join("")}`,
    task_hooks_result: `0x${word(32n)}${word(0n)}`,
    task_evaluator_result: `0x${word(0n)}`,
    task_metadata_result: `0x${word(32n)}${word(BigInt(Math.floor(Date.parse(task.createdAt) / 1_000)))}${word(0n)}${word(0n)}${word(128n)}${word(0n)}`,
    receipt: {
      status,
      transactionHash: task.escrowTxHash,
      to: "0x8884f95b69dd1581565633aea85f9a9f7067144d",
      from: payer,
      logs: [{
        address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        topics: [transferTopic, topicAddress(payer), topicAddress(diamond)],
        data: `0x${word(reward)}`,
      }, {
        address: diamond,
        topics: [taskCreatedTopic, task.id, topicAddress(task.requester), `0xa81913a5${"0".repeat(56)}`],
        data: `0x${word(reward)}${word(expiry)}${word(0n)}${word(0n)}`,
      }],
    },
  };
}

test("blocker-free Taskmarket preparation becomes a hash-bound eligible intent", async () => {
  const root = await mkdtemp(join(tmpdir(), "taskmarket-intent-"));
  const artifact = join(root, "report.json");
  const htmlArtifact = join(root, "report.html");
  await writeFile(artifact, '{"verified":true}\n', { mode: 0o600 });
  await writeFile(htmlArtifact, "<!doctype html><title>Verified report</title>\n", { mode: 0o600 });
  const { trigger } = buildOpportunityTrigger([candidate], [], "2026-07-21T12:00:00.000Z");
  assert.ok(trigger);
  const preparation: OpportunityPreparationResult = {
    schema_version: 1,
    trigger_id: trigger.trigger_id,
    task_id: task.id,
    status: "PREPARED",
    summary: "Prepared and deterministically validated.",
    artifact_paths: [artifact, htmlArtifact],
    tests: [{ command: "validate report schema", passed: true, result: "passed" }],
    remaining_blockers: [],
    product_learning: [],
  };
  const intent = await admitTaskmarketSubmission({
    trigger,
    preparation,
    preparation_root: root,
    current_task: task,
    funding_receipt: fundingReceipt(),
    now: new Date("2026-07-21T12:10:00.000Z"),
  });
  assert.equal(intent.state, "ELIGIBLE");
  assert.equal(intent.guardrails.max_payment_usdc, "0");
  assert.equal(intent.artifacts[0].validator, "utf8_json_parse");
  assert.equal(intent.artifacts[1].mime_type, "application/octet-stream");
  assert.equal(intent.artifacts[1].validator, "utf8_nonempty_secret_scan");
  assert.deepEqual(parseTaskmarketSubmissionIntent(JSON.parse(JSON.stringify(intent))), intent);
  validateTaskmarketIntentAgainstFreshTask(intent, task, fundingReceipt(), new Date("2026-07-21T12:10:00.000Z"));
  await revalidateTaskmarketSubmissionArtifacts(intent);
  const publicSubmission = {
    id: "11592476-6f08-472f-908c-0d9531275757",
    taskId: task.id,
    workerAddress: intent.worker_address,
    submitTxHash: `0x${"c".repeat(64)}`,
    deliverableHash: "",
    submittedAt: "2026-07-21T12:11:00.000Z",
    rejectedAt: null,
    artifacts: intent.artifacts.map((entry, index) => ({
      fileName: entry.file_name,
      mimeType: entry.mime_type,
      role: entry.role,
      sizeBytes: entry.size_bytes,
      sha256Hash: entry.sha256,
      keccak256Hash: entry.keccak256,
      displayOrder: index,
    })),
  };
  const manifestBody = JSON.stringify({
    artifacts: intent.artifacts.map((entry, index) => ({
      displayOrder: index, fileName: entry.file_name, keccak256Hash: entry.keccak256,
      mediaKind: entry.mime_type === "application/json" || entry.mime_type === "text/markdown" ? "text" : "unknown",
      mimeType: entry.mime_type, role: entry.role, sha256Hash: entry.sha256, sizeBytes: entry.size_bytes,
    })),
    version: "taskmarket-artifacts-v1",
  });
  publicSubmission.deliverableHash = keccak256(toBytes(manifestBody));
  assert.equal(reconcileTaskmarketSubmissionIntent(intent, []).status, "ABSENT");
  assert.equal(reconcileTaskmarketSubmissionIntent(intent, [publicSubmission]).status, "MANIFEST_REQUIRED");
  const reconciled = reconcileTaskmarketSubmissionIntent(intent, [publicSubmission], {
    body: manifestBody,
    content_type: "application/json; charset=utf-8",
    hash_function: "keccak256",
    preimage_encoding: "json-utf8",
    deliverable_hash: publicSubmission.deliverableHash,
    submit_tx_hash: publicSubmission.submitTxHash,
  });
  assert.equal(reconciled.status, "VERIFIED");
  if (reconciled.status === "VERIFIED") {
    assert.equal(reconciled.tracked.expected_net_atomic, "5550000");
    assert.equal(verifyTaskmarketSubmissionReceipt(intent, reconciled.submission, {
      transaction_hash: reconciled.submission.submitTxHash,
      receipt: {
        status: "0x1",
        transactionHash: reconciled.submission.submitTxHash,
        to: "0x8884f95b69dd1581565633aea85f9a9f7067144d",
        logs: [{
          address: diamond,
          topics: [
            "0x7d30d1881f77d1707467f58525863cb9ccbaedc1c4ddb2a4d9dd1349ca7a4e4b",
            task.id,
            topicAddress(intent.worker_address),
          ],
          data: reconciled.submission.deliverableHash,
        }],
      },
    }), true);
  }
  assert.equal(reconcileTaskmarketSubmissionIntent(intent, [{
    ...publicSubmission,
    artifacts: [{ ...publicSubmission.artifacts[0], sha256Hash: "0".repeat(64) }],
  }]).status, "AMBIGUOUS");
  parseTaskmarketCliIdentity(
    { ok: true, data: { address: intent.worker_address } },
    { ok: true, data: { registered: true, agentId: intent.worker_agent_id } },
    { ok: true, data: { accepted: false, enforcementEnabled: false, status: "draft" } },
  );
  assert.throws(() => parseTaskmarketCliIdentity(
    { ok: true, data: { address: intent.worker_address } },
    { ok: true, data: { registered: true, agentId: intent.worker_agent_id } },
    { ok: true, data: { accepted: false, enforcementEnabled: true, status: "active" } },
  ), /manual boundary/);
  await writeFile(artifact, '{"verified":false}\n', { mode: 0o600 });
  await assert.rejects(revalidateTaskmarketSubmissionArtifacts(intent), /changed after admission/);
});

test("submission admission fails closed on blockers, task drift, funding drift, and credential-like artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "taskmarket-intent-reject-"));
  const artifact = join(root, "report.md");
  await writeFile(artifact, "Safe report.\n", { mode: 0o600 });
  const { trigger } = buildOpportunityTrigger([candidate], [], "2026-07-21T12:00:00.000Z");
  assert.ok(trigger);
  const preparation: OpportunityPreparationResult = {
    schema_version: 1,
    trigger_id: trigger.trigger_id,
    task_id: task.id,
    status: "PREPARED",
    summary: "Prepared.",
    artifact_paths: [artifact],
    tests: [{ command: "validate report", passed: true, result: "passed" }],
    remaining_blockers: ["Needs external validation."],
    product_learning: [],
  };
  const base = {
    trigger,
    preparation,
    preparation_root: root,
    current_task: task,
    funding_receipt: fundingReceipt(),
    now: new Date("2026-07-21T12:10:00.000Z"),
  };
  await assert.rejects(admitTaskmarketSubmission(base), /blocker-free/);
  preparation.remaining_blockers = [];
  preparation.tests[0].passed = false;
  await assert.rejects(admitTaskmarketSubmission(base), /all passed/);
  preparation.tests[0].passed = true;
  await assert.rejects(admitTaskmarketSubmission({ ...base, current_task: { ...task, description: "Drifted." } }), /drifted/);
  await assert.rejects(admitTaskmarketSubmission({ ...base, funding_receipt: fundingReceipt("0x0") }), /not independently verified/);
  await writeFile(artifact, "CDP_WALLET_SECRET=must-not-leak\n", { mode: 0o600 });
  await assert.rejects(admitTaskmarketSubmission(base), /credential-like/);
  assert.match(await readFile(artifact, "utf8"), /must-not-leak/);
  await writeFile(artifact, "-----BEGIN ENCRYPTED PRIVATE KEY-----\nnot-a-real-key\n", { mode: 0o600 });
  await assert.rejects(admitTaskmarketSubmission(base), /credential-like/);
});
