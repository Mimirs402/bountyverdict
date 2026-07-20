import test from "node:test";
import assert from "node:assert/strict";
import { CheckError, type AgentVerdict } from "../src/check.ts";
import { checkBountyPortfolio } from "../src/portfolio.ts";
import { SERVICE_REUSE } from "../src/reuse.ts";

function verdict(url: string, decision: AgentVerdict["verdict"], score: number): AgentVerdict {
  return {
    product: "BountyVerdict",
    version: "1.0",
    verdict: decision,
    score,
    summary: "test",
    service_reuse: SERVICE_REUSE.single,
    issue: { url, title: "Issue", state: "open", repository: "acme/widget" },
    signals: [],
    contribution_policy: { ai_use: "NO_EXPLICIT_RULE_FOUND", documents: [] },
    coverage: {
      comments_scanned: 0,
      timeline_events_scanned: 0,
      linked_pull_requests_found: 0,
      policy_documents_scanned: 0,
      github_rate_limit_remaining: 100,
    },
    checked_at: "2026-07-20T12:00:00.000Z",
    limitations: [],
  };
}

test("portfolio ranks viable candidates ahead of caution and avoid", async () => {
  const urls = [
    "https://github.com/acme/widget/issues/1",
    "https://github.com/acme/widget/issues/2",
    "https://github.com/acme/widget/issues/3",
  ];
  const decisions = new Map([
    [urls[0], verdict(urls[0], "AVOID", 0)],
    [urls[1], verdict(urls[1], "VIABLE", 82)],
    [urls[2], verdict(urls[2], "CAUTION", 60)],
  ]);
  const result = await checkBountyPortfolio(
    urls,
    {},
    fetch,
    new Date("2026-07-20T12:00:00Z"),
    async (url) => decisions.get(url)!,
  );

  assert.equal(result.best_candidate, urls[1]);
  assert.deepEqual(result.ranked.map((item) => item.verdict), ["VIABLE", "CAUTION", "AVOID"]);
  assert.deepEqual(result.counts, { submitted: 3, checked: 3, viable: 1, caution: 1, avoid: 1, failed: 0 });
});

test("portfolio preserves useful results when one upstream check fails", async () => {
  const urls = [
    "https://github.com/acme/widget/issues/1",
    "https://github.com/acme/widget/issues/2",
  ];
  const result = await checkBountyPortfolio(
    urls,
    {},
    fetch,
    new Date("2026-07-20T12:00:00Z"),
    async (url) => {
      if (url === urls[0]) throw new CheckError("Not found", 404, "ISSUE_NOT_FOUND");
      return verdict(url, "VIABLE", 90);
    },
  );

  assert.equal(result.counts.checked, 1);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.failures[0]?.error.code, "ISSUE_NOT_FOUND");
});

test("portfolio rejects duplicates and unsafe batch sizes before checking", async () => {
  const url = "https://github.com/acme/widget/issues/1";
  await assert.rejects(
    () => checkBountyPortfolio([url, `${url}?duplicate=1`]),
    (error: unknown) => error instanceof CheckError && error.code === "DUPLICATE_ISSUE_URL",
  );
  await assert.rejects(
    () => checkBountyPortfolio([url]),
    (error: unknown) => error instanceof CheckError && error.code === "INVALID_PORTFOLIO_SIZE",
  );
});
