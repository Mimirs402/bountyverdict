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

export const EARNED_PLACEMENT_BASELINE = Object.freeze({
  total_installs: 8,
  router_installs: 2,
  skillverdict_installs: 1,
  genuine_purchases: 0,
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
  genuine_purchases: number;
  total_installs?: number;
  router_installs?: number;
  skillverdict_installs?: number;
  placements: readonly PlacementStatus[];
};

function finiteCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function evaluateEarnedPlacementExperiment(input: EarnedPlacementExperimentInput) {
  const checkedAtMs = Date.parse(input.checked_at);
  if (!Number.isFinite(checkedAtMs)) throw new Error("Acquisition experiment checked_at is invalid.");
  const purchases = finiteCount(input.genuine_purchases);
  if (purchases === null) throw new Error("Acquisition experiment purchase count is invalid.");

  const exposedAt = input.placements
    .filter((placement) => ["merged", "listed", "active"].includes(String(placement.status)))
    .map((placement) => placement.exposed_at ?? placement.merged_at)
    .filter((value): value is string => typeof value === "string")
    .map(String)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const startedAt = exposedAt[0] || null;
  const startedAtMs = startedAt ? Date.parse(startedAt) : null;
  const endsAt = startedAtMs === null
    ? null
    : new Date(startedAtMs + EARNED_PLACEMENT_WINDOW_MS).toISOString();
  const elapsedMs = startedAtMs === null ? 0 : Math.max(0, checkedAtMs - startedAtMs);

  const totalInstalls = finiteCount(input.total_installs);
  const routerInstalls = finiteCount(input.router_installs);
  const skillverdictInstalls = finiteCount(input.skillverdict_installs);
  const installDeltas = {
    total: totalInstalls === null ? null : totalInstalls - EARNED_PLACEMENT_BASELINE.total_installs,
    router: routerInstalls === null ? null : routerInstalls - EARNED_PLACEMENT_BASELINE.router_installs,
    skillverdict: skillverdictInstalls === null
      ? null
      : skillverdictInstalls - EARNED_PLACEMENT_BASELINE.skillverdict_installs,
  };
  const purchaseDelta = purchases - EARNED_PLACEMENT_BASELINE.genuine_purchases;
  const primarySuccess = purchaseDelta >= 1;
  const supportingSuccess = (installDeltas.router ?? 0) >= 1 || (installDeltas.skillverdict ?? 0) >= 1;
  const windowComplete = startedAtMs !== null && elapsedMs >= EARNED_PLACEMENT_WINDOW_MS;
  const status = startedAtMs === null
    ? "awaiting_placement"
    : primarySuccess && supportingSuccess
      ? "strong_success"
      : primarySuccess
        ? "primary_success"
        : windowComplete
          ? "failed_no_purchase"
          : "running";

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
      genuine_purchases: purchases,
    },
    delta: {
      installs: installDeltas,
      genuine_purchases: purchaseDelta,
    },
    primary_success: primarySuccess,
    supporting_success: supportingSuccess,
    currently_healthy: input.healthy,
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
  repository = "cristianmoroaica/bountyverdict",
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
