const LIGHTNING_BOUNTIES_URL = "https://app.lightningbounties.com/";
const LIGHTNING_BOUNTIES_REWARDS_URL = new URL("api/rewards/", LIGHTNING_BOUNTIES_URL);
const LIGHTNING_BOUNTIES_MAX_RESPONSE_BYTES = 1_000_000;
const LIGHTNING_BOUNTIES_MAX_SCRIPTS = 256;
const LIGHTNING_BOUNTIES_MAX_RECORDS = 100;
const LIGHTNING_BOUNTIES_MAX_ROUTES = 8;
const RSC_PUSH = "self.__next_f.push(";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/;

type FetchLike = typeof fetch;

export type LightningBountiesIssueRoute = {
  owner: string;
  repo: string;
  number: number;
};

export type LightningBountiesEvidence = {
  platform: "Lightning Bounties";
  verification: "TRUSTED_PLATFORM_API";
  state: "OPEN" | "AWARDED";
  amount: number;
  secured_amount: number;
  reclaimable_amount: number;
  currency: "SATS";
  evidence_url: typeof LIGHTNING_BOUNTIES_URL;
};

type NormalizedRecord = {
  id: string;
  listing: LightningBountiesListing;
  fingerprint: string;
};

export type LightningBountiesListing = {
  platform_issue_id: string;
  state: "OPEN" | "AWARDED";
  total_rewards: number;
  total_reward_sats: number;
  unexpired_total_rewards: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validRoutes(routes: readonly LightningBountiesIssueRoute[]): boolean {
  if (!Array.isArray(routes) || routes.length < 1 || routes.length > LIGHTNING_BOUNTIES_MAX_ROUTES) return false;
  return routes.every((route) =>
    isRecord(route) &&
    typeof route.owner === "string" && route.owner.length > 0 &&
    route.owner.length <= 100 && REPOSITORY_PART.test(route.owner) &&
    typeof route.repo === "string" && route.repo.length > 0 &&
    route.repo.length <= 100 && REPOSITORY_PART.test(route.repo) &&
    Number.isSafeInteger(route.number) && Number(route.number) > 0
  );
}

function exactIssueRoute(
  value: unknown,
  routes: readonly LightningBountiesIssueRoute[],
): LightningBountiesIssueRoute | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port ||
      url.username || url.password || url.search || url.hash) return null;
  return routes.find((route) =>
    url.pathname.toLowerCase() === `/${route.owner}/${route.repo}/issues/${route.number}`.toLowerCase()
  ) ?? null;
}

function parseRscPushAt(
  source: string,
  markerStart: number,
): { chunk: string | null; next: number } | null {
  const start = markerStart + RSC_PUSH.length;
  if (source[start] !== "[") return null;

  let arrayDepth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
    } else if (character === "[") {
      arrayDepth += 1;
    } else if (character === "]") {
      arrayDepth -= 1;
      if (arrayDepth < 0) return null;
      if (arrayDepth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end < 0 || inString || arrayDepth !== 0) return null;
  let next = end;
  while (/\s/.test(source[next] || "")) next += 1;
  if (source[next] !== ")") return null;
  next += 1;
  while (/\s/.test(source[next] || "")) next += 1;
  if (source[next] === ";") next += 1;

  let value: unknown;
  try {
    value = JSON.parse(source.slice(start, end));
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  if (value.length === 2 && value[0] === 1 && typeof value[1] === "string") {
    return { chunk: value[1], next };
  }
  if ((value.length === 1 && value[0] === 0) ||
      (value.length === 2 && value[0] === 2 && value[1] === null)) {
    return { chunk: null, next };
  }
  return null;
}

function rscChunks(html: string): string[] | null {
  const chunks: string[] = [];
  const script = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;
  let scriptsSeen = 0;
  for (let match = script.exec(html); match; match = script.exec(html)) {
    scriptsSeen += 1;
    if (scriptsSeen > LIGHTNING_BOUNTIES_MAX_SCRIPTS) return null;
    if (!match[1].includes(RSC_PUSH)) continue;
    let markerStart = match[1].indexOf(RSC_PUSH);
    while (markerStart >= 0) {
      const parsed = parseRscPushAt(match[1], markerStart);
      if (parsed === null) return null;
      if (parsed.chunk !== null) chunks.push(parsed.chunk);
      markerStart = match[1].indexOf(RSC_PUSH, parsed.next);
    }
  }
  return chunks;
}

function candidateRecords(chunks: readonly string[]): Record<string, unknown>[] | null {
  const records: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    if (!chunk.includes("\"github_id\"")) continue;
    const starts: number[] = [];
    let inString = false;
    let escaped = false;
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
        continue;
      }
      if (character === "\"") {
        inString = true;
      } else if (character === "{") {
        starts.push(index);
      } else if (character === "}") {
        const start = starts.pop();
        if (start === undefined) return null;
        const source = chunk.slice(start, index + 1);
        if (!source.includes("\"github_id\"")) continue;
        try {
          const value: unknown = JSON.parse(source);
          if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, "github_id")) {
            records.push(value);
            if (records.length > LIGHTNING_BOUNTIES_MAX_RECORDS) return null;
          }
        } catch {
          // A containing RSC object can include protocol references that are not
          // standalone JSON. Exact nested issue records are still considered.
        }
      }
    }
    if (inString || starts.length > 0) return null;
  }
  return records;
}

