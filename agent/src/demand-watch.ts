import { createHash } from "node:crypto";
import { parseAndAnalyzeMcpDrift } from "./mcp-drift.ts";
import { PRODUCT_CATALOG } from "./product-catalog.ts";
import {
  selectExactPublicDemand,
  stableDemandInput,
  type ExactDemandDecision,
} from "./exact-demand.ts";
import type { The402Product } from "./the402.ts";

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const txPattern = /^0x[a-f0-9]{64}$/i;
const addressPattern = /^0x[a-f0-9]{40}$/i;
const moneyPattern = /^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,6})?$/;
const maximumRecords = 200;
const maximumTextBytes = 20_000;
const freshOpportunityMaximumAgeMs = 12 * 60 * 60 * 1_000;
const freshOpportunityMinimumRemainingMs = 2 * 60 * 60 * 1_000;
const freshOpportunityMaximumCompetition = 3;
const freshOpportunityMinimumNetAtomic = 5_000_000n;
const moltJobsConservativeWorkerShareNumerator = 95n;
const moltJobsConservativeWorkerShareDenominator = 100n;
const baseUsdcAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const moltJobsEscrowAddress = "0xa845fba3f4428d4abf76df453f4b57e391328f71";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const moltJobsEscrowFundedTopic =
  "0x2dcdaad87b561ba5a69835009b4c53ef9d3c41ca6cc9574049187659d6c6a715";

export type DemandCandidate = {
  market: "moltjobs" | "openjobs" | "taskmarket";
  job_id: string;
  title: string;
  product: The402Product;
  input_sha256: string;
  price_cents: number;
  budget_usdc: string;
  created_at: string;
  deadline_at: string | null;
};

export type MoltJob = {
  id: string;
  posterId: string;
  agentId: string | null;
  status: "OPEN";
  templateId: string;
  title: string;
  budgetUsdc: string;
  inputData: Record<string, unknown>;
  acceptanceCriteria: unknown;
  deadlineAt: string;
  createdAt: string;
  updatedAt: string;
  paymentProvider: "ON_CHAIN_USDC";
  paymentStatus: string | null;
  escrowTxHash: string | null;
  escrowJobId: Record<string, number> | null;
  isPubliclyShareable: boolean;
};

export type MoltJobsPage = { data: MoltJob[]; next_cursor: string | null };

export type MoltJobPublicSummary = {
  id: string;
  title: string;
  status: "OPEN";
  budgetUsdc: string;
  deadlineAt: string;
  createdAt: string;
  assignedAgentId: string | null;
  bidCount: number;
  escrowFunded: boolean;
};

export type MoltJobFundingReceiptPayload = {
  transaction_hash: string;
  receipt: unknown | null;
  unavailable_reason?: string;
};

export type OpenJob = {
  id: string;
  title: string;
  description: string;
  reward: string;
  currency: string;
  status: "open";
  jobType: "paid" | "free" | "negotiable";
  posterId: string;
  workerId: string | null;
  acceptMode: string | null;
  complexityBand: string;
  createdAt: string;
  submittedAt: string | null;
  isTest: boolean;
  isSandbox: boolean;
  isOnboarding: boolean;
  riskFlagged: boolean;
  escrowFrozen: boolean;
  disputeStatus: string | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nullableString(value: unknown, label: string, maximum = 500): string | null {
  if (value === null) return null;
  return requiredString(value, label, maximum);
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredString(value, label, 64);
  if (!uuidPattern.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, label, 80);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} is invalid.`);
  return parsed;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}

function decimalAtomic(value: unknown, label: string): bigint {
  const parsed = requiredString(value, label, 32);
  if (!moneyPattern.test(parsed)) throw new Error(`${label} is invalid.`);
  const [whole, fraction = ""] = parsed.split(".");
  const atomic = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if (atomic <= 0n || atomic > 100_000_000_000_000n) throw new Error(`${label} is outside bounds.`);
  return atomic;
}

function atomicToDecimal(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const fraction = String(atomic % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function atomicToBudgetCents(atomic: bigint): number {
  const cents = Number(atomic / 10_000n);
  if (!Number.isSafeInteger(cents) || cents < 1) return 0;
  return cents;
}

function parseEscrowJobId(value: unknown): Record<string, number> | null {
  if (value === null) return null;
  if (!isObject(value) || Object.keys(value).length !== 32) throw new Error("MoltJobs escrow job ID is invalid.");
  const result: Record<string, number> = {};
  for (let index = 0; index < 32; index += 1) {
    const byte = value[String(index)];
    if (!Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255) {
      throw new Error("MoltJobs escrow job ID is invalid.");
    }
    result[String(index)] = Number(byte);
  }
  return result;
}

function boundedObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${label} is invalid.`);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > maximumTextBytes) throw new Error(`${label} is too large.`);
  return value;
}

