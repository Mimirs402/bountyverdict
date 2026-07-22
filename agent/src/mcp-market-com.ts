export const MCP_MARKET_COM_MAX_PAGE_BYTES = 3_000_000;

export type McpMarketComListing = {
  listed: true;
  contract_verified: boolean;
  title: string;
  paid_x402_disclosed: boolean;
  business_owner_verified: boolean;
  canonical_product_link_verified: boolean;
  public_usage_telemetry_available: false;
};

function exactlyOnce(value: string, marker: string): boolean {
  const first = value.indexOf(marker);
  return first >= 0 && value.indexOf(marker, first + marker.length) < 0;
}

export function parseMcpMarketComListing(
  html: unknown,
  expectedListingUrl: string,
  expectedRepository: string,
  expectedProductUrl: string,
): McpMarketComListing {
  if (typeof html !== "string" || html.length === 0 || Buffer.byteLength(html) > MCP_MARKET_COM_MAX_PAGE_BYTES) {
    throw new Error("MCP Market page is invalid or unbounded.");
  }
  const titleMatch = html.match(/<title>([^<]{1,300})<\/title>/);
  if (!titleMatch || !titleMatch[1].startsWith("BountyVerdict:")) {
    throw new Error("MCP Market page is missing the exact BountyVerdict title.");
  }
  const canonical = `<link rel="canonical" href="${expectedListingUrl}">`;
  const repositoryHref = `href="${expectedRepository.toLowerCase()}"`;
  const productUrlJson = `\"url\":\"${expectedProductUrl}\"`;
  const paidX402Disclosed = /seven paid, bounded decision APIs/i.test(html) &&
    /x402 in Base USDC/i.test(html) &&
    /pay per call in USDC/i.test(html);
  const businessOwnerVerified = exactlyOnce(html, repositoryHref) &&
    html.includes(">Mimirs402</a>");
  const canonicalProductLinkVerified = html.includes(productUrlJson) ||
    html.includes(`href="${expectedProductUrl}"`);
  const contractVerified = exactlyOnce(html, canonical) && paidX402Disclosed &&
    businessOwnerVerified && canonicalProductLinkVerified;
  return {
    listed: true,
    contract_verified: contractVerified,
    title: titleMatch[1],
    paid_x402_disclosed: paidX402Disclosed,
    business_owner_verified: businessOwnerVerified,
    canonical_product_link_verified: canonicalProductLinkVerified,
    public_usage_telemetry_available: false,
  };
}
