export type QtMcpRegistryStatus = {
  listed: boolean;
  expected_name: string;
  expected_version: string;
  expected_endpoint: string;
  observed_versions: string[];
  generated_at: string;
  server_count: number;
};

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