function parseMoltJob(value: unknown): MoltJob {
  if (!isObject(value)) throw new Error("MoltJobs job is malformed.");
  if (value.status !== "OPEN" || value.paymentProvider !== "ON_CHAIN_USDC") {
    throw new Error("MoltJobs open feed contains an unsupported status or payment provider.");
  }
  const escrowTxHash = nullableString(value.escrowTxHash, "MoltJobs escrow transaction", 66);
  if (escrowTxHash !== null && !txPattern.test(escrowTxHash)) throw new Error("MoltJobs escrow transaction is invalid.");
  const escrowJobId = parseEscrowJobId(value.escrowJobId);
  if ((escrowTxHash === null) !== (escrowJobId === null)) throw new Error("MoltJobs escrow evidence disagrees.");
  const paymentStatus = value.paymentStatus === null
    ? null
    : requiredString(value.paymentStatus, "MoltJobs payment status", 80);
  return {
    id: uuid(value.id, "MoltJobs job ID"),
    posterId: uuid(value.posterId, "MoltJobs poster ID"),
    agentId: value.agentId === null ? null : uuid(value.agentId, "MoltJobs agent ID"),
    status: "OPEN",
    templateId: requiredString(value.templateId, "MoltJobs template ID", 100),
    title: requiredString(value.title, "MoltJobs title", 500),
    budgetUsdc: atomicToDecimal(decimalAtomic(value.budgetUsdc, "MoltJobs budget")),
    inputData: boundedObject(value.inputData, "MoltJobs input data"),
    acceptanceCriteria: value.acceptanceCriteria,
    deadlineAt: timestamp(value.deadlineAt, "MoltJobs deadline"),
    createdAt: timestamp(value.createdAt, "MoltJobs creation time"),
    updatedAt: timestamp(value.updatedAt, "MoltJobs update time"),
    paymentProvider: "ON_CHAIN_USDC",
    paymentStatus,
    escrowTxHash,
    escrowJobId,
    isPubliclyShareable: booleanValue(value.isPubliclyShareable, "MoltJobs sharing flag"),
  };
}

export function parseMoltJobsPage(value: unknown): MoltJobsPage {
  if (!isObject(value) || !Array.isArray(value.data) || value.data.length > 100 || !isObject(value.meta)) {
    throw new Error("MoltJobs page is malformed.");
  }
  const cursor = value.meta.nextCursor;
  if (cursor !== null && (typeof cursor !== "string" || !cursor || cursor.length > 1_000)) {
    throw new Error("MoltJobs cursor is invalid.");
  }
  const data = value.data.map(parseMoltJob);
  const ids = new Set(data.map(({ id }) => id));
  if (ids.size !== data.length) throw new Error("MoltJobs page duplicated a job.");
  return { data, next_cursor: cursor };
}

export function parseMoltJobPublicSummary(value: unknown): MoltJobPublicSummary {
  if (!isObject(value) || !isObject(value.data)) throw new Error("MoltJobs public summary is malformed.");
  const summary = value.data;
  if (summary.status !== "OPEN") throw new Error("MoltJobs public summary is not open.");
  if (!Number.isSafeInteger(summary.bidCount) || Number(summary.bidCount) < 0 ||
    Number(summary.bidCount) > 10_000) {
    throw new Error("MoltJobs public bid count is invalid.");
  }
  const assignedAgent = summary.assignedAgent;
  let assignedAgentId: string | null = null;
  if (assignedAgent !== null) {
    if (!isObject(assignedAgent)) throw new Error("MoltJobs public assigned agent is malformed.");
    assignedAgentId = uuid(assignedAgent.id, "MoltJobs public assigned agent ID");
  }
  return {
    id: uuid(summary.id, "MoltJobs public job ID"),
    title: requiredString(summary.title, "MoltJobs public title", 500),
    status: "OPEN",
    budgetUsdc: atomicToDecimal(decimalAtomic(summary.budgetUsdc, "MoltJobs public budget")),
    deadlineAt: timestamp(summary.deadlineAt, "MoltJobs public deadline"),
    createdAt: timestamp(summary.createdAt, "MoltJobs public creation time"),
    assignedAgentId,
    bidCount: Number(summary.bidCount),
    escrowFunded: booleanValue(summary.escrowFunded, "MoltJobs public escrow flag"),
  };
}

