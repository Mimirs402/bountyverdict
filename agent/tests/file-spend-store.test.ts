import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateFileSpendStore } from "../src/file-spend-store.ts";

const entry = {
  atomicAmount: 50_000n,
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453" as const,
  payTo: "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
  at: 1_721_476_800_000,
};

test("private spend store persists bigint entries atomically with private mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-ledger-"));
  try {
    const path = join(directory, "ledger.json");
    const store = new PrivateFileSpendStore(path);
    assert.deepEqual(await store.load(), []);
    await store.append(entry);
    assert.deepEqual(await store.load(), [entry]);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const serialized = await readFile(path, "utf8");
    assert.match(serialized, /"atomic_amount": "50000"/);
    assert.doesNotMatch(serialized, /50000n/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("private spend store prunes and removes exact entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-ledger-"));
  try {
    const store = new PrivateFileSpendStore(join(directory, "ledger.json"));
    const newer = { ...entry, atomicAmount: 60_000n, at: entry.at + 1_000 };
    await store.append(entry);
    await store.append(newer);
    await store.prune(entry.at + 1);
    assert.deepEqual(await store.load(), [newer]);
    await store.removeEntry(newer);
    assert.deepEqual(await store.load(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("private spend store rejects malformed or over-capacity state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-ledger-"));
  try {
    const path = join(directory, "ledger.json");
    const store = new PrivateFileSpendStore(path, 1);
    await writeFile(path, JSON.stringify({ ledger: "wrong", version: "1.0", entries: [] }));
    await assert.rejects(store.load(), /envelope is invalid/);
    await rm(path);
    await store.append(entry);
    await assert.rejects(store.append({ ...entry, at: entry.at + 1 }), /capacity/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
