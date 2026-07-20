import { outputSchema, portfolioOutputSchema } from "./discovery.ts";
import { harnessOutputSchema } from "./harness-discovery.ts";
import { skillOutputSchema } from "./skill-discovery.ts";
import { runOutputSchema } from "./run-discovery.ts";
import { flakeOutputSchema } from "./flake-discovery.ts";

export function createOpenApi(
  origin: string,
  network: string,
  prices: { single: string; portfolio: string; harness: string; skill: string; run: string; flake: string },
) {
  return {
    openapi: "3.1.0",
    info: {
      title: "BountyVerdict Agent API",
      version: "1.0.0",
      description: "Evidence-linked GitHub bounty due diligence for autonomous coding agents. Payment uses x402 v2 and USDC.",
      license: { name: "MIT", identifier: "MIT" },
    },
    externalDocs: {
      description: "Agent manifest and activation status",
      url: "https://cristianmoroaica.github.io/bountyverdict/agent-manifest.json",
    },
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
      "/api/verdict": {
        get: {
          summary: "Deep-preflight a public GitHub bounty issue",
          description: "Checks issue and repository state, competition and failed-attempt swarms, maintainer rejection, reward withdrawal, and official AI-contribution policy. Successful calls cost $0.05 USDC through x402.",
          operationId: "checkBountyVerdict",
          parameters: [{
            name: "issue_url",
            in: "query",
            required: true,
            description: "Canonical public GitHub issue URL",
            schema: {
              type: "string",
              pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+(?:[?#].*)?$",
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
          description: "Runs the full evidence-linked preflight on each candidate with concurrency limits, ranks viable work first, and preserves partial results when an upstream issue is unavailable.",
          operationId: "rankBountyPortfolio",
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
                      items: {
                        type: "string",
                        pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+(?:[?#].*)?$",
                      },
                    },
                  },
                  required: ["issue_urls"],
                  additionalProperties: false,
                },
                example: {
                  issue_urls: [
                    "https://github.com/acme/widget/issues/12",
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
      "/api/harness": {
        get: {
          summary: "Audit a public repository's coding-agent instruction stack",
          description: "Pins the repository default branch to a commit and audits recognized AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, and SKILL.md files for structural reliability, portability, stale references, context size, and secret-like material.",
          operationId: "checkHarnessVerdict",
          parameters: [{
            name: "repo_url",
            in: "query",
            required: true,
            description: "Canonical public GitHub repository URL",
            schema: {
              type: "string",
              pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+(?:\\.git)?$",
            },
            example: "https://github.com/openai/codex",
          }],
          responses: {
            "200": {
              description: "Commit-pinned evidence-linked harness audit after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...harnessOutputSchema } } },
            },
            "402": { description: "Payment required; inspect the PAYMENT-REQUIRED header" },
            "400": { description: "Invalid repository URL; verified payment is not settled" },
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
          description: "Pins the repository default branch to a commit and statically scans the requested SKILL.md plus its bounded directory context without executing code. Returns redacted findings, capabilities, domains, coverage, and a LOW_RISK, REVIEW, or BLOCK verdict.",
          operationId: "checkSkillVerdict",
          parameters: [
            {
              name: "repo_url",
              in: "query",
              required: true,
              description: "Canonical public GitHub repository URL",
              schema: { type: "string", pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+(?:\\.git)?$" },
              example: "https://github.com/coinbase/agentic-wallet-skills",
            },
            {
              name: "skill_path",
              in: "query",
              required: true,
              description: "Repository-relative skill directory or exact SKILL.md path",
              schema: { type: "string", pattern: "^[A-Za-z0-9._/-]+$" },
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
      "/api/run": {
        get: {
          summary: "Diagnose a public GitHub Actions workflow run",
          description: "Reads exact-attempt job metadata and bounded failed-job logs without executing or rerunning code. Separates primary failures from aggregate result jobs, redacts secret-like evidence, classifies root-cause families, and returns retryability plus next actions.",
          operationId: "diagnoseRunVerdict",
          parameters: [{
            name: "run_url",
            in: "query",
            required: true,
            description: "Canonical public GitHub Actions workflow run URL",
            schema: { type: "string", pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/actions/runs/[1-9][0-9]*$" },
            example: "https://github.com/openai/codex/actions/runs/29728148711",
          }],
          responses: {
            "200": {
              description: "Bounded evidence-linked run diagnosis after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...runOutputSchema } } },
            },
            "402": { description: "Payment required; inspect the PAYMENT-REQUIRED header" },
            "400": { description: "Invalid workflow run URL; verified payment is not settled" },
            "404": { description: "Public workflow run not found; verified payment is not settled" },
            "502": { description: "GitHub upstream failure; verified payment is not settled" },
            "503": { description: "Temporary capacity or service configuration failure" },
          },
          "x-x402": { version: 2, scheme: "exact", network, price: prices.run, currency: "USDC" },
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
      "/api/flake": {
        get: {
          summary: "Classify a public GitHub Actions failure before retrying",
          description: "Compares an exact run attempt with other attempts of the same run, same-SHA outcomes, exact job-and-failed-step fingerprints, and up to 12 earlier comparable workflow runs. It returns confirmed, likely, structurally recurring, new, inconclusive, or not-failed evidence without executing or rerunning CI.",
          operationId: "classifyFlakeVerdict",
          parameters: [
            {
              name: "run_url",
              in: "query",
              required: true,
              description: "Canonical public GitHub Actions workflow run URL",
              schema: { type: "string", pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/actions/runs/[1-9][0-9]*$" },
              example: "https://github.com/actions/runner/actions/runs/29423388605",
            },
            {
              name: "attempt",
              in: "query",
              required: false,
              description: "Exact positive run attempt; omit to classify the current attempt",
              schema: { type: "integer", minimum: 1 },
              example: 1,
            },
          ],
          responses: {
            "200": {
              description: "Bounded evidence-linked flake classification after x402 settlement",
              content: { "application/json": { schema: flakeOutputSchema } },
            },
            "402": { description: "Payment required; inspect the PAYMENT-REQUIRED header" },
            "400": { description: "Invalid workflow run URL or attempt; verified payment is not settled" },
            "404": { description: "Public workflow run or requested attempt not found; verified payment is not settled" },
            "429": { description: "Bounded upstream capacity exhausted; verified payment is not settled" },
            "502": { description: "GitHub upstream failure; verified payment is not settled" },
            "503": { description: "Temporary capacity, deadline, or service configuration failure; verified payment is not settled" },
          },
          "x-x402": { version: 2, scheme: "exact", network, price: prices.flake, currency: "USDC" },
        },
      },
    },
  };
}

export function createLlmsText(origin: string): string {
  return `# BountyVerdict

> Evidence-linked GitHub bounty due diligence for autonomous coding agents.

## Decide if this tool is useful

- Free representative result: ${origin}/api/sample
- OpenAPI 3.1 contract: ${origin}/openapi.json
- Agent operating skill: https://cristianmoroaica.github.io/bountyverdict/skills/preflight-github-bounties/SKILL.md
- Paid check: GET ${origin}/api/verdict?issue_url=<PUBLIC_GITHUB_ISSUE_URL>
- Price: $0.05 USDC per successful result through x402 v2
- Free portfolio sample: ${origin}/api/portfolio/sample
- Paid portfolio: POST ${origin}/api/portfolio with {"issue_urls":[...]} for $0.40 USDC
- Portfolio size: 2 to 10 unique public GitHub issue URLs
- Verdicts: AVOID, CAUTION, VIABLE
- Free HarnessVerdict sample: ${origin}/api/harness/sample
- Paid HarnessVerdict: GET ${origin}/api/harness?repo_url=<PUBLIC_GITHUB_REPOSITORY_URL>
- HarnessVerdict price: $0.03 USDC per successful commit-pinned audit
- Harness verdicts: READY, REVIEW, REPAIR
- Free SkillVerdict sample: ${origin}/api/skill/sample
- Paid SkillVerdict: GET ${origin}/api/skill?repo_url=<PUBLIC_GITHUB_REPOSITORY_URL>&skill_path=<SKILL_DIRECTORY>
- SkillVerdict price: $0.06 USDC per successful commit-pinned pre-install audit
- Skill verdicts: LOW_RISK, REVIEW, BLOCK
- Free RunVerdict sample: ${origin}/api/run/sample
- Paid RunVerdict: GET ${origin}/api/run?run_url=<PUBLIC_GITHUB_ACTIONS_RUN_URL>
- RunVerdict price: $0.04 USDC per bounded exact-attempt diagnosis
- Run verdicts: PASS, WAIT, RETRY, FIX, INVESTIGATE
- Free FlakeVerdict sample: ${origin}/api/flake/sample
- Paid FlakeVerdict: GET ${origin}/api/flake?run_url=<PUBLIC_GITHUB_ACTIONS_RUN_URL>&attempt=<OPTIONAL_EXACT_ATTEMPT>
- FlakeVerdict price: $0.07 USDC per bounded historical retry decision
- Flake verdicts: CONFIRMED_FLAKE, LIKELY_FLAKE, RECURRING_FAILURE, NEW_FAILURE, INCONCLUSIVE, NOT_FAILED
- Failed or invalid checks are not settled
- Every successful result includes explicit service_reuse guidance so agents know when to call the same reliable bounded check again

## Differentiation

BountyVerdict checks up to 300 issue comments, first and newest timeline pages, competing and failed PRs, attempt swarms, issue locks, repository state, explicit maintainer rejection, reward-withdrawal language, and conventional contribution-document paths for AI-work bans or disclosure requirements. Important signals include public evidence URLs and coverage counts.

The portfolio product runs the full check on every submitted candidate, ranks VIABLE before CAUTION before AVOID, recommends the strongest candidate, and reports partial upstream failures.

HarnessVerdict audits the repository's recognized coding-agent instruction surfaces without cloning or executing its code. It reports stale path references, oversized always-loaded context, machine-local paths, malformed skill frontmatter, secret-like material, and client portability across Codex, Claude Code, Gemini CLI, GitHub Copilot, and Cursor. Every result is pinned to the audited commit SHA.

SkillVerdict audits a requested public SKILL.md plus its bounded directory and repository context without execution. It detects high-confidence supply-chain hazards, redacts secret-like values, discloses observed capabilities and external domains, and pins every finding to the exact reviewed commit. LOW_RISK is not a safety guarantee; retain least privilege and inspect coverage before installation.

RunVerdict diagnoses one public GitHub Actions run from exact-attempt job metadata and bounded failed-job logs. It distinguishes primary failures from downstream summary jobs, returns redacted evidence and root-cause families, and recommends whether to fix, investigate, wait, or retry without mutating CI.

FlakeVerdict is the read-only retry gate before RunVerdict: it compares the selected attempt with same-run, same-SHA, and bounded historical workflow evidence. Only a currently failed CONFIRMED_FLAKE may recommend one retry; likely, recurring, new, and inconclusive evidence never authorizes an automatic rerun.

## Safety

A VIABLE result means investigate further. It does not guarantee a reward, merge, eligibility, or payment.
`;
}
