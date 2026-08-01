import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { auditedMonitorRequiresRotation } from "../src/audited-monitor.ts";
import { trustedFunnelBaseline } from "../src/funnel-epoch.ts";
import { loadDistributionMonitorConfiguration } from "../src/monitor-configuration.ts";

const execFileAsync = promisify(execFile);
const monitor = process.env.AUDITED_MONITOR;
if (monitor !== "directory" && monitor !== "distribution") {
  throw new Error("AUDITED_MONITOR must be directory or distribution.");
}
const distributionConfiguration = monitor === "distribution"
  ? loadDistributionMonitorConfiguration(process.env)
  : null;
const requiresRotation = auditedMonitorRequiresRotation(
  monitor,
  distributionConfiguration?.reportOnly === true,
);
const baselineFile = process.env.TRUSTED_FUNNEL_BASELINE_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-baseline.json`;
const historyFile = process.env.TRUSTED_FUNNEL_HISTORY_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
if (requiresRotation) {
  const baseline = trustedFunnelBaseline(JSON.parse(await readFile(baselineFile, "utf8")));
  if (!baseline) throw new Error("Trusted funnel baseline is malformed; refusing an unattributed marketplace audit.");
  const ledger = JSON.parse(await readFile(historyFile, "utf8")) as Record<string, any>;
  if (ledger.schema_version !== 2 || ledger.active_epoch_id !== baseline.epoch_id || !Array.isArray(ledger.epochs)) {
    throw new Error("Trusted funnel ledger and baseline disagree; refusing an unattributed marketplace audit.");
  }
  if (ledger.rotation?.status !== "draining") {
    const rotationId = `marketplace-audit-epoch-${baseline.epoch_id + 1}`;
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
} else {
  console.log(JSON.stringify({
    status: "report_only_without_rotation",
    monitor,
  }));
}

if (requiresRotation) process.env.BOUNTYVERDICT_AUDITED_ROTATION_ACTIVE = monitor;
if (monitor === "directory") await import("./directory-monitor.ts");
else await import("./distribution-monitor.ts");
