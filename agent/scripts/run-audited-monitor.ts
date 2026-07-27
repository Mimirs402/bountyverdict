import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { trustedFunnelBaseline } from "../src/funnel-epoch.ts";
import { loadDistributionMonitorConfiguration } from "../src/monitor-configuration.ts";
import {
  OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH,
  OWNER_BUYER_JOURNEY_SCHEMA_VERSION,
  validateOwnerJourneyPrerequisite,
} from "../src/owner-buyer-journey.ts";

const execFileAsync = promisify(execFile);
const monitor = process.env.AUDITED_MONITOR;
if (monitor !== "directory" && monitor !== "distribution" && monitor !== "owner-journey") {
  throw new Error("AUDITED_MONITOR must be directory, distribution, or owner-journey.");
}
if (monitor === "distribution") loadDistributionMonitorConfiguration(process.env);
const baselineFile = process.env.TRUSTED_FUNNEL_BASELINE_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-baseline.json`;
const historyFile = process.env.TRUSTED_FUNNEL_HISTORY_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
const distributionFile = process.env.STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/distribution-status.json`;
const ownerJourneyFile = process.env.OWNER_BUYER_JOURNEY_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/owner-buyer-journey-v2.json`;
const baseline = trustedFunnelBaseline(JSON.parse(await readFile(baselineFile, "utf8")));
if (!baseline) throw new Error("Trusted funnel baseline is malformed; refusing an unattributed marketplace audit.");
const ledger = JSON.parse(await readFile(historyFile, "utf8")) as Record<string, any>;
if (ledger.schema_version !== 2 || ledger.active_epoch_id !== baseline.epoch_id || !Array.isArray(ledger.epochs)) {
  throw new Error("Trusted funnel ledger and baseline disagree; refusing an unattributed marketplace audit.");
}
if (monitor === "owner-journey") {
  try {
    const journey = JSON.parse(await readFile(ownerJourneyFile, "utf8")) as Record<string, unknown>;
    if (journey.schema_version !== OWNER_BUYER_JOURNEY_SCHEMA_VERSION) {
      throw new Error("Owner buyer journey state version is invalid.");
    }
    if (
      journey.status === "COMPLETED" ||
      journey.status === "STOPPED_NO_NATURAL_MATCH" ||
      journey.status === "AUTHORIZATION_STARTED"
    ) {
      console.log(JSON.stringify({
        status: "owner_journey_no_automatic_action",
        journey_status: journey.status,
        reason: journey.status === "AUTHORIZATION_STARTED"
          ? "Authorization began without a persisted validated result; reconcile manually and never retry automatically."
          : "Owner journey is terminal.",
      }, null, 2));
      process.exit(0);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  validateOwnerJourneyPrerequisite(
    JSON.parse(await readFile(distributionFile, "utf8")),
    ledger,
  );
  if (baseline.epoch_id !== OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH) {
    throw new Error("Owner buyer journey must begin from the frozen epoch-57 baseline.");
  }
  if (
    ledger.rotation?.status === "draining" &&
    ledger.rotation.id !==
      `owner-buyer-journey-v2-epoch-${OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH + 1}`
  ) {
    throw new Error("Another audited drain is active; owner buyer journey will wait.");
  }
}
if (ledger.rotation?.status !== "draining") {
  const rotationId = monitor === "owner-journey"
    ? `owner-buyer-journey-v2-epoch-${baseline.epoch_id + 1}`
    : `marketplace-audit-epoch-${baseline.epoch_id + 1}`;
  const script = new URL("./start-funnel-epoch.ts", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", script.pathname], {
    env: {
      ...process.env,
      START_FUNNEL_EPOCH: "YES",
      FUNNEL_ROTATION_ID: rotationId,
      FUNNEL_EPOCH_REASON: "Autonomous marketplace retrieval audits can trigger unattributed downstream origin crawls; exclude the audit and drain until external aggregates are stable.",
      QUIET_PERIOD_SECONDS: process.env.QUIET_PERIOD_SECONDS || "900",
    },
    timeout: 30_000,
    maxBuffer: 1_000_000,
    encoding: "utf8",
  });
  if (!/"status": "draining_started"/.test(stdout)) {
    throw new Error(`Marketplace audit could not establish a draining epoch: ${stdout.trim()}`);
  }
  process.stdout.write(stdout);
} else {
  console.log(JSON.stringify({
    status: "using_existing_draining_epoch",
    rotation_id: ledger.rotation.id,
    monitor,
  }));
}

process.env.BOUNTYVERDICT_AUDITED_ROTATION_ACTIVE = monitor;
process.env.BOUNTYVERDICT_AUDITED_ROTATION_ID = ledger.rotation?.status === "draining"
  ? ledger.rotation.id
  : monitor === "owner-journey"
    ? `owner-buyer-journey-v2-epoch-${baseline.epoch_id + 1}`
    : `marketplace-audit-epoch-${baseline.epoch_id + 1}`;
if (monitor === "directory") await import("./directory-monitor.ts");
else if (monitor === "distribution") await import("./distribution-monitor.ts");
else await import("./owner-buyer-journey.ts");
