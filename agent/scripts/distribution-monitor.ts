import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { isDeepStrictEqual, promisify } from "node:util";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { base } from "viem/chains";
import { validatePaymentChallenge } from "../src/payment-safety.ts";
import {
  OWNER_CONTROLLED_CANARY_PAYER,
  summarizeRevenue,
  type SettlementTransfer,
} from "../src/revenue.ts";
import { LEGACY_GET_PATHS, PRODUCT_CATALOG, productForAtomicAmount, productForTransport, type ProductKey } from "../src/product-catalog.ts";
import { mcpDriftExampleInput } from "../src/mcp-drift-discovery.ts";
import { evaluateEarnedPlacementExperiment } from "../src/acquisition.ts";
import {
  discoveryBuyerCandidateTotals,
  isBuyerCandidateDiscoveryCohort,
  loadFunnelSnapshot,
  mcpBuyerCandidateTotals,
} from "../src/funnel-telemetry.ts";
import {
  captureTrustedFunnelBaseline,
  trustedBuyerCandidateDiscoveryDelta,
  trustedFunnelBaseline,
  trustedMcpDelta,
  type TrustedFunnelBaseline,
} from "../src/funnel-epoch.ts";
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
import { parseGitHubTraffic } from "../src/github-traffic.ts";
import {
  appendCdpMerchantQualityHistory,
  normalizeAgenticMarketQuality,
  normalizeCdpMerchantQuality,
  normalizeThe402ServiceOutcome,
} from "../src/marketplace-telemetry.ts";
import { loadDistributionMonitorConfiguration } from "../src/monitor-configuration.ts";
import { canReuseMcpDownstreamStatus, glamaConnectorStatus, parseMcpubGetResponse, parseMcpubSearchLiveResponse, parseOneMcpRegistryShow, parseQtMcpRegistry } from "../src/mcp-downstreams.ts";
import { TASKMARKET_OWNER_IDENTITIES, TASKMARKET_WORKER_ADDRESS } from "../src/taskmarket-demand.ts";
import { CLAWLANCER_CANARY, parseClawlancerWorkState } from "../src/clawlancer-work.ts";
import { verifyClawlancerFunding, verifyClawlancerRelease } from "../src/clawlancer-chain.ts";
import { ASKILL_BUYER_QUERIES } from "../src/askill.ts";
import {
  normalizeSmitheryServer,
  smitherySearchObservation,
  SMITHERY_BUYER_QUERIES,
  SMITHERY_QUALIFIED_NAME,
} from "../src/smithery.ts";

const CDP_DISCOVERY = "https://api.cdp.coinbase.com/platform/v2/x402/discovery";
const AGENTIC_MARKET_SERVICE =
  "https://api.agentic.market/v1/services/bountyverdict-agent-production-mimirslab-workers-dev";
const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NETWORK = "eip155:8453";
const TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);
const GITHUB_REPOSITORY = "Mimirs402/bountyverdict";
const MCP_REGISTRY_NAME = "io.github.Mimirs402/bountyverdict";
const MCP_REGISTRY_VERSION = "1.1.9";
const MCP_REGISTRY_TIMEOUT_MS = 45_000;
const ONE_MCP_PACKAGE = "@1mcp/agent@0.34.3";
const QT_MCP_REGISTRY = "https://qtccache.qt.io/mcp/registry.json";
const GLAMA_MCP_CONNECTOR = `https://glama.ai/mcp/connectors/${MCP_REGISTRY_NAME}`;
const MCPUB_MCP = "https://mcpub.dev/mcp";
const MCP_INTENT_PAGE = "https://mimirs402.github.io/bountyverdict/mcp-github-actions-diagnosis.html";
const MCP_DOWNSTREAM_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SMITHERY_API = "https://api.smithery.ai";
const MCP_PREVIEW_COPY_ROLLOUT = Object.freeze({
  id: "mcp-selection-preview-parity-v2",
  started_at: "2026-07-21T22:04:03.330Z",
  release_commit: "0734bec44f4f96ff3bb56f6e362911c884509c99",
  baseline: Object.freeze({
    initialize: 257,
    tools_list: 208,
    validation_error: 6,
    capacity_rejected: 0,
    payment_required: 0,
    payment_present: 0,
    paid_success: 0,
  }),
});

const configuration = loadDistributionMonitorConfiguration(process.env);
const api = configuration.productionApi;
const wallet = configuration.revenueWallet;
const startBlockInput = configuration.startBlock;
const stateFile = process.env.STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/distribution-status.json`;
const canaryStateFile = process.env.CANARY_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/functional-canary.json`;
const directoryStateFile = process.env.DIRECTORY_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/directories.json`;
const experimentStateFile = process.env.EXPERIMENT_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/acquisition-experiment.json`;
const payanDemandStateFile = process.env.PAYAN_DEMAND_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/payan-demand.json`;
const publicDemandStateFile = process.env.DEMAND_WATCH_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/demand-watch.json`;
const clawlancerWorkStateFile = process.env.CLAWLANCER_WORK_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/clawlancer-work.json`;
const funnelStateFile = process.env.FUNNEL_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-telemetry.json`;
const trustedFunnelBaselineFile = process.env.TRUSTED_FUNNEL_BASELINE_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-baseline.json`;
const trustedFunnelEpochFile = process.env.TRUSTED_FUNNEL_HISTORY_FILE ||
  `${homedir()}/.local/state/bountyverdict/funnel-trusted-epochs.json`;
const monitorNoteFile = process.env.MONITOR_NOTE_FILE || `${homedir()}/notes/mimirx402.md`;
const trackedCostsInput = configuration.trackedCostsUsdc;
const historicalTestGasEth = process.env.HISTORICAL_TEST_GAS_ETH || "0.00000525";
const reportOnly = configuration.reportOnly;
if (!reportOnly && process.env.BOUNTYVERDICT_AUDITED_ROTATION_ACTIVE !== "distribution") {
  throw new Error("Full marketplace retrieval must run through run-audited-monitor.ts after establishing a draining funnel rotation.");
}
const settlementBuyer = configuration.settlementBuyerAddress;
const settlementCanaryEnabled = configuration.settlementCanaryEnabled;
const the402ApiKey = configuration.the402ApiKey;
const the402ParticipantId = configuration.the402ParticipantId;
const nearMarketApiKey = configuration.nearMarketApiKey;
const nearMarketAgentId = configuration.nearMarketAgentId;
const payanApiKey = configuration.payanApiKey;
const payanAgentId = configuration.payanAgentId;
const payanOfferMapInput = configuration.payanOfferMap;
const MAX_CANARY_AGE_MS = 8 * 60 * 60 * 1000;
const EXPECTED_PRODUCTS = ["single", "portfolio", "harness", "skill", "run", "flake", "mcpdrift"] as const;
const MCP_PRODUCTS = EXPECTED_PRODUCTS.filter((product): product is Exclude<ProductKey, "skill"> => product !== "skill");
const BUYER_QUERY_BENCHMARK: Readonly<Record<ProductKey, readonly string[]>> = Object.freeze({
  single: Object.freeze([
    "is this GitHub bounty still open and unclaimed",
    "can I work on this GitHub bounty or is someone already doing it",
  ]),
  portfolio: Object.freeze([
    "which GitHub bounty should I work on",
    "compare these GitHub bounty issues and pick the best one",
  ]),
  harness: Object.freeze([
    "check AGENTS.md and CLAUDE.md before editing this repository",
    "is this repo ready for a coding agent",
  ]),
  skill: Object.freeze([
    "is this agent skill safe to install",
    "check this SKILL.md for credential theft or destructive commands",
  ]),
  run: Object.freeze([
    "why did this GitHub Actions run fail",
    "what broke in this failed GitHub Actions workflow",
  ]),
  flake: Object.freeze([
    "should I rerun this failed workflow or fix the code",
    "is this GitHub Actions failure flaky",
  ]),
  mcpdrift: Object.freeze([
    "will this MCP tools list update break existing agents",
    "did this MCP server change its tool schemas",
  ]),
});
const MARKETPLACE_SEARCH_INTENTS: ReadonlyArray<{
  product: "single" | "portfolio" | "harness" | "run" | "flake";
  query: string;
}> = [
  { product: "single", query: "is this GitHub bounty still open and unclaimed" },
  { product: "portfolio", query: "which GitHub bounty should I work on" },
  { product: "harness", query: "check AGENTS.md and CLAUDE.md before editing this repository" },
  { product: "run", query: "why did this GitHub Actions run fail" },
  { product: "flake", query: "should I rerun this failed workflow or fix the code" },
];
function expectedDiscoveryResources(): Record<ProductKey, string> {
  return Object.fromEntries(Object.entries(PRODUCT_CATALOG).map(([product, contract]) => [
    product,
    `${api}${contract.path}`,
  ])) as Record<ProductKey, string>;
}
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

async function monitoredFetch(input: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", "bountyverdict-distribution-monitor/1.0");
  return fetch(input, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
}

async function monitoredFetchWithServerRetry(input: string, init?: RequestInit): Promise<Response> {
  let response = await monitoredFetch(input, init);
  for (let attempt = 1; attempt < 3 && response.status >= 500; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    response = await monitoredFetch(input, init);
  }
  return response;
}

async function monitoredFetchWithNetworkRetry(input: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await monitoredFetch(input, init, 10_000);
      if (response.status < 500 || attempt === 2) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Bounded network retry exhausted.");
}

async function githubTrafficStatus(): Promise<Record<string, unknown>> {
  const names = ["views", "clones", "popular/referrers", "popular/paths"] as const;
  const values = await Promise.all(names.map(async (name) => {
    const { stdout } = await execFileAsync("gh", [
      "api",
      `repos/${GITHUB_REPOSITORY}/traffic/${name}`,
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      "X-GitHub-Api-Version: 2022-11-28",
    ], { timeout: TIMEOUT_MS, maxBuffer: 1_000_000, encoding: "utf8" });
    return JSON.parse(stdout) as unknown;
  }));
  return parseGitHubTraffic(GITHUB_REPOSITORY, {
    views: values[0],
    clones: values[1],
    referrers: values[2],
    popular_paths: values[3],
  });
}

async function requireStatus(path: string, expected = 200): Promise<number> {
  const response = await monitoredFetch(`${api}${path}`);
  if (response.status !== expected) {
    throw new Error(`${path} returned HTTP ${response.status}; expected ${expected}.`);
  }
  return response.status;
}

async function requireJsonObject(path: string): Promise<Record<string, any>> {
  const response = await monitoredFetch(`${api}${path}`);
  if (response.status !== 200) throw new Error(`${path} returned HTTP ${response.status}; expected 200.`);
  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${path} returned malformed JSON metadata.`);
  }
  return body as Record<string, any>;
}

async function mcpRegistryStatus(): Promise<Record<string, unknown>> {
  const endpoint = `${api}/mcp?source=mcp-registry`;
  const response = await monitoredFetch(
    `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(MCP_REGISTRY_NAME)}`,
    undefined,
    MCP_REGISTRY_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`MCP Registry returned HTTP ${response.status}.`);
  const body = await response.json() as { servers?: Array<{ server?: { name?: unknown; version?: unknown; remotes?: unknown } }> };
  if (!Array.isArray(body.servers) || body.servers.length > 100) throw new Error("MCP Registry response is malformed or unbounded.");
  const entry = body.servers.find(({ server }) => server?.name === MCP_REGISTRY_NAME && server?.version === MCP_REGISTRY_VERSION)?.server;
  if (!entry || !Array.isArray(entry.remotes) || !entry.remotes.some((remote) => remote && typeof remote === "object" &&
    (remote as { type?: unknown }).type === "streamable-http" && (remote as { url?: unknown }).url === endpoint)) {
    throw new Error("Official MCP Registry listing is missing or has drifted from the production endpoint.");
  }
  return {
    listed: true,
    name: MCP_REGISTRY_NAME,
    version: MCP_REGISTRY_VERSION,
    transport: "streamable-http",
    endpoint,
    checked_at: new Date().toISOString(),
    accounting_note: "Registry presence is distribution evidence only; it is not an impression, purchase, or revenue.",
  };
}

