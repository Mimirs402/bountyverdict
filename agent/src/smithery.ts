export const SMITHERY_QUALIFIED_NAME = "mimirs402/bountyverdict";
export const SMITHERY_DISPLAY_NAME = "BountyVerdict — GitHub & CI Preflight";
export const SMITHERY_DESCRIPTION = "Choose the right GitHub or CI decision tool for free, then diagnose failed GitHub Actions from a run URL, decide retry versus fix, audit AGENTS.md and CLAUDE.md, check or rank GitHub bounty issues, and detect breaking MCP tools/list changes. Six paid read-only checks plus a free selector; a first unsigned call returns the exact quote and successful authorized calls cost $0.02-$0.40 USDC via x402 on Base. No buyer API key, repository clone, code execution, or CI mutation.";

export const SMITHERY_BUYER_QUERIES = Object.freeze([
  "GitHub Actions failed workflow run URL root cause analysis",
  "CI/CD build log failure diagnosis from public URL",
  "classify CI failure transient flaky retryable vs deterministic",
  "GitHub issue bounty reward claim status",
  "GitHub issue open assigned pull request maintainer activity",
  "GitHub repository issue complexity effort estimate",
  "scan public repository for AGENTS.md and nested agent instruction files",
  "compare MCP server versions tool names input schemas and output schemas",
  "MCP server update breaking-change and agent workflow compatibility audit",
  "MCP server security audit capability permission and prompt-injection changes",
] as const);

export const SMITHERY_TOOL_NAMES = Object.freeze([
  "choose_github_agent_decision",
  "check_github_bounty",
  "rank_github_bounties",
  "audit_agent_harness",
  "diagnose_github_actions_run",
  "classify_github_actions_flake",
  "check_mcp_tool_drift",
] as const);

export function normalizeSmitheryServer(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Smithery server record is malformed.");
  }
  const server = value as Record<string, any>;
  if (server.qualifiedName !== SMITHERY_QUALIFIED_NAME || server.remote !== true ||
    server.displayName !== SMITHERY_DISPLAY_NAME ||
    server.description !== SMITHERY_DESCRIPTION ||
    !Array.isArray(server.tools) || !Array.isArray(server.connections)) {
    throw new Error("Smithery server identity or deployment contract drifted.");
  }
  const names = server.tools.map((tool: unknown) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool) ||
      typeof (tool as Record<string, unknown>).name !== "string" ||
      typeof (tool as Record<string, unknown>).description !== "string" ||
      !(tool as Record<string, string>).description.trim()) {
      throw new Error("Smithery tool catalog is malformed.");
    }
    return (tool as Record<string, string>).name;
  });
  if (new Set(names).size !== names.length ||
    names.length !== SMITHERY_TOOL_NAMES.length ||
    SMITHERY_TOOL_NAMES.some((name) => !names.includes(name))) {
    throw new Error("Smithery tool catalog drifted.");
  }
  const httpConnections = server.connections.filter((connection: unknown) =>
    connection && typeof connection === "object" && !Array.isArray(connection) &&
    (connection as Record<string, unknown>).type === "http" &&
    typeof (connection as Record<string, unknown>).deploymentUrl === "string"
  );
  if (httpConnections.length !== 1) throw new Error("Smithery HTTP deployment contract drifted.");
  const deployment = new URL(httpConnections[0].deploymentUrl);
  if (deployment.protocol !== "https:" || !deployment.hostname.endsWith(".run.tools")) {
    throw new Error("Smithery HTTP deployment origin drifted.");
  }
  return {
    listed: true,
    qualified_name: SMITHERY_QUALIFIED_NAME,
    display_name: server.displayName,
    description: server.description,
    remote: true,
    tool_count: names.length,
    tool_names: names,
    deployment_url: deployment.href,
  };
}

export function smitherySearchObservation(value: unknown, query: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !Array.isArray((value as Record<string, unknown>).servers)) {
    throw new Error("Smithery search response is malformed.");
  }
  const servers = (value as { servers: Array<Record<string, unknown>> }).servers;
  if (servers.length > 20) throw new Error("Smithery search response exceeded its bound.");
  const matches = servers.flatMap((server, index) =>
    server?.qualifiedName === SMITHERY_QUALIFIED_NAME ? [{ server, rank: index + 1 }] : []
  );
  if (matches.length > 1) throw new Error("Smithery search duplicated the exact server.");
  const match = matches[0];
  if (!match) return { query, found: false, rank: null, score: null, use_count: null };
  const useCount = match.server.useCount;
  const score = match.server.score;
  if (!Number.isSafeInteger(useCount) || Number(useCount) < 0 ||
    typeof score !== "number" || !Number.isFinite(score) || score < 0) {
    throw new Error("Smithery search counters are malformed.");
  }
  return { query, found: true, rank: match.rank, score, use_count: Number(useCount) };
}
