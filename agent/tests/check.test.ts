import test from "node:test";
import assert from "node:assert/strict";
import { CheckError, checkGithubIssue } from "../src/check.ts";

const issue = {
  state: "open",
  locked: false,
  active_lock_reason: null,
  assignees: [],
  updated_at: "2026-07-19T12:00:00Z",
  html_url: "https://github.com/acme/widget/issues/4",
  title: "Fix widget alignment",
  body: "This $100 bounty has a reproducible and bounded specification with clear current behavior, expected behavior, and acceptance criteria that are long enough.",
  author_association: "OWNER",
  comments: 1,
};

const repository = {
  archived: false,
  pushed_at: "2026-07-19T12:00:00Z",
  html_url: "https://github.com/acme/widget",
  full_name: "acme/widget",
};

function githubMock(comments: unknown[] = [], policy: string | null = null, issueOverride = issue): typeof fetch {
  return async (input) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) return Response.json(issueOverride, { headers });
    if (/\/repos\/acme\/widget$/.test(url)) return Response.json(repository, { headers });
    if (/\/comments\?/.test(url)) return Response.json(comments, { headers });
    if (/\/timeline\?/.test(url)) return Response.json([], { headers });
    if (policy && /\/contents\/CONTRIBUTING\.md$/.test(url)) {
      return Response.json({
        type: "file",
        path: "CONTRIBUTING.md",
        encoding: "base64",
        content: Buffer.from(policy).toString("base64"),
        html_url: "https://github.com/acme/widget/blob/main/CONTRIBUTING.md",
      }, { headers });
    }
    return Response.json({ message: "not found" }, { status: 404, headers });
  };
}

test("returns structured evidence for a viable issue", async () => {
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.verdict, "VIABLE");
  assert.equal(result.issue.repository, "acme/widget");
  assert.equal(result.coverage.comments_scanned, 0);
  assert.equal(result.coverage.policy_documents_scanned, 0);
  assert.equal(result.coverage.github_rate_limit_remaining, 4990);
  assert.ok(result.signals.some((signal) => signal.label === "No linked open PR found"));
});

test("paid check reads repository policy and blocks prohibited AI work", async () => {
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock([], "We do not accept contributions generated or assisted by AI or an LLM."),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.verdict, "AVOID");
  assert.equal(result.contribution_policy.ai_use, "BLOCKED");
  assert.equal(result.contribution_policy.documents[0]?.path, "CONTRIBUTING.md");
  assert.equal(result.coverage.policy_documents_scanned, 1);
});

test("returns AVOID when a maintainer rejects AI bounty work", async () => {
  const comments = [{
    body: "Locking this because it only attracts AI slop from bounty hunters.",
    author_association: "MEMBER",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-1",
    user: { login: "maintainer" },
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.verdict, "AVOID");
  assert.ok(result.signals.some((signal) => signal.hard_stop));
});

test("returns AVOID when GitHub already lists an assignee", async () => {
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock([], null, { ...issue, assignees: [{ login: "assigned-solver" }] }),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.verdict, "AVOID");
  assert.ok(result.signals.some((signal) => signal.label === "Issue is already assigned" && signal.hard_stop));
});

test("returns AVOID for an unconfirmed bounty posted by a non-maintainer", async () => {
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock([], null, { ...issue, author_association: "NONE" }),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "UNVERIFIED");
  assert.equal(result.verdict, "AVOID");
  assert.ok(result.signals.some((signal) =>
    signal.label === "Bounty issuer lacks repository authority" && signal.hard_stop
  ));
});

test("rejects a non-issue URL before making an upstream request", async () => {
  let fetched = false;
  const mock = (async () => {
    fetched = true;
    return Response.json({});
  }) as typeof fetch;

  await assert.rejects(
    () => checkGithubIssue("https://github.com/acme/widget/pull/4", {}, mock),
    (error: unknown) => {
      assert.ok(error instanceof CheckError);
      assert.equal(error.code, "INVALID_ISSUE_URL");
      assert.equal(error.status, 400);
      return true;
    },
  );
  assert.equal(fetched, false);
});

