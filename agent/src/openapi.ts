import { BOUNTY_DISCOVERY_DESCRIPTION, outputSchema, portfolioOutputSchema } from "./discovery.ts";
import { harnessOutputSchema } from "./harness-discovery.ts";
import { SKILL_DISCOVERY_DESCRIPTION, skillOutputSchema } from "./skill-discovery.ts";
import { runOutputSchema } from "./run-discovery.ts";
import { FLAKE_SERVICE_REUSE, flakeOutputSchema } from "./flake-discovery.ts";
import { SERVICE_REUSE } from "./reuse.ts";
import { MCP_DRIFT_SERVICE_REUSE } from "./mcp-drift.ts";
import {
  MCP_DRIFT_DISCOVERY_DESCRIPTION,
  mcpDriftExampleInput,
  mcpDriftInputSchema,
  mcpDriftOutputSchema,
} from "./mcp-drift-discovery.ts";
import {
  THE402_LISTINGS,
  THE402_PROVIDER_CATALOG_URL,
  THE402_SUBSCRIPTION_PLAN,
} from "./the402-catalog.ts";
import {
  NEAR_MARKET_LISTINGS,
  NEAR_MARKET_PROVIDER_URL,
} from "./near-market.ts";

function paymentInfo(price: string) {
  const amount = price.replace(/^\$/, "");
  if (!/^\d+\.\d{2}$/.test(amount)) throw new Error(`Invalid USD price: ${price}`);
  return {
    price: { mode: "fixed", currency: "USD", amount: `${amount}0000` },
    protocols: [{ x402: {} }],
  };
}

const SKILLS_BASE = "https://mimirs402.github.io/bountyverdict/skills/";

function agentMetadata(
  origin: string,
  options: {
    tags: string[];
    samplePath: string;
    skill: string;
    useWhen: string;
    reuse: unknown;
  },
) {
  return {
    tags: options.tags,
    "x-agent-skill": `${SKILLS_BASE}${options.skill}/SKILL.md`,
    "x-use-when": options.useWhen,
    "x-service-reuse": options.reuse,
    "x-free-sample": new URL(options.samplePath, origin).href,
  };
}

