import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { loadFunnelSnapshot } from "../src/funnel-telemetry.ts";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import {
  assertFreshFunnelCollector,
  captureTrustedFunnelBaseline,
  trustedBoundaryFingerprint,
  trustedFunnelBaseline,
  type TrustedFunnelBaseline,
} from "../src/funnel-epoch.ts";

const funnelStateFile = process.env.FUNNEL_STATE_FILE || `${homedir()}/.local/state/bountyverdict/funnel-telemetry.json`;
const baselineFile = process.env.TRUSTED_FUNNEL_BASELINE_FILE || `${homedir()}/.local/state/bountyverdict/funnel-trusted-baseline.json`;
const historyFile = process.env.TRUSTED_FUNNEL_HISTORY_FILE || `${homedir()}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
const mutationLockFile = `${historyFile}.lock`;
const reason = process.env.FUNNEL_EPOCH_REASON || "";
const requestedRotationId = process.env.FUNNEL_ROTATION_ID || "";
const automaticPoll = requestedRotationId === "AUTO";
const quietSecondsInput = process.env.QUIET_PERIOD_SECONDS || "900";
const expectedUid = process.getuid?.() ?? -1;
const ordinaryStateMaximumBytes = 2_000_000;
const historyStateMaximumBytes = 64 * 1024 * 1024;

if (process.env.START_FUNNEL_EPOCH !== "YES") throw new Error("Set START_FUNNEL_EPOCH=YES to rotate the trusted funnel epoch.");
if (!automaticPoll && !/^[a-z0-9][a-z0-9_-]{7,79}$/.test(requestedRotationId)) throw new Error("FUNNEL_ROTATION_ID is invalid.");
if (!/^\d+$/.test(quietSecondsInput)) throw new Error("QUIET_PERIOD_SECONDS must be an integer.");
const quietSeconds = Number(quietSecondsInput);
if (!Number.isSafeInteger(quietSeconds) || quietSeconds < 60 || quietSeconds > 3_600) {
  throw new Error("QUIET_PERIOD_SECONDS must be between 60 and 3600.");
}

async function secureReadState(
  path: string,
  label: string,
  maximumBytes = ordinaryStateMaximumBytes,
): Promise<string> {
  if (expectedUid < 0) throw new Error(`${label} requires a local Unix owner identity.`);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2 || maximumBytes > historyStateMaximumBytes) {
    throw new Error(`${label} size bound is invalid.`);
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.uid !== expectedUid || (metadata.mode & 0o777) !== 0o600 ||
        metadata.size < 2 || metadata.size > maximumBytes) {
      throw new Error(`${label} must be a bounded regular owner-owned file with mode 0600.`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== expectedUid ||
      (parent.mode & 0o777) !== 0o700) {
    throw new Error(`State parent ${dirname(path)} must be a private owner-owned directory.`);
  }
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function rotateFunnelEpoch(): Promise<void> {
const state = loadFunnelSnapshot(JSON.parse(await secureReadState(funnelStateFile, "Funnel collector state")));
if (!state) throw new Error("Funnel telemetry state is malformed.");
let previous = trustedFunnelBaseline(JSON.parse(await secureReadState(baselineFile, "Trusted funnel baseline")));
if (!previous) throw new Error("Trusted funnel baseline is malformed.");
const now = new Date();
const observedAt = now.toISOString();
assertFreshFunnelCollector(state, observedAt);
type Epoch = {
  id: number;
  status: "active" | "draining" | "closed";
  started_at: string;
  baseline: TrustedFunnelBaseline;
  conversion_eligible: boolean;
  classification: string;
  ended_at?: string;
  final?: TrustedFunnelBaseline;
  close_reason?: string;
};
type Ledger = {
  schema_version: 2;
  active_epoch_id: number;
  epochs: Epoch[];
  rotation?: {
    id: string;
    status: "draining" | "activated";
    requested_at: string;
    target_epoch_id: number;
    reason: string;
    stable_since: string;
    observations: number;
    last_observed_at: string;
    candidate: TrustedFunnelBaseline;
    activated_at?: string;
  };
  completed_rotations?: Array<{
    id: string;
    requested_at: string;
    target_epoch_id: number;
    reason: string;
    activated_at: string;
  }>;
};
let ledger: Ledger;
try {
  const parsed = JSON.parse(await secureReadState(
    historyFile,
    "Trusted funnel epoch ledger",
    historyStateMaximumBytes,
  )) as Ledger;
  if (parsed.schema_version !== 2 || !Array.isArray(parsed.epochs) ||
      parsed.epochs.length < 1 || parsed.epochs.length > 200 ||
      !Number.isSafeInteger(parsed.active_epoch_id) ||
      (parsed.completed_rotations !== undefined &&
        (!Array.isArray(parsed.completed_rotations) || parsed.completed_rotations.length > 100))) {
    throw new Error("Trusted funnel epoch ledger is malformed.");
  }
  ledger = parsed;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  ledger = {
    schema_version: 2,
    active_epoch_id: previous.epoch_id,
    epochs: [{
      id: previous.epoch_id,
      status: "active",
      started_at: previous.initialized_at,
      baseline: previous,
      conversion_eligible: true,
      classification: "legacy_active_epoch_imported_verbatim",
    }],
  };
}
if (ledger.rotation?.status === "activated") {
  const active = ledger.epochs.find((epoch) => epoch.id === ledger.active_epoch_id);
  const activeBaseline = active ? trustedFunnelBaseline(active.baseline) : null;
  if (!active || active.status !== "active" || !active.conversion_eligible || !activeBaseline) {
    throw new Error("Activated funnel epoch is missing or ineligible.");
  }
  const baselineMatches = previous.epoch_id === active.id &&
    trustedBoundaryFingerprint(previous) === trustedBoundaryFingerprint(activeBaseline);
  if (!baselineMatches) {
    await atomicWrite(baselineFile, `${JSON.stringify(activeBaseline, null, 2)}\n`);
    previous = activeBaseline;
  }
  if (automaticPoll) {
    console.log(JSON.stringify({
      status: baselineMatches ? "idle_no_pending_rotation" : "activated_baseline_repaired",
      active_epoch: ledger.active_epoch_id,
    }, null, 2));
    return;
  }
  if (ledger.rotation.id === requestedRotationId) {
    console.log(JSON.stringify({
      status: baselineMatches ? "already_activated" : "activated_baseline_repaired",
      rotation_id: requestedRotationId,
      active_epoch: ledger.active_epoch_id,
    }, null, 2));
    return;
  }
  ledger.completed_rotations ||= [];
  ledger.completed_rotations.push({
    id: ledger.rotation.id,
    requested_at: ledger.rotation.requested_at,
    target_epoch_id: ledger.rotation.target_epoch_id,
    reason: ledger.rotation.reason,
    activated_at: ledger.rotation.activated_at || active.started_at,
  });
  if (ledger.completed_rotations.length > 100) ledger.completed_rotations.splice(0, ledger.completed_rotations.length - 100);
  delete ledger.rotation;
}
if (automaticPoll && !ledger.rotation) {
  console.log(JSON.stringify({ status: "idle_no_pending_rotation", active_epoch: ledger.active_epoch_id }, null, 2));
  return;
}
const rotationId = automaticPoll ? ledger.rotation!.id : requestedRotationId;
const rotationReason = automaticPoll ? ledger.rotation!.reason : reason;
const targetEpochId = ledger.rotation?.status === "draining"
  ? ledger.rotation.target_epoch_id
  : previous.epoch_id + 1;
const candidate = captureTrustedFunnelBaseline(state, observedAt, rotationReason, targetEpochId);
if (!ledger.rotation) {
  const active = ledger.epochs.find((epoch) => epoch.id === ledger.active_epoch_id);
  const activeBaseline = active ? trustedFunnelBaseline(active.baseline) : null;
  if (!active || active.status !== "active" || active.id !== previous.epoch_id || !activeBaseline ||
      trustedBoundaryFingerprint(activeBaseline) !== trustedBoundaryFingerprint(previous)) {
    throw new Error("Active epoch does not match the baseline.");
  }
  active.status = "draining";
  active.conversion_eligible = false;
  active.classification = "excluded_unattributed_owner_triggered_downstream_probe";
  ledger.rotation = {
    id: rotationId,
    status: "draining",
    requested_at: observedAt,
    target_epoch_id: previous.epoch_id + 1,
    reason: rotationReason,
    stable_since: observedAt,
    observations: 1,
    last_observed_at: observedAt,
    candidate,
  };
  await atomicWrite(historyFile, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({ status: "draining_started", rotation_id: rotationId, stable_since: observedAt, required_quiet_seconds: quietSeconds }, null, 2));
  return;
}
if (ledger.rotation.id !== rotationId || ledger.rotation.target_epoch_id !== previous.epoch_id + 1) {
  throw new Error("Funnel rotation identity or target epoch does not match.");
}
if (trustedBoundaryFingerprint(candidate) !== trustedBoundaryFingerprint(ledger.rotation.candidate)) {
  ledger.rotation.stable_since = observedAt;
  ledger.rotation.observations = 1;
  ledger.rotation.last_observed_at = observedAt;
  ledger.rotation.candidate = candidate;
  await atomicWrite(historyFile, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({ status: "draining_reset", rotation_id: rotationId, stable_since: observedAt }, null, 2));
  return;
}
if (ledger.rotation.last_observed_at !== observedAt) ledger.rotation.observations += 1;
ledger.rotation.last_observed_at = observedAt;
const stableSeconds = Math.floor((now.getTime() - Date.parse(ledger.rotation.stable_since)) / 1_000);
if (stableSeconds < quietSeconds || ledger.rotation.observations < 2) {
  await atomicWrite(historyFile, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({ status: "draining", rotation_id: rotationId, stable_seconds: stableSeconds, observations: ledger.rotation.observations, required_quiet_seconds: quietSeconds }, null, 2));
  return;
}
const active = ledger.epochs.find((epoch) => epoch.id === ledger.active_epoch_id);
if (!active || active.status !== "draining") throw new Error("Draining epoch is missing.");
const boundary = captureTrustedFunnelBaseline(state, observedAt, rotationReason, ledger.rotation.target_epoch_id);
active.status = "closed";
active.ended_at = observedAt;
active.final = { ...boundary, epoch_id: active.id };
active.close_reason = rotationReason;
ledger.epochs.push({
  id: boundary.epoch_id,
  status: "active",
  started_at: observedAt,
  baseline: boundary,
  conversion_eligible: true,
  classification: "active_clean_epoch_after_stable_drain",
});
ledger.active_epoch_id = boundary.epoch_id;
ledger.rotation.status = "activated";
ledger.rotation.activated_at = observedAt;
await atomicWrite(historyFile, `${JSON.stringify(ledger, null, 2)}\n`);
await atomicWrite(baselineFile, `${JSON.stringify(boundary, null, 2)}\n`);
console.log(JSON.stringify({ status: "activated", rotation_id: rotationId, previous_epoch: active.id, active_epoch: boundary.epoch_id, initialized_at: observedAt, stable_seconds: stableSeconds, observations: ledger.rotation.observations, counters: boundary.counters }, null, 2));
}

const releaseMutationLock = await acquireExclusiveRun(mutationLockFile);
try {
  await rotateFunnelEpoch();
} finally {
  await releaseMutationLock();
}
