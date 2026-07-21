export const ASKILL_REPOSITORY = "cristianmoroaica/bountyverdict-mcp-skill";
export const ASKILL_OWNER = "cristianmoroaica";
export const ASKILL_REPO = "bountyverdict-mcp-skill";
export const ASKILL_SKILL_NAME = "route-github-agent-decisions";
export const ASKILL_PATH = `skills/${ASKILL_SKILL_NAME}`;
export const ASKILL_FILE_PATH = `${ASKILL_PATH}/SKILL.md`;
export const ASKILL_INSTALL_REF = `gh:${ASKILL_REPOSITORY}@${ASKILL_SKILL_NAME}`;
export const ASKILL_BUYER_LANGUAGE_DESCRIPTION =
  "Diagnose why a GitHub Actions run failed and find its root cause; decide whether to retry that failed Action once; check or rank GitHub bounties; audit AGENTS.md readiness; detect MCP schema drift.";
export const ASKILL_REQUIRED_ADAPTER_REVISION_PUSHED_AT = "2026-07-21T15:51:34.000Z";
export const ASKILL_DEDICATED_REPOSITORY = "Mimirs402/bountyverdict-mcp-skill";
export const ASKILL_DEDICATED_OWNER = "Mimirs402";
export const ASKILL_DEDICATED_INSTALL_REF =
  `gh:${ASKILL_DEDICATED_REPOSITORY}@${ASKILL_SKILL_NAME}`;
export const ASKILL_DEDICATED_REQUIRED_ADAPTER_REVISION_PUSHED_AT = "2026-07-21T21:37:35.000Z";
export const ASKILL_BUYER_QUERIES = Object.freeze([
  "github actions root cause",
  "should I retry failed github action",
  "check github bounty",
  "audit AGENTS.md",
  "MCP schema drift",
  "rank github bounties",
  "is this github bounty worth working on",
  "which github bounty should i work on",
  "is this repo ready for a coding agent",
  "why did my github actions run fail",
  "should i retry this failed github actions run",
  "will this mcp tools/list change break clients",
] as const);

export type AskillBuyerQueryResult = {
  found: boolean;
  rank: number | null;
  returned_results: number;
};

export type AskillIdentity = Readonly<{
  owner: string;
  repo: string;
  installRef: string;
  requiredAdapterRevisionPushedAt: string;
}>;

export const ASKILL_LEGACY_IDENTITY: AskillIdentity = Object.freeze({
  owner: ASKILL_OWNER,
  repo: ASKILL_REPO,
  installRef: ASKILL_INSTALL_REF,
  requiredAdapterRevisionPushedAt: ASKILL_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
});

export const ASKILL_DEDICATED_IDENTITY: AskillIdentity = Object.freeze({
  owner: ASKILL_DEDICATED_OWNER,
  repo: ASKILL_REPO,
  installRef: ASKILL_DEDICATED_INSTALL_REF,
  requiredAdapterRevisionPushedAt: ASKILL_DEDICATED_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
});

function boundedString(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`askill ${label} is malformed.`);
  }
  return value;
}

function counter(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`askill ${label} is malformed.`);
  return Number(value);
}

function optionalScore(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`askill ${label} is malformed.`);
  }
  return value;
}

