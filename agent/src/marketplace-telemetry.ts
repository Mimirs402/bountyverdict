export type The402ServiceOutcome = {
  service_id: string;
  listed_at: string;
  updated_at: string;
  score: number;
  confidence: number;
  dimensions: {
    quality: number;
    speed: number;
    reliability: number;
    communication: number;
  };
  total_jobs: number;
  successful_jobs: number;
  failed_jobs: number;
  disputed_jobs: number;
};

export type CdpMerchantQualitySnapshot = {
  resource: string;
  observed_at: string;
  last_updated_at: string;
  quality_available: boolean;
  last_called_at: string | null;
  reported_calls_30d: number;
  reported_unique_payers_30d: number;
  delta_calls_30d: number | null;
  delta_unique_payers_30d: number | null;
  call_recency_advanced: boolean;
  requires_settlement_reconciliation: boolean;
  baseline_owner_contaminated: true;
};

export type AgenticMarketQualitySnapshot = {
  quality_available: boolean;
  reported_calls_30d: number;
  reported_unique_payers_30d: number;
};

function boundedNumber(value: unknown, label: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`the402 ${label} is invalid.`);
  }
  return value;
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`the402 ${label} is invalid.`);
  return Number(value);
}

function agenticMarketCount(value: unknown, label: string): number {
  if (!((typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)))) {
    throw new Error(`Agentic Market ${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Agentic Market ${label} is invalid.`);
  return parsed;
}

export function normalizeAgenticMarketQuality(value: unknown): AgenticMarketQualitySnapshot {
  if (value === null || value === undefined) {
    return {
      quality_available: false,
      reported_calls_30d: 0,
      reported_unique_payers_30d: 0,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agentic Market quality is malformed.");
  }
  const quality = value as Record<string, unknown>;
  const calls = agenticMarketCount(quality.l30DaysTotalCalls, "calls");
  const payers = agenticMarketCount(quality.l30DaysUniquePayers, "unique payers");
  if (payers > calls) throw new Error("Agentic Market quality counters are inconsistent.");
  return {
    quality_available: true,
    reported_calls_30d: calls,
    reported_unique_payers_30d: payers,
  };
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`the402 ${label} is invalid.`);
  }
  return value;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  return timestamp(value, label);
}

function previousMerchantQuality(value: unknown): Pick<CdpMerchantQualitySnapshot,
  "resource" | "reported_calls_30d" | "reported_unique_payers_30d" | "last_called_at"> | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("previous CDP merchant quality is malformed.");
  }
  const previous = value as Record<string, unknown>;
  if (typeof previous.resource !== "string" || !/^https:\/\//.test(previous.resource)) {
    throw new Error("previous CDP merchant resource identity is invalid.");
  }
  return {
    resource: previous.resource,
    reported_calls_30d: count(previous.reported_calls_30d, "previous CDP calls"),
    reported_unique_payers_30d: count(previous.reported_unique_payers_30d, "previous CDP unique payers"),
    last_called_at: nullableTimestamp(previous.last_called_at, "previous CDP lastCalledAt"),
  };
}

