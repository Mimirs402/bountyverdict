export const BOUNTYVERDICT_REGISTRY_DESCRIPTION =
  "Read-only GitHub bounty, agent harness, Actions failure, flake, and MCP tool-drift decisions.";

export const BOUNTYVERDICT_AGENT_FINDER_DESCRIPTION =
  "Check whether a GitHub bounty is worth pursuing, diagnose why an Actions run failed, decide whether to retry a flake, audit AGENTS.md, or detect breaking MCP tool drift.";

export type QtMcpRegistryStatus = {
  listed: boolean;
  expected_name: string;
  expected_version: string;
  expected_endpoint: string;
  observed_versions: string[];
  generated_at: string;
  server_count: number;
};

export type McpObservatoryStatus = {
  listed: true;
  status: "repository_metadata_only" | "agent_ready";
  server_id: string;
  repository: string;
  first_seen: string;
  last_seen: string;
  current_version: string | null;
  release_versions: string[];
  tags: string[];
  language: string | null;
  license: string | null;
  endpoint_exposed: boolean;
  tool_schemas_exposed: boolean;
};

export type AwesomeMcpServersStatus = {
  listed: boolean;
  contract_verified: boolean;
  skillverdict_contamination_risk: boolean;
  repository: string;
  endpoint: string;
};

export type TensorBlockSearchStatus = {
  listed: boolean;
  status: "listed" | "not_indexed";
  id: string;
  repository: string;
  source_pull_request: number | null;
  profile_path: string | null;
  web_profile_url: string | null;
};

export type TensorBlockProfileStatus = {
  contract_verified: boolean;
  id: string;
  repository: string | null;
  endpoint: string | null;
  transport: string[];
  auth_type: string | null;
  license: string | null;
};

export type DockerMcpRegistryStatus = {
  listed: boolean;
  contract_verified: boolean;
  endpoint: string;
  skillverdict_contamination_risk: boolean;
};

export type McpServersOrgStatus = {
  listed: boolean;
  repository_metadata_verified: boolean;
  contract_verified: boolean;
  repository: string;
  endpoint: string;
  skillverdict_contamination_risk: boolean;
};

export type McpDirectoryStatus = {
  listed: boolean;
  repository_metadata_verified: boolean;
  remote_metadata_verified: boolean;
  repository: string;
  endpoint: string;
  skillverdict_contamination_risk: boolean;
};

export type ClineMarketplaceStatus = {
  listed: boolean;
  contract_verified: boolean;
  id: string;
  repository: string;
  endpoint: string;
  install_command: string;
  skillverdict_contamination_risk: boolean;
};

export type KiloMarketplaceStatus = {
  listed: boolean;
  contract_verified: boolean;
  id: string;
  repository: string;
  endpoint: string;
  skillverdict_contamination_risk: boolean;
};

export type AgentFinderCatalogEntryStatus = {
  listed: true;
  contract_verified: boolean;
  identifier: string | null;
  definition_url: string | null;
};

export type AgentFinderRegistryStatus = {
  contract_verified: boolean;
  name: string | null;
  version: string | null;
  endpoint: string | null;
  active: boolean;
  latest: boolean;
};

export type AgentFinderSearchStatus = {
  listed: boolean;
  contract_verified: boolean;
  rank: number | null;
  total_results: number;
  identifier: string | null;
  definition_url: string | null;
};

export function parseAgentFinderCatalogEntry(
  value: unknown,
  expectedIdentifier: string,
  expectedDefinitionUrl: string,
  expectedServerName: string,
): AgentFinderCatalogEntryStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent Finder catalog entry is not an object.");
  }
  const entry = value as Record<string, any>;
  if (typeof entry.identifier !== "string" || entry.identifier.length > 500 ||
    typeof entry.displayName !== "string" || entry.displayName.length > 200 ||
    typeof entry.mediaType !== "string" || entry.mediaType.length > 200 ||
    typeof entry.url !== "string" || entry.url.length > 2_048 ||
    typeof entry.description !== "string" || entry.description.length > 1_000 ||
    !entry.metadata || typeof entry.metadata !== "object" || Array.isArray(entry.metadata)) {
    throw new Error("Agent Finder catalog entry is malformed or unbounded.");
  }
  const contractVerified = entry.identifier === expectedIdentifier &&
    entry.displayName === "BountyVerdict Agent Decision Tools" &&
    entry.mediaType === "application/mcp-server+json" &&
    entry.url === expectedDefinitionUrl &&
    entry.description === BOUNTYVERDICT_AGENT_FINDER_DESCRIPTION &&
    entry.metadata.sourceSet === "bountyverdict" &&
    entry.metadata.repoPath === "server.json" &&
    entry.metadata.serverName === expectedServerName &&
    entry.metadata.version === "latest";
  return {
    listed: true,
    contract_verified: contractVerified,
    identifier: entry.identifier,
    definition_url: entry.url,
  };
}

