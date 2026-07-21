export const TOOLHIVE_SERVER_NAME = "io.github.stacklok/bountyverdict";
export const TOOLHIVE_SERVER_VERSION = "1.1.4";
export const TOOLHIVE_TOOLS = Object.freeze([
  "check_github_bounty",
  "rank_github_bounties",
  "audit_agent_harness",
  "diagnose_github_actions_run",
  "classify_github_actions_flake",
  "check_mcp_tool_drift",
] as const);

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ToolHive ${name} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function stringList(value: unknown, name: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`ToolHive ${name} is malformed.`);
  }
  const actual = [...value] as string[];
  if (new Set(actual).size !== actual.length) throw new Error(`ToolHive ${name} contains duplicates.`);
  return actual;
}

function exactStrings(value: unknown, expected: readonly string[], name: string): string[] {
  const actual = stringList(value, name, expected.length);
  if (actual.length !== expected.length ||
    [...actual].sort().some((entry, index) => entry !== [...expected].sort()[index])) {
    throw new Error(`ToolHive ${name} does not match the exact contract.`);
  }
  return actual;
}

function requiredStrings(value: unknown, required: readonly string[], name: string): string[] {
  const actual = stringList(value, name, 20);
  if (required.some((entry) => !actual.includes(entry))) {
    throw new Error(`ToolHive ${name} omits required discovery metadata.`);
  }
  return actual;
}

export function parseToolHiveCatalogEntry(
  value: unknown,
  repository: string,
  endpoint: string,
): Record<string, unknown> {
  const entry = record(value, "catalog entry");
  const repositoryRecord = record(entry.repository, "repository");
  if (entry.name !== TOOLHIVE_SERVER_NAME || entry.version !== TOOLHIVE_SERVER_VERSION ||
    repositoryRecord.source !== "github" || repositoryRecord.url !== repository) {
    throw new Error("ToolHive catalog identity or release drifted.");
  }
  if (!Array.isArray(entry.remotes) || entry.remotes.length !== 1) {
    throw new Error("ToolHive must expose exactly one remote.");
  }
  const remote = record(entry.remotes[0], "remote");
  if (remote.type !== "streamable-http" || remote.url !== endpoint) {
    throw new Error("ToolHive remote contract drifted.");
  }
  const rootMeta = record(entry._meta, "metadata");
  const publisher = record(rootMeta["io.modelcontextprotocol.registry/publisher-provided"], "publisher metadata");
  const namespace = record(publisher["io.github.stacklok"], "Stacklok metadata");
  const remoteMeta = record(namespace[endpoint], "remote metadata");
  const custom = record(remoteMeta.custom_metadata, "custom metadata");
  if (remoteMeta.tier !== "Community" || remoteMeta.status !== "Active" ||
    custom.license !== "MIT" || custom.homepage !== "https://mimirs402.github.io/bountyverdict/") {
    throw new Error("ToolHive trust metadata drifted.");
  }
  const tools = exactStrings(remoteMeta.tools, TOOLHIVE_TOOLS, "tool list");
  const tags = requiredStrings(remoteMeta.tags, [
    "remote",
    "github",
    "coding-agents",
    "continuous-integration",
    "developer-tools",
    "read-only",
    "x402",
  ], "tag list");
  return {
    listed: true,
    contract_verified: true,
    name: entry.name,
    version: entry.version,
    endpoint: remote.url,
    tool_count: tools.length,
    tools,
    tags,
    tier: remoteMeta.tier,
    status: remoteMeta.status,
  };
}
