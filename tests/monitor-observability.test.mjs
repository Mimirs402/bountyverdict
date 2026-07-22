import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const distributionUrl = new URL("../agent/scripts/distribution-monitor.ts", import.meta.url);
const auditedRunnerUrl = new URL("../agent/scripts/run-audited-monitor.ts", import.meta.url);
const directoryMonitorUrl = new URL("../agent/scripts/directory-monitor.ts", import.meta.url);
const agentToolsCloudUrl = new URL("../agent/src/agent-tools-cloud.ts", import.meta.url);
const acquisitionUrl = new URL("../agent/src/acquisition.ts", import.meta.url);
const demandWatchUrl = new URL("../agent/scripts/demand-watch.ts", import.meta.url);
const demandServiceUrl = new URL("../ops/systemd/bountyverdict-demand-watch.service", import.meta.url);
const directoryTimerUrl = new URL("../ops/systemd/bountyverdict-directory-monitor.timer", import.meta.url);
const marketplaceTimerUrl = new URL("../ops/systemd/bountyverdict-marketplace-audit.timer", import.meta.url);
const geminiExtensionUrl = new URL("../gemini-extension.json", import.meta.url);

test("frequent reporting samples merchant activity without semantic retrieval while full audits establish a drain", async () => {
  const [distribution, auditedRunner, directory] = await Promise.all([
    readFile(distributionUrl, "utf8"),
    readFile(auditedRunnerUrl, "utf8"),
    readFile(directoryMonitorUrl, "utf8"),
  ]);
  assert.match(distribution, /const reportOnly = configuration\.reportOnly/);
  assert.match(distribution, /!reportOnly && process\.env\.BOUNTYVERDICT_AUDITED_ROTATION_ACTIVE !== "distribution"/);
  assert.match(distribution, /if \(reportOnly\) \{[\s\S]+merchantDiscoveryStatus\(previousReport\.discovery \|\| \{\}, checkedAt\)[\s\S]+\} else \{\s+try \{\s+discovery = await discoveryStatus/);
  assert.match(distribution, /marketplace_search: previousReport\.acquisition\?\.marketplace_search/);
  assert.match(distribution, /agenticMarket = previousReport\.marketplaces\?\.agentic_market/);
  assert.match(distribution, /Security action required:[^\n]+x402\.jobs API key/);
  assert.match(distribution, /ToolHive in-agent catalog:[^\n]+PR \[#1388\]/);
  assert.match(distribution, /Placement and review state are not impressions, installs, purchases, or revenue/);
  assert.match(auditedRunner, /FUNNEL_ROTATION_ID: rotationId/);
  assert.match(auditedRunner, /if \(monitor === "distribution"\) loadDistributionMonitorConfiguration\(process\.env\)/);
  assert.match(auditedRunner, /process\.env\.BOUNTYVERDICT_AUDITED_ROTATION_ACTIVE = monitor/);
  assert.match(auditedRunner, /if \(monitor === "directory"\).*directory-monitor/s);
  assert.match(auditedRunner, /else await import\("\.\/distribution-monitor\.ts"\)/);
  assert.match(directory, /BOUNTYVERDICT_AUDITED_ROTATION_ACTIVE !== "directory"/);
});

test("directory monitoring retains public AgentSkill and GitHub Skill conversion signals", async () => {
  const [directory, acquisition] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(acquisitionUrl, "utf8"),
  ]);
  assert.match(directory, /parseAgentSkillSearchPayload/);
  assert.match(directory, /metric_history: mergeAgentSkillHistory/);
  assert.match(directory, /total_installs/);
  assert.match(acquisition, /security_score/);
  assert.match(acquisition, /content_quality_score/);
  assert.match(directory, /execFileAsync\("gh", \[\s*"skill", "search"/s);
  assert.match(directory, /one_rotating_owner_run_exact_github_code_search_per_hour/);
  assert.match(directory, /github_skill: githubSkill/);
});

test("directory monitoring tracks the dedicated Skills.sh adapter and indexing request", async () => {
  const [directory, distribution, parser] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
    readFile(new URL("../agent/src/skills-sh.ts", import.meta.url), "utf8"),
  ]);
  const start = directory.indexOf("async function skillsShDedicatedStatus");
  const end = directory.indexOf("async function agentPluginsCatalogStatus", start);
  assert.ok(start >= 0 && end > start);
  const dedicated = directory.slice(start, end);
  assert.match(directory, /skills\.sh\/Mimirs402\/bountyverdict-mcp-skill/);
  assert.match(dedicated, /vercel-labs\/skills/);
  assert.match(dedicated, /"1754"/);
  assert.match(dedicated, /url\.searchParams\.set\("owner", "Mimirs402"\)/);
  assert.doesNotMatch(dedicated, /owner", "cristianmoroaica"/);
  assert.match(directory, /skills_sh_dedicated: skillsDedicated/);
  assert.match(parser, /Mimirs402\/bountyverdict-mcp-skill/);
  assert.match(parser, /route-github-agent-decisions/);
  assert.match(distribution, /Dedicated Skills\.sh adapter/);
  assert.match(distribution, /request and owner-run retrieval are never demand or revenue/);
});

test("directory monitoring verifies the account-free Awesome Skills listing without claiming demand", async () => {
  const [directory, distribution, parser] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
    readFile(new URL("../agent/src/awesome-skills.ts", import.meta.url), "utf8"),
  ]);
  assert.match(directory, /async function awesomeSkillsStatus/);
  assert.match(directory, /awesome_skills: awesomeSkills/);
  assert.match(directory, /account_free_public_repository_url/);
  assert.match(directory, /readBoundedText\(response, AWESOME_SKILLS_MAX_PAGE_BYTES\)/);
  assert.match(parser, /bountyverdict-mcp-skill-route-github-agent-decisions/);
  assert.match(parser, /npx skills add/);
  assert.match(parser, /check_mcp_tool_drift/);
  assert.match(distribution, /Awesome Skills adapter/);
  assert.match(distribution, /submission and listing presence are never demand or revenue/);
});

test("directory monitoring tracks the exact AgentSkills.in adapter and source cohort without claiming demand", async () => {
  const [directory, distribution, parser] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
    readFile(new URL("../agent/src/agentskills-in.ts", import.meta.url), "utf8"),
  ]);
  assert.match(directory, /agentSkillsInStatus/);
  assert.match(directory, /Karanjot786\/agent-skills-cli/);
  assert.match(directory, /agent_skills_in: agentSkillsIn/);
  assert.match(directory, /submitted_catalog_unavailable/);
  assert.match(directory, /agentSkillsInFallbackSearchUrl/);
  assert.match(directory, /bounded_fallback_search/);
  assert.match(parser, /AGENT_SKILLS_IN_REPOSITORY = "cristianmoroaica\/bountyverdict-mcp-skill"/);
  assert.match(parser, /AGENT_SKILLS_IN_SKILL_NAME = "route-github-agent-decisions"/);
  assert.match(parser, /submission_and_exact_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue|pending_indexing/);
  assert.match(distribution, /AgentSkills\.in adapter/);
  assert.match(distribution, /mcp_by_channel\?\.agent_skills_marketplace/);
  assert.match(distribution, /submission\/listing and aggregate events are not installs, unique agents, purchases, or revenue/);
});

