import { PRODUCT_CATALOG, PRODUCT_KEYS, productForTransport, type ProductKey } from "./product-catalog.ts";

export const FUNNEL_SCHEMA_VERSION = 2 as const;
const FUNNEL_PRIVACY = "Aggregate REST, discovery, and MCP funnel counts only; raw URLs, query values, tool arguments, bodies, declared client names and versions, headers, payment payloads, payer addresses, IP addresses, geolocation, visitor IDs, and full user-agent strings are discarded. MCP initialize client names are reduced to an allowlisted family before logging.";

export const FUNNEL_SOURCE_CATEGORIES = Object.freeze([
  "owner_automation",
  "known_directory",
  "automated_client",
  "interactive_client",
  "unknown",
] as const);
export const FUNNEL_CLIENT_CLASSES = Object.freeze([
  "owner_automation",
  "agent402",
  "x402_observer",
  "registry_crawler",
  "agent_runtime",
  "generic_automation",
  "browser",
  "unknown",
  "legacy_unclassified",
] as const);
export const FUNNEL_CHANNELS = Object.freeze([
  "owner_automation",
  "coinbase_bazaar",
  "index_402",
  "x402scan",
  "x402gle",
  "the402",
  "near_market",
  "payan",
  "skills_sh",
  "agent_plugins",
  "kiro_power",
  "agent_skills_marketplace",
  "cline_marketplace",
  "kilo_marketplace",
  "cursor_deeplink",
  "vscode_deeplink",
  "openhands_integrations",
  "goose_extensions",
  "glama",
  "github",
  "web_search",
  "agent402",
  "x402_observer",
  "registry_or_directory",
  "direct_or_hidden",
  "other_referrer",
  "legacy_unclassified",
] as const);
export const MCP_NON_BUYER_CHANNELS = Object.freeze([
  "owner_automation",
  "glama",
  "x402_observer",
  "registry_or_directory",
] as const satisfies readonly FunnelChannel[]);
const DISCOVERY_NON_BUYER_CHANNELS = new Set<FunnelChannel>([
  "owner_automation",
  "x402_observer",
  "registry_or_directory",
]);
const AGENT402_HEALTH_SURFACES = new Set<FunnelDiscoverySurface>([
  "openapi",
  "well_known_x402_probe",
]);
export const FUNNEL_INPUT_PROFILES = Object.freeze([
  "complete_expected",
  "missing_required",
  "malformed_expected",
  "body_unobservable",
  "legacy_unclassified",
] as const);
export const FUNNEL_PAYMENT_CARRIERS = Object.freeze([
  "none",
  "payment_signature_v2",
  "x_payment_legacy",
  "ambiguous_multiple",
  "legacy_unclassified",
] as const);
export const FUNNEL_RESPONSE_PREFERENCES = Object.freeze([
  "json",
  "event_stream",
  "browser_html",
  "unspecified_or_other",
  "legacy_unclassified",
] as const);
export const FUNNEL_DISCOVERY_SURFACES = Object.freeze([
  "homepage",
  "openapi",
  "llms",
  "sample_single",
  "sample_portfolio",
  "sample_harness",
  "sample_skill",
  "sample_run",
  "sample_flake",
  "sample_mcpdrift",
  "well_known_x402_probe",
  "well_known_mcp_probe",
  "well_known_mcp_server_card_probe",
  "well_known_api_catalog_probe",
  "well_known_integrations_probe",
  "well_known_agent_probe",
  "well_known_ai_catalog_probe",
  "skill_md_probe",
  "agent_manifest_probe",
] as const);
export const MCP_FUNNEL_STAGES = Object.freeze([
  "initialize",
  "tools_list",
  "protocol_error",
  "tool_not_found",
  "validation_error",
  "capacity_rejected",
  "payment_required",
  "payment_present",
  "paid_success",
  "paid_error",
] as const);
export const MCP_CLIENT_FAMILIES = Object.freeze([
  "owner_automation",
  "claude",
  "codex",
  "chatgpt",
  "gemini",
  "cursor",
  "vscode",
  "mcp_inspector",
  "cloudflare_playground",
  "other_declared",
  "missing",
  "not_applicable",
] as const);
export const MCP_VALIDATION_KINDS = Object.freeze([
  "invalid_issue_url",
  "invalid_portfolio",
  "invalid_repository_url",
  "invalid_run_or_attempt",
  "invalid_mcp_snapshot",
  "schema_rejected_before_handler",
  "legacy_unclassified",
] as const);

export type FunnelSourceCategory = typeof FUNNEL_SOURCE_CATEGORIES[number];
export type FunnelClientClass = typeof FUNNEL_CLIENT_CLASSES[number];
export type FunnelChannel = typeof FUNNEL_CHANNELS[number];
export type FunnelInputProfile = typeof FUNNEL_INPUT_PROFILES[number];
export type FunnelPaymentCarrier = typeof FUNNEL_PAYMENT_CARRIERS[number];
export type FunnelResponsePreference = typeof FUNNEL_RESPONSE_PREFERENCES[number];
export type FunnelDiscoverySurface = typeof FUNNEL_DISCOVERY_SURFACES[number];
export type McpFunnelStage = typeof MCP_FUNNEL_STAGES[number];
export type McpClientFamily = typeof MCP_CLIENT_FAMILIES[number];
export type McpValidationKind = typeof MCP_VALIDATION_KINDS[number];
const MCP_SEMANTIC_VALIDATION_KIND_BY_PRODUCT = Object.freeze({
  single: "invalid_issue_url",
  portfolio: "invalid_portfolio",
  harness: "invalid_repository_url",
  run: "invalid_run_or_attempt",
  flake: "invalid_run_or_attempt",
  mcpdrift: "invalid_mcp_snapshot",
} as const satisfies Record<Exclude<ProductKey, "skill">, Exclude<McpValidationKind, "schema_rejected_before_handler" | "legacy_unclassified">>);
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
  client_class: FunnelClientClass;
  channel: FunnelChannel;
  input_profile: FunnelInputProfile;
  payment_carrier: FunnelPaymentCarrier;
  response_preference: FunnelResponsePreference;
  outcome: FunnelOutcome;
  signed_request: boolean;
};

export type FunnelDiscoveryObservation = {
  observed_at: string;
  surface: FunnelDiscoverySurface;
  source: FunnelSourceCategory;
  client_class: FunnelClientClass;
  channel: FunnelChannel;
  response_preference: FunnelResponsePreference;
  outcome: FunnelOutcome;
  signed_request: false;
};

