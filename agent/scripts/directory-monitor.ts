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
  parseAgentToolsCloudListing,
} from "../src/agent-tools-cloud.ts";
import { PRODUCT_CATALOG, type ProductKey } from "../src/product-catalog.ts";
import { parseAgentSkillsInSearchPayload } from "../src/agentskills-in.ts";
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

if (process.env.BOUNTYVERDICT_AUDITED_ROTATION_ACTIVE !== "directory") {
  throw new Error("Directory retrieval must run through run-audited-monitor.ts after establishing a draining funnel rotation.");
}

const repository = "https://github.com/cristianmoroaica/bountyverdict";
const agentToolUrl = "https://agenttool.sh/tools/bountyverdict-agent-decision-apis";
const skillsUrl = "https://skills.sh/cristianmoroaica/bountyverdict";
const securityDirectoryPrUrl = "https://github.com/LLMSecurity/awesome-agent-skills-security/pull/38";
const x402DirectoryPrUrl = "https://github.com/xpaysh/awesome-x402/pull/934";
const agentPluginsPrUrl = "https://github.com/dmgrok/agent-plugins/pull/97";
const agentPluginsCatalogUrl = "https://cdn.jsdelivr.net/gh/dmgrok/agent-plugins@main/catalog.json";
const awesomeCopilotIssueUrl = "https://github.com/github/awesome-copilot/issues/2369";
const awesomeCopilotCatalogUrl = "https://raw.githubusercontent.com/github/awesome-copilot/main/plugins/external.json";
const x402ScoutUrl = "https://x402scout.com/catalog";
const agent402Api = "https://agent402.tools/api";
const productionOrigin = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const x402ScanUrl = "https://www.x402scan.com";
const x402gleHostUrl = "https://x402gle.com/servers/bountyverdict-agent-production.mimirslab.workers.dev";
const agentToolsCloudApi = "https://agent-tools.cloud/api/v1";
const agentToolsCloudSlug = "bountyverdict-agent-production-mimirslab-workers-dev-bazaar";
const revenueWallet = "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
const monetizeYourAgentApi = "https://monetizeyouragent.fun/api/v1";
const monetizeYourAgentSubmissionId = 234;
const directory402Api = "https://402directory.com/api";
const directory402SubmissionIds = Object.freeze([50, 51, 52, 53, 54, 55, 56]);
const index402Api = "https://402index.io/api/v1/services";
const agentSkillSearchUrl = "https://agentskill.sh/api/agent/search?q=bountyverdict&limit=20";
const agentSkillsInSearchUrl = "https://www.agentskills.in/api/skills?name=route-github-agent-decisions&author=cristianmoroaica&limit=20";
const agentSkillsInListingUrl = "https://www.agentskills.in/marketplace/%40cristianmoroaica/route-github-agent-decisions";
const agentSkillsInSubmissionIssueNumber = 23;
const agentSkillsInSubmissionIssueUrl =
  `https://github.com/Karanjot786/agent-skills-cli/issues/${agentSkillsInSubmissionIssueNumber}`;
