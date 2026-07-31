import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative } from "node:path";
import { keccak256, toBytes } from "viem";
import type {
  OpportunityPreparationResult,
  OpportunityTrigger,
} from "./opportunity-agent-workflow.ts";
import {
  TASKMARKET_OWNER_IDENTITIES,
  TASKMARKET_DIAMOND,
  TASKMARKET_FORWARDER,
  TASKMARKET_WORKER_ADDRESS,
  taskmarketTaskSnapshotSha256,
  verifyTaskmarketFundingReceipt,
  type TaskmarketFundingReceiptPayload,
  type TaskmarketTask,
  type TaskmarketTrackedSpecification,
} from "./taskmarket-demand.ts";

export const TASKMARKET_WORKER_AGENT_ID = "59501";
const maximumIntentAgeMs = 3 * 60 * 60 * 1_000;
const maximumTaskAgeMs = 12 * 60 * 60 * 1_000;
const minimumDeadlineRemainingMs = 30 * 60 * 1_000;
const maximumArtifacts = 20;
const maximumArtifactBytes = 40 * 1024 * 1024;
const maximumSingleArtifactBytes = 20 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;
const bytes32Pattern = /^0x[a-f0-9]{64}$/i;
const addressPattern = /^0x[a-f0-9]{40}$/i;