export function normalizeCdpMerchantQuality(
  value: unknown,
  expectedResource: string,
  observedAt: string,
  previousValue?: unknown,
): CdpMerchantQualitySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CDP merchant resource is malformed.");
  }
  const resource = value as Record<string, any>;
  if (resource.resource !== expectedResource) throw new Error("CDP merchant resource identity is invalid.");
  if (resource.quality !== null && resource.quality !== undefined &&
    (!resource.quality || typeof resource.quality !== "object" || Array.isArray(resource.quality))) {
    throw new Error("CDP merchant quality is malformed.");
  }
  const qualityAvailable = resource.quality !== null && resource.quality !== undefined;
  const calls = qualityAvailable ? count(resource.quality.l30DaysTotalCalls, "merchant calls") : 0;
  const payers = qualityAvailable ? count(resource.quality.l30DaysUniquePayers, "merchant unique payers") : 0;
  if (payers > calls) throw new Error("CDP merchant quality counters are inconsistent.");
  const lastCalledAt = qualityAvailable
    ? nullableTimestamp(resource.quality.lastCalledAt, "merchant lastCalledAt")
    : null;
  const previous = previousMerchantQuality(previousValue);
  const comparablePrevious = previous?.resource === expectedResource ? previous : null;
  const deltaCalls = comparablePrevious ? calls - comparablePrevious.reported_calls_30d : null;
  const deltaPayers = comparablePrevious ? payers - comparablePrevious.reported_unique_payers_30d : null;
  const callRecencyAdvanced = Boolean(comparablePrevious && lastCalledAt &&
    (!comparablePrevious.last_called_at || Date.parse(lastCalledAt) > Date.parse(comparablePrevious.last_called_at)));
  const requiresReconciliation = Boolean(comparablePrevious &&
    (deltaCalls !== 0 || deltaPayers !== 0 || callRecencyAdvanced));
  return {
    resource: expectedResource,
    observed_at: timestamp(observedAt, "merchant observation timestamp"),
    last_updated_at: timestamp(resource.lastUpdated, "merchant lastUpdated"),
    quality_available: qualityAvailable,
    last_called_at: lastCalledAt,
    reported_calls_30d: calls,
    reported_unique_payers_30d: payers,
    delta_calls_30d: deltaCalls,
    delta_unique_payers_30d: deltaPayers,
    call_recency_advanced: callRecencyAdvanced,
    requires_settlement_reconciliation: requiresReconciliation,
    baseline_owner_contaminated: true,
  };
}

export function appendCdpMerchantQualityHistory(
  previousHistory: unknown,
  current: Record<string, CdpMerchantQualitySnapshot>,
  maximumEntries = 180,
): Record<string, CdpMerchantQualitySnapshot[]> {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 1_000) {
    throw new Error("CDP merchant history limit is invalid.");
  }
  if (previousHistory !== undefined && previousHistory !== null &&
    (typeof previousHistory !== "object" || Array.isArray(previousHistory))) {
    throw new Error("CDP merchant quality history is malformed.");
  }
  const previous = (previousHistory || {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(current).map(([product, snapshot]) => {
    const existing = previous[product] === undefined ? [] : previous[product];
    if (!Array.isArray(existing) || existing.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error(`CDP merchant quality history is malformed for ${product}.`);
    }
    const rows = existing as CdpMerchantQualitySnapshot[];
    const last = rows.at(-1);
    const changed = !last || last.resource !== snapshot.resource || last.quality_available !== snapshot.quality_available ||
      last.reported_calls_30d !== snapshot.reported_calls_30d ||
      last.reported_unique_payers_30d !== snapshot.reported_unique_payers_30d ||
      last.last_called_at !== snapshot.last_called_at || last.last_updated_at !== snapshot.last_updated_at;
    return [product, (changed ? [...rows, snapshot] : rows).slice(-maximumEntries)];
  }));
}

