import { FLAKE_SERVICE_REUSE } from "./flake.ts";
import { MCP_DRIFT_RULESET_VERSION, MCP_DRIFT_SERVICE_REUSE } from "./mcp-drift.ts";
import { mcpDriftExampleInput } from "./mcp-drift-discovery.ts";
import { PRODUCT_CATALOG } from "./product-catalog.ts";

export const SETTLEMENT_CANARY_ORIGIN =
  "https://bountyverdict-agent-production.mimirslab.workers.dev";
export const SETTLEMENT_CANARY_NETWORK = "eip155:8453";
export const SETTLEMENT_CANARY_ASSET =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const SETTLEMENT_CANARY_PAYEE =
  "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
export const SETTLEMENT_CANARY_USER_AGENT =
  "bountyverdict-settlement-canary/1.0";

export const SETTLEMENT_CANARY_PRODUCTS = [
  "single",
  "portfolio",
  "harness",
  "skill",
  "run",
  "flake",
  "mcpdrift",
] as const;

export type SettlementCanaryProduct = typeof SETTLEMENT_CANARY_PRODUCTS[number];
export type SettlementCanaryStatus =
  | "SETTLED"
  | "CONTRACT_FAILED"
  | "FAILED"
  | "AMBIGUOUS";

interface SettlementCanaryFixture {
  readonly product: SettlementCanaryProduct;
  readonly service: string;
  readonly amountAtomic: string;
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: string;
}

export interface SettlementPaymentAdapter {
  createPaymentPayload(paymentRequired: Record<string, unknown>): Promise<unknown>;
  encodePaymentHeaders(paymentPayload: unknown): Record<string, string>;
}

export interface SettlementCanaryResult {
  canary: "BountyVerdict real x402 settlement";
  version: "1.0";
  product: SettlementCanaryProduct;
  service: string;
  status: SettlementCanaryStatus;
  healthy: boolean;
  stage:
    | "challenge"
    | "authorization"
    | "paid_transport"
    | "settlement"
    | "contract"
    | "complete";
  error_code: string | null;
  attempted_at: string;
  completed_at: string;
  amount_atomic: string;
  network: typeof SETTLEMENT_CANARY_NETWORK;
  asset: typeof SETTLEMENT_CANARY_ASSET;
  payee: typeof SETTLEMENT_CANARY_PAYEE;
  resource: string;
  method: "GET" | "POST";
  payment_authorized: boolean;
  transaction_hash: string | null;
  contract_summary: Record<string, string | number | boolean | null> | null;
  requires_reconciliation: boolean;
}

interface RunSettlementCanaryOptions {
  product: SettlementCanaryProduct;
  payment: SettlementPaymentAdapter;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  onPaymentAuthorized?: (pending: SettlementCanaryResult) => Promise<void>;
}

class SettlementCanaryValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function fixtureUrl(
  path: string,
  parameters: readonly (readonly [string, string])[] = [],
): string {
  const url = new URL(path, SETTLEMENT_CANARY_ORIGIN);
  for (const [name, value] of parameters) url.searchParams.set(name, value);
  return url.href;
}

