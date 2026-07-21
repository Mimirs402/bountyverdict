import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const distributionUrl = new URL("../agent/scripts/distribution-monitor.ts", import.meta.url);
const auditedRunnerUrl = new URL("../agent/scripts/run-audited-monitor.ts", import.meta.url);
const directoryMonitorUrl = new URL("../agent/scripts/directory-monitor.ts", import.meta.url);
const acquisitionUrl = new URL("../agent/src/acquisition.ts", import.meta.url);

test("frequent reporting samples merchant activity without semantic retrieval while full audits establish a drain", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  const auditedRunner = await readFile(auditedRunnerUrl, "utf8");
  assert.match(distribution, /const reportOnly = process\.env\.REPORT_ONLY === "YES"/);
  assert.match(distribution, /if \(reportOnly\) \{[\s\S]+merchantDiscoveryStatus\(previousReport\.discovery \|\| \{\}, checkedAt\)[\s\S]+\} else \{\s+try \{\s+discovery = await discoveryStatus/);
  assert.match(distribution, /marketplace_search: previousReport\.acquisition\?\.marketplace_search/);
  assert.match(distribution, /agenticMarket = previousReport\.marketplaces\?\.agentic_market/);
  assert.match(auditedRunner, /FUNNEL_ROTATION_ID: rotationId/);
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
