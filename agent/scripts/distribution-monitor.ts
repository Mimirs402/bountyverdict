import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { base } from "viem/chains";
import { validatePaymentChallenge } from "../src/payment-safety.ts";
import {
  OWNER_CONTROLLED_CANARY_PAYER,
  summarizeRevenue,
  type SettlementTransfer,
} from "../src/revenue.ts";
import { PRODUCT_CATALOG, productForAtomicAmount, type ProductKey } from "../src/product-catalog.ts";
import { mcpDriftExampleInput } from "../src/mcp-drift-discovery.ts";
import { evaluateEarnedPlacementExperiment } from "../src/acquisition.ts";
import {
  THE402_API,
  THE402_LISTINGS,
  THE402_SUBSCRIPTION_PLAN,
} from "../src/the402-catalog.ts";
import {
  NEAR_MARKET_API,
  NEAR_MARKET_LISTINGS,
  NEAR_MARKET_PROVIDER_ID,
} from "../src/near-market.ts";
import { PAYAN_API, PAYAN_OFFERS, PAYAN_PROVIDER_ID } from "../src/payan.ts";

const DEFAULT_API = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const DEFAULT_WALLET = "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
const DEFAULT_START_BLOCK = "48876000";
const CDP_DISCOVERY = "https://api.cdp.coinbase.com/platform/v2/x402/discovery";
const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NETWORK = "eip155:8453";
const TIMEOUT_MS = 30_000;

const api = new URL(process.env.PRODUCTION_API_URL || DEFAULT_API).origin;
const wallet = process.env.REVENUE_WALLET || DEFAULT_WALLET;
const startBlockInput = process.env.START_BLOCK || DEFAULT_START_BLOCK;
const stateFile = process.env.STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/distribution-status.json`;
const canaryStateFile = process.env.CANARY_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/functional-canary.json`;
const directoryStateFile = process.env.DIRECTORY_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/directories.json`;
const experimentStateFile = process.env.EXPERIMENT_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/acquisition-experiment.json`;
const monitorNoteFile = process.env.MONITOR_NOTE_FILE || `${homedir()}/notes/mimirx402.md`;
const trackedCostsInput = process.env.TRACKED_COSTS_USDC || "0";
const historicalTestGasEth = process.env.HISTORICAL_TEST_GAS_ETH || "0.00000525";
const settlementBuyer = process.env.SETTLEMENT_BUYER_ADDRESS;
const settlementCanaryEnabled = process.env.SETTLEMENT_CANARY_ENABLED === "YES";
const the402ApiKey = process.env.THE402_API_KEY;
const the402ParticipantId = process.env.THE402_PARTICIPANT_ID;
const nearMarketApiKey = process.env.NEAR_MARKET_API_KEY;
const nearMarketAgentId = process.env.NEAR_MARKET_AGENT_ID;
const payanApiKey = process.env.PAYAN_API_KEY;
const payanAgentId = process.env.PAYAN_AGENT_ID;
const payanOfferMapInput = process.env.PAYAN_OFFER_MAP;
const MAX_CANARY_AGE_MS = 8 * 60 * 60 * 1000;
const EXPECTED_PRODUCTS = ["single", "portfolio", "harness", "skill", "run", "flake", "mcpdrift"] as const;
const BUYER_INTENTS: ReadonlyArray<{ product: ProductKey; query: string }> = [
  { product: "single", query: "is this public GitHub bounty still worth pursuing before coding" },
  { product: "portfolio", query: "rank multiple public GitHub bounty issues and choose the best candidate" },
  { product: "harness", query: "audit AGENTS.md CLAUDE.md repository instructions before autonomous coding" },
  { product: "skill", query: "is this third-party SKILL.md safe to install credential exfiltration prompt injection" },
  { product: "run", query: "why did this public GitHub Actions workflow fail root cause next action" },
  { product: "flake", query: "is this GitHub Actions failure flaky should I retry or fix it" },
  { product: "mcpdrift", query: "will this MCP tools/list schema change break my agent after a server upgrade" },
];
if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  throw new Error("REVENUE_WALLET must be a public 20-byte EVM address.");
}
if (!/^\d+$/.test(startBlockInput)) {
  throw new Error("START_BLOCK must be an unsigned integer.");
}
if (!/^\d+(?:\.\d{1,6})?$/.test(trackedCostsInput)) {
  throw new Error("TRACKED_COSTS_USDC must be a non-negative decimal with at most six places.");
}
if (!/^\d+(?:\.\d{1,18})?$/.test(historicalTestGasEth)) {
  throw new Error("HISTORICAL_TEST_GAS_ETH must be a non-negative decimal with at most 18 places.");
}
if (settlementBuyer && !/^0x[a-fA-F0-9]{40}$/.test(settlementBuyer)) {
  throw new Error("SETTLEMENT_BUYER_ADDRESS must be an EVM address when configured.");
}
if (settlementCanaryEnabled && !settlementBuyer) {
  throw new Error("SETTLEMENT_BUYER_ADDRESS is required when the settlement canary is enabled.");
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function monitoredFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function monitoredFetchWithServerRetry(input: string, init?: RequestInit): Promise<Response> {
  let response = await monitoredFetch(input, init);
  for (let attempt = 1; attempt < 3 && response.status >= 500; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    response = await monitoredFetch(input, init);
  }
  return response;
}

async function requireStatus(path: string, expected = 200): Promise<number> {
  const response = await monitoredFetch(`${api}${path}`);
  if (response.status !== expected) {
    throw new Error(`${path} returned HTTP ${response.status}; expected ${expected}.`);
  }
  return response.status;
}

function decodeChallenge(header: string): any {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

async function inspectChallenge(
  product: ProductKey,
): Promise<Record<string, unknown>> {
  const url = product === "single"
    ? `${api}/api/verdict?issue_url=${encodeURIComponent("https://github.com/typeorm/typeorm/issues/3357")}`
    : product === "harness"
      ? `${api}/api/harness?repo_url=${encodeURIComponent("https://github.com/openai/codex")}`
      : product === "skill"
        ? `${api}/api/skill?repo_url=${encodeURIComponent("https://github.com/coinbase/agentic-wallet-skills")}&skill_path=${encodeURIComponent("skills/agentic-wallet")}`
        : product === "run"
          ? `${api}/api/run?run_url=${encodeURIComponent("https://github.com/openai/codex/actions/runs/29728148711")}`
          : product === "flake"
            ? `${api}/api/flake?run_url=${encodeURIComponent("https://github.com/actions/runner/actions/runs/29423388605")}&attempt=1`
            : product === "mcpdrift"
              ? `${api}/api/mcp-drift`
              : `${api}/api/portfolio`;
  const response = await monitoredFetch(url, product === "portfolio"
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue_urls: [
            "https://github.com/godotengine/godot/issues/70796",
            "https://github.com/typeorm/typeorm/issues/3357",
          ],
        }),
      }
    : product === "mcpdrift"
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mcpDriftExampleInput),
        }
    : undefined);
  if (response.status !== 402) {
    throw new Error(`${product} endpoint returned HTTP ${response.status}; expected 402.`);
  }
  const header = response.headers.get("payment-required");
  if (!header) throw new Error(`${product} endpoint omitted PAYMENT-REQUIRED.`);
  const challenge = decodeChallenge(header);
  const expectedAmount = PRODUCT_CATALOG[product].amountAtomic;
  const requirement = validatePaymentChallenge(challenge, {
    maximumAtomic: expectedAmount,
    executePayment: false,
    allowMainnet: false,
  });
  if (BigInt(requirement.amount) !== expectedAmount) {
    throw new Error(`${product} price changed from ${expectedAmount} atomic USDC.`);
  }
  if (requirement.network !== NETWORK) {
    throw new Error(`${product} endpoint is not on Base mainnet.`);
  }
  if (requirement.payTo.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error(`${product} endpoint recipient does not match the revenue wallet.`);
  }
  const expectedMethod = PRODUCT_CATALOG[product].method;
  const method = challenge.extensions?.bazaar?.info?.input?.method;
  if (method !== expectedMethod) {
    throw new Error(`${product} Bazaar method is ${method || "missing"}; expected ${expectedMethod}.`);
  }
  if (product === "mcpdrift" && challenge.extensions?.bazaar?.info?.input?.bodyType !== "json") {
    throw new Error("mcpdrift Bazaar bodyType is missing or not json.");
  }
  return {
    status: response.status,
    network: requirement.network,
    asset: requirement.asset,
    amount_atomic: requirement.amount,
    pay_to: requirement.payTo,
    bazaar_method: method,
  };
}

