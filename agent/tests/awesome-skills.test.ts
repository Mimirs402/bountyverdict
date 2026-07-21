import assert from "node:assert/strict";
import test from "node:test";
import {
  AWESOME_SKILLS_DESCRIPTION,
  AWESOME_SKILLS_INSTALL_URL,
  AWESOME_SKILLS_MAX_PAGE_BYTES,
  AWESOME_SKILLS_SOURCE_URL,
  AWESOME_SKILLS_URL,
  parseAwesomeSkillsPage,
} from "../src/awesome-skills.ts";

const exactPage = `
<link rel="canonical" href="${AWESOME_SKILLS_URL}" />
<h1>route-github-agent-decisions</h1>
<p>${AWESOME_SKILLS_DESCRIPTION}</p>
<a href="${AWESOME_SKILLS_SOURCE_URL}">source</a>
<code>npx skills add ${AWESOME_SKILLS_INSTALL_URL}</code>
<p>https://bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=agent-skills-marketplace</p>
<p>io.github.Mimirs402/bountyverdict/http-payment-handoff</p>
<p>check_github_bounty rank_github_bounties audit_agent_harness diagnose_github_actions_run classify_github_actions_flake check_mcp_tool_drift</p>`;

test("verifies the exact Awesome Skills adapter contract", () => {
  assert.deepEqual(parseAwesomeSkillsPage(exactPage), {
    listed: true,
    contract_verified: true,
    expected_tools: 6,
    listed_tools: 6,
    install_command_verified: true,
    source_verified: true,
    description_verified: true,
  });
});

test("separates a listing shell from a complete payable adapter", () => {
  const result = parseAwesomeSkillsPage(exactPage.replace("check_mcp_tool_drift", "unknown_tool"));
  assert.equal(result.listed, true);
  assert.equal(result.contract_verified, false);
  assert.equal(result.listed_tools, 5);
});

test("rejects malformed and unbounded Awesome Skills pages", () => {
  assert.throws(() => parseAwesomeSkillsPage(null), /malformed/);
  assert.throws(() => parseAwesomeSkillsPage("x".repeat(AWESOME_SKILLS_MAX_PAGE_BYTES + 1)), /unbounded/);
});
