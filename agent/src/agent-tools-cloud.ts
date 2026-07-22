import { PRODUCT_CATALOG, type ProductKey } from "./product-catalog.ts";

export class AgentToolsCloudContractDrift extends Error {
  override readonly name = "AgentToolsCloudContractDrift";
}

type ExpectedResource = Readonly<{
  product: ProductKey;
  url: string;
}>;

type ParseOptions = Readonly<{
  productionOrigin: string;
  slug: string;
  revenueWallet: string;
  expectedResources: readonly ExpectedResource[];
}>;

type McpParseOptions = Readonly<{
  endpointUrl: string;
  homepageUrl: string;
  name: string;
  slug: string;
  expectedTools: readonly string[];
  expectedDescriptionPrefixes: Readonly<Record<string, string>>;
}>;

function contractDrift(message: string): never {
  throw new AgentToolsCloudContractDrift(message);
}

export function parseAgentToolsCloudListing(
  search: Record<string, any>,
  detail: Record<string, any>,
  options: ParseOptions,
): Record<string, unknown> {
  const { productionOrigin, slug, revenueWallet, expectedResources } = options;
  if (!Number.isSafeInteger(search.count) || !Array.isArray(search.services) || search.count !== search.services.length ||
    search.services.some((service: unknown) => !service || typeof service !== "object" || Array.isArray(service))) {
    contractDrift("Agent Tools Cloud search telemetry is malformed.");
  }
  const matches = search.services.filter((service: Record<string, unknown>) => service.slug === slug);
  if (matches.length !== 1 || detail.slug !== slug || detail.url !== productionOrigin ||
    detail.name !== new URL(productionOrigin).host || detail.well_known_url !== `${productionOrigin}/.well-known/x402`) {
    contractDrift("Agent Tools Cloud identity telemetry drifted.");
  }

  if (!Array.isArray(detail.resource_samples) ||
    detail.resource_samples.some((sample: unknown) => !sample || typeof sample !== "object" || Array.isArray(sample))) {
    contractDrift("Agent Tools Cloud resource telemetry is malformed or contains an unknown route.");
  }
  const sampleValues = detail.resource_samples as Array<Record<string, unknown>>;
  const sampleUrls = sampleValues.map((sample: Record<string, unknown>) => sample.url);
  const expectedByUrl = new Map(expectedResources.map((resource) => [resource.url, resource]));
  if (!Number.isSafeInteger(detail.resource_count) || detail.resource_count !== sampleUrls.length ||
    new Set(sampleUrls).size !== sampleUrls.length || sampleUrls.some((url: unknown) => !expectedByUrl.has(String(url))) ||
    sampleValues.some((sample: Record<string, unknown>) => sample.kind !== "http")) {
    contractDrift("Agent Tools Cloud resource telemetry is malformed or contains an unknown route.");
  }

  const listedProducts = sampleUrls.map((url: unknown) => expectedByUrl.get(String(url))!);
  const listedPrices = listedProducts.map(({ product }) => Number(PRODUCT_CATALOG[product].priceUsd.slice(1)));
  const payment = detail.payment;
  if (!payment || typeof payment !== "object" || Array.isArray(payment) || payment.currency !== "USDC" ||
    typeof payment.pay_to !== "string" || payment.pay_to.toLowerCase() !== revenueWallet.toLowerCase() ||
    !Array.isArray(payment.chains) || payment.chains.length !== 1 || payment.chains[0] !== "eip155:8453" ||
    !listedPrices.length || Number(payment.price_min_usd) !== Math.min(...listedPrices) ||
    Number(payment.price_max_usd) !== Math.max(...listedPrices) ||
    detail.health !== "ok" || detail.http_status !== 200 || ![0, 1].includes(detail.x402_ok)) {
    contractDrift("Agent Tools Cloud health or payment telemetry drifted.");
  }

  const missing = expectedResources
    .filter(({ url }) => !sampleUrls.includes(url))
    .map(({ product }) => product);
  const probeOk = detail.x402_ok === 1;
  const description = String(detail.description || "");
  const descriptionCoverage = /bounty/i.test(description) && /instruction/i.test(description) &&
    /actions|workflow|CI/i.test(description) && /MCP/i.test(description)
    ? "suite_wide"
    : "narrow_or_incomplete";
  const status = probeOk
    ? (missing.length ? "listed_partial" : "listed")
    : (missing.length ? "listed_partial_probe_failed" : "listed_probe_failed");

  return {
    listed: true,
    status,
    health: detail.health,
    latency_ms: Number.isFinite(detail.latency_ms) ? detail.latency_ms : null,
    http_status: detail.http_status,
    expected_resources: expectedResources.length,
    listed_resources: sampleUrls.length,
    listed_resource_urls: sampleUrls,
    missing_products: missing,
    x402_probe_ok: probeOk,
    x402_probe_status: probeOk ? "passed" : "failed",
    description_coverage: descriptionCoverage,
    payment: {
      currency: payment.currency,
      chains: payment.chains,
      pay_to: payment.pay_to,
      price_min_usd: payment.price_min_usd,
      price_max_usd: payment.price_max_usd,
    },
    checked_at_unix: detail.health_checked,
    last_seen_unix: detail.last_seen,
    measurement: "organic_catalog_health_and_resource_presence_not_impressions_purchases_or_revenue",
  };
}

