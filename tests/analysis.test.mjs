import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBounty, parseIssueUrl } from "../analysis.js";

const now = new Date("2026-07-20T12:00:00Z");
const healthyIssue = {
  state: "open",
  locked: false,
  active_lock_reason: null,
  updated_at: "2026-07-19T12:00:00Z",
  html_url: "https://github.com/acme/widget/issues/4",
  title: "Fix widget alignment",
  body: "A reproducible and bounded specification with clear current behavior, expected behavior, and acceptance criteria that are long enough."
};
const healthyRepo = {
  archived: false,
  pushed_at: "2026-07-19T12:00:00Z",
  html_url: "https://github.com/acme/widget",
  full_name: "acme/widget"
};

test("parses a canonical GitHub issue URL", () => {
  assert.deepEqual(parseIssueUrl("https://github.com/acme/widget/issues/42"), { owner: "acme", repo: "widget", number: 42 });
});

test("rejects pull request and non-GitHub URLs", () => {
  assert.throws(() => parseIssueUrl("https://github.com/acme/widget/pull/42"), /Use a URL like/);
  assert.throws(() => parseIssueUrl("https://example.com/acme/widget/issues/42"), /Only github.com/);
});

test("marks a healthy uncontested issue viable", () => {
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, now });
  assert.equal(output.verdict, "VIABLE");
  assert.ok(output.score >= 75);
});

test("locked issue is a hard stop", () => {
  const output = analyzeBounty({ issue: { ...healthyIssue, locked: true }, repository: healthyRepo, now });
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Discussion is locked" && item.hardStop));
});

test("maintainer AI-slop warning is a hard stop", () => {
  const comments = [{
    body: "Locking this issue as it is only attracting AI slop from bounty hunters.",
    author_association: "MEMBER",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-1",
    user: { login: "maintainer" }
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "AVOID");
  assert.equal(output.maintainerWarnings.length, 1);
});

test("withdrawn bounty is detected even when issue remains open", () => {
  const comments = [{
    body: "I have removed the $1000 bounty because the issue attracted duplicate PRs.",
    author_association: "NONE",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-2",
    user: { login: "sponsor" }
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "AVOID");
  assert.equal(output.withdrawals.length, 1);
});

test("linked competing PR reduces the verdict", () => {
  const timeline = [{
    event: "cross-referenced",
    source: { issue: { title: "Implement fix", state: "open", user: { login: "solver" }, pull_request: { html_url: "https://github.com/acme/widget/pull/9" } } }
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, timeline, now });
  assert.equal(output.verdict, "CAUTION");
  assert.equal(output.pullRequests.length, 1);
});

