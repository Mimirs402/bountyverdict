import { homedir } from "node:os";
import { readPrivateJson } from "../src/agent-question-v6-activation.ts";
import { checkpointFreeSelectorBoundary } from "../src/free-selector-boundary-checkpoint.ts";
import {
  readMeasurementExperimentCheckpoint,
  writeMeasurementExperimentCheckpoint,
} from "../src/recovery-experiment-checkpoint.ts";
import { CATALOG_FREE_PROOF_EXPERIMENT_ID } from "../src/task-leading-description-experiment.ts";

const home = homedir();
const funnelPath = process.env.FUNNEL_STATE_FILE ||
  `${home}/.local/state/bountyverdict/funnel-telemetry.json`;
const baselinePath = process.env.TRUSTED_FUNNEL_BASELINE_FILE ||
  `${home}/.local/state/bountyverdict/funnel-trusted-baseline.json`;
const ledgerPath = process.env.TRUSTED_FUNNEL_HISTORY_FILE ||
  `${home}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
const activationPath = process.env.CATALOG_FREE_PROOF_EXPERIMENT_ACTIVATION_FILE ||
  `${home}/.config/bountyverdict/catalog-free-proof-v1.activation.json`;
const checkpointPath = process.env.CATALOG_FREE_PROOF_EXPERIMENT_STATE_FILE ||
  `${home}/.local/state/bountyverdict/experiments/mcp-catalog-free-proof-v1.json`;

const [funnelState, trustedBaseline, trustedLedger, activation, previous] = await Promise.all([
  readPrivateJson(funnelPath),
  readPrivateJson(baselinePath),
  readPrivateJson(ledgerPath),
  readPrivateJson(activationPath),
  readMeasurementExperimentCheckpoint(checkpointPath, CATALOG_FREE_PROOF_EXPERIMENT_ID),
]);
const missing = Object.entries({ funnelState, trustedBaseline, trustedLedger, activation })
  .filter(([, value]) => value === null)
  .map(([name]) => name);
if (missing.length) throw new Error(`Catalog free-proof boundary inputs are missing: ${missing.join(", ")}`);

const observedAt = new Date().toISOString();
const checkpoint = checkpointFreeSelectorBoundary({
  experimentId: CATALOG_FREE_PROOF_EXPERIMENT_ID,
  observedAt,
  funnelState,
  trustedBaseline,
  trustedLedger,
  activation,
  previous,
});
await writeMeasurementExperimentCheckpoint(
  checkpointPath,
  CATALOG_FREE_PROOF_EXPERIMENT_ID,
  observedAt,
  checkpoint.experiment,
);
console.log(JSON.stringify({
  status: checkpoint.audit_ready ? "boundary_ready_for_audited_monitor" : "boundary_waiting",
  tools_list: checkpoint.tools_list,
  remaining_tools_list: checkpoint.remaining_tools_list,
}));
if (!checkpoint.audit_ready) process.exitCode = 1;
