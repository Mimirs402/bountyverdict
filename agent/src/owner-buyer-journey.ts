import { createHash } from "node:crypto";
import { MCP_FREE_SELECTION_OUTPUT_SCHEMA, MCP_SUCCESS_OUTPUT_SCHEMAS } from "./mcp-output-contracts.ts";
import { mcpDriftExampleInput } from "./mcp-drift-discovery.ts";
import { MCP_HTTP_PAYMENT_HANDOFF_EXTENSION } from "./payment-handoff.ts";
import { validatePaymentChallenge } from "./payment-safety.ts";
import { FREE_SELECTION_ROUTER_EXPERIMENT_ID } from "./task-leading-description-experiment.ts";

export const OWNER_BUYER_JOURNEY_SCHEMA_VERSION = 2 as const;
export const OWNER_BUYER_JOURNEY_QUERY =
  "did this MCP server change its tool schemas in a breaking way";
export const OWNER_BUYER_JOURNEY_ORIGIN =
  "https://bountyverdict-agent-production.mimirslab.workers.dev";
export const OWNER_BUYER_JOURNEY_MCP_URL = `${OWNER_BUYER_JOURNEY_ORIGIN}/mcp`;
export const OWNER_BUYER_JOURNEY_RESOURCE_URL =
  `${OWNER_BUYER_JOURNEY_ORIGIN}/api/mcp-drift`;
export const OWNER_BUYER_JOURNEY_PAY_TO =
  "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
export const OWNER_BUYER_JOURNEY_ASSET =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const OWNER_BUYER_JOURNEY_NETWORK = "eip155:8453";
export const OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC = "20000";
export const OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH = 57;
export const OWNER_BUYER_JOURNEY_RELEASE_COMMIT =
  "88d51f7f6c76151e94daeaca5f3d5a576623ec5e";
export const OWNER_BUYER_JOURNEY_USER_AGENT =
  "bountyverdict-owner-audit/1.0";