test("directory monitoring verifies the anonymous Agent-Skills.md adapter without inventing demand", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /async function agentSkillsMdStatus/);
  assert.match(directory, /agent-skills\.md\/skills\/Mimirs402\/bountyverdict-mcp-skill\/route-github-agent-decisions/);
  assert.match(directory, /Repo captured\. Mimirs402\/bountyverdict-mcp-skill added with 1 skills\./);
  assert.match(directory, /agent_skills_md: agentSkillsMd/);
  assert.match(directory, /anonymous_submission_and_exact_listing_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue/);
  assert.match(distribution, /Agent-Skills\.md adapter/);
  assert.match(distribution, /anonymous submission and catalog presence are never impressions, installs, tool calls, purchases, or revenue/);
});

test("directory monitoring tracks the seven canonical askill entries and task retrieval without inventing demand", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /const askillMainSubmittedAt = "2026-07-22T00:19:00\.000Z"/);
  assert.match(directory, /async function askillMainStatus/);
  assert.match(directory, /parseAskillMainSearchPayload/);
  assert.match(directory, /parseAskillMainBuyerQueryPayload/);
  assert.match(directory, /indexed_skills: 7/);
  assert.match(directory, /askill_main: askillMain/);
  assert.match(directory, /exact_seven_skill_catalog_presence_and_fixed_owner_run_ranks_not_search_volume_impressions_installs_tool_calls_purchases_or_revenue/);
  assert.match(distribution, /Canonical askill skill suite/);
  assert.match(distribution, /listing and owner-run rank evidence are never impressions, installs, calls, purchases, or revenue/);
});

test("directory monitoring tracks the exact SkillsMD submission and public install counter without claiming revenue", async () => {
  const [directory, distribution, parser] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
    readFile(new URL("../agent/src/skillsmd.ts", import.meta.url), "utf8"),
  ]);
  assert.match(directory, /skillsMdStatus/);
  assert.match(directory, /e68e968f-d03d-4808-b36b-5fd3b42b6489/);
  assert.match(directory, /skills_md: skillsMd/);
  assert.match(parser, /SKILLS_MD_REPOSITORY = "cristianmoroaica\/bountyverdict-mcp-skill"/);
  assert.match(parser, /SKILLS_MD_SKILL_NAME = "route-github-agent-decisions"/);
  assert.match(distribution, /SkillsMD adapter/);
  assert.match(distribution, /public installs/);
  assert.match(distribution, /submission, catalog presence, and install counters are not impressions, tool calls, purchases, or revenue/);
});

test("distribution monitoring treats Payan demand state as a funnel and receipts as settlement attribution", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(distribution, /async function payanDemandStatus/);
  assert.match(distribution, /exact_fit_request_bids_and_fulfillment_state_not_settlement_or_revenue_by_itself/);
  assert.match(distribution, /delivered_request_sales/);
  assert.match(distribution, /\["direct", "escrow_release"\]/);
  assert.match(distribution, /Payan exact-fit demand capture/);
});

test("distribution monitoring measures the MCP selection-preview rollout from an immutable buyer-event baseline", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(distribution, /mcp-selection-preview-parity-v2/);
  assert.match(distribution, /release_commit: "0734bec44f4f96ff3bb56f6e362911c884509c99"/);
  assert.match(distribution, /initialize: 257/);
  assert.match(distribution, /tools_list: 208/);
  assert.match(distribution, /valid_call_per_tools_list_percent/);
  assert.match(distribution, /invalid_call_share_percent/);
  assert.match(distribution, /payment_present_per_valid_call_percent/);
  assert.match(distribution, /aggregate event deltas, not unique agents or purchase proof/);
  assert.match(distribution, /monitoredFetchWithNetworkRetry/);
  assert.match(distribution, /AbortSignal\.timeout\(timeoutMs\)/);
});

