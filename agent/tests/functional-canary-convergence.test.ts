import assert from "node:assert/strict";
import test from "node:test";
import { waitForPinnedWorkerVersion } from "../src/functional-canary-convergence.ts";

const expected = "12345678-1234-1234-1234-123456789abc";

test("release convergence waits through stale edges before accepting the exact Worker UUID", async () => {
  const observed = [null, null, expected];
  let clock = 0;
  let sleeps = 0;
  const result = await waitForPinnedWorkerVersion(expected, async () => ({
    worker_version_id: observed.shift() || null,
  }), {
    timeoutMs: 10,
    retryMs: 1,
    now: () => clock,
    sleep: async (milliseconds) => {
      sleeps += 1;
      clock += milliseconds;
    },
  });
  assert.equal(result.worker_version_id, expected);
  assert.equal(sleeps, 2);
});

test("release convergence returns the last mismatched observation at its exact deadline", async () => {
  let clock = 0;
  let probes = 0;
  const result = await waitForPinnedWorkerVersion(expected, async () => {
    probes += 1;
    return { worker_version_id: null };
  }, {
    timeoutMs: 2,
    retryMs: 1,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  });
  assert.equal(result.worker_version_id, null);
  assert.equal(probes, 3);
});

test("release convergence rejects invalid UUIDs and timing without probing", async () => {
  let probes = 0;
  const probe = async () => {
    probes += 1;
    return { worker_version_id: expected };
  };
  await assert.rejects(() => waitForPinnedWorkerVersion("1.1.19", probe), /lowercase UUID/);
  await assert.rejects(() => waitForPinnedWorkerVersion(expected, probe, { timeoutMs: 10, retryMs: 11 }), /timing/);
  assert.equal(probes, 0);
});