export type McpFunnelObservation = {
  observed_at: string;
  stage: McpFunnelStage;
  product: Exclude<ProductKey, "skill"> | null;
  source: FunnelSourceCategory;
  client_class: FunnelClientClass;
  client_family: McpClientFamily;
  validation_kind: McpValidationKind | "not_applicable";
  channel: FunnelChannel;
};

export type McpFunnelCounters = Record<McpFunnelStage, number> & { events: number };

export type FunnelCounters = {
  requests: number;
  challenges_402: number;
  signed_requests: number;
  signed_successes: number;
  unsigned_successes: number;
  preflight_rejections: number;
  rate_limited: number;
  server_errors: number;
  other: number;
};

export type FunnelSnapshot = {
  schema_version: typeof FUNNEL_SCHEMA_VERSION;
  capture_started_at: string;
  enhanced_capture_started_at: string;
  cohort_capture_started_at: string;
  collector_heartbeat_at: string;
  updated_at: string;
  privacy: string;
  totals: FunnelCounters;
  by_product: Record<ProductKey, FunnelCounters>;
  by_source: Record<FunnelSourceCategory, FunnelCounters>;
  by_client_class: Record<FunnelClientClass, FunnelCounters>;
  by_channel: Record<FunnelChannel, FunnelCounters>;
  by_input_profile: Record<FunnelInputProfile, FunnelCounters>;
  by_payment_carrier: Record<FunnelPaymentCarrier, FunnelCounters>;
  by_response_preference: Record<FunnelResponsePreference, FunnelCounters>;
  by_product_source: Record<ProductKey, Record<FunnelSourceCategory, FunnelCounters>>;
  by_cohort: Record<string, FunnelCounters>;
  by_day: Record<string, FunnelCounters>;
  by_hour: Record<string, FunnelCounters>;
  discovery_totals: FunnelCounters;
  by_discovery_surface: Record<FunnelDiscoverySurface, FunnelCounters>;
  by_discovery_source: Record<FunnelSourceCategory, FunnelCounters>;
  by_discovery_client_class: Record<FunnelClientClass, FunnelCounters>;
  by_discovery_channel: Record<FunnelChannel, FunnelCounters>;
  by_discovery_surface_source: Record<FunnelDiscoverySurface, Record<FunnelSourceCategory, FunnelCounters>>;
  by_discovery_cohort: Record<string, FunnelCounters>;
  discovery_by_day: Record<string, FunnelCounters>;
  discovery_by_hour: Record<string, FunnelCounters>;
  mcp_totals: McpFunnelCounters;
  mcp_by_product: Record<Exclude<ProductKey, "skill">, McpFunnelCounters>;
  mcp_by_product_source: Record<Exclude<ProductKey, "skill">, Record<FunnelSourceCategory, McpFunnelCounters>>;
  mcp_by_source: Record<FunnelSourceCategory, McpFunnelCounters>;
  mcp_by_client_class: Record<FunnelClientClass, McpFunnelCounters>;
  mcp_by_client_family: Record<McpClientFamily, McpFunnelCounters>;
  mcp_validation_kinds: Record<McpValidationKind, number>;
  mcp_by_channel: Record<FunnelChannel, McpFunnelCounters>;
  mcp_by_day: Record<string, McpFunnelCounters>;
  mcp_by_hour: Record<string, McpFunnelCounters>;
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
  logs?: unknown;
};

const MCP_PRODUCTS = PRODUCT_KEYS.filter((product): product is Exclude<ProductKey, "skill"> => product !== "skill");

const PRODUCTION_HOST = "bountyverdict-agent-production.mimirslab.workers.dev";
const DISCOVERY_SURFACE_BY_PATH = new Map<string, FunnelDiscoverySurface>([
  ["/", "homepage"],
  ["/openapi.json", "openapi"],
  ["/llms.txt", "llms"],
  ["/api/sample", "sample_single"],
  ["/api/portfolio/sample", "sample_portfolio"],
  ["/api/harness/sample", "sample_harness"],
  ["/api/skill/sample", "sample_skill"],
  ["/api/run/sample", "sample_run"],
  ["/api/flake/sample", "sample_flake"],
  ["/api/mcp-drift/sample", "sample_mcpdrift"],
  ["/.well-known/x402", "well_known_x402_probe"],
  ["/.well-known/mcp.json", "well_known_mcp_probe"],
  ["/.well-known/mcp/server-card.json", "well_known_mcp_server_card_probe"],
  ["/.well-known/api-catalog", "well_known_api_catalog_probe"],
  ["/.well-known/integrations.json", "well_known_integrations_probe"],
  ["/.well-known/agent.json", "well_known_agent_probe"],
  ["/.well-known/ai-catalog.json", "well_known_ai_catalog_probe"],
  ["/SKILL.md", "skill_md_probe"],
  ["/agent-manifest.json", "agent_manifest_probe"],
]);
const COUNTER_KEYS = Object.freeze([
  "requests",
  "challenges_402",
  "signed_requests",
  "signed_successes",
  "unsigned_successes",
  "preflight_rejections",
  "rate_limited",
  "server_errors",
  "other",
] as const);

function emptyCounters(): FunnelCounters {
  return {
    requests: 0,
    challenges_402: 0,
    signed_requests: 0,
    signed_successes: 0,
    unsigned_successes: 0,
    preflight_rejections: 0,
    rate_limited: 0,
    server_errors: 0,
    other: 0,
  };
}

function emptyMcpCounters(): McpFunnelCounters {
  return {
    events: 0,
    initialize: 0,
    tools_list: 0,
    protocol_error: 0,
    tool_not_found: 0,
    validation_error: 0,
    capacity_rejected: 0,
    payment_required: 0,
    payment_present: 0,
    paid_success: 0,
    paid_error: 0,
  };
}

export function mcpBuyerCandidateTotals(snapshot: FunnelSnapshot): McpFunnelCounters {
  const excluded = new Set<FunnelChannel>(MCP_NON_BUYER_CHANNELS);
  const totals = emptyMcpCounters();
  const keys = ["events", ...MCP_FUNNEL_STAGES] as const;
  for (const channel of FUNNEL_CHANNELS) {
    if (excluded.has(channel)) continue;
    for (const key of keys) totals[key] += snapshot.mcp_by_channel[channel][key];
  }
  return totals;
}

