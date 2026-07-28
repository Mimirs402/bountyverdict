import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedAttempts } from "../src/bounded-retry.ts";

test("retries one transient unsuccessful result and returns success", async () => {
  const attempts: number[] = [];
  const retries: Array<{ attempt: number; code: number }> = [];
  const result = await runBoundedAttempts(
    2,
    async (attempt) => {
      attempts.push(attempt);
      return attempt === 1 ? 1 : 0;
    },
    (code) => code === 0,
    (attempt, code) => retries.push({ attempt, code }),
  );

  assert.equal(result, 0);
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(retries, [{ attempt: 1, code: 1 }]);
});

test("does not retry a successful first result", async () => {
  let calls = 0;
  const result = await runBoundedAttempts(
    2,
    async () => {
      calls += 1;
      return 0;
    },
    (code) => code === 0,
  );

  assert.equal(result, 0);
  assert.equal(calls, 1);
});

test("returns the final failure without exceeding the bound", async () => {
  let calls = 0;
  const result = await runBoundedAttempts(
    2,
    async () => {
      calls += 1;
      return 1;
    },
    (code) => code === 0,
  );

  assert.equal(result, 1);
  assert.equal(calls, 2);
});

test("rejects an unsafe attempt bound", async () => {
  await assert.rejects(
    () => runBoundedAttempts(4, async () => 0, (code) => code === 0),
    /integer from 1 through 3/,
  );
});
