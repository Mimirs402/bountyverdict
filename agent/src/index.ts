import {
  type HTTPRequestContext,
  type RouteConfig,
} from "@x402/core/server";
import { paymentMiddleware } from "@x402/hono";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { parseIssueUrl } from "../../analysis.js";
import { CheckError, checkGithubIssue } from "./check.ts";
import {
  BOUNTY_DISCOVERY_DESCRIPTION,
  discoveryExtension,
  exampleVerdict,
  portfolioDiscoveryExtension,
  portfolioExample,
} from "./discovery.ts";
import { createLlmsText, createOpenApi } from "./openapi.ts";
import { checkBountyPortfolio, validatePortfolioUrls } from "./portfolio.ts";
import { checkGithubHarness, HarnessError, parseRepositoryUrl } from "./harness.ts";
import { harnessDiscoveryExtension, harnessExample } from "./harness-discovery.ts";
import { checkGithubSkill, normalizeSkillPath } from "./skill.ts";
import { skillDiscoveryExtension, skillExample } from "./skill-discovery.ts";
import { diagnoseGithubRun, parseRunUrl } from "./run.ts";
import { runDiscoveryExtension, runExample } from "./run-discovery.ts";
import { diagnoseGithubFlake, FlakeError, parseFlakeAttempt } from "./flake.ts";
import { flakeDiscoveryExtension, flakeExample } from "./flake-discovery.ts";
import {
  MCP_DRIFT_MAX_BODY_BYTES,
  McpDriftError,
  parseAndAnalyzeMcpDrift,
  type McpDriftResult,
} from "./mcp-drift.ts";
import {
  MCP_DRIFT_DISCOVERY_DESCRIPTION,
  mcpDriftDiscoveryExtension,
  mcpDriftExample,
  mcpDriftExampleInput,
} from "./mcp-drift-discovery.ts";
import {
  LEGACY_FLAKE_PATH,
  LEGACY_GET_PATHS,
  LEGACY_HARNESS_PATH,
  LEGACY_RUN_PATH,
  LEGACY_SINGLE_PATH,
  PRODUCT_CATALOG,
} from "./product-catalog.ts";
import { buildPaymentHandoff } from "./payment-handoff.ts";
import { PRODUCT_SELECTION_PREVIEWS } from "./selection-preview.ts";
import { createX402ServiceManifest } from "./x402-service-manifest.ts";
import {
  createAiCatalog,
  createApiCatalog,
  createIntegrationsManifest,
  createMcpServerCard,
  createMcpWellKnown,
  createOriginAgentManifest,
  createOriginSkillMarkdown,
} from "./origin-discovery.ts";
import {
  canaryErrorCode,
  isCanaryProduct,
  runFunctionalCanary,
  verifyCanaryAuthorization,
} from "./canary.ts";
import {
  fulfillProduct,
  fulfillThe402Product,
  parseThe402JobDispatch,
  parseThe402ServiceMap,
  reportThe402Result,
  verifyThe402Webhook,
} from "./the402.ts";
import {
  NEAR_MARKET_MAX_BODY_BYTES,
  parseNearMarketInput,
  parseNearMarketProduct,
} from "./near-market.ts";
import {
  evaluateAndBidThe402Request,
  parseThe402RequestCreated,
} from "./the402-bidder.ts";
import {
  createX402ServerContext,
  requireCdpResourceDescription,
  TESTNET_X402_NETWORK,
} from "./x402-resource-server.ts";
import { handleMcpRequest } from "./mcp-server.ts";

interface Env {
  PAY_TO_ADDRESS?: string;
  GITHUB_TOKEN?: string;
  X402_NETWORK?: string;
  X402_FACILITATOR_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  CANARY_TOKEN?: string;
  THE402_API_KEY?: string;
  THE402_WEBHOOK_SECRET?: string;
  THE402_SERVICE_MAP?: string;
  CANARY_RATE_LIMITER?: RateLimit;
  FLAKE_RATE_LIMITER?: RateLimit;
  NEAR_MARKET_RATE_LIMITER?: RateLimit;
}

type AppBindings = {
  Bindings: Env;
  Variables: {
    mcpDriftResult: McpDriftResult;
    singleIssueUrl: string;
    portfolioIssueUrls: string[];
    harnessRepoUrl: string;
    skillRepoUrl: string;
    skillPath: string;
    runUrl: string;
    flakeRunUrl: string;
    flakeAttempt: number | undefined;
  };
};

const SINGLE_PRICE_USD = PRODUCT_CATALOG.single.priceUsd;
const PORTFOLIO_PRICE_USD = PRODUCT_CATALOG.portfolio.priceUsd;
const HARNESS_PRICE_USD = PRODUCT_CATALOG.harness.priceUsd;
const SKILL_PRICE_USD = PRODUCT_CATALOG.skill.priceUsd;
const RUN_PRICE_USD = PRODUCT_CATALOG.run.priceUsd;
const FLAKE_PRICE_USD = PRODUCT_CATALOG.flake.priceUsd;
const MCP_DRIFT_PRICE_USD = PRODUCT_CATALOG.mcpdrift.priceUsd;
const SINGLE_ENDPOINT = PRODUCT_CATALOG.single.path;
const PORTFOLIO_ENDPOINT = PRODUCT_CATALOG.portfolio.path;
const HARNESS_ENDPOINT = PRODUCT_CATALOG.harness.path;
const SKILL_ENDPOINT = PRODUCT_CATALOG.skill.path;
const RUN_ENDPOINT = PRODUCT_CATALOG.run.path;
const FLAKE_ENDPOINT = PRODUCT_CATALOG.flake.path;
const MCP_DRIFT_ENDPOINT = PRODUCT_CATALOG.mcpdrift.path;
const TESTNET_NETWORK = TESTNET_X402_NETWORK;
const PRODUCT_URL = "https://cristianmoroaica.github.io/bountyverdict/";
const ICON_URL = `${PRODUCT_URL}favicon.svg`;
const MANIFEST_URL = `${PRODUCT_URL}agent-manifest.json`;
const SKILLS_URL = `${PRODUCT_URL}skills/`;
const SKILL_URL = `${SKILLS_URL}route-github-agent-checks/SKILL.md`;
const SINGLE_MAX_BODY_BYTES = 4 * 1024;
const DECISION_MAX_BODY_BYTES = 4 * 1024;
const PORTFOLIO_MAX_BODY_BYTES = 16 * 1024;
const CANONICAL_ISSUE_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/;

