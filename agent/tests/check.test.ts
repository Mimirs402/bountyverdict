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

function githubMock(
  comments: unknown[] = [],
  policy: string | null = null,
  issueOverride = issue,
  reportedComments: unknown = comments.length,
): typeof fetch {
  const servedComments = comments.map((comment, index) => {
    if (typeof comment !== "object" || comment === null || Array.isArray(comment)) return comment;
    return {
      id: index + 1,
      html_url: `https://github.com/acme/widget/issues/4#issuecomment-${index + 1}`,
      created_at: "2026-07-20T10:00:00Z",
      body: "",
      author_association: "NONE",
      user: null,
      ...comment,
    };
  });
  return async (input) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) {
      return Response.json({ ...issueOverride, comments: reportedComments }, { headers });
    }
    if (/\/repos\/acme\/widget$/.test(url)) return Response.json(repository, { headers });
    if (/\/comments\?/.test(url)) return Response.json(servedComments, { headers });
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

test("returns AVOID when a maintainer mirror is delivered with every slot filled", async () => {
  const deliveredIssue = {
    ...issue,
    title: "Frantic bounty #118: Vendor UX dogfood",
    body: "Frantic bounty #118\n\nWorker price: $1\nSlots: 2 (filled)\nStatus: delivered\n" +
      "Claim: https://gofrantic.com/bounties/118\n\nFrantic is the source of truth. This GitHub issue is a mirrored board thread.",
    labels: [{ name: "bounty" }, { name: "funded" }, { name: "delivered" }],
  };
  const comments = [{
    body: "Frantic paid one accepted claim.",
    author_association: "OWNER",
    created_at: "2026-07-21T10:46:12Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-paid",
    user: { login: "maintainer" },
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments, null, deliveredIssue),
    new Date("2026-07-22T06:00:00Z"),
  );

  assert.equal(result.reward.state, "PAID_OR_AWARDED");
  assert.equal(result.verdict, "AVOID");
  assert.ok(result.signals.some((signal) => signal.label === "Bounty has no open work slot" && signal.hard_stop));
  assert.ok(result.signals.some((signal) =>
    signal.label === "External bounty platform requires separate verification" &&
    signal.evidence_url === "https://gofrantic.com/bounties/118"
  ));
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

test("returns CAUTION when a maintainer-owned listing mirrors an external source issue", async () => {
  const mirrored = {
    ...issue,
    body: "### Original link\nhttps://github.com/upstream/project/issues/77\n\nThis $500 bounty mirrors the external implementation target with complete acceptance criteria.",
  };
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock([], null, mirrored),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "PROMISED");
  assert.equal(result.verdict, "CAUTION");
  assert.ok(result.signals.some((signal) =>
    signal.label === "External source issue requires separate verification" &&
    signal.evidence_url === "https://github.com/upstream/project/issues/77"
  ));
});

test("returns AVOID when Opire rejected the issue's advertised amount", async () => {
  const rejectedIssue = {
    ...issue,
    title: "Fix slice precedence",
    body: `${"A complete reproducible implementation specification and acceptance criteria. ".repeat(2)}\n<details><summary>This repo is using Opire - what does it mean?</summary>Everyone can add rewards commenting /reward 100.</details>`,
    labels: [{ name: "bounty" }, { name: "opire" }, { name: "$10" }],
  };
  const comments = [{
    body: "You cannot create a reward of $10. It needs to be at least $20.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-rejected",
    user: { login: "opirebot[bot]" },
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments, null, rejectedIssue),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "WITHDRAWN");
  assert.equal(result.reward.verification, "TRUSTED_PLATFORM_APP");
  assert.equal(result.reward.platform, "Opire");
  assert.equal(result.reward.amount, 10);
  assert.equal(result.verdict, "AVOID");
  assert.ok(result.signals.some((signal) =>
    signal.label === "Reward platform rejected listing" && signal.hard_stop
  ));
});

test("Opire boilerplate alone cannot fabricate a paid opportunity", async () => {
  const boilerplateOnly = {
    ...issue,
    title: "Make MCP timeouts cancellation-safe",
    body: `${"A complete reproducible implementation specification and acceptance criteria. ".repeat(2)}\n<details><summary>This repo is using Opire - what does it mean?</summary>Everyone can add rewards commenting /reward 100.</details>`,
  };
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock([], null, boilerplateOnly),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "NOT_FOUND");
  assert.equal(result.verdict, "CAUTION");
});

