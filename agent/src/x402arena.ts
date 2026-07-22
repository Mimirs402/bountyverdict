export const X402_ARENA_BASE_URL = "https://core.x402arena.gg";
export const X402_ARENA_AGENT_ID = "runverdict-ci-diagnosis";
export const X402_ARENA_PRICE_USDC = 0.04;
export const X402_ARENA_LISTINGS = Object.freeze({
  "bountyverdict-eligibility": 0.05,
  "harnessverdict-agent-readiness": 0.03,
  "skillverdict-security-audit": 0.06,
  "runverdict-ci-diagnosis": 0.04,
  "flakeverdict-retry-gate": 0.07,
} as const);

export interface X402ArenaTelemetry {
  agentId: string;
  status: "active";
  priceUsdc: number;
  totalRevenue: number;
  organicRevenue: number;
  houseRevenue: number;
  queryCount: number;
  uniqueBuyers: number;
  lastEventAt: string;
}

function boundedNumber(value: unknown, label: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000 ||
    (integer && !Number.isSafeInteger(value))) {
    throw new Error(`x402 Arena returned an invalid ${label}.`);
  }
  return value;
}

export function parseX402ArenaTelemetry(
  value: unknown,
  expectedAgentId = X402_ARENA_AGENT_ID,
  expectedPriceUsdc = X402_ARENA_PRICE_USDC,
): X402ArenaTelemetry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("x402 Arena returned an invalid agents response.");
  }
  const agents = (value as Record<string, unknown>).agents;
  if (!Array.isArray(agents) || agents.length > 10_000) {
    throw new Error("x402 Arena returned an invalid agents list.");
  }
  const matches = agents.filter((entry) => entry && typeof entry === "object" &&
    !Array.isArray(entry) && (entry as Record<string, unknown>).agentId === expectedAgentId);
  if (matches.length !== 1) throw new Error("x402 Arena listing identity is missing or ambiguous.");
  const item = matches[0] as Record<string, unknown>;
  if (item.status !== "active") throw new Error("x402 Arena listing is not active.");
  const priceUsdc = boundedNumber(item.priceUsdc, "price");
  if (priceUsdc !== expectedPriceUsdc) throw new Error("x402 Arena listing price drifted.");
  if (typeof item.lastEventAt !== "string" || item.lastEventAt.length < 10 || item.lastEventAt.length > 64) {
    throw new Error("x402 Arena returned an invalid activity timestamp.");
  }
  return {
    agentId: expectedAgentId,
    status: "active",
    priceUsdc,
    totalRevenue: boundedNumber(item.totalRevenue, "total revenue"),
    organicRevenue: boundedNumber(item.organicRevenue, "organic revenue"),
    houseRevenue: boundedNumber(item.houseRevenue, "house revenue"),
    queryCount: boundedNumber(item.queryCount, "query count", true),
    uniqueBuyers: boundedNumber(item.uniqueBuyers, "unique buyer count", true),
    lastEventAt: item.lastEventAt,
  };
}