export function parseAgentFinderRegistryLatest(
  value: unknown,
  expectedServerName: string,
  expectedRepository: string,
  expectedEndpoint: string,
): AgentFinderRegistryStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent Finder MCP Registry response is not an object.");
  }
  const payload = value as Record<string, any>;
  const server = payload.server;
  const official = payload._meta?.["io.modelcontextprotocol.registry/official"];
  if (!server || typeof server !== "object" || Array.isArray(server) ||
    typeof server.name !== "string" || server.name.length > 500 ||
    typeof server.title !== "string" || server.title.length > 200 ||
    typeof server.description !== "string" || server.description.length > 1_000 ||
    typeof server.version !== "string" || !server.version || server.version.length > 100 ||
    !server.repository || typeof server.repository !== "object" || Array.isArray(server.repository) ||
    !Array.isArray(server.remotes) || server.remotes.length > 20 ||
    server.remotes.some((remote: unknown) => !remote || typeof remote !== "object" || Array.isArray(remote) ||
      typeof (remote as Record<string, unknown>).type !== "string" ||
      typeof (remote as Record<string, unknown>).url !== "string" ||
      String((remote as Record<string, unknown>).url).length > 2_048) ||
    !official || typeof official !== "object" || Array.isArray(official)) {
    throw new Error("Agent Finder MCP Registry response is malformed or unbounded.");
  }
  const matchingRemotes = server.remotes.filter((remote: Record<string, unknown>) =>
    remote.type === "streamable-http" && remote.url === expectedEndpoint
  );
  const active = official.status === "active";
  const latest = official.isLatest === true;
  return {
    contract_verified: server.name === expectedServerName &&
      server.title === "BountyVerdict Agent Decision Tools" &&
      server.description === BOUNTYVERDICT_REGISTRY_DESCRIPTION &&
      server.repository.url === expectedRepository && server.repository.source === "github" &&
      matchingRemotes.length === 1 && active && latest,
    name: server.name,
    version: server.version,
    endpoint: matchingRemotes.length === 1 ? expectedEndpoint : null,
    active,
    latest,
  };
}

export function parseAgentFinderSearchPage(
  html: unknown,
  expectedIdentifier: string,
  expectedDefinitionUrl: string,
): AgentFinderSearchStatus {
  if (typeof html !== "string" || html.length > 5_000_000) {
    throw new Error("Agent Finder search page is invalid or unbounded.");
  }
  const marker = 'data-target="react-app.embeddedData"';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0 || html.indexOf(marker, markerIndex + marker.length) >= 0) {
    throw new Error("Agent Finder search page has missing or duplicate embedded data.");
  }
  const scriptStart = html.lastIndexOf("<script", markerIndex);
  const bodyStart = html.indexOf(">", markerIndex);
  const bodyEnd = bodyStart >= 0 ? html.indexOf("</script>", bodyStart + 1) : -1;
  if (scriptStart < 0 || markerIndex - scriptStart > 1_000 || bodyStart < 0 || bodyEnd < 0 || bodyEnd - bodyStart > 2_000_000) {
    throw new Error("Agent Finder search page embedded data is malformed or unbounded.");
  }
  let embedded: Record<string, any>;
  try {
    embedded = JSON.parse(html.slice(bodyStart + 1, bodyEnd)) as Record<string, any>;
  } catch {
    throw new Error("Agent Finder search page embedded data is not valid JSON.");
  }
  const serversData = embedded?.payload?.agentFinderRoute?.serversData;
  const servers = serversData?.servers;
  const metadata = serversData?.metadata;
  if (!Array.isArray(servers) || servers.length > 100 ||
    !metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
    !Number.isSafeInteger(metadata.count) || metadata.count !== servers.length ||
    !Number.isSafeInteger(metadata.total) || metadata.total < 0 || metadata.total > 1_000_000 ||
    servers.some((server: unknown) => !server || typeof server !== "object" || Array.isArray(server) ||
      typeof (server as Record<string, unknown>).id !== "string" || String((server as Record<string, unknown>).id).length > 500 ||
      typeof (server as Record<string, unknown>).display_name !== "string" || String((server as Record<string, unknown>).display_name).length > 200 ||
      typeof (server as Record<string, unknown>).description !== "string" || String((server as Record<string, unknown>).description).length > 1_000 ||
      typeof (server as Record<string, unknown>).url !== "string" || String((server as Record<string, unknown>).url).length > 2_048 ||
      typeof (server as Record<string, unknown>).extension_type !== "string" || String((server as Record<string, unknown>).extension_type).length > 200)) {
    throw new Error("Agent Finder search results are malformed or unbounded.");
  }
  const matches = servers
    .map((entry: Record<string, unknown>, index: number) => ({ entry, rank: index + 1 }))
    .filter(({ entry }) => entry.id === expectedIdentifier || entry.url === expectedDefinitionUrl ||
      entry.display_name === "BountyVerdict Agent Decision Tools");
  if (matches.length > 1) throw new Error("Agent Finder search duplicated the BountyVerdict entry.");
  if (matches.length === 0) {
    return {
      listed: false,
      contract_verified: false,
      rank: null,
      total_results: metadata.total,
      identifier: null,
      definition_url: null,
    };
  }
  const { entry, rank } = matches[0];
  return {
    listed: true,
    contract_verified: entry.id === expectedIdentifier && entry.name === expectedIdentifier &&
      entry.full_name === expectedIdentifier && entry.api_name === expectedIdentifier &&
      entry.display_name === "BountyVerdict Agent Decision Tools" &&
      entry.description === BOUNTYVERDICT_AGENT_FINDER_DESCRIPTION &&
      entry.url === expectedDefinitionUrl && entry.extension_type === "MCP server",
    rank,
    total_results: metadata.total,
    identifier: String(entry.id),
    definition_url: String(entry.url),
  };
}