export function parseAskillSearchPayload(
  value: unknown,
  identity: AskillIdentity = ASKILL_LEGACY_IDENTITY,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("askill returned a malformed search payload.");
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.data) || payload.data.length > 100 ||
    !payload.pagination || typeof payload.pagination !== "object" || Array.isArray(payload.pagination)) {
    throw new Error("askill returned malformed or unbounded search telemetry.");
  }
  const pagination = payload.pagination as Record<string, unknown>;
  if (counter(pagination.page, "page") !== 1 || counter(pagination.limit, "limit") > 100 ||
    counter(pagination.total, "catalog total") < payload.data.length || typeof pagination.hasMore !== "boolean") {
    throw new Error("askill pagination is malformed or unbounded.");
  }

  const repositoryEntries = payload.data.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("askill returned a malformed skill entry.");
    }
    const entry = value as Record<string, unknown>;
    return entry.repoOwner === identity.owner && entry.repoName === identity.repo;
  }) as Array<Record<string, unknown>>;
  if (repositoryEntries.length > 1) throw new Error("askill duplicated the adapter listing.");

  const entry = repositoryEntries[0];
  if (!entry) {
    return {
      listed: false,
      listed_skills: 0,
      expected_skills: 1,
      catalog_total: Number(pagination.total),
      status: "not_indexed",
    };
  }
  if (!Array.isArray(entry.tags) || entry.tags.length > 50 ||
    entry.tags.some((tag) => typeof tag !== "string" || tag.length === 0 || tag.length > 100)) {
    throw new Error("askill tags are malformed or unbounded.");
  }
  const exact = boundedString(entry.name, "name", 200) === ASKILL_SKILL_NAME &&
    boundedString(entry.skillName, "skill name", 200) === ASKILL_SKILL_NAME &&
    boundedString(entry.installRef, "install reference", 500) === identity.installRef &&
    boundedString(entry.path, "path", 500) === ASKILL_PATH &&
    boundedString(entry.filePath, "file path", 500) === ASKILL_FILE_PATH &&
    entry.nameUniqueInRepo === true && entry.source === "submit";
  if (!exact) {
    return {
      listed: false,
      listed_skills: 0,
      expected_skills: 1,
      catalog_total: Number(pagination.total),
      status: "contract_drift",
    };
  }
  const id = counter(entry.id, "entry ID");
  const description = boundedString(entry.description, "description", 2_000);
  const updatedAt = boundedString(entry.updatedAt, "updated timestamp", 64);
  const lastPushed = boundedString(entry.lastPushed, "last-pushed timestamp", 64);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("askill updated timestamp is malformed.");
  if (!Number.isFinite(Date.parse(lastPushed))) throw new Error("askill last-pushed timestamp is malformed.");
  const buyerLanguageRevisionLive = description === ASKILL_BUYER_LANGUAGE_DESCRIPTION;
  const adapterRevisionLive = Date.parse(lastPushed) >= Date.parse(identity.requiredAdapterRevisionPushedAt);
  return {
    listed: true,
    listed_skills: 1,
    expected_skills: 1,
    catalog_total: Number(pagination.total),
    entry_id: id,
    listing_url: `https://askill.sh/skills/${id}`,
    install_source: identity.installRef,
    favorites: counter(entry.favoriteCount, "favorite count"),
    repository_stars: counter(entry.stars, "repository stars"),
    ai_score: optionalScore(entry.aiScore, "AI score"),
    llm_score: optionalScore(entry.llmScore, "LLM score"),
    tags: [...entry.tags] as string[],
    updated_at: updatedAt,
    last_pushed: lastPushed,
    buyer_language_revision_live: buyerLanguageRevisionLive,
    adapter_revision_live: adapterRevisionLive,
    required_adapter_revision_pushed_at: identity.requiredAdapterRevisionPushedAt,
    status: buyerLanguageRevisionLive && adapterRevisionLive ? "listed" : "listed_pending_content_refresh",
  };
}

export function parseAskillBuyerQueryPayload(
  value: unknown,
  identity: AskillIdentity = ASKILL_LEGACY_IDENTITY,
): AskillBuyerQueryResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("askill returned a malformed buyer-query payload.");
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.data) || payload.data.length > 100 ||
    !payload.pagination || typeof payload.pagination !== "object" || Array.isArray(payload.pagination)) {
    throw new Error("askill returned malformed or unbounded buyer-query telemetry.");
  }
  const pagination = payload.pagination as Record<string, unknown>;
  if (counter(pagination.page, "buyer-query page") !== 1 || counter(pagination.limit, "buyer-query limit") > 100 ||
    counter(pagination.total, "buyer-query catalog total") < payload.data.length || typeof pagination.hasMore !== "boolean") {
    throw new Error("askill buyer-query pagination is malformed or unbounded.");
  }
  const matches: number[] = [];
  payload.data.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("askill returned a malformed buyer-query entry.");
    }
    const entry = value as Record<string, unknown>;
    if (entry.installRef === identity.installRef) {
      if (entry.repoOwner !== identity.owner || entry.repoName !== identity.repo || entry.name !== ASKILL_SKILL_NAME ||
        entry.path !== ASKILL_PATH || entry.filePath !== ASKILL_FILE_PATH) {
        throw new Error("askill buyer-query target contract drifted.");
      }
      matches.push(index + 1);
    }
  });
  if (matches.length > 1) throw new Error("askill duplicated the buyer-query target.");
  return {
    found: matches.length === 1,
    rank: matches[0] || null,
    returned_results: payload.data.length,
  };
}
