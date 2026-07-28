import { PRODUCT_KEYS, type ProductKey } from "./product-catalog.ts";
import {
  FUNNEL_CHANNELS,
  FUNNEL_CLIENT_CLASSES,
  MCP_CLIENT_FAMILIES,
  MCP_FUNNEL_STAGES,
  MCP_VALIDATION_KINDS,
  discoveryBuyerCandidateTotals,
  mcpBuyerCandidateTotals,
  type FunnelCounters,
  type FunnelSnapshot,
  type McpFunnelCounters,
} from "./funnel-telemetry.ts";

type ProductCounters = Pick<FunnelCounters,
  "requests" | "challenges_402" | "signed_requests" | "signed_successes" |
  "preflight_rejections" | "rate_limited" | "server_errors">;

type McpProduct = Exclude<ProductKey, "skill">;
const FUNNEL_COUNTER_KEYS = [
  "requests", "challenges_402", "signed_requests", "signed_successes", "unsigned_successes",
  "preflight_rejections", "rate_limited", "server_errors", "other",
] as const satisfies readonly (keyof FunnelCounters)[];

export type TrustedMcpBaseline = {
  external_totals: McpFunnelCounters;
  buyer_candidate_totals: McpFunnelCounters;
  external_by_product: Record<McpProduct, McpFunnelCounters>;
  by_channel: FunnelSnapshot["mcp_by_channel"];
  by_client_class: FunnelSnapshot["mcp_by_client_class"];
  by_client_family: FunnelSnapshot["mcp_by_client_family"];
  validation_kinds: FunnelSnapshot["mcp_validation_kinds"];
};

export type TrustedFunnelBaseline = {
  schema_version: 1;
  epoch_id: number;
  initialized_at: string;
  reason: string;
  funnel_capture_started_at: string;
  funnel_schema_version: number;
  funnel_observed_through: string;
  funnel_collector_heartbeat_at: string;
  cohort_capture_started_at: string;
  mcp?: TrustedMcpBaseline;
  buyer_candidate_discovery_totals: FunnelCounters;
  counters: {
    external_discovery_requests: number;
    external_402_challenges: number;
    signed_payment_attempts: number;
    successful_signed_responses: number;
  };
  external_by_product: Record<ProductKey, ProductCounters>;
  by_channel: FunnelSnapshot["by_channel"];
  by_client_class: FunnelSnapshot["by_client_class"];
  by_discovery_channel: FunnelSnapshot["by_discovery_channel"];
  by_discovery_client_class: FunnelSnapshot["by_discovery_client_class"];
  external_discovery_by_surface: Record<string, number>;
  by_cohort: FunnelSnapshot["by_cohort"];
  by_discovery_cohort: FunnelSnapshot["by_discovery_cohort"];
};

function subtractOwner(total: number, owner: number, label: string): number {
  const result = total - owner;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} is internally inconsistent.`);
  return result;
}

function funnelCountersDelta(current: FunnelCounters, baseline: FunnelCounters, label: string): FunnelCounters {
  return Object.fromEntries(FUNNEL_COUNTER_KEYS.map((key) => {
    const value = current[key] - baseline[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} ${key} is internally inconsistent.`);
    return [key, value];
  })) as FunnelCounters;
}

function funnelCountersValid(value: unknown): value is FunnelCounters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === FUNNEL_COUNTER_KEYS.length &&
    FUNNEL_COUNTER_KEYS.every((key) => Number.isSafeInteger(record[key]) && Number(record[key]) >= 0);
}

const MCP_PRODUCTS = PRODUCT_KEYS.filter((product): product is McpProduct => product !== "skill");
const MCP_COUNTER_KEYS = ["events", ...MCP_FUNNEL_STAGES] as const;
const TRUSTED_MCP_BASELINE_KEYS = [
  "external_totals",
  "buyer_candidate_totals",
  "external_by_product",
  "by_channel",
  "by_client_class",
  "by_client_family",
  "validation_kinds",
] as const;

function emptyMcpCounters(): McpFunnelCounters {
  return Object.fromEntries(MCP_COUNTER_KEYS.map((key) => [key, 0])) as McpFunnelCounters;
}

function addMcpCounters(target: McpFunnelCounters, source: McpFunnelCounters): McpFunnelCounters {
  for (const key of MCP_COUNTER_KEYS) target[key] += source[key] ?? 0;
  return target;
}

