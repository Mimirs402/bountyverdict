import assert from "node:assert/strict";
import test from "node:test";
import {
  demandWatchSourceStatus,
  failedDemandWatchSource,
  resolveDemandWatchSource,
  shouldRefreshTaskmarketTracked,
  successfulDemandWatchSource,
  TASKMARKET_TRACKED_REFRESH_INTERVAL_MS,
} from "../src/demand-watch-state.ts";

const taskExpiry = "2026-07-28T18:05:00.000Z";

function previousState({
  checkedAt = "2026-07-28T18:00:00.000Z",
  lastAttemptAt = checkedAt,
  lastGoodAt = checkedAt,
  error = null,
}: {
  checkedAt?: string;
  lastAttemptAt?: string;
  lastGoodAt?: string;
  error?: string | null;
} = {}) {
  return {
    checked_at: checkedAt,
    source_status: {
      taskmarket_tracked: {
        last_attempt_at: lastAttemptAt,
        last_good_at: lastGoodAt,
        error,
      },
    },
    sources: {
      taskmarket: {
        tracked_worker: {
          submissions: [{
            submission_state: "pending_award",
            task_expiry_at: taskExpiry,
          }],
        },
      },
    },
  };
}

test("source failure preserves the prior last-good timestamp and compacts its error", () => {
  const previous = successfulDemandWatchSource("2026-07-28T18:00:00.000Z");
  const failed = failedDemandWatchSource(
    "2026-07-28T18:10:00.000Z",
    previous,
    new Error("MoltJobs\n  connect timeout"),
  );
  assert.deepEqual(failed, {
    last_attempt_at: "2026-07-28T18:10:00.000Z",
    last_good_at: "2026-07-28T18:00:00.000Z",
    error: "MoltJobs connect timeout",
  });
});

test("one failed source reuses only its own last-good value", () => {
  const previousStatus = successfulDemandWatchSource("2026-07-28T18:00:00.000Z");
  const failed = resolveDemandWatchSource({
    attemptedAt: "2026-07-28T18:10:00.000Z",
    label: "MoltJobs",
    result: { status: "rejected", reason: new Error("connect timeout") },
    previousStatus,
    previousValue: { open_jobs: 1 },
  });
  const healthy = resolveDemandWatchSource({
    attemptedAt: "2026-07-28T18:10:00.000Z",
    label: "OpenJobs",
    result: { status: "fulfilled", value: { open_jobs: 29 } },
    previousStatus,
    previousValue: { open_jobs: 28 },
  });
  assert.equal(failed.value.open_jobs, 1);
  assert.equal(failed.reused_last_good, true);
  assert.equal(failed.status.error, "connect timeout");
  assert.equal(healthy.value.open_jobs, 29);
  assert.equal(healthy.reused_last_good, false);
  assert.equal(healthy.status.error, null);
});

test("legacy state supplies a compatible last-good timestamp", () => {
  assert.deepEqual(demandWatchSourceStatus({
    checked_at: "2026-07-28T18:00:00.000Z",
  }, "openjobs"), {
    last_attempt_at: "2026-07-28T18:00:00.000Z",
    last_good_at: "2026-07-28T18:00:00.000Z",
    error: null,
  });
});

test("tracked Taskmarket reconciliation stays cached until its six-hour cadence", () => {
  const previous = previousState({
    checkedAt: "2026-07-28T18:00:00.000Z",
    lastGoodAt: "2026-07-28T18:00:00.000Z",
  });
  previous.sources.taskmarket.tracked_worker.submissions = [];
  assert.deepEqual(shouldRefreshTaskmarketTracked(
    previous,
    Date.parse("2026-07-28T23:59:59.999Z"),
  ), {
    due: false,
    reason: "cached",
    last_good_at: "2026-07-28T18:00:00.000Z",
  });
  assert.deepEqual(shouldRefreshTaskmarketTracked(
    previous,
    Date.parse("2026-07-29T00:00:00.000Z"),
  ), {
    due: true,
    reason: "interval_elapsed",
    last_good_at: "2026-07-28T18:00:00.000Z",
  });
  assert.equal(TASKMARKET_TRACKED_REFRESH_INTERVAL_MS, 21_600_000);
});

test("first ten-minute pass after a pending submission expires forces one exact refresh", () => {
  const beforeExpiry = previousState();
  assert.equal(shouldRefreshTaskmarketTracked(
    beforeExpiry,
    Date.parse("2026-07-28T18:06:00.000Z"),
  ).reason, "post_expiry");

  const afterRefresh = previousState({
    checkedAt: "2026-07-28T18:06:00.000Z",
    lastGoodAt: "2026-07-28T18:06:00.000Z",
  });
  assert.equal(shouldRefreshTaskmarketTracked(
    afterRefresh,
    Date.parse("2026-07-28T18:16:00.000Z"),
  ).reason, "cached");
});

test("failed tracked refresh retries after a bounded thirty-minute backoff", () => {
  const previous = previousState({
    checkedAt: "2026-07-28T18:10:00.000Z",
    lastAttemptAt: "2026-07-28T18:10:00.000Z",
    lastGoodAt: "2026-07-28T18:00:00.000Z",
    error: "Taskmarket timeout",
  });
  assert.equal(shouldRefreshTaskmarketTracked(
    previous,
    Date.parse("2026-07-28T18:39:59.999Z"),
  ).reason, "retry_backoff");
  assert.equal(shouldRefreshTaskmarketTracked(
    previous,
    Date.parse("2026-07-28T18:40:00.000Z"),
  ).reason, "retry_after_error");
});
