import { analyzeBounty, parseIssueUrl } from "../../analysis.js";
import { SERVICE_REUSE, type ServiceReuseGuidance } from "./reuse.ts";

export interface CheckEnvironment {
  GITHUB_TOKEN?: string;
}

export interface VerdictSignal {
  label: string;
  impact: number;
  detail: string;
  evidence_url: string | null;
  hard_stop: boolean;
}

export interface AgentVerdict {
  product: "BountyVerdict";
  version: "1.0";
  verdict: "AVOID" | "CAUTION" | "VIABLE";
  score: number;
  summary: string;
  service_reuse: ServiceReuseGuidance;
  issue: {
    url: string;
    submitted_url: string;
    transferred: boolean;
    title: string;
    state: string;
    repository: string;
  };
  signals: VerdictSignal[];
  contribution_policy: {
    ai_use: "BLOCKED" | "DISCLOSURE_REQUIRED" | "NO_EXPLICIT_RULE_FOUND";
    documents: Array<{ path: string; url: string }>;
  };
  reward: {
    state: "LISTED" | "PROMISED" | "UNVERIFIED" | "NOT_FOUND" | "WITHDRAWN" | "PAID_OR_AWARDED";
    verification: "TRUSTED_PLATFORM_APP" | "MAINTAINER_STATEMENT" | "UNVERIFIED" | "NONE";
    platform: string | null;
    amount: number | null;
    currency: string | null;
    evidence_url: string | null;
  };
  coverage: {
    comments_scanned: number;
    comments_total: number;
    comment_pages_scanned: number;
    comments_truncated: boolean;
    timeline_events_scanned: number;
    timeline_events_total: number;
    timeline_pages_scanned: number;
    timeline_truncated: boolean;
    linked_pull_requests_found: number;
    policy_documents_scanned: number;
    github_rate_limit_remaining: number | null;
  };
  checked_at: string;
  limitations: string[];
}

type FetchLike = typeof fetch;

interface AnalysisResult {
  verdict: AgentVerdict["verdict"];
  score: number;
  pullRequests: unknown[];
  aiPolicyBlocks: unknown[];
  aiPolicyRequirements: unknown[];
  reward: {
    state: AgentVerdict["reward"]["state"];
    verification: AgentVerdict["reward"]["verification"];
    platform: string | null;
    amount: number | null;
    currency: string | null;
    evidenceUrl: string | null;
  };
  signals: Array<{
    label: string;
    impact: number;
    detail: string;
    evidenceUrl: string | null;
    hardStop: boolean;
  }>;
}

export class CheckError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface GithubResponse {
  data: any;
  remaining: number | null;
  link: string | null;
}

interface PolicyDocument {
  path: string;
  body: string;
  html_url: string;
}

const POLICY_PATHS = [
  "CONTRIBUTING.md",
  ".github/CONTRIBUTING.md",
  "docs/CONTRIBUTING.md",
  ".github/pull_request_template.md",
];