const githubSkillReleaseTag = "v1.0.3";
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
const dockerMcpRegistryPrNumber = 4496;
const dockerMcpRegistryPrUrl = `https://github.com/docker/mcp-registry/pull/${dockerMcpRegistryPrNumber}`;
const dockerMcpRegistryDefinitionUrl = "https://raw.githubusercontent.com/docker/mcp-registry/main/servers/bountyverdict/server.yaml";
const dockerMcpHubUrl = "https://hub.docker.com/mcp/server/bountyverdict/overview";
const mcpServersOrgSubmissionId = 4842;
const mcpServersOrgSubmittedAt = "2026-07-21T05:32:29.746Z";
const mcpServersOrgReceiptUrl = `https://mcpservers.org/submit-success?submission_id=${mcpServersOrgSubmissionId}`;
const mcpServersOrgListingUrl = "https://mcpservers.org/servers/cristianmoroaica/bountyverdict";
const mcpDirectorySubmittedAt = "2026-07-21T05:48:37Z";
const mcpDirectoryListingUrl = "https://mcp.directory/servers/bountyverdict";
const clineMarketplacePrNumber = 13;
const clineMarketplacePrUrl = `https://github.com/cline/marketplace/pull/${clineMarketplacePrNumber}`;
const clineMarketplaceCatalogUrl = "https://cline.github.io/marketplace/catalog.json";
const kiloMarketplacePrNumber = 192;
const kiloMarketplacePrUrl = `https://github.com/Kilo-Org/kilo-marketplace/pull/${kiloMarketplacePrNumber}`;
const kiloMarketplaceDefinitionUrl = "https://raw.githubusercontent.com/Kilo-Org/kilo-marketplace/main/mcps/bountyverdict/MCP.yaml";
const kiloMarketplaceCatalogUrl = "https://raw.githubusercontent.com/Kilo-Org/kilo-marketplace/main/mcps/marketplace.yaml";
const geminiCliGalleryUrl = "https://geminicli.com/extensions.json";
const agentFinderPrNumber = 10;
const agentFinderPrUrl = `https://github.com/github/agentfinder-catalog/pull/${agentFinderPrNumber}`;
const agentFinderCatalogEntryPath = "catalog/cristianmoroaica/bountyverdict.json";
const agentFinderCatalogEntryUrl = `https://raw.githubusercontent.com/github/agentfinder-catalog/main/${agentFinderCatalogEntryPath}`;
const agentFinderSearchUrl = "https://github.com/agentfinder?search=bountyverdict";
const agentFinderIdentifier = "urn:ai:registry.modelcontextprotocol.io:io.github.cristianmoroaica:bountyverdict";
const officialMcpServerName = "io.github.cristianmoroaica/bountyverdict";
const officialMcpRegistryLatestUrl = "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.cristianmoroaica%2Fbountyverdict/versions/latest";
const ardCatalogUrl = `${productionOrigin}/.well-known/ai-catalog.json`;
const ardRepresentativeQueries = Object.freeze([
  "check whether a github bounty issue is still open claimed or worth coding",
  "compare github bounty issues and choose the best candidate",
  "audit repository coding agent instructions before autonomous work",
  "diagnose a failed github actions workflow and decide whether to fix or retry",
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
  { product: "single", url: `${productionOrigin}/api/verdict`, method: "GET" },
  { product: "portfolio", url: `${productionOrigin}/api/portfolio`, method: "POST" },
  { product: "harness", url: `${productionOrigin}/api/harness`, method: "GET" },
  { product: "skill", url: `${productionOrigin}/api/skill`, method: "GET" },
  { product: "run", url: `${productionOrigin}/api/run`, method: "GET" },
  { product: "flake", url: `${productionOrigin}/api/flake`, method: "GET" },
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
  { product: "harness", path: "/api/harness", query: "audit repository coding agent instructions AGENTS.md CLAUDE.md" },
  { product: "skill", path: "/api/skill", query: "security audit an agent skill before installation" },
  { product: "run", path: "/api/run", query: "diagnose failed github actions workflow run root cause" },
  { product: "flake", path: "/api/flake", query: "decide whether failed github actions run is flaky and should retry" },
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
const agentSkillRetryMs = 20 * 60 * 60 * 1000;
const forceAgentSkillSubmission = process.env.AGENTSKILL_FORCE_SUBMIT === "YES";
const execFileAsync = promisify(execFile);

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
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
        url.searchParams.set("owner", "cristianmoroaica");
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
      const expectedId = query.skill ? `cristianmoroaica/bountyverdict/${query.skill}` : null;
      const rank = expectedId === null
        ? (payload.skills as Array<Record<string, unknown>>).findIndex(({ source }) => source === "cristianmoroaica/bountyverdict")
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
      "issue", "view", "2369",
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
  if (issue.number !== 2369 || issue.url !== awesomeCopilotIssueUrl || !Array.isArray(issue.labels) ||
    !Array.isArray(catalog)) {
    throw new Error("Awesome Copilot returned malformed review or catalog telemetry.");
  }
  const labels = issue.labels.map((label: Record<string, unknown>) => String(label.name || "")).filter(Boolean).sort();
  const matching = (catalog as Array<Record<string, any>>).filter((entry) =>
    entry.name === "bountyverdict" && entry.source?.source === "github" &&
    entry.source?.repo === "cristianmoroaica/bountyverdict"
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
      pr_merged_at: review.merged_at || null,
      pr_draft: review.draft === true,
      pr_mergeable: review.mergeable ?? null,
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
      pr_draft: review.draft === true,
      pr_merged_at: review.merged_at || null,
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
      `${productionOrigin}/mcp`,
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
      pr_merged_at: review.merged_at || null,
      pr_draft: review.draft === true,
      pr_mergeable: review.mergeable ?? null,
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

async function clineMarketplaceStatus(
  previousStatus: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  try {
    const [review, catalogResponse] = await Promise.all([
      githubPrStatus("cline", "marketplace", clineMarketplacePrNumber, clineMarketplacePrUrl),
      fetch(clineMarketplaceCatalogUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (!catalogResponse.ok) throw new Error(`Cline Marketplace returned HTTP ${catalogResponse.status}.`);
    const body = await catalogResponse.text();
    if (body.length > 2_000_000) throw new Error("Cline Marketplace catalog response is unbounded.");
    const parsed = parseClineMarketplaceCatalog(JSON.parse(body), repository, `${productionOrigin}/mcp`);
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
      url: clineMarketplacePrUrl,
      catalog_url: clineMarketplaceCatalogUrl,
      pr_status: prStatus,
      pr_merged_at: review.merged_at || null,
      pr_draft: review.draft === true,
      pr_mergeable: review.mergeable ?? null,
      catalog_http_status: catalogResponse.status,
      ...parsed,
      status,
      first_listed_at: parsed.contract_verified ? previousStatus.first_listed_at || observedAt : null,
      measurement: "submission_and_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue",
    };
  } catch (error) {
    return {
      url: clineMarketplacePrUrl,
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
      ? parseKiloMarketplaceDefinition(await definitionResponse.text(), repository, `${productionOrigin}/mcp`)
      : null;
    const catalogBody = await catalogResponse.text();
    const catalog = parseKiloMarketplaceCatalog(catalogBody, repository, `${productionOrigin}/mcp`);
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
      pr_merged_at: review.merged_at || null,
      pr_draft: review.draft === true,
      pr_mergeable: review.mergeable ?? null,
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
      String((entry as Record<string, unknown>).fullName || "").toLowerCase() === "cristianmoroaica/bountyverdict");
    if (matches.length > 1) throw new Error("Gemini CLI Extensions Gallery duplicated BountyVerdict.");
    const entry = matches[0] as Record<string, unknown> | undefined;
    const listed = Boolean(entry);
    const contractVerified = Boolean(entry && entry.url === repository && entry.extensionName === "bountyverdict" &&
      entry.extensionVersion === "1.1.0" && entry.hasMCP === true);
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
  const githubHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "bountyverdict-directory-monitor",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const [prResponse, prFilesResponse, catalogResponse, registryResponse, searchResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/github/agentfinder-catalog/pulls/${agentFinderPrNumber}`, {
        headers: githubHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(`https://api.github.com/repos/github/agentfinder-catalog/pulls/${agentFinderPrNumber}/files?per_page=100`, {
        headers: githubHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      }),
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
    if (prResponse.status !== 200 || prFilesResponse.status !== 200 ||
      ![200, 404].includes(catalogResponse.status) || registryResponse.status !== 200 || searchResponse.status !== 200) {
      throw new Error(`Agent Finder returned HTTP ${prResponse.status}/${prFilesResponse.status}/${catalogResponse.status}/${registryResponse.status}/${searchResponse.status}.`);
    }
    const pr = await prResponse.json() as Record<string, any>;
    const prFiles = await prFilesResponse.json() as unknown;
    if (!Array.isArray(prFiles) || prFiles.length > 100 ||
      prFiles.some((file: unknown) => !file || typeof file !== "object" || Array.isArray(file) ||
        typeof (file as Record<string, unknown>).filename !== "string" ||
        String((file as Record<string, unknown>).filename).length > 1_000)) {
      throw new Error("Agent Finder PR files are malformed or unbounded.");
    }
    const prContractVerified = pr.number === agentFinderPrNumber && pr.html_url === agentFinderPrUrl &&
      pr.base?.repo?.full_name === "github/agentfinder-catalog" && pr.base?.ref === "main" &&
      pr.head?.label === "cristianmoroaica:add-bountyverdict-agent-tools" && pr.changed_files === 1 &&
      prFiles.length === 1 && prFiles[0].filename === agentFinderCatalogEntryPath && prFiles[0].status === "added";
    const prStatus = pr.merged_at ? "merged" : typeof pr.state === "string" ? pr.state : "unknown";

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
      `${productionOrigin}/mcp`,
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
      pr_merged_at: pr.merged_at || null,
      pr_draft: pr.draft === true,
      pr_mergeable: pr.mergeable ?? null,
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
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pull}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "bountyverdict-directory-monitor",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { url, http_status: response.status, status: "unexpected_response" };
    }
    const payload = await response.json() as {
      state?: string;
      merged_at?: string | null;
      draft?: boolean;
      mergeable?: boolean | null;
    };
    return {
      url,
      http_status: response.status,
      status: payload.merged_at ? "merged" : payload.state || "unknown",
      merged_at: payload.merged_at || null,
      draft: payload.draft === true,
      mergeable: payload.mergeable,
    };
  } catch (error) {
    return {
      url,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
  try {
    const [searchResponse, detailResponse] = await Promise.all([
      fetch(searchUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      fetch(detailUrl, {
        headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ]);
    if (!searchResponse.ok || !detailResponse.ok) {
      return {
        url: "https://agent-tools.cloud/",
        search_url: searchUrl,
        detail_url: detailUrl,
        listed: false,
        status: "unexpected_response",
        search_http_status: searchResponse.status,
        detail_http_status: detailResponse.status,
      };
    }
    const search = await searchResponse.json() as Record<string, any>;
    const detail = await detailResponse.json() as Record<string, any>;
    return {
      url: "https://agent-tools.cloud/",
      search_url: searchUrl,
      detail_url: detailUrl,
      ...parseAgentToolsCloudListing(search, detail, {
        productionOrigin,
        slug: agentToolsCloudSlug,
        revenueWallet,
        expectedResources: x402ScanResources,
      }),
    };
  } catch (error) {
    return {
      url: "https://agent-tools.cloud/",
      search_url: searchUrl,
      detail_url: detailUrl,
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
    if (!response.ok) throw new Error(`AgentSkills.in search returned HTTP ${response.status}.`);
    const issue = JSON.parse(stdout) as Record<string, any>;
    if (issue.number !== agentSkillsInSubmissionIssueNumber || issue.url !== agentSkillsInSubmissionIssueUrl ||
      !Array.isArray(issue.labels) || !Array.isArray(issue.comments) || !["OPEN", "CLOSED"].includes(issue.state)) {
      throw new Error("AgentSkills.in submission issue telemetry is malformed.");
    }
    const catalog = parseAgentSkillsInSearchPayload(await response.json());
    const listed = catalog.listed === true;
    return {
      url: agentSkillsInSubmissionIssueUrl,
      listing_url: agentSkillsInListingUrl,
      search_url: agentSkillsInSearchUrl,
      http_status: response.status,
      ...catalog,
      status: listed
        ? "listed"
        : catalog.status === "contract_drift"
          ? "catalog_contract_drift"
          : issue.state === "CLOSED"
            ? "submission_closed_without_listing"
            : "submitted_pending_indexing",
      submission: {
        issue_number: issue.number,
        issue_state: issue.state,
        issue_created_at: issue.createdAt,
        issue_updated_at: issue.updatedAt,
        issue_closed_at: issue.closedAt,
        labels: issue.labels.map((label: Record<string, unknown>) => String(label.name || "")).filter(Boolean).sort(),
        maintainer_comments: issue.comments.length,
        direct_endpoint_attempts: 2,
        direct_endpoint_result: "backend_failed_403_then_cloudflare_1101",
      },
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

async function githubSkillStatus(previousStatus: Record<string, any>, observedAt: string): Promise<Record<string, unknown>> {
  try {
    const hour = Math.floor(Date.parse(observedAt) / (60 * 60 * 1000));
    const selectedSkill = PUBLISHED_SKILLS[hour % PUBLISHED_SKILLS.length];
    const [{ stdout: releaseOutput }, { stdout: searchOutput }] = await Promise.all([
      execFileAsync("gh", [
        "release", "view", githubSkillReleaseTag,
        "--repo", "cristianmoroaica/bountyverdict",
        "--json", "tagName,isDraft,isPrerelease,publishedAt,url,targetCommitish",
      ], { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }),
      execFileAsync("gh", [
        "skill", "search", selectedSkill,
        "--owner", "cristianmoroaica",
        "--limit", "20",
        "--json", "description,namespace,path,repo,skillName,stars",
      ], { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }),
    ]);
    const release = JSON.parse(releaseOutput) as Record<string, unknown>;
    const results = JSON.parse(searchOutput) as Array<Record<string, unknown>>;
    if (!Array.isArray(results)) throw new Error(`GitHub Skill search for ${selectedSkill} was malformed.`);
    const resultIndex = results.findIndex((entry) =>
      String(entry.repo).toLowerCase() === "cristianmoroaica/bountyverdict" && entry.skillName === selectedSkill
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
      url: `https://github.com/cristianmoroaica/bountyverdict/releases/tag/${githubSkillReleaseTag}`,
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

let previous: Record<string, any> = {};
try {
  previous = JSON.parse(await readFile(stateFile, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const [
  skills,
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
  clineMarketplace,
  kiloMarketplace,
  geminiCliGallery,
  agentFinderCatalog,
  ardCatalog,
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
] = await Promise.all([
  skillsShStatus(),
  agentToolStatus(),
  mcpRepositoryStatus(),
  agentNdxStatus(),
  mcpObservatoryStatus(),
  githubPrStatus("roverbird", "mcpub", 4, mcpubCrawlerPrUrl),
  githubPrStatus("LLMSecurity", "awesome-agent-skills-security", 38, securityDirectoryPrUrl),
  githubPrStatus("xpaysh", "awesome-x402", 934, x402DirectoryPrUrl),
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
  clineMarketplaceStatus(previous.cline_marketplace || {}, new Date().toISOString()),
  kiloMarketplaceStatus(previous.kilo_marketplace || {}, new Date().toISOString()),
  geminiCliGalleryStatus(previous.gemini_cli_gallery || {}, new Date().toISOString()),
  agentFinderCatalogStatus(previous.agent_finder_catalog || {}, new Date().toISOString()),
  ardCatalogStatus(previous.ard_catalog || {}, new Date().toISOString()),
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
const state = {
  checked_at: new Date().toISOString(),
  repository,
  skills_sh: skills,
  agenttool,
  mcp_repository: mcpRepository,
  agentndx: agentNdx,
  mcp_observatory: mcpObservatory,
  mcpub_crawler_pr: mcpubCrawlerPr,
  agentskill,
  agent_skills_in: agentSkillsIn,
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
  cline_marketplace: clineMarketplace,
  kilo_marketplace: kiloMarketplace,
  gemini_cli_gallery: geminiCliGallery,
  agent_finder_catalog: agentFinderCatalog,
  ard_catalog: ardCatalog,
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
