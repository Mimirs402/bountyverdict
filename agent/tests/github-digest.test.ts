import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGithubDigest,
  GITHUB_DIGEST_MAX_EVENTS,
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

test("an empty poll retains the latest non-empty digest without changing its fingerprint", () => {
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
});