test("does not expose private issues through a server credential", async () => {
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) return Response.json(issue, { headers });
    if (/\/repos\/acme\/widget$/.test(url)) return Response.json({ ...repository, private: true }, { headers });
    throw new Error(`Unexpected private-repository follow-up request: ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () => checkGithubIssue("https://github.com/acme/widget/issues/4", { GITHUB_TOKEN: "server-token" }, mock),
    (error: unknown) => error instanceof CheckError && error.code === "ISSUE_NOT_FOUND" && error.status === 404,
  );
});

test("reports a deleted issue as a terminal stale-listing failure", async () => {
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) {
      return Response.json({ message: "This issue was deleted" }, { status: 410, headers });
    }
    if (/\/repos\/acme\/widget$/.test(url)) return Response.json(repository, { headers });
    throw new Error(`Unexpected deleted-issue follow-up request: ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () => checkGithubIssue("https://github.com/acme/widget/issues/4", {}, mock),
    (error: unknown) => {
      assert.ok(error instanceof CheckError);
      assert.equal(error.code, "ISSUE_DELETED");
      assert.equal(error.status, 410);
      assert.match(error.message, /marketplace listing.*stale/i);
      return true;
    },
  );
});

test("large issues retain the first setup page and newest claim pages", async () => {
  const requested: string[] = [];
  const largeIssue = { ...issue, comments: 1_854 };
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    requested.push(url);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) return Response.json(largeIssue, { headers });
    if (/\/repos\/acme\/widget$/.test(url)) return Response.json(repository, { headers });
    if (/\/comments\?.*page=1$/.test(url)) return Response.json([{ id: 1, body: "setup", user: { login: "maintainer" } }], { headers });
    if (/\/comments\?.*page=18$/.test(url)) return Response.json([{ id: 1801, body: "/opire try", user: { login: "new-solver-a" } }], { headers });
    if (/\/comments\?.*page=19$/.test(url)) return Response.json([{ id: 1901, body: "/opire try", user: { login: "new-solver-b" } }], { headers });
    if (/\/timeline\?.*page=1$/.test(url)) {
      return Response.json([], { headers: { ...headers, link: '<https://api.github.com/repos/acme/widget/issues/4/timeline?per_page=100&page=5>; rel="last"' } });
    }
    if (/\/timeline\?.*page=(3|4|5)$/.test(url)) return Response.json([], { headers });
    return Response.json({ message: "not found" }, { status: 404, headers });
  }) as typeof fetch;

  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    mock,
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.verdict, "CAUTION");
  assert.equal(result.coverage.comments_total, 1_854);
  assert.equal(result.coverage.comments_scanned, 3);
  assert.equal(result.coverage.comment_pages_scanned, 3);
  assert.equal(result.coverage.comments_truncated, true);
  assert.equal(result.coverage.timeline_pages_scanned, 4);
  assert.equal(result.coverage.timeline_truncated, true);
  assert.ok(requested.some((url) => /\/comments\?.*page=18$/.test(url)));
  assert.ok(requested.some((url) => /\/comments\?.*page=19$/.test(url)));
  assert.ok(!requested.some((url) => /\/comments\?.*page=(2|3)$/.test(url)));
});

test("a transferred issue uses only its canonical destination repository", async () => {
  const requested: string[] = [];
  const transferredIssue = {
    ...issue,
    number: 9,
    repository_url: "https://api.github.com/repos/newco/gadget",
    html_url: "https://github.com/newco/gadget/issues/9",
    title: "$100 bounty moved with its repository",
  };
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    requested.push(url);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/repos\/acme\/widget\/issues\/4$/.test(url)) return Response.json(transferredIssue, { headers });
    if (/\/repos\/newco\/gadget$/.test(url)) return Response.json({ ...repository, full_name: "newco/gadget", html_url: "https://github.com/newco/gadget" }, { headers });
    if (/\/repos\/newco\/gadget\/issues\/9\/comments\?/.test(url)) return Response.json([], { headers });
    if (/\/repos\/newco\/gadget\/issues\/9\/timeline\?/.test(url)) return Response.json([], { headers });
    if (/\/repos\/newco\/gadget\/contents\//.test(url)) return Response.json({ message: "not found" }, { status: 404, headers });
    throw new Error(`Unexpected transferred-issue request: ${url}`);
  }) as typeof fetch;

  const result = await checkGithubIssue("https://github.com/acme/widget/issues/4", {}, mock);

  assert.equal(result.issue.url, "https://github.com/newco/gadget/issues/9");
  assert.equal(result.issue.submitted_url, "https://github.com/acme/widget/issues/4");
  assert.equal(result.issue.transferred, true);
  assert.equal(result.issue.repository, "newco/gadget");
  assert.ok(!requested.some((url) => /\/repos\/acme\/widget(?:$|\/contents|\/issues\/4\/(?:comments|timeline))/.test(url)));
});
