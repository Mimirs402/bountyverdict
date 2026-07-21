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
import { PRODUCT_CATALOG } from "./product-catalog.ts";
import { createX402ServiceManifest } from "./x402-service-manifest.ts";
import { createMcpWellKnown, createOriginAgentManifest, createOriginSkillMarkdown } from "./origin-discovery.ts";
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
const PORTFOLIO_MAX_BODY_BYTES = 16 * 1024;

const INPUT_GUIDANCE = Object.freeze({
  single: {
    product: "BountyVerdict",
    method: "GET",
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
    method: "GET",
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
    method: "GET",
    required: ["run_url"],
    example: { run_url: "https://github.com/owner/repository/actions/runs/123456789" },
  },
  flake: {
    product: "FlakeVerdict",
    method: "GET",
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

type PreflightProduct = keyof typeof INPUT_GUIDANCE;

function preflightFailure(
  c: Context<AppBindings>,
  product: PreflightProduct,
  code: string,
  message: string,
  status: 400 | 413 | 422 | 429 | 503 = 400,
  details: Record<string, unknown> = {},
) {
  const origin = new URL(c.req.url).origin;
  const guidance = INPUT_GUIDANCE[product];
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
  product: string;
  price: string;
  description: string;
  useWhen: string;
  notFor: string;
  decisionReturned: string[];
  whyPay: string;
  samplePath: string;
  skillName: string;
  method: "GET" | "POST";
};

async function unpaidDecisionBody(preview: UnpaidDecisionPreview, context: HTTPRequestContext) {
  const requestHint = preview.method === "GET"
    ? "Use the exact request URL, including its encoded query string."
    : "Use POST with the intended validated JSON body. Standard x402 authorizes the resource URL, not the POST body; review the normalized body hash and resend the same JSON on the signed retry.";
  const requestUrl = context.adapter.getUrl();
  const requestBody = preview.method === "POST" && context.adapter.getBody
    ? await context.adapter.getBody()
    : undefined;
  const maxAmountAtomic = String(Math.round(Number(preview.price.replace(/^\$/, "")) * 1_000_000));
  if (preview.method === "POST" && requestBody === undefined) {
    throw new Error(`Validated POST body is unavailable for ${preview.product}; refusing to construct a payment challenge.`);
  }
  const awalArgv = ["awal@2.12.0", "x402", "pay", requestUrl];
  const normalizedBodyJson = requestBody === undefined ? undefined : JSON.stringify(requestBody);
  const normalizedBodySha256 = normalizedBodyJson === undefined
    ? undefined
    : `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedBodyJson)))]
      .map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  if (preview.method === "POST") {
    awalArgv.push("-X", "POST");
    if (normalizedBodyJson !== undefined) awalArgv.push("-d", normalizedBodyJson);
  }
  awalArgv.push("--max-amount", maxAmountAtomic, "--json");
  return {
    contentType: "application/json",
    body: {
      error: "PAYMENT_REQUIRED",
      product: preview.product,
      price: preview.price,
      currency: "USDC",
      description: preview.description,
      use_when: preview.useWhen,
      not_for: preview.notFor,
      decision_returned: preview.decisionReturned,
      why_pay: preview.whyPay,
      free_sample: preview.samplePath,
      skill: `${SKILLS_URL}${preview.skillName}/SKILL.md`,
      documentation: `${PRODUCT_URL}agents.html`,
      payment: {
        protocol: "x402 v2",
        network: "Base",
        asset: "USDC",
        max_amount_atomic: maxAmountAtomic,
        inspect_challenge_before_signing: true,
        request_binding: requestHint,
        exact_request: {
          method: preview.method,
          url: requestUrl,
          ...(requestBody === undefined ? {} : { body: requestBody }),
          ...(normalizedBodySha256 === undefined ? {} : { normalized_body_sha256: normalizedBodySha256 }),
        },
        authorization_scope: preview.method === "POST" ? "resource_url_not_post_body" : "resource_url",
        agentic_wallet: {
          executable: "npx",
          argv: awalArgv,
          execute_as_argument_vector: true,
          do_not_join_into_shell_string: true,
        },
        retry_semantics: {
          reuse_exact_method_url_and_body: true,
          payment_header: "Payment-Signature",
          expected_success_status: 200,
          never_raise_max_amount_without_new_authorization: true,
        },
        execution_risk: "Input shape is validated before payment. Third-party GitHub availability or state can still change after settlement; a payment does not guarantee upstream success.",
      },
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
    description: BOUNTY_DISCOVERY_DESCRIPTION,
    mimeType: "application/json",
    serviceName: "BountyVerdict",
    tags: ["github", "bounty", "eligibility", "claimability", "already-claimed", "assignment-status", "due-diligence"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      product: "BountyVerdict",
      price: SINGLE_PRICE_USD,
      description: "Pay once to receive a fresh evidence-linked bounty risk verdict.",
      useWhen: "Before coding one public GitHub bounty issue.",
      notFor: "Private repositories or payout guarantees.",
      decisionReturned: ["AVOID", "CAUTION", "VIABLE"],
      whyPay: "Checks withdrawn rewards, maintainer rejection, competing pull requests, failed-attempt saturation, and repository AI-contribution policy in one bounded pass.",
      samplePath: "/api/sample",
      skillName: "preflight-github-bounties",
      method: "GET",
    }, context),
  };
  const portfolioRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: PORTFOLIO_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: "Compare two to ten public GitHub bounties and choose the best candidate to work on. Runs the full due-diligence check for every issue, ranks opportunities, returns per-candidate verdicts and partial failures, and identifies the strongest non-AVOID option in one call.",
    mimeType: "application/json",
    serviceName: "BountyVerdict Portfolio",
    tags: ["compare-bounties", "best-candidate", "candidate-selection", "opportunity-ranking", "github-bounties", "portfolio"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      product: "BountyVerdict Portfolio",
      price: PORTFOLIO_PRICE_USD,
      description: "Pay once to rank up to ten bounty candidates with full evidence-linked verdicts.",
      useWhen: "When choosing among two to ten public GitHub bounty candidates.",
      notFor: "One candidate, duplicate issue URLs, or private issues.",
      decisionReturned: ["ranked_verdicts", "best_candidate", "counts", "partial_failures"],
      whyPay: "One call performs two to ten full audits; at ten candidates the fixed price is $0.04 per candidate.",
      samplePath: "/api/portfolio/sample",
      skillName: "preflight-github-bounties",
      method: "POST",
    }, context),
  };
  const harnessRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: HARNESS_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: "Audit a public GitHub repository's coding-agent instruction stack at an immutable commit. Maps AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, and SKILL.md coverage; flags stale paths, oversized context, machine-local references, malformed skills, and secret-like material with evidence-linked fixes.",
    mimeType: "application/json",
    serviceName: "HarnessVerdict",
    tags: ["github", "agents-md", "claude-md", "agent-harness", "developer-tools", "lint"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      product: "HarnessVerdict",
      price: HARNESS_PRICE_USD,
      description: "Pay once for a commit-pinned, evidence-linked repository instruction audit.",
      useWhen: "Before autonomous coding in a public GitHub repository.",
      notFor: "Generic code quality review or private repositories.",
      decisionReturned: ["READY", "REVIEW", "REPAIR"],
      whyPay: "Maps AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, and SKILL.md coverage at an immutable commit and returns evidence-linked fixes.",
      samplePath: "/api/harness/sample",
      skillName: "audit-agent-harness",
      method: "GET",
    }, context),
  };
  const skillRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: SKILL_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: "Pre-install security audit for a public agent SKILL.md bundle. Pins the repository to a commit, scans the whole skill directory without executing it, uses repository context to reduce false positives, and flags credential exfiltration, remote or encoded execution, destructive commands, persistence, privilege escalation, instruction evasion, hidden scripts, symlinks, submodules, hardcoded secrets, and undeclared capabilities.",
    mimeType: "application/json",
    serviceName: "SkillVerdict",
    tags: ["agent-skills", "skill-md", "security", "supply-chain", "prompt-injection", "pre-install"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      product: "SkillVerdict",
      price: SKILL_PRICE_USD,
      description: "Pay once for a commit-pinned, non-executing security audit before installing a public agent skill.",
      useWhen: "Before installing or running a third-party public SKILL.md bundle.",
      notFor: "Runtime sandboxing, private skills, or a guarantee that code is safe.",
      decisionReturned: ["LOW_RISK", "REVIEW", "BLOCK"],
      whyPay: "Scans the whole pinned skill directory for credential theft, remote execution, destructive actions, persistence, privilege escalation, hidden files, and undeclared capabilities without executing it.",
      samplePath: "/api/skill/sample",
      skillName: "preflight-agent-skills",
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
    description: "Find why one public GitHub Actions workflow failed and what the agent should do next. Reads exact-attempt jobs and bounded failed-job logs, separates primary failures from downstream summaries, and returns root cause, retryability, redacted evidence, and concrete next actions without rerunning code.",
    mimeType: "application/json",
    serviceName: "RunVerdict",
    tags: ["workflow-failure", "why-failed", "root-cause", "failed-run", "next-action", "github-actions"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      product: "RunVerdict",
      price: RUN_PRICE_USD,
      description: "Pay once to learn why a public GitHub Actions run failed and what to do next.",
      useWhen: "After a failed run when the agent needs root cause and next action.",
      notFor: "The narrower retry-once-versus-fix flake decision.",
      decisionReturned: ["PASS", "WAIT", "RETRY", "FIX", "INVESTIGATE"],
      whyPay: "Reads exact-attempt jobs and bounded failed-job logs, separates primary failures from downstream summaries, and returns redacted evidence without rerunning code.",
      samplePath: "/api/run/sample",
      skillName: "diagnose-github-actions",
      method: "GET",
    }, context),
  };
  const flakeRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: FLAKE_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: "Decide whether a completed GitHub Actions failure is flaky and should be retried once, or is recurring or new and needs a fix. Compares exact workflow attempts, same-commit outcomes, failed-step fingerprints, and bounded historical runs, then returns a retry-or-fix decision without rerunning CI.",
    mimeType: "application/json",
    serviceName: "FlakeVerdict",
    tags: ["flaky-ci", "should-i-retry", "retry-or-fix", "workflow-attempts", "historical-run-comparison", "github-actions"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      product: "FlakeVerdict",
      price: FLAKE_PRICE_USD,
      description: "Pay once to decide whether one public GitHub Actions failure merits exactly one retry or needs a fix.",
      useWhen: "After a completed failed run when the decision is retry once versus fix.",
      notFor: "Root-cause diagnosis; use RunVerdict when the question is why the run failed.",
      decisionReturned: ["CONFIRMED_FLAKE", "LIKELY_FLAKE", "RECURRING_FAILURE", "NEW_FAILURE", "INCONCLUSIVE", "NOT_FAILED"],
      whyPay: "Compares exact attempts, same-commit outcomes, failed-step fingerprints, and bounded historical runs to avoid a wasted CI rerun.",
      samplePath: PRODUCT_CATALOG.flake.samplePath,
      skillName: "classify-github-flakes",
      method: "GET",
    }, context),
  };
  const mcpDriftRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: MCP_DRIFT_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: MCP_DRIFT_DISCOVERY_DESCRIPTION,
    mimeType: "application/json",
    serviceName: "MCPDriftVerdict",
    tags: ["mcp", "tools-list", "schema-drift", "breaking-change", "agent-compatibility", "server-upgrade", "required-argument"],
    iconUrl: ICON_URL,
    unpaidResponseBody: (context) => unpaidDecisionBody({
      product: "MCPDriftVerdict",
      price: MCP_DRIFT_PRICE_USD,
      description: "Pay once to receive the already-computed compatibility verdict for this exact MCP tools/list snapshot pair.",
      useWhen: "After a complete MCP tools/list change and before an agent accepts the server upgrade.",
      notFor: "Malware or prompt-injection scanning, private catalogs, or invoking MCP tools.",
      decisionReturned: ["UNCHANGED", "SAFE_ADDITIVE", "REVIEW", "INCONCLUSIVE", "BREAKING", "SECURITY_REGRESSION"],
      whyPay: "Provides an exact-hash structural compatibility gate for removed tools, new required arguments, incompatible schemas, and model-facing safety regressions.",
      samplePath: PRODUCT_CATALOG.mcpdrift.samplePath,
      skillName: "check-mcp-tool-drift",
      method: "POST",
    }, context),
  };
  const middleware = paymentMiddleware(
    {
      [`GET ${SINGLE_ENDPOINT}`]: routeConfig,
      [`POST ${PORTFOLIO_ENDPOINT}`]: portfolioRouteConfig,
      [`GET ${HARNESS_ENDPOINT}`]: harnessRouteConfig,
      [`GET ${SKILL_ENDPOINT}`]: skillRouteConfig,
      [`GET ${RUN_ENDPOINT}`]: runRouteConfig,
      [`GET ${FLAKE_ENDPOINT}`]: flakeRouteConfig,
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
        method: "GET",
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
        method: "GET",
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
        method: "GET",
        use_when: "Diagnose the root cause and next action for one public workflow run.",
        skill: `${SKILLS_URL}diagnose-github-actions/SKILL.md`,
        input: { run_url: "https://github.com/owner/repository/actions/runs/123456789" },
      },
      {
        name: "FlakeVerdict",
        price: FLAKE_PRICE_USD,
        endpoint: FLAKE_ENDPOINT,
        method: "GET",
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
  if (c.req.method !== "GET") return await next();
  try {
    const parsed = parseRepositoryUrl(c.req.query("repo_url") || "");
    c.set("harnessRepoUrl", `https://github.com/${parsed.owner}/${parsed.repo}`);
    return await next();
  } catch (error) {
    return preflightFailure(c, "harness", "INVALID_REPOSITORY_URL", error instanceof Error ? error.message : "repo_url is invalid.");
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
  if (c.req.method !== "GET") return await next();
  try {
    const parsed = parseRunUrl(c.req.query("run_url") || "");
    c.set("runUrl", `https://github.com/${parsed.owner}/${parsed.repo}/actions/runs/${parsed.runId}`);
    return await next();
  } catch (error) {
    return preflightFailure(c, "run", "INVALID_RUN_URL", error instanceof Error ? error.message : "run_url is invalid.");
  }
};

const flakePreflight: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== "GET") return await next();
  try {
    const parsed = parseRunUrl(c.req.query("run_url") || "");
    c.set("flakeRunUrl", `https://github.com/${parsed.owner}/${parsed.repo}/actions/runs/${parsed.runId}`);
    c.set("flakeAttempt", parseFlakeAttempt(c.req.query("attempt")));
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

app.use(SINGLE_ENDPOINT, singlePreflight);
app.use(PORTFOLIO_ENDPOINT, portfolioPreflight);
app.use(HARNESS_ENDPOINT, harnessPreflight);
app.use(SKILL_ENDPOINT, skillPreflight);
app.use(RUN_ENDPOINT, runPreflight);
app.use(FLAKE_ENDPOINT, flakePreflight);
app.use(SINGLE_ENDPOINT, paymentGate);
app.use(PORTFOLIO_ENDPOINT, paymentGate);
app.use(HARNESS_ENDPOINT, paymentGate);
app.use(SKILL_ENDPOINT, paymentGate);
app.use(RUN_ENDPOINT, paymentGate);
app.use(FLAKE_ENDPOINT, paymentGate);

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

app.get(SINGLE_ENDPOINT, async (c) => {
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
});

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

app.get(HARNESS_ENDPOINT, async (c) => {
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
});

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

app.get(RUN_ENDPOINT, async (c) => {
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
});

app.get(FLAKE_ENDPOINT, async (c) => {
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
});

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