export function isBuyerCandidateDiscoveryCohort(cohort: string): boolean {
  const [surface, channel, client, response, ...extra] = cohort.split("|");
  if (extra.length > 0 || !surface || !channel || !client || !response ||
    !FUNNEL_DISCOVERY_SURFACES.includes(surface as FunnelDiscoverySurface) ||
    !FUNNEL_CHANNELS.includes(channel as FunnelChannel) ||
    !FUNNEL_CLIENT_CLASSES.includes(client as FunnelClientClass) ||
    !FUNNEL_RESPONSE_PREFERENCES.includes(response as FunnelResponsePreference)) return false;
  if (DISCOVERY_NON_BUYER_CHANNELS.has(channel as FunnelChannel)) return false;
  // Agent402 continuously refreshes only these origin contracts as directory
  // health checks. Preserve its other surfaces as candidate reach so a future
  // routed agent interaction is not hidden by a broad client exclusion.
  if (channel === "agent402" && AGENT402_HEALTH_SURFACES.has(surface as FunnelDiscoverySurface)) return false;
  return true;
}

export function discoveryBuyerCandidateTotals(
  snapshot: Pick<FunnelSnapshot, "by_discovery_cohort">,
): FunnelCounters {
  const totals = emptyCounters();
  for (const [cohort, counters] of Object.entries(snapshot.by_discovery_cohort)) {
    if (!isBuyerCandidateDiscoveryCohort(cohort)) continue;
    for (const key of COUNTER_KEYS) totals[key] += counters[key];
  }
  return totals;
}

function mcpCountersRecord<K extends string>(keys: readonly K[]): Record<K, McpFunnelCounters> {
  return Object.fromEntries(keys.map((key) => [key, emptyMcpCounters()])) as Record<K, McpFunnelCounters>;
}

function countersRecord<K extends string>(keys: readonly K[]): Record<K, FunnelCounters> {
  return Object.fromEntries(keys.map((key) => [key, emptyCounters()])) as Record<K, FunnelCounters>;
}

function productSourceRecord(): Record<ProductKey, Record<FunnelSourceCategory, FunnelCounters>> {
  return Object.fromEntries(PRODUCT_KEYS.map((product) => [
    product,
    countersRecord(FUNNEL_SOURCE_CATEGORIES),
  ])) as Record<ProductKey, Record<FunnelSourceCategory, FunnelCounters>>;
}

function discoverySurfaceSourceRecord(): Record<FunnelDiscoverySurface, Record<FunnelSourceCategory, FunnelCounters>> {
  return Object.fromEntries(FUNNEL_DISCOVERY_SURFACES.map((surface) => [
    surface,
    countersRecord(FUNNEL_SOURCE_CATEGORIES),
  ])) as Record<FunnelDiscoverySurface, Record<FunnelSourceCategory, FunnelCounters>>;
}

function mcpProductSourceRecord(): Record<Exclude<ProductKey, "skill">, Record<FunnelSourceCategory, McpFunnelCounters>> {
  return Object.fromEntries(MCP_PRODUCTS.map((product) => [
    product,
    mcpCountersRecord(FUNNEL_SOURCE_CATEGORIES),
  ])) as Record<Exclude<ProductKey, "skill">, Record<FunnelSourceCategory, McpFunnelCounters>>;
}

function headersRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [name, header] of Object.entries(value)) {
    if (typeof header === "string") result[name.toLowerCase()] = header;
  }
  return result;
}

function clientClass(userAgent: string, signed: boolean): FunnelClientClass {
  if (/bountyverdict-(?:owner-audit|funnel-smoke|payment-smoke|directory-monitor|distribution-monitor|settlement-canary)/i.test(userAgent)) {
    return "owner_automation";
  }
  if (/agent402/i.test(userAgent)) return "agent402";
  if (/x402-observer/i.test(userAgent)) return "x402_observer";
  if (/(?:opendexter|x402gle|402index|tollbooth|x402dash|x402scan|x402scout|mcp-spider|smitherybot\/)/i.test(userAgent)) {
    return "registry_crawler";
  }
  if (signed || /(?:\bawal\b|agentkit|modelcontextprotocol|\bmcp\b|claude|codex|openai|gemini|langchain|crewai|autogpt|eliza|x402-client)/i.test(userAgent)) {
    return "agent_runtime";
  }
  if (/(?:bot\b|crawler|spider|python-requests|node-fetch|undici|axios|go-http-client|curl\/|wget\/)/i.test(userAgent)) {
    return "generic_automation";
  }
  if (/(?:mozilla|chrome|safari|firefox|edge)\//i.test(userAgent)) return "browser";
  return "unknown";
}

function sourceCategory(client: FunnelClientClass): FunnelSourceCategory {
  if (client === "owner_automation") return "owner_automation";
  if (client === "agent402" || client === "x402_observer" || client === "registry_crawler") return "known_directory";
  if (client === "agent_runtime" || client === "generic_automation") return "automated_client";
  if (client === "browser") return "interactive_client";
  return "unknown";
}

function referrerHost(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function channelCategory(headers: Record<string, string>, client: FunnelClientClass): FunnelChannel {
  if (client === "owner_automation") return "owner_automation";
  const host = referrerHost(headers.referer || headers.referrer || "");
  if (host) {
    if (host === "api.cdp.coinbase.com" || host.endsWith(".coinbase.com")) return "coinbase_bazaar";
    if (host === "402index.io" || host.endsWith(".402index.io")) return "index_402";
    if (host === "x402scan.com" || host.endsWith(".x402scan.com")) return "x402scan";
    if (host === "x402gle.com" || host.endsWith(".x402gle.com")) return "x402gle";
    if (host === "the402.ai" || host.endsWith(".the402.ai")) return "the402";
    if (host === "market.near.ai") return "near_market";
    if (host === "payanagent.com" || host.endsWith(".payanagent.com")) return "payan";
    if (host === "skills.sh" || host.endsWith(".skills.sh")) return "skills_sh";
    if (host === "dmgrok.github.io") return "agent_plugins";
    if (host === "github.com" || host.endsWith(".github.com") || host.endsWith(".github.io")) return "github";
    if (/(?:^|\.)(?:google|bing|duckduckgo|brave|kagi)\./.test(host)) return "web_search";
    return "other_referrer";
  }
  if (client === "agent402") return "agent402";
  if (client === "x402_observer") return "x402_observer";
  if (client === "registry_crawler") return "registry_or_directory";
  return "direct_or_hidden";
}

function canonicalGithubUrl(value: string, kind: "repo" | "issue" | "run"): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.search || url.hash) return false;
    if (kind === "repo") return /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname);
    if (kind === "issue") return /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+\/?$/.test(url.pathname);
    return /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function inputProfile(product: ProductKey, url: URL, method: string): FunnelInputProfile {
  if (method === "POST") return "body_unobservable";
  const required = product === "single" ? ["issue_url"] : product === "skill" ? ["repo_url", "skill_path"] :
    product === "harness" ? ["repo_url"] : ["run_url"];
  if (required.some((key) => !(url.searchParams.get(key) || "").trim())) return "missing_required";
  if (product === "single" && !canonicalGithubUrl(url.searchParams.get("issue_url") || "", "issue")) return "malformed_expected";
  if (product === "harness" && !canonicalGithubUrl(url.searchParams.get("repo_url") || "", "repo")) return "malformed_expected";
  if (product === "skill") {
    const skillPath = url.searchParams.get("skill_path") || "";
    if (!canonicalGithubUrl(url.searchParams.get("repo_url") || "", "repo") ||
      skillPath.startsWith("/") || skillPath.split("/").some((part) => !part || part === "." || part === "..")) {
      return "malformed_expected";
    }
  }
  if ((product === "run" || product === "flake") && !canonicalGithubUrl(url.searchParams.get("run_url") || "", "run")) {
    return "malformed_expected";
  }
  return "complete_expected";
}