function normalizedRecord(
  record: Record<string, unknown>,
  githubIssueId: number,
  routes: readonly LightningBountiesIssueRoute[],
): NormalizedRecord | "OTHER_ISSUE" | null {
  if (record.github_id !== githubIssueId) return "OTHER_ISSUE";
  const route = exactIssueRoute(record.html_url, routes);
  const repository = record.repository_data;
  if (!route || !isRecord(repository) ||
      typeof record.id !== "string" || !UUID.test(record.id) ||
      typeof record.repository_id !== "string" || !UUID.test(record.repository_id) ||
      typeof repository.id !== "string" || repository.id.toLowerCase() !== record.repository_id.toLowerCase() ||
      typeof repository.full_name !== "string" ||
      repository.full_name.toLowerCase() !== `${route.owner}/${route.repo}`.toLowerCase() ||
      record.issue_number !== route.number ||
      typeof record.is_closed !== "boolean" ||
      !Number.isSafeInteger(record.total_rewards) || Number(record.total_rewards) < 1 ||
      !isSafeNonNegativeInteger(record.total_reward_sats) || record.total_reward_sats < 1 ||
      !isSafeNonNegativeInteger(record.unexpired_total_rewards) ||
      !isSafeNonNegativeInteger(record.unlocked_total_rewards) ||
      record.unlocked_total_rewards > record.unexpired_total_rewards ||
      record.unexpired_total_rewards > record.total_reward_sats) return null;

  const hasWinner = record.winner_id !== null;
  const hasClaimedAt = record.claimed_at !== null;
  if (hasWinner !== hasClaimedAt ||
      (hasWinner && (typeof record.winner_id !== "string" || !UUID.test(record.winner_id))) ||
      (hasClaimedAt && (typeof record.claimed_at !== "string" || !ISO_TIMESTAMP.test(record.claimed_at) ||
        !Number.isFinite(Date.parse(record.claimed_at)))) ||
      (hasWinner && record.is_closed !== true) ||
      (!hasWinner && record.is_closed === true)) return null;

  const state = hasWinner ? "AWARDED" : "OPEN";
  if (state === "OPEN" && record.unexpired_total_rewards === 0) return null;
  const listing: LightningBountiesListing = {
    platform_issue_id: record.id.toLowerCase(),
    state,
    total_rewards: Number(record.total_rewards),
    total_reward_sats: record.total_reward_sats,
    unexpired_total_rewards: record.unexpired_total_rewards,
  };
  return {
    id: record.id.toLowerCase(),
    listing,
    fingerprint: JSON.stringify({
      route: `${route.owner}/${route.repo}#${route.number}`.toLowerCase(),
      repository_id: record.repository_id.toLowerCase(),
      state,
      unexpired_total_rewards: listing.unexpired_total_rewards,
      unlocked_total_rewards: record.unlocked_total_rewards,
      total_rewards: record.total_rewards,
      total_reward_sats: record.total_reward_sats,
      winner_id: typeof record.winner_id === "string" ? record.winner_id.toLowerCase() : null,
      claimed_at: record.claimed_at,
    }),
  };
}

export function parseLightningBountiesListingPage(
  html: unknown,
  githubIssueId: number,
  routes: readonly LightningBountiesIssueRoute[],
): LightningBountiesListing | null {
  if (typeof html !== "string" || html.length < 1 || html.length > LIGHTNING_BOUNTIES_MAX_RESPONSE_BYTES ||
      !Number.isSafeInteger(githubIssueId) || githubIssueId < 1 || !validRoutes(routes)) return null;
  const chunks = rscChunks(html);
  if (!chunks) return null;
  const records = candidateRecords(chunks);
  if (!records) return null;

  const matches = new Map<string, NormalizedRecord>();
  for (const record of records) {
    const normalized = normalizedRecord(record, githubIssueId, routes);
    if (normalized === "OTHER_ISSUE") continue;
    if (normalized === null) return null;
    const previous = matches.get(normalized.id);
    if (previous && previous.fingerprint !== normalized.fingerprint) return null;
    matches.set(normalized.id, normalized);
  }
  if (matches.size !== 1) return null;
  return [...matches.values()][0].listing;
}

type Timestamp = number | null | "INVALID";

function optionalTimestamp(value: unknown): Timestamp {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return "INVALID";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : "INVALID";
}

function requiredTimestamp(value: unknown): number | null {
  const parsed = optionalTimestamp(value);
  return typeof parsed === "number" ? parsed : null;
}