async function discoveryStatus(): Promise<Record<string, unknown>> {
  const merchantUrl = new URL(`${CDP_DISCOVERY}/merchant`);
  merchantUrl.searchParams.set("payTo", wallet);
  merchantUrl.searchParams.set("limit", "100");
  const merchantResponse = await monitoredFetch(merchantUrl.href);
  if (!merchantResponse.ok) {
    throw new Error(`CDP merchant discovery returned HTTP ${merchantResponse.status}.`);
  }
  const merchant = await merchantResponse.json() as { resources?: Array<{ resource?: string }> };
  const resources = merchant.resources || [];

  const searches = await Promise.all(BUYER_INTENTS.map(async ({ product, query }) => {
    const searchUrl = new URL(`${CDP_DISCOVERY}/search`);
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("network", NETWORK);
    searchUrl.searchParams.set("limit", "20");
    const response = await monitoredFetch(searchUrl.href);
    if (!response.ok) throw new Error(`CDP semantic discovery returned HTTP ${response.status}.`);
    const result = await response.json() as {
      resources?: Array<{ resource?: string }>;
      searchMethod?: string;
    };
    return { product, query, ...result };
  }));
  const semanticResources = [...new Set(searches.flatMap(({ resources: found = [] }) =>
    found.map(({ resource }) => resource).filter((resource): resource is string => Boolean(resource))
  ))];
  const merchantResources = new Set(resources.map(({ resource }) => resource).filter(Boolean));
  const expectedResources = {
    single: `${api}/api/verdict`,
    portfolio: `${api}/api/portfolio`,
    harness: `${api}/api/harness`,
    skill: `${api}/api/skill`,
    run: `${api}/api/run`,
    flake: `${api}/api/flake`,
    mcpdrift: `${api}/api/mcp-drift`,
  };
  const indexedProducts = Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) =>
    [name, merchantResources.has(resource)]
  ));
  const semanticProducts = Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) =>
    [name, semanticResources.includes(resource)]
  ));
  const semanticRanks = Object.fromEntries(searches.map(({ product, resources: found = [] }) => {
    const rank = found.findIndex((candidate) => candidate.resource === expectedResources[product]);
    return [product, rank >= 0 ? rank + 1 : null];
  }));
  const queryRanks = Object.fromEntries(searches.map(({ query, resources: found = [] }) => [
    query,
    Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) => {
      const rank = found.findIndex((candidate) => candidate.resource === resource);
      return [name, rank >= 0 ? rank + 1 : null];
    })),
  ]));
  const topCompetitors = Object.fromEntries(searches.map(({ product, resources: found = [] }) => [
    product,
    found.filter(({ resource }) => resource !== expectedResources[product]).slice(0, 3).map(({ resource }) => resource),
  ]));
  return {
    indexed: Object.values(indexedProducts).every(Boolean),
    indexed_products: indexedProducts,
    semantic_products: semanticProducts,
    semantic_best_rank: semanticRanks,
    query_ranks: queryRanks,
    top_competitors: topCompetitors,
    merchant_resource_count: resources.length,
    semantic_match_count: semanticResources.filter((resource) => resource.startsWith(`${api}/api/`)).length,
    search_method: [...new Set(searches.map(({ searchMethod }) => searchMethod).filter(Boolean))],
    resources: resources.map(({ resource }) => resource).filter(Boolean),
  };
}