export function captureTrustedMcpBaseline(state: FunnelSnapshot): TrustedMcpBaseline {
  const externalTotals = emptyMcpCounters();
  for (const [source, counters] of Object.entries(state.mcp_by_source)) {
    if (source !== "owner_automation") addMcpCounters(externalTotals, counters);
  }
  const externalByProduct = Object.fromEntries(MCP_PRODUCTS.map((product) => {
    const totals = emptyMcpCounters();
    for (const [source, counters] of Object.entries(state.mcp_by_product_source[product])) {
      if (source !== "owner_automation") addMcpCounters(totals, counters);
    }
    return [product, totals];
  })) as Record<McpProduct, McpFunnelCounters>;
  return {
    external_totals: externalTotals,
    buyer_candidate_totals: mcpBuyerCandidateTotals(state),
    external_by_product: externalByProduct,
    by_channel: structuredClone(state.mcp_by_channel),
    by_client_class: structuredClone(state.mcp_by_client_class),
    by_client_family: structuredClone(state.mcp_by_client_family),
    validation_kinds: structuredClone(state.mcp_validation_kinds),
  };
}

function monotonicMcpDelta(current: number, baseline: number, label: string): number {
  const delta = current - baseline;
  if (!Number.isSafeInteger(delta) || delta < 0) throw new Error(`${label} is internally inconsistent.`);
  return delta;
}

function mcpCountersDelta(current: McpFunnelCounters, baseline: McpFunnelCounters, label: string): McpFunnelCounters {
  return Object.fromEntries(MCP_COUNTER_KEYS.map((key) => [
    key,
    monotonicMcpDelta(current[key] ?? 0, baseline[key] ?? 0, `${label} ${key}`),
  ])) as McpFunnelCounters;
}

function keyedMcpDelta<K extends string>(
  current: Record<K, McpFunnelCounters>,
  baseline: Record<K, McpFunnelCounters>,
  keys: readonly K[],
  label: string,
): Record<K, McpFunnelCounters> {
  return Object.fromEntries(keys.map((key) => [key, mcpCountersDelta(current[key], baseline[key], `${label} ${key}`)])) as Record<K, McpFunnelCounters>;
}

export function trustedMcpDelta(state: FunnelSnapshot, baseline: TrustedMcpBaseline): TrustedMcpBaseline {
  const current = captureTrustedMcpBaseline(state);
  return {
    external_totals: mcpCountersDelta(current.external_totals, baseline.external_totals, "External MCP"),
    buyer_candidate_totals: mcpCountersDelta(current.buyer_candidate_totals, baseline.buyer_candidate_totals, "Buyer-candidate MCP"),
    external_by_product: keyedMcpDelta(current.external_by_product, baseline.external_by_product, MCP_PRODUCTS, "External MCP product"),
    by_channel: keyedMcpDelta(current.by_channel, baseline.by_channel, FUNNEL_CHANNELS, "MCP channel"),
    by_client_class: keyedMcpDelta(current.by_client_class, baseline.by_client_class, FUNNEL_CLIENT_CLASSES, "MCP client class"),
    by_client_family: keyedMcpDelta(current.by_client_family, baseline.by_client_family, MCP_CLIENT_FAMILIES, "MCP client family"),
    validation_kinds: Object.fromEntries(MCP_VALIDATION_KINDS.map((kind) => [
      kind,
      monotonicMcpDelta(current.validation_kinds[kind], baseline.validation_kinds[kind], `MCP validation kind ${kind}`),
    ])) as FunnelSnapshot["mcp_validation_kinds"],
  };
}

export function trustedBuyerCandidateDiscoveryDelta(
  state: FunnelSnapshot,
  baseline: TrustedFunnelBaseline,
): FunnelCounters {
  return funnelCountersDelta(
    discoveryBuyerCandidateTotals(state),
    baseline.buyer_candidate_discovery_totals,
    "Buyer-candidate discovery",
  );
}

function mcpCountersValid(value: unknown): value is McpFunnelCounters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if ((keys.length !== MCP_COUNTER_KEYS.length && !(keys.length === MCP_COUNTER_KEYS.length - 1 && record.selection_preview === undefined)) ||
    !MCP_COUNTER_KEYS.every((key) => key === "selection_preview" && record[key] === undefined || Number.isSafeInteger(record[key]) && Number(record[key]) >= 0)) return false;
  return MCP_FUNNEL_STAGES.reduce((sum, stage) => sum + Number(record[stage] ?? 0), 0) === Number(record.events);
}

