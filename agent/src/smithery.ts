import { isDeepStrictEqual } from "node:util";

export const SMITHERY_QUALIFIED_NAME = "mimirs402/bountyverdict";
export const SMITHERY_DISPLAY_NAME = "BountyVerdict — GitHub & CI Preflight";
export const SMITHERY_DESCRIPTION = "Choose the right GitHub or CI decision tool for free, then diagnose failed GitHub Actions from a run URL, decide retry versus fix, audit AGENTS.md and CLAUDE.md, check or rank GitHub bounty issues, and detect breaking MCP tools/list changes. Six paid read-only checks plus a free selector; a first unsigned call returns the exact quote and successful authorized calls cost $0.02-$0.40 USDC via x402 on Base. No buyer API key, repository clone, code execution, or CI mutation.";
export const SMITHERY_DEPLOYMENT_URL = "https://bountyverdict--mimirs402.run.tools";

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

export const SMITHERY_TOOL_DESCRIPTIONS: Readonly<Record<typeof SMITHERY_TOOL_NAMES[number], string>> = Object.freeze({
  choose_github_agent_decision: "Call with no arguments for a free six-tool catalog, or choose the economical next call for a GitHub bounty, coding-agent instructions, failed Actions run, retry decision, or MCP tools change. Returns exact prices, samples, required fields, and unsigned-quote semantics without inspecting the target.",
  check_github_bounty: "Is this public GitHub issue bounty still claimable, or is someone already working on it? Checks current status, reward evidence, competing work, and maintainer signals; returns AVOID, CAUTION, or VIABLE. For 2-7 issues, repeated single checks cost less unless one ranked response is worth the premium; use rank_github_bounties for 8-10. Inspect a representative result before paying: https://bountyverdict-agent-production.mimirslab.workers.dev/api/sample. Exact authorization cap: 0.05 USDC.",
  rank_github_bounties: "Which public GitHub bounty should I work on next? Compares 2-10 issue URLs, chooses the strongest non-AVOID candidate or recommends none, and returns cited evidence plus partial failures. Its $0.40 price equals eight $0.05 single checks and is cheaper per candidate at 9-10; repeated check_github_bounty calls cost less for 2-7 when ranked orchestration is unnecessary. Inspect a representative result before paying: https://bountyverdict-agent-production.mimirslab.workers.dev/api/portfolio/sample. Exact authorization cap: 0.40 USDC.",
  audit_agent_harness: "Can a coding agent safely work in this public repository without missing project instructions? Audits AGENTS.md, CLAUDE.md, and related instructions at an immutable commit; does not diagnose CI. Inspect a representative result before paying: https://bountyverdict-agent-production.mimirslab.workers.dev/api/harness/sample. Exact authorization cap: 0.03 USDC.",
  diagnose_github_actions_run: "Why did this public GitHub Actions run fail, and what should I fix? Uses bounded failed-job logs and redacted evidence. Use classify_github_actions_flake only for retry-once versus fix. Inspect a representative result before paying: https://bountyverdict-agent-production.mimirslab.workers.dev/api/run/sample. Exact authorization cap: 0.04 USDC.",
  classify_github_actions_flake: "Is this failed GitHub Actions run flaky—should I retry it once or fix the code? Uses the current attempt and bounded history. Use diagnose_github_actions_run for root cause. Inspect a representative result before paying: https://bountyverdict-agent-production.mimirslab.workers.dev/api/flake/sample. Exact authorization cap: 0.07 USDC.",
  check_mcp_tool_drift: "Will upgrading to this complete MCP tools/list break my agent or weaken declared safety hints? Compares caller-supplied baseline and current snapshots; never fetches or invokes tools. Inspect a representative result before paying: https://bountyverdict-agent-production.mimirslab.workers.dev/api/mcp-drift/sample. Exact authorization cap: 0.02 USDC.",
});

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
  for (const tool of server.tools as Array<Record<string, unknown>>) {
    const name = tool.name as typeof SMITHERY_TOOL_NAMES[number];
    if (tool.description !== SMITHERY_TOOL_DESCRIPTIONS[name]) {
      throw new Error(`Smithery tool description drifted for ${name}.`);
    }
  }
  const expectedConnection = { type: "http", deploymentUrl: SMITHERY_DEPLOYMENT_URL, configSchema: {} };
  if (server.connections.length !== 1 || !isDeepStrictEqual(server.connections[0], expectedConnection)) {
    throw new Error("Smithery HTTP deployment contract drifted.");
  }
  return {
    listed: true,
    qualified_name: SMITHERY_QUALIFIED_NAME,
    display_name: server.displayName,
    description: server.description,
    remote: true,
    tool_count: names.length,
    tool_names: names,
    deployment_url: `${SMITHERY_DEPLOYMENT_URL}/`,
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