async function revenueStatus(): Promise<Record<string, unknown>> {
  const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL) });
  const latestBlock = await client.getBlockNumber();
  const startBlock = BigInt(startBlockInput);
  if (startBlock > latestBlock) {
    throw new Error(`START_BLOCK ${startBlock} is ahead of latest Base block ${latestBlock}.`);
  }
  const transfer = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  );
  const transfers: SettlementTransfer[] = [];
  const chunkSize = 10_000n;
  for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += chunkSize) {
    const toBlock = fromBlock + chunkSize - 1n > latestBlock
      ? latestBlock
      : fromBlock + chunkSize - 1n;
    const logs = await client.getLogs({
      address: MAINNET_USDC,
      event: transfer,
      args: { to: wallet as Address },
      fromBlock,
      toBlock,
    });
    for (const log of logs) {
      if (log.args.from === undefined || log.args.value === undefined || !log.transactionHash || log.logIndex === null) continue;
      transfers.push({
        from: log.args.from,
        amount: log.args.value,
        transaction_hash: log.transactionHash,
        log_index: log.logIndex,
        block_number: log.blockNumber ?? undefined,
      });
    }
  }
  const summary = summarizeRevenue(
    transfers,
    undefined,
    settlementBuyer
      ? [OWNER_CONTROLLED_CANARY_PAYER, settlementBuyer]
      : [OWNER_CONTROLLED_CANARY_PAYER],
  );
  const recognizedBlocks = [...new Set(summary.recognized_transfers
    .map((entry) => entry.block_number)
    .filter((value): value is bigint => typeof value === "bigint"))];
  const blockTimestamps = new Map<string, string>();
  await Promise.all(recognizedBlocks.map(async (blockNumber) => {
    const block = await client.getBlock({ blockNumber });
    blockTimestamps.set(blockNumber.toString(), new Date(Number(block.timestamp) * 1000).toISOString());
  }));
  return {
    scanned_blocks: { from: startBlock.toString(), to: latestBlock.toString() },
    target_usdc: summary.target_usdc,
    recognized_usdc: summary.recognized_usdc,
    remaining_usdc: summary.remaining_usdc,
    progress_percent: summary.progress_percent,
    purchases: summary.purchases,
    recognized_transfers: summary.recognized_transfers.map((entry) => ({
      from: entry.from,
      transaction_hash: entry.transaction_hash,
      log_index: entry.log_index,
      amount_atomic: entry.amount.toString(),
      product: productForAtomicAmount(entry.amount),
      block_number: entry.block_number?.toString() || null,
      block_timestamp: entry.block_number ? blockTimestamps.get(entry.block_number.toString()) || null : null,
    })),
    canary_transfer_count: summary.canary_transfers.length,
    canary_usdc: summary.canary_usdc,
    canary_transfers: summary.canary_transfers.map((entry) => ({
      from: entry.from,
      transaction_hash: entry.transaction_hash,
      log_index: entry.log_index,
      amount_atomic: entry.amount.toString(),
    })),
    excluded_non_revenue_transfers: summary.excluded_transfers.map((entry) => ({
      from: entry.from,
      transaction_hash: entry.transaction_hash,
      log_index: entry.log_index,
      amount_atomic: entry.amount.toString(),
    })),
    unrelated_incoming_transfer_count: summary.unrecognized_transfers.length,
    unrelated_incoming_transfers: summary.unrecognized_transfers.map((entry) => ({
      from: entry.from,
      transaction_hash: entry.transaction_hash,
      log_index: entry.log_index,
      amount_atomic: entry.amount.toString(),
    })),
  };
}

async function the402Status(): Promise<Record<string, unknown>> {
  if (!the402ApiKey || !/^sk_[A-Za-z0-9_-]{8,}$/.test(the402ApiKey)) {
    throw new Error("THE402_API_KEY is missing or invalid.");
  }
  if (!the402ParticipantId || !/^p_[A-Za-z0-9_-]{1,160}$/.test(the402ParticipantId)) {
    throw new Error("THE402_PARTICIPANT_ID is missing or invalid.");
  }
  const catalogUrl = new URL(`${THE402_API}/services/catalog`);
  catalogUrl.searchParams.set("provider", the402ParticipantId);
  catalogUrl.searchParams.set("limit", "100");
  const [catalogResponse, earningsResponse, notificationsResponse, plansResponse] = await Promise.all([
    monitoredFetch(catalogUrl.href),
    monitoredFetch(`${THE402_API}/provider/earnings`, {
      headers: { "X-API-Key": the402ApiKey },
    }),
    monitoredFetch(`${THE402_API}/postings/notifications`, {
      headers: { "X-API-Key": the402ApiKey },
    }),
    monitoredFetch(`${THE402_API}/plans?limit=100`),
  ]);
  if (!catalogResponse.ok) throw new Error(`the402 catalog returned HTTP ${catalogResponse.status}.`);
  if (!earningsResponse.ok) throw new Error(`the402 earnings returned HTTP ${earningsResponse.status}.`);
  if (!notificationsResponse.ok) {
    throw new Error(`the402 request notification status returned HTTP ${notificationsResponse.status}.`);
  }
  if (!plansResponse.ok) throw new Error(`the402 plan catalog returned HTTP ${plansResponse.status}.`);
  const catalog = await catalogResponse.json() as { services?: Array<Record<string, any>> };
  const earnings = await earningsResponse.json() as Record<string, any>;
  const notifications = await notificationsResponse.json() as Record<string, any>;
  const plansPayload = await plansResponse.json() as Record<string, any>;
  const services = Array.isArray(catalog.services) ? catalog.services : [];
  const expectedById = new Map(THE402_LISTINGS.map((listing) => [listing.service_id, listing]));
  const expectedIds = new Set<string>(expectedById.keys());
  const owned = services.filter(({ id }) => expectedIds.has(String(id)));
  if (owned.length !== expectedIds.size || new Set(owned.map(({ id }) => id)).size !== expectedIds.size) {
    throw new Error("the402 catalog does not contain the exact six expected services.");
  }
  if (services.some(({ name }) => name === "SkillVerdict")) {
    throw new Error("SkillVerdict was added to the402 before its isolated experiment ended.");
  }
  if (!owned.every(({ webhook_healthy }) => webhook_healthy === true)) {
    throw new Error("the402 reports an unhealthy BountyVerdict webhook.");
  }
  for (const service of owned) {
    const expected = expectedById.get(String(service.id));
    if (!expected) throw new Error("the402 returned an unexpected service.");
    if (
      service.name !== expected.name || service.description !== expected.description ||
      service.price?.fixed !== expected.price || service.agent_price?.fixed !== expected.agent_price ||
      service.service_type !== "data_api" || service.fulfillment_type !== "instant" ||
      service.estimated_delivery !== "30s" || service.category !== "developer-tools" ||
      !isDeepStrictEqual(service.tags, expected.tags) ||
      !isDeepStrictEqual(service.input_schema, expected.input_schema) ||
      !isDeepStrictEqual(service.deliverable_schema, expected.deliverable_schema)
    ) {
      throw new Error(`the402 listing contract drifted for ${expected.name}.`);
    }
  }
  const completedCounts = [...new Set(owned.map(({ provider_completed_jobs }) => provider_completed_jobs))];
  if (completedCounts.length !== 1 || !Number.isSafeInteger(completedCounts[0]) || completedCounts[0] < 0) {
    throw new Error("the402 completed-job telemetry is inconsistent or invalid.");
  }
  if (earnings.provider_id !== the402ParticipantId) {
    throw new Error("the402 earnings belong to a different provider.");
  }
  if (String(earnings.wallet || "").toLowerCase() !== OWNER_CONTROLLED_CANARY_PAYER.toLowerCase()) {
    throw new Error("the402 earnings resolve to an unexpected provider wallet.");
  }
  if (notifications.enabled !== true) {
    throw new Error("the402 request.created notifications are not enabled.");
  }
  const plans = Array.isArray(plansPayload.plans) ? plansPayload.plans as Array<Record<string, any>> : [];
  const plan = plans.find(({ id }) => id === THE402_SUBSCRIPTION_PLAN.plan_id);
  if (
    !plan || plan.provider_id !== the402ParticipantId || plan.name !== THE402_SUBSCRIPTION_PLAN.name ||
    plan.description !== THE402_SUBSCRIPTION_PLAN.description ||
    plan.interval !== THE402_SUBSCRIPTION_PLAN.interval ||
    Number(plan.price_usd) !== THE402_SUBSCRIPTION_PLAN.agent_price_usd ||
    Number(plan.max_requests) !== THE402_SUBSCRIPTION_PLAN.max_requests ||
    !isDeepStrictEqual(plan.service_ids, THE402_SUBSCRIPTION_PLAN.service_ids)
  ) {
    throw new Error("the402 subscription plan is missing or its public contract drifted.");
  }
  const settledUsd = Number(earnings.earnings?.settled_usd);
  const heldUsd = Number(earnings.earnings?.held_usd);
  const pendingUsd = Number(earnings.earnings?.pending_usd);
  if (![settledUsd, heldUsd, pendingUsd].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("the402 earnings telemetry is invalid.");
  }
  const recentSettlements = Array.isArray(earnings.recent_settlements)
    ? earnings.recent_settlements as Array<Record<string, unknown>>
    : [];
  // A subscription is one purchase even when it later produces many covered
  // service calls. Only count settlements that the marketplace explicitly
  // attributes to our plan; never infer a subscription from price alone.
  const subscriptionSettlements = recentSettlements.flatMap((entry) => {
    const planId = typeof entry.plan_id === "string"
      ? entry.plan_id
      : typeof entry.subscription_plan_id === "string" ? entry.subscription_plan_id : null;
    if (planId !== THE402_SUBSCRIPTION_PLAN.plan_id) return [];
    const transactionHash = typeof entry.transaction_hash === "string"
      ? entry.transaction_hash
      : typeof entry.tx_hash === "string" ? entry.tx_hash : null;
    const settlementId = typeof entry.settlement_id === "string"
      ? entry.settlement_id
      : typeof entry.id === "string"
        ? entry.id
        : transactionHash;
    if (!settlementId) return [];
    return [{
      settlement_id: settlementId,
      plan_id: planId,
      subscription_id: typeof entry.subscription_id === "string" ? entry.subscription_id : null,
      transaction_hash: transactionHash,
      settled_at: typeof entry.settled_at === "string"
        ? entry.settled_at
        : typeof entry.created_at === "string" ? entry.created_at : null,
    }];
  });
  return {
    listed: true,
    participant_id: the402ParticipantId,
    provider_wallet: String(earnings.wallet).toLowerCase(),
    service_count: owned.length,
    skillverdict_excluded: true,
    webhook_healthy: true,
    listing_contracts_verified: true,
    request_notifications_enabled: true,
    request_notification_failures: Number.isSafeInteger(notifications.consecutive_failures)
      ? notifications.consecutive_failures
      : null,
    subscription_plan: {
      active: true,
      plan_id: THE402_SUBSCRIPTION_PLAN.plan_id,
      name: THE402_SUBSCRIPTION_PLAN.name,
      agent_price_usd: THE402_SUBSCRIPTION_PLAN.agent_price_usd,
      provider_net_usd: THE402_SUBSCRIPTION_PLAN.provider_price_usd,
      maximum_monthly_requests: THE402_SUBSCRIPTION_PLAN.max_requests,
      service_count: THE402_SUBSCRIPTION_PLAN.service_ids.length,
    },
    completed_jobs: completedCounts[0],
    settled_usd: settledUsd,
    held_usd: heldUsd,
    pending_usd: pendingUsd,
    recent_settlement_count: recentSettlements.length,
    subscription_settlement_ids: subscriptionSettlements.map(({ settlement_id }) => settlement_id),
    subscription_settlements: subscriptionSettlements,
    recent_settlements: recentSettlements.map((entry) => ({
      service_id: typeof entry.service_id === "string" ? entry.service_id : null,
      transaction_hash: typeof entry.transaction_hash === "string"
        ? entry.transaction_hash
        : typeof entry.tx_hash === "string" ? entry.tx_hash : null,
      amount_usd: typeof entry.amount_usd === "number" || typeof entry.amount_usd === "string"
        ? entry.amount_usd
        : null,
      settled_at: typeof entry.settled_at === "string"
        ? entry.settled_at
        : typeof entry.created_at === "string" ? entry.created_at : null,
    })),
    services: owned.map(({ id, name, price, agent_price, provider_net_price, webhook_healthy }) => ({
      id,
      name,
      price,
      agent_price,
      provider_net_price,
      webhook_healthy,
    })),
  };
}

