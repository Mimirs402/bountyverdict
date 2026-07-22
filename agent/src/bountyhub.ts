const BOUNTYHUB_API = "https://api.bountyhub.dev/api/bounties";
const BOUNTYHUB_PAGE_SIZE = 100;
const BOUNTYHUB_MAX_PAGES = 10;
const BOUNTYHUB_MAX_MATCHES = 20;
const BOUNTYHUB_MAX_RESPONSE_BYTES = 1_000_000;
const BOUNTYHUB_REFERENCE = /https:\/\/(?:www\.)?bountyhub\.dev\/(?:en\/)?bounty\/view\/[0-9a-f-]{36}(?:\b|\/)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FetchLike = typeof fetch;

export type BountyHubEvidence = {
  platform: "BountyHub";
  verification: "TRUSTED_PLATFORM_API";
  state: "OPEN" | "CLAIMED" | "FROZEN" | "RETRACTED" | "SOLVED";
  amount: number;
  secured_amount: number;
  promised_amount: number;
  currency: "USD";
  funding_status: "PREPAID" | "PROMISED" | "MIXED";
  evidence_url: string;
};

type CollectionPage = { ids: string[]; hasNextPage: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactUsdCents(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  return cents > 0n ? cents : null;
}

function centsNumber(value: bigint): number {
  return Number(value) / 100;
}

function exactIssueUrl(value: unknown, owner: string, repo: string, number: number): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const expectedPath = `/${owner}/${repo}/issues/${number}`.toLowerCase();
  return url.protocol === "https:" && url.hostname === "github.com" &&
    !url.username && !url.password && !url.search && !url.hash &&
    url.pathname.toLowerCase() === expectedPath;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`BountyHub returned HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > BOUNTYHUB_MAX_RESPONSE_BYTES) {
    throw new Error("BountyHub response is too large.");
  }
  const text = await response.text();
  if (text.length > BOUNTYHUB_MAX_RESPONSE_BYTES) throw new Error("BountyHub response is too large.");
  return JSON.parse(text);
}

export function hasBountyHubReference(issue: unknown, comments: unknown[]): boolean {
  const body = isRecord(issue) && typeof issue.body === "string" ? issue.body : "";
  if (BOUNTYHUB_REFERENCE.test(body)) return true;
  return comments.some((comment) =>
    isRecord(comment) && typeof comment.body === "string" && BOUNTYHUB_REFERENCE.test(comment.body)
  );
}

export function parseBountyHubCollectionPage(
  payload: unknown,
  owner: string,
  repo: string,
  number: number,
): CollectionPage | null {
  if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length > BOUNTYHUB_PAGE_SIZE ||
      typeof payload.hasNextPage !== "boolean") return null;
  const repository = `${owner}/${repo}`;
  const ids: string[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry)) return null;
    if (typeof entry.repositoryFullName !== "string" || entry.repositoryFullName.toLowerCase() !== repository.toLowerCase() ||
        entry.issueNumber !== number) continue;
    if (typeof entry.id !== "string" || !UUID.test(entry.id) || !exactIssueUrl(entry.htmlURL, owner, repo, number)) return null;
    ids.push(entry.id);
  }
  return { ids, hasNextPage: payload.hasNextPage };
}

export function parseBountyHubEvidence(
  details: unknown[],
  owner: string,
  repo: string,
  number: number,
): BountyHubEvidence | null {
  if (details.length < 1 || details.length > BOUNTYHUB_MAX_MATCHES) return null;
  const repository = `${owner}/${repo}`;
  const records: Record<string, unknown>[] = [];
  const seenRecords = new Set<string>();
  for (const detail of details) {
    if (!isRecord(detail) || typeof detail.id !== "string" || !UUID.test(detail.id) || seenRecords.has(detail.id) ||
        typeof detail.repositoryFullName !== "string" || detail.repositoryFullName.toLowerCase() !== repository.toLowerCase() ||
        detail.issueNumber !== number || !exactIssueUrl(detail.htmlURL, owner, repo, number) ||
        typeof detail.claimed !== "boolean" || typeof detail.retracted !== "boolean" ||
        typeof detail.solved !== "boolean" || typeof detail.isFrozen !== "boolean" ||
        (detail.deletedAt !== null && typeof detail.deletedAt !== "string") ||
        !Array.isArray(detail.pledges) || !Array.isArray(detail.claims)) return null;
    seenRecords.add(detail.id);
    records.push(detail);
  }

  const activeRecords = records.filter((record) => record.deletedAt === null && record.retracted === false);
  const relevantRecords = activeRecords.length ? activeRecords : records;
  const pledgeStates = new Map<string, { amount: bigint; status: "PAID" | "PROMISED" }>();
  let unknownActivePledge = false;
  let solved = relevantRecords.some((record) => record.solved === true);
  let claimed = activeRecords.some((record) =>
    record.claimed === true || (record.assignmentType === "exclusive" && isRecord(record.assignee))
  );
  for (const record of relevantRecords) {
    for (const claim of record.claims as unknown[]) {
      if (!isRecord(claim)) return null;
      if (claim.deletedAt !== null && typeof claim.deletedAt !== "string") return null;
      if (claim.rejectedAt !== null && typeof claim.rejectedAt !== "string") return null;
      if (typeof claim.isOpen !== "boolean" || typeof claim.isPaid !== "boolean" || typeof claim.pullRequestIsmerged !== "boolean") return null;
      if (claim.deletedAt === null && claim.isPaid === true) solved = true;
      if (claim.deletedAt === null && claim.rejectedAt === null && (claim.isOpen === true || claim.pullRequestIsmerged === true)) claimed = true;
    }
    for (const pledge of record.pledges as unknown[]) {
      if (!isRecord(pledge) || typeof pledge.id !== "string" || !UUID.test(pledge.id) ||
          typeof pledge.retracted !== "boolean" || typeof pledge.isPaid !== "boolean" ||
          (pledge.deletedAt !== null && typeof pledge.deletedAt !== "string")) return null;
      if (pledge.retracted || pledge.deletedAt !== null || pledge.isPaid) continue;
      const amount = exactUsdCents(pledge.amount);
      if (amount === null || (pledge.paymentStatus !== "PAID" && pledge.paymentStatus !== "PROMISED")) {
        unknownActivePledge = true;
        continue;
      }
      const state = { amount, status: pledge.paymentStatus } as const;
      const previous = pledgeStates.get(pledge.id);
      if (previous && (previous.amount !== state.amount || previous.status !== state.status)) return null;
      pledgeStates.set(pledge.id, state);
    }
  }
  if (unknownActivePledge) return null;

  let secured = 0n;
  let promised = 0n;
  for (const pledge of pledgeStates.values()) {
    if (pledge.status === "PAID") secured += pledge.amount;
    else promised += pledge.amount;
  }
  const total = secured + promised;
  if (total <= 0n) return null;
  const state = activeRecords.length === 0
    ? "RETRACTED"
    : solved
      ? "SOLVED"
      : activeRecords.some((record) => record.isFrozen === true)
        ? "FROZEN"
        : claimed
          ? "CLAIMED"
          : "OPEN";
  const fundingStatus = secured > 0n && promised > 0n ? "MIXED" : secured > 0n ? "PREPAID" : "PROMISED";
  const evidenceUrl = records.length === 1
    ? `https://www.bountyhub.dev/en/bounty/view/${records[0].id}`
    : (() => {
      const url = new URL(BOUNTYHUB_API);
      url.searchParams.set("page", "1");
      url.searchParams.set("limit", String(BOUNTYHUB_PAGE_SIZE));
      url.searchParams.set("filters", JSON.stringify({ repositoryFullName: repository }));
      return url.toString();
    })();
  return {
    platform: "BountyHub",
    verification: "TRUSTED_PLATFORM_API",
    state,
    amount: centsNumber(total),
    secured_amount: centsNumber(secured),
    promised_amount: centsNumber(promised),
    currency: "USD",
    funding_status: fundingStatus,
    evidence_url: evidenceUrl,
  };
}

