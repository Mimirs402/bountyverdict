type CountSummary = {
  count: number;
  uniques: number;
};

type DailyCount = CountSummary & {
  timestamp: string;
};

export type GitHubTrafficSnapshot = {
  available: true;
  repository: string;
  measurement_window: "github_rolling_14_days";
  views: CountSummary & { daily: DailyCount[] };
  clones: CountSummary & { daily: DailyCount[] };
  referrers: Array<CountSummary & { referrer: string }>;
  popular_paths: Array<CountSummary & { path: string; title: string }>;
  accounting_note: string;
  privacy_note: string;
};

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum || /[\r\n]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function countSummary(value: unknown, label: string): CountSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  const row = value as Record<string, unknown>;
  const summary = {
    count: nonNegativeInteger(row.count, `${label}.count`),
    uniques: nonNegativeInteger(row.uniques, `${label}.uniques`),
  };
  if (summary.uniques > summary.count) throw new Error(`${label}.uniques exceeds count.`);
  return summary;
}

function dailyCounts(value: unknown, label: string): DailyCount[] {
  if (!Array.isArray(value) || value.length > 14) throw new Error(`${label} is malformed.`);
  return value.map((entry, index) => {
    const summary = countSummary(entry, `${label}[${index}]`);
    const timestamp = boundedString(
      (entry as Record<string, unknown>).timestamp,
      `${label}[${index}].timestamp`,
      32,
    );
    if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`${label}[${index}].timestamp is invalid.`);
    return { timestamp, ...summary };
  });
}

function validateAggregate(summary: CountSummary, daily: DailyCount[], label: string): void {
  const dailyCount = daily.reduce((sum, row) => sum + row.count, 0);
  if (dailyCount !== summary.count) throw new Error(`${label}.count does not match its daily series.`);
}

export function parseGitHubTraffic(
  repository: string,
  payloads: {
    views: unknown;
    clones: unknown;
    referrers: unknown;
    popular_paths: unknown;
  },
): GitHubTrafficSnapshot {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GitHub repository is invalid.");
  }
  const views = countSummary(payloads.views, "views");
  const clones = countSummary(payloads.clones, "clones");
  const viewDaily = dailyCounts((payloads.views as Record<string, unknown>).views, "views.daily");
  const cloneDaily = dailyCounts((payloads.clones as Record<string, unknown>).clones, "clones.daily");
  validateAggregate(views, viewDaily, "views");
  validateAggregate(clones, cloneDaily, "clones");
  if (!Array.isArray(payloads.referrers) || payloads.referrers.length > 10) {
    throw new Error("referrers is malformed.");
  }
  if (!Array.isArray(payloads.popular_paths) || payloads.popular_paths.length > 10) {
    throw new Error("popular_paths is malformed.");
  }
  const referrers = payloads.referrers.map((entry, index) => ({
    referrer: boundedString(
      (entry as Record<string, unknown>)?.referrer,
      `referrers[${index}].referrer`,
      255,
    ),
    ...countSummary(entry, `referrers[${index}]`),
  }));
  const popularPaths = payloads.popular_paths.map((entry, index) => ({
    path: boundedString((entry as Record<string, unknown>)?.path, `popular_paths[${index}].path`, 1024),
    title: (entry as Record<string, unknown>)?.title === ""
      ? ""
      : boundedString((entry as Record<string, unknown>)?.title, `popular_paths[${index}].title`, 512),
    ...countSummary(entry, `popular_paths[${index}]`),
  }));
  return {
    available: true,
    repository,
    measurement_window: "github_rolling_14_days",
    views: { ...views, daily: viewDaily },
    clones: { ...clones, daily: cloneDaily },
    referrers,
    popular_paths: popularPaths,
    accounting_note: "Repository traffic is acquisition evidence only and is never counted as a purchase or revenue.",
    privacy_note: "GitHub supplies aggregate counts and popular referrers/paths; no visitor identity is collected or retained.",
  };
}
