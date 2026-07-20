import { PRODUCT_CATALOG, PRODUCT_KEYS, type ProductKey } from "./product-catalog.ts";

export const FUNNEL_SCHEMA_VERSION = 1 as const;

export const FUNNEL_SOURCE_CATEGORIES = Object.freeze([
  "owner_automation",
  "known_directory",
  "automated_client",
  "interactive_client",
  "unknown",
] as const);

export type FunnelSourceCategory = typeof FUNNEL_SOURCE_CATEGORIES[number];
export type FunnelOutcome =
  | "challenge_402"
  | "signed_success"
  | "unsigned_success"
  | "preflight_rejection"
  | "rate_limited"
  | "server_error"
  | "other";

export type FunnelObservation = {
  observed_at: string;
  product: ProductKey;
  source: FunnelSourceCategory;
  outcome: FunnelOutcome;
  signed_request: boolean;
};

export type FunnelCounters = {
  requests: number;
  challenges_402: number;
  signed_requests: number;
  signed_successes: number;
  preflight_rejections: number;
  rate_limited: number;
  server_errors: number;
  other: number;
};

export type FunnelSnapshot = {
  schema_version: typeof FUNNEL_SCHEMA_VERSION;
  capture_started_at: string;
  updated_at: string;
  privacy: string;
  totals: FunnelCounters;
  by_product: Record<ProductKey, FunnelCounters>;
  by_source: Record<FunnelSourceCategory, FunnelCounters>;
};

type TailEvent = {
  scriptName?: unknown;
  eventTimestamp?: unknown;
  event?: {
    request?: {
      url?: unknown;
      method?: unknown;
      headers?: unknown;
    };
    response?: { status?: unknown };
  };
};

const PRODUCT_BY_PATH = new Map<string, ProductKey>(
  PRODUCT_KEYS.map((product) => [PRODUCT_CATALOG[product].path, product] as const),
);
const PRODUCTION_HOST = "bountyverdict-agent-production.mimirslab.workers.dev";

function emptyCounters(): FunnelCounters {
  return {
    requests: 0,
    challenges_402: 0,
    signed_requests: 0,
    signed_successes: 0,
    preflight_rejections: 0,
    rate_limited: 0,
    server_errors: 0,
    other: 0,
  };
}

function headersRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [name, header] of Object.entries(value)) {
    if (typeof header === "string") result[name.toLowerCase()] = header;
  }
  return result;
}

function sourceCategory(userAgent: string): FunnelSourceCategory {
  if (/bountyverdict-(?:funnel-smoke|directory-monitor|distribution-monitor|settlement-canary)/i.test(userAgent)) {
    return "owner_automation";
  }
  if (/(?:agent402|x402-observer|opendexter|x402gle|402index|tollbooth|x402dash|x402scan|x402scout)/i.test(userAgent)) {
    return "known_directory";
  }
  if (/(?:bot\b|crawler|spider|python-requests|node-fetch|undici|axios|go-http-client)/i.test(userAgent)) {
    return "automated_client";
  }
  if (/(?:mozilla|chrome|safari|firefox|edge)\//i.test(userAgent)) return "interactive_client";
  return "unknown";
}

function outcomeFor(status: number, signed: boolean): FunnelOutcome {
  if (status === 402) return "challenge_402";
  if (status >= 200 && status < 300) return signed ? "signed_success" : "unsigned_success";
  if (status === 400 || status === 404 || status === 405 || status === 413 || status === 422) {
    return "preflight_rejection";
  }
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "server_error";
  return "other";
}

export function classifyFunnelTailEvent(value: unknown): FunnelObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tail = value as TailEvent;
  if (tail.scriptName !== "bountyverdict-agent-production") return null;
  const request = tail.event?.request;
  const rawUrl = request?.url;
  const method = request?.method;
  const status = tail.event?.response?.status;
  if (typeof rawUrl !== "string" || typeof method !== "string" || !Number.isSafeInteger(status)) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.host !== PRODUCTION_HOST) return null;
  const product = PRODUCT_BY_PATH.get(url.pathname);
  if (!product || method.toUpperCase() !== PRODUCT_CATALOG[product].method) return null;
  const headers = headersRecord(request?.headers);
  const signed = Boolean(headers["payment-signature"] || headers["x-payment"]);
  const timestamp = typeof tail.eventTimestamp === "number" && Number.isFinite(tail.eventTimestamp)
    ? new Date(tail.eventTimestamp).toISOString()
    : new Date().toISOString();
  return {
    observed_at: timestamp,
    product,
    source: sourceCategory(headers["user-agent"] || ""),
    outcome: outcomeFor(status as number, signed),
    signed_request: signed,
  };
}

export function createFunnelSnapshot(now = new Date().toISOString()): FunnelSnapshot {
  return {
    schema_version: FUNNEL_SCHEMA_VERSION,
    capture_started_at: now,
    updated_at: now,
    privacy: "Aggregate paid-route counts only; raw URLs, query values, bodies, headers, IP addresses, geolocation, and user-agent strings are discarded.",
    totals: emptyCounters(),
    by_product: Object.fromEntries(PRODUCT_KEYS.map((product) => [product, emptyCounters()])) as Record<ProductKey, FunnelCounters>,
    by_source: Object.fromEntries(FUNNEL_SOURCE_CATEGORIES.map((source) => [source, emptyCounters()])) as Record<FunnelSourceCategory, FunnelCounters>,
  };
}

function increment(counters: FunnelCounters, observation: FunnelObservation): void {
  counters.requests += 1;
  if (observation.signed_request) counters.signed_requests += 1;
  if (observation.outcome === "challenge_402") counters.challenges_402 += 1;
  else if (observation.outcome === "signed_success") counters.signed_successes += 1;
  else if (observation.outcome === "preflight_rejection") counters.preflight_rejections += 1;
  else if (observation.outcome === "rate_limited") counters.rate_limited += 1;
  else if (observation.outcome === "server_error") counters.server_errors += 1;
  else counters.other += 1;
}

export function recordFunnelObservation(snapshot: FunnelSnapshot, observation: FunnelObservation): FunnelSnapshot {
  increment(snapshot.totals, observation);
  increment(snapshot.by_product[observation.product], observation);
  increment(snapshot.by_source[observation.source], observation);
  snapshot.updated_at = observation.observed_at;
  return snapshot;
}

export function isFunnelSnapshot(value: unknown): value is FunnelSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<FunnelSnapshot>;
  if (snapshot.schema_version !== FUNNEL_SCHEMA_VERSION || typeof snapshot.capture_started_at !== "string" ||
    typeof snapshot.updated_at !== "string" || typeof snapshot.privacy !== "string") return false;
  if (!snapshot.totals || !snapshot.by_product || !snapshot.by_source) return false;
  const countersValid = (counters: unknown) => Boolean(counters && typeof counters === "object" &&
    Object.values(counters).every((count) => Number.isSafeInteger(count) && (count as number) >= 0));
  return countersValid(snapshot.totals) && PRODUCT_KEYS.every((product) => countersValid(snapshot.by_product?.[product])) &&
    FUNNEL_SOURCE_CATEGORIES.every((source) => countersValid(snapshot.by_source?.[source]));
}