async function mcpIntentPageStatus(): Promise<Record<string, unknown>> {
  const response = await monitoredFetch(MCP_INTENT_PAGE);
  if (!response.ok) throw new Error(`MCP intent page returned HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > 100_000) throw new Error("MCP intent page is unexpectedly large.");
  const body = await response.text();
  if (body.length > 100_000 || !body.includes("<title>GitHub Actions Failure Diagnosis MCP Server</title>") ||
    !body.includes("diagnose_github_actions_run") || !body.includes("classify_github_actions_flake") ||
    !body.includes("io.github.Mimirs402/bountyverdict") ||
    !body.includes("Use $route-github-agent-decisions for [REAL_PUBLIC_GITHUB_ACTIONS_RUN_URL]") ||
    !body.includes("pay only if it is exactly $0.04 Base USDC and my explicit budget authorizes it")) {
    throw new Error("MCP intent page content is incomplete or drifted.");
  }
  return {
    live: true,
    url: MCP_INTENT_PAGE,
    checked_at: new Date().toISOString(),
    scope: ["diagnose_github_actions_run", "classify_github_actions_flake"],
    copy_ready_prompt: true,
    accounting_note: "Availability is distribution evidence only; this owner-run check is not an impression, purchase, or revenue.",
  };
}

async function mcpDownstreamStatus(previous: Record<string, any> = {}): Promise<Record<string, unknown>> {
  const now = new Date();
  const endpoint = `${api}/mcp?source=mcp-registry`;
  if (canReuseMcpDownstreamStatus(previous, MCP_REGISTRY_NAME, MCP_REGISTRY_VERSION, endpoint, now.getTime(), MCP_DOWNSTREAM_CHECK_INTERVAL_MS)) {
    return { ...previous, reused_at: now.toISOString() };
  }
  const [qtResponse, glamaResponse, mcpubResponse, mcpubLiveResponse, oneMcp] = await Promise.all([
    monitoredFetch(QT_MCP_REGISTRY),
    monitoredFetch(GLAMA_MCP_CONNECTOR, { redirect: "manual" }),
    monitoredFetch(MCPUB_MCP, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get", arguments: { url: endpoint } },
      }),
    }),
    monitoredFetch(MCPUB_MCP, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "search_live", arguments: { query: "GitHub Actions failure", limit: 50, offset: 0 } },
      }),
    }),
    execFileAsync("npx", ["-y", ONE_MCP_PACKAGE, "registry", "show", MCP_REGISTRY_NAME, "--format", "json"], {
      timeout: TIMEOUT_MS,
      maxBuffer: 1_000_000,
      encoding: "utf8",
    }),
  ]);
  if (!qtResponse.ok) throw new Error(`Qt Creator MCP mirror returned HTTP ${qtResponse.status}.`);
  if (!mcpubResponse.ok) throw new Error(`mcpub returned HTTP ${mcpubResponse.status}.`);
  if (!mcpubLiveResponse.ok) throw new Error(`mcpub live search returned HTTP ${mcpubLiveResponse.status}.`);
  const oneMcpEntry = parseOneMcpRegistryShow(oneMcp.stdout);
  if (oneMcpEntry.name !== MCP_REGISTRY_NAME || oneMcpEntry.version !== MCP_REGISTRY_VERSION ||
    !Array.isArray(oneMcpEntry.remotes) || !oneMcpEntry.remotes.some((remote) => remote && typeof remote === "object" &&
      !Array.isArray(remote) && (remote as { type?: unknown }).type === "streamable-http" && (remote as { url?: unknown }).url === endpoint)) {
    throw new Error("1MCP did not resolve the exact active MCP release.");
  }
  const qt = parseQtMcpRegistry(await qtResponse.json(), MCP_REGISTRY_NAME, MCP_REGISTRY_VERSION, endpoint);
  const glama = glamaConnectorStatus(glamaResponse.status, GLAMA_MCP_CONNECTOR);
  const mcpub = parseMcpubGetResponse(await mcpubResponse.json(), endpoint);
  const mcpubLive = parseMcpubSearchLiveResponse(await mcpubLiveResponse.json(), endpoint);
  return {
    checked_at: now.toISOString(),
    check_interval_hours: MCP_DOWNSTREAM_CHECK_INTERVAL_MS / 3_600_000,
    registry_name: MCP_REGISTRY_NAME,
    registry_version: MCP_REGISTRY_VERSION,
    registry_endpoint: endpoint,
    one_mcp: {
      status: "confirmed_direct_official_registry_consumer",
      verified_version: MCP_REGISTRY_VERSION,
      verified_endpoint: endpoint,
      verified_at: now.toISOString(),
      client_package: ONE_MCP_PACKAGE,
      accounting_note: "One owner-run CLI retrieval proved availability; it is not an impression or purchase.",
    },
    mcp_proxy: {
      status: "direct_official_registry_consumer",
      available_version: MCP_REGISTRY_VERSION,
      accounting_note: "Availability follows the active official entry; it is not an independently mirrored impression.",
    },
    qt_creator: {
      ...qt,
      status: qt.listed ? "listed" : "pending_scheduled_mirror",
      registry_url: QT_MCP_REGISTRY,
    },
    glama: {
      ...glama,
      methodology: "official_registry_ingestion",
    },
    mcpub: {
      ...mcpub,
      live: mcpubLive,
      live_verified: mcpubLive.listed,
      directory_mcp: MCPUB_MCP,
      accounting_note: "Registration and crawler verification are distribution evidence, never impressions, purchases, or revenue.",
    },
    accounting_note: "Downstream propagation checks are bounded owner-run distribution audits and never purchase or revenue evidence.",
  };
}

function decodeChallenge(header: string): any {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

async function inspectChallenge(
  product: ProductKey,
): Promise<Record<string, unknown>> {
  const url = product === "skill"
        ? `${api}/api/skill?repo_url=${encodeURIComponent("https://github.com/coinbase/agentic-wallet-skills")}&skill_path=${encodeURIComponent("skills/agentic-wallet")}`
        : `${api}${PRODUCT_CATALOG[product].path}`;
  const response = await monitoredFetch(url, product === "single"
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_url: "https://github.com/typeorm/typeorm/issues/3357" }),
      }
    : product === "portfolio"
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
    : product === "harness"
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo_url: "https://github.com/openai/codex" }),
        }
    : product === "run"
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run_url: "https://github.com/openai/codex/actions/runs/29728148711" }),
        }
    : product === "flake"
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            run_url: "https://github.com/actions/runner/actions/runs/29423388605",
            attempt: 1,
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
  if (
    challenge.resource?.url !== url ||
    challenge.resource?.serviceName !== PRODUCT_CATALOG[product].service
  ) {
    throw new Error(`${product} payment challenge resource identity changed.`);
  }
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
  if (PRODUCT_CATALOG[product].method === "POST" && challenge.extensions?.bazaar?.info?.input?.bodyType !== "json") {
    throw new Error(`${product} Bazaar bodyType is missing or not json.`);
  }
  return {
    status: response.status,
    network: requirement.network,
    asset: requirement.asset,
    amount_atomic: requirement.amount,
    pay_to: requirement.payTo,
    resource: challenge.resource.url,
    bazaar_method: method,
  };
}

async function discoveryStatus(
  previousDiscovery: Record<string, any>,
  observedAt: string,
): Promise<Record<string, unknown>> {
  const expectedResources = expectedDiscoveryResources();
  const merchantStatus = await merchantDiscoveryStatus(previousDiscovery, observedAt, expectedResources);

  const benchmarkQueries = Object.entries(BUYER_QUERY_BENCHMARK).flatMap(([product, queries]) =>
    queries.map((query) => ({ product: product as ProductKey, query }))
  );
  const searches = await Promise.all(benchmarkQueries.map(async ({ product, query }) => {
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
  const semanticProducts = Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) =>
    [name, semanticResources.includes(resource)]
  ));
  const buyerQueryBenchmark = Object.fromEntries(EXPECTED_PRODUCTS.map((product) => {
    const rows = searches.filter((search) => search.product === product).map(({ query, resources: found = [] }) => {
      const rank = found.findIndex((candidate) => candidate.resource === expectedResources[product]);
      return { query, rank: rank >= 0 ? rank + 1 : null };
    });
    const foundRanks = rows.flatMap(({ rank }) => rank === null ? [] : [rank]).sort((left, right) => left - right);
    const middle = Math.floor(foundRanks.length / 2);
    const medianFoundRank = foundRanks.length === 0 ? null : foundRanks.length % 2
      ? foundRanks[middle]
      : (foundRanks[middle - 1] + foundRanks[middle]) / 2;
    return [product, {
      query_count: rows.length,
      found_queries: foundRanks.length,
      top_three_queries: foundRanks.filter((rank) => rank <= 3).length,
      first_place_queries: foundRanks.filter((rank) => rank === 1).length,
      coverage_percent: rows.length ? Math.round(foundRanks.length / rows.length * 100) : 0,
      median_found_rank: medianFoundRank,
      worst_result: foundRanks.length < rows.length ? "not_found" : foundRanks.at(-1) || null,
      queries: rows,
    }];
  }));
  const benchmarkRows = Object.values(buyerQueryBenchmark) as Array<Record<string, any>>;
  const queryRanks = Object.fromEntries(searches.map(({ query, resources: found = [] }) => [
    query,
    Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) => {
      const rank = found.findIndex((candidate) => candidate.resource === resource);
      return [name, rank >= 0 ? rank + 1 : null];
    })),
  ]));
  const topCompetitors = Object.fromEntries(EXPECTED_PRODUCTS.map((product) => [
    product,
    [...new Set(searches.filter((search) => search.product === product).flatMap(({ resources: found = [] }) =>
      found.filter(({ resource }) => resource !== expectedResources[product]).map(({ resource }) => resource)
    ))].slice(0, 5),
  ]));
  return {
    ...merchantStatus,
    semantic_products: semanticProducts,
    buyer_query_benchmark: buyerQueryBenchmark,
    buyer_query_summary: {
      query_count: benchmarkRows.reduce((sum, row) => sum + Number(row.query_count || 0), 0),
      found_queries: benchmarkRows.reduce((sum, row) => sum + Number(row.found_queries || 0), 0),
      top_three_queries: benchmarkRows.reduce((sum, row) => sum + Number(row.top_three_queries || 0), 0),
      first_place_queries: benchmarkRows.reduce((sum, row) => sum + Number(row.first_place_queries || 0), 0),
      methodology: "Two plain-language questions per product, phrased as an agent would ask while holding a concrete GitHub URL or MCP snapshot. This synthetic holdout measures task retrieval robustness, not observed marketplace query volume.",
    },
    query_ranks: queryRanks,
    top_competitors: topCompetitors,
    semantic_match_count: semanticResources.filter((resource) => resource.startsWith(`${api}/api/`)).length,
    search_method: [...new Set(searches.map(({ searchMethod }) => searchMethod).filter(Boolean))],
  };
}

async function merchantDiscoveryStatus(
  previousDiscovery: Record<string, any>,
  observedAt: string,
  expectedResources = expectedDiscoveryResources(),
): Promise<Record<string, unknown>> {
  const merchantUrl = new URL(`${CDP_DISCOVERY}/merchant`);
  merchantUrl.searchParams.set("payTo", wallet);
  merchantUrl.searchParams.set("limit", "100");
  const merchantResponse = await monitoredFetch(merchantUrl.href);
  if (!merchantResponse.ok) {
    throw new Error(`CDP merchant discovery returned HTTP ${merchantResponse.status}.`);
  }
  const merchant = await merchantResponse.json() as { resources?: Array<Record<string, any>> };
  const resources = merchant.resources || [];

  const merchantResources = new Set(resources.map(({ resource }) => resource).filter(Boolean));
  const merchantByResource = new Map<string, Record<string, any>>();
  for (const resource of resources) {
    if (typeof resource.resource !== "string") throw new Error("CDP merchant discovery returned an invalid resource.");
    if (merchantByResource.has(resource.resource)) throw new Error("CDP merchant discovery returned a duplicate resource.");
    merchantByResource.set(resource.resource, resource);
  }
  const previousMerchantQuality = previousDiscovery.cdp_merchant_quality || {};
  const cdpMerchantQuality = Object.fromEntries(Object.entries(expectedResources).flatMap(([product, resource]) => {
    const found = merchantByResource.get(resource);
    return found ? [[product, normalizeCdpMerchantQuality(
      found,
      resource,
      observedAt,
      previousMerchantQuality[product],
    )]] : [];
  }));
  const cdpMerchantQualityHistory = appendCdpMerchantQualityHistory(
    previousDiscovery.cdp_merchant_quality_history,
    cdpMerchantQuality,
  );
  const indexedProducts = Object.fromEntries(Object.entries(expectedResources).map(([name, resource]) =>
    [name, merchantResources.has(resource)]
  ));
  return {
    indexed: Object.values(indexedProducts).every(Boolean),
    indexed_products: indexedProducts,
    cdp_merchant_quality: cdpMerchantQuality,
    cdp_merchant_quality_history: cdpMerchantQualityHistory,
    cdp_merchant_quality_note: "CDP Bazaar rolling call/payer counters and recency are owner-contaminated acquisition signals. Any change requires settlement reconciliation and is never revenue by itself.",
    merchant_resource_count: resources.length,
    resources: resources.map(({ resource }) => resource).filter(Boolean),
  };
}

async function agenticMarketStatus(): Promise<Record<string, unknown>> {
  const response = await monitoredFetch(AGENTIC_MARKET_SERVICE);
  if (!response.ok) throw new Error(`service lookup returned HTTP ${response.status}.`);
  const service = await response.json() as Record<string, any>;
  if (
    service.id !== "bountyverdict-agent-production-mimirslab-workers-dev" ||
    service.domain !== new URL(api).hostname ||
    !Array.isArray(service.endpoints) ||
    service.endpoints.length === 0 ||
    service.endpoints.length > EXPECTED_PRODUCTS.length + Object.keys(LEGACY_GET_PATHS).length
  ) {
    throw new Error("automatic service group identity or endpoint count is invalid.");
  }

  const indexedProducts = Object.fromEntries(EXPECTED_PRODUCTS.map((product) => [product, false]));
  const quality: Record<string, ReturnType<typeof normalizeAgenticMarketQuality>> = {};
  const seenCanonical = new Set<ProductKey>();
  const seenTransports = new Set<string>();
  const legacyGetIndexed = Object.fromEntries(
    Object.keys(LEGACY_GET_PATHS).map((product) => [product, false]),
  ) as Record<keyof typeof LEGACY_GET_PATHS, boolean>;
  for (const endpoint of service.endpoints as Array<Record<string, any>>) {
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(String(endpoint.url));
    } catch {
      throw new Error("automatic directory contains an invalid endpoint URL.");
    }
    if (endpointUrl.origin !== api || endpointUrl.search || endpointUrl.hash) {
      throw new Error("automatic directory contains an endpoint outside the exact production origin.");
    }
    const method = String(endpoint.method).toUpperCase();
    const product = productForTransport(endpointUrl.pathname, method);
    const transportKey = `${method} ${endpointUrl.href}`;
    if (!product || seenTransports.has(transportKey)) throw new Error("automatic directory contains an unknown or duplicate endpoint.");
    const expected = PRODUCT_CATALOG[product];
    const amount = Number(endpoint.pricing?.amount);
    const endpointQuality = normalizeAgenticMarketQuality(endpoint.quality);
    if (
      endpoint.serviceName !== expected.service ||
      !Number.isFinite(amount) || Math.round(amount * 1_000_000) !== Number(expected.amountAtomic) ||
      String(endpoint.pricing?.currency).toUpperCase() !== "USDC" ||
      endpoint.pricing?.network !== NETWORK || endpoint.pricing?.scheme !== "exact"
    ) {
      throw new Error(`automatic directory contract drifted for ${expected.service}.`);
    }
    seenTransports.add(transportKey);
    const canonical = endpointUrl.pathname === expected.path && method === expected.method;
    if (canonical) {
      if (seenCanonical.has(product)) throw new Error("automatic directory duplicated a canonical product endpoint.");
      seenCanonical.add(product);
      indexedProducts[product] = true;
      quality[product] = endpointQuality;
    } else if (
      method === "GET" && product in LEGACY_GET_PATHS &&
      endpointUrl.pathname === LEGACY_GET_PATHS[product as keyof typeof LEGACY_GET_PATHS]
    ) {
      const legacyProduct = product as keyof typeof LEGACY_GET_PATHS;
      legacyGetIndexed[legacyProduct] = true;
      quality[`${legacyProduct}_legacy_get`] = endpointQuality;
    } else {
      throw new Error("automatic directory contains an unrecognized compatibility transport.");
    }
  }
  const missingProducts = EXPECTED_PRODUCTS.filter((product) => !seenCanonical.has(product));
  return {
    listed: true,
    service_id: service.id,
    endpoint_count: seenTransports.size,
    canonical_endpoint_count: seenCanonical.size,
    legacy_single_get_indexed: legacyGetIndexed.single,
    legacy_get_indexed: legacyGetIndexed,
    exact_contracts_verified: true,
    indexed_products: indexedProducts,
    missing_products: missingProducts,
    reported_quality: quality,
    accounting_note: "Agentic Market mirrors CDP Bazaar endpoints. Its aggregate quality counters are owner-contaminated and are never counted as genuine purchases or revenue; Base settlements are recognized only by the direct onchain ledger.",
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
  const detailResponses = await Promise.all(owned.map(({ id }) =>
    monitoredFetch(`${THE402_API}/services/${encodeURIComponent(String(id))}`)));
  if (detailResponses.some((response) => !response.ok)) {
    throw new Error("one or more the402 service-detail lookups failed.");
  }
  const detailPayloads = await Promise.all(detailResponses.map((response) => response.json()));
  const serviceOutcomes = Object.fromEntries(owned.map((service, index) => {
    const expected = expectedById.get(String(service.id));
    if (!expected) throw new Error("the402 returned an unexpected service detail.");
    return [expected.product, normalizeThe402ServiceOutcome(detailPayloads[index], String(service.id))];
  }));
  const outcomeTotals = Object.values(serviceOutcomes).reduce((sum, outcome) => ({
    total_jobs: sum.total_jobs + outcome.total_jobs,
    successful_jobs: sum.successful_jobs + outcome.successful_jobs,
    failed_jobs: sum.failed_jobs + outcome.failed_jobs,
    disputed_jobs: sum.disputed_jobs + outcome.disputed_jobs,
  }), { total_jobs: 0, successful_jobs: 0, failed_jobs: 0, disputed_jobs: 0 });
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
    service_outcomes: serviceOutcomes,
    service_outcome_totals: outcomeTotals,
    service_outcome_note: "Per-service marketplace attempt and reputation telemetry; customer purchases and revenue still require settlement attribution.",
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
  const expected = new Map(NEAR_MARKET_LISTINGS.map((listing) => [listing.service_id, listing]));
  const owned = services.filter(({ service_id }) => expected.has(String(service_id)));
  if (owned.length !== expected.size || new Set(owned.map(({ service_id }) => service_id)).size !== expected.size) {
    throw new Error("catalog does not contain the exact six expected services.");
  }
  for (const service of owned) {
    const listing = expected.get(String(service.service_id));
    if (!listing || service.agent_id !== NEAR_MARKET_PROVIDER_ID ||
      service.name !== listing.name ||
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

function payanOfferMap(): Record<string, string> {
  let offerMap: Record<string, string>;
  try {
    const parsed = JSON.parse(payanOfferMapInput || "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    offerMap = parsed as Record<string, string>;
  } catch {
    throw new Error("PAYAN_OFFER_MAP is missing or invalid.");
  }
  const expectedProducts = new Set(PAYAN_OFFERS.map(({ product }) => product));
  if (Object.keys(offerMap).length !== expectedProducts.size ||
    [...expectedProducts].some((product) => !/^[a-z0-9]{20,64}$/.test(offerMap[product] || ""))) {
    throw new Error("PAYAN_OFFER_MAP does not contain the exact six expected offers.");
  }
  return offerMap;
}

async function payanDemandStatus(): Promise<Record<string, any>> {
  const state = JSON.parse(await readFile(payanDemandStateFile, "utf8")) as Record<string, any>;
  if (state.schema_version !== 1 || state.provider_id !== PAYAN_PROVIDER_ID ||
    typeof state.checked_at !== "string" || !Number.isFinite(Date.parse(state.checked_at)) ||
    !state.records || typeof state.records !== "object" || Array.isArray(state.records) ||
    Object.keys(state.records).length > 200 || !state.last_run || typeof state.last_run !== "object") {
    throw new Error("Payan demand capture state is malformed.");
  }
  const ageMs = Date.now() - Date.parse(state.checked_at);
  if (ageMs < 0 || ageMs > 15 * 60 * 1000) throw new Error("Payan demand capture state is stale.");
  const counters = [
    "open_requests_seen", "exact_matches", "bids_created", "existing_bids_recovered",
    "accepted", "fulfilled", "approved", "errors", "tracked_requests",
  ];
  for (const field of counters) {
    if (!Number.isSafeInteger(state.last_run[field]) || Number(state.last_run[field]) < 0) {
      throw new Error(`Payan demand ${field} is invalid.`);
    }
  }
  if (state.last_run.bid_enabled !== true || state.last_run.fulfill_enabled !== true) {
    throw new Error("Payan demand capture is not enabled for bids and fulfillment.");
  }
  const records = Object.values(state.records) as Array<Record<string, any>>;
  const products: Record<string, number> = {};
  for (const record of records) {
    if (!/^[a-z0-9]{20,64}$/.test(record.request_id || "") ||
      !/^[a-z0-9]{20,64}$/.test(record.bid_id || "") ||
      !PAYAN_OFFERS.some(({ product }) => product === record.decision?.product) ||
      !Number.isSafeInteger(record.decision?.price_cents) || Number(record.decision.price_cents) < 1) {
      throw new Error("Payan demand record is malformed.");
    }
    products[record.decision.product] = Number(products[record.decision.product] || 0) + 1;
  }
  return {
    healthy: Number(state.last_run.errors) === 0,
    checked_at: state.checked_at,
    age_seconds: Math.round(ageMs / 1000),
    ...state.last_run,
    tracked_products: products,
    records,
    measurement: "exact_fit_request_bids_and_fulfillment_state_not_settlement_or_revenue_by_itself",
  };
}

async function publicDemandStatus(): Promise<Record<string, any>> {
  const state = JSON.parse(await readFile(publicDemandStateFile, "utf8")) as Record<string, any>;
  const molt = state.sources?.moltjobs;
  const open = state.sources?.openjobs;
  const taskmarket = state.sources?.taskmarket;
  const taskmarketTracked = taskmarket?.tracked_worker;
  if (state.schema_version !== 2 || state.read_only !== true || state.actions_enabled !== false ||
    state.errors !== 0 || typeof state.checked_at !== "string" || !Number.isFinite(Date.parse(state.checked_at)) ||
    !molt || typeof molt !== "object" || Array.isArray(molt) ||
    !open || typeof open !== "object" || Array.isArray(open) ||
    !taskmarket || typeof taskmarket !== "object" || Array.isArray(taskmarket) ||
    !taskmarketTracked || typeof taskmarketTracked !== "object" || Array.isArray(taskmarketTracked)) {
    throw new Error("Public demand watcher state is malformed or not strictly read-only.");
  }
  const ageMs = Date.now() - Date.parse(state.checked_at);
  if (ageMs < 0 || ageMs > 30 * 60 * 1000) throw new Error("Public demand watcher state is stale.");
  for (const [source, fields] of [[molt, [
    "open_jobs", "verified_funded_open_jobs", "exact_candidate_count",
    "rejected_unfunded_or_expired", "rejected_funded_non_matches",
  ]], [open, [
    "open_jobs", "usdc_open_jobs", "eligible_usdc_open_jobs", "wage_open_jobs", "exact_candidate_count",
  ]], [taskmarket, [
    "open_tasks", "api_escrow_backed_open_tasks", "unassigned_unexpired_submission_open_tasks",
    "exact_candidate_count", "rejected_escrow_non_matches", "excluded_expired_assigned_or_closed_window",
  ]]] as Array<[Record<string, any>, string[]]>) {
    for (const field of fields) {
      if (!Number.isSafeInteger(source[field]) || source[field] < 0) {
        throw new Error(`Public demand watcher counter ${field} is invalid.`);
      }
    }
    if (!Array.isArray(source.exact_candidates) || source.exact_candidates.length !== source.exact_candidate_count) {
      throw new Error("Public demand watcher candidates disagree with their counter.");
    }
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(molt.nominal_open_budget_usdc) ||
    !/^\d+(?:\.\d{1,6})?$/.test(molt.verified_funded_budget_usdc) ||
    !/^\d+(?:\.\d{1,6})?$/.test(taskmarket.api_escrow_backed_reward_usdc) ||
    !/^\d+(?:\.\d{1,6})?$/.test(taskmarket.unassigned_unexpired_reward_usdc)) {
    throw new Error("Public demand watcher budget telemetry is invalid.");
  }
  const taskmarketUsdcAtomic = (value: unknown): bigint | null => {
    if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
    const [whole, fraction = ""] = value.split(".");
    const atomic = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
    return atomic <= 1_000_000_000_000_000n ? atomic : null;
  };
  const taskmarketAwardAmounts = (award: Record<string, any> | null | undefined) => {
    if (!award || typeof award !== "object" || Array.isArray(award)) return null;
    const gross = taskmarketUsdcAtomic(award.gross_usdc);
    const workerPayment = taskmarketUsdcAtomic(award.worker_payment_usdc);
    const platformFee = taskmarketUsdcAtomic(award.platform_fee_usdc);
    if (gross === null || workerPayment === null || platformFee === null || workerPayment <= 0n ||
      gross !== workerPayment + platformFee) return null;
    return { gross, workerPayment, platformFee };
  };
  for (const field of [
    "tracked_submissions", "pending_submissions", "rejected_submissions", "not_awarded_submissions",
    "unverified_award_submissions", "settled_submissions",
  ]) {
    if (!Number.isSafeInteger(taskmarketTracked[field]) || taskmarketTracked[field] < 0) {
      throw new Error(`Taskmarket tracked counter ${field} is invalid.`);
    }
  }
  if (typeof taskmarketTracked.worker_address !== "string" ||
    taskmarketTracked.worker_address.toLowerCase() !== TASKMARKET_WORKER_ADDRESS.toLowerCase() ||
    !/^\d+(?:\.\d{1,6})?$/.test(taskmarketTracked.settled_worker_earnings_usdc) ||
    !Array.isArray(taskmarketTracked.submissions) ||
    taskmarketTracked.submissions.length !== taskmarketTracked.tracked_submissions ||
    taskmarketTracked.tracked_submissions !== taskmarketTracked.pending_submissions +
      taskmarketTracked.rejected_submissions + taskmarketTracked.not_awarded_submissions +
      taskmarketTracked.unverified_award_submissions + taskmarketTracked.settled_submissions) {
    throw new Error("Taskmarket tracked worker accounting is malformed or does not reconcile.");
  }
  let settledRecords = 0;
  let unverifiedAwardRecords = 0;
  let settledWorkerAtomic = 0n;
  let pendingGrossAtomic = 0n;
  let pendingNetAtomic = 0n;
  const consumedReceiptEvidence = new Set<string>();
  const consumedCanonicalEvents = new Set<string>();
  for (const record of taskmarketTracked.submissions as Array<Record<string, any>>) {
    if (!/^0x[a-f0-9]{64}$/i.test(record.task_id || "") ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(record.submission_id || "") ||
      !/^0x[a-f0-9]{64}$/i.test(record.submit_tx_hash || "") ||
      !["pending_award", "rejected", "not_awarded", "award_unverified", "settled_award"].includes(record.submission_state)) {
      throw new Error("Taskmarket tracked submission record is malformed.");
    }
    const recordEscrowReward = taskmarketUsdcAtomic(record.escrow_reward_usdc);
    const recordGrossPotential = taskmarketUsdcAtomic(record.potential_gross_usdc);
    const recordNetPotential = taskmarketUsdcAtomic(record.potential_net_usdc);
    if (recordEscrowReward === null || recordEscrowReward <= 0n || recordGrossPotential === null ||
      recordGrossPotential <= 0n || recordGrossPotential > recordEscrowReward || recordNetPotential === null ||
      recordNetPotential <= 0n || recordNetPotential > recordGrossPotential ||
      !["full_task_reward_contract", "operator_estimated_submitted_record_net_scaled_by_task_contract_not_award"].includes(record.potential_basis)) {
      throw new Error("Taskmarket tracked submission potential amounts are malformed.");
    }
    if (record.submission_state === "pending_award") {
      pendingGrossAtomic += recordGrossPotential;
      pendingNetAtomic += recordNetPotential;
    }
    if (record.submission_state === "settled_award") {
      settledRecords += 1;
      const platformAmounts = taskmarketAwardAmounts(record.platform_award);
      const settlementAmounts = taskmarketAwardAmounts(record.settlement);
      const onchain = record.settlement?.onchain_evidence;
      const onchainWorkerAtomic = typeof onchain?.worker_payment_atomic === "string" &&
        /^[1-9][0-9]{0,15}$/.test(onchain.worker_payment_atomic)
        ? BigInt(onchain.worker_payment_atomic)
        : null;
      const onchainPlatformFeeAtomic = typeof onchain?.platform_fee_atomic === "string" &&
        /^(?:0|[1-9][0-9]{0,15})$/.test(onchain.platform_fee_atomic)
        ? BigInt(onchain.platform_fee_atomic)
        : null;
      const onchainRequester = String(onchain?.onchain_requester_address || "").toLowerCase();
      const canonicalEventIndex = onchain?.task_completed_log_index;
      if (!record.settlement || !/^0x[a-f0-9]{64}$/i.test(record.settlement.settlement_tx_hash || "") ||
        !record.platform_award || !/^0x[a-f0-9]{64}$/i.test(record.platform_award.settlement_tx_hash || "") ||
        record.platform_award.settlement_tx_hash.toLowerCase() !== record.settlement.settlement_tx_hash.toLowerCase() ||
        !platformAmounts || !settlementAmounts || platformAmounts.gross !== settlementAmounts.gross ||
        platformAmounts.workerPayment !== settlementAmounts.workerPayment ||
        platformAmounts.platformFee !== settlementAmounts.platformFee || onchainWorkerAtomic === null ||
        onchainPlatformFeeAtomic === null || onchainPlatformFeeAtomic !== settlementAmounts.platformFee ||
        onchainWorkerAtomic !== settlementAmounts.workerPayment || onchain?.verified !== true ||
        onchain?.network !== "eip155:8453" || onchain?.task_id_topic_present !== true ||
        String(onchain?.task_id || "").toLowerCase() !== String(record.task_id).toLowerCase() ||
        String(onchain?.settlement_tx_hash || "").toLowerCase() !== record.settlement.settlement_tx_hash.toLowerCase() ||
        String(onchain?.taskmarket_settlement_contract || "").toLowerCase() !==
          "0xddc6cc3e4d11c1f3527b867c7dad4ed9869c33f7" ||
        String(onchain?.task_completed_topic || "").toLowerCase() !==
          "0x0c01e82f21f6dc480e3553e62cba7e6511685aa15d312f971ea64663bef07ecb" ||
        !Number.isSafeInteger(canonicalEventIndex) || Number(canonicalEventIndex) < 0 ||
        !/^0x[a-f0-9]{40}$/i.test(onchainRequester) ||
        onchainRequester !== String(record.platform_award.requester_address || "").toLowerCase() ||
        onchainRequester !== String(record.settlement.requester_address || "").toLowerCase() ||
        onchainRequester === TASKMARKET_WORKER_ADDRESS.toLowerCase() ||
        TASKMARKET_OWNER_IDENTITIES.some((address) => address.toLowerCase() === onchainRequester) ||
        String(onchain?.base_usdc_address || "").toLowerCase() !==
          "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" ||
        String(onchain?.transfer_source_address || "").toLowerCase() !==
          "0xddc6cc3e4d11c1f3527b867c7dad4ed9869c33f7" ||
        String(onchain?.transfer_source_topic || "").toLowerCase() !==
          "0x000000000000000000000000ddc6cc3e4d11c1f3527b867c7dad4ed9869c33f7" ||
        String(onchain?.worker_address || "").toLowerCase() !== TASKMARKET_WORKER_ADDRESS.toLowerCase() ||
        !Number.isSafeInteger(onchain?.matching_transfer_log_index) ||
        Number(onchain.matching_transfer_log_index) < 0) {
        throw new Error("Taskmarket settled submission lacks authoritative Base receipt evidence.");
      }
      const canonicalEventKey = `eip155:8453:${record.settlement.settlement_tx_hash.toLowerCase()}:${Number(canonicalEventIndex)}`;
      if (onchain.authoritative_proof_key !== canonicalEventKey || consumedCanonicalEvents.has(canonicalEventKey)) {
        throw new Error("Taskmarket settled submissions reuse or misstate canonical event evidence.");
      }
      const evidenceKey = `${record.settlement.settlement_tx_hash.toLowerCase()}:${Number(onchain.matching_transfer_log_index)}`;
      if (consumedReceiptEvidence.has(evidenceKey)) {
        throw new Error("Taskmarket settled submissions reuse the same receipt transfer evidence.");
      }
      consumedCanonicalEvents.add(canonicalEventKey);
      consumedReceiptEvidence.add(evidenceKey);
      settledWorkerAtomic += settlementAmounts.workerPayment;
    } else if (record.submission_state === "award_unverified") {
      unverifiedAwardRecords += 1;
      if (!record.platform_award || !/^0x[a-f0-9]{64}$/i.test(record.platform_award.settlement_tx_hash || "") ||
        !taskmarketAwardAmounts(record.platform_award) || !record.award_verification ||
        record.award_verification.verified !== false || record.settlement !== null) {
        throw new Error("Taskmarket unverified award state is malformed or contains revenue accounting.");
      }
    } else if (record.settlement !== null) {
      throw new Error("Taskmarket unsettled submission contains settlement accounting.");
    }
  }
  if (settledRecords !== taskmarketTracked.settled_submissions) {
    throw new Error("Taskmarket settled submission records disagree with their counter.");
  }
  if (unverifiedAwardRecords !== taskmarketTracked.unverified_award_submissions) {
    throw new Error("Taskmarket unverified award records disagree with their counter.");
  }
  const reportedSettledWorkerAtomic = taskmarketUsdcAtomic(taskmarketTracked.settled_worker_earnings_usdc);
  if (reportedSettledWorkerAtomic === null || reportedSettledWorkerAtomic !== settledWorkerAtomic) {
    throw new Error("Taskmarket reported worker earnings do not equal the sum of uniquely verified settlement records.");
  }
  const reportedPendingGrossAtomic = taskmarketUsdcAtomic(taskmarketTracked.pending_gross_potential_usdc);
  const reportedPendingNetAtomic = taskmarketUsdcAtomic(taskmarketTracked.pending_net_potential_usdc);
  if (reportedPendingGrossAtomic === null || reportedPendingNetAtomic === null ||
    reportedPendingGrossAtomic !== pendingGrossAtomic || reportedPendingNetAtomic !== pendingNetAtomic) {
    throw new Error("Taskmarket pending opportunity totals do not equal the pending submission records.");
  }
  return {
    healthy: true,
    checked_at: state.checked_at,
    age_seconds: Math.round(ageMs / 1000),
    read_only: true,
    actions_enabled: false,
    moltjobs: molt,
    openjobs: open,
    taskmarket,
    excluded: state.sources.excluded || {},
    measurement: "public_inventory_exact_fits_submissions_and_API_awards_are_not_purchases_or_revenue; only non-owner awards with successful Base receipts, exact task topics, and exact Base-USDC worker transfers settle",
  };
}

function atomicUsdc(value: string): string {
  const atomic = BigInt(value);
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function clawlancerWorkStatus(): Promise<Record<string, unknown>> {
  const persisted = JSON.parse(await readFile(clawlancerWorkStateFile, "utf8")) as unknown;
  const state = parseClawlancerWorkState(persisted);
  const ageMs = Date.now() - Date.parse(state.checkedAt);
  if (ageMs < 0 || ageMs > 30 * 60 * 1000) throw new Error("Clawlancer work state is stale.");
  const transaction = state.transaction;
  if (transaction.id !== CLAWLANCER_CANARY.transactionId ||
    transaction.listingId !== CLAWLANCER_CANARY.listingId ||
    transaction.buyerAddress.toLowerCase() !== CLAWLANCER_CANARY.buyerAddress.toLowerCase() ||
    transaction.sellerAddress.toLowerCase() !== CLAWLANCER_CANARY.sellerAddress.toLowerCase() ||
    transaction.amountAtomic !== CLAWLANCER_CANARY.amountAtomic ||
    state.artifact.sha256 !== "d212237abd908763276b51baf45efd1421ba9d21eb816ffe7083e60f5432695b") {
    throw new Error("Clawlancer canary identity, amount, or deliverable drifted.");
  }

  const buyer = transaction.buyerAddress.toLowerCase();
  const ownerIdentities = new Set([
    wallet.toLowerCase(),
    OWNER_CONTROLLED_CANARY_PAYER.toLowerCase(),
    TASKMARKET_WORKER_ADDRESS.toLowerCase(),
    ...TASKMARKET_OWNER_IDENTITIES.map((address) => address.toLowerCase()),
  ]);
  let onchainEvidence: Record<string, unknown> = {
    verified: false,
    reason: transaction.state === "RELEASED"
      ? "release_receipt_not_verified"
      : "transaction_not_released",
  };
  let fundingEvidence: Record<string, unknown> | null = null;
  if (["FUNDED", "DELIVERED"].includes(transaction.state)) {
    const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL) });
    fundingEvidence = await verifyClawlancerFunding(client, transaction);
  }
  if (transaction.state === "RELEASED" && transaction.releaseTxHash) {
    try {
      if (ownerIdentities.has(buyer) || buyer === transaction.sellerAddress.toLowerCase()) {
        throw new Error("Clawlancer buyer is owner-controlled or equals the worker.");
      }
      const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL) });
      onchainEvidence = await verifyClawlancerRelease(client, transaction);
    } catch (error) {
      onchainEvidence = {
        verified: false,
        release_tx_hash: transaction.releaseTxHash,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const verified = onchainEvidence.verified === true;
  const verifiedWorkerAtomic = verified && typeof onchainEvidence.worker_amount_atomic === "string"
    ? onchainEvidence.worker_amount_atomic
    : "0";
  return {
    available: true,
    checked_at: state.checkedAt,
    age_seconds: Math.round(ageMs / 1000),
    status: state.status,
    action: state.action,
    submitted_now: state.submittedNow,
    transaction,
    amount_usdc: atomicUsdc(transaction.amountAtomic),
    funding_evidence: fundingEvidence,
    onchain_evidence: onchainEvidence,
    settled_jobs: verified ? 1 : 0,
    verified_worker_earnings_usdc: atomicUsdc(verifiedWorkerAtomic),
    accounting_note: "Only a non-owner RELEASED transaction with a successful call to the pinned Clawlancer escrow and one exact Base-USDC transfer to the worker counts as a paid job or revenue.",
  };
}

async function payanStatus(): Promise<Record<string, unknown>> {
  if (!payanApiKey || !/^pk_live_[A-Za-z0-9_-]+$/.test(payanApiKey)) throw new Error("PAYAN_API_KEY is missing or invalid.");
  if (payanAgentId !== PAYAN_PROVIDER_ID) throw new Error("PAYAN_AGENT_ID does not match the pinned provider.");
  const offerMap = payanOfferMap();
  const [receiptResponse, demandCapture, ...offerResponses] = await Promise.all([
    monitoredFetch(`${PAYAN_API}/agents/${PAYAN_PROVIDER_ID}/receipts`),
    payanDemandStatus(),
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
  const deliveredOffers = receipts.filter((receipt) =>
    receipt.sellerId === PAYAN_PROVIDER_ID && receipt.buyerId !== PAYAN_PROVIDER_ID &&
    offerIds.has(String(receipt.offerId)) && receipt.status === "confirmed" && receipt.delivered === true
  );
  const requestContracts = new Map((demandCapture.records as Array<Record<string, any>>).map((record) => [
    record.request_id,
    { price_cents: Number(record.decision.price_cents), receipt_id: record.settlement_receipt_id || null },
  ]));
  const deliveredRequests = receipts.filter((receipt) => {
    const contract = requestContracts.get(String(receipt.requestId));
    return Boolean(contract) && receipt.sellerId === PAYAN_PROVIDER_ID && receipt.buyerId !== PAYAN_PROVIDER_ID &&
      receipt.status === "confirmed" && ["direct", "escrow_release"].includes(String(receipt.settlementType)) &&
      Number(receipt.amountCents) === contract!.price_cents &&
      (!contract!.receipt_id || receipt._id === contract!.receipt_id);
  });
  const delivered = [...new Map([...deliveredOffers, ...deliveredRequests].map((receipt) => [receipt._id, receipt])).values()];
  const receiptRevenueCents = delivered.reduce((sum, receipt) => sum + Number(receipt.amountCents || 0), 0);
  if (!Number.isSafeInteger(receiptRevenueCents) || receiptRevenueCents < 0) throw new Error("receipt revenue is invalid.");
  return {
    listed: true,
    provider_id: PAYAN_PROVIDER_ID,
    offer_count: offers.length,
    listing_contracts_verified: true,
    delivered_external_sales: delivered.length,
    delivered_offer_sales: deliveredOffers.length,
    delivered_request_sales: deliveredRequests.length,
    delivered_receipt_ids: delivered.map(({ _id }) => _id),
    delivered_transaction_hashes: delivered.map(({ txHash }) => txHash),
    receipt_revenue_usdc: receiptRevenueCents / 100,
    demand_capture: demandCapture,
    accounting_note: "PayanAgent settles directly to the Base revenue wallet; these receipts are attribution metadata and are already counted by direct onchain settlement accounting.",
  };
}

function oneBasedRank(
  rows: Array<Record<string, unknown>>,
  identityKey: string,
  expectedId: string,
): number | null {
  const matches = rows.flatMap((row, index) => row[identityKey] === expectedId ? [index] : []);
  if (matches.length > 1) throw new Error(`Search response duplicated ${expectedId}.`);
  return matches.length === 1 ? matches[0] + 1 : null;
}

async function marketplaceSearchStatus(): Promise<Record<string, unknown>> {
  if (!nearMarketApiKey || !/^sk_live_[A-Za-z0-9_-]+$/.test(nearMarketApiKey)) {
    throw new Error("NEAR_MARKET_API_KEY is missing or invalid.");
  }
  const offerMap = payanOfferMap();
  const the402Ids = new Map(THE402_LISTINGS.map(({ product, service_id }) => [product, service_id]));
  const nearIds = new Map(NEAR_MARKET_LISTINGS.map(({ product, service_id }) => [product, service_id]));

  const queries = await Promise.all(MARKETPLACE_SEARCH_INTENTS.map(async ({ product, query }) => {
    const the402Url = new URL(`${THE402_API}/services/catalog`);
    the402Url.searchParams.set("q", query);
    the402Url.searchParams.set("limit", "100");
    const nearUrl = new URL(`${NEAR_MARKET_API}/services`);
    nearUrl.searchParams.set("search", query);
    nearUrl.searchParams.set("limit", "100");
    const payanUrl = new URL(`${PAYAN_API}/discover`);
    payanUrl.searchParams.set("q", query);
    const [the402Response, nearResponse, payanResponse] = await Promise.all([
      monitoredFetch(the402Url.href),
      monitoredFetch(nearUrl.href, { headers: { Authorization: `Bearer ${nearMarketApiKey}` } }),
      monitoredFetch(payanUrl.href),
    ]);
    if (!the402Response.ok) throw new Error(`the402 search returned HTTP ${the402Response.status}.`);
    if (!nearResponse.ok) throw new Error(`NEAR search returned HTTP ${nearResponse.status}.`);
    if (!payanResponse.ok) throw new Error(`PayanAgent search returned HTTP ${payanResponse.status}.`);
    const the402Payload = await the402Response.json() as Record<string, unknown>;
    const nearPayload = await nearResponse.json() as unknown;
    const payanPayload = await payanResponse.json() as Record<string, unknown>;
    if (!Array.isArray(the402Payload.services) || !Array.isArray(nearPayload) || !Array.isArray(payanPayload.offers)) {
      throw new Error("Marketplace search returned a malformed ranked result set.");
    }
    const expectedThe402Id = the402Ids.get(product);
    const expectedNearId = nearIds.get(product);
    const expectedPayanId = offerMap[product];
    if (!expectedThe402Id || !expectedNearId || !expectedPayanId) {
      throw new Error(`Marketplace identity is missing for ${product}.`);
    }
    return {
      product,
      query,
      ranks: {
        the402: oneBasedRank(the402Payload.services, "id", expectedThe402Id),
        near: oneBasedRank(nearPayload, "service_id", expectedNearId),
        payan: oneBasedRank(payanPayload.offers, "_id", expectedPayanId),
      },
    };
  }));
  const ranks = queries.flatMap(({ ranks }) => Object.values(ranks));
  return {
    available: true,
    checked_at: new Date().toISOString(),
    measured_cells: ranks.length,
    first_place_cells: ranks.filter((rank) => rank === 1).length,
    queries,
    note: "Queries are task descriptions an agent could plausibly generate, not product names or observed marketplace query volume. Search rank is acquisition telemetry, not a purchase or a production-health signal.",
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
      github_pr_monitoring: state.github_pr_monitoring || null,
      skills_sh: state.skills_sh || null,
      skills_sh_dedicated: state.skills_sh_dedicated || null,
      awesome_skills: state.awesome_skills || null,
      agenttool: state.agenttool || null,
      mcp_repository: state.mcp_repository || null,
      agentndx: state.agentndx || null,
      mcp_observatory: state.mcp_observatory || null,
      mcpub_crawler_pr: state.mcpub_crawler_pr || null,
      agentskill: state.agentskill || null,
      agent_skills_in: state.agent_skills_in || null,
      skills_md: state.skills_md || null,
      askill: state.askill || null,
      askill_dedicated: state.askill_dedicated || null,
      askill_main: state.askill_main || null,
      agent_skills_md: state.agent_skills_md || null,
      github_skill: state.github_skill || null,
      security_directory_pr: state.security_directory_pr || null,
      x402_directory_pr: state.x402_directory_pr || null,
      agent_plugins_pr: state.agent_plugins_pr || null,
      agent_plugins_catalog: state.agent_plugins_catalog || null,
      awesome_copilot: state.awesome_copilot || null,
      lobehub: state.lobehub || null,
      awesome_mcp_servers: state.awesome_mcp_servers || null,
      tensorblock_mcp_index: state.tensorblock_mcp_index || null,
      agentage: state.agentage || null,
      docker_mcp_registry: state.docker_mcp_registry || null,
      mcp_servers_org: state.mcp_servers_org || null,
      mcp_directory: state.mcp_directory || null,
      vaultplane: state.vaultplane || null,
      tools_for_agents: state.tools_for_agents || null,
      mcp_server_spot: state.mcp_server_spot || null,
      cline_marketplace: state.cline_marketplace || null,
      kilo_marketplace: state.kilo_marketplace || null,
      toolhive: state.toolhive || null,
      openhands_integrations: state.openhands_integrations || null,
      gemini_cli_gallery: state.gemini_cli_gallery || null,
      agent_finder_catalog: state.agent_finder_catalog || null,
      ard_catalog: state.ard_catalog || null,
      agent402: state.agent402 || null,
      x402scout: state.x402scout || null,
      x402scan: state.x402scan || null,
      x402gle: state.x402gle || null,
      agent_tools_cloud: state.agent_tools_cloud || null,
      monetize_your_agent: state.monetize_your_agent || null,
      directory_402: state.directory_402 || null,
      index_402: state.index_402 || null,
      note: "Anonymous install telemetry is an acquisition signal, not proof of a genuine buyer or customer purchase.",
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function smitheryStatus(checkedAt: string): Promise<Record<string, unknown>> {
  const readJson = async (url: URL | string): Promise<Record<string, any>> => {
    const response = await monitoredFetch(String(url));
    if (!response.ok) throw new Error(`Smithery returned HTTP ${response.status} for ${new URL(String(url)).pathname}.`);
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Smithery returned a malformed JSON body.");
    }
    return body as Record<string, any>;
  };
  const search = async (query: string): Promise<Record<string, unknown>> => {
    const url = new URL("/servers", SMITHERY_API);
    url.searchParams.set("q", query);
    url.searchParams.set("pageSize", "20");
    return smitherySearchObservation(await readJson(url), query);
  };

  const serverUrl = new URL(`/servers/${SMITHERY_QUALIFIED_NAME}`, SMITHERY_API);
  const [serverBody, branded, ...queries] = await Promise.all([
    readJson(serverUrl),
    search("bountyverdict"),
    ...SMITHERY_BUYER_QUERIES.map((query) => search(query)),
  ]);
  const server = normalizeSmitheryServer(serverBody);
  if (branded.found !== true || !Number.isSafeInteger(branded.use_count) || Number(branded.use_count) < 0) {
    throw new Error("Smithery's branded lookup did not expose the exact listing and use counter.");
  }
  const observedUseCounts = queries
    .filter((query) => query.found === true)
    .map((query) => query.use_count);
  if (observedUseCounts.some((useCount) => useCount !== branded.use_count)) {
    throw new Error("Smithery returned inconsistent use counters across its search results.");
  }
  const found = queries.filter((query) => query.found === true);
  return {
    ...server,
    checked_at: checkedAt,
    listing_url: `https://smithery.ai/servers/${SMITHERY_QUALIFIED_NAME}`,
    use_count: branded.use_count,
    branded_rank: branded.rank,
    buyer_query_benchmark: {
      query_count: queries.length,
      found_queries: found.length,
      top_ten_queries: found.filter((query) => Number(query.rank) <= 10).length,
      top_three_queries: found.filter((query) => Number(query.rank) <= 3).length,
      queries,
      methodology: "Fixed unbranded task descriptions supplied by context-isolated agents; bounded to Smithery's first 20 results.",
      accounting: "Owner-run retrieval is placement evidence, not search volume, impressions, use, purchases, or revenue.",
    },
  };
}