export function parseAwesomeMcpServersReadme(
  markdown: unknown,
  expectedRepository: string,
  expectedEndpoint: string,
): AwesomeMcpServersStatus {
  if (typeof markdown !== "string" || markdown.length > 2_000_000) {
    throw new Error("Awesome MCP Servers README is invalid or unbounded.");
  }
  const lines = markdown.split("\n");
  if (lines.length > 50_000 || lines.some((line) => line.length > 50_000)) {
    throw new Error("Awesome MCP Servers README lines are unbounded.");
  }
  let repositoryUrl: URL;
  try {
    repositoryUrl = new URL(expectedRepository);
  } catch {
    throw new Error("Awesome MCP Servers expected repository is invalid.");
  }
  const repositoryParts = repositoryUrl.pathname.split("/").filter(Boolean);
  if (repositoryUrl.protocol !== "https:" || repositoryUrl.hostname !== "github.com" ||
      repositoryParts.length !== 2) {
    throw new Error("Awesome MCP Servers expected repository is invalid.");
  }
  const anchor = `[${repositoryParts.join("/")}](${expectedRepository})`;
  const matches = lines.filter((line) => line.startsWith(`- ${anchor}`));
  if (matches.length > 1) throw new Error("Awesome MCP Servers duplicated the exact BountyVerdict listing.");
  if (matches.length === 0) {
    return {
      listed: false,
      contract_verified: false,
      skillverdict_contamination_risk: false,
      repository: expectedRepository,
      endpoint: expectedEndpoint,
    };
  }
  const listing = matches[0];
  const skillverdictContaminationRisk = /skillverdict|\/api\/skill|preflight-agent-skills/i.test(listing);
  const contractVerified = listing.includes("📇") && listing.includes("☁️") &&
    listing.includes(expectedEndpoint) && /\bx402\b/i.test(listing) &&
    !skillverdictContaminationRisk;
  return {
    listed: true,
    contract_verified: contractVerified,
    skillverdict_contamination_risk: skillverdictContaminationRisk,
    repository: expectedRepository,
    endpoint: expectedEndpoint,
  };
}

export function parseTensorBlockSearch(
  value: unknown,
  expectedId: string,
  expectedRepository: string,
  expectedSourcePullRequest: number,
): TensorBlockSearchStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TensorBlock MCP Index search is not an object.");
  }
  const payload = value as Record<string, any>;
  if (!Number.isSafeInteger(payload.count) || payload.count < 0 || payload.count > 50 ||
    !Number.isSafeInteger(payload.limit) || payload.limit < 1 || payload.limit > 50 ||
    payload.query !== "bountyverdict" || !Array.isArray(payload.servers) ||
    payload.servers.length !== payload.count || payload.servers.length > payload.limit ||
    payload.servers.some((entry: unknown) => !entry || typeof entry !== "object" || Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>).id !== "string" || String((entry as Record<string, unknown>).id).length > 200 ||
      typeof (entry as Record<string, unknown>).primaryUrl !== "string" || String((entry as Record<string, unknown>).primaryUrl).length > 2_048)) {
    throw new Error("TensorBlock MCP Index search is malformed or unbounded.");
  }
  const matching = payload.servers.filter((entry: Record<string, unknown>) =>
    entry.id === expectedId || entry.primaryUrl === expectedRepository
  );
  if (matching.length > 1) throw new Error("TensorBlock MCP Index duplicated the exact BountyVerdict entry.");
  if (matching.length === 0) {
    return {
      listed: false,
      status: "not_indexed",
      id: expectedId,
      repository: expectedRepository,
      source_pull_request: null,
      profile_path: null,
      web_profile_url: null,
    };
  }
  const entry = matching[0];
  if (entry.id !== expectedId || entry.primaryUrl !== expectedRepository ||
    entry.profilePath !== `/v1/servers/${expectedId}` ||
    entry.webProfilePath !== `https://tensorblock.co/mcp/servers/${expectedId}` ||
    entry.sourcePullRequest !== expectedSourcePullRequest) {
    throw new Error("TensorBlock MCP Index returned a drifted BountyVerdict search contract.");
  }
  return {
    listed: true,
    status: "listed",
    id: expectedId,
    repository: expectedRepository,
    source_pull_request: entry.sourcePullRequest,
    profile_path: entry.profilePath,
    web_profile_url: entry.webProfilePath,
  };
}

