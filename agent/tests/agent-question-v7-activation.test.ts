import assert from "node:assert/strict";
import test from "node:test";
import {
  activationFromVerifiedEpoch55,
  AGENT_QUESTION_V7_EPOCH,
  AGENT_QUESTION_V7_PRODUCTION_ACTIVATION,
  AGENT_QUESTION_V7_RELEASE,
  AGENT_QUESTION_V7_ROTATION,
} from "../src/agent-question-v7-activation.ts";
import { AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID } from "../src/task-leading-description-experiment.ts";

const activatedAt = "2026-07-22T21:40:00.000Z";
const ledger = {
  schema_version: 2,
  active_epoch_id: AGENT_QUESTION_V7_EPOCH,
  epochs: [{
    id: AGENT_QUESTION_V7_EPOCH,
    status: "active",
    started_at: activatedAt,
    conversion_eligible: true,
    baseline: { epoch_id: AGENT_QUESTION_V7_EPOCH, initialized_at: activatedAt },
  }],
  rotation: {
    id: AGENT_QUESTION_V7_ROTATION,
    status: "activated",
    target_epoch_id: AGENT_QUESTION_V7_EPOCH,
    activated_at: activatedAt,
  },
};

test("derives v7 activation only from the exact fresh Agent Finder drain boundary", () => {
  const activation = activationFromVerifiedEpoch55(ledger);
  assert.equal(activation?.experiment_id, AGENT_QUESTION_DESCRIPTION_EXPERIMENT_ID);
  assert.equal(activation?.release_commit, AGENT_QUESTION_V7_RELEASE);
  assert.equal(activation?.production_activation_commit, AGENT_QUESTION_V7_PRODUCTION_ACTIVATION);
  assert.equal(activation?.measurement_epoch_id, 55);
  assert.equal(activation?.epoch_activated_at, activatedAt);
  assert.equal(activationFromVerifiedEpoch55({ ...ledger, rotation: { ...ledger.rotation, status: "draining" } }), null);
  assert.equal(activationFromVerifiedEpoch55({ ...ledger, rotation: { ...ledger.rotation, id: "other-rotation" } }), null);
});

test("v7 refuses a stale active epoch or a non-eligible epoch", () => {
  assert.throws(
    () => activationFromVerifiedEpoch55({ ...ledger, active_epoch_id: 56 }),
    /no longer the active measurement epoch/,
  );
  assert.throws(
    () => activationFromVerifiedEpoch55({
      ...ledger,
      epochs: [{ ...ledger.epochs[0], conversion_eligible: false }],
    }),
    /does not match/,
  );
});
