const ISSUEHUNT_ORIGIN = "https://oss.issuehunt.io";
const ISSUEHUNT_MAX_RESPONSE_BYTES = 1_000_000;
const ISSUEHUNT_MAX_RECORDS = 20;
const ISSUEHUNT_MAX_EVENTS = 20;
const NEXT_DATA_START = "__NEXT_DATA__ = ";
const NEXT_DATA_END = ";__NEXT_LOADED_PAGES__";
const ISSUEHUNT_REFERENCE = /https:\/\/(?:oss\.)?issuehunt\.io\/(?:r\/[^\s/]+\/[^\s/]+\/issues\/\d+|repos\/\d+\/issues\/\d+)(?:\b|\/)/i;
const ISSUEHUNT_ROUTE_REFERENCE = /https:\/\/(?:oss\.)?issuehunt\.io\/r\/([a-z0-9](?:[a-z0-9-]{0,38}))\/([a-z0-9._-]{1,100})\/issues\/([1-9]\d{0,9})(?:\b|\/)/gi;
const ISSUEHUNT_MAX_REFERENCE_ROUTES = 3;

type FetchLike = typeof fetch;

type IssueHuntEvidenceBase = {
  platform: "IssueHunt";
  evidence_url: string;
  submitted_pull_requests: string[];
};

export type IssueHuntEvidence = IssueHuntEvidenceBase & ({
  verification: "UNVERIFIED";
  state: "ACTIVE_UNVERIFIED";
  amount: null;
  currency: null;
} | {
  verification: "TRUSTED_PLATFORM_API";
  state: "REWARDED";
  amount: number;
  currency: "USD";
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactPositiveCents(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,10}$/.test(value)) return null;
  const cents = BigInt(value);
  return cents > 0n ? cents : null;
}

function exactNonNegativeCents(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) return null;
  return BigInt(value);
}

function exactObjectId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);
}

function exactUtcTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length < 20 || value.length > 30) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) return null;
  return timestamp;
}

function exactRouteQuery(
  value: unknown,
  owner: string,
  repo: string,
  number: number,
): boolean {
  return isRecord(value) && typeof value.repositoryOwnerName === "string" &&
    value.repositoryOwnerName.toLowerCase() === owner.toLowerCase() &&
    typeof value.repositoryName === "string" && value.repositoryName.toLowerCase() === repo.toLowerCase() &&
    String(value.issueNumber) === String(number);
}

function exactPullRequestUrl(
  value: unknown,
  owner: string,
  repo: string,
  number: number,
): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password ||
      url.search || url.hash || url.pathname.toLowerCase() !== `/${owner}/${repo}/pull/${number}`.toLowerCase()) {
    return null;
  }
  return `https://github.com/${owner}/${repo}/pull/${number}`;
}

export function hasIssueHuntReference(issue: unknown, comments: unknown[]): boolean {
  if (!isRecord(issue)) return false;
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  const exactLabel = labels.some((label) => {
    const name = typeof label === "string" ? label : isRecord(label) ? label.name : null;
    return typeof name === "string" && name.trim().toLowerCase() === "funded on issuehunt";
  });
  if (exactLabel || (typeof issue.body === "string" && ISSUEHUNT_REFERENCE.test(issue.body))) return true;
  return comments.some((comment) =>
    isRecord(comment) && typeof comment.body === "string" && ISSUEHUNT_REFERENCE.test(comment.body)
  );
}