export function parseTensorBlockProfile(
  value: unknown,
  expectedId: string,
  expectedRepository: string,
  expectedEndpoint: string,
): TensorBlockProfileStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TensorBlock MCP Index profile is not an object.");
  }
  const profile = value as Record<string, any>;
  if (profile.id !== expectedId || typeof profile.name !== "string" || profile.name.length > 200 ||
    typeof profile.category !== "string" || profile.category.length > 200 ||
    !profile.links || typeof profile.links !== "object" || Array.isArray(profile.links) ||
    !Array.isArray(profile.transport) || profile.transport.length > 10 ||
    profile.transport.some((entry: unknown) => typeof entry !== "string" || !entry || entry.length > 100) ||
    !profile.auth || typeof profile.auth !== "object" || Array.isArray(profile.auth) ||
    typeof profile.auth.type !== "string" || profile.auth.type.length > 100 ||
    typeof profile.license !== "string" || profile.license.length > 100) {
    throw new Error("TensorBlock MCP Index profile is malformed or unbounded.");
  }
  const repository = typeof profile.links.repo === "string" ? profile.links.repo :
    typeof profile.links.primary === "string" ? profile.links.primary : null;
  const endpoint = typeof profile.links.endpoint === "string" ? profile.links.endpoint : null;
  const transport = [...new Set(profile.transport as string[])].sort();
  return {
    contract_verified: repository === expectedRepository && endpoint === expectedEndpoint &&
      transport.length === 1 && transport[0] === "streamable-http" &&
      profile.auth.type === "none" && profile.license === "MIT",
    id: expectedId,
    repository,
    endpoint,
    transport,
    auth_type: profile.auth.type,
    license: profile.license,
  };
}

export function parseDockerMcpRegistryDefinition(
  yaml: unknown,
  expectedEndpoint: string,
): DockerMcpRegistryStatus {
  if (typeof yaml !== "string" || yaml.length > 100_000) {
    throw new Error("Docker MCP Registry definition is invalid or unbounded.");
  }
  const lines = yaml.split("\n");
  if (lines.length > 2_000 || lines.some((line) => line.length > 10_000)) {
    throw new Error("Docker MCP Registry definition lines are unbounded.");
  }
  const count = (line: string) => lines.filter((candidate) => candidate.trim() === line).length;
  const required = [
    "name: bountyverdict",
    "type: remote",
    "title: BountyVerdict Agent Decision Tools",
    "transport_type: streamable-http",
    `url: ${expectedEndpoint}`,
  ];
  if (required.some((line) => count(line) > 1)) {
    throw new Error("Docker MCP Registry duplicated a BountyVerdict contract field.");
  }
  const skillverdictContaminationRisk = /skillverdict|\/api\/skill|preflight-agent-skills/i.test(yaml);
  return {
    listed: count("name: bountyverdict") === 1,
    contract_verified: required.every((line) => count(line) === 1) &&
      /six read-only tools/i.test(yaml) && /\bx402\b/i.test(yaml) && !skillverdictContaminationRisk,
    endpoint: expectedEndpoint,
    skillverdict_contamination_risk: skillverdictContaminationRisk,
  };
}

export function parseDockerMcpHubPage(
  html: unknown,
  expectedEndpoint: string,
): DockerMcpRegistryStatus {
  if (typeof html !== "string" || html.length > 2_000_000) {
    throw new Error("Docker MCP Hub page is invalid or unbounded.");
  }
  const skillverdictContaminationRisk = /skillverdict|\/api\/skill|preflight-agent-skills/i.test(html);
  const listed = /BountyVerdict Agent Decision Tools/i.test(html);
  return {
    listed,
    contract_verified: listed && html.includes(expectedEndpoint) && /streamable-http/i.test(html) &&
      !skillverdictContaminationRisk,
    endpoint: expectedEndpoint,
    skillverdict_contamination_risk: skillverdictContaminationRisk,
  };
}

