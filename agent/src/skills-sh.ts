export const SKILLS_SH_DEDICATED_SOURCE = "Mimirs402/bountyverdict-mcp-skill";
export const SKILLS_SH_DEDICATED_SKILL = "route-github-agent-decisions";
export const SKILLS_SH_DEDICATED_ID = `${SKILLS_SH_DEDICATED_SOURCE}/${SKILLS_SH_DEDICATED_SKILL}`;

export type SkillsShSearchResult = {
  found: boolean;
  rank: number | null;
  returned_results: number;
  catalog_matches: number;
};

export function parseSkillsShSearchPayload(
  value: unknown,
  expectedId = SKILLS_SH_DEDICATED_ID,
  expectedSource = SKILLS_SH_DEDICATED_SOURCE,
): SkillsShSearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("skills.sh search payload is malformed.");
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.skills) || payload.skills.length > 100 ||
    !Number.isSafeInteger(payload.count) || Number(payload.count) < payload.skills.length) {
    throw new Error("skills.sh search telemetry is malformed or unbounded.");
  }
  if (typeof expectedId !== "string" || expectedId.length === 0 || expectedId.length > 500) {
    throw new Error("skills.sh expected identity is malformed.");
  }
  if (typeof expectedSource !== "string" || expectedSource.length === 0 || expectedSource.length > 500) {
    throw new Error("skills.sh expected source is malformed.");
  }

  const normalizedExpected = expectedId.toLowerCase();
  const normalizedSource = expectedSource.toLowerCase();
  const matches: number[] = [];
  payload.skills.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("skills.sh search entry is malformed.");
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || entry.id.length === 0 || entry.id.length > 500 ||
      typeof entry.source !== "string" || entry.source.length === 0 || entry.source.length > 500) {
      throw new Error("skills.sh search entry identity is malformed.");
    }
    if (entry.id.toLowerCase() === normalizedExpected) {
      if (entry.source.toLowerCase() !== normalizedSource) {
        throw new Error("skills.sh dedicated adapter source drifted.");
      }
      matches.push(index);
    }
  });
  if (matches.length > 1) throw new Error("skills.sh duplicated the dedicated adapter.");

  return {
    found: matches.length === 1,
    rank: matches.length === 1 ? matches[0] + 1 : null,
    returned_results: payload.skills.length,
    catalog_matches: Number(payload.count),
  };
}
