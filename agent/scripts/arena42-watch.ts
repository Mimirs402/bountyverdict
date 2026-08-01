import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  analyzeArena42,
  ARENA42_API,
  ARENA42_DEPOSIT_TOPIC,
  arena42OpportunityCompetitionIds,
  parseArena42Competitions,
  type Arena42Competition,
  type Arena42DepositEvidence,
} from "../src/arena42-demand.ts";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import {
  OPPORTUNITY_MARKER_VERSION,
  parseOpportunityTrigger,
  parseRememberedOpportunityFingerprints,
  type EscrowOpportunityCandidate,
} from "../src/opportunity-agent-workflow.ts";
import { coordinateOpportunityTrigger } from "../src/opportunity-trigger-coordination.ts";

const BASE_MAINNET_RPC = "https://mainnet.base.org";
const BASE_BLOCKSCOUT = "https://base.blockscout.com";
const stateRoot = resolve(process.env.BOUNTYVERDICT_STATE_ROOT || `${homedir()}/.local/state/bountyverdict`);
const statePath = `${stateRoot}/arena42-watch.json`;
const triggerPath = `${stateRoot}/opportunity-trigger.json`;
const producerLockPath = `${stateRoot}/opportunity-trigger-producer.lock`;
const userAgent = "MimirsLab-Arena42OpportunityMonitor/1.0 (admin@mimirslab.com; bounded read-only audit)";
const maximumResponseBytes = 4_000_000;

type JsonRecord = Record<string, unknown>;