const FIXTURES: Readonly<Record<SettlementCanaryProduct, SettlementCanaryFixture>> =
  Object.freeze({
    single: Object.freeze({
      product: "single",
      service: "BountyVerdict",
      amountAtomic: "50000",
      method: "POST",
      url: fixtureUrl(PRODUCT_CATALOG.single.path),
      body: JSON.stringify({
        issue_url: "https://github.com/typeorm/typeorm/issues/3357",
      }),
    }),
    portfolio: Object.freeze({
      product: "portfolio",
      service: "BountyVerdict Portfolio",
      amountAtomic: "400000",
      method: "POST",
      url: fixtureUrl("/api/portfolio"),
      body: JSON.stringify({
        issue_urls: [
          "https://github.com/godotengine/godot/issues/70796",
          "https://github.com/typeorm/typeorm/issues/3357",
        ],
      }),
    }),
    harness: Object.freeze({
      product: "harness",
      service: "HarnessVerdict",
      amountAtomic: "30000",
      method: "POST",
      url: fixtureUrl(PRODUCT_CATALOG.harness.path),
      body: JSON.stringify({
        repo_url: "https://github.com/openai/codex",
      }),
    }),
    skill: Object.freeze({
      product: "skill",
      service: "SkillVerdict",
      amountAtomic: "60000",
      method: "GET",
      url: fixtureUrl("/api/skill", [
        ["repo_url", "https://github.com/Mimirs402/bountyverdict"],
        ["skill_path", "skills/diagnose-github-actions"],
      ]),
    }),
    run: Object.freeze({
      product: "run",
      service: "RunVerdict",
      amountAtomic: "40000",
      method: "POST",
      url: fixtureUrl(PRODUCT_CATALOG.run.path),
      body: JSON.stringify({
        run_url: "https://github.com/openai/codex/actions/runs/29728148711",
      }),
    }),
    flake: Object.freeze({
      product: "flake",
      service: "FlakeVerdict",
      amountAtomic: "70000",
      method: "POST",
      url: fixtureUrl(PRODUCT_CATALOG.flake.path),
      body: JSON.stringify({
        run_url: "https://github.com/actions/runner/actions/runs/29423388605",
        attempt: 1,
      }),
    }),
    mcpdrift: Object.freeze({
      product: "mcpdrift",
      service: "MCPDriftVerdict",
      amountAtomic: "20000",
      method: "POST",
      url: fixtureUrl("/api/mcp-drift"),
      body: JSON.stringify(mcpDriftExampleInput),
    }),
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: string): never {
  throw new SettlementCanaryValidationError(code);
}

function exactValue(value: unknown, expected: unknown, code: string): void {
  if (value !== expected) fail(code);
}

function exactAddress(value: unknown, expected: string, code: string): void {
  if (typeof value !== "string" || value.toLowerCase() !== expected.toLowerCase()) {
    fail(code);
  }
}

function decodeBase64Json(header: string, code: string): Record<string, unknown> {
  if (
    header.length === 0 ||
    header.length > 32_768 ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(header)
  ) {
    fail(code);
  }
  try {
    const normalized = header.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(value)) fail(code);
    return value;
  } catch (error) {
    if (error instanceof SettlementCanaryValidationError) throw error;
    fail(code);
  }
}

function requirePinnedFixture(fixture: SettlementCanaryFixture): void {
  const url = new URL(fixture.url);
  if (
    url.origin !== SETTLEMENT_CANARY_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  ) {
    fail("UNPINNED_RESOURCE");
  }
  const canonical = FIXTURES[fixture.product];
  if (
    fixture !== canonical ||
    fixture.url !== canonical.url ||
    fixture.method !== canonical.method
  ) {
    fail("UNPINNED_FIXTURE");
  }
}

export function isSettlementCanaryProduct(
  value: string,
): value is SettlementCanaryProduct {
  return (SETTLEMENT_CANARY_PRODUCTS as readonly string[]).includes(value);
}

/**
 * Return the deterministic UTC week bucket used for both selection and the
 * no-repeat guard in the durable runner.
 */
export function settlementCanaryWindow(at: Date): number {
  if (!Number.isFinite(at.getTime())) fail("INVALID_SELECTION_TIME");
  return Math.floor(at.getTime() / (7 * 24 * 60 * 60 * 1000));
}

export function assertSettlementCanarySpacing(
  previousAttemptedAt: string,
  selectedAt: Date,
): void {
  const previous = new Date(previousAttemptedAt);
  if (!Number.isFinite(previous.getTime()) || !Number.isFinite(selectedAt.getTime())) {
    fail("INVALID_CANARY_TIMESTAMP");
  }
  const elapsed = selectedAt.getTime() - previous.getTime();
  if (elapsed < 0) fail("FUTURE_CANARY_TIMESTAMP");
  if (elapsed < 7 * 24 * 60 * 60 * 1000) fail("CANARY_INTERVAL_NOT_ELAPSED");
}

