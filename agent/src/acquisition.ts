export const PUBLISHED_SKILLS = Object.freeze([
  "route-github-agent-checks",
  "audit-agent-harness",
  "check-mcp-tool-drift",
  "classify-github-flakes",
  "diagnose-github-actions",
  "preflight-agent-skills",
  "preflight-github-bounties",
] as const);

export type PublishedSkill = typeof PUBLISHED_SKILLS[number];

type AgentSkillEntry = {
  slug?: unknown;
  name?: unknown;
  skillName?: unknown;
  owner?: unknown;
  installCount?: unknown;
  githubStars?: unknown;
  score?: unknown;
  ratingCount?: unknown;
  securityScore?: unknown;
  contentQualityScore?: unknown;
  contentSha?: unknown;
  updatedAt?: unknown;
};

function optionalNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function publishedSkillFromAgentSkillEntry(entry: AgentSkillEntry): PublishedSkill | null {
  const candidates = [entry.slug, entry.skillName, entry.name]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  for (const skill of PUBLISHED_SKILLS) {
    if (candidates.some((candidate) =>
      candidate === skill || candidate.split(/[/:]/).includes(skill)
    )) return skill;
  }
  return null;
}

export function parseAgentSkillSearchPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("AgentSkill search payload is malformed.");
  }
  const document = payload as Record<string, unknown>;
  if (!Array.isArray(document.results) || !Number.isSafeInteger(document.total) || Number(document.total) < 0 ||
    typeof document.hasMore !== "boolean") {
    throw new Error("AgentSkill search telemetry is malformed.");
  }

  const bySkill = new Map<PublishedSkill, Record<string, unknown>>();
  for (const rawEntry of document.results) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as AgentSkillEntry;
    if (String(entry.owner || "").toLowerCase() !== "cristianmoroaica") continue;
    const skill = publishedSkillFromAgentSkillEntry(entry);
    if (!skill || bySkill.has(skill)) continue;
    const updatedAt = typeof entry.updatedAt === "string" && Number.isFinite(Date.parse(entry.updatedAt))
      ? entry.updatedAt
      : null;
    bySkill.set(skill, {
      skill,
      slug: typeof entry.slug === "string" ? entry.slug : null,
      install_count: optionalNonNegativeNumber(entry.installCount),
      github_stars: optionalNonNegativeNumber(entry.githubStars),
      score: optionalNonNegativeNumber(entry.score),
      rating_count: optionalNonNegativeNumber(entry.ratingCount),
      security_score: optionalNonNegativeNumber(entry.securityScore),
      content_quality_score: optionalNonNegativeNumber(entry.contentQualityScore),
      content_sha: typeof entry.contentSha === "string" && /^[a-f0-9]{7,64}$/i.test(entry.contentSha)
        ? entry.contentSha
        : null,
      updated_at: updatedAt,
    });
  }

  const skills = PUBLISHED_SKILLS.flatMap((skill) => {
    const entry = bySkill.get(skill);
    return entry ? [entry] : [];
  });
  const sumWhenComplete = (field: string): number | null => {
    if (skills.some((entry) => typeof entry[field] !== "number")) return skills.length === 0 ? 0 : null;
    return skills.reduce((sum, entry) => sum + Number(entry[field]), 0);
  };
  return {
    listed: skills.length === PUBLISHED_SKILLS.length,
    status: skills.length === PUBLISHED_SKILLS.length ? "listed" : skills.length ? "partial" : "not_indexed",
    listed_skills: skills.length,
    expected_skills: PUBLISHED_SKILLS.length,
    catalog_matches: Number(document.total),
    catalog_total_exact: document.totalExact === true,
    catalog_has_more: document.hasMore,
    total_installs: sumWhenComplete("install_count"),
    total_ratings: sumWhenComplete("rating_count"),
    skills,
  };
}

export const EARNED_PLACEMENT_BASELINE = Object.freeze({
  total_installs: 8,
  router_installs: 2,
  skillverdict_installs: 1,
  skillverdict_registry_queries: 0,
  non_target_registry_queries: 0,
  skillverdict_purchases: 0,
  other_purchases: 0,
});

const EARNED_PLACEMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type PlacementStatus = {
  status?: unknown;
  merged_at?: unknown;
  exposed_at?: unknown;
};

