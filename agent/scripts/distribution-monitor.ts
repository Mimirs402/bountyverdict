import { mkdir, writeFile } from "node:fs/promises";
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

if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  throw new Error("REVENUE_WALLET must be a public 20-byte EVM address.");
}
if (!/^\d+$/.test(startBlockInput)) {
  throw new Error("START_BLOCK must be an unsigned integer.");
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
  product: "single" | "portfolio",
): Promise<Record<string, unknown>> {
  const url = product === "single"
    ? `${api}/api/verdict?issue_url=${encodeURIComponent("https://github.com/typeorm/typeorm/issues/3357")}`
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
  const expectedAmount = product === "single" ? 50_000n : 400_000n;
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
  const expectedMethod = product === "single" ? "GET" : "POST";
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

  const searchUrl = new URL(`${CDP_DISCOVERY}/search`);
  searchUrl.searchParams.set("query", "BountyVerdict GitHub bounty due diligence");
  searchUrl.searchParams.set("network", NETWORK);
  searchUrl.searchParams.set("payTo", wallet);
  searchUrl.searchParams.set("limit", "20");
  const searchResponse = await monitoredFetch(searchUrl.href);
  if (!searchResponse.ok) {
    throw new Error(`CDP semantic discovery returned HTTP ${searchResponse.status}.`);
  }
  const search = await searchResponse.json() as {
    resources?: Array<{ resource?: string }>;
    searchMethod?: string;
  };
  const semanticResources = search.resources || [];
  const expectedPrefix = `${api}/api/`;
  return {
    indexed: resources.some(({ resource }) => resource?.startsWith(expectedPrefix)),
    merchant_resource_count: resources.length,
    semantic_match_count: semanticResources.filter(({ resource }) =>
      resource?.startsWith(expectedPrefix)
    ).length,
    search_method: search.searchMethod || null,
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
    unrelated_incoming_transfers: summary.unrecognized_transfers.length,
  };
}

const checkedAt = new Date().toISOString();
const errors: string[] = [];
let health: Record<string, unknown> = {};
let discovery: Record<string, unknown> = {};
let revenue: Record<string, unknown> = {};

try {
  const [root, sample, portfolioSample, openapi, llms, single, portfolio] = await Promise.all([
    requireStatus("/"),
    requireStatus("/api/sample"),
    requireStatus("/api/portfolio/sample"),
    requireStatus("/openapi.json"),
    requireStatus("/llms.txt"),
    inspectChallenge("single"),
    inspectChallenge("portfolio"),
  ]);
  health = { root, sample, portfolio_sample: portfolioSample, openapi, llms, single, portfolio };
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
  errors,
};

await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
await writeFile(stateFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