function normalizeMcpCounters(value: McpFunnelCounters): McpFunnelCounters {
  return Object.fromEntries(MCP_COUNTER_KEYS.map((key) => [key, value[key] ?? 0])) as McpFunnelCounters;
}

function keyedMcpCountersValid(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === keys.length && keys.every((key) => mcpCountersValid(record[key]));
}

function migrateMcpChannelCounters(value: unknown): FunnelSnapshot["mcp_by_channel"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !FUNNEL_CHANNELS.includes(key as typeof FUNNEL_CHANNELS[number])) ||
    !Object.values(record).every(mcpCountersValid)) return null;
  return Object.fromEntries(FUNNEL_CHANNELS.map((channel) => [
    channel,
    record[channel] ? normalizeMcpCounters(record[channel] as McpFunnelCounters) : emptyMcpCounters(),
  ])) as FunnelSnapshot["mcp_by_channel"];
}

function migrateFunnelChannelCounters(value: unknown): FunnelSnapshot["by_channel"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !FUNNEL_CHANNELS.includes(key as typeof FUNNEL_CHANNELS[number])) ||
    !Object.values(record).every(funnelCountersValid)) return null;
  const empty = (): FunnelCounters => Object.fromEntries(FUNNEL_COUNTER_KEYS.map((key) => [key, 0])) as FunnelCounters;
  return Object.fromEntries(FUNNEL_CHANNELS.map((channel) => [
    channel,
    record[channel] ? structuredClone(record[channel]) : empty(),
  ])) as FunnelSnapshot["by_channel"];
}

function normalizeTrustedMcpBaseline(value: unknown): TrustedMcpBaseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const baseline = value as Partial<TrustedMcpBaseline>;
  if (Object.keys(value).length !== TRUSTED_MCP_BASELINE_KEYS.length ||
    !TRUSTED_MCP_BASELINE_KEYS.every((key) => key in value) ||
    !mcpCountersValid(baseline.external_totals) || !mcpCountersValid(baseline.buyer_candidate_totals) ||
    !keyedMcpCountersValid(baseline.external_by_product, MCP_PRODUCTS) ||
    !keyedMcpCountersValid(baseline.by_client_class, FUNNEL_CLIENT_CLASSES) ||
    !keyedMcpCountersValid(baseline.by_client_family, MCP_CLIENT_FAMILIES) ||
    !baseline.validation_kinds || typeof baseline.validation_kinds !== "object" || Array.isArray(baseline.validation_kinds)) return null;
  const byChannel = migrateMcpChannelCounters(baseline.by_channel);
  if (!byChannel) return null;
  const validationKinds = baseline.validation_kinds as Record<string, unknown>;
  if (Object.keys(validationKinds).length !== MCP_VALIDATION_KINDS.length ||
    !MCP_VALIDATION_KINDS.every((kind) => Number.isSafeInteger(validationKinds[kind]) && Number(validationKinds[kind]) >= 0)) return null;
  return {
    ...baseline,
    external_totals: normalizeMcpCounters(baseline.external_totals),
    buyer_candidate_totals: normalizeMcpCounters(baseline.buyer_candidate_totals),
    external_by_product: Object.fromEntries(MCP_PRODUCTS.map((product) => [
      product,
      normalizeMcpCounters(baseline.external_by_product![product]),
    ])) as TrustedMcpBaseline["external_by_product"],
    by_channel: byChannel,
    by_client_class: Object.fromEntries(FUNNEL_CLIENT_CLASSES.map((client) => [
      client,
      normalizeMcpCounters(baseline.by_client_class![client]),
    ])) as TrustedMcpBaseline["by_client_class"],
    by_client_family: Object.fromEntries(MCP_CLIENT_FAMILIES.map((family) => [
      family,
      normalizeMcpCounters(baseline.by_client_family![family]),
    ])) as TrustedMcpBaseline["by_client_family"],
  } as TrustedMcpBaseline;
}

