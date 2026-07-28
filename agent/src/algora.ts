const ALGORA_ORIGIN = "https://algora.io";
const ALGORA_MAX_RESPONSE_BYTES = 1_000_000;
const ALGORA_MAX_ROWS = 100;
const ALGORA_MAX_SPONSORS = 4;
const LEGACY_ALGORA_USER_ID = 136125894;
const BOUNTY_ID_PATTERN = /^cli[a-z0-9]{20,40}$/;
const SPONSOR_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

type FetchLike = typeof fetch;

type Coordinates = {
  owner: string;
  repo: string;
  number: number;
};

type SponsorReference = {
  sponsor: string;
  expected_bounty_id: string | null;
  referenced_repository: { owner: string; repo: string } | null;
};

export type AlgoraEvidence = {
  platform: "Algora";
  verification: "TRUSTED_PLATFORM_API";
  state: "OPEN" | "CLAIMED";
  amount: number;
  currency: "USD";
  claim_count: number;
  bounty_ids: string[];
  evidence_url: string;
  completeness: "discovered_trusted_sponsor_records";
};

type AlgoraSponsorPageEvidence = Omit<AlgoraEvidence, "evidence_url" | "completeness"> & {
  bounty_records: Array<{ bounty_id: string; amount: number; claim_count: number }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCoordinates(value: Coordinates): boolean {
  return SPONSOR_PATTERN.test(value.owner) &&
    /^[A-Za-z0-9._-]{1,100}$/.test(value.repo) &&
    Number.isSafeInteger(value.number) && value.number > 0;
}

function exactGithubIssueUrl(value: string, allowed: readonly Coordinates[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" ||
      parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  return allowed.some(({ owner, repo, number }) =>
    parsed.pathname.toLowerCase() === `/${owner}/${repo}/issues/${number}`.toLowerCase()
  );
}

function sponsorReferences(comments: unknown[]): SponsorReference[] {
  const references: SponsorReference[] = [];
  const seen = new Set<string>();
  for (const value of comments) {
    if (!isRecord(value) || typeof value.body !== "string") continue;
    const body = value.body;
    const appSlug = isRecord(value.performed_via_github_app)
      ? value.performed_via_github_app.slug
      : null;
    const trustedApp = appSlug === "algora-pbc";
    const user = isRecord(value.user) ? value.user : null;
    const trustedLegacyActor = user?.id === LEGACY_ALGORA_USER_ID &&
      user.login === "algora-pbc" && user.type === "User" &&
      value.performed_via_github_app === null;

    if (trustedApp) {
      const matches = [...body.matchAll(/https:\/\/algora\.io\/([A-Za-z0-9][A-Za-z0-9-]{0,38})(?:\b|\/)/g)];
      for (const match of matches) {
        const sponsor = match[1];
        const key = sponsor.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        references.push({ sponsor, expected_bounty_id: null, referenced_repository: null });
        if (references.length === ALGORA_MAX_SPONSORS) return references;
      }
      continue;
    }

    if (!trustedLegacyActor ||
        !/^💎\s*(?:\*\*)?\$[\d][\d,]*(?:\.\d{1,2})?(?:\*\*)?\s+bounty created by @[A-Za-z0-9][A-Za-z0-9-]{0,38}\b/im.test(body)) {
      continue;
    }
    const sponsors = [...body.matchAll(/bounty created by @([A-Za-z0-9][A-Za-z0-9-]{0,38})\b/gi)];
    const bountyIds = [...body.matchAll(/https:\/\/console\.algora\.io\/bounties\/(cli[a-z0-9]{20,40})(?:\b|\/)/gi)];
    const repositories = [...body.matchAll(/Thank you for contributing to ([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})!/gi)];
    if (sponsors.length !== 1 || bountyIds.length !== 1 || repositories.length !== 1 ||
        !BOUNTY_ID_PATTERN.test(bountyIds[0][1])) continue;
    const sponsor = sponsors[0][1];
    const key = sponsor.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({
      sponsor,
      expected_bounty_id: bountyIds[0][1],
      referenced_repository: { owner: repositories[0][1], repo: repositories[0][2] },
    });
    if (references.length === ALGORA_MAX_SPONSORS) return references;
  }
  return references;
}

export function hasTrustedAlgoraReference(comments: unknown[]): boolean {
  return Array.isArray(comments) && comments.length <= 300 && sponsorReferences(comments).length > 0;
}

export function parseAlgoraSponsorPage(
  html: unknown,
  sponsor: string,
  allowedCoordinates: readonly Coordinates[],
  expectedBountyId: string | null = null,
): AlgoraSponsorPageEvidence | null {
  if (typeof html !== "string" || html.length < 2 || html.length > ALGORA_MAX_RESPONSE_BYTES ||
      !SPONSOR_PATTERN.test(sponsor) || allowedCoordinates.length < 1 || allowedCoordinates.length > 3 ||
      allowedCoordinates.some((coordinates) => !validCoordinates(coordinates)) ||
      (expectedBountyId !== null && !BOUNTY_ID_PATTERN.test(expectedBountyId))) return null;

  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  if (rows.length > ALGORA_MAX_ROWS) return null;
  const matches = new Map<string, { amountCents: bigint; claimCount: number }>();
  for (const row of rows) {
    const idMatches = [...row.matchAll(/phx-click="toggle-claims"\s+phx-value-id="([^"]+)"/gi)];
    const issueMatches = [...row.matchAll(/<a\s+href="(https:\/\/github\.com\/[^"]+)"[^>]*class="[^"]*group\/issue[^"]*"/gi)];
    const amountMatches = [...row.matchAll(/class="[^"]*font-extrabold[^"]*"[^>]*>\s*\$([\d][\d,]*(?:\.\d{1,2})?)\s*</gi)];
    const claimMatches = [...row.matchAll(/>\s*([0-9]{1,6})\s+claims?\s*</gi)];
    if (idMatches.length !== 1 || issueMatches.length !== 1 ||
        !exactGithubIssueUrl(issueMatches[0][1], allowedCoordinates)) continue;
    const bountyId = idMatches[0][1];
    if (!BOUNTY_ID_PATTERN.test(bountyId) || (expectedBountyId && bountyId !== expectedBountyId) ||
        amountMatches.length !== 1 || claimMatches.length !== 1) continue;
    const amountText = amountMatches[0][1].replaceAll(",", "");
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amountText)) continue;
    const [whole, fraction = ""] = amountText.split(".");
    const amountCents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
    const claimCount = Number(claimMatches[0][1]);
    if (amountCents <= 0n || amountCents > 100_000_000_00n ||
        !Number.isSafeInteger(claimCount) || claimCount < 0) continue;
    const prior = matches.get(bountyId);
    if (prior && (prior.amountCents !== amountCents || prior.claimCount !== claimCount)) return null;
    matches.set(bountyId, { amountCents, claimCount });
  }
  if (!matches.size || (expectedBountyId && !matches.has(expectedBountyId))) return null;
  const amountCents = [...matches.values()].reduce((sum, row) => sum + row.amountCents, 0n);
  const claimCount = [...matches.values()].reduce((sum, row) => sum + row.claimCount, 0);
  const amount = Number(amountCents) / 100;
  if (!Number.isSafeInteger(Number(amountCents)) || !Number.isFinite(amount)) return null;
  return {
    platform: "Algora",
    verification: "TRUSTED_PLATFORM_API",
    state: claimCount > 0 ? "CLAIMED" : "OPEN",
    amount,
    currency: "USD",
    claim_count: claimCount,
    bounty_ids: [...matches.keys()].sort(),
    bounty_records: [...matches.entries()]
      .map(([bounty_id, value]) => ({
        bounty_id,
        amount: Number(value.amountCents) / 100,
        claim_count: value.claimCount,
      }))
      .sort((left, right) => left.bounty_id.localeCompare(right.bounty_id)),
  };
}

