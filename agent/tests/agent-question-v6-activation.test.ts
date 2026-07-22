import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  activationFromVerifiedEpoch54,
  AGENT_QUESTION_V6_EPOCH,
  AGENT_QUESTION_V6_ROTATION,
  readPrivateJson,
  writePrivateActivation,
} from "../src/agent-question-v6-activation.ts";

const activatedAt = "2026-07-22T21:01:38.438Z";
const ledger = {
  schema_version: 2,
  active_epoch_id: AGENT_QUESTION_V6_EPOCH,
  epochs: [{
    id: AGENT_QUESTION_V6_EPOCH,
    status: "active",
    started_at: activatedAt,
    conversion_eligible: true,
    baseline: { epoch_id: AGENT_QUESTION_V6_EPOCH, initialized_at: activatedAt },
  }],
  rotation: {
    id: AGENT_QUESTION_V6_ROTATION,
    status: "activated",
    target_epoch_id: AGENT_QUESTION_V6_EPOCH,
    activated_at: activatedAt,
  },
};

test("derives v6 activation only from the exact active verified epoch boundary", () => {
  const activation = activationFromVerifiedEpoch54(ledger);
  assert.equal(activation?.measurement_epoch_id, 54);
  assert.equal(activation?.epoch_activated_at, activatedAt);
  assert.equal(activationFromVerifiedEpoch54({ ...ledger, rotation: { ...ledger.rotation, status: "draining" } }), null);
  assert.equal(activationFromVerifiedEpoch54({ ...ledger, rotation: { ...ledger.rotation, id: "other-rotation" } }), null);
  assert.throws(
    () => activationFromVerifiedEpoch54({ ...ledger, active_epoch_id: 55 }),
    /no longer the active measurement epoch/,
  );
  assert.throws(
    () => activationFromVerifiedEpoch54({
      ...ledger,
      epochs: [{ ...ledger.epochs[0], conversion_eligible: false }],
    }),
    /does not match/,
  );
});

test("writes and reads an exact owner-private activation atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-v6-activation-"));
  const path = join(directory, "nested", "activation.json");
  const activation = activationFromVerifiedEpoch54(ledger)!;
  await writePrivateActivation(path, activation);
  assert.deepEqual(await readPrivateJson(path), activation);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("private JSON input rejects permissive state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-v6-activation-"));
  const path = join(directory, "ledger.json");
  await writeFile(path, `${JSON.stringify(ledger)}\n`, { mode: 0o600 });
  assert.deepEqual(await readPrivateJson(path), ledger);
  await chmod(path, 0o644);
  await assert.rejects(readPrivateJson(path), /mode 0600/);
  assert.ok((await readFile(path, "utf8")).includes(AGENT_QUESTION_V6_ROTATION));
});
