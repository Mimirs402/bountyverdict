import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBusinessPullRequestReviewEvents,
  buildGithubDigest,
  GITHUB_DIGEST_MAX_EVENTS,
  mergeGithubDigestEvents,
  parseBusinessAuthoredOpenPullRequests,
  preserveLatestNonEmptyGithubDigest,
} from "../src/github-digest.ts";

const since = "2026-07-27T08:00:00.000Z";
const checkedAt = "2026-07-28T08:00:00.000Z";

test("GitHub digest keeps bounded public review evidence without API identities", () => {
  const latest = "https://api.github.com/repos/aaif-goose/goose/pulls/comments/3668540783";
  const digest = buildGithubDigest([{
    id: "123",
    reason: "comment",
    updated_at: "2026-07-28T07:30:00Z",
    repository: { full_name: "aaif-goose/goose" },
    subject: {
      title: "feat: add BountyVerdict",
      type: "PullRequest",
      latest_comment_url: latest,
    },
  }], new Map([[latest, {
    html_url: "https://github.com/aaif-goose/goose/pull/10625#discussion_r3668540783",
    body: "Please verify the selector against the current server.",
    user: { login: "chatgpt-codex-connector" },
  }]]), since, checkedAt);
  assert.equal(digest.account, "Mimirs402");
  assert.equal(digest.event_count, 1);
  assert.equal(digest.actionable_count, 1);
  assert.equal(digest.events[0].repository, "aaif-goose/goose");
  assert.equal(digest.events[0].author, "chatgpt-codex-connector");
  assert.match(digest.events[0].body_excerpt || "", /verify the selector/);
  assert.match(digest.events[0].url || "", /^https:\/\/github\.com\//);
  assert.match(digest.digest_fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(digest), /api\.github\.com/);
});

test("GitHub digest rejects unbounded input and drops malformed notifications", () => {
  assert.throws(
    () => buildGithubDigest(Array.from({ length: 101 }, () => ({})), new Map(), since, checkedAt),
    /unbounded/,
  );
  const digest = buildGithubDigest([{}, {
    id: "x",
    reason: "subscribed",
    updated_at: "invalid",
    repository: { full_name: "owner/repo" },
    subject: { title: "bad", type: "Issue" },
  }], new Map(), since, checkedAt);
  assert.equal(digest.event_count, 0);
  assert.ok(digest.events.length <= GITHUB_DIGEST_MAX_EVENTS);
});

test("an empty poll retains prior context without repeating an already-seen action", () => {
  const previous = buildGithubDigest([{
    id: "123",
    reason: "comment",
    updated_at: "2026-07-28T07:30:00Z",
    repository: { full_name: "aaif-goose/goose" },
    subject: { title: "docs", type: "PullRequest" },
  }], new Map(), since, checkedAt);
  const empty = buildGithubDigest([], new Map(), checkedAt, "2026-07-29T08:00:00.000Z");
  const retained = preserveLatestNonEmptyGithubDigest(empty, previous);
  assert.equal(retained.event_count, 1);
  assert.equal(retained.digest_fingerprint, previous.digest_fingerprint);
  assert.equal(retained.checked_at, "2026-07-29T08:00:00.000Z");
  assert.equal(retained.actionable_count, 0);
  assert.equal(retained.events[0].actionable, false);
});

test("retained digest validation rejects inconsistent actionable accounting", () => {
  const empty = buildGithubDigest([], new Map(), checkedAt, "2026-07-29T08:00:00.000Z");
  const previous = buildGithubDigest([{
    id: "123",
    reason: "comment",
    updated_at: "2026-07-28T07:30:00Z",
    repository: { full_name: "aaif-goose/goose" },
    subject: { title: "docs", type: "PullRequest" },
  }], new Map(), since, checkedAt);
  assert.equal(preserveLatestNonEmptyGithubDigest(empty, {
    ...previous,
    actionable_count: 0,
  }), empty);
});

test("GitHub digest parses only complete open PR searches authored by the business account", () => {
  const pullRequests = parseBusinessAuthoredOpenPullRequests({
    total_count: 1,
    incomplete_results: false,
    items: [{
      number: 10625,
      state: "open",
      title: "feat: add BountyVerdict",
      html_url: "https://github.com/aaif-goose/goose/pull/10625",
      repository_url: "https://api.github.com/repos/aaif-goose/goose",
      user: { login: "Mimirs402" },
      pull_request: { url: "https://api.github.com/repos/aaif-goose/goose/pulls/10625" },
    }],
  });
  assert.deepEqual(pullRequests, [{
    repository: "aaif-goose/goose",
    number: 10625,
    title: "feat: add BountyVerdict",
    url: "https://github.com/aaif-goose/goose/pull/10625",
    author: "Mimirs402",
  }]);
  assert.throws(() => parseBusinessAuthoredOpenPullRequests({
    total_count: 1,
    incomplete_results: true,
    items: [],
  }), /incomplete/);
});

test("GitHub digest captures read inline reviews that notifications can miss", () => {
  const pullRequest = {
    repository: "aaif-goose/goose",
    number: 10625,
    title: "feat: add BountyVerdict",
    url: "https://github.com/aaif-goose/goose/pull/10625",
    author: "Mimirs402" as const,
  };
  const reviewEvents = buildBusinessPullRequestReviewEvents([{
    pull_request: pullRequest,
    review_comments: [{
      id: 3668540783,
      body: "Please remove the nonexistent selector.",
      html_url: `${pullRequest.url}#discussion_r3668540783`,
      updated_at: "2026-07-28T07:45:00Z",
      user: { login: "chatgpt-codex-connector" },
    }],
    reviews: [{
      id: 987,
      state: "CHANGES_REQUESTED",
      body: "",
      html_url: `${pullRequest.url}#pullrequestreview-987`,
      submitted_at: "2026-07-28T07:50:00Z",
      user: { login: "maintainer" },
    }],
  }], since);
  assert.equal(reviewEvents.length, 2);
  assert.deepEqual(reviewEvents.map(({ reason }) => reason).sort(), ["review", "review_comment"]);
  assert.ok(reviewEvents.every(({ actionable }) => actionable));

  const notifications = buildGithubDigest([], new Map(), since, checkedAt);
  const merged = mergeGithubDigestEvents(notifications, reviewEvents);
  assert.equal(merged.event_count, 2);
  assert.equal(merged.actionable_count, 2);
  assert.match(merged.digest_fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("GitHub digest rejects truncated review feedback", () => {
  assert.throws(() => buildBusinessPullRequestReviewEvents([{
    pull_request: {
      repository: "aaif-goose/goose",
      number: 10625,
      title: "feat: add BountyVerdict",
      url: "https://github.com/aaif-goose/goose/pull/10625",
      author: "Mimirs402",
    },
    review_comments: Array.from({ length: 100 }, () => ({})),
    reviews: [],
  }], since), /truncated/);
});