const mimeByExtension = new Map([
  // Keep this mapping byte-for-byte aligned with @lucid-agents/taskmarket 1.4.0's
  // upload metadata. Its CLI intentionally falls back to octet-stream for
  // text extensions outside the explicit cases below.
  [".csv", "application/octet-stream"],
  [".css", "application/octet-stream"],
  [".html", "application/octet-stream"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "application/octet-stream"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ts", "application/octet-stream"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".xml", "application/octet-stream"],
] as const);

const forbiddenFileNames = new Set([
  ".env",
  ".npmrc",
  "credentials.json",
  "keystore.json",
  "wallet.json",
]);

const forbiddenText = [
  /-----BEGIN (?:(?:RSA|EC|OPENSSH|ENCRYPTED) PRIVATE KEY|PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /(?:^|\n)\s*(?:CDP_API_KEY_SECRET|CDP_WALLET_SECRET|PRIVATE_KEY|MNEMONIC|SEED_PHRASE)\s*=/i,
];

export type TaskmarketSubmissionArtifact = {
  path: string;
  file_name: string;
  mime_type: string;
  role: "final";
  size_bytes: number;
  sha256: string;
  keccak256: `0x${string}`;
  validator: string;
};

export type TaskmarketSubmissionIntent = {
  schema_version: 1;
  kind: "taskmarket_submission_intent";
  state: "ELIGIBLE";
  intent_id: string;
  created_at: string;
  trigger_id: string;
  task_id: string;
  preparation_root: string;
  worker_address: typeof TASKMARKET_WORKER_ADDRESS;
  worker_agent_id: typeof TASKMARKET_WORKER_AGENT_ID;
  requester: string;
  escrow_tx_hash: string;
  gross_reward_usdc: string;
  net_reward_usdc: string;
  deadline_at: string;
  task_snapshot_sha256: string;
  artifact_manifest_sha256: string;
  artifacts: TaskmarketSubmissionArtifact[];
  funding_proof: {
    network: "eip155:8453";
    transaction_hash: string;
    verified: true;
  };
  guardrails: {
    external_action: "taskmarket_submit_only";
    max_payment_usdc: "0";
    legal_acceptance_enabled: false;
    registration_enabled: false;
    wallet_switch_enabled: false;
    personal_identity_use_enabled: false;
  };
};

function inside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function hex(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString("hex");
}

function validateMagic(mime: string, contents: Uint8Array): string {
  if (mime === "image/png") {
    if (hex(contents.subarray(0, 8)) !== "89504e470d0a1a0a") throw new Error("PNG artifact magic is invalid.");
    return "png_magic";
  }
  if (mime === "image/jpeg") {
    if (hex(contents.subarray(0, 3)) !== "ffd8ff") throw new Error("JPEG artifact magic is invalid.");
    return "jpeg_magic";
  }
  if (mime === "image/webp") {
    if (contents.length < 12 || Buffer.from(contents.subarray(0, 4)).toString() !== "RIFF" ||
      Buffer.from(contents.subarray(8, 12)).toString() !== "WEBP") throw new Error("WebP artifact magic is invalid.");
    return "webp_magic";
  }
  if (mime === "application/pdf") {
    if (Buffer.from(contents.subarray(0, 5)).toString() !== "%PDF-") throw new Error("PDF artifact magic is invalid.");
    return "pdf_magic";
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  if (!text.trim() || text.includes("\u0000")) throw new Error("Text artifact is empty or contains NUL bytes.");
  if (forbiddenText.some((pattern) => pattern.test(text))) throw new Error("Text artifact contains credential-like material.");
  if (mime === "application/json") JSON.parse(text);
  return mime === "application/json" ? "utf8_json_parse" : "utf8_nonempty_secret_scan";
}

async function inspectArtifacts(
  preparationRoot: string,
  artifactPaths: readonly string[],
): Promise<TaskmarketSubmissionArtifact[]> {
  if (artifactPaths.length < 1 || artifactPaths.length > maximumArtifacts) {
    throw new Error("Taskmarket submission requires between one and twenty artifacts.");
  }
  const canonicalRoot = await realpath(preparationRoot);
  const artifacts: TaskmarketSubmissionArtifact[] = [];
  const names = new Set<string>();
  let totalBytes = 0;
  for (const path of artifactPaths) {
    if (!isAbsolute(path)) throw new Error("Taskmarket artifact path is not absolute.");
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 ||
      metadata.size > maximumSingleArtifactBytes) {
      throw new Error("Taskmarket artifacts must be bounded regular files.");
    }
    const canonical = await realpath(path);
    if (!inside(canonicalRoot, canonical)) throw new Error("Taskmarket artifact escapes the preparation workspace.");
    const fileName = basename(canonical);
    if (fileName.startsWith(".") || forbiddenFileNames.has(fileName.toLowerCase()) || names.has(fileName.toLowerCase())) {
      throw new Error("Taskmarket artifact name is hidden, sensitive, or duplicated.");
    }
    names.add(fileName.toLowerCase());
    const mime = mimeByExtension.get(extname(fileName).toLowerCase() as never);
    if (!mime) throw new Error("Taskmarket artifact type is not allowlisted.");
    const contents = await readFile(canonical);
    totalBytes += contents.length;
    if (totalBytes > maximumArtifactBytes) throw new Error("Taskmarket artifact manifest exceeds the total byte cap.");
    artifacts.push({
      path: canonical,
      file_name: fileName,
      mime_type: mime,
      role: "final",
      size_bytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
      keccak256: keccak256(contents),
      validator: validateMagic(mime, contents),
    });
  }
  return artifacts;
}

function artifactManifestSha256(artifacts: readonly TaskmarketSubmissionArtifact[]): string {
  return createHash("sha256").update(JSON.stringify(artifacts.map((artifact) => ({
    file_name: artifact.file_name,
    mime_type: artifact.mime_type,
    role: artifact.role,
    size_bytes: artifact.size_bytes,
    sha256: artifact.sha256,
    keccak256: artifact.keccak256,
  })))).digest("hex");
}

function intentId(value: Omit<TaskmarketSubmissionIntent, "intent_id">): string {
  return createHash("sha256").update(JSON.stringify({
    kind: value.kind,
    trigger_id: value.trigger_id,
    task_id: value.task_id.toLowerCase(),
    preparation_root: value.preparation_root,
    worker_address: value.worker_address.toLowerCase(),
    escrow_tx_hash: value.escrow_tx_hash.toLowerCase(),
    task_snapshot_sha256: value.task_snapshot_sha256,
    artifact_manifest_sha256: value.artifact_manifest_sha256,
  })).digest("hex");
}

function decimalToAtomic(value: string): string {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value)) throw new Error("Taskmarket decimal amount is invalid.");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
}

