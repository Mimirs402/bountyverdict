import { homedir } from "node:os";
import {
  readPrivateJson,
  writePrivateActivation,
} from "../src/agent-question-v6-activation.ts";
import {
  activationFromVerifiedFreeSelectionEpoch,
} from "../src/free-selection-router-experiment.ts";
import {
  FREE_SELECTION_CATALOG_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
} from "../src/task-leading-description-experiment.ts";

if (process.env.ACTIVATE_FREE_SELECTION_CATALOG_EXPERIMENT !== "YES") {
  throw new Error("Set ACTIVATE_FREE_SELECTION_CATALOG_EXPERIMENT=YES to reconcile the free catalog experiment.");
}

const required = [
  "FREE_SELECTION_CATALOG_RELEASE_COMMIT",
  "FREE_SELECTION_CATALOG_PRODUCTION_ACTIVATION_COMMIT",
  "FREE_SELECTION_CATALOG_PRODUCTION_ACTIVATED_AT",
  "FREE_SELECTION_CATALOG_DRAIN_ROTATION_ID",
] as const;
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing free catalog activation coordinates: ${missing.join(", ")}`);

const ledgerPath = process.env.TRUSTED_FUNNEL_HISTORY_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
const activationPath = process.env.FREE_SELECTION_CATALOG_EXPERIMENT_ACTIVATION_FILE ||
  `${homedir()}/.config/bountyverdict/free-selection-catalog-v2.activation.json`;

const ledger = await readPrivateJson(ledgerPath);
if (!ledger) throw new Error("Trusted funnel epoch ledger is missing.");
const activation = activationFromVerifiedFreeSelectionEpoch(ledger, {
  releaseCommit: process.env.FREE_SELECTION_CATALOG_RELEASE_COMMIT!,
  productionActivationCommit: process.env.FREE_SELECTION_CATALOG_PRODUCTION_ACTIVATION_COMMIT!,
  productionActivatedAt: process.env.FREE_SELECTION_CATALOG_PRODUCTION_ACTIVATED_AT!,
  drainRotationId: process.env.FREE_SELECTION_CATALOG_DRAIN_ROTATION_ID!,
}, FREE_SELECTION_CATALOG_EXPERIMENT_ID);
if (!activation) {
  console.log(JSON.stringify({ status: "awaiting_exact_activated_free_catalog_rotation" }));
  process.exit(0);
}

const existing = await readPrivateJson(activationPath, 64 * 1024);
if (existing) {
  const parsed = parseTaskLeadingDescriptionActivation(existing, FREE_SELECTION_CATALOG_EXPERIMENT_ID);
  if (JSON.stringify(parsed) !== JSON.stringify(activation)) {
    throw new Error("Existing free catalog activation does not match the verified epoch boundary.");
  }
  console.log(JSON.stringify({ status: "already_activated", measurement_epoch_id: activation.measurement_epoch_id }));
  process.exit(0);
}

await writePrivateActivation(activationPath, activation, FREE_SELECTION_CATALOG_EXPERIMENT_ID);
console.log(JSON.stringify({
  status: "activated",
  measurement_epoch_id: activation.measurement_epoch_id,
  epoch_activated_at: activation.epoch_activated_at,
}));