export function parseMcpServersOrgPage(
  html: unknown,
  expectedRepository: string,
  expectedEndpoint: string,
): McpServersOrgStatus {
  if (typeof html !== "string" || html.length > 2_000_000) {
    throw new Error("MCPServers.org listing page is invalid or unbounded.");
  }
  const lines = html.split("\n");
  if (lines.length > 50_000 || lines.some((line) => line.length > 200_000)) {
    throw new Error("MCPServers.org listing page lines are unbounded.");
  }
  const skillverdictContaminationRisk = /skillverdict|\/api\/skill|preflight-agent-skills/i.test(html);
  const repositoryMetadataVerified = /BountyVerdict Agent Decision Tools/i.test(html) &&
    html.includes(expectedRepository);
  const contractVerified = repositoryMetadataVerified && html.includes(expectedEndpoint) &&
    /streamable[ -]?http/i.test(html) && /\bx402\b/i.test(html) && !skillverdictContaminationRisk;
  return {
    listed: repositoryMetadataVerified,
    repository_metadata_verified: repositoryMetadataVerified,
    contract_verified: contractVerified,
    repository: expectedRepository,
    endpoint: expectedEndpoint,
    skillverdict_contamination_risk: skillverdictContaminationRisk,
  };
}

export function parseMcpDirectoryPage(
  html: unknown,
  expectedRepository: string,
  expectedEndpoint: string,
): McpDirectoryStatus {
  if (typeof html !== "string" || html.length > 2_000_000) {
    throw new Error("MCP.Directory listing page is invalid or unbounded.");
  }
  const lines = html.split("\n");
  if (lines.length > 50_000 || lines.some((line) => line.length > 250_000)) {
    throw new Error("MCP.Directory listing page lines are unbounded.");
  }
  const skillverdictContaminationRisk = /skillverdict|\/api\/skill|preflight-agent-skills/i.test(html);
  const repositoryMetadataVerified = /BountyVerdict Agent Decision Tools/i.test(html) &&
    html.includes(expectedRepository);
  const remoteMetadataVerified = repositoryMetadataVerified && html.includes(expectedEndpoint) &&
    /streamable[ -]?http/i.test(html) && /\bx402\b/i.test(html) && !skillverdictContaminationRisk;
  return {
    listed: repositoryMetadataVerified,
    repository_metadata_verified: repositoryMetadataVerified,
    remote_metadata_verified: remoteMetadataVerified,
    repository: expectedRepository,
    endpoint: expectedEndpoint,
    skillverdict_contamination_risk: skillverdictContaminationRisk,
  };
}