async function funnelStatus(): Promise<Record<string, unknown>> {
  try {
    const monotonicDelta = (current: unknown, baseline: unknown, label: string): number => {
      const currentValue = Number(current || 0);
      const baselineValue = Number(baseline || 0);
      if (!Number.isSafeInteger(currentValue) || currentValue < 0 || !Number.isSafeInteger(baselineValue) || baselineValue < 0) {
        throw new Error(`${label} counters are invalid.`);
      }
      if (currentValue < baselineValue) {
        throw new Error(`${label} regressed from ${baselineValue} to ${currentValue}; trusted rates are unavailable until an explicit audited epoch starts.`);
      }
      return currentValue - baselineValue;
    };
    const state = loadFunnelSnapshot(JSON.parse(await readFile(funnelStateFile, "utf8")));
    if (!state) throw new Error("Funnel telemetry state is malformed.");
    const owner = state.by_source.owner_automation;
    const externalByProduct = Object.fromEntries(EXPECTED_PRODUCTS.map((product) => {
      const sources = state.by_product_source[product];
      const external = Object.entries(sources)
        .filter(([source]) => source !== "owner_automation")
        .reduce((sum, [, counters]) => ({
          requests: sum.requests + counters.requests,
          challenges_402: sum.challenges_402 + counters.challenges_402,
          signed_requests: sum.signed_requests + counters.signed_requests,
          signed_successes: sum.signed_successes + counters.signed_successes,
          preflight_rejections: sum.preflight_rejections + counters.preflight_rejections,
          rate_limited: sum.rate_limited + counters.rate_limited,
          server_errors: sum.server_errors + counters.server_errors,
        }), { requests: 0, challenges_402: 0, signed_requests: 0, signed_successes: 0, preflight_rejections: 0, rate_limited: 0, server_errors: 0 });
      return [product, external];
    }));
    const externalChallenges = state.totals.challenges_402 - owner.challenges_402;
    const externalSignedRequests = state.totals.signed_requests - owner.signed_requests;
    const externalSignedSuccesses = state.totals.signed_successes - owner.signed_successes;
    const enhancedExternalChallenges = Object.values(externalByProduct)
      .reduce((sum, counters) => sum + counters.challenges_402, 0);
    const discoveryOwner = state.by_discovery_source.owner_automation;
    const externalDiscoveryRequests = state.discovery_totals.requests - discoveryOwner.requests;
    const buyerCandidateDiscoveryTotals = discoveryBuyerCandidateTotals(state);
    const externalDiscoveryBySurface = Object.fromEntries(Object.entries(state.by_discovery_surface_source).map(([surface, sources]) => [
      surface,
      Object.entries(sources).filter(([source]) => source !== "owner_automation")
        .reduce((sum, [, counters]) => sum + counters.requests, 0),
    ]));
    const externalMcpTotals = Object.fromEntries(Object.entries(state.mcp_totals).map(([stage, count]) => [
      stage,
      monotonicDelta(count, state.mcp_by_source.owner_automation[stage as keyof typeof state.mcp_totals], `MCP ${stage}`),
    ]));
    const buyerCandidateMcpTotals = mcpBuyerCandidateTotals(state);
    const mcpPreviewCopyDelta = Object.fromEntries(Object.entries(MCP_PREVIEW_COPY_ROLLOUT.baseline).map(([stage, baseline]) => [
      stage,
      monotonicDelta(
        buyerCandidateMcpTotals[stage as keyof typeof buyerCandidateMcpTotals],
        baseline,
        `MCP selection-preview rollout ${stage}`,
      ),
    ]));
    const previewCallOpportunities = Number(mcpPreviewCopyDelta.validation_error || 0) + Number(mcpPreviewCopyDelta.payment_required || 0);
    const mcpPreviewCopyExperiment = {
      ...MCP_PREVIEW_COPY_ROLLOUT,
      status: "running",
      delta: mcpPreviewCopyDelta,
      event_ratios: {
        valid_call_per_tools_list_percent: Number(mcpPreviewCopyDelta.tools_list || 0) > 0
          ? Math.round(Number(mcpPreviewCopyDelta.payment_required || 0) / Number(mcpPreviewCopyDelta.tools_list) * 1_000) / 10
          : null,
        invalid_call_share_percent: previewCallOpportunities > 0
          ? Math.round(Number(mcpPreviewCopyDelta.validation_error || 0) / previewCallOpportunities * 1_000) / 10
          : null,
        payment_present_per_valid_call_percent: Number(mcpPreviewCopyDelta.payment_required || 0) > 0
          ? Math.round(Number(mcpPreviewCopyDelta.payment_present || 0) / Number(mcpPreviewCopyDelta.payment_required) * 1_000) / 10
          : null,
      },
      measurement: "aggregate_events_excluding_owner_registry_glama_and_x402_observer_channels_not_unique_users_or_purchases",
    };
    const externalMcpByProduct = Object.fromEntries(MCP_PRODUCTS.map((product) => {
      const sources = state.mcp_by_product_source[product];
      return [product, Object.fromEntries(Object.keys(state.mcp_totals).map((stage) => [
        stage,
        Object.entries(sources).filter(([source]) => source !== "owner_automation")
          .reduce((sum, [, counters]) => sum + Number(counters[stage as keyof typeof counters] || 0), 0),
      ]))];
    }));
    const mcpLearningStage = Number(buyerCandidateMcpTotals.events || 0) === 0
      ? "mcp_reach_not_observed"
      : Number(buyerCandidateMcpTotals.protocol_error || 0) > 0
        ? "mcp_protocol_negotiation_friction"
      : Number(buyerCandidateMcpTotals.capacity_rejected || 0) > 0
        ? "mcp_capacity_friction"
      : Number(buyerCandidateMcpTotals.tools_list || 0) === 0 && Number(buyerCandidateMcpTotals.payment_required || 0) === 0
        ? "mcp_initialized_without_tool_discovery"
        : Number(buyerCandidateMcpTotals.payment_required || 0) === 0 && Number(buyerCandidateMcpTotals.validation_error || 0) === 0
          ? "mcp_catalog_discovery_only"
          : Number(buyerCandidateMcpTotals.payment_present || 0) === 0
            ? "mcp_tool_interest_without_payment"
            : Number(buyerCandidateMcpTotals.paid_success || 0) === 0
              ? "mcp_payment_friction"
              : "mcp_conversion_observed";
    const currentTrustedCounters = {
      external_discovery_requests: externalDiscoveryRequests,
      external_402_challenges: externalChallenges,
      signed_payment_attempts: externalSignedRequests,
      successful_signed_responses: externalSignedSuccesses,
    };
    let trustedBaseline: TrustedFunnelBaseline;
    try {
      const loaded = trustedFunnelBaseline(JSON.parse(await readFile(trustedFunnelBaselineFile, "utf8")));
      if (!loaded) throw new Error("Trusted funnel baseline is malformed.");
      trustedBaseline = loaded;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      trustedBaseline = captureTrustedFunnelBaseline(
        state,
        new Date().toISOString(),
        "Owner release probes were not identifiable before this boundary; earlier external-or-unattributed totals are retained but not used for conversion rates.",
        1,
      );
      await atomicWrite(trustedFunnelBaselineFile, `${JSON.stringify(trustedBaseline, null, 2)}\n`);
    }
    let epochRotation: Record<string, any> | null = null;
    try {
      const ledger = JSON.parse(await readFile(trustedFunnelEpochFile, "utf8")) as Record<string, any>;
      if (ledger.schema_version !== 2 || !Number.isSafeInteger(ledger.active_epoch_id) || !Array.isArray(ledger.epochs)) {
        throw new Error("Trusted funnel epoch ledger is malformed.");
      }
      if (Number(ledger.active_epoch_id) !== Number(trustedBaseline.epoch_id || 1)) {
        throw new Error("Trusted funnel epoch ledger and active baseline disagree.");
      }
      if (ledger.rotation && !["draining", "activated"].includes(String(ledger.rotation.status))) {
        throw new Error("Trusted funnel epoch rotation is malformed.");
      }
      epochRotation = ledger.rotation || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const baselineCounters = trustedBaseline.counters as unknown as Record<string, unknown>;
    const baselineChannels = trustedBaseline.by_channel as unknown as Record<string, Record<string, unknown>>;
    const baselineClients = trustedBaseline.by_client_class as unknown as Record<string, Record<string, unknown>>;
    const trustedExternalByProduct = Object.fromEntries(EXPECTED_PRODUCTS.map((product) => {
      const current = externalByProduct[product];
      const baseline = (trustedBaseline.external_by_product?.[product] || {}) as unknown as Record<string, unknown>;
      return [product, Object.fromEntries(Object.entries(current).map(([key, value]) => [
        key,
        monotonicDelta(value, baseline[key], `Product ${product} ${key}`),
      ]))];
    }));
    const trusted = Object.fromEntries(Object.entries(currentTrustedCounters).map(([key, value]) => [
      key,
      monotonicDelta(value, baselineCounters[key], `Funnel ${key}`),
    ]));
    const trustedByChannel = Object.fromEntries(Object.entries(state.by_channel).map(([channel, current]) => [
      channel,
      Object.fromEntries(Object.entries(current).map(([key, value]) => [
        key,
        monotonicDelta(value, baselineChannels[channel]?.[key], `Channel ${channel} ${key}`),
      ])),
    ]));
    const trustedByClientClass = Object.fromEntries(Object.entries(state.by_client_class).map(([client, current]) => [
      client,
      Object.fromEntries(Object.entries(current).map(([key, value]) => [
        key,
        monotonicDelta(value, baselineClients[client]?.[key], `Client ${client} ${key}`),
      ])),
    ]));
    const trustedExternalDiscoveryBySurface = Object.fromEntries(Object.entries(externalDiscoveryBySurface).map(([surface, count]) => [
      surface,
      monotonicDelta(count, trustedBaseline.external_discovery_by_surface?.[surface], `Discovery surface ${surface}`),
    ]));
    const cohortDelta = (
      current: Record<string, Record<string, unknown>>,
      baseline: Record<string, Record<string, unknown>> | undefined,
      label: string,
    ) => Object.fromEntries(Object.entries(current).map(([cohort, counters]) => [
      cohort,
      Object.fromEntries(Object.entries(counters).map(([key, value]) => [
        key,
        monotonicDelta(value, baseline?.[cohort]?.[key], `${label} ${cohort} ${key}`),
      ])),
    ]).filter(([, counters]) => Object.values(counters).some((value) => Number(value) > 0)));
    const trustedByCohort = cohortDelta(state.by_cohort, trustedBaseline.by_cohort, "Paid cohort");
    const trustedByDiscoveryCohort = cohortDelta(
      state.by_discovery_cohort,
      trustedBaseline.by_discovery_cohort,
      "Discovery cohort",
    );
    const measurementEligible = epochRotation?.status !== "draining";
    const effectiveTrusted = measurementEligible
      ? trusted
      : Object.fromEntries(Object.keys(trusted).map((key) => [key, 0]));
    const zeroCounters = (record: Record<string, Record<string, unknown>>) => Object.fromEntries(
      Object.entries(record).map(([dimension, counters]) => [dimension, Object.fromEntries(Object.keys(counters).map((key) => [key, 0]))]),
    );
    const effectiveByProduct = measurementEligible ? trustedExternalByProduct : zeroCounters(trustedExternalByProduct);
    const effectiveByChannel = measurementEligible ? trustedByChannel : zeroCounters(trustedByChannel);
    const effectiveByClient = measurementEligible ? trustedByClientClass : zeroCounters(trustedByClientClass);
    const effectiveDiscoveryBySurface = measurementEligible
      ? trustedExternalDiscoveryBySurface
      : Object.fromEntries(Object.keys(trustedExternalDiscoveryBySurface).map((surface) => [surface, 0]));
    const effectiveByCohort = measurementEligible ? trustedByCohort : {};
    const effectiveByDiscoveryCohort = measurementEligible ? trustedByDiscoveryCohort : {};
    const trustedMcp = trustedBaseline.mcp ? trustedMcpDelta(state, trustedBaseline.mcp) : null;
    const effectiveTrustedMcp = measurementEligible ? trustedMcp : null;
    const trustedBuyerCandidateDiscovery = trustedBuyerCandidateDiscoveryDelta(state, trustedBaseline);
    const effectiveBuyerCandidateDiscovery = measurementEligible
      ? trustedBuyerCandidateDiscovery
      : Object.fromEntries(Object.keys(trustedBuyerCandidateDiscovery).map((key) => [key, 0]));
    const trustedLearningStage = !measurementEligible
      ? "measurement_draining"
      : Number(effectiveBuyerCandidateDiscovery.requests || 0) === 0 && effectiveTrusted.external_402_challenges === 0 && effectiveTrusted.signed_payment_attempts === 0
      ? "reach_not_observed"
      : effectiveTrusted.external_402_challenges === 0 && effectiveTrusted.signed_payment_attempts === 0
        ? "discovery_surface_without_paid_route"
      : effectiveTrusted.signed_payment_attempts === 0
        ? "discovery_without_payment_attempt"
        : effectiveTrusted.successful_signed_responses === 0
          ? "signed_payment_friction"
          : "signed_conversion_observed";
    const trustedMcpLearningStage = !measurementEligible
      ? "measurement_draining"
      : !effectiveTrustedMcp
        ? "mcp_epoch_baseline_unavailable"
        : Number(effectiveTrustedMcp.buyer_candidate_totals.events || 0) === 0
          ? "mcp_reach_not_observed"
          : Number(effectiveTrustedMcp.buyer_candidate_totals.protocol_error || 0) > 0
            ? "mcp_protocol_negotiation_friction"
            : Number(effectiveTrustedMcp.buyer_candidate_totals.capacity_rejected || 0) > 0
              ? "mcp_capacity_friction"
              : Number(effectiveTrustedMcp.buyer_candidate_totals.tools_list || 0) === 0 &&
                  Number(effectiveTrustedMcp.buyer_candidate_totals.payment_required || 0) === 0
                ? "mcp_initialized_without_tool_discovery"
                : Number(effectiveTrustedMcp.buyer_candidate_totals.payment_required || 0) === 0 &&
                    Number(effectiveTrustedMcp.buyer_candidate_totals.validation_error || 0) === 0
                  ? "mcp_catalog_discovery_only"
                  : Number(effectiveTrustedMcp.buyer_candidate_totals.payment_present || 0) === 0
                    ? "mcp_tool_interest_without_payment"
                    : Number(effectiveTrustedMcp.buyer_candidate_totals.paid_success || 0) === 0
                      ? "mcp_payment_friction"
                      : "mcp_conversion_observed";
    return {
      available: true,
      capture_started_at: state.capture_started_at,
      enhanced_capture_started_at: state.enhanced_capture_started_at,
      cohort_capture_started_at: state.cohort_capture_started_at,
      updated_at: state.updated_at,
      paid_route_requests: state.totals.requests,
      discovery_surface_requests: state.discovery_totals.requests,
      external_discovery_requests: externalDiscoveryRequests,
      buyer_candidate_discovery: buyerCandidateDiscoveryTotals,
      buyer_candidate_discovery_requests: buyerCandidateDiscoveryTotals.requests,
      external_discovery_by_surface: externalDiscoveryBySurface,
      external_402_challenges: externalChallenges,
      enhanced_external_402_challenges: enhancedExternalChallenges,
      signed_payment_attempts: externalSignedRequests,
      successful_signed_responses: externalSignedSuccesses,
      trusted_capture_started_at: trustedBaseline.initialized_at,
      trusted_epoch_id: Number(trustedBaseline.epoch_id || 1),
      trusted_measurement_eligible: measurementEligible,
      trusted_epoch_rotation: epochRotation,
      trusted_external_discovery_requests: effectiveTrusted.external_discovery_requests,
      trusted_buyer_candidate_discovery: effectiveBuyerCandidateDiscovery,
      trusted_buyer_candidate_discovery_requests: Number(effectiveBuyerCandidateDiscovery.requests || 0),
      trusted_external_402_challenges: effectiveTrusted.external_402_challenges,
      trusted_signed_payment_attempts: effectiveTrusted.signed_payment_attempts,
      trusted_successful_signed_responses: effectiveTrusted.successful_signed_responses,
      trusted_external_by_product: effectiveByProduct,
      trusted_by_channel: effectiveByChannel,
      trusted_by_client_class: effectiveByClient,
      trusted_external_discovery_by_surface: effectiveDiscoveryBySurface,
      trusted_by_cohort: effectiveByCohort,
      trusted_by_discovery_cohort: effectiveByDiscoveryCohort,
      provisional_external_discovery_requests: trusted.external_discovery_requests,
      provisional_buyer_candidate_discovery: trustedBuyerCandidateDiscovery,
      provisional_buyer_candidate_discovery_requests: trustedBuyerCandidateDiscovery.requests,
      provisional_external_402_challenges: trusted.external_402_challenges,
      provisional_signed_payment_attempts: trusted.signed_payment_attempts,
      provisional_successful_signed_responses: trusted.successful_signed_responses,
      pre_trusted_external_402_challenges: Number(trustedBaseline.counters.external_402_challenges || 0),
      pre_trusted_measurement_note: trustedBaseline.reason,
      challenge_to_signed_attempt_percent: measurementEligible && effectiveTrusted.external_402_challenges > 0
        ? Math.round(effectiveTrusted.signed_payment_attempts / effectiveTrusted.external_402_challenges * 1_000) / 10
        : null,
      signed_attempt_success_percent: measurementEligible && effectiveTrusted.signed_payment_attempts > 0
        ? Math.round(effectiveTrusted.successful_signed_responses / effectiveTrusted.signed_payment_attempts * 1_000) / 10
        : null,
      learning_stage: trustedLearningStage,
      mcp_external: externalMcpTotals,
      mcp_external_by_product: externalMcpByProduct,
      mcp_buyer_candidate: buyerCandidateMcpTotals,
      trusted_mcp_available: Boolean(effectiveTrustedMcp),
      trusted_mcp_external: effectiveTrustedMcp?.external_totals || {},
      trusted_mcp_buyer_candidate: effectiveTrustedMcp?.buyer_candidate_totals || {},
      trusted_mcp_external_by_product: effectiveTrustedMcp?.external_by_product || {},
      trusted_mcp_by_channel: effectiveTrustedMcp?.by_channel || {},
      trusted_mcp_by_client_class: effectiveTrustedMcp?.by_client_class || {},
      trusted_mcp_by_client_family: effectiveTrustedMcp?.by_client_family || {},
      trusted_mcp_validation_kinds: effectiveTrustedMcp?.validation_kinds || {},
      mcp_preview_copy_experiment: mcpPreviewCopyExperiment,
      mcp_learning_stage: mcpLearningStage,
      trusted_mcp_learning_stage: trustedMcpLearningStage,
      mcp_by_source: state.mcp_by_source,
      mcp_by_client_class: state.mcp_by_client_class,
      mcp_by_client_family: state.mcp_by_client_family,
      mcp_validation_kinds: state.mcp_validation_kinds,
      mcp_by_channel: state.mcp_by_channel,
      mcp_by_day: state.mcp_by_day,
      mcp_by_hour: state.mcp_by_hour,
      owner_automation_requests: owner.requests,
      by_product: state.by_product,
      by_source: state.by_source,
      external_by_product: externalByProduct,
      by_client_class: state.by_client_class,
      by_channel: state.by_channel,
      by_input_profile: state.by_input_profile,
      by_payment_carrier: state.by_payment_carrier,
      by_response_preference: state.by_response_preference,
      by_cohort: state.by_cohort,
      by_day: state.by_day,
      by_hour: state.by_hour,
      by_discovery_surface: state.by_discovery_surface,
      by_discovery_source: state.by_discovery_source,
      by_discovery_client_class: state.by_discovery_client_class,
      by_discovery_channel: state.by_discovery_channel,
      by_discovery_cohort: state.by_discovery_cohort,
      discovery_by_day: state.discovery_by_day,
      discovery_by_hour: state.discovery_by_hour,
      privacy: state.privacy,
      accounting_note: "Edge funnel telemetry measures aggregate HTTP behavior only. Onchain settlement attribution remains authoritative for purchases and revenue.",
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
  return Number.isFinite(parsed) ? `${parsed < 0 ? "-" : ""}$${Math.abs(parsed).toFixed(2)}` : "unavailable";
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function renderMonitorNote(report: Record<string, any>): string {
  const directRevenueValue = Number(report.revenue?.recognized_usdc || 0);
  const marketplaceRevenueValue = Number(report.marketplaces?.the402?.settled_usd || 0);
  const nearRevenueValue = Number(report.marketplaces?.near?.earned_usdc_balance || 0);
  const taskmarketTracked = report.acquisition?.public_demand_watch?.taskmarket?.tracked_worker || {};
  const taskmarketRevenueValue = Number(taskmarketTracked.settled_worker_earnings_usdc || 0);
  const clawlancer = report.marketplaces?.clawlancer || {};
  const clawlancerRevenueValue = Number(clawlancer.verified_worker_earnings_usdc || 0);
  const revenueValue = directRevenueValue + marketplaceRevenueValue + nearRevenueValue + taskmarketRevenueValue + clawlancerRevenueValue;
  const costsValue = Number(trackedCostsInput);
  const profitValue = revenueValue - costsValue;
  const purchases = report.revenue?.purchases || {};
  const marketplacePurchases = Number(report.marketplaces?.the402?.completed_jobs || 0);
  const subscriptionPurchases = Number(report.marketplaces?.the402?.subscription_purchases || 0);
  const nearPurchases = Number(report.marketplaces?.near?.completed_external_jobs || 0);
  const taskmarketPurchases = Number(taskmarketTracked.settled_submissions || 0);
  const clawlancerPurchases = Number(clawlancer.settled_jobs || 0);
  const payanAttributedSales = Number(report.marketplaces?.payan?.delivered_external_sales || 0);
  const payanDemand = report.marketplaces?.payan?.demand_capture || {};
  const agenticIndexed = report.marketplaces?.agentic_market?.indexed_products || {};
  const agenticMissing = Array.isArray(report.marketplaces?.agentic_market?.missing_products)
    ? report.marketplaces.agentic_market.missing_products
    : [];
  const mcpDriftIndexing = agenticMissing.includes("mcpdrift")
    ? "owner activation settlement completed on 2026-07-21 and is awaiting the documented asynchronous CDP catalog refresh; the dedicated payer and revenue exclusion are enforced"
    : "indexed in the CDP Bazaar mirror; no owner refresh is pending";
  const totalPurchases = Number(purchases.total || 0) + marketplacePurchases + subscriptionPurchases + nearPurchases + taskmarketPurchases + clawlancerPurchases;
  const skillInstalls = report.acquisition?.skills_sh?.install_counts || {};
  const totalSkillInstalls = report.acquisition?.skills_sh?.total_installs;
  const skillsShSearch = report.acquisition?.skills_sh?.search_index || {};
  const dedicatedSkillsSh = report.acquisition?.skills_sh_dedicated || {};
  const dedicatedSkillsShSearch = dedicatedSkillsSh.search_index || {};
  const awesomeSkills = report.acquisition?.awesome_skills || {};
  const experiment = report.acquisition?.experiment || {};
  const publicDemand = report.acquisition?.public_demand_watch || {};
  const moltDemand = publicDemand.moltjobs || {};
  const openDemand = publicDemand.openjobs || {};
  const taskmarketDemand = publicDemand.taskmarket || {};
  const buyerQuerySummary = report.discovery?.buyer_query_summary || {};
  const buyerQueryBenchmark = report.discovery?.buyer_query_benchmark || {};
  const buyerBenchmarkSummary = Number.isFinite(Number(buyerQuerySummary.query_count))
    ? `${Number(buyerQuerySummary.found_queries || 0)} / ${Number(buyerQuerySummary.query_count)} unbranded buyer-query variants found; ${Number(buyerQuerySummary.top_three_queries || 0)} rank in the top 3`
    : "unavailable";
  const funnel = report.funnel || {};
  const mcpBuyerCandidate = funnel.mcp_buyer_candidate || {};
  const trustedMcpBuyerCandidate = funnel.trusted_mcp_buyer_candidate || {};
  const trustedMcpAvailable = funnel.trusted_mcp_available === true;
  const mcpPreviewCopyExperiment = funnel.mcp_preview_copy_experiment || {};
  const mcpPreviewCopyDelta = mcpPreviewCopyExperiment.delta || {};
  const mcpPreviewCopyRatios = mcpPreviewCopyExperiment.event_ratios || {};
  const ratio = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value))
    ? `${Number(value)}%`
    : "not yet measurable";
  const mcpValidationKinds = funnel.mcp_validation_kinds || {};
  const mcpValidationSummary = Object.entries(mcpValidationKinds)
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([kind, count]) => `${kind} ${Number(count)}`)
    .join(", ") || "none observed";
  const mcpRegistryCrawler = funnel.mcp_by_client_class?.registry_crawler || {};
  const mcpKiroPower = funnel.mcp_by_channel?.kiro_power || {};
  const mcpAgentSkillsMarketplace = funnel.mcp_by_channel?.agent_skills_marketplace || {};
  const mcpClineMarketplace = funnel.mcp_by_channel?.cline_marketplace || {};
  const mcpKiloMarketplace = funnel.mcp_by_channel?.kilo_marketplace || {};
  const mcpCursorDeeplink = funnel.mcp_by_channel?.cursor_deeplink || {};
  const mcpOpenHandsIntegrations = funnel.mcp_by_channel?.openhands_integrations || {};
  const mcpGlama = funnel.mcp_by_channel?.glama || {};
  const githubPrMonitoring = report.acquisition?.github_pr_monitoring || {};
  const githubPrFailureSummary = Array.isArray(githubPrMonitoring.failures) && githubPrMonitoring.failures.length
    ? githubPrMonitoring.failures.slice(0, 10).map((failure: Record<string, any>) => {
        const failedNames = Array.isArray(failure.failed_check_names)
          ? failure.failed_check_names.slice(0, 3).join(", ")
          : "";
        return `${String(failure.name || "unknown")}: ${String(failure.kind || failure.status || "failure")}${failedNames ? ` (${failedNames})` : ""}`;
      }).join("; ")
    : "none";
  const githubPrActionSummary = Array.isArray(githubPrMonitoring.action_required) && githubPrMonitoring.action_required.length
    ? githubPrMonitoring.action_required.slice(0, 10).map((entry: Record<string, any>) => {
        const names = Array.isArray(entry.gate_names) ? entry.gate_names.slice(0, 3).join(", ") : "";
        return `${String(entry.name || "unknown")}${names ? ` (${names})` : ""}`;
      }).join("; ")
    : "none";
  const githubCheckRuns = githubPrMonitoring.check_runs || {};
  const githubWorkflowRuns = githubPrMonitoring.workflow_runs || {};
  const githubPrWorkflowTelemetryAvailable = Number(githubPrMonitoring.checked || 0) >= 12 &&
    Number.isFinite(Number(githubCheckRuns.total)) && Number.isFinite(Number(githubWorkflowRuns.total)) &&
    Array.isArray(githubPrMonitoring.action_required) && Array.isArray(githubPrMonitoring.failures);
  const githubPrTelemetrySummary = githubPrWorkflowTelemetryAvailable
    ? `${Number(githubPrMonitoring.sources_readable ?? githubPrMonitoring.checked ?? 0)} / ${Number(githubPrMonitoring.checked || 0)} PR sources readable. Workflow runs: ${Number(githubWorkflowRuns.succeeded || 0)} success, ${Number(githubWorkflowRuns.neutral_or_skipped || 0)} neutral/skipped, ${Number(githubWorkflowRuns.failed || 0)} failed, ${Number(githubWorkflowRuns.cancelled_or_stale || 0)} cancelled/stale, ${Number(githubWorkflowRuns.action_required || 0)} action-required, ${Number(githubWorkflowRuns.pending || 0)} pending of ${Number(githubWorkflowRuns.total || 0)}. PR check rollup: ${Number(githubCheckRuns.succeeded || 0)} success, ${Number(githubCheckRuns.neutral_or_skipped || 0)} neutral/skipped, ${Number(githubCheckRuns.failed || 0)} failed, ${Number(githubCheckRuns.cancelled_or_stale || 0)} cancelled/stale, ${Number(githubCheckRuns.action_required || 0)} action-required, ${Number(githubCheckRuns.pending || 0)} pending of ${Number(githubCheckRuns.total || 0)}. Maintainer approval gates: ${githubPrActionSummary}; failure detail: ${githubPrFailureSummary}. Approval-required is actionable but is not a failed workflow or buyer demand.`
    : `${Number(githubPrMonitoring.sources_readable ?? githubPrMonitoring.checked ?? 0)} / ${Number(githubPrMonitoring.checked || 0)} legacy PR sources readable; workflow outcomes are unavailable until the next audited directory refresh and zero is not asserted.`;
  const mcpDownstreams = report.acquisition?.mcp_downstreams || {};
  const smithery = report.acquisition?.smithery || {};
  const smitheryBenchmark = smithery.buyer_query_benchmark || {};
  const smitherySummary = smithery.listed
    ? `${Number(smithery.tool_count || 0)} tools live; ${Number(smithery.use_count || 0)} public uses; unbranded retrieval ${Number(smitheryBenchmark.found_queries || 0)} / ${Number(smitheryBenchmark.query_count || SMITHERY_BUYER_QUERIES.length)} queries found, ${Number(smitheryBenchmark.top_ten_queries || 0)} top-ten, and ${Number(smitheryBenchmark.top_three_queries || 0)} top-three`
    : `unavailable (${smithery.error || smithery.status || "not checked"})`;
  const githubTraffic = report.acquisition?.github_traffic || {};
  const the402OutcomeTotals = report.marketplaces?.the402?.service_outcome_totals || {};
  const cdpMerchantQuality = report.discovery?.cdp_merchant_quality || {};
  const cdpMerchantQualityAvailable = Object.keys(cdpMerchantQuality).length > 0;
  const cdpReconciliationProducts = Object.entries(cdpMerchantQuality)
    .filter(([, quality]: [string, any]) => quality?.requires_settlement_reconciliation === true)
    .map(([product]) => PRODUCT_CATALOG[product as ProductKey]?.service || product);
  const externalProductFunnel = funnel.trusted_external_by_product || {};
  const activeChannels = Object.entries(funnel.trusted_by_channel || {})
    .filter(([channel, counters]: [string, any]) => !["owner_automation", "legacy_unclassified"].includes(channel) && Number(counters?.requests || 0) > 0)
    .sort((left: [string, any], right: [string, any]) => Number(right[1]?.requests || 0) - Number(left[1]?.requests || 0));
  const activeClients = Object.entries(funnel.trusted_by_client_class || {})
    .filter(([client, counters]: [string, any]) => !["owner_automation", "legacy_unclassified"].includes(client) && Number(counters?.requests || 0) > 0)
    .sort((left: [string, any], right: [string, any]) => Number(right[1]?.requests || 0) - Number(left[1]?.requests || 0));
  const activeMcpClientFamilies = Object.entries(funnel.mcp_by_client_family || {})
    .filter(([family, counters]: [string, any]) => !["owner_automation", "not_applicable"].includes(family) && Number(counters?.initialize || 0) > 0)
    .sort((left: [string, any], right: [string, any]) => Number(right[1]?.initialize || 0) - Number(left[1]?.initialize || 0));
  const externalDiscoverySurfaces = Object.entries(funnel.trusted_external_discovery_by_surface || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0));
  const externalDiscoveryCohorts = Object.entries(funnel.trusted_by_discovery_cohort || {})
    .filter(([cohort, counters]: [string, any]) =>
      isBuyerCandidateDiscoveryCohort(cohort) && Number(counters?.requests || 0) > 0
    )
    .sort((left: [string, any], right: [string, any]) =>
      Number(right[1]?.requests || 0) - Number(left[1]?.requests || 0)
    )
    .slice(0, 5)
    .map(([cohort, counters]: [string, any]) => {
      const [surface, channel, client, response] = cohort.split("|");
      return `${surface} via ${channel}/${client} (${Number(counters.requests)}; ${response})`;
    });
  const externalPaidRouteCohorts = Object.entries(funnel.trusted_by_cohort || {})
    .filter(([cohort, counters]: [string, any]) =>
      !cohort.includes("|owner_automation|") && Number(counters?.requests || 0) > 0
    )
    .sort((left: [string, any], right: [string, any]) =>
      Number(right[1]?.requests || 0) - Number(left[1]?.requests || 0)
    )
    .slice(0, 5)
    .map(([cohort, counters]: [string, any]) => {
      const [product, channel, client, input, payment] = cohort.split("|");
      return `${product} via ${channel}/${client} (${Number(counters.requests)}; input ${input}; payment ${payment})`;
    });
  const indexed = report.discovery?.indexed_products || {};
  const status = report.healthy ? "HEALTHY" : "DEGRADED";
  const errors = Array.isArray(report.errors) && report.errors.length
    ? report.errors.map((error: unknown) => `- ${String(error)}`).join("\n")
    : "- None";
  return `# Mimir x402 Monitor

- **STATUS:** ${status}
- **Customer revenue:** ${money(revenueValue)} / $1,000.00
- **Current profit (recognized-USDC basis):** ${money(profitValue)} (customer revenue minus ${money(costsValue)} tracked USD costs)
- **Security action required:** revoke the x402.jobs API key that appeared in the tracked example file during local investigation; it was removed before commit or push and was never used. Store any future replacement only in an ignored mode-0600 user configuration after body-aware endpoint verification is supported.
- **Historic owner-test gas:** approximately ${historicalTestGasEth} ETH (reported separately; not converted into tracked USD costs)
- **Distribution milestone:** ${totalPurchases} / 10 genuine external purchases
- **Pending Taskmarket opportunity estimate (not revenue):** ${Number(taskmarketTracked.pending_submissions || 0)} submissions; $${String(taskmarketTracked.pending_gross_potential_usdc || "0")} gross / $${String(taskmarketTracked.pending_net_potential_usdc || "0")} net if awarded (pool-task net is explicitly operator-estimated from submitted record types; gross is scaled by that task's live reward/net contract, never the full escrow)
- **Autonomous work safety gate (2026-07-21 snapshot):** minia2a gas task rejected after 79 competing submissions; minia2a CAPTCHA rejected for insufficient authorization, live request/price drift, duplicate payment choices, and unsafe public token delivery; BountyBook excluded because all 32 API-verified jobs reported payout failure, no payout transaction hash, and contract job ID 0. No payment or claim was made.
- **Tollbooth compatibility probe:** submitted_unverified; its verifier parsed the exact $0.05 x402 v2 Base-USDC challenge and payee but the paid replay stayed at HTTP 402 with no settlement proof. The listing has zero calls and zero revenue; do not retry or weaken the production protocol until Tollbooth demonstrates compatible v2 payment replay.
- **Smithery marketplace:** ${smitherySummary} at [cristianmoroaica/bountyverdict](https://smithery.ai/servers/cristianmoroaica/bountyverdict) (fixed owner-run retrieval and the public use counter are placement/use telemetry, not search volume, impressions, purchases, or revenue)
- **ToolHive in-agent catalog:** ${report.acquisition?.toolhive?.status || "pr_open_pending_directory_refresh"}; issue [#1384](https://github.com/stacklok/toolhive-catalog/issues/1384) and PR [#1388](${report.acquisition?.toolhive?.url || "https://github.com/stacklok/toolhive-catalog/pull/1388"}); PR ${report.acquisition?.toolhive?.pr_status || "open"}, review ${report.acquisition?.toolhive?.pr_review_decision || "REVIEW_REQUIRED"}, merge state ${report.acquisition?.toolhive?.pr_merge_state_status || "BLOCKED"}; exact secret-free six-tool catalog contract ${report.acquisition?.toolhive?.contract_verified ? "verified live" : "pending merge"}. Full catalog validation and Go tests passed before submission. Placement and review state are not impressions, installs, purchases, or revenue.
- **Clawlancer funded-work canary:** ${clawlancer.available ? `${String(clawlancer.status || "unknown").toUpperCase()}; ${clawlancer.transaction?.fundingTxHash ? "funding transaction reported" : "no funding transaction"}; ${clawlancer.onchain_evidence?.verified ? "release verified on Base and recognized" : "no onchain-verified release, not revenue"}; next action ${clawlancer.action || "unknown"}` : `unavailable (${clawlancer.error || "state not captured"})`} (the pinned deliverable auto-submits only after FUNDED)
- **Neutral buyer-query retrieval:** ${buyerBenchmarkSummary}
- **CDP Bazaar activity deltas:** ${cdpMerchantQualityAvailable ? (cdpReconciliationProducts.length ? `${cdpReconciliationProducts.join(", ")} changed and require settlement reconciliation` : "no counter or call-recency advance from the owner-contaminated baseline") : "baseline pending the next audited marketplace observation"} (never revenue by itself)
- **CDP MCPDrift indexing path:** ${mcpDriftIndexing}; its representative JSON activation call settled successfully and strict invalid-input-before-payment behavior remains intact
- **GitHub repository reach (rolling 14 days):** ${githubTraffic.available ? `${Number(githubTraffic.views?.count || 0)} views / ${Number(githubTraffic.views?.uniques || 0)} unique; ${Number(githubTraffic.clones?.count || 0)} clones / ${Number(githubTraffic.clones?.uniques || 0)} unique` : `unavailable (${githubTraffic.error || "not captured"})`}
- **Agent edge funnel:** ${funnel.available ? `${Number(funnel.trusted_buyer_candidate_discovery_requests || 0)} trusted buyer-candidate discovery hits; ${Number(funnel.trusted_external_discovery_requests || 0)} raw external discovery/health hits; ${Number(funnel.trusted_external_402_challenges || 0)} trusted 402 challenges; ${Number(funnel.trusted_signed_payment_attempts || 0)} signed attempts; ${Number(funnel.trusted_successful_signed_responses || 0)} signed successes in epoch ${Number(funnel.trusted_epoch_id || 1)} since ${funnel.trusted_capture_started_at || "the clean boundary"}` : `capture unavailable (${funnel.error || "not started"})`}
- **Latest privacy-safe buyer-candidate learning:** discovery ${externalDiscoveryCohorts.length ? externalDiscoveryCohorts.join("; ") : "none since the clean boundary"}; paid-route attempts ${externalPaidRouteCohorts.length ? externalPaidRouteCohorts.join("; ") : "none since the clean boundary"} (Agent402 OpenAPI/x402 health, owner automation, x402 observer, and registry crawlers remain visible as raw reach but are excluded here; bounded aggregate categories only; no arguments, URLs, payloads, identities, IPs, or raw user agents retained)
- **MCP buyer-candidate funnel:** ${funnel.available ? `${Number(mcpBuyerCandidate.initialize || 0)} initializations; ${Number(mcpBuyerCandidate.tools_list || 0)} tool-list requests; ${Number(mcpBuyerCandidate.protocol_error || 0)} protocol errors; ${Number(mcpBuyerCandidate.capacity_rejected || 0)} capacity rejections; ${Number(mcpBuyerCandidate.payment_required || 0)} valid unpaid tool calls; ${Number(mcpBuyerCandidate.payment_present || 0)} payment presentations; ${Number(mcpBuyerCandidate.paid_success || 0)} paid successes` : "unavailable"} (${funnel.mcp_learning_stage || "not started"}; owner, registry, Glama release, and x402 observer channels excluded)
- **MCP selection-preview rollout:** ${funnel.available ? `${mcpPreviewCopyExperiment.status || "unavailable"} since ${mcpPreviewCopyExperiment.started_at || "unknown"} at ${String(mcpPreviewCopyExperiment.release_commit || "unknown").slice(0, 7)}; delta ${Number(mcpPreviewCopyDelta.initialize || 0)} initialize / ${Number(mcpPreviewCopyDelta.tools_list || 0)} tools/list / ${Number(mcpPreviewCopyDelta.validation_error || 0)} invalid / ${Number(mcpPreviewCopyDelta.payment_required || 0)} valid unpaid / ${Number(mcpPreviewCopyDelta.payment_present || 0)} payment presented / ${Number(mcpPreviewCopyDelta.paid_success || 0)} paid success; list-to-valid ${ratio(mcpPreviewCopyRatios.valid_call_per_tools_list_percent)}, invalid share ${ratio(mcpPreviewCopyRatios.invalid_call_share_percent)}, valid-to-payment ${ratio(mcpPreviewCopyRatios.payment_present_per_valid_call_percent)}` : "unavailable"} (aggregate event deltas, not unique agents or purchase proof)
- **MCP invalid-call learning:** ${funnel.available ? mcpValidationSummary : "unavailable"} (coarse categories only; no arguments, URLs, payloads, identities, or raw client names retained; pre-upgrade events remain legacy-unclassified)
- **MCP directory-crawler activity:** ${funnel.available ? `${Number(mcpRegistryCrawler.initialize || 0)} initializations; ${Number(mcpRegistryCrawler.tools_list || 0)} tool-list requests; ${Number(mcpRegistryCrawler.payment_required || 0)} valid unpaid tool calls` : "unavailable"} (retained separately for distribution propagation, never treated as buyer intent)
- **Kiro Power package:** repository contract published; registry submission not made because publisher terms require explicit acceptance; ${funnel.available ? `${Number(mcpKiroPower.initialize || 0)} declared-source initializations, ${Number(mcpKiroPower.tools_list || 0)} tool-list requests, ${Number(mcpKiroPower.payment_required || 0)} valid unpaid calls, ${Number(mcpKiroPower.payment_present || 0)} payment presentations` : "funnel unavailable"} (source marker is aggregate attribution, not proof of install, identity, or purchase)
- **Cursor direct MCP workflow:** official one-click MCP deeplink published; Marketplace publication is intentionally excluded because its Publisher Terms prohibit direct or indirect user fees, which conflicts with x402 calls; ${funnel.available ? `${Number(mcpCursorDeeplink.initialize || 0)} deeplink-source initializations, ${Number(mcpCursorDeeplink.tools_list || 0)} deeplink tool-list requests` : "funnel unavailable"} (source-marked aggregates are not clicks, installs, unique agents, purchases, or revenue)
- **OpenHands integrations registry:** ${report.acquisition?.openhands_integrations?.status || "pr_open_pending_directory_refresh"}; PR [#416](${report.acquisition?.openhands_integrations?.url || "https://github.com/OpenHands/extensions/pull/416"}); exact no-auth Streamable HTTP contract ${report.acquisition?.openhands_integrations?.contract_verified ? "verified live" : "pending merge"}; ${funnel.available ? `${Number(mcpOpenHandsIntegrations.initialize || 0)} initializations, ${Number(mcpOpenHandsIntegrations.tools_list || 0)} tool-list requests, ${Number(mcpOpenHandsIntegrations.payment_required || 0)} valid unpaid calls, ${Number(mcpOpenHandsIntegrations.payment_present || 0)} payment presentations` : "funnel unavailable"} (PR or catalog presence and aggregate events are not installs, unique agents, purchases, or revenue)
- **AgentSkills.in adapter:** ${report.acquisition?.agent_skills_in?.listed ? "1 / 1 exact skill listed" : report.acquisition?.agent_skills_in?.status || "awaiting audited catalog refresh"}; public adapter [repository](https://github.com/cristianmoroaica/bountyverdict-mcp-skill), indexing [submission #23](https://github.com/Karanjot786/agent-skills-cli/issues/23); ${funnel.available ? `${Number(mcpAgentSkillsMarketplace.initialize || 0)} source-marked initializations, ${Number(mcpAgentSkillsMarketplace.tools_list || 0)} tool-list requests, ${Number(mcpAgentSkillsMarketplace.validation_error || 0)} invalid calls, ${Number(mcpAgentSkillsMarketplace.payment_required || 0)} valid unpaid calls, ${Number(mcpAgentSkillsMarketplace.payment_present || 0)} payment presentations, ${Number(mcpAgentSkillsMarketplace.paid_success || 0)} paid successes` : "funnel unavailable"} (submission/listing and aggregate events are not installs, unique agents, purchases, or revenue)
- **SkillsMD adapter:** ${report.acquisition?.skills_md?.listed ? `1 / 1 exact skill listed; ${Number(report.acquisition.skills_md.installs || 0)} public installs` : report.acquisition?.skills_md?.status || "awaiting audited catalog refresh"}; submission receipt ${report.acquisition?.skills_md?.submission?.id || "e68e968f-d03d-4808-b36b-5fd3b42b6489"}; shares the privacy-safe agent-skill source cohort above (submission, listing, and public install counts are not impressions, tool calls, purchases, or revenue)
- **askill adapter:** ${report.acquisition?.askill?.listed ? `1 / 1 exact skill listed at ${report.acquisition.askill.listing_url}; task-first copy ${report.acquisition.askill.buyer_language_revision_live ? "live" : "pending"}; complete adapter revision ${report.acquisition.askill.adapter_revision_live ? "live" : "pending reindex"}; ${Number(report.acquisition.askill.favorites || 0)} public favorites; unbranded retrieval ${Number(report.acquisition.askill.buyer_query_benchmark?.found_queries || 0)} / ${Number(report.acquisition.askill.buyer_query_benchmark?.query_count || ASKILL_BUYER_QUERIES.length)} queries found and ${Number(report.acquisition.askill.buyer_query_benchmark?.top_three_queries || 0)} top-three` : report.acquisition?.askill?.status || "awaiting audited catalog refresh"}; exact install source ${report.acquisition?.askill?.install_source || "gh:cristianmoroaica/bountyverdict-mcp-skill@route-github-agent-decisions"} (fixed owner-run retrieval, listing, and favorites are not search volume, impressions, installs, tool calls, purchases, or revenue; askill exposes no public install counter)
- **Dedicated askill adapter:** ${report.acquisition?.askill_dedicated?.listed ? `1 / 1 exact skill listed at ${report.acquisition.askill_dedicated.listing_url}; ${Number(report.acquisition.askill_dedicated.favorites || 0)} public favorites; unbranded retrieval ${Number(report.acquisition.askill_dedicated.buyer_query_benchmark?.found_queries || 0)} / ${Number(report.acquisition.askill_dedicated.buyer_query_benchmark?.query_count || ASKILL_BUYER_QUERIES.length)} queries found and ${Number(report.acquisition.askill_dedicated.buyer_query_benchmark?.top_three_queries || 0)} top-three` : report.acquisition?.askill_dedicated?.status || "awaiting audited catalog refresh"}; exact install source ${report.acquisition?.askill_dedicated?.install_source || "gh:Mimirs402/bountyverdict-mcp-skill@route-github-agent-decisions"} (separate dedicated-account placement; never merged into the frozen legacy experiment or treated as an install, purchase, or revenue)
- **Canonical askill skill suite:** ${report.acquisition?.askill_main?.listed ? `${Number(report.acquisition.askill_main.listed_skills || 0)} / 7 exact task skills listed; ${Number(report.acquisition.askill_main.favorites || 0)} public favorites; unbranded retrieval ${Number(report.acquisition.askill_main.buyer_query_benchmark?.found_queries || 0)} / ${Number(report.acquisition.askill_main.buyer_query_benchmark?.query_count || ASKILL_BUYER_QUERIES.length)} queries found and ${Number(report.acquisition.askill_main.buyer_query_benchmark?.top_three_queries || 0)} top-three` : report.acquisition?.askill_main?.status || "awaiting audited catalog refresh"} (one canonical repository submission; listing and owner-run rank evidence are never impressions, installs, calls, purchases, or revenue)
- **Dedicated Skills.sh adapter:** ${dedicatedSkillsSh.listed ? `listed at ${dedicatedSkillsSh.url}; exact search rank ${dedicatedSkillsShSearch.exact_rank || "unavailable"}; natural retrieval ${Number(dedicatedSkillsShSearch.natural_found || 0)} / ${Number(dedicatedSkillsShSearch.natural_expected || ASKILL_BUYER_QUERIES.length)} queries and ${Number(dedicatedSkillsShSearch.natural_top_three || 0)} top-three` : `${dedicatedSkillsSh.status || "awaiting audited catalog refresh"}; indexing request ${dedicatedSkillsSh.indexing_request?.issue_url || "https://github.com/vercel-labs/skills/issues/1754"}`} (upstream request, listing, and owner-run retrieval are not impressions, installs, tool calls, purchases, or revenue)
- **Awesome Skills adapter:** ${awesomeSkills.contract_verified ? `listed with exact source, install command, task description, payment handoff, and ${Number(awesomeSkills.listed_tools || 0)} / ${Number(awesomeSkills.expected_tools || 6)} tools at ${awesomeSkills.url}` : awesomeSkills.status || "awaiting audited catalog refresh"} (account-free submission and listing contract are not impressions, installs, tool calls, purchases, or revenue)
- **Agent-Skills.md adapter:** ${report.acquisition?.agent_skills_md?.status || "unavailable"} (${report.acquisition?.agent_skills_md?.contract_verified ? "task-first source and six-tool payment handoff verified" : "publication or contract verification pending"}; ${report.acquisition?.agent_skills_md?.listing_url || "https://agent-skills.md/skills/Mimirs402/bountyverdict-mcp-skill/route-github-agent-decisions"}; anonymous submission and listing presence are not impressions, installs, tool calls, purchases, or revenue)
- **Glama release path:** build-ready secret-free stdio bridge to the existing six-tool remote; ${funnel.available ? `${Number(mcpGlama.initialize || 0)} source-marked initializations, ${Number(mcpGlama.tools_list || 0)} tool-list requests, ${Number(mcpGlama.payment_required || 0)} valid unpaid calls, ${Number(mcpGlama.payment_present || 0)} payment presentations` : "funnel unavailable"}; dashboard release and quality score pending (source marker and build checks are distribution evidence only, never installs, purchases, or revenue)
- **Authenticated GitHub PR telemetry:** ${githubPrTelemetrySummary}
- **Official MCP Registry:** ${report.acquisition?.mcp_registry?.listed ? `${report.acquisition.mcp_registry.name}@${report.acquisition.mcp_registry.version} listed at the exact production Streamable HTTP endpoint` : `unavailable (${report.acquisition?.mcp_registry?.error || "not checked"})`} (placement only, never a purchase)
- **Agentic Resource Discovery catalog (last audited snapshot):** ${report.acquisition?.ard_catalog?.live ? `${report.acquisition.ard_catalog.representative_queries} neutral buyer queries and ${report.acquisition.ard_catalog.capabilities} MCP capabilities live` : report.acquisition?.ard_catalog?.status || "unavailable"} (${report.acquisition?.ard_catalog?.url || "origin catalog not checked"}; direct catalog availability is not registry indexing, an impression, a tool call, or a purchase)
- **MCP paid-call handoff:** ${report.health?.mcp_metadata?.payment?.http_payment_handoff_extension === "io.github.Mimirs402/bountyverdict/http-payment-handoff" && report.health?.mcp_metadata?.payment?.direct_automatic_payment_requires === "@x402/mcp" ? "live — direct MCP payment requires @x402/mcp; standard hosts receive the exact versioned HTTP handoff for a separately authorized wallet" : "unavailable or drifted"}
- **GitHub Actions MCP intent page:** ${report.acquisition?.mcp_intent_page?.live && report.acquisition?.mcp_intent_page?.copy_ready_prompt ? "live with direct adapter install and a copy-ready schema-valid $0.04 call prompt" : `unavailable or drifted (${report.acquisition?.mcp_intent_page?.error || "required call prompt not verified"})`} (owner-checked availability, never an impression or purchase)
- **MCP downstream propagation:** 1MCP ${mcpDownstreams.one_mcp?.status === "confirmed_direct_official_registry_consumer" ? "confirmed" : "unavailable"}; MCPProxy ${mcpDownstreams.mcp_proxy?.status === "direct_official_registry_consumer" ? "available through direct official lookup" : "unavailable"}; mcpub ${mcpDownstreams.mcpub?.live_verified ? "live verified" : mcpDownstreams.mcpub?.listed ? "archive registered" : "pending registration"}; Qt Creator ${mcpDownstreams.qt_creator?.listed ? "listed" : "pending scheduled mirror"}; Glama ${mcpDownstreams.glama?.listed ? "listed" : "pending registry ingestion"} (bounded owner-run checks, never impressions or purchases)
- **MCPRepository:** ${report.acquisition?.mcp_repository?.status || "unavailable"} (${report.acquisition?.mcp_repository?.url || "submission not recorded"}; placement is never an impression, install, or purchase)
- **AgentNDX MCP/x402 registry:** ${report.acquisition?.agentndx?.status || "unavailable"} (${report.acquisition?.agentndx?.listed ? "exact listing active" : "submitted for review"}; catalog presence is never an impression, tool call, purchase, or revenue)
- **MCP Observatory:** ${report.acquisition?.mcp_observatory?.status || "unavailable"} (${report.acquisition?.mcp_observatory?.status === "repository_metadata_only" ? "repository metadata only; remote endpoint and tool schemas absent" : report.acquisition?.mcp_observatory?.status === "agent_ready" ? "remote endpoint and tool schemas exposed" : "exact propagation check pending"}; automatic indexing is never an impression, tool call, purchase, or revenue)
- **Measurement boundary:** ${funnel.trusted_measurement_eligible === false ? `draining owner-triggered downstream probes; ${Number(funnel.provisional_buyer_candidate_discovery_requests || 0)} buyer-candidate discovery, ${Number(funnel.provisional_external_discovery_requests || 0)} raw external discovery/health, and ${Number(funnel.provisional_external_402_challenges || 0)} challenge signals are excluded until a stable new epoch activates` : `epoch ${Number(funnel.trusted_epoch_id || 1)} eligible`}
- **Measurement policy:** every hit remains in privacy-safe lifetime/provisional telemetry; only conversion-capable paid-route events reset the clean-epoch quiet window
- **Current funnel diagnosis:** ${funnel.learning_stage || "unavailable"}
- **Current acquisition experiment:** ${experiment.status || "unavailable"}${experiment.started_at ? ` (started ${experiment.started_at}; ends ${experiment.ends_at})` : " (clock starts on first verified directory placement)"}
- **Experiment next action:** ${experiment.next_action?.code || "unavailable"} — ${experiment.next_action?.reason || "No classified action available."}
- **Customer purchases:** ${totalPurchases} (${Number(purchases.total || 0)} direct x402; ${marketplacePurchases} the402 one-off jobs; ${subscriptionPurchases} the402 subscriptions; ${nearPurchases} NEAR Agent Market jobs; ${taskmarketPurchases} onchain-verified Taskmarket awards)
- **the402 listing contracts:** ${report.marketplaces?.the402?.listing_contracts_verified ? "6 / 6 exact input and deliverable schemas verified" : "unavailable or drifted"}
- **the402 buyer-request feed:** ${report.marketplaces?.the402?.request_notifications_enabled ? "enabled; unset minimum budgets normalized before exact-match autonomous bidding" : "unavailable"}
- **the402 service attempts:** ${Number(the402OutcomeTotals.total_jobs || 0)} total (${Number(the402OutcomeTotals.successful_jobs || 0)} successful, ${Number(the402OutcomeTotals.failed_jobs || 0)} failed, ${Number(the402OutcomeTotals.disputed_jobs || 0)} disputed; marketplace telemetry, not settlement proof)
- **the402 monthly bundle:** ${report.marketplaces?.the402?.subscription_plan?.active ? `$${Number(report.marketplaces.the402.subscription_plan.agent_price_usd).toFixed(2)} for up to ${report.marketplaces.the402.subscription_plan.maximum_monthly_requests} requests` : "unavailable"}
- **NEAR Agent Market listings:** ${report.marketplaces?.near?.listing_contracts_verified ? "6 / 6 exact contracts verified" : "unavailable or drifted"}
- **PayanAgent offers:** ${report.marketplaces?.payan?.listing_contracts_verified ? "6 / 6 exact contracts verified" : "unavailable or drifted"} (${payanAttributedSales} delivered sales, attributed inside direct onchain totals)
- **Payan exact-fit demand capture:** ${payanDemand.healthy ? "enabled and healthy" : "unavailable or degraded"}; ${Number(payanDemand.open_requests_seen || 0)} open seen, ${Number(payanDemand.exact_matches || 0)} exact fits, ${Number(payanDemand.tracked_requests || 0)} tracked bids, ${Number(payanDemand.accepted || 0)} accepted, ${Number(payanDemand.fulfilled || 0)} fulfilled, ${Number(payanDemand.approved || 0)} approved (never bids on incomplete or mismatched briefs)
- **Public funded-demand watcher:** ${publicDemand.healthy ? "healthy and strictly read-only" : "unavailable or degraded"}; MoltJobs ${Number(moltDemand.verified_funded_open_jobs || 0)} verified funded / $${String(moltDemand.verified_funded_budget_usdc || "0")} USDC and ${Number(moltDemand.exact_candidate_count || 0)} exact fits; OpenJobs ${Number(openDemand.usdc_open_jobs || 0)} USDC jobs and ${Number(openDemand.exact_candidate_count || 0)} exact fits; Taskmarket ${Number(taskmarketDemand.api_escrow_backed_open_tasks || 0)} API escrow-backed / $${String(taskmarketDemand.api_escrow_backed_reward_usdc || "0")} USDC and ${Number(taskmarketDemand.exact_candidate_count || 0)} exact existing-product fits (inventory is never revenue)
- **Taskmarket worker settlement:** ${Number(taskmarketTracked.tracked_submissions || 0)} tracked submissions for ${taskmarketTracked.worker_address || "unavailable"}; ${Number(taskmarketTracked.pending_submissions || 0)} pending ($${String(taskmarketTracked.pending_gross_potential_usdc || "0")} gross / $${String(taskmarketTracked.pending_net_potential_usdc || "0")} net potential), ${Number(taskmarketTracked.rejected_submissions || 0)} rejected, ${Number(taskmarketTracked.unverified_award_submissions || 0)} API awards awaiting/failed Base verification, ${taskmarketPurchases} onchain-verified awards / ${money(taskmarketRevenueValue)} worker earnings (submissions, submit transactions, and API award rows alone remain zero purchases and zero revenue)
- **Agentic Market automatic directory:** ${report.marketplaces?.agentic_market?.exact_contracts_verified ? `${report.marketplaces.agentic_market.endpoint_count} / 7 exact contracts indexed` : "unavailable or drifted"}${agenticMissing.length ? `; pending ${agenticMissing.join(", ")}` : ""}
- **Agent402 open router:** ${report.acquisition?.agent402?.listed ? `${report.acquisition.agent402.found_queries ?? 0} / ${report.acquisition.agent402.query_count ?? 7} unbranded buyer queries retrieve the exact route; ${report.acquisition.agent402.top_three_queries ?? 0} top-three` : "unavailable or missing"} (${report.acquisition?.agent402?.listing_source || "unknown source"}; owner-run benchmark, not impressions)
- **x402scan registry:** ${report.acquisition?.x402scan?.listed_resources ?? "unavailable"} / ${report.acquisition?.x402scan?.expected_resources ?? 7} paid endpoints (${report.acquisition?.x402scan?.status || "unavailable"}; registry presence only, never a purchase)
- **x402gle/OpenDexter:** ${report.acquisition?.x402gle?.synthesized_skills ?? "unavailable"} / ${report.acquisition?.x402gle?.expected_products ?? 7} synthesized agent skills (${report.acquisition?.x402gle?.status || "unavailable"}; platform audition/listing activity is never an organic purchase)
- **Agent Tools Cloud organic catalog:** ${report.acquisition?.agent_tools_cloud?.listed_resources ?? 0} / ${report.acquisition?.agent_tools_cloud?.expected_resources ?? 7} direct resources (${report.acquisition?.agent_tools_cloud?.status || "unavailable"}; health ${report.acquisition?.agent_tools_cloud?.health || "unknown"}; x402 probe ${report.acquisition?.agent_tools_cloud?.x402_probe_status || "unknown"}; metadata ${report.acquisition?.agent_tools_cloud?.description_coverage || "unknown"}); refreshed MCP listing ${report.acquisition?.agent_tools_cloud?.mcp?.listed_tools ?? 0} / ${report.acquisition?.agent_tools_cloud?.mcp?.expected_tools ?? 6} tools (${report.acquisition?.agent_tools_cloud?.mcp?.status || "unavailable"}; health ${report.acquisition?.agent_tools_cloud?.mcp?.health || "unknown"}; x402 ${report.acquisition?.agent_tools_cloud?.mcp?.x402_supported === true ? "verified" : "unverified"}; safety ${report.acquisition?.agent_tools_cloud?.mcp?.safety_verdict || "unknown"}); fixed owner-run task retrieval ${report.acquisition?.agent_tools_cloud?.buyer_query_benchmark?.found_queries ?? 0} / ${report.acquisition?.agent_tools_cloud?.buyer_query_benchmark?.query_count ?? 6} found, ${report.acquisition?.agent_tools_cloud?.buyer_query_benchmark?.top_three_queries ?? 0} top-three; presence, health, and retrieval are never purchases
- **Monetize Your Agent:** ${report.acquisition?.monetize_your_agent?.status || "unavailable"} (submission ${report.acquisition?.monetize_your_agent?.submission_id ?? "unavailable"})
- **402directory:** ${report.acquisition?.directory_402?.listed_endpoints ?? 0} / ${report.acquisition?.directory_402?.expected_endpoints ?? 7} endpoints listed (${report.acquisition?.directory_402?.status || "unavailable"}; submissions ${Array.isArray(report.acquisition?.directory_402?.submission_ids) ? report.acquisition.directory_402.submission_ids.join(", ") : "unavailable"})
- **402 Index:** ${report.acquisition?.index_402?.active_resources ?? 0} / ${report.acquisition?.index_402?.expected_resources ?? 6} endpoints live (${report.acquisition?.index_402?.status || "unavailable"}; registry presence is never a purchase)
- **skills.sh anonymous CLI installs:** ${Number.isFinite(Number(totalSkillInstalls)) ? Number(totalSkillInstalls) : "unavailable"} (acquisition signal only; 8-install baseline on 2026-07-20)
- **skills.sh global search:** ${Number(skillsShSearch.exact_found || 0)} / ${Number(skillsShSearch.exact_expected || 7)} exact names; ${Number(skillsShSearch.natural_found || 0)} / ${Number(skillsShSearch.natural_expected || 7)} natural buyer queries (owner-run corpus check, not impressions)
- **Agent Plugins catalog:** ${report.acquisition?.agent_plugins_catalog?.listed_skills ?? 0} / 7 skills listed; provider PR ${report.acquisition?.agent_plugins_pr?.status || "unavailable"} (${report.acquisition?.agent_plugins_pr?.url || "submission not recorded"})
- **Awesome Copilot default marketplace:** ${report.acquisition?.awesome_copilot?.listed ? `listed at version ${report.acquisition.awesome_copilot.listed_version}` : report.acquisition?.awesome_copilot?.review_status || "unavailable"} (${report.acquisition?.awesome_copilot?.url || "submission not recorded"}; no install/impression telemetry exposed)
- **LobeHub MCP marketplace:** ${report.acquisition?.lobehub?.status || "pending_review"} (${report.acquisition?.lobehub?.url || "https://github.com/lobehub/lobehub/issues/17401"}; submission or catalog presence is never an impression, tool call, purchase, or revenue)
- **Awesome MCP Servers:** ${report.acquisition?.awesome_mcp_servers?.status || "unavailable"} (${report.acquisition?.awesome_mcp_servers?.url || "https://github.com/punkpeye/awesome-mcp-servers/pull/10554"}; placement only, never an impression, tool call, purchase, or revenue)
- **TensorBlock MCP Index:** ${report.acquisition?.tensorblock_mcp_index?.status || "unavailable"} (${report.acquisition?.tensorblock_mcp_index?.pr_url || "https://github.com/TensorBlock/awesome-mcp-servers/pull/1312"}; agent-ready catalog placement only, never an impression, tool call, purchase, or revenue)
- **Agentage MCP directory:** ${report.acquisition?.agentage?.status || "unavailable"} (${report.acquisition?.agentage?.directory_mcp || "https://catalog.agentage.io/mcp"}; exact owner-run record lookup only, never an impression, tool call, purchase, or revenue)
- **Docker MCP Registry:** ${report.acquisition?.docker_mcp_registry?.status || "unavailable"} (${report.acquisition?.docker_mcp_registry?.url || "https://github.com/docker/mcp-registry/pull/4496"}; Docker catalog placement only, never an impression, tool call, purchase, or revenue)
- **MCPServers.org:** ${report.acquisition?.mcp_servers_org?.status || "unavailable"} (free submission ${report.acquisition?.mcp_servers_org?.submission_id ?? 4842}; ${report.acquisition?.mcp_servers_org?.listing_url || "https://mcpservers.org/servers/cristianmoroaica/bountyverdict"}; exact receipt/listing checks only, never search impressions, tool calls, purchases, or revenue)
- **MCP.Directory:** ${report.acquisition?.mcp_directory?.status || "unavailable"} (${report.acquisition?.mcp_directory?.submission_recorded ? "free submission recorded from its HTTP 200 response" : "submission unavailable"}; ${report.acquisition?.mcp_directory?.listing_url || "https://mcp.directory/servers/bountyverdict"}; exact listing checks only, never search impressions, tool calls, purchases, or revenue)
- **VaultPlane skill directory:** ${report.acquisition?.vaultplane?.status || "unavailable"} (free submission ${report.acquisition?.vaultplane?.submission_id || "8ffee7a8-d33b-486f-8eae-9483db40d75b"}; ${report.acquisition?.vaultplane?.listing_url || "https://www.vaultplane.com/skills/bountyverdict-agent-decision-router"}; exact listing checks only, never search impressions, installs, tool calls, purchases, or revenue)
- **Tools for Agents:** ${report.acquisition?.tools_for_agents?.status || "unavailable"} (${report.acquisition?.tools_for_agents?.submission_recorded ? "free review submission recorded" : "submission unavailable"}; ${report.acquisition?.tools_for_agents?.listing_url || "https://www.toolsforagents.dev/tools/cristianmoroaica/bountyverdict"}; a generic route HTTP 200 is not counted as exposure)
- **MCP Server Spot:** ${report.acquisition?.mcp_server_spot?.status || "unavailable"} (${report.acquisition?.mcp_server_spot?.contract_verified ? "exact six-tool remote contract verified" : "publication or contract verification pending"}; ${report.acquisition?.mcp_server_spot?.listing_url || "https://www.mcpserverspot.com/servers/bountyverdict-agent-decision-tools"}; listing presence is not an impression, tool call, purchase, or revenue)
- **Cline in-agent marketplace:** ${report.acquisition?.cline_marketplace?.status || "unavailable"}; ${funnel.available ? `${Number(mcpClineMarketplace.initialize || 0)} source-marked initializations, ${Number(mcpClineMarketplace.tools_list || 0)} tool-list requests, ${Number(mcpClineMarketplace.validation_error || 0)} invalid calls, ${Number(mcpClineMarketplace.payment_required || 0)} valid unpaid calls, ${Number(mcpClineMarketplace.payment_present || 0)} payment presentations, ${Number(mcpClineMarketplace.paid_success || 0)} paid successes` : "funnel unavailable"} (MCP ${report.acquisition?.cline_marketplace?.url || "https://github.com/cline/marketplace/pull/16"}; routing skill https://github.com/cline/marketplace/pull/15; aggregate events, not installs, unique agents, purchases, or revenue)
- **Kilo in-agent marketplace:** ${report.acquisition?.kilo_marketplace?.status || "unavailable"}; ${funnel.available ? `${Number(mcpKiloMarketplace.initialize || 0)} source-marked initializations, ${Number(mcpKiloMarketplace.tools_list || 0)} tool-list requests, ${Number(mcpKiloMarketplace.validation_error || 0)} invalid calls, ${Number(mcpKiloMarketplace.payment_required || 0)} valid unpaid calls, ${Number(mcpKiloMarketplace.payment_present || 0)} payment presentations, ${Number(mcpKiloMarketplace.paid_success || 0)} paid successes` : "funnel unavailable"} (${report.acquisition?.kilo_marketplace?.url || "https://github.com/Kilo-Org/kilo-marketplace/pull/194"}; aggregate events, not installs, unique agents, purchases, or revenue)
- **Cursor direct install:** official source-marked MCP deeplink is public in the canonical guide; Marketplace submission is not pursued because its Publisher Terms conflict with the paid x402 service model; aggregate source events are ${funnel.available ? `${Number(mcpCursorDeeplink.initialize || 0)} initialize / ${Number(mcpCursorDeeplink.tools_list || 0)} tools/list` : "unavailable"}, never clicks, installs, unique agents, purchases, or revenue
- **Gemini CLI Extensions Gallery:** ${report.acquisition?.gemini_cli_gallery?.status || "unavailable"} (${report.acquisition?.gemini_cli_gallery?.url || "https://geminicli.com/extensions/"}; exact daily-catalog checks only, never an impression, install, tool call, purchase, or revenue)
- **GitHub Agent Finder:** ${report.acquisition?.agent_finder_catalog?.status || "unavailable"}; PR #10 ${report.acquisition?.agent_finder_catalog?.pr_status || "unknown"}; exact catalog ${report.acquisition?.agent_finder_catalog?.catalog_contract_verified ? "verified" : "pending"}; exact owner-run search ${report.acquisition?.agent_finder_catalog?.search_contract_verified ? `listed at rank ${report.acquisition.agent_finder_catalog.search_rank}` : "not indexed"} (${report.acquisition?.agent_finder_catalog?.url || "https://github.com/github/agentfinder-catalog/pull/10"}; PR, catalog, and search presence are distribution only, never an impression, install, tool call, purchase, or revenue)
- **Owner canary settlements excluded:** ${Number(report.revenue?.canary_transfer_count || 0)} (${money(report.revenue?.canary_usdc || 0)})
- **Unrelated incoming transfers:** ${Number(report.revenue?.unrelated_incoming_transfer_count || 0)}
- **Last refreshed:** ${report.checked_at}

Owner-funded launch proofs and every settlement from the dedicated owner canary payer are excluded from both customer revenue and profit. Unrelated incoming transfers remain separate from purchases. Wallet reserves are capital, not revenue. Profit is not a full fiat-accounting figure until the separately reported historic gas is converted and entered as a tracked USD cost.

## Current milestone

The seven-product suite is healthy in production and unattended GitHub-to-Cloudflare deployment is verified end to end. Six independently distributed non-SkillVerdict contracts are exposed as paid MCP tools through one stateless Streamable HTTP endpoint and listed in the official MCP Registry as \`${MCP_REGISTRY_NAME}@${MCP_REGISTRY_VERSION}\`. The endpoint accepts every protocol version supported by its pinned MCP SDK and records aggregate protocol failures without retaining requested versions. The origin-owned Agentic Resource Discovery catalog is ${report.acquisition?.ard_catalog?.live ? "live with six neutral semantic queries pointing to the existing MCP server" : report.acquisition?.ard_catalog?.status || "not yet live"}; this proves direct publication only, not third-party indexing. The general agent page provides the exact remote configuration and selection boundary, while the x402 manifest cross-links the MCP endpoint, well-known metadata, and official release. 1MCP retrieves the immutable entry, MCPProxy can query it directly, mcpub is ${mcpDownstreams.mcpub?.live_verified ? "live verified" : mcpDownstreams.mcpub?.listed ? "archive-only pending a standards-compatible hosted crawl" : "not registered"}, AgentNDX is ${report.acquisition?.agentndx?.status || "unavailable"}, MCPRepository is ${report.acquisition?.mcp_repository?.status || "unavailable"}, MCP.Directory is ${report.acquisition?.mcp_directory?.status || "unavailable"}, Cline's in-agent marketplace is ${report.acquisition?.cline_marketplace?.status || "unavailable"}, Kilo's in-agent marketplace is ${report.acquisition?.kilo_marketplace?.status || "unavailable"}, Gemini CLI's gallery is ${report.acquisition?.gemini_cli_gallery?.status || "unavailable"}, and MCP Observatory has ${report.acquisition?.mcp_observatory?.status === "repository_metadata_only" ? "indexed repository metadata without the live endpoint or tool schemas" : report.acquisition?.mcp_observatory?.status || "not been observed"}; scheduled Qt Creator and Glama propagation remains pending. A crawlable GitHub Actions diagnosis page supplies a narrower root-cause-versus-retry intent surface. These are distribution and catalog-validation facts, not impressions, installs, or purchases. SkillVerdict remains excluded while its earned-placement experiment is frozen. Privacy-safe edge capture distinguishes both REST and MCP discovery, validation, capacity rejection, challenge, payment-presentation, and success stages, identifies known crawlers when their signature is available, and reduces declared initialize client names to an allowlisted family before discarding the original name and version. Distribution is the sole product milestone: no eighth tool will be built until ten genuine purchases have been recognized from external payers.

## What is next

1. Keep the SkillVerdict earned-placement experiment isolated through its seven-day exposure window; do not change price or positioning mid-test.
2. Monitor Smithery's public listing and downstream buyer-candidate funnel for tool selection or payment presentation. Keep its publication and crawler traffic separate from genuine demand, purchases, and revenue.
3. Monitor ToolHive PR #1388 for workflow approval, automated checks, review, and catalog merge. Respond only to concrete technical feedback; do not treat a PR, check, merge, or catalog view as buyer demand or revenue.
4. Let the single armed MCPDrift owner canary run only when the weekly timer and spend guard allow it, then perform one bounded CDP/Agentic Market propagation check. Keep that settlement labeled owner indexing cost, never customer demand, purchase, or revenue. Separately measure whether agents discover the official MCP Registry entry, ARD catalog, general remote-MCP handoff, mcpub registration, AgentNDX listing, MCPRepository listing, Awesome MCP Servers entry, TensorBlock MCP Index, Agentage directory, Docker MCP Registry, MCPServers.org entry, MCP.Directory entry, Cline or Kilo in-agent marketplace entry, Gemini CLI extension, GitHub Agent Finder entry, ToolHive entry, or GitHub Actions intent page; then call \`tools/list\`, select a specific tool, and present payment. Do not confuse registry presence, crawler verification, or owner checks with buyer demand.
5. Monitor the live askill, Agent-Skills.md, and MCP Server Spot entries, AgentSkills.in submission #23, SkillsMD receipt e68e968f-d03d-4808-b36b-5fd3b42b6489, VaultPlane receipt 8ffee7a8-d33b-486f-8eae-9483db40d75b, Tools for Agents review, and their exact indexing, plus AgentNDX review, TensorBlock issue/PR/catalog activation, Agentage official-registry ingestion, Docker MCP Registry PR/catalog activation, MCPServers.org submission 4842, MCP.Directory review, Cline and Kilo marketplace PR/catalog activation, Gemini CLI's daily gallery crawl, GitHub Agent Finder PR #10/catalog/search activation, GitHub Skill, AgentTool, AgentSkill, Agent Plugins PR/catalog activation, and skills.sh indexing; keep retries bounded and do not generate fake install telemetry.
6. Monitor the six signed the402 listings, six NEAR services, six PayanAgent offers, Agent402 listing and unbranded retrieval, all seven x402scan routes, six 402 Index listings, x402gle synthesized skills, Monetize Your Agent and 402directory reviews, Agentic Market's automatic mirror, null-tolerant exact-match buyer-request feed, edge challenges, and exact receipt attribution.
7. Use the neutral buyer-query benchmark and edge funnel—not best-case phrase ranks—to decide the next distribution change after the frozen experiment. Do not build an eighth product before ten external purchases are recognized.
8. Keep minia2a CAPTCHA and gas tasks, BountyBook claims, and Tollbooth verification retries closed until a fresh audit removes their exact authorization, settlement, or x402-v2 compatibility blocker. Never infer revenue from escrow, a verifier's prepared payment, an API verified label, or a platform aggregate payout counter.

## Production health

- API: ${report.production_api}
- Payment/network: Base mainnet USDC, exact x402 v2
- Functional canary: ${report.functional?.healthy === true ? "healthy" : "unhealthy or stale"}
- Latest functional pass: ${report.functional?.checked_at || "unavailable"}
- Products checked: ${Array.isArray(report.functional?.products_checked) ? report.functional.products_checked.join(", ") : "unavailable"}
- Monitor errors:
${errors}

## Products and distribution

| Product | Price | Buyer queries found | Median found rank | Worst result | CDP cache | Agentic Market |
|---|---:|---:|---:|---:|---|---|
${EXPECTED_PRODUCTS.map((product) => {
  const result = buyerQueryBenchmark[product] || {};
  const name = PRODUCT_CATALOG[product].service;
  const median = result.median_found_rank !== null && result.median_found_rank !== undefined &&
      Number.isFinite(Number(result.median_found_rank))
    ? `#${Number(result.median_found_rank).toFixed(Number(result.median_found_rank) % 1 ? 1 : 0)}`
    : "not found";
  const worst = result.worst_result === "not_found" ? "not found" : Number.isFinite(Number(result.worst_result)) ? `#${result.worst_result}` : "not found";
  const quality = cdpMerchantQuality[product] || {};
  const cdpStatus = indexed[product]
    ? (quality.resource
      ? (quality.quality_available === false
        ? "indexed; quality counters pending"
        : `indexed; ${Number(quality.reported_calls_30d || 0)} calls / ${Number(quality.reported_unique_payers_30d || 0)} payers`)
      : "indexed; baseline pending")
    : "pending";
  return `| ${name} | ${PRODUCT_CATALOG[product].priceUsd} | ${Number(result.found_queries || 0)} / ${Number(result.query_count || 2)} | ${median} | ${worst} | ${cdpStatus} | ${agenticIndexed[product] ? "indexed" : "pending"} |`;
}).join("\n")}