function paymentCarrier(headers: Record<string, string>): FunnelPaymentCarrier {
  const v2 = Boolean(headers["payment-signature"]);
  const legacy = Boolean(headers["x-payment"]);
  if (v2 && legacy) return "ambiguous_multiple";
  if (v2) return "payment_signature_v2";
  if (legacy) return "x_payment_legacy";
  return "none";
}

function responsePreference(accept: string): FunnelResponsePreference {
  if (/text\/event-stream/i.test(accept)) return "event_stream";
  if (/application\/(?:json|[^;,]+\+json)/i.test(accept)) return "json";
  if (/text\/html/i.test(accept)) return "browser_html";
  return "unspecified_or_other";
}

function outcomeFor(status: number, signed: boolean): FunnelOutcome {
  if (status === 402) return "challenge_402";
  if (status >= 200 && status < 300) return signed ? "signed_success" : "unsigned_success";
  if (status === 400 || status === 404 || status === 405 || status === 413 || status === 422) return "preflight_rejection";
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
  const normalizedMethod = method.toUpperCase();
  const product = productForTransport(url.pathname, normalizedMethod);
  if (!product) return null;
  const headers = headersRecord(request?.headers);
  const payment = paymentCarrier(headers);
  const signed = payment !== "none";
  const client = clientClass(headers["user-agent"] || "", signed);
  const timestamp = typeof tail.eventTimestamp === "number" && Number.isFinite(tail.eventTimestamp)
    ? new Date(tail.eventTimestamp).toISOString()
    : new Date().toISOString();
  return {
    observed_at: timestamp,
    product,
    source: sourceCategory(client),
    client_class: client,
    channel: channelCategory(headers, client),
    input_profile: inputProfile(product, url, normalizedMethod),
    payment_carrier: payment,
    response_preference: responsePreference(headers.accept || ""),
    outcome: outcomeFor(status as number, signed),
    signed_request: signed,
  };
}

export function classifyDiscoveryTailEvent(value: unknown): FunnelDiscoveryObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tail = value as TailEvent;
  if (tail.scriptName !== "bountyverdict-agent-production") return null;
  const request = tail.event?.request;
  const rawUrl = request?.url;
  const method = request?.method;
  const status = tail.event?.response?.status;
  if (typeof rawUrl !== "string" || (method !== "GET" && method !== "HEAD") || !Number.isSafeInteger(status)) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.host !== PRODUCTION_HOST) return null;
  const surface = DISCOVERY_SURFACE_BY_PATH.get(url.pathname);
  if (!surface) return null;
  const headers = headersRecord(request?.headers);
  const client = clientClass(headers["user-agent"] || "", false);
  const timestamp = typeof tail.eventTimestamp === "number" && Number.isFinite(tail.eventTimestamp)
    ? new Date(tail.eventTimestamp).toISOString()
    : new Date().toISOString();
  return {
    observed_at: timestamp,
    surface,
    source: sourceCategory(client),
    client_class: client,
    channel: channelCategory(headers, client),
    response_preference: responsePreference(headers.accept || ""),
    outcome: outcomeFor(status as number, false),
    signed_request: false,
  };
}

function exactMcpLogEvent(value: unknown): {
  stage: McpFunnelStage;
  product: Exclude<ProductKey, "skill"> | null;
  source: "owner_automation" | "external";
  client_family: McpClientFamily;
  validation_kind: McpValidationKind | "not_applicable";
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const versionOne = record.schema_version === 1 && keys.join("|") === "product|schema_version|source|stage|type";
  const versionTwo = record.schema_version === 2 && keys.join("|") === "client_family|product|schema_version|source|stage|type";
  const versionThree = record.schema_version === 3 && keys.join("|") === "client_family|product|schema_version|source|stage|type|validation_kind";
  if ((!versionOne && !versionTwo && !versionThree) || record.type !== "bountyverdict_mcp_funnel" ||
    !MCP_FUNNEL_STAGES.includes(record.stage as McpFunnelStage) ||
    (record.source !== "owner_automation" && record.source !== "external")) return null;
  const stage = record.stage as McpFunnelStage;
  const product = record.product;
  if (stage === "capacity_rejected" && (!versionThree || product !== "flake")) return null;
  if (stage === "initialize" || stage === "tools_list" || stage === "protocol_error" || stage === "tool_not_found") {
    if (product !== null) return null;
  } else if (!MCP_PRODUCTS.includes(product as Exclude<ProductKey, "skill">)) return null;
  const clientFamily = (versionTwo || versionThree) && MCP_CLIENT_FAMILIES.includes(record.client_family as McpClientFamily)
    ? record.client_family as McpClientFamily
    : "not_applicable";
  if ((versionTwo || versionThree) && stage !== "initialize" && clientFamily !== "not_applicable") return null;
  if ((versionTwo || versionThree) && stage === "initialize" && clientFamily === "not_applicable") return null;
  const validationKind = versionThree
    ? record.validation_kind
    : stage === "validation_error" ? "legacy_unclassified" : "not_applicable";
  if (stage === "validation_error") {
    if (!MCP_VALIDATION_KINDS.includes(validationKind as McpValidationKind)) return null;
    if (versionThree && validationKind !== "schema_rejected_before_handler" &&
      validationKind !== MCP_SEMANTIC_VALIDATION_KIND_BY_PRODUCT[product as Exclude<ProductKey, "skill">]) return null;
  } else if (validationKind !== "not_applicable") return null;
  return {
    stage,
    product: product as Exclude<ProductKey, "skill"> | null,
    source: record.source,
    client_family: clientFamily,
    validation_kind: validationKind as McpValidationKind | "not_applicable",
  };
}