const INPUT_GUIDANCE = Object.freeze({
  single: {
    product: "BountyVerdict",
    method: "POST",
    required: ["issue_url"],
    example: { issue_url: "https://github.com/owner/repository/issues/123" },
  },
  portfolio: {
    product: "BountyVerdict Portfolio",
    method: "POST",
    required: ["issue_urls"],
    example: { issue_urls: ["https://github.com/owner/repository/issues/123", "https://github.com/owner/repository/issues/456"] },
  },
  harness: {
    product: "HarnessVerdict",
    method: "POST",
    required: ["repo_url"],
    example: { repo_url: "https://github.com/owner/repository" },
  },
  skill: {
    product: "SkillVerdict",
    method: "GET",
    required: ["repo_url", "skill_path"],
    example: { repo_url: "https://github.com/owner/skills", skill_path: "skills/example" },
  },
  run: {
    product: "RunVerdict",
    method: "POST",
    required: ["run_url"],
    example: { run_url: "https://github.com/owner/repository/actions/runs/123456789" },
  },
  flake: {
    product: "FlakeVerdict",
    method: "POST",
    required: ["run_url"],
    optional: ["attempt"],
    example: { run_url: "https://github.com/owner/repository/actions/runs/123456789", attempt: 1 },
  },
  mcpdrift: {
    product: "MCPDriftVerdict",
    method: "POST",
    required: ["baseline", "current"],
    example: mcpDriftExampleInput,
  },
} as const);

const LEGACY_SINGLE_INPUT_GUIDANCE = Object.freeze({
  product: "BountyVerdict",
  method: "GET",
  required: ["issue_url"],
  example: { issue_url: "https://github.com/owner/repository/issues/123" },
  deprecated: true,
  canonical_transport: {
    method: "POST",
    path: PRODUCT_CATALOG.single.path,
    body: { issue_url: "https://github.com/owner/repository/issues/123" },
  },
});

const LEGACY_HARNESS_INPUT_GUIDANCE = Object.freeze({
  product: "HarnessVerdict",
  method: "GET",
  required: ["repo_url"],
  example: { repo_url: "https://github.com/owner/repository" },
  deprecated: true,
  canonical_transport: {
    method: "POST",
    path: PRODUCT_CATALOG.harness.path,
    body: { repo_url: "https://github.com/owner/repository" },
  },
});

const LEGACY_RUN_INPUT_GUIDANCE = Object.freeze({
  product: "RunVerdict",
  method: "GET",
  required: ["run_url"],
  example: { run_url: "https://github.com/owner/repository/actions/runs/123456789" },
  deprecated: true,
  canonical_transport: {
    method: "POST",
    path: PRODUCT_CATALOG.run.path,
    body: { run_url: "https://github.com/owner/repository/actions/runs/123456789" },
  },
});

const LEGACY_FLAKE_INPUT_GUIDANCE = Object.freeze({
  product: "FlakeVerdict",
  method: "GET",
  required: ["run_url"],
  optional: ["attempt"],
  example: { run_url: "https://github.com/owner/repository/actions/runs/123456789", attempt: 1 },
  deprecated: true,
  canonical_transport: {
    method: "POST",
    path: PRODUCT_CATALOG.flake.path,
    body: { run_url: "https://github.com/owner/repository/actions/runs/123456789", attempt: 1 },
  },
});

type PreflightProduct = keyof typeof INPUT_GUIDANCE;

function preflightFailure(
  c: Context<AppBindings>,
  product: PreflightProduct,
  code: string,
  message: string,
  status: 400 | 413 | 422 | 429 | 503 = 400,
  details: Record<string, unknown> = {},
  guidanceOverride?: Record<string, unknown>,
) {
  const origin = new URL(c.req.url).origin;
  const guidance = guidanceOverride || INPUT_GUIDANCE[product];
  return c.json({
    error: code,
    message,
    product: guidance.product,
    payment_signature_present: Boolean(c.req.header("Payment-Signature") || c.req.header("X-PAYMENT")),
    payment_verified: false,
    payment_settled: false,
    payment_challenge_issued: false,
    ...details,
    required_input: guidance,
    free_sample: `${origin}${PRODUCT_CATALOG[product].samplePath}`,
    openapi: `${origin}/openapi.json`,
    agent_guide: `${origin}/llms.txt`,
    retry: "Correct the input, then retry without a payment signature to receive a request-bound x402 challenge.",
  }, status);
}

type UnpaidDecisionPreview = {
  productKey: keyof typeof PRODUCT_CATALOG;
  method: "GET" | "POST";
  legacyTransport?: boolean;
};

async function unpaidDecisionBody(preview: UnpaidDecisionPreview, context: HTTPRequestContext) {
  const requestUrl = context.adapter.getUrl();
  const selection = PRODUCT_SELECTION_PREVIEWS[preview.productKey];
  const requestBody = preview.method === "POST" && context.adapter.getBody
    ? await context.adapter.getBody()
    : undefined;
  if (preview.method === "POST" && requestBody === undefined) {
    throw new Error(`Validated POST body is unavailable for ${selection.product}; refusing to construct a payment challenge.`);
  }
  const catalog = PRODUCT_CATALOG[preview.productKey];
  const canonical = catalog.method === preview.method && !preview.legacyTransport;
  const requestPath = new URL(requestUrl).pathname;
  const legacyPath = LEGACY_GET_PATHS[preview.productKey as keyof typeof LEGACY_GET_PATHS];
  const legacy = preview.method === "GET" && preview.legacyTransport === true && legacyPath === requestPath;
  if (!canonical && !legacy) {
    throw new Error(`Payment handoff method drifted for ${selection.product}.`);
  }
  const payment = await buildPaymentHandoff({
    method: preview.method,
    url: requestUrl,
    ...(requestBody === undefined ? {} : { body: requestBody }),
  }, catalog.amountAtomic.toString());
  return {
    contentType: "application/json",
    body: {
      error: "PAYMENT_REQUIRED",
      product: selection.product,
      price: catalog.priceUsd,
      currency: "USDC",
      description: selection.description,
      use_when: selection.useWhen,
      not_for: selection.notFor,
      decision_returned: selection.decisionReturned,
      why_pay: selection.whyPay,
      free_sample: selection.samplePath,
      skill: `${SKILLS_URL}${selection.skillName}/SKILL.md`,
      documentation: `${PRODUCT_URL}agents.html`,
      payment,
    },
  };
}