export function moltJobsOpportunityDetailIds(
  fundedJobs: readonly MoltJob[],
  nowMs = Date.now(),
  maximum = 20,
): string[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 20) {
    throw new Error("MoltJobs public-detail cap is invalid.");
  }
  const preliminary = fundedJobs.filter((job) => {
    const createdMs = Date.parse(job.createdAt);
    const deadlineMs = Date.parse(job.deadlineAt);
    const conservativeNet = decimalAtomic(job.budgetUsdc, "MoltJobs budget") *
      moltJobsConservativeWorkerShareNumerator / moltJobsConservativeWorkerShareDenominator;
    return job.agentId === null &&
      job.isPubliclyShareable &&
      Boolean(job.escrowTxHash && job.escrowJobId) &&
      createdMs <= nowMs &&
      nowMs - createdMs <= freshOpportunityMaximumAgeMs &&
      deadlineMs - nowMs >= freshOpportunityMinimumRemainingMs &&
      conservativeNet >= freshOpportunityMinimumNetAtomic;
  });
  if (preliminary.length > maximum) {
    throw new Error("MoltJobs preliminary opportunity set exceeds the bounded public-detail cap.");
  }
  return preliminary.map(({ id }) => id);
}

function sameMoltSummary(job: MoltJob, summary: MoltJobPublicSummary): boolean {
  return job.id === summary.id &&
    job.title === summary.title &&
    job.status === summary.status &&
    job.budgetUsdc === summary.budgetUsdc &&
    job.deadlineAt === summary.deadlineAt &&
    job.createdAt === summary.createdAt &&
    job.agentId === summary.assignedAgentId;
}

function conservativeMoltNetAtomic(job: MoltJob): bigint {
  return decimalAtomic(job.budgetUsdc, "MoltJobs budget") *
    moltJobsConservativeWorkerShareNumerator / moltJobsConservativeWorkerShareDenominator;
}

function escrowJobIdHex(job: MoltJob): string {
  if (!job.escrowJobId) throw new Error("MoltJobs escrow job ID is missing.");
  return `0x${Array.from({ length: 32 }, (_, index) =>
    job.escrowJobId?.[String(index)].toString(16).padStart(2, "0")
  ).join("")}`;
}

