import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import {
  analyzeMoltJobs,
  analyzeOpenJobs,
  moltJobsOpportunityDetailIds,
  parseMoltJobPublicSummary,
  parseMoltJobsPage,
  parseOpenJobs,
  type MoltJob,
} from "../src/demand-watch.ts";
import {
  demandWatchSourceStatus,
  resolveDemandWatchSource,
  shouldRefreshTaskmarketTracked,
  TASKMARKET_TRACKED_REFRESH_INTERVAL_MS,
  type DemandWatchSourceKey,
  type DemandWatchSourceStatus,
} from "../src/demand-watch-state.ts";
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
import {
  OPPORTUNITY_MARKER_VERSION,
  parseOpportunityTrigger,
} from "../src/opportunity-agent-workflow.ts";
import { coordinateOpportunityTrigger } from "../src/opportunity-trigger-coordination.ts";

const MOLTJOBS_API = "https://api.moltjobs.io/v1/jobs";
const OPENJOBS_API = "https://openjobs.bot/api/v1/jobs";
const BASE_MAINNET_RPC = "https://mainnet.base.org";
const stateFile = process.env.DEMAND_WATCH_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/demand-watch.json`;
const opportunityTriggerFile = process.env.BOUNTY_OPPORTUNITY_TRIGGER_FILE ||
  `${homedir()}/.local/state/bountyverdict/opportunity-trigger.json`;
const timeoutMs = 20_000;
const maximumResponseBytes = 2_000_000;
const maximumOpportunityTriggerBytes = 256 * 1024;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type JsonRecord = Record<string, any>;

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function readPreviousState(): Promise<JsonRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Previous demand-watch state is malformed.");
    }
    const state = parsed as JsonRecord;
    if (state.schema_version !== 2 || state.read_only !== true || state.actions_enabled !== false ||
      !state.sources || typeof state.sources !== "object" || Array.isArray(state.sources)) {
      throw new Error("Previous demand-watch state is incompatible.");
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function pendingOpportunityTriggerId(): Promise<string | null> {
  try {
    const metadata = await lstat(opportunityTriggerFile);
    const expectedUid = process.getuid?.() ?? -1;
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== expectedUid ||
      (metadata.mode & 0o777) !== 0o600 || metadata.size < 2 ||
      metadata.size > maximumOpportunityTriggerBytes) {
      throw new Error("Pending opportunity trigger must be a bounded private owner-owned file.");
    }
    return parseOpportunityTrigger(JSON.parse(await readFile(opportunityTriggerFile, "utf8")) as unknown).trigger_id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function previousSourceValue(previous: JsonRecord | null, key: DemandWatchSourceKey): unknown {
  if (!previous) return undefined;
  if (key === "taskmarket_inventory") {
    const taskmarket = previous.sources?.taskmarket;
    if (!taskmarket || typeof taskmarket !== "object" || Array.isArray(taskmarket)) return undefined;
    const { tracked_worker: _tracked, tracked_refresh: _refresh, ...inventory } = taskmarket;
    return inventory;
  }
  if (key === "taskmarket_tracked") return previous.sources?.taskmarket?.tracked_worker;
  return previous.sources?.[key];
}

function resolveSource<T>({
  key,
  label,
  result,
  previous,
  checkedAt,
  statuses,
}: {
  key: DemandWatchSourceKey;
  label: string;
  result: PromiseSettledResult<T>;
  previous: JsonRecord | null;
  checkedAt: string;
  statuses: Record<DemandWatchSourceKey, DemandWatchSourceStatus>;
}): T {
  const resolved = resolveDemandWatchSource({
    attemptedAt: checkedAt,
    label,
    result,
    previousValue: previousSourceValue(previous, key) as T | undefined,
    previousStatus: demandWatchSourceStatus(previous, key),
  });
  statuses[key] = resolved.status;
  return resolved.value;
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

function moltJobsOwnerPosterIds(): string[] | null {
  const raw = process.env.BOUNTY_MOLTJOBS_OWNER_POSTER_IDS;
  if (raw === undefined) return null;
  if (raw === "none") return [];
  const ids = raw.split(",");
  if (ids.length === 0 || ids.length > 20 || ids.some((id) => !uuidPattern.test(id))) {
    throw new Error("MoltJobs owner poster identity scope is invalid.");
  }
  const normalized = ids.map((id) => id.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("MoltJobs owner poster identity scope is duplicated.");
  }
  return normalized;
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
const previous = await readPreviousState();
const trackedDecision = shouldRefreshTaskmarketTracked(previous, checkedAtMs);
const moltOwnerPosterIds = moltJobsOwnerPosterIds();
const [moltResult, openJobsResult, taskmarketInventoryResult, taskmarketTrackedResult] = await Promise.allSettled([
  Promise.all([fetchMoltJobs(false), fetchMoltJobs(true)])
    .then(async ([openJobs, fundedJobs]) => {
      const detailIds = moltOwnerPosterIds === null
        ? []
        : moltJobsOpportunityDetailIds(fundedJobs, checkedAtMs);
      const preliminaryJobs = detailIds.map((id) => {
        const job = fundedJobs.find((candidate) => candidate.id === id);
        if (!job?.escrowTxHash) throw new Error("MoltJobs preliminary opportunity lost its escrow transaction.");
        return job;
      });
      const [publicOpportunitySummaries, fundingReceipts] = await Promise.all([
        Promise.all(detailIds.map(async (id) =>
          parseMoltJobPublicSummary(await publicJson(
            new URL(`/v1/public/jobs/${encodeURIComponent(id)}`, "https://api.moltjobs.io"),
            "MoltJobs public opportunity summary",
          ))
        )),
        Promise.all(preliminaryJobs.map((job) => baseSettlementReceipt(job.escrowTxHash!))),
      ]);
      return analyzeMoltJobs({
        open_jobs: openJobs,
        funded_jobs: fundedJobs,
        public_opportunity_summaries: publicOpportunitySummaries,
        funding_receipts: fundingReceipts,
        excluded_owner_poster_ids: moltOwnerPosterIds || [],
        opportunity_triggers_enabled: moltOwnerPosterIds !== null,
        now_ms: checkedAtMs,
      });
    }),
  publicJson(new URL(`${OPENJOBS_API}?status=open&limit=100`), "OpenJobs")
    .then((payload) => {
      const openJobs = parseOpenJobs(payload);
      if (openJobs.length === 100) {
        throw new Error("OpenJobs reached its public cap while exposing no usable pagination; inventory is incomplete.");
      }
      return analyzeOpenJobs(openJobs, checkedAtMs);
    }),
  fetchTaskmarketOpen().then((tasks) => analyzeTaskmarket(tasks, checkedAtMs)),
  trackedDecision.due
    ? fetchTaskmarketTracked().then((tracked) => reconcileTaskmarketTracked({
        worker_address: TASKMARKET_WORKER_ADDRESS,
        tracked: TASKMARKET_TRACKED_SUBMISSIONS,
        payloads: tracked.payloads,
        agent_stats: tracked.stats,
        now_ms: checkedAtMs,
      }))
    : Promise.resolve(previousSourceValue(previous, "taskmarket_tracked")),
]);

const statuses = {} as Record<DemandWatchSourceKey, DemandWatchSourceStatus>;
const moltjobs = resolveSource({
  key: "moltjobs",
  label: "MoltJobs",
  result: moltResult,
  previous,
  checkedAt,
  statuses,
});
const openjobs = resolveSource({
  key: "openjobs",
  label: "OpenJobs",
  result: openJobsResult,
  previous,
  checkedAt,
  statuses,
});
const taskmarketInventory = resolveSource({
  key: "taskmarket_inventory",
  label: "Taskmarket inventory",
  result: taskmarketInventoryResult,
  previous,
  checkedAt,
  statuses,
});
let taskmarketTracked: unknown;
if (trackedDecision.due) {
  taskmarketTracked = resolveSource({
    key: "taskmarket_tracked",
    label: "Taskmarket tracked reconciliation",
    result: taskmarketTrackedResult,
    previous,
    checkedAt,
    statuses,
  });
} else {
  taskmarketTracked = previousSourceValue(previous, "taskmarket_tracked");
  const previousStatus = demandWatchSourceStatus(previous, "taskmarket_tracked");
  if (taskmarketTracked === undefined || previousStatus === null) {
    throw new Error("Taskmarket tracked reconciliation was skipped without a last-good snapshot.");
  }
  statuses.taskmarket_tracked = previousStatus;
}
const degradedSources = Object.values(statuses).filter(({ error }) => error !== null).length;
const trackedRefreshed = trackedDecision.due &&
  statuses.taskmarket_tracked.error === null &&
  statuses.taskmarket_tracked.last_good_at === checkedAt;
const previousRememberedOpportunityFingerprints = previous?.opportunity_event_loop &&
  typeof previous.opportunity_event_loop === "object" &&
  !Array.isArray(previous.opportunity_event_loop)
  ? (previous.opportunity_event_loop as JsonRecord).triggered_opportunity_fingerprints ??
    (previous.opportunity_event_loop as JsonRecord).triggered_task_ids
  : undefined;
const taskmarketInventoryFresh = statuses.taskmarket_inventory.error === null &&
  statuses.taskmarket_inventory.last_good_at === checkedAt;
const moltJobsInventoryFresh = statuses.moltjobs.error === null &&
  statuses.moltjobs.last_good_at === checkedAt;
const pendingTriggerId = await pendingOpportunityTriggerId();
const eligibleOpportunityCandidates = [
  ...(taskmarketInventoryFresh
    ? (taskmarketInventory as JsonRecord).fresh_low_competition_candidates
    : []),
  ...(moltJobsInventoryFresh
    ? (moltjobs as JsonRecord).fresh_low_competition_candidates
    : []),
].sort((left, right) => {
  const scoreDifference = Number(right.opportunity_score_usdc_per_current_entry) -
    Number(left.opportunity_score_usdc_per_current_entry);
  if (scoreDifference !== 0) return scoreDifference;
  const rewardDifference = Number(right.net_reward_usdc) - Number(left.net_reward_usdc);
  if (rewardDifference !== 0) return rewardDifference;
  return String(left.created_at).localeCompare(String(right.created_at));
});
const opportunityEvent = await coordinateOpportunityTrigger({
  candidates: eligibleOpportunityCandidates,
  rememberedOpportunityFingerprints: previousRememberedOpportunityFingerprints,
  checkedAt,
  pendingTriggerId,
  writeTrigger: async (trigger) => {
    await atomicWrite(opportunityTriggerFile, `${JSON.stringify(trigger, null, 2)}\n`);
  },
});
const state = {
  schema_version: 2,
  checked_at: checkedAt,
  read_only: true,
  actions_enabled: false,
  errors: degradedSources,
  degraded_sources: degradedSources,
  source_status: statuses,
  opportunity_event_loop: {
    marker_version: OPPORTUNITY_MARKER_VERSION,
    inventory_fresh: taskmarketInventoryFresh && moltJobsInventoryFresh,
    inventory_fresh_by_market: {
      taskmarket: taskmarketInventoryFresh,
      moltjobs: moltJobsInventoryFresh,
      openjobs: statuses.openjobs.error === null && statuses.openjobs.last_good_at === checkedAt,
    },
    observed_candidates: {
      taskmarket: (taskmarketInventory as JsonRecord).fresh_low_competition_candidate_count,
      moltjobs: (moltjobs as JsonRecord).fresh_low_competition_candidate_count,
      openjobs: 0,
    },
    eligible_candidates: eligibleOpportunityCandidates.length,
    emitted_new_trigger: opportunityEvent.trigger !== null,
    trigger_id: opportunityEvent.trigger?.trigger_id || null,
    pending_trigger_id: pendingTriggerId,
    suppressed_reason: !taskmarketInventoryFresh && !moltJobsInventoryFresh
      ? "eligible_market_inventories_not_fresh"
      : pendingTriggerId
        ? "pending_opportunity_workflow"
        : null,
    triggered_opportunity_fingerprints: opportunityEvent.remembered_opportunity_fingerprints,
    trigger_contract_file: opportunityTriggerFile,
    workflow_scope: "agent_fit_review_and_local_solution_only",
    external_actions_enabled: false,
  },
  sources: {
    moltjobs,
    openjobs,
    taskmarket: {
      ...(taskmarketInventory as JsonRecord),
      tracked_worker: taskmarketTracked,
      tracked_refresh: {
        attempted: trackedDecision.due,
        refreshed: trackedRefreshed,
        reason: trackedDecision.reason,
        interval_seconds: TASKMARKET_TRACKED_REFRESH_INTERVAL_MS / 1_000,
        last_good_at: statuses.taskmarket_tracked.last_good_at,
      },
    },
    excluded: {
      lobster_jobs: "excluded: official documentation requires bearer authentication and its unauthenticated surface exposed sensitive-looking auth metadata",
    },
  },
  accounting_note: "Public demand inventory and exact-match candidates are acquisition evidence only. A tracked Taskmarket submission becomes one purchase and positive worker-payment revenue only after its completed task exposes a canonical award and a live successful Base receipt binds it to the canonical Taskmarket Diamond TaskCompleted event, exact task, onchain non-owner requester, worker payment, platform fee, and a unique exact Base-USDC payout transfer from the Diamond to the worker.",
};
await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify({
  checked_at: checkedAt,
  healthy: degradedSources === 0,
  degraded_sources: degradedSources,
  source_errors: Object.fromEntries(
    Object.entries(statuses)
      .filter(([, status]) => status.error !== null)
      .map(([source, status]) => [source, status.error]),
  ),
  exact_candidates: {
    moltjobs: (moltjobs as JsonRecord).exact_candidate_count,
    openjobs: (openjobs as JsonRecord).exact_candidate_count,
    taskmarket: (taskmarketInventory as JsonRecord).exact_candidate_count,
  },
  opportunity_event_loop: {
    inventory_fresh_by_market: {
      taskmarket: taskmarketInventoryFresh,
      moltjobs: moltJobsInventoryFresh,
    },
    eligible_candidates: eligibleOpportunityCandidates.length,
    emitted_new_trigger: opportunityEvent.trigger !== null,
    trigger_id: opportunityEvent.trigger?.trigger_id || null,
  },
  taskmarket_tracked: {
    attempted: trackedDecision.due,
    refreshed: trackedRefreshed,
    reason: trackedDecision.reason,
    last_good_at: statuses.taskmarket_tracked.last_good_at,
    pending_submissions: (taskmarketTracked as JsonRecord).pending_submissions,
    settled_submissions: (taskmarketTracked as JsonRecord).settled_submissions,
    settled_worker_earnings_usdc: (taskmarketTracked as JsonRecord).settled_worker_earnings_usdc,
  },
}));
