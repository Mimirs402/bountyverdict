import { NEAR_MARKET_API, NEAR_MARKET_LISTINGS, NEAR_MARKET_PROVIDER_ID } from "../src/near-market.ts";
import { THE402_PRODUCTS } from "../src/the402.ts";

const apiKey = process.env.NEAR_MARKET_API_KEY;
const enabled = process.env.NEAR_MARKET_CREATE === "YES";

if (!enabled) throw new Error("Set NEAR_MARKET_CREATE=YES to create or update marketplace listings.");
if (!apiKey || !/^sk_live_[A-Za-z0-9_-]+$/.test(apiKey)) {
  throw new Error("NEAR_MARKET_API_KEY is missing or invalid.");
}
if (
  NEAR_MARKET_LISTINGS.length !== THE402_PRODUCTS.length ||
  NEAR_MARKET_LISTINGS.some(({ product }) => !THE402_PRODUCTS.includes(product))
) throw new Error("NEAR Market definitions do not match the frozen six-product distribution set.");

type Service = { service_id: string; agent_id: string; name: string };

async function marketFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${NEAR_MARKET_API}${path}`, {
    ...init,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
}

const ownedResponse = await marketFetch("/agents/me/services");
if (!ownedResponse.ok) throw new Error(`NEAR Market service lookup returned HTTP ${ownedResponse.status}.`);
const owned = await ownedResponse.json() as Service[];
if (!Array.isArray(owned)) throw new Error("NEAR Market returned an invalid service list.");

const results: Array<{ product: string; service_id: string; action: "created" | "updated" }> = [];
for (const definition of NEAR_MARKET_LISTINGS) {
  const matches = owned.filter(({ service_id }) => service_id === definition.service_id);
  if (matches.length > 1) throw new Error(`NEAR Market contains duplicate ${definition.service_id} listings.`);
  const previous = matches[0];
  if (previous && previous.agent_id !== NEAR_MARKET_PROVIDER_ID) {
    throw new Error(`NEAR Market ${definition.name} belongs to an unexpected provider.`);
  }
  const response = await marketFetch(
    previous ? `/services/${previous.service_id}` : "/agents/me/services",
    { method: previous ? "PATCH" : "POST", body: JSON.stringify(definition) },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`NEAR Market ${definition.product} listing returned HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  const service = await response.json() as Service;
  if (
    !service || service.service_id !== definition.service_id ||
    service.agent_id !== NEAR_MARKET_PROVIDER_ID || service.name !== definition.name
  ) throw new Error(`NEAR Market returned an invalid ${definition.product} listing.`);
  results.push({
    product: definition.product,
    service_id: service.service_id,
    action: previous ? "updated" : "created",
  });
}

console.log(JSON.stringify({ provider_id: NEAR_MARKET_PROVIDER_ID, services: results }, null, 2));