export async function admitTaskmarketSubmission(input: {
  trigger: OpportunityTrigger;
  preparation: OpportunityPreparationResult;
  preparation_root: string;
  current_task: TaskmarketTask;
  funding_receipt: TaskmarketFundingReceiptPayload;
  now?: Date;
}): Promise<TaskmarketSubmissionIntent> {
  const now = input.now || new Date();
  const candidate = input.trigger.candidates.find(({ task_id }) =>
    task_id.toLowerCase() === input.preparation.task_id.toLowerCase()
  );
  if (!candidate || candidate.market !== "taskmarket" || candidate.task_snapshot_sha256 === null) {
    throw new Error("Only a Taskmarket candidate can enter Taskmarket submission admission.");
  }
  if (input.preparation.status !== "PREPARED" || input.preparation.remaining_blockers.length !== 0) {
    throw new Error("Taskmarket submission admission requires a blocker-free PREPARED result.");
  }
  if (input.preparation.tests.length === 0 || input.preparation.tests.some(({ passed }) => passed !== true)) {
    throw new Error("Taskmarket submission admission requires recorded task-specific verifications that all passed.");
  }
  const task = input.current_task;
  const snapshot = taskmarketTaskSnapshotSha256(task);
  const nowMs = now.getTime();
  const triggerMs = Date.parse(input.trigger.triggered_at);
  const taskCreatedMs = Date.parse(task.createdAt);
  if (nowMs < triggerMs || nowMs - triggerMs > maximumIntentAgeMs) throw new Error("Taskmarket preparation is stale.");
  if (!Number.isFinite(taskCreatedMs) || nowMs < taskCreatedMs || nowMs - taskCreatedMs > maximumTaskAgeMs) {
    throw new Error("Taskmarket task is outside the fresh-opportunity window.");
  }
  if (task.id.toLowerCase() !== candidate.task_id.toLowerCase() || task.mode !== "bounty" ||
    task.requester.toLowerCase() !== candidate.requester.toLowerCase() ||
    task.rewardAtomic !== decimalToAtomic(candidate.gross_reward_usdc) ||
    task.netRewardAtomic !== decimalToAtomic(candidate.net_reward_usdc) ||
    task.escrowTxHash.toLowerCase() !== candidate.escrow_tx_hash.toLowerCase() ||
    task.expiryTime !== candidate.deadline_at || snapshot !== candidate.task_snapshot_sha256) {
    throw new Error("Taskmarket task identity, economics, or content drifted after assessment.");
  }
  const excluded = new Set([TASKMARKET_WORKER_ADDRESS, ...TASKMARKET_OWNER_IDENTITIES].map((value) => value.toLowerCase()));
  if (task.status !== "open" || !task.submissionWindowOpen || task.claimedBy !== null ||
    task.submissionCount > 3 || excluded.has(task.requester.toLowerCase()) ||
    task.taskVisibility !== "public" || task.hooks === null || task.hooks.length !== 0 || task.evaluator !== null ||
    Date.parse(task.expiryTime) - nowMs < minimumDeadlineRemainingMs) {
    throw new Error("Taskmarket task is no longer an open, low-competition, non-owner bounty.");
  }
  if (!verifyTaskmarketFundingReceipt(task, input.funding_receipt)) {
    throw new Error("Taskmarket funding receipt is not independently verified.");
  }
  const artifacts = await inspectArtifacts(input.preparation_root, input.preparation.artifact_paths);
  const manifestDigest = artifactManifestSha256(artifacts);
  const withoutId: Omit<TaskmarketSubmissionIntent, "intent_id"> = {
    schema_version: 1,
    kind: "taskmarket_submission_intent",
    state: "ELIGIBLE",
    created_at: now.toISOString(),
    trigger_id: input.trigger.trigger_id,
    task_id: task.id,
    preparation_root: await realpath(input.preparation_root),
    worker_address: TASKMARKET_WORKER_ADDRESS,
    worker_agent_id: TASKMARKET_WORKER_AGENT_ID,
    requester: task.requester,
    escrow_tx_hash: task.escrowTxHash,
    gross_reward_usdc: candidate.gross_reward_usdc,
    net_reward_usdc: candidate.net_reward_usdc,
    deadline_at: task.expiryTime,
    task_snapshot_sha256: snapshot,
    artifact_manifest_sha256: manifestDigest,
    artifacts,
    funding_proof: {
      network: "eip155:8453",
      transaction_hash: task.escrowTxHash,
      verified: true,
    },
    guardrails: {
      external_action: "taskmarket_submit_only",
      max_payment_usdc: "0",
      legal_acceptance_enabled: false,
      registration_enabled: false,
      wallet_switch_enabled: false,
      personal_identity_use_enabled: false,
    },
  };
  return { ...withoutId, intent_id: intentId(withoutId) };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as Record<string, unknown>;
}