export const OWNER_BUYER_JOURNEY_INPUT = mcpDriftExampleInput;

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function fullCommit(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a full lowercase commit.`);
  }
  return value;
}

export function validateOwnerJourneyPrerequisite(
  reportValue: unknown,
  ledgerValue: unknown,
): {
  reportCheckedAt: string;
  boundaryObservedAt: string;
  eligibleToolsList: number;
  productionActivationCommit: string;
  productionActivatedAt: string;
} {
  const report = record(reportValue, "Distribution report");
  const reportCheckedAt = canonicalTimestamp(report.checked_at, "Distribution report checked_at");
  if (report.mode !== "report_only_without_semantic_retrieval") {
    throw new Error("Owner journey requires a report-only distribution checkpoint.");
  }
  const funnel = record(report.funnel, "Distribution report funnel");
  const experiment = record(
    funnel.mcp_free_selection_router_experiment,
    "Free selection router experiment",
  );
  const activation = record(experiment.activation, "Free selection router activation");
  const boundary = record(experiment.boundary, "Free selection router boundary");
  const eligible = record(boundary.eligible_delta, "Free selection router boundary delta");

  if (
    experiment.id !== FREE_SELECTION_ROUTER_EXPERIMENT_ID ||
    experiment.status !== "completed" ||
    experiment.activation_verified !== true ||
    experiment.measurement_epoch_id !== OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH ||
    experiment.target_tools_list !== 25 ||
    experiment.remaining_eligible_tools_list !== 0 ||
    boundary.measurement_epoch_id !== OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH ||
    boundary.observation_rule !==
      "first_monitor_report_at_or_above_25_eligible_free_selection_router_tools_list_events" ||
    boundary.causal_copy_claim !== false ||
    !Number.isSafeInteger(eligible.tools_list) ||
    eligible.tools_list < 25
  ) {
    throw new Error("Free selection router experiment has not frozen its exact N=25 boundary.");
  }
  if (
    activation.experiment_id !== FREE_SELECTION_ROUTER_EXPERIMENT_ID ||
    activation.release_commit !== OWNER_BUYER_JOURNEY_RELEASE_COMMIT ||
    activation.measurement_epoch_id !== OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH ||
    activation.target_tools_list !== 25
  ) {
    throw new Error("Free selection router activation does not match the reviewed release.");
  }
  const productionActivationCommit = fullCommit(
    activation.production_activation_commit,
    "Production activation commit",
  );
  const productionActivatedAt = canonicalTimestamp(
    activation.production_activated_at,
    "Production activation timestamp",
  );
  const boundaryObservedAt = canonicalTimestamp(
    boundary.observed_at,
    "Free selection router boundary observed_at",
  );
  if (
    Date.parse(boundaryObservedAt) < Date.parse(productionActivatedAt) ||
    Date.parse(reportCheckedAt) < Date.parse(boundaryObservedAt)
  ) {
    throw new Error("Free selection router boundary timestamps are inconsistent.");
  }

  const ledger = record(ledgerValue, "Trusted funnel ledger");
  if (
    ledger.schema_version !== 2 ||
    ledger.active_epoch_id !== OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH ||
    !Array.isArray(ledger.epochs)
  ) {
    throw new Error("Trusted funnel ledger is not on the frozen measurement epoch.");
  }
  const epoch = record(
    ledger.epochs.find((candidate: Record<string, unknown>) =>
      candidate?.id === OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH),
    "Frozen measurement epoch",
  );
  if (epoch.status !== "active" || epoch.conversion_eligible !== true) {
    throw new Error("Frozen measurement epoch is not the current clean eligible epoch.");
  }

  return {
    reportCheckedAt,
    boundaryObservedAt,
    eligibleToolsList: Number(eligible.tools_list),
    productionActivationCommit,
    productionActivatedAt,
  };
}

function canonicalResource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      url.protocol !== "https:"
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function selectNaturalBazaarMatch(value: unknown): {
  item: Record<string, unknown>;
  rank: number;
  resultCount: number;
} | null {
  const result = record(value, "Bazaar search result");
  if (!Array.isArray(result.items) || result.items.length > 20) {
    throw new Error("Bazaar search result items are malformed.");
  }
  const expected = canonicalResource(OWNER_BUYER_JOURNEY_RESOURCE_URL);
  const matches = result.items.flatMap((candidate: unknown, index: number) => {
    const item = record(candidate, `Bazaar search result ${index + 1}`);
    return canonicalResource(item.resource) === expected
      ? [{ item: item as Record<string, unknown>, rank: index + 1 }]
      : [];
  });
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new Error("Bazaar search returned more than one canonical MCP drift resource.");
  }
  const { item, rank } = matches[0];
  const amount = String(item.maxAmountRequired ?? item.amount ?? "");
  const scheme = String(item.scheme ?? "");
  const network = String(item.network ?? "");
  if (
    amount !== OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC ||
    scheme !== "exact" ||
    (network !== "base" && network !== OWNER_BUYER_JOURNEY_NETWORK)
  ) {
    throw new Error("Natural Bazaar match does not advertise the exact bounded Base price.");
  }
  return { item, rank, resultCount: result.items.length };
}

export function validateOwnerSelectorResult(value: unknown): Record<string, any> {
  const candidate = record(value, "Free selector result");
  const { product_key: productKey, ...declaredOutput } = candidate;
  const parsed = MCP_FREE_SELECTION_OUTPUT_SCHEMA.parse(declaredOutput);
  const route = { ...parsed, product_key: productKey } as Record<string, any>;
  if (
    route.task !== "mcp_tools_change" ||
    route.product !== "MCPDriftVerdict" ||
    route.product_key !== "mcpdrift" ||
    route.total_price_usdc !== "0.02" ||
    route.next_call.tool_name !== "check_mcp_tool_drift" ||
    route.next_call.call_strategy !== "single_call" ||
    route.next_call.payment_required !== true ||
    route.next_call.authorization_required_before_settlement !== true ||
    route.next_call.preserve_arguments_on_retry !== true
  ) {
    throw new Error("Free selector did not route to the exact MCP drift paid call.");
  }
  return route;
}

export function normalizedOwnerJourneyBodyHash(): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(OWNER_BUYER_JOURNEY_INPUT))
    .digest("hex")}`;
}