function logAddressTopic(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function parseHexAtomic(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return BigInt(value);
}

export function verifyMoltJobsFundingReceipt(
  job: MoltJob,
  payload: MoltJobFundingReceiptPayload,
): boolean {
  if (!job.escrowTxHash || payload.transaction_hash.toLowerCase() !== job.escrowTxHash.toLowerCase() ||
    !isObject(payload.receipt)) {
    return false;
  }
  const receipt = payload.receipt;
  if (receipt.status !== "0x1" ||
    typeof receipt.transactionHash !== "string" ||
    receipt.transactionHash.toLowerCase() !== job.escrowTxHash.toLowerCase() ||
    typeof receipt.from !== "string" ||
    !addressPattern.test(receipt.from) ||
    typeof receipt.to !== "string" ||
    receipt.to.toLowerCase() !== moltJobsEscrowAddress ||
    !Array.isArray(receipt.logs) ||
    receipt.logs.length > 1_000) {
    return false;
  }
  const expectedBudget = decimalAtomic(job.budgetUsdc, "MoltJobs budget");
  const expectedJobId = escrowJobIdHex(job).toLowerCase();
  const transferLogs = receipt.logs.filter((raw): raw is Record<string, unknown> => {
    if (!isObject(raw) || typeof raw.address !== "string" || !Array.isArray(raw.topics)) return false;
    return raw.address.toLowerCase() === baseUsdcAddress &&
      raw.topics[0]?.toLowerCase?.() === transferTopic &&
      raw.topics[2]?.toLowerCase?.() === logAddressTopic(moltJobsEscrowAddress);
  });
  const escrowLogs = receipt.logs.filter((raw): raw is Record<string, unknown> => {
    if (!isObject(raw) || typeof raw.address !== "string" || !Array.isArray(raw.topics)) return false;
    return raw.address.toLowerCase() === moltJobsEscrowAddress &&
      raw.topics[0]?.toLowerCase?.() === moltJobsEscrowFundedTopic &&
      raw.topics[1]?.toLowerCase?.() === expectedJobId;
  });
  if (transferLogs.length !== 1 || escrowLogs.length !== 1) return false;
  const transfer = transferLogs[0];
  const escrow = escrowLogs[0];
  const transferTopics = transfer.topics as unknown[];
  const escrowTopics = escrow.topics as unknown[];
  if (typeof transferTopics[1] !== "string" || typeof escrowTopics[2] !== "string" ||
    transferTopics[1].toLowerCase() !== escrowTopics[2].toLowerCase() ||
    transferTopics[1].toLowerCase() !== logAddressTopic(receipt.from)) {
    return false;
  }
  let transferAmount: bigint;
  let workerAmount: bigint;
  let feeAmount: bigint;
  try {
    transferAmount = parseHexAtomic(transfer.data, "MoltJobs USDC transfer amount");
    if (typeof escrow.data !== "string" || !/^0x[a-f0-9]{128}$/i.test(escrow.data)) return false;
    workerAmount = BigInt(`0x${escrow.data.slice(2, 66)}`);
    feeAmount = BigInt(`0x${escrow.data.slice(66, 130)}`);
  } catch {
    return false;
  }
  return transferAmount === expectedBudget &&
    workerAmount > 0n &&
    feeAmount >= 0n &&
    workerAmount + feeAmount === expectedBudget;
}

function moltOpportunityCandidate(
  job: MoltJob,
  summary: MoltJobPublicSummary,
  receipt: MoltJobFundingReceiptPayload,
  nowMs: number,
  excludedOwnerPosterIds: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (!sameMoltSummary(job, summary)) throw new Error("MoltJobs public summary disagrees with the funded feed.");
  const createdMs = Date.parse(job.createdAt);
  const deadlineMs = Date.parse(job.deadlineAt);
  const netRewardAtomic = conservativeMoltNetAtomic(job);
  if (!summary.escrowFunded ||
    !verifyMoltJobsFundingReceipt(job, receipt) ||
    summary.bidCount > freshOpportunityMaximumCompetition ||
    excludedOwnerPosterIds.has(job.posterId.toLowerCase()) ||
    createdMs > nowMs ||
    nowMs - createdMs > freshOpportunityMaximumAgeMs ||
    deadlineMs - nowMs < freshOpportunityMinimumRemainingMs ||
    netRewardAtomic < freshOpportunityMinimumNetAtomic ||
    !job.escrowTxHash) {
    return null;
  }
  const scoreAtomic = netRewardAtomic / BigInt(summary.bidCount + 1);
  return {
    market: "moltjobs",
    task_id: job.id,
    title: job.title,
    mode: "competitive_job",
    gross_reward_usdc: job.budgetUsdc,
    net_reward_usdc: atomicToDecimal(netRewardAtomic),
    submission_count: summary.bidCount,
    created_at: job.createdAt,
    deadline_at: job.deadlineAt,
    hours_remaining: Math.round((deadlineMs - nowMs) / 36_000) / 100,
    escrow_tx_hash: job.escrowTxHash,
    requester: job.posterId,
    opportunity_score_usdc_per_current_entry: atomicToDecimal(scoreAtomic),
    requires_agent_fit_review: true,
    selection_basis:
      "official funded filter plus paired escrow identifiers plus agreeing public escrow flag plus successful Base receipt binding exact USDC and escrowJobId; non-owner poster; <=3 public bids; conservative 95% net >=5 USDC; <=12h old; >=2h remaining",
  };
}

function exactInputKeys(input: Record<string, unknown>, decision: ExactDemandDecision): boolean {
  const expected = Object.keys(decision.input).sort();
  const actual = Object.keys(input).sort();
  return JSON.stringify(actual) === JSON.stringify(expected) && stableDemandInput(input) === stableDemandInput(decision.input);
}

function mcpCandidate(job: MoltJob): DemandCandidate | null {
  const keys = Object.keys(job.inputData).sort();
  const expected = ["annotation_source_trust", "baseline", "contract_version", "current", "subject"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) return null;
  try {
    parseAndAnalyzeMcpDrift(JSON.stringify(job.inputData));
  } catch {
    return null;
  }
  const priceCents = Number(PRODUCT_CATALOG.mcpdrift.amountAtomic / 10_000n);
  if (atomicToBudgetCents(decimalAtomic(job.budgetUsdc, "MoltJobs budget")) < priceCents) return null;
  return {
    market: "moltjobs",
    job_id: job.id,
    title: job.title,
    product: "mcpdrift",
    input_sha256: createHash("sha256").update(stableDemandInput(job.inputData)).digest("hex"),
    price_cents: priceCents,
    budget_usdc: job.budgetUsdc,
    created_at: job.createdAt,
    deadline_at: job.deadlineAt,
  };
}

function moltCandidate(job: MoltJob): DemandCandidate | null {
  const mcp = mcpCandidate(job);
  if (mcp) return mcp;
  const decision = selectExactPublicDemand({
    title: job.title,
    description: JSON.stringify(job.inputData),
    budget_cents: atomicToBudgetCents(decimalAtomic(job.budgetUsdc, "MoltJobs budget")),
  });
  if (!decision || !exactInputKeys(job.inputData, decision)) return null;
  return {
    market: "moltjobs",
    job_id: job.id,
    title: job.title,
    product: decision.product,
    input_sha256: decision.input_sha256,
    price_cents: decision.price_cents,
    budget_usdc: job.budgetUsdc,
    created_at: job.createdAt,
    deadline_at: job.deadlineAt,
  };
}

export function analyzeMoltJobs(input: {
  open_jobs: MoltJob[];
  funded_jobs: MoltJob[];
  public_opportunity_summaries?: MoltJobPublicSummary[];
  funding_receipts?: MoltJobFundingReceiptPayload[];
  excluded_owner_poster_ids?: string[];
  opportunity_triggers_enabled?: boolean;
  now_ms?: number;
}): Record<string, unknown> {
  const nowMs = input.now_ms ?? Date.now();
  const opportunityTriggersEnabled = input.opportunity_triggers_enabled === true;
  const open = new Map(input.open_jobs.map((job) => [job.id, job]));
  if (open.size !== input.open_jobs.length || input.open_jobs.length > maximumRecords) {
    throw new Error("MoltJobs open inventory is duplicated or oversized.");
  }
  const fundedIds = new Set<string>();
  let fundedAtomic = 0n;
  const candidates: DemandCandidate[] = [];
  let expiredOrAssignedFunded = 0;
  const summaries = new Map((input.public_opportunity_summaries || []).map((summary) => [summary.id, summary]));
  if (summaries.size !== (input.public_opportunity_summaries || []).length) {
    throw new Error("MoltJobs public opportunity summaries are duplicated.");
  }
  const excludedOwnerPosterIds = new Set((input.excluded_owner_poster_ids || []).map((id) =>
    uuid(id, "MoltJobs owner poster ID").toLowerCase()
  ));
  const fundingReceipts = new Map((input.funding_receipts || []).map((payload) => [
    payload.transaction_hash.toLowerCase(),
    payload,
  ]));
  if (fundingReceipts.size !== (input.funding_receipts || []).length) {
    throw new Error("MoltJobs funding receipts are duplicated.");
  }
  const freshLowCompetitionCandidates: Record<string, unknown>[] = [];
  let chainReceiptVerifiedJobs = 0;
  let chainReceiptRejectedJobs = 0;
  for (const funded of input.funded_jobs) {
    const canonical = open.get(funded.id);
    if (!canonical || stableDemandInput(canonical as unknown as Record<string, unknown>) !==
      stableDemandInput(funded as unknown as Record<string, unknown>)) {
      throw new Error("MoltJobs funded inventory disagrees with the open feed.");
    }
    if (fundedIds.has(funded.id) || !funded.escrowTxHash || !funded.escrowJobId) {
      throw new Error("MoltJobs funded inventory contains invalid or duplicate escrow evidence.");
    }
    fundedIds.add(funded.id);
    if (funded.agentId !== null || !funded.isPubliclyShareable || Date.parse(funded.deadlineAt) <= nowMs) {
      expiredOrAssignedFunded += 1;
      continue;
    }
    fundedAtomic += decimalAtomic(funded.budgetUsdc, "MoltJobs budget");
    const candidate = moltCandidate(funded);
    if (candidate) candidates.push(candidate);
    const summary = summaries.get(funded.id);
    if (summary && opportunityTriggersEnabled) {
      const receipt = funded.escrowTxHash
        ? fundingReceipts.get(funded.escrowTxHash.toLowerCase())
        : undefined;
      if (!receipt) throw new Error("MoltJobs qualifying opportunity lacks a Base funding receipt.");
      if (verifyMoltJobsFundingReceipt(funded, receipt)) chainReceiptVerifiedJobs += 1;
      else chainReceiptRejectedJobs += 1;
      const opportunity = moltOpportunityCandidate(funded, summary, receipt, nowMs, excludedOwnerPosterIds);
      if (opportunity) freshLowCompetitionCandidates.push(opportunity);
    } else if (opportunityTriggersEnabled && moltJobsOpportunityDetailIds([funded], nowMs).length > 0) {
      throw new Error("MoltJobs qualifying preliminary opportunity lacks a public summary.");
    }
  }
  if ([...summaries.keys()].some((id) => !fundedIds.has(id))) {
    throw new Error("MoltJobs public summary does not belong to funded inventory.");
  }
  const fundedTransactionHashes = new Set(input.funded_jobs.flatMap((job) =>
    job.escrowTxHash ? [job.escrowTxHash.toLowerCase()] : []
  ));
  if ([...fundingReceipts.keys()].some((hash) => !fundedTransactionHashes.has(hash))) {
    throw new Error("MoltJobs funding receipt does not belong to funded inventory.");
  }
  freshLowCompetitionCandidates.sort((left, right) => {
    const scoreDifference = Number(right.opportunity_score_usdc_per_current_entry) -
      Number(left.opportunity_score_usdc_per_current_entry);
    if (scoreDifference !== 0) return scoreDifference;
    return String(left.created_at).localeCompare(String(right.created_at));
  });
  return {
    open_jobs: input.open_jobs.length,
    nominal_open_budget_usdc: atomicToDecimal(input.open_jobs.reduce(
      (sum, job) => sum + decimalAtomic(job.budgetUsdc, "MoltJobs budget"), 0n)),
    verified_funded_open_jobs: fundedIds.size - expiredOrAssignedFunded,
    verified_funded_budget_usdc: atomicToDecimal(fundedAtomic),
    exact_candidates: candidates,
    exact_candidate_count: candidates.length,
    fresh_low_competition_candidates: freshLowCompetitionCandidates,
    fresh_low_competition_candidate_count: freshLowCompetitionCandidates.length,
    public_opportunity_summary_checks: summaries.size,
    chain_receipt_verified_jobs: chainReceiptVerifiedJobs,
    chain_receipt_rejected_jobs: chainReceiptRejectedJobs,
    opportunity_triggering_enabled: opportunityTriggersEnabled,
    opportunity_triggering_suppressed_reason: opportunityTriggersEnabled
      ? null
      : "owner_poster_identity_scope_unconfigured",
    rejected_unfunded_or_expired: input.open_jobs.length - fundedIds.size + expiredOrAssignedFunded,
    rejected_funded_non_matches: fundedIds.size - expiredOrAssignedFunded - candidates.length,
    funding_rule: "server_funded_filter_plus_matching_onchain_escrow_identifiers_and_future_deadline",
    fresh_low_competition_rule:
      "funded_and_open_feeds_agree_plus_paired_escrow_identifiers_plus_public_escrow_flag_and_competition_agree_plus_successful_base_receipt_with_exact_usdc_transfer_and_escrow_job_event_plus_non_owner_poster_plus_max_3_bids_plus_conservative_95_percent_net_min_5_usdc_plus_max_12h_age_plus_min_2h_remaining",
  };
}

function openJobsDecimal(value: unknown, label: string, allowZero = false): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0) ||
        !Number.isSafeInteger(value * 1_000_000)) {
      throw new Error(`${label} is not an exact six-decimal amount.`);
    }
    return atomicToDecimal(BigInt(value * 1_000_000));
  }
  return atomicToDecimal(decimalAtomic(value, label));
}

