import { analyzeBounty, externalSourceIssue, parseIssueUrl } from "../../analysis.js";
import { fetchBountyHubEvidence } from "./bountyhub.ts";
import {
  fetchIssueHuntEvidence,
  hasIssueHuntReference,
  issueHuntReferenceRoutes,
} from "./issuehunt.ts";
import { fetchLightningBountiesEvidence } from "./lightning-bounties.ts";
import { fetchOpireEvidence } from "./opire.ts";
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
  task_requirements: {
    agent_execution: "BLOCKED" | "CAPABILITY_REVIEW_REQUIRED" | "NO_EXPLICIT_BLOCKER_FOUND";
    blockers: Array<{
      category: "HUMAN_ELIGIBILITY_OR_IDENTITY" | "SYNCHRONOUS_HUMAN_PARTICIPATION" | "AI_AGENT_EXCLUDED";
      source: "issue_body" | "maintainer_comment" | "repository_policy";
      evidence_url: string;
    }>;
    capability_requirements: Array<
      "ACCOUNT_OR_REGISTRATION" |
      "API_KEY_OR_PROVIDER_DATA" |
      "DEMO_VIDEO" |
      "PUBLIC_SOCIAL_POSTING_OR_ENGAGEMENT" |
      "SPECIALIZED_HARDWARE" |
      "GATED_PLATFORM_VALIDATION"
    >;
  };
  reward: {
    state: "LISTED" | "PROMISED" | "UNVERIFIED" | "NOT_FOUND" | "WITHDRAWN" | "PAID_OR_AWARDED";
    verification: "TRUSTED_PLATFORM_APP" | "TRUSTED_PLATFORM_API" | "MAINTAINER_STATEMENT" | "UNVERIFIED" | "NONE";
    platform: string | null;
    amount: number | null;
    currency: string | null;
    evidence_url: string | null;
  };
  linked_source: {
    state: "NOT_APPLICABLE" | "CHECKED" | "UNAVAILABLE" | "DEPTH_LIMITED";
    url: string | null;
    verdict: AgentVerdict["verdict"] | null;
    reward_state: AgentVerdict["reward"]["state"] | null;
    reward_verification: AgentVerdict["reward"]["verification"] | null;
    error_code: string | null;
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
    policy_issues_truncated: boolean;
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
  taskAutonomyBlockers: Array<{
    category: AgentVerdict["task_requirements"]["blockers"][number]["category"];
    source: AgentVerdict["task_requirements"]["blockers"][number]["source"];
    evidenceUrl: string;
  }>;
  externalPrerequisites: string[];
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

const capabilityRequirementMap = Object.freeze({
  "account or registration": "ACCOUNT_OR_REGISTRATION",
  "API key or provider data": "API_KEY_OR_PROVIDER_DATA",
  "demo video": "DEMO_VIDEO",
  "public social posting or engagement": "PUBLIC_SOCIAL_POSTING_OR_ENGAGEMENT",
  "specialized hardware": "SPECIALIZED_HARDWARE",
  "gated platform validation": "GATED_PLATFORM_VALIDATION",
} as const);

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
const REPOSITORY_POLICY_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const BOUNTY_POLICY_TITLE_PATTERN =
  /\b(?:bount(?:y|ies)|rewards?)\b.{0,80}\b(?:guidelines?|polic(?:y|ies)|rules?|read\s+(?:first|before|and\s+obey))\b|\b(?:guidelines?|polic(?:y|ies)|rules?|read\s+(?:first|before|and\s+obey))\b.{0,80}\b(?:bount(?:y|ies)|rewards?)\b/i;
const BOUNTY_POLICY_REPOSITORY_SCOPE_PATTERN =
  /\b(?:guidelines?|polic(?:y|ies)|rules?)\b[^.\n]{0,120}\b(?:bount(?:y|ies)|rewards?|payments?)\b[^.\n]{0,100}\b(?:for|in|across)\s+(?:this|the|our)\s+(?:repository|repo)\b|\b(?:bount(?:y|ies)|rewards?|payments?)\b[^.\n]{0,100}\b(?:for|in|across)\s+(?:this|the|our)\s+(?:repository|repo)\b|\brepository[ -]wide\b[^.\n]{0,80}\b(?:bount(?:y|ies)|rewards?|payments?)\b|\b(?:this|the|our)\s+(?:repository|repo)\b[^.\n]{0,100}\b(?:does not|doesn['’]?t|never|will not|won['’]?t)\b[^.\n]{0,80}\b(?:pay|fund|offer|honou?r)\b[^.\n]{0,80}\b(?:bount(?:y|ies)|rewards?|contributions?)\b/i;
const maximumRepositoryPolicyPages = 5;
const maximumGithubJsonBytes = 2_000_000;
const githubRequestTimeoutMs = 10_000;

function githubHeaders(env: CheckEnvironment): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "BountyVerdict-Agent/1.0",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function boundedGithubJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new CheckError("GitHub returned an invalid content length.", 502, "GITHUB_RESPONSE_INVALID");
    }
    if (bytes > maximumGithubJsonBytes) {
      throw new CheckError("GitHub returned an oversized JSON response.", 502, "GITHUB_RESPONSE_TOO_LARGE");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new CheckError("GitHub returned an empty JSON response.", 502, "GITHUB_RESPONSE_INVALID");
  }
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumGithubJsonBytes) {
        await reader.cancel();
        throw new CheckError("GitHub returned an oversized JSON response.", 502, "GITHUB_RESPONSE_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new CheckError("GitHub returned invalid JSON.", 502, "GITHUB_RESPONSE_INVALID");
  }
}

