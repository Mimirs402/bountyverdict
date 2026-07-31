import {
  MCP_HTTP_PAYMENT_HANDOFF_EXTENSION,
  PAYMENT_NEXT_ACTION,
} from "./payment-handoff.ts";

export const MCP_CANARY_KINDS = ["free_selector", "unsigned_paid_handoff_v2"] as const;
export type McpCanaryKind = typeof MCP_CANARY_KINDS[number];

const MCP_PATH = "/mcp";
const PROTOCOL_VERSION = "2025-11-25";
const PAID_TOOL = "diagnose_github_actions_run";
const PAID_ARGUMENTS = Object.freeze({
  run_url: "https://github.com/owner/repo/actions/runs/1",
});
const EXPECTED_AMOUNT = "40000";
const EXPECTED_PATH = "/api/github-actions-run-diagnosis";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type McpContractCheck = {
  kind: McpCanaryKind;
  ok: boolean;
  contract: "1.0";
  duration_ms: number;
  error?: string;
};

export type McpContractCanaryReport = {
  healthy: boolean;
  endpoint: string;
  server_version: string | null;
  worker_version_id: string | null;
  server_identity_error?: string;
  payment_or_signing_attempted: false;
  checks: McpContractCheck[];
};

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function record(value: unknown, label: string): Record<string, any> {
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value), `${label} is missing.`);
  return value as Record<string, any>;
}

