import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseAgentSkillSearchPayload,
  parseSkillsShInstallCounts,
  PUBLISHED_SKILLS,
} from "../src/acquisition.ts";
import {
  AgentToolsCloudContractDrift,
  parseAgentToolsCloudMcpBuyerQuery,
  parseAgentToolsCloudListing,
  parseAgentToolsCloudMcpListing,
} from "../src/agent-tools-cloud.ts";
import { PRODUCT_CATALOG, type ProductKey } from "../src/product-catalog.ts";
import { parseAgentSkillsInSearchPayload } from "../src/agentskills-in.ts";
import { parseSkillsMdSearchPayload } from "../src/skillsmd.ts";
import {
  ASKILL_BUYER_QUERIES,
  ASKILL_DEDICATED_IDENTITY,
  ASKILL_LEGACY_IDENTITY,
  ASKILL_MAIN_OWNER,
  ASKILL_MAIN_REPO,
  ASKILL_MAIN_SKILLS,
  parseAskillBuyerQueryPayload,
  parseAskillMainBuyerQueryPayload,
  parseAskillMainSearchPayload,
  parseAskillSearchPayload,
  type AskillIdentity,
} from "../src/askill.ts";
import {
  parseAgentFinderCatalogEntry,
  parseAgentFinderRegistryLatest,
  parseAgentFinderSearchPage,
  parseClineMarketplaceCatalog,
  parseAgentageGetResponse,
  parseAwesomeMcpServersReadme,
  parseDockerMcpHubPage,
  parseDockerMcpRegistryDefinition,
  parseKiloMarketplaceCatalog,
  parseKiloMarketplaceDefinition,
  parseMcpDirectoryPage,
  parseMcpServersOrgPage,
  parseMcpObservatoryDetail,
  parseTensorBlockProfile,
  parseTensorBlockSearch,
} from "../src/mcp-downstreams.ts";
import { githubPrFields, githubPrSnapshot, readGitHubPrStatus, type GitHubPrStatus } from "../src/github-pr-telemetry.ts";
import { parseToolHiveCatalogEntry } from "../src/toolhive.ts";
import {
  parseSkillsShSearchPayload,
  SKILLS_SH_DEDICATED_ID,
  SKILLS_SH_DEDICATED_SKILL,
  SKILLS_SH_DEDICATED_SOURCE,
} from "../src/skills-sh.ts";
import {
  AWESOME_SKILLS_MAX_PAGE_BYTES,
  AWESOME_SKILLS_URL,
  parseAwesomeSkillsPage,
} from "../src/awesome-skills.ts";
import {
  MCP_MARKETPLACE_MAX_PAGE_BYTES,
  parseMcpMarketplaceListing,
  parseMcpMarketplaceSearchResponse,
} from "../src/mcp-marketplace.ts";

if (process.env.BOUNTYVERDICT_AUDITED_ROTATION_ACTIVE !== "directory") {
  throw new Error("Directory retrieval must run through run-audited-monitor.ts after establishing a draining funnel rotation.");
}

const repository = "https://github.com/Mimirs402/bountyverdict";
const agentToolUrl = "https://agenttool.sh/tools/bountyverdict-agent-decision-apis";
const skillsUrl = "https://skills.sh/Mimirs402/bountyverdict";
const legacyExperimentSkillsRepository = "cristianmoroaica/bountyverdict";
const legacyExperimentSkillsUrl = `https://skills.sh/${legacyExperimentSkillsRepository}`;
const skillsDedicatedUrl = "https://skills.sh/Mimirs402/bountyverdict-mcp-skill";
const skillsDedicatedIssueUrl = "https://github.com/vercel-labs/skills/issues/1754";
const skillsDedicatedIssueTitle = "Listing: Request indexing for Mimirs402/bountyverdict-mcp-skill";
const awesomeSkillsSubmittedAt = "2026-07-21T23:44:27Z";
const securityDirectoryPrUrl = "https://github.com/LLMSecurity/awesome-agent-skills-security/pull/38";
const x402DirectoryPrUrl = "https://github.com/xpaysh/awesome-x402/pull/959";
const agentPluginsPrUrl = "https://github.com/dmgrok/agent-plugins/pull/97";
const agentPluginsCatalogUrl = "https://cdn.jsdelivr.net/gh/dmgrok/agent-plugins@main/catalog.json";
const awesomeCopilotIssueUrl = "https://github.com/github/awesome-copilot/issues/2385";
const awesomeCopilotCatalogUrl = "https://raw.githubusercontent.com/github/awesome-copilot/main/plugins/external.json";
const x402ScoutUrl = "https://x402scout.com/catalog";
const agent402Api = "https://agent402.tools/api";
const productionOrigin = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const x402ScanUrl = "https://www.x402scan.com";
const x402gleHostUrl = "https://x402gle.com/servers/bountyverdict-agent-production.mimirslab.workers.dev";
const agentToolsCloudApi = "https://agent-tools.cloud/api/v1";
const agentToolsCloudSlug = "bountyverdict-agent-production-mimirslab-workers-dev-bazaar";
const agentToolsCloudMcpSlug = "bountyverdict-agent-decision-tools-bountyverdict-agent-production-mimirslab-work";
const agentToolsCloudMcpX402Slug = "bountyverdict-agent-decision-apis-x402";
const agentToolsCloudMcpTools = Object.freeze([
  "check_github_bounty",
  "rank_github_bounties",
  "audit_agent_harness",
  "diagnose_github_actions_run",
  "classify_github_actions_flake",
  "check_mcp_tool_drift",
]);
const agentToolsCloudBuyerQueries = Object.freeze([
  "why did this GitHub Actions run fail",
  "should I rerun this failed workflow or fix the code",
  "check AGENTS.md and CLAUDE.md before editing this repository",
  "is this GitHub bounty still open and unclaimed",
  "which GitHub bounty issue should I work on",
  "will this MCP tools list update break existing agents",
]);
const revenueWallet = "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
const monetizeYourAgentApi = "https://monetizeyouragent.fun/api/v1";
const monetizeYourAgentSubmissionId = 234;
const directory402Api = "https://402directory.com/api";
const directory402SubmissionIds = Object.freeze([50, 51, 52, 53, 54, 55, 56]);
const index402Api = "https://402index.io/api/v1/services";
const agentSkillSearchUrl = "https://agentskill.sh/api/agent/search?q=bountyverdict&limit=20";
const agentSkillsInSearchUrl = "https://www.agentskills.in/api/skills?name=route-github-agent-decisions&author=cristianmoroaica&limit=20";
const agentSkillsInFallbackSearchUrl = "https://www.agentskills.in/api/skills?search=bountyverdict&author=cristianmoroaica&limit=50&offset=0&sortBy=recent";
const agentSkillsInListingUrl = "https://www.agentskills.in/marketplace/%40cristianmoroaica/route-github-agent-decisions";
const agentSkillsInSubmissionIssueNumber = 23;
const agentSkillsInSubmissionIssueUrl =
  `https://github.com/Karanjot786/agent-skills-cli/issues/${agentSkillsInSubmissionIssueNumber}`;
const skillsMdSearchUrl = "https://skillsmd.dev/api/search?q=route-github-agent-decisions";
const skillsMdRegistryUrl = "https://skillsmd.dev/";
const skillsMdSubmissionId = "e68e968f-d03d-4808-b36b-5fd3b42b6489";
const skillsMdSubmittedAt = "2026-07-21T10:26:21Z";
const askillSearchUrl = "https://askill.sh/api/v1/skills?q=route-github-agent-decisions&owner=cristianmoroaica&repo=bountyverdict-mcp-skill&limit=20";
const askillSubmittedAt = "2026-07-21T10:42:45.083Z";
const askillRefreshRecordedAt = "2026-07-21T16:00:14Z";
const askillRefreshResult = "existing_skill_skipped_zero_indexed";
const askillDedicatedSearchUrl = "https://askill.sh/api/v1/skills?q=route-github-agent-decisions&owner=Mimirs402&repo=bountyverdict-mcp-skill&limit=20";
const askillDedicatedSubmittedAt = "2026-07-21T21:37:35.000Z";
const askillMainSubmittedAt = "2026-07-22T00:19:00.000Z";
const askillLegacyMonitor = Object.freeze({
  searchUrl: askillSearchUrl,
  submittedAt: askillSubmittedAt,
  identity: ASKILL_LEGACY_IDENTITY,
  submission: {
    submitted_at: askillSubmittedAt,
    indexed: true,
    refresh_recorded_at: askillRefreshRecordedAt,
    refresh_result: askillRefreshResult,
  },
});
const askillDedicatedMonitor = Object.freeze({
  searchUrl: askillDedicatedSearchUrl,
  submittedAt: askillDedicatedSubmittedAt,
  identity: ASKILL_DEDICATED_IDENTITY,
  submission: {
    submitted_at: askillDedicatedSubmittedAt,
    indexed: true,
    entry_id: 703722,
    repository: "Mimirs402/bountyverdict-mcp-skill",
  },
});
const agentSkillsMdSubmissionRecordedAt = "2026-07-22T00:05:36Z";
const agentSkillsMdListingUrl = "https://agent-skills.md/skills/Mimirs402/bountyverdict-mcp-skill/route-github-agent-decisions";
const agentSkillsMdTaskFirstDescription =
  "Diagnose why a GitHub Actions run failed and find its root cause; decide whether to retry that failed Action once; check or rank GitHub bounties; audit AGENTS.md readiness; detect MCP schema drift.";
const githubSkillReleaseTag = "v1.1.9";
const mcpRepositoryUrl = "https://mcprepository.com/cristianmoroaica/bountyverdict";
const mcpRepositorySubmittedAt = "2026-07-21T03:31:45Z";
const mcpubCrawlerPrUrl = "https://github.com/roverbird/mcpub/pull/4";
const agentNdxIndexUrl = "https://agentndx.ai/api/servers.json";
const agentNdxSubmittedAt = "2026-07-21T03:33:34Z";
const mcpObservatoryServerId = "github:cristianmoroaica/bountyverdict";
const mcpObservatoryUrl = `https://mcpobservatory.com/api/servers/${mcpObservatoryServerId}`;
const lobeHubIssueNumber = 17401;
const lobeHubIssueUrl = `https://github.com/lobehub/lobehub/issues/${lobeHubIssueNumber}`;
const lobeHubListingId = "io-github-cristianmoroaica-bountyverdict";
const lobeHubListingUrl = `https://market.lobehub.com/s/plugins/${lobeHubListingId}`;
const awesomeMcpServersPrNumber = 10554;
const awesomeMcpServersPrUrl = `https://github.com/punkpeye/awesome-mcp-servers/pull/${awesomeMcpServersPrNumber}`;
const awesomeMcpServersReadmeUrl = "https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md";
const tensorBlockIssueNumber = 1311;
const tensorBlockIssueUrl = `https://github.com/TensorBlock/awesome-mcp-servers/issues/${tensorBlockIssueNumber}`;
const tensorBlockPrNumber = 1312;
const tensorBlockPrUrl = `https://github.com/TensorBlock/awesome-mcp-servers/pull/${tensorBlockPrNumber}`;
const tensorBlockIndexApi = "https://mcp-index.tensorblock.co";
const tensorBlockServerId = "github-cristianmoroaica-bountyverdict-038d60c1";
const agentageMcpUrl = "https://catalog.agentage.io/mcp";
const agentageSlug = "io-github-cristianmoroaica-bountyverdict";
const dockerMcpRegistryPrNumber = 4509;
const dockerMcpRegistryPrUrl = `https://github.com/docker/mcp-registry/pull/${dockerMcpRegistryPrNumber}`;
const dockerMcpRegistryDefinitionUrl = "https://raw.githubusercontent.com/docker/mcp-registry/main/servers/bountyverdict/server.yaml";
const dockerMcpHubUrl = "https://hub.docker.com/mcp/server/bountyverdict/overview";
const mcpServersOrgSubmissionId = 4842;
const mcpServersOrgSubmittedAt = "2026-07-21T05:32:29.746Z";
const mcpServersOrgReceiptUrl = `https://mcpservers.org/submit-success?submission_id=${mcpServersOrgSubmissionId}`;
const mcpServersOrgListingUrl = "https://mcpservers.org/servers/cristianmoroaica/bountyverdict";
const mcpDirectorySubmittedAt = "2026-07-21T05:48:37Z";
const mcpDirectoryListingUrl = "https://mcp.directory/servers/bountyverdict";
const vaultPlaneSubmissionId = "8ffee7a8-d33b-486f-8eae-9483db40d75b";
const vaultPlaneSubmittedAt = "2026-07-21T15:32:23.786Z";
const vaultPlaneListingUrl = "https://www.vaultplane.com/skills/bountyverdict-agent-decision-router";
const toolsForAgentsSubmittedAt = "2026-07-21T15:34:00Z";
const toolsForAgentsListingUrl = "https://www.toolsforagents.dev/tools/cristianmoroaica/bountyverdict";
const mcpServerSpotSubmittedAt = "2026-07-21T15:36:00Z";
const mcpServerSpotListingUrl = "https://www.mcpserverspot.com/servers/bountyverdict-agent-decision-tools";
const clineMarketplaceSkillPrNumber = 15;
const clineMarketplaceSkillPrUrl = `https://github.com/cline/marketplace/pull/${clineMarketplaceSkillPrNumber}`;
const clineMarketplaceMcpPrNumber = 16;
const clineMarketplaceMcpPrUrl = `https://github.com/cline/marketplace/pull/${clineMarketplaceMcpPrNumber}`;
const clineMarketplaceCatalogUrl = "https://cline.github.io/marketplace/catalog.json";
const clineMarketplaceEndpoint = `${productionOrigin}/mcp?source=cline-marketplace`;
const kiloMarketplacePrNumber = 194;
const kiloMarketplacePrUrl = `https://github.com/Kilo-Org/kilo-marketplace/pull/${kiloMarketplacePrNumber}`;
const kiloMarketplaceDefinitionUrl = "https://raw.githubusercontent.com/Kilo-Org/kilo-marketplace/main/mcps/bountyverdict/MCP.yaml";
const kiloMarketplaceCatalogUrl = "https://raw.githubusercontent.com/Kilo-Org/kilo-marketplace/main/mcps/marketplace.yaml";
const kiloMarketplaceEndpoint = `${productionOrigin}/mcp?source=kilo-marketplace`;
const geminiCliGalleryUrl = "https://geminicli.com/extensions.json";
const agentFinderPrNumber = 11;
const agentFinderPrUrl = `https://github.com/github/agentfinder-catalog/pull/${agentFinderPrNumber}`;
const agentFinderCatalogEntryPath = "catalog/Mimirs402/bountyverdict.json";
const agentFinderCatalogEntryUrl = `https://raw.githubusercontent.com/github/agentfinder-catalog/main/${agentFinderCatalogEntryPath}`;
const agentFinderSearchUrl = "https://github.com/agentfinder?search=bountyverdict";
const agentFinderIdentifier = "urn:ai:registry.modelcontextprotocol.io:io.github.Mimirs402:bountyverdict";
const toolHivePrNumber = 1388;
const toolHivePrUrl = `https://github.com/stacklok/toolhive-catalog/pull/${toolHivePrNumber}`;
const toolHiveCatalogUrl =
  "https://raw.githubusercontent.com/stacklok/toolhive-catalog/main/registries/toolhive/servers/bountyverdict/server.json";
const supersededPersonalAccountPrs = Object.freeze([
  Object.freeze({
    surface: "x402_directory",
    url: "https://github.com/xpaysh/awesome-x402/pull/934",
    superseded_by: x402DirectoryPrUrl,
  }),
  Object.freeze({
    surface: "cline_marketplace_mcp",
    url: "https://github.com/cline/marketplace/pull/13",
    superseded_by: clineMarketplaceMcpPrUrl,
  }),
  Object.freeze({
    surface: "kilo_marketplace",
    url: "https://github.com/Kilo-Org/kilo-marketplace/pull/192",
    superseded_by: kiloMarketplacePrUrl,
  }),
  Object.freeze({
    surface: "toolhive",
    url: "https://github.com/stacklok/toolhive-catalog/pull/1385",
    superseded_by: toolHivePrUrl,
  }),
]);
const openHandsIntegrationsPrNumber = 416;
const openHandsIntegrationsPrUrl = `https://github.com/OpenHands/extensions/pull/${openHandsIntegrationsPrNumber}`;
const openHandsIntegrationsCatalogUrl =
  "https://raw.githubusercontent.com/OpenHands/extensions/main/integrations/catalog/bountyverdict.json";
const openHandsIntegrationsEndpoint = `${productionOrigin}/mcp?source=openhands-integrations`;
const openHandsIntegrationsDescription =
  "Remote, account-free MCP server for preflight decisions on public GitHub bounties, coding-agent repository instructions, GitHub Actions failures, flaky retries, and MCP tool-catalog changes. Six read-only tools return evidence-linked verdicts. A valid first unsigned call cannot charge and returns a structured selection preview plus the exact x402 USDC quote.";
