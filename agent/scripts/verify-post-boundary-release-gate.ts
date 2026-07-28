import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isDeepStrictEqual, promisify } from "node:util";
import { readPrivateJson } from "../src/agent-question-v6-activation.ts";
import {
  EARNED_PLACEMENT_ENDS_AT,
  RELEASE_CANDIDATE_BRANCH,
  RELEASE_CANDIDATE_WORKTREE,
  SNAPSHOT_SOURCE_WORKTREE,
  verifyPostBoundaryReleaseGate,
  type SnapshotServiceState,
  type SnapshotSourceState,
  type SnapshotTimerState,
  type SnapshotUnitEvidence,
} from "../src/post-boundary-release-gate.ts";

const execFile = promisify(execFileCallback);
const experimentPath = process.env.ACQUISITION_EXPERIMENT_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/acquisition-experiment.json`;
const reportPath = process.env.DISTRIBUTION_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/distribution-status.json`;
const ledgerPath = process.env.TRUSTED_FUNNEL_HISTORY_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
const serviceName = "bountyverdict-acquisition-snapshot.service";
const timerName = "bountyverdict-acquisition-snapshot.timer";
const serviceUnitPath = `${homedir()}/.config/systemd/user/${serviceName}`;
const timerUnitPath = `${homedir()}/.config/systemd/user/${timerName}`;
const commandEnvironment = { ...process.env, LC_ALL: "C", TZ: "UTC" };

function parseProperties(output: string): Map<string, string[]> {
  const properties = new Map<string, string[]>();
  for (const line of output.trim().split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("Systemd evidence is malformed.");
    const key = line.slice(0, separator);
    properties.set(key, [...(properties.get(key) || []), line.slice(separator + 1)]);
  }
  return properties;
}

function one(properties: Map<string, string[]>, key: string): string {
  const values = properties.get(key);
  if (!values || values.length !== 1) throw new Error(`Systemd property ${key} is missing or duplicated.`);
  return values[0];
}

