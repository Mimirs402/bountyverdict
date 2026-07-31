import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { keccak256, toBytes } from "viem";
import { buildOpportunityTrigger, type OpportunityCandidate, type OpportunityPreparationResult } from "../src/opportunity-agent-workflow.ts";
import { admitTaskmarketSubmission } from "../src/opportunity-taskmarket-submission.ts";
import { taskmarketTaskSnapshotSha256, type TaskmarketTask } from "../src/taskmarket-demand.ts";

const worker = "0xe5E0fe496B7283032d034Dc79C305b384Ad1ee67";
const requester = "0x1111111111111111111111111111111111111111";
const diamond = "0xddc6cc3e4d11c1f3527b867c7dad4ed9869c33f7";
const forwarder = "0x8884f95b69dd1581565633aea85f9a9f7067144d";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const payer = "0x2222222222222222222222222222222222222222";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const taskCreatedTopic = "0xe0dc4072f8420c56e984e9c6eec7bad2e5616825f0d1ca581bd96ff3e8eec948";
const taskSubmittedTopic = "0x7d30d1881f77d1707467f58525863cb9ccbaedc1c4ddb2a4d9dd1349ca7a4e4b";
const word = (value: bigint) => value.toString(16).padStart(64, "0");
const topicAddress = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

function taskResult(task: TaskmarketTask): string {
  const reward = BigInt(task.rewardAtomic);
  const expiry = BigInt(Math.floor(Date.parse(task.expiryTime) / 1_000));
  return `0x${[
    task.id.slice(2), topicAddress(task.requester).slice(2), "0".repeat(64), word(0n),
    `a81913a5${"0".repeat(56)}`, word(reward), word(expiry), word(0n), word(750n),
    "0".repeat(64), word(0n), "0".repeat(64), word(0n), word(0n),
  ].join("")}`;
}

