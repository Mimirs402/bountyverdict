export const AGENT_SKILLS_IN_REPOSITORY = "cristianmoroaica/bountyverdict-mcp-skill";
export const AGENT_SKILLS_IN_SKILL_NAME = "route-github-agent-decisions";
export const AGENT_SKILLS_IN_SCOPED_NAME = `@cristianmoroaica/${AGENT_SKILLS_IN_SKILL_NAME}`;
export const AGENT_SKILLS_IN_SKILL_PATH = `skills/${AGENT_SKILLS_IN_SKILL_NAME}/SKILL.md`;
export const AGENT_SKILLS_IN_GITHUB_URL =
  `https://github.com/${AGENT_SKILLS_IN_REPOSITORY}/tree/main/skills/${AGENT_SKILLS_IN_SKILL_NAME}`;

type SkillEntry = {
  name: string;
  author: string;
  githubUrl: string;
  scopedName: string | null;
  repoFullName: string | null;
  path: string | null;
  hasContent: boolean;
};

function boundedString(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > 2_000) throw new Error(`AgentSkills.in ${label} is malformed.`);
  return value;
}

function normalizeEntry(value: unknown): SkillEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AgentSkills.in returned a malformed skill entry.");
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.hasContent !== "boolean") throw new Error("AgentSkills.in content state is malformed.");
  for (const field of ["stars", "forks"]) {
    if (!Number.isSafeInteger(entry[field]) || Number(entry[field]) < 0) {
      throw new Error(`AgentSkills.in ${field} is malformed.`);
    }
  }
  if (entry.description !== null && typeof entry.description !== "string") {
    throw new Error("AgentSkills.in description is malformed.");
  }
  return {
    name: boundedString(entry.name, "name") as string,
    author: boundedString(entry.author, "author") as string,
    githubUrl: boundedString(entry.githubUrl, "GitHub URL") as string,
    scopedName: boundedString(entry.scopedName, "scoped name", true),
    repoFullName: boundedString(entry.repoFullName, "repository", true),
    path: boundedString(entry.path, "path", true),
    hasContent: entry.hasContent,
  };
}

export function parseAgentSkillsInSearchPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AgentSkills.in returned a malformed search payload.");
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.skills) || payload.skills.length > 20 ||
    !Number.isSafeInteger(payload.total) || Number(payload.total) < 0 ||
    !Number.isSafeInteger(payload.limit) || Number(payload.limit) < 1 || Number(payload.limit) > 100 ||
    !Number.isSafeInteger(payload.offset) || Number(payload.offset) < 0) {
    throw new Error("AgentSkills.in returned malformed or unbounded search telemetry.");
  }
  const entries = payload.skills.map(normalizeEntry);
  const repoEntries = entries.filter(({ repoFullName }) => repoFullName === AGENT_SKILLS_IN_REPOSITORY);
  const exact = repoEntries.filter((entry) =>
    entry.name === AGENT_SKILLS_IN_SKILL_NAME &&
    entry.author === "cristianmoroaica" &&
    entry.githubUrl === AGENT_SKILLS_IN_GITHUB_URL &&
    entry.scopedName === AGENT_SKILLS_IN_SCOPED_NAME &&
    entry.path === AGENT_SKILLS_IN_SKILL_PATH &&
    entry.hasContent === true
  );
  if (repoEntries.length > 1 || exact.length > 1) throw new Error("AgentSkills.in duplicated the adapter listing.");
  const listed = exact.length === 1;
  return {
    listed,
    listed_skills: listed ? 1 : 0,
    expected_skills: 1,
    catalog_total: Number(payload.total),
    status: listed ? "listed" : repoEntries.length ? "contract_drift" : "pending_indexing",
  };
}