async function nearMarketStatus(): Promise<Record<string, unknown>> {
  if (!nearMarketApiKey || !/^sk_live_[A-Za-z0-9_-]+$/.test(nearMarketApiKey)) {
    throw new Error("NEAR_MARKET_API_KEY is missing or invalid.");
  }
  if (nearMarketAgentId !== NEAR_MARKET_PROVIDER_ID) {
    throw new Error("NEAR_MARKET_AGENT_ID does not match the pinned provider.");
  }
  const headers = { Authorization: `Bearer ${nearMarketApiKey}` };
  const [servicesResponse, jobsResponse, walletResponse] = await Promise.all([
    monitoredFetch(`${NEAR_MARKET_API}/agents/me/services`, { headers }),
    monitoredFetch(`${NEAR_MARKET_API}/jobs?worker=${encodeURIComponent(NEAR_MARKET_PROVIDER_ID)}&limit=100`, { headers }),
    monitoredFetchWithServerRetry(`${NEAR_MARKET_API}/wallet/balance`, { headers }),
  ]);
  if (!servicesResponse.ok) throw new Error(`service lookup returned HTTP ${servicesResponse.status}.`);
  if (!jobsResponse.ok) throw new Error(`job lookup returned HTTP ${jobsResponse.status}.`);
  if (!walletResponse.ok) throw new Error(`wallet lookup returned HTTP ${walletResponse.status}.`);
  const services = await servicesResponse.json() as Array<Record<string, any>>;
  const jobs = await jobsResponse.json() as Array<Record<string, any>>;
  const walletState = await walletResponse.json() as Record<string, any>;
  if (!Array.isArray(services) || !Array.isArray(jobs)) throw new Error("marketplace returned invalid telemetry.");
  const expected = new Map(NEAR_MARKET_LISTINGS.map((listing) => [listing.name, listing]));
  const owned = services.filter(({ name }) => expected.has(String(name)));
  if (owned.length !== expected.size || new Set(owned.map(({ service_id }) => service_id)).size !== expected.size) {
    throw new Error("catalog does not contain the exact six expected services.");
  }
  for (const service of owned) {
    const listing = expected.get(String(service.name));
    if (!listing || service.agent_id !== NEAR_MARKET_PROVIDER_ID ||
      service.description !== listing.description || service.category !== listing.category ||
      service.pricing_model !== listing.pricing_model || service.endpoint_url !== listing.endpoint_url ||
      service.price_amount !== listing.price_amount || service.price_token !== listing.price_token ||
      service.response_time_seconds !== listing.response_time_seconds || service.enabled !== true ||
      !isDeepStrictEqual(service.tags, listing.tags) ||
      !isDeepStrictEqual(service.input_schema, listing.input_schema) ||
      !isDeepStrictEqual(service.output_schema, listing.output_schema)) {
      throw new Error(`listing contract drifted for ${listing?.name || "unknown service"}.`);
    }
  }
  const completed = jobs.filter((job) =>
    job.worker_agent_id === NEAR_MARKET_PROVIDER_ID &&
    job.creator_agent_id !== NEAR_MARKET_PROVIDER_ID &&
    job.status === "completed"
  );
  const usdc = Array.isArray(walletState.balances)
    ? walletState.balances.find((entry: Record<string, unknown>) => entry.symbol === "USDC")
    : null;
  const earnedUsdc = Number(usdc?.balance || 0);
  if (!Number.isFinite(earnedUsdc) || earnedUsdc < 0) throw new Error("wallet USDC telemetry is invalid.");
  return {
    listed: true,
    provider_id: NEAR_MARKET_PROVIDER_ID,
    service_count: owned.length,
    listing_contracts_verified: true,
    completed_external_jobs: completed.length,
    completed_external_job_ids: completed.map(({ job_id }) => job_id),
    earned_usdc_balance: earnedUsdc,
    custody_account: walletState.is_custody_account === true,
  };
}

