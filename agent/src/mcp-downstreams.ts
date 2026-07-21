export type QtMcpRegistryStatus = {
  listed: boolean;
  expected_name: string;
  expected_version: string;
  expected_endpoint: string;
  observed_versions: string[];
  generated_at: string;
  server_count: number;
};

export function canReuseMcpDownstreamStatus(
  value: unknown,
  expectedName: string,
  expectedVersion: string,
  expectedEndpoint: string,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  const checkedAt = typeof status.checked_at === "string" ? Date.parse(status.checked_at) : Number.NaN;
  return Number.isFinite(checkedAt) && Number.isFinite(nowMs) && Number.isFinite(intervalMs) && intervalMs > 0 &&
    nowMs >= checkedAt && nowMs - checkedAt < intervalMs &&
    status.registry_name === expectedName &&
    status.registry_version === expectedVersion &&
    status.registry_endpoint === expectedEndpoint &&
    Boolean(status.mcpub && typeof status.mcpub === "object" && !Array.isArray(status.mcpub) &&
      (status.mcpub as Record<string, unknown>).listed === true);
}

export function parseOneMcpRegistryShow(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.length > 1_000_000) throw new Error("1MCP registry output is invalid or unbounded.");
  const start = value.indexOf("{");
  if (start < 0) throw new Error("1MCP registry output contains no JSON object.");
  const parsed = JSON.parse(value.slice(start)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("1MCP registry output is not an object.");
  return parsed as Record<string, unknown>;
}

export function parseMcpubGetResponse(value: unknown, expectedEndpoint: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mcpub response is not an object.");
  const response = value as Record<string, any>;
  const content = response.result?.content;
  if (response.jsonrpc !== "2.0" || !Array.isArray(content) || content.length !== 1 ||
    content[0]?.type !== "text" || typeof content[0]?.text !== "string" || content[0].text.length > 10_000) {
    throw new Error("mcpub response has an invalid MCP result envelope.");
  }
  const parsed = JSON.parse(content[0].text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("mcpub result is not an object.");
  const entry = parsed as Record<string, unknown>;
  if (entry.status === "not_found" && entry.url === expectedEndpoint && Object.keys(entry).length === 2) {
    return { listed: false, status: "not_found", endpoint: expectedEndpoint };
  }
  if (entry.url !== expectedEndpoint || typeof entry.description !== "string" || entry.description.length > 500 ||
    !Number.isSafeInteger(entry.submitted_at) || Number(entry.submitted_at) <= 0 ||
    (entry.source !== "archive" && entry.source !== "live (verified alive)")) {
    throw new Error("mcpub did not return the exact registered endpoint.");
  }
  return {
    listed: true,
    status: entry.source === "live (verified alive)" ? "verified_alive" : "registered",
    endpoint: expectedEndpoint,
    description: entry.description,
    submitted_at_unix: entry.submitted_at,
    source: entry.source,
  };
}

export function parseQtMcpRegistry(
  value: unknown,
  expectedName: string,
  expectedVersion: string,
  expectedEndpoint: string,
): QtMcpRegistryStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Qt Creator MCP registry is not an object.");
  const body = value as { count?: unknown; generated_at?: unknown; servers?: unknown };
  if (!Number.isSafeInteger(body.count) || Number(body.count) < 0 || Number(body.count) > 50_000) {
    throw new Error("Qt Creator MCP registry count is invalid or unbounded.");
  }
  if (typeof body.generated_at !== "string" || !Number.isFinite(Date.parse(body.generated_at))) {
    throw new Error("Qt Creator MCP registry has no valid generation timestamp.");
  }
  if (!Array.isArray(body.servers) || body.servers.length !== body.count) {
    throw new Error("Qt Creator MCP registry server list does not match its declared count.");
  }
  const matching = body.servers.filter((entry): entry is Record<string, unknown> => Boolean(
    entry && typeof entry === "object" && !Array.isArray(entry) && (entry as { name?: unknown }).name === expectedName,
  ));
  const observedVersions = [...new Set(matching.flatMap((entry) => typeof entry.version === "string" ? [entry.version] : []))].sort();
  const exact = matching.filter((entry) => entry.version === expectedVersion && entry.status === "active" &&
    Array.isArray(entry.remotes) && entry.remotes.some((remote) => remote && typeof remote === "object" && !Array.isArray(remote) &&
      (remote as { type?: unknown }).type === "streamable-http" && (remote as { url?: unknown }).url === expectedEndpoint));
  if (exact.length > 1) throw new Error("Qt Creator MCP registry duplicated the exact BountyVerdict release.");
  return {
    listed: exact.length === 1,
    expected_name: expectedName,
    expected_version: expectedVersion,
    expected_endpoint: expectedEndpoint,
    observed_versions: observedVersions,
    generated_at: body.generated_at,
    server_count: body.servers.length,
  };
}

export function glamaConnectorStatus(httpStatus: number, connectorUrl: string): Record<string, unknown> {
  if (!Number.isSafeInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) throw new Error("Glama returned an invalid HTTP status.");
  if (httpStatus !== 200 && httpStatus !== 404) throw new Error(`Glama connector lookup returned HTTP ${httpStatus}.`);
  return {
    listed: httpStatus === 200,
    status: httpStatus === 200 ? "listed" : "pending_registry_ingestion",
    connector_url: connectorUrl,
    http_status: httpStatus,
    accounting_note: "This bounded owner-run propagation check is not an impression, purchase, or revenue event.",
  };
}