test("authenticated Opire creation is trusted and a later rejection does not cancel it", async () => {
  const comments = [{
    body: "@sponsor created a $20.00 reward using [Opire](https://opire.dev)",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-19T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-listed",
    user: { login: "opirebot[bot]" },
  }, {
    body: "You cannot create a reward of $10. It needs to be at least $20.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-rejected",
    user: { login: "opirebot[bot]" },
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments, null, { ...issue, author_association: "NONE" }),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "LISTED");
  assert.equal(result.reward.platform, "Opire");
  assert.equal(result.reward.amount, 20);
  assert.ok(!result.signals.some((signal) => signal.label === "Reward platform rejected listing"));
});

test("maintainer reward denial cannot clear an untrusted issuer", async () => {
  const comments = [{
    body: "This bounty will not be paid.",
    author_association: "MEMBER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-denial",
    user: { login: "maintainer" },
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments, null, { ...issue, author_association: "NONE" }),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "WITHDRAWN");
  assert.equal(result.verdict, "AVOID");
  assert.ok(result.signals.some((signal) => signal.label === "Reward withdrawal signal" && signal.hard_stop));
});

test("maintainer-authored issue denial is terminal", async () => {
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock([], null, { ...issue, body: `${issue.body}\n\nThis bounty will not be paid.` }),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "WITHDRAWN");
  assert.equal(result.verdict, "AVOID");
  assert.ok(result.signals.some((signal) => signal.label === "Reward withdrawal signal" && signal.hard_stop));
});