async function payanStatus(): Promise<Record<string, unknown>> {
  if (!payanApiKey || !/^pk_live_[A-Za-z0-9_-]+$/.test(payanApiKey)) throw new Error("PAYAN_API_KEY is missing or invalid.");
  if (payanAgentId !== PAYAN_PROVIDER_ID) throw new Error("PAYAN_AGENT_ID does not match the pinned provider.");
  let offerMap: Record<string, string>;
  try {
    offerMap = JSON.parse(payanOfferMapInput || "");
  } catch {
    throw new Error("PAYAN_OFFER_MAP is missing or invalid.");
  }
  const expectedProducts = new Set(PAYAN_OFFERS.map(({ product }) => product));
  if (Object.keys(offerMap).length !== expectedProducts.size ||
    [...expectedProducts].some((product) => !/^[a-z0-9]{20,64}$/.test(offerMap[product] || ""))) {
    throw new Error("PAYAN_OFFER_MAP does not contain the exact six expected offers.");
  }
  const [receiptResponse, ...offerResponses] = await Promise.all([
    monitoredFetch(`${PAYAN_API}/agents/${PAYAN_PROVIDER_ID}/receipts`),
    ...PAYAN_OFFERS.map(({ product }) => monitoredFetch(`${PAYAN_API}/offers/${offerMap[product]}`)),
  ]);
  if (!receiptResponse.ok) throw new Error(`receipt lookup returned HTTP ${receiptResponse.status}.`);
  if (offerResponses.some((response) => !response.ok)) throw new Error("one or more offer lookups failed.");
  const receiptPayload = await receiptResponse.json() as Record<string, any>;
  const offers = await Promise.all(offerResponses.map((response) => response.json() as Promise<Record<string, any>>));
  for (let index = 0; index < PAYAN_OFFERS.length; index += 1) {
    const expected = PAYAN_OFFERS[index];
    const offer = offers[index]?.offer;
    if (!offer || offer._id !== offerMap[expected.product] || offer.sellerId !== PAYAN_PROVIDER_ID ||
      offer.title !== expected.title || offer.description !== expected.description ||
      offer.category !== expected.category || offer.offerType !== expected.offerType ||
      offer.httpMethod !== expected.httpMethod || offer.inputSchema !== expected.inputSchema ||
      offer.outputSchema !== expected.outputSchema || Number(offer.priceCents) !== expected.priceCents ||
      offer.isActive !== true || !isDeepStrictEqual(offer.tags, expected.tags)) {
      throw new Error(`offer contract drifted for ${expected.title}.`);
    }
  }
  const receipts = Array.isArray(receiptPayload.receipts) ? receiptPayload.receipts as Array<Record<string, any>> : [];
  const offerIds = new Set(Object.values(offerMap));
  const delivered = receipts.filter((receipt) =>
    receipt.sellerId === PAYAN_PROVIDER_ID && receipt.buyerId !== PAYAN_PROVIDER_ID &&
    offerIds.has(String(receipt.offerId)) && receipt.status === "confirmed" && receipt.delivered === true
  );
  const receiptRevenueCents = delivered.reduce((sum, receipt) => sum + Number(receipt.amountCents || 0), 0);
  if (!Number.isSafeInteger(receiptRevenueCents) || receiptRevenueCents < 0) throw new Error("receipt revenue is invalid.");
  return {
    listed: true,
    provider_id: PAYAN_PROVIDER_ID,
    offer_count: offers.length,
    listing_contracts_verified: true,
    delivered_external_sales: delivered.length,
    delivered_receipt_ids: delivered.map(({ _id }) => _id),
    delivered_transaction_hashes: delivered.map(({ txHash }) => txHash),
    receipt_revenue_usdc: receiptRevenueCents / 100,
    accounting_note: "PayanAgent settles directly to the Base revenue wallet; these receipts are attribution metadata and are already counted by direct onchain settlement accounting.",
  };
}

async function functionalStatus(): Promise<Record<string, unknown>> {
  const raw = await readFile(canaryStateFile, "utf8");
  const state = JSON.parse(raw) as {
    checked_at?: unknown;
    healthy?: unknown;
    production_api?: unknown;
    products_checked?: unknown;
    checks?: unknown;
  };
  if (typeof state.checked_at !== "string" || !Number.isFinite(Date.parse(state.checked_at))) {
    throw new Error("Functional canary state has no valid checked_at timestamp.");
  }
  const ageMs = Date.now() - Date.parse(state.checked_at);
  if (ageMs < 0 || ageMs > MAX_CANARY_AGE_MS) {
    throw new Error(`Functional canary state is stale (${Math.round(ageMs / 60_000)} minutes old).`);
  }
  if (state.healthy !== true) throw new Error("The latest functional canary run is unhealthy.");
  if (state.production_api !== api) throw new Error("Functional canary state does not belong to the production API.");
  const checked = Array.isArray(state.products_checked) ? state.products_checked : [];
  const checkedSet = new Set(checked);
  const missing = EXPECTED_PRODUCTS.filter((product) => !checkedSet.has(product));
  if (missing.length || checked.length !== EXPECTED_PRODUCTS.length || checkedSet.size !== EXPECTED_PRODUCTS.length) {
    throw new Error(`Functional canary state has an invalid product set${missing.length ? `; missing ${missing.join(", ")}` : ""}.`);
  }
  const checks = Array.isArray(state.checks) ? state.checks as Array<Record<string, unknown>> : [];
  const checkProducts = checks.map(({ product }) => product);
  for (const product of EXPECTED_PRODUCTS) {
    const matching = checks.filter((check) => check.product === product);
    if (matching.length !== 1) throw new Error(`Functional canary state must contain one ${product} check.`);
    const check = matching[0];
    if (check.ok !== true || check.contract !== "1.0" || check.http_status !== 200) {
      throw new Error(`Functional canary ${product} check does not prove contract 1.0 success.`);
    }
    if (typeof check.checked_at !== "string" || !Number.isFinite(Date.parse(check.checked_at))) {
      throw new Error(`Functional canary ${product} check has no valid server timestamp.`);
    }
  }
  if (new Set(checkProducts).size !== EXPECTED_PRODUCTS.length) {
    throw new Error("Functional canary state contains duplicate or unexpected checks.");
  }
  return {
    healthy: true,
    checked_at: state.checked_at,
    age_seconds: Math.round(ageMs / 1000),
    products_checked: checked,
    checks,
  };
}

