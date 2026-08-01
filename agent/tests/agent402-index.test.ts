import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT402_INDEX_PAGE_LIMIT,
  parseAgent402IndexPage,
  readAgent402SellerIndex,
} from "../src/agent402-index.ts";

const target = "https://bountyverdict-agent-production.mimirslab.workers.dev";

function indexPage(page: number, pages: number, sellers: Array<Record<string, unknown>>) {
  return {
    page,
    pages,
    perPage: AGENT402_INDEX_PAGE_LIMIT,
    totals: { sellers: 501 },
    sellers,
  };
}

test("finds an exact seller beyond the first Agent402 index page", async () => {
  const requested: URL[] = [];
  const fetchFn = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url);
    const page = Number(url.searchParams.get("page"));
    return Response.json(indexPage(page, 3, page === 2 ? [{ origin: target, routable: true, toolCount: 7 }] : [{ origin: `https://seller-${page}.example` }]));
  };
  const result = await readAgent402SellerIndex({
    apiUrl: "https://agent402.tools/api/index",
    targetOrigin: target,
    timeoutMs: 1_000,
    fetchFn: fetchFn as typeof fetch,
  });
  assert.equal(result.seller?.origin, target);
  assert.equal(result.pagesScanned, 3);
  assert.equal(result.sellersScanned, 3);
  assert.equal(result.ecosystemSellers, 501);
  assert.deepEqual(requested.map((url) => url.searchParams.get("page")), ["0", "1", "2"]);
  assert.ok(requested.every((url) => url.searchParams.get("limit") === String(AGENT402_INDEX_PAGE_LIMIT)));
});

test("rejects pagination drift and duplicate target origins", async () => {
  assert.throws(() => parseAgent402IndexPage({ ...indexPage(0, 2, []), page: 1 }, 0), /contract drifted/);
  let calls = 0;
  const fetchFn = async () => Response.json(indexPage(calls++, 2, [{ origin: target }]));
  await assert.rejects(readAgent402SellerIndex({
    apiUrl: "https://agent402.tools/api/index",
    targetOrigin: target,
    timeoutMs: 1_000,
    fetchFn: fetchFn as typeof fetch,
  }), /duplicate target origin/);
});

test("rejects unbounded Agent402 page counts and seller entries", () => {
  assert.throws(() => parseAgent402IndexPage({ ...indexPage(0, 51, []) }, 0), /page count/);
  assert.throws(() => parseAgent402IndexPage(indexPage(0, 1, [{ displayName: "missing origin" }]), 0), /seller entry/);
});