async function githubJson(
  path: string,
  env: CheckEnvironment,
  fetchImpl: FetchLike,
  allowNotFound = false,
): Promise<GithubResponse> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), githubRequestTimeoutMs);
    try {
      const response = await fetchImpl(`https://api.github.com${path}`, {
        headers: githubHeaders(env),
        signal: controller.signal,
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
        data: await boundedGithubJson(response),
        remaining,
        link: response.headers.get("link"),
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new CheckError("GitHub did not respond within the bounded request window.", 504, "GITHUB_UPSTREAM_TIMEOUT");
      }
      // A successful HTTP response with broken JSON framing is safe to read once
      // more. Semantic evidence validation happens after this function returns,
      // so malformed GitHub objects still fail closed without a retry.
      if (attempt === 0 && error instanceof CheckError && error.code === "GITHUB_RESPONSE_INVALID") {
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new CheckError("GitHub returned invalid JSON.", 502, "GITHUB_RESPONSE_INVALID");
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

function repositoryBountyPolicyDocuments(
  value: unknown,
  currentIssueNumber: number,
  canonical: { owner: string; repo: string },
): PolicyDocument[] {
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new CheckError("GitHub returned an invalid repository issue policy page.", 502, "GITHUB_RESPONSE_INVALID");
  }
  return value.flatMap((item): PolicyDocument[] => {
    if (!isRecord(item)) {
      throw new CheckError("GitHub returned an invalid repository issue policy page.", 502, "GITHUB_RESPONSE_INVALID");
    }
    if ("pull_request" in item || item.number === currentIssueNumber ||
        typeof item.title !== "string" || !BOUNTY_POLICY_TITLE_PATTERN.test(item.title) ||
        typeof item.body !== "string" || !BOUNTY_POLICY_REPOSITORY_SCOPE_PATTERN.test(item.body) ||
        !REPOSITORY_POLICY_ASSOCIATIONS.has(String(item.author_association))) {
      return [];
    }
    if (!Number.isSafeInteger(item.number) || Number(item.number) < 1 ||
        typeof item.html_url !== "string") {
      throw new CheckError("GitHub returned an invalid repository bounty policy issue.", 502, "GITHUB_RESPONSE_INVALID");
    }
    let coordinates;
    try {
      coordinates = parseIssueUrl(item.html_url);
    } catch {
      throw new CheckError("GitHub returned an invalid repository bounty policy issue.", 502, "GITHUB_RESPONSE_INVALID");
    }
    if (coordinates.owner.toLowerCase() !== canonical.owner.toLowerCase() ||
        coordinates.repo.toLowerCase() !== canonical.repo.toLowerCase() ||
        coordinates.number !== item.number) {
      throw new CheckError("GitHub returned an invalid repository bounty policy issue.", 502, "GITHUB_RESPONSE_INVALID");
    }
    return [{
      path: `repository-bounty-policy-issue-${item.number}`,
      body: item.body,
      html_url: item.html_url,
    }];
  });
}

function repositoryIssueLinkPages(
  link: string | null,
  direction: "asc" | "desc",
  canonical: { owner: string; repo: string },
  repositoryId: unknown,
): Partial<Record<"next" | "prev" | "first" | "last", number>> {
  if (link === null) return {};
  const pages: Partial<Record<"next" | "prev" | "first" | "last", number>> = {};
  for (const part of link.split(",")) {
    const target = part.match(/^\s*<([^>]+)>/i)?.[1];
    const relations = part.match(/;\s*rel="([^"]+)"/i)?.[1]?.split(/\s+/).filter(Boolean);
    if (!target || !relations?.length) {
      throw new CheckError("GitHub returned invalid repository policy pagination.", 502, "GITHUB_RESPONSE_INVALID");
    }
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new CheckError("GitHub returned invalid repository policy pagination.", 502, "GITHUB_RESPONSE_INVALID");
    }
    const canonicalPath = `/repos/${encodeURIComponent(canonical.owner)}/${encodeURIComponent(canonical.repo)}/issues`;
    const numericRepositoryId = Number(repositoryId);
    const repositoryIdPath = Number.isSafeInteger(numericRepositoryId) && numericRepositoryId > 0
      ? `/repositories/${numericRepositoryId}/issues`
      : null;
    const allowedPath = url.pathname.toLowerCase() === canonicalPath.toLowerCase() ||
      (repositoryIdPath !== null && url.pathname === repositoryIdPath);
    const allowedParameters = new Set(["state", "sort", "direction", "per_page", "page", "after", "before"]);
    const safeParameters = [...url.searchParams.keys()].every((key) =>
      allowedParameters.has(key) && url.searchParams.getAll(key).length === 1
    );
    const cursorValues = [url.searchParams.get("after"), url.searchParams.get("before")]
      .filter((value): value is string => value !== null);
    const page = Number(url.searchParams.get("page"));
    if (url.origin !== "https://api.github.com" || !allowedPath || !safeParameters ||
        url.searchParams.get("state") !== "all" || url.searchParams.get("sort") !== "created" ||
        url.searchParams.get("direction") !== direction || url.searchParams.get("per_page") !== "100" ||
        !Number.isSafeInteger(page) || page < 1 || page > 10_000 ||
        cursorValues.some((value) => value.length < 1 || value.length > 1_024)) {
      throw new CheckError("GitHub returned invalid repository policy pagination.", 502, "GITHUB_RESPONSE_INVALID");
    }
    for (const relation of relations) {
      if (!["next", "prev", "first", "last"].includes(relation) || relation in pages) {
        throw new CheckError("GitHub returned invalid repository policy pagination.", 502, "GITHUB_RESPONSE_INVALID");
      }
      pages[relation as keyof typeof pages] = page;
    }
  }
  return pages;
}

