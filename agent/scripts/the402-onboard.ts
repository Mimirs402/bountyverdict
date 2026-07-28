import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { MARKETPLACE_PRODUCTS, type MarketplaceProduct } from "../src/the402.ts";
import {
  THE402_API,
  THE402_LISTINGS,
  THE402_SERVICE_DEFINITIONS,
} from "../src/the402-catalog.ts";

const api = THE402_API;
const apiKey = process.env.THE402_API_KEY;
const participantId = process.env.THE402_PARTICIPANT_ID;
const enabled = process.env.THE402_CREATE === "YES";
const stagePending = process.env.THE402_STAGE_PENDING === "YES";
const webhookUrl = "https://bountyverdict-agent-production.mimirslab.workers.dev/api/the402/webhook";
const configFile = process.env.THE402_CONFIG_FILE ||
  `${homedir()}/.config/bountyverdict/the402.env`;

if (!enabled) throw new Error("Set THE402_CREATE=YES to create or update marketplace listings.");
if (!apiKey || apiKey.length < 16) throw new Error("THE402_API_KEY is missing or invalid.");
if (!participantId || !/^p_[A-Za-z0-9_-]{1,160}$/.test(participantId)) {
  throw new Error("THE402_PARTICIPANT_ID is missing or invalid.");
}

const definitions = stagePending
  ? THE402_SERVICE_DEFINITIONS.filter(({ service_id }) => service_id.endsWith("_PENDING"))
  : THE402_LISTINGS;

if (
  !definitions.length ||
  definitions.some(({ product }) => !MARKETPLACE_PRODUCTS.includes(product)) ||
  new Set(definitions.map(({ product }) => product)).size !== definitions.length ||
  (stagePending && definitions.some(({ service_id }) => !service_id.endsWith("_PENDING"))) ||
  (!stagePending && definitions.some(({ service_id }) => service_id.endsWith("_PENDING")))
) {
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

function findString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  if (!Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === "string") {
    return (value as Record<string, string>)[key];
  }
  for (const nested of Object.values(value)) {
    const found = findString(nested, key);
    if (found) return found;
  }
  return null;
}

async function persistWebhookSecret(secret: string): Promise<void> {
  if (!/^whsec_[A-Za-z0-9_-]{8,}$/.test(secret)) {
    throw new Error("the402 participant update returned an invalid webhook secret.");
  }
  const existing = await readFile(configFile, "utf8");
  const next = /^THE402_WEBHOOK_SECRET=.*$/m.test(existing)
    ? existing.replace(/^THE402_WEBHOOK_SECRET=.*$/m, `THE402_WEBHOOK_SECRET=${secret}`)
    : `${existing.trimEnd()}\nTHE402_WEBHOOK_SECRET=${secret}\n`;
  await mkdir(dirname(configFile), { recursive: true, mode: 0o700 });
  const temporary = `${configFile}.${process.pid}.tmp`;
  await writeFile(temporary, next, { mode: 0o600 });
  await rename(temporary, configFile);
}

async function ensureWebhook(): Promise<"updated" | "unchanged"> {
  const response = await platformFetch(`/participants/${encodeURIComponent(participantId!)}`, {
    method: "PUT",
    body: JSON.stringify({ webhook_url: webhookUrl }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`the402 webhook registration returned HTTP ${response.status}: ${error.slice(0, 500)}`);
  }
  const payload = await response.json();
  const returnedUrl = findString(payload, "webhook_url");
  if (returnedUrl && returnedUrl !== webhookUrl) {
    throw new Error("the402 participant update returned an unexpected webhook URL.");
  }
  const secret = findString(payload, "webhook_secret");
  if (secret) {
    await persistWebhookSecret(secret);
    return "updated";
  }
  return "unchanged";
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

const webhook = await ensureWebhook();
const existing = await existingServices();
const duplicateNames = [...new Set(existing.map(({ name }) => name))]
  .filter((name) => existing.filter((service) => service.name === name).length > 1);
if (duplicateNames.length) {
  throw new Error(`the402 contains duplicate owned service names: ${duplicateNames.join(", ")}`);
}
const map: Record<string, MarketplaceProduct> = {};
const results: Array<{
  product: MarketplaceProduct;
  service_id: string;
  previous_service_id: string | null;
  action: "created" | "updated" | "recovered";
}> = [];
for (const definition of definitions) {
  const previous = existing.find(({ id }) => id === definition.service_id) ||
    existing.find(({ name }) => name === definition.name);
  // The platform's owned-service collection omits inactive services. Once an
  // authoritative ID is committed, update that exact resource directly so a
  // temporarily inactive listing cannot be duplicated by name.
  const configuredId = definition.service_id.endsWith("_PENDING")
    ? null
    : definition.service_id;
  const targetId = configuredId || previous?.id || null;
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
    status: stagePending ? "inactive" : "active",
  };
  const response = await platformFetch(targetId ? `/services/${targetId}` : "/services", {
    method: targetId ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`the402 ${definition.product} listing returned HTTP ${response.status}: ${error.slice(0, 500)}`);
  }
  const id = targetId || serviceId(await response.json());
  if (stagePending) {
    const deactivate = await platformFetch(`/services/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "inactive" }),
    });
    if (!deactivate.ok) {
      const error = await deactivate.text();
      throw new Error(`the402 ${definition.product} staging deactivation returned HTTP ${deactivate.status}: ${error.slice(0, 500)}`);
    }
  }
  map[id] = definition.product;
  results.push({
    product: definition.product,
    service_id: id,
    previous_service_id: targetId,
    action: targetId
      ? targetId === definition.service_id ? "updated" : "recovered"
      : "created",
  });
}

console.log(JSON.stringify({
  participant_id: participantId,
  webhook: { url: webhookUrl, secret: "stored_outside_repository", action: webhook },
  service_map: map,
  services: results,
}, null, 2));