export function createOpenApi(
  origin: string,
  network: string,
  prices: { single: string; portfolio: string; harness: string; skill: string; run: string; flake: string; mcpdrift: string },
) {
  return {
    openapi: "3.1.0",
    info: {
      title: "BountyVerdict Agent Decision APIs",
      version: "1.1.10",
      description: "Seven bounded decision APIs for coding agents: evidence-linked GitHub due diligence and diagnostics plus deterministic MCP tool-catalog compatibility and security gates. Payment uses x402 v2 and Base USDC.",
      "x-guidance": "Choose the narrowest operation for the decision at hand, inspect its free sample and unpaid x402 challenge, then pay only when the challenge matches the documented price, Base USDC asset, and operation. Reuse a successful result only according to its service_reuse field.",
      license: { name: "MIT", identifier: "MIT" },
    },
    externalDocs: {
      description: "Agent manifest and activation status",
      url: "https://mimirs402.github.io/bountyverdict/agent-manifest.json",
    },
    tags: [
      { name: "bounty-due-diligence", description: "Decide whether one public GitHub bounty remains worth pursuing." },
      { name: "bounty-ranking", description: "Compare and rank two to ten public GitHub bounty candidates." },
      { name: "agent-instructions", description: "Audit repository instructions used by autonomous coding agents." },
      { name: "skill-security", description: "Audit a public agent skill before installation or execution." },
      { name: "ci-diagnosis", description: "Find the root cause and next action for a public GitHub Actions run." },
      { name: "ci-flake-gate", description: "Decide whether a failed workflow should be retried once or fixed." },
      { name: "mcp-compatibility", description: "Gate MCP tools/list schema changes before an agent upgrade." },
    ],
    servers: [{ url: origin }],
    paths: {
      "/api/sample": {
        get: {
          summary: "Inspect a representative verdict without payment",
          operationId: "getBountyVerdictSample",
          responses: {
            "200": {
              description: "Representative response",
              content: { "application/json": { schema: { type: "object", ...outputSchema } } },
            },
          },
        },
      },
      "/api/bounty-preflight": {
        post: {
          summary: "Check GitHub bounty eligibility and claimability",
          description: BOUNTY_DISCOVERY_DESCRIPTION,
          operationId: "checkBountyVerdict",
          ...agentMetadata(origin, {
            tags: ["bounty-due-diligence"],
            samplePath: "/api/sample",
            skill: "preflight-github-bounties",
            useWhen: "Decide whether one public GitHub bounty is still available and worth pursuing before coding.",
            reuse: SERVICE_REUSE.single,
          }),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    issue_url: {
                      type: "string",
                      pattern: "^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[1-9][0-9]*$",
                      description: "Exact canonical public GitHub issue URL without a query string, fragment, or trailing slash.",
                      example: "https://github.com/typeorm/typeorm/issues/3357",
                    },
                  },
                  required: ["issue_url"],
                  additionalProperties: false,
                },
                example: { issue_url: "https://github.com/typeorm/typeorm/issues/3357" },
              },
            },
          },
          responses: {
            "200": {
              description: "Fresh evidence-linked verdict after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...outputSchema } } },
            },
            "402": { description: "Payment required; inspect the PAYMENT-REQUIRED header. Standard x402 authorizes this resource URL, not the POST body; resend the exact validated body." },
            "400": { description: "Invalid JSON or GitHub issue URL; no payment challenge is issued" },
            "410": { description: "GitHub reports that the issue was deleted; a stale marketplace listing must not be pursued and verified payment is not settled" },
            "413": { description: "Request body exceeds 4,096 bytes; no payment challenge is issued" },
            "502": { description: "GitHub upstream failure; verified payment is not settled" },
            "503": { description: "Temporary capacity or service configuration failure" },
          },
          "x-x402": {
            version: 2,
            scheme: "exact",
            network,
            price: prices.single,
            currency: "USDC",
          },
          "x-payment-info": paymentInfo(prices.single),
        },
      },
      "/api/verdict": {
        get: {
          summary: "Check GitHub bounty eligibility and claimability (legacy GET transport)",
          description: `Deprecated compatibility transport. New agents should call POST /api/bounty-preflight. ${BOUNTY_DISCOVERY_DESCRIPTION}`,
          operationId: "checkBountyVerdictLegacyGet",
          deprecated: true,
          ...agentMetadata(origin, {
            tags: ["bounty-due-diligence"],
            samplePath: "/api/sample",
            skill: "preflight-github-bounties",
            useWhen: "Decide whether one public GitHub bounty is still available and worth pursuing before coding.",
            reuse: SERVICE_REUSE.single,
          }),
          parameters: [{
            name: "issue_url",
            in: "query",
            required: true,
            description: "Canonical public GitHub issue URL",
            schema: {
              type: "string",
              pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+([?#].*)?$",
            },
            example: "https://github.com/typeorm/typeorm/issues/3357",
          }],
          responses: {
            "200": {
              description: "Fresh evidence-linked verdict after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...outputSchema } } },
            },
            "402": { description: "Payment required; inspect the PAYMENT-REQUIRED header" },
            "400": { description: "Invalid GitHub issue URL; verified payment is not settled" },
            "410": { description: "GitHub reports that the issue was deleted; a stale marketplace listing must not be pursued and verified payment is not settled" },
            "502": { description: "GitHub upstream failure; verified payment is not settled" },
            "503": { description: "Temporary capacity or service configuration failure" },
          },
          "x-x402": {
            version: 2,
            scheme: "exact",
            network,
            price: prices.single,
            currency: "USDC",
          },
          "x-payment-info": paymentInfo(prices.single),
        },
      },
      "/api/portfolio/sample": {
        get: {
          summary: "Inspect a representative ranked portfolio without payment",
          operationId: "getBountyPortfolioSample",
          responses: {
            "200": {
              description: "Representative portfolio response",
              content: { "application/json": { schema: { type: "object", ...portfolioOutputSchema } } },
            },
          },
        },
      },
      "/api/portfolio": {
        post: {
          summary: "Rank two to ten GitHub bounty candidates",
          description: "Which GitHub bounty should I work on? Compare two to ten public issue URLs and choose the best candidate. Runs the full due-diligence check for every issue, ranks opportunities, returns per-candidate verdicts and partial failures, and identifies the strongest non-AVOID option. At ten candidates the fixed price is $0.04 per audited candidate.",
          operationId: "rankBountyPortfolio",
          ...agentMetadata(origin, {
            tags: ["bounty-ranking"],
            samplePath: "/api/portfolio/sample",
            skill: "preflight-github-bounties",
            useWhen: "Choose the best candidate from two to ten public GitHub bounty issues.",
            reuse: SERVICE_REUSE.portfolio,
          }),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    issue_urls: {
                      type: "array",
                      minItems: 2,
                      maxItems: 10,
                      uniqueItems: true,
                      default: [
                        "https://github.com/tenstorrent/tt-metal/issues/50522",
                        "https://github.com/typeorm/typeorm/issues/3357",
                      ],
                      example: [
                        "https://github.com/tenstorrent/tt-metal/issues/50522",
                        "https://github.com/typeorm/typeorm/issues/3357",
                      ],
                      items: {
                        type: "string",
                        pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+([?#].*)?$",
                      },
                    },
                  },
                  required: ["issue_urls"],
                  additionalProperties: false,
                },
                example: {
                  issue_urls: [
                    "https://github.com/tenstorrent/tt-metal/issues/50522",
                    "https://github.com/typeorm/typeorm/issues/3357",
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Ranked portfolio after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...portfolioOutputSchema } } },
            },
            "402": { description: "Payment required; inspect the PAYMENT-REQUIRED header" },
            "400": { description: "Invalid portfolio input; verified payment is not settled" },
            "502": { description: "No submitted issue could be checked; verified payment is not settled" },
          },
          "x-x402": {
            version: 2,
            scheme: "exact",
            network,
            price: prices.portfolio,
            currency: "USDC",
          },
          "x-payment-info": paymentInfo(prices.portfolio),
        },
      },
      "/api/harness/sample": {
        get: {
          summary: "Inspect a representative HarnessVerdict audit without payment",
          operationId: "getHarnessVerdictSample",
          responses: {
            "200": {
              description: "Representative instruction-stack audit",
              content: { "application/json": { schema: { type: "object", ...harnessOutputSchema } } },
            },
          },
        },
      },
      "/api/repository-agent-instructions-audit": {
        post: {
          summary: "Audit a public repository's coding-agent instruction stack",
          description: "Pins the repository default branch to a commit and audits recognized AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, and SKILL.md files for structural reliability, portability, stale references, context size, and secret-like material.",
          operationId: "checkHarnessVerdict",
          ...agentMetadata(origin, {
            tags: ["agent-instructions"],
            samplePath: "/api/harness/sample",
            skill: "audit-agent-harness",
            useWhen: "Audit AGENTS.md, CLAUDE.md, and other repository instructions before autonomous coding.",
            reuse: SERVICE_REUSE.harness,
          }),
          requestBody: {
            required: true,
            content: { "application/json": {
              schema: {
                type: "object",
                properties: { repo_url: {
                  type: "string",
                  pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+(\\.git)?$",
                  example: "https://github.com/openai/codex",
                } },
                required: ["repo_url"],
                additionalProperties: false,
              },
              example: { repo_url: "https://github.com/openai/codex" },
            } },
          },
          responses: {
            "200": {
              description: "Commit-pinned evidence-linked harness audit after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...harnessOutputSchema } } },
            },
            "402": { description: "Payment required; standard x402 authorizes this resource URL, not the POST body; resend the exact validated body" },
            "400": { description: "Invalid JSON or repository URL; no payment challenge is issued" },
            "413": { description: "Request body exceeds 4,096 bytes; no payment challenge is issued" },
            "404": { description: "Public repository not found; verified payment is not settled" },
            "502": { description: "GitHub upstream failure; verified payment is not settled" },
            "503": { description: "Temporary capacity or service configuration failure" },
          },
          "x-x402": {
            version: 2,
            scheme: "exact",
            network,
            price: prices.harness,
            currency: "USDC",
          },
          "x-payment-info": paymentInfo(prices.harness),
        },
      },
      "/api/harness": {
        get: {
          summary: "Audit a public repository's coding-agent instruction stack (legacy GET transport)",
          description: "Deprecated compatibility transport. New agents should call POST /api/repository-agent-instructions-audit.",
          operationId: "checkHarnessVerdictLegacyGet",
          deprecated: true,
          ...agentMetadata(origin, {
            tags: ["agent-instructions"], samplePath: "/api/harness/sample", skill: "audit-agent-harness",
            useWhen: "Use only for compatibility; prefer the canonical POST transport.", reuse: SERVICE_REUSE.harness,
          }),
          parameters: [{
            name: "repo_url", in: "query", required: true,
            schema: { type: "string", pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+(\\.git)?$" },
          }],
          responses: {
            "200": { description: "Commit-pinned audit after x402 settlement", content: { "application/json": { schema: { type: "object", ...harnessOutputSchema } } } },
            "402": { description: "Payment required" },
            "400": { description: "Invalid repository URL; no payment challenge is issued" },
          },
          "x-x402": { version: 2, scheme: "exact", network, price: prices.harness, currency: "USDC" },
          "x-payment-info": paymentInfo(prices.harness),
        },
      },
      "/api/skill/sample": {
        get: {
          summary: "Inspect a representative SkillVerdict audit without payment",
          operationId: "getSkillVerdictSample",
          responses: {
            "200": {
              description: "Representative pre-install skill security audit",
              content: { "application/json": { schema: { type: "object", ...skillOutputSchema } } },
            },
          },
        },
      },
      "/api/skill": {
        get: {
          summary: "Audit a public agent skill before installation",
          description: SKILL_DISCOVERY_DESCRIPTION,
          operationId: "checkSkillVerdict",
          ...agentMetadata(origin, {
            tags: ["skill-security"],
            samplePath: "/api/skill/sample",
            skill: "preflight-agent-skills",
            useWhen: "Decide whether a third-party public SKILL.md bundle is safe to install or requires review.",
            reuse: SERVICE_REUSE.skill,
          }),
          parameters: [
            {
              name: "repo_url",
              in: "query",
              required: true,
              description: "Canonical public GitHub repository URL",
              schema: {
                type: "string",
                pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+(\\.git)?$",
                default: "https://github.com/coinbase/agentic-wallet-skills",
                example: "https://github.com/coinbase/agentic-wallet-skills",
              },
              example: "https://github.com/coinbase/agentic-wallet-skills",
            },
            {
              name: "skill_path",
              in: "query",
              required: true,
              description: "Repository-relative skill directory or exact SKILL.md path",
              schema: {
                type: "string",
                pattern: "^[A-Za-z0-9._/-]+$",
                default: "skills/agentic-wallet",
                example: "skills/agentic-wallet",
              },
              example: "skills/agentic-wallet",
            },
          ],
          responses: {
            "200": {
              description: "Commit-pinned redacted skill security audit after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...skillOutputSchema } } },
            },
            "402": { description: "Payment required; inspect the PAYMENT-REQUIRED header" },
            "400": { description: "Invalid repository URL or skill path; verified payment is not settled" },
            "404": { description: "Public repository or skill not found; verified payment is not settled" },
            "502": { description: "GitHub upstream failure; verified payment is not settled" },
            "503": { description: "Temporary capacity or service configuration failure" },
          },
          "x-x402": {
            version: 2,
            scheme: "exact",
            network,
            price: prices.skill,
            currency: "USDC",
          },
          "x-payment-info": paymentInfo(prices.skill),
        },
      },
      "/api/run/sample": {
        get: {
          summary: "Inspect a representative RunVerdict diagnosis without payment",
          operationId: "getRunVerdictSample",
          responses: {
            "200": {
              description: "Representative GitHub Actions diagnosis",
              content: { "application/json": { schema: { type: "object", ...runOutputSchema } } },
            },
          },
        },
      },
      "/api/github-actions-run-diagnosis": {
        post: {
          summary: "Diagnose a public GitHub Actions workflow run",
          description: "Why did this GitHub Actions run fail? Diagnose one completed public workflow URL and explain what the agent should do next. Reads exact-attempt jobs and bounded failed-job logs, separates primary failures from downstream summaries, and returns root cause, retryability, redacted evidence, and concrete next actions without rerunning code.",
          operationId: "diagnoseRunVerdict",
          ...agentMetadata(origin, {
            tags: ["ci-diagnosis"],
            samplePath: "/api/run/sample",
            skill: "diagnose-github-actions",
            useWhen: "When an agent asks why a completed public GitHub Actions run failed and what to do next.",
            reuse: SERVICE_REUSE.run,
          }),
          requestBody: {
            required: true,
            content: { "application/json": {
              schema: {
                type: "object",
                properties: { run_url: {
                  type: "string",
                  pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/actions/runs/[1-9][0-9]*$",
                  example: "https://github.com/openai/codex/actions/runs/29728148711",
                } },
                required: ["run_url"],
                additionalProperties: false,
              },
              example: { run_url: "https://github.com/openai/codex/actions/runs/29728148711" },
            } },
          },
          responses: {
            "200": {
              description: "Bounded evidence-linked run diagnosis after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...runOutputSchema } } },
            },
            "402": { description: "Payment required; standard x402 authorizes this resource URL, not the POST body; resend the exact validated body" },
            "400": { description: "Invalid JSON or workflow run URL; no payment challenge is issued" },
            "413": { description: "Request body exceeds 4,096 bytes; no payment challenge is issued" },
            "404": { description: "Public workflow run not found; verified payment is not settled" },
            "502": { description: "GitHub upstream failure; verified payment is not settled" },
            "503": { description: "Temporary capacity or service configuration failure" },
          },
          "x-x402": { version: 2, scheme: "exact", network, price: prices.run, currency: "USDC" },
          "x-payment-info": paymentInfo(prices.run),
        },
      },
      "/api/run": {
        get: {
          summary: "Diagnose a public GitHub Actions workflow run (legacy GET transport)",
          description: "Deprecated compatibility transport. New agents should call POST /api/github-actions-run-diagnosis.",
          operationId: "diagnoseRunVerdictLegacyGet",
          deprecated: true,
          ...agentMetadata(origin, {
            tags: ["ci-diagnosis"], samplePath: "/api/run/sample", skill: "diagnose-github-actions",
            useWhen: "Use only for compatibility; prefer the canonical POST transport.", reuse: SERVICE_REUSE.run,
          }),
          parameters: [{ name: "run_url", in: "query", required: true, schema: { type: "string", pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/actions/runs/[1-9][0-9]*$" } }],
          responses: {
            "200": { description: "Run diagnosis after x402 settlement", content: { "application/json": { schema: { type: "object", ...runOutputSchema } } } },
            "402": { description: "Payment required" },
            "400": { description: "Invalid workflow run URL; no payment challenge is issued" },
          },
          "x-x402": { version: 2, scheme: "exact", network, price: prices.run, currency: "USDC" },
          "x-payment-info": paymentInfo(prices.run),
        },
      },
      "/api/flake/sample": {
        get: {
          summary: "Inspect a representative FlakeVerdict retry decision without payment",
          operationId: "getFlakeVerdictSample",
          responses: {
            "200": {
              description: "Representative bounded flake classification",
              content: { "application/json": { schema: flakeOutputSchema } },
            },
          },
        },
      },
      "/api/github-actions-flake-retry-gate": {
        post: {
          summary: "Classify a public GitHub Actions failure before retrying",
          description: "Should I rerun this failed GitHub Actions workflow or fix the code? Decide whether one completed public run is flaky and merits exactly one retry, or is recurring or new and needs a fix. Compares exact attempts, same-commit outcomes, failed-step fingerprints, and bounded historical runs without rerunning CI.",
          operationId: "classifyFlakeVerdict",
          ...agentMetadata(origin, {
            tags: ["ci-flake-gate"],
            samplePath: "/api/flake/sample",
            skill: "classify-github-flakes",
            useWhen: "When an agent must decide whether to rerun one completed failed GitHub Actions workflow or fix the code.",
            reuse: FLAKE_SERVICE_REUSE,
          }),
          requestBody: {
            required: true,
            content: { "application/json": {
              schema: {
                type: "object",
                properties: {
                  run_url: {
                    type: "string",
                    pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/actions/runs/[1-9][0-9]*$",
                    example: "https://github.com/actions/runner/actions/runs/29423388605",
                  },
                  attempt: { type: "integer", minimum: 1 },
                },
                required: ["run_url"],
                additionalProperties: false,
              },
              example: { run_url: "https://github.com/actions/runner/actions/runs/29423388605", attempt: 1 },
            } },
          },
          responses: {
            "200": {
              description: "Bounded evidence-linked flake classification after x402 settlement",
              content: { "application/json": { schema: flakeOutputSchema } },
            },
            "402": { description: "Payment required; standard x402 authorizes this resource URL, not the POST body; resend the exact validated body" },
            "400": { description: "Invalid JSON, workflow run URL, or attempt; no payment challenge is issued" },
            "413": { description: "Request body exceeds 4,096 bytes; no payment challenge is issued" },
            "404": { description: "Public workflow run or requested attempt not found; verified payment is not settled" },
            "429": { description: "Bounded upstream capacity exhausted; verified payment is not settled" },
            "502": { description: "GitHub upstream failure; verified payment is not settled" },
            "503": { description: "Temporary capacity, deadline, or service configuration failure; verified payment is not settled" },
          },
          "x-x402": { version: 2, scheme: "exact", network, price: prices.flake, currency: "USDC" },
          "x-payment-info": paymentInfo(prices.flake),
        },
      },
      "/api/flake": {
        get: {
          summary: "Classify a public GitHub Actions failure before retrying (legacy GET transport)",
          description: "Deprecated compatibility transport. New agents should call POST /api/github-actions-flake-retry-gate.",
          operationId: "classifyFlakeVerdictLegacyGet",
          deprecated: true,
          ...agentMetadata(origin, {
            tags: ["ci-flake-gate"], samplePath: "/api/flake/sample", skill: "classify-github-flakes",
            useWhen: "Use only for compatibility; prefer the canonical POST transport.", reuse: FLAKE_SERVICE_REUSE,
          }),
          parameters: [
            { name: "run_url", in: "query", required: true, schema: { type: "string", pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/actions/runs/[1-9][0-9]*$" } },
            { name: "attempt", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
          ],
          responses: {
            "200": { description: "Flake classification after x402 settlement", content: { "application/json": { schema: flakeOutputSchema } } },
            "402": { description: "Payment required" },
            "400": { description: "Invalid workflow run URL or attempt; no payment challenge is issued" },
            "429": { description: "Bounded upstream capacity exhausted; verified payment is not settled" },
          },
          "x-x402": { version: 2, scheme: "exact", network, price: prices.flake, currency: "USDC" },
          "x-payment-info": paymentInfo(prices.flake),
        },
      },
      "/api/mcp-drift/sample": {
        get: {
          summary: "Inspect a representative MCPDriftVerdict result without payment",
          operationId: "getMcpDriftVerdictSample",
          responses: {
            "200": {
              description: "Representative deterministic MCP tool-catalog drift verdict",
              content: { "application/json": { schema: mcpDriftOutputSchema } },
            },
          },
        },
      },
      "/api/mcp-drift": {
        post: {
          summary: "Check MCP schema drift and tools/list compatibility",
          description: `${MCP_DRIFT_DISCOVERY_DESCRIPTION} Invalid or unsupported inputs fail unpaid.`,
          operationId: "checkMcpToolDrift",
          ...agentMetadata(origin, {
            tags: ["mcp-compatibility"],
            samplePath: "/api/mcp-drift/sample",
            skill: "check-mcp-tool-drift",
            useWhen: "Decide whether an MCP tools/list schema change will break an agent after a server upgrade.",
            reuse: MCP_DRIFT_SERVICE_REUSE,
          }),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  ...mcpDriftInputSchema,
                  properties: {
                    ...mcpDriftInputSchema.properties,
                    subject: { ...mcpDriftInputSchema.properties.subject, example: mcpDriftExampleInput.subject },
                    baseline: { ...mcpDriftInputSchema.properties.baseline, example: mcpDriftExampleInput.baseline },
                    current: { ...mcpDriftInputSchema.properties.current, example: mcpDriftExampleInput.current },
                  },
                },
                example: mcpDriftExampleInput,
              },
            },
          },
          responses: {
            "200": {
              description: "Precomputed deterministic drift verdict after x402 settlement",
              headers: {
                "X-MCP-Drift-Baseline-Snapshot": { schema: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } },
                "X-MCP-Drift-Current-Snapshot": { schema: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } },
                "X-MCP-Drift-Ruleset-Version": { schema: { type: "string", const: "2026-07-20.1" } },
              },
              content: { "application/json": { schema: mcpDriftOutputSchema } },
            },
            "400": { description: "Malformed, incomplete, duplicate, or out-of-contract input; no payment challenge is emitted" },
            "413": { description: "Request body exceeds 524,288 bytes; no payment challenge is emitted" },
            "422": { description: "Unsupported schema dialect or feature; no payment challenge is emitted" },
            "402": {
              description: "Valid verdict is ready; payment required to return it. Snapshot/ruleset headers identify the precomputed result; standard x402 authorizes the resource URL, not the POST body.",
              headers: {
                "X-MCP-Drift-Baseline-Snapshot": { schema: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } },
                "X-MCP-Drift-Current-Snapshot": { schema: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } },
                "X-MCP-Drift-Ruleset-Version": { schema: { type: "string", const: "2026-07-20.1" } },
              },
            },
            "500": { description: "Verdict computation failed before payment; no settlement is attempted" },
          },
          "x-x402": { version: 2, scheme: "exact", network, price: prices.mcpdrift, currency: "USDC" },
          "x-payment-info": paymentInfo(prices.mcpdrift),
        },
      },
    },
  };
}

