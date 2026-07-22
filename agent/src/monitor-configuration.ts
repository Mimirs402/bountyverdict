export type DistributionMonitorConfiguration = Readonly<{
  productionApi: string;
  revenueWallet: string;
  startBlock: string;
  trackedCostsUsdc: string;
  settlementBuyerAddress: string;
  settlementCanaryEnabled: boolean;
  reportOnly: boolean;
  the402ApiKey: string;
  the402ParticipantId: string;
  nearMarketApiKey: string;
  nearMarketAgentId: string;
  payanApiKey: string;
  payanAgentId: string;
  payanOfferMap: string;
}>;

export const PRODUCTION_MONITOR_IDENTITY = Object.freeze({
  productionApi: "https://bountyverdict-agent-production.mimirslab.workers.dev",
  revenueWallet: "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
  startBlock: "48876000",
  trackedCostsUsdc: "1.012",
});

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function loadDistributionMonitorConfiguration(
  env: NodeJS.ProcessEnv,
): DistributionMonitorConfiguration {
  const invalid: string[] = [];
  let productionApi = "";
  try {
    const parsed = new URL(env.PRODUCTION_API_URL || "");
    if (parsed.protocol !== "https:" || parsed.origin !== env.PRODUCTION_API_URL ||
      parsed.origin !== PRODUCTION_MONITOR_IDENTITY.productionApi) throw new Error("not the production HTTPS origin");
    productionApi = parsed.origin;
  } catch {
    invalid.push("PRODUCTION_API_URL");
  }

  const revenueWallet = env.REVENUE_WALLET || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(revenueWallet) ||
    revenueWallet.toLowerCase() !== PRODUCTION_MONITOR_IDENTITY.revenueWallet.toLowerCase()) invalid.push("REVENUE_WALLET");
  const startBlock = env.START_BLOCK || "";
  if (startBlock !== PRODUCTION_MONITOR_IDENTITY.startBlock) invalid.push("START_BLOCK");
  const trackedCostsUsdc = env.TRACKED_COSTS_USDC || "";
  if (trackedCostsUsdc !== PRODUCTION_MONITOR_IDENTITY.trackedCostsUsdc) invalid.push("TRACKED_COSTS_USDC");
  const settlementBuyerAddress = env.SETTLEMENT_BUYER_ADDRESS || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(settlementBuyerAddress) ||
    settlementBuyerAddress.toLowerCase() === revenueWallet.toLowerCase()) {
    invalid.push("SETTLEMENT_BUYER_ADDRESS");
  }
  if (!new Set(["YES", "NO"]).has(env.SETTLEMENT_CANARY_ENABLED || "")) {
    invalid.push("SETTLEMENT_CANARY_ENABLED");
  }

  const requiredText = [
    "THE402_API_KEY",
    "THE402_PARTICIPANT_ID",
    "NEAR_MARKET_API_KEY",
    "NEAR_MARKET_AGENT_ID",
    "PAYAN_API_KEY",
    "PAYAN_AGENT_ID",
    "PAYAN_OFFER_MAP",
  ] as const;
  for (const name of requiredText) {
    if (!nonEmpty(env[name])) invalid.push(name);
  }
  if (invalid.length) {
    throw new Error(`Distribution monitor configuration is incomplete or invalid: ${[...new Set(invalid)].join(", ")}. Refusing to overwrite commerce state.`);
  }

  return {
    productionApi,
    revenueWallet,
    startBlock,
    trackedCostsUsdc,
    settlementBuyerAddress,
    settlementCanaryEnabled: env.SETTLEMENT_CANARY_ENABLED === "YES",
    reportOnly: env.REPORT_ONLY === "YES",
    the402ApiKey: env.THE402_API_KEY!,
    the402ParticipantId: env.THE402_PARTICIPANT_ID!,
    nearMarketApiKey: env.NEAR_MARKET_API_KEY!,
    nearMarketAgentId: env.NEAR_MARKET_AGENT_ID!,
    payanApiKey: env.PAYAN_API_KEY!,
    payanAgentId: env.PAYAN_AGENT_ID!,
    payanOfferMap: env.PAYAN_OFFER_MAP!,
  };
}