export async function fetchAlgoraEvidence(
  comments: unknown[],
  canonical: Coordinates,
  submitted: Coordinates,
  fetchImpl: FetchLike = fetch,
): Promise<AlgoraEvidence | null> {
  if (!Array.isArray(comments) || comments.length > 300 ||
      !validCoordinates(canonical) || !validCoordinates(submitted)) return null;
  const references = sponsorReferences(comments);
  if (!references.length) return null;
  const transferred = canonical.owner.toLowerCase() !== submitted.owner.toLowerCase() ||
    canonical.repo.toLowerCase() !== submitted.repo.toLowerCase() ||
    canonical.number !== submitted.number;
  const rows: Array<{
    evidence: AlgoraSponsorPageEvidence;
    url: string;
  }> = [];
  for (const reference of references) {
    try {
      const url = `${ALGORA_ORIGIN}/${encodeURIComponent(reference.sponsor)}/bounties?status=open`;
      const response = await fetchImpl(url, {
        headers: { Accept: "text/html", "User-Agent": "BountyVerdict-Agent/1.0" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().startsWith("text/html")) continue;
      const declaredLength = Number(response.headers.get("content-length") || "0");
      if (Number.isFinite(declaredLength) && declaredLength > ALGORA_MAX_RESPONSE_BYTES) continue;
      const evidence = parseAlgoraSponsorPage(
        await response.text(),
        reference.sponsor,
        [...new Map([
          canonical,
          ...(transferred ? [submitted] : []),
          ...(reference.referenced_repository
            ? [{ ...reference.referenced_repository, number: canonical.number }]
            : []),
        ].map((route) => [
          `${route.owner.toLowerCase()}/${route.repo.toLowerCase()}/${route.number}`,
          route,
        ])).values()],
        reference.expected_bounty_id,
      );
      if (evidence) rows.push({ evidence, url });
    } catch {
      // One unavailable sponsor page cannot authenticate or negate another.
    }
  }
  if (!rows.length) return null;
  const byBounty = new Map<string, { amount: number; claimed: boolean; claimCount: number; url: string }>();
  for (const row of rows) {
    for (const record of row.evidence.bounty_records) {
      const next = {
        amount: record.amount,
        claimed: record.claim_count > 0,
        claimCount: record.claim_count,
        url: row.url,
      };
      const prior = byBounty.get(record.bounty_id);
      if (prior && (prior.amount !== next.amount || prior.claimed !== next.claimed ||
          prior.claimCount !== next.claimCount)) return null;
      byBounty.set(record.bounty_id, next);
    }
  }
  const amount = [...byBounty.values()].reduce((sum, row) => sum + row.amount, 0);
  const claimCount = [...byBounty.values()].reduce((sum, row) => sum + row.claimCount, 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    platform: "Algora",
    verification: "TRUSTED_PLATFORM_API",
    state: claimCount > 0 ? "CLAIMED" : "OPEN",
    amount,
    currency: "USD",
    claim_count: claimCount,
    bounty_ids: [...byBounty.keys()].sort(),
    evidence_url: rows[0].url,
    completeness: "discovered_trusted_sponsor_records",
  };
}
