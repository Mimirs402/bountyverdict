import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { base } from "viem/chains";
import { validatePaymentChallenge } from "../src/payment-safety.ts";
import {
  OWNER_CONTROLLED_CANARY_PAYER,
  summarizeRevenue,
  type SettlementTransfer,
} from "../src/revenue.ts";
import { PRODUCT_CATALOG, type ProductKey } from "../src/product-catalog.ts";
import { mcpDriftExampleInput } from "../src/mcp-drift-discovery.ts";
import { evaluateEarnedPlacementExperiment } from "../src/acquisition.ts";

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
const monitorNoteFile = process.env.MONITOR_NOTE_FILE || `${homedir()}/notes/mimirx402.md`;
const trackedCostsInput = process.env.TRACKED_COSTS_USDC || "0";
const historicalTestGasEth = process.env.HISTORICAL_TEST_GAS_ETH || "0.00000525";
const settlementBuyer = process.env.SETTLEMENT_BUYER_ADDRESS;
const settlementCanaryEnabled = process.env.SETTLEMENT_CANARY_ENABLED === "YES";
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

function renderMonitorNote(report: Record<string, any>): string {
  const revenueValue = Number(report.revenue?.recognized_usdc || 0);
  const costsValue = Number(trackedCostsInput);
  const profitValue = revenueValue - costsValue;
  const purchases = report.revenue?.purchases || {};
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
- **Distribution milestone:** ${Number(purchases.total || 0)} / 10 genuine external purchases
- **Current acquisition experiment:** ${experiment.status || "unavailable"}${experiment.started_at ? ` (started ${experiment.started_at}; ends ${experiment.ends_at})` : " (clock starts on first verified directory placement)"}
- **Customer purchases:** ${Number(purchases.total || 0)}
- **skills.sh anonymous CLI installs:** ${Number.isFinite(Number(totalSkillInstalls)) ? Number(totalSkillInstalls) : "unavailable"} (acquisition signal only; 8-install baseline on 2026-07-20)
- **Owner canary settlements excluded:** ${Number(report.revenue?.canary_transfer_count || 0)} (${money(report.revenue?.canary_usdc || 0)})
- **Unrelated incoming transfers:** ${Number(report.revenue?.unrelated_incoming_transfer_count || 0)}
- **Last refreshed:** ${report.checked_at}

Owner-funded launch proofs and every settlement from the dedicated owner canary payer are excluded from both customer revenue and profit. Unrelated incoming transfers remain separate from purchases. Wallet reserves are capital, not revenue. Profit is not a full fiat-accounting figure until the separately reported historic gas is converted and entered as a tracked USD cost.

## Current milestone

The seven-product suite is healthy in production and unattended GitHub-to-Cloudflare deployment is verified end to end. The agent-first v1.0.1 release and dedicated catalog page are public, and direct version-pinned GitHub Skill preview and installation are verified. Distribution is now the sole product milestone: no eighth tool will be built until ten genuine purchases have been recognized from external payers. Owner-funded checks remain excluded.

## What is next

1. Keep the SkillVerdict earned-placement experiment isolated through its seven-day exposure window; do not change price or positioning mid-test.
2. Monitor GitHub Skill, AgentTool, AgentSkill, and skills.sh indexing; keep retries bounded and do not generate fake install telemetry.
3. Keep Coinbase Bazaar automatic discovery under observation while FlakeVerdict propagates and MCPDriftVerdict awaits an eligible settlement.
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
- x402Scout GET listings: ${report.acquisition?.x402scout?.listed_entries ?? "unavailable"} / ${report.acquisition?.x402scout?.expected_entries ?? 5} (${report.acquisition?.x402scout?.status || "unavailable"}; ${Number(report.acquisition?.x402scout?.total_query_count || 0)} catalog queries)
- Experiment status: ${experiment.status || "unavailable"}
- Experiment baseline: 8 total installs, 2 router installs, 1 SkillVerdict workflow install, 0 genuine purchases
- Experiment delta: ${Number(experiment.delta?.installs?.total || 0)} total installs, ${Number(experiment.delta?.installs?.router || 0)} router installs, ${Number(experiment.delta?.installs?.skillverdict || 0)} SkillVerdict workflow installs, ${Number(experiment.delta?.genuine_purchases || 0)} genuine purchases

skills.sh counts are anonymous CLI telemetry with unknown provenance. They are tracked as a funnel signal only and are never counted as purchases or revenue.

## Revenue detail

- Single verdict purchases: ${Number(purchases.single || 0)}
- Portfolio purchases: ${Number(purchases.portfolio || 0)}
- Harness purchases: ${Number(purchases.harness || 0)}
- Skill purchases: ${Number(purchases.skill || 0)}
- Run purchases: ${Number(purchases.run || 0)}
- Flake purchases: ${Number(purchases.flake || 0)}
- MCP drift purchases: ${Number(purchases.mcpdrift || 0)}
- Owner canary settlement volume excluded: ${money(report.revenue?.canary_usdc || 0)} across ${Number(report.revenue?.canary_transfer_count || 0)} transfers
- Unrelated incoming transfers: ${Number(report.revenue?.unrelated_incoming_transfer_count || 0)}
- Remaining to first goal: ${money(report.revenue?.remaining_usdc)}

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
  acquisition = {
    ...acquisition,
    experiment: evaluateEarnedPlacementExperiment({
      checked_at: checkedAt,
      healthy: errors.length === 0,
      genuine_purchases: Number((revenue.purchases as Record<string, unknown> | undefined)?.total || 0),
      total_installs: Number((acquisition.skills_sh as Record<string, unknown> | null)?.total_installs),
      router_installs: Number(installs["route-github-agent-checks"]),
      skillverdict_installs: Number(installs["preflight-agent-skills"]),
      placements: [
        acquisition.security_directory_pr as Record<string, unknown>,
        acquisition.x402_directory_pr as Record<string, unknown>,
        acquisition.x402scout as Record<string, unknown>,
      ],
    }),
  };
} catch (error) {
  errors.push(`Acquisition experiment: ${error instanceof Error ? error.message : String(error)}`);
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
  functional,
  acquisition,
  errors,
};

await atomicWrite(stateFile, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(monitorNoteFile, renderMonitorNote(report));
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