export type EarnedPlacementExperimentInput = {
  checked_at: string;
  healthy: boolean;
  persisted_started_at?: string;
  total_installs?: number;
  router_installs?: number;
  skillverdict_installs?: number;
  skillverdict_registry_queries?: number;
  non_target_registry_queries?: number;
  recognized_purchases?: readonly {
    product: string;
    settled_at: string;
  }[];
  placements: readonly PlacementStatus[];
};

function finiteCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function evaluateEarnedPlacementExperiment(input: EarnedPlacementExperimentInput) {
  const checkedAtMs = Date.parse(input.checked_at);
  if (!Number.isFinite(checkedAtMs)) throw new Error("Acquisition experiment checked_at is invalid.");

  const exposedAt = input.placements
    .filter((placement) => ["merged", "listed", "active"].includes(String(placement.status)))
    .map((placement) => placement.exposed_at ?? placement.merged_at)
    .filter((value): value is string => typeof value === "string")
    .map(String)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const startedAt = input.persisted_started_at || exposedAt[0] || null;
  const startedAtMs = startedAt ? Date.parse(startedAt) : null;
  if (startedAt && !Number.isFinite(startedAtMs)) {
    throw new Error("Acquisition experiment persisted start is invalid.");
  }
  if (startedAtMs !== null && startedAtMs > checkedAtMs) {
    throw new Error("Acquisition experiment start is in the future.");
  }
  const endsAt = startedAtMs === null
    ? null
    : new Date(startedAtMs + EARNED_PLACEMENT_WINDOW_MS).toISOString();
  const elapsedMs = startedAtMs === null ? 0 : Math.max(0, checkedAtMs - startedAtMs);

  const totalInstalls = finiteCount(input.total_installs);
  const routerInstalls = finiteCount(input.router_installs);
  const skillverdictInstalls = finiteCount(input.skillverdict_installs);
  const skillverdictRegistryQueries = finiteCount(input.skillverdict_registry_queries);
  const nonTargetRegistryQueries = finiteCount(input.non_target_registry_queries);
  const installDeltas = {
    total: totalInstalls === null ? null : totalInstalls - EARNED_PLACEMENT_BASELINE.total_installs,
    router: routerInstalls === null ? null : routerInstalls - EARNED_PLACEMENT_BASELINE.router_installs,
    skillverdict: skillverdictInstalls === null
      ? null
      : skillverdictInstalls - EARNED_PLACEMENT_BASELINE.skillverdict_installs,
  };
  const purchaseEvents = Array.isArray(input.recognized_purchases) ? input.recognized_purchases : null;
  const purchaseMeasurementValid = purchaseEvents !== null && purchaseEvents.every((purchase) =>
    typeof purchase.product === "string" &&
    typeof purchase.settled_at === "string" &&
    Number.isFinite(Date.parse(purchase.settled_at))
  );
  const inWindowPurchases = purchaseMeasurementValid && startedAtMs !== null
    ? purchaseEvents.filter((purchase) => {
        const settledAt = Date.parse(purchase.settled_at);
        return settledAt >= startedAtMs && settledAt <= startedAtMs + EARNED_PLACEMENT_WINDOW_MS;
      })
    : [];
  const targetPurchases = inWindowPurchases.filter((purchase) => purchase.product === "skill").length;
  const otherPurchases = inWindowPurchases.length - targetPurchases;
  const primarySuccess = targetPurchases >= 1;
  const commercialSuccess = inWindowPurchases.length >= 1;
  const supportingSuccess = (installDeltas.router ?? 0) >= 1 || (installDeltas.skillverdict ?? 0) >= 1;
  const windowComplete = startedAtMs !== null && elapsedMs >= EARNED_PLACEMENT_WINDOW_MS;
  const installMeasurementValid = Object.values(installDeltas).every((value) => value !== null && value >= 0);
  const registryMeasurementValid = skillverdictRegistryQueries !== null && nonTargetRegistryQueries !== null;
  const measurementValid = installMeasurementValid && registryMeasurementValid && purchaseMeasurementValid;
  const targetedInstallDelta = Math.max(installDeltas.router ?? 0, installDeltas.skillverdict ?? 0);
  const nonTargetInstallDelta = installDeltas.total === null
    ? 0
    : installDeltas.total - Math.max(0, installDeltas.router ?? 0) - Math.max(0, installDeltas.skillverdict ?? 0);
  const status = startedAtMs === null
    ? "awaiting_placement"
    : !windowComplete
      ? "running"
      : !input.healthy || !measurementValid
        ? "inconclusive_measurement"
        : targetPurchases >= 1
          ? "target_purchase_success"
          : otherPurchases >= 1
            ? "off_target_purchase_success"
            : targetedInstallDelta >= 1
              ? "install_to_purchase_failure"
              : (skillverdictRegistryQueries ?? 0) >= 1
                ? "listing_to_install_failure"
                : nonTargetInstallDelta >= 1 || (nonTargetRegistryQueries ?? 0) >= 1
                  ? "off_target_reach"
                  : "reach_failure";
  const nextAction = !input.healthy
    ? {
        code: "restore_distribution_health",
        reason: "Production or acquisition monitoring is degraded, so conversion evidence is not trustworthy.",
      }
    : !measurementValid
      ? {
          code: "restore_acquisition_measurement",
          reason: "Purchase, registry-query, or install telemetry is unavailable or moved below the fixed baseline.",
        }
      : status === "awaiting_placement"
        ? {
            code: "secure_verified_placement",
            reason: "No public directory placement has exposed the experiment yet.",
          }
        : status === "running"
          ? {
              code: "hold_experiment_constant",
              reason: "The seven-day exposure window is still running; changing price or positioning would contaminate it.",
            }
          : status === "target_purchase_success"
            ? { code: "scale_proven_distribution", reason: "SkillVerdict produced a genuine in-window purchase." }
            : status === "off_target_purchase_success"
              ? { code: "scale_purchased_product", reason: "Another product produced a genuine in-window purchase; scale that product's path." }
              : status === "install_to_purchase_failure"
                ? { code: "test_purchase_friction", reason: "Targeted installs increased but no SkillVerdict purchase followed." }
                : status === "listing_to_install_failure"
                  ? { code: "improve_listing_conversion", reason: "SkillVerdict registry queries increased but targeted installs did not." }
                  : status === "off_target_reach"
                    ? { code: "focus_reached_product", reason: "Only non-target products gained measurable discovery or install activity." }
                    : { code: "expand_earned_reach", reason: "The full exposure window ended without target queries, installs, or purchases." };

  return {
    name: "skillverdict_earned_directory_placement",
    status,
    baseline: EARNED_PLACEMENT_BASELINE,
    started_at: startedAt,
    ends_at: endsAt,
    elapsed_hours: Math.round(elapsedMs / (60 * 60 * 1000)),
    window_days: 7,
    current: {
      total_installs: totalInstalls,
      router_installs: routerInstalls,
      skillverdict_installs: skillverdictInstalls,
      skillverdict_registry_queries: skillverdictRegistryQueries,
      non_target_registry_queries: nonTargetRegistryQueries,
      skillverdict_purchases: targetPurchases,
      other_purchases: otherPurchases,
      genuine_purchases: inWindowPurchases.length,
    },
    delta: {
      installs: installDeltas,
      skillverdict_purchases: targetPurchases,
      other_purchases: otherPurchases,
      genuine_purchases: inWindowPurchases.length,
    },
    primary_success: primarySuccess,
    commercial_success: commercialSuccess,
    supporting_success: supportingSuccess,
    measurement_valid: measurementValid,
    currently_healthy: input.healthy,
    next_action: nextAction,
    success_criteria: {
      primary: "At least one genuine non-owner purchase within seven full days of the first verified public directory placement.",
      supporting: "At least one new router or preflight-agent-skills install.",
      strong: "Both the primary and supporting criteria are met.",
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSkillsShInstallCounts(
  html: string,
  repository = "Mimirs402/bountyverdict",
): { total: number; by_skill: Record<PublishedSkill, number> } {
  const bySkill = {} as Record<PublishedSkill, number>;
  for (const skill of PUBLISHED_SKILLS) {
    const path = `/${repository}/${skill}`;
    const pattern = new RegExp(
      `href=["']${escapeRegExp(path)}["'](?:(?!</a>)[\\s\\S]){0,700}?<span[^>]*>([\\d,]+)</span>`,
    );
    const match = html.match(pattern);
    if (!match) throw new Error(`skills.sh did not expose an install count for ${skill}.`);
    const value = Number(match[1].replaceAll(",", ""));
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`skills.sh exposed an invalid install count for ${skill}.`);
    }
    bySkill[skill] = value;
  }
  return {
    total: Object.values(bySkill).reduce((sum, value) => sum + value, 0),
    by_skill: bySkill,
  };
}