export function parseTaskmarketSubmissionIntent(value: unknown): TaskmarketSubmissionIntent {
  const record = object(value, "Taskmarket submission intent") as unknown as TaskmarketSubmissionIntent;
  const createdAtMs = Date.parse(record.created_at);
  const deadlineMs = Date.parse(record.deadline_at);
  let grossAtomic: bigint;
  let netAtomic: bigint;
  try {
    grossAtomic = BigInt(decimalToAtomic(record.gross_reward_usdc));
    netAtomic = BigInt(decimalToAtomic(record.net_reward_usdc));
  } catch {
    throw new Error("Taskmarket submission intent economics are invalid.");
  }
  if (record.schema_version !== 1 || record.kind !== "taskmarket_submission_intent" || record.state !== "ELIGIBLE" ||
    !sha256Pattern.test(record.intent_id) || !sha256Pattern.test(record.trigger_id) ||
    !Number.isFinite(createdAtMs) || !Number.isFinite(deadlineMs) || netAtomic > grossAtomic ||
    !bytes32Pattern.test(record.task_id) || !isAbsolute(record.preparation_root) || !addressPattern.test(record.requester) ||
    !bytes32Pattern.test(record.escrow_tx_hash) || record.worker_address !== TASKMARKET_WORKER_ADDRESS ||
    record.worker_agent_id !== TASKMARKET_WORKER_AGENT_ID || !sha256Pattern.test(record.task_snapshot_sha256) ||
    !sha256Pattern.test(record.artifact_manifest_sha256) || !Array.isArray(record.artifacts) ||
    record.artifacts.length < 1 || record.artifacts.length > maximumArtifacts ||
    record.funding_proof?.network !== "eip155:8453" || record.funding_proof.verified !== true ||
    record.funding_proof.transaction_hash.toLowerCase() !== record.escrow_tx_hash.toLowerCase() ||
    record.guardrails?.external_action !== "taskmarket_submit_only" || record.guardrails.max_payment_usdc !== "0" ||
    record.guardrails.legal_acceptance_enabled !== false || record.guardrails.registration_enabled !== false ||
    record.guardrails.wallet_switch_enabled !== false || record.guardrails.personal_identity_use_enabled !== false) {
    throw new Error("Taskmarket submission intent contract is invalid.");
  }
  const names = new Set<string>();
  for (const artifact of record.artifacts) {
    if (!artifact || typeof artifact !== "object" || !isAbsolute(artifact.path) ||
      basename(artifact.path) !== artifact.file_name || !artifact.file_name || names.has(artifact.file_name.toLowerCase()) ||
      artifact.role !== "final" || typeof artifact.mime_type !== "string" ||
      !Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 1 ||
      !sha256Pattern.test(artifact.sha256) || !bytes32Pattern.test(artifact.keccak256) ||
      typeof artifact.validator !== "string") {
      throw new Error("Taskmarket submission artifact contract is invalid.");
    }
    names.add(artifact.file_name.toLowerCase());
  }
  const { intent_id: _intentId, ...withoutId } = record;
  if (intentId(withoutId) !== record.intent_id ||
    artifactManifestSha256(record.artifacts) !== record.artifact_manifest_sha256) {
    throw new Error("Taskmarket submission intent digest is invalid.");
  }
  return record;
}

export async function revalidateTaskmarketSubmissionArtifacts(intent: TaskmarketSubmissionIntent): Promise<void> {
  const inspected = await inspectArtifacts(
    intent.preparation_root,
    intent.artifacts.map(({ path }) => path),
  );
  if (artifactManifestSha256(inspected) !== intent.artifact_manifest_sha256 ||
    inspected.some((artifact, index) => artifact.path !== intent.artifacts[index].path ||
      artifact.sha256 !== intent.artifacts[index].sha256 || artifact.size_bytes !== intent.artifacts[index].size_bytes ||
      artifact.keccak256 !== intent.artifacts[index].keccak256 ||
      artifact.mime_type !== intent.artifacts[index].mime_type)) {
    throw new Error("Taskmarket submission artifacts changed after admission.");
  }
}

