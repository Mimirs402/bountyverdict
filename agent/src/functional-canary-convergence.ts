export type WorkerVersionProbe = {
  worker_version_id: string | null;
};

type WaitOptions = {
  timeoutMs?: number;
  retryMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<unknown>;
};

export async function waitForPinnedWorkerVersion<T extends WorkerVersionProbe>(
  expectedWorkerVersionId: string,
  probe: () => Promise<T>,
  options: WaitOptions = {},
): Promise<T> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(expectedWorkerVersionId)) {
    throw new Error("Expected Worker version ID must be a lowercase UUID.");
  }
  const timeoutMs = options.timeoutMs ?? 45_000;
  const retryMs = options.retryMs ?? 1_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 ||
    !Number.isInteger(retryMs) || retryMs < 1 || retryMs > Math.max(timeoutMs, 1)) {
    throw new Error("Worker version convergence timing is invalid.");
  }
  const now = options.now || Date.now;
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + timeoutMs;
  let latest: T;
  do {
    latest = await probe();
    if (latest.worker_version_id === expectedWorkerVersionId || now() >= deadline) return latest;
    await sleep(retryMs);
  } while (true);
}