function parseOpenJob(value: unknown): OpenJob {
  if (!isObject(value)) throw new Error("OpenJobs job is malformed.");
  if (value.status !== "open") throw new Error("OpenJobs feed contains a non-open job.");
  const jobType = requiredString(value.jobType, "OpenJobs job type", 40);
  if (!["paid", "free", "negotiable"].includes(jobType)) throw new Error("OpenJobs job type is unsupported.");
  const currency = requiredString(value.currency, "OpenJobs currency", 20);
  if (!["USDC", "WAGE"].includes(currency)) throw new Error("OpenJobs currency is unsupported.");
  return {
    id: uuid(value.id, "OpenJobs job ID"),
    title: requiredString(value.title, "OpenJobs title", 500),
    description: requiredString(value.description, "OpenJobs description", maximumTextBytes),
    reward: openJobsDecimal(
      value.reward,
      "OpenJobs reward",
      currency === "WAGE" && jobType !== "paid",
    ),
    currency,
    status: "open",
    jobType: jobType as OpenJob["jobType"],
    posterId: uuid(value.posterId, "OpenJobs poster ID"),
    workerId: value.workerId === null ? null : uuid(value.workerId, "OpenJobs worker ID"),
    acceptMode: value.acceptMode === undefined || value.acceptMode === null
      ? null
      : requiredString(value.acceptMode, "OpenJobs acceptance mode", 40),
    complexityBand: requiredString(value.complexityBand, "OpenJobs complexity", 10),
    createdAt: timestamp(value.createdAt, "OpenJobs creation time"),
    submittedAt: value.submittedAt === null ? null : timestamp(value.submittedAt, "OpenJobs submission time"),
    isTest: booleanValue(value.isTest, "OpenJobs test flag"),
    isSandbox: booleanValue(value.isSandbox, "OpenJobs sandbox flag"),
    isOnboarding: booleanValue(value.isOnboarding, "OpenJobs onboarding flag"),
    riskFlagged: booleanValue(value.riskFlagged, "OpenJobs risk flag"),
    escrowFrozen: booleanValue(value.escrowFrozen, "OpenJobs escrow flag"),
    disputeStatus: value.disputeStatus === null ? null : requiredString(value.disputeStatus, "OpenJobs dispute status", 80),
  };
}