/** Select one immutable product fixture, rotating once per UTC week. */
export function selectSettlementCanaryProduct(
  explicitProduct: string | undefined,
  at: Date,
): SettlementCanaryProduct {
  if (explicitProduct !== undefined) {
    if (!isSettlementCanaryProduct(explicitProduct)) {
      fail("INVALID_PRODUCT_SELECTION");
    }
    return explicitProduct;
  }
  const weeklyWindow = settlementCanaryWindow(at);
  return SETTLEMENT_CANARY_PRODUCTS[
    ((weeklyWindow % SETTLEMENT_CANARY_PRODUCTS.length) +
      SETTLEMENT_CANARY_PRODUCTS.length) % SETTLEMENT_CANARY_PRODUCTS.length
  ];
}

export function getSettlementCanaryFixture(
  product: SettlementCanaryProduct,
): Readonly<SettlementCanaryFixture> {
  const fixture = FIXTURES[product];
  requirePinnedFixture(fixture);
  return fixture;
}

export function decodeAndValidatePaymentRequired(
  header: string | null,
  product: SettlementCanaryProduct,
): Record<string, unknown> {
  if (!header) fail("PAYMENT_REQUIRED_MISSING");
  const fixture = getSettlementCanaryFixture(product);
  const challenge = decodeBase64Json(header, "PAYMENT_REQUIRED_INVALID");
  exactValue(challenge.x402Version, 2, "X402_VERSION_CHANGED");

  if (!isRecord(challenge.resource)) fail("RESOURCE_INVALID");
  exactValue(challenge.resource.url, fixture.url, "RESOURCE_URL_CHANGED");
  exactValue(challenge.resource.serviceName, fixture.service, "SERVICE_CHANGED");

  if (!Array.isArray(challenge.accepts) || challenge.accepts.length !== 1) {
    fail("PAYMENT_OPTIONS_CHANGED");
  }
  const requirement = challenge.accepts[0];
  if (!isRecord(requirement)) fail("PAYMENT_REQUIREMENT_INVALID");
  exactValue(requirement.scheme, "exact", "SCHEME_CHANGED");
  exactValue(requirement.network, SETTLEMENT_CANARY_NETWORK, "NETWORK_CHANGED");
  exactAddress(requirement.asset, SETTLEMENT_CANARY_ASSET, "ASSET_CHANGED");
  exactValue(requirement.amount, fixture.amountAtomic, "AMOUNT_CHANGED");
  exactAddress(requirement.payTo, SETTLEMENT_CANARY_PAYEE, "PAYEE_CHANGED");

  const extensions = challenge.extensions;
  const bazaar = isRecord(extensions) ? extensions.bazaar : undefined;
  const info = isRecord(bazaar) ? bazaar.info : undefined;
  const input = isRecord(info) ? info.input : undefined;
  if (!isRecord(input)) fail("BAZAAR_INPUT_INVALID");
  exactValue(input.method, fixture.method, "METHOD_CHANGED");
  if (fixture.method === "POST") exactValue(input.bodyType, "json", "BODY_TYPE_CHANGED");
  return challenge;
}

export function decodeAndValidateSettlement(
  header: string | null,
): { transaction: string; network: typeof SETTLEMENT_CANARY_NETWORK } {
  if (!header) fail("PAYMENT_RESPONSE_MISSING");
  const settlement = decodeBase64Json(header, "PAYMENT_RESPONSE_INVALID");
  if (settlement.success !== true) fail("SETTLEMENT_NOT_SUCCESSFUL");
  exactValue(settlement.network, SETTLEMENT_CANARY_NETWORK, "SETTLEMENT_NETWORK_CHANGED");
  if (
    typeof settlement.transaction !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction)
  ) {
    fail("TRANSACTION_HASH_INVALID");
  }
  return {
    transaction: settlement.transaction.toLowerCase(),
    network: SETTLEMENT_CANARY_NETWORK,
  };
}