const middlewareCache = new Map<string, MiddlewareHandler>();

function buildPaymentMiddleware(env: Env): MiddlewareHandler {
  const { payTo, network, cacheKey: key, resourceServer } = createX402ServerContext(env);
  const cached = middlewareCache.get(key);
  if (cached) return cached;

  const routeConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: SINGLE_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: requireCdpResourceDescription(BOUNTY_DISCOVERY_DESCRIPTION),
    mimeType: "application/json",
    serviceName: "BountyVerdict",
    tags: ["github", "bounty", "eligibility", "claimability", "already-claimed", "assignment-status", "due-diligence"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "single",
      method: "POST",
    }, context),
  };
  const portfolioRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: PORTFOLIO_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: requireCdpResourceDescription("Which GitHub bounty should I work on? Compare two to ten public issue URLs and choose the best candidate. Runs the full due-diligence check for every issue, ranks opportunities, returns per-candidate verdicts and partial failures, and identifies the strongest non-AVOID option in one call."),
    mimeType: "application/json",
    serviceName: "BountyVerdict Portfolio",
    tags: ["compare-bounties", "best-candidate", "candidate-selection", "opportunity-ranking", "github-bounties", "portfolio"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "portfolio",
      method: "POST",
    }, context),
  };
  const legacySingleRouteConfig: RouteConfig = {
    ...routeConfig,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "single",
      method: "GET",
      legacyTransport: true,
    }, context),
  };
  const harnessRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: HARNESS_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: requireCdpResourceDescription("Audit a public GitHub repository's coding-agent instruction stack at an immutable commit. Maps AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, and SKILL.md coverage; flags stale paths, oversized context, machine-local references, malformed skills, and secret-like material with evidence-linked fixes."),
    mimeType: "application/json",
    serviceName: "HarnessVerdict",
    tags: ["github", "agents-md", "claude-md", "agent-harness", "developer-tools", "lint"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "harness",
      method: "POST",
    }, context),
  };
  const legacyHarnessRouteConfig: RouteConfig = {
    ...harnessRouteConfig,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "harness",
      method: "GET",
      legacyTransport: true,
    }, context),
  };
  const skillRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: SKILL_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: requireCdpResourceDescription("Pre-install security audit for a public agent SKILL.md bundle. Pins the repository to a commit, scans the whole skill directory without executing it, uses repository context to reduce false positives, and flags credential exfiltration, remote or encoded execution, destructive commands, persistence, privilege escalation, instruction evasion, hidden scripts, symlinks, submodules, hardcoded secrets, and undeclared capabilities."),
    mimeType: "application/json",
    serviceName: "SkillVerdict",
    tags: ["agent-skills", "skill-md", "security", "supply-chain", "prompt-injection", "pre-install"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "skill",
      method: "GET",
    }, context),
  };
  const runRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: RUN_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: requireCdpResourceDescription("Why did this GitHub Actions run fail? Diagnose one completed public workflow URL and explain what the agent should do next. Reads exact-attempt jobs and bounded failed-job logs, separates primary failures from downstream summaries, and returns root cause, retryability, redacted evidence, and concrete next actions without rerunning code."),
    mimeType: "application/json",
    serviceName: "RunVerdict",
    tags: ["workflow-failure", "why-failed", "root-cause", "failed-run", "next-action", "github-actions"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "run",
      method: "POST",
    }, context),
  };
  const legacyRunRouteConfig: RouteConfig = {
    ...runRouteConfig,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "run",
      method: "GET",
      legacyTransport: true,
    }, context),
  };
  const flakeRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: FLAKE_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: requireCdpResourceDescription("Should I rerun this failed GitHub Actions workflow or fix the code? Decide whether one completed public run is flaky and merits exactly one retry, or is recurring or new and needs a fix. Compares exact attempts, same-commit outcomes, failed-step fingerprints, and bounded historical runs without rerunning CI."),
    mimeType: "application/json",
    serviceName: "FlakeVerdict",
    tags: ["flaky-ci", "should-i-retry", "retry-or-fix", "workflow-attempts", "historical-run-comparison", "github-actions"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "flake",
      method: "POST",
    }, context),
  };
  const legacyFlakeRouteConfig: RouteConfig = {
    ...flakeRouteConfig,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "flake",
      method: "GET",
      legacyTransport: true,
    }, context),
  };
  const mcpDriftRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: MCP_DRIFT_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: requireCdpResourceDescription(MCP_DRIFT_DISCOVERY_DESCRIPTION),
    mimeType: "application/json",
    serviceName: "MCPDriftVerdict",
    tags: ["mcp", "tools-list", "schema-drift", "breaking-change", "agent-compatibility", "server-upgrade", "required-argument"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      productKey: "mcpdrift",
      method: "POST",
    }, context),
  };
  const middleware = paymentMiddleware(
    {
      [`POST ${SINGLE_ENDPOINT}`]: routeConfig,
      [`GET ${LEGACY_SINGLE_PATH}`]: legacySingleRouteConfig,
      [`POST ${PORTFOLIO_ENDPOINT}`]: portfolioRouteConfig,
      [`POST ${HARNESS_ENDPOINT}`]: harnessRouteConfig,
      [`GET ${LEGACY_HARNESS_PATH}`]: legacyHarnessRouteConfig,
      [`GET ${SKILL_ENDPOINT}`]: skillRouteConfig,
      [`POST ${RUN_ENDPOINT}`]: runRouteConfig,
      [`GET ${LEGACY_RUN_PATH}`]: legacyRunRouteConfig,
      [`POST ${FLAKE_ENDPOINT}`]: flakeRouteConfig,
      [`GET ${LEGACY_FLAKE_PATH}`]: legacyFlakeRouteConfig,
      [`POST ${MCP_DRIFT_ENDPOINT}`]: mcpDriftRouteConfig,
    },
    resourceServer,
  );
  // Attach already-enriched metadata after middleware construction. The Hono
  // adapter otherwise auto-loads the eval-based validator that Workers reject.
  // x402HTTPResourceServer retains this same route object for payment responses.
  routeConfig.extensions = discoveryExtension;
  portfolioRouteConfig.extensions = portfolioDiscoveryExtension;
  harnessRouteConfig.extensions = harnessDiscoveryExtension;
  skillRouteConfig.extensions = skillDiscoveryExtension;
  runRouteConfig.extensions = runDiscoveryExtension;
  flakeRouteConfig.extensions = flakeDiscoveryExtension;
  mcpDriftRouteConfig.extensions = mcpDriftDiscoveryExtension;
  middlewareCache.set(key, middleware);
  return middleware;
}

