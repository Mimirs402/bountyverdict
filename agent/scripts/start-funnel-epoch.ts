import { unlinkSync } from "node:fs";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { loadFunnelSnapshot } from "../src/funnel-telemetry.ts";
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

if (process.env.START_FUNNEL_EPOCH !== "YES") throw new Error("Set START_FUNNEL_EPOCH=YES to rotate the trusted funnel epoch.");
if (!automaticPoll && !/^[a-z0-9][a-z0-9_-]{7,79}$/.test(requestedRotationId)) throw new Error("FUNNEL_ROTATION_ID is invalid.");
if (!/^\d+$/.test(quietSecondsInput)) throw new Error("QUIET_PERIOD_SECONDS must be an integer.");
const quietSeconds = Number(quietSecondsInput);
if (!Number.isSafeInteger(quietSeconds) || quietSeconds < 60 || quietSeconds > 3_600) {
  throw new Error("QUIET_PERIOD_SECONDS must be between 60 and 3600.");
}

const mutationLock = await open(mutationLockFile, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "EEXIST") throw new Error("Trusted funnel state is currently being mutated.");
  throw error;
});
await mutationLock.writeFile(`${process.pid}\n`);
await mutationLock.sync();
process.once("exit", () => {
  try {
    unlinkSync(mutationLockFile);
  } catch {
    // A missing lock is already released; any other cleanup failure remains fail-closed for the next run.
  }
});

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

const state = loadFunnelSnapshot(JSON.parse(await readFile(funnelStateFile, "utf8")));
if (!state) throw new Error("Funnel telemetry state is malformed.");
let previous = trustedFunnelBaseline(JSON.parse(await readFile(baselineFile, "utf8")));
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
  const parsed = JSON.parse(await readFile(historyFile, "utf8")) as Ledger;
  if (parsed.schema_version !== 2 || !Array.isArray(parsed.epochs) || !Number.isSafeInteger(parsed.active_epoch_id)) {
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
    process.exit(0);
  }
  if (ledger.rotation.id === requestedRotationId) {
    console.log(JSON.stringify({
      status: baselineMatches ? "already_activated" : "activated_baseline_repaired",
      rotation_id: requestedRotationId,
      active_epoch: ledger.active_epoch_id,
    }, null, 2));
    process.exit(0);
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
  process.exit(0);
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
  process.exit(0);
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
  process.exit(0);
}
if (ledger.rotation.last_observed_at !== observedAt) ledger.rotation.observations += 1;
ledger.rotation.last_observed_at = observedAt;
const stableSeconds = Math.floor((now.getTime() - Date.parse(ledger.rotation.stable_since)) / 1_000);
if (stableSeconds < quietSeconds || ledger.rotation.observations < 2) {
  await atomicWrite(historyFile, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({ status: "draining", rotation_id: rotationId, stable_seconds: stableSeconds, observations: ledger.rotation.observations, required_quiet_seconds: quietSeconds }, null, 2));
  process.exit(0);
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
