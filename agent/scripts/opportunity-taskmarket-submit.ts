import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import {
  parseTaskmarketCliIdentity,
  parseTaskmarketSubmissionIntent,
  reconcileTaskmarketSubmissionIntent,
  revalidateTaskmarketSubmissionArtifacts,
  validateTaskmarketIntentAgainstFreshTask,
  verifyTaskmarketSubmissionReceipt,
  type TaskmarketSubmissionReconciliation,
  type TaskmarketSubmissionManifestPayload,
  type TaskmarketSubmissionIntent,
} from "../src/opportunity-taskmarket-submission.ts";
import {
  parseTaskmarketTask,
  TASKMARKET_API,
  TASKMARKET_DIAMOND,
  TASKMARKET_EVALUATOR_FOR_SELECTOR,
  TASKMARKET_GET_TASK_SELECTOR,
  TASKMARKET_GET_TASK_HOOKS_SELECTOR,
  TASKMARKET_GET_TASK_METADATA_SELECTOR,
  TASKMARKET_WORKER_ADDRESS,
  type TaskmarketFundingReceiptPayload,
  type TaskmarketTrackedSpecification,
} from "../src/taskmarket-demand.ts";

const execFile = promisify(execFileCallback);
const stateRoot = process.env.BOUNTY_OPPORTUNITY_STATE_ROOT || `${homedir()}/.local/state/bountyverdict`;
const intentRoot = process.env.BOUNTY_OPPORTUNITY_SUBMISSION_INTENT_ROOT || join(stateRoot, "opportunity-submission-intents");
const archiveRoot = process.env.BOUNTY_OPPORTUNITY_SUBMISSION_ARCHIVE_ROOT || join(stateRoot, "opportunity-submission-intents-archive");
const submissionStateRoot = process.env.BOUNTY_OPPORTUNITY_SUBMISSION_STATE_ROOT || join(stateRoot, "opportunity-submission-states");
const trackedFile = process.env.BOUNTY_OPPORTUNITY_TASKMARKET_TRACKED_FILE || join(stateRoot, "opportunity-taskmarket-tracked.json");
const taskFenceRoot = process.env.BOUNTY_OPPORTUNITY_TASKMARKET_FENCE_ROOT || join(stateRoot, "opportunity-taskmarket-task-fences");
const lockFile = process.env.BOUNTY_OPPORTUNITY_SUBMISSION_LOCK_FILE || join(stateRoot, "opportunity-taskmarket-submit.lock");
const taskmarketCli = join(process.cwd(), "node_modules/.bin/taskmarket");
const taskmarketKeystore = process.env.BOUNTY_TASKMARKET_KEYSTORE_FILE || join(homedir(), ".taskmarket/keystore.json");
const maximumJsonBytes = 2_000_000;
const maximumIntents = 100;
const expectedUid = process.getuid?.() ?? -1;
const intentFilePattern = /^[a-f0-9]{64}\.json$/;

type SubmissionState = {
  schema_version: 1;
  intent_id: string;
  task_id: string;
  state: "SUBMITTING" | "SUBMITTED_UNVERIFIED" | "SUBMITTED_VERIFIED" | "STALE" | "AMBIGUOUS" |
    "IDENTITY_MISMATCH" | "MANUAL_BOUNDARY";
  updated_at: string;
  accounting: "submission_is_not_purchase_or_revenue";
  reason?: string;
  submission_id?: string;
  submit_tx_hash?: string;
};

type TaskMutationFence = {
  schema_version: 1;
  task_id: string;
  intent_id: string;
  worker_address: typeof TASKMARKET_WORKER_ADDRESS;
  reserved_at: string;
  accounting: "mutation_reservation_is_not_purchase_or_revenue";
};