const gooseExtensionsPrNumber = 10625;
const gooseExtensionsPrUrl = `https://github.com/aaif-goose/goose/pull/${gooseExtensionsPrNumber}`;
const gooseExtensionsCatalogUrl =
  "https://raw.githubusercontent.com/aaif-goose/goose/main/documentation/static/servers.json";
const gooseExtensionsEndpoint = `${productionOrigin}/mcp?source=goose-extensions`;
const officialMcpServerName = "io.github.Mimirs402/bountyverdict";
const officialMcpRegistryLatestUrl = "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Mimirs402%2Fbountyverdict/versions/latest";
const mcpMarketplaceSlug = "io-github-mimirs402-bountyverdict";
const mcpMarketplaceUrl = `https://www.mcp-marketplace.io/server/${mcpMarketplaceSlug}`;
const mcpMarketplaceEndpoint = `${productionOrigin}/mcp?source=mcp-registry`;
const mcpMarketplaceSearchEndpoint = "https://mcp-marketplace.io/api/mcp/mcp";
const mcpMarketplaceSearchLimit = 25;
const ardCatalogUrl = `${productionOrigin}/.well-known/ai-catalog.json`;
const ardRepresentativeQueries = Object.freeze([
  "check whether a github bounty issue is still open claimed or worth coding",
  "compare github bounty issues and choose the best candidate",
  "audit repository coding agent instructions before autonomous work",
  "why did this github actions workflow run fail",
  "should i retry this failed github actions run once or fix it",
  "check whether an mcp tools list schema change will break an agent",
]);
const ardCapabilities = Object.freeze([
  "check_github_bounty",
  "rank_github_bounties",
  "audit_agent_harness",
  "diagnose_github_actions_run",
  "classify_github_actions_flake",
  "check_mcp_tool_drift",
]);
const index402Listings = Object.freeze([
  { product: "single", id: "82c992cc-1a4f-44ea-b742-e798784b6a14", path: "/api/verdict", method: "GET" },
  { product: "portfolio", id: "057ea175-ec64-4c2e-8553-1f747455e6bf", path: "/api/portfolio", method: "POST" },
  { product: "harness", id: "b64d1c67-a5d9-43f1-b226-79886f425f99", path: "/api/harness", method: "GET" },
  { product: "skill", id: "f7ae83f3-cef1-4d9e-ae80-327b07d4f674", path: "/api/skill", method: "GET" },
  { product: "run", id: "19eada5c-4d79-4868-8183-745aab875cbb", path: "/api/run", method: "GET" },
  { product: "flake", id: "2d2fb88a-7402-4d1a-ab66-63d4e9ba1031", path: "/api/flake", method: "GET" },
]);
const x402ScanResources = Object.freeze([
  { product: "single", url: `${productionOrigin}/api/bounty-preflight`, method: "POST" },
  { product: "portfolio", url: `${productionOrigin}/api/portfolio`, method: "POST" },
  { product: "harness", url: `${productionOrigin}/api/repository-agent-instructions-audit`, method: "POST" },
  { product: "skill", url: `${productionOrigin}/api/skill`, method: "GET" },
  { product: "run", url: `${productionOrigin}/api/github-actions-run-diagnosis`, method: "POST" },
  { product: "flake", url: `${productionOrigin}/api/github-actions-flake-retry-gate`, method: "POST" },
  { product: "mcpdrift", url: `${productionOrigin}/api/mcp-drift`, method: "POST" },
] as const satisfies readonly { product: ProductKey; url: string; method: "GET" | "POST" }[]);
const x402ScoutIds = Object.freeze([
  "be000191-00e6-41d6-aed5-da35c6123e52",
  "f2ae9481-cfb9-4bbc-bf7c-9c1fb32523e4",
  "dfc4f4e3-b1ea-440d-b9c1-a416296e4fdd",
  "10bf30eb-c3f7-4231-ab23-fc16d02a0e7c",
  "98fed8fa-da74-436d-9fbe-22a500abf298",
]);
const agent402BuyerQueries = Object.freeze([
  { product: "single", path: "/api/verdict", query: "check whether github bounty issue is still open claimed or worth coding" },
  { product: "portfolio", path: "/api/portfolio", query: "compare and rank github bounty issues to choose the best candidate" },
  { product: "harness", path: "/api/repository-agent-instructions-audit", query: "audit repository coding agent instructions AGENTS.md CLAUDE.md" },
  { product: "skill", path: "/api/skill", query: "security audit an agent skill before installation" },
  { product: "run", path: "/api/github-actions-run-diagnosis", query: "diagnose failed github actions workflow run root cause" },
  { product: "flake", path: "/api/github-actions-flake-retry-gate", query: "decide whether failed github actions run is flaky and should retry" },
  { product: "mcpdrift", path: "/api/mcp-drift", query: "check MCP tools list schema drift compatibility breaking change" },
]);
const skillsShBuyerQueries = Object.freeze([
  { skill: "route-github-agent-checks", query: "route github agent checks" },
  { skill: "audit-agent-harness", query: "audit coding agent repository instructions" },
  { skill: "check-mcp-tool-drift", query: "check MCP tool schema compatibility" },
  { skill: "classify-github-flakes", query: "decide whether github actions failure is flaky" },
  { skill: "diagnose-github-actions", query: "diagnose github actions failure" },
  { skill: "preflight-agent-skills", query: "security audit agent skill before install" },
  { skill: "preflight-github-bounties", query: "check github bounty before coding" },
]);
const stateFile = process.env.DIRECTORY_STATE_FILE || `${homedir()}/.local/state/bountyverdict/directories.json`;
const timeoutMs = 30_000;
const skillsShMaximumPageBytes = 2_000_000;
const agentSkillRetryMs = 20 * 60 * 60 * 1000;
const forceAgentSkillSubmission = process.env.AGENTSKILL_FORCE_SUBMIT === "YES";
const execFileAsync = promisify(execFile);

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw new Error("Remote page declared an invalid or oversized body.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new Error("Remote page exceeded its bounded body limit.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function skillsShStatus(): Promise<Record<string, unknown>> {
  try {
    const searchQueries = [
      { type: "branded", skill: null, query: "bountyverdict" },
      ...PUBLISHED_SKILLS.map((skill) => ({ type: "exact", skill, query: skill })),
      ...skillsShBuyerQueries.map(({ skill, query }) => ({ type: "natural", skill, query })),
    ];
    const [response, ...searchResponses] = await Promise.all([
      fetch(skillsUrl, { signal: AbortSignal.timeout(timeoutMs) }),
      ...searchQueries.map(({ query }) => {
        const url = new URL("https://skills.sh/api/search");
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "100");
        url.searchParams.set("owner", "Mimirs402");
        return fetch(url, {
          headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      }),
    ]);
    const body = await response.text();
    const listed = response.ok && body.includes("bountyverdict") && !body.toLowerCase().includes("not found");
    if (!listed) return { url: skillsUrl, http_status: response.status, listed };
    if (searchResponses.some((searchResponse) => !searchResponse.ok)) {
      throw new Error("skills.sh search returned an unsuccessful response.");
    }
    const searchResults = await Promise.all(searchResponses.map(async (searchResponse, index) => {
      const payload = await searchResponse.json() as Record<string, unknown>;
      if (!Array.isArray(payload.skills) || !Number.isSafeInteger(payload.count)) {
        throw new Error("skills.sh search returned malformed telemetry.");
      }
      const query = searchQueries[index];
      const expectedId = query.skill ? `Mimirs402/bountyverdict/${query.skill}` : null;
      const rank = expectedId === null
        ? (payload.skills as Array<Record<string, unknown>>).findIndex(({ source }) => source === "Mimirs402/bountyverdict")
        : (payload.skills as Array<Record<string, unknown>>).findIndex(({ id }) => id === expectedId);
      return { ...query, found: rank >= 0, rank: rank >= 0 ? rank + 1 : null, returned_results: payload.skills.length };
    }));
    try {
      const installs = parseSkillsShInstallCounts(body);
      return {
        url: skillsUrl,
        http_status: response.status,
        listed: true,
        total_installs: installs.total,
        install_counts: installs.by_skill,
        search_index: {
          branded_found: searchResults[0].found,
          exact_found: searchResults.filter(({ type, found }) => type === "exact" && found).length,
          exact_expected: PUBLISHED_SKILLS.length,
          natural_found: searchResults.filter(({ type, found }) => type === "natural" && found).length,
          natural_expected: skillsShBuyerQueries.length,
          queries: searchResults,
          measurement: "owner_run_search_corpus_and_retrieval_check_not_impressions_or_purchases",
        },
        measurement: "anonymous_cli_install_telemetry_not_customer_purchases",
      };
    } catch (error) {
      return {
        url: skillsUrl,
        http_status: response.status,
        listed: true,
        measurement: "unavailable",
        measurement_error: error instanceof Error ? error.message : String(error),
      };
    }
  } catch (error) {
    return {
      url: skillsUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function skillsShLegacyExperimentStatus(): Promise<Record<string, unknown>> {
  const provenance = {
    measurement_role: "frozen_skillverdict_experiment_only",
    source_repository: legacyExperimentSkillsRepository,
    source_url: legacyExperimentSkillsUrl,
    retrieval: "passive_exact_public_page_only",
    authenticated: false,
    mutated: false,
    search_requests: 0,
    canonical_business_distribution: false,
  } as const;
  try {
    const response = await fetch(legacyExperimentSkillsUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        url: legacyExperimentSkillsUrl,
        http_status: response.status,
        listed: false,
        status: "measurement_unavailable",
        provenance,
      };
    }
    const body = await readBoundedText(response, skillsShMaximumPageBytes);
    const listed = body.includes(legacyExperimentSkillsRepository) &&
      !body.toLowerCase().includes("not found");
    if (!listed) {
      return {
        url: legacyExperimentSkillsUrl,
        http_status: response.status,
        listed: false,
        status: "measurement_unavailable",
        provenance,
      };
    }
    const installs = parseSkillsShInstallCounts(body, legacyExperimentSkillsRepository);
    return {
      url: legacyExperimentSkillsUrl,
      http_status: response.status,
      listed: true,
      status: "measured",
      total_installs: installs.total,
      install_counts: installs.by_skill,
      provenance,
      measurement: "legacy_anonymous_cli_install_telemetry_for_frozen_experiment_only_not_current_business_distribution_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: legacyExperimentSkillsUrl,
      listed: false,
      status: "measurement_unavailable",
      error: error instanceof Error ? error.message : String(error),
      provenance,
    };
  }
}

async function skillsShDedicatedStatus(): Promise<Record<string, unknown>> {
  try {
    const searchQueries = [
      { type: "exact", query: SKILLS_SH_DEDICATED_SKILL },
      ...ASKILL_BUYER_QUERIES.map((query) => ({ type: "natural", query })),
    ];
    const [{ stdout: issueOutput }, pageResponse, ...searchResponses] = await Promise.all([
      execFileAsync("gh", [
        "issue", "view", "1754",
        "--repo", "vercel-labs/skills",
        "--json", "number,title,state,createdAt,updatedAt,closedAt,url",
      ], { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }),
      fetch(skillsDedicatedUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      ...searchQueries.map(({ query }) => {
        const url = new URL("https://skills.sh/api/search");
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "100");
        url.searchParams.set("owner", "Mimirs402");
        return fetch(url, {
          headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      }),
    ]);
    const issue = JSON.parse(issueOutput) as Record<string, unknown>;
    if (issue.number !== 1754 || issue.title !== skillsDedicatedIssueTitle || issue.url !== skillsDedicatedIssueUrl ||
      !["OPEN", "CLOSED"].includes(String(issue.state)) ||
      typeof issue.createdAt !== "string" || !Number.isFinite(Date.parse(issue.createdAt)) ||
      typeof issue.updatedAt !== "string" || !Number.isFinite(Date.parse(issue.updatedAt)) ||
      !(issue.closedAt === null ||
        (typeof issue.closedAt === "string" && Number.isFinite(Date.parse(issue.closedAt))))) {
      throw new Error("Skills.sh indexing request telemetry is malformed.");
    }
    if (!pageResponse.ok && pageResponse.status !== 404) {
      throw new Error(`Skills.sh dedicated page returned HTTP ${pageResponse.status}.`);
    }
    if (searchResponses.some((response) => !response.ok)) {
      throw new Error("Skills.sh dedicated search returned an unsuccessful response.");
    }
    const pageBody = await pageResponse.text();
    const queries = await Promise.all(searchResponses.map(async (response, index) => ({
      ...searchQueries[index],
      ...parseSkillsShSearchPayload(
        await response.json(),
        SKILLS_SH_DEDICATED_ID,
        SKILLS_SH_DEDICATED_SOURCE,
      ),
    })));
    const exactFound = queries[0].found;
    const pageListed = pageResponse.ok &&
      pageBody.toLowerCase().includes(SKILLS_SH_DEDICATED_SOURCE.toLowerCase()) &&
      pageBody.includes(SKILLS_SH_DEDICATED_SKILL) &&
      !pageBody.toLowerCase().includes("not found");
    const listed = pageListed && exactFound;
    const naturalQueries = queries.filter(({ type }) => type === "natural");
    return {
      url: skillsDedicatedUrl,
      source: SKILLS_SH_DEDICATED_SOURCE,
      skill_id: SKILLS_SH_DEDICATED_ID,
      http_status: pageResponse.status,
      listed,
      status: listed
        ? "listed"
        : issue.state === "OPEN"
          ? "indexing_requested"
          : "closed_without_exact_listing",
      indexing_request: {
        issue_number: issue.number,
        issue_url: issue.url,
        issue_state: issue.state,
        requested_at: issue.createdAt,
        updated_at: issue.updatedAt,
        closed_at: issue.closedAt,
      },
      search_index: {
        exact_found: exactFound,
        exact_rank: queries[0].rank,
        natural_found: naturalQueries.filter(({ found }) => found).length,
        natural_top_three: naturalQueries.filter(({ rank }) => rank !== null && rank <= 3).length,
        natural_expected: naturalQueries.length,
        queries,
      },
      measurement: "indexing_request_exact_page_and_owner_run_search_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: skillsDedicatedUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function awesomeSkillsStatus(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(AWESOME_SKILLS_URL, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Awesome Skills returned HTTP ${response.status}.`);
    const parsed = parseAwesomeSkillsPage(await readBoundedText(response, AWESOME_SKILLS_MAX_PAGE_BYTES));
    return {
      url: AWESOME_SKILLS_URL,
      http_status: response.status,
      status: parsed.contract_verified ? "listed" : parsed.listed ? "contract_drift" : "not_listed",
      ...parsed,
      submission: {
        submitted_at: awesomeSkillsSubmittedAt,
        method: "account_free_public_repository_url",
        result: "submitted",
        slug: "bountyverdict-mcp-skill-route-github-agent-decisions",
      },
      measurement: "account_free_submission_and_exact_listing_contract_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: AWESOME_SKILLS_URL,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "account_free_submission_and_exact_listing_contract_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function agentPluginsCatalogStatus(): Promise<Record<string, unknown>> {
  const response = await fetch(agentPluginsCatalogUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Agent Plugins catalog returned HTTP ${response.status}.`);
  const payload = await response.json() as Record<string, unknown>;
  if (!Array.isArray(payload.skills) || !payload.providers || typeof payload.providers !== "object" ||
    !Number.isSafeInteger(payload.total_skills) || Number(payload.total_skills) !== payload.skills.length) {
    throw new Error("Agent Plugins catalog returned malformed telemetry.");
  }
  const matching = (payload.skills as Array<Record<string, any>>).filter((skill) =>
    skill?.source?.repo === repository && PUBLISHED_SKILLS.includes(skill.name));
  return {
    url: "https://dmgrok.github.io/agent-plugins/",
    catalog_url: agentPluginsCatalogUrl,
    listed: matching.length === PUBLISHED_SKILLS.length,
    listed_skills: matching.length,
    expected_skills: PUBLISHED_SKILLS.length,
    total_catalog_skills: payload.skills.length,
    generated_at: typeof payload.generated_at === "string" ? payload.generated_at : null,
    skills: matching.map(({ id, name, quality_score, maintenance_status }) => ({
      id,
      name,
      quality_score,
      maintenance_status,
    })),
    measurement: "catalog_presence_and_quality_metadata_not_impressions_installs_or_purchases",
  };
}

async function awesomeCopilotStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  const [{ stdout: issueOutput }, catalogResponse] = await Promise.all([
    execFileAsync("gh", [
      "issue", "view", "2385",
      "--repo", "github/awesome-copilot",
      "--json", "number,title,state,labels,createdAt,updatedAt,closedAt,url",
    ], { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }),
    fetch(awesomeCopilotCatalogUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    }),
  ]);
  if (!catalogResponse.ok) throw new Error(`Awesome Copilot catalog returned HTTP ${catalogResponse.status}.`);
  const issue = JSON.parse(issueOutput) as Record<string, any>;
  const catalog = await catalogResponse.json() as unknown;
  if (issue.number !== 2385 || issue.url !== awesomeCopilotIssueUrl || !Array.isArray(issue.labels) ||
    !Array.isArray(catalog)) {
    throw new Error("Awesome Copilot returned malformed review or catalog telemetry.");
  }
  const labels = issue.labels.map((label: Record<string, unknown>) => String(label.name || "")).filter(Boolean).sort();
  const matching = (catalog as Array<Record<string, any>>).filter((entry) =>
    entry.name === "bountyverdict" && entry.source?.source === "github" &&
    entry.source?.repo === "Mimirs402/bountyverdict"
  );
  if (matching.length > 1) throw new Error("Awesome Copilot catalog duplicated BountyVerdict.");
  const listed = matching.length === 1;
  const reviewStatus = listed || labels.includes("approved")
    ? "approved"
    : labels.includes("ready-for-review")
      ? "ready_for_review"
      : labels.includes("requires-submitter-fixes")
        ? "requires_submitter_fixes"
        : labels.includes("rejected")
          ? "rejected"
          : labels.includes("awaiting-review")
            ? "awaiting_review"
            : issue.state === "CLOSED"
              ? "closed_without_catalog_entry"
              : "submitted_awaiting_intake";
  return {
    url: awesomeCopilotIssueUrl,
    catalog_url: "https://github.com/github/awesome-copilot/blob/main/plugins/external.json",
    issue_state: issue.state,
    issue_labels: labels,
    issue_created_at: issue.createdAt,
    issue_updated_at: issue.updatedAt,
    issue_closed_at: issue.closedAt,
    review_status: reviewStatus,
    automated_intake_passed: labels.includes("ready-for-review") || labels.includes("approved") || listed,
    listed,
    listed_version: listed ? matching[0].version : null,
    listed_source_sha: listed ? matching[0].source?.sha || null : null,
    exposed_at: listed ? previousStatus.exposed_at || observedAt : null,
    measurement: "submission_review_and_default_catalog_presence_not_impressions_installs_or_purchases",
  };
}

async function lobeHubStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [{ stdout: issueOutput }, listingResponse] = await Promise.all([
      execFileAsync("gh", [
        "issue", "view", String(lobeHubIssueNumber),
        "--repo", "lobehub/lobehub",
        "--json", "number,title,state,labels,createdAt,updatedAt,closedAt,url",
      ], { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }),
      fetch(lobeHubListingUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    const issue = JSON.parse(issueOutput) as Record<string, any>;
    if (issue.number !== lobeHubIssueNumber || issue.url !== lobeHubIssueUrl || !Array.isArray(issue.labels)) {
      throw new Error("LobeHub returned malformed submission telemetry.");
    }
    const body = await listingResponse.text();
    if (body.length > 1_000_000) throw new Error("LobeHub listing response is unbounded.");
    const exactListing = listingResponse.ok &&
      body.includes("# BountyVerdict Agent Decision Tools") &&
      body.includes(`\`${lobeHubListingId}\``) &&
      body.includes("**Connection Type:** remote");
    const labels = issue.labels.map((label: Record<string, unknown>) => String(label.name || ""))
      .filter(Boolean)
      .sort();
    const status = exactListing
      ? "listed"
      : listingResponse.ok
        ? "contract_drift"
        : issue.state === "CLOSED"
          ? "closed_without_listing"
          : "pending_review";
    return {
      url: lobeHubIssueUrl,
      listing_url: lobeHubListingUrl,
      issue_state: issue.state,
      issue_labels: labels,
      issue_created_at: issue.createdAt,
      issue_updated_at: issue.updatedAt,
      issue_closed_at: issue.closedAt,
      listing_http_status: listingResponse.status,
      listed: exactListing,
      status,
      exposed_at: exactListing ? previousStatus.exposed_at || observedAt : null,
      measurement: "submission_review_and_catalog_presence_not_impressions_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: lobeHubIssueUrl,
      listing_url: lobeHubListingUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function awesomeMcpServersStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [review, catalogResponse] = await Promise.all([
      githubPrStatus(
        "punkpeye",
        "awesome-mcp-servers",
        awesomeMcpServersPrNumber,
        awesomeMcpServersPrUrl,
      ),
      fetch(awesomeMcpServersReadmeUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (!catalogResponse.ok) {
      return {
        url: awesomeMcpServersPrUrl,
        catalog_url: awesomeMcpServersReadmeUrl,
        pr_status: review.status || "unknown",
        ...githubPrFields(review),
        catalog_http_status: catalogResponse.status,
        listed: false,
        contract_verified: false,
        status: "catalog_unavailable",
        measurement: "submission_and_catalog_presence_not_impressions_tool_calls_purchases_or_revenue",
      };
    }
    const parsed = parseAwesomeMcpServersReadme(await catalogResponse.text(), repository, `${productionOrigin}/mcp`);
    const prStatus = String(review.status || "unknown");
    const status = parsed.contract_verified
      ? "catalog_listed"
      : parsed.listed
        ? "catalog_contract_drift"
        : prStatus === "merged"
          ? "pr_merged_awaiting_catalog"
          : prStatus === "open"
            ? "pr_open"
            : prStatus === "closed"
              ? "pr_closed_without_catalog"
              : "pr_status_unknown";
    return {
      url: awesomeMcpServersPrUrl,
      catalog_url: awesomeMcpServersReadmeUrl,
      pr_status: prStatus,
      ...githubPrFields(review),
      catalog_http_status: catalogResponse.status,
      ...parsed,
      status,
      first_listed_at: parsed.contract_verified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "submission_and_catalog_presence_not_impressions_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: awesomeMcpServersPrUrl,
      catalog_url: awesomeMcpServersReadmeUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_and_catalog_presence_not_impressions_tool_calls_purchases_or_revenue",
    };
  }
}

async function tensorBlockMcpIndexStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  const searchUrl = new URL("/v1/servers", tensorBlockIndexApi);
  searchUrl.searchParams.set("query", "bountyverdict");
  searchUrl.searchParams.set("limit", "20");
  try {
    const [issueResponse, review, healthResponse, searchResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/TensorBlock/awesome-mcp-servers/issues/${tensorBlockIssueNumber}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "bountyverdict-directory-monitor/1.0",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      githubPrStatus("TensorBlock", "awesome-mcp-servers", tensorBlockPrNumber, tensorBlockPrUrl),
      fetch(`${tensorBlockIndexApi}/health`, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(searchUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (!issueResponse.ok || !healthResponse.ok || !searchResponse.ok) {
      throw new Error(`TensorBlock returned HTTP ${issueResponse.status}/${healthResponse.status}/${searchResponse.status}.`);
    }
    const [issueBody, healthBody, searchBody] = await Promise.all([
      issueResponse.text(),
      healthResponse.text(),
      searchResponse.text(),
    ]);
    if (issueBody.length > 1_000_000 || healthBody.length > 100_000 || searchBody.length > 2_000_000) {
      throw new Error("TensorBlock returned an unbounded response.");
    }
    const issue = JSON.parse(issueBody) as Record<string, any>;
    const health = JSON.parse(healthBody) as Record<string, any>;
    if (issue.number !== tensorBlockIssueNumber || issue.html_url !== tensorBlockIssueUrl ||
      !["open", "closed"].includes(issue.state) || !Array.isArray(issue.labels) || issue.labels.length > 50 ||
      health.status !== "ok" || !Number.isSafeInteger(health.catalogEntries) ||
      health.catalogEntries < 1 || health.catalogEntries > 100_000 ||
      typeof health.loadedAt !== "string" || !Number.isFinite(Date.parse(health.loadedAt)) ||
      !health.build || typeof health.build !== "object" || Array.isArray(health.build) ||
      typeof health.build.commitSha !== "string" || !/^[0-9a-f]{40}$/i.test(health.build.commitSha) ||
      typeof health.build.builtAt !== "string" || !Number.isFinite(Date.parse(health.build.builtAt))) {
      throw new Error("TensorBlock returned malformed issue or health telemetry.");
    }
    const search = parseTensorBlockSearch(
      JSON.parse(searchBody),
      tensorBlockServerId,
      repository,
      tensorBlockPrNumber,
    );
    let profile: Record<string, unknown> | null = null;
    if (search.listed) {
      const profileResponse = await fetch(`${tensorBlockIndexApi}/v1/servers/${tensorBlockServerId}`, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!profileResponse.ok) throw new Error(`TensorBlock profile returned HTTP ${profileResponse.status}.`);
      const profileBody = await profileResponse.text();
      if (profileBody.length > 1_000_000) throw new Error("TensorBlock profile response is unbounded.");
      profile = parseTensorBlockProfile(JSON.parse(profileBody), tensorBlockServerId, repository, `${productionOrigin}/mcp`);
    }
    const prStatus = String(review.status || "unknown");
    const contractVerified = profile?.contract_verified === true;
    const status = contractVerified
      ? "catalog_listed"
      : search.listed
        ? "catalog_contract_drift"
        : prStatus === "merged"
          ? "pr_merged_awaiting_catalog"
          : prStatus === "open"
            ? "pr_open"
            : "submission_pending";
    return {
      url: tensorBlockIssueUrl,
      pr_url: tensorBlockPrUrl,
      api_url: tensorBlockIndexApi,
      issue_status: issue.state,
      issue_labels: issue.labels.map((label: Record<string, unknown>) => String(label.name || "")).filter(Boolean).sort(),
      pr_status: prStatus,
      ...githubPrFields(review),
      indexed_servers: health.catalogEntries,
      catalog_loaded_at: health.loadedAt,
      catalog_build_sha: health.build.commitSha,
      ...search,
      profile,
      contract_verified: contractVerified,
      status,
      first_listed_at: contractVerified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "submission_and_agent_ready_catalog_presence_not_search_impressions_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: tensorBlockIssueUrl,
      pr_url: tensorBlockPrUrl,
      api_url: tensorBlockIndexApi,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_and_agent_ready_catalog_presence_not_search_impressions_tool_calls_purchases_or_revenue",
    };
  }
}

async function agentageStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  const call = async (id: number, name: string, args: Record<string, unknown>) => {
    const response = await fetch(agentageMcpUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-11-25",
        "User-Agent": "bountyverdict-directory-monitor/1.0",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Agentage returned HTTP ${response.status}.`);
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error("Agentage returned an unbounded response.");
    return JSON.parse(body) as unknown;
  };
  try {
    const detail = parseAgentageGetResponse(
      await call(1, "mcp_get", { slug: agentageSlug }),
      agentageSlug,
      `${productionOrigin}/mcp?source=mcp-registry`,
    );
    const contractVerified = detail?.contract_verified === true;
    return {
      url: `https://catalog.agentage.io/mcp/${agentageSlug}`,
      directory_mcp: agentageMcpUrl,
      listed: detail.listed === true,
      slug: agentageSlug,
      details_url: `https://catalog.agentage.io/mcp/${agentageSlug}`,
      detail,
      contract_verified: contractVerified,
      status: contractVerified ? "catalog_listed" : detail.listed === true ? "catalog_contract_drift" : "pending_official_registry_crawl",
      first_listed_at: contractVerified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "owner_run_exact_catalog_record_lookup_not_search_impressions_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: `https://catalog.agentage.io/mcp/${agentageSlug}`,
      directory_mcp: agentageMcpUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "owner_run_exact_catalog_record_lookup_not_search_impressions_tool_calls_purchases_or_revenue",
    };
  }
}

async function dockerMcpRegistryStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [review, definitionResponse, hubResponse] = await Promise.all([
      githubPrStatus("docker", "mcp-registry", dockerMcpRegistryPrNumber, dockerMcpRegistryPrUrl),
      fetch(dockerMcpRegistryDefinitionUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(dockerMcpHubUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (![200, 404].includes(definitionResponse.status) || ![200, 404].includes(hubResponse.status)) {
      throw new Error(`Docker MCP Registry returned HTTP ${definitionResponse.status}/${hubResponse.status}.`);
    }
    const definition = definitionResponse.status === 200
      ? parseDockerMcpRegistryDefinition(await definitionResponse.text(), `${productionOrigin}/mcp`)
      : null;
    const hub = hubResponse.status === 200
      ? parseDockerMcpHubPage(await hubResponse.text(), `${productionOrigin}/mcp`)
      : null;
    const prStatus = String(review.status || "unknown");
    const contractVerified = hub?.contract_verified === true;
    const status = contractVerified
      ? "catalog_listed"
      : definition?.contract_verified === true
        ? "registry_merged_awaiting_catalog"
        : prStatus === "open"
          ? "pr_open"
          : prStatus === "merged"
            ? "pr_merged_definition_pending"
            : prStatus === "closed"
              ? "pr_closed_without_catalog"
              : "pr_status_unknown";
    return {
      url: dockerMcpRegistryPrUrl,
      definition_url: dockerMcpRegistryDefinitionUrl,
      catalog_url: dockerMcpHubUrl,
      pr_status: prStatus,
      ...githubPrFields(review),
      definition_http_status: definitionResponse.status,
      catalog_http_status: hubResponse.status,
      definition,
      hub,
      listed: hub?.listed === true,
      contract_verified: contractVerified,
      skillverdict_contamination_risk: definition?.skillverdict_contamination_risk === true ||
        hub?.skillverdict_contamination_risk === true,
      status,
      first_listed_at: contractVerified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "submission_and_docker_catalog_presence_not_impressions_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: dockerMcpRegistryPrUrl,
      definition_url: dockerMcpRegistryDefinitionUrl,
      catalog_url: dockerMcpHubUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_and_docker_catalog_presence_not_impressions_tool_calls_purchases_or_revenue",
    };
  }
}

async function mcpServersOrgStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [receiptResponse, listingHead] = await Promise.all([
      fetch(mcpServersOrgReceiptUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(mcpServersOrgListingUrl, {
        method: "HEAD",
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (receiptResponse.status !== 200 || ![200, 404].includes(listingHead.status)) {
      throw new Error(`MCPServers.org returned HTTP ${receiptResponse.status}/${listingHead.status}.`);
    }
    const receiptBody = await receiptResponse.text();
    if (receiptBody.length > 1_000_000 ||
      !receiptBody.includes("BountyVerdict Agent Decision Tools") ||
      !receiptBody.includes("has been submitted successfully") ||
      (!receiptBody.includes(`submissionId":${mcpServersOrgSubmissionId}`) &&
        !receiptBody.includes(`submissionId\\":${mcpServersOrgSubmissionId}`))) {
      throw new Error("MCPServers.org submission receipt is malformed or mismatched.");
    }
    let listing = null;
    if (listingHead.status === 200) {
      const listingResponse = await fetch(mcpServersOrgListingUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (listingResponse.status !== 200) {
        throw new Error(`MCPServers.org listing changed from HTTP 200 to ${listingResponse.status}.`);
      }
      listing = parseMcpServersOrgPage(await listingResponse.text(), repository, `${productionOrigin}/mcp`);
    }
    const contractVerified = listing?.contract_verified === true;
    const listed = listing?.listed === true;
    return {
      submission_id: mcpServersOrgSubmissionId,
      submitted_at: mcpServersOrgSubmittedAt,
      plan: "free",
      payment_status: "not_required",
      receipt_url: mcpServersOrgReceiptUrl,
      receipt_verified: true,
      listing_url: mcpServersOrgListingUrl,
      listing_http_status: listingHead.status,
      listing,
      listed,
      repository_metadata_verified: listing?.repository_metadata_verified === true,
      contract_verified: contractVerified,
      status: contractVerified
        ? "catalog_remote_contract_verified"
        : listed
          ? "catalog_repository_metadata_only"
          : "pending_review",
      first_listed_at: listed ? previousStatus.first_listed_at || observedAt : null,
      measurement: "exact_submission_receipt_and_listing_presence_not_search_impressions_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      submission_id: mcpServersOrgSubmissionId,
      submitted_at: mcpServersOrgSubmittedAt,
      plan: "free",
      payment_status: "not_required",
      receipt_url: mcpServersOrgReceiptUrl,
      listing_url: mcpServersOrgListingUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "exact_submission_receipt_and_listing_presence_not_search_impressions_tool_calls_purchases_or_revenue",
    };
  }
}

async function mcpDirectoryStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const listingHead = await fetch(mcpDirectoryListingUrl, {
      method: "HEAD",
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (![200, 404].includes(listingHead.status)) {
      throw new Error(`MCP.Directory returned HTTP ${listingHead.status}.`);
    }
    let listing = null;
    if (listingHead.status === 200) {
      const listingResponse = await fetch(mcpDirectoryListingUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (listingResponse.status !== 200) {
        throw new Error(`MCP.Directory listing changed from HTTP 200 to ${listingResponse.status}.`);
      }
      listing = parseMcpDirectoryPage(await listingResponse.text(), repository, `${productionOrigin}/mcp`);
    }
    const remoteMetadataVerified = listing?.remote_metadata_verified === true;
    const listed = listing?.listed === true;
    return {
      submitted_at: mcpDirectorySubmittedAt,
      submission_recorded: true,
      submission_response_http_status: 200,
      submission_response_message: "Server submitted for review!",
      submission_url: "https://mcp.directory/submit",
      listing_url: mcpDirectoryListingUrl,
      listing_http_status: listingHead.status,
      listing,
      listed,
      repository_metadata_verified: listing?.repository_metadata_verified === true,
      remote_metadata_verified: remoteMetadataVerified,
      status: remoteMetadataVerified
        ? "catalog_remote_metadata_verified"
        : listed
          ? "catalog_repository_metadata_only"
          : "pending_review",
      first_listed_at: listed ? previousStatus.first_listed_at || observedAt : null,
      measurement: "recorded_submission_http_200_and_exact_listing_presence_not_search_impressions_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      submitted_at: mcpDirectorySubmittedAt,
      submission_recorded: true,
      submission_response_http_status: 200,
      submission_response_message: "Server submitted for review!",
      submission_url: "https://mcp.directory/submit",
      listing_url: mcpDirectoryListingUrl,
      listed: false,
      remote_metadata_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "recorded_submission_http_200_and_exact_listing_presence_not_search_impressions_tool_calls_purchases_or_revenue",
    };
  }
}

async function vaultPlaneStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(vaultPlaneListingUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (![200, 404].includes(response.status)) {
      throw new Error(`VaultPlane returned HTTP ${response.status}.`);
    }
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error("VaultPlane listing response is unbounded.");
    const listed = response.status === 200 &&
      body.includes("BountyVerdict Agent Decision Router") &&
      body.includes("cristianmoroaica/bountyverdict") &&
      body.includes("route-github-agent-decisions");
    return {
      submission_id: vaultPlaneSubmissionId,
      submitted_at: vaultPlaneSubmittedAt,
      submission_status: "pending",
      verification_status: "unverified",
      payment_status: "not_required",
      listing_url: vaultPlaneListingUrl,
      listing_http_status: response.status,
      listed,
      contract_verified: listed,
      status: listed ? "catalog_contract_verified" : "pending_review",
      first_listed_at: listed ? previousStatus.first_listed_at || observedAt : null,
      measurement: "exact_submission_receipt_and_listing_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      submission_id: vaultPlaneSubmissionId,
      submitted_at: vaultPlaneSubmittedAt,
      submission_status: "pending",
      verification_status: "unverified",
      payment_status: "not_required",
      listing_url: vaultPlaneListingUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "exact_submission_receipt_and_listing_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function toolsForAgentsStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(toolsForAgentsListingUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (![200, 404].includes(response.status)) {
      throw new Error(`Tools for Agents returned HTTP ${response.status}.`);
    }
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error("Tools for Agents listing response is unbounded.");
    // The dynamic route itself returns HTTP 200 before review. Require product copy and
    // the endpoint so a generic shell or route-state echo cannot become false exposure.
    const listed = response.status === 200 &&
      body.includes("BountyVerdict") &&
      body.includes("GitHub bounty") &&
      body.includes("bountyverdict-agent-production.mimirslab.workers.dev/mcp");
    return {
      submitted_at: toolsForAgentsSubmittedAt,
      submission_recorded: true,
      submission_response_message: "Submission Received",
      payment_status: "not_required",
      listing_url: toolsForAgentsListingUrl,
      listing_http_status: response.status,
      listed,
      contract_verified: listed,
      status: listed ? "catalog_contract_verified" : "pending_review",
      first_listed_at: listed ? previousStatus.first_listed_at || observedAt : null,
      measurement: "recorded_submission_and_exact_listing_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      submitted_at: toolsForAgentsSubmittedAt,
      submission_recorded: true,
      submission_response_message: "Submission Received",
      payment_status: "not_required",
      listing_url: toolsForAgentsListingUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "recorded_submission_and_exact_listing_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function mcpServerSpotStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(mcpServerSpotListingUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (![200, 404].includes(response.status)) {
      throw new Error(`MCP Server Spot returned HTTP ${response.status}.`);
    }
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("MCP Server Spot listing response is unbounded.");
    const requiredMarkers = [
      "BountyVerdict Agent Decision Tools",
      "cristianmoroaica/bountyverdict",
      "bountyverdict-agent-production.mimirslab.workers.dev/mcp",
      "check_github_bounty",
      "rank_github_bounties",
      "audit_agent_harness",
      "diagnose_github_actions_run",
      "classify_github_actions_flake",
      "check_mcp_tool_drift",
    ];
    const listed = response.status === 200 && requiredMarkers.every((marker) => body.includes(marker));
    return {
      submitted_at: mcpServerSpotSubmittedAt,
      submission_recorded: true,
      submission_response_message: "Your server has been added to the directory.",
      payment_status: "not_required",
      listing_url: mcpServerSpotListingUrl,
      listing_http_status: response.status,
      listed,
      contract_verified: listed,
      status: listed ? "catalog_contract_verified" : response.status === 404 ? "pending_publication" : "catalog_contract_drift",
      first_listed_at: listed ? previousStatus.first_listed_at || observedAt : null,
      measurement: "recorded_submission_and_exact_listing_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      submitted_at: mcpServerSpotSubmittedAt,
      submission_recorded: true,
      submission_response_message: "Your server has been added to the directory.",
      payment_status: "not_required",
      listing_url: mcpServerSpotListingUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "recorded_submission_and_exact_listing_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function clineMarketplaceStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [mcpReview, skillReview, catalogResponse] = await Promise.all([
      githubPrStatus("cline", "marketplace", clineMarketplaceMcpPrNumber, clineMarketplaceMcpPrUrl),
      githubPrStatus("cline", "marketplace", clineMarketplaceSkillPrNumber, clineMarketplaceSkillPrUrl),
      fetch(clineMarketplaceCatalogUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (!catalogResponse.ok) throw new Error(`Cline Marketplace returned HTTP ${catalogResponse.status}.`);
    const body = await catalogResponse.text();
    if (body.length > 2_000_000) throw new Error("Cline Marketplace catalog response is unbounded.");
    const parsed = parseClineMarketplaceCatalog(JSON.parse(body), repository, clineMarketplaceEndpoint);
    const prStatus = String(mcpReview.status || "unknown");
    const status = parsed.contract_verified
      ? "catalog_listed"
      : parsed.listed
        ? "catalog_contract_drift"
        : prStatus === "merged"
          ? "pr_merged_awaiting_catalog"
          : prStatus === "open"
            ? "pr_open"
            : prStatus === "closed"
              ? "pr_closed_without_catalog"
              : "pr_status_unknown";
    return {
      url: clineMarketplaceMcpPrUrl,
      mcp_pr: githubPrSnapshot(mcpReview),
      skill_pr: githubPrSnapshot(skillReview),
      catalog_url: clineMarketplaceCatalogUrl,
      pr_status: prStatus,
      ...githubPrFields(mcpReview),
      catalog_http_status: catalogResponse.status,
      ...parsed,
      status,
      first_listed_at: parsed.contract_verified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "submission_and_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: clineMarketplaceMcpPrUrl,
      mcp_pr: {
        pr_url: clineMarketplaceMcpPrUrl,
        pr_status: "request_failed",
      },
      skill_pr: {
        pr_url: clineMarketplaceSkillPrUrl,
        pr_status: "request_failed",
      },
      catalog_url: clineMarketplaceCatalogUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_and_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function kiloMarketplaceStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [review, definitionResponse, catalogResponse] = await Promise.all([
      githubPrStatus("Kilo-Org", "kilo-marketplace", kiloMarketplacePrNumber, kiloMarketplacePrUrl),
      fetch(kiloMarketplaceDefinitionUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(kiloMarketplaceCatalogUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (![200, 404].includes(definitionResponse.status) || catalogResponse.status !== 200) {
      throw new Error(`Kilo Marketplace returned HTTP ${definitionResponse.status}/${catalogResponse.status}.`);
    }
    const definition = definitionResponse.status === 200
      ? parseKiloMarketplaceDefinition(await definitionResponse.text(), repository, kiloMarketplaceEndpoint)
      : null;
    const catalogBody = await catalogResponse.text();
    const catalog = parseKiloMarketplaceCatalog(catalogBody, repository, kiloMarketplaceEndpoint);
    const prStatus = String(review.status || "unknown");
    const contractVerified = catalog.contract_verified === true;
    const status = contractVerified
      ? "catalog_listed"
      : catalog.listed
        ? "catalog_contract_drift"
        : definition?.contract_verified === true
          ? "definition_merged_awaiting_catalog"
          : prStatus === "open"
            ? "pr_open"
            : prStatus === "merged"
              ? "pr_merged_definition_pending"
              : prStatus === "closed"
                ? "pr_closed_without_catalog"
                : "pr_status_unknown";
    return {
      url: kiloMarketplacePrUrl,
      definition_url: kiloMarketplaceDefinitionUrl,
      catalog_url: kiloMarketplaceCatalogUrl,
      pr_status: prStatus,
      ...githubPrFields(review),
      definition_http_status: definitionResponse.status,
      catalog_http_status: catalogResponse.status,
      definition,
      catalog,
      listed: catalog.listed,
      contract_verified: contractVerified,
      status,
      first_listed_at: contractVerified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "submission_and_kilo_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: kiloMarketplacePrUrl,
      definition_url: kiloMarketplaceDefinitionUrl,
      catalog_url: kiloMarketplaceCatalogUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_and_kilo_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function toolHiveStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [review, catalogResponse] = await Promise.all([
      githubPrStatus("stacklok", "toolhive-catalog", toolHivePrNumber, toolHivePrUrl),
      fetch(toolHiveCatalogUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (![200, 404].includes(catalogResponse.status)) {
      throw new Error(`ToolHive catalog returned HTTP ${catalogResponse.status}.`);
    }
    let catalog: Record<string, unknown> = { listed: false, contract_verified: false };
    let contractError: string | null = null;
    if (catalogResponse.status === 200) {
      const body = await catalogResponse.text();
      if (body.length > 100_000) throw new Error("ToolHive catalog entry is unbounded.");
      try {
        catalog = parseToolHiveCatalogEntry(JSON.parse(body), repository, `${productionOrigin}/mcp`);
      } catch (error) {
        catalog = { listed: true, contract_verified: false };
        contractError = error instanceof Error ? error.message : String(error);
      }
    }
    const prStatus = String(review.status || "unknown");
    const listed = catalog.listed === true;
    const contractVerified = catalog.contract_verified === true;
    const status = contractVerified
      ? "catalog_listed"
      : listed
        ? "catalog_contract_drift"
        : prStatus === "merged"
          ? "pr_merged_awaiting_catalog"
          : prStatus === "open"
            ? "pr_open"
            : prStatus === "closed"
              ? "pr_closed_without_catalog"
              : "pr_status_unknown";
    return {
      url: toolHivePrUrl,
      catalog_url: toolHiveCatalogUrl,
      pr_status: prStatus,
      ...githubPrFields(review),
      catalog_http_status: catalogResponse.status,
      ...catalog,
      contract_error: contractError,
      status,
      first_listed_at: contractVerified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "submission_and_toolhive_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: toolHivePrUrl,
      catalog_url: toolHiveCatalogUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_and_toolhive_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function openHandsIntegrationsStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [review, catalogResponse] = await Promise.all([
      githubPrStatus("OpenHands", "extensions", openHandsIntegrationsPrNumber, openHandsIntegrationsPrUrl),
      fetch(openHandsIntegrationsCatalogUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (![200, 404].includes(catalogResponse.status)) {
      throw new Error(`OpenHands integration catalog returned HTTP ${catalogResponse.status}.`);
    }
    let listed = false;
    let contractVerified = false;
    let contractError: string | null = null;
    if (catalogResponse.status === 200) {
      listed = true;
      const body = await catalogResponse.text();
      if (body.length > 100_000) throw new Error("OpenHands integration entry is unbounded.");
      try {
        const entry = JSON.parse(body) as unknown;
        const expected = {
          id: "bountyverdict",
          name: "BountyVerdict Agent Decision Tools",
          description: openHandsIntegrationsDescription,
          appUrl: "https://mimirs402.github.io/bountyverdict/",
          docsUrl: "https://mimirs402.github.io/bountyverdict/agents.html",
          keywords: ["github", "ci", "agent-safety", "mcp", "x402"],
          connectionOptions: [{
            id: "none",
            provider: "mcp",
            transport: { kind: "shttp", url: openHandsIntegrationsEndpoint },
            auth: { strategy: "none" },
          }],
        };
        contractVerified = JSON.stringify(entry) === JSON.stringify(expected);
        if (!contractVerified) contractError = "OpenHands catalog entry drifted from the exact no-auth remote contract.";
      } catch (error) {
        contractError = error instanceof Error ? error.message : String(error);
      }
    }
    const prStatus = String(review.status || "unknown");
    const status = contractVerified
      ? "catalog_listed"
      : listed
        ? "catalog_contract_drift"
        : prStatus === "merged"
          ? "pr_merged_awaiting_catalog"
          : prStatus === "open"
            ? "pr_open"
            : prStatus === "closed"
              ? "pr_closed_without_catalog"
              : "pr_status_unknown";
    return {
      url: openHandsIntegrationsPrUrl,
      catalog_url: openHandsIntegrationsCatalogUrl,
      pr_status: prStatus,
      ...githubPrFields(review),
      catalog_http_status: catalogResponse.status,
      listed,
      contract_verified: contractVerified,
      contract_error: contractError,
      status,
      first_listed_at: contractVerified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "submission_and_openhands_runtime_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: openHandsIntegrationsPrUrl,
      catalog_url: openHandsIntegrationsCatalogUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_and_openhands_runtime_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function gooseExtensionsStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [review, catalogResponse] = await Promise.all([
      githubPrStatus("aaif-goose", "goose", gooseExtensionsPrNumber, gooseExtensionsPrUrl),
      fetch(gooseExtensionsCatalogUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (!catalogResponse.ok) throw new Error(`goose Extensions catalog returned HTTP ${catalogResponse.status}.`);
    const body = await catalogResponse.text();
    if (body.length > 5_000_000) throw new Error("goose Extensions catalog is unbounded.");
    const entries = JSON.parse(body) as unknown;
    if (!Array.isArray(entries)) throw new Error("goose Extensions catalog is malformed.");
    const matching = entries.filter((entry) => entry && typeof entry === "object" &&
      (entry as Record<string, unknown>).id === "bountyverdict");
    const listed = matching.length === 1;
    const expected = {
      id: "bountyverdict",
      name: "BountyVerdict Agent Decision Tools",
      description: openHandsIntegrationsDescription,
      type: "streamable-http",
      url: gooseExtensionsEndpoint,
      link: "https://github.com/Mimirs402/bountyverdict",
      installation_notes: "No BountyVerdict account or API key is required. Connecting and listing tools are free. A valid unsigned tool call returns an exact x402 v2 Base USDC payment requirement; the standard goose MCP connection does not itself authorize or settle the payment.",
      is_builtin: false,
      endorsed: false,
      environmentVariables: [],
    };
    const contractVerified = listed && JSON.stringify(matching[0]) === JSON.stringify(expected);
    const contractError = matching.length > 0 && !contractVerified
      ? "goose catalog entry drifted from the exact keyless Streamable HTTP contract."
      : null;
    const prStatus = String(review.status || "unknown");
    const status = contractVerified
      ? "catalog_listed"
      : matching.length > 0
        ? "catalog_contract_drift"
        : prStatus === "merged"
          ? "pr_merged_awaiting_catalog"
          : prStatus === "open"
            ? "pr_open"
            : prStatus === "closed"
              ? "pr_closed_without_catalog"
              : "pr_status_unknown";
    return {
      url: gooseExtensionsPrUrl,
      catalog_url: gooseExtensionsCatalogUrl,
      pr_status: prStatus,
      ...githubPrFields(review),
      catalog_http_status: catalogResponse.status,
      listed,
      matching_entries: matching.length,
      contract_verified: contractVerified,
      contract_error: contractError,
      status,
      first_listed_at: contractVerified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "submission_and_goose_in_agent_extensions_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: gooseExtensionsPrUrl,
      catalog_url: gooseExtensionsCatalogUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_and_goose_in_agent_extensions_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function geminiCliGalleryStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(geminiCliGalleryUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Gemini CLI Extensions Gallery returned HTTP ${response.status}.`);
    const body = await response.text();
    if (body.length > 5_000_000) throw new Error("Gemini CLI Extensions Gallery response is unbounded.");
    const entries = JSON.parse(body) as unknown;
    if (!Array.isArray(entries)) throw new Error("Gemini CLI Extensions Gallery returned a malformed catalog.");
    const matches = entries.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) &&
      String((entry as Record<string, unknown>).fullName || "").toLowerCase() === "mimirs402/bountyverdict");
    if (matches.length > 1) throw new Error("Gemini CLI Extensions Gallery duplicated BountyVerdict.");
    const entry = matches[0] as Record<string, unknown> | undefined;
    const listed = Boolean(entry);
    const contractVerified = Boolean(entry && entry.url === repository && entry.extensionName === "bountyverdict" &&
      entry.extensionVersion === "1.1.9" && entry.hasMCP === true);
    return {
      url: "https://geminicli.com/extensions/",
      catalog_url: geminiCliGalleryUrl,
      catalog_http_status: response.status,
      listed,
      contract_verified: contractVerified,
      status: contractVerified ? "catalog_listed" : listed ? "catalog_contract_drift" : "pending_daily_crawl",
      rank: typeof entry?.rank === "number" ? entry.rank : null,
      stars: typeof entry?.stars === "number" ? entry.stars : null,
      last_updated: typeof entry?.lastUpdated === "string" ? entry.lastUpdated : null,
      first_listed_at: contractVerified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "exact_gemini_cli_gallery_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: "https://geminicli.com/extensions/",
      catalog_url: geminiCliGalleryUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "exact_gemini_cli_gallery_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function agentFinderCatalogStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [prReview, { stdout: prOutput }, { stdout: prFilesOutput }, catalogResponse, registryResponse, searchResponse] = await Promise.all([
      readGitHubPrStatus("github", "agentfinder-catalog", agentFinderPrNumber, agentFinderPrUrl, timeoutMs),
      execFileAsync("gh", ["api", `repos/github/agentfinder-catalog/pulls/${agentFinderPrNumber}`], {
        timeout: timeoutMs,
        maxBuffer: 1_000_000,
        encoding: "utf8",
      }),
      execFileAsync("gh", [
        "api", "--method", "GET", `repos/github/agentfinder-catalog/pulls/${agentFinderPrNumber}/files`,
        "-f", "per_page=100",
      ], { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }),
      fetch(agentFinderCatalogEntryUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(officialMcpRegistryLatestUrl, {
        headers: { Accept: "application/json", "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(agentFinderSearchUrl, {
        headers: { Accept: "text/html", "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (prReview.status === "request_failed" || ![200, 404].includes(catalogResponse.status) ||
      registryResponse.status !== 200 || searchResponse.status !== 200) {
      throw new Error(`Agent Finder returned unavailable PR telemetry or HTTP ${catalogResponse.status}/${registryResponse.status}/${searchResponse.status}.`);
    }
    const pr = JSON.parse(String(prOutput)) as Record<string, any>;
    const prFiles = JSON.parse(String(prFilesOutput)) as unknown;
    if (!Array.isArray(prFiles) || prFiles.length > 100 ||
      prFiles.some((file: unknown) => !file || typeof file !== "object" || Array.isArray(file) ||
        typeof (file as Record<string, unknown>).filename !== "string" ||
        String((file as Record<string, unknown>).filename).length > 1_000)) {
      throw new Error("Agent Finder PR files are malformed or unbounded.");
    }
    const prContractVerified = pr.number === agentFinderPrNumber && pr.html_url === agentFinderPrUrl &&
      pr.base?.repo?.full_name === "github/agentfinder-catalog" && pr.base?.ref === "main" &&
      pr.head?.label === "Mimirs402:add-bountyverdict-canonical-mimirslab" && pr.changed_files === 1 &&
      prFiles.length === 1 && prFiles[0].filename === agentFinderCatalogEntryPath && prFiles[0].status === "added";
    const prStatus = prReview.status;

    let catalog = null;
    if (catalogResponse.status === 200) {
      const body = await catalogResponse.text();
      if (body.length > 100_000) throw new Error("Agent Finder catalog entry is unbounded.");
      catalog = parseAgentFinderCatalogEntry(
        JSON.parse(body),
        agentFinderIdentifier,
        officialMcpRegistryLatestUrl,
        officialMcpServerName,
      );
    }
    const registryBody = await registryResponse.text();
    if (registryBody.length > 500_000) throw new Error("Agent Finder Registry response is unbounded.");
    const registry = parseAgentFinderRegistryLatest(
      JSON.parse(registryBody),
      officialMcpServerName,
      repository,
      mcpMarketplaceEndpoint,
    );
    const search = parseAgentFinderSearchPage(
      await searchResponse.text(),
      agentFinderIdentifier,
      officialMcpRegistryLatestUrl,
    );
    const status = !registry.contract_verified
      ? "registry_contract_drift"
      : search.listed
        ? search.contract_verified ? "agent_finder_search_listed" : "agent_finder_search_contract_drift"
        : catalog?.listed
          ? catalog.contract_verified ? "catalog_listed_awaiting_search_index" : "catalog_contract_drift"
          : !prContractVerified
            ? "pr_contract_drift"
            : prStatus === "merged"
              ? "pr_merged_awaiting_catalog"
              : prStatus === "open"
                ? "pr_open"
                : prStatus === "closed"
                  ? "pr_closed_without_catalog"
                  : "pr_status_unknown";
    return {
      url: agentFinderPrUrl,
      pr_number: agentFinderPrNumber,
      pr_status: prStatus,
      ...githubPrFields(prReview),
      pr_contract_verified: prContractVerified,
      catalog_url: agentFinderCatalogEntryUrl,
      catalog_http_status: catalogResponse.status,
      catalog_listed: catalog?.listed === true,
      catalog_contract_verified: catalog?.contract_verified === true,
      registry_url: officialMcpRegistryLatestUrl,
      registry_http_status: registryResponse.status,
      registry_contract_verified: registry.contract_verified,
      registry_version: registry.version,
      search_url: agentFinderSearchUrl,
      search_http_status: searchResponse.status,
      search_listed: search.listed,
      search_contract_verified: search.contract_verified,
      search_rank: search.rank,
      search_total_results: search.total_results,
      status,
      first_catalog_listed_at: catalog?.contract_verified === true
        ? previousStatus.first_catalog_listed_at || observedAt
        : null,
      first_search_listed_at: search.contract_verified
        ? previousStatus.first_search_listed_at || observedAt
        : null,
      measurement: "exact_pr_catalog_registry_and_owner_run_search_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: agentFinderPrUrl,
      pr_number: agentFinderPrNumber,
      catalog_url: agentFinderCatalogEntryUrl,
      registry_url: officialMcpRegistryLatestUrl,
      search_url: agentFinderSearchUrl,
      catalog_listed: false,
      catalog_contract_verified: false,
      registry_contract_verified: false,
      search_listed: false,
      search_contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "exact_pr_catalog_registry_and_owner_run_search_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function agentToolStatus(): Promise<Record<string, unknown>> {
  const apiUrl = "https://agenttool.sh/api/tools/bountyverdict-agent-decision-apis";
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      url: agentToolUrl,
      api_url: apiUrl,
      http_status: response.status,
      listed: response.ok,
      status: response.ok ? "listed" : response.status === 404 ? "scanning" : "unexpected_response",
    };
  } catch (error) {
    return {
      url: agentToolUrl,
      api_url: apiUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mcpRepositoryStatus(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(mcpRepositoryUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error("MCPRepository listing response is unbounded.");
    const title = body.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || "";
    const exactRepositoryLink = /href="https:\/\/github\.com\/cristianmoroaica\/bountyverdict(?:\?ref=mcprepository\.com)?"/i.test(body);
    const listed = response.ok && title.length > 0 && exactRepositoryLink;
    return {
      url: mcpRepositoryUrl,
      http_status: response.status,
      submitted_at: mcpRepositorySubmittedAt,
      listed,
      status: listed ? "listed" : response.ok || response.status === 404 ? "queued_validation" : "unexpected_response",
      title: listed ? title : null,
      measurement: "submission_and_catalog_presence_not_impressions_installs_or_purchases",
    };
  } catch (error) {
    return {
      url: mcpRepositoryUrl,
      submitted_at: mcpRepositorySubmittedAt,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function agentNdxStatus(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(agentNdxIndexUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        url: "https://agentndx.ai/",
        index_url: agentNdxIndexUrl,
        submitted_at: agentNdxSubmittedAt,
        http_status: response.status,
        listed: false,
        status: "unexpected_response",
      };
    }
    const body = await response.text();
    if (body.length > 5_000_000) throw new Error("AgentNDX index response is unbounded.");
    const payload = JSON.parse(body) as { servers?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.servers) || payload.servers.length > 10_000) {
      throw new Error("AgentNDX returned malformed or unbounded index telemetry.");
    }
    const matching = payload.servers.filter(({ github_url, endpoint }) =>
      github_url === repository || endpoint === `${productionOrigin}/mcp`
    );
    if (matching.length > 1) throw new Error("AgentNDX duplicated the BountyVerdict listing.");
    const entry = matching[0] || null;
    return {
      url: "https://agentndx.ai/",
      index_url: agentNdxIndexUrl,
      submitted_at: agentNdxSubmittedAt,
      http_status: response.status,
      listed: Boolean(entry),
      status: entry ? "listed" : "pending_review",
      indexed_servers: payload.servers.length,
      entry,
      measurement: "submission_and_catalog_presence_not_search_impressions_tool_calls_or_purchases",
    };
  } catch (error) {
    return {
      url: "https://agentndx.ai/",
      index_url: agentNdxIndexUrl,
      submitted_at: agentNdxSubmittedAt,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mcpObservatoryStatus(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(mcpObservatoryUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { url: mcpObservatoryUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error("MCP Observatory detail response is unbounded.");
    return {
      url: mcpObservatoryUrl,
      http_status: response.status,
      ...parseMcpObservatoryDetail(JSON.parse(body), mcpObservatoryServerId, repository),
      measurement: "automatic_repository_indexing_not_agent_discovery_impressions_tool_calls_or_purchases",
    };
  } catch (error) {
    return {
      url: mcpObservatoryUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function agent402Status(): Promise<Record<string, unknown>> {
  try {
    const [indexResponse, ...routeResponses] = await Promise.all([
      fetch(`${agent402Api}/index`, {
        headers: { "User-Agent": "bountyverdict-directory-monitor" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      ...agent402BuyerQueries.map(({ query }) => fetch(`${agent402Api}/route`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "bountyverdict-directory-monitor",
        },
        body: JSON.stringify({ query, top: 25, include: "external" }),
        signal: AbortSignal.timeout(timeoutMs),
      })),
    ]);
    if (!indexResponse.ok) {
      return { url: "https://agent402.tools/marketplace", http_status: indexResponse.status, listed: false, status: "unexpected_response" };
    }
    const index = await indexResponse.json() as {
      totals?: Record<string, unknown>;
      sellers?: Array<Record<string, unknown>>;
    };
    const seller = (index.sellers || []).find((entry) => entry.origin === productionOrigin);
    const queries = await Promise.all(routeResponses.map(async (response, queryIndex) => {
      const expected = agent402BuyerQueries[queryIndex];
      if (!response.ok) {
        return { ...expected, found: false, rank: null, http_status: response.status, status: "unexpected_response" };
      }
      const payload = await response.json() as { results?: Array<Record<string, unknown>> };
      const results = Array.isArray(payload.results) ? payload.results : [];
      const rankIndex = results.findIndex((entry) =>
        entry.seller === productionOrigin && entry.route === expected.path
      );
      const match = rankIndex >= 0 ? results[rankIndex] : null;
      return {
        ...expected,
        found: rankIndex >= 0,
        rank: rankIndex >= 0 ? rankIndex + 1 : null,
        score: match && typeof match.score === "number" ? match.score : null,
        price_usd: match && (typeof match.priceUsd === "number" || typeof match.priceUsd === "string")
          ? match.priceUsd
          : null,
        returned_results: results.length,
      };
    }));
    const foundQueries = queries.filter(({ found }) => found).length;
    const topThreeQueries = queries.filter(({ rank }) => typeof rank === "number" && rank <= 3).length;
    return {
      url: "https://agent402.tools/marketplace",
      api_url: `${agent402Api}/index`,
      http_status: indexResponse.status,
      listed: Boolean(seller),
      status: seller ? "listed" : "missing",
      routable: seller?.routable === true,
      health: typeof seller?.health === "number" ? seller.health : null,
      listing_source: seller?.source || null,
      native_manifest: seller?.source === "manifest",
      observed_tool_count: typeof seller?.toolCount === "number" ? seller.toolCount : null,
      ecosystem_sellers: index.totals?.sellers ?? null,
      query_count: queries.length,
      found_queries: foundQueries,
      top_three_queries: topThreeQueries,
      query_benchmark: queries,
      measurement: "owner_run_unbranded_retrieval_benchmark_not_search_impressions_or_customer_purchases",
    };
  } catch (error) {
    return {
      url: "https://agent402.tools/marketplace",
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function githubPrStatus(
  owner: string,
  repo: string,
  pull: number,
  url: string,
): Promise<GitHubPrStatus> {
  return readGitHubPrStatus(owner, repo, pull, url, timeoutMs);
}

async function x402ScoutStatus(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${x402ScoutUrl}?limit=500&offset=0`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { url: x402ScoutUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as { count?: number; endpoints?: Array<Record<string, unknown>> };
    const expected = new Set(x402ScoutIds);
    const catalog = payload.endpoints || [];
    const entries = catalog
      .map((entry, index) => ({ entry, position: index + 1 }))
      .filter(({ entry }) => expected.has(String(entry.id)))
      .map(({ entry, position }) => ({
        id: entry.id,
        name: entry.name,
        url: entry.url,
        catalog_position: position,
        registered_at: entry.registered_at,
        status: entry.status,
        health_status: entry.health_status,
        uptime_pct: entry.uptime_pct,
        avg_latency_ms: entry.avg_latency_ms,
        query_count: entry.query_count,
        tags: entry.tags,
        capability_tags: entry.capability_tags,
        trust_score: entry.trust_score,
      }));
    const exposedAt = entries
      .map((entry) => String(entry.registered_at || ""))
      .filter((value) => Number.isFinite(Date.parse(value)))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || null;
    const uniqueEntryIds = new Set(entries.map((entry) => String(entry.id)));
    const listed = entries.length === x402ScoutIds.length &&
      uniqueEntryIds.size === x402ScoutIds.length &&
      entries.every((entry) => entry.status === "active");
    const queryCounts = entries.map((entry) =>
      typeof entry.query_count === "number" && Number.isSafeInteger(entry.query_count) && entry.query_count >= 0
        ? entry.query_count
        : null
    );
    const queryTelemetryAvailable = queryCounts.length === x402ScoutIds.length &&
      queryCounts.every((value): value is number => value !== null);
    const skillEntry = entries.find((entry) => entry.id === "dfc4f4e3-b1ea-440d-b9c1-a416296e4fdd");
    const skillQueryCount = skillEntry && typeof skillEntry.query_count === "number" &&
      Number.isSafeInteger(skillEntry.query_count) && skillEntry.query_count >= 0
      ? skillEntry.query_count
      : null;
    const totalQueryCount = queryTelemetryAvailable
      ? queryCounts.reduce((total, value) => total + (value ?? 0), 0)
      : null;
    return {
      url: x402ScoutUrl,
      http_status: response.status,
      listed,
      status: listed ? "listed" : entries.length ? "partial" : "missing",
      exposed_at: exposedAt,
      expected_entries: x402ScoutIds.length,
      listed_entries: entries.length,
      unique_entry_ids: uniqueEntryIds.size,
      catalog_entries: Number(payload.count || catalog.length),
      catalog_positions: entries.map((entry) => entry.catalog_position),
      query_telemetry_available: queryTelemetryAvailable,
      total_query_count: totalQueryCount,
      skillverdict_query_count: skillQueryCount,
      non_target_query_count: totalQueryCount === null || skillQueryCount === null
        ? null
        : totalQueryCount - skillQueryCount,
      entries,
    };
  } catch (error) {
    return {
      url: x402ScoutUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function x402ScanStatus(): Promise<Record<string, unknown>> {
  const resources = x402ScanResources.map(({ url, method }) => ({ url, method }));
  const input = encodeURIComponent(JSON.stringify({ json: { resources } }));
  const apiUrl = `${x402ScanUrl}/api/trpc/public.resources.checkRegistered?input=${input}`;
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { url: x402ScanUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as {
      result?: { data?: { json?: { registered?: unknown; unregistered?: unknown } } };
    };
    const result = payload.result?.data?.json;
    const registered = Array.isArray(result?.registered)
      ? result.registered.filter((value): value is string => typeof value === "string")
      : [];
    const unregistered = Array.isArray(result?.unregistered)
      ? result.unregistered.filter((value): value is string => typeof value === "string")
      : [];
    const expected = new Set<string>(x402ScanResources.map(({ url }) => url));
    const exact = registered.length === expected.size &&
      new Set(registered).size === expected.size && registered.every((url) => expected.has(url));
    return {
      url: `${x402ScanUrl}/resources`,
      api_url: apiUrl,
      http_status: response.status,
      listed: exact,
      status: exact ? "listed" : registered.length ? "partial" : "missing",
      expected_resources: expected.size,
      listed_resources: registered.length,
      registered,
      unregistered,
      measurement: "public_registry_presence_not_customer_purchases",
    };
  } catch (error) {
    return {
      url: x402ScanUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function x402gleStatus(): Promise<Record<string, unknown>> {
  const skillsUrl = `${x402gleHostUrl}/skills.json`;
  try {
    const response = await fetch(skillsUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { url: x402gleHostUrl, skills_url: skillsUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as {
      ok?: unknown;
      host?: unknown;
      skill_count?: unknown;
      skills?: Array<Record<string, unknown>>;
    };
    const skills = Array.isArray(payload.skills) ? payload.skills : [];
    const names = skills.map(({ skill_name }) => skill_name).filter((value): value is string => typeof value === "string");
    const valid = payload.ok === true && payload.host === new URL(productionOrigin).host &&
      Number(payload.skill_count) === skills.length && new Set(names).size === names.length;
    if (!valid) throw new Error("x402gle returned malformed or mismatched skill telemetry.");
    return {
      url: x402gleHostUrl,
      skills_url: skillsUrl,
      skill_url: `${x402gleHostUrl}/SKILL.md`,
      agent_card_url: `${x402gleHostUrl}/.well-known/agent.json`,
      http_status: response.status,
      listed: skills.length > 0,
      status: skills.length >= 7 ? "listed" : skills.length ? "listed_partial" : "missing",
      expected_products: 7,
      synthesized_skills: skills.length,
      skill_names: names,
      measurement: "public_agent_skill_listing_not_customer_purchase",
    };
  } catch (error) {
    return {
      url: x402gleHostUrl,
      skills_url: skillsUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function agentToolsCloudStatus(): Promise<Record<string, unknown>> {
  const searchUrl = `${agentToolsCloudApi}/search?q=bountyverdict&limit=100`;
  const detailUrl = `${agentToolsCloudApi}/services/${agentToolsCloudSlug}`;
  const mcpSearchUrl = `${agentToolsCloudApi}/mcp/search?q=BountyVerdict&limit=20`;
  const mcpDetailUrl = `${agentToolsCloudApi}/mcp/servers/${agentToolsCloudMcpSlug}`;
  const buyerQueryUrls = agentToolsCloudBuyerQueries.map((query) =>
    `${agentToolsCloudApi}/mcp/search?q=${encodeURIComponent(query)}&limit=100`
  );
  try {
    const responses = await Promise.all([
      fetch(searchUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(detailUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(mcpSearchUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(mcpDetailUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      ...buyerQueryUrls.map((url) => fetch(url, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      })),
    ]);
    const [searchResponse, detailResponse, mcpSearchResponse, mcpDetailResponse] = responses;
    const buyerQueryResponses = responses.slice(4);
    if (!searchResponse.ok || !detailResponse.ok || !mcpSearchResponse.ok || !mcpDetailResponse.ok ||
      buyerQueryResponses.some((response) => !response.ok)) {
      return {
        url: "https://agent-tools.cloud/",
        search_url: searchUrl,
        detail_url: detailUrl,
        mcp_search_url: mcpSearchUrl,
        mcp_detail_url: mcpDetailUrl,
        listed: false,
        status: "unexpected_response",
        search_http_status: searchResponse.status,
        detail_http_status: detailResponse.status,
        mcp_search_http_status: mcpSearchResponse.status,
        mcp_detail_http_status: mcpDetailResponse.status,
        buyer_query_http_statuses: buyerQueryResponses.map((response) => response.status),
      };
    }
    const search = await searchResponse.json() as Record<string, any>;
    const detail = await detailResponse.json() as Record<string, any>;
    const mcpSearch = await mcpSearchResponse.json() as Record<string, any>;
    const mcpDetail = await mcpDetailResponse.json() as Record<string, any>;
    const buyerQueryPayloads = await Promise.all(buyerQueryResponses.map(async (response) =>
      await response.json() as Record<string, any>
    ));
    const buyerQueries = agentToolsCloudBuyerQueries.map((query, index) => {
      const parsed = parseAgentToolsCloudMcpBuyerQuery(
        buyerQueryPayloads[index],
        [agentToolsCloudMcpSlug, agentToolsCloudMcpX402Slug],
      ) as { found: boolean; rank: number | null; returned_results: number };
      return { query, ...parsed };
    });
    return {
      url: "https://agent-tools.cloud/",
      search_url: searchUrl,
      detail_url: detailUrl,
      mcp_search_url: mcpSearchUrl,
      mcp_detail_url: mcpDetailUrl,
      ...parseAgentToolsCloudListing(search, detail, {
        productionOrigin,
        slug: agentToolsCloudSlug,
        revenueWallet,
        expectedResources: x402ScanResources,
      }),
      mcp: parseAgentToolsCloudMcpListing(mcpSearch, mcpDetail, {
        endpointUrl: `${productionOrigin}/mcp?source=mcp-registry`,
        homepageUrl: "https://mimirs402.github.io/bountyverdict/",
        name: "BountyVerdict Agent Decision Tools",
        slug: agentToolsCloudMcpSlug,
        expectedTools: agentToolsCloudMcpTools,
      }),
      buyer_query_benchmark: {
        queries: buyerQueries,
        query_count: buyerQueries.length,
        found_queries: buyerQueries.filter(({ found }) => found).length,
        top_three_queries: buyerQueries.filter(({ rank }) => typeof rank === "number" && rank <= 3).length,
        first_place_queries: buyerQueries.filter(({ rank }) => rank === 1).length,
        measurement: "fixed_owner_run_unbranded_catalog_queries_not_search_volume_impressions_calls_purchases_or_revenue",
      },
    };
  } catch (error) {
    return {
      url: "https://agent-tools.cloud/",
      search_url: searchUrl,
      detail_url: detailUrl,
      mcp_search_url: mcpSearchUrl,
      mcp_detail_url: mcpDetailUrl,
      listed: false,
      status: error instanceof AgentToolsCloudContractDrift ? "contract_drift" : "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function monetizeYourAgentStatus(): Promise<Record<string, unknown>> {
  const apiUrl = `${monetizeYourAgentApi}/entries?limit=250`;
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { url: "https://monetizeyouragent.fun/", api_url: apiUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.data)) throw new Error("Monetize Your Agent returned malformed directory telemetry.");
    const entry = payload.data.find(({ name, url }) =>
      name === "BountyVerdict Agent Decision APIs" && url === productionOrigin
    );
    return {
      url: "https://monetizeyouragent.fun/",
      api_url: apiUrl,
      http_status: response.status,
      listed: Boolean(entry),
      status: entry ? String(entry.status || "listed") : "pending_review",
      submission_id: monetizeYourAgentSubmissionId,
      entry: entry || null,
      measurement: "public_directory_listing_not_customer_purchase",
    };
  } catch (error) {
    return {
      url: "https://monetizeyouragent.fun/",
      api_url: apiUrl,
      listed: false,
      status: "request_failed",
      submission_id: monetizeYourAgentSubmissionId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function directory402Status(): Promise<Record<string, unknown>> {
  const apiUrl = `${directory402Api}/directory`;
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { url: "https://www.402directory.com/", api_url: apiUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as { entries?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.entries)) throw new Error("402directory returned malformed directory telemetry.");
    const expected = new Set<string>(x402ScanResources.map(({ url }) => url));
    const entries = payload.entries.filter(({ endpoint }) => expected.has(String(endpoint)));
    const exact = entries.length === expected.size && new Set(entries.map(({ endpoint }) => endpoint)).size === expected.size;
    return {
      url: "https://www.402directory.com/",
      api_url: apiUrl,
      http_status: response.status,
      listed: exact,
      status: exact ? "listed" : entries.length ? "partial" : "pending_review",
      expected_endpoints: expected.size,
      listed_endpoints: entries.length,
      submission_ids: directory402SubmissionIds,
      entries,
      measurement: "public_directory_listing_not_customer_purchase",
    };
  } catch (error) {
    return {
      url: "https://www.402directory.com/",
      api_url: apiUrl,
      listed: false,
      status: "request_failed",
      expected_endpoints: x402ScanResources.length,
      submission_ids: directory402SubmissionIds,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function index402Status(): Promise<Record<string, unknown>> {
  try {
    const resources = await Promise.all(index402Listings.map(async ({ product, id, path, method }) => {
      const response = await fetch(`${index402Api}/${id}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`402 Index ${product} returned HTTP ${response.status}.`);
      const entry = await response.json() as Record<string, unknown>;
      const expected = x402ScanResources.find((resource) => resource.url === `${productionOrigin}${path}`);
      if (!expected || expected.method !== method || entry.id !== id || entry.url !== expected.url || entry.protocol !== "x402" ||
        entry.payment_network !== "eip155:8453" || entry.http_method !== method) {
        throw new Error(`402 Index ${product} contract telemetry drifted.`);
      }
      return {
        product,
        id,
        url: `https://402index.io/service/${id}`,
        status: entry.status,
        health_status: entry.health_status,
        probe_status: entry.probe_status,
        provider_display: entry.provider,
      };
    }));
    const active = resources.filter(({ status, health_status, probe_status }) =>
      status === "active" && health_status === "healthy" && probe_status === "probeable"
    );
    return {
      url: "https://402index.io/",
      listed: active.length === index402Listings.length,
      status: active.length === index402Listings.length ? "listed" : active.length ? "partial" : "unavailable",
      expected_resources: index402Listings.length,
      active_resources: active.length,
      missing_product: "mcpdrift",
      resources,
      measurement: "public_directory_listing_not_customer_purchase",
    };
  } catch (error) {
    return {
      url: "https://402index.io/",
      listed: false,
      status: "request_failed",
      expected_resources: index402Listings.length,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function submitAgentSkill(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch("https://agentskill.sh/api/skills/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: repository }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json() as {
      success?: boolean;
      data?: { summary?: { found?: number; imported?: number; updated?: number; failed?: number } };
    };
    const summary = payload.data?.summary || {};
    const accepted = response.ok && payload.success === true && summary.found === 7 && summary.failed === 0;
    return {
      url: "https://agentskill.sh/submit",
      attempted_at: new Date().toISOString(),
      http_status: response.status,
      accepted,
      status: accepted ? "accepted_for_indexing" : "upstream_blocked",
      summary,
    };
  } catch (error) {
    return {
      url: "https://agentskill.sh/submit",
      attempted_at: new Date().toISOString(),
      accepted: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function mergeAgentSkillHistory(
  previousHistory: unknown,
  current: Record<string, any>,
  observedAt: string,
): Array<Record<string, unknown>> {
  const history = Array.isArray(previousHistory)
    ? previousHistory.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)).slice(-95)
    : [];
  const point = {
    observed_at: observedAt,
    listed_skills: current.listed_skills,
    total_installs: current.total_installs,
    total_ratings: current.total_ratings,
    skills: current.skills,
  };
  const comparable = (value: Record<string, unknown>) => JSON.stringify({
    listed_skills: value.listed_skills,
    total_installs: value.total_installs,
    total_ratings: value.total_ratings,
    skills: value.skills,
  });
  const previousPoint = history.at(-1) as Record<string, unknown> | undefined;
  if (!previousPoint || comparable(previousPoint) !== comparable(point)) history.push(point);
  return history.slice(-96);
}

async function agentSkillStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(agentSkillSearchUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`AgentSkill search returned HTTP ${response.status}.`);
    const current = parseAgentSkillSearchPayload(await response.json());
    const exposedAt = current.listed
      ? previousStatus.exposed_at || observedAt
      : null;
    return {
      url: "https://agentskill.sh/",
      search_url: agentSkillSearchUrl,
      http_status: response.status,
      ...current,
      exposed_at: exposedAt,
      metric_history: mergeAgentSkillHistory(previousStatus.metric_history, current, observedAt),
      measurement: "public_catalog_presence_installs_ratings_security_and_quality_not_impressions_or_purchases",
    };
  } catch (error) {
    return {
      url: "https://agentskill.sh/",
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      metric_history: Array.isArray(previousStatus.metric_history) ? previousStatus.metric_history.slice(-96) : [],
    };
  }
}

async function agentSkillsInStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [{ stdout }, response] = await Promise.all([
      execFileAsync("gh", [
        "issue", "view", String(agentSkillsInSubmissionIssueNumber),
        "--repo", "Karanjot786/agent-skills-cli",
        "--json", "number,title,state,createdAt,updatedAt,closedAt,url,labels,comments",
      ], { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }),
      fetch(agentSkillsInSearchUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    const issue = JSON.parse(stdout) as Record<string, any>;
    if (issue.number !== agentSkillsInSubmissionIssueNumber || issue.url !== agentSkillsInSubmissionIssueUrl ||
      !Array.isArray(issue.labels) || !Array.isArray(issue.comments) || !["OPEN", "CLOSED"].includes(issue.state)) {
      throw new Error("AgentSkills.in submission issue telemetry is malformed.");
    }
    const submission = {
      issue_number: issue.number,
      issue_state: issue.state,
      issue_created_at: issue.createdAt,
      issue_updated_at: issue.updatedAt,
      issue_closed_at: issue.closedAt,
      labels: issue.labels.map((label: Record<string, unknown>) => String(label.name || "")).filter(Boolean).sort(),
      maintainer_comments: issue.comments.length,
      direct_endpoint_attempts: 2,
      direct_endpoint_result: "backend_failed_403_then_cloudflare_1101",
    };
    let catalogResponse = response;
    let lookup = "exact_name";
    if (!response.ok) {
      catalogResponse = await fetch(agentSkillsInFallbackSearchUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      lookup = "bounded_fallback_search";
      if (!catalogResponse.ok) {
        return {
          url: agentSkillsInSubmissionIssueUrl,
          listing_url: agentSkillsInListingUrl,
          search_url: agentSkillsInFallbackSearchUrl,
          exact_name_search_url: agentSkillsInSearchUrl,
          primary_http_status: response.status,
          http_status: catalogResponse.status,
          listed: false,
          listed_skills: 0,
          expected_skills: 1,
          status: issue.state === "CLOSED" ? "submission_closed_catalog_unavailable" : "submitted_catalog_unavailable",
          submission,
          exposed_at: null,
          catalog_error: `AgentSkills.in exact-name search returned HTTP ${response.status}; bounded fallback returned HTTP ${catalogResponse.status}.`,
          measurement: "submission_and_exact_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
        };
      }
    }
    const catalog = parseAgentSkillsInSearchPayload(await catalogResponse.json());
    const listed = catalog.listed === true;
    return {
      url: agentSkillsInSubmissionIssueUrl,
      listing_url: agentSkillsInListingUrl,
      search_url: lookup === "exact_name" ? agentSkillsInSearchUrl : agentSkillsInFallbackSearchUrl,
      exact_name_search_url: agentSkillsInSearchUrl,
      primary_http_status: response.status,
      http_status: catalogResponse.status,
      lookup,
      ...catalog,
      status: listed
        ? "listed"
        : catalog.status === "contract_drift"
          ? "catalog_contract_drift"
          : issue.state === "CLOSED"
            ? "submission_closed_without_listing"
            : "submitted_pending_indexing",
      submission,
      exposed_at: listed ? previousStatus.exposed_at || observedAt : null,
      measurement: "submission_and_exact_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: agentSkillsInSubmissionIssueUrl,
      listing_url: agentSkillsInListingUrl,
      listed: false,
      expected_skills: 1,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_and_exact_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function skillsMdStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  const submission = {
    id: skillsMdSubmissionId,
    submitted_at: skillsMdSubmittedAt,
    accepted: true,
    http_status: 201,
    direct_endpoint_attempts: 2,
    direct_endpoint_result: "transient_404_then_submission_received",
  };
  try {
    const response = await fetch(skillsMdSearchUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        url: skillsMdRegistryUrl,
        search_url: skillsMdSearchUrl,
        http_status: response.status,
        listed: false,
        listed_skills: 0,
        expected_skills: 1,
        status: "submitted_catalog_unavailable",
        submission,
        exposed_at: null,
        catalog_error: `SkillsMD search returned HTTP ${response.status}.`,
        measurement: "submission_exact_catalog_presence_and_public_install_counter_not_impressions_tool_calls_purchases_or_revenue",
      };
    }
    const catalog = parseSkillsMdSearchPayload(await response.json());
    const listed = catalog.listed === true;
    return {
      url: skillsMdRegistryUrl,
      search_url: skillsMdSearchUrl,
      http_status: response.status,
      ...catalog,
      status: listed ? "listed" : catalog.status === "contract_drift" ? "catalog_contract_drift" : "submitted_pending_review",
      submission,
      exposed_at: listed ? previousStatus.exposed_at || observedAt : null,
      measurement: "submission_exact_catalog_presence_and_public_install_counter_not_impressions_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: skillsMdRegistryUrl,
      search_url: skillsMdSearchUrl,
      listed: false,
      listed_skills: 0,
      expected_skills: 1,
      status: "submitted_catalog_request_failed",
      submission,
      exposed_at: null,
      error: error instanceof Error ? error.message : String(error),
      measurement: "submission_exact_catalog_presence_and_public_install_counter_not_impressions_tool_calls_purchases_or_revenue",
    };
  }
}

async function askillStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
  monitor: Readonly<{
    searchUrl: string;
    submittedAt: string;
    identity: AskillIdentity;
    submission: Readonly<Record<string, unknown>>;
  }> = askillLegacyMonitor,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(monitor.searchUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        url: "https://askill.sh/",
        search_url: monitor.searchUrl,
        http_status: response.status,
        listed: false,
        listed_skills: 0,
        expected_skills: 1,
        status: "catalog_unavailable",
        submission: monitor.submission,
        exposed_at: previousStatus.exposed_at || monitor.submittedAt,
        catalog_error: `askill search returned HTTP ${response.status}.`,
        measurement: "exact_catalog_presence_and_public_favorites_not_impressions_installs_tool_calls_purchases_or_revenue",
      };
    }
    const catalog = parseAskillSearchPayload(await response.json(), monitor.identity);
    const listed = catalog.listed === true;
    let buyerQueryBenchmark: Record<string, unknown>;
    try {
      const queryResults = await Promise.all(ASKILL_BUYER_QUERIES.map(async (query) => {
        const url = new URL("https://askill.sh/api/v1/skills");
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "50");
        const queryResponse = await fetch(url, {
          headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!queryResponse.ok) throw new Error(`askill buyer query returned HTTP ${queryResponse.status}.`);
        return { query, ...parseAskillBuyerQueryPayload(await queryResponse.json(), monitor.identity) };
      }));
      const found = queryResults.filter((result) => result.found === true);
      buyerQueryBenchmark = {
        available: true,
        queries: queryResults,
        query_count: queryResults.length,
        found_queries: found.length,
        top_three_queries: found.filter((result) => Number(result.rank) <= 3).length,
        worst_found_rank: found.length ? Math.max(...found.map((result) => Number(result.rank))) : null,
        measurement: "fixed_owner_run_unbranded_catalog_queries_not_search_volume_impressions_installs_or_demand",
      };
    } catch (error) {
      buyerQueryBenchmark = {
        available: false,
        error: error instanceof Error ? error.message : String(error),
        measurement: "fixed_owner_run_unbranded_catalog_queries_not_search_volume_impressions_installs_or_demand",
      };
    }
    return {
      url: listed ? catalog.listing_url : "https://askill.sh/",
      search_url: monitor.searchUrl,
      http_status: response.status,
      ...catalog,
      submission: monitor.submission,
      buyer_query_benchmark: buyerQueryBenchmark,
      exposed_at: listed ? previousStatus.exposed_at || monitor.submittedAt : null,
      measurement: "exact_catalog_presence_and_public_favorites_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: "https://askill.sh/",
      search_url: monitor.searchUrl,
      listed: false,
      listed_skills: 0,
      expected_skills: 1,
      status: "catalog_request_failed",
      submission: monitor.submission,
      exposed_at: previousStatus.exposed_at || monitor.submittedAt,
      error: error instanceof Error ? error.message : String(error),
      measurement: "exact_catalog_presence_and_public_favorites_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function askillMainStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const entries = await Promise.all(ASKILL_MAIN_SKILLS.map(async (name) => {
      const url = new URL("https://askill.sh/api/v1/skills");
      url.searchParams.set("q", name);
      url.searchParams.set("owner", ASKILL_MAIN_OWNER);
      url.searchParams.set("repo", ASKILL_MAIN_REPO);
      url.searchParams.set("limit", "20");
      const response = await fetch(url, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`askill main-repository ${name} lookup returned HTTP ${response.status}.`);
      return parseAskillMainSearchPayload(await response.json(), name);
    }));
    const listedEntries = entries.filter((entry) => entry.listed === true);
    const exact = listedEntries.length === ASKILL_MAIN_SKILLS.length &&
      listedEntries.every((entry) => entry.revision_live === true);
    let buyerQueryBenchmark: Record<string, unknown>;
    try {
      const queryResults = await Promise.all(ASKILL_BUYER_QUERIES.map(async (query) => {
        const url = new URL("https://askill.sh/api/v1/skills");
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "50");
        const response = await fetch(url, {
          headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`askill main-repository buyer query returned HTTP ${response.status}.`);
        return { query, ...parseAskillMainBuyerQueryPayload(await response.json()) };
      }));
      const found = queryResults.filter((result) => result.found === true);
      buyerQueryBenchmark = {
        available: true,
        queries: queryResults,
        query_count: queryResults.length,
        found_queries: found.length,
        top_three_queries: found.filter((result) => Number(result.rank) <= 3).length,
        worst_found_rank: found.length ? Math.max(...found.map((result) => Number(result.rank))) : null,
        measurement: "fixed_owner_run_unbranded_catalog_queries_not_search_volume_impressions_installs_or_demand",
      };
    } catch (error) {
      buyerQueryBenchmark = {
        available: false,
        error: error instanceof Error ? error.message : String(error),
        measurement: "fixed_owner_run_unbranded_catalog_queries_not_search_volume_impressions_installs_or_demand",
      };
    }
    return {
      url: listedEntries[0]?.listing_url || "https://askill.sh/",
      listed: exact,
      listed_skills: listedEntries.length,
      expected_skills: ASKILL_MAIN_SKILLS.length,
      status: exact ? "listed" : listedEntries.length ? "partial_or_stale_index" : "not_indexed",
      entries,
      favorites: listedEntries.reduce((sum, entry) => sum + Number(entry.favorites || 0), 0),
      buyer_query_benchmark: buyerQueryBenchmark,
      submission: {
        submitted_at: askillMainSubmittedAt,
        repository: `${ASKILL_MAIN_OWNER}/${ASKILL_MAIN_REPO}`,
        indexed_skills: 7,
        ignored_invalid: 0,
        entry_ids: [703723, 703724, 703725, 703726, 703727, 703728, 703729],
        response_message: "Found and indexed 7 skills.",
      },
      exposed_at: exact ? previousStatus.exposed_at || askillMainSubmittedAt : null,
      checked_at: observedAt,
      measurement: "exact_seven_skill_catalog_presence_and_fixed_owner_run_ranks_not_search_volume_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: "https://askill.sh/",
      listed: false,
      listed_skills: 0,
      expected_skills: ASKILL_MAIN_SKILLS.length,
      status: "catalog_request_failed",
      submission: {
        submitted_at: askillMainSubmittedAt,
        repository: `${ASKILL_MAIN_OWNER}/${ASKILL_MAIN_REPO}`,
        indexed_skills: 7,
        ignored_invalid: 0,
        entry_ids: [703723, 703724, 703725, 703726, 703727, 703728, 703729],
        response_message: "Found and indexed 7 skills.",
      },
      exposed_at: null,
      checked_at: observedAt,
      error: error instanceof Error ? error.message : String(error),
      measurement: "exact_seven_skill_catalog_presence_and_fixed_owner_run_ranks_not_search_volume_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function agentSkillsMdStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  const previousFirstListedAt = typeof previousStatus.first_listed_at === "string"
    && previousStatus.listing_url === agentSkillsMdListingUrl
    && Date.parse(previousStatus.first_listed_at) >= Date.parse(agentSkillsMdSubmissionRecordedAt)
    ? previousStatus.first_listed_at
    : null;
  try {
    const response = await fetch(agentSkillsMdListingUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (![200, 404].includes(response.status)) {
      throw new Error(`Agent-Skills.md returned HTTP ${response.status}.`);
    }
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("Agent-Skills.md listing response is unbounded.");
    const requiredMarkers = [
      "Route GitHub Agent Decisions Skill",
      agentSkillsMdTaskFirstDescription,
      "Mimirs402/bountyverdict-mcp-skill/route-github-agent-decisions",
      "bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=agent-skills-marketplace",
      "check_github_bounty",
      "rank_github_bounties",
      "audit_agent_harness",
      "diagnose_github_actions_run",
      "classify_github_actions_flake",
      "check_mcp_tool_drift",
      "io.github.Mimirs402/bountyverdict/http-payment-handoff",
    ];
    const listed = response.status === 200 && requiredMarkers.every((marker) => body.includes(marker));
    return {
      submission_recorded_at: agentSkillsMdSubmissionRecordedAt,
      submission_recorded: true,
      submission_response_message: "Repo captured. Mimirs402/bountyverdict-mcp-skill added with 1 skills.",
      payment_status: "not_required",
      listing_url: agentSkillsMdListingUrl,
      listing_http_status: response.status,
      listed,
      contract_verified: listed,
      status: listed ? "catalog_contract_verified" : response.status === 404 ? "pending_publication" : "catalog_contract_drift",
      first_listed_at: listed ? previousFirstListedAt || observedAt : null,
      measurement: "anonymous_submission_and_exact_listing_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      submission_recorded_at: agentSkillsMdSubmissionRecordedAt,
      submission_recorded: true,
      submission_response_message: "Repo captured. Mimirs402/bountyverdict-mcp-skill added with 1 skills.",
      payment_status: "not_required",
      listing_url: agentSkillsMdListingUrl,
      listed: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "anonymous_submission_and_exact_listing_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue",
    };
  }
}

async function githubSkillStatus(previousStatus: Record<string, any>, observedAt: string): Promise<Record<string, unknown>> {
  try {
    const hour = Math.floor(Date.parse(observedAt) / (60 * 60 * 1000));
    const selectedSkill = PUBLISHED_SKILLS[hour % PUBLISHED_SKILLS.length];
    const [{ stdout: releaseOutput }, { stdout: searchOutput }] = await Promise.all([
      execFileAsync("gh", [
        "release", "view", githubSkillReleaseTag,
        "--repo", "Mimirs402/bountyverdict",
        "--json", "tagName,isDraft,isPrerelease,publishedAt,url,targetCommitish",
      ], { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }),
      execFileAsync("gh", [
        "skill", "search", selectedSkill,
        "--owner", "Mimirs402",
        "--limit", "20",
        "--json", "description,namespace,path,repo,skillName,stars",
      ], { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }),
    ]);
    const release = JSON.parse(releaseOutput) as Record<string, unknown>;
    const results = JSON.parse(searchOutput) as Array<Record<string, unknown>>;
    if (!Array.isArray(results)) throw new Error(`GitHub Skill search for ${selectedSkill} was malformed.`);
    const resultIndex = results.findIndex((entry) =>
      String(entry.repo).toLowerCase() === "mimirs402/bountyverdict" && entry.skillName === selectedSkill
    );
    const checked = {
      skill: selectedSkill,
      found: resultIndex >= 0,
      rank: resultIndex >= 0 ? resultIndex + 1 : null,
      returned_results: results.length,
      stars: resultIndex >= 0 && typeof results[resultIndex].stars === "number" ? results[resultIndex].stars : null,
      checked_at: observedAt,
    };
    const previousQueries = Array.isArray(previousStatus.exact_searches)
      ? previousStatus.exact_searches as Array<Record<string, unknown>>
      : [];
    const queries = PUBLISHED_SKILLS.map((skill) => {
      if (skill === selectedSkill) return checked;
      return previousQueries.find((query) => query.skill === skill) || {
        skill,
        found: null,
        rank: null,
        returned_results: null,
        stars: null,
        checked_at: null,
      };
    });
    const listedSkills = queries.filter(({ found }) => found === true).length;
    const checkedSkills = queries.filter(({ found }) => typeof found === "boolean").length;
    const listed = listedSkills === PUBLISHED_SKILLS.length;
    return {
      url: release.url,
      release_tag: release.tagName,
      release_published_at: release.publishedAt,
      release_target: release.targetCommitish,
      release_verified: release.tagName === githubSkillReleaseTag && release.isDraft === false && release.isPrerelease === false,
      listed,
      status: listed ? "listed" : listedSkills ? "partial" : "published_awaiting_search_index",
      listed_skills: listedSkills,
      checked_skills: checkedSkills,
      expected_skills: PUBLISHED_SKILLS.length,
      exposed_at: listed ? previousStatus.exposed_at || observedAt : null,
      exact_searches: queries,
      measurement: "one_rotating_owner_run_exact_github_code_search_per_hour_not_impressions_installs_or_purchases",
    };
  } catch (error) {
    return {
      url: `https://github.com/Mimirs402/bountyverdict/releases/tag/${githubSkillReleaseTag}`,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ardCatalogStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(ardCatalogUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "bountyverdict-directory-monitor/1.0",
      },
    });
    const payload = response.ok ? await response.json() as Record<string, any> : null;
    const entry = Array.isArray(payload?.entries) && payload.entries.length === 1
      ? payload.entries[0] as Record<string, any>
      : null;
    const contractVerified = response.status === 200 &&
      response.headers.get("access-control-allow-origin") === "*" &&
      payload?.specVersion === "1.0" &&
      entry?.identifier === "urn:air:bountyverdict-agent-production.mimirslab.workers.dev:server:bountyverdict" &&
      entry?.type === "application/mcp-server-card+json" &&
      entry?.url === `${productionOrigin}/.well-known/mcp.json` &&
      JSON.stringify(entry?.representativeQueries) === JSON.stringify(ardRepresentativeQueries) &&
      JSON.stringify(entry?.capabilities) === JSON.stringify(ardCapabilities) &&
      entry?.metadata?.paymentProtocol === "x402-v2" &&
      entry?.metadata?.paymentNetwork === "eip155:8453" &&
      entry?.metadata?.paymentCurrency === "USDC" &&
      entry?.metadata?.mutatesExternalSystems === false;
    return {
      url: ardCatalogUrl,
      http_status: response.status,
      cors: response.headers.get("access-control-allow-origin"),
      live: contractVerified,
      contract_verified: contractVerified,
      status: contractVerified ? "live" : response.ok ? "contract_drift" : "not_live",
      first_live_at: contractVerified ? previousStatus.first_live_at || observedAt : null,
      representative_queries: contractVerified ? ardRepresentativeQueries.length : 0,
      capabilities: contractVerified ? ardCapabilities.length : 0,
      measurement: "origin_owned_ard_catalog_availability_not_registry_indexing_impressions_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: ardCatalogUrl,
      live: false,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "origin_owned_ard_catalog_availability_not_registry_indexing_impressions_tool_calls_purchases_or_revenue",
    };
  }
}

async function mcpMarketplaceStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const search = async (query: string, id: number): Promise<Record<string, unknown>> => {
      const response = await fetch(mcpMarketplaceSearchEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "User-Agent": "bountyverdict-directory-monitor/1.0",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: "search_servers",
            arguments: { query, sort: "relevance", limit: mcpMarketplaceSearchLimit, page: 1 },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`MCP Marketplace search returned HTTP ${response.status}.`);
      const eventStream = await readBoundedText(response, 500_000);
      const dataLines = eventStream.split("\n").filter((line) => line.startsWith("data: "));
      if (dataLines.length !== 1 || dataLines[0].length > 400_000) {
        throw new Error("MCP Marketplace search returned a malformed event stream.");
      }
      let envelope: Record<string, any>;
      try {
        envelope = JSON.parse(dataLines[0].slice(6)) as Record<string, any>;
      } catch {
        throw new Error("MCP Marketplace search returned invalid JSON-RPC data.");
      }
      const content = envelope?.result?.content;
      const texts = Array.isArray(content)
        ? content.filter((item: unknown) => item && typeof item === "object" && !Array.isArray(item) &&
          (item as Record<string, unknown>).type === "text" && typeof (item as Record<string, unknown>).text === "string")
        : [];
      if (envelope.jsonrpc !== "2.0" || envelope.id !== id || envelope.error || envelope.result?.isError === true ||
        texts.length !== 1 || String(texts[0].text).length > 300_000) {
        throw new Error("MCP Marketplace search returned a malformed tool result.");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(String(texts[0].text));
      } catch {
        throw new Error("MCP Marketplace search tool text is not valid JSON.");
      }
      return { query, ...parseMcpMarketplaceSearchResponse(payload, mcpMarketplaceSlug, mcpMarketplaceSearchLimit) };
    };
    const [response, searchSettled] = await Promise.all([
      fetch(mcpMarketplaceUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      Promise.allSettled(agentToolsCloudBuyerQueries.map((query, index) => search(query, index + 1))),
    ]);
    if (!response.ok) throw new Error(`MCP Marketplace returned HTTP ${response.status}.`);
    const parsed = parseMcpMarketplaceListing(
      await readBoundedText(response, MCP_MARKETPLACE_MAX_PAGE_BYTES),
      officialMcpServerName,
      mcpMarketplaceSlug,
      githubSkillReleaseTag.slice(1),
      repository,
      mcpMarketplaceEndpoint,
      agentToolsCloudMcpTools,
    );
    const searches = searchSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const searchFailures = searchSettled.flatMap((result, index) => result.status === "rejected" ? [{
      query: agentToolsCloudBuyerQueries[index],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    }] : []);
    const found = searches.filter(({ rank }) => Number.isSafeInteger(rank));
    const emptySubstringFallbacks = searches.filter(({ ranking_mode, total_matches }) =>
      ranking_mode === "substring" && total_matches === 0
    ).length;
    const searchStatus = searchFailures.length > 0
      ? "partial_or_failed"
      : emptySubstringFallbacks === searches.length
        ? "degraded_empty_substring_fallback"
        : found.length > 0
          ? "listed_in_agent_search"
          : "not_found_in_agent_search";
    return {
      url: mcpMarketplaceUrl,
      checked_at: observedAt,
      first_listed_at: previousStatus.first_listed_at || observedAt,
      ...parsed,
      status: parsed.contract_verified ? "listed_contract_verified" : "listed_contract_drift",
      measurement: "anonymous_marketplace_install_counter_and_registry_import_contract_not_unique_users_tool_calls_purchases_or_revenue",
      pricing_note: parsed.pricing_disclosure_accurate
        ? "Marketplace pricing disclosure is accurate."
        : "Marketplace imported the Registry endpoint as free even though valid selected tool calls require disclosed per-call x402 USDC payment; ownership remains unclaimed while the catalog-copy experiment is frozen.",
      buyer_query_benchmark: {
        status: searchStatus,
        healthy: searchFailures.length === 0 && emptySubstringFallbacks !== searches.length,
        query_count: agentToolsCloudBuyerQueries.length,
        completed_queries: searches.length,
        found_queries: found.length,
        top_ten_queries: found.filter(({ rank }) => Number(rank) <= 10).length,
        semantic_queries: searches.filter(({ ranking_mode }) => ranking_mode === "semantic").length,
        empty_substring_fallbacks: emptySubstringFallbacks,
        queries: searches,
        failures: searchFailures,
        methodology: "Fixed unbranded task descriptions supplied by context-isolated agents; bounded to the first 25 MCP Marketplace results.",
        accounting: "Owner-run retrieval is visibility telemetry, not marketplace query volume, impressions, installs, purchases, or revenue.",
      },
    };
  } catch (error) {
    return {
      url: mcpMarketplaceUrl,
      checked_at: observedAt,
      listed: previousStatus.listed === true,
      contract_verified: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
      measurement: "anonymous_marketplace_install_counter_and_registry_import_contract_not_unique_users_tool_calls_purchases_or_revenue",
    };
  }
}

let previous: Record<string, any> = {};
try {
  previous = JSON.parse(await readFile(stateFile, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const [
  skills,
  legacyExperimentSkills,
  skillsDedicated,
  awesomeSkills,
  agenttool,
  mcpRepository,
  agentNdx,
  mcpObservatory,
  mcpubCrawlerPr,
  securityDirectoryPr,
  x402DirectoryPr,
  agentPluginsPr,
  agentPluginsCatalog,
  awesomeCopilot,
  lobeHub,
  awesomeMcpServers,
  tensorBlockMcpIndex,
  agentage,
  dockerMcpRegistry,
  mcpServersOrg,
  mcpDirectory,
  vaultPlane,
  toolsForAgents,
  mcpServerSpot,
  clineMarketplace,
  kiloMarketplace,
  toolHive,
  openHandsIntegrations,
  gooseExtensions,
  geminiCliGallery,
  agentFinderCatalog,
  ardCatalog,
  mcpMarketplace,
  agent402,
  x402scout,
  x402scan,
  x402gle,
  agentToolsCloud,
  monetizeYourAgent,
  directory402,
  index402,
  githubSkill,
  agentSkillsIn,
  skillsMd,
  askill,
  askillDedicated,
  askillMain,
  agentSkillsMd,
] = await Promise.all([
  skillsShStatus(),
  skillsShLegacyExperimentStatus(),
  skillsShDedicatedStatus(),
  awesomeSkillsStatus(),
  agentToolStatus(),
  mcpRepositoryStatus(),
  agentNdxStatus(),
  mcpObservatoryStatus(),
  githubPrStatus("roverbird", "mcpub", 4, mcpubCrawlerPrUrl),
  githubPrStatus("LLMSecurity", "awesome-agent-skills-security", 38, securityDirectoryPrUrl),
  githubPrStatus("xpaysh", "awesome-x402", 959, x402DirectoryPrUrl),
  githubPrStatus("dmgrok", "agent-plugins", 97, agentPluginsPrUrl),
  agentPluginsCatalogStatus(),
  awesomeCopilotStatus(previous.awesome_copilot || {}, new Date().toISOString()),
  lobeHubStatus(previous.lobehub || {}, new Date().toISOString()),
  awesomeMcpServersStatus(previous.awesome_mcp_servers || {}, new Date().toISOString()),
  tensorBlockMcpIndexStatus(previous.tensorblock_mcp_index || {}, new Date().toISOString()),
  agentageStatus(previous.agentage || {}, new Date().toISOString()),
  dockerMcpRegistryStatus(previous.docker_mcp_registry || {}, new Date().toISOString()),
  mcpServersOrgStatus(previous.mcp_servers_org || {}, new Date().toISOString()),
  mcpDirectoryStatus(previous.mcp_directory || {}, new Date().toISOString()),
  vaultPlaneStatus(previous.vaultplane || {}, new Date().toISOString()),
  toolsForAgentsStatus(previous.tools_for_agents || {}, new Date().toISOString()),
  mcpServerSpotStatus(previous.mcp_server_spot || {}, new Date().toISOString()),
  clineMarketplaceStatus(previous.cline_marketplace || {}, new Date().toISOString()),
  kiloMarketplaceStatus(previous.kilo_marketplace || {}, new Date().toISOString()),
  toolHiveStatus(previous.toolhive || {}, new Date().toISOString()),
  openHandsIntegrationsStatus(previous.openhands_integrations || {}, new Date().toISOString()),
  gooseExtensionsStatus(previous.goose_extensions || {}, new Date().toISOString()),
  geminiCliGalleryStatus(previous.gemini_cli_gallery || {}, new Date().toISOString()),
  agentFinderCatalogStatus(previous.agent_finder_catalog || {}, new Date().toISOString()),
  ardCatalogStatus(previous.ard_catalog || {}, new Date().toISOString()),
  mcpMarketplaceStatus(previous.mcp_marketplace || {}, new Date().toISOString()),
  agent402Status(),
  x402ScoutStatus(),
  x402ScanStatus(),
  x402gleStatus(),
  agentToolsCloudStatus(),
  monetizeYourAgentStatus(),
  directory402Status(),
  index402Status(),
  githubSkillStatus(previous.github_skill || {}, new Date().toISOString()),
  agentSkillsInStatus(previous.agent_skills_in || {}, new Date().toISOString()),
  skillsMdStatus(previous.skills_md || {}, new Date().toISOString()),
  askillStatus(previous.askill || {}, new Date().toISOString()),
  askillStatus(previous.askill_dedicated || {}, new Date().toISOString(), askillDedicatedMonitor),
  askillMainStatus(previous.askill_main || {}, new Date().toISOString()),
  agentSkillsMdStatus(previous.agent_skills_md || {}, new Date().toISOString()),
]);
if (Number(x402scan.listed_resources || 0) > 0) {
  x402scan.exposed_at = previous.x402scan?.exposed_at || new Date().toISOString();
}
const observedAt = new Date().toISOString();
let agentSkill = await agentSkillStatus(previous.agentskill || {}, observedAt);
const previousSubmission = previous.agentskill?.submission || (
  previous.agentskill?.summary || previous.agentskill?.attempted_at
    ? {
        attempted_at: previous.agentskill.attempted_at || previous.checked_at,
        http_status: previous.agentskill.http_status,
        accepted: false,
        status: previous.agentskill.status,
        summary: previous.agentskill.summary,
      }
    : {}
);
const previousAttempt = Date.parse(String(previousSubmission.attempted_at || previous.checked_at || ""));
const agentSkillRetryDue = forceAgentSkillSubmission || !Number.isFinite(previousAttempt) ||
  Date.now() - previousAttempt >= agentSkillRetryMs;
let agentSkillSubmission = previousSubmission;
if (agentSkill.listed !== true && agentSkillRetryDue) {
  agentSkillSubmission = await submitAgentSkill();
  if (agentSkillSubmission.accepted === true) {
    agentSkill = await agentSkillStatus(previous.agentskill || {}, new Date().toISOString());
  }
}
const agentskill = {
  ...agentSkill,
  status: agentSkill.listed === true
    ? "listed"
    : agentSkillSubmission.status === "upstream_blocked"
      ? "not_indexed_upstream_blocked"
      : agentSkill.status,
  submission: agentSkillRetryDue || agentSkill.listed === true
    ? agentSkillSubmission
    : {
        ...agentSkillSubmission,
        retry_deferred: true,
        retry_after: new Date(previousAttempt + agentSkillRetryMs).toISOString(),
      },
};
const githubPrChecks = [
  ["mcpub_crawler", mcpubCrawlerPr],
  ["security_directory", securityDirectoryPr],
  ["x402_directory", x402DirectoryPr],
  ["agent_plugins", agentPluginsPr],
  ["awesome_mcp_servers", awesomeMcpServers],
  ["tensorblock_mcp_index", tensorBlockMcpIndex],
  ["docker_mcp_registry", dockerMcpRegistry],
  ["cline_marketplace_mcp", clineMarketplace.mcp_pr || clineMarketplace],
  ["cline_marketplace_skill", clineMarketplace.skill_pr || {}],
  ["kilo_marketplace", kiloMarketplace],
  ["toolhive", toolHive],
  ["openhands_integrations", openHandsIntegrations],
  ["goose_extensions", gooseExtensions],
  ["agent_finder_catalog", agentFinderCatalog],
] as const;
const prTelemetryValue = (normalized: Record<string, unknown>, field: string): unknown =>
  normalized[`pr_${field}`] ?? normalized[field];
const githubPrFailures = githubPrChecks.flatMap(([name, check]) => {
  const normalized = check as Record<string, unknown>;
  const status = String(normalized.pr_status || normalized.status || "unknown");
  const error = typeof normalized.pr_error === "string"
    ? normalized.pr_error
    : typeof normalized.error === "string"
      ? normalized.error
      : null;
  const sourceFailure = status === "request_failed" || status === "unknown" || status === "pr_status_unknown"
    ? [{
        kind: "source_unreadable",
        name,
        url: normalized.pr_url || normalized.url || null,
        status,
        error: error || "GitHub PR status unavailable.",
      }]
    : [];
  const failedChecks = Number(prTelemetryValue(normalized, "checks_failed"));
  const checkFailure = Number.isInteger(failedChecks) && failedChecks > 0
    ? [{
        kind: "check_runs_failed",
        name,
        url: normalized.pr_url || normalized.url || null,
        status,
        failed_checks: failedChecks,
        failed_check_names: Array.isArray(prTelemetryValue(normalized, "failed_check_names"))
          ? (prTelemetryValue(normalized, "failed_check_names") as unknown[]).filter((value): value is string => typeof value === "string").slice(0, 100)
          : [],
      }]
    : [];
  const cancelledChecks = Number(prTelemetryValue(normalized, "checks_cancelled_or_stale"));
  const cancelledCheckFailure = Number.isInteger(cancelledChecks) && cancelledChecks > 0
    ? [{
        kind: "check_runs_cancelled_or_stale",
        name,
        url: normalized.pr_url || normalized.url || null,
        status,
        cancelled_or_stale_checks: cancelledChecks,
      }]
    : [];
  const failedWorkflowRuns = Number(prTelemetryValue(normalized, "workflow_runs_failed"));
  const workflowFailure = Number.isInteger(failedWorkflowRuns) && failedWorkflowRuns > 0
    ? [{
        kind: "workflow_runs_failed",
        name,
        url: normalized.pr_url || normalized.url || null,
        status,
        failed_workflow_runs: failedWorkflowRuns,
        failed_check_names: Array.isArray(prTelemetryValue(normalized, "failed_workflow_names"))
          ? (prTelemetryValue(normalized, "failed_workflow_names") as unknown[]).filter((value): value is string => typeof value === "string").slice(0, 100)
          : [],
      }]
    : [];
  const cancelledWorkflowRuns = Number(prTelemetryValue(normalized, "workflow_runs_cancelled_or_stale"));
  const cancelledWorkflowFailure = Number.isInteger(cancelledWorkflowRuns) && cancelledWorkflowRuns > 0
    ? [{
        kind: "workflow_runs_cancelled_or_stale",
        name,
        url: normalized.pr_url || normalized.url || null,
        status,
        cancelled_or_stale_workflow_runs: cancelledWorkflowRuns,
      }]
    : [];
  return [...sourceFailure, ...checkFailure, ...cancelledCheckFailure, ...workflowFailure, ...cancelledWorkflowFailure];
});
const githubPrActionRequired = githubPrChecks.flatMap(([name, check]) => {
  const normalized = check as Record<string, unknown>;
  const workflowActionRequired = Number(prTelemetryValue(normalized, "workflow_runs_action_required"));
  const checkActionRequired = Number(prTelemetryValue(normalized, "checks_action_required"));
  const workflowNames = Array.isArray(prTelemetryValue(normalized, "action_required_workflow_names"))
    ? (prTelemetryValue(normalized, "action_required_workflow_names") as unknown[]).filter((value): value is string => typeof value === "string").slice(0, 100)
    : [];
  const checkNames = Array.isArray(prTelemetryValue(normalized, "action_required_check_names"))
    ? (prTelemetryValue(normalized, "action_required_check_names") as unknown[]).filter((value): value is string => typeof value === "string").slice(0, 100)
    : [];
  const actionRequired = (Number.isInteger(workflowActionRequired) && workflowActionRequired > 0 ? workflowActionRequired : 0) +
    (Number.isInteger(checkActionRequired) && checkActionRequired > 0 ? checkActionRequired : 0);
  return actionRequired > 0
    ? [{
        name,
        url: normalized.pr_url || normalized.url || null,
        action_required_workflow_runs: Number.isInteger(workflowActionRequired) ? workflowActionRequired : 0,
        action_required_check_runs: Number.isInteger(checkActionRequired) ? checkActionRequired : 0,
        gate_names: [...new Set([...workflowNames, ...checkNames])].sort().slice(0, 100),
      }]
    : [];
});
const githubGateTotals = githubPrChecks.reduce((totals, [, check]) => {
  const normalized = check as Record<string, unknown>;
  const count = (field: string): number => {
    const value = Number(prTelemetryValue(normalized, field));
    return Number.isInteger(value) && value >= 0 && value <= 100 ? value : 0;
  };
  totals.checks.total += count("checks_total");
  totals.checks.pending += count("checks_pending");
  totals.checks.succeeded += count("checks_succeeded");
  totals.checks.neutral_or_skipped += count("checks_neutral_or_skipped");
  totals.checks.failed += count("checks_failed");
  totals.checks.cancelled_or_stale += count("checks_cancelled_or_stale");
  totals.checks.action_required += count("checks_action_required");
  totals.workflows.total += count("workflow_runs_total");
  totals.workflows.pending += count("workflow_runs_pending");
  totals.workflows.succeeded += count("workflow_runs_succeeded");
  totals.workflows.neutral_or_skipped += count("workflow_runs_neutral_or_skipped");
  totals.workflows.failed += count("workflow_runs_failed");
  totals.workflows.cancelled_or_stale += count("workflow_runs_cancelled_or_stale");
  totals.workflows.action_required += count("workflow_runs_action_required");
  return totals;
}, {
  checks: { total: 0, pending: 0, succeeded: 0, neutral_or_skipped: 0, failed: 0, cancelled_or_stale: 0, action_required: 0 },
  workflows: { total: 0, pending: 0, succeeded: 0, neutral_or_skipped: 0, failed: 0, cancelled_or_stale: 0, action_required: 0 },
});
const githubSourceFailures = githubPrFailures.filter(({ kind }) => kind === "source_unreadable").length;
const githubPrMonitoring = {
  healthy: githubPrFailures.length === 0,
  checked: githubPrChecks.length,
  sources_readable: githubPrChecks.length - githubSourceFailures,
  source_failures: githubSourceFailures,
  failed: githubPrFailures.length,
  check_runs: githubGateTotals.checks,
  workflow_runs: githubGateTotals.workflows,
  requires_maintainer_action: githubPrActionRequired.length > 0,
  action_required: githubPrActionRequired,
  failures: githubPrFailures,
  excluded_superseded_personal_prs: supersededPersonalAccountPrs,
  excluded_superseded_personal_pr_count: supersededPersonalAccountPrs.length,
  measurement: "authenticated_pr_and_workflow_state_only_not_catalog_exposure_impressions_installs_or_purchases",
};
const state = {
  checked_at: new Date().toISOString(),
  repository,
  github_pr_monitoring: githubPrMonitoring,
  skills_sh: skills,
  skills_sh_legacy_experiment: legacyExperimentSkills,
  skills_sh_dedicated: skillsDedicated,
  awesome_skills: awesomeSkills,
  agenttool,
  mcp_repository: mcpRepository,
  agentndx: agentNdx,
  mcp_observatory: mcpObservatory,
  mcpub_crawler_pr: mcpubCrawlerPr,
  agentskill,
  agent_skills_in: agentSkillsIn,
  skills_md: skillsMd,
  askill,
  askill_dedicated: askillDedicated,
  askill_main: askillMain,
  agent_skills_md: agentSkillsMd,
  github_skill: githubSkill,
  security_directory_pr: securityDirectoryPr,
  x402_directory_pr: x402DirectoryPr,
  agent_plugins_pr: agentPluginsPr,
  agent_plugins_catalog: agentPluginsCatalog,
  awesome_copilot: awesomeCopilot,
  lobehub: lobeHub,
  awesome_mcp_servers: awesomeMcpServers,
  tensorblock_mcp_index: tensorBlockMcpIndex,
  agentage,
  docker_mcp_registry: dockerMcpRegistry,
  mcp_servers_org: mcpServersOrg,
  mcp_directory: mcpDirectory,
  vaultplane: vaultPlane,
  tools_for_agents: toolsForAgents,
  mcp_server_spot: mcpServerSpot,
  cline_marketplace: clineMarketplace,
  kilo_marketplace: kiloMarketplace,
  toolhive: toolHive,
  openhands_integrations: openHandsIntegrations,
  goose_extensions: gooseExtensions,
  gemini_cli_gallery: geminiCliGallery,
  agent_finder_catalog: agentFinderCatalog,
  ard_catalog: ardCatalog,
  mcp_marketplace: mcpMarketplace,
  agent402,
  x402scout,
  x402scan,
  x402gle,
  agent_tools_cloud: agentToolsCloud,
  monetize_your_agent: monetizeYourAgent,
  directory_402: directory402,
  index_402: index402,
};
await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(state, null, 2));