The buyer-query benchmark uses two task descriptions per product: eight untouched blind-agent outputs and six balanced controls. It is a synthetic retrieval robustness test, not evidence of actual query volume; the exact phrases and ranks are retained in the machine-readable monitor state.

### Exact buyer-query benchmark

${EXPECTED_PRODUCTS.map((product) => {
  const result = buyerQueryBenchmark[product] || {};
  const queries = Array.isArray(result.queries) ? result.queries : [];
  return `- **${PRODUCT_CATALOG[product].service}:** ${queries.length
    ? queries.map(({ query, rank }: { query?: unknown; rank?: unknown }) =>
        `\`${String(query || "unavailable")}\` → ${rank !== null && rank !== undefined && Number.isFinite(Number(rank)) ? `#${Number(rank)}` : "not found"}`
      ).join("; ")
    : "unavailable"}`;
}).join("\n")}

## Acquisition funnel

- GitHub repository traffic: ${githubTraffic.available ? `${Number(githubTraffic.views?.count || 0)} views (${Number(githubTraffic.views?.uniques || 0)} unique) and ${Number(githubTraffic.clones?.count || 0)} clones (${Number(githubTraffic.clones?.uniques || 0)} unique) in GitHub's rolling 14-day window` : `unavailable (${githubTraffic.error || "not captured"})`}
- GitHub top referrers: ${Array.isArray(githubTraffic.referrers) && githubTraffic.referrers.length ? githubTraffic.referrers.map(({ referrer, count, uniques }: Record<string, unknown>) => `${String(referrer)} (${Number(count)} / ${Number(uniques)} unique)`).join(", ") : "none reported"}
- GitHub popular paths: ${Array.isArray(githubTraffic.popular_paths) && githubTraffic.popular_paths.length ? githubTraffic.popular_paths.map(({ path, count, uniques }: Record<string, unknown>) => `${String(path)} (${Number(count)} / ${Number(uniques)} unique)`).join(", ") : "none reported"}
- skills.sh repository installs: ${Number.isFinite(Number(totalSkillInstalls)) ? Number(totalSkillInstalls) : "unavailable"}
- skills.sh search corpus: branded ${skillsShSearch.branded_found === true ? "found" : "not found"}; exact names ${Number(skillsShSearch.exact_found || 0)} / ${Number(skillsShSearch.exact_expected || 7)}; natural buyer queries ${Number(skillsShSearch.natural_found || 0)} / ${Number(skillsShSearch.natural_expected || 7)} (owner-run retrieval, never demand)
- Dedicated Skills.sh adapter: ${dedicatedSkillsSh.status || "unavailable"}; exact search ${dedicatedSkillsShSearch.exact_found === true ? `found at rank ${dedicatedSkillsShSearch.exact_rank}` : "not found"}; natural buyer queries ${Number(dedicatedSkillsShSearch.natural_found || 0)} / ${Number(dedicatedSkillsShSearch.natural_expected || ASKILL_BUYER_QUERIES.length)} (${dedicatedSkillsSh.indexing_request?.issue_url || "https://github.com/vercel-labs/skills/issues/1754"}; request and owner-run retrieval are never demand or revenue)
- Awesome Skills adapter: ${awesomeSkills.status || "unavailable"}; contract ${awesomeSkills.contract_verified ? "verified" : "not verified"}; ${Number(awesomeSkills.listed_tools || 0)} / ${Number(awesomeSkills.expected_tools || 6)} tools (${awesomeSkills.url || "https://www.awesomeskills.dev/en/skill/bountyverdict-mcp-skill-route-github-agent-decisions"}; submission and listing presence are never demand or revenue)
- Router installs: ${Number(skillInstalls["route-github-agent-checks"] || 0)}
- SkillVerdict workflow installs: ${Number(skillInstalls["preflight-agent-skills"] || 0)}
- AgentTool: ${report.acquisition?.agenttool?.status || (report.acquisition?.agenttool?.listed ? "listed" : "unavailable")}
- MCPRepository: ${report.acquisition?.mcp_repository?.status || "unavailable"} (${report.acquisition?.mcp_repository?.url || "submission not recorded"}; catalog presence is not demand or revenue)
- AgentNDX MCP/x402 registry: ${report.acquisition?.agentndx?.status || "unavailable"}; ${report.acquisition?.agentndx?.indexed_servers ?? "unavailable"} servers in the free index (${report.acquisition?.agentndx?.url || "submission not recorded"}; placement is not demand or revenue)
- MCP Observatory: ${report.acquisition?.mcp_observatory?.status || "unavailable"}; releases ${Array.isArray(report.acquisition?.mcp_observatory?.release_versions) ? report.acquisition.mcp_observatory.release_versions.join(", ") : "unavailable"} (${report.acquisition?.mcp_observatory?.url || "not observed"}; repository indexing is not demand or revenue)
- MCPub crawler compatibility PR: ${report.acquisition?.mcpub_crawler_pr?.status || "unavailable"} (${report.acquisition?.mcpub_crawler_pr?.url || "https://github.com/roverbird/mcpub/pull/4"}; review and deployment are not reach or revenue)
- AgentSkill: ${report.acquisition?.agentskill?.listed_skills ?? 0} / 7 publicly indexed; ${report.acquisition?.agentskill?.status || "unavailable"}; ${report.acquisition?.agentskill?.total_installs ?? 0} installs and ${report.acquisition?.agentskill?.total_ratings ?? 0} ratings retained with per-skill security/quality history (never purchases)
- AgentSkills.in adapter: ${report.acquisition?.agent_skills_in?.listed_skills ?? 0} / 1 exact skill listed; ${report.acquisition?.agent_skills_in?.status || "unavailable"}; submission ${report.acquisition?.agent_skills_in?.submission?.issue_number ?? 23} ${report.acquisition?.agent_skills_in?.submission?.issue_state || "pending audited refresh"} (${report.acquisition?.agent_skills_in?.url || "https://github.com/Karanjot786/agent-skills-cli/issues/23"}; listing presence is not an install, impression, tool call, purchase, or revenue)
- SkillsMD adapter: ${report.acquisition?.skills_md?.listed_skills ?? 0} / 1 exact skill listed; ${report.acquisition?.skills_md?.status || "unavailable"}; ${Number(report.acquisition?.skills_md?.installs || 0)} public installs; submission ${report.acquisition?.skills_md?.submission?.id || "e68e968f-d03d-4808-b36b-5fd3b42b6489"} (${report.acquisition?.skills_md?.url || "https://skillsmd.dev/"}; submission, catalog presence, and install counters are not impressions, tool calls, purchases, or revenue)
- askill adapter: ${report.acquisition?.askill?.listed_skills ?? 0} / 1 exact skill listed; ${report.acquisition?.askill?.status || "unavailable"}; task-first copy ${report.acquisition?.askill?.buyer_language_revision_live ? "live" : "pending"}; complete adapter revision ${report.acquisition?.askill?.adapter_revision_live ? "live" : "pending reindex"}; ${Number(report.acquisition?.askill?.favorites || 0)} public favorites; fixed unbranded retrieval ${Number(report.acquisition?.askill?.buyer_query_benchmark?.found_queries || 0)} / ${Number(report.acquisition?.askill?.buyer_query_benchmark?.query_count || ASKILL_BUYER_QUERIES.length)} found and ${Number(report.acquisition?.askill?.buyer_query_benchmark?.top_three_queries || 0)} top-three (${report.acquisition?.askill?.url || "https://askill.sh/skills/703721"}; catalog presence, owner-run ranks, and favorites are not search volume, impressions, installs, tool calls, purchases, or revenue)
- Dedicated askill adapter: ${report.acquisition?.askill_dedicated?.listed_skills ?? 0} / 1 exact skill listed; ${report.acquisition?.askill_dedicated?.status || "unavailable"}; ${Number(report.acquisition?.askill_dedicated?.favorites || 0)} public favorites; fixed unbranded retrieval ${Number(report.acquisition?.askill_dedicated?.buyer_query_benchmark?.found_queries || 0)} / ${Number(report.acquisition?.askill_dedicated?.buyer_query_benchmark?.query_count || ASKILL_BUYER_QUERIES.length)} found and ${Number(report.acquisition?.askill_dedicated?.buyer_query_benchmark?.top_three_queries || 0)} top-three (${report.acquisition?.askill_dedicated?.url || "https://askill.sh/skills/703722"}; dedicated-account placement is measured separately from the frozen legacy experiment and is never purchase or revenue proof)
- Canonical askill skill suite: ${report.acquisition?.askill_main?.listed_skills ?? 0} / 7 exact skills listed; ${report.acquisition?.askill_main?.status || "unavailable"}; ${Number(report.acquisition?.askill_main?.favorites || 0)} public favorites; fixed unbranded retrieval ${Number(report.acquisition?.askill_main?.buyer_query_benchmark?.found_queries || 0)} / ${Number(report.acquisition?.askill_main?.buyer_query_benchmark?.query_count || ASKILL_BUYER_QUERIES.length)} found and ${Number(report.acquisition?.askill_main?.buyer_query_benchmark?.top_three_queries || 0)} top-three (${report.acquisition?.askill_main?.url || "https://askill.sh/"}; exact listing and owner-run ranks are not search volume, impressions, installs, calls, purchases, or revenue)
- Agent-Skills.md adapter: ${report.acquisition?.agent_skills_md?.status || "unavailable"}; exact task-first source and six-tool payment handoff ${report.acquisition?.agent_skills_md?.contract_verified ? "verified" : "pending"} (${report.acquisition?.agent_skills_md?.listing_url || "https://agent-skills.md/skills/Mimirs402/bountyverdict-mcp-skill/route-github-agent-decisions"}; anonymous submission and catalog presence are never impressions, installs, tool calls, purchases, or revenue)
- GitHub Skill release: ${report.acquisition?.github_skill?.release_verified ? report.acquisition.github_skill.release_tag : "unavailable"}; exact public discovery ${report.acquisition?.github_skill?.listed_skills ?? 0} / 7 (${report.acquisition?.github_skill?.status || "unavailable"}; owner-run retrieval, not impressions)
- Agent security directory PR: ${report.acquisition?.security_directory_pr?.status || "unavailable"} (${report.acquisition?.security_directory_pr?.url || "not recorded"})
- x402 ecosystem directory PR: ${report.acquisition?.x402_directory_pr?.status || "unavailable"} (${report.acquisition?.x402_directory_pr?.url || "not recorded"})
- Agent Plugins: ${report.acquisition?.agent_plugins_catalog?.listed_skills ?? 0} / 7 skills in the daily catalog; provider PR ${report.acquisition?.agent_plugins_pr?.status || "unavailable"} (${report.acquisition?.agent_plugins_pr?.url || "not recorded"}; catalog placement and quality metadata are not purchases)
- Awesome Copilot: ${report.acquisition?.awesome_copilot?.listed ? `listed at version ${report.acquisition.awesome_copilot.listed_version}` : report.acquisition?.awesome_copilot?.review_status || "unavailable"} (${report.acquisition?.awesome_copilot?.url || "not recorded"}; default-marketplace presence is not an impression, install, or purchase)
- LobeHub MCP marketplace: ${report.acquisition?.lobehub?.status || "pending_review"} (${report.acquisition?.lobehub?.url || "https://github.com/lobehub/lobehub/issues/17401"}; review and catalog presence are not impressions, tool calls, purchases, or revenue)
- Awesome MCP Servers: ${report.acquisition?.awesome_mcp_servers?.status || "unavailable"}; PR ${report.acquisition?.awesome_mcp_servers?.pr_status || "unknown"}; exact catalog contract ${report.acquisition?.awesome_mcp_servers?.contract_verified ? "verified" : "pending"} (${report.acquisition?.awesome_mcp_servers?.url || "https://github.com/punkpeye/awesome-mcp-servers/pull/10554"}; placement only, never an impression, tool call, purchase, or revenue)
- TensorBlock MCP Index: ${report.acquisition?.tensorblock_mcp_index?.status || "unavailable"}; PR ${report.acquisition?.tensorblock_mcp_index?.pr_status || "unknown"}; ${report.acquisition?.tensorblock_mcp_index?.indexed_servers ?? "unavailable"} indexed servers (${report.acquisition?.tensorblock_mcp_index?.pr_url || "https://github.com/TensorBlock/awesome-mcp-servers/pull/1312"}; catalog placement is never an impression, tool call, purchase, or revenue)
- Agentage MCP directory: ${report.acquisition?.agentage?.status || "unavailable"}; exact remote contract ${report.acquisition?.agentage?.contract_verified ? "verified" : "pending"} (${report.acquisition?.agentage?.directory_mcp || "https://catalog.agentage.io/mcp"}; owner-run record lookup is never an impression, tool call, purchase, or revenue)
- Docker MCP Registry: ${report.acquisition?.docker_mcp_registry?.status || "unavailable"}; PR ${report.acquisition?.docker_mcp_registry?.pr_status || "unknown"}; exact remote catalog contract ${report.acquisition?.docker_mcp_registry?.contract_verified ? "verified" : "pending"} (${report.acquisition?.docker_mcp_registry?.catalog_url || "https://hub.docker.com/mcp/server/bountyverdict/overview"}; catalog presence is never an impression, tool call, purchase, or revenue)
- MCPServers.org: ${report.acquisition?.mcp_servers_org?.status || "unavailable"}; receipt ${report.acquisition?.mcp_servers_org?.receipt_verified ? "verified" : "unavailable"}; exact listing ${report.acquisition?.mcp_servers_org?.listed ? "active" : "pending review"}; remote contract ${report.acquisition?.mcp_servers_org?.contract_verified ? "verified" : "not yet verified"} (${report.acquisition?.mcp_servers_org?.listing_url || "https://mcpservers.org/servers/cristianmoroaica/bountyverdict"}; exact-record checks only, never search impressions, tool calls, purchases, or revenue)
- MCP.Directory: ${report.acquisition?.mcp_directory?.status || "unavailable"}; submission ${report.acquisition?.mcp_directory?.submission_recorded ? "recorded from HTTP 200" : "unavailable"}; exact listing ${report.acquisition?.mcp_directory?.listed ? "active" : "pending review"}; remote metadata ${report.acquisition?.mcp_directory?.remote_metadata_verified ? "verified" : "not yet verified"} (${report.acquisition?.mcp_directory?.listing_url || "https://mcp.directory/servers/bountyverdict"}; exact-record checks only, never search impressions, tool calls, purchases, or revenue)
- VaultPlane skill directory: ${report.acquisition?.vaultplane?.status || "unavailable"}; receipt ${report.acquisition?.vaultplane?.submission_id || "8ffee7a8-d33b-486f-8eae-9483db40d75b"}; exact listing ${report.acquisition?.vaultplane?.listed ? "active" : "pending review"} (${report.acquisition?.vaultplane?.listing_url || "https://www.vaultplane.com/skills/bountyverdict-agent-decision-router"}; submission and placement are never impressions, installs, tool calls, purchases, or revenue)
- Tools for Agents: ${report.acquisition?.tools_for_agents?.status || "unavailable"}; exact listing ${report.acquisition?.tools_for_agents?.listed ? "active" : "pending review"} (${report.acquisition?.tools_for_agents?.listing_url || "https://www.toolsforagents.dev/tools/cristianmoroaica/bountyverdict"}; generic route resolution is never counted as exposure or demand)
- MCP Server Spot: ${report.acquisition?.mcp_server_spot?.status || "unavailable"}; exact six-tool remote contract ${report.acquisition?.mcp_server_spot?.contract_verified ? "verified" : "pending"} (${report.acquisition?.mcp_server_spot?.listing_url || "https://www.mcpserverspot.com/servers/bountyverdict-agent-decision-tools"}; catalog presence is never an impression, tool call, purchase, or revenue)
- Cline in-agent marketplace: ${report.acquisition?.cline_marketplace?.status || "unavailable"}; MCP PR ${report.acquisition?.cline_marketplace?.pr_status || "unknown"}; exact marketplace install/wizard contract ${report.acquisition?.cline_marketplace?.contract_verified ? "verified in the live catalog" : "pending catalog publication"} (${report.acquisition?.cline_marketplace?.url || "https://github.com/cline/marketplace/pull/16"}; routing skill PR https://github.com/cline/marketplace/pull/15; PR or catalog presence is never an impression, install, tool call, purchase, or revenue)
- Kilo in-agent marketplace: ${report.acquisition?.kilo_marketplace?.status || "unavailable"}; PR ${report.acquisition?.kilo_marketplace?.pr_status || "unknown"}; exact secret-free remote contract ${report.acquisition?.kilo_marketplace?.contract_verified ? "verified in the live catalog" : "pending catalog publication"} (${report.acquisition?.kilo_marketplace?.url || "https://github.com/Kilo-Org/kilo-marketplace/pull/194"}; PR or catalog presence is never an impression, install, tool call, purchase, or revenue)
- ToolHive in-agent catalog: ${report.acquisition?.toolhive?.status || "unavailable"}; PR ${report.acquisition?.toolhive?.pr_status || "unknown"}; exact six-tool remote contract ${report.acquisition?.toolhive?.contract_verified ? "verified in the live catalog" : "pending catalog publication"} (${report.acquisition?.toolhive?.url || "https://github.com/stacklok/toolhive-catalog/pull/1388"}; PR or catalog presence is never an impression, install, tool call, purchase, or revenue)
- Gemini CLI Extensions Gallery: ${report.acquisition?.gemini_cli_gallery?.status || "unavailable"}; exact remote MCP contract ${report.acquisition?.gemini_cli_gallery?.contract_verified ? "verified in the live catalog" : "pending the daily catalog crawl"} (${report.acquisition?.gemini_cli_gallery?.url || "https://geminicli.com/extensions/"}; catalog presence is never an impression, install, tool call, purchase, or revenue)
- GitHub Agent Finder: ${report.acquisition?.agent_finder_catalog?.status || "unavailable"}; PR #10 ${report.acquisition?.agent_finder_catalog?.pr_status || "unknown"}; exact PR ${report.acquisition?.agent_finder_catalog?.pr_contract_verified ? "verified" : "drifted or unavailable"}; Registry ${report.acquisition?.agent_finder_catalog?.registry_contract_verified ? `verified at ${report.acquisition.agent_finder_catalog.registry_version}` : "drifted or unavailable"}; exact catalog ${report.acquisition?.agent_finder_catalog?.catalog_contract_verified ? "verified" : "pending"}; exact owner-run search ${report.acquisition?.agent_finder_catalog?.search_contract_verified ? `listed at rank ${report.acquisition.agent_finder_catalog.search_rank}` : "not indexed"} (${report.acquisition?.agent_finder_catalog?.url || "https://github.com/github/agentfinder-catalog/pull/10"}; PR, catalog, and search presence are distribution only, never an impression, install, tool call, purchase, or revenue)
- Agent402 open router: ${report.acquisition?.agent402?.listed ? "listed" : "unavailable"}; exact-route retrieval ${report.acquisition?.agent402?.found_queries ?? 0} / ${report.acquisition?.agent402?.query_count ?? 7}, top-three ${report.acquisition?.agent402?.top_three_queries ?? 0} (${report.acquisition?.agent402?.listing_source || "unknown source"}; fixed owner-run queries are not impressions)
- x402Scout GET listings: ${report.acquisition?.x402scout?.listed_entries ?? "unavailable"} / ${report.acquisition?.x402scout?.expected_entries ?? 5} (${report.acquisition?.x402scout?.status || "unavailable"}; positions ${Array.isArray(report.acquisition?.x402scout?.catalog_positions) ? report.acquisition.x402scout.catalog_positions.join(", ") : "unavailable"} of ${report.acquisition?.x402scout?.catalog_entries ?? "unavailable"}; ${typeof report.acquisition?.x402scout?.total_query_count === "number" ? report.acquisition.x402scout.total_query_count : "unavailable"} catalog queries)
- x402scan paid endpoints: ${report.acquisition?.x402scan?.listed_resources ?? "unavailable"} / ${report.acquisition?.x402scan?.expected_resources ?? 7} (${report.acquisition?.x402scan?.status || "unavailable"}; registry presence is not counted as purchase activity)
- x402gle/OpenDexter synthesized skills: ${report.acquisition?.x402gle?.synthesized_skills ?? "unavailable"} / ${report.acquisition?.x402gle?.expected_products ?? 7} (${report.acquisition?.x402gle?.status || "unavailable"}; public host Skill and A2A card: ${report.acquisition?.x402gle?.listed ? "available" : "unavailable"})
- Agent Tools Cloud organic catalog: ${report.acquisition?.agent_tools_cloud?.listed_resources ?? 0} / ${report.acquisition?.agent_tools_cloud?.expected_resources ?? 7} direct resources (${report.acquisition?.agent_tools_cloud?.status || "unavailable"}; health ${report.acquisition?.agent_tools_cloud?.health || "unknown"}; x402 probe ${report.acquisition?.agent_tools_cloud?.x402_probe_status || "unknown"}); MCP ${report.acquisition?.agent_tools_cloud?.mcp?.listed_tools ?? 0} / ${report.acquisition?.agent_tools_cloud?.mcp?.expected_tools ?? 6} tools (${report.acquisition?.agent_tools_cloud?.mcp?.status || "unavailable"}; x402 ${report.acquisition?.agent_tools_cloud?.mcp?.x402_supported === true ? "verified" : "unverified"}; safety ${report.acquisition?.agent_tools_cloud?.mcp?.safety_verdict || "unknown"}); fixed owner-run task retrieval ${report.acquisition?.agent_tools_cloud?.buyer_query_benchmark?.found_queries ?? 0} / ${report.acquisition?.agent_tools_cloud?.buyer_query_benchmark?.query_count ?? 6} found and ${report.acquisition?.agent_tools_cloud?.buyer_query_benchmark?.top_three_queries ?? 0} top-three; presence and health are never purchases, and owner-run retrieval is not search volume, impressions, calls, purchases, or revenue
- Monetize Your Agent suite entry: ${report.acquisition?.monetize_your_agent?.status || "unavailable"} (submission ${report.acquisition?.monetize_your_agent?.submission_id ?? "unavailable"})
- 402directory endpoints: ${report.acquisition?.directory_402?.listed_endpoints ?? 0} / ${report.acquisition?.directory_402?.expected_endpoints ?? 7} (${report.acquisition?.directory_402?.status || "unavailable"}; seven review submissions are not purchases)
- 402 Index endpoints: ${report.acquisition?.index_402?.active_resources ?? 0} / ${report.acquisition?.index_402?.expected_resources ?? 6} (${report.acquisition?.index_402?.status || "unavailable"}; MCPDrift body-bound preflight is not probe-compatible)
- the402 listings: ${report.marketplaces?.the402?.service_count ?? "unavailable"} / 6 (${report.marketplaces?.the402?.webhook_healthy ? "signed webhook healthy" : "unavailable"}; SkillVerdict excluded during isolated experiment)
- the402 per-product service attempts: ${Object.entries(report.marketplaces?.the402?.service_outcomes || {}).map(([product, outcome]: [string, any]) => `${product} ${Number(outcome.total_jobs || 0)} total/${Number(outcome.failed_jobs || 0)} failed/${Number(outcome.disputed_jobs || 0)} disputed`).join("; ") || "unavailable"} (attempt telemetry only; settlements remain authoritative)
- NEAR Agent Market listings: ${report.marketplaces?.near?.service_count ?? "unavailable"} / 6 (automated JSON fulfillment; SkillVerdict excluded)
- PayanAgent offers: ${report.marketplaces?.payan?.offer_count ?? "unavailable"} / 6 (Base x402 proxy; SkillVerdict excluded); exact-fit request automation ${report.marketplaces?.payan?.demand_capture?.healthy ? "healthy" : "unavailable"}
- Agentic Market automatic endpoints: ${report.marketplaces?.agentic_market?.endpoint_count ?? "unavailable"} / 7 (CDP Bazaar mirror; reported quality counters excluded from purchase and revenue accounting)
- Edge funnel capture: ${funnel.available ? `${Number(funnel.trusted_external_402_challenges || 0)} trusted external challenges; ${Number(funnel.trusted_signed_payment_attempts || 0)} signed attempts in epoch ${Number(funnel.trusted_epoch_id || 1)} since ${funnel.trusted_capture_started_at || "the clean boundary"}; ${Number(funnel.external_402_challenges || 0)} older/lifetime external-or-unattributed challenges retained but excluded from rates` : "unavailable"} (aggregate HTTP telemetry only; onchain ledger remains authoritative)
- Buyer-candidate discovery capture: ${funnel.available ? `${Number(funnel.trusted_buyer_candidate_discovery_requests || 0)} trusted since the clean boundary; ${Number(funnel.buyer_candidate_discovery_requests || 0)} lifetime` : "unavailable"} (direct/hidden, marketplace, web/GitHub, and other non-health discovery retained; Agent402 OpenAPI/x402 health, owner automation, x402 observer, and registry crawlers excluded)
- Raw external discovery/health capture: ${funnel.available ? `${Number(funnel.trusted_external_discovery_requests || 0)} trusted raw external since the clean boundary; ${Number(funnel.external_discovery_requests || 0)} lifetime raw external` : "unavailable"} (directory health and buyer-candidate reach retained together for distribution visibility, never purchase proof)
- Trusted MCP buyer-candidate capture: ${funnel.available && trustedMcpAvailable ? `${Number(trustedMcpBuyerCandidate.initialize || 0)} initialize, ${Number(trustedMcpBuyerCandidate.tools_list || 0)} tools/list, ${Number(trustedMcpBuyerCandidate.protocol_error || 0)} protocol errors, ${Number(trustedMcpBuyerCandidate.tool_not_found || 0)} unknown-tool calls, ${Number(trustedMcpBuyerCandidate.validation_error || 0)} invalid calls, ${Number(trustedMcpBuyerCandidate.capacity_rejected || 0)} capacity rejections, ${Number(trustedMcpBuyerCandidate.payment_required || 0)} unpaid valid calls, ${Number(trustedMcpBuyerCandidate.payment_present || 0)} payment presentations, ${Number(trustedMcpBuyerCandidate.paid_success || 0)} paid successes, ${Number(trustedMcpBuyerCandidate.paid_error || 0)} paid errors` : `unavailable (${funnel.trusted_mcp_learning_stage || "no MCP epoch baseline"})`} (exact active-epoch deltas; owner, registry, Glama release, and x402 observer channels excluded)
- Lifetime MCP buyer-candidate capture: ${funnel.available ? `${Number(mcpBuyerCandidate.initialize || 0)} initialize, ${Number(mcpBuyerCandidate.tools_list || 0)} tools/list, ${Number(mcpBuyerCandidate.validation_error || 0)} invalid calls, ${Number(mcpBuyerCandidate.payment_required || 0)} unpaid valid calls, ${Number(mcpBuyerCandidate.payment_present || 0)} payment presentations, ${Number(mcpBuyerCandidate.paid_success || 0)} paid successes` : "unavailable"} (${funnel.mcp_learning_stage || "not started"}; retained for continuity, not an epoch conversion rate)
- MCP identified-directory capture: ${funnel.available ? `${Number(mcpRegistryCrawler.initialize || 0)} initialize, ${Number(mcpRegistryCrawler.tools_list || 0)} tools/list, ${Number(mcpRegistryCrawler.payment_required || 0)} unpaid valid calls, ${Number(mcpRegistryCrawler.payment_present || 0)} payment presentations` : "unavailable"} (distribution propagation retained separately from buyer-intent learning)
- Kiro Power declared-source capture: ${funnel.available ? `${Number(mcpKiroPower.initialize || 0)} initialize, ${Number(mcpKiroPower.tools_list || 0)} tools/list, ${Number(mcpKiroPower.payment_required || 0)} unpaid valid calls, ${Number(mcpKiroPower.payment_present || 0)} payment presentations` : "unavailable"} (allowlisted query marker only; never identity or purchase proof)
- AgentSkills.in adapter source capture: ${funnel.available ? `${Number(mcpAgentSkillsMarketplace.initialize || 0)} initialize, ${Number(mcpAgentSkillsMarketplace.tools_list || 0)} tools/list, ${Number(mcpAgentSkillsMarketplace.validation_error || 0)} invalid calls, ${Number(mcpAgentSkillsMarketplace.payment_required || 0)} unpaid valid calls, ${Number(mcpAgentSkillsMarketplace.payment_present || 0)} payment presentations, ${Number(mcpAgentSkillsMarketplace.paid_success || 0)} paid successes` : "unavailable"} (allowlisted aggregate marker only; not unique agents, purchases, or revenue)
- Cline marketplace source capture: ${funnel.available ? `${Number(mcpClineMarketplace.initialize || 0)} initialize, ${Number(mcpClineMarketplace.tools_list || 0)} tools/list, ${Number(mcpClineMarketplace.validation_error || 0)} invalid calls, ${Number(mcpClineMarketplace.payment_required || 0)} unpaid valid calls, ${Number(mcpClineMarketplace.payment_present || 0)} payment presentations, ${Number(mcpClineMarketplace.paid_success || 0)} paid successes` : "unavailable"} (allowlisted aggregate marker only; not an install, identity, unique agent, purchase, or revenue)
- Kilo marketplace source capture: ${funnel.available ? `${Number(mcpKiloMarketplace.initialize || 0)} initialize, ${Number(mcpKiloMarketplace.tools_list || 0)} tools/list, ${Number(mcpKiloMarketplace.validation_error || 0)} invalid calls, ${Number(mcpKiloMarketplace.payment_required || 0)} unpaid valid calls, ${Number(mcpKiloMarketplace.payment_present || 0)} payment presentations, ${Number(mcpKiloMarketplace.paid_success || 0)} paid successes` : "unavailable"} (allowlisted aggregate marker only; not an install, identity, unique agent, purchase, or revenue)
- Cursor deeplink source capture: ${funnel.available ? `${Number(mcpCursorDeeplink.initialize || 0)} initialize, ${Number(mcpCursorDeeplink.tools_list || 0)} tools/list, ${Number(mcpCursorDeeplink.validation_error || 0)} invalid calls, ${Number(mcpCursorDeeplink.payment_required || 0)} unpaid valid calls, ${Number(mcpCursorDeeplink.payment_present || 0)} payment presentations, ${Number(mcpCursorDeeplink.paid_success || 0)} paid successes` : "unavailable"} (allowlisted aggregate marker only; not a click, install, identity, unique agent, purchase, or revenue)
- OpenHands integrations source capture: ${funnel.available ? `${Number(mcpOpenHandsIntegrations.initialize || 0)} initialize, ${Number(mcpOpenHandsIntegrations.tools_list || 0)} tools/list, ${Number(mcpOpenHandsIntegrations.validation_error || 0)} invalid calls, ${Number(mcpOpenHandsIntegrations.payment_required || 0)} unpaid valid calls, ${Number(mcpOpenHandsIntegrations.payment_present || 0)} payment presentations, ${Number(mcpOpenHandsIntegrations.paid_success || 0)} paid successes` : "unavailable"} (allowlisted aggregate marker only; not a catalog impression, install, identity, unique agent, purchase, or revenue)
- Glama release source capture: ${funnel.available ? `${Number(mcpGlama.initialize || 0)} initialize, ${Number(mcpGlama.tools_list || 0)} tools/list, ${Number(mcpGlama.payment_required || 0)} unpaid valid calls, ${Number(mcpGlama.payment_present || 0)} payment presentations` : "unavailable"} (allowlisted aggregate marker only; not unique agents, purchases, or revenue)
- MCP initialize client families: ${activeMcpClientFamilies.length ? activeMcpClientFamilies.map(([family, counters]: [string, any]) => `${family} (${Number(counters.initialize || 0)})`).join(", ") : "none identified yet"} (allowlisted aggregates only; raw names and versions discarded)
- Raw external discovery surfaces observed: ${externalDiscoverySurfaces.length ? externalDiscoverySurfaces.map(([surface, count]) => `${surface} (${Number(count)})`).join(", ") : "none yet"} (includes directory health)
- Enhanced learning dimensions active since: ${funnel.enhanced_capture_started_at || "unavailable"}
- Cross-dimensional product/channel/input/payment cohorts active since: ${funnel.cohort_capture_started_at || "unavailable"}
- External channels observed: ${activeChannels.length ? activeChannels.map(([channel, counters]: [string, any]) => `${channel} (${Number(counters.requests || 0)})`).join(", ") : "none yet"}
- External client classes observed: ${activeClients.length ? activeClients.map(([client, counters]: [string, any]) => `${client} (${Number(counters.requests || 0)})`).join(", ") : "none yet"}
- Challenge → signed-attempt rate: ${funnel.challenge_to_signed_attempt_percent === null || funnel.challenge_to_signed_attempt_percent === undefined ? "not measurable yet" : `${funnel.challenge_to_signed_attempt_percent}%`}
- Signed-attempt → successful-response rate: ${funnel.signed_attempt_success_percent === null || funnel.signed_attempt_success_percent === undefined ? "not measurable yet" : `${funnel.signed_attempt_success_percent}%`}
- Current learning diagnosis: ${funnel.learning_stage || "unavailable"}

### Trusted external paid-route learning by product

| Product | Requests | 402 challenges | Signed attempts | Signed successes | Input rejections | Server errors |
|---|---:|---:|---:|---:|---:|---:|
${EXPECTED_PRODUCTS.map((product) => {
  const row = externalProductFunnel[product] || {};
  return `| ${PRODUCT_CATALOG[product].service} | ${Number(row.requests || 0)} | ${Number(row.challenges_402 || 0)} | ${Number(row.signed_requests || 0)} | ${Number(row.signed_successes || 0)} | ${Number(row.preflight_rejections || 0)} | ${Number(row.server_errors || 0)} |`;
}).join("\n")}

Input readiness, channel, client class, response preference, x402 header generation, hourly and daily trends, product×source aggregates, and coarse product×channel×client×input×payment×response cohorts are retained in the private machine-readable state. The immutable clean boundary excludes older owner-probe contamination from conversion rates without fabricating a retroactive attribution; lifetime totals remain available and explicitly labeled. No raw request content or visitor identifier is retained.

### Trusted active-epoch non-owner MCP tool-call activity by product

| Product | Valid unpaid calls | Invalid calls | Payment presented | Paid successes | Paid errors |
|---|---:|---:|---:|---:|---:|
${MCP_PRODUCTS.map((product) => {
  const row = trustedMcpAvailable ? funnel.trusted_mcp_external_by_product?.[product] || {} : {};
  return `| ${PRODUCT_CATALOG[product].service} | ${Number(row.payment_required || 0)} | ${Number(row.validation_error || 0)} | ${Number(row.payment_present || 0)} | ${Number(row.paid_success || 0)} | ${Number(row.paid_error || 0)} |`;
}).join("\n")}

The MCP product table is the exact active-epoch non-owner delta and remains zero/unavailable while a drain is active or a legacy baseline lacks MCP fields. MCP telemetry is aggregate and privacy-preserving: it retains only stage, product, coarse validation category, broad source/client/referral class, and bounded hour/day counts. Tool arguments, JSON-RPC payloads, payment payloads, payer addresses, IPs, and full user-agent strings are discarded. Onchain settlement attribution remains authoritative for purchases and revenue.
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
- PayanAgent request funnel: ${Number(payanDemand.exact_matches || 0)} exact fits, ${Number(payanDemand.tracked_requests || 0)} bids tracked, ${Number(payanDemand.accepted || 0)} accepted, ${Number(payanDemand.fulfilled || 0)} fulfilled, ${Number(payanDemand.approved || 0)} approved
- Clawlancer verified paid jobs: ${clawlancerPurchases}; onchain-verified worker revenue: ${money(clawlancerRevenueValue)} (${clawlancer.available ? `${String(clawlancer.status || "unknown").toUpperCase()} transaction ${clawlancer.transaction?.id || "unavailable"}` : "canary unavailable"})

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
let agenticMarket: Record<string, unknown> = {};
let clawlancer: Record<string, unknown> = {};
let funnel: Record<string, unknown> = {};
let previousReport: Record<string, any> = {};
try {
  previousReport = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, any>;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

try {
  const [root, sample, portfolioSample, harnessSample, skillSample, runSample, flakeSample, mcpDriftSample, x402Manifest, mcpMetadata, openapi, llms] = await Promise.all([
    requireStatus("/"),
    requireStatus("/api/sample"),
    requireStatus("/api/portfolio/sample"),
    requireStatus("/api/harness/sample"),
    requireStatus("/api/skill/sample"),
    requireStatus("/api/run/sample"),
    requireStatus("/api/flake/sample"),
    requireStatus("/api/mcp-drift/sample"),
    requireStatus("/.well-known/x402"),
    requireJsonObject("/.well-known/mcp.json"),
    requireStatus("/openapi.json"),
    requireStatus("/llms.txt"),
  ]);
  health = { root, sample, portfolio_sample: portfolioSample, harness_sample: harnessSample, skill_sample: skillSample, run_sample: runSample, flake_sample: flakeSample, mcp_drift_sample: mcpDriftSample, x402_manifest: x402Manifest, mcp_metadata: mcpMetadata, openapi, llms };
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

if (reportOnly) {
  try {
    discovery = {
      ...(previousReport.discovery || {}),
      ...await merchantDiscoveryStatus(previousReport.discovery || {}, checkedAt),
    };
  } catch (error) {
    discovery = previousReport.discovery || {};
    errors.push(`CDP merchant discovery: ${error instanceof Error ? error.message : String(error)}`);
  }
} else {
  try {
    discovery = await discoveryStatus(previousReport.discovery || {}, checkedAt);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
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

if (reportOnly) {
  acquisition = {
    ...acquisition,
    smithery: previousReport.acquisition?.smithery || {
      listed: false,
      checked_at: null,
      status: "awaiting_full_audited_retrieval",
    },
  };
} else {
  try {
    acquisition = {
      ...acquisition,
      smithery: await smitheryStatus(checkedAt),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    acquisition = { ...acquisition, smithery: { listed: false, checked_at: checkedAt, error: message } };
    errors.push(`Smithery: ${message}`);
  }
}

try {
  acquisition = {
    ...acquisition,
    mcp_registry: await mcpRegistryStatus(),
  };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  acquisition = { ...acquisition, mcp_registry: { listed: false, checked_at: checkedAt, error: message } };
  errors.push(`MCP Registry: ${message}`);
}

try {
  acquisition = {
    ...acquisition,
    mcp_intent_page: await mcpIntentPageStatus(),
  };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  acquisition = { ...acquisition, mcp_intent_page: { live: false, checked_at: checkedAt, error: message } };
  errors.push(`MCP intent page: ${message}`);
}

try {
  acquisition = {
    ...acquisition,
    mcp_downstreams: await mcpDownstreamStatus(previousReport.acquisition?.mcp_downstreams || {}),
  };
} catch (error) {
  acquisition = {
    ...acquisition,
    mcp_downstreams: {
      ...(previousReport.acquisition?.mcp_downstreams || {}),
      last_failed_at: checkedAt,
      last_error: error instanceof Error ? error.message : String(error),
    },
  };
}

try {
  acquisition = {
    ...acquisition,
    public_demand_watch: await publicDemandStatus(),
  };
} catch (error) {
  errors.push(`Public demand watcher: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  acquisition = {
    ...acquisition,
    github_traffic: await githubTrafficStatus(),
  };
} catch (error) {
  acquisition = {
    ...acquisition,
    github_traffic: {
      available: false,
      checked_at: checkedAt,
      error: error instanceof Error ? error.message : String(error),
      accounting_note: "Repository traffic is acquisition evidence only and is never counted as a purchase or revenue.",
    },
  };
}

if (reportOnly) {
  acquisition = {
    ...acquisition,
    marketplace_search: previousReport.acquisition?.marketplace_search || {},
  };
} else {
  try {
    acquisition = {
      ...acquisition,
      marketplace_search: await marketplaceSearchStatus(),
    };
  } catch (error) {
    acquisition = {
      ...acquisition,
      marketplace_search: {
        available: false,
        checked_at: checkedAt,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

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
      acquisition.agent_plugins_pr as Record<string, unknown>,
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

const agentToolsCloud = acquisition.agent_tools_cloud as Record<string, unknown> | null;
if (agentToolsCloud?.status === "contract_drift") {
  errors.push(`Agent Tools Cloud contract drift: ${String(agentToolsCloud.error || "identity, route, health, or payment metadata changed")}`);
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

if (reportOnly) {
  agenticMarket = previousReport.marketplaces?.agentic_market || {};
} else {
  try {
    agenticMarket = await agenticMarketStatus();
  } catch (error) {
    errors.push(`Agentic Market: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  clawlancer = await clawlancerWorkStatus();
} catch (error) {
  clawlancer = {
    available: false,
    checked_at: checkedAt,
    settled_jobs: 0,
    verified_worker_earnings_usdc: "0",
    error: error instanceof Error ? error.message : String(error),
    accounting_note: "Unavailable Clawlancer state is never counted as a paid job or revenue.",
  };
  errors.push(`Clawlancer canary: ${clawlancer.error}`);
}

if (clawlancer.available === true &&
  (clawlancer.transaction as Record<string, unknown> | undefined)?.state === "RELEASED" &&
  (clawlancer.onchain_evidence as Record<string, unknown> | undefined)?.verified !== true) {
  errors.push(`Clawlancer release verification: ${String((clawlancer.onchain_evidence as Record<string, unknown>)?.reason || "release is not onchain verified")}`);
}

funnel = await funnelStatus();

const taskmarketCommerce = (
  (acquisition.public_demand_watch as Record<string, any> | undefined)?.taskmarket?.tracked_worker || {}
) as Record<string, any>;

const report = {
  product: "BountyVerdict",
  checked_at: checkedAt,
  healthy: errors.length === 0,
  production_api: api,
  network: NETWORK,
  mode: reportOnly ? "report_only_without_semantic_retrieval" : "full_marketplace_retrieval_audit",
  revenue_wallet: wallet,
  health,
  discovery,
  revenue,
  marketplaces: { the402, near: nearMarket, payan, agentic_market: agenticMarket, clawlancer },
  commerce: {
    genuine_purchases: Number((revenue.purchases as Record<string, unknown> | undefined)?.total || 0) +
      Number(the402.completed_jobs || 0) + Number(the402.subscription_purchases || 0) +
      Number(nearMarket.completed_external_jobs || 0) +
      Number(taskmarketCommerce.settled_submissions || 0) +
      Number(clawlancer.settled_jobs || 0),
    customer_revenue_usdc: (
      Number(revenue.recognized_usdc || 0) + Number(the402.settled_usd || 0) +
      Number(nearMarket.earned_usdc_balance || 0) +
      Number(taskmarketCommerce.settled_worker_earnings_usdc || 0) +
      Number(clawlancer.verified_worker_earnings_usdc || 0)
    ).toFixed(6).replace(/\.?0+$/, ""),
    tracked_costs_usdc: trackedCostsInput,
  },
  functional,
  acquisition,
  funnel,
  errors,
};

await atomicWrite(stateFile, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(monitorNoteFile, renderMonitorNote(report));
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
