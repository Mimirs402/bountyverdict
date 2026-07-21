import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPaymentWrapper, type PaymentRequirements } from "@x402/mcp";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { z } from "zod";
import { parseIssueUrl } from "../../analysis.js";
import { CheckError, checkGithubIssue } from "./check.ts";
import { checkBountyPortfolio, validatePortfolioUrls } from "./portfolio.ts";
import { checkGithubHarness, HarnessError, parseRepositoryUrl } from "./harness.ts";
import { diagnoseGithubRun, parseRunUrl } from "./run.ts";
import { diagnoseGithubFlake, FlakeError, parseFlakeAttempt } from "./flake.ts";
import { MCP_DRIFT_MAX_BODY_BYTES, McpDriftError, parseAndAnalyzeMcpDrift } from "./mcp-drift.ts";
import { mcpDriftInputSchema } from "./mcp-drift-discovery.ts";
import { PRODUCT_CATALOG, type ProductKey } from "./product-catalog.ts";
import { createX402ServerContext, type X402ServerEnvironment } from "./x402-resource-server.ts";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_BODY_LIMIT_BYTES = MCP_DRIFT_MAX_BODY_BYTES + 64 * 1024;
const MCP_SERVER_VERSION = "1.0.1";
const MCP_ALLOWED_BROWSER_ORIGINS = new Set(["https://playground.ai.cloudflare.com"]);
const GITHUB_ISSUE_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*\/?$/;
const GITHUB_REPOSITORY_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;
const GITHUB_RUN_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9]\d*\/?$/;
const MCP_SERVER_ID_PATTERN = /^[A-Za-z0-9._:/@+~-]{1,256}$/;
const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

type DistributedProduct = Exclude<ProductKey, "skill">;
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

interface McpEnvironment extends X402ServerEnvironment {
  GITHUB_TOKEN?: string;
  FLAKE_RATE_LIMITER?: RateLimit;
}

interface PaymentContext {
  resourceServer: ReturnType<typeof createX402ServerContext>["resourceServer"];
  accepts: Record<DistributedProduct, PaymentRequirements[]>;
}

interface RequestClassification {
  ownerAutomation: boolean;
  clientFamily: McpClientFamily;
  toolStageEmitted: boolean;
}

const MCP_CLIENT_FAMILIES = Object.freeze([
  "owner_automation",
  "claude",
  "codex",
  "chatgpt",
  "gemini",
  "cursor",
  "vscode",
  "mcp_inspector",
  "cloudflare_playground",
  "other_declared",
  "missing",
  "not_applicable",
] as const);
type McpClientFamily = typeof MCP_CLIENT_FAMILIES[number];

const TOOL_PRODUCT = Object.freeze({
  check_github_bounty: "single",
  rank_github_bounties: "portfolio",
  audit_agent_harness: "harness",
  diagnose_github_actions_run: "run",
  classify_github_actions_flake: "flake",
  check_mcp_tool_drift: "mcpdrift",
} as const satisfies Record<string, DistributedProduct>);

type ToolName = keyof typeof TOOL_PRODUCT;

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  check_github_bounty: "Use for one public GitHub bounty issue before coding: assess claimability and delivery risk with an evidence-linked AVOID, CAUTION, or VIABLE verdict. For choosing among 2-10 bounties, use rank_github_bounties instead. Read-only. Costs $0.05 USDC on Base via x402 per successful call.",
  rank_github_bounties: "Use to choose the best candidate from 2-10 distinct public GitHub bounty issues. Returns full verdicts, evidence, ranking, and partial failures. For one issue, use check_github_bounty instead. Read-only. Costs $0.40 USDC on Base via x402 per successful call.",
  audit_agent_harness: "Use before assigning a coding agent to a public GitHub repository: audit its AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, and SKILL.md instruction stack at an immutable commit. This does not diagnose CI runs. Read-only. Costs $0.03 USDC on Base via x402 per successful call.",
  diagnose_github_actions_run: "Use to find the root cause of one public failed GitHub Actions run and get redacted evidence plus concrete next actions. For the narrower retry-once-versus-fix decision using history, use classify_github_actions_flake. Read-only. Costs $0.04 USDC on Base via x402 per successful call.",
  classify_github_actions_flake: "Use when the question is whether one completed failed GitHub Actions run should be retried once or fixed, using attempt and historical fingerprints. For general root-cause diagnosis, use diagnose_github_actions_run. Read-only. Costs $0.07 USDC on Base via x402 per successful call.",
  check_mcp_tool_drift: "Use before accepting an MCP tools/list update: compare complete baseline and current snapshots for removed tools, new required arguments, incompatible schemas, and model-facing safety-hint regressions. Returns a deterministic compatibility verdict without fetching or invoking tools. Read-only. Costs $0.02 USDC on Base via x402 per successful call.",
};

