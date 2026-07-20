import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { PAYAN_API, PAYAN_OFFERS, PAYAN_PROVIDER_ID } from "../src/payan.ts";

const enabled = process.env.PAYAN_CREATE === "YES";
const apiKey = process.env.PAYAN_API_KEY;
const agentId = process.env.PAYAN_AGENT_ID;
const secretFile = process.env.PAYAN_SECRET_FILE || `${homedir()}/.config/bountyverdict/payan.env`;
if (!enabled) throw new Error("Set PAYAN_CREATE=YES to create or update marketplace offers.");
if (!apiKey || !/^pk_live_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error("PAYAN_API_KEY is missing or invalid.");
if (agentId !== PAYAN_PROVIDER_ID) throw new Error("PAYAN_AGENT_ID does not match the pinned provider.");

let offerMap: Record<string, string> = {};
try {
  const parsed = JSON.parse(process.env.PAYAN_OFFER_MAP || "{}");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) offerMap = parsed;
} catch {
  throw new Error("PAYAN_OFFER_MAP is invalid JSON.");
}

async function persistMap(): Promise<void> {
  await mkdir(dirname(secretFile), { recursive: true, mode: 0o700 });
  const temporary = `${secretFile}.${process.pid}.tmp`;
  await writeFile(temporary, [
    `PAYAN_AGENT_ID=${agentId}`,
    `PAYAN_API_KEY=${apiKey}`,
    `PAYAN_OFFER_MAP='${JSON.stringify(offerMap)}'`,
    "",
  ].join("\n"), { mode: 0o600 });
  await rename(temporary, secretFile);
}

const results: Array<{ product: string; offer_id: string; action: "created" | "updated" }> = [];
for (const offer of PAYAN_OFFERS) {
  const previous = offerMap[offer.product];
  if (previous && !/^[a-z0-9]{20,64}$/.test(previous)) throw new Error(`Stored ${offer.product} offer ID is invalid.`);
  const response = await fetch(previous ? `${PAYAN_API}/offers/${previous}` : `${PAYAN_API}/offers`, {
    method: previous ? "PATCH" : "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(offer),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`PayanAgent ${offer.product} offer returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  const offerId = previous || payload.offerId;
  if (typeof offerId !== "string" || !/^[a-z0-9]{20,64}$/.test(offerId)) {
    throw new Error(`PayanAgent returned an invalid ${offer.product} offer ID.`);
  }
  offerMap[offer.product] = offerId;
  await persistMap();
  results.push({ product: offer.product, offer_id: offerId, action: previous ? "updated" : "created" });
}

console.log(JSON.stringify({ provider_id: PAYAN_PROVIDER_ID, offers: results }, null, 2));

