import { THE402_PRODUCTS, type The402Product } from "./the402.ts";
import { THE402_LISTINGS } from "./the402-catalog.ts";

export const NEAR_MARKET_API = "https://market.near.ai/v1";
export const NEAR_MARKET_PROVIDER_ID = "51ebba6e-65e9-49b2-b23b-6561b2375179";
export const NEAR_MARKET_MAX_BODY_BYTES = 524_288;

const endpointOrigin = "https://bountyverdict-agent-production.mimirslab.workers.dev";

export const NEAR_MARKET_LISTINGS = Object.freeze(THE402_LISTINGS.map((listing) => ({
  product: listing.product,
  name: listing.name,
  description: `${listing.description} Invoke with the documented JSON input; automated fulfillment returns the declared JSON output.`,
  category: listing.product === "harness" || listing.product === "mcpdrift" ? "code-review" : "development",
  pricing_model: "fixed",
  endpoint_url: `${endpointOrigin}/api/near-market/${listing.product}`,
  input_schema: listing.input_schema,
  output_schema: listing.deliverable_schema,
  price_amount: "1",
  price_token: "USDC",
  response_time_seconds: 120,
  tags: [...listing.tags, "automated", "json-api"],
  enabled: true,
})));

export function parseNearMarketProduct(value: string): The402Product | null {
  return THE402_PRODUCTS.includes(value as The402Product) ? value as The402Product : null;
}

export function parseNearMarketInput(rawBody: string): Record<string, unknown> {
  if (new TextEncoder().encode(rawBody).length === 0) throw new Error("Request body must not be empty.");
  if (new TextEncoder().encode(rawBody).length > NEAR_MARKET_MAX_BODY_BYTES) {
    throw new Error("Request body is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  const object = parsed as Record<string, unknown>;
  const input = "input" in object ? object.input : object;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Service input must be a JSON object.");
  }
  return input as Record<string, unknown>;
}
