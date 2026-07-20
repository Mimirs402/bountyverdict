import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { base } from "viem/chains";
import { validatePaymentChallenge } from "../src/payment-safety.ts";
import { summarizeRevenue, type SettlementTransfer } from "../src/revenue.ts";

const DEFAULT_API = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const DEFAULT_WALLET = "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
const DEFAULT_START_BLOCK = "48876000";
const CDP_DISCOVERY = "https://api.cdp.coinbase.com/platform/v2/x402/discovery";
const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NETWORK = "eip155:8453";
const TIMEOUT_MS = 15_000;

const api = new URL(process.env.PRODUCTION_API_URL || DEFAULT_API).origin;
const wallet = process.env.REVENUE_WALLET || DEFAULT_WALLET;
const startBlockInput = process.env.START_BLOCK || DEFAULT_START_BLOCK;
const stateFile = process.env.STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/distribution-status.json`;
const canaryStateFile = process.env.CANARY_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/functional-canary.json`;
const monitorNoteFile = process.env.MONITOR_NOTE_FILE || `${homedir()}/notes/mimirx402.md`;
const trackedCostsInput = process.env.TRACKED_COSTS_USDC || "0";
const MAX_CANARY_AGE_MS = 8 * 60 * 60 * 1000;
const EXPECTED_PRODUCTS = ["single", "portfolio", "harness", "skill", "run"] as const;