test("distribution monitoring reports MCP conversion from the active trusted epoch", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(distribution, /trustedMcpDelta\(state, trustedBaseline\.mcp\)/);
  assert.match(distribution, /trusted_mcp_buyer_candidate/);
  assert.match(distribution, /trusted_mcp_external_by_product/);
  assert.match(distribution, /mcp_epoch_baseline_unavailable/);
  assert.match(distribution, /exact active-epoch deltas/);
  assert.match(distribution, /Lifetime MCP buyer-candidate capture/);
});

test("MCPDrift activation remains owner-attributed and outside purchase accounting", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(distribution, /CDP MCPDrift indexing path/);
  assert.match(distribution, /owner activation settlement completed on 2026-07-21/);
  assert.match(distribution, /dedicated payer and revenue exclusion are enforced/);
  assert.match(distribution, /documented asynchronous CDP catalog refresh/);
  assert.match(distribution, /never customer demand, purchase, or revenue/);
  assert.match(distribution, /representative JSON activation call settled successfully/);
  assert.match(distribution, /strict invalid-input-before-payment behavior remains intact/);
});

test("marketplace retrieval uses a blind-agent task holdout instead of seller-shaped copy", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  assert.doesNotMatch(distribution, /public GitHub bounty worth pursuing/);
  assert.match(distribution, /why did this GitHub Actions run fail/);
  assert.match(distribution, /check AGENTS\.md and CLAUDE\.md before editing this repository/);
  assert.match(distribution, /will this MCP tools list update break existing agents/);
  assert.match(distribution, /Two plain-language questions per product/);
  assert.match(distribution, /not observed marketplace query volume/);
});

test("Smithery monitoring measures fixed agent tasks without inventing demand", async () => {
  const [distribution, smithery] = await Promise.all([
    readFile(distributionUrl, "utf8"),
    readFile(new URL("../agent/src/smithery.ts", import.meta.url), "utf8"),
  ]);
  assert.match(distribution, /smithery: await smitheryStatus\(checkedAt\)/);
  assert.match(distribution, /previousReport\.acquisition\?\.smithery/);
  assert.match(distribution, /public use counter are placement\/use telemetry, not search volume, impressions, purchases, or revenue/);
  assert.match(distribution, /Fixed unbranded task descriptions supplied by context-isolated agents/);
  assert.match(distribution, /bounded to Smithery's first 20 results/);
  assert.match(smithery, /SMITHERY_TOOL_NAMES/);
});

test("the monitor turns privacy-safe hits into bounded actionable cohort summaries", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(distribution, /trusted_by_discovery_cohort/);
  assert.match(distribution, /trusted_by_cohort/);
  assert.match(distribution, /\.slice\(0, 5\)/);
  assert.match(distribution, /Latest privacy-safe buyer-candidate learning/);
  assert.match(distribution, /isBuyerCandidateDiscoveryCohort/);
  assert.match(distribution, /trusted_buyer_candidate_discovery_requests/);
  assert.match(distribution, /raw external discovery\/health hits/);
  assert.match(distribution, /no arguments, URLs, payloads, identities, IPs, or raw user agents retained/);
});

test("directory monitoring separates Awesome Copilot review and catalog presence from demand", async () => {
  const directory = await readFile(directoryMonitorUrl, "utf8");
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(directory, /async function awesomeCopilotStatus/);
  assert.match(directory, /submission_review_and_default_catalog_presence_not_impressions_installs_or_purchases/);
  assert.match(directory, /issues\/2385/);
  assert.match(directory, /Mimirs402\/bountyverdict/);
  assert.match(distribution, /Awesome Copilot default marketplace/);
  assert.match(distribution, /default-marketplace presence is not an impression, install, or purchase/);
});

test("directory monitoring tracks LobeHub review and exact listing without calling it demand", async () => {
  const directory = await readFile(directoryMonitorUrl, "utf8");
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(directory, /async function lobeHubStatus/);
  assert.match(directory, /const lobeHubIssueNumber = 17401/);
  assert.match(directory, /lobehub\/lobehub/);
  assert.match(directory, /io-github-cristianmoroaica-bountyverdict/);
  assert.match(directory, /# BountyVerdict Agent Decision Tools/);
  assert.match(directory, /Connection Type:\*\* remote/);
  assert.match(directory, /submission_review_and_catalog_presence_not_impressions_tool_calls_purchases_or_revenue/);
  assert.match(directory, /lobehub: lobeHub/);
  assert.match(distribution, /LobeHub MCP marketplace/);
  assert.match(distribution, /submission or catalog presence is never an impression, tool call, purchase, or revenue/);
});

test("directory monitoring tracks Awesome MCP Servers without contaminating the frozen experiment", async () => {
  const [directory, distribution, acquisition] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
    readFile(acquisitionUrl, "utf8"),
  ]);
  assert.match(directory, /async function awesomeMcpServersStatus/);
  assert.match(directory, /const awesomeMcpServersPrNumber = 10554/);
  assert.match(directory, /parseAwesomeMcpServersReadme/);
  assert.match(directory, /awesome_mcp_servers: awesomeMcpServers/);
  assert.match(distribution, /Awesome MCP Servers/);
  assert.match(distribution, /placement only, never an impression, tool call, purchase, or revenue/);
  assert.match(distribution, /awesome_mcp_servers: state\.awesome_mcp_servers/);
  assert.doesNotMatch(acquisition, /catalog_listed/);
});