function repositoryPolicyPagePlan(
  response: GithubResponse,
  canonical: { owner: string; repo: string },
  repositoryId: unknown,
): {
  mode: "numbered" | "cursor";
  pages: number[];
  total_pages: number | null;
  truncated: boolean;
} {
  if (response.data === null) {
    return { mode: "numbered", pages: [], total_pages: null, truncated: true };
  }
  if (!Array.isArray(response.data) || response.data.length > 100) {
    throw new CheckError("GitHub returned an invalid repository issue policy page.", 502, "GITHUB_RESPONSE_INVALID");
  }
  if (response.link === null) {
    return {
      mode: "numbered",
      pages: [1],
      total_pages: response.data.length === 100 ? null : 1,
      truncated: response.data.length === 100,
    };
  }
  const links = repositoryIssueLinkPages(response.link, "asc", canonical, repositoryId);
  if (links.last === undefined) {
    if (links.next === undefined) {
      throw new CheckError("GitHub returned invalid repository policy pagination.", 502, "GITHUB_RESPONSE_INVALID");
    }
    return {
      mode: "cursor",
      pages: Array.from({ length: maximumRepositoryPolicyPages - 1 }, (_, index) => index + 1),
      total_pages: null,
      truncated: true,
    };
  }
  const totalPages = links.last;
  if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 10_000) {
    throw new CheckError("GitHub returned invalid repository policy pagination.", 502, "GITHUB_RESPONSE_INVALID");
  }
  const pages = boundedEvidencePages(totalPages, maximumRepositoryPolicyPages);
  return {
    mode: "numbered",
    pages,
    total_pages: totalPages,
    truncated: totalPages > pages.length,
  };
}