async function acquisitionStatus(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(directoryStateFile, "utf8");
    const state = JSON.parse(raw) as Record<string, any>;
    const checkedAt = typeof state.checked_at === "string" ? state.checked_at : null;
    return {
      available: true,
      checked_at: checkedAt,
      skills_sh: state.skills_sh || null,
      agenttool: state.agenttool || null,
      agentskill: state.agentskill || null,
      security_directory_pr: state.security_directory_pr || null,
      x402_directory_pr: state.x402_directory_pr || null,
      x402scout: state.x402scout || null,
      note: "Anonymous install telemetry is an acquisition signal, not proof of a genuine buyer or customer purchase.",
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function money(value: unknown): string {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? `$${parsed.toFixed(2)}` : "unavailable";
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function renderMonitorNote(report: Record<string, any>): string {
  const directRevenueValue = Number(report.revenue?.recognized_usdc || 0);
  const marketplaceRevenueValue = Number(report.marketplaces?.the402?.settled_usd || 0);
  const nearRevenueValue = Number(report.marketplaces?.near?.earned_usdc_balance || 0);
  const revenueValue = directRevenueValue + marketplaceRevenueValue + nearRevenueValue;
  const costsValue = Number(trackedCostsInput);
  const profitValue = revenueValue - costsValue;
  const purchases = report.revenue?.purchases || {};
  const marketplacePurchases = Number(report.marketplaces?.the402?.completed_jobs || 0);
  const subscriptionPurchases = Number(report.marketplaces?.the402?.subscription_purchases || 0);
  const nearPurchases = Number(report.marketplaces?.near?.completed_external_jobs || 0);
  const payanAttributedSales = Number(report.marketplaces?.payan?.delivered_external_sales || 0);
  const totalPurchases = Number(purchases.total || 0) + marketplacePurchases + subscriptionPurchases + nearPurchases;
  const skillInstalls = report.acquisition?.skills_sh?.install_counts || {};
  const totalSkillInstalls = report.acquisition?.skills_sh?.total_installs;
  const experiment = report.acquisition?.experiment || {};
  const ranks = report.discovery?.semantic_best_rank || {};
  const indexed = report.discovery?.indexed_products || {};
  const status = report.healthy ? "HEALTHY" : "DEGRADED";
  const errors = Array.isArray(report.errors) && report.errors.length
    ? report.errors.map((error: unknown) => `- ${String(error)}`).join("\n")
    : "- None";
  return `# Mimir x402 Monitor

- **STATUS:** ${status}
- **Customer revenue:** ${money(revenueValue)} / $1,000.00
- **Current profit (recognized-USDC basis):** ${money(profitValue)} (customer revenue minus ${money(costsValue)} tracked USD costs)
- **Historic owner-test gas:** approximately ${historicalTestGasEth} ETH (reported separately; not converted into tracked USD costs)
- **Distribution milestone:** ${totalPurchases} / 10 genuine external purchases
- **Current acquisition experiment:** ${experiment.status || "unavailable"}${experiment.started_at ? ` (started ${experiment.started_at}; ends ${experiment.ends_at})` : " (clock starts on first verified directory placement)"}
- **Experiment next action:** ${experiment.next_action?.code || "unavailable"} — ${experiment.next_action?.reason || "No classified action available."}
- **Customer purchases:** ${totalPurchases} (${Number(purchases.total || 0)} direct x402; ${marketplacePurchases} the402 one-off jobs; ${subscriptionPurchases} the402 subscriptions; ${nearPurchases} NEAR Agent Market jobs)
- **the402 listing contracts:** ${report.marketplaces?.the402?.listing_contracts_verified ? "6 / 6 exact input and deliverable schemas verified" : "unavailable or drifted"}
- **the402 buyer-request feed:** ${report.marketplaces?.the402?.request_notifications_enabled ? "enabled; exact-match autonomous bids only" : "unavailable"}
- **the402 monthly bundle:** ${report.marketplaces?.the402?.subscription_plan?.active ? `$${Number(report.marketplaces.the402.subscription_plan.agent_price_usd).toFixed(2)} for up to ${report.marketplaces.the402.subscription_plan.maximum_monthly_requests} requests` : "unavailable"}
- **NEAR Agent Market listings:** ${report.marketplaces?.near?.listing_contracts_verified ? "6 / 6 exact contracts verified" : "unavailable or drifted"}
- **PayanAgent offers:** ${report.marketplaces?.payan?.listing_contracts_verified ? "6 / 6 exact contracts verified" : "unavailable or drifted"} (${payanAttributedSales} delivered sales, attributed inside direct onchain totals)
- **skills.sh anonymous CLI installs:** ${Number.isFinite(Number(totalSkillInstalls)) ? Number(totalSkillInstalls) : "unavailable"} (acquisition signal only; 8-install baseline on 2026-07-20)
- **Owner canary settlements excluded:** ${Number(report.revenue?.canary_transfer_count || 0)} (${money(report.revenue?.canary_usdc || 0)})
- **Unrelated incoming transfers:** ${Number(report.revenue?.unrelated_incoming_transfer_count || 0)}
- **Last refreshed:** ${report.checked_at}

Owner-funded launch proofs and every settlement from the dedicated owner canary payer are excluded from both customer revenue and profit. Unrelated incoming transfers remain separate from purchases. Wallet reserves are capital, not revenue. Profit is not a full fiat-accounting figure until the separately reported historic gas is converted and entered as a tracked USD cost.

## Current milestone

The seven-product suite is healthy in production and unattended GitHub-to-Cloudflare deployment is verified end to end. Six existing products now expose exact canonical deliverable contracts on the402, and the owned agent manifest plus llms.txt publish their escrow purchase routes. SkillVerdict remains isolated. Distribution is now the sole product milestone: no eighth tool will be built until ten genuine purchases have been recognized from external payers. Owner-funded checks remain excluded.

## What is next

1. Keep the SkillVerdict earned-placement experiment isolated through its seven-day exposure window; do not change price or positioning mid-test.
2. Monitor GitHub Skill, AgentTool, AgentSkill, and skills.sh indexing; keep retries bounded and do not generate fake install telemetry.
3. Monitor the six signed the402 listings, exact marketplace contract integrity, guarded buyer-request feed, and Coinbase Bazaar while keeping SkillVerdict out of the new channel until its isolated experiment ends.
4. Improve positioning from observed discovery and genuine calls until ten external purchases are recognized. Do not build an eighth product before that gate.

## Production health

- API: ${report.production_api}
- Payment/network: Base mainnet USDC, exact x402 v2
- Functional canary: ${report.functional?.healthy === true ? "healthy" : "unhealthy or stale"}
- Latest functional pass: ${report.functional?.checked_at || "unavailable"}
- Products checked: ${Array.isArray(report.functional?.products_checked) ? report.functional.products_checked.join(", ") : "unavailable"}
- Monitor errors:
${errors}

## Products and distribution

| Product | Price | Global semantic best rank | Merchant cache |
|---|---:|---:|---|
| BountyVerdict | $0.05 | ${ranks.single ?? "not found"} | ${indexed.single ? "indexed" : "pending"} |
| BountyVerdict Portfolio | $0.40 | ${ranks.portfolio ?? "not found"} | ${indexed.portfolio ? "indexed" : "pending"} |
| HarnessVerdict | $0.03 | ${ranks.harness ?? "not found"} | ${indexed.harness ? "indexed" : "pending"} |
| SkillVerdict | $0.06 | ${ranks.skill ?? "not found"} | ${indexed.skill ? "indexed" : "pending"} |
| RunVerdict | $0.04 | ${ranks.run ?? "not found"} | ${indexed.run ? "indexed" : "pending"} |
| FlakeVerdict | $0.07 | ${ranks.flake ?? "not found"} | ${indexed.flake ? "indexed" : "pending"} |
| MCPDriftVerdict | $0.02 | ${ranks.mcpdrift ?? "not found"} | ${indexed.mcpdrift ? "indexed" : "pending"} |

## Acquisition funnel

- skills.sh repository installs: ${Number.isFinite(Number(totalSkillInstalls)) ? Number(totalSkillInstalls) : "unavailable"}
- Router installs: ${Number(skillInstalls["route-github-agent-checks"] || 0)}
- SkillVerdict workflow installs: ${Number(skillInstalls["preflight-agent-skills"] || 0)}
- AgentTool: ${report.acquisition?.agenttool?.status || (report.acquisition?.agenttool?.listed ? "listed" : "unavailable")}
- AgentSkill: ${report.acquisition?.agentskill?.status || (report.acquisition?.agentskill?.listed ? "listed" : "unavailable")}
- Agent security directory PR: ${report.acquisition?.security_directory_pr?.status || "unavailable"} (${report.acquisition?.security_directory_pr?.url || "not recorded"})
- x402 ecosystem directory PR: ${report.acquisition?.x402_directory_pr?.status || "unavailable"} (${report.acquisition?.x402_directory_pr?.url || "not recorded"})
- x402Scout GET listings: ${report.acquisition?.x402scout?.listed_entries ?? "unavailable"} / ${report.acquisition?.x402scout?.expected_entries ?? 5} (${report.acquisition?.x402scout?.status || "unavailable"}; positions ${Array.isArray(report.acquisition?.x402scout?.catalog_positions) ? report.acquisition.x402scout.catalog_positions.join(", ") : "unavailable"} of ${report.acquisition?.x402scout?.catalog_entries ?? "unavailable"}; ${typeof report.acquisition?.x402scout?.total_query_count === "number" ? report.acquisition.x402scout.total_query_count : "unavailable"} catalog queries)
- the402 listings: ${report.marketplaces?.the402?.service_count ?? "unavailable"} / 6 (${report.marketplaces?.the402?.webhook_healthy ? "signed webhook healthy" : "unavailable"}; SkillVerdict excluded during isolated experiment)
- NEAR Agent Market listings: ${report.marketplaces?.near?.service_count ?? "unavailable"} / 6 (automated JSON fulfillment; SkillVerdict excluded)
- PayanAgent offers: ${report.marketplaces?.payan?.offer_count ?? "unavailable"} / 6 (Base x402 proxy; SkillVerdict excluded)
- Experiment status: ${experiment.status || "unavailable"}
- Experiment baseline: 8 total installs, 2 router installs, 1 SkillVerdict workflow install, 0 genuine purchases
- Experiment delta: ${Number(experiment.delta?.installs?.total || 0)} total installs, ${Number(experiment.delta?.installs?.router || 0)} router installs, ${Number(experiment.delta?.installs?.skillverdict || 0)} SkillVerdict workflow installs, ${Number(experiment.delta?.genuine_purchases || 0)} genuine purchases
- Classified next action: ${experiment.next_action?.code || "unavailable"} — ${experiment.next_action?.reason || "No classified action available."}
- Terminal snapshot: scheduled for 2026-07-27T16:37:15Z; the first terminal result is persisted and cannot be rewritten by later cumulative counters

skills.sh counts are anonymous CLI telemetry with unknown provenance. They are tracked as a funnel signal only and are never counted as purchases or revenue.

## Revenue detail

- the402 completed customer jobs: ${marketplacePurchases}
- the402 genuine subscription purchases: ${subscriptionPurchases}
- the402 settled provider revenue: ${money(marketplaceRevenueValue)}
- the402 held/pending: ${money(report.marketplaces?.the402?.held_usd || 0)} / ${money(report.marketplaces?.the402?.pending_usd || 0)}
- NEAR Agent Market completed external jobs: ${nearPurchases}
- NEAR Agent Market earned USDC balance: ${money(nearRevenueValue)}
- PayanAgent delivered receipts: ${payanAttributedSales} (${money(report.marketplaces?.payan?.receipt_revenue_usdc || 0)} already included in direct Base settlements, never added twice)

- Single verdict purchases: ${Number(purchases.single || 0)}
- Portfolio purchases: ${Number(purchases.portfolio || 0)}
- Harness purchases: ${Number(purchases.harness || 0)}
- Skill purchases: ${Number(purchases.skill || 0)}
- Run purchases: ${Number(purchases.run || 0)}
- Flake purchases: ${Number(purchases.flake || 0)}
- MCP drift purchases: ${Number(purchases.mcpdrift || 0)}
- Owner canary settlement volume excluded: ${money(report.revenue?.canary_usdc || 0)} across ${Number(report.revenue?.canary_transfer_count || 0)} transfers
- Unrelated incoming transfers: ${Number(report.revenue?.unrelated_incoming_transfer_count || 0)}
- Remaining to first goal: ${money(Math.max(0, 1_000 - revenueValue))}

This file is overwritten by the production monitor. Machine-readable state: \`~/.local/state/bountyverdict/distribution-status.json\`.
`;
}

const checkedAt = new Date().toISOString();
const errors: string[] = [];
let health: Record<string, unknown> = {};
let discovery: Record<string, unknown> = {};
let revenue: Record<string, unknown> = {};
let functional: Record<string, unknown> = {};
let acquisition: Record<string, unknown> = {};
let the402: Record<string, unknown> = {};
let nearMarket: Record<string, unknown> = {};
let payan: Record<string, unknown> = {};

try {
  const [root, sample, portfolioSample, harnessSample, skillSample, runSample, flakeSample, mcpDriftSample, openapi, llms] = await Promise.all([
    requireStatus("/"),
    requireStatus("/api/sample"),
    requireStatus("/api/portfolio/sample"),
    requireStatus("/api/harness/sample"),
    requireStatus("/api/skill/sample"),
    requireStatus("/api/run/sample"),
    requireStatus("/api/flake/sample"),
    requireStatus("/api/mcp-drift/sample"),
    requireStatus("/openapi.json"),
    requireStatus("/llms.txt"),
  ]);
  health = { root, sample, portfolio_sample: portfolioSample, harness_sample: harnessSample, skill_sample: skillSample, run_sample: runSample, flake_sample: flakeSample, mcp_drift_sample: mcpDriftSample, openapi, llms };
  // Probe protected routes sequentially. A fresh deployment may place concurrent
  // requests on separate cold isolates, causing redundant facilitator syncs and
  // a false whole-suite timeout. Incremental assignment also preserves the
  // evidence collected before any individual failure.
  for (const product of EXPECTED_PRODUCTS) {
    health[product] = await inspectChallenge(product);
  }
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

try {
  discovery = await discoveryStatus();
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

try {
  revenue = await revenueStatus();
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

try {
  functional = await functionalStatus();
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

acquisition = await acquisitionStatus();

try {
  const installs = (acquisition.skills_sh as Record<string, any> | null)?.install_counts || {};
  const scout = acquisition.x402scout as Record<string, unknown> | null;
  const recognizedPurchases = Array.isArray(revenue.recognized_transfers)
    ? (revenue.recognized_transfers as Array<Record<string, unknown>>).map((transfer) => ({
        product: typeof transfer.product === "string" ? transfer.product : "",
        settled_at: typeof transfer.block_timestamp === "string" ? transfer.block_timestamp : "",
      }))
    : undefined;
  let persisted: Record<string, any> = {};
  try {
    persisted = JSON.parse(await readFile(experimentStateFile, "utf8"));
    if (persisted.name !== "skillverdict_earned_directory_placement") {
      throw new Error("Acquisition experiment state belongs to a different experiment.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const evaluated = persisted.terminal_result || evaluateEarnedPlacementExperiment({
    checked_at: checkedAt,
    healthy: errors.length === 0,
    persisted_started_at: typeof persisted.started_at === "string" ? persisted.started_at : undefined,
    total_installs: optionalCount((acquisition.skills_sh as Record<string, unknown> | null)?.total_installs),
    router_installs: optionalCount(installs["route-github-agent-checks"]),
    skillverdict_installs: optionalCount(installs["preflight-agent-skills"]),
    skillverdict_registry_queries: optionalCount(scout?.skillverdict_query_count),
    non_target_registry_queries: optionalCount(scout?.non_target_query_count),
    recognized_purchases: recognizedPurchases,
    placements: [
      acquisition.security_directory_pr as Record<string, unknown>,
      acquisition.x402_directory_pr as Record<string, unknown>,
      acquisition.x402scout as Record<string, unknown>,
    ],
  });
  const terminalStatuses = new Set([
    "inconclusive_measurement",
    "target_purchase_success",
    "off_target_purchase_success",
    "install_to_purchase_failure",
    "listing_to_install_failure",
    "off_target_reach",
    "reach_failure",
  ]);
  const terminalResult = persisted.terminal_result ||
    (terminalStatuses.has(String(evaluated.status)) ? { ...evaluated, frozen_at: checkedAt } : null);
  await atomicWrite(experimentStateFile, `${JSON.stringify({
    name: "skillverdict_earned_directory_placement",
    initialized_at: persisted.initialized_at || checkedAt,
    started_at: persisted.started_at || evaluated.started_at,
    ends_at: persisted.ends_at || evaluated.ends_at,
    baseline: persisted.baseline || evaluated.baseline,
    terminal_result: terminalResult,
  }, null, 2)}\n`);
  acquisition = {
    ...acquisition,
    experiment: terminalResult || evaluated,
  };
} catch (error) {
  errors.push(`Acquisition experiment: ${error instanceof Error ? error.message : String(error)}`);
}

// the402 is an independent distribution channel. Its availability affects the
// overall monitor, but must not contaminate the isolated SkillVerdict exposure
// experiment's health classification above.
try {
  the402 = await the402Status();
  let previousSubscriptionIds: string[] = [];
  try {
    const previousReport = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, any>;
    const previousIds = previousReport.marketplaces?.the402?.subscription_settlement_ids;
    if (Array.isArray(previousIds)) {
      previousSubscriptionIds = previousIds.filter((value): value is string => typeof value === "string");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const currentSubscriptionIds = Array.isArray(the402.subscription_settlement_ids)
    ? the402.subscription_settlement_ids.filter((value): value is string => typeof value === "string")
    : [];
  const subscriptionSettlementIds = [...new Set([
    ...previousSubscriptionIds,
    ...currentSubscriptionIds,
  ])];
  the402 = {
    ...the402,
    subscription_settlement_ids: subscriptionSettlementIds,
    subscription_purchases: subscriptionSettlementIds.length,
  };
} catch (error) {
  errors.push(`the402: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  nearMarket = await nearMarketStatus();
} catch (error) {
  errors.push(`NEAR Agent Market: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  payan = await payanStatus();
} catch (error) {
  errors.push(`PayanAgent: ${error instanceof Error ? error.message : String(error)}`);
}

const report = {
  product: "BountyVerdict",
  checked_at: checkedAt,
  healthy: errors.length === 0,
  production_api: api,
  network: NETWORK,
  revenue_wallet: wallet,
  health,
  discovery,
  revenue,
  marketplaces: { the402, near: nearMarket, payan },
  commerce: {
    genuine_purchases: Number((revenue.purchases as Record<string, unknown> | undefined)?.total || 0) +
      Number(the402.completed_jobs || 0) + Number(the402.subscription_purchases || 0) +
      Number(nearMarket.completed_external_jobs || 0),
    customer_revenue_usdc: (
      Number(revenue.recognized_usdc || 0) + Number(the402.settled_usd || 0) +
      Number(nearMarket.earned_usdc_balance || 0)
    ).toFixed(6).replace(/\.?0+$/, ""),
    tracked_costs_usdc: trackedCostsInput,
  },
  functional,
  acquisition,
  errors,
};

await atomicWrite(stateFile, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(monitorNoteFile, renderMonitorNote(report));
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