export function validateTaskmarketIntentAgainstFreshTask(
  intent: TaskmarketSubmissionIntent,
  task: TaskmarketTask,
  receipt: TaskmarketFundingReceiptPayload,
  now = new Date(),
): void {
  const nowMs = now.getTime();
  const createdAtMs = Date.parse(intent.created_at);
  const taskCreatedAtMs = Date.parse(task.createdAt);
  const excluded = new Set([TASKMARKET_WORKER_ADDRESS, ...TASKMARKET_OWNER_IDENTITIES].map((value) => value.toLowerCase()));
  if (task.id.toLowerCase() !== intent.task_id.toLowerCase() ||
    task.requester.toLowerCase() !== intent.requester.toLowerCase() ||
    task.escrowTxHash.toLowerCase() !== intent.escrow_tx_hash.toLowerCase() ||
    task.rewardAtomic !== decimalToAtomic(intent.gross_reward_usdc) ||
    task.netRewardAtomic !== decimalToAtomic(intent.net_reward_usdc) ||
    task.expiryTime !== intent.deadline_at || taskmarketTaskSnapshotSha256(task) !== intent.task_snapshot_sha256 ||
    task.mode !== "bounty" || task.status !== "open" || !task.submissionWindowOpen || task.claimedBy !== null ||
    task.submissionVisibility !== "public" || task.taskVisibility !== "public" || task.submissionCount > 3 ||
    task.hooks === null || task.hooks.length !== 0 || task.evaluator !== null ||
    excluded.has(task.requester.toLowerCase()) || BigInt(task.netRewardAtomic) < 5_000_000n ||
    !Number.isFinite(createdAtMs) || nowMs < createdAtMs || nowMs - createdAtMs > maximumIntentAgeMs ||
    !Number.isFinite(taskCreatedAtMs) || nowMs < taskCreatedAtMs || nowMs - taskCreatedAtMs > maximumTaskAgeMs ||
    Date.parse(task.expiryTime) - nowMs < minimumDeadlineRemainingMs ||
    !verifyTaskmarketFundingReceipt(task, receipt)) {
    throw new Error("Taskmarket submission intent no longer matches a fresh eligible task and funding proof.");
  }
}

export type PublicSubmission = {
  id: string;
  taskId: string;
  workerAddress: string;
  submitTxHash: string;
  deliverableHash: string;
  submittedAt: string;
  rejectedAt: string | null;
  artifacts: Array<{
    fileName: string;
    mimeType: string;
    role: "preview" | "source" | "final" | "attachment";
    sizeBytes: number;
    sha256Hash: string;
    keccak256Hash: string;
    displayOrder: number;
  }>;
};

export type TaskmarketSubmissionReceiptPayload = {
  transaction_hash: string;
  receipt: unknown | null;
};

const taskSubmittedTopic = "0x7d30d1881f77d1707467f58525863cb9ccbaedc1c4ddb2a4d9dd1349ca7a4e4b";

export function verifyTaskmarketSubmissionReceipt(
  intent: TaskmarketSubmissionIntent,
  submission: PublicSubmission,
  payload: TaskmarketSubmissionReceiptPayload,
): boolean {
  if (payload.transaction_hash.toLowerCase() !== submission.submitTxHash.toLowerCase()) return false;
  const receipt = payload.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const record = receipt as Record<string, unknown>;
  if (record.status !== "0x1" || typeof record.transactionHash !== "string" ||
    record.transactionHash.toLowerCase() !== submission.submitTxHash.toLowerCase() ||
    typeof record.to !== "string" || record.to.toLowerCase() !== TASKMARKET_FORWARDER ||
    !Array.isArray(record.logs) || record.logs.length > 1_000) return false;
  const workerTopic = `0x${"0".repeat(24)}${intent.worker_address.slice(2).toLowerCase()}`;
  const matches = record.logs.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const log = value as Record<string, unknown>;
    return typeof log.address === "string" && log.address.toLowerCase() === TASKMARKET_DIAMOND.toLowerCase() &&
      Array.isArray(log.topics) && log.topics.length === 3 &&
      typeof log.topics[0] === "string" && log.topics[0].toLowerCase() === taskSubmittedTopic &&
      typeof log.topics[1] === "string" && log.topics[1].toLowerCase() === intent.task_id.toLowerCase() &&
      typeof log.topics[2] === "string" && log.topics[2].toLowerCase() === workerTopic &&
      typeof log.data === "string" && log.data.toLowerCase() === submission.deliverableHash.toLowerCase();
  });
  return matches.length === 1;
}