function githubHeaders(env: CheckEnvironment): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "BountyVerdict-Agent/1.0",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function githubJson(
  path: string,
  env: CheckEnvironment,
  fetchImpl: FetchLike,
  allowNotFound = false,
): Promise<GithubResponse> {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: githubHeaders(env),
  });
  const remainingValue = Number(response.headers.get("x-ratelimit-remaining"));
  const remaining = Number.isFinite(remainingValue) ? remainingValue : null;

  if (!response.ok) {
    if (response.status === 404 && allowNotFound) {
      return { data: null, remaining, link: response.headers.get("link") };
    }
    if (response.status === 404) {
      throw new CheckError("GitHub could not find that public issue.", 404, "ISSUE_NOT_FOUND");
    }
    if (response.status === 410) {
      throw new CheckError(
        "GitHub reports that this issue was deleted; any marketplace listing for it is stale.",
        410,
        "ISSUE_DELETED",
      );
    }
    if (response.status === 403 && remaining === 0) {
      throw new CheckError("GitHub API capacity is temporarily exhausted.", 503, "GITHUB_RATE_LIMITED");
    }
    throw new CheckError(`GitHub returned HTTP ${response.status}.`, 502, "GITHUB_UPSTREAM_ERROR");
  }

  return {
    data: await response.json(),
    remaining,
    link: response.headers.get("link"),
  };
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubPolicyDocument(
  base: string,
  path: string,
  env: CheckEnvironment,
  fetchImpl: FetchLike,
): Promise<{ document: PolicyDocument | null; response: GithubResponse }> {
  const response = await githubJson(
    `${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
    env,
    fetchImpl,
    true,
  );
  const file = response.data;
  if (
    !file ||
    file.type !== "file" ||
    file.encoding !== "base64" ||
    typeof file.content !== "string" ||
    typeof file.html_url !== "string"
  ) {
    return { document: null, response };
  }
  return {
    document: {
      path: file.path || path,
      body: decodeBase64Utf8(file.content),
      html_url: file.html_url,
    },
    response,
  };
}

function lastPageFromLink(link: string | null): number {
  if (!link) return 1;
  const last = link.split(",").find((part) => /rel="last"/.test(part));
  const match = last?.match(/[?&]page=(\d+)/);
  return match ? Number(match[1]) : 1;
}

function boundedEvidencePages(lastPage: number, limit: number): number[] {
  if (lastPage <= limit) return Array.from({ length: lastPage }, (_, index) => index + 1);
  return [1, ...Array.from({ length: limit - 1 }, (_, index) => lastPage - index)].sort((a, b) => a - b);
}

function canonicalIssueCoordinates(
  issue: any,
  fallback: { owner: string; repo: string; number: number },
): { owner: string; repo: string; number: number } {
  if (typeof issue?.repository_url !== "string") return fallback;
  let url: URL;
  try {
    url = new URL(issue.repository_url);
  } catch {
    throw new CheckError("GitHub returned an invalid canonical repository URL.", 502, "GITHUB_RESPONSE_INVALID");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const number = Number(issue.number);
  if (
    url.protocol !== "https:" || url.hostname !== "api.github.com" ||
    parts.length !== 3 || parts[0] !== "repos" || !parts[1] || !parts[2] ||
    !Number.isSafeInteger(number) || number < 1
  ) {
    throw new CheckError("GitHub returned invalid canonical issue coordinates.", 502, "GITHUB_RESPONSE_INVALID");
  }
  return { owner: parts[1], repo: parts[2], number };
}

function deduplicateEvidence(items: any[]): any[] {
  const seen = new Set<string>();
  return items.filter((item, index) => {
    const key = String(item?.id ?? item?.node_id ?? item?.html_url ?? `${item?.event ?? "item"}:${index}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectNonIssueObject(value: unknown): void {
  if (!isRecord(value)) {
    throw new CheckError("GitHub returned an invalid issue object.", 502, "GITHUB_RESPONSE_INVALID");
  }
  if (!("pull_request" in value)) return;
  if (!isRecord(value.pull_request)) {
    throw new CheckError("GitHub returned an invalid issue object.", 502, "GITHUB_RESPONSE_INVALID");
  }
  throw new CheckError(
    "That GitHub /issues URL resolves to a pull request, not an issue.",
    400,
    "NOT_AN_ISSUE",
  );
}

function isCommentEvidencePage(data: unknown): data is Array<Record<string, unknown>> {
  return Array.isArray(data) && data.every((item) =>
    isRecord(item) && typeof item.id === "number" && Number.isSafeInteger(item.id) && item.id > 0 &&
    typeof item.html_url === "string" && item.html_url.length > 0 &&
    typeof item.created_at === "string" && item.created_at.length > 0 &&
    (typeof item.body === "string" || item.body === null) &&
    typeof item.author_association === "string" &&
    (item.user === null || isRecord(item.user))
  );
}

function isTimelineEvidencePage(data: unknown): data is Array<Record<string, unknown>> {
  return Array.isArray(data) && data.every((item) =>
    isRecord(item) && typeof item.event === "string" && item.event.length > 0 &&
    typeof item.created_at === "string" && item.created_at.length > 0
  );
}

function summarize(verdict: AgentVerdict["verdict"]): string {
  if (verdict === "VIABLE") {
    return "No obvious public hard stop was found. Confirm reward terms and reproduce the issue before coding.";
  }
  if (verdict === "CAUTION") {
    return "Competition, staleness, or ambiguity makes this issue a risky use of agent compute.";
  }
  return "A public hard stop or severe risk signal makes this issue an unsafe bounty target.";
}

export async function checkGithubIssue(
  issueUrl: string,
  env: CheckEnvironment = {},
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<AgentVerdict> {
  let parsed;
  try {
    parsed = parseIssueUrl(issueUrl);
  } catch (error) {
    throw new CheckError(
      error instanceof Error ? error.message : "Invalid GitHub issue URL.",
      400,
      "INVALID_ISSUE_URL",
    );
  }

  const submitted = parsed;
  const submittedBase = `/repos/${encodeURIComponent(submitted.owner)}/${encodeURIComponent(submitted.repo)}`;
  const issueResponse = await githubJson(`${submittedBase}/issues/${submitted.number}`, env, fetchImpl);
  rejectNonIssueObject(issueResponse.data);
  const canonical = canonicalIssueCoordinates(issueResponse.data, submitted);
  const { owner, repo, number } = canonical;
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repoResponse = await githubJson(base, env, fetchImpl);
  if (repoResponse.data?.private === true) {
    throw new CheckError("GitHub could not find that public issue.", 404, "ISSUE_NOT_FOUND");
  }

  const commentsTotal = issueResponse.data.comments;
  if (!Number.isSafeInteger(commentsTotal) || commentsTotal < 0) {
    throw new CheckError("GitHub returned an invalid issue comment count.", 502, "GITHUB_RESPONSE_INVALID");
  }
  const commentPageCount = Math.max(1, Math.ceil(commentsTotal / 100));
  const commentPages = boundedEvidencePages(commentPageCount, 3);
  const [commentResponses, firstTimeline, policyResponses] = await Promise.all([
    Promise.all(
      commentPages.map((page) =>
        githubJson(`${base}/issues/${number}/comments?per_page=100&page=${page}`, env, fetchImpl),
      ),
    ),
    githubJson(`${base}/issues/${number}/timeline?per_page=100&page=1`, env, fetchImpl),
    Promise.all(
      POLICY_PATHS.map((path) => githubPolicyDocument(base, path, env, fetchImpl)),
    ),
  ]);

  const timelineLastPage = lastPageFromLink(firstTimeline.link);
  const timelinePages = boundedEvidencePages(timelineLastPage, 4);
  const additionalTimelineResponses = await Promise.all(
    timelinePages.filter((page) => page !== 1).map((page) =>
      githubJson(`${base}/issues/${number}/timeline?per_page=100&page=${page}`, env, fetchImpl)
    ),
  );
  const timelineResponses = [firstTimeline, ...additionalTimelineResponses];
  if (commentResponses.some((response) => !isCommentEvidencePage(response.data)) ||
      timelineResponses.some((response) => !isTimelineEvidencePage(response.data))) {
    throw new CheckError("GitHub returned invalid issue evidence pages.", 502, "GITHUB_RESPONSE_INVALID");
  }
  const comments = deduplicateEvidence(commentResponses.flatMap((page) => page.data));
  const timeline = deduplicateEvidence(timelineResponses.flatMap((page) => page.data));
  const commentsTruncated = commentPageCount > commentPages.length || comments.length !== commentsTotal;
  const policyDocuments = policyResponses
    .map((result) => result.document)
    .filter((document): document is PolicyDocument => document !== null);
  const responses = [
    issueResponse,
    repoResponse,
    ...commentResponses,
    ...timelineResponses,
    ...policyResponses.map((result) => result.response),
  ].filter((value): value is GithubResponse => value !== null);
  const remainingValues = responses
    .map((response) => response.remaining)
    .filter((value): value is number => value !== null);

  const analysis = (analyzeBounty as unknown as (input: Record<string, unknown>) => AnalysisResult)({
    issue: issueResponse.data,
    repository: repoResponse.data,
    comments,
    timeline,
    policyDocuments,
    coverage: {
      commentsTruncated,
      timelineTruncated: timelineLastPage > timelinePages.length,
    },
    now,
  });

  return {
    product: "BountyVerdict",
    version: "1.0",
    verdict: analysis.verdict,
    score: analysis.score,
    summary: summarize(analysis.verdict),
    service_reuse: SERVICE_REUSE.single,
    issue: {
      url: issueResponse.data.html_url,
      submitted_url: issueUrl,
      transferred: owner.toLowerCase() !== submitted.owner.toLowerCase() ||
        repo.toLowerCase() !== submitted.repo.toLowerCase() || number !== submitted.number,
      title: issueResponse.data.title,
      state: issueResponse.data.state,
      repository: repoResponse.data.full_name,
    },
    signals: analysis.signals.map((item) => ({
      label: item.label,
      impact: item.impact,
      detail: item.detail,
      evidence_url: item.evidenceUrl,
      hard_stop: item.hardStop,
    })),
    contribution_policy: {
      ai_use: analysis.aiPolicyBlocks.length
        ? "BLOCKED"
        : analysis.aiPolicyRequirements.length
          ? "DISCLOSURE_REQUIRED"
          : "NO_EXPLICIT_RULE_FOUND",
      documents: policyDocuments.map((document) => ({
        path: document.path,
        url: document.html_url,
      })),
    },
    reward: {
      state: analysis.reward.state,
      verification: analysis.reward.verification,
      platform: analysis.reward.platform,
      amount: analysis.reward.amount,
      currency: analysis.reward.currency,
      evidence_url: analysis.reward.evidenceUrl,
    },
    coverage: {
      comments_scanned: comments.length,
      comments_total: commentsTotal,
      comment_pages_scanned: commentPages.length,
      comments_truncated: commentsTruncated,
      timeline_events_scanned: timeline.length,
      timeline_events_total: timelineLastPage > 1
        ? (timelineLastPage - 1) * 100 + timelineResponses.at(-1)!.data.length
        : firstTimeline.data.length,
      timeline_pages_scanned: timelinePages.length,
      timeline_truncated: timelineLastPage > timelinePages.length,
      linked_pull_requests_found: analysis.pullRequests.length,
      policy_documents_scanned: policyDocuments.length,
      github_rate_limit_remaining: remainingValues.length
        ? Math.min(...remainingValues)
        : null,
    },
    checked_at: now.toISOString(),
    limitations: [
      "A VIABLE verdict is permission to investigate, not a payout guarantee.",
      "Confirm current reward terms, payout eligibility, contribution policy, and acceptance criteria before coding.",
      "A trusted platform listing proves listing provenance, not escrow, acceptance, merge, or payout.",
      "When a mirror or source issue is linked, this check does not fetch that second issue; inspect it separately before coding.",
      "A marketplace listing can outlive its GitHub issue; deleted issues fail with ISSUE_DELETED instead of receiving a verdict.",
      "The check reads the first comment page plus up to two newest comment pages, and up to four bounded timeline pages; coverage reports any truncation.",
      "AI-policy detection checks four conventional contribution-document paths and may not find policies stored elsewhere.",
    ],
  };
}