const issueUrlSchema = z.string()
  .regex(GITHUB_ISSUE_URL_PATTERN)
  .describe("Canonical public GitHub issue URL, for example https://github.com/owner/repository/issues/123. No query string, fragment, pull request, or non-GitHub host.");
const repositoryUrlSchema = z.string()
  .regex(GITHUB_REPOSITORY_URL_PATTERN)
  .describe("Canonical public GitHub repository URL, for example https://github.com/owner/repository. No subpath, query string, fragment, or non-GitHub host.");
const runUrlSchema = z.string()
  .regex(GITHUB_RUN_URL_PATTERN)
  .describe("Canonical public GitHub Actions run URL, for example https://github.com/owner/repository/actions/runs/123456. No job URL, query string, fragment, or non-GitHub host.");
const portfolioUrlsSchema = z.array(issueUrlSchema)
  .min(2)
  .max(10)
  .refine((urls) => new Set(urls).size === urls.length, "Every issue URL must be unique.")
  .describe("Two to ten distinct canonical public GitHub issue URLs. Duplicate issue URLs are rejected before payment.");
const jsonSchemaObject = z.record(z.unknown())
  .describe("A bounded JSON Schema Draft 2020-12 object in MCPDriftVerdict's documented comparison subset.");
const mcpToolSchema = z.object({
  name: z.string().regex(MCP_TOOL_NAME_PATTERN).describe("Stable MCP tool name."),
  title: z.string().max(512).optional().describe("Optional human-readable tool title."),
  description: z.string().max(16_384).optional().describe("Optional model-facing tool description."),
  icons: z.array(z.record(z.unknown())).max(8).optional().describe("Optional MCP tool icons; retained for comparison, never fetched."),
  inputSchema: jsonSchemaObject.describe("The tool's complete input JSON Schema."),
  outputSchema: jsonSchemaObject.optional().describe("The tool's complete output JSON Schema, when declared."),
  annotations: z.object({
    title: z.string().max(512).optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  }).strict().optional().describe("Model-facing MCP safety hints. They are caller-asserted metadata, not behavioral proof."),
  execution: z.object({
    taskSupport: z.enum(["forbidden", "optional", "required"]).optional(),
  }).strict().optional(),
  _meta: z.record(z.unknown()).optional().describe("Optional MCP extension metadata; bounded again by the semantic validator."),
}).strict().describe("One complete MCP tools/list tool definition.");
const mcpSnapshotSchema = z.object({
  protocol_version: z.literal("2025-11-25"),
  complete: z.literal(true).describe("Caller assertion that every tools/list page was aggregated and nextCursor was exhausted."),
  tools: z.array(mcpToolSchema).max(128).describe("The complete tools/list catalog, with at most 128 tools."),
}).strict().describe("One complete aggregated MCP tools/list snapshot. No live server is contacted.");
const mcpDriftLiveInputSchema = z.object({
  contract_version: z.literal("mcp-drift/1"),
  subject: z.object({
    server_id: z.string().regex(MCP_SERVER_ID_PATTERN).describe("Non-secret stable caller-chosen server identifier, for example acme/tasks@production."),
  }).strict().describe("Caller-chosen identity for the MCP server being compared; ownership is not verified."),
  annotation_source_trust: z.enum(["trusted", "untrusted"]).describe("Whether the caller recognizes the annotation source. Annotations never become runtime-behavior proof."),
  baseline: mcpSnapshotSchema.describe("Complete previously accepted tools/list snapshot."),
  current: mcpSnapshotSchema.describe("Complete candidate tools/list snapshot."),
}).strict();

