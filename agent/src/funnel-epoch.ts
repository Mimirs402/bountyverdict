import { PRODUCT_KEYS, type ProductKey } from "./product-catalog.ts";
import type { FunnelCounters, FunnelSnapshot } from "./funnel-telemetry.ts";

type ProductCounters = Pick<FunnelCounters,
  "requests" | "challenges_402" | "signed_requests" | "signed_successes" |
  "preflight_rejections" | "rate_limited" | "server_errors">;

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
  return {
    ...baseline,
    epoch_id: Number(epochId),
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
    by_discovery_channel: baseline.by_discovery_channel || {} as FunnelSnapshot["by_discovery_channel"],
    by_discovery_client_class: baseline.by_discovery_client_class || {} as FunnelSnapshot["by_discovery_client_class"],
    by_cohort: baseline.by_cohort || {},
    by_discovery_cohort: baseline.by_discovery_cohort || {},
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
