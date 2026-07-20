import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { loadFunnelSnapshot } from "../src/funnel-telemetry.ts";
import {
  captureTrustedFunnelBaseline,
  trustedBoundaryFingerprint,
  trustedFunnelBaseline,
  type TrustedFunnelBaseline,
} from "../src/funnel-epoch.ts";

const funnelStateFile = process.env.FUNNEL_STATE_FILE || `${homedir()}/.local/state/bountyverdict/funnel-telemetry.json`;
const baselineFile = process.env.TRUSTED_FUNNEL_BASELINE_FILE || `${homedir()}/.local/state/bountyverdict/funnel-trusted-baseline.json`;
const historyFile = process.env.TRUSTED_FUNNEL_HISTORY_FILE || `${homedir()}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
const reason = process.env.FUNNEL_EPOCH_REASON || "";
const rotationId = process.env.FUNNEL_ROTATION_ID || "";
const quietSecondsInput = process.env.QUIET_PERIOD_SECONDS || "900";

if (process.env.START_FUNNEL_EPOCH !== "YES") throw new Error("Set START_FUNNEL_EPOCH=YES to rotate the trusted funnel epoch.");
if (!/^[a-z0-9][a-z0-9_-]{7,79}$/.test(rotationId)) throw new Error("FUNNEL_ROTATION_ID is invalid.");
if (!/^\d+$/.test(quietSecondsInput)) throw new Error("QUIET_PERIOD_SECONDS must be an integer.");
const quietSeconds = Number(quietSecondsInput);
if (!Number.isSafeInteger(quietSeconds) || quietSeconds < 60 || quietSeconds > 3_600) {
  throw new Error("QUIET_PERIOD_SECONDS must be between 60 and 3600.");
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

const state = loadFunnelSnapshot(JSON.parse(await readFile(funnelStateFile, "utf8")));
if (!state) throw new Error("Funnel telemetry state is malformed.");
const previous = trustedFunnelBaseline(JSON.parse(await readFile(baselineFile, "utf8")));
if (!previous) throw new Error("Trusted funnel baseline is malformed.");
const now = new Date();
const observedAt = now.toISOString();
const candidate = captureTrustedFunnelBaseline(state, observedAt, reason, previous.epoch_id + 1);
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
  if (ledger.rotation.id !== rotationId) throw new Error("A different funnel rotation is already recorded.");
  const active = ledger.epochs.find((epoch) => epoch.id === ledger.active_epoch_id);
  if (!active || active.status !== "active" || !active.conversion_eligible) {
    throw new Error("Activated funnel epoch is missing or ineligible.");
  }
  const baselineMatches = previous.epoch_id === active.id &&
    trustedBoundaryFingerprint(previous) === trustedBoundaryFingerprint(active.baseline);
  if (!baselineMatches) {
    await atomicWrite(baselineFile, `${JSON.stringify(active.baseline, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    status: baselineMatches ? "already_activated" : "activated_baseline_repaired",
    rotation_id: rotationId,
    active_epoch: ledger.active_epoch_id,
  }, null, 2));
  process.exit(0);
}
if (!ledger.rotation) {
  const active = ledger.epochs.find((epoch) => epoch.id === ledger.active_epoch_id);
  if (!active || active.status !== "active" || active.id !== previous.epoch_id) throw new Error("Active epoch does not match the baseline.");
  active.status = "draining";
  active.conversion_eligible = false;
  active.classification = "excluded_unattributed_owner_triggered_downstream_probe";
  ledger.rotation = {
    id: rotationId,
    status: "draining",
    requested_at: observedAt,
    target_epoch_id: previous.epoch_id + 1,
    reason,
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
const boundary = captureTrustedFunnelBaseline(state, observedAt, reason, ledger.rotation.target_epoch_id);
active.status = "closed";
active.ended_at = observedAt;
active.final = { ...boundary, epoch_id: active.id };
active.close_reason = reason;
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