if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  throw new Error("REVENUE_WALLET must be a public 20-byte EVM address.");
}
if (!/^\d+$/.test(startBlockInput)) {
  throw new Error("START_BLOCK must be an unsigned integer.");
}
if (!/^\d+(?:\.\d{1,6})?$/.test(trackedCostsInput)) {
  throw new Error("TRACKED_COSTS_USDC must be a non-negative decimal with at most six places.");
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
  product: "single" | "portfolio" | "harness" | "skill" | "run",
): Promise<Record<string, unknown>> {
  const url = product === "single"
    ? `${api}/api/verdict?issue_url=${encodeURIComponent("https://github.com/typeorm/typeorm/issues/3357")}`
    : product === "harness"
      ? `${api}/api/harness?repo_url=${encodeURIComponent("https://github.com/openai/codex")}`
      : product === "skill"
        ? `${api}/api/skill?repo_url=${encodeURIComponent("https://github.com/coinbase/agentic-wallet-skills")}&skill_path=${encodeURIComponent("skills/agentic-wallet")}`
        : product === "run"
          ? `${api}/api/run?run_url=${encodeURIComponent("https://github.com/openai/codex/actions/runs/29728148711")}`
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
    : undefined);
  if (response.status !== 402) {
    throw new Error(`${product} endpoint returned HTTP ${response.status}; expected 402.`);
  }
  const header = response.headers.get("payment-required");
  if (!header) throw new Error(`${product} endpoint omitted PAYMENT-REQUIRED.`);
  const challenge = decodeChallenge(header);
  const expectedAmount = product === "single" ? 50_000n : product === "harness" ? 30_000n : product === "skill" ? 60_000n : product === "run" ? 40_000n : 400_000n;
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
  const expectedMethod = product === "portfolio" ? "POST" : "GET";
  const method = challenge.extensions?.bazaar?.info?.input?.method;
  if (method !== expectedMethod) {
    throw new Error(`${product} Bazaar method is ${method || "missing"}; expected ${expectedMethod}.`);
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

  const searches = await Promise.all([
    "GitHub bounty due diligence stale issue competing pull requests AI contribution policy",
    "AGENTS.md CLAUDE.md repository instruction audit stale paths portability",
    "agent SKILL.md security supply chain pre-install audit credential exfiltration",
    "GitHub Actions failed run job logs root cause diagnosis retry",
  ].map(async (query) => {
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
    return { query, ...result };
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
  };
  const indexedProducts = Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) =>
    [name, merchantResources.has(resource)]
  ));
  const semanticProducts = Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) =>
    [name, semanticResources.includes(resource)]
  ));
  const semanticRanks = Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) => {
    const ranks = searches.map(({ resources: found = [] }) =>
      found.findIndex((candidate) => candidate.resource === resource)
    ).filter((rank) => rank >= 0).map((rank) => rank + 1);
    return [name, ranks.length ? Math.min(...ranks) : null];
  }));
  const queryRanks = Object.fromEntries(searches.map(({ query, resources: found = [] }) => [
    query,
    Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) => {
      const rank = found.findIndex((candidate) => candidate.resource === resource);
      return [name, rank >= 0 ? rank + 1 : null];
    })),
  ]));
  return {
    indexed: Object.values(indexedProducts).every(Boolean),
    indexed_products: indexedProducts,
    semantic_products: semanticProducts,
    semantic_best_rank: semanticRanks,
    query_ranks: queryRanks,
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
      if (log.args.value === undefined || !log.transactionHash || log.logIndex === null) continue;
      transfers.push({
        amount: log.args.value,
        transaction_hash: log.transactionHash,
        log_index: log.logIndex,
      });
    }
  }
  const summary = summarizeRevenue(transfers);
  return {
    scanned_blocks: { from: startBlock.toString(), to: latestBlock.toString() },
    target_usdc: summary.target_usdc,
    recognized_usdc: summary.recognized_usdc,
    remaining_usdc: summary.remaining_usdc,
    progress_percent: summary.progress_percent,
    purchases: summary.purchases,
    recognized_transfers: summary.recognized_transfers.map((entry) => ({
      transaction_hash: entry.transaction_hash,
      log_index: entry.log_index,
      amount_atomic: entry.amount.toString(),
    })),
    excluded_non_revenue_transfers: summary.excluded_transfers.map((entry) => ({
      transaction_hash: entry.transaction_hash,
      log_index: entry.log_index,
      amount_atomic: entry.amount.toString(),
    })),
    unrelated_incoming_transfers: summary.unrecognized_transfers.length,
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

function money(value: unknown): string {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? `$${parsed.toFixed(2)}` : "unavailable";
}

function renderMonitorNote(report: Record<string, any>): string {
  const revenueValue = Number(report.revenue?.recognized_usdc || 0);
  const costsValue = Number(trackedCostsInput);
  const profitValue = revenueValue - costsValue;
  const purchases = report.revenue?.purchases || {};
  const ranks = report.discovery?.semantic_best_rank || {};
  const indexed = report.discovery?.indexed_products || {};
  const status = report.healthy ? "HEALTHY" : "DEGRADED";
  const errors = Array.isArray(report.errors) && report.errors.length
    ? report.errors.map((error: unknown) => `- ${String(error)}`).join("\n")
    : "- None";
  return `# Mimir x402 Monitor

- **STATUS:** ${status}
- **Customer revenue:** ${money(revenueValue)} / $1,000.00
- **Current profit:** ${money(profitValue)} (customer revenue minus ${money(costsValue)} tracked external costs)
- **Customer purchases:** ${Number(purchases.total || 0)}
- **Last refreshed:** ${report.checked_at}

Owner-funded launch proofs are excluded from both customer revenue and profit. Wallet reserves are capital, not revenue.

## Current milestone

Five paid products are live on Base mainnet. All five real handlers are exercised by authenticated six-hour functional canaries, while the 15-minute monitor verifies free routes, exact x402 challenges, global Bazaar discovery, and on-chain revenue. Every successful semantic result now carries an explicit reusable-service contract in \`service_reuse\`.

## What is next

1. Complete and verify the reusable-result production release and hardened deploy workflow.
2. Build FlakeVerdict, the strongest currently validated underserved x402 opportunity: historical CI flake versus regression diagnosis.
3. Improve unbranded marketplace rank for BountyVerdict and Portfolio while measuring only genuine customer settlements.
4. Reach the first unique paying agent, then optimize from observed calls rather than owner-funded proofs.

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

## Revenue detail

- Single verdict purchases: ${Number(purchases.single || 0)}
- Portfolio purchases: ${Number(purchases.portfolio || 0)}
- Harness purchases: ${Number(purchases.harness || 0)}
- Skill purchases: ${Number(purchases.skill || 0)}
- Run purchases: ${Number(purchases.run || 0)}
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

try {
  const [root, sample, portfolioSample, harnessSample, skillSample, runSample, openapi, llms, single, portfolio, harness, skill, run] = await Promise.all([
    requireStatus("/"),
    requireStatus("/api/sample"),
    requireStatus("/api/portfolio/sample"),
    requireStatus("/api/harness/sample"),
    requireStatus("/api/skill/sample"),
    requireStatus("/api/run/sample"),
    requireStatus("/openapi.json"),
    requireStatus("/llms.txt"),
    inspectChallenge("single"),
    inspectChallenge("portfolio"),
    inspectChallenge("harness"),
    inspectChallenge("skill"),
    inspectChallenge("run"),
  ]);
  health = { root, sample, portfolio_sample: portfolioSample, harness_sample: harnessSample, skill_sample: skillSample, run_sample: runSample, openapi, llms, single, portfolio, harness, skill, run };
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
  errors,
};

await atomicWrite(stateFile, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(monitorNoteFile, renderMonitorNote(report));
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