export function issueHuntReferenceRoutes(
  issue: unknown,
  comments: unknown[],
  issueNumber: number,
): Array<{ owner: string; repo: string; number: number }> {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return [];
  const texts: string[] = [];
  if (isRecord(issue) && typeof issue.body === "string") texts.push(issue.body);
  for (const comment of comments) {
    if (isRecord(comment) && typeof comment.body === "string") texts.push(comment.body);
  }

  const routes: Array<{ owner: string; repo: string; number: number }> = [];
  const seen = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(ISSUEHUNT_ROUTE_REFERENCE)) {
      const number = Number(match[3]);
      if (number !== issueNumber) continue;
      const key = `${match[1].toLowerCase()}/${match[2].toLowerCase()}/${number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ owner: match[1], repo: match[2], number });
      if (routes.length === ISSUEHUNT_MAX_REFERENCE_ROUTES) return routes;
    }
  }
  return routes;
}

export function parseIssueHuntPage(
  html: unknown,
  owner: string,
  repo: string,
  repositoryGithubId: number,
  number: number,
): IssueHuntEvidence | null {
  if (typeof html !== "string" || html.length < 2 || html.length > ISSUEHUNT_MAX_RESPONSE_BYTES ||
      !Number.isSafeInteger(repositoryGithubId) || repositoryGithubId < 1) return null;
  const start = html.indexOf(NEXT_DATA_START);
  if (start < 0 || html.indexOf(NEXT_DATA_START, start + NEXT_DATA_START.length) >= 0) return null;
  const jsonStart = start + NEXT_DATA_START.length;
  const end = html.indexOf(NEXT_DATA_END, jsonStart);
  if (end < 0 || html.indexOf(NEXT_DATA_END, end + NEXT_DATA_END.length) >= 0) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(html.slice(jsonStart, end));
  } catch {
    return null;
  }
  if (!isRecord(payload) || !exactRouteQuery(payload.query, owner, repo, number) || !isRecord(payload.props)) return null;
  const route = payload.props.route;
  const expectedPath = `/r/${owner}/${repo}/issues/${number}`;
  if (!isRecord(route) || route.pathname !== "/issues/show" || route.asPath !== expectedPath ||
      !exactRouteQuery(route.query, owner, repo, number) || !isRecord(payload.props.pageProps)) return null;
  const page = payload.props.pageProps;
  const repository = page.repository;
  const issue = page.issue;
  if (!isRecord(repository) || !isRecord(issue) ||
      typeof repository.ownerName !== "string" || repository.ownerName.toLowerCase() !== owner.toLowerCase() ||
      typeof repository.name !== "string" || repository.name.toLowerCase() !== repo.toLowerCase() ||
      String(repository.githubId) !== String(repositoryGithubId) ||
      typeof issue.repositoryOwnerName !== "string" || issue.repositoryOwnerName.toLowerCase() !== owner.toLowerCase() ||
      typeof issue.repositoryName !== "string" || issue.repositoryName.toLowerCase() !== repo.toLowerCase() ||
      String(issue.repositoryGithubId) !== String(repositoryGithubId) || issue.number !== number ||
      !new Set(["funded", "ready", "rewarded"]).has(String(issue.status)) ||
      !Number.isSafeInteger(issue.depositAmount) || Number(issue.depositAmount) <= 0 ||
      !Array.isArray(page.deposits) ||
      !Array.isArray(page.anonymousDeposits) ||
      page.deposits.length + page.anonymousDeposits.length < 1 ||
      page.deposits.length + page.anonymousDeposits.length > ISSUEHUNT_MAX_RECORDS ||
      !Array.isArray(page.pullRequests) || page.pullRequests.length > ISSUEHUNT_MAX_RECORDS ||
      !Array.isArray(page.organizationGithubIdBalanceAmountEntries) || page.organizationGithubIdBalanceAmountEntries.length > 0) {
    return null;
  }

  const seenDeposits = new Set<string>();
  let activeDepositCents = 0n;
  for (const deposit of [...page.deposits, ...page.anonymousDeposits]) {
    if (!isRecord(deposit) || typeof deposit._id !== "string" || !/^[0-9a-f]{24}$/i.test(deposit._id) ||
        seenDeposits.has(deposit._id.toLowerCase()) || typeof deposit.cancelled !== "boolean") return null;
    seenDeposits.add(deposit._id.toLowerCase());
    const cents = exactPositiveCents(deposit.amount);
    if (cents === null) return null;
    if (!deposit.cancelled) activeDepositCents += cents;
  }
  if (activeDepositCents !== BigInt(Number(issue.depositAmount))) return null;

  const submitted: string[] = [];
  const seenSubmissions = new Set<string>();
  const parsedPulls: Array<{ id: string; rewardId: string | null; cancelled: boolean }> = [];
  for (const pull of page.pullRequests) {
    if (!isRecord(pull) || !exactObjectId(pull._id) ||
        typeof pull.cancelled !== "boolean" || typeof pull.repositoryOwnerName !== "string" ||
        typeof pull.repositoryName !== "string" || !Number.isSafeInteger(pull.number) || Number(pull.number) < 1) return null;
    const rewardId = pull.reward === undefined ? null : exactObjectId(pull.reward) ? pull.reward : null;
    if (pull.reward !== undefined && rewardId === null) return null;
    const canonical = exactPullRequestUrl(
      pull.url,
      pull.repositoryOwnerName,
      pull.repositoryName,
      Number(pull.number),
    );
    if (!canonical || pull.repositoryOwnerName.toLowerCase() !== owner.toLowerCase() ||
        pull.repositoryName.toLowerCase() !== repo.toLowerCase()) return null;
    parsedPulls.push({ id: pull._id, rewardId, cancelled: pull.cancelled });
    if (pull.cancelled) continue;
    const key = canonical.toLowerCase();
    if (seenSubmissions.has(key)) return null;
    seenSubmissions.add(key);
    submitted.push(canonical);
  }

  const evidenceUrl = `${ISSUEHUNT_ORIGIN}${expectedPath}`;
  if (issue.status !== "rewarded") {
    // IssueHunt's public SSR payload is historical accounting, not an active
    // escrow or collectibility ledger. Its Terms extinguish Deposits after 180
    // days from purchase, while balance-funded records omit that original
    // purchase time and every public record omits current reserve,
    // withdrawability, and contributor-share state. The strictly identity-bound
    // record remains useful for an explicit unverified hard stop and submitted
    // output evidence, but never becomes trusted active funding.
    return {
      platform: "IssueHunt",
      verification: "UNVERIFIED",
      state: "ACTIVE_UNVERIFIED",
      amount: null,
      currency: null,
      evidence_url: evidenceUrl,
      submitted_pull_requests: submitted,
    };
  }

  const reward = page.reward;
  if (!exactObjectId(repository._id) || !exactObjectId(issue._id) ||
      exactUtcTimestamp(issue.rewardedAt) === null || !isRecord(reward) ||
      !exactObjectId(reward._id) || reward.repository !== repository._id || reward.issue !== issue._id ||
      !exactObjectId(reward.pullRequest) || exactUtcTimestamp(reward.createdAt) === null ||
      !Number.isSafeInteger(reward.repositoryPercentge) || Number(reward.repositoryPercentge) < 0 ||
      Number(reward.repositoryPercentge) > 100 || !Number.isSafeInteger(reward.feePercentage) ||
      Number(reward.feePercentage) < 0 || Number(reward.feePercentage) > 100 ||
      Number(reward.repositoryPercentge) + Number(reward.feePercentage) > 100 ||
      !Array.isArray(page.events) || page.events.length < 1 || page.events.length > ISSUEHUNT_MAX_EVENTS) return null;
  const rewardAmount = exactPositiveCents(reward.amount);
  const feeAmount = exactNonNegativeCents(reward.feeAmount);
  const repositoryRewardAmount = exactNonNegativeCents(reward.repositoryRewardAmount);
  const userRewardAmount = exactNonNegativeCents(reward.userRewardAmount);
  if (rewardAmount === null || feeAmount === null || repositoryRewardAmount === null ||
      userRewardAmount === null || rewardAmount !== activeDepositCents ||
      feeAmount + repositoryRewardAmount + userRewardAmount !== rewardAmount ||
      parsedPulls.filter((pull) => !pull.cancelled && pull.id === reward.pullRequest &&
        pull.rewardId === reward._id).length !== 1) return null;
  const matchingRewardEvents = page.events.filter((event) => isRecord(event) &&
    event.__t === "RewardEvent" && event.type === "Reward" && exactObjectId(event._id) &&
    exactUtcTimestamp(event.createdAt) !== null && event.rewardId === reward._id &&
    event.repositoryId === repository._id && String(event.repositoryGithubId) === String(repositoryGithubId) &&
    typeof event.repositoryOwnerName === "string" && event.repositoryOwnerName.toLowerCase() === owner.toLowerCase() &&
    typeof event.repositoryName === "string" && event.repositoryName.toLowerCase() === repo.toLowerCase() &&
    event.issueId === issue._id && event.issueNumber === number && event.amount === reward.amount &&
    event.feeAmount === reward.feeAmount && event.repositoryRewardAmount === reward.repositoryRewardAmount &&
    event.userRewardAmount === reward.userRewardAmount);
  if (matchingRewardEvents.length !== 1) return null;

  return {
    platform: "IssueHunt",
    verification: "TRUSTED_PLATFORM_API",
    state: "REWARDED",
    amount: Number(rewardAmount) / 100,
    currency: "USD",
    evidence_url: evidenceUrl,
    submitted_pull_requests: submitted,
  };
}

export async function fetchIssueHuntEvidence(
  owner: string,
  repo: string,
  repositoryGithubId: number,
  number: number,
  fetchImpl: FetchLike = fetch,
): Promise<IssueHuntEvidence | null> {
  try {
    const url = `${ISSUEHUNT_ORIGIN}/r/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`;
    const response = await fetchImpl(url, {
      headers: { Accept: "text/html", "User-Agent": "BountyVerdict-Agent/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().startsWith("text/html")) return null;
    const declaredLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(declaredLength) && declaredLength > ISSUEHUNT_MAX_RESPONSE_BYTES) return null;
    const html = await response.text();
    return parseIssueHuntPage(html, owner, repo, repositoryGithubId, number);
  } catch {
    return null;
  }
}
