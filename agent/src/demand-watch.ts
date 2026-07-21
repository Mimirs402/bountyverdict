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
const moneyPattern = /^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,6})?$/;
const maximumRecords = 200;
const maximumTextBytes = 20_000;

export type DemandCandidate = {
  market: "moltjobs" | "openjobs";
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
  now_ms?: number;
}): Record<string, unknown> {
  const nowMs = input.now_ms ?? Date.now();
  const open = new Map(input.open_jobs.map((job) => [job.id, job]));
  if (open.size !== input.open_jobs.length || input.open_jobs.length > maximumRecords) {
    throw new Error("MoltJobs open inventory is duplicated or oversized.");
  }
  const fundedIds = new Set<string>();
  let fundedAtomic = 0n;
  const candidates: DemandCandidate[] = [];
  let expiredOrAssignedFunded = 0;
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
  }
  return {
    open_jobs: input.open_jobs.length,
    nominal_open_budget_usdc: atomicToDecimal(input.open_jobs.reduce(
      (sum, job) => sum + decimalAtomic(job.budgetUsdc, "MoltJobs budget"), 0n)),
    verified_funded_open_jobs: fundedIds.size - expiredOrAssignedFunded,
    verified_funded_budget_usdc: atomicToDecimal(fundedAtomic),
    exact_candidates: candidates,
    exact_candidate_count: candidates.length,
    rejected_unfunded_or_expired: input.open_jobs.length - fundedIds.size + expiredOrAssignedFunded,
    rejected_funded_non_matches: fundedIds.size - expiredOrAssignedFunded - candidates.length,
    funding_rule: "server_funded_filter_plus_matching_onchain_escrow_identifiers_and_future_deadline",
  };
}

function openJobsDecimal(value: unknown, label: string): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(value * 1_000_000)) {
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
    reward: openJobsDecimal(value.reward, "OpenJobs reward"),
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
