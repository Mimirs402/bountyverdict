export const MCP_MARKETPLACE_MAX_PAGE_BYTES = 2_000_000;

export type McpMarketplaceListing = {
  listed: true;
  contract_verified: boolean;
  status: string;
  version: string;
  install_count: number;
  security_score: number;
  risk_level: "low";
  remote_probe_succeeded: boolean;
  remote_probe_tool_count: number;
  remote_probe_response_time_ms: number;
  pricing_type: string;
  price_cents: number;
  pricing_disclosure_accurate: boolean;
  pricing_disclosure_state: "accurate" | "misclassified_free";
  claimed: boolean;
  import_source: string;
  created_at: string;
};

export type McpMarketplaceSearchObservation = {
  ranking_mode: "semantic" | "substring";
  total_matches: number;
  returned: number;
  rank: number | null;
};

export function parseMcpMarketplaceSearchResponse(
  value: unknown,
  expectedSlug: string,
  expectedLimit: number,
): McpMarketplaceSearchObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP Marketplace search response is not an object.");
  }
  const payload = value as Record<string, any>;
  if (!Number.isSafeInteger(expectedLimit) || expectedLimit < 1 || expectedLimit > 25 ||
    !Number.isSafeInteger(payload.total_matches) || payload.total_matches < 0 || payload.total_matches > 1_000_000 ||
    payload.page !== 1 || payload.limit !== expectedLimit ||
    !Number.isSafeInteger(payload.returned) || payload.returned < 0 || payload.returned > expectedLimit ||
    !["semantic", "substring"].includes(payload.ranking_mode) || typeof payload.has_more !== "boolean" ||
    !Array.isArray(payload.results) || payload.results.length !== payload.returned || payload.results.length > expectedLimit) {
    throw new Error("MCP Marketplace search response is malformed or unbounded.");
  }
  const slugs = payload.results.map((result: unknown) => {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("MCP Marketplace search result is malformed.");
    }
    const record = result as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name || record.name.length > 500 ||
      typeof record.slug !== "string" || !record.slug || record.slug.length > 500 ||
      typeof record.url !== "string" || !record.url.startsWith("https://mcp-marketplace.io/server/") || record.url.length > 2_048 ||
      typeof record.tagline !== "string" || record.tagline.length > 2_000 ||
      typeof record.pricing !== "string" || record.pricing.length > 100 ||
      typeof record.security_score !== "number" || !Number.isFinite(record.security_score) || record.security_score < 0 || record.security_score > 10 ||
      !Number.isSafeInteger(record.critical_findings) || Number(record.critical_findings) < 0 || Number(record.critical_findings) > 10_000 ||
      typeof record.has_critical_findings !== "boolean") {
      throw new Error("MCP Marketplace search result fields are malformed or unbounded.");
    }
    return record.slug as string;
  });
  if (new Set(slugs).size !== slugs.length) throw new Error("MCP Marketplace search duplicated a server.");
  const matches = slugs.flatMap((slug, index) => slug === expectedSlug ? [index + 1] : []);
  if (matches.length > 1) throw new Error("MCP Marketplace search duplicated the expected listing.");
  return {
    ranking_mode: payload.ranking_mode,
    total_matches: payload.total_matches,
    returned: payload.returned,
    rank: matches[0] || null,
  };
}

function extractFlightPayload(html: string, markerIndex: number): string {
  const scriptPrefix = "<script>self.__next_f.push(";
  const scriptStart = html.lastIndexOf(scriptPrefix, markerIndex);
  const scriptEnd = scriptStart >= 0 ? html.indexOf(")</script>", markerIndex) : -1;
  if (scriptStart < 0 || markerIndex - scriptStart > 50_000 || scriptEnd < 0 || scriptEnd - scriptStart > 1_000_000) {
    throw new Error("MCP Marketplace listing payload is missing or unbounded.");
  }
  let call: unknown;
  try {
    call = JSON.parse(html.slice(scriptStart + scriptPrefix.length, scriptEnd));
  } catch {
    throw new Error("MCP Marketplace listing Flight payload is not valid JSON.");
  }
  if (!Array.isArray(call) || call.length !== 2 || call[0] !== 1 || typeof call[1] !== "string" || call[1].length > 900_000) {
    throw new Error("MCP Marketplace listing Flight payload has an invalid envelope.");
  }
  return call[1];
}

function extractJsonObject(payload: string, markerIndex: number): Record<string, any> {
  const propertyIndex = payload.lastIndexOf('"server":', markerIndex);
  const start = propertyIndex >= 0 ? payload.indexOf("{", propertyIndex + 9) : -1;
  if (propertyIndex < 0 || markerIndex - propertyIndex > 2_000 || start < 0) {
    throw new Error("MCP Marketplace server object is missing.");
  }
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < payload.length && index - start <= 500_000; index += 1) {
    const character = payload[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
      if (depth < 0) break;
    }
  }
  if (end < 0 || quoted || depth !== 0) throw new Error("MCP Marketplace server object is malformed or unbounded.");
  try {
    const parsed = JSON.parse(payload.slice(start, end));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, any>;
  } catch {
    throw new Error("MCP Marketplace server object is not valid JSON.");
  }
}

