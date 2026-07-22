import { homedir } from "node:os";
import {
  activationFromVerifiedEpoch55,
} from "../src/agent-question-v7-activation.ts";
import {
  readPrivateJson,
  writePrivateActivation,
} from "../src/agent-question-v6-activation.ts";
import {
  AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
} from "../src/task-leading-description-experiment.ts";

if (process.env.ACTIVATE_AGENT_QUESTION_EXPERIMENT !== "YES") {
  throw new Error("Set ACTIVATE_AGENT_QUESTION_EXPERIMENT=YES to reconcile v7 activation.");
}

const ledgerPath = process.env.TRUSTED_FUNNEL_HISTORY_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
const activationPath = process.env.AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ACTIVATION_FILE ||
  `${homedir()}/.config/bountyverdict/agent-question-description-experiment-v7.activation.json`;

const ledger = await readPrivateJson(ledgerPath);
if (!ledger) throw new Error("Trusted funnel epoch ledger is missing.");
const activation = activationFromVerifiedEpoch55(ledger);
if (!activation) {
  console.log(JSON.stringify({ status: "awaiting_verified_epoch_55" }));
  process.exit(0);
}

const existing = await readPrivateJson(activationPath, 64 * 1024);
if (existing) {
  const parsed = parseTaskLeadingDescriptionActivation(existing, AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID);
  if (JSON.stringify(parsed) !== JSON.stringify(activation)) {
    throw new Error("Existing v7 activation does not match the verified epoch boundary.");
  }
  console.log(JSON.stringify({ status: "already_activated", measurement_epoch_id: activation.measurement_epoch_id }));
  process.exit(0);
}

await writePrivateActivation(activationPath, activation, AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID);
console.log(JSON.stringify({
  status: "activated",
  measurement_epoch_id: activation.measurement_epoch_id,
  epoch_activated_at: activation.epoch_activated_at,
}));