test("directory monitoring tracks TensorBlock and Agentage as placement-only agent catalogs", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /async function tensorBlockMcpIndexStatus/);
  assert.match(directory, /const tensorBlockIssueNumber = 1311/);
  assert.match(directory, /const tensorBlockPrNumber = 1312/);
  assert.match(directory, /parseTensorBlockSearch/);
  assert.match(directory, /tensorblock_mcp_index: tensorBlockMcpIndex/);
  assert.match(directory, /async function agentageStatus/);
  assert.match(directory, /https:\/\/catalog\.agentage\.io\/mcp/);
  assert.match(directory, /parseAgentageGetResponse/);
  assert.doesNotMatch(directory, /await call\(1, "mcp_search"/);
  assert.match(directory, /agentage,/);
  assert.match(distribution, /TensorBlock MCP Index/);
  assert.match(distribution, /Agentage MCP directory/);
  assert.match(distribution, /agent-ready catalog placement only, never an impression, tool call, purchase, or revenue/);
  assert.match(distribution, /exact owner-run record lookup only, never an impression, tool call, purchase, or revenue/);
});

test("directory monitoring tracks Docker registry review separately from live catalog exposure", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /const dockerMcpRegistryPrNumber = 4509/);
  assert.match(directory, /async function dockerMcpRegistryStatus/);
  assert.match(directory, /parseDockerMcpRegistryDefinition/);
  assert.match(directory, /parseDockerMcpHubPage/);
  assert.match(directory, /docker_mcp_registry: dockerMcpRegistry/);
  assert.match(distribution, /Docker MCP Registry/);
  assert.match(distribution, /Docker catalog placement only, never an impression, tool call, purchase, or revenue/);
});

test("directory monitoring tracks the exact MCPServers.org submission without search inflation", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /const mcpServersOrgSubmissionId = 4842/);
  assert.match(directory, /async function mcpServersOrgStatus/);
  assert.match(directory, /method: "HEAD"/);
  assert.match(directory, /mcp_servers_org: mcpServersOrg/);
  assert.doesNotMatch(directory, /mcpservers\.org\/search\?query/);
  assert.match(distribution, /MCPServers\.org/);
  assert.match(distribution, /exact receipt\/listing checks only, never search impressions, tool calls, purchases, or revenue/);
});

test("directory monitoring tracks the recorded MCP.Directory submission without search inflation", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /const mcpDirectorySubmittedAt = "2026-07-21T05:48:37Z"/);
  assert.match(directory, /async function mcpDirectoryStatus/);
  assert.match(directory, /https:\/\/mcp\.directory\/servers\/bountyverdict/);
  assert.match(directory, /mcp_directory: mcpDirectory/);
  assert.match(directory, /submission_recorded: true/);
  assert.match(directory, /remote_metadata_verified/);
  assert.match(directory, /recorded_submission_http_200_and_exact_listing_presence_not_search_impressions_tool_calls_purchases_or_revenue/);
  assert.doesNotMatch(directory, /mcp\.directory\/servers\?q=/);
  assert.match(distribution, /MCP\.Directory/);
  assert.match(distribution, /free submission recorded from its HTTP 200 response/);
  assert.match(distribution, /exact listing checks only, never search impressions, tool calls, purchases, or revenue/);
});

test("directory monitoring records the three account-free submissions without inflating route shells into exposure", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /const vaultPlaneSubmissionId = "8ffee7a8-d33b-486f-8eae-9483db40d75b"/);
  assert.match(directory, /async function vaultPlaneStatus/);
  assert.match(directory, /async function toolsForAgentsStatus/);
  assert.match(directory, /a generic shell or route-state echo cannot become false exposure/);
  assert.match(directory, /async function mcpServerSpotStatus/);
  assert.match(directory, /mcp_server_spot: mcpServerSpot/);
  assert.match(directory, /tools_for_agents: toolsForAgents/);
  assert.match(directory, /vaultplane: vaultPlane/);
  assert.match(distribution, /VaultPlane skill directory/);
  assert.match(distribution, /a generic route HTTP 200 is not counted as exposure/);
  assert.match(distribution, /MCP Server Spot/);
  assert.match(distribution, /listing presence is not an impression, tool call, purchase, or revenue/);
});

test("directory monitoring tracks Cline review and exact in-agent install contract without claiming demand", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /const clineMarketplacePrNumber = 16/);
  assert.match(distribution, /routing skill https:\/\/github\.com\/cline\/marketplace\/pull\/15/);
  assert.match(directory, /async function clineMarketplaceStatus/);
  assert.match(directory, /parseClineMarketplaceCatalog/);
  assert.match(directory, /cline_marketplace: clineMarketplace/);
  assert.match(directory, /submission_and_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue/);
  assert.match(distribution, /cline_marketplace: state\.cline_marketplace/);
  assert.match(distribution, /Cline in-agent marketplace/);
  assert.match(distribution, /exact marketplace install\/wizard contract/);
  assert.match(distribution, /Cline marketplace source capture/);
  assert.match(distribution, /mcpClineMarketplace\.paid_success/);
  assert.match(distribution, /aggregate events, not installs, unique agents, purchases, or revenue/);
});

