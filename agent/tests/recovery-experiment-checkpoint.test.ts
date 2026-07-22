import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readRecoveryExperimentCheckpoint,
  writeRecoveryExperimentCheckpoint,
} from "../src/recovery-experiment-checkpoint.ts";

const id = "mcp-unknown-tool-recovery-epoch46-v1";
const state = { id, accounting_schema_version: 3, eligible_delta: { tools_list: 20 } };

test("round-trips an owner-only atomic recovery checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-recovery-checkpoint-"));
  const path = join(directory, "nested", "checkpoint.json");
  await writeRecoveryExperimentCheckpoint(path, id, "2026-07-22T14:09:39.106Z", state);
  assert.deepEqual(await readRecoveryExperimentCheckpoint(path, id), state);
  const envelope = JSON.parse(await readFile(path, "utf8"));
  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.experiment_id, id);
});

test("refuses permissive files and symlink checkpoints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-recovery-checkpoint-"));
  const target = join(directory, "target.json");
  const link = join(directory, "link.json");
  await writeFile(target, JSON.stringify({
    schema_version: 1,
    experiment_id: id,
    persisted_at: "2026-07-22T14:09:39.106Z",
    state,
  }), { mode: 0o644 });
  await assert.rejects(readRecoveryExperimentCheckpoint(target, id), /mode 0600/);
  await symlink(target, link);
  await assert.rejects(readRecoveryExperimentCheckpoint(link, id), (error: any) => error?.code === "ELOOP");
});

test("refuses mismatched experiment identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-recovery-checkpoint-"));
  const path = join(directory, "checkpoint.json");
  await writeRecoveryExperimentCheckpoint(path, id, "2026-07-22T14:09:39.106Z", state);
  await assert.rejects(
    readRecoveryExperimentCheckpoint(path, "mcp-some-other-experiment-v1"),
    /different experiment/,
  );
});