const app = new Hono<AppBindings>();

app.get("/favicon.ico", (c) => c.redirect(ICON_URL, 302));

app.get("/", (c) =>
  c.json({
    product: "BountyVerdict",
    status: "available",
    purpose: "Seven bounded decision APIs for coding agents: GitHub due diligence and diagnostics plus deterministic MCP tool-catalog upgrade gates.",
    currency: "USDC",
    products: [
      {
        name: "BountyVerdict",
        price: SINGLE_PRICE_USD,
        endpoint: SINGLE_ENDPOINT,
        method: "POST",
        legacy_endpoint: LEGACY_SINGLE_PATH,
        legacy_method: "GET",
        use_when: "Decide whether one public GitHub bounty issue is worth pursuing before coding.",
        skill: `${SKILLS_URL}preflight-github-bounties/SKILL.md`,
        input: { issue_url: "https://github.com/owner/repository/issues/123" },
      },
      {
        name: "BountyVerdict Portfolio",
        price: PORTFOLIO_PRICE_USD,
        endpoint: PORTFOLIO_ENDPOINT,
        method: "POST",
        use_when: "Rank two to ten public GitHub bounty candidates.",
        skill: `${SKILLS_URL}preflight-github-bounties/SKILL.md`,
        input: { issue_urls: ["https://github.com/owner/repository/issues/123", "https://github.com/owner/repository/issues/456"] },
      },
      {
        name: "HarnessVerdict",
        price: HARNESS_PRICE_USD,
        endpoint: HARNESS_ENDPOINT,
        method: "POST",
        legacy_endpoint: LEGACY_HARNESS_PATH,
        legacy_method: "GET",
        use_when: "Audit repository coding-agent instructions before autonomous work.",
        skill: `${SKILLS_URL}audit-agent-harness/SKILL.md`,
        input: { repo_url: "https://github.com/owner/repository" },
      },
      {
        name: "SkillVerdict",
        price: SKILL_PRICE_USD,
        endpoint: SKILL_ENDPOINT,
        method: "GET",
        use_when: "Audit a public SKILL.md bundle before installation or execution.",
        skill: `${SKILLS_URL}preflight-agent-skills/SKILL.md`,
        input: { repo_url: "https://github.com/owner/skills", skill_path: "skills/example" },
      },
      {
        name: "RunVerdict",
        price: RUN_PRICE_USD,
        endpoint: RUN_ENDPOINT,
        method: "POST",
        legacy_endpoint: LEGACY_RUN_PATH,
        legacy_method: "GET",
        use_when: "Diagnose the root cause and next action for one public workflow run.",
        skill: `${SKILLS_URL}diagnose-github-actions/SKILL.md`,
        input: { run_url: "https://github.com/owner/repository/actions/runs/123456789" },
      },
      {
        name: "FlakeVerdict",
        price: FLAKE_PRICE_USD,
        endpoint: FLAKE_ENDPOINT,
        method: "POST",
        legacy_endpoint: LEGACY_FLAKE_PATH,
        legacy_method: "GET",
        use_when: "Decide whether a completed failed workflow run merits exactly one retry.",
        skill: `${SKILLS_URL}classify-github-flakes/SKILL.md`,
        input: { run_url: "https://github.com/owner/repository/actions/runs/123456789", attempt: 1 },
      },
      {
        name: "MCPDriftVerdict",
        price: MCP_DRIFT_PRICE_USD,
        endpoint: MCP_DRIFT_ENDPOINT,
        method: "POST",
        use_when: "Gate an MCP server tool-catalog change before an agent accepts or pins it.",
        skill: `${SKILLS_URL}check-mcp-tool-drift/SKILL.md`,
        input: mcpDriftExampleInput,
      },
    ],
    sample: "/api/sample",
    openapi: "/openapi.json",
    llms: "/llms.txt",
    x402_manifest: "/.well-known/x402",
    ai_catalog: "/.well-known/ai-catalog.json",
    api_catalog: "/.well-known/api-catalog",
    integrations: "/.well-known/integrations.json",
    mcp_server_card: "/.well-known/mcp/server-card.json",
    agent_manifest: MANIFEST_URL,
    agent_skill: SKILL_URL,
    distributed_agent_manifest: "/agent-manifest.json",
    distributed_agent_skill: "/SKILL.md",
    mcp: {
      endpoint: "/mcp",
      transport: "streamable-http",
      protocol_version: "2025-11-25",
      paid_tools: 6,
      registry_name: "io.github.cristianmoroaica/bountyverdict",
    },
    install_skill: "npx skills add cristianmoroaica/bountyverdict --skill route-github-agent-checks -y",
    human_checker: PRODUCT_URL,
  }),
);

app.get("/api/sample", (c) => c.json(exampleVerdict));
app.get("/api/portfolio/sample", (c) => c.json(portfolioExample));
app.get("/api/harness/sample", (c) => c.json(harnessExample));
app.get("/api/skill/sample", (c) => c.json(skillExample));
app.get("/api/run/sample", (c) => c.json(runExample));
app.get("/api/flake/sample", (c) => c.json(flakeExample));
app.get("/api/mcp-drift/sample", (c) => c.json(mcpDriftExample));

app.get("/.well-known/x402", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(createX402ServiceManifest(
    origin,
    c.env.X402_NETWORK || TESTNET_NETWORK,
    c.env.PAY_TO_ADDRESS,
  ));
});

app.get("/.well-known/mcp.json", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(createMcpWellKnown(origin, c.env.X402_NETWORK || TESTNET_NETWORK));
});

app.get("/.well-known/mcp/server-card.json", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(createMcpServerCard(origin, c.env.X402_NETWORK || TESTNET_NETWORK), 200, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=3600",
  });
});

app.get("/.well-known/integrations.json", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(createIntegrationsManifest(origin), 200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  });
});

app.on(["GET", "HEAD"], "/.well-known/api-catalog", (c) => {
  const origin = new URL(c.req.url).origin;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
    "Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    Link: `<${origin}/.well-known/api-catalog>; rel="api-catalog"`,
  };
  if (c.req.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(JSON.stringify(createApiCatalog(origin)), { status: 200, headers });
});