function requireServiceReuse(value: unknown, service: string): void {
  if (!isRecord(value)) fail("SERVICE_REUSE_MISSING");
  if (
    value.reusable !== true ||
    value.fresh_result_per_successful_call !== true ||
    value.reliability !== "bounded_live_check" ||
    typeof value.guidance !== "string" ||
    value.guidance.length < 80 ||
    !value.guidance.startsWith(`Call ${service}`)
  ) {
    fail("SERVICE_REUSE_INVALID");
  }
}

function finiteNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code);
  return value;
}

export function validatePaidProductContract(
  product: SettlementCanaryProduct,
  body: unknown,
): Record<string, string | number | boolean | null> {
  if (!isRecord(body)) fail("PRODUCT_BODY_INVALID");
  const fixture = getSettlementCanaryFixture(product);
  if (product === "mcpdrift") {
    exactValue(body.service, fixture.service, "PRODUCT_CHANGED");
    exactValue(body.contract_version, "mcp-drift/1", "PRODUCT_VERSION_CHANGED");
    exactValue(body.ruleset_version, MCP_DRIFT_RULESET_VERSION, "MCP_RULESET_CHANGED");
    exactValue(body.verdict, "SAFE_ADDITIVE", "VERDICT_INVALID");
    exactValue(body.action, "ACCEPT_CURRENT", "MCP_ACTION_INVALID");
    exactValue(body.service_reuse, MCP_DRIFT_SERVICE_REUSE, "SERVICE_REUSE_INVALID");
    if (!isRecord(body.hashes) || !isRecord(body.summary) || !isRecord(body.coverage)) fail("MCP_RESULT_INVALID");
    if (!/^sha256:[a-f0-9]{64}$/.test(String(body.hashes.baseline_snapshot)) || !/^sha256:[a-f0-9]{64}$/.test(String(body.hashes.current_snapshot))) fail("MCP_HASH_INVALID");
    if (body.hashes.baseline_snapshot === body.hashes.current_snapshot) fail("MCP_FIXTURE_UNCHANGED");
    exactValue(body.summary.baseline_tools, 1, "MCP_COVERAGE_INVALID");
    exactValue(body.summary.current_tools, 1, "MCP_COVERAGE_INVALID");
    exactValue(body.coverage.relation_checks, 1, "MCP_COVERAGE_INVALID");
    exactValue(body.coverage.proven_subset, 1, "MCP_COVERAGE_INVALID");
    exactValue(body.coverage.unknown, 0, "MCP_COVERAGE_INVALID");
    exactValue(body.coverage.truncated, false, "MCP_COVERAGE_INVALID");
    return {
      verdict: String(body.verdict),
      action: String(body.action),
      relation_checks: 1,
      proven_subset: 1,
    };
  }
  exactValue(body.product, fixture.service, "PRODUCT_CHANGED");
  exactValue(body.version, "1.0", "PRODUCT_VERSION_CHANGED");
  requireServiceReuse(body.service_reuse, fixture.service);
  if (typeof body.checked_at !== "string" || !Number.isFinite(Date.parse(body.checked_at))) {
    fail("CHECKED_AT_INVALID");
  }

  if (product === "single") {
    if (!["AVOID", "CAUTION", "VIABLE"].includes(String(body.verdict))) {
      fail("VERDICT_INVALID");
    }
    if (!isRecord(body.issue)) fail("ISSUE_RESULT_INVALID");
    exactValue(
      body.issue.url,
      "https://github.com/typeorm/typeorm/issues/3357",
      "ISSUE_FIXTURE_CHANGED",
    );
    return {
      verdict: String(body.verdict),
      score: finiteNumber(body.score, "SCORE_INVALID"),
    };
  }
  if (product === "portfolio") {
    if (!isRecord(body.counts) || !Array.isArray(body.ranked)) {
      fail("PORTFOLIO_RESULT_INVALID");
    }
    const checked = finiteNumber(body.counts.checked, "PORTFOLIO_COUNTS_INVALID");
    const failed = finiteNumber(body.counts.failed, "PORTFOLIO_COUNTS_INVALID");
    if (checked !== 2 || failed !== 0 || body.ranked.length !== 2) {
      fail("PORTFOLIO_COVERAGE_INCOMPLETE");
    }
    return { checked, failed, ranked: body.ranked.length };
  }
  if (product === "harness") {
    if (!isRecord(body.repository)) fail("HARNESS_REPOSITORY_INVALID");
    exactValue(body.repository.full_name, "openai/codex", "HARNESS_FIXTURE_CHANGED");
    if (!/^[0-9a-f]{40}$/i.test(String(body.repository.commit_sha))) {
      fail("HARNESS_COMMIT_INVALID");
    }
    if (!["READY", "REVIEW", "REPAIR"].includes(String(body.verdict))) {
      fail("VERDICT_INVALID");
    }
    return {
      verdict: String(body.verdict),
      score: finiteNumber(body.score, "SCORE_INVALID"),
      commit_sha: String(body.repository.commit_sha),
    };
  }
  if (product === "skill") {
    if (!isRecord(body.repository) || !isRecord(body.skill)) {
      fail("SKILL_RESULT_INVALID");
    }
    exactValue(
      String(body.repository.full_name).toLowerCase(),
      "Mimirs402/bountyverdict",
      "SKILL_FIXTURE_CHANGED",
    );
    exactValue(
      body.skill.path,
      "skills/diagnose-github-actions/SKILL.md",
      "SKILL_PATH_CHANGED",
    );
    if (!["LOW_RISK", "REVIEW", "BLOCK"].includes(String(body.verdict))) {
      fail("VERDICT_INVALID");
    }
    return {
      verdict: String(body.verdict),
      risk_score: finiteNumber(body.risk_score, "RISK_SCORE_INVALID"),
    };
  }
  if (product === "flake") {
    if (!isRecord(body.target) || !isRecord(body.coverage) || !isRecord(body.decision)) {
      fail("FLAKE_RESULT_INVALID");
    }
    exactValue(body.target.id, "29423388605", "FLAKE_FIXTURE_CHANGED");
    exactValue(body.target.attempt, 1, "FLAKE_ATTEMPT_CHANGED");
    exactValue(body.target.current_attempt, 2, "FLAKE_CURRENT_ATTEMPT_CHANGED");
    exactValue(body.target.status, "completed", "FLAKE_STATUS_CHANGED");
    exactValue(body.target.conclusion, "failure", "FLAKE_CONCLUSION_CHANGED");
    if (!isRecord(body.service_reuse)) fail("SERVICE_REUSE_INVALID");
    exactValue(
      body.service_reuse.guidance,
      FLAKE_SERVICE_REUSE.guidance,
      "SERVICE_REUSE_INVALID",
    );
    if (![
      "CONFIRMED_FLAKE",
      "LIKELY_FLAKE",
      "RECURRING_FAILURE",
      "NEW_FAILURE",
      "INCONCLUSIVE",
    ].includes(String(body.verdict))) {
      fail("VERDICT_INVALID");
    }
    const attemptsChecked = finiteNumber(
      body.coverage.same_run_attempts_checked,
      "FLAKE_COVERAGE_INVALID",
    );
    if (attemptsChecked < 1) fail("FLAKE_COVERAGE_INCOMPLETE");
    const jobsReported = finiteNumber(body.coverage.target_jobs_reported, "FLAKE_COVERAGE_INVALID");
    const jobsTotal = finiteNumber(body.coverage.target_jobs_total, "FLAKE_COVERAGE_INVALID");
    const failedJobs = finiteNumber(body.coverage.target_failed_jobs, "FLAKE_COVERAGE_INVALID");
    if (
      jobsReported <= 0 ||
      failedJobs <= 0 ||
      jobsReported !== jobsTotal ||
      body.coverage.target_jobs_truncated !== false
    ) fail("FLAKE_COVERAGE_INCOMPLETE");
    exactValue(body.decision.retry, "NO", "FLAKE_RETRY_INVALID");
    return {
      verdict: String(body.verdict),
      retry: String(body.decision.retry),
      same_run_attempts_checked: attemptsChecked,
    };
  }
  if (product !== "run" || !isRecord(body.run) || !isRecord(body.coverage)) {
    fail("RUN_RESULT_INVALID");
  }
  exactValue(body.run.id, "29728148711", "RUN_FIXTURE_CHANGED");
  if (!["PASS", "WAIT", "RETRY", "FIX", "INVESTIGATE"].includes(String(body.verdict))) {
    fail("VERDICT_INVALID");
  }
  const failedJobs = finiteNumber(body.coverage.failed_jobs, "RUN_COVERAGE_INVALID");
  const logsScanned = finiteNumber(body.coverage.logs_scanned, "RUN_COVERAGE_INVALID");
  if (failedJobs <= 0 || logsScanned <= 0) fail("RUN_COVERAGE_INCOMPLETE");
  return {
    verdict: String(body.verdict),
    failed_jobs: failedJobs,
    logs_scanned: logsScanned,
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  const maximumBytes = 2 * 1024 * 1024;
  const advertisedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumBytes) {
    fail("PRODUCT_BODY_TOO_LARGE");
  }
  if (!response.body) fail("PRODUCT_BODY_INVALID");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        fail("PRODUCT_BODY_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof SettlementCanaryValidationError) throw error;
    fail("PRODUCT_BODY_INVALID");
  }
  try {
    return JSON.parse(text);
  } catch {
    fail("PRODUCT_BODY_INVALID");
  }
}

