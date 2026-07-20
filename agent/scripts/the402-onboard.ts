import { THE402_PRODUCTS, type The402Product } from "../src/the402.ts";
import { THE402_API, THE402_LISTINGS } from "../src/the402-catalog.ts";

const api = THE402_API;
const apiKey = process.env.THE402_API_KEY;
const participantId = process.env.THE402_PARTICIPANT_ID;
const enabled = process.env.THE402_CREATE === "YES";

if (!enabled) throw new Error("Set THE402_CREATE=YES to create or update marketplace listings.");
if (!apiKey || apiKey.length < 16) throw new Error("THE402_API_KEY is missing or invalid.");
if (!participantId || !/^p_[A-Za-z0-9_-]{1,160}$/.test(participantId)) {
  throw new Error("THE402_PARTICIPANT_ID is missing or invalid.");
}

const definitions = THE402_LISTINGS;

if (definitions.length !== THE402_PRODUCTS.length ||
  definitions.some(({ product }) => !THE402_PRODUCTS.includes(product))) {
  throw new Error("the402 listing definitions do not match the allowed product set.");
}

async function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${api}${path}`, {
    ...init,
    redirect: "error",
    headers: {
      "X-API-Key": apiKey!,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
}

type ExistingService = { id: string; name: string };

function servicesFromPayload(payload: any): ExistingService[] {
  const candidates = Array.isArray(payload?.services)
    ? payload.services
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return candidates
    .filter((entry: any) => typeof entry?.id === "string" && typeof entry?.name === "string")
    .map((entry: any) => ({ id: entry.id, name: entry.name }));
}

async function existingServices(): Promise<ExistingService[]> {
  const owned = await platformFetch("/services");
  if (owned.ok) return servicesFromPayload(await owned.json());
  if (![404, 405].includes(owned.status)) {
    throw new Error(`the402 owned-service lookup returned HTTP ${owned.status}.`);
  }
  const catalog = await fetch(`${api}/services/catalog?provider=${encodeURIComponent(participantId!)}&limit=100`, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!catalog.ok) throw new Error(`the402 catalog lookup returned HTTP ${catalog.status}.`);
  return servicesFromPayload(await catalog.json());
}

function serviceId(payload: any): string {
  const value = payload?.service?.id || payload?.service?.service_id ||
    payload?.data?.id || payload?.data?.service_id || payload?.id || payload?.service_id;
  if (typeof value !== "string" || !/^svc_[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new Error("the402 did not return a valid service ID.");
  }
  return value;
}

const existing = await existingServices();
const map: Record<string, The402Product> = {};
const results: Array<{ product: The402Product; service_id: string; action: "created" | "updated" }> = [];
for (const definition of definitions) {
  const previous = existing.find(({ id }) => id === definition.service_id);
  const payload = {
    name: definition.name,
    description: definition.description,
    price: { fixed: definition.price },
    service_type: "data_api",
    pricing_model: "fixed",
    fulfillment_type: "instant",
    estimated_delivery: "30s",
    category: "developer-tools",
    tags: definition.tags,
    input_schema: definition.input_schema,
    deliverable_schema: definition.deliverable_schema,
  };
  const response = await platformFetch(previous ? `/services/${previous.id}` : "/services", {
    method: previous ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`the402 ${definition.product} listing returned HTTP ${response.status}: ${error.slice(0, 500)}`);
  }
  const id = previous?.id || serviceId(await response.json());
  map[id] = definition.product;
  results.push({ product: definition.product, service_id: id, action: previous ? "updated" : "created" });
}

console.log(JSON.stringify({ participant_id: participantId, service_map: map, services: results }, null, 2));
