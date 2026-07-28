import { execFile as execFileCallback } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { readPrivateJson } from "../src/agent-question-v6-activation.ts";
import {
  EARNED_PLACEMENT_ENDS_AT,
  EARNED_PLACEMENT_EXPERIMENT_NAME,
} from "../src/post-boundary-release-gate.ts";

const execFile = promisify(execFileCallback);
const enabled = process.env.RETRY_ACQUISITION_SNAPSHOT === "YES";
const experimentPath = process.env.ACQUISITION_EXPERIMENT_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/acquisition-experiment.json`;
const snapshotService = "bountyverdict-acquisition-snapshot.service";

function exactExperiment(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Acquisition experiment state is missing or malformed.");
  }
  const experiment = value as Record<string, unknown>;
  if (experiment.name !== EARNED_PLACEMENT_EXPERIMENT_NAME ||
      experiment.ends_at !== EARNED_PLACEMENT_ENDS_AT) {
    throw new Error("Acquisition experiment identity or boundary drifted.");
  }
  return experiment;
}

if (Date.now() < Date.parse(EARNED_PLACEMENT_ENDS_AT)) {
  throw new Error("Acquisition snapshot retry cannot run before the immutable boundary.");
}
const before = exactExperiment(await readPrivateJson(experimentPath, 64 * 1024));
if (before.terminal_result && typeof before.terminal_result === "object" &&
    !Array.isArray(before.terminal_result)) {
  console.log(JSON.stringify({ status: "already_frozen", ends_at: EARNED_PLACEMENT_ENDS_AT }));
  process.exit(0);
}
if (!enabled) throw new Error("Set RETRY_ACQUISITION_SNAPSHOT=YES to retry the reviewed snapshot service.");

await execFile("systemctl", ["--user", "start", snapshotService], {
  timeout: 4 * 60_000,
  maxBuffer: 1_000_000,
  encoding: "utf8",
  env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
});
const after = exactExperiment(await readPrivateJson(experimentPath, 64 * 1024));
if (!after.terminal_result || typeof after.terminal_result !== "object" ||
    Array.isArray(after.terminal_result)) {
  throw new Error("Reviewed acquisition snapshot retry did not produce a terminal result.");
}
console.log(JSON.stringify({ status: "retried_and_frozen", ends_at: EARNED_PLACEMENT_ENDS_AT }));