async function secureJson(path: string, label: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.uid !== expectedUid || (metadata.mode & 0o777) !== 0o600 ||
      metadata.size < 2 || metadata.size > maximumJsonBytes) {
      throw new Error(`${label} must be a bounded private owner-owned file.`);
    }
    return JSON.parse(await handle.readFile("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function publicJson(url: URL, label: string): Promise<unknown> {
  const response = await fetch(url, {
    redirect: "error",
    headers: { Accept: "application/json", "User-Agent": "bountyverdict-taskmarket-auto-submit/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error(`${label} returned an invalid HTTP response.`);
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maximumJsonBytes) throw new Error(`${label} exceeded the response cap.`);
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumJsonBytes) throw new Error(`${label} exceeded the response cap.`);
  return JSON.parse(body) as unknown;
}

async function publicManifest(url: URL): Promise<TaskmarketSubmissionManifestPayload> {
  const response = await fetch(url, {
    redirect: "error",
    headers: { Accept: "application/json", "User-Agent": "bountyverdict-taskmarket-auto-submit/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Taskmarket canonical submission manifest returned an invalid HTTP response.");
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maximumJsonBytes) throw new Error("Taskmarket canonical manifest exceeded its cap.");
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumJsonBytes) throw new Error("Taskmarket canonical manifest exceeded its cap.");
  return {
    body,
    content_type: response.headers.get("content-type") || "",
    hash_function: response.headers.get("x-hash-function") || "",
    preimage_encoding: response.headers.get("x-preimage-encoding") || "",
    deliverable_hash: response.headers.get("x-deliverable-hash") || "",
    submit_tx_hash: response.headers.get("x-submit-tx-hash") || "",
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as Record<string, unknown>;
}

async function readOnlyLegalStatus(): Promise<unknown> {
  const keystore = record(await secureJson(taskmarketKeystore, "Taskmarket keystore"), "Taskmarket keystore");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (keystore.legalAcceptanceApiOrigin === TASKMARKET_API &&
    typeof keystore.legalAcceptanceReceipt === "string" &&
    keystore.legalAcceptanceReceipt.length >= 16 && keystore.legalAcceptanceReceipt.length <= 16_384) {
    headers["X-Taskmarket-Legal-Receipt"] = keystore.legalAcceptanceReceipt;
  }
  const response = await fetch(new URL("/api/legal/status", TASKMARKET_API), {
    redirect: "error",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error("Taskmarket legal status returned an invalid HTTP response.");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumJsonBytes) throw new Error("Taskmarket legal status exceeded its cap.");
  const status = record(JSON.parse(body) as unknown, "Taskmarket legal status");
  const bundle = record(status.bundle, "Taskmarket legal bundle");
  return {
    ok: true,
    data: {
      accepted: status.accepted,
      enforcementEnabled: bundle.enforcementEnabled,
      status: bundle.status,
      bundleDigest: bundle.bundleDigest,
      bundleVersion: bundle.version,
    },
  };
}

async function baseRpc(method: string, params: unknown[]): Promise<unknown | null> {
  const response = await fetch("https://mainnet.base.org", {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "bountyverdict-taskmarket-auto-submit/1.0",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error("Base RPC returned an invalid HTTP response.");
  }
  const payload = await response.json() as Record<string, unknown>;
  if (payload.jsonrpc !== "2.0" || payload.id !== 1 || !("result" in payload)) {
    throw new Error("Base RPC returned a malformed receipt envelope.");
  }
  return payload.result ?? null;
}

async function fundingReceipt(transactionHash: string, taskId: string): Promise<TaskmarketFundingReceiptPayload> {
  const [receipt, taskResult, taskHooksResult, taskEvaluatorResult, taskMetadataResult] = await Promise.all([
    baseRpc("eth_getTransactionReceipt", [transactionHash]),
    baseRpc("eth_call", [{
      to: TASKMARKET_DIAMOND,
      data: `${TASKMARKET_GET_TASK_SELECTOR}${taskId.slice(2)}`,
    }, "latest"]),
    baseRpc("eth_call", [{ to: TASKMARKET_DIAMOND, data: `${TASKMARKET_GET_TASK_HOOKS_SELECTOR}${taskId.slice(2)}` }, "latest"]),
    baseRpc("eth_call", [{ to: TASKMARKET_DIAMOND, data: `${TASKMARKET_EVALUATOR_FOR_SELECTOR}${taskId.slice(2)}` }, "latest"]),
    baseRpc("eth_call", [{ to: TASKMARKET_DIAMOND, data: `${TASKMARKET_GET_TASK_METADATA_SELECTOR}${taskId.slice(2)}` }, "latest"]),
  ]);
  return {
    transaction_hash: transactionHash, receipt, task_id: taskId, task_result: taskResult,
    task_hooks_result: taskHooksResult, task_evaluator_result: taskEvaluatorResult,
    task_metadata_result: taskMetadataResult,
  };
}

function cliEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["HOME", "PATH", "LANG", "LC_ALL", "TMPDIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function cliJson(args: string[]): Promise<unknown> {
  const { stdout } = await execFile(taskmarketCli, args, {
    cwd: process.cwd(),
    env: cliEnvironment(),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: maximumJsonBytes,
  });
  return JSON.parse(stdout) as unknown;
}

async function writeState(intent: TaskmarketSubmissionIntent, state: SubmissionState["state"], extra: Partial<SubmissionState> = {}): Promise<void> {
  await atomicWrite(join(submissionStateRoot, `${intent.intent_id}.json`), {
    schema_version: 1,
    intent_id: intent.intent_id,
    task_id: intent.task_id,
    state,
    updated_at: new Date().toISOString(),
    accounting: "submission_is_not_purchase_or_revenue",
    ...extra,
  } satisfies SubmissionState);
}

async function readState(intent: TaskmarketSubmissionIntent): Promise<SubmissionState | null> {
  const path = join(submissionStateRoot, `${intent.intent_id}.json`);
  try {
    const value = await secureJson(path, "Taskmarket submission state") as SubmissionState;
    if (value.schema_version !== 1 || value.intent_id !== intent.intent_id || value.task_id !== intent.task_id ||
      !["SUBMITTING", "SUBMITTED_UNVERIFIED", "SUBMITTED_VERIFIED", "STALE", "AMBIGUOUS", "IDENTITY_MISMATCH", "MANUAL_BOUNDARY"].includes(value.state)) {
      throw new Error("Taskmarket submission state is malformed.");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function reserveTaskMutation(intent: TaskmarketSubmissionIntent): Promise<"OWNED" | "CONFLICT"> {
  await mkdir(taskFenceRoot, { recursive: true, mode: 0o700 });
  const path = join(taskFenceRoot, `${intent.task_id.slice(2).toLowerCase()}.json`);
  const fence: TaskMutationFence = {
    schema_version: 1,
    task_id: intent.task_id,
    intent_id: intent.intent_id,
    worker_address: TASKMARKET_WORKER_ADDRESS,
    reserved_at: new Date().toISOString(),
    accounting: "mutation_reservation_is_not_purchase_or_revenue",
  };
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(fence, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const directory = await open(taskFenceRoot, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return "OWNED";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const existing = await secureJson(path, "Taskmarket task mutation fence") as TaskMutationFence;
  if (existing.schema_version !== 1 || existing.task_id.toLowerCase() !== intent.task_id.toLowerCase() ||
    existing.worker_address.toLowerCase() !== TASKMARKET_WORKER_ADDRESS.toLowerCase() ||
    typeof existing.intent_id !== "string" || !/^[a-f0-9]{64}$/.test(existing.intent_id) ||
    typeof existing.reserved_at !== "string" || !Number.isFinite(Date.parse(existing.reserved_at)) ||
    existing.accounting !== "mutation_reservation_is_not_purchase_or_revenue") {
    throw new Error("Taskmarket task mutation fence is malformed.");
  }
  return existing.intent_id === intent.intent_id ? "OWNED" : "CONFLICT";
}

async function archiveIntent(path: string, intent: TaskmarketSubmissionIntent): Promise<void> {
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
  await rename(path, join(archiveRoot, `${intent.intent_id}.json`));
}

async function recordTracked(intent: TaskmarketSubmissionIntent, tracked: TaskmarketTrackedSpecification): Promise<void> {
  let submissions: TaskmarketTrackedSpecification[] = [];
  try {
    const value = await secureJson(trackedFile, "Dynamic Taskmarket tracking registry") as Record<string, unknown>;
    if (value.schema_version !== 1 || value.worker_address !== TASKMARKET_WORKER_ADDRESS || !Array.isArray(value.submissions) ||
      value.submissions.length > 89) throw new Error("Dynamic Taskmarket tracking registry is malformed.");
    submissions = value.submissions as TaskmarketTrackedSpecification[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const task = tracked.task_id.toLowerCase();
  const submission = tracked.submission_id.toLowerCase();
  const existing = submissions.find((entry) => entry.task_id.toLowerCase() === task || entry.submission_id.toLowerCase() === submission);
  if (existing && JSON.stringify(existing) !== JSON.stringify(tracked)) {
    throw new Error("Dynamic Taskmarket tracking registry conflicts with a verified submission.");
  }
  if (!existing) submissions.push(tracked);
  if (submissions.length > 89) throw new Error("Dynamic Taskmarket tracking registry reached its safe aggregate bound.");
  await atomicWrite(trackedFile, {
    schema_version: 1,
    worker_address: TASKMARKET_WORKER_ADDRESS,
    updated_at: new Date().toISOString(),
    source_intent_id: intent.intent_id,
    submissions,
    accounting: "tracked submissions remain zero purchases and zero revenue until exact non-owner onchain settlement",
  });
}

async function reconcile(
  intent: TaskmarketSubmissionIntent,
): Promise<ReturnType<typeof reconcileTaskmarketSubmissionIntent>> {
  const submissions = await publicJson(
    new URL(`/api/tasks/${encodeURIComponent(intent.task_id)}/submissions`, TASKMARKET_API),
    "Taskmarket submissions",
  );
  const initial = reconcileTaskmarketSubmissionIntent(intent, submissions);
  if (initial.status !== "MANIFEST_REQUIRED") return initial;
  const manifest = await publicManifest(new URL(
    `/api/tasks/${encodeURIComponent(intent.task_id)}/submissions/${encodeURIComponent(initial.submission_id)}/manifest`,
    TASKMARKET_API,
  ));
  return reconcileTaskmarketSubmissionIntent(intent, submissions, manifest);
}

async function finishVerifiedSubmission(
  intent: TaskmarketSubmissionIntent,
  reconciliation: Extract<TaskmarketSubmissionReconciliation, { status: "VERIFIED" }>,
): Promise<boolean> {
  const receipt = await baseRpc("eth_getTransactionReceipt", [reconciliation.submission.submitTxHash]);
  if (receipt === null) {
    await writeState(intent, "SUBMITTED_UNVERIFIED", { reason: "submission_receipt_not_yet_available_no_resubmit" });
    return false;
  }
  if (!verifyTaskmarketSubmissionReceipt(intent, reconciliation.submission, {
    transaction_hash: reconciliation.submission.submitTxHash,
    receipt,
  })) {
    await writeState(intent, "AMBIGUOUS", { reason: "submission_onchain_receipt_mismatch" });
    return false;
  }
  await recordTracked(intent, reconciliation.tracked);
  await writeState(intent, "SUBMITTED_VERIFIED", {
    submission_id: reconciliation.submission.id,
    submit_tx_hash: reconciliation.submission.submitTxHash,
  });
  return true;
}

async function processIntent(path: string): Promise<void> {
  const intent = parseTaskmarketSubmissionIntent(await secureJson(path, "Taskmarket submission intent"));
  const previous = await readState(intent);
  if (previous && ["SUBMITTED_VERIFIED", "STALE", "AMBIGUOUS", "IDENTITY_MISMATCH", "MANUAL_BOUNDARY"].includes(previous.state)) {
    await archiveIntent(path, intent);
    return;
  }

  if (previous?.state === "SUBMITTING" || previous?.state === "SUBMITTED_UNVERIFIED") {
    const prior = await reconcile(intent);
    if (prior.status === "VERIFIED") {
      if (await reserveTaskMutation(intent) === "CONFLICT") {
        await writeState(intent, "AMBIGUOUS", { reason: "task_reserved_by_a_different_submission_intent" });
        await archiveIntent(path, intent);
        return;
      }
      if (await finishVerifiedSubmission(intent, prior)) await archiveIntent(path, intent);
      return;
    }
    if (prior.status === "AMBIGUOUS") {
      await writeState(intent, "AMBIGUOUS", { reason: prior.reason });
      await archiveIntent(path, intent);
      return;
    }
    await writeState(intent, "SUBMITTED_UNVERIFIED", { reason: "prior_mutation_outcome_remains_unverified_no_resubmit" });
    return;
  }

  const currentTask = parseTaskmarketTask(await publicJson(
    new URL(`/api/tasks/${encodeURIComponent(intent.task_id)}`, TASKMARKET_API),
    "Taskmarket task detail",
  ));
  const receipt = await fundingReceipt(currentTask.escrowTxHash, currentTask.id);
  try {
    validateTaskmarketIntentAgainstFreshTask(intent, currentTask, receipt);
    await revalidateTaskmarketSubmissionArtifacts(intent);
  } catch (error) {
    await writeState(intent, "STALE", { reason: (error as Error).message.slice(0, 500) });
    await archiveIntent(path, intent);
    return;
  }

  try {
    parseTaskmarketCliIdentity(
      await cliJson(["address"]),
      await cliJson(["identity", "status"]),
      await readOnlyLegalStatus(),
    );
  } catch (error) {
    const reason = (error as Error).message.slice(0, 500);
    const state = /legal acceptance/i.test(reason) ? "MANUAL_BOUNDARY" : "IDENTITY_MISMATCH";
    await writeState(intent, state, { reason });
    await archiveIntent(path, intent);
    return;
  }

  const before = await reconcile(intent);
  if (before.status === "VERIFIED") {
    if (await reserveTaskMutation(intent) === "CONFLICT") {
      await writeState(intent, "AMBIGUOUS", { reason: "task_reserved_by_a_different_submission_intent" });
      await archiveIntent(path, intent);
      return;
    }
    if (await finishVerifiedSubmission(intent, before)) await archiveIntent(path, intent);
    return;
  }
  if (before.status === "AMBIGUOUS") {
    await writeState(intent, "AMBIGUOUS", { reason: before.reason });
    await archiveIntent(path, intent);
    return;
  }
  if (await reserveTaskMutation(intent) === "CONFLICT") {
    await writeState(intent, "AMBIGUOUS", { reason: "task_reserved_by_a_different_submission_intent" });
    await archiveIntent(path, intent);
    return;
  }
  await writeState(intent, "SUBMITTING");
  let cliError: string | null = null;
  try {
    await cliJson([
      "task",
      "submit",
      intent.task_id,
      ...intent.artifacts.flatMap(({ path: artifactPath }) => ["--file", artifactPath]),
      "--role",
      "final",
    ]);
  } catch (error) {
    cliError = (error as Error).message.slice(0, 500);
  }
  const after = await reconcile(intent);
  if (after.status === "VERIFIED") {
    if (await finishVerifiedSubmission(intent, after)) await archiveIntent(path, intent);
    return;
  }
  if (after.status === "AMBIGUOUS") {
    await writeState(intent, "AMBIGUOUS", { reason: after.reason });
    await archiveIntent(path, intent);
    return;
  }
  await writeState(intent, "SUBMITTED_UNVERIFIED", {
    reason: cliError ? `cli_or_network_outcome_uncertain:${cliError}` : "submission_not_yet_visible_after_cli_success",
  });
}

export async function runTaskmarketSubmissionQueue(): Promise<number> {
  await mkdir(intentRoot, { recursive: true, mode: 0o700 });
  const releaseLock = await acquireExclusiveRun(lockFile, { staleAfterMs: 2 * 60 * 60 * 1_000 });
  try {
    const entries = (await readdir(intentRoot)).filter((name) => intentFilePattern.test(name)).sort();
    if (entries.length > maximumIntents) throw new Error("Taskmarket submission intent queue exceeds its bound.");
    for (const name of entries) {
      const path = join(intentRoot, name);
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Taskmarket submission queue contains an unsafe entry.");
      await processIntent(path);
    }
    console.log(JSON.stringify({ status: "completed", inspected_intents: entries.length }));
    return entries.length;
  } finally {
    await releaseLock();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runTaskmarketSubmissionQueue();
}
