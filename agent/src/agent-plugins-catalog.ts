const MEASUREMENT = "catalog_presence_and_quality_metadata_not_impressions_installs_or_purchases";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type AgentPluginsCatalogOptions = {
  catalogUrl: string;
  publicUrl: string;
  repository: string;
  publishedSkills: readonly string[];
  previousStatus?: Record<string, unknown>;
  observedAt: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
};

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function lastKnownStatus(
  previousStatus: Record<string, unknown>,
  expectedSkills: number,
): Record<string, unknown> {
  const listedSkills = Number.isSafeInteger(previousStatus.listed_skills) &&
    Number(previousStatus.listed_skills) >= 0 && Number(previousStatus.listed_skills) <= expectedSkills
    ? Number(previousStatus.listed_skills)
    : null;
  const totalCatalogSkills = Number.isSafeInteger(previousStatus.total_catalog_skills) &&
    Number(previousStatus.total_catalog_skills) >= 0
    ? Number(previousStatus.total_catalog_skills)
    : null;
  const listed = typeof previousStatus.listed === "boolean" && listedSkills !== null
    ? previousStatus.listed
    : null;
  return {
    listed,
    listed_skills: listedSkills,
    total_catalog_skills: totalCatalogSkills,
    generated_at: typeof previousStatus.generated_at === "string" ? previousStatus.generated_at : null,
    skills: Array.isArray(previousStatus.skills) ? previousStatus.skills : null,
    last_success_at: typeof previousStatus.last_success_at === "string"
      ? previousStatus.last_success_at
      : null,
  };
}

function failureStatus(
  options: AgentPluginsCatalogOptions,
  status: "request_failed" | "contract_drift",
  error: unknown,
  httpStatus?: number,
): Record<string, unknown> {
  return {
    url: options.publicUrl,
    catalog_url: options.catalogUrl,
    checked_at: options.observedAt,
    available: status === "contract_drift",
    stale: true,
    contract_verified: false,
    ...lastKnownStatus(options.previousStatus || {}, options.publishedSkills.length),
    expected_skills: options.publishedSkills.length,
    status,
    ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
    error: errorMessage(error),
    measurement: MEASUREMENT,
  };
}

function parseCatalog(
  payload: unknown,
  repository: string,
  publishedSkills: readonly string[],
): {
  listed: boolean;
  listedSkills: number;
  totalCatalogSkills: number;
  generatedAt: string | null;
  skills: Array<Record<string, unknown>>;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Agent Plugins catalog returned malformed telemetry.");
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.skills) || !record.providers || typeof record.providers !== "object" ||
    Array.isArray(record.providers) || !Number.isSafeInteger(record.total_skills) ||
    Number(record.total_skills) !== record.skills.length) {
    throw new Error("Agent Plugins catalog returned malformed telemetry.");
  }
  const matching = (record.skills as Array<Record<string, any>>).filter((skill) =>
    skill?.source?.repo === repository && publishedSkills.includes(skill.name));
  const names = matching.map(({ name }) => name as string);
  if (new Set(names).size !== names.length) {
    throw new Error("Agent Plugins catalog duplicated a published BountyVerdict skill.");
  }
  const matchedNames = new Set(names);
  return {
    listed: publishedSkills.every((name) => matchedNames.has(name)),
    listedSkills: matchedNames.size,
    totalCatalogSkills: record.skills.length,
    generatedAt: typeof record.generated_at === "string" ? record.generated_at : null,
    skills: matching.map(({ id, name, quality_score, maintenance_status }) => ({
      id,
      name,
      quality_score,
      maintenance_status,
    })),
  };
}

export async function readAgentPluginsCatalogStatus(
  options: AgentPluginsCatalogOptions,
): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl || fetch;
  let response: Response;
  try {
    response = await fetchImpl(options.catalogUrl, {
      headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    return failureStatus(options, "request_failed", error);
  }
  if (!response.ok) {
    return failureStatus(
      options,
      "request_failed",
      new Error(`Agent Plugins catalog returned HTTP ${response.status}.`),
      response.status,
    );
  }
  let parsed;
  try {
    parsed = parseCatalog(await response.json(), options.repository, options.publishedSkills);
  } catch (error) {
    return failureStatus(options, "contract_drift", error, response.status);
  }
  const status = parsed.listed ? "listed" : parsed.listedSkills > 0 ? "partial_listing" : "not_listed";
  return {
    url: options.publicUrl,
    catalog_url: options.catalogUrl,
    checked_at: options.observedAt,
    available: true,
    stale: false,
    contract_verified: true,
    listed: parsed.listed,
    listed_skills: parsed.listedSkills,
    expected_skills: options.publishedSkills.length,
    total_catalog_skills: parsed.totalCatalogSkills,
    generated_at: parsed.generatedAt,
    skills: parsed.skills,
    last_success_at: options.observedAt,
    status,
    http_status: response.status,
    measurement: MEASUREMENT,
  };
}