function canonicalSystemdTimestamp(value: string, label: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return new Date(milliseconds).toISOString();
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const preliminaryExperiment = await readPrivateJson(experimentPath, 64 * 1024);
if (Date.now() < Date.parse(EARNED_PLACEMENT_ENDS_AT)) {
  console.log(JSON.stringify({
    ready: false,
    status: "WAIT_BOUNDARY",
    ends_at: EARNED_PLACEMENT_ENDS_AT,
    terminal_result_present: Boolean(
      preliminaryExperiment &&
      typeof preliminaryExperiment === "object" &&
      !Array.isArray(preliminaryExperiment) &&
      (preliminaryExperiment as Record<string, unknown>).terminal_result,
    ),
  }, null, 2));
  process.exit(0);
}

const [
  experiment,
  distributionReport,
  trustedFunnelLedger,
  serviceOutput,
  timerOutput,
  sourceHead,
  sourceStatus,
  releaseHead,
  releaseRemoteHead,
  releaseBranch,
  releaseStatus,
  units,
] = await Promise.all([
  readPrivateJson(experimentPath, 64 * 1024),
  readPrivateJson(reportPath, 2 * 1024 * 1024),
  readPrivateJson(ledgerPath, 64 * 1024 * 1024),
  execFile("systemctl", [
    "--user",
    "show",
    serviceName,
    "--property=Result",
    "--property=ExecMainStatus",
    "--property=ActiveState",
    "--property=SubState",
    "--property=InvocationID",
    "--property=ExecMainStartTimestamp",
    "--property=ExecMainExitTimestamp",
    "--property=NeedDaemonReload",
    "--property=DropInPaths",
    "--property=FragmentPath",
    "--property=WorkingDirectory",
    "--property=ExecStart",
  ], { encoding: "utf8", env: commandEnvironment }),
  execFile("systemctl", [
    "--user",
    "show",
    timerName,
    "--property=LastTriggerUSec",
    "--property=NeedDaemonReload",
    "--property=DropInPaths",
    "--property=FragmentPath",
  ], { encoding: "utf8", env: commandEnvironment }),
  execFile("git", ["-C", SNAPSHOT_SOURCE_WORKTREE, "rev-parse", "HEAD"], {
    encoding: "utf8",
    env: commandEnvironment,
  }),
  execFile("git", ["-C", SNAPSHOT_SOURCE_WORKTREE, "status", "--porcelain=v1", "--untracked-files=all"], {
    encoding: "utf8",
    env: commandEnvironment,
  }),
  execFile("git", ["-C", RELEASE_CANDIDATE_WORKTREE, "rev-parse", "HEAD"], {
    encoding: "utf8",
    env: commandEnvironment,
  }),
  execFile("git", [
    "-C",
    RELEASE_CANDIDATE_WORKTREE,
    "rev-parse",
    `refs/remotes/origin/${RELEASE_CANDIDATE_BRANCH}`,
  ], {
    encoding: "utf8",
    env: commandEnvironment,
  }),
  execFile("git", ["-C", RELEASE_CANDIDATE_WORKTREE, "branch", "--show-current"], {
    encoding: "utf8",
    env: commandEnvironment,
  }),
  execFile("git", [
    "-C",
    RELEASE_CANDIDATE_WORKTREE,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ], {
    encoding: "utf8",
    env: commandEnvironment,
  }),
  Promise.all([readFile(serviceUnitPath), readFile(timerUnitPath)]).then(([service, timer]) => ({
    service_sha256: sha256(service),
    timer_sha256: sha256(timer),
  })),
]);
if (!experiment || !distributionReport || !trustedFunnelLedger) {
  throw new Error("Post-boundary release evidence is missing.");
}

const serviceProperties = parseProperties(serviceOutput.stdout);
const snapshotService: SnapshotServiceState = {
  Result: one(serviceProperties, "Result"),
  ExecMainStatus: one(serviceProperties, "ExecMainStatus"),
  ActiveState: one(serviceProperties, "ActiveState"),
  SubState: one(serviceProperties, "SubState"),
  InvocationID: one(serviceProperties, "InvocationID"),
  started_at: canonicalSystemdTimestamp(
    one(serviceProperties, "ExecMainStartTimestamp"),
    "Snapshot service start",
  ),
  completed_at: canonicalSystemdTimestamp(
    one(serviceProperties, "ExecMainExitTimestamp"),
    "Snapshot service completion",
  ),
  NeedDaemonReload: one(serviceProperties, "NeedDaemonReload"),
  DropInPaths: one(serviceProperties, "DropInPaths"),
  FragmentPath: one(serviceProperties, "FragmentPath"),
  WorkingDirectory: one(serviceProperties, "WorkingDirectory"),
  ExecStartCommands: (serviceProperties.get("ExecStart") || []).map((value) => {
    const match = value.match(/argv\[\]=(.*?) ; ignore_errors=/);
    if (!match) throw new Error("Snapshot service ExecStart evidence is malformed.");
    return match[1];
  }),
};
const timerProperties = parseProperties(timerOutput.stdout);
const snapshotTimer: SnapshotTimerState = {
  last_trigger_at: canonicalSystemdTimestamp(
    one(timerProperties, "LastTriggerUSec"),
    "Snapshot timer trigger",
  ),
  NeedDaemonReload: one(timerProperties, "NeedDaemonReload"),
  DropInPaths: one(timerProperties, "DropInPaths"),
  FragmentPath: one(timerProperties, "FragmentPath"),
};
const snapshotSource: SnapshotSourceState = {
  worktree: SNAPSHOT_SOURCE_WORKTREE,
  head: sourceHead.stdout.trim(),
  porcelain: sourceStatus.stdout,
};

const result = verifyPostBoundaryReleaseGate({
  experiment,
  distributionReport,
  trustedFunnelLedger,
  snapshotService,
  snapshotTimer,
  snapshotSource,
  snapshotUnits: units as SnapshotUnitEvidence,
  releaseCandidate: {
    worktree: RELEASE_CANDIDATE_WORKTREE,
    branch: releaseBranch.stdout.trim(),
    head: releaseHead.stdout.trim(),
    remote_head: releaseRemoteHead.stdout.trim(),
    porcelain: releaseStatus.stdout,
  },
});
const [experimentAfter, reportAfter, ledgerAfter] = await Promise.all([
  readPrivateJson(experimentPath, 64 * 1024),
  readPrivateJson(reportPath, 2 * 1024 * 1024),
  readPrivateJson(ledgerPath, 64 * 1024 * 1024),
]);
if (!isDeepStrictEqual(experimentAfter, experiment) ||
    !isDeepStrictEqual(reportAfter, distributionReport) ||
    !isDeepStrictEqual(ledgerAfter, trustedFunnelLedger)) {
  throw new Error("Post-boundary release evidence changed during verification.");
}
console.log(JSON.stringify(result, null, 2));
