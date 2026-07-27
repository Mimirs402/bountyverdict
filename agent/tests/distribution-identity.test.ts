import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directoryMonitorUrl = new URL("../scripts/directory-monitor.ts", import.meta.url);
const distributionMonitorUrl = new URL("../scripts/distribution-monitor.ts", import.meta.url);

test("directory monitoring treats only business-owned records as canonical distribution", async () => {
  const source = await readFile(directoryMonitorUrl, "utf8");

  assert.match(source, /const mcpRepositoryUrl = "https:\/\/mcprepository\.com\/Mimirs402\/bountyverdict"/);
  assert.match(source, /const mcpObservatoryServerId = "github:Mimirs402\/bountyverdict"/);
  assert.match(source, /const agentageSlug = "io-github-mimirs402-bountyverdict"/);
  assert.match(source, /author=Mimirs402&limit=20/);
  assert.match(source, /marketplace\/%40Mimirs402\/route-github-agent-decisions/);
  assert.match(source, /const mcpServersOrgListingUrl = "https:\/\/mcpservers\.org\/servers\/Mimirs402\/bountyverdict"/);
  assert.match(source, /const toolsForAgentsListingUrl = "https:\/\/www\.toolsforagents\.dev\/tools\/Mimirs402\/bountyverdict"/);

  assert.match(source, /mcp_repository_legacy: mcpRepositoryLegacy/);
  assert.match(source, /mcp_servers_org_legacy: mcpServersOrgLegacy/);
  assert.match(source, /canonical_business_distribution: false/);
  assert.match(source, /excluded_from_acquisition: true/);
  assert.match(source, /const legacyPersonalRecord = monitor === askillLegacyMonitor/);
});

test("distribution reports retain legacy records only as excluded migration evidence", async () => {
  const source = await readFile(distributionMonitorUrl, "utf8");

  assert.match(source, /mcp_repository_legacy: state\.mcp_repository_legacy \|\| null/);
  assert.match(source, /mcp_servers_org_legacy: state\.mcp_servers_org_legacy \|\| null/);
  assert.match(source, /always excluded from canonical distribution, demand, purchases, and revenue/);
  assert.match(source, /Legacy personal askill adapter/);
  assert.match(source, /Canonical askill adapter/);
  assert.doesNotMatch(source, /mcpservers\.org\/servers\/cristianmoroaica\/bountyverdict/);
  assert.doesNotMatch(source, /toolsforagents\.dev\/tools\/cristianmoroaica\/bountyverdict/);
});