export function parseAgentToolsCloudMcpListing(
  search: Record<string, any>,
  detail: Record<string, any>,
  options: McpParseOptions,
): Record<string, unknown> {
  const { endpointUrl, homepageUrl, name, slug, expectedTools, expectedDescriptionPrefixes } = options;
  if (!Number.isSafeInteger(search.count) || !Number.isSafeInteger(search.total_matched) ||
    !Array.isArray(search.servers) || search.count !== search.servers.length ||
    search.servers.some((server: unknown) => !server || typeof server !== "object" || Array.isArray(server))) {
    contractDrift("Agent Tools Cloud MCP search telemetry is malformed.");
  }
  const matches = search.servers.filter((server: Record<string, unknown>) => server.slug === slug);
  if (matches.length !== 1 || detail.slug !== slug || detail.endpoint_url !== endpointUrl ||
    detail.homepage_url !== homepageUrl || detail.name !== name ||
    detail.transport !== "streamable-http") {
    contractDrift("Agent Tools Cloud MCP identity telemetry drifted.");
  }

  if (!Array.isArray(detail.tools) ||
    detail.tools.some((tool: unknown) => !tool || typeof tool !== "object" || Array.isArray(tool) ||
      typeof (tool as Record<string, unknown>).name !== "string")) {
    contractDrift("Agent Tools Cloud MCP tool telemetry is malformed.");
  }
  const toolNames = detail.tools.map((tool: Record<string, unknown>) => String(tool.name));
  if (detail.tool_count !== toolNames.length || new Set(toolNames).size !== toolNames.length ||
    toolNames.length !== expectedTools.length || expectedTools.some((name) => !toolNames.includes(name)) ||
    detail.x402_supported !== 1 || detail.health !== "ok" || detail.http_status !== 200 ||
    detail.kind !== "callable" || detail.conformance !== "pass" || detail.safety_verdict !== "clean") {
    contractDrift("Agent Tools Cloud MCP health, safety, payment, or tool telemetry drifted.");
  }

  if (Object.keys(expectedDescriptionPrefixes).length !== expectedTools.length ||
    expectedTools.some((toolName) => typeof expectedDescriptionPrefixes[toolName] !== "string")) {
    contractDrift("Agent Tools Cloud expected MCP description revision is incomplete.");
  }
  const currentDescriptionCount = detail.tools.filter((tool: Record<string, unknown>) => {
    const toolName = String(tool.name);
    return typeof tool.description === "string" &&
      tool.description.startsWith(expectedDescriptionPrefixes[toolName]);
  }).length;
  const toolDescriptionRevision = currentDescriptionCount === expectedTools.length
    ? "agent_question_v3"
    : currentDescriptionCount === 0
      ? "stale_pre_agent_question_v3"
      : "mixed_agent_question_v3";

  return {
    listed: true,
    status: "listed",
    slug,
    endpoint_url: endpointUrl,
    transport: detail.transport,
    x402_supported: true,
    health: detail.health,
    http_status: detail.http_status,
    latency_ms: Number.isFinite(detail.latency_ms) ? detail.latency_ms : null,
    conformance: detail.conformance,
    safety_verdict: detail.safety_verdict,
    quality_score: Number.isFinite(detail.quality_score) ? detail.quality_score : null,
    expected_tools: expectedTools.length,
    listed_tools: toolNames.length,
    tool_names: toolNames,
    current_tool_descriptions: currentDescriptionCount,
    tool_description_revision: toolDescriptionRevision,
    checked_at_unix: detail.health_checked,
    last_seen_unix: detail.last_seen,
    measurement: "organic_mcp_catalog_health_and_tool_presence_not_impressions_calls_purchases_or_revenue",
  };
}

export function parseAgentToolsCloudMcpBuyerQuery(
  payload: Record<string, any>,
  acceptedSlugs: readonly string[],
): Record<string, unknown> {
  if (!Number.isSafeInteger(payload.count) || payload.count < 0 || payload.count > 100 ||
    !Number.isSafeInteger(payload.total_matched) || payload.total_matched < payload.count ||
    !Array.isArray(payload.servers) || payload.count !== payload.servers.length ||
    payload.servers.some((server: unknown) => !server || typeof server !== "object" || Array.isArray(server) ||
      typeof (server as Record<string, unknown>).slug !== "string")) {
    contractDrift("Agent Tools Cloud MCP buyer-query telemetry is malformed.");
  }
  const slugs = payload.servers.map((server: Record<string, unknown>) => String(server.slug));
  if (new Set(slugs).size !== slugs.length) contractDrift("Agent Tools Cloud MCP buyer-query results contain duplicate slugs.");
  const ranks = acceptedSlugs
    .map((slug) => slugs.indexOf(slug))
    .filter((index) => index >= 0)
    .map((index) => index + 1);
  return {
    found: ranks.length > 0,
    rank: ranks.length ? Math.min(...ranks) : null,
    returned_results: payload.count,
  };
}
