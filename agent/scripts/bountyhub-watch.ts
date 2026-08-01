import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  BOUNTYHUB_API,
  BOUNTYHUB_MAX_PAGES,
  BOUNTYHUB_PAGE_SIZE,
  analyzeBountyHubInventory,
  bountyHubDetailListings,
  parseBountyHubDetail,
  parseBountyHubPage,
  type BountyHubListing,
} from "../src/bountyhub-watch.ts";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import {
  OPPORTUNITY_MARKER_VERSION,
  parseOpportunityTrigger,
  parseRememberedOpportunityFingerprints,
} from "../src/opportunity-agent-workflow.ts";
import { coordinateOpportunityTrigger } from "../src/opportunity-trigger-coordination.ts";

const stateRoot = resolve(process.env.BOUNTYVERDICT_STATE_ROOT || `${homedir()}/.local/state/bountyverdict`);
const statePath = `${stateRoot}/bountyhub-watch.json`;
const triggerPath = `${stateRoot}/opportunity-trigger.json`;
const producerLockPath = `${stateRoot}/opportunity-trigger-producer.lock`;
const userAgent = "MimirsLab-BountyOpportunityMonitor/1.0 (admin@mimirslab.com; bounded daily read)";

async function publicJson(url: URL): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`BountyHub returned HTTP ${response.status}.`);
  const body = await response.text();
  if (body.length > 8_000_000) throw new Error("BountyHub response exceeds the bounded size limit.");
  return JSON.parse(body) as unknown;
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function readBoundedJson(path: string, maximum: number): Promise<Record<string, unknown> | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximum) {
      throw new Error(`${path} is not a bounded regular file.`);
    }
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} is malformed.`);
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fetchListings(): Promise<{ listings: BountyHubListing[]; pages: number }> {
  const listings: BountyHubListing[] = [];
  for (let pageNumber = 1; pageNumber <= BOUNTYHUB_MAX_PAGES; pageNumber += 1) {
    const url = new URL("/api/bounties", BOUNTYHUB_API);
    url.searchParams.set("page", String(pageNumber));
    url.searchParams.set("limit", String(BOUNTYHUB_PAGE_SIZE));
    const page = parseBountyHubPage(await publicJson(url));
    listings.push(...page.listings);
    if (!page.has_next_page) return { listings, pages: pageNumber };
  }
  throw new Error(`BountyHub inventory exceeds the ${BOUNTYHUB_MAX_PAGES}-page safety bound.`);
}

const checkedAt = new Date().toISOString();
const previous = await readBoundedJson(statePath, 2_000_000);
if (previous && previous.schema_version !== 1) throw new Error("BountyHub watch state is incompatible.");
const inventory = await fetchListings();
const detailListings = bountyHubDetailListings(inventory.listings);
const details = [];
for (let index = 0; index < detailListings.length; index += 4) {
  const batch = detailListings.slice(index, index + 4);
  details.push(...await Promise.all(batch.map(async (listing) =>
    parseBountyHubDetail(await publicJson(new URL(`/api/bounties/${listing.id}`, BOUNTYHUB_API)), listing)
  )));
}
const analysis = analyzeBountyHubInventory(inventory.listings, details);
const priorRemembered = parseRememberedOpportunityFingerprints(previous?.triggered_opportunity_fingerprints);
const releaseProducerLock = await acquireExclusiveRun(producerLockPath, { staleAfterMs: 10 * 60 * 1_000 });
let pendingTriggerId: string | null = null;
let opportunityEvent: Awaited<ReturnType<typeof coordinateOpportunityTrigger>>;
try {
  const pending = await readBoundedJson(triggerPath, 256_000);
  pendingTriggerId = pending ? parseOpportunityTrigger(pending).trigger_id : null;
  opportunityEvent = await coordinateOpportunityTrigger({
    candidates: analysis.candidates,
    rememberedOpportunityFingerprints: priorRemembered,
    checkedAt,
    pendingTriggerId,
    writeTrigger: async (trigger) => atomicWrite(triggerPath, trigger),
  });
} finally {
  await releaseProducerLock();
}

const state = {
  schema_version: 1,
  checked_at: checkedAt,
  source: "BountyHub bounded public JSON API",
  collection_url: `${BOUNTYHUB_API}/api/bounties?page=1&limit=${BOUNTYHUB_PAGE_SIZE}`,
  user_agent: userAgent,
  read_only: true,
  external_actions_enabled: false,
  polling_cadence: "daily",
  pages_fetched: inventory.pages,
  inventory_count: inventory.listings.length,
  paid_open_listing_count: inventory.listings.filter((listing) => listing.open && listing.payment_status === "PAID").length,
  details_fetched: details.length,
  evaluated_issue_count: analysis.evaluations.length,
  admitted_candidate_count: analysis.candidates.length,
  evaluations: analysis.evaluations,
  marker_version: OPPORTUNITY_MARKER_VERSION,
  emitted_new_trigger: opportunityEvent.trigger !== null,
  trigger_id: opportunityEvent.trigger?.trigger_id || null,
  pending_trigger_id: pendingTriggerId,
  triggered_opportunity_fingerprints: opportunityEvent.remembered_opportunity_fingerprints,
};
await atomicWrite(statePath, state);
console.log(JSON.stringify({
  checked_at: checkedAt,
  inventory_count: inventory.listings.length,
  paid_open_listing_count: state.paid_open_listing_count,
  details_fetched: details.length,
  evaluated_issue_count: analysis.evaluations.length,
  admitted_candidate_count: analysis.candidates.length,
  emitted_new_trigger: opportunityEvent.trigger !== null,
  trigger_id: opportunityEvent.trigger?.trigger_id || null,
}, null, 2));