app.get("/.well-known/ai-catalog.json", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(createAiCatalog(origin), 200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  });
});

app.get("/agent-manifest.json", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(createOriginAgentManifest(
    origin,
    c.env.X402_NETWORK || TESTNET_NETWORK,
    c.env.PAY_TO_ADDRESS,
  ));
});

app.get("/SKILL.md", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.text(createOriginSkillMarkdown(
    origin,
    c.env.X402_NETWORK || TESTNET_NETWORK,
    c.env.PAY_TO_ADDRESS,
  ), 200, {
    "Content-Type": "text/markdown; charset=utf-8",
  });
});

app.get("/openapi.json", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(createOpenApi(origin, c.env.X402_NETWORK || TESTNET_NETWORK, {
    single: SINGLE_PRICE_USD,
    portfolio: PORTFOLIO_PRICE_USD,
    harness: HARNESS_PRICE_USD,
    skill: SKILL_PRICE_USD,
    run: RUN_PRICE_USD,
    flake: FLAKE_PRICE_USD,
    mcpdrift: MCP_DRIFT_PRICE_USD,
  }));
});

app.get("/llms.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.text(createLlmsText(origin), 200, { "Content-Type": "text/plain; charset=utf-8" });
});

app.all("/mcp", (c) => handleMcpRequest(c.req.raw, c.env));

app.post("/api/the402/webhook", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  const declaredLength = c.req.header("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > 65_536) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  const rawBody = await c.req.text();
  const verified = await verifyThe402Webhook({
    raw_body: rawBody,
    api_key_header: c.req.header("X-Platform-Secret"),
    signature_header: c.req.header("X-Webhook-Signature"),
    timestamp_header: c.req.header("X-Webhook-Timestamp"),
    api_key: c.env.THE402_API_KEY,
    webhook_secret: c.env.THE402_WEBHOOK_SECRET,
  });
  if (!verified || !c.env.THE402_API_KEY) return c.json({ error: "NOT_FOUND" }, 404);

  let job;
  try {
    const request = parseThe402RequestCreated(rawBody);
    if (request) {
      const apiKey = c.env.THE402_API_KEY;
      c.executionCtx.waitUntil(evaluateAndBidThe402Request({ request, api_key: apiKey })
        .then((result) => console.log("the402 request evaluation:", result))
        .catch((error) => console.error(
          "the402 request evaluation failed:",
          error instanceof Error ? error.message : "unknown error",
        )));
      return c.json({ accepted: true, action: "bid_evaluation_scheduled", posting_id: request.posting_id });
    }
    job = parseThe402JobDispatch(rawBody, parseThe402ServiceMap(c.env.THE402_SERVICE_MAP));
  } catch (error) {
    console.error("Rejected authenticated the402 webhook:", error instanceof Error ? error.message : "invalid payload");
    return c.json({ error: "INVALID_WEBHOOK" }, 400);
  }
  if (!job) return c.json({ accepted: true, action: "ignored" });

  const apiKey = c.env.THE402_API_KEY;
  c.executionCtx.waitUntil((async () => {
    try {
      const deliverables = await fulfillThe402Product(job, {
        GITHUB_TOKEN: c.env.GITHUB_TOKEN,
        FLAKE_RATE_LIMITER: c.env.FLAKE_RATE_LIMITER,
      });
      await reportThe402Result({
        callback_url: job.callback_url,
        api_key: apiKey,
        status: "completed",
        deliverables,
        notes: `${job.product} fulfilled automatically by BountyVerdict.`,
      });
    } catch (error) {
      console.error(`the402 ${job.product} fulfillment failed:`, error instanceof Error ? error.message : "unknown error");
      try {
        await reportThe402Result({
          callback_url: job.callback_url,
          api_key: apiKey,
          status: "failed",
          notes: "BountyVerdict could not fulfill this request; the input may be invalid or upstream capacity unavailable.",
        });
      } catch (callbackError) {
        console.error("the402 failure callback failed:", callbackError instanceof Error ? callbackError.message : "unknown error");
      }
    }
  })());
  return c.json({ accepted: true, job_id: job.job_id });
});

app.get("/_internal/canary/:product", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  const configured = Boolean(c.env.CANARY_TOKEN && c.env.CANARY_TOKEN.length >= 32);
  if (!configured) {
    console.error("Functional canary secret is not configured.");
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  if (!await verifyCanaryAuthorization(c.req.header("Authorization"), c.env.CANARY_TOKEN)) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  const product = c.req.param("product");
  if (!isCanaryProduct(product)) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  if (!c.env.CANARY_RATE_LIMITER) {
    console.error("Functional canary rate limiter is not configured.");
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  const rateLimit = await c.env.CANARY_RATE_LIMITER.limit({ key: `canary:${product}` });
  if (!rateLimit.success) {
    c.header("Retry-After", "60");
    return c.json({ product, ok: false, error: "CANARY_RATE_LIMITED" }, 429);
  }
  try {
    return c.json(await runFunctionalCanary(product, { GITHUB_TOKEN: c.env.GITHUB_TOKEN }));
  } catch (error) {
    console.error(`Functional canary ${product} failed:`, error);
    return c.json({
      product,
      ok: false,
      error: canaryErrorCode(error),
      checked_at: new Date().toISOString(),
    }, 503);
  }
});

const paymentGate: MiddlewareHandler<AppBindings> = async (c, next) => {
  try {
    return await buildPaymentMiddleware(c.env)(c, next);
  } catch (error) {
    console.error(error);
    return c.json(
      {
        error: "SERVICE_CONFIGURATION_ERROR",
        message: "The payment service is not configured yet.",
      },
      503,
    );
  }
};

const singlePreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "POST") return await next();
  const contentType = c.req.header("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return preflightFailure(c, "single", "INVALID_CONTENT_TYPE", "Content-Type must be application/json.");
  }
  const declaredLength = c.req.header("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > SINGLE_MAX_BODY_BYTES) {
    return preflightFailure(c, "single", "INPUT_TOO_LARGE", "Request body exceeds 4,096 bytes.", 413);
  }
  try {
    const raw = await c.req.raw.clone().text();
    if (new TextEncoder().encode(raw).byteLength > SINGLE_MAX_BODY_BYTES) {
      return preflightFailure(c, "single", "INPUT_TOO_LARGE", "Request body exceeds 4,096 bytes.", 413);
    }
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length !== 1 || typeof input.issue_url !== "string") {
      return preflightFailure(c, "single", "INVALID_INPUT", "Request body must contain exactly one string field: issue_url.");
    }
    if (!CANONICAL_ISSUE_URL_PATTERN.test(input.issue_url)) {
      return preflightFailure(c, "single", "INVALID_ISSUE_URL", "issue_url must be an exact canonical public GitHub issue URL without a query string, fragment, or trailing slash.");
    }
    const parsed = parseIssueUrl(input.issue_url);
    c.set("singleIssueUrl", `https://github.com/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`);
    return await next();
  } catch (error) {
    return preflightFailure(
      c,
      "single",
      error instanceof SyntaxError ? "INVALID_JSON" : "INVALID_ISSUE_URL",
      error instanceof SyntaxError ? "Request body must be valid JSON." :
        error instanceof Error ? error.message : "issue_url must be a canonical public GitHub issue URL.",
    );
  }
};

const legacySinglePreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "GET") return await next();
  try {
    const parsed = parseIssueUrl(c.req.query("issue_url") || "");
    c.set("singleIssueUrl", `https://github.com/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`);
    return await next();
  } catch (error) {
    return preflightFailure(
      c,
      "single",
      "INVALID_ISSUE_URL",
      error instanceof Error ? error.message : "issue_url must be a canonical public GitHub issue URL.",
      400,
      {},
      LEGACY_SINGLE_INPUT_GUIDANCE,
    );
  }
};

const portfolioPreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "POST") return await next();
  const contentType = c.req.header("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return preflightFailure(c, "portfolio", "INVALID_CONTENT_TYPE", "Content-Type must be application/json.");
  }
  const declaredLength = c.req.header("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > PORTFOLIO_MAX_BODY_BYTES) {
    return preflightFailure(c, "portfolio", "INPUT_TOO_LARGE", "Request body exceeds 16,384 bytes.", 413);
  }
  try {
    const raw = await c.req.raw.clone().text();
    if (new TextEncoder().encode(raw).byteLength > PORTFOLIO_MAX_BODY_BYTES) {
      return preflightFailure(c, "portfolio", "INPUT_TOO_LARGE", "Request body exceeds 16,384 bytes.", 413);
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 || !("issue_urls" in parsed)) {
      return preflightFailure(c, "portfolio", "INVALID_INPUT", "Request body must contain exactly issue_urls.");
    }
    c.set("portfolioIssueUrls", validatePortfolioUrls(parsed.issue_urls));
    return await next();
  } catch (error) {
    if (error instanceof CheckError) {
      return preflightFailure(c, "portfolio", error.code, error.message);
    }
    return preflightFailure(c, "portfolio", "INVALID_JSON", "Request body must be valid JSON.");
  }
};

const harnessPreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "POST") return await next();
  const contentType = c.req.header("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return preflightFailure(c, "harness", "INVALID_CONTENT_TYPE", "Content-Type must be application/json.");
  }
  const declaredLength = c.req.header("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > DECISION_MAX_BODY_BYTES) {
    return preflightFailure(c, "harness", "INPUT_TOO_LARGE", "Request body exceeds 4,096 bytes.", 413);
  }
  try {
    const raw = await c.req.raw.clone().text();
    if (new TextEncoder().encode(raw).byteLength > DECISION_MAX_BODY_BYTES) {
      return preflightFailure(c, "harness", "INPUT_TOO_LARGE", "Request body exceeds 4,096 bytes.", 413);
    }
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length !== 1 || typeof input.repo_url !== "string") {
      return preflightFailure(c, "harness", "INVALID_INPUT", "Request body must contain exactly one string field: repo_url.");
    }
    const parsed = parseRepositoryUrl(input.repo_url);
    c.set("harnessRepoUrl", `https://github.com/${parsed.owner}/${parsed.repo}`);
    return await next();
  } catch (error) {
    return preflightFailure(
      c,
      "harness",
      error instanceof SyntaxError ? "INVALID_JSON" : "INVALID_REPOSITORY_URL",
      error instanceof SyntaxError ? "Request body must be valid JSON." : error instanceof Error ? error.message : "repo_url is invalid.",
    );
  }
};

const legacyHarnessPreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "GET") return await next();
  try {
    const parsed = parseRepositoryUrl(c.req.query("repo_url") || "");
    c.set("harnessRepoUrl", `https://github.com/${parsed.owner}/${parsed.repo}`);
    return await next();
  } catch (error) {
    return preflightFailure(c, "harness", "INVALID_REPOSITORY_URL", error instanceof Error ? error.message : "repo_url is invalid.", 400, {}, LEGACY_HARNESS_INPUT_GUIDANCE);
  }
};

const skillPreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "GET") return await next();
  try {
    const parsed = parseRepositoryUrl(c.req.query("repo_url") || "");
    const skill = normalizeSkillPath(c.req.query("skill_path") || "");
    c.set("skillRepoUrl", `https://github.com/${parsed.owner}/${parsed.repo}`);
    c.set("skillPath", skill.entry);
    return await next();
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : "INVALID_INPUT";
    return preflightFailure(c, "skill", code, error instanceof Error ? error.message : "Skill input is invalid.");
  }
};

const runPreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "POST") return await next();
  const contentType = c.req.header("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return preflightFailure(c, "run", "INVALID_CONTENT_TYPE", "Content-Type must be application/json.");
  }
  const declaredLength = c.req.header("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > DECISION_MAX_BODY_BYTES) {
    return preflightFailure(c, "run", "INPUT_TOO_LARGE", "Request body exceeds 4,096 bytes.", 413);
  }
  try {
    const raw = await c.req.raw.clone().text();
    if (new TextEncoder().encode(raw).byteLength > DECISION_MAX_BODY_BYTES) {
      return preflightFailure(c, "run", "INPUT_TOO_LARGE", "Request body exceeds 4,096 bytes.", 413);
    }
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length !== 1 || typeof input.run_url !== "string") {
      return preflightFailure(c, "run", "INVALID_INPUT", "Request body must contain exactly one string field: run_url.");
    }
    const parsed = parseRunUrl(input.run_url);
    c.set("runUrl", `https://github.com/${parsed.owner}/${parsed.repo}/actions/runs/${parsed.runId}`);
    return await next();
  } catch (error) {
    return preflightFailure(
      c,
      "run",
      error instanceof SyntaxError ? "INVALID_JSON" : "INVALID_RUN_URL",
      error instanceof SyntaxError ? "Request body must be valid JSON." : error instanceof Error ? error.message : "run_url is invalid.",
    );
  }
};

const legacyRunPreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "GET") return await next();
  try {
    const parsed = parseRunUrl(c.req.query("run_url") || "");
    c.set("runUrl", `https://github.com/${parsed.owner}/${parsed.repo}/actions/runs/${parsed.runId}`);
    return await next();
  } catch (error) {
    return preflightFailure(c, "run", "INVALID_RUN_URL", error instanceof Error ? error.message : "run_url is invalid.", 400, {}, LEGACY_RUN_INPUT_GUIDANCE);
  }
};

const flakePreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "POST") return await next();
  const contentType = c.req.header("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return preflightFailure(c, "flake", "INVALID_CONTENT_TYPE", "Content-Type must be application/json.");
  }
  const declaredLength = c.req.header("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > DECISION_MAX_BODY_BYTES) {
    return preflightFailure(c, "flake", "INPUT_TOO_LARGE", "Request body exceeds 4,096 bytes.", 413);
  }
  try {
    const raw = await c.req.raw.clone().text();
    if (new TextEncoder().encode(raw).byteLength > DECISION_MAX_BODY_BYTES) {
      return preflightFailure(c, "flake", "INPUT_TOO_LARGE", "Request body exceeds 4,096 bytes.", 413);
    }
    const input = JSON.parse(raw) as Record<string, unknown>;
    const keys = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      !keys.includes("run_url") || keys.some((key) => key !== "run_url" && key !== "attempt") ||
      typeof input.run_url !== "string" || ("attempt" in input && typeof input.attempt !== "number")) {
      return preflightFailure(c, "flake", "INVALID_INPUT", "Request body must contain run_url as a string and may contain attempt as an integer.");
    }
    const parsed = parseRunUrl(input.run_url);
    c.set("flakeRunUrl", `https://github.com/${parsed.owner}/${parsed.repo}/actions/runs/${parsed.runId}`);
    c.set("flakeAttempt", parseFlakeAttempt(input.attempt as number | undefined));
    if (!c.env.FLAKE_RATE_LIMITER) {
      return preflightFailure(c, "flake", "SERVICE_CONFIGURATION_ERROR", "FlakeVerdict capacity protection is unavailable.", 503);
    }
    if (c.req.header("Payment-Signature") || c.req.header("X-PAYMENT")) {
      const rateLimit = await c.env.FLAKE_RATE_LIMITER.limit({ key: "flake:verified-global" });
      if (!rateLimit.success) {
        c.header("Retry-After", "60");
        return preflightFailure(c, "flake", "FLAKE_RATE_LIMITED", "FlakeVerdict is temporarily at its bounded upstream capacity.", 429);
      }
    }
    return await next();
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : "INVALID_INPUT";
    return preflightFailure(c, "flake", code, error instanceof Error ? error.message : "Flake input is invalid.");
  }
};

const legacyFlakePreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "GET") return await next();
  try {
    const parsed = parseRunUrl(c.req.query("run_url") || "");
    c.set("flakeRunUrl", `https://github.com/${parsed.owner}/${parsed.repo}/actions/runs/${parsed.runId}`);
    c.set("flakeAttempt", parseFlakeAttempt(c.req.query("attempt")));
    if (!c.env.FLAKE_RATE_LIMITER) {
      return preflightFailure(c, "flake", "SERVICE_CONFIGURATION_ERROR", "FlakeVerdict capacity protection is unavailable.", 503, {}, LEGACY_FLAKE_INPUT_GUIDANCE);
    }
    if (c.req.header("Payment-Signature") || c.req.header("X-PAYMENT")) {
      const rateLimit = await c.env.FLAKE_RATE_LIMITER.limit({ key: "flake:verified-global" });
      if (!rateLimit.success) {
        c.header("Retry-After", "60");
        return preflightFailure(c, "flake", "FLAKE_RATE_LIMITED", "FlakeVerdict is temporarily at its bounded upstream capacity.", 429, {}, LEGACY_FLAKE_INPUT_GUIDANCE);
      }
    }
    return await next();
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : "INVALID_INPUT";
    return preflightFailure(c, "flake", code, error instanceof Error ? error.message : "Flake input is invalid.", 400, {}, LEGACY_FLAKE_INPUT_GUIDANCE);
  }
};

app.use(SINGLE_ENDPOINT, singlePreflight);
app.use(LEGACY_SINGLE_PATH, legacySinglePreflight);
app.use(PORTFOLIO_ENDPOINT, portfolioPreflight);
app.use(HARNESS_ENDPOINT, harnessPreflight);
app.use(LEGACY_HARNESS_PATH, legacyHarnessPreflight);
app.use(SKILL_ENDPOINT, skillPreflight);
app.use(RUN_ENDPOINT, runPreflight);
app.use(LEGACY_RUN_PATH, legacyRunPreflight);
app.use(FLAKE_ENDPOINT, flakePreflight);
app.use(LEGACY_FLAKE_PATH, legacyFlakePreflight);
app.use(SINGLE_ENDPOINT, paymentGate);
app.use(LEGACY_SINGLE_PATH, paymentGate);
app.use(PORTFOLIO_ENDPOINT, paymentGate);
app.use(HARNESS_ENDPOINT, paymentGate);
app.use(LEGACY_HARNESS_PATH, paymentGate);
app.use(SKILL_ENDPOINT, paymentGate);
app.use(RUN_ENDPOINT, paymentGate);
app.use(LEGACY_RUN_PATH, paymentGate);
app.use(FLAKE_ENDPOINT, paymentGate);
app.use(LEGACY_FLAKE_PATH, paymentGate);

const mcpDriftPreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  const contentType = c.req.header("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return preflightFailure(c, "mcpdrift", "INVALID_INPUT", "Content-Type must be application/json.");
  }
  const declaredLength = c.req.header("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MCP_DRIFT_MAX_BODY_BYTES) {
    return preflightFailure(c, "mcpdrift", "INPUT_TOO_LARGE", "Request body exceeds 524,288 bytes.", 413);
  }
  try {
    const result = await parseAndAnalyzeMcpDrift(await c.req.text());
    c.set("mcpDriftResult", result);
    c.header("X-MCP-Drift-Baseline-Snapshot", result.hashes.baseline_snapshot);
    c.header("X-MCP-Drift-Current-Snapshot", result.hashes.current_snapshot);
    c.header("X-MCP-Drift-Ruleset-Version", result.ruleset_version);
    return await next();
  } catch (error) {
    if (error instanceof McpDriftError) {
      return preflightFailure(c, "mcpdrift", error.code, error.message, error.status, { path: error.path });
    }
    console.error("MCPDriftVerdict preflight failed", error instanceof Error ? { name: error.name, message: error.message } : { name: "unknown" });
    return c.json({ error: "INTERNAL_ERROR", message: "The MCP drift verdict could not be produced before payment." }, 500);
  }
};

// The verdict is fully validated and computed before any x402 verification or settlement.
app.use(MCP_DRIFT_ENDPOINT, mcpDriftPreflight);
app.use(MCP_DRIFT_ENDPOINT, paymentGate);

const singleHandler = async (c: Context<AppBindings>) => {
  const issueUrl = c.get("singleIssueUrl");
  try {
    const verdict = await checkGithubIssue(issueUrl, {
      GITHUB_TOKEN: c.env.GITHUB_TOKEN,
    });
    return c.json(verdict);
  } catch (error) {
    if (error instanceof CheckError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json(
      { error: "INTERNAL_ERROR", message: "The verdict could not be produced." },
      500,
    );
  }
};

app.post(SINGLE_ENDPOINT, singleHandler);
app.get(LEGACY_SINGLE_PATH, singleHandler);

app.post(PORTFOLIO_ENDPOINT, async (c) => {
  try {
    const portfolio = await checkBountyPortfolio(c.get("portfolioIssueUrls"), {
      GITHUB_TOKEN: c.env.GITHUB_TOKEN,
    });
    return c.json(portfolio);
  } catch (error) {
    if (error instanceof CheckError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json(
      { error: "INTERNAL_ERROR", message: "The portfolio could not be produced." },
      500,
    );
  }
});

const harnessHandler = async (c: Context<AppBindings>) => {
  const repoUrl = c.get("harnessRepoUrl");
  try {
    const audit = await checkGithubHarness(repoUrl, { GITHUB_TOKEN: c.env.GITHUB_TOKEN });
    return c.json(audit);
  } catch (error) {
    if (error instanceof HarnessError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json({ error: "INTERNAL_ERROR", message: "The harness audit could not be produced." }, 500);
  }
};

app.post(HARNESS_ENDPOINT, harnessHandler);
app.get(LEGACY_HARNESS_PATH, harnessHandler);

app.get(SKILL_ENDPOINT, async (c) => {
  const repoUrl = c.get("skillRepoUrl");
  const skillPath = c.get("skillPath");
  try {
    const audit = await checkGithubSkill(repoUrl, skillPath, { GITHUB_TOKEN: c.env.GITHUB_TOKEN });
    return c.json(audit);
  } catch (error) {
    if (error instanceof HarnessError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json({ error: "INTERNAL_ERROR", message: "The skill audit could not be produced." }, 500);
  }
});

const runHandler = async (c: Context<AppBindings>) => {
  const runUrl = c.get("runUrl");
  try {
    const diagnosis = await diagnoseGithubRun(runUrl, { GITHUB_TOKEN: c.env.GITHUB_TOKEN });
    return c.json(diagnosis);
  } catch (error) {
    if (error instanceof HarnessError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json({ error: "INTERNAL_ERROR", message: "The workflow run could not be diagnosed." }, 500);
  }
};

app.post(RUN_ENDPOINT, runHandler);
app.get(LEGACY_RUN_PATH, runHandler);

const flakeHandler = async (c: Context<AppBindings>) => {
  const runUrl = c.get("flakeRunUrl");
  const attempt = c.get("flakeAttempt");
  try {
    const verdict = await diagnoseGithubFlake(
      runUrl,
      attempt,
      { GITHUB_TOKEN: c.env.GITHUB_TOKEN },
    );
    return c.json(verdict);
  } catch (error) {
    if (error instanceof FlakeError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json({ error: "INTERNAL_ERROR", message: "The workflow flake classification could not be produced." }, 500);
  }
};

app.post(FLAKE_ENDPOINT, flakeHandler);
app.get(LEGACY_FLAKE_PATH, flakeHandler);

app.post(MCP_DRIFT_ENDPOINT, (c) => c.json(c.get("mcpDriftResult")));

app.post("/api/near-market/:product", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  const product = parseNearMarketProduct(c.req.param("product"));
  if (!product) return c.json({ error: "NOT_FOUND" }, 404);
  const contentType = c.req.header("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return c.json({ error: "INVALID_INPUT", message: "Content-Type must be application/json." }, 400);
  }
  const declaredLength = c.req.header("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > NEAR_MARKET_MAX_BODY_BYTES) {
    return c.json({ error: "INPUT_TOO_LARGE", message: "Request body exceeds 524,288 bytes." }, 413);
  }
  if (!c.env.NEAR_MARKET_RATE_LIMITER) {
    console.error("NEAR Market rate limiter is not configured.");
    return c.json({ error: "SERVICE_CONFIGURATION_ERROR" }, 503);
  }
  const rateLimit = await c.env.NEAR_MARKET_RATE_LIMITER.limit({ key: `near-market:${product}` });
  if (!rateLimit.success) {
    c.header("Retry-After", "60");
    return c.json({ error: "RATE_LIMITED" }, 429);
  }
  try {
    const input = parseNearMarketInput(await c.req.text());
    const output = await fulfillProduct(product, input, {
      GITHUB_TOKEN: c.env.GITHUB_TOKEN,
      FLAKE_RATE_LIMITER: c.env.FLAKE_RATE_LIMITER,
    });
    return c.json(output);
  } catch (error) {
    if (error instanceof CheckError || error instanceof HarnessError || error instanceof FlakeError || error instanceof McpDriftError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    if (error instanceof Error && /must|invalid|too large|empty/i.test(error.message)) {
      return c.json({ error: "INVALID_INPUT", message: error.message }, 400);
    }
    console.error(`NEAR Market ${product} fulfillment failed:`, error instanceof Error ? error.message : "unknown error");
    return c.json({ error: "INTERNAL_ERROR", message: "The marketplace request could not be fulfilled." }, 500);
  }
});

app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));

export default app;