function mcpLogMessages(logs: unknown): string[] {
  if (!Array.isArray(logs)) return [];
  const messages: string[] = [];
  for (const entry of logs) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const message = (entry as { message?: unknown }).message;
    if (typeof message === "string" && message.length <= 1024) messages.push(message);
    else if (Array.isArray(message) && message.length === 1 && typeof message[0] === "string" && message[0].length <= 1024) {
      messages.push(message[0]);
    }
  }
  return messages;
}

export function classifyMcpTailEvents(value: unknown): McpFunnelObservation[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const tail = value as TailEvent;
  if (tail.scriptName !== "bountyverdict-agent-production") return [];
  const request = tail.event?.request;
  if (request?.method !== "POST" || typeof request.url !== "string") return [];
  let url: URL;
  try { url = new URL(request.url); } catch { return []; }
  if (url.protocol !== "https:" || url.host !== PRODUCTION_HOST || url.pathname !== "/mcp") return [];
  const headers = headersRecord(request.headers);
  const client = clientClass(headers["user-agent"] || "", false);
  const classifiedSource = sourceCategory(client);
  const timestamp = typeof tail.eventTimestamp === "number" && Number.isFinite(tail.eventTimestamp)
    ? new Date(tail.eventTimestamp).toISOString()
    : new Date().toISOString();
  const declaredSource = url.searchParams.size === 1 && url.searchParams.getAll("source").length === 1
    ? url.searchParams.get("source")
    : null;
  const declaredChannel: FunnelChannel | null = declaredSource === "kiro-power"
    ? "kiro_power"
    : declaredSource === "agent-skills-marketplace"
      ? "agent_skills_marketplace"
      : declaredSource === "cline-marketplace"
        ? "cline_marketplace"
        : declaredSource === "kilo-marketplace"
          ? "kilo_marketplace"
          : declaredSource === "cursor-deeplink"
            ? "cursor_deeplink"
            : declaredSource === "vscode-deeplink"
              ? "vscode_deeplink"
              : declaredSource === "openhands-integrations"
                ? "openhands_integrations"
                : declaredSource === "goose-extensions"
                  ? "goose_extensions"
                  : declaredSource === "glama-release"
                    ? "glama"
                    : declaredSource === "mcp-registry"
                      ? "registry_or_directory"
                      : null;
  const observations: McpFunnelObservation[] = [];
  for (const message of mcpLogMessages(tail.logs)) {
    let parsed: unknown;
    try { parsed = JSON.parse(message); } catch { continue; }
    const event = exactMcpLogEvent(parsed);
    if (!event) continue;
    if ((event.source === "owner_automation") !== (client === "owner_automation")) continue;
    observations.push({
      observed_at: timestamp,
      stage: event.stage,
      product: event.product,
      source: event.source === "owner_automation" ? "owner_automation" : classifiedSource,
      client_class: client,
      client_family: event.client_family,
      validation_kind: event.validation_kind,
      channel: event.source === "owner_automation"
        ? "owner_automation"
        : declaredChannel || channelCategory(headers, client),
    });
  }
  return observations;
}

export function createFunnelSnapshot(now = new Date().toISOString()): FunnelSnapshot {
  return {
    schema_version: FUNNEL_SCHEMA_VERSION,
    capture_started_at: now,
    enhanced_capture_started_at: now,
    cohort_capture_started_at: now,
    collector_heartbeat_at: now,
    updated_at: now,
    privacy: FUNNEL_PRIVACY,
    totals: emptyCounters(),
    by_product: countersRecord(PRODUCT_KEYS),
    by_source: countersRecord(FUNNEL_SOURCE_CATEGORIES),
    by_client_class: countersRecord(FUNNEL_CLIENT_CLASSES),
    by_channel: countersRecord(FUNNEL_CHANNELS),
    by_input_profile: countersRecord(FUNNEL_INPUT_PROFILES),
    by_payment_carrier: countersRecord(FUNNEL_PAYMENT_CARRIERS),
    by_response_preference: countersRecord(FUNNEL_RESPONSE_PREFERENCES),
    by_product_source: productSourceRecord(),
    by_cohort: {},
    by_day: {},
    by_hour: {},
    discovery_totals: emptyCounters(),
    by_discovery_surface: countersRecord(FUNNEL_DISCOVERY_SURFACES),
    by_discovery_source: countersRecord(FUNNEL_SOURCE_CATEGORIES),
    by_discovery_client_class: countersRecord(FUNNEL_CLIENT_CLASSES),
    by_discovery_channel: countersRecord(FUNNEL_CHANNELS),
    by_discovery_surface_source: discoverySurfaceSourceRecord(),
    by_discovery_cohort: {},
    discovery_by_day: {},
    discovery_by_hour: {},
    mcp_totals: emptyMcpCounters(),
    mcp_by_product: mcpCountersRecord(MCP_PRODUCTS),
    mcp_by_product_source: mcpProductSourceRecord(),
    mcp_by_source: mcpCountersRecord(FUNNEL_SOURCE_CATEGORIES),
    mcp_by_client_class: mcpCountersRecord(FUNNEL_CLIENT_CLASSES),
    mcp_by_client_family: mcpCountersRecord(MCP_CLIENT_FAMILIES),
    mcp_validation_kinds: Object.fromEntries(MCP_VALIDATION_KINDS.map((kind) => [kind, 0])) as Record<McpValidationKind, number>,
    mcp_by_channel: mcpCountersRecord(FUNNEL_CHANNELS),
    mcp_by_day: {},
    mcp_by_hour: {},
  };
}

function paidCohortKey(observation: FunnelObservation): string {
  return [
    observation.product,
    observation.channel,
    observation.client_class,
    observation.input_profile,
    observation.payment_carrier,
    observation.response_preference,
  ].join("|");
}

function discoveryCohortKey(observation: FunnelDiscoveryObservation): string {
  return [
    observation.surface,
    observation.channel,
    observation.client_class,
    observation.response_preference,
  ].join("|");
}