export function parseMcpMarketplaceListing(
  html: unknown,
  expectedName: string,
  expectedSlug: string,
  expectedVersion: string,
  expectedRepository: string,
  expectedEndpoint: string,
  expectedToolNames: readonly string[],
): McpMarketplaceListing {
  if (typeof html !== "string" || Buffer.byteLength(html) > MCP_MARKETPLACE_MAX_PAGE_BYTES) {
    throw new Error("MCP Marketplace page is invalid or unbounded.");
  }
  const encodedMarker = `\\"name\\":\\"${expectedName.replaceAll("/", "\\/")}\\"`;
  const plainEncodedMarker = `\\"name\\":\\"${expectedName}\\"`;
  const markers = [encodedMarker, plainEncodedMarker].filter((value, index, all) => all.indexOf(value) === index);
  const positions = markers.flatMap((marker) => {
    const found: number[] = [];
    for (let index = html.indexOf(marker); index >= 0; index = html.indexOf(marker, index + marker.length)) found.push(index);
    return found;
  });
  if (positions.length !== 1) throw new Error("MCP Marketplace page has a missing or duplicate exact listing.");
  const payload = extractFlightPayload(html, positions[0]);
  const marker = `"name":"${expectedName}"`;
  const markerIndex = payload.indexOf(marker);
  if (markerIndex < 0 || payload.indexOf(marker, markerIndex + marker.length) >= 0) {
    throw new Error("MCP Marketplace Flight payload has a missing or duplicate exact listing.");
  }
  const server = extractJsonObject(payload, markerIndex);
  const boundedText = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum;
  if (!boundedText(server.id, 100) || !boundedText(server.name, 500) || !boundedText(server.slug, 500) ||
    !boundedText(server.tagline, 1_000) || !boundedText(server.description, 10_000) ||
    !boundedText(server.status, 100) || !boundedText(server.version, 100) ||
    !boundedText(server.created_at, 100) || !Number.isFinite(Date.parse(server.created_at)) ||
    !Number.isSafeInteger(server.install_count) || server.install_count < 0 || server.install_count > 1_000_000_000 ||
    typeof server.security_score !== "number" || !Number.isFinite(server.security_score) || server.security_score < 0 || server.security_score > 10 ||
    !Number.isSafeInteger(server.price_cents) || server.price_cents < 0 || server.price_cents > 100_000_000 ||
    !boundedText(server.pricing_type, 100) || !boundedText(server.import_source, 100)) {
    throw new Error("MCP Marketplace listing fields are malformed or unbounded.");
  }
  const report = server.security_report;
  const probe = report?.remote_probe;
  if (!report || typeof report !== "object" || Array.isArray(report) ||
    report.overall_score !== server.security_score || report.risk_level !== "low" ||
    !probe || typeof probe !== "object" || Array.isArray(probe) ||
    probe.probe_succeeded !== true || probe.protocol_version !== "2025-11-25" ||
    !Number.isSafeInteger(probe.tool_count) || probe.tool_count < 0 || probe.tool_count > 100 ||
    !Array.isArray(probe.tool_names) || probe.tool_names.length > 100 ||
    probe.tool_names.some((name: unknown) => !boundedText(name, 200)) ||
    !Number.isSafeInteger(probe.response_time_ms) || probe.response_time_ms < 0 || probe.response_time_ms > 300_000 ||
    !boundedText(probe.endpoint_url, 2_048)) {
    throw new Error("MCP Marketplace security or remote-probe evidence is malformed.");
  }
  const installServers = server.install_config?.mcpServers;
  const installConfig = installServers?.[expectedSlug];
  const technicalContractVerified = server.name === expectedName && server.slug === expectedSlug &&
    server.status === "approved" && server.version === expectedVersion && server.github_url === expectedRepository &&
    server.import_source === "registry" && server.remote_url === expectedEndpoint &&
    installServers && typeof installServers === "object" && !Array.isArray(installServers) &&
    Object.keys(installServers).length === 1 && installConfig?.url === expectedEndpoint &&
    Object.keys(installConfig || {}).length === 1 &&
    report.summary === "Valid MCP server (1 strong, 1 medium validity signals). No known CVEs in dependencies. Imported from the Official MCP Registry." &&
    probe.server_name === "BountyVerdict" && probe.endpoint_url === expectedEndpoint &&
    probe.tool_count === expectedToolNames.length && JSON.stringify(probe.tool_names) === JSON.stringify(expectedToolNames);
  const pricingDisclosureAccurate = !(server.pricing_type === "free" && server.price_cents === 0);
  return {
    listed: true,
    contract_verified: technicalContractVerified,
    status: server.status,
    version: server.version,
    install_count: server.install_count,
    security_score: server.security_score,
    risk_level: report.risk_level,
    remote_probe_succeeded: probe.probe_succeeded,
    remote_probe_tool_count: probe.tool_count,
    remote_probe_response_time_ms: probe.response_time_ms,
    pricing_type: server.pricing_type,
    price_cents: server.price_cents,
    pricing_disclosure_accurate: pricingDisclosureAccurate,
    pricing_disclosure_state: pricingDisclosureAccurate ? "accurate" : "misclassified_free",
    claimed: server.claimed_at !== null,
    import_source: server.import_source,
    created_at: server.created_at,
  };
}