test("same-comment restoration clears its historical cancellation clause", async () => {
  const comments = [{
    body: "We cancelled the bounty yesterday, but restored it today. This $100 reward will be paid after acceptance.",
    author_association: "OWNER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-restored",
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "PROMISED");
  assert.equal(result.verdict, "VIABLE");
  assert.ok(!result.signals.some((signal) => signal.label === "Reward withdrawal signal"));
});

test("negated or hypothetical restoration is terminal in the paid check", async () => {
  const denials = [
    "We will not restore this $100 bounty. It will not be paid.",
    "We cannot restore this $100 bounty.",
    "Do not restore this $100 bounty; it remains cancelled.",
    "We discussed restoring the $100 bounty but decided not to.",
    "The $100 bounty has not been restored and will not be paid.",
    "We restored the $100 bounty yesterday, then withdrew it today.",
    "We restored the $100 bounty and it will be paid after merge, but later cancelled it.",
    "We restored the $100 bounty and it will be paid after merge, but then removed it.",
    "We restored the $100 bounty and it will be paid after merge, but decided to cancel it.",
    "We restored the $100 bounty and it will be paid after merge, but it is no longer available.",
  ];
  for (const body of denials) {
    const comments = [{
      body,
      author_association: "OWNER",
      created_at: "2026-07-20T10:00:00Z",
      html_url: "https://github.com/acme/widget/issues/4#issuecomment-denial",
    }];
    const result = await checkGithubIssue(
      "https://github.com/acme/widget/issues/4",
      {},
      githubMock(comments),
      new Date("2026-07-20T12:00:00Z"),
    );
    assert.equal(result.reward.state, "WITHDRAWN", body);
    assert.equal(result.verdict, "AVOID", body);
    assert.ok(result.signals.some((signal) => signal.label === "Reward withdrawal signal" && signal.hard_stop), body);
  }
});

test("an older Opire claim cannot cancel a newer Algora listing", async () => {
  const comments = [{
    body: "The user @solver has claimed all rewards for this issue.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-19T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-claimed",
  }, {
    body: "## 💎 $250 bounty\nThe bounty is now up for grabs.",
    author_association: "NONE",
    performed_via_github_app: { slug: "algora-pbc" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-algora-listed",
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "LISTED");
  assert.equal(result.reward.platform, "Algora");
  assert.equal(result.verdict, "VIABLE");
});

test("authenticated Opire empty state blocks an Opire-bound promise", async () => {
  const opireBound = {
    ...issue,
    body: `${issue.body}\n<details><summary>This repo is using Opire - what does it mean?</summary></details>`,
  };
  const comments = [{
    body: "This issue does not have any reward yet!",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-empty",
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments, null, opireBound),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "NOT_FOUND");
  assert.equal(result.reward.verification, "TRUSTED_PLATFORM_APP");
  assert.equal(result.verdict, "AVOID");
});

test("maintainer non-authorization cannot confirm an untrusted bounty", async () => {
  const comments = [{
    body: "A user mentioned a $100 bounty, but that bounty is not ours and we do not authorize it.",
    author_association: "MEMBER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-disclaimer",
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments, null, { ...issue, author_association: "NONE" }),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "WITHDRAWN");
  assert.equal(result.verdict, "AVOID");
  assert.ok(result.signals.some((signal) => signal.label === "Reward withdrawal signal" && signal.hard_stop));
});

test("authenticated Opire rejection overrides its maintainer-authored promise", async () => {
  const promised = { ...issue, title: "[Opire bounty $10] Fix widget", labels: ["opire", "$10"] };
  const comments = [{
    body: "You cannot create a reward of $10. It needs to be at least $20.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-rejected",
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments, null, promised),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.reward.state, "WITHDRAWN");
  assert.equal(result.reward.verification, "TRUSTED_PLATFORM_APP");
  assert.equal(result.verdict, "AVOID");
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

test("rejects an issues URL that GitHub resolves to a pull request", async () => {
  const requested: string[] = [];
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    requested.push(url);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) {
      return Response.json({
        ...issue,
        html_url: "https://github.com/acme/widget/pull/4",
        pull_request: {
          url: "https://api.github.com/repos/acme/widget/pulls/4",
          html_url: "https://github.com/acme/widget/pull/4",
        },
      }, { headers });
    }
    throw new Error(`Unexpected pull-request follow-up request: ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () => checkGithubIssue("https://github.com/acme/widget/issues/4", {}, mock),
    (error: unknown) => {
      assert.ok(error instanceof CheckError);
      assert.equal(error.code, "NOT_AN_ISSUE");
      assert.equal(error.status, 400);
      assert.match(error.message, /pull request, not an issue/i);
      return true;
    },
  );
  assert.deepEqual(requested, ["https://api.github.com/repos/acme/widget/issues/4"]);
});

test("fails closed when GitHub returns malformed pull-request identity metadata", async () => {
  const mock = (async () => Response.json({ ...issue, pull_request: null }, {
    headers: { "x-ratelimit-remaining": "4990" },
  })) as typeof fetch;

  await assert.rejects(
    () => checkGithubIssue("https://github.com/acme/widget/issues/4", {}, mock),
    (error: unknown) => error instanceof CheckError &&
      error.code === "GITHUB_RESPONSE_INVALID" && error.status === 502,
  );
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
    const comment = (id: number, body: string, login: string) => ({
      id,
      body,
      user: { login },
      author_association: "NONE",
      created_at: "2026-07-20T10:00:00Z",
      html_url: `https://github.com/acme/widget/issues/4#issuecomment-${id}`,
    });
    if (/\/comments\?.*page=1$/.test(url)) return Response.json([comment(1, "setup", "maintainer")], { headers });
    if (/\/comments\?.*page=18$/.test(url)) return Response.json([comment(1801, "/opire try", "new-solver-a")], { headers });
    if (/\/comments\?.*page=19$/.test(url)) return Response.json([comment(1901, "/opire try", "new-solver-b")], { headers });
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

test("a short GitHub comment page cannot claim complete evidence coverage", async () => {
  const shortPageIssue = { ...issue, comments: 2 };
  const oneComment = [{
    id: 1,
    body: "Here are the requested reproduction logs.",
    author_association: "NONE",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-1",
    user: { login: "candidate" },
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(oneComment, null, shortPageIssue, 2),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.coverage.comments_total, 2);
  assert.equal(result.coverage.comments_scanned, 1);
  assert.equal(result.coverage.comment_pages_scanned, 1);
  assert.equal(result.coverage.comments_truncated, true);
  assert.equal(result.verdict, "CAUTION");
  assert.ok(result.signals.some((signal) => signal.label === "Evidence coverage is truncated"));

  const overrun = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock([
      oneComment[0],
      { ...oneComment[0], id: 2, html_url: "https://github.com/acme/widget/issues/4#issuecomment-2" },
    ], null, issue, 1),
    new Date("2026-07-20T12:00:00Z"),
  );
  assert.equal(overrun.coverage.comments_scanned, 2);
  assert.equal(overrun.coverage.comments_total, 1);
  assert.equal(overrun.coverage.comments_truncated, true);
  assert.equal(overrun.verdict, "CAUTION");
});

test("invalid GitHub evidence counts and page shapes fail closed", async () => {
  for (const reportedComments of [-1, "1", null]) {
    const invalidCount = githubMock([], null, issue, reportedComments);
    await assert.rejects(
      () => checkGithubIssue("https://github.com/acme/widget/issues/4", {}, invalidCount),
      (error: unknown) => error instanceof CheckError && error.code === "GITHUB_RESPONSE_INVALID",
    );
  }

  const invalidPage = (async (input: URL | RequestInfo) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) return Response.json({ ...issue, comments: 1 }, { headers });
    if (/\/repos\/acme\/widget$/.test(url)) return Response.json(repository, { headers });
    if (/\/comments\?/.test(url)) return Response.json({ message: "unexpected shape" }, { headers });
    if (/\/timeline\?/.test(url)) return Response.json([], { headers });
    return Response.json({ message: "not found" }, { status: 404, headers });
  }) as typeof fetch;
  await assert.rejects(
    () => checkGithubIssue("https://github.com/acme/widget/issues/4", {}, invalidPage),
    (error: unknown) => error instanceof CheckError && error.code === "GITHUB_RESPONSE_INVALID",
  );

  for (const [invalidKind, invalidEntry] of [
    ["comments", null],
    ["comments", {}],
    ["timeline", null],
    ["timeline", { message: "unexpected shape" }],
  ] as const) {
    const invalidElement = (async (input: URL | RequestInfo) => {
      const url = String(input);
      const headers = { "x-ratelimit-remaining": "4990" };
      if (/\/issues\/4$/.test(url)) {
        return Response.json({ ...issue, comments: invalidKind === "comments" ? 1 : 0 }, { headers });
      }
      if (/\/repos\/acme\/widget$/.test(url)) return Response.json(repository, { headers });
      if (/\/comments\?/.test(url)) {
        return Response.json(invalidKind === "comments" ? [invalidEntry] : [], { headers });
      }
      if (/\/timeline\?/.test(url)) {
        return Response.json(invalidKind === "timeline" ? [invalidEntry] : [], { headers });
      }
      return Response.json({ message: "not found" }, { status: 404, headers });
    }) as typeof fetch;
    await assert.rejects(
      () => checkGithubIssue("https://github.com/acme/widget/issues/4", {}, invalidElement),
      (error: unknown) => error instanceof CheckError && error.code === "GITHUB_RESPONSE_INVALID",
    );
  }
});

test("a GitHub cross-reference timeline event remains valid evidence", async () => {
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) return Response.json({ ...issue, comments: 0 }, { headers });
    if (/\/repos\/acme\/widget$/.test(url)) return Response.json(repository, { headers });
    if (/\/comments\?/.test(url)) return Response.json([], { headers });
    if (/\/timeline\?/.test(url)) {
      return Response.json([{
        event: "cross-referenced",
        created_at: "2026-07-20T10:00:00Z",
        source: {
          issue: {
            title: "Competing fix",
            state: "open",
            user: { login: "solver" },
            pull_request: { html_url: "https://github.com/acme/widget/pull/9" },
          },
        },
      }], { headers });
    }
    return Response.json({ message: "not found" }, { status: 404, headers });
  }) as typeof fetch;

  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    mock,
    new Date("2026-07-20T12:00:00Z"),
  );
  assert.equal(result.coverage.timeline_events_scanned, 1);
  assert.equal(result.coverage.linked_pull_requests_found, 1);
  assert.equal(result.verdict, "CAUTION");
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
