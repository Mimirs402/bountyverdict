import assert from "node:assert/strict";
import test from "node:test";
import {
  ASKILL_BUYER_LANGUAGE_DESCRIPTION,
  ASKILL_DEDICATED_IDENTITY,
  ASKILL_DEDICATED_INSTALL_REF,
  ASKILL_DEDICATED_OWNER,
  ASKILL_DEDICATED_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
  ASKILL_FILE_PATH,
  ASKILL_BUYER_QUERIES,
  ASKILL_INSTALL_REF,
  ASKILL_OWNER,
  ASKILL_PATH,
  ASKILL_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
  ASKILL_REPO,
  ASKILL_SKILL_NAME,
  parseAskillBuyerQueryPayload,
  parseAskillSearchPayload,
} from "../src/askill.ts";

const exactEntry = {
  id: 703721,
  installRef: ASKILL_INSTALL_REF,
  name: ASKILL_SKILL_NAME,
  skillName: ASKILL_SKILL_NAME,
  description: ASKILL_BUYER_LANGUAGE_DESCRIPTION,
  tags: [],
  stars: 0,
  favoriteCount: 0,
  aiScore: null,
  llmScore: null,
  owner: ASKILL_OWNER,
  repoOwner: ASKILL_OWNER,
  repo: ASKILL_REPO,
  repoName: ASKILL_REPO,
  path: ASKILL_PATH,
  filePath: ASKILL_FILE_PATH,
  updatedAt: ASKILL_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
  lastPushed: ASKILL_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
  nameUniqueInRepo: true,
  source: "submit",
  publishedSlug: null,
};

const payload = (data: unknown[]) => ({
  data,
  pagination: { page: 1, limit: 20, total: 261140, hasMore: false },
});

test("recognizes only the exact askill adapter listing", () => {
  assert.deepEqual(parseAskillSearchPayload(payload([exactEntry])), {
    listed: true,
    listed_skills: 1,
    expected_skills: 1,
    catalog_total: 261140,
    entry_id: 703721,
    listing_url: "https://askill.sh/skills/703721",
    install_source: ASKILL_INSTALL_REF,
    favorites: 0,
    repository_stars: 0,
    ai_score: null,
    llm_score: null,
    tags: [],
    updated_at: ASKILL_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
    last_pushed: ASKILL_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
    buyer_language_revision_live: true,
    adapter_revision_live: true,
    required_adapter_revision_pushed_at: ASKILL_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
    status: "listed",
  });
  assert.equal(parseAskillSearchPayload(payload([])).status, "not_indexed");
  assert.equal(parseAskillSearchPayload(payload([{ ...exactEntry, filePath: "SKILL.md" }])).status, "contract_drift");
  assert.deepEqual(parseAskillSearchPayload(payload([{ ...exactEntry, description: "Older listing copy." }])), {
    ...parseAskillSearchPayload(payload([exactEntry])),
    buyer_language_revision_live: false,
    status: "listed_pending_content_refresh",
  });
  assert.deepEqual(parseAskillSearchPayload(payload([{
    ...exactEntry,
    description: "Route GitHub decisions: bounty worth working on; which bounty to choose; audit AGENTS.md/coding-agent readiness; why Actions failed; retry failed Action; will MCP tools/list changes break clients?",
    updatedAt: "2026-07-21T10:58:06.000Z",
    lastPushed: "2026-07-21T10:58:06.000Z",
  }])), {
    ...parseAskillSearchPayload(payload([exactEntry])),
    updated_at: "2026-07-21T10:58:06.000Z",
    last_pushed: "2026-07-21T10:58:06.000Z",
    buyer_language_revision_live: false,
    adapter_revision_live: false,
    status: "listed_pending_content_refresh",
  });
});

test("tracks the dedicated Mimir's Lab askill listing without merging legacy telemetry", () => {
  const dedicated = {
    ...exactEntry,
    id: 703722,
    owner: ASKILL_DEDICATED_OWNER,
    repoOwner: ASKILL_DEDICATED_OWNER,
    installRef: ASKILL_DEDICATED_INSTALL_REF,
    updatedAt: ASKILL_DEDICATED_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
    lastPushed: ASKILL_DEDICATED_REQUIRED_ADAPTER_REVISION_PUSHED_AT,
  };
  const combined = payload([dedicated, exactEntry]);
  const parsed = parseAskillSearchPayload(combined, ASKILL_DEDICATED_IDENTITY);
  assert.equal(parsed.listed, true);
  assert.equal(parsed.entry_id, 703722);
  assert.equal(parsed.install_source, ASKILL_DEDICATED_INSTALL_REF);
  assert.equal(parsed.status, "listed");
  assert.equal(parseAskillSearchPayload(payload([dedicated])).listed, false);
  assert.deepEqual(parseAskillBuyerQueryPayload(combined, ASKILL_DEDICATED_IDENTITY), {
    found: true,
    rank: 1,
    returned_results: 2,
  });
});

test("rejects duplicate, malformed, and unbounded askill telemetry", () => {
  assert.throws(() => parseAskillSearchPayload(payload([exactEntry, exactEntry])), /duplicated/);
  assert.throws(() => parseAskillSearchPayload({ data: "private", pagination: payload([]).pagination }), /malformed/);
  assert.throws(() => parseAskillSearchPayload({ data: [], pagination: { page: 1, limit: 101, total: 0, hasMore: false } }), /unbounded/);
  assert.throws(() => parseAskillSearchPayload(payload([{ ...exactEntry, favoriteCount: -1 }])), /favorite/);
  assert.throws(() => parseAskillSearchPayload(payload([{ ...exactEntry, tags: new Array(51).fill("tag") }])), /tags/);
  assert.throws(() => parseAskillSearchPayload(payload([{ ...exactEntry, lastPushed: "not-a-date" }])), /last-pushed/);
});

test("retains bounded unbranded askill retrieval ranks", () => {
  assert.deepEqual(ASKILL_BUYER_QUERIES, [
    "github actions root cause",
    "should I retry failed github action",
    "check github bounty",
    "audit AGENTS.md",
    "MCP schema drift",
    "rank github bounties",
    "is this github bounty worth working on",
    "which github bounty should i work on",
    "is this repo ready for a coding agent",
    "why did my github actions run fail",
    "should i retry this failed github actions run",
    "will this mcp tools/list change break clients",
  ]);
  assert.deepEqual(parseAskillBuyerQueryPayload(payload([
    { installRef: "gh:other/repo@skill" },
    exactEntry,
  ])), { found: true, rank: 2, returned_results: 2 });
  assert.deepEqual(parseAskillBuyerQueryPayload(payload([])), {
    found: false,
    rank: null,
    returned_results: 0,
  });
  assert.throws(() => parseAskillBuyerQueryPayload(payload([exactEntry, exactEntry])), /duplicated/);
  assert.throws(() => parseAskillBuyerQueryPayload(payload([{ ...exactEntry, path: "wrong" }])), /drifted/);
});
