import { THE402_LISTINGS } from "./the402-catalog.ts";

export const PAYAN_API = "https://payanagent.com/api/v1";
export const PAYAN_PROVIDER_ID = "j579t3gcz6jaqe54jrrezy8wzd8axzbj";

const endpointOrigin = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const prices: Record<string, number> = {
  single: 5,
  portfolio: 40,
  harness: 3,
  run: 4,
  flake: 7,
  mcpdrift: 2,
};

export const PAYAN_OFFERS = Object.freeze(THE402_LISTINGS.map((listing) => ({
  product: listing.product,
  title: listing.name,
  description: `${listing.description} Automated JSON fulfillment; payment settles directly to the provider on Base.`,
  category: "Developer Tools",
  tags: [...new Set([...listing.tags, "automated", "json-api"])].slice(0, 10),
  priceCents: prices[listing.product]!,
  offerType: "api",
  endpoint: `${endpointOrigin}/api/near-market/${listing.product}`,
  httpMethod: "POST",
  inputSchema: JSON.stringify(listing.input_schema),
  outputSchema: JSON.stringify(listing.deliverable_schema),
})));