async function callTool(
  origin: string,
  id: number,
  name: string,
  args: Record<string, unknown>,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ response: Response; payload: Record<string, any> }> {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    "User-Agent": "bountyverdict-owner-audit/1.0",
  };
  // This recurring proof is deliberately unsigned: it must never receive a
  // bearer credential, payment header, wallet tool, or signing capability.
  requireCondition(
    !Object.keys(headers).some((name) =>
      ["authorization", "payment-signature", "x-payment"].includes(name.toLowerCase())),
    "MCP canary request unexpectedly contains an authorization or payment header.",
  );
  const response = await fetchImpl(`${origin}${MCP_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  requireCondition(response.ok, `MCP ${name} returned HTTP ${response.status}.`);
  return { response, payload: record(await response.json(), `${name} JSON-RPC response`) };
}

async function readServerVersion(
  origin: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<string> {
  const response = await fetchImpl(`${origin}${MCP_PATH}`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      "User-Agent": "bountyverdict-owner-audit/1.0",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 900,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "bountyverdict-functional-canary", version: "1.0.0" },
      },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  requireCondition(response.ok, `MCP initialize returned HTTP ${response.status}.`);
  const payload = record(await response.json(), "MCP initialize response");
  requireCondition(payload.result?.serverInfo?.name === "BountyVerdict", "MCP initialize returned the wrong server identity.");
  const version = payload.result?.serverInfo?.version;
  requireCondition(
    typeof version === "string" && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version),
    "MCP initialize returned an invalid semantic version.",
  );
  return version;
}

async function checkFreeSelector(
  origin: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<void> {
  const { response, payload } = await callTool(
    origin,
    901,
    "choose_github_agent_decision",
    { task: "github_actions_root_cause" },
    fetchImpl,
    timeoutMs,
  );
  requireCondition(!response.headers.has("Payment-Required"), "Free selector unexpectedly returned Payment-Required.");
  const result = record(payload.result, "Free selector result");
  const route = record(result.structuredContent, "Free selector structuredContent");
  requireCondition(result.isError !== true, "Free selector returned an MCP error.");
  requireCondition(route.next_call?.tool_name === PAID_TOOL, "Free selector routed to the wrong paid tool.");
  requireCondition(route.selector_call_payment_required === false, "Free selector is no longer explicitly free.");
  requireCondition(!Object.hasOwn(route, "verdict"), "Free selector unexpectedly produced a paid verdict.");
  requireCondition(route.total_price_usdc === "0.04", "Free selector quote changed.");
  requireCondition(sameJson(route.next_call?.required_fields, ["run_url"]), "Free selector required fields changed.");
  requireCondition(route.next_call?.payment_required === true, "Free selector no longer marks the next call as paid.");
  requireCondition(
    route.next_call?.authorization_required_before_settlement === true,
    "Free selector no longer requires authorization before settlement.",
  );
  requireCondition(
    route.next_call?.unsigned_call_action === "inspect_quote_then_authorize_or_stop",
    "Free selector unsigned-call instruction changed.",
  );
  requireCondition(route.next_call?.preserve_arguments_on_retry === true, "Free selector retry binding changed.");
  const content = Array.isArray(result.content) ? result.content : [];
  const text = typeof content[0]?.text === "string" ? JSON.parse(content[0].text) : null;
  requireCondition(sameJson(text, route), "Free selector text and structured content diverged.");
  requireCondition(text?.accepts === undefined, "Free selector leaked a payment challenge.");
}

async function checkUnsignedPaidHandoff(
  origin: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<void> {
  const { payload } = await callTool(origin, 902, PAID_TOOL, PAID_ARGUMENTS, fetchImpl, timeoutMs);
  const result = record(payload.result, "Unsigned paid result");
  requireCondition(result.isError === true, "Unsigned paid call did not stop at a challenge.");
  requireCondition(result.structuredContent === undefined, "Unsigned paid call exposed structured paid output.");
  const content = Array.isArray(result.content) ? result.content : [];
  requireCondition(content.length === 2, "Unsigned paid call did not return the canonical two-part handoff.");
  const challenge = typeof content[0]?.text === "string" ? JSON.parse(content[0].text) : null;
  requireCondition(/^PAYMENT REQUIRED:/.test(content[1]?.text || ""), "Unsigned paid call lacks the plain payment instruction.");
  requireCondition(/explicit authorization/.test(content[1]?.text || ""), "Unsigned paid call lacks explicit-authorization guidance.");
  requireCondition(/otherwise stop/.test(content[1]?.text || ""), "Unsigned paid call lacks a stop condition.");
  requireCondition(challenge?.accepts?.[0]?.amount === EXPECTED_AMOUNT, "Unsigned paid amount changed.");
  requireCondition(challenge?.accepts?.[0]?.network === "eip155:8453", "Unsigned paid network changed.");
  requireCondition(challenge?.resource?.url === `mcp://tool/${PAID_TOOL}`, "Unsigned paid resource identity changed.");
  requireCondition(challenge?.extensions?.bazaar?.info?.input?.toolName === PAID_TOOL, "Bazaar tool identity changed.");

  const handoff = record(
    challenge?.extensions?.[MCP_HTTP_PAYMENT_HANDOFF_EXTENSION]?.info,
    "Canonical HTTP payment handoff",
  );
  const payment = record(handoff.payment, "Canonical payment object");
  const walletMcp = record(handoff.wallet_mcp, "Canonical wallet MCP handoff");
  requireCondition(handoff.version === "2", "HTTP payment handoff is not version 2.");
  requireCondition(
    handoff.direct_mcp?.automatic_payment_requires === "@x402/mcp",
    "Direct MCP automatic-payment requirement changed.",
  );
  requireCondition(walletMcp.tool_name === "make_http_request_with_x402", "Wallet MCP tool changed.");
  requireCondition(walletMcp.execution_kind === "equivalent_rest_request", "Wallet MCP execution kind changed.");
  requireCondition(sameJson(walletMcp, payment.coinbase_wallet_mcp), "Wallet MCP aliases diverged.");
  requireCondition(payment.charge_state === "unsigned_not_charged", "Unsigned payment charge state changed.");
  requireCondition(payment.next_action === PAYMENT_NEXT_ACTION, "Unsigned payment next action changed.");
  requireCondition(payment.inspect_challenge_before_signing === true, "Challenge inspection guard changed.");
  requireCondition(payment.max_amount_atomic === EXPECTED_AMOUNT, "Payment cap changed.");
  requireCondition(payment.exact_request?.method === "POST", "Exact paid request method changed.");
  requireCondition(sameJson(payment.exact_request?.body, PAID_ARGUMENTS), "Exact paid request body changed.");
  const expectedHashBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(PAID_ARGUMENTS)),
  );
  const expectedHash = `sha256:${[...new Uint8Array(expectedHashBytes)]
    .map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  requireCondition(payment.exact_request?.normalized_body_sha256 === expectedHash, "Exact paid request body hash changed.");
  requireCondition(payment.authorization_scope === "resource_url_not_post_body", "POST authorization scope changed.");

  const exactUrl = new URL(payment.exact_request?.url || "invalid:");
  requireCondition(exactUrl.origin === origin && exactUrl.pathname === EXPECTED_PATH, "Exact paid request URL changed.");
  requireCondition(walletMcp.arguments?.baseURL === origin, "Wallet MCP origin changed.");
  requireCondition(walletMcp.arguments?.path === EXPECTED_PATH, "Wallet MCP path changed.");
  requireCondition(walletMcp.arguments?.method === "POST", "Wallet MCP method changed.");
  requireCondition(sameJson(walletMcp.arguments?.body, PAID_ARGUMENTS), "Wallet MCP body changed.");
  requireCondition(walletMcp.arguments?.maxAmountPerRequest === 40000, "Wallet MCP cap changed.");
  requireCondition(walletMcp.arguments?.preferredNetwork === "base", "Wallet MCP preferred network changed.");
  requireCondition(payment.agentic_wallet?.executable === "npx", "Agentic Wallet executable changed.");
  requireCondition(payment.agentic_wallet?.execute_as_argument_vector === true, "Agentic Wallet argv safety flag changed.");
  requireCondition(payment.agentic_wallet?.do_not_join_into_shell_string === true, "Agentic Wallet shell-safety flag changed.");
  const argv = payment.agentic_wallet?.argv;
  requireCondition(Array.isArray(argv), "Agentic Wallet argv is missing.");
  requireCondition(sameJson(argv, [
    "awal@2.12.0", "x402", "pay", `${origin}${EXPECTED_PATH}`,
    "-X", "POST", "-d", JSON.stringify(PAID_ARGUMENTS),
    "--max-amount", EXPECTED_AMOUNT, "--json",
  ]), "Agentic Wallet argv changed.");
  requireCondition(payment.retry_semantics?.transport === "rest_http", "Payment retry transport changed.");
  requireCondition(payment.retry_semantics?.reuse_exact_method_url_and_body === true, "Payment retry binding changed.");
  requireCondition(payment.retry_semantics?.payment_header === "Payment-Signature", "Payment retry header changed.");
  requireCondition(payment.retry_semantics?.expected_success_status === 200, "Payment success contract changed.");
  requireCondition(
    payment.retry_semantics?.never_raise_max_amount_without_new_authorization === true,
    "Payment cap reauthorization guard changed.",
  );
}

export async function runMcpContractCanary(
  origin: string,
  options: {
    fetch?: FetchLike;
    timeoutMs?: number;
    monotonic?: () => number;
    workerVersionOverride?: string;
  } = {},
): Promise<McpContractCanaryReport> {
  const normalizedOrigin = new URL(origin).origin;
  requireCondition(normalizedOrigin === origin, "MCP canary origin must be an exact origin.");
  const fetchImpl = options.fetch || fetch;
  const workerVersionOverride = options.workerVersionOverride;
  if (workerVersionOverride) {
    requireCondition(
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(workerVersionOverride),
      "MCP canary Worker version override must be a lowercase UUID.",
    );
  }
  const versionPinnedFetch: FetchLike = workerVersionOverride
    ? (input, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set(
          "Cloudflare-Workers-Version-Overrides",
          `bountyverdict-agent-production="${workerVersionOverride}"`,
        );
        return fetchImpl(input, { ...init, headers });
      }
    : fetchImpl;
  const timeoutMs = options.timeoutMs || 30_000;
  const monotonic = options.monotonic || (() => performance.now());
  let serverVersion: string | null = null;
  let serverIdentityError: string | undefined;
  try {
    serverVersion = await readServerVersion(origin, versionPinnedFetch, timeoutMs);
  } catch (error) {
    serverIdentityError = error instanceof Error ? error.message : String(error);
  }
  const definitions = [
    ["free_selector", checkFreeSelector],
    ["unsigned_paid_handoff_v2", checkUnsignedPaidHandoff],
  ] as const;
  const checks: McpContractCheck[] = [];
  for (const [kind, check] of definitions) {
    const started = monotonic();
    try {
      await check(origin, versionPinnedFetch, timeoutMs);
      checks.push({ kind, ok: true, contract: "1.0", duration_ms: Math.max(0, Math.round(monotonic() - started)) });
    } catch (error) {
      checks.push({
        kind,
        ok: false,
        contract: "1.0",
        duration_ms: Math.max(0, Math.round(monotonic() - started)),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    healthy: serverVersion !== null && checks.length === MCP_CANARY_KINDS.length && checks.every(({ ok }) => ok),
    endpoint: `${origin}${MCP_PATH}`,
    server_version: serverVersion,
    worker_version_id: workerVersionOverride || null,
    ...(serverIdentityError ? { server_identity_error: serverIdentityError } : {}),
    payment_or_signing_attempted: false,
    checks,
  };
}