function increment(counters: FunnelCounters, observation: Pick<FunnelObservation, "signed_request" | "outcome">): void {
  counters.requests += 1;
  if (observation.signed_request) counters.signed_requests += 1;
  if (observation.outcome === "challenge_402") counters.challenges_402 += 1;
  else if (observation.outcome === "signed_success") counters.signed_successes += 1;
  else if (observation.outcome === "unsigned_success") counters.unsigned_successes += 1;
  else if (observation.outcome === "preflight_rejection") counters.preflight_rejections += 1;
  else if (observation.outcome === "rate_limited") counters.rate_limited += 1;
  else if (observation.outcome === "server_error") counters.server_errors += 1;
  else counters.other += 1;
}

export function recordFunnelObservation(snapshot: FunnelSnapshot, observation: FunnelObservation): FunnelSnapshot {
  increment(snapshot.totals, observation);
  increment(snapshot.by_product[observation.product], observation);
  increment(snapshot.by_source[observation.source], observation);
  increment(snapshot.by_client_class[observation.client_class], observation);
  increment(snapshot.by_channel[observation.channel], observation);
  increment(snapshot.by_input_profile[observation.input_profile], observation);
  increment(snapshot.by_payment_carrier[observation.payment_carrier], observation);
  increment(snapshot.by_response_preference[observation.response_preference], observation);
  increment(snapshot.by_product_source[observation.product][observation.source], observation);
  const cohort = paidCohortKey(observation);
  snapshot.by_cohort[cohort] ||= emptyCounters();
  increment(snapshot.by_cohort[cohort], observation);
  const day = observation.observed_at.slice(0, 10);
  const hour = observation.observed_at.slice(0, 13);
  snapshot.by_day[day] ||= emptyCounters();
  snapshot.by_hour[hour] ||= emptyCounters();
  increment(snapshot.by_day[day], observation);
  increment(snapshot.by_hour[hour], observation);
  for (const oldDay of Object.keys(snapshot.by_day).sort().slice(0, -90)) delete snapshot.by_day[oldDay];
  for (const oldHour of Object.keys(snapshot.by_hour).sort().slice(0, -168)) delete snapshot.by_hour[oldHour];
  snapshot.updated_at = observation.observed_at;
  return snapshot;
}

export function recordDiscoveryObservation(snapshot: FunnelSnapshot, observation: FunnelDiscoveryObservation): FunnelSnapshot {
  increment(snapshot.discovery_totals, observation);
  increment(snapshot.by_discovery_surface[observation.surface], observation);
  increment(snapshot.by_discovery_source[observation.source], observation);
  increment(snapshot.by_discovery_client_class[observation.client_class], observation);
  increment(snapshot.by_discovery_channel[observation.channel], observation);
  increment(snapshot.by_discovery_surface_source[observation.surface][observation.source], observation);
  const cohort = discoveryCohortKey(observation);
  snapshot.by_discovery_cohort[cohort] ||= emptyCounters();
  increment(snapshot.by_discovery_cohort[cohort], observation);
  const day = observation.observed_at.slice(0, 10);
  const hour = observation.observed_at.slice(0, 13);
  snapshot.discovery_by_day[day] ||= emptyCounters();
  snapshot.discovery_by_hour[hour] ||= emptyCounters();
  increment(snapshot.discovery_by_day[day], observation);
  increment(snapshot.discovery_by_hour[hour], observation);
  for (const oldDay of Object.keys(snapshot.discovery_by_day).sort().slice(0, -90)) delete snapshot.discovery_by_day[oldDay];
  for (const oldHour of Object.keys(snapshot.discovery_by_hour).sort().slice(0, -168)) delete snapshot.discovery_by_hour[oldHour];
  snapshot.updated_at = observation.observed_at;
  return snapshot;
}

function incrementMcp(counters: McpFunnelCounters, stage: McpFunnelStage): void {
  counters.events += 1;
  counters[stage] += 1;
}

export function recordMcpObservation(snapshot: FunnelSnapshot, observation: McpFunnelObservation): FunnelSnapshot {
  incrementMcp(snapshot.mcp_totals, observation.stage);
  if (observation.product) incrementMcp(snapshot.mcp_by_product[observation.product], observation.stage);
  if (observation.product) incrementMcp(snapshot.mcp_by_product_source[observation.product][observation.source], observation.stage);
  incrementMcp(snapshot.mcp_by_source[observation.source], observation.stage);
  incrementMcp(snapshot.mcp_by_client_class[observation.client_class], observation.stage);
  incrementMcp(snapshot.mcp_by_client_family[observation.client_family], observation.stage);
  if (observation.stage === "validation_error" && observation.validation_kind !== "not_applicable") {
    snapshot.mcp_validation_kinds[observation.validation_kind] += 1;
  }
  incrementMcp(snapshot.mcp_by_channel[observation.channel], observation.stage);
  const day = observation.observed_at.slice(0, 10);
  const hour = observation.observed_at.slice(0, 13);
  snapshot.mcp_by_day[day] ||= emptyMcpCounters();
  snapshot.mcp_by_hour[hour] ||= emptyMcpCounters();
  incrementMcp(snapshot.mcp_by_day[day], observation.stage);
  incrementMcp(snapshot.mcp_by_hour[hour], observation.stage);
  for (const oldDay of Object.keys(snapshot.mcp_by_day).sort().slice(0, -90)) delete snapshot.mcp_by_day[oldDay];
  for (const oldHour of Object.keys(snapshot.mcp_by_hour).sort().slice(0, -168)) delete snapshot.mcp_by_hour[oldHour];
  snapshot.updated_at = observation.observed_at;
  return snapshot;
}

function countersValid(counters: unknown): counters is FunnelCounters {
  if (!counters || typeof counters !== "object" || Array.isArray(counters)) return false;
  return COUNTER_KEYS.every((key) => Number.isSafeInteger((counters as Record<string, unknown>)[key]) &&
    Number((counters as Record<string, unknown>)[key]) >= 0);
}

function keyedCountersValid<K extends string>(value: unknown, keys: readonly K[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => countersValid(record[key]));
}

function mcpCountersValid(counters: unknown): counters is McpFunnelCounters {
  if (!counters || typeof counters !== "object" || Array.isArray(counters)) return false;
  const record = counters as Record<string, unknown>;
  return ["events", ...MCP_FUNNEL_STAGES].every((key) => Number.isSafeInteger(record[key]) && Number(record[key]) >= 0) &&
    Number(record.events) === MCP_FUNNEL_STAGES.reduce((sum, stage) => sum + Number(record[stage]), 0);
}

