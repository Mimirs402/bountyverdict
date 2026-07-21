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

test("frequent reporting samples merchant activity without semantic retrieval while full audits establish a drain", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  const auditedRunner = await readFile(auditedRunnerUrl, "utf8");
  assert.match(distribution, /const reportOnly = configuration\.reportOnly/);
  assert.match(distribution, /if \(reportOnly\) \{[\s\S]+merchantDiscoveryStatus\(previousReport\.discovery \|\| \{\}, checkedAt\)[\s\S]+\} else \{\s+try \{\s+discovery = await discoveryStatus/);
  assert.match(distribution, /marketplace_search: previousReport\.acquisition\?\.marketplace_search/);
  assert.match(distribution, /agenticMarket = previousReport\.marketplaces\?\.agentic_market/);
  assert.match(auditedRunner, /FUNNEL_ROTATION_ID: rotationId/);
  assert.match(auditedRunner, /if \(monitor === "distribution"\) loadDistributionMonitorConfiguration\(process\.env\)/);
  assert.match(auditedRunner, /if \(monitor === "directory"\).*directory-monitor/s);
  assert.match(auditedRunner, /else await import\("\.\/distribution-monitor\.ts"\)/);
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

test("distribution monitoring treats Payan demand state as a funnel and receipts as settlement attribution", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(distribution, /async function payanDemandStatus/);
  assert.match(distribution, /exact_fit_request_bids_and_fulfillment_state_not_settlement_or_revenue_by_itself/);
  assert.match(distribution, /delivered_request_sales/);
  assert.match(distribution, /\["direct", "escrow_release"\]/);
  assert.match(distribution, /Payan exact-fit demand capture/);
});

test("directory monitoring separates Awesome Copilot review and catalog presence from demand", async () => {
  const directory = await readFile(directoryMonitorUrl, "utf8");
  const distribution = await readFile(distributionUrl, "utf8");
  assert.match(directory, /async function awesomeCopilotStatus/);
  assert.match(directory, /submission_review_and_default_catalog_presence_not_impressions_installs_or_purchases/);
  assert.match(directory, /issues\/2369/);
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

test("public demand monitoring is scheduled read-only and excluded from commerce accounting", async () => {
  const [distribution, watcher, service] = await Promise.all([
    readFile(distributionUrl, "utf8"),
    readFile(demandWatchUrl, "utf8"),
    readFile(demandServiceUrl, "utf8"),
  ]);
  assert.match(watcher, /read_only: true/);
  assert.match(watcher, /actions_enabled: false/);
  assert.match(watcher, /acquisition evidence only; they are never purchases, settlements, or revenue/);
  assert.doesNotMatch(watcher, /Authorization|api[_-]?key|place_bid|accept_job/i);
  assert.match(distribution, /async function publicDemandStatus/);
  assert.match(distribution, /state\.read_only !== true \|\| state\.actions_enabled !== false/);
  assert.match(distribution, /public_inventory_and_exact_fit_acquisition_evidence_never_purchase_or_revenue/);
  assert.match(distribution, /Public funded-demand watcher/);
  assert.doesNotMatch(service, /EnvironmentFile/);
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
  assert.match(service, /Environment=TRACKED_COSTS_USDC=1\.01/);
  assert.doesNotMatch(service, /run-audited-monitor/);
});
