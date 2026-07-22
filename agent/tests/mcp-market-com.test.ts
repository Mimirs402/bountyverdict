import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpMarketComListing } from "../src/mcp-market-com.ts";

const listingUrl = "https://mcpmarket.com/server/bountyverdict";
const repository = "https://github.com/Mimirs402/bountyverdict";
const productUrl = "https://mimirs402.github.io/bountyverdict/";

const page = (overrides = "") => `<html><head>
<title>BountyVerdict: Agent Decision APIs for Autonomous Coding</title>
<link rel="canonical" href="${listingUrl}">
<meta name="description" content="Audit skills and evaluate bounties. Pay per call in USDC.">
</head><body>
<a href="${repository.toLowerCase()}">Mimirs402</a>
<p>BountyVerdict offers a suite of seven paid, bounded decision APIs.</p>
<p>Every valid result is paid through x402 in Base USDC.</p>
<script type="application/ld+json">{"url":"${productUrl}"}</script>
${overrides}</body></html>`;

test("verifies the exact paid MCP Market placement without inventing usage", () => {
  const result = parseMcpMarketComListing(page(), listingUrl, repository, productUrl);
  assert.equal(result.listed, true);
  assert.equal(result.contract_verified, true);
  assert.equal(result.paid_x402_disclosed, true);
  assert.equal(result.business_owner_verified, true);
  assert.equal(result.canonical_product_link_verified, true);
  assert.equal(result.public_usage_telemetry_available, false);
});

test("surfaces catalog copy drift instead of calling the placement verified", () => {
  const result = parseMcpMarketComListing(
    page().replace("seven paid, bounded decision APIs", "seven decision APIs"),
    listingUrl,
    repository,
    productUrl,
  );
  assert.equal(result.listed, true);
  assert.equal(result.contract_verified, false);
  assert.equal(result.paid_x402_disclosed, false);
});

test("rejects duplicate identity and unbounded pages", () => {
  const duplicate = parseMcpMarketComListing(
    page().replace("</body>", `<a href="${repository.toLowerCase()}">Mimirs402</a></body>`),
    listingUrl,
    repository,
    productUrl,
  );
  assert.equal(duplicate.contract_verified, false);
  assert.throws(
    () => parseMcpMarketComListing("x".repeat(3_000_001), listingUrl, repository, productUrl),
    /invalid or unbounded/,
  );
});