const BAZAAR_INPUT_SCHEMAS: Record<ToolName, Record<string, unknown>> = {
  check_github_bounty: { type: "object", properties: { issue_url: { type: "string", description: "Public GitHub issue URL." } }, required: ["issue_url"], additionalProperties: false },
  rank_github_bounties: { type: "object", properties: { issue_urls: { type: "array", minItems: 2, maxItems: 10, uniqueItems: true, items: { type: "string", description: "Public GitHub issue URL." } } }, required: ["issue_urls"], additionalProperties: false },
  audit_agent_harness: { type: "object", properties: { repo_url: { type: "string", description: "Public GitHub repository URL." } }, required: ["repo_url"], additionalProperties: false },
  diagnose_github_actions_run: { type: "object", properties: { run_url: { type: "string", description: "Public GitHub Actions run URL." } }, required: ["run_url"], additionalProperties: false },
  classify_github_actions_flake: { type: "object", properties: { run_url: { type: "string", description: "Public GitHub Actions run URL." }, attempt: { type: "integer", minimum: 1, description: "Optional exact workflow attempt." } }, required: ["run_url"], additionalProperties: false },
  check_mcp_tool_drift: mcpDriftInputSchema,
};

const PAYMENT_CACHE = new Map<string, Promise<PaymentContext>>();

function jsonResult(value: unknown): ToolResult {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { result: value };
  return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
}

function errorResult(product: DistributedProduct, code: string, message: string): ToolResult {
  return {
    ...jsonResult({ error: code, message, product: PRODUCT_CATALOG[product].service, payment_verified: false, payment_settled: false, payment_challenge_issued: false }),
    isError: true,
  };
}

export function classifyMcpClientFamily(value: unknown, ownerAutomation = false): McpClientFamily {
  if (ownerAutomation) return "owner_automation";
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as { method?: unknown }).method !== "initialize") {
    return "not_applicable";
  }
  const name = (value as { params?: { clientInfo?: { name?: unknown } } }).params?.clientInfo?.name;
  if (typeof name !== "string" || !name.trim()) return "missing";
  if (/claude/i.test(name)) return "claude";
  if (/codex/i.test(name)) return "codex";
  if (/chatgpt|openai/i.test(name)) return "chatgpt";
  if (/gemini/i.test(name)) return "gemini";
  if (/cursor/i.test(name)) return "cursor";
  if (/visual studio code|vscode/i.test(name)) return "vscode";
  if (/model context protocol inspector|mcp[ _-]?inspector/i.test(name)) return "mcp_inspector";
  if (/cloudflare.*playground|playground.*cloudflare/i.test(name)) return "cloudflare_playground";
  return "other_declared";
}

function classifyRequest(request: Request, body: unknown): RequestClassification {
  const ownerAutomation = /bountyverdict-(?:owner-audit|funnel-smoke|payment-smoke|directory-monitor|distribution-monitor|settlement-canary)/i.test(request.headers.get("User-Agent") || "");
  return { ownerAutomation, clientFamily: classifyMcpClientFamily(body, ownerAutomation), toolStageEmitted: false };
}