export type TaskmarketSubmissionReconciliation =
  | { status: "ABSENT" }
  | { status: "MANIFEST_REQUIRED"; submission_id: string }
  | { status: "AMBIGUOUS"; reason: string }
  | { status: "VERIFIED"; submission: PublicSubmission; tracked: TaskmarketTrackedSpecification };

export type TaskmarketSubmissionManifestPayload = {
  body: string;
  content_type: string;
  hash_function: string;
  preimage_encoding: string;
  deliverable_hash: string;
  submit_tx_hash: string;
};

function publicSubmissionRows(value: unknown): Record<string, unknown>[] {
  const direct = Array.isArray(value) ? value : object(value, "Taskmarket submissions").data;
  if (!Array.isArray(direct) || direct.length > 1_000) throw new Error("Taskmarket submissions are malformed or unbounded.");
  return direct.map((row) => object(row, "Taskmarket submission"));
}

export function reconcileTaskmarketSubmissionIntent(
  intent: TaskmarketSubmissionIntent,
  value: unknown,
  manifest?: TaskmarketSubmissionManifestPayload,
): TaskmarketSubmissionReconciliation {
  const ours = publicSubmissionRows(value).filter((row) =>
    typeof row.taskId === "string" && row.taskId.toLowerCase() === intent.task_id.toLowerCase() &&
    typeof row.workerAddress === "string" && row.workerAddress.toLowerCase() === intent.worker_address.toLowerCase()
  );
  if (ours.length === 0) return { status: "ABSENT" };
  if (ours.length !== 1) return { status: "AMBIGUOUS", reason: "multiple_worker_submissions" };
  const row = ours[0];
  if (typeof row.id !== "string" || !/^[a-f0-9-]{36}$/i.test(row.id) ||
    typeof row.submitTxHash !== "string" || !bytes32Pattern.test(row.submitTxHash) ||
    typeof row.deliverableHash !== "string" || !bytes32Pattern.test(row.deliverableHash) ||
    typeof row.submittedAt !== "string" || !Number.isFinite(Date.parse(row.submittedAt)) ||
    row.rejectedAt !== null || !Array.isArray(row.artifacts) || row.artifacts.length !== intent.artifacts.length) {
    return { status: "AMBIGUOUS", reason: "worker_submission_shape_or_state_mismatch" };
  }
  const artifacts: PublicSubmission["artifacts"] = [];
  for (let index = 0; index < row.artifacts.length; index += 1) {
    const artifact = object(row.artifacts[index], "Taskmarket submission artifact");
    const expected = intent.artifacts[index];
    if (artifact.fileName !== expected.file_name || artifact.mimeType !== expected.mime_type ||
      artifact.role !== expected.role || artifact.sizeBytes !== expected.size_bytes ||
      artifact.sha256Hash !== expected.sha256 || artifact.displayOrder !== index ||
      typeof artifact.keccak256Hash !== "string" || artifact.keccak256Hash.toLowerCase() !== expected.keccak256.toLowerCase()) {
      return { status: "AMBIGUOUS", reason: "worker_submission_artifact_mismatch" };
    }
    artifacts.push({
      fileName: artifact.fileName as string,
      mimeType: artifact.mimeType as string,
      role: artifact.role as PublicSubmission["artifacts"][number]["role"],
      sizeBytes: artifact.sizeBytes as number,
      sha256Hash: artifact.sha256Hash as string,
      keccak256Hash: artifact.keccak256Hash,
      displayOrder: artifact.displayOrder as number,
    });
  }
  const submission: PublicSubmission = {
    id: row.id,
    taskId: row.taskId as string,
    workerAddress: row.workerAddress as string,
    submitTxHash: row.submitTxHash,
    deliverableHash: row.deliverableHash,
    submittedAt: row.submittedAt,
    rejectedAt: null,
    artifacts,
  };
  if (!manifest) return { status: "MANIFEST_REQUIRED", submission_id: submission.id };
  if (manifest.content_type.toLowerCase() !== "application/json; charset=utf-8" ||
    manifest.hash_function.toLowerCase() !== "keccak256" || manifest.preimage_encoding.toLowerCase() !== "json-utf8" ||
    manifest.deliverable_hash.toLowerCase() !== submission.deliverableHash.toLowerCase() ||
    manifest.submit_tx_hash.toLowerCase() !== submission.submitTxHash.toLowerCase() ||
    new TextEncoder().encode(manifest.body).length > 2_000_000 ||
    keccak256(toBytes(manifest.body)).toLowerCase() !== submission.deliverableHash.toLowerCase()) {
    return { status: "AMBIGUOUS", reason: "canonical_submission_manifest_hash_mismatch" };
  }
  let canonical: Record<string, unknown>;
  try {
    canonical = object(JSON.parse(manifest.body) as unknown, "Taskmarket canonical submission manifest");
  } catch {
    return { status: "AMBIGUOUS", reason: "canonical_submission_manifest_malformed" };
  }
  if (JSON.stringify(canonical) !== manifest.body || Object.keys(canonical).join(",") !== "artifacts,version" ||
    canonical.version !== "taskmarket-artifacts-v1" || !Array.isArray(canonical.artifacts) ||
    canonical.artifacts.length !== artifacts.length) {
    return { status: "AMBIGUOUS", reason: "canonical_submission_manifest_noncanonical" };
  }
  const manifestKeys = "displayOrder,fileName,keccak256Hash,mediaKind,mimeType,role,sha256Hash,sizeBytes";
  for (let index = 0; index < canonical.artifacts.length; index += 1) {
    const artifact = object(canonical.artifacts[index], "Taskmarket canonical manifest artifact");
    const expected = intent.artifacts[index];
    if (Object.keys(artifact).join(",") !== manifestKeys || artifact.displayOrder !== index ||
      artifact.fileName !== expected.file_name || artifact.mimeType !== expected.mime_type || artifact.role !== expected.role ||
      artifact.sizeBytes !== expected.size_bytes || artifact.sha256Hash !== expected.sha256 ||
      typeof artifact.mediaKind !== "string" || !["image", "video", "audio", "pdf", "text", "archive", "unknown"].includes(artifact.mediaKind) ||
      typeof artifact.keccak256Hash !== "string" || artifact.keccak256Hash.toLowerCase() !== expected.keccak256.toLowerCase()) {
      return { status: "AMBIGUOUS", reason: "canonical_submission_manifest_artifact_mismatch" };
    }
  }
  return {
    status: "VERIFIED",
    submission,
    tracked: {
      task_id: intent.task_id,
      submission_id: submission.id,
      submit_tx_hash: submission.submitTxHash,
      reward_atomic: decimalToAtomic(intent.gross_reward_usdc),
      expected_net_atomic: decimalToAtomic(intent.net_reward_usdc),
      artifact_manifest: artifacts.map((artifact) => ({
        file_name: artifact.fileName,
        mime_type: artifact.mimeType,
        role: artifact.role,
        size_bytes: artifact.sizeBytes,
        sha256_hash: artifact.sha256Hash,
        keccak256_hash: artifact.keccak256Hash,
        display_order: artifact.displayOrder,
      })),
    },
  };
}

export function parseTaskmarketCliIdentity(
  addressPayload: unknown,
  identityPayload: unknown,
  legalPayload: unknown,
): void {
  const address = object(addressPayload, "Taskmarket CLI address");
  const addressData = object(address.data, "Taskmarket CLI address data");
  const identity = object(identityPayload, "Taskmarket CLI identity");
  const identityData = object(identity.data, "Taskmarket CLI identity data");
  const legal = object(legalPayload, "Taskmarket legal status");
  const legalData = object(legal.data, "Taskmarket legal status data");
  if (address.ok !== true || typeof addressData.address !== "string" ||
    addressData.address.toLowerCase() !== TASKMARKET_WORKER_ADDRESS.toLowerCase() ||
    identity.ok !== true || identityData.registered !== true || identityData.agentId !== TASKMARKET_WORKER_AGENT_ID) {
    throw new Error("Taskmarket CLI business identity does not match the pinned project identity.");
  }
  if (legal.ok !== true || typeof legalData.enforcementEnabled !== "boolean" ||
    (legalData.enforcementEnabled === true && legalData.accepted !== true)) {
    throw new Error("Taskmarket legal acceptance requires a manual boundary.");
  }
}
