import { analyzeBounty, parseIssueUrl } from "../../analysis.js";

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
  issue: {
    url: string;
    title: string;
    state: string;
    repository: string;
  };
  signals: VerdictSignal[];
  coverage: {
    comments_scanned: number;
    timeline_events_scanned: number;
    linked_pull_requests_found: number;
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
): Promise<GithubResponse> {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: githubHeaders(env),
  });
  const remainingValue = Number(response.headers.get("x-ratelimit-remaining"));
  const remaining = Number.isFinite(remainingValue) ? remainingValue : null;

  if (!response.ok) {
    if (response.status === 404) {
      throw new CheckError("GitHub could not find that public issue.", 404, "ISSUE_NOT_FOUND");
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

function lastPageFromLink(link: string | null): number {
  if (!link) return 1;
  const last = link.split(",").find((part) => /rel="last"/.test(part));
  const match = last?.match(/[?&]page=(\d+)/);
  return match ? Number(match[1]) : 1;
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

  const { owner, repo, number } = parsed;
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const [issueResponse, repoResponse] = await Promise.all([
    githubJson(`${base}/issues/${number}`, env, fetchImpl),
    githubJson(base, env, fetchImpl),
  ]);

  const commentPageCount = Math.max(1, Math.ceil(issueResponse.data.comments / 100));
  const commentPages = Array.from(
    { length: Math.min(3, commentPageCount) },
    (_, index) => index + 1,
  );
  const [commentResponses, firstTimeline] = await Promise.all([
    Promise.all(
      commentPages.map((page) =>
        githubJson(`${base}/issues/${number}/comments?per_page=100&page=${page}`, env, fetchImpl),
      ),
    ),
    githubJson(`${base}/issues/${number}/timeline?per_page=100&page=1`, env, fetchImpl),
  ]);

  const timelineLastPage = lastPageFromLink(firstTimeline.link);
  const lastTimeline = timelineLastPage > 1
    ? await githubJson(
        `${base}/issues/${number}/timeline?per_page=100&page=${timelineLastPage}`,
        env,
        fetchImpl,
      )
    : null;
  const comments = commentResponses.flatMap((page) => page.data);
  const timeline = lastTimeline
    ? [...firstTimeline.data, ...lastTimeline.data]
    : firstTimeline.data;
  const responses = [
    issueResponse,
    repoResponse,
    ...commentResponses,
    firstTimeline,
    lastTimeline,
  ].filter((value): value is GithubResponse => value !== null);
  const remainingValues = responses
    .map((response) => response.remaining)
    .filter((value): value is number => value !== null);

  const analysis = (analyzeBounty as unknown as (input: Record<string, unknown>) => AnalysisResult)({
    issue: issueResponse.data,
    repository: repoResponse.data,
    comments,
    timeline,
    now,
  });

  return {
    product: "BountyVerdict",
    version: "1.0",
    verdict: analysis.verdict,
    score: analysis.score,
    summary: summarize(analysis.verdict),
    issue: {
      url: issueResponse.data.html_url,
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
    coverage: {
      comments_scanned: comments.length,
      timeline_events_scanned: timeline.length,
      linked_pull_requests_found: analysis.pullRequests.length,
      github_rate_limit_remaining: remainingValues.length
        ? Math.min(...remainingValues)
        : null,
    },
    checked_at: now.toISOString(),
    limitations: [
      "A VIABLE verdict is permission to investigate, not a payout guarantee.",
      "Confirm current reward terms, payout eligibility, contribution policy, and acceptance criteria before coding.",
      "The check reads at most 300 comments plus the first and newest timeline pages.",
    ],
  };
}
