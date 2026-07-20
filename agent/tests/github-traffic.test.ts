import assert from "node:assert/strict";
import test from "node:test";
import { parseGitHubTraffic } from "../src/github-traffic.ts";

const payloads = {
  views: {
    count: 3,
    uniques: 2,
    views: [
      { timestamp: "2026-07-19T00:00:00Z", count: 1, uniques: 1 },
      { timestamp: "2026-07-20T00:00:00Z", count: 2, uniques: 1 },
    ],
  },
  clones: {
    count: 1,
    uniques: 1,
    clones: [{ timestamp: "2026-07-20T00:00:00Z", count: 1, uniques: 1 }],
  },
  referrers: [{ referrer: "skills.sh", count: 2, uniques: 1 }],
  popular_paths: [{ path: "/owner/repo", title: "owner/repo", count: 3, uniques: 2 }],
};

test("normalizes aggregate GitHub traffic without visitor identifiers", () => {
  const result = parseGitHubTraffic("owner/repo", payloads);
  assert.equal(result.views.count, 3);
  assert.equal(result.clones.uniques, 1);
  assert.deepEqual(result.referrers, [{ referrer: "skills.sh", count: 2, uniques: 1 }]);
  assert.deepEqual(result.popular_paths, [{ path: "/owner/repo", title: "owner/repo", count: 3, uniques: 2 }]);
  assert.deepEqual(Object.keys(result).sort(), [
    "accounting_note",
    "available",
    "clones",
    "measurement_window",
    "popular_paths",
    "privacy_note",
    "referrers",
    "repository",
    "views",
  ]);
  assert.equal(JSON.stringify(result).includes("ip_address"), false);
});

test("rejects inconsistent, oversized, and malformed traffic", () => {
  assert.throws(() => parseGitHubTraffic("owner/repo", {
    ...payloads,
    views: { ...payloads.views, count: 4 },
  }), /does not match/);
  assert.throws(() => parseGitHubTraffic("owner/repo", {
    ...payloads,
    referrers: Array.from({ length: 11 }, () => ({ referrer: "example.com", count: 1, uniques: 1 })),
  }), /referrers is malformed/);
  assert.throws(() => parseGitHubTraffic("owner/repo", {
    ...payloads,
    popular_paths: [{ path: "/safe\nunsafe", title: "bad", count: 1, uniques: 1 }],
  }), /path is invalid/);
});