function fundingProof(task: TaskmarketTask) {
  const reward = BigInt(task.rewardAtomic);
  const expiry = BigInt(Math.floor(Date.parse(task.expiryTime) / 1_000));
  return {
    transaction_hash: task.escrowTxHash,
    task_id: task.id,
    task_result: taskResult(task),
    task_hooks_result: `0x${word(32n)}${word(0n)}`,
    task_evaluator_result: `0x${word(0n)}`,
    task_metadata_result: `0x${word(32n)}${word(BigInt(Math.floor(Date.parse(task.createdAt) / 1_000)))}${word(0n)}${word(0n)}${word(128n)}${word(0n)}`,
    receipt: {
      status: "0x1",
      transactionHash: task.escrowTxHash,
      to: forwarder,
      from: payer,
      logs: [{
        address: usdc,
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

test("submitter durably fences a task, mutates once, verifies onchain, and archives both intents", async () => {
  const root = await mkdtemp(join(tmpdir(), "taskmarket-submitter-integration-"));
  const stateRoot = join(root, "state");
  const intentRoot = join(stateRoot, "opportunity-submission-intents");
  const artifactRoot = join(root, "artifacts");
  const secondArtifactRoot = join(root, "artifacts-second");
  const fakeBin = join(root, "node_modules/.bin");
  const keystore = join(root, "keystore.json");
  const invocationLog = join(root, "cli-invocations.jsonl");
  await Promise.all([
    mkdir(intentRoot, { recursive: true, mode: 0o700 }),
    mkdir(artifactRoot, { recursive: true, mode: 0o700 }),
    mkdir(secondArtifactRoot, { recursive: true, mode: 0o700 }),
    mkdir(fakeBin, { recursive: true, mode: 0o700 }),
  ]);
  await writeFile(keystore, JSON.stringify({ walletAddress: worker, encryptedKey: "test-only" }), { mode: 0o600 });
  const artifact = join(artifactRoot, "report.md");
  const secondArtifact = join(secondArtifactRoot, "report.md");
  await writeFile(artifact, "# Verified result\n\nAll requested checks passed.\n", { mode: 0o600 });
  await writeFile(secondArtifact, "# Verified result\n\nAll requested checks passed.\n", { mode: 0o600 });

  const now = new Date();
  const task: TaskmarketTask = {
    id: `0x${"a".repeat(64)}`,
    requester,
    description: "Produce a verified compatibility report.",
    rewardAtomic: "110000000",
    netRewardAtomic: "101750000",
    escrowTxHash: `0x${"b".repeat(64)}`,
    createdAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
    expiryTime: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    status: "open",
    tags: ["research"],
    mode: "bounty",
    claimedBy: null,
    submissionWindowOpen: true,
    submissionCount: 0,
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
    gross_reward_usdc: "110",
    net_reward_usdc: "101.75",
    submission_count: 0,
    created_at: task.createdAt,
    deadline_at: task.expiryTime,
    hours_remaining: 2,
    escrow_tx_hash: task.escrowTxHash,
    requester: task.requester,
    task_snapshot_sha256: taskmarketTaskSnapshotSha256(task),
    opportunity_score_usdc_per_current_entry: "101.75",
    requires_agent_fit_review: true,
    selection_basis: "test fixture with exact onchain proof",
  };
  const preparation = (triggerId: string, artifactPath = artifact): OpportunityPreparationResult => ({
    schema_version: 1,
    trigger_id: triggerId,
    task_id: task.id,
    status: "PREPARED",
    summary: "Prepared and verified.",
    artifact_paths: [artifactPath],
    tests: [{ command: "validate report", passed: true, result: "passed" }],
    remaining_blockers: [],
    product_learning: [],
  });
  const firstTrigger = buildOpportunityTrigger([candidate], [], new Date(now.getTime() - 2_000).toISOString()).trigger!;
  const secondTrigger = buildOpportunityTrigger([{ ...candidate, selection_basis: "second independently assessed trigger" }], [], new Date(now.getTime() - 1_000).toISOString()).trigger!;
  const firstIntent = await admitTaskmarketSubmission({
    trigger: firstTrigger,
    preparation: preparation(firstTrigger.trigger_id),
    preparation_root: artifactRoot,
    current_task: task,
    funding_receipt: fundingProof(task),
    now,
  });
  const secondIntent = await admitTaskmarketSubmission({
    trigger: secondTrigger,
    preparation: preparation(secondTrigger.trigger_id, secondArtifact),
    preparation_root: secondArtifactRoot,
    current_task: task,
    funding_receipt: fundingProof(task),
    now,
  });
  for (const intent of [firstIntent, secondIntent]) {
    await writeFile(join(intentRoot, `${intent.intent_id}.json`), `${JSON.stringify(intent)}\n`, { mode: 0o600 });
  }

  const fakeCli = join(fakeBin, "taskmarket");
  await writeFile(fakeCli, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
let stateDurable = null;
let fenceDurable = null;
if (args[0] === "task" && args[1] === "submit") {
  const states = fs.readdirSync(${JSON.stringify(join(stateRoot, "opportunity-submission-states"))});
  stateDurable = states.some((name) => JSON.parse(fs.readFileSync(path.join(${JSON.stringify(join(stateRoot, "opportunity-submission-states"))}, name), "utf8")).state === "SUBMITTING");
  fenceDurable = fs.readdirSync(${JSON.stringify(join(stateRoot, "opportunity-taskmarket-task-fences"))}).length === 1;
}
fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify({ args, env: Object.keys(process.env).sort(), stateDurable, fenceDurable }) + "\\n");
if (args[0] === "address") console.log(JSON.stringify({ ok: true, data: { address: ${JSON.stringify(worker)} } }));
else if (args[0] === "identity" && args[1] === "status") console.log(JSON.stringify({ ok: true, data: { registered: true, agentId: "59501" } }));
else if (args[0] === "task" && args[1] === "submit") console.log(JSON.stringify({ ok: true, data: { submissionId: "11111111-1111-4111-8111-111111111111" } }));
else process.exit(2);
`, { mode: 0o700 });
  await chmod(fakeCli, 0o700);

  const submitTxHash = `0x${"c".repeat(64)}`;
  const manifestBody = JSON.stringify({
    artifacts: firstIntent.artifacts.map((entry, index) => ({
      displayOrder: index, fileName: entry.file_name, keccak256Hash: entry.keccak256, mediaKind: "text",
      mimeType: entry.mime_type, role: entry.role, sha256Hash: entry.sha256, sizeBytes: entry.size_bytes,
    })),
    version: "taskmarket-artifacts-v1",
  });
  const deliverableHash = keccak256(toBytes(manifestBody));
  const publicSubmission = {
    id: "11111111-1111-4111-8111-111111111111",
    taskId: task.id,
    workerAddress: worker,
    submitTxHash,
    deliverableHash,
    submittedAt: now.toISOString(),
    rejectedAt: null,
    artifacts: firstIntent.artifacts.map((entry, index) => ({
      fileName: entry.file_name,
      mimeType: entry.mime_type,
      role: entry.role,
      sizeBytes: entry.size_bytes,
      sha256Hash: entry.sha256,
      keccak256Hash: entry.keccak256,
      displayOrder: index,
    })),
  };
  const submissionReceipt = {
    status: "0x1",
    transactionHash: submitTxHash,
    to: forwarder,
    logs: [{
      address: diamond,
      topics: [taskSubmittedTopic, task.id, topicAddress(worker)],
      data: deliverableHash,
    }],
  };
  const originalFetch = globalThis.fetch;
  const originalCwd = process.cwd();
  const prior = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries({
    BOUNTY_OPPORTUNITY_STATE_ROOT: stateRoot,
    BOUNTY_TASKMARKET_KEYSTORE_FILE: keystore,
    HOME: root,
  })) {
    prior.set(key, process.env[key]);
    process.env[key] = value;
  }
  const json = (value: unknown) => new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.taskmarket.dev/api/legal/status") {
      return json({ accepted: false, bundle: { enforcementEnabled: false, status: "draft", bundleDigest: "sha256:test", version: "test" } });
    }
    if (url === `https://api.taskmarket.dev/api/tasks/${task.id}`) return json({
      id: task.id, requester: task.requester, description: task.description, reward: task.rewardAtomic,
      netReward: task.netRewardAtomic, escrowTxHash: task.escrowTxHash, createdAt: task.createdAt,
      expiryTime: task.expiryTime, status: task.status, tags: task.tags, mode: task.mode,
      claimedBy: null, submissionWindowOpen: true, submissionCount: 0, pitchCount: 0, pitchDeadline: null,
      submissionVisibility: "public", taskVisibility: "public", hooks: [], evaluator: null,
    });
    if (url === `https://api.taskmarket.dev/api/tasks/${task.id}/submissions`) {
      let submitted = false;
      try {
        submitted = (await readFile(invocationLog, "utf8")).split("\n").filter(Boolean)
          .some((line) => JSON.parse(line).args.slice(0, 2).join(" ") === "task submit");
      } catch {}
      return json(submitted ? [publicSubmission] : []);
    }
    if (url === `https://api.taskmarket.dev/api/tasks/${task.id}/submissions/${publicSubmission.id}/manifest`) {
      return new Response(manifestBody, { status: 200, headers: {
        "content-type": "application/json; charset=utf-8", "x-hash-function": "keccak256",
        "x-preimage-encoding": "json-utf8", "x-deliverable-hash": deliverableHash,
        "x-submit-tx-hash": submitTxHash,
      } });
    }
    if (url === "https://mainnet.base.org") {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (body.method === "eth_call") {
        const data = String((body.params[0] as { data: string }).data);
        const proof = fundingProof(task);
        const result = data.startsWith("0x15a29035") ? proof.task_result : data.startsWith("0x339f424b")
          ? proof.task_hooks_result : data.startsWith("0x9d691d36") ? proof.task_evaluator_result : proof.task_metadata_result;
        return json({ jsonrpc: "2.0", id: 1, result });
      }
      const hash = body.params[0];
      return json({ jsonrpc: "2.0", id: 1, result: hash === task.escrowTxHash ? fundingProof(task).receipt : submissionReceipt });
    }
    throw new Error(`Unexpected integration-test fetch: ${url}`);
  }) as typeof fetch;

  try {
    process.chdir(root);
    const module = await import(`../scripts/opportunity-taskmarket-submit.ts?integration=${Date.now()}`);
    assert.equal(await module.runTaskmarketSubmissionQueue(), 2);
  } finally {
    process.chdir(originalCwd);
    globalThis.fetch = originalFetch;
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const invocations = (await readFile(invocationLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const submits = invocations.filter(({ args }) => args.slice(0, 2).join(" ") === "task submit");
  const ownerIntent = [firstIntent, secondIntent].sort((left, right) => left.intent_id.localeCompare(right.intent_id))[0];
  assert.equal(submits.length, 1);
  assert.deepEqual(submits[0].args, ["task", "submit", task.id, "--file", ownerIntent.artifacts[0].path, "--role", "final"]);
  assert.equal(submits[0].stateDurable, true);
  assert.equal(submits[0].fenceDurable, true);
  assert.equal(submits[0].env.some((key: string) => /GH_|GITHUB|CDP|PRIVATE|TOKEN|SECRET/i.test(key)), false);
  assert.equal(invocations.some(({ args }) => args[0] === "legal"), false);

  const stateFiles = await readdir(join(stateRoot, "opportunity-submission-states"));
  const states = await Promise.all(stateFiles.map(async (name) => JSON.parse(await readFile(join(stateRoot, "opportunity-submission-states", name), "utf8"))));
  assert.deepEqual(states.map(({ state }) => state).sort(), ["AMBIGUOUS", "SUBMITTED_VERIFIED"]);
  assert.equal((await readdir(join(stateRoot, "opportunity-taskmarket-task-fences"))).length, 1);
  assert.equal((await readdir(join(stateRoot, "opportunity-submission-intents-archive"))).length, 2);
  const tracked = JSON.parse(await readFile(join(stateRoot, "opportunity-taskmarket-tracked.json"), "utf8"));
  assert.equal(tracked.submissions.length, 1);
  assert.equal(tracked.accounting.includes("zero purchases and zero revenue"), true);
});