export function parseOpenJobs(value: unknown): OpenJob[] {
  let records: unknown;
  if (Array.isArray(value)) records = value;
  else if (isObject(value) && Array.isArray(value.jobs) && Number.isSafeInteger(value.count) && value.count === value.jobs.length) {
    records = value.jobs;
  } else throw new Error("OpenJobs feed shape is unsupported.");
  if ((records as unknown[]).length > 100) throw new Error("OpenJobs feed exceeds its public cap.");
  const jobs = (records as unknown[]).map(parseOpenJob);
  const ids = new Set(jobs.map(({ id }) => id));
  if (ids.size !== jobs.length) throw new Error("OpenJobs feed duplicated a job.");
  return jobs;
}

export function analyzeOpenJobs(jobs: OpenJob[], nowMs = Date.now()): Record<string, unknown> {
  const freshCutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
  const usdc = jobs.filter((job) => job.currency === "USDC");
  const eligible = usdc.filter((job) =>
    job.jobType === "paid" && job.workerId === null && job.submittedAt === null && !job.isTest &&
    !job.isSandbox && !job.isOnboarding && !job.riskFlagged && !job.escrowFrozen &&
    job.disputeStatus === null && Date.parse(job.createdAt) >= freshCutoff
  );
  const candidates = eligible.flatMap((job): DemandCandidate[] => {
    const decision = selectExactPublicDemand({
      title: job.title,
      description: job.description,
      budget_cents: atomicToBudgetCents(decimalAtomic(job.reward, "OpenJobs reward")),
    });
    if (!decision || /\b(?:implement|patch|open (?:an? )?(?:pull request|pr)|submit code|code change|publish|post)\b/i.test(job.description)) {
      return [];
    }
    return [{
      market: "openjobs",
      job_id: job.id,
      title: job.title,
      product: decision.product,
      input_sha256: decision.input_sha256,
      price_cents: decision.price_cents,
      budget_usdc: job.reward,
      created_at: job.createdAt,
      deadline_at: null,
    }];
  });
  return {
    open_jobs: jobs.length,
    usdc_open_jobs: usdc.length,
    eligible_usdc_open_jobs: eligible.length,
    wage_open_jobs: jobs.filter((job) => job.currency === "WAGE").length,
    exact_candidates: candidates,
    exact_candidate_count: candidates.length,
    excluded_non_usdc: jobs.length - usdc.length,
    excluded_ambiguous_or_unsafe_usdc: usdc.length - eligible.length,
    feed_shape_note: "accepts_validated_documented_wrapper_or_current_bare_array_and_rejects_over_100_without_pagination",
  };
}