function emitMcpEvent(stage: string, product: DistributedProduct | null, request: RequestClassification): void {
  if (product || stage === "tool_not_found") request.toolStageEmitted = true;
  console.log(JSON.stringify({
    type: "bountyverdict_mcp_funnel",
    schema_version: 2,
    stage,
    product,
    source: request.ownerAutomation ? "owner_automation" : "external",
    client_family: stage === "initialize" ? request.clientFamily : "not_applicable",
  }));
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

async function getPaymentContext(env: McpEnvironment): Promise<PaymentContext> {
  const context = createX402ServerContext(env);
  let pending = PAYMENT_CACHE.get(context.cacheKey);
  if (!pending) {
    pending = (async () => {
      context.resourceServer.registerExtension(bazaarResourceServerExtension);
      await context.resourceServer.initialize();
      const entries = await Promise.all((Object.keys(PRODUCT_CATALOG) as ProductKey[])
        .filter((product): product is DistributedProduct => product !== "skill")
        .map(async (product) => [product, await context.resourceServer.buildPaymentRequirements({ scheme: "exact", network: context.network, payTo: context.payTo, price: PRODUCT_CATALOG[product].priceUsd, maxTimeoutSeconds: 300 })] as const));
      return { resourceServer: context.resourceServer, accepts: Object.fromEntries(entries) as Record<DistributedProduct, PaymentRequirements[]> };
    })().catch((error) => { PAYMENT_CACHE.delete(context.cacheKey); throw error; });
    PAYMENT_CACHE.set(context.cacheKey, pending);
  }
  return pending;
}

function hasPayment(extra: unknown): boolean {
  if (!extra || typeof extra !== "object") return false;
  const payment = (extra as { _meta?: Record<string, unknown> })._meta?.["x402/payment"];
  return Boolean(payment && typeof payment === "object" && !Array.isArray(payment));
}

async function paidCall(
  payment: PaymentContext,
  toolName: ToolName,
  product: DistributedProduct,
  normalizedArgs: Record<string, unknown>,
  extra: unknown,
  request: RequestClassification,
  execute: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const argumentsHash = await sha256(JSON.stringify(normalizedArgs));
  const paymentPresent = hasPayment(extra);
  emitMcpEvent(paymentPresent ? "payment_present" : "payment_required", product, request);
  const wrapped = createPaymentWrapper(payment.resourceServer, {
    accepts: payment.accepts[product],
    resource: {
      url: `mcp://tool/${toolName}`,
      description: `${TOOL_DESCRIPTIONS[toolName]} Advisory normalized arguments hash ${argumentsHash}. Payment does not cryptographically bind arguments; retry with the exact same normalized arguments.`,
      mimeType: "application/json",
      serviceName: PRODUCT_CATALOG[product].service,
      tags: ["github", "agent", "decision", product],
    },
    extensions: declareDiscoveryExtension({ toolName, description: TOOL_DESCRIPTIONS[toolName], transport: "streamable-http", inputSchema: BAZAAR_INPUT_SCHEMAS[toolName] }),
  })(async () => execute());
  try {
    const result = await wrapped(normalizedArgs, extra as never) as ToolResult;
    if (paymentPresent) {
      const settled = Boolean(result._meta?.["x402/payment-response"]);
      emitMcpEvent(settled && !result.isError ? "paid_success" : "paid_error", product, request);
    }
    return result;
  } catch (error) {
    if (paymentPresent) emitMcpEvent("paid_error", product, request);
    throw error;
  }
}

function normalizeIssueUrl(value: string): string {
  const parsed = parseIssueUrl(value);
  return `https://github.com/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`;
}

function normalizeRepositoryUrl(value: string): string {
  const parsed = parseRepositoryUrl(value);
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}

function normalizeRunUrl(value: string): string {
  const parsed = parseRunUrl(value);
  return `https://github.com/${parsed.owner}/${parsed.repo}/actions/runs/${parsed.runId}`;
}

async function createMcpServer(env: McpEnvironment, request: RequestClassification): Promise<McpServer> {
  const payment = await getPaymentContext(env);
  const server = new McpServer({
    name: "BountyVerdict",
    title: "BountyVerdict Agent Decision Tools",
    version: MCP_SERVER_VERSION,
    description: "Paid, read-only GitHub and MCP decision tools for autonomous agents.",
    websiteUrl: "https://cristianmoroaica.github.io/bountyverdict/",
  }, {
    instructions: "Choose by task: one bounty -> check_github_bounty; 2-10 bounties -> rank_github_bounties; repository coding-agent instructions -> audit_agent_harness; CI root cause and next action -> diagnose_github_actions_run; retry once versus fix using run history -> classify_github_actions_flake; proposed tools/list compatibility -> check_mcp_tool_drift. All six tools are paid and read-only. Invalid input is rejected before any payment challenge. Each successful call charges the exact advertised USDC price on Base via x402. Payment identifies the fixed-price tool, not its arguments; preserve the exact normalized arguments when retrying with payment.",
  });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  server.registerTool("check_github_bounty", { title: "Check GitHub bounty claimability risk", description: TOOL_DESCRIPTIONS.check_github_bounty, inputSchema: z.object({ issue_url: issueUrlSchema }).strict(), annotations }, async ({ issue_url }, extra) => {
    let normalized: string;
    try { normalized = normalizeIssueUrl(issue_url); } catch (error) {
      emitMcpEvent("validation_error", "single", request);
      return errorResult("single", "INVALID_ISSUE_URL", error instanceof Error ? error.message : "Invalid GitHub issue URL.");
    }
    return paidCall(payment, "check_github_bounty", "single", { issue_url: normalized }, extra, request, async () => {
      try { return jsonResult(await checkGithubIssue(normalized, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof CheckError ? errorResult("single", error.code, error.message) : errorResult("single", "CHECK_FAILED", "The bounty verdict could not be produced."); }
    });
  });

  server.registerTool("rank_github_bounties", { title: "Choose the best GitHub bounty", description: TOOL_DESCRIPTIONS.rank_github_bounties, inputSchema: z.object({ issue_urls: portfolioUrlsSchema }).strict(), annotations }, async ({ issue_urls }, extra) => {
    let normalized: string[];
    try { normalized = validatePortfolioUrls(issue_urls); } catch (error) {
      emitMcpEvent("validation_error", "portfolio", request);
      return errorResult("portfolio", error instanceof CheckError ? error.code : "INVALID_PORTFOLIO", error instanceof Error ? error.message : "Invalid bounty portfolio.");
    }
    return paidCall(payment, "rank_github_bounties", "portfolio", { issue_urls: normalized }, extra, request, async () => {
      try { return jsonResult(await checkBountyPortfolio(normalized, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof CheckError ? errorResult("portfolio", error.code, error.message) : errorResult("portfolio", "PORTFOLIO_CHECK_FAILED", "The bounty portfolio could not be produced."); }
    });
  });

  server.registerTool("audit_agent_harness", { title: "Audit coding-agent repository instructions", description: TOOL_DESCRIPTIONS.audit_agent_harness, inputSchema: z.object({ repo_url: repositoryUrlSchema }).strict(), annotations }, async ({ repo_url }, extra) => {
    let normalized: string;
    try { normalized = normalizeRepositoryUrl(repo_url); } catch (error) {
      emitMcpEvent("validation_error", "harness", request);
      return errorResult("harness", "INVALID_REPOSITORY_URL", error instanceof Error ? error.message : "Invalid GitHub repository URL.");
    }
    return paidCall(payment, "audit_agent_harness", "harness", { repo_url: normalized }, extra, request, async () => {
      try { return jsonResult(await checkGithubHarness(normalized, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof HarnessError ? errorResult("harness", error.code, error.message) : errorResult("harness", "HARNESS_CHECK_FAILED", "The agent harness audit could not be produced."); }
    });
  });

  server.registerTool("diagnose_github_actions_run", { title: "Find why a GitHub Actions run failed", description: TOOL_DESCRIPTIONS.diagnose_github_actions_run, inputSchema: z.object({ run_url: runUrlSchema }).strict(), annotations }, async ({ run_url }, extra) => {
    let normalized: string;
    try { normalized = normalizeRunUrl(run_url); } catch (error) {
      emitMcpEvent("validation_error", "run", request);
      return errorResult("run", "INVALID_RUN_URL", error instanceof Error ? error.message : "Invalid GitHub Actions run URL.");
    }
    return paidCall(payment, "diagnose_github_actions_run", "run", { run_url: normalized }, extra, request, async () => {
      try { return jsonResult(await diagnoseGithubRun(normalized, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof HarnessError ? errorResult("run", error.code, error.message) : errorResult("run", "RUN_DIAGNOSIS_FAILED", "The workflow run could not be diagnosed."); }
    });
  });

  server.registerTool("classify_github_actions_flake", { title: "Decide whether to retry failed GitHub Actions", description: TOOL_DESCRIPTIONS.classify_github_actions_flake, inputSchema: z.object({
    run_url: runUrlSchema,
    attempt: z.number().int().positive().optional().describe("Optional exact workflow run attempt number, starting at 1. Omit to use the run URL's latest available completed attempt."),
  }).strict(), annotations }, async ({ run_url, attempt }, extra) => {
    let normalized: string;
    let normalizedAttempt: number | undefined;
    try {
      normalized = normalizeRunUrl(run_url);
      normalizedAttempt = parseFlakeAttempt(attempt === undefined ? undefined : String(attempt));
      if (!env.FLAKE_RATE_LIMITER) throw new HarnessError("FlakeVerdict capacity protection is unavailable.", 503, "SERVICE_CONFIGURATION_ERROR");
      if (hasPayment(extra)) {
        const permitted = await env.FLAKE_RATE_LIMITER.limit({ key: "flake:mcp-verified-global" });
        if (!permitted.success) throw new HarnessError("FlakeVerdict is temporarily at its bounded upstream capacity.", 429, "FLAKE_RATE_LIMITED");
      }
    } catch (error) {
      emitMcpEvent("validation_error", "flake", request);
      return errorResult("flake", error instanceof HarnessError ? error.code : "INVALID_INPUT", error instanceof Error ? error.message : "Invalid flake input.");
    }
    return paidCall(payment, "classify_github_actions_flake", "flake", { run_url: normalized, ...(normalizedAttempt === undefined ? {} : { attempt: normalizedAttempt }) }, extra, request, async () => {
      try { return jsonResult(await diagnoseGithubFlake(normalized, normalizedAttempt, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof FlakeError ? errorResult("flake", error.code, error.message) : errorResult("flake", "FLAKE_CHECK_FAILED", "The workflow flake classification could not be produced."); }
    });
  });

  server.registerTool("check_mcp_tool_drift", { title: "Check whether an MCP tools update is breaking", description: TOOL_DESCRIPTIONS.check_mcp_tool_drift, inputSchema: mcpDriftLiveInputSchema, annotations }, async (args, extra) => {
    let result: Awaited<ReturnType<typeof parseAndAnalyzeMcpDrift>>;
    const normalized = { contract_version: args.contract_version, subject: args.subject, annotation_source_trust: args.annotation_source_trust, baseline: args.baseline, current: args.current };
    try { result = await parseAndAnalyzeMcpDrift(JSON.stringify(normalized)); }
    catch (error) {
      emitMcpEvent("validation_error", "mcpdrift", request);
      return error instanceof McpDriftError ? errorResult("mcpdrift", error.code, error.message) : errorResult("mcpdrift", "INVALID_INPUT", "The MCP snapshots are invalid.");
    }
    return paidCall(payment, "check_mcp_tool_drift", "mcpdrift", normalized, extra, request, async () => jsonResult(result));
  });

  return server;
}

function jsonRpcHttpError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(status === 405 ? { Allow: "POST" } : {}) } });
}

export async function handleMcpRequest(request: Request, env: McpEnvironment): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const allowedCorsOrigin = origin && (origin === url.origin || MCP_ALLOWED_BROWSER_ORIGINS.has(origin)) ? origin : null;
  const respond = (response: Response): Response => {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    if (allowedCorsOrigin) {
      headers.set("Access-Control-Allow-Origin", allowedCorsOrigin);
      headers.append("Vary", "Origin");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
  if (origin && !allowedCorsOrigin) return respond(jsonRpcHttpError(403, -32000, "Forbidden Origin"));
  if (request.method === "OPTIONS" && allowedCorsOrigin) {
    return respond(new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
    } }));
  }
  if (request.method !== "POST") return respond(jsonRpcHttpError(405, -32600, "Method not allowed; this stateless MCP server accepts POST only"));
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MCP_BODY_LIMIT_BYTES) return respond(jsonRpcHttpError(413, -32600, "MCP request body is too large"));
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
    return respond(jsonRpcHttpError(415, -32000, "Unsupported Media Type: Content-Type must be application/json"));
  }
  const accept = request.headers.get("Accept") || "";
  if (!/application\/json/i.test(accept) || !/text\/event-stream/i.test(accept)) {
    return respond(jsonRpcHttpError(406, -32000, "Not Acceptable: client must accept application/json and text/event-stream"));
  }

  let parsedBody: unknown;
  if (request.method === "POST") {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MCP_BODY_LIMIT_BYTES) return respond(jsonRpcHttpError(413, -32600, "MCP request body is too large"));
    try { parsedBody = JSON.parse(raw); } catch { return respond(jsonRpcHttpError(400, -32700, "Parse error")); }
  }

  const classification = classifyRequest(request, parsedBody);
  const method = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? (parsedBody as { method?: unknown }).method : undefined;
  const requestedProtocol = request.headers.get("MCP-Protocol-Version");
  if (method !== "initialize" && requestedProtocol !== MCP_PROTOCOL_VERSION) {
    return respond(jsonRpcHttpError(400, -32600, `MCP-Protocol-Version must be ${MCP_PROTOCOL_VERSION}`));
  }
  if (method === "initialize") emitMcpEvent("initialize", null, classification);
  if (method === "tools/list") emitMcpEvent("tools_list", null, classification);

  try {
    const server = await createMcpServer(env, classification);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(request, parsedBody === undefined ? undefined : { parsedBody });
    if (method === "tools/call" && !classification.toolStageEmitted) {
      const toolName = (parsedBody as { params?: { name?: unknown } }).params?.name;
      const product = typeof toolName === "string" ? TOOL_PRODUCT[toolName as ToolName] : undefined;
      emitMcpEvent(product ? "validation_error" : "tool_not_found", product || null, classification);
    }
    return respond(response);
  } catch (error) {
    console.error("MCP request failed", error instanceof Error ? { name: error.name } : { name: "unknown" });
    return respond(jsonRpcHttpError(503, -32603, "MCP service temporarily unavailable"));
  }
}

export const MCP_DISTRIBUTED_TOOL_NAMES = Object.freeze(Object.keys(TOOL_PRODUCT) as ToolName[]);
