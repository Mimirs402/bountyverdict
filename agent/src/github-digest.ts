import { createHash } from "node:crypto";

export const GITHUB_DIGEST_MAX_EVENTS = 50;
export const GITHUB_DIGEST_ACCOUNT = "Mimirs402" as const;
export const GITHUB_DIGEST_MAX_OPEN_PULL_REQUESTS = 50;
export const GITHUB_DIGEST_MAX_PR_FEEDBACK_PER_KIND = 100;

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

export type GithubDigest = {
  schema_version: 1;
  checked_at: string;
  since: string;
  account: typeof GITHUB_DIGEST_ACCOUNT;
  event_count: number;
  actionable_count: number;
  digest_fingerprint: string;
  events: GithubDigestEvent[];
};

export type BusinessAuthoredOpenPullRequest = {
  repository: string;
  number: number;
  title: string;
  url: string;
  author: typeof GITHUB_DIGEST_ACCOUNT;
};

export type BusinessPullRequestFeedback = {
  pull_request: BusinessAuthoredOpenPullRequest;
  review_comments: unknown;
  reviews: unknown;
};

export function preserveLatestNonEmptyGithubDigest(
  current: GithubDigest,
  previous: unknown,
): GithubDigest {
  if (current.event_count > 0) return current;
  const prior = record(previous);
  if (prior.schema_version !== 1 || prior.account !== GITHUB_DIGEST_ACCOUNT ||
      typeof prior.digest_fingerprint !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(prior.digest_fingerprint) ||
      !Number.isSafeInteger(prior.event_count) || prior.event_count < 1 ||
      !Number.isSafeInteger(prior.actionable_count) ||
      !Array.isArray(prior.events) || prior.events.length !== prior.event_count ||
      prior.events.length > GITHUB_DIGEST_MAX_EVENTS ||
      !prior.events.every(validEvent) ||
      prior.events.filter((event: GithubDigestEvent) => event.actionable).length !== prior.actionable_count) return current;
  const retainedEvents = (prior.events as GithubDigestEvent[]).map((event) => ({
    ...event,
    actionable: false,
  }));
  return {
    ...(prior as GithubDigest),
    checked_at: current.checked_at,
    since: current.since,
    actionable_count: 0,
    events: retainedEvents,
  };
}

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

function boundedIdentifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return boundedString(value, 128);
}

function validEvent(event: unknown): event is GithubDigestEvent {
  const candidate = record(event);
  return typeof candidate.id === "string" && candidate.id.length > 0 && candidate.id.length <= 512 &&
    typeof candidate.repository === "string" &&
    /^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(candidate.repository) &&
    typeof candidate.reason === "string" && candidate.reason.length > 0 && candidate.reason.length <= 64 &&
    typeof candidate.type === "string" && candidate.type.length > 0 && candidate.type.length <= 64 &&
    typeof candidate.title === "string" && candidate.title.length > 0 && candidate.title.length <= 300 &&
    typeof candidate.updated_at === "string" && Number.isFinite(Date.parse(candidate.updated_at)) &&
    (candidate.url === null || publicGithubUrl(candidate.url) === candidate.url) &&
    (candidate.author === null ||
      (typeof candidate.author === "string" && candidate.author.length > 0 && candidate.author.length <= 100)) &&
    (candidate.body_excerpt === null ||
      (typeof candidate.body_excerpt === "string" && candidate.body_excerpt.length > 0 &&
        candidate.body_excerpt.length <= 1_200)) &&
    typeof candidate.actionable === "boolean";
}

function digestFromEvents(
  eventValues: readonly GithubDigestEvent[],
  since: string,
  checkedAt: string,
): GithubDigest {
  if (!Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(checkedAt))) {
    throw new Error("GitHub digest timestamps are invalid.");
  }
  const events = [...eventValues]
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
    account: GITHUB_DIGEST_ACCOUNT,
    event_count: events.length,
    actionable_count: events.filter(({ actionable }) => actionable).length,
    digest_fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(fingerprintInput)).digest("hex")}`,
    events,
  };
}

export function parseBusinessAuthoredOpenPullRequests(
  value: unknown,
): BusinessAuthoredOpenPullRequest[] {
  const response = record(value);
  if (response.incomplete_results !== false ||
      !Number.isSafeInteger(response.total_count) || response.total_count < 0 ||
      response.total_count > GITHUB_DIGEST_MAX_OPEN_PULL_REQUESTS ||
      !Array.isArray(response.items) ||
      response.items.length !== response.total_count) {
    throw new Error("Business pull-request search is incomplete, unbounded, or malformed.");
  }
  return response.items.map((entry: unknown): BusinessAuthoredOpenPullRequest => {
    const item = record(entry);
    const author = boundedString(record(item.user).login, 100);
    const number = item.number;
    const state = boundedString(item.state, 20);
    const title = boundedString(item.title, 300);
    const repositoryUrl = boundedString(item.repository_url, 2_048);
    const url = publicGithubUrl(item.html_url);
    const repositoryMatch = repositoryUrl?.match(
      /^https:\/\/api\.github\.com\/repos\/([-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+)$/,
    );
    const repository = repositoryMatch?.[1] ?? null;
    if (author !== GITHUB_DIGEST_ACCOUNT || state !== "open" ||
        !Number.isSafeInteger(number) || number < 1 || !title || !repository || !url ||
        url !== `https://github.com/${repository}/pull/${number}` ||
        Object.keys(record(item.pull_request)).length === 0) {
      throw new Error("Business pull-request search returned an unauthorized or malformed item.");
    }
    return {
      repository,
      number,
      title,
      url,
      author: GITHUB_DIGEST_ACCOUNT,
    };
  });
}