export function captureTrustedFunnelBaseline(
  state: FunnelSnapshot,
  initializedAt: string,
  reason: string,
  epochId: number,
): TrustedFunnelBaseline {
  if (!Number.isFinite(Date.parse(initializedAt))) throw new Error("Baseline timestamp is invalid.");
  if (!Number.isSafeInteger(epochId) || epochId < 1) throw new Error("Baseline epoch ID is invalid.");
  if (reason.length < 20 || reason.length > 500 || /[\r\n]/.test(reason)) throw new Error("Baseline reason is invalid.");
  const externalByProduct = Object.fromEntries(PRODUCT_KEYS.map((product) => {
    const sources = state.by_product_source[product];
    const external = Object.entries(sources)
      .filter(([source]) => source !== "owner_automation")
      .reduce((sum, [, counters]) => ({
        requests: sum.requests + counters.requests,
        challenges_402: sum.challenges_402 + counters.challenges_402,
        signed_requests: sum.signed_requests + counters.signed_requests,
        signed_successes: sum.signed_successes + counters.signed_successes,
        preflight_rejections: sum.preflight_rejections + counters.preflight_rejections,
        rate_limited: sum.rate_limited + counters.rate_limited,
        server_errors: sum.server_errors + counters.server_errors,
      }), { requests: 0, challenges_402: 0, signed_requests: 0, signed_successes: 0, preflight_rejections: 0, rate_limited: 0, server_errors: 0 });
    return [product, external];
  })) as Record<ProductKey, ProductCounters>;
  const externalDiscoveryBySurface = Object.fromEntries(
    Object.entries(state.by_discovery_surface_source).map(([surface, sources]) => [
      surface,
      Object.entries(sources)
        .filter(([source]) => source !== "owner_automation")
        .reduce((sum, [, counters]) => sum + counters.requests, 0),
    ]),
  );
  return {
    schema_version: 1,
    epoch_id: epochId,
    initialized_at: initializedAt,
    reason,
    funnel_capture_started_at: state.capture_started_at,
    funnel_schema_version: state.schema_version,
    funnel_observed_through: state.updated_at,
    funnel_collector_heartbeat_at: state.collector_heartbeat_at,
    cohort_capture_started_at: state.cohort_capture_started_at,
    mcp: captureTrustedMcpBaseline(state),
    buyer_candidate_discovery_totals: discoveryBuyerCandidateTotals(state),
    counters: {
      external_discovery_requests: subtractOwner(
        state.discovery_totals.requests,
        state.by_discovery_source.owner_automation.requests,
        "External discovery total",
      ),
      external_402_challenges: subtractOwner(
        state.totals.challenges_402,
        state.by_source.owner_automation.challenges_402,
        "External challenge total",
      ),
      signed_payment_attempts: subtractOwner(
        state.totals.signed_requests,
        state.by_source.owner_automation.signed_requests,
        "External signed-request total",
      ),
      successful_signed_responses: subtractOwner(
        state.totals.signed_successes,
        state.by_source.owner_automation.signed_successes,
        "External signed-success total",
      ),
    },
    external_by_product: externalByProduct,
    by_channel: structuredClone(state.by_channel),
    by_client_class: structuredClone(state.by_client_class),
    by_discovery_channel: structuredClone(state.by_discovery_channel),
    by_discovery_client_class: structuredClone(state.by_discovery_client_class),
    external_discovery_by_surface: externalDiscoveryBySurface,
    by_cohort: structuredClone(state.by_cohort),
    by_discovery_cohort: structuredClone(state.by_discovery_cohort),
  };
}