export function normalizeThe402ServiceOutcome(value: unknown, expectedServiceId: string): The402ServiceOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("the402 service detail is malformed.");
  }
  const detail = value as Record<string, any>;
  if (detail.id !== expectedServiceId) throw new Error("the402 service detail belongs to another service.");
  const reputation = detail.service_reputation;
  if (!reputation || typeof reputation !== "object" || Array.isArray(reputation) ||
    !reputation.dimensions || typeof reputation.dimensions !== "object" || Array.isArray(reputation.dimensions)) {
    throw new Error("the402 service reputation is malformed.");
  }
  const result = {
    service_id: expectedServiceId,
    listed_at: timestamp(detail.listed_at, "listed_at"),
    updated_at: timestamp(detail.updated_at, "updated_at"),
    score: boundedNumber(reputation.score, "reputation score", 100),
    confidence: boundedNumber(reputation.confidence, "reputation confidence", 1),
    dimensions: {
      quality: boundedNumber(reputation.dimensions.quality, "quality score", 100),
      speed: boundedNumber(reputation.dimensions.speed, "speed score", 100),
      reliability: boundedNumber(reputation.dimensions.reliability, "reliability score", 100),
      communication: boundedNumber(reputation.dimensions.communication, "communication score", 100),
    },
    total_jobs: count(reputation.total_jobs, "total_jobs"),
    successful_jobs: count(reputation.successful_jobs, "successful_jobs"),
    failed_jobs: count(reputation.failed_jobs, "failed_jobs"),
    disputed_jobs: count(reputation.disputed_jobs, "disputed_jobs"),
  };
  if (result.successful_jobs + result.failed_jobs + result.disputed_jobs > result.total_jobs) {
    throw new Error("the402 service outcome counters are inconsistent.");
  }
  return result;
}

export function normalizeThe402WebhookHealth(
  values: unknown[],
  completedJobs: number,
): { healthy: boolean; status: "healthy" | "unverified_no_completed_jobs" } {
  if (!Number.isSafeInteger(completedJobs) || completedJobs < 0) {
    throw new Error("the402 completed-job count is invalid.");
  }
  if (values.length === 0 || values.some((value) => typeof value !== "boolean")) {
    throw new Error("the402 webhook health telemetry is malformed.");
  }
  if (values.every((value) => value === true)) {
    return { healthy: true, status: "healthy" };
  }
  if (completedJobs === 0 && values.every((value) => value === false)) {
    return { healthy: false, status: "unverified_no_completed_jobs" };
  }
  throw new Error("the402 webhook health telemetry is inconsistent with completed jobs.");
}

export function normalizeThe402CustomerSettlement(
  settlementValue: unknown,
  jobValue: unknown,
  expectedServiceIds: ReadonlySet<string>,
  excludedBuyerWallets: ReadonlySet<string>,
): {
  settlement_id: string;
  job_id: string;
  service_id: string;
  buyer_wallet: string;
  amount_usd: number;
  settled_at: string;
} | null {
  if (!settlementValue || typeof settlementValue !== "object" || Array.isArray(settlementValue) ||
    !jobValue || typeof jobValue !== "object" || Array.isArray(jobValue)) {
    throw new Error("the402 settlement attribution is malformed.");
  }
  const settlement = settlementValue as Record<string, any>;
  const job = jobValue as Record<string, any>;
  for (const [label, value] of [
    ["settlement ID", settlement.id],
    ["job ID", settlement.job_id],
    ["job response ID", job.id],
    ["service ID", job.service_id],
  ] as const) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
      throw new Error(`the402 ${label} is invalid.`);
    }
  }
  if (job.id !== settlement.job_id) throw new Error("the402 settlement job identity is inconsistent.");
  if (!expectedServiceIds.has(job.service_id)) throw new Error("the402 settlement references an unknown service.");
  const buyerWallet = String(job.agent_wallet || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(buyerWallet)) throw new Error("the402 settlement buyer wallet is invalid.");
  const amount = Number(settlement.amount_usd);
  const providerAmount = Number(job.provider_amount_usd);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000 ||
    !Number.isFinite(providerAmount) || Math.abs(amount - providerAmount) > 0.000001) {
    throw new Error("the402 settlement amount is inconsistent.");
  }
  if (excludedBuyerWallets.has(buyerWallet)) return null;
  if (!["completed", "verified", "released"].includes(String(job.status)) ||
    job.escrow_status !== "released") {
    return null;
  }
  return {
    settlement_id: settlement.id,
    job_id: settlement.job_id,
    service_id: job.service_id,
    buyer_wallet: buyerWallet,
    amount_usd: amount,
    settled_at: timestamp(settlement.created_at, "settlement created_at"),
  };
}