async function publicJson(url: URL, label: string): Promise<unknown> {
  const response = await fetch(url, {
    redirect: "error",
    headers: { Accept: "application/json", "User-Agent": userAgent, "X-Arena-Skill-Version": "1.25.0" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumResponseBytes) throw new Error(`${label} exceeded the byte cap.`);
  if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  return JSON.parse(body) as unknown;
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function readBoundedJson(path: string, maximum: number): Promise<JsonRecord | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximum) {
      throw new Error(`${path} is not a bounded regular file.`);
    }
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} is malformed.`);
    return value as JsonRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fetchEscrowLogs(contract: string): Promise<unknown[]> {
  const items: unknown[] = [];
  const cursors = new Set<string>();
  let nextPage: JsonRecord | null = null;
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`/api/v2/addresses/${contract}/logs`, BASE_BLOCKSCOUT);
    for (const [key, value] of Object.entries(nextPage || {})) {
      if (typeof value !== "string" && typeof value !== "number") throw new Error("Arena42 log cursor is malformed.");
      url.searchParams.set(key, String(value));
    }
    const payload = await publicJson(url, "Arena42 Blockscout logs") as JsonRecord;
    if (!Array.isArray(payload.items)) throw new Error("Arena42 Blockscout logs are malformed.");
    items.push(...payload.items);
    if (payload.next_page_params === null || payload.next_page_params === undefined) return items;
    if (!payload.next_page_params || typeof payload.next_page_params !== "object" ||
      Array.isArray(payload.next_page_params)) throw new Error("Arena42 log cursor is malformed.");
    const fingerprint = JSON.stringify(payload.next_page_params);
    if (cursors.has(fingerprint)) throw new Error("Arena42 repeated a log cursor.");
    cursors.add(fingerprint);
    nextPage = payload.next_page_params as JsonRecord;
  }
  throw new Error("Arena42 Blockscout pagination exceeded five pages.");
}

async function receipt(transactionHash: string): Promise<unknown> {
  const response = await fetch(BASE_MAINNET_RPC, {
    method: "POST",
    redirect: "error",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": userAgent },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [transactionHash] }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumResponseBytes || !response.ok ||
    !(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error("Arena42 deposit receipt is unavailable.");
  }
  const payload = JSON.parse(body) as JsonRecord;
  if (payload.jsonrpc !== "2.0" || payload.id !== 1 || !payload.result) {
    throw new Error("Arena42 deposit receipt is unavailable.");
  }
  return payload.result;
}

async function depositEvidence(competitions: readonly Arena42Competition[]): Promise<Arena42DepositEvidence[]> {
  const logsByContract = new Map<string, unknown[]>();
  for (const contract of new Set(competitions.map(({ escrowContract }) => escrowContract))) {
    logsByContract.set(contract, await fetchEscrowLogs(contract));
  }
  return Promise.all(competitions.map(async (competition) => {
    const logs = logsByContract.get(competition.escrowContract);
    if (!logs) throw new Error("Arena42 escrow logs are unavailable.");
    const matches = logs.filter((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const log = value as JsonRecord;
      return Array.isArray(log.topics) && log.topics[0]?.toString().toLowerCase() === ARENA42_DEPOSIT_TOPIC &&
        log.topics[1]?.toString().toLowerCase() === competition.campaignId &&
        typeof log.transaction_hash === "string";
    }) as JsonRecord[];
    if (matches.length !== 1) throw new Error("Arena42 campaign deposit is missing or ambiguous.");
    const depositTransactionHash = String(matches[0].transaction_hash).toLowerCase();
    return {
      competition_id: competition.id,
      campaign_id: competition.campaignId,
      escrow_contract: competition.escrowContract,
      deposit_transaction_hash: depositTransactionHash,
      receipt: await receipt(depositTransactionHash),
    };
  }));
}

const checkedAt = new Date().toISOString();
const checkedAtMs = Date.parse(checkedAt);
const previous = await readBoundedJson(statePath, 4_000_000);
if (previous && previous.schema_version !== 1) throw new Error("Arena42 watch state is incompatible.");
const url = new URL("/api/competitions", ARENA42_API);
url.searchParams.set("joinable", "true");
url.searchParams.set("limit", "100");
const competitions = parseArena42Competitions(await publicJson(url, "Arena42 competition feed"));
const opportunityIds = new Set(arena42OpportunityCompetitionIds(competitions, checkedAtMs));
const opportunityCompetitions = competitions.filter(({ id }) => opportunityIds.has(id));
const analysis = analyzeArena42({
  competitions,
  deposit_evidence: await depositEvidence(opportunityCompetitions),
  now_ms: checkedAtMs,
});
const candidates = analysis.fresh_low_competition_candidates as EscrowOpportunityCandidate[];
const priorRemembered = parseRememberedOpportunityFingerprints(previous?.triggered_opportunity_fingerprints);
const releaseLock = await acquireExclusiveRun(producerLockPath, { staleAfterMs: 10 * 60 * 1_000 });
let pendingTriggerId: string | null = null;
let opportunityEvent: Awaited<ReturnType<typeof coordinateOpportunityTrigger>>;
try {
  const pending = await readBoundedJson(triggerPath, 256_000);
  pendingTriggerId = pending ? parseOpportunityTrigger(pending).trigger_id : null;
  opportunityEvent = await coordinateOpportunityTrigger({
    candidates,
    rememberedOpportunityFingerprints: priorRemembered,
    checkedAt,
    pendingTriggerId,
    writeTrigger: async (trigger) => atomicWrite(triggerPath, trigger),
  });
} finally {
  await releaseLock();
}

const state = {
  schema_version: 1,
  checked_at: checkedAt,
  source: "Arena42 bounded public competition API plus Base escrow evidence",
  collection_url: url.toString(),
  read_only: true,
  external_actions_enabled: false,
  polling_cadence: "hourly",
  live_real_reward_competitions: analysis.live_real_reward_competitions,
  gross_live_usdc: analysis.gross_live_usdc,
  chain_verified_competitions: analysis.chain_verified_competitions,
  admitted_candidate_count: candidates.length,
  candidates,
  marker_version: OPPORTUNITY_MARKER_VERSION,
  emitted_new_trigger: opportunityEvent.trigger !== null,
  trigger_id: opportunityEvent.trigger?.trigger_id || null,
  pending_trigger_id: pendingTriggerId,
  triggered_opportunity_fingerprints: opportunityEvent.remembered_opportunity_fingerprints,
};
await atomicWrite(statePath, state);
console.log(JSON.stringify({
  checked_at: checkedAt,
  live_real_reward_competitions: state.live_real_reward_competitions,
  gross_live_usdc: state.gross_live_usdc,
  chain_verified_competitions: state.chain_verified_competitions,
  admitted_candidate_count: state.admitted_candidate_count,
  emitted_new_trigger: state.emitted_new_trigger,
}, null, 2));