function migrateMcpCounters(value: unknown): McpFunnelCounters {
  const counters = emptyMcpCounters();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const stage of MCP_FUNNEL_STAGES) {
      const count = record[stage];
      if (Number.isSafeInteger(count) && Number(count) >= 0) counters[stage] = Number(count);
    }
  }
  counters.events = MCP_FUNNEL_STAGES.reduce((sum, stage) => sum + counters[stage], 0);
  return counters;
}

function migrateMcpCountersRecord<K extends string>(value: unknown, keys: readonly K[]): Record<K, McpFunnelCounters> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(keys.map((key) => [key, migrateMcpCounters(record[key])])) as Record<K, McpFunnelCounters>;
}

function migrateMcpProductSource(value: unknown): FunnelSnapshot["mcp_by_product_source"] {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(MCP_PRODUCTS.map((product) => [
    product,
    migrateMcpCountersRecord(record[product], FUNNEL_SOURCE_CATEGORIES),
  ])) as FunnelSnapshot["mcp_by_product_source"];
}

function migrateMcpBuckets(value: unknown): Record<string, McpFunnelCounters> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([bucket, counters]) => [bucket, migrateMcpCounters(counters)]));
}

function keyedMcpCountersValid<K extends string>(value: unknown, keys: readonly K[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => mcpCountersValid(record[key]));
}

function mcpValidationKindsValid(value: unknown, expectedTotal: number): value is Record<McpValidationKind, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === MCP_VALIDATION_KINDS.length && keys.every((key) => MCP_VALIDATION_KINDS.includes(key as McpValidationKind)) &&
    MCP_VALIDATION_KINDS.every((kind) => Number.isSafeInteger(record[kind]) && Number(record[kind]) >= 0) &&
    MCP_VALIDATION_KINDS.reduce((sum, kind) => sum + Number(record[kind]), 0) === expectedTotal;
}

function migrateMcpValidationKinds(value: unknown, expectedTotal: number): Record<McpValidationKind, number> {
  if (mcpValidationKindsValid(value, expectedTotal)) {
    return Object.fromEntries(MCP_VALIDATION_KINDS.map((kind) => [kind, value[kind]])) as Record<McpValidationKind, number>;
  }
  return Object.fromEntries(MCP_VALIDATION_KINDS.map((kind) => [
    kind,
    kind === "legacy_unclassified" ? expectedTotal : 0,
  ])) as Record<McpValidationKind, number>;
}

export function isFunnelSnapshot(value: unknown): value is FunnelSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<FunnelSnapshot>;
  if (snapshot.schema_version !== FUNNEL_SCHEMA_VERSION || typeof snapshot.capture_started_at !== "string" ||
    typeof snapshot.enhanced_capture_started_at !== "string" || typeof snapshot.cohort_capture_started_at !== "string" ||
    typeof snapshot.collector_heartbeat_at !== "string" || !Number.isFinite(Date.parse(snapshot.collector_heartbeat_at)) ||
    typeof snapshot.updated_at !== "string" ||
    typeof snapshot.privacy !== "string" || !countersValid(snapshot.totals)) return false;
  if (!keyedCountersValid(snapshot.by_product, PRODUCT_KEYS) ||
    !keyedCountersValid(snapshot.by_source, FUNNEL_SOURCE_CATEGORIES) ||
    !keyedCountersValid(snapshot.by_client_class, FUNNEL_CLIENT_CLASSES) ||
    !keyedCountersValid(snapshot.by_channel, FUNNEL_CHANNELS) ||
    !keyedCountersValid(snapshot.by_input_profile, FUNNEL_INPUT_PROFILES) ||
    !keyedCountersValid(snapshot.by_payment_carrier, FUNNEL_PAYMENT_CARRIERS) ||
    !keyedCountersValid(snapshot.by_response_preference, FUNNEL_RESPONSE_PREFERENCES) ||
    !countersValid(snapshot.discovery_totals) ||
    !keyedCountersValid(snapshot.by_discovery_surface, FUNNEL_DISCOVERY_SURFACES) ||
    !keyedCountersValid(snapshot.by_discovery_source, FUNNEL_SOURCE_CATEGORIES) ||
    !keyedCountersValid(snapshot.by_discovery_client_class, FUNNEL_CLIENT_CLASSES) ||
    !keyedCountersValid(snapshot.by_discovery_channel, FUNNEL_CHANNELS) ||
    !mcpCountersValid(snapshot.mcp_totals) ||
    !keyedMcpCountersValid(snapshot.mcp_by_product, MCP_PRODUCTS) ||
    !keyedMcpCountersValid(snapshot.mcp_by_source, FUNNEL_SOURCE_CATEGORIES) ||
    !keyedMcpCountersValid(snapshot.mcp_by_client_class, FUNNEL_CLIENT_CLASSES) ||
    !keyedMcpCountersValid(snapshot.mcp_by_client_family, MCP_CLIENT_FAMILIES) ||
    !keyedMcpCountersValid(snapshot.mcp_by_channel, FUNNEL_CHANNELS) ||
    !mcpValidationKindsValid(snapshot.mcp_validation_kinds, snapshot.mcp_totals.validation_error)) return false;
  if (!snapshot.mcp_by_product_source || typeof snapshot.mcp_by_product_source !== "object" ||
    !MCP_PRODUCTS.every((product) => keyedMcpCountersValid(snapshot.mcp_by_product_source?.[product], FUNNEL_SOURCE_CATEGORIES))) return false;
  if (!snapshot.by_discovery_surface_source || typeof snapshot.by_discovery_surface_source !== "object" ||
    !FUNNEL_DISCOVERY_SURFACES.every((surface) =>
      keyedCountersValid(snapshot.by_discovery_surface_source?.[surface], FUNNEL_SOURCE_CATEGORIES))) return false;
  if (!snapshot.by_product_source || typeof snapshot.by_product_source !== "object" ||
    !PRODUCT_KEYS.every((product) => keyedCountersValid(snapshot.by_product_source?.[product], FUNNEL_SOURCE_CATEGORIES))) return false;
  const cohortRecordValid = (cohorts: unknown, parts: number) => Boolean(cohorts && typeof cohorts === "object" &&
    !Array.isArray(cohorts) && Object.entries(cohorts).every(([key, counters]) =>
      key.split("|").length === parts && countersValid(counters)));
  if (!cohortRecordValid(snapshot.by_cohort, 6) || !cohortRecordValid(snapshot.by_discovery_cohort, 4)) return false;
  const bucketValid = (buckets: unknown, pattern: RegExp) => Boolean(buckets && typeof buckets === "object" && !Array.isArray(buckets) &&
    Object.entries(buckets).every(([bucket, counters]) => pattern.test(bucket) && countersValid(counters)));
  const mcpBucketValid = (buckets: unknown, pattern: RegExp) => Boolean(buckets && typeof buckets === "object" && !Array.isArray(buckets) &&
    Object.entries(buckets).every(([bucket, counters]) => pattern.test(bucket) && mcpCountersValid(counters)));
  return bucketValid(snapshot.by_day, /^\d{4}-\d{2}-\d{2}$/) &&
    bucketValid(snapshot.discovery_by_day, /^\d{4}-\d{2}-\d{2}$/) &&
    bucketValid(snapshot.by_hour, /^\d{4}-\d{2}-\d{2}T\d{2}$/) &&
    bucketValid(snapshot.discovery_by_hour, /^\d{4}-\d{2}-\d{2}T\d{2}$/) &&
    mcpBucketValid(snapshot.mcp_by_day, /^\d{4}-\d{2}-\d{2}$/) &&
    mcpBucketValid(snapshot.mcp_by_hour, /^\d{4}-\d{2}-\d{2}T\d{2}$/);
}

