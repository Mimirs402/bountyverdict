import { homedir } from "node:os";
import {
  readPrivateJson,
  writePrivateActivation,
} from "../src/agent-question-v6-activation.ts";
import {
  activationFromVerifiedFreeSelectionEpoch,
} from "../src/free-selection-router-experiment.ts";
import {
  CATALOG_FREE_PROOF_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
} from "../src/task-leading-description-experiment.ts";

if (process.env.ACTIVATE_CATALOG_FREE_PROOF_EXPERIMENT !== "YES") {
  throw new Error("Set ACTIVATE_CATALOG_FREE_PROOF_EXPERIMENT=YES to reconcile the catalog free-proof experiment.");
}

const required = [
  "CATALOG_FREE_PROOF_RELEASE_COMMIT",
  "CATALOG_FREE_PROOF_PRODUCTION_ACTIVATION_COMMIT",
  "CATALOG_FREE_PROOF_PRODUCTION_ACTIVATED_AT",
  "CATALOG_FREE_PROOF_DRAIN_ROTATION_ID",
] as const;
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing catalog free-proof activation coordinates: ${missing.join(", ")}`);

const ledgerPath = process.env.TRUSTED_FUNNEL_HISTORY_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
const activationPath = process.env.CATALOG_FREE_PROOF_EXPERIMENT_ACTIVATION_FILE ||
  `${homedir()}/.config/bountyverdict/catalog-free-proof-v1.activation.json`;

const ledger = await readPrivateJson(ledgerPath);
if (!ledger) throw new Error("Trusted funnel epoch ledger is missing.");
const activation = activationFromVerifiedFreeSelectionEpoch(ledger, {
  releaseCommit: process.env.CATALOG_FREE_PROOF_RELEASE_COMMIT!,
  productionActivationCommit: process.env.CATALOG_FREE_PROOF_PRODUCTION_ACTIVATION_COMMIT!,
  productionActivatedAt: process.env.CATALOG_FREE_PROOF_PRODUCTION_ACTIVATED_AT!,
  drainRotationId: process.env.CATALOG_FREE_PROOF_DRAIN_ROTATION_ID!,
}, CATALOG_FREE_PROOF_EXPERIMENT_ID);
if (!activation) {
  console.log(JSON.stringify({ status: "awaiting_exact_activated_catalog_free_proof_rotation" }));
  process.exit(0);
}

const existing = await readPrivateJson(activationPath, 64 * 1024);
if (existing) {
  const parsed = parseTaskLeadingDescriptionActivation(existing, CATALOG_FREE_PROOF_EXPERIMENT_ID);
  if (JSON.stringify(parsed) !== JSON.stringify(activation)) {
    throw new Error("Existing catalog free-proof activation does not match the verified epoch boundary.");
  }
  console.log(JSON.stringify({ status: "already_activated", measurement_epoch_id: activation.measurement_epoch_id }));
  process.exit(0);
}

await writePrivateActivation(activationPath, activation, CATALOG_FREE_PROOF_EXPERIMENT_ID);
console.log(JSON.stringify({
  status: "activated",
  measurement_epoch_id: activation.measurement_epoch_id,
  epoch_activated_at: activation.epoch_activated_at,
}));