export function parseClineMarketplaceCatalog(
  value: unknown,
  expectedRepository: string,
  expectedEndpoint: string,
): ClineMarketplaceStatus {
  const expectedId = "bountyverdict";
  const expectedArgs = [expectedId, "--transport", "http", expectedEndpoint];
  const shellArgument = (argument: string): string => /^[A-Za-z0-9_./:@-]+$/.test(argument)
    ? argument
    : JSON.stringify(argument);
  const expectedCommand = `cline mcp install ${expectedArgs.map(shellArgument).join(" ")}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cline Marketplace catalog is not an object.");
  }
  const payload = value as Record<string, any>;
  if (!Number.isSafeInteger(payload.version) || payload.version < 1 || payload.version > 100 ||
    typeof payload.generatedAt !== "string" || !Number.isFinite(Date.parse(payload.generatedAt)) ||
    typeof payload.baseUrl !== "string" || payload.baseUrl.length > 2_048 ||
    !payload.counts || typeof payload.counts !== "object" || Array.isArray(payload.counts) ||
    !Array.isArray(payload.entries) || payload.entries.length > 10_000 ||
    payload.entries.some((entry: unknown) => !entry || typeof entry !== "object" || Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>).id !== "string" || String((entry as Record<string, unknown>).id).length > 200)) {
    throw new Error("Cline Marketplace catalog is malformed or unbounded.");
  }
  const matching = payload.entries.filter((entry: Record<string, unknown>) =>
    entry.id === expectedId || entry.repo === expectedRepository
  );
  if (matching.length > 1) throw new Error("Cline Marketplace duplicated the exact BountyVerdict entry.");
  if (matching.length === 0) {
    return {
      listed: false,
      contract_verified: false,
      id: expectedId,
      repository: expectedRepository,
      endpoint: expectedEndpoint,
      install_command: expectedCommand,
      skillverdict_contamination_risk: false,
    };
  }
  const entry = matching[0] as Record<string, any>;
  const serialized = JSON.stringify(entry);
  if (serialized.length > 100_000 || typeof entry.description !== "string" || entry.description.length > 10_000 ||
    !entry.install || typeof entry.install !== "object" || Array.isArray(entry.install) ||
    !Array.isArray(entry.install.args) || entry.install.args.length > 20 ||
    entry.install.args.some((argument: unknown) => typeof argument !== "string" || String(argument).length > 2_048)) {
    throw new Error("Cline Marketplace BountyVerdict entry is malformed or unbounded.");
  }
  const skillverdictContaminationRisk = /skillverdict|\/api\/skill|preflight-agent-skills/i.test(serialized);
  const installEnvIsEmpty = entry.install.env === undefined ||
    (entry.install.env && typeof entry.install.env === "object" && !Array.isArray(entry.install.env) &&
      Object.keys(entry.install.env).length === 0);
  const contractVerified = entry.id === expectedId && entry.type === "mcp" &&
    entry.name === "BountyVerdict Agent Decision Tools" && entry.repo === expectedRepository &&
    JSON.stringify(entry.install.args) === JSON.stringify(expectedArgs) &&
    entry.install.command === expectedCommand && /six read-only tools/i.test(entry.description) &&
    /\bx402\b/i.test(entry.description) && installEnvIsEmpty && !skillverdictContaminationRisk;
  return {
    listed: true,
    contract_verified: contractVerified,
    id: expectedId,
    repository: expectedRepository,
    endpoint: expectedEndpoint,
    install_command: expectedCommand,
    skillverdict_contamination_risk: skillverdictContaminationRisk,
  };
}

function kiloMarketplaceContract(
  block: string,
  expectedRepository: string,
  expectedEndpoint: string,
): Omit<KiloMarketplaceStatus, "listed"> {
  const skillverdictContaminationRisk = /skillverdict|\/api\/skill|preflight-agent-skills/i.test(block);
  const hasSensitiveConfiguration = /(?:^|\n)\s*(?:parameters|env):\s*(?:\n|$)/m.test(block) ||
    /\{\{[^}]+\}\}|API[_-]KEY|AUTHORIZATION|BEARER/i.test(block);
  const contractVerified = /(?:^|\n)\s*-?\s*id: bountyverdict\s*(?:\n|$)/m.test(block) &&
    /(?:^|\n)\s*name: BountyVerdict Agent Decision Tools\s*(?:\n|$)/m.test(block) &&
    block.includes(`url: ${expectedRepository}`) && /(?:^|\n)\s*category: development\s*(?:\n|$)/m.test(block) &&
    /Six read-only x402 tools/i.test(block) && /Invalid input is\s+rejected before payment/i.test(block) &&
    block.includes('"type": "streamable-http"') && block.includes(`"url": "${expectedEndpoint}"`) &&
    block.split(expectedRepository).length === 2 && block.split(expectedEndpoint).length === 2 &&
    !hasSensitiveConfiguration && !skillverdictContaminationRisk;
  return {
    contract_verified: contractVerified,
    id: "bountyverdict",
    repository: expectedRepository,
    endpoint: expectedEndpoint,
    skillverdict_contamination_risk: skillverdictContaminationRisk,
  };
}

export function parseKiloMarketplaceDefinition(
  yaml: unknown,
  expectedRepository: string,
  expectedEndpoint: string,
): KiloMarketplaceStatus {
  if (typeof yaml !== "string" || yaml.length > 200_000) {
    throw new Error("Kilo Marketplace definition is invalid or unbounded.");
  }
  const idMatches = yaml.match(/^id: bountyverdict\s*$/gm) || [];
  if (idMatches.length > 1) throw new Error("Kilo Marketplace definition duplicated the BountyVerdict id.");
  if (idMatches.length === 0) {
    return { listed: false, ...kiloMarketplaceContract("", expectedRepository, expectedEndpoint) };
  }
  return { listed: true, ...kiloMarketplaceContract(yaml, expectedRepository, expectedEndpoint) };
}

export function parseKiloMarketplaceCatalog(
  yaml: unknown,
  expectedRepository: string,
  expectedEndpoint: string,
): KiloMarketplaceStatus {
  if (typeof yaml !== "string" || yaml.length > 5_000_000) {
    throw new Error("Kilo Marketplace catalog is invalid or unbounded.");
  }
  const marker = "  - id: bountyverdict\n";
  const starts: number[] = [];
  for (let index = yaml.indexOf(marker); index !== -1; index = yaml.indexOf(marker, index + marker.length)) {
    starts.push(index);
  }
  if (starts.length > 1) throw new Error("Kilo Marketplace catalog duplicated the BountyVerdict entry.");
  if (starts.length === 0) {
    return { listed: false, ...kiloMarketplaceContract("", expectedRepository, expectedEndpoint) };
  }
  const next = yaml.indexOf("\n  - id:", starts[0] + marker.length);
  const block = yaml.slice(starts[0], next === -1 ? yaml.length : next);
  if (block.length > 100_000) throw new Error("Kilo Marketplace BountyVerdict entry is unbounded.");
  return { listed: true, ...kiloMarketplaceContract(block, expectedRepository, expectedEndpoint) };
}

function mcpTextResult(value: unknown, label: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} response is not an object.`);
  const response = value as Record<string, any>;
  const content = response.result?.content;
  if (response.jsonrpc !== "2.0" || response.result?.isError === true || !Array.isArray(content) || content.length !== 1 ||
    content[0]?.type !== "text" || typeof content[0]?.text !== "string" || content[0].text.length > 1_000_000) {
    throw new Error(`${label} response has an invalid MCP result envelope.`);
  }
  return content[0].text;
}