export function trustedFunnelBaseline(value: unknown): TrustedFunnelBaseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const baseline = value as Partial<TrustedFunnelBaseline>;
  const epochId = baseline.epoch_id === undefined ? 1 : baseline.epoch_id;
  if (baseline.schema_version !== 1 || !Number.isSafeInteger(epochId) || Number(epochId) < 1 ||
    typeof baseline.initialized_at !== "string" || !Number.isFinite(Date.parse(baseline.initialized_at)) ||
    typeof baseline.reason !== "string" || !baseline.counters || !baseline.external_by_product ||
    !baseline.by_channel || !baseline.by_client_class || !baseline.external_discovery_by_surface) return null;
  const normalizedMcp = baseline.mcp === undefined ? undefined : normalizeTrustedMcpBaseline(baseline.mcp);
  if (baseline.mcp !== undefined && !normalizedMcp) return null;
  const normalizedByChannel = migrateFunnelChannelCounters(baseline.by_channel);
  if (!normalizedByChannel) return null;
  const normalizedDiscoveryByChannel = baseline.by_discovery_channel === undefined
    ? undefined
    : migrateFunnelChannelCounters(baseline.by_discovery_channel);
  if (baseline.by_discovery_channel !== undefined && !normalizedDiscoveryByChannel) return null;
  if (baseline.buyer_candidate_discovery_totals !== undefined &&
    !funnelCountersValid(baseline.buyer_candidate_discovery_totals)) return null;
  return {
    ...baseline,
    epoch_id: Number(epochId),
    mcp: normalizedMcp,
    funnel_capture_started_at: typeof baseline.funnel_capture_started_at === "string"
      ? baseline.funnel_capture_started_at
      : "legacy_unknown",
    funnel_schema_version: typeof baseline.funnel_schema_version === "number" ? baseline.funnel_schema_version : 0,
    funnel_observed_through: typeof baseline.funnel_observed_through === "string"
      ? baseline.funnel_observed_through
      : baseline.initialized_at,
    funnel_collector_heartbeat_at: typeof baseline.funnel_collector_heartbeat_at === "string" &&
      Number.isFinite(Date.parse(baseline.funnel_collector_heartbeat_at))
      ? baseline.funnel_collector_heartbeat_at
      : (typeof baseline.funnel_observed_through === "string" ? baseline.funnel_observed_through : baseline.initialized_at),
    cohort_capture_started_at: typeof baseline.cohort_capture_started_at === "string"
      ? baseline.cohort_capture_started_at
      : "legacy_unknown",
    by_channel: normalizedByChannel,
    by_discovery_channel: normalizedDiscoveryByChannel || {} as FunnelSnapshot["by_discovery_channel"],
    by_discovery_client_class: baseline.by_discovery_client_class || {} as FunnelSnapshot["by_discovery_client_class"],
    by_cohort: baseline.by_cohort || {},
    by_discovery_cohort: baseline.by_discovery_cohort || {},
    buyer_candidate_discovery_totals: baseline.buyer_candidate_discovery_totals ||
      discoveryBuyerCandidateTotals({ by_discovery_cohort: baseline.by_discovery_cohort || {} }),
  } as TrustedFunnelBaseline;
}

export function assertFreshFunnelCollector(
  state: FunnelSnapshot,
  observedAt: string,
  maximumAgeSeconds = 60,
): void {
  const observedMs = Date.parse(observedAt);
  const heartbeatMs = Date.parse(state.collector_heartbeat_at);
  if (!Number.isFinite(observedMs) || !Number.isFinite(heartbeatMs) ||
    !Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 15 || maximumAgeSeconds > 300) {
    throw new Error("Funnel collector freshness inputs are invalid.");
  }
  const ageMs = observedMs - heartbeatMs;
  if (ageMs < -5_000 || ageMs > maximumAgeSeconds * 1_000) {
    throw new Error(`Funnel collector heartbeat is stale or ahead of the rotation boundary (${Math.round(ageMs / 1_000)}s).`);
  }
}

export function trustedBoundaryFingerprint(baseline: TrustedFunnelBaseline): string {
  const healthChannels = new Set([
    "owner_automation", "coinbase_bazaar", "index_402", "x402scan", "x402gle",
    "agent402", "x402_observer", "registry_or_directory",
  ]);
  // The drain exists to isolate owner-triggered downstream catalog probes before
  // opening a conversion epoch. Keep every discovery and rejection in the
  // baseline/report, but do not let anonymous malformed probes hold conversion
  // measurement closed forever. Any payment-capable event, bypass, throttling,
  // server failure, or unclassified response still resets the quiet window.
  const boundaryCounters = [
    "challenges_402", "signed_requests", "signed_successes", "unsigned_successes",
    "rate_limited", "server_errors", "other",
  ] as const;
  const buyerRelevantPaidCohorts = Object.fromEntries(Object.entries(baseline.by_cohort || {})
    .filter(([key]) => !healthChannels.has(key.split("|")[1] || ""))
    .map(([key, counters]) => [key, Object.fromEntries(
      boundaryCounters.map((counter) => [counter, Number(counters[counter] || 0)]),
    )])
    .filter(([, counters]) => Object.values(counters).some((value) => value > 0)));
  return JSON.stringify({
    funnel_capture_started_at: baseline.funnel_capture_started_at,
    funnel_schema_version: baseline.funnel_schema_version,
    cohort_capture_started_at: baseline.cohort_capture_started_at,
    buyer_relevant_paid_cohorts: buyerRelevantPaidCohorts,
  });
}