function deduplicatePolicyDocuments(documents: PolicyDocument[]): PolicyDocument[] {
  const unique = new Map<string, PolicyDocument>();
  for (const document of documents) {
    const existing = unique.get(document.path);
    if (!existing) {
      unique.set(document.path, document);
      continue;
    }
    if (existing.body !== document.body || existing.html_url !== document.html_url) {
      throw new CheckError("GitHub returned conflicting repository policy evidence.", 502, "GITHUB_RESPONSE_INVALID");
    }
  }
  return [...unique.values()];
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

function summarize(verdict: AgentVerdict["verdict"], hasHardStop: boolean): string {
  if (verdict === "VIABLE") {
    return "No obvious public hard stop was found. Confirm reward terms and reproduce the issue before coding.";
  }
  if (verdict === "CAUTION") {
    return "Competition, staleness, or ambiguity makes this issue a risky use of agent compute.";
  }
  if (!hasHardStop) {
    return "Cumulative public risk and competition signals make this issue an unsafe bounty target, even though no single hard stop was found.";
  }
  return "A public hard stop or severe risk signal makes this issue an unsafe bounty target.";
}

async function fetchCanonicalIssueHuntEvidence(
  issue: unknown,
  comments: unknown[],
  canonical: { owner: string; repo: string; number: number },
  submitted: { owner: string; repo: string; number: number },
  repositoryGithubId: unknown,
  fetchImpl: FetchLike,
) {
  if (!hasIssueHuntReference(issue, comments) ||
      typeof repositoryGithubId !== "number" || !Number.isSafeInteger(repositoryGithubId) ||
      repositoryGithubId < 1) return null;

  const candidates = [
    canonical,
    submitted,
    ...issueHuntReferenceRoutes(issue, comments, canonical.number),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.owner.toLowerCase()}/${candidate.repo.toLowerCase()}/${candidate.number}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // IssueHunt records can retain a pre-transfer route. The submitted GitHub URL
    // or exact issue-body reference supplies only a route candidate;
    // parseIssueHuntPage must still bind it to the canonical repository's
    // immutable GitHub ID and exact issue number before it becomes evidence.
    const evidence = await fetchIssueHuntEvidence(
      candidate.owner,
      candidate.repo,
      repositoryGithubId,
      candidate.number,
      fetchImpl,
    );
    if (evidence) return evidence;
  }
  return null;
}

async function fetchCanonicalBountyHubEvidence(
  canonical: { owner: string; repo: string; number: number },
  submitted: { owner: string; repo: string; number: number },
  fetchImpl: FetchLike,
) {
  const canonicalEvidence = await fetchBountyHubEvidence(
    canonical.owner,
    canonical.repo,
    canonical.number,
    fetchImpl,
  );
  if (canonicalEvidence) return canonicalEvidence;

  const transferred = canonical.owner.toLowerCase() !== submitted.owner.toLowerCase() ||
    canonical.repo.toLowerCase() !== submitted.repo.toLowerCase() ||
    canonical.number !== submitted.number;
  if (!transferred) return null;

  // The submitted GitHub URL has already resolved to the canonical issue. That
  // redirect proof permits one exact pre-transfer BountyHub lookup, while the
  // platform parser still requires the old repository and issue coordinates to
  // match every collection and detail record.
  return fetchBountyHubEvidence(
    submitted.owner,
    submitted.repo,
    submitted.number,
    fetchImpl,
  );
}