function feedbackArray(value: unknown, kind: string): unknown[] {
  if (!Array.isArray(value) || value.length >= GITHUB_DIGEST_MAX_PR_FEEDBACK_PER_KIND) {
    throw new Error(`GitHub ${kind} response is truncated, unbounded, or malformed.`);
  }
  return value;
}

export function buildBusinessPullRequestReviewEvents(
  value: unknown,
  since: string,
): GithubDigestEvent[] {
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs) || !Array.isArray(value) ||
      value.length > GITHUB_DIGEST_MAX_OPEN_PULL_REQUESTS) {
    throw new Error("Business pull-request feedback input is unbounded or malformed.");
  }
  const events: GithubDigestEvent[] = [];
  for (const rawScan of value) {
    const scan = record(rawScan);
    const pullRequest = record(scan.pull_request);
    const repository = boundedString(pullRequest.repository, 200);
    const number = pullRequest.number;
    const title = boundedString(pullRequest.title, 300);
    const url = publicGithubUrl(pullRequest.url);
    if (pullRequest.author !== GITHUB_DIGEST_ACCOUNT || !repository ||
        !/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(repository) ||
        !Number.isSafeInteger(number) || number < 1 || !title || !url ||
        url !== `https://github.com/${repository}/pull/${number}`) {
      throw new Error("Pull-request feedback source is not an authorized business-authored PR.");
    }

    for (const rawComment of feedbackArray(scan.review_comments, "review-comments")) {
      const comment = record(rawComment);
      const id = boundedIdentifier(comment.id);
      const author = boundedString(record(comment.user).login, 100);
      const body = boundedString(comment.body, 1_200);
      const htmlUrl = publicGithubUrl(comment.html_url);
      const updatedAt = boundedString(comment.updated_at || comment.created_at, 64);
      if (!id || !author || !body || !htmlUrl ||
          !htmlUrl.startsWith(`${url}#discussion_r`) ||
          !updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
        throw new Error("GitHub review-comment response contains malformed feedback.");
      }
      if (Date.parse(updatedAt) < sinceMs || author === GITHUB_DIGEST_ACCOUNT) continue;
      events.push({
        id: `review-comment:${repository}#${number}:${id}`,
        repository,
        reason: "review_comment",
        type: "PullRequest",
        title,
        updated_at: new Date(updatedAt).toISOString(),
        url: htmlUrl,
        author,
        body_excerpt: body,
        actionable: true,
      });
    }

    for (const rawReview of feedbackArray(scan.reviews, "reviews")) {
      const review = record(rawReview);
      const id = boundedIdentifier(review.id);
      const author = boundedString(record(review.user).login, 100);
      const state = boundedString(review.state, 40);
      const body = boundedString(review.body, 1_200);
      const htmlUrl = publicGithubUrl(review.html_url);
      const submittedAt = boundedString(review.submitted_at, 64);
      if (!id || !author || !state || !/^(?:APPROVED|CHANGES_REQUESTED|COMMENTED|DISMISSED)$/.test(state) ||
          !htmlUrl || !htmlUrl.startsWith(`${url}#pullrequestreview-`) ||
          !submittedAt || !Number.isFinite(Date.parse(submittedAt))) {
        throw new Error("GitHub review response contains malformed feedback.");
      }
      if (Date.parse(submittedAt) < sinceMs || author === GITHUB_DIGEST_ACCOUNT) continue;
      events.push({
        id: `review:${repository}#${number}:${id}`,
        repository,
        reason: "review",
        type: "PullRequest",
        title,
        updated_at: new Date(submittedAt).toISOString(),
        url: htmlUrl,
        author,
        body_excerpt: body ?? `Review state: ${state}`,
        actionable: true,
      });
    }
  }
  if (events.length > GITHUB_DIGEST_MAX_OPEN_PULL_REQUESTS *
      (GITHUB_DIGEST_MAX_PR_FEEDBACK_PER_KIND - 1) * 2) {
    throw new Error("Business pull-request feedback result is unbounded.");
  }
  return events;
}

export function mergeGithubDigestEvents(
  digest: GithubDigest,
  additionalEvents: readonly GithubDigestEvent[],
): GithubDigest {
  if (digest.schema_version !== 1 || digest.account !== GITHUB_DIGEST_ACCOUNT ||
      digest.events.length !== digest.event_count ||
      !additionalEvents.every(validEvent)) {
    throw new Error("GitHub digest merge input is malformed.");
  }
  const deduplicated = new Map<string, GithubDigestEvent>();
  for (const event of [...digest.events, ...additionalEvents]) {
    const key = event.url ? `url:${event.url}` : `id:${event.id}`;
    const previous = deduplicated.get(key);
    if (!previous) {
      deduplicated.set(key, event);
      continue;
    }
    const direct = event.reason === "review" || event.reason === "review_comment"
      ? event
      : previous;
    deduplicated.set(key, {
      ...direct,
      actionable: previous.actionable || event.actionable,
      body_excerpt: direct.body_excerpt ?? previous.body_excerpt ?? event.body_excerpt,
      author: direct.author ?? previous.author ?? event.author,
    });
  }
  return digestFromEvents([...deduplicated.values()], digest.since, digest.checked_at);
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
  }).filter((event): event is GithubDigestEvent => event !== null);
  return digestFromEvents(events, since, checkedAt);
}
