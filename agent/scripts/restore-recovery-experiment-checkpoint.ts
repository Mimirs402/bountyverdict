import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import {
  readRecoveryExperimentCheckpoint,
  writeRecoveryExperimentCheckpoint,
} from "../src/recovery-experiment-checkpoint.ts";

const execFileAsync = promisify(execFile);
const invocationId = process.env.RECOVERY_JOURNAL_INVOCATION_ID || "";
if (!/^[a-f0-9]{32}$/.test(invocationId)) {
  throw new Error("RECOVERY_JOURNAL_INVOCATION_ID must be the exact 32-character systemd invocation ID.");
}
const experimentId = "mcp-unknown-tool-recovery-epoch46-v1";
const checkpointPath = process.env.RECOVERY_EXPERIMENT_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/experiments/${experimentId}.json`;
const { stdout } = await execFileAsync("journalctl", [
  "--user",
  "_SYSTEMD_INVOCATION_ID=" + invocationId,
  "--no-pager",
  "-o",
  "json",
], { encoding: "utf8", maxBuffer: 100_000_000, timeout: 30_000 });
const messages = stdout.trim().split("\n").filter(Boolean).map((line) => {
  const entry = JSON.parse(line) as Record<string, unknown>;
  if (entry._SYSTEMD_INVOCATION_ID !== invocationId || typeof entry.MESSAGE !== "string") {
    throw new Error("Journal output escaped the pinned systemd invocation.");
  }
  return entry.MESSAGE;
});
const report = JSON.parse(messages.join("\n")) as Record<string, any>;
const state = report.funnel?.mcp_unknown_tool_recovery_experiment as Record<string, any> | undefined;
if (report.checked_at !== "2026-07-22T14:09:39.106Z" ||
  state?.id !== experimentId ||
  state.accounting_schema_version !== 3 ||
  state.status !== "running_clean_epoch" ||
  state.measurement_epoch_id !== 46 ||
  state.target_tools_list !== 25 ||
  state.remaining_eligible_tools_list !== 5 ||
  state.boundary !== null ||
  state.eligible_delta?.initialize !== 19 ||
  state.eligible_delta?.tools_list !== 20 ||
  ["protocol_error", "tool_not_found", "validation_error", "capacity_rejected", "payment_required", "payment_present", "paid_success", "paid_error"]
    .some((key) => state.eligible_delta?.[key] !== 0)) {
  throw new Error("Pinned journal report does not match the independently observed clean 20/25 checkpoint.");
}
const existing = await readRecoveryExperimentCheckpoint(checkpointPath, experimentId);
if (existing) throw new Error("Recovery experiment checkpoint already exists; refusing to overwrite it during restoration.");
await writeRecoveryExperimentCheckpoint(checkpointPath, experimentId, report.checked_at, state);
console.log(JSON.stringify({
  status: "restored_verified_checkpoint",
  experiment_id: experimentId,
  journal_invocation_id: invocationId,
  observed_at: report.checked_at,
  eligible_delta: state.eligible_delta,
  checkpoint_path: checkpointPath,
}, null, 2));