test("x402scan monitoring follows the seven canonical paid transports", async () => {
  const directory = await readFile(directoryMonitorUrl, "utf8");
  const start = directory.indexOf("const x402ScanResources");
  const end = directory.indexOf("const x402ScoutIds", start);
  assert.ok(start >= 0 && end > start);
  const resources = directory.slice(start, end);
  const expected = [
    '{ product: "single", url: `${productionOrigin}/api/bounty-preflight`, method: "POST" }',
    '{ product: "portfolio", url: `${productionOrigin}/api/portfolio`, method: "POST" }',
    '{ product: "harness", url: `${productionOrigin}/api/repository-agent-instructions-audit`, method: "POST" }',
    '{ product: "skill", url: `${productionOrigin}/api/skill`, method: "GET" }',
    '{ product: "run", url: `${productionOrigin}/api/github-actions-run-diagnosis`, method: "POST" }',
    '{ product: "flake", url: `${productionOrigin}/api/github-actions-flake-retry-gate`, method: "POST" }',
    '{ product: "mcpdrift", url: `${productionOrigin}/api/mcp-drift`, method: "POST" }',
  ];
  for (const resource of expected) assert.ok(resources.includes(resource));
  assert.doesNotMatch(resources, /\/api\/verdict/);
});

test("directory PR monitoring uses authenticated GitHub reads instead of exhausted anonymous API quota", async () => {
  const [directory, telemetry, distribution] = await Promise.all([
    readFile(new URL("../agent/scripts/directory-monitor.ts", import.meta.url), "utf8"),
    readFile(new URL("../agent/src/github-pr-telemetry.ts", import.meta.url), "utf8"),
    readFile(new URL("../agent/scripts/distribution-monitor.ts", import.meta.url), "utf8"),
  ]);
  assert.match(directory, /readGitHubPrStatus\(owner, repo, pull, url, timeoutMs\)/);
  assert.match(directory, /github_pr_monitoring: githubPrMonitoring/);
  assert.match(directory, /\.\.\.githubPrFields\(review\)/);
  assert.match(telemetry, /"gh", \[\.\.\.args\]/);
  assert.match(telemetry, /number,url,state,mergedAt,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,headRefOid,statusCheckRollup/);
  assert.match(telemetry, /StatusContext/);
  assert.match(directory, /workflow_runs: githubGateTotals\.workflows/);
  assert.match(directory, /action_required_check_names/);
  assert.match(directory, /\["agent_finder_catalog", agentFinderCatalog\]/);
  assert.match(distribution, /githubWorkflowRuns\.action_required/);
  assert.match(distribution, /workflow outcomes are unavailable until the next audited directory refresh and zero is not asserted/);
  assert.doesNotMatch(directory, /fetch\(`https:\/\/api\.github\.com\/repos\/github\/agentfinder-catalog\/pulls/);
  assert.match(distribution, /Authenticated GitHub PR telemetry/);
  assert.doesNotMatch(directory, /fetch\(`https:\/\/api\.github\.com\/repos\/\$\{owner\}\/\$\{repo\}\/pulls\/\$\{pull\}`/);
});

test("official MCP Registry monitoring tolerates its observed slow response without unbounded retries", async () => {
  const distribution = await readFile(new URL("../agent/scripts/distribution-monitor.ts", import.meta.url), "utf8");
  assert.match(distribution, /const MCP_REGISTRY_TIMEOUT_MS = 45_000/);
  assert.match(distribution, /MCP_REGISTRY_TIMEOUT_MS,\n\s*\)/);
  assert.doesNotMatch(distribution, /monitoredFetchWithNetworkRetry\(`https:\/\/registry\.modelcontextprotocol\.io/);
});

test("directory monitoring tracks Kilo review and exact secret-free remote contract without claiming demand", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /const kiloMarketplacePrNumber = 194/);
  assert.match(directory, /async function kiloMarketplaceStatus/);
  assert.match(directory, /parseKiloMarketplaceDefinition/);
  assert.match(directory, /parseKiloMarketplaceCatalog/);
  assert.match(directory, /kilo_marketplace: kiloMarketplace/);
  assert.match(directory, /submission_and_kilo_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue/);
  assert.match(distribution, /kilo_marketplace: state\.kilo_marketplace/);
  assert.match(distribution, /Kilo in-agent marketplace/);
  assert.match(distribution, /exact secret-free remote contract/);
  assert.match(distribution, /Kilo marketplace source capture/);
  assert.match(distribution, /mcpKiloMarketplace\.paid_success/);
});

test("directory monitoring tracks ToolHive review and exact in-agent remote contract without claiming demand", async () => {
  const [directory, distribution, parser] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
    readFile(new URL("../agent/src/toolhive.ts", import.meta.url), "utf8"),
  ]);
  assert.match(directory, /const toolHivePrNumber = 1388/);
  assert.match(directory, /async function toolHiveStatus/);
  assert.match(directory, /parseToolHiveCatalogEntry/);
  assert.match(directory, /toolhive: toolHive/);
  assert.match(directory, /submission_and_toolhive_in_agent_catalog_presence_not_impressions_installs_tool_calls_purchases_or_revenue/);
  assert.match(distribution, /toolhive: state\.toolhive/);
  assert.match(distribution, /ToolHive in-agent catalog/);
  assert.match(distribution, /exact six-tool remote contract/);
  assert.match(parser, /io\.github\.stacklok\/bountyverdict/);
  assert.match(parser, /TOOLHIVE_SERVER_VERSION = "1\.1\.9"/);
});