export function createLlmsText(origin: string): string {
  const the402Services = THE402_LISTINGS.map((listing) =>
    `- ${listing.name}: POST https://api.the402.ai/v1/services/${listing.service_id}/purchase — agent price ${listing.agent_price} USDC; instant fulfillment`,
  ).join("\n");
  const nearMarketServices = NEAR_MARKET_LISTINGS.map((listing) =>
    `- ${listing.name}: hire https://market.near.ai/hire?service_id=${listing.service_id}; authenticated POST https://market.near.ai/v1/services/${listing.service_id}/invoke — ${listing.price_amount} ${listing.price_token}`,
  ).join("\n");
  return `# BountyVerdict Agent Decision APIs

> Seven bounded checks for public GitHub decisions and MCP tool-catalog upgrade safety.

## Decide if this tool is useful

- Free representative result: ${origin}/api/sample
- x402 seller manifest: ${origin}/.well-known/x402
- OpenAPI 3.1 contract: ${origin}/openapi.json
- Remote MCP server: ${origin}/mcp (MCP 2025-11-25 Streamable HTTP; six paid read-only tools; SkillVerdict excluded)
- MCP endpoint metadata: ${origin}/.well-known/mcp.json
- MCP server card: ${origin}/.well-known/mcp/server-card.json
- RFC 9727 API catalog: ${origin}/.well-known/api-catalog
- Integration declaration: ${origin}/.well-known/integrations.json
- Agentic Resource Discovery catalog: ${origin}/.well-known/ai-catalog.json (six neutral representative queries; publication is not proof of third-party indexing)
- MCP Registry name: io.github.Mimirs402/bountyverdict
- Client-specific MCP install and paid-call guide: https://mimirs402.github.io/bountyverdict/llms-install.md
- A remote MCP connection does not provide a wallet; direct automatic payment requires an x402-aware MCP client such as @x402/mcp
- Every valid unpaid MCP call includes io.github.Mimirs402/bountyverdict/http-payment-handoff with the equivalent exact HTTP x402 request for an authorized wallet
- Umbrella routing skill: https://mimirs402.github.io/bountyverdict/skills/route-github-agent-checks/SKILL.md
- Install router: npx skills add Mimirs402/bountyverdict --skill route-github-agent-checks -y
- Install all operating skills: npx skills add Mimirs402/bountyverdict --skill '*' -y
- Paid check: POST ${origin}/api/bounty-preflight with {"issue_url":"<EXACT_PUBLIC_GITHUB_ISSUE_URL>"}
- Deprecated compatibility transport: GET ${origin}/api/verdict?issue_url=<PUBLIC_GITHUB_ISSUE_URL>
- Price: $0.05 USDC per successful result through x402 v2
- Free portfolio sample: ${origin}/api/portfolio/sample
- Paid portfolio: POST ${origin}/api/portfolio with {"issue_urls":[...]} for $0.40 USDC
- Portfolio size: 2 to 10 unique public GitHub issue URLs
- Verdicts: AVOID, CAUTION, VIABLE
- Free HarnessVerdict sample: ${origin}/api/harness/sample
- Paid HarnessVerdict: POST ${origin}/api/repository-agent-instructions-audit with {"repo_url":"<PUBLIC_GITHUB_REPOSITORY_URL>"}
- Deprecated HarnessVerdict transport: GET ${origin}/api/harness?repo_url=<PUBLIC_GITHUB_REPOSITORY_URL>
- HarnessVerdict price: $0.03 USDC per successful commit-pinned audit
- Harness verdicts: READY, REVIEW, REPAIR
- Free SkillVerdict sample: ${origin}/api/skill/sample
- Paid SkillVerdict: GET ${origin}/api/skill?repo_url=<PUBLIC_GITHUB_REPOSITORY_URL>&skill_path=<SKILL_DIRECTORY>
- SkillVerdict price: $0.06 USDC per successful commit-pinned pre-install audit
- Skill verdicts: LOW_RISK, REVIEW, BLOCK
- Free RunVerdict sample: ${origin}/api/run/sample
- Paid RunVerdict: POST ${origin}/api/github-actions-run-diagnosis with {"run_url":"<PUBLIC_GITHUB_ACTIONS_RUN_URL>"}
- Deprecated RunVerdict transport: GET ${origin}/api/run?run_url=<PUBLIC_GITHUB_ACTIONS_RUN_URL>
- RunVerdict price: $0.04 USDC per bounded exact-attempt diagnosis
- Run verdicts: PASS, WAIT, RETRY, FIX, INVESTIGATE
- Free FlakeVerdict sample: ${origin}/api/flake/sample
- Paid FlakeVerdict: POST ${origin}/api/github-actions-flake-retry-gate with {"run_url":"<PUBLIC_GITHUB_ACTIONS_RUN_URL>","attempt":<OPTIONAL_EXACT_ATTEMPT>}
- Deprecated FlakeVerdict transport: GET ${origin}/api/flake?run_url=<PUBLIC_GITHUB_ACTIONS_RUN_URL>&attempt=<OPTIONAL_EXACT_ATTEMPT>
- FlakeVerdict price: $0.07 USDC per bounded historical retry decision
- Flake verdicts: CONFIRMED_FLAKE, LIKELY_FLAKE, RECURRING_FAILURE, NEW_FAILURE, INCONCLUSIVE, NOT_FAILED
- Free MCPDriftVerdict sample: ${origin}/api/mcp-drift/sample
- Paid MCPDriftVerdict: POST ${origin}/api/mcp-drift with complete MCP 2025-11-25 baseline and current tools/list snapshots
- MCPDriftVerdict price: $0.02 USDC per precomputed deterministic result
- MCPDriftVerdict verdicts: UNCHANGED, SAFE_ADDITIVE, REVIEW, INCONCLUSIVE, BREAKING, SECURITY_REGRESSION
- MCPDriftVerdict validates and computes before payment; unsupported or invalid catalogs receive no 402 challenge
- Failed or invalid checks are not settled
- Every successful result includes explicit service_reuse guidance so agents know when to call the same reliable bounded check again

## Escrow marketplace

- Public the402 provider catalog: ${THE402_PROVIDER_CATALOG_URL}
- These six routes offer the same tested products through the402 escrow; inspect each exact input and deliverable schema in the public catalog before purchase.
- SkillVerdict is intentionally excluded from this marketplace while its earned-placement experiment is frozen.
- Monthly bundle: POST https://api.the402.ai/v1/plans/${THE402_SUBSCRIPTION_PLAN.plan_id}/subscribe — $${THE402_SUBSCRIPTION_PLAN.agent_price_usd.toFixed(2)} USDC for up to ${THE402_SUBSCRIPTION_PLAN.max_requests} combined requests across the six listed services.
${the402Services}

## NEAR Agent Market

- Public provider profile: ${NEAR_MARKET_PROVIDER_URL}
- These six automated services expose the same tested input and output contracts through NEAR Agent Market; SkillVerdict remains excluded during its frozen experiment.
${nearMarketServices}

## Differentiation

BountyVerdict checks the first and newest bounded comment windows, up to four bounded timeline pages, current Algora status tables, exact BountyHub records and pledge-level prepaid-versus-promised funding when an issue references that platform, non-cash reward denomination drift, one explicitly linked external GitHub source issue, rewarded labels, competing and failed PRs, attempt swarms, issue locks, repository state, explicit maintainer rejection, reward-withdrawal language, and conventional contribution-document paths for AI-work bans or disclosure requirements. BountyHub creator approval remains required and platform-held funds are not a payout guarantee. The check reports truncation explicitly and never returns VIABLE from incomplete evidence. Important signals include public evidence URLs and coverage counts.

The portfolio product runs the full check on every submitted candidate, ranks VIABLE before CAUTION before AVOID, recommends the strongest candidate, and reports partial upstream failures.

HarnessVerdict audits the repository's recognized coding-agent instruction surfaces without cloning or executing its code. It reports stale path references, oversized always-loaded context, machine-local paths, malformed skill frontmatter, secret-like material, and client portability across Codex, Claude Code, Gemini CLI, GitHub Copilot, and Cursor. Every result is pinned to the audited commit SHA.

SkillVerdict audits a requested public SKILL.md plus its bounded directory and repository context without execution. It detects high-confidence supply-chain hazards, redacts secret-like values, discloses observed capabilities and external domains, and pins every finding to the exact reviewed commit. LOW_RISK is not a safety guarantee; retain least privilege and inspect coverage before installation.

RunVerdict diagnoses one public GitHub Actions run from exact-attempt job metadata and bounded failed-job logs. It distinguishes primary failures from downstream summary jobs, returns redacted evidence and root-cause families, and recommends whether to fix, investigate, wait, or retry without mutating CI.

FlakeVerdict is the read-only retry gate before RunVerdict: it compares the selected attempt with same-run, same-SHA, and bounded historical workflow evidence. Only a currently failed CONFIRMED_FLAKE may recommend one retry; likely, recurring, new, and inconclusive evidence never authorizes an automatic rerun.

MCPDriftVerdict compares two inline, complete caller-supplied MCP 2025-11-25 tools/list snapshots. It canonicalizes and hashes both snapshots, proves only a conservative JSON Schema 2020-12 subset, reverses variance for output schemas, and blocks declared safety-hint regressions. Tool descriptions, schemas, icons, and metadata are untrusted data; the service never fetches, installs, invokes, or follows anything in a catalog.

## Safety

A VIABLE result means investigate further. It does not guarantee a reward, merge, eligibility, or payment.
`;
}