export function parseLightningBountiesRewards(
  payload: unknown,
  listing: LightningBountiesListing,
  now: Date,
): LightningBountiesEvidence | null {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > LIGHTNING_BOUNTIES_MAX_RECORDS ||
      !isRecord(listing) || !UUID.test(listing.platform_issue_id) ||
      (listing.state !== "OPEN" && listing.state !== "AWARDED") ||
      !Number.isSafeInteger(listing.total_rewards) || listing.total_rewards < 1 ||
      listing.total_rewards > LIGHTNING_BOUNTIES_MAX_RECORDS ||
      !isSafeNonNegativeInteger(listing.total_reward_sats) || listing.total_reward_sats < 1 ||
      !isSafeNonNegativeInteger(listing.unexpired_total_rewards) ||
      listing.unexpired_total_rewards > listing.total_reward_sats ||
      !(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      payload.length !== listing.total_rewards) return null;

  const seen = new Set<string>();
  let total = 0;
  let unexpired = 0;
  let secured = 0;
  let reclaimable = 0;
  for (const value of payload) {
    if (!isRecord(value) || typeof value.id !== "string" || !UUID.test(value.id) ||
        typeof value.issue_id !== "string" ||
        value.issue_id.toLowerCase() !== listing.platform_issue_id ||
        !isSafeNonNegativeInteger(value.reward_sats) || value.reward_sats < 1 ||
        requiredTimestamp(value.created_at) === null || requiredTimestamp(value.modified_at) === null ||
        !isRecord(value.issue_data) || typeof value.issue_data.id !== "string" ||
        value.issue_data.id.toLowerCase() !== listing.platform_issue_id ||
        typeof value.issue_data.is_closed !== "boolean" ||
        value.issue_data.is_closed !== (listing.state === "AWARDED")) return null;
    const id = value.id.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);

    const unlocksAt = optionalTimestamp(value.unlocks_at);
    const expiresAt = optionalTimestamp(value.expires_at);
    if (unlocksAt === "INVALID" || expiresAt === "INVALID" ||
        (typeof expiresAt === "number" && expiresAt > now.getTime())) return null;

    total += value.reward_sats;
    if (!Number.isSafeInteger(total)) return null;
    if (expiresAt !== null) continue;
    unexpired += value.reward_sats;
    if (typeof unlocksAt === "number" && unlocksAt > now.getTime()) secured += value.reward_sats;
    else reclaimable += value.reward_sats;
    if (![unexpired, secured, reclaimable].every(Number.isSafeInteger)) return null;
  }
  if (total !== listing.total_reward_sats || unexpired !== listing.unexpired_total_rewards ||
      secured + reclaimable !== unexpired || (listing.state === "OPEN" && unexpired === 0)) return null;

  return {
    platform: "Lightning Bounties",
    verification: "TRUSTED_PLATFORM_API",
    state: listing.state,
    amount: unexpired,
    secured_amount: secured,
    reclaimable_amount: reclaimable,
    currency: "SATS",
    evidence_url: LIGHTNING_BOUNTIES_URL,
  };
}

export async function fetchLightningBountiesEvidence(
  githubIssueId: number,
  routes: readonly LightningBountiesIssueRoute[],
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<LightningBountiesEvidence | null> {
  try {
    const pageResponse = await fetchImpl(LIGHTNING_BOUNTIES_URL, {
      headers: { Accept: "text/html", "User-Agent": "BountyVerdict-Agent/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!pageResponse.ok ||
        !(pageResponse.headers.get("content-type") || "").toLowerCase().startsWith("text/html")) return null;
    const declaredLength = pageResponse.headers.get("content-length");
    if (declaredLength !== null &&
        (!/^\d+$/.test(declaredLength) || Number(declaredLength) > LIGHTNING_BOUNTIES_MAX_RESPONSE_BYTES)) return null;
    const html = await pageResponse.text();
    const listing = parseLightningBountiesListingPage(html, githubIssueId, routes);
    if (!listing) return null;

    const rewardsUrl = new URL(LIGHTNING_BOUNTIES_REWARDS_URL);
    rewardsUrl.searchParams.set("issue_id", listing.platform_issue_id);
    rewardsUrl.searchParams.set("skip", "0");
    rewardsUrl.searchParams.set("limit", String(LIGHTNING_BOUNTIES_MAX_RECORDS));
    const rewardsResponse = await fetchImpl(rewardsUrl, {
      headers: { Accept: "application/json", "User-Agent": "BountyVerdict-Agent/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!rewardsResponse.ok ||
        !(rewardsResponse.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return null;
    const rewardsLength = rewardsResponse.headers.get("content-length");
    if (rewardsLength !== null &&
        (!/^\d+$/.test(rewardsLength) || Number(rewardsLength) > LIGHTNING_BOUNTIES_MAX_RESPONSE_BYTES)) return null;
    const rewardsText = await rewardsResponse.text();
    if (rewardsText.length < 1 || rewardsText.length > LIGHTNING_BOUNTIES_MAX_RESPONSE_BYTES) return null;
    let rewards: unknown;
    try {
      rewards = JSON.parse(rewardsText);
    } catch {
      return null;
    }
    return parseLightningBountiesRewards(rewards, listing, now);
  } catch {
    return null;
  }
}