export function validateOwnerMcpChallenge(value: unknown): {
  normalizedBodyHash: string;
  walletArgv: string[];
} {
  const challenge = record(value, "Unsigned MCP payment challenge");
  const requirement = validatePaymentChallenge(challenge, {
    maximumAtomic: BigInt(OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC),
    executePayment: false,
    allowMainnet: false,
  });
  if (
    challenge.resource?.url !== "mcp://tool/check_mcp_tool_drift" ||
    requirement.amount !== OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC ||
    requirement.network !== OWNER_BUYER_JOURNEY_NETWORK ||
    requirement.asset.toLowerCase() !== OWNER_BUYER_JOURNEY_ASSET.toLowerCase() ||
    requirement.payTo.toLowerCase() !== OWNER_BUYER_JOURNEY_PAY_TO.toLowerCase() ||
    challenge.extensions?.bazaar?.info?.input?.type !== "mcp" ||
    challenge.extensions?.bazaar?.info?.input?.toolName !== "check_mcp_tool_drift"
  ) {
    throw new Error("Unsigned MCP challenge does not match the selected paid tool.");
  }
  const handoff = record(
    challenge.extensions?.[MCP_HTTP_PAYMENT_HANDOFF_EXTENSION],
    "MCP HTTP payment handoff extension",
  );
  const info = record(handoff.info, "MCP HTTP payment handoff");
  const wallet = record(info.wallet_mcp, "MCP wallet handoff");
  const args = record(wallet.arguments, "MCP wallet handoff arguments");
  const payment = record(info.payment, "MCP handoff payment");
  const agenticWallet = record(payment.agentic_wallet, "Agentic Wallet handoff");
  const exactRequest = record(payment.exact_request, "MCP exact payment request");
  const expectedHash = normalizedOwnerJourneyBodyHash();
  if (
    info.version !== "2" ||
    wallet.tool_name !== "make_http_request_with_x402" ||
    wallet.execution_kind !== "equivalent_rest_request" ||
    args.baseURL !== OWNER_BUYER_JOURNEY_ORIGIN ||
    args.path !== "/api/mcp-drift" ||
    args.method !== "POST" ||
    args.maxAmountPerRequest !== Number(OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC) ||
    args.preferredNetwork !== "base" ||
    JSON.stringify(args.body) !== JSON.stringify(OWNER_BUYER_JOURNEY_INPUT) ||
    payment.max_amount_atomic !== OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC ||
    payment.network !== "Base" ||
    payment.asset !== "USDC" ||
    payment.charge_state !== "unsigned_not_charged" ||
    payment.authorization_scope !== "resource_url_not_post_body" ||
    exactRequest.method !== "POST" ||
    exactRequest.url !== OWNER_BUYER_JOURNEY_RESOURCE_URL ||
    exactRequest.normalized_body_sha256 !== expectedHash ||
    JSON.stringify(exactRequest.body) !== JSON.stringify(OWNER_BUYER_JOURNEY_INPUT) ||
    agenticWallet.executable !== "npx" ||
    !Array.isArray(agenticWallet.argv)
  ) {
    throw new Error("MCP HTTP handoff does not preserve the exact reviewed payment request.");
  }
  return { normalizedBodyHash: expectedHash, walletArgv: [...agenticWallet.argv] };
}

export function validateOwnerHttpChallenge(value: unknown): void {
  const challenge = record(value, "Unsigned HTTP payment challenge");
  const requirement = validatePaymentChallenge(challenge, {
    maximumAtomic: BigInt(OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC),
    executePayment: true,
    allowMainnet: true,
  });
  if (
    challenge.resource?.url !== OWNER_BUYER_JOURNEY_RESOURCE_URL ||
    challenge.resource?.serviceName !== "MCPDriftVerdict" ||
    requirement.amount !== OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC ||
    requirement.network !== OWNER_BUYER_JOURNEY_NETWORK ||
    requirement.asset.toLowerCase() !== OWNER_BUYER_JOURNEY_ASSET.toLowerCase() ||
    requirement.payTo.toLowerCase() !== OWNER_BUYER_JOURNEY_PAY_TO.toLowerCase() ||
    challenge.accepts?.[0]?.scheme !== "exact" ||
    challenge.extensions?.bazaar?.info?.input?.method !== "POST" ||
    challenge.extensions?.bazaar?.info?.input?.bodyType !== "json"
  ) {
    throw new Error("Unsigned HTTP challenge does not match the exact authorized purchase.");
  }
}

export function validateOwnerPaymentResult(value: unknown): {
  status: number;
  amountPaidAtomic: number;
  verdict: string;
  action: string;
  rulesetVersion: string;
  data: Record<string, unknown>;
} {
  const result = record(value, "Agentic Wallet payment result");
  const amountPaid = Number(result.amountPaid);
  if (
    result.paymentMade !== true ||
    result.status !== 200 ||
    !Number.isSafeInteger(amountPaid) ||
    amountPaid !== Number(OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC)
  ) {
    throw new Error("Agentic Wallet did not prove the exact successful bounded payment.");
  }
  const data = MCP_SUCCESS_OUTPUT_SCHEMAS.check_mcp_tool_drift.parse(result.data) as Record<string, unknown>;
  return {
    status: 200,
    amountPaidAtomic: amountPaid,
    verdict: String(data.verdict),
    action: String(data.action),
    rulesetVersion: String(data.ruleset_version),
    data,
  };
}
