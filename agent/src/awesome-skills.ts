export const AWESOME_SKILLS_SLUG = "bountyverdict-mcp-skill-route-github-agent-decisions";
export const AWESOME_SKILLS_URL =
  `https://www.awesomeskills.dev/en/skill/${AWESOME_SKILLS_SLUG}`;
export const AWESOME_SKILLS_SOURCE_URL =
  "https://github.com/Mimirs402/bountyverdict-mcp-skill/blob/main/skills/route-github-agent-decisions/SKILL.md";
export const AWESOME_SKILLS_INSTALL_URL =
  "https://github.com/Mimirs402/bountyverdict-mcp-skill/tree/main/skills/route-github-agent-decisions";
export const AWESOME_SKILLS_DESCRIPTION =
  "Diagnose why a GitHub Actions run failed and find its root cause; decide whether to retry that failed Action once; check or rank GitHub bounties; audit AGENTS.md readiness; detect MCP schema drift.";
export const AWESOME_SKILLS_MAX_PAGE_BYTES = 2 * 1024 * 1024;

const EXPECTED_TOOLS = Object.freeze([
  "check_github_bounty",
  "rank_github_bounties",
  "audit_agent_harness",
  "diagnose_github_actions_run",
  "classify_github_actions_flake",
  "check_mcp_tool_drift",
]);

export type AwesomeSkillsPage = {
  listed: boolean;
  contract_verified: boolean;
  expected_tools: number;
  listed_tools: number;
  install_command_verified: boolean;
  source_verified: boolean;
  description_verified: boolean;
};

export function parseAwesomeSkillsPage(value: unknown): AwesomeSkillsPage {
  if (typeof value !== "string" || value.length === 0 ||
    new TextEncoder().encode(value).byteLength > AWESOME_SKILLS_MAX_PAGE_BYTES) {
    throw new Error("Awesome Skills page is malformed or unbounded.");
  }
  const listed = value.includes(`rel="canonical" href="${AWESOME_SKILLS_URL}"`) &&
    value.includes(">route-github-agent-decisions</h1>");
  const sourceVerified = value.includes(AWESOME_SKILLS_SOURCE_URL);
  const installCommandVerified = value.includes(`npx skills add ${AWESOME_SKILLS_INSTALL_URL}`);
  const descriptionVerified = value.includes(AWESOME_SKILLS_DESCRIPTION);
  const listedTools = EXPECTED_TOOLS.filter((tool) => value.includes(tool)).length;
  const contractVerified = listed && sourceVerified && installCommandVerified &&
    descriptionVerified && listedTools === EXPECTED_TOOLS.length &&
    value.includes("https://bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=agent-skills-marketplace") &&
    value.includes("io.github.Mimirs402/bountyverdict/http-payment-handoff");
  return {
    listed,
    contract_verified: contractVerified,
    expected_tools: EXPECTED_TOOLS.length,
    listed_tools: listedTools,
    install_command_verified: installCommandVerified,
    source_verified: sourceVerified,
    description_verified: descriptionVerified,
  };
}