export async function fetchBountyHubEvidence(
  owner: string,
  repo: string,
  number: number,
  fetchImpl: FetchLike = fetch,
): Promise<BountyHubEvidence | null> {
  try {
    const ids: string[] = [];
    for (let page = 1; page <= BOUNTYHUB_MAX_PAGES; page += 1) {
      const url = new URL(BOUNTYHUB_API);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(BOUNTYHUB_PAGE_SIZE));
      url.searchParams.set("filters", JSON.stringify({ repositoryFullName: `${owner}/${repo}` }));
      const parsed = parseBountyHubCollectionPage(await boundedJson(await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "BountyVerdict-Agent/1.0" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      })), owner, repo, number);
      if (!parsed) return null;
      ids.push(...parsed.ids);
      if (ids.length > BOUNTYHUB_MAX_MATCHES) return null;
      if (!parsed.hasNextPage) break;
      if (page === BOUNTYHUB_MAX_PAGES) return null;
    }
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length || uniqueIds.length < 1) return null;
    const details = await Promise.all(uniqueIds.map(async (id) =>
      boundedJson(await fetchImpl(`${BOUNTYHUB_API}/${id}`, {
        headers: { Accept: "application/json", "User-Agent": "BountyVerdict-Agent/1.0" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      }))
    ));
    return parseBountyHubEvidence(details, owner, repo, number);
  } catch {
    return null;
  }
}