export function parseAgentageSearchResponse(value: unknown, expectedSlug: string): Record<string, unknown> {
  const text = mcpTextResult(value, "Agentage search");
  const detailsUrl = `https://catalog.agentage.io/mcp/${expectedSlug}`;
  const slugMatches = text.split(`\`${expectedSlug}\``).length - 1;
  const urlMatches = text.split(detailsUrl).length - 1;
  if (slugMatches > 1 || urlMatches > 1) throw new Error("Agentage duplicated the exact BountyVerdict search result.");
  if ((slugMatches === 1) !== (urlMatches === 1)) {
    throw new Error("Agentage returned a drifted BountyVerdict search result.");
  }
  return {
    listed: slugMatches === 1,
    status: slugMatches === 1 ? "listed" : "not_indexed",
    slug: expectedSlug,
    details_url: detailsUrl,
  };
}

export function parseAgentageGetResponse(
  value: unknown,
  expectedSlug: string,
  expectedEndpoint: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agentage detail response is not an object.");
  }
  const response = value as Record<string, any>;
  if (response.jsonrpc !== "2.0" || !response.result || typeof response.result !== "object" ||
    Array.isArray(response.result)) {
    throw new Error("Agentage detail response has an invalid MCP result envelope.");
  }
  if (response.result.isError === true) {
    const content = response.result.content;
    if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== "text" ||
      content[0]?.text !== "Unknown slug. Use mcp_search to find the right slug.") {
      throw new Error("Agentage detail returned an unexpected MCP error.");
    }
    return {
      listed: false,
      status: "not_indexed",
      contract_verified: false,
      slug: expectedSlug,
      endpoint: expectedEndpoint,
      source: null,
    };
  }
  const text = mcpTextResult(value, "Agentage detail");
  const detail = response.result.structuredContent;
  if (!detail || typeof detail !== "object" || Array.isArray(detail) ||
    typeof detail.slug !== "string" || detail.slug.length > 300 ||
    typeof detail.is_official !== "boolean" ||
    typeof detail.details_url !== "string" || detail.details_url.length > 2_048 ||
    !Array.isArray(detail.remotes) || detail.remotes.length > 20 ||
    detail.remotes.some((remote: unknown) => !remote || typeof remote !== "object" || Array.isArray(remote) ||
      typeof (remote as Record<string, unknown>).type !== "string" || String((remote as Record<string, unknown>).type).length > 100 ||
      typeof (remote as Record<string, unknown>).url !== "string" || String((remote as Record<string, unknown>).url).length > 2_048)) {
    throw new Error("Agentage detail structured content is malformed or unbounded.");
  }
  const exactRemoteMatches = detail.remotes.filter((remote: Record<string, unknown>) =>
    remote.type === "streamable-http" && remote.url === expectedEndpoint
  ).length;
  if (exactRemoteMatches > 1) throw new Error("Agentage duplicated the exact BountyVerdict remote endpoint.");
  const exactDetailsUrl = `https://catalog.agentage.io/mcp/${expectedSlug}`;
  const contractVerified = detail.slug === expectedSlug && detail.is_official === true &&
    detail.details_url === exactDetailsUrl && exactRemoteMatches === 1;
  return {
    listed: true,
    status: "listed",
    contract_verified: contractVerified,
    slug: expectedSlug,
    endpoint: expectedEndpoint,
    source: detail.is_official === true ? "official_registry" : "unknown",
    details_url: exactDetailsUrl,
    response_text_present: text.length > 0,
  };
}

function boundedStrings(value: unknown, limit: number, maxLength: number, label: string): string[] {
  if (!Array.isArray(value) || value.length > limit ||
    value.some((entry) => typeof entry !== "string" || !entry || entry.length > maxLength)) {
    throw new Error(`MCP Observatory ${label} are malformed or unbounded.`);
  }
  return value as string[];
}