function resultBase(
  fixture: SettlementCanaryFixture,
  attemptedAt: string,
  completedAt: string,
): Omit<SettlementCanaryResult,
  "status" | "healthy" | "stage" | "error_code" | "payment_authorized" |
  "transaction_hash" | "contract_summary" | "requires_reconciliation"> {
  return {
    canary: "BountyVerdict real x402 settlement",
    version: "1.0",
    product: fixture.product,
    service: fixture.service,
    attempted_at: attemptedAt,
    completed_at: completedAt,
    amount_atomic: fixture.amountAtomic,
    network: SETTLEMENT_CANARY_NETWORK,
    asset: SETTLEMENT_CANARY_ASSET,
    payee: SETTLEMENT_CANARY_PAYEE,
    resource: fixture.url,
    method: fixture.method,
  };
}

function safeCode(error: unknown, fallback: string): string {
  return error instanceof SettlementCanaryValidationError ? error.code : fallback;
}

/**
 * Exercise one real x402 settlement. There is exactly one unsigned challenge
 * request and at most one authorized request; this function never retries.
 */
export async function runSettlementCanary(
  options: RunSettlementCanaryOptions,
): Promise<SettlementCanaryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 120_000;
  const fixture = getSettlementCanaryFixture(options.product);
  const attemptedAt = now().toISOString();
  let paymentAuthorized = false;
  let transactionHash: string | null = null;

  const requestInit = (): RequestInit => ({
    method: fixture.method,
    headers: fixture.body
      ? {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": SETTLEMENT_CANARY_USER_AGENT,
        }
      : {
          Accept: "application/json",
          "User-Agent": SETTLEMENT_CANARY_USER_AGENT,
        },
    body: fixture.body,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });

  let challenge: Record<string, unknown>;
  try {
    const unpaid = await fetchImpl(fixture.url, requestInit());
    if (unpaid.status !== 402) fail("UNPAID_STATUS_CHANGED");
    challenge = decodeAndValidatePaymentRequired(
      unpaid.headers.get("payment-required"),
      fixture.product,
    );
  } catch (error) {
    return {
      ...resultBase(fixture, attemptedAt, now().toISOString()),
      status: "FAILED",
      healthy: false,
      stage: "challenge",
      error_code: safeCode(error, "CHALLENGE_TRANSPORT_FAILED"),
      payment_authorized: false,
      transaction_hash: null,
      contract_summary: null,
      requires_reconciliation: false,
    };
  }

  let paymentPayload: unknown;
  try {
    paymentPayload = await options.payment.createPaymentPayload(challenge);
    paymentAuthorized = true;
  } catch (error) {
    return {
      ...resultBase(fixture, attemptedAt, now().toISOString()),
      status: "FAILED",
      healthy: false,
      stage: "authorization",
      error_code: safeCode(error, "PAYMENT_AUTHORIZATION_FAILED"),
      payment_authorized: false,
      transaction_hash: null,
      contract_summary: null,
      requires_reconciliation: false,
    };
  }

  if (options.onPaymentAuthorized) {
    const pending: SettlementCanaryResult = {
      ...resultBase(fixture, attemptedAt, now().toISOString()),
      status: "AMBIGUOUS",
      healthy: false,
      stage: "paid_transport",
      error_code: "PAYMENT_AUTHORIZED_AWAITING_RESULT",
      payment_authorized: true,
      transaction_hash: null,
      contract_summary: null,
      requires_reconciliation: true,
    };
    try {
      // Persist the reconciliation lock before the signed authorization can be
      // transported. A crash cannot silently turn into another scheduled pay.
      await options.onPaymentAuthorized(pending);
    } catch {
      return {
        ...pending,
        completed_at: now().toISOString(),
        error_code: "AMBIGUOUS_AUTHORIZATION_CHECKPOINT_FAILED",
      };
    }
  }

  let paid: Response;
  try {
    const init = requestInit();
    const headers = new Headers(init.headers);
    const paymentHeaders = Object.entries(
      options.payment.encodePaymentHeaders(paymentPayload),
    );
    if (
      paymentHeaders.length !== 1 ||
      paymentHeaders[0][0].toLowerCase() !== "payment-signature"
    ) {
      fail("PAYMENT_HEADER_INVALID");
    }
    for (const [name, value] of paymentHeaders) {
      if (typeof value !== "string" || !value) fail("PAYMENT_HEADER_INVALID");
      headers.set(name, value);
    }
    paid = await fetchImpl(fixture.url, { ...init, headers });
  } catch {
    return {
      ...resultBase(fixture, attemptedAt, now().toISOString()),
      status: "AMBIGUOUS",
      healthy: false,
      stage: "paid_transport",
      error_code: "AMBIGUOUS_AFTER_AUTHORIZATION",
      payment_authorized: paymentAuthorized,
      transaction_hash: null,
      contract_summary: null,
      requires_reconciliation: true,
    };
  }

  let settlement: ReturnType<typeof decodeAndValidateSettlement>;
  try {
    if (paid.status !== 200) fail("PAID_STATUS_NOT_200");
    settlement = decodeAndValidateSettlement(paid.headers.get("payment-response"));
    transactionHash = settlement.transaction;
  } catch {
    return {
      ...resultBase(fixture, attemptedAt, now().toISOString()),
      status: "AMBIGUOUS",
      healthy: false,
      stage: "settlement",
      error_code: "AMBIGUOUS_SETTLEMENT_RESULT",
      payment_authorized: paymentAuthorized,
      transaction_hash: null,
      contract_summary: null,
      requires_reconciliation: true,
    };
  }

  try {
    const contractSummary = validatePaidProductContract(
      fixture.product,
      await boundedJson(paid),
    );
    return {
      ...resultBase(fixture, attemptedAt, now().toISOString()),
      status: "SETTLED",
      healthy: true,
      stage: "complete",
      error_code: null,
      payment_authorized: paymentAuthorized,
      transaction_hash: transactionHash,
      contract_summary: contractSummary,
      requires_reconciliation: false,
    };
  } catch (error) {
    return {
      ...resultBase(fixture, attemptedAt, now().toISOString()),
      status: "CONTRACT_FAILED",
      healthy: false,
      stage: "contract",
      error_code: safeCode(error, "PRODUCT_CONTRACT_INVALID"),
      payment_authorized: paymentAuthorized,
      transaction_hash: transactionHash,
      contract_summary: null,
      requires_reconciliation: false,
    };
  }
}