export async function checkGithubIssue(
  issueUrl: string,
  env: CheckEnvironment = {},
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<AgentVerdict> {
  return checkGithubIssueInternal(issueUrl, env, fetchImpl, now, true);
}

async function checkGithubIssueInternal(
  issueUrl: string,
  env: CheckEnvironment,
  fetchImpl: FetchLike,
  now: Date,
  inspectLinkedSource: boolean,
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
  const [commentResponses, firstTimeline, policyResponses, firstRepositoryIssuePolicyResponse] = await Promise.all([
    Promise.all(
      commentPages.map((page) =>
        githubJson(`${base}/issues/${number}/comments?per_page=100&page=${page}`, env, fetchImpl),
      ),
    ),
    githubJson(`${base}/issues/${number}/timeline?per_page=100&page=1`, env, fetchImpl),
    Promise.all(
      POLICY_PATHS.map((path) => githubPolicyDocument(base, path, env, fetchImpl)),
    ),
    githubJson(
      `${base}/issues?state=all&sort=created&direction=asc&per_page=100&page=1`,
      env,
      fetchImpl,
      true,
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
  const repositoryPolicyPlan = repositoryPolicyPagePlan(
    firstRepositoryIssuePolicyResponse,
    canonical,
    repoResponse.data?.id,
  );
  const additionalRepositoryIssuePolicyResponses = await Promise.all(
    repositoryPolicyPlan.pages.filter((page) => repositoryPolicyPlan.mode === "cursor" || page !== 1).map((page) =>
      githubJson(
        `${base}/issues?state=all&sort=created&direction=${repositoryPolicyPlan.mode === "cursor" ? "desc" : "asc"}&per_page=100&page=${page}`,
        env,
        fetchImpl,
      )
    ),
  );
  const repositoryIssuePolicyResponses = [
    firstRepositoryIssuePolicyResponse,
    ...additionalRepositoryIssuePolicyResponses,
  ];
  const policyIssuesTruncated = repositoryPolicyPlan.mode === "cursor"
    ? repositoryIssueLinkPages(
      additionalRepositoryIssuePolicyResponses.at(-1)?.link ?? null,
      "desc",
      canonical,
      repoResponse.data?.id,
    ).next !== undefined
    : repositoryPolicyPlan.truncated;
  if (commentResponses.some((response) => !isCommentEvidencePage(response.data)) ||
      timelineResponses.some((response) => !isTimelineEvidencePage(response.data))) {
    throw new CheckError("GitHub returned invalid issue evidence pages.", 502, "GITHUB_RESPONSE_INVALID");
  }
  const comments = deduplicateEvidence(commentResponses.flatMap((page) => page.data));
  const timeline = deduplicateEvidence(timelineResponses.flatMap((page) => page.data));
  const [bountyHubEvidence, issueHuntEvidence, lightningEvidence, opireEvidence] = await Promise.all([
    fetchCanonicalBountyHubEvidence(canonical, submitted, fetchImpl),
    fetchCanonicalIssueHuntEvidence(
      issueResponse.data,
      comments,
      canonical,
      submitted,
      repoResponse.data?.id,
      fetchImpl,
    ),
    Number.isSafeInteger(issueResponse.data?.id) && Number(issueResponse.data.id) > 0
      ? fetchLightningBountiesEvidence(
          Number(issueResponse.data.id),
          [
            canonical,
            ...(canonical.owner.toLowerCase() !== submitted.owner.toLowerCase() ||
                canonical.repo.toLowerCase() !== submitted.repo.toLowerCase() ||
                canonical.number !== submitted.number
              ? [submitted]
              : []),
          ],
          fetchImpl,
        )
      : Promise.resolve(null),
    Number.isSafeInteger(issueResponse.data?.id) && Number(issueResponse.data.id) > 0 &&
        Number.isSafeInteger(repoResponse.data?.id) && Number(repoResponse.data.id) > 0
      ? fetchOpireEvidence(
          canonical.owner,
          canonical.repo,
          canonical.number,
          Number(issueResponse.data.id),
          Number(repoResponse.data.id),
          fetchImpl,
        )
      : Promise.resolve(null),
  ]);
  const bountyHubTerminal = bountyHubEvidence &&
    ["SOLVED", "RETRACTED", "FROZEN", "CLAIMED"].includes(bountyHubEvidence.state);
  const platformEvidence = lightningEvidence?.state === "AWARDED"
    ? lightningEvidence
    : issueHuntEvidence?.state === "REWARDED"
      ? issueHuntEvidence
    : bountyHubTerminal
      ? bountyHubEvidence
      : opireEvidence?.claim_count
        ? opireEvidence
      : bountyHubEvidence || opireEvidence || lightningEvidence;
  const commentsTruncated = commentPageCount > commentPages.length || comments.length !== commentsTotal;
  const policyDocuments = deduplicatePolicyDocuments(policyResponses
    .map((result) => result.document)
    .filter((document): document is PolicyDocument => document !== null)
    .concat(repositoryIssuePolicyResponses.flatMap((response) =>
      repositoryBountyPolicyDocuments(response.data, canonical.number, canonical)
    )));
  const responses = [
    issueResponse,
    repoResponse,
    ...commentResponses,
    ...timelineResponses,
    ...policyResponses.map((result) => result.response),
    ...repositoryIssuePolicyResponses,
  ].filter((value): value is GithubResponse => value !== null);
  const remainingValues = responses
    .map((response) => response.remaining)
    .filter((value): value is number => value !== null);

  const analysis = (analyzeBounty as unknown as (input: Record<string, unknown>) => AnalysisResult)({
    issue: issueResponse.data,
    repository: repoResponse.data,
    comments,
    timeline,
    issueAliases: owner.toLowerCase() !== submitted.owner.toLowerCase() ||
        repo.toLowerCase() !== submitted.repo.toLowerCase() || number !== submitted.number
      ? [submitted]
      : [],
    platformEvidence,
    policyDocuments,
    coverage: {
      commentsTruncated,
      timelineTruncated: timelineLastPage > timelinePages.length,
      policyTruncated: policyIssuesTruncated,
    },
    now,
  });

  const linkedCoordinates = externalSourceIssue(issueResponse.data, repoResponse.data);
  let linkedVerdict: AgentVerdict | null = null;
  let linkedErrorCode: string | null = null;
  if (linkedCoordinates && inspectLinkedSource) {
    try {
      linkedVerdict = await checkGithubIssueInternal(linkedCoordinates.url, env, fetchImpl, now, false);
    } catch (error) {
      linkedErrorCode = error instanceof CheckError ? error.code : "LINKED_SOURCE_CHECK_FAILED";
    }
  }
  const linkedSourceHardStop = Boolean(linkedCoordinates) && inspectLinkedSource &&
    (linkedErrorCode !== null || linkedVerdict?.verdict === "AVOID");
  const independentlyTrustedReward =
    (analysis.reward.verification === "TRUSTED_PLATFORM_API" ||
      analysis.reward.verification === "TRUSTED_PLATFORM_APP") &&
    analysis.reward.platform !== "IssueHunt";
  const unverifiedIssueHuntFunding = issueHuntEvidence?.state === "ACTIVE_UNVERIFIED" &&
    !independentlyTrustedReward;
  const issueHuntSubmittedOutputs = issueHuntEvidence?.state === "ACTIVE_UNVERIFIED"
    ? issueHuntEvidence.submitted_pull_requests
    : [];
  const issueHuntSubmissionHardStop = issueHuntSubmittedOutputs.length > 0;
  const finalVerdict: AgentVerdict["verdict"] = linkedSourceHardStop || unverifiedIssueHuntFunding ||
      issueHuntSubmissionHardStop
    ? "AVOID"
    : analysis.verdict;
  const signals: VerdictSignal[] = analysis.signals.map((item) => ({
    label: item.label,
    impact: item.impact,
    detail: item.detail,
    evidence_url: item.evidenceUrl,
    hard_stop: item.hardStop,
  }));
  if (linkedSourceHardStop) {
    signals.push({
      label: linkedErrorCode ? "External source issue could not be verified" : "External source issue is not actionable",
      impact: -100,
      detail: linkedErrorCode
        ? `The explicitly linked source issue could not be verified (${linkedErrorCode}). Do not start mirrored work without authoritative source evidence.`
        : `The explicitly linked source issue returned ${linkedVerdict!.verdict}; authority or payment language in this mirror cannot override the source repository's hard stops.`,
      evidence_url: linkedCoordinates!.url,
      hard_stop: true,
    });
  } else if (linkedVerdict) {
    signals.push({
      label: "External source issue checked",
      impact: 0,
      detail: `The explicitly linked source issue returned ${linkedVerdict.verdict}. The mirror still requires separate acceptance and payout verification.`,
      evidence_url: linkedCoordinates!.url,
      hard_stop: false,
    });
  }
  if (unverifiedIssueHuntFunding) {
    signals.push({
      label: "IssueHunt funding is not currently collectible evidence",
      impact: -100,
      detail: "IssueHunt's public funded/ready pages expose historical deposit accounting but not the original purchase date for balance-funded deposits, current reserve or withdrawability, or the contributor share required to prove a collectible reward under its 180-day rules. Require authenticated platform or explicit independent funding evidence before starting work.",
      evidence_url: "https://oss.issuehunt.io/terms",
      hard_stop: true,
    });
  }
  if (issueHuntSubmissionHardStop) {
    signals.push({
      label: "Bounty platform reports submitted outputs",
      impact: -70,
      detail: `IssueHunt lists ${issueHuntSubmittedOutputs.length} non-cancelled pull request submission${issueHuntSubmittedOutputs.length === 1 ? "" : "s"}; verify current GitHub state before considering duplicate work.`,
      evidence_url: issueHuntSubmittedOutputs[0],
      hard_stop: true,
    });
  }
  const finalScore = linkedSourceHardStop || unverifiedIssueHuntFunding || issueHuntSubmissionHardStop
    ? 0
    : analysis.score;
  const projectIssueHuntReward = unverifiedIssueHuntFunding &&
    !new Set(["PAID_OR_AWARDED", "WITHDRAWN"]).has(analysis.reward.state);

  return {
    product: "BountyVerdict",
    version: "1.0",
    verdict: finalVerdict,
    score: finalScore,
    summary: summarize(finalVerdict, signals.some((item) => item.hard_stop)),
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
    signals,
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
    task_requirements: {
      agent_execution: analysis.taskAutonomyBlockers.length
        ? "BLOCKED"
        : analysis.externalPrerequisites.length
          ? "CAPABILITY_REVIEW_REQUIRED"
        : "NO_EXPLICIT_BLOCKER_FOUND",
      blockers: analysis.taskAutonomyBlockers.map((blocker) => ({
        category: blocker.category,
        source: blocker.source,
        evidence_url: blocker.evidenceUrl,
      })),
      capability_requirements: analysis.externalPrerequisites.flatMap((requirement) => {
        const mapped = capabilityRequirementMap[requirement as keyof typeof capabilityRequirementMap];
        return mapped ? [mapped] : [];
      }),
    },
    reward: {
      state: projectIssueHuntReward ? "UNVERIFIED" : analysis.reward.state,
      verification: projectIssueHuntReward ? "UNVERIFIED" : analysis.reward.verification,
      platform: projectIssueHuntReward ? "IssueHunt" : analysis.reward.platform,
      amount: projectIssueHuntReward ? null : analysis.reward.amount,
      currency: projectIssueHuntReward ? null : analysis.reward.currency,
      evidence_url: projectIssueHuntReward ? issueHuntEvidence!.evidence_url : analysis.reward.evidenceUrl,
    },
    linked_source: linkedCoordinates
      ? inspectLinkedSource
        ? {
            state: linkedVerdict ? "CHECKED" : "UNAVAILABLE",
            url: linkedCoordinates.url,
            verdict: linkedVerdict?.verdict ?? null,
            reward_state: linkedVerdict?.reward.state ?? null,
            reward_verification: linkedVerdict?.reward.verification ?? null,
            error_code: linkedErrorCode,
          }
        : {
            state: "DEPTH_LIMITED",
            url: linkedCoordinates.url,
            verdict: null,
            reward_state: null,
            reward_verification: null,
            error_code: null,
          }
      : {
          state: "NOT_APPLICABLE",
          url: null,
          verdict: null,
          reward_state: null,
          reward_verification: null,
          error_code: null,
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
      policy_issues_truncated: policyIssuesTruncated,
      github_rate_limit_remaining: remainingValues.length
        ? Math.min(...remainingValues)
        : null,
    },
    checked_at: now.toISOString(),
    limitations: [
      "A VIABLE verdict is permission to investigate, not a payout guarantee.",
      "Confirm current reward terms, payout eligibility, contribution policy, and acceptance criteria before coding.",
      "A trusted platform record proves platform-reported listing or funding state, not acceptance, merge, or payout.",
      "Public IssueHunt funded/ready pages are excluded from trusted active reward evidence because they do not prove that displayed deposits remain collectible under the platform's 180-day validity rules; terminal rewarded records remain conservative hard stops.",
      "A terminal IssueHunt rewarded amount is the platform's gross deposited reward; the public proof chain separately reports fees and shares, so the displayed amount must not be treated as contributor net proceeds.",
      "One explicitly linked external GitHub source issue is checked recursively; longer mirror chains stop after that bounded hop and remain non-actionable without separate verification.",
      "A marketplace listing can outlive its GitHub issue; deleted issues fail with ISSUE_DELETED instead of receiving a verdict.",
      "The check reads the first comment page plus up to two newest comment pages, and up to four bounded timeline pages; coverage reports any truncation.",
      "Checks four contribution paths and up to five bounded issue pages for repository-wide bounty policies; truncated policy coverage prevents VIABLE.",
      "Task-requirement detection checks the issue body and maintainer-authored comments for explicit human-identity, synchronous-participation, and AI-agent exclusions, and repository policy documents for explicit automated bounty claim or assignment bans; absence of a blocker is not proof that autonomous completion is possible.",
    ],
  };
}