export function parseMcpObservatoryDetail(
  value: unknown,
  expectedId: string,
  expectedRepository: string,
): McpObservatoryStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP Observatory detail is not an object.");
  }
  const payload = value as Record<string, any>;
  const server = payload.server;
  if (!server || typeof server !== "object" || Array.isArray(server) ||
    server.id !== expectedId || server.name !== "cristianmoroaica/bountyverdict" ||
    server.repoUrl !== expectedRepository || server.kind !== "github-only" ||
    typeof server.firstSeen !== "string" || !Number.isFinite(Date.parse(server.firstSeen)) ||
    typeof server.lastSeen !== "string" || !Number.isFinite(Date.parse(server.lastSeen)) ||
    (server.currentVersion !== null && (typeof server.currentVersion !== "string" || !server.currentVersion || server.currentVersion.length > 100))) {
    throw new Error("MCP Observatory returned mismatched or malformed server metadata.");
  }
  const tags = boundedStrings(server.tags, 100, 100, "tags");
  if (!Array.isArray(payload.releases) || payload.releases.length > 100 ||
    !payload.releases.every((release: unknown) => release && typeof release === "object" && !Array.isArray(release) &&
      typeof (release as Record<string, unknown>).version === "string" &&
      String((release as Record<string, unknown>).version).length <= 100 &&
      typeof (release as Record<string, unknown>).publishedAt === "string" &&
      Number.isFinite(Date.parse(String((release as Record<string, unknown>).publishedAt))))) {
    throw new Error("MCP Observatory releases are malformed or unbounded.");
  }
  if (!payload.deps || typeof payload.deps !== "object" || Array.isArray(payload.deps) ||
    !Array.isArray(payload.deps.out) || payload.deps.out.length > 1_000 ||
    !Array.isArray(payload.deps.in) || payload.deps.in.length > 1_000 ||
    !Array.isArray(payload.related) || payload.related.length > 100) {
    throw new Error("MCP Observatory relationships are malformed or unbounded.");
  }
  const endpointExposed = typeof server.endpoint === "string" && server.endpoint.length > 0;
  const toolSchemasExposed = Array.isArray(server.tools) && server.tools.length > 0;
  return {
    listed: true,
    status: endpointExposed && toolSchemasExposed ? "agent_ready" : "repository_metadata_only",
    server_id: expectedId,
    repository: expectedRepository,
    first_seen: server.firstSeen,
    last_seen: server.lastSeen,
    current_version: server.currentVersion,
    release_versions: [...new Set(payload.releases.map((release: Record<string, unknown>) => String(release.version)))].sort(),
    tags,
    language: typeof server.language === "string" && server.language.length <= 100 ? server.language : null,
    license: typeof server.license === "string" && server.license.length <= 100 ? server.license : null,
    endpoint_exposed: endpointExposed,
    tool_schemas_exposed: toolSchemasExposed,
  };
}

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

export function parseMcpubSearchLiveResponse(value: unknown, expectedEndpoint: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mcpub live response is not an object.");
  const response = value as Record<string, any>;
  const content = response.result?.content;
  if (response.jsonrpc !== "2.0" || !Array.isArray(content) || content.length !== 1 ||
    content[0]?.type !== "text" || typeof content[0]?.text !== "string" || content[0].text.length > 1_000_000) {
    throw new Error("mcpub live response has an invalid MCP result envelope.");
  }
  const parsed = JSON.parse(content[0].text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("mcpub live result is not an object.");
  const result = parsed as Record<string, any>;
  if (!Number.isSafeInteger(result.total) || result.total < 0 || result.total > 1_000_000 ||
    result.offset !== 0 || !Number.isSafeInteger(result.limit) || result.limit < 1 || result.limit > 50 ||
    result.source !== "live (scan_cache.csv - verified alive)" || !Array.isArray(result.results) ||
    result.results.length > result.limit || result.results.length > result.total ||
    result.results.some((entry: unknown) => !entry || typeof entry !== "object" || Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>).url !== "string" || String((entry as Record<string, unknown>).url).length > 2_048 ||
      typeof (entry as Record<string, unknown>).description !== "string" || String((entry as Record<string, unknown>).description).length > 10_000)) {
    throw new Error("mcpub live search result is malformed or unbounded.");
  }
  const matching = result.results.filter((entry: Record<string, unknown>) => entry.url === expectedEndpoint);
  if (matching.length > 1) throw new Error("mcpub live search duplicated the exact endpoint.");
  return {
    listed: matching.length === 1,
    status: matching.length === 1 ? "verified_alive" : "not_live_verified",
    endpoint: expectedEndpoint,
    matching_live_results: result.total,
    returned_results: result.results.length,
    description: matching.length === 1 ? matching[0].description : null,
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
