import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import {
  analyzeMoltJobs,
  analyzeOpenJobs,
  parseMoltJobsPage,
  parseOpenJobs,
  type MoltJob,
} from "../src/demand-watch.ts";
import {
  analyzeTaskmarket,
  parseTaskmarketPage,
  reconcileTaskmarketTracked,
  taskmarketAwardSettlementHashes,
  TASKMARKET_API,
  TASKMARKET_TRACKED_SUBMISSIONS,
  TASKMARKET_WORKER_ADDRESS,
  type TaskmarketTask,
  type TaskmarketSettlementReceiptPayload,
  type TaskmarketTrackedSpecification,
  type TaskmarketTrackedPayload,
} from "../src/taskmarket-demand.ts";

const MOLTJOBS_API = "https://api.moltjobs.io/v1/jobs";
const OPENJOBS_API = "https://openjobs.bot/api/v1/jobs";
const BASE_MAINNET_RPC = "https://mainnet.base.org";
const stateFile = process.env.DEMAND_WATCH_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/demand-watch.json`;
const timeoutMs = 20_000;
const maximumResponseBytes = 2_000_000;

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function publicJson(url: URL, market: string): Promise<unknown> {
  const response = await fetch(url, {
    redirect: "error",
    headers: { "User-Agent": "bountyverdict-read-only-demand-watch/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${market} returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${market} returned a non-JSON response.`);
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
    throw new Error(`${market} response exceeded the byte cap.`);
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumResponseBytes) {
    throw new Error(`${market} response exceeded the byte cap.`);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${market} returned malformed JSON.`);
  }
}

async function baseSettlementReceipt(transactionHash: string): Promise<TaskmarketSettlementReceiptPayload> {
  try {
    const response = await fetch(BASE_MAINNET_RPC, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "bountyverdict-read-only-demand-watch/1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [transactionHash],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { transaction_hash: transactionHash, receipt: null, unavailable_reason: "rpc_unavailable" };
    const contentType = response.headers.get("content-type") || "";
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (!contentType.toLowerCase().includes("application/json") ||
      (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes)) {
      return { transaction_hash: transactionHash, receipt: null, unavailable_reason: "rpc_unavailable" };
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).length > maximumResponseBytes) {
      return { transaction_hash: transactionHash, receipt: null, unavailable_reason: "rpc_unavailable" };
    }
    const payload = JSON.parse(body) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      (payload as Record<string, unknown>).jsonrpc !== "2.0" || (payload as Record<string, unknown>).id !== 1 ||
      !("result" in payload) || (payload as Record<string, unknown>).result === undefined) {
      return { transaction_hash: transactionHash, receipt: null, unavailable_reason: "rpc_unavailable" };
    }
    const receipt = (payload as Record<string, unknown>).result;
    return receipt === null
      ? { transaction_hash: transactionHash, receipt: null, unavailable_reason: "receipt_not_yet_available" }
      : { transaction_hash: transactionHash, receipt };
  } catch {
    return { transaction_hash: transactionHash, receipt: null, unavailable_reason: "rpc_unavailable" };
  }
}

async function fetchMoltJobs(funded: boolean): Promise<MoltJob[]> {
  const jobs: MoltJob[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const url = new URL(MOLTJOBS_API);
    url.searchParams.set("status", "OPEN");
    url.searchParams.set("limit", "100");
    if (funded) url.searchParams.set("funded", "true");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = parseMoltJobsPage(await publicJson(url, "MoltJobs"));
    jobs.push(...page.data);
    if (!page.next_cursor) return jobs;
    if (seenCursors.has(page.next_cursor)) throw new Error("MoltJobs repeated a pagination cursor.");
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;
  }
  throw new Error("MoltJobs pagination exceeded the bounded five-page audit.");
}

async function fetchTaskmarketOpen(): Promise<TaskmarketTask[]> {
  const tasks: TaskmarketTask[] = [];
  const taskIds = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const url = new URL("/api/tasks", TASKMARKET_API);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = parseTaskmarketPage(await publicJson(url, "Taskmarket"));
    for (const task of page.tasks) {
      const normalized = task.id.toLowerCase();
      if (taskIds.has(normalized)) throw new Error("Taskmarket repeated a task across pages.");
      taskIds.add(normalized);
      tasks.push(task);
    }
    if (!page.has_more) return tasks;
    if (!page.next_cursor || cursors.has(page.next_cursor)) throw new Error("Taskmarket repeated or omitted a pagination cursor.");
    cursors.add(page.next_cursor);
    cursor = page.next_cursor;
  }
  throw new Error("Taskmarket pagination exceeded the bounded five-page audit.");
}

async function fetchTaskmarketTracked(): Promise<{ payloads: TaskmarketTrackedPayload[]; stats: unknown }> {
  const [payloads, stats] = await Promise.all([
    Promise.all(TASKMARKET_TRACKED_SUBMISSIONS.map(async (tracked: TaskmarketTrackedSpecification): Promise<TaskmarketTrackedPayload> => {
      const { task_id, public_proof: publicProof } = tracked;
      const encodedTaskId = encodeURIComponent(task_id);
      const [detail, submissions, publicProofNotes] = await Promise.all([
        publicJson(new URL(`/api/tasks/${encodedTaskId}`, TASKMARKET_API), "Taskmarket task detail"),
        publicJson(new URL(`/api/tasks/${encodedTaskId}/submissions`, TASKMARKET_API), "Taskmarket submissions"),
        publicProof
          ? publicJson(
              new URL(`/tasks/${encodedTaskId}/notes?limit=200`, publicProof.service_origin),
              "Taskmarket supporting public-proof notes",
            )
          : Promise.resolve(undefined),
      ]);
      const settlementReceipts = await Promise.all(
        taskmarketAwardSettlementHashes(detail).map(baseSettlementReceipt),
      );
      return {
        task_id,
        detail,
        submissions,
        public_proof_notes: publicProofNotes,
        settlement_receipts: settlementReceipts,
      };
    })),
    publicJson(new URL(`/api/agents/stats?address=${encodeURIComponent(TASKMARKET_WORKER_ADDRESS)}`, TASKMARKET_API), "Taskmarket worker stats"),
  ]);
  return { payloads, stats };
}

const checkedAtMs = Date.now();
const checkedAt = new Date(checkedAtMs).toISOString();
const [moltOpen, moltFunded, openJobsPayload, taskmarketOpen, taskmarketTracked] = await Promise.all([
  fetchMoltJobs(false),
  fetchMoltJobs(true),
  publicJson(new URL(`${OPENJOBS_API}?status=open&limit=100`), "OpenJobs"),
  fetchTaskmarketOpen(),
  fetchTaskmarketTracked(),
]);
const openJobs = parseOpenJobs(openJobsPayload);
if (openJobs.length === 100) {
  throw new Error("OpenJobs reached its public cap while exposing no usable pagination; inventory is incomplete.");
}
const state = {
  schema_version: 2,
  checked_at: checkedAt,
  read_only: true,
  actions_enabled: false,
  errors: 0,
  sources: {
    moltjobs: analyzeMoltJobs({ open_jobs: moltOpen, funded_jobs: moltFunded }),
    openjobs: analyzeOpenJobs(openJobs),
    taskmarket: {
      ...analyzeTaskmarket(taskmarketOpen, checkedAtMs),
      tracked_worker: reconcileTaskmarketTracked({
        worker_address: TASKMARKET_WORKER_ADDRESS,
        tracked: TASKMARKET_TRACKED_SUBMISSIONS,
        payloads: taskmarketTracked.payloads,
        agent_stats: taskmarketTracked.stats,
        now_ms: checkedAtMs,
      }),
    },
    excluded: {
      lobster_jobs: "excluded: official documentation requires bearer authentication and its unauthenticated surface exposed sensitive-looking auth metadata",
    },
  },
  accounting_note: "Public demand inventory and exact-match candidates are acquisition evidence only. A tracked Taskmarket submission becomes one purchase and positive worker-payment revenue only after its completed task exposes a canonical award and a live successful Base receipt binds it to the canonical Taskmarket Diamond TaskCompleted event, exact task, onchain non-owner requester, worker payment, platform fee, and a unique exact Base-USDC payout transfer from the Diamond to the worker.",
};
await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(state, null, 2));
