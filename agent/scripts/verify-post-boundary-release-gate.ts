import { execFile as execFileCallback } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { readPrivateJson } from "../src/agent-question-v6-activation.ts";
import {
  verifyPostBoundaryReleaseGate,
  type SnapshotServiceState,
} from "../src/post-boundary-release-gate.ts";

const execFile = promisify(execFileCallback);
const experimentPath = process.env.ACQUISITION_EXPERIMENT_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/acquisition-experiment.json`;
const reportPath = process.env.DISTRIBUTION_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/distribution-status.json`;
const serviceName = "bountyverdict-acquisition-snapshot.service";

const [experiment, distributionReport, serviceOutput] = await Promise.all([
  readPrivateJson(experimentPath, 64 * 1024),
  readPrivateJson(reportPath, 2 * 1024 * 1024),
  execFile("systemctl", [
    "--user",
    "show",
    serviceName,
    "--property=Result",
    "--property=ExecMainStatus",
    "--property=ActiveState",
    "--property=SubState",
  ]),
]);
if (!experiment || !distributionReport) throw new Error("Post-boundary release evidence is missing.");

const snapshotService = Object.fromEntries(
  serviceOutput.stdout.trim().split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("Snapshot service evidence is malformed.");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }),
) as SnapshotServiceState;

console.log(JSON.stringify(verifyPostBoundaryReleaseGate({
  experiment,
  distributionReport,
  snapshotService,
}), null, 2));