test("directory monitoring tracks Gemini CLI gallery propagation without claiming demand", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /const geminiCliGalleryUrl = "https:\/\/geminicli\.com\/extensions\.json"/);
  assert.match(directory, /async function geminiCliGalleryStatus/);
  assert.match(directory, /mimirs402\/bountyverdict/);
  assert.match(directory, /entry\.hasMCP === true/);
  assert.match(directory, /gemini_cli_gallery: geminiCliGallery/);
  assert.match(directory, /exact_gemini_cli_gallery_presence_not_search_impressions_installs_tool_calls_purchases_or_revenue/);
  assert.match(distribution, /gemini_cli_gallery: state\.gemini_cli_gallery/);
  assert.match(distribution, /Gemini CLI Extensions Gallery/);
  assert.match(distribution, /catalog presence is never an impression, install, tool call, purchase, or revenue/);
});

test("directory monitoring tracks exact GitHub Agent Finder PR, catalog, Registry, and search state without claiming demand", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /const agentFinderPrNumber = 11/);
  assert.match(directory, /github\/agentfinder-catalog\/pull\/\$\{agentFinderPrNumber\}/);
  assert.match(directory, /catalog\/Mimirs402\/bountyverdict\.json/);
  assert.match(directory, /registry\.modelcontextprotocol\.io\/v0\.1\/servers\/io\.github\.Mimirs402%2Fbountyverdict\/versions\/latest/);
  assert.match(directory, /https:\/\/github\.com\/agentfinder\?search=bountyverdict/);
  assert.match(directory, /async function agentFinderCatalogStatus/);
  assert.match(directory, /parseAgentFinderCatalogEntry/);
  assert.match(directory, /parseAgentFinderRegistryLatest/);
  assert.match(directory, /parseAgentFinderSearchPage/);
  assert.match(directory, /agent_finder_catalog: agentFinderCatalog/);
  assert.match(directory, /exact_pr_catalog_registry_and_owner_run_search_presence_not_impressions_installs_tool_calls_purchases_or_revenue/);
  assert.match(distribution, /agent_finder_catalog: state\.agent_finder_catalog/);
  assert.match(distribution, /GitHub Agent Finder/);
  assert.match(distribution, /PR, catalog, and search presence are distribution only, never an impression, install, tool call, purchase, or revenue/);
});

test("directory monitoring verifies the origin ARD catalog without calling publication demand", async () => {
  const [directory, distribution, deployWorkflow] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
    readFile(new URL("../.github/workflows/deploy-worker.yml", import.meta.url), "utf8"),
  ]);
  assert.match(directory, /async function ardCatalogStatus/);
  assert.match(directory, /\.well-known\/ai-catalog\.json/);
  assert.match(directory, /application\/mcp-server-card\+json/);
  assert.match(directory, /why did this github actions workflow run fail/);
  assert.match(directory, /should i retry this failed github actions run once or fix it/);
  assert.match(directory, /origin_owned_ard_catalog_availability_not_registry_indexing_impressions_tool_calls_purchases_or_revenue/);
  assert.match(directory, /ard_catalog: ardCatalog/);
  assert.match(distribution, /Agentic Resource Discovery catalog/);
  assert.match(distribution, /direct catalog availability is not registry indexing/);
  assert.match(deployWorkflow, /representativeQueries\?\.length !== 6/);
});

