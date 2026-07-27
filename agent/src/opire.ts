const OPIRE_API_ORIGIN = "https://app.opire.dev";
const OPIRE_REWARDS_API = `${OPIRE_API_ORIGIN}/api/backend/rewards`;
const OPIRE_MAX_RESPONSE_BYTES = 1_000_000;
const OPIRE_MAX_SEARCH_RESULTS = 100;
const OPIRE_MAX_REWARDS = 100;
const OPIRE_MAX_USERS = 100;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

type FetchLike = typeof fetch;

export type OpireEvidence = {
  platform: "Opire";
  verification: "TRUSTED_PLATFORM_API";
  state: "OPEN";
  amount: number;
  currency: "USD";
  claim_count: number;
  try_count: number;
  evidence_url: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactIssueUrl(value: unknown, owner: string, repo: string, number: number): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname === "github.com" && !url.port &&
    !url.username && !url.password && !url.search && !url.hash &&
    url.pathname.toLowerCase() === `/${owner}/${repo}/issues/${number}`.toLowerCase();
}

function exactRepositoryUrl(value: unknown, owner: string, repo: string): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname === "github.com" && !url.port &&
    !url.username && !url.password && !url.search && !url.hash &&
    url.pathname.replace(/\/$/, "").toLowerCase() === `/${owner}/${repo}`.toLowerCase();
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Opire returned HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > OPIRE_MAX_RESPONSE_BYTES) {
    throw new Error("Opire response is too large.");
  }
  const text = await response.text();
  if (text.length > OPIRE_MAX_RESPONSE_BYTES) throw new Error("Opire response is too large.");
  return JSON.parse(text);
}

export function parseOpireSearch(
  payload: unknown,
  owner: string,
  repo: string,
  number: number,
): string | null {
  if (!Array.isArray(payload) || payload.length > OPIRE_MAX_SEARCH_RESULTS) return null;
  const matches = payload.filter((entry) =>
    isRecord(entry) && exactIssueUrl(entry.url, owner, repo, number)
  );
  if (matches.length !== 1 || typeof matches[0].id !== "string" || !ULID.test(matches[0].id)) return null;
  return matches[0].id;
}

export function parseOpireEvidence(
  payload: unknown,
  expectedId: string,
  owner: string,
  repo: string,
  number: number,
  githubIssueId: number,
  githubRepositoryId: number,
): OpireEvidence | null {
  if (!isRecord(payload) || payload.id !== expectedId || !ULID.test(expectedId) ||
      payload.platform !== "GitHub" || payload.platformId !== String(githubIssueId) ||
      !exactIssueUrl(payload.issueURL, owner, repo, number) ||
      typeof payload.isClosed !== "boolean" || typeof payload.isDeleted !== "boolean" ||
      payload.isDeleted || !isRecord(payload.project) ||
      payload.project.platform !== "GitHub" ||
      payload.project.platformId !== String(githubRepositoryId) ||
      typeof payload.project.name !== "string" ||
      payload.project.name.toLowerCase() !== repo.toLowerCase() ||
      !exactRepositoryUrl(payload.project.url, owner, repo) ||
      !Array.isArray(payload.rewards) || payload.rewards.length > OPIRE_MAX_REWARDS ||
      !Array.isArray(payload.usersClaiming) || payload.usersClaiming.length > OPIRE_MAX_USERS ||
      !Array.isArray(payload.usersTrying) || payload.usersTrying.length > OPIRE_MAX_USERS) return null;

  const userList = (values: unknown[]): string[] | null => {
    if (!values.every((value) => typeof value === "string" && ULID.test(value))) return null;
    const unique = new Set(values as string[]);
    return unique.size === values.length ? [...unique] : null;
  };
  const claiming = userList(payload.usersClaiming);
  const trying = userList(payload.usersTrying);
  if (!claiming || !trying) return null;

  let availableCents = 0;
  const rewardIds = new Set<string>();
  for (const reward of payload.rewards) {
    if (!isRecord(reward) || typeof reward.id !== "string" || !ULID.test(reward.id) ||
        rewardIds.has(reward.id) || !isRecord(reward.price) ||
        reward.price.unit !== "USD_CENT" ||
        typeof reward.price.value !== "number" || !Number.isSafeInteger(reward.price.value) ||
        reward.price.value < 1 || !exactIssueUrl(reward.commentURL, owner, repo, number) ||
        typeof reward.creatorId !== "string" || !ULID.test(reward.creatorId) ||
        (reward.status !== "Available" && reward.status !== "Paid") ||
        (reward.status === "Available" && reward.rewardedUserId !== null) ||
        (reward.status === "Paid" &&
          (typeof reward.rewardedUserId !== "string" || !ULID.test(reward.rewardedUserId)))) return null;
    rewardIds.add(reward.id);
    if (reward.status === "Available") availableCents += reward.price.value;
    if (!Number.isSafeInteger(availableCents)) return null;
  }
  if (availableCents < 1) return null;

  return {
    platform: "Opire",
    verification: "TRUSTED_PLATFORM_API",
    state: "OPEN",
    amount: availableCents / 100,
    currency: "USD",
    claim_count: claiming.length,
    try_count: trying.length,
    evidence_url: `${OPIRE_API_ORIGIN}/issues/${expectedId}`,
  };
}

export async function fetchOpireEvidence(
  owner: string,
  repo: string,
  number: number,
  githubIssueId: number,
  githubRepositoryId: number,
  fetchImpl: FetchLike = fetch,
): Promise<OpireEvidence | null> {
  try {
    const search = new URL(OPIRE_REWARDS_API);
    search.searchParams.set("search", repo);
    const options: RequestInit = {
      headers: { Accept: "application/json", "User-Agent": "BountyVerdict-Agent/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    };
    const id = parseOpireSearch(
      await boundedJson(await fetchImpl(search, options)),
      owner,
      repo,
      number,
    );
    if (!id) return null;
    const detail = await boundedJson(await fetchImpl(
      `${OPIRE_API_ORIGIN}/api/backend/issues/${id}`,
      options,
    ));
    return parseOpireEvidence(
      detail,
      id,
      owner,
      repo,
      number,
      githubIssueId,
      githubRepositoryId,
    );
  } catch {
    return null;
  }
}
