export const TASKMARKET_TRACKED_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const TASKMARKET_TRACKED_RETRY_INTERVAL_MS = 30 * 60 * 1_000;

export const DEMAND_WATCH_SOURCE_KEYS = Object.freeze([
  "moltjobs",
  "openjobs",
  "taskmarket_inventory",
  "taskmarket_tracked",
] as const);

export type DemandWatchSourceKey = typeof DEMAND_WATCH_SOURCE_KEYS[number];

export type DemandWatchSourceStatus = {
  last_attempt_at: string;
  last_good_at: string;
  error: string | null;
};

export type DemandWatchSourceResolution<T> = {
  value: T;
  status: DemandWatchSourceStatus;
  reused_last_good: boolean;
};

type PreviousDemandWatchState = {
  checked_at?: unknown;
  source_status?: unknown;
  sources?: unknown;
};

type TrackedRefreshDecision = {
  due: boolean;
  reason: "missing_snapshot" | "interval_elapsed" | "post_expiry" | "retry_after_error" |
    "retry_backoff" | "cached";
  last_good_at: string | null;
};

const validTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export function compactDemandWatchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "unknown source failure";
}

export function demandWatchSourceStatus(
  previous: PreviousDemandWatchState | null,
  key: DemandWatchSourceKey,
): DemandWatchSourceStatus | null {
  const sourceStatus = asRecord(previous?.source_status);
  const status = asRecord(sourceStatus?.[key]);
  if (status && validTimestamp(status.last_attempt_at) && validTimestamp(status.last_good_at) &&
    (status.error === null || typeof status.error === "string")) {
    return {
      last_attempt_at: status.last_attempt_at,
      last_good_at: status.last_good_at,
      error: status.error,
    };
  }
  if (validTimestamp(previous?.checked_at)) {
    return {
      last_attempt_at: previous.checked_at,
      last_good_at: previous.checked_at,
      error: null,
    };
  }
  return null;
}

export function successfulDemandWatchSource(at: string): DemandWatchSourceStatus {
  if (!validTimestamp(at)) throw new Error("Demand-watch source success timestamp is invalid.");
  return { last_attempt_at: at, last_good_at: at, error: null };
}

export function failedDemandWatchSource(
  at: string,
  previous: DemandWatchSourceStatus | null,
  error: unknown,
): DemandWatchSourceStatus {
  if (!validTimestamp(at) || !previous) {
    throw new Error("Demand-watch source failure has no last-good snapshot.");
  }
  return {
    last_attempt_at: at,
    last_good_at: previous.last_good_at,
    error: compactDemandWatchError(error),
  };
}

export function resolveDemandWatchSource<T>({
  attemptedAt,
  label,
  result,
  previousStatus,
  previousValue,
}: {
  attemptedAt: string;
  label: string;
  result: PromiseSettledResult<T>;
  previousStatus: DemandWatchSourceStatus | null;
  previousValue: T | undefined;
}): DemandWatchSourceResolution<T> {
  if (result.status === "fulfilled") {
    return {
      value: result.value,
      status: successfulDemandWatchSource(attemptedAt),
      reused_last_good: false,
    };
  }
  if (previousValue === undefined || previousStatus === null) {
    throw new Error(`${label} failed without a last-good snapshot: ${compactDemandWatchError(result.reason)}`);
  }
  return {
    value: previousValue,
    status: failedDemandWatchSource(attemptedAt, previousStatus, result.reason),
    reused_last_good: true,
  };
}

export function shouldRefreshTaskmarketTracked(
  previous: PreviousDemandWatchState | null,
  nowMs: number,
  refreshIntervalMs = TASKMARKET_TRACKED_REFRESH_INTERVAL_MS,
  retryIntervalMs = TASKMARKET_TRACKED_RETRY_INTERVAL_MS,
): TrackedRefreshDecision {
  if (!Number.isFinite(nowMs) || refreshIntervalMs <= 0 || retryIntervalMs <= 0) {
    throw new Error("Taskmarket tracked refresh timing is invalid.");
  }
  const sources = asRecord(previous?.sources);
  const taskmarket = asRecord(sources?.taskmarket);
  const tracked = asRecord(taskmarket?.tracked_worker);
  const status = demandWatchSourceStatus(previous, "taskmarket_tracked");
  if (!tracked || !status) return { due: true, reason: "missing_snapshot", last_good_at: null };

  const lastGoodMs = Date.parse(status.last_good_at);
  const lastAttemptMs = Date.parse(status.last_attempt_at);
  if (status.error !== null) {
    return nowMs - lastAttemptMs >= retryIntervalMs
      ? { due: true, reason: "retry_after_error", last_good_at: status.last_good_at }
      : { due: false, reason: "retry_backoff", last_good_at: status.last_good_at };
  }

  const submissions = Array.isArray(tracked.submissions) ? tracked.submissions : [];
  const crossedExpiry = submissions.some((value) => {
    const record = asRecord(value);
    const expiry = record?.task_expiry_at;
    if (!validTimestamp(expiry) || record?.submission_state !== "pending_award") return false;
    const expiryMs = Date.parse(expiry);
    return expiryMs > lastGoodMs && expiryMs <= nowMs;
  });
  if (crossedExpiry) {
    return { due: true, reason: "post_expiry", last_good_at: status.last_good_at };
  }
  if (nowMs - lastGoodMs >= refreshIntervalMs) {
    return { due: true, reason: "interval_elapsed", last_good_at: status.last_good_at };
  }
  return { due: false, reason: "cached", last_good_at: status.last_good_at };
}