type LegacySnapshot = {
  schema_version: 1;
  capture_started_at: string;
  updated_at: string;
  totals: Record<string, unknown>;
  by_product: Record<string, Record<string, unknown>>;
  by_source: Record<string, Record<string, unknown>>;
};

function migrateCounters(value: Record<string, unknown> | undefined): FunnelCounters {
  const counters = emptyCounters();
  for (const key of COUNTER_KEYS) {
    const count = value?.[key];
    if (Number.isSafeInteger(count) && Number(count) >= 0) counters[key] = Number(count);
  }
  return counters;
}

export function loadFunnelSnapshot(value: unknown, now = new Date().toISOString()): FunnelSnapshot | null {
  if (isFunnelSnapshot(value)) return value.privacy === FUNNEL_PRIVACY ? value : { ...value, privacy: FUNNEL_PRIVACY };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if ((value as { schema_version?: unknown }).schema_version === FUNNEL_SCHEMA_VERSION) {
    const existing = value as Record<string, unknown>;
    const migratedMcpTotals = migrateMcpCounters(existing.mcp_totals);
    const upgraded = {
      ...existing,
      privacy: FUNNEL_PRIVACY,
      discovery_totals: existing.discovery_totals || emptyCounters(),
      by_channel: { ...countersRecord(FUNNEL_CHANNELS), ...((existing.by_channel as object) || {}) },
      by_discovery_surface: { ...countersRecord(FUNNEL_DISCOVERY_SURFACES), ...((existing.by_discovery_surface as object) || {}) },
      by_discovery_source: existing.by_discovery_source || countersRecord(FUNNEL_SOURCE_CATEGORIES),
      by_discovery_client_class: existing.by_discovery_client_class || countersRecord(FUNNEL_CLIENT_CLASSES),
      by_discovery_channel: { ...countersRecord(FUNNEL_CHANNELS), ...((existing.by_discovery_channel as object) || {}) },
      by_discovery_surface_source: { ...discoverySurfaceSourceRecord(), ...((existing.by_discovery_surface_source as object) || {}) },
      cohort_capture_started_at: existing.cohort_capture_started_at || now,
      collector_heartbeat_at: typeof existing.collector_heartbeat_at === "string"
        ? existing.collector_heartbeat_at
        : existing.updated_at,
      by_cohort: existing.by_cohort || {},
      by_discovery_cohort: existing.by_discovery_cohort || {},
      discovery_by_day: existing.discovery_by_day || {},
      discovery_by_hour: existing.discovery_by_hour || {},
      by_hour: existing.by_hour || {},
      mcp_totals: migratedMcpTotals,
      mcp_by_product: migrateMcpCountersRecord(existing.mcp_by_product, MCP_PRODUCTS),
      mcp_by_product_source: migrateMcpProductSource(existing.mcp_by_product_source),
      mcp_by_source: migrateMcpCountersRecord(existing.mcp_by_source, FUNNEL_SOURCE_CATEGORIES),
      mcp_by_client_class: migrateMcpCountersRecord(existing.mcp_by_client_class, FUNNEL_CLIENT_CLASSES),
      mcp_by_client_family: migrateMcpCountersRecord(existing.mcp_by_client_family, MCP_CLIENT_FAMILIES),
      mcp_validation_kinds: migrateMcpValidationKinds(existing.mcp_validation_kinds, migratedMcpTotals.validation_error),
      mcp_by_channel: migrateMcpCountersRecord(existing.mcp_by_channel, FUNNEL_CHANNELS),
      mcp_by_day: migrateMcpBuckets(existing.mcp_by_day),
      mcp_by_hour: migrateMcpBuckets(existing.mcp_by_hour),
    };
    if (isFunnelSnapshot(upgraded)) return upgraded;
  }
  const legacy = value as LegacySnapshot;
  if (legacy.schema_version !== 1 || typeof legacy.capture_started_at !== "string" ||
    typeof legacy.updated_at !== "string" || !legacy.totals || !legacy.by_product || !legacy.by_source) return null;
  const snapshot = createFunnelSnapshot(now);
  snapshot.capture_started_at = legacy.capture_started_at;
  snapshot.collector_heartbeat_at = legacy.updated_at;
  snapshot.updated_at = legacy.updated_at;
  snapshot.totals = migrateCounters(legacy.totals);
  for (const product of PRODUCT_KEYS) snapshot.by_product[product] = migrateCounters(legacy.by_product[product]);
  for (const source of FUNNEL_SOURCE_CATEGORIES) snapshot.by_source[source] = migrateCounters(legacy.by_source[source]);
  snapshot.by_client_class.legacy_unclassified = { ...snapshot.totals };
  snapshot.by_channel.legacy_unclassified = { ...snapshot.totals };
  snapshot.by_input_profile.legacy_unclassified = { ...snapshot.totals };
  snapshot.by_payment_carrier.legacy_unclassified = { ...snapshot.totals };
  snapshot.by_response_preference.legacy_unclassified = { ...snapshot.totals };
  return snapshot;
}
