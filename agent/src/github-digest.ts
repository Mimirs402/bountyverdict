import { createHash } from "node:crypto";

export const GITHUB_DIGEST_MAX_EVENTS = 50;

export type GithubDigestEvent = {
  id: string;
  repository: string;
  reason: string;
  type: string;
  title: string;
  updated_at: string;
  url: string | null;
  author: string | null;
  body_excerpt: string | null;
  actionable: boolean;
};

type GithubDigest = {
  schema_version: 1;
  checked_at: string;
  since: string;
  account: "Mimirs402";
  event_count: number;
  actionable_count: number;
  digest_fingerprint: string;
  events: GithubDigestEvent[];
};

function record(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length ? compact.slice(0, maximum) : null;
}

function publicGithubUrl(value: unknown): string | null {
  const text = boundedString(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildGithubDigest(
  value: unknown,
  detailByApiUrl: ReadonlyMap<string, unknown>,
  since: string,
  checkedAt: string,
): GithubDigest {
  if (!Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(checkedAt))) {
    throw new Error("GitHub digest timestamps are invalid.");
  }
  if (!Array.isArray(value) || value.length > 100) throw new Error("GitHub notification response is unbounded or malformed.");
  const events = value.map((entry): GithubDigestEvent | null => {
    const notification = record(entry);
    const subject = record(notification.subject);
    const repository = record(notification.repository);
    const id = boundedString(notification.id, 128);
    const fullName = boundedString(repository.full_name, 200);
    const reason = boundedString(notification.reason, 64);
    const type = boundedString(subject.type, 64);
    const title = boundedString(subject.title, 300);
    const updatedAt = boundedString(notification.updated_at, 64);
    if (!id || !fullName || !/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(fullName) ||
        !reason || !type || !title || !updatedAt || !Number.isFinite(Date.parse(updatedAt))) return null;
    const detailUrl = boundedString(subject.latest_comment_url, 2_048);
    const detail = detailUrl ? record(detailByApiUrl.get(detailUrl)) : {};
    const body = boundedString(detail.body, 1_200);
    const author = boundedString(record(detail.user).login, 100);
    const actionableReasons = new Set(["assign", "author", "comment", "mention", "review_requested", "security_alert", "team_mention"]);
    return {
      id,
      repository: fullName,
      reason,
      type,
      title,
      updated_at: new Date(updatedAt).toISOString(),
      url: publicGithubUrl(detail.html_url || subject.html_url),
      author,
      body_excerpt: body,
      actionable: actionableReasons.has(reason) || body !== null,
    };
  }).filter((event): event is GithubDigestEvent => event !== null)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, GITHUB_DIGEST_MAX_EVENTS);
  const fingerprintInput = events.map(({ id, updated_at, reason, url, body_excerpt }) => ({
    id,
    updated_at,
    reason,
    url,
    body_excerpt,
  }));
  return {
    schema_version: 1,
    checked_at: new Date(checkedAt).toISOString(),
    since: new Date(since).toISOString(),
    account: "Mimirs402",
    event_count: events.length,
    actionable_count: events.filter(({ actionable }) => actionable).length,
    digest_fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(fingerprintInput)).digest("hex")}`,
    events,
  };
}