test("declared MCP source attribution remains allowlisted, aggregate, and separate from purchase proof", async () => {
  const [funnel, distribution] = await Promise.all([
    readFile(new URL("../agent/src/funnel-telemetry.ts", import.meta.url), "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(funnel, /url\.searchParams\.size === 1/);
  assert.match(funnel, /declaredSource === "kiro-power"/);
  assert.match(funnel, /declaredSource === "agent-skills-marketplace"/);
  assert.match(funnel, /declaredSource === "cline-marketplace"/);
  assert.match(funnel, /declaredSource === "kilo-marketplace"/);
  assert.match(funnel, /declaredSource === "cursor-deeplink"/);
  assert.match(funnel, /declaredSource === "openhands-integrations"/);
  assert.match(funnel, /\? "agent_skills_marketplace"/);
  assert.match(funnel, /event\.source === "owner_automation"[\s\S]*\? "owner_automation"/);
  assert.match(distribution, /Kiro Power package/);
  assert.match(distribution, /Cursor direct MCP workflow/);
  assert.match(distribution, /OpenHands integrations registry/);
  assert.match(distribution, /source marker is aggregate attribution, not proof of install, identity, or purchase/);
});

test("OpenHands runtime-registry monitoring pins the exact PR and no-auth remote contract", async () => {
  const [directory, distribution] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(distributionUrl, "utf8"),
  ]);
  assert.match(directory, /openHandsIntegrationsPrNumber = 416/);
  assert.match(directory, /OpenHands\/extensions\/pull\/\$\{openHandsIntegrationsPrNumber\}/);
  assert.match(directory, /integrations\/catalog\/bountyverdict\.json/);
  assert.match(directory, /mcp\?source=openhands-integrations/);
  assert.match(directory, /auth: \{ strategy: "none" \}/);
  assert.match(directory, /openhands_integrations: openHandsIntegrations/);
  assert.match(distribution, /state\.openhands_integrations/);
  assert.match(distribution, /OpenHands integrations registry/);
  assert.match(distribution, /PR \[#416\]/);
  assert.match(distribution, /not installs, unique agents, purchases, or revenue/);
});

test("production reporting keeps the executable MCP payment handoff visible", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(distribution, /requireJsonObject\("\/\.well-known\/mcp\.json"\)/);
  assert.match(distribution, /mcp_metadata: mcpMetadata/);
  assert.match(distribution, /MCP paid-call handoff/);
  assert.match(distribution, /direct MCP payment requires @x402\/mcp/);
  assert.match(distribution, /standard hosts receive the exact versioned HTTP handoff/);
});

test("Gemini CLI extension exposes only the hosted paid MCP without secrets", async () => {
  const manifest = JSON.parse(await readFile(geminiExtensionUrl, "utf8"));
  assert.deepEqual(manifest, {
    name: "bountyverdict",
    version: "1.1.9",
    description: "Paid GitHub bounty selection, CI diagnosis, flaky-run triage, agent-instruction audits, and MCP compatibility checks for autonomous coding agents.",
    mcpServers: {
      bountyverdict: {
        httpUrl: "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp",
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(manifest), /secret|token|api[_-]?key|env/i);
});

test("MCP buyer-intent reporting excludes non-buyer distribution channels but retains them separately", async () => {
  const [distribution, telemetry] = await Promise.all([
    readFile(distributionUrl, "utf8"),
    readFile(new URL("../agent/src/funnel-telemetry.ts", import.meta.url), "utf8"),
  ]);
  assert.match(telemetry, /smitherybot\\\//i);
  assert.match(telemetry, /MCP_NON_BUYER_CHANNELS/);
  assert.match(telemetry, /"glama"/);
  assert.match(telemetry, /"x402_observer"/);
  assert.match(telemetry, /"registry_or_directory"/);
  assert.match(distribution, /buyerCandidateMcpTotals/);
  assert.match(distribution, /mcpBuyerCandidateTotals\(state\)/);
  assert.match(distribution, /MCP buyer-candidate funnel/);
  assert.match(distribution, /MCP directory-crawler activity/);
  assert.match(distribution, /Glama release source capture/);
});

test("directory monitoring retains MCPRepository validation without calling it demand", async () => {
  const directory = await readFile(directoryMonitorUrl, "utf8");
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(directory, /async function mcpRepositoryStatus/);
  assert.match(directory, /mcprepository\.com\/cristianmoroaica\/bountyverdict/);
  assert.match(directory, /submission_and_catalog_presence_not_impressions_installs_or_purchases/);
  assert.match(directory, /mcp_repository: mcpRepository/);
  assert.match(distribution, /MCPRepository:/);
  assert.match(distribution, /catalog presence is not demand or revenue/);
});

test("directory monitoring retains AgentNDX review and exact listing state", async () => {
  const directory = await readFile(directoryMonitorUrl, "utf8");
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(directory, /async function agentNdxStatus/);
  assert.match(directory, /https:\/\/agentndx\.ai\/api\/servers\.json/);
  assert.match(directory, /submission_and_catalog_presence_not_search_impressions_tool_calls_or_purchases/);
  assert.match(directory, /agentndx: agentNdx/);
  assert.match(distribution, /AgentNDX MCP\/x402 registry/);
  assert.match(distribution, /catalog presence is never an impression, tool call, purchase, or revenue/);
});

test("public demand monitoring is read-only and Taskmarket accounting requires Base receipts", async () => {
  const [distribution, watcher, service] = await Promise.all([
    readFile(distributionUrl, "utf8"),
    readFile(demandWatchUrl, "utf8"),
    readFile(demandServiceUrl, "utf8"),
  ]);
  assert.match(watcher, /read_only: true/);
  assert.match(watcher, /actions_enabled: false/);
  assert.match(watcher, /A tracked Taskmarket submission becomes one purchase and positive worker-payment revenue only after its completed task exposes a canonical award and a live successful Base receipt binds it to the canonical Taskmarket Diamond TaskCompleted event/);
  assert.match(watcher, /pageNumber < 5/);
  assert.match(watcher, /searchParams\.set\("limit", "100"\)/);
  assert.doesNotMatch(watcher, /Authorization|api[_-]?key|place_bid|accept_job|x-taskmarket-api-token|keystore/i);
  assert.match(watcher, /method: "eth_getTransactionReceipt"/);
  assert.doesNotMatch(watcher, /method: "(?:eth_sendRawTransaction|eth_sendTransaction)"/);
  assert.match(distribution, /async function publicDemandStatus/);
  assert.match(distribution, /state\.read_only !== true \|\| state\.actions_enabled !== false/);
  assert.match(distribution, /public_inventory_exact_fits_submissions_and_API_awards_are_not_purchases_or_revenue/);
  assert.match(distribution, /onchain-verified Taskmarket awards/);
  assert.match(distribution, /unverified_award_submissions/);
  assert.match(distribution, /onchain\?\.verified !== true/);
  assert.match(distribution, /workerPayment <= 0n/);
  assert.match(distribution, /consumedReceiptEvidence/);
  assert.match(distribution, /consumedCanonicalEvents/);
  assert.match(distribution, /authoritative_proof_key/);
  assert.match(distribution, /0xddc6cc3e4d11c1f3527b867c7dad4ed9869c33f7/);
  assert.match(distribution, /0x0c01e82f21f6dc480e3553e62cba7e6511685aa15d312f971ea64663bef07ecb/);
  assert.match(distribution, /reuse the same receipt transfer evidence/);
  assert.match(distribution, /reported worker earnings do not equal the sum of uniquely verified settlement records/);
  assert.match(distribution, /pending opportunity totals do not equal the pending submission records/);
  assert.match(distribution, /Pending Taskmarket opportunity estimate \(not revenue\)/);
  assert.match(distribution, /explicitly operator-estimated from submitted record types/);
  assert.match(distribution, /settled_worker_earnings_usdc/);
  assert.match(distribution, /API award rows alone remain zero purchases and zero revenue/);
  assert.match(distribution, /Public funded-demand watcher/);
  assert.doesNotMatch(service, /EnvironmentFile/);
});

test("Clawlancer delivery and revenue require exact Base escrow evidence", async () => {
  const [distribution, worker, chain, lock] = await Promise.all([
    readFile(distributionUrl, "utf8"),
    readFile(new URL("../agent/scripts/clawlancer-work.ts", import.meta.url), "utf8"),
    readFile(new URL("../agent/src/clawlancer-chain.ts", import.meta.url), "utf8"),
    readFile(new URL("../agent/src/exclusive-run.ts", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /verifyClawlancerFunding\(client, transaction\)/);
  assert.match(worker, /acquireExclusiveRun\(LOCK_PATH\)/);
  assert.match(chain, /event Created\(bytes32 indexed id, address indexed buyer, address indexed seller/);
  assert.match(chain, /event Released\(bytes32 indexed id, uint256 sellerAmount, uint256 feeAmount\)/);
  assert.match(chain, /event\.from\.toLowerCase\(\) === CLAWLANCER_CHAIN\.escrowAddress\.toLowerCase\(\)/);
  assert.match(chain, /event\.sellerAmount \+ event\.feeAmount === expectedAmount/);
  assert.match(distribution, /verifyClawlancerRelease\(client, transaction\)/);
  assert.match(distribution, /verified_worker_earnings_usdc/);
  assert.match(distribution, /errors\.push\(`Clawlancer canary:/);
  assert.match(lock, /await mkdir\(path, \{ mode: 0o700 \}\)/);
});

test("directory monitoring validates the organic Agent Tools Cloud placement without calling it revenue", async () => {
  const directory = await readFile(directoryMonitorUrl, "utf8");
  const distribution = await readFile(distributionUrl, "utf8");
  const parser = await readFile(agentToolsCloudUrl, "utf8");
  assert.match(directory, /async function agentToolsCloudStatus/);
  assert.match(directory, /bountyverdict-agent-production-mimirslab-workers-dev-bazaar/);
  assert.match(parser, /organic_catalog_health_and_resource_presence_not_impressions_purchases_or_revenue/);
  assert.match(parser, /typeof payment\.pay_to !== "string" \|\| payment\.pay_to\.toLowerCase\(\) !== revenueWallet\.toLowerCase\(\)/);
  assert.match(parser, /listed_partial_probe_failed/);
  assert.match(parser, /organic_mcp_catalog_health_and_tool_presence_not_impressions_calls_purchases_or_revenue/);
  assert.match(directory, /parseAgentToolsCloudMcpListing/);
  assert.match(directory, /bountyverdict-agent-decision-tools-bountyverdict-agent-production-mimirslab-work/);
  assert.match(directory, /mcp: parseAgentToolsCloudMcpListing/);
  assert.match(directory, /parseAgentToolsCloudMcpBuyerQuery/);
  assert.match(directory, /fixed_owner_run_unbranded_catalog_queries_not_search_volume_impressions_calls_purchases_or_revenue/);
  assert.match(directory, /AgentToolsCloudContractDrift \? "contract_drift"/);
  assert.match(directory, /agent_tools_cloud: agentToolsCloud/);
  assert.match(distribution, /Agent Tools Cloud contract drift/);
  assert.match(distribution, /Agent Tools Cloud organic catalog/);
  assert.match(distribution, /presence and health are never purchases/);
});

test("all scheduled broad directory audits establish or reuse a funnel drain", async () => {
  const directoryService = await readFile(new URL("../ops/systemd/bountyverdict-directory-monitor.service", import.meta.url), "utf8");
  const snapshotService = await readFile(new URL("../ops/systemd/bountyverdict-acquisition-snapshot.service", import.meta.url), "utf8");
  assert.match(directoryService, /Environment=AUDITED_MONITOR=directory/);
  assert.match(directoryService, /scripts\/run-audited-monitor\.ts/);
  assert.doesNotMatch(directoryService, /ExecStart=.*scripts\/directory-monitor\.ts/);
  assert.match(snapshotService, /AUDITED_MONITOR=directory[\s\S]+scripts\/run-audited-monitor\.ts/);
  assert.match(snapshotService, /AUDITED_MONITOR=distribution[\s\S]+scripts\/run-audited-monitor\.ts/);
  assert.doesNotMatch(snapshotService, /ExecStart=.*scripts\/(?:directory|distribution)-monitor\.ts/);
});

test("broad retrieval audits share a bounded six-hour measurement window", async () => {
  const [directoryTimer, marketplaceTimer] = await Promise.all([
    readFile(directoryTimerUrl, "utf8"),
    readFile(marketplaceTimerUrl, "utf8"),
  ]);
  assert.match(directoryTimer, /OnCalendar=\*-\*-\* 05,11,17,23:15:00/);
  assert.match(marketplaceTimer, /OnCalendar=\*-\*-\* 05,11,17,23:17:00/);
  assert.doesNotMatch(directoryTimer, /OnUnitActiveSec=1h|hourly/i);
  assert.doesNotMatch(marketplaceTimer, /OnUnitActiveSec=1h|hourly/i);
});

test("the normal distribution timer is report-only and retains explicit accounting identity", async () => {
  const service = await readFile(new URL("../ops/systemd/bountyverdict-distribution-monitor.service", import.meta.url), "utf8");
  assert.match(service, /Environment=REPORT_ONLY=YES/);
  assert.match(service, /Environment=REVENUE_WALLET=0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614/);
  assert.match(service, /Environment=START_BLOCK=48876000/);
  assert.match(service, /Environment=TRACKED_COSTS_USDC=1\.011/);
  assert.doesNotMatch(service, /run-audited-monitor/);
});
