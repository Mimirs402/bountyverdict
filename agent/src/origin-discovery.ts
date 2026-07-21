import { PRODUCT_CATALOG, type ProductKey } from "./product-catalog.ts";
import { mcpDriftExampleInput } from "./mcp-drift-discovery.ts";

const REPOSITORY = "https://github.com/cristianmoroaica/bountyverdict";
const SITE = "https://cristianmoroaica.github.io/bountyverdict";
const NETWORK_LABELS = Object.freeze({
  "eip155:8453": "Base mainnet",
  "eip155:84532": "Base Sepolia",
} as const);
const DISTRIBUTED_PRODUCTS = Object.freeze([
  "single", "portfolio", "harness", "run", "flake", "mcpdrift",
] as const satisfies readonly ProductKey[]);
const MCP_TOOL_BY_PRODUCT = Object.freeze({
  single: "check_github_bounty",
  portfolio: "rank_github_bounties",
  harness: "audit_agent_harness",
  run: "diagnose_github_actions_run",
  flake: "classify_github_actions_flake",
  mcpdrift: "check_mcp_tool_drift",
} as const satisfies Record<typeof DISTRIBUTED_PRODUCTS[number], string>);

const PRODUCT_GUIDANCE = Object.freeze({
  single: Object.freeze({
    use_when: "Decide whether one public GitHub bounty issue is still worth pursuing before coding.",
    not_for: "Private repositories, pull requests, or guaranteed reward predictions.",
    input_example: { issue_url: "https://github.com/owner/repository/issues/123" },
    skill: "preflight-github-bounties",
  }),
  portfolio: Object.freeze({
    use_when: "Rank two to ten public GitHub bounty candidates with partial-failure handling.",
    not_for: "A single issue or more than ten candidates.",
    input_example: {
      issue_urls: [
        "https://github.com/owner/repository/issues/123",
        "https://github.com/owner/repository/issues/456",
      ],
    },
    skill: "preflight-github-bounties",
  }),
  harness: Object.freeze({
    use_when: "Audit a public repository's coding-agent instruction stack before autonomous work.",
    not_for: "Private repositories, executing repository code, or runtime behavior claims.",
    input_example: { repo_url: "https://github.com/owner/repository" },
    skill: "audit-agent-harness",
  }),
  run: Object.freeze({
    use_when: "Diagnose the root cause and next action for one public GitHub Actions run.",
    not_for: "Private runs, non-GitHub CI, or mutating and rerunning workflows.",
    input_example: { run_url: "https://github.com/owner/repository/actions/runs/123456789" },
    skill: "diagnose-github-actions",
  }),
  flake: Object.freeze({
    use_when: "Decide whether a completed failed public GitHub Actions run merits exactly one retry.",
    not_for: "Running jobs, private runs, non-GitHub CI, or automatically rerunning a workflow.",
    input_example: {
      run_url: "https://github.com/owner/repository/actions/runs/123456789",
      attempt: 1,
    },
    skill: "classify-github-flakes",
  }),
  mcpdrift: Object.freeze({
    use_when: "Gate a complete MCP 2025-11-25 tools/list snapshot change before accepting an upgrade.",
    not_for: "Fetching MCP catalogs, invoking tools, or proving runtime and server identity.",
    input_example: mcpDriftExampleInput,
    skill: "check-mcp-tool-drift",
  }),
});

function canonicalOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.protocol !== "https:") {
    throw new Error("Origin discovery requires an exact HTTPS origin.");
  }
  return parsed.origin;
}

function networkLabel(network: string): string {
  const label = NETWORK_LABELS[network as keyof typeof NETWORK_LABELS];
  if (!label) throw new Error("Origin discovery requires a supported Base network.");
  return label;
}

function openApiOperationPointer(path: string, method: string): string {
  const encodedPath = path.replaceAll("~", "~0").replaceAll("/", "~1");
  return `#/paths/${encodedPath}/${method.toLowerCase()}`;
}

export function createOriginAgentManifest(originInput: string, network: string, payTo?: string) {
  const origin = canonicalOrigin(originInput);
  const paymentNetwork = networkLabel(network);
  return {
    spec: "bountyverdict-agent-manifest/1",
    version: 1,
    name: "BountyVerdict Agent Decision APIs",
    description: "Six bounded, read-only decision contracts for public GitHub bounty, repository-instruction, GitHub Actions, and MCP schema checks. Every result includes an exact service_reuse rule.",
    origin,
    repository: REPOSITORY,
    openapi: `${origin}/openapi.json`,
    llms: `${origin}/llms.txt`,
    skill: `${origin}/SKILL.md`,
    payment: {
      protocol: "x402",
      version: 2,
      scheme: "exact",
      network,
      network_name: paymentNetwork,
      currency: "USDC",
      pay_to: payTo || null,
      wallet_cli: "npx awal@2.12.0 x402 pay",
      safeguards: [
        "Make an unsigned request first and inspect the returned challenge.",
        "Require the exact documented URL, Base USDC asset, amount, and payee before signing.",
        "Use the product amount as a hard maximum and never raise it silently.",
      ],
    },
    products: DISTRIBUTED_PRODUCTS.map((product) => {
      const catalog = PRODUCT_CATALOG[product];
      const guidance = PRODUCT_GUIDANCE[product];
      return {
        id: product,
        name: catalog.service,
        method: catalog.method,
        url: `${origin}${catalog.path}`,
        price_usdc: catalog.priceUsd.slice(1),
        amount_atomic_usdc: String(catalog.amountAtomic),
        use_when: guidance.use_when,
        not_for: guidance.not_for,
        input_example: guidance.input_example,
        free_sample: `${origin}${catalog.samplePath}`,
        openapi_operation: `${origin}/openapi.json${openApiOperationPointer(catalog.path, catalog.method)}`,
        task_skill: `${SITE}/skills/${guidance.skill}/SKILL.md`,
      };
    }),
    mcp: {
      transport: "streamable-http",
      protocol_version: "2025-11-25",
      stateless: true,
      url: `${origin}/mcp`,
      payment: "x402 v2 exact USDC on Base",
      tools: DISTRIBUTED_PRODUCTS.map((product) => ({
        name: MCP_TOOL_BY_PRODUCT[product],
        product,
        price_usdc: PRODUCT_CATALOG[product].priceUsd.slice(1),
        amount_atomic_usdc: String(PRODUCT_CATALOG[product].amountAtomic),
      })),
    },
    distribution_scope: {
      excluded_products: ["SkillVerdict"],
      reason: "This surface is intentionally limited to the six independently distributed contracts. The canonical OpenAPI and x402 inventory remain the complete seven-product sources.",
    },
    reliability: {
      prepayment_input_validation: true,
      scheduled_functional_canaries: true,
      mutates_external_systems: false,
      result_reuse_field: "service_reuse",
      purchase_evidence: "Only a corroborated non-owner settlement is a purchase; discovery and calls are not revenue.",
    },
  };
}

export function createMcpWellKnown(originInput: string, network: string) {
  const origin = canonicalOrigin(originInput);
  const paymentNetwork = networkLabel(network);
  return {
    name: "io.github.cristianmoroaica/bountyverdict",
    title: "BountyVerdict Agent Decision APIs",
    description: "Six paid, read-only tools for GitHub bounty triage, repository-instruction audits, Actions diagnosis, flaky-retry decisions, and MCP schema-change gates.",
    url: `${origin}/mcp`,
    transport: "streamable-http",
    protocol_version: "2025-11-25",
    authentication: "none",
    payment: {
      protocol: "x402",
      version: 2,
      network,
      network_name: paymentNetwork,
      currency: "USDC",
      price_range_usdc: { minimum: "0.02", maximum: "0.40" },
    },
    registry: {
      name: "io.github.cristianmoroaica/bountyverdict",
      latest: "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.cristianmoroaica%2Fbountyverdict/versions/latest",
    },
    repository: REPOSITORY,
  };
}

export function createOriginSkillMarkdown(originInput: string, network: string, payTo?: string): string {
  const origin = canonicalOrigin(originInput);
  const manifest = createOriginAgentManifest(origin, network, payTo);
  const payeeRule = manifest.payment.pay_to
    ? `the published payee \`${manifest.payment.pay_to}\``
    : "the payee published by the exact challenge";
  const products = manifest.products.map((product) => `### ${product.name} — $${product.price_usdc} USDC

- Use when: ${product.use_when}
- Do not use for: ${product.not_for}
- Endpoint: \`${product.method} ${product.url}\`
- Free sample: ${product.free_sample}
- Exact task workflow: ${product.task_skill}
`).join("\n");
  return `---
name: bountyverdict-agent-decisions
description: Route public GitHub bounty, agent-instruction, CI diagnosis, flaky-retry, and MCP schema-change decisions to six exact read-only x402 APIs.
---

# BountyVerdict agent decisions

Use the narrowest contract below before an autonomous agent spends coding time, installs repository instructions, retries CI, or accepts an MCP tool-catalog change. Each paid result contains a \`service_reuse\` rule stating exactly when it remains reliable and when to call again.

This discovery skill never signs, pays, executes repository code, mutates GitHub, fetches MCP catalog URLs, or invokes MCP tools.

Agents with MCP 2025-11-25 Streamable HTTP and x402 support may connect directly to \`${origin}/mcp\`. It exposes the same six products as paid tools, validates semantic input before requesting payment, and excludes SkillVerdict. Use \`tools/list\` to inspect exact schemas and prices.

## Safe calling sequence

1. Validate the complete canonical public input against ${origin}/openapi.json.
2. Inspect the free sample and make one unsigned request to the exact product URL.
3. Require x402 v2, the documented atomic price, network \`${manifest.payment.network}\` (${manifest.payment.network_name}), that network's documented USDC asset, and ${payeeRule}.
4. If authorized to spend, execute the returned \`payment.agentic_wallet.argv\` as an argument vector. Never join it into a shell string or raise the cap silently.
5. Validate the typed result and preserve its \`service_reuse\` guidance.

## Products

${products}
## Machine-readable references

- Manifest: ${origin}/agent-manifest.json
- OpenAPI: ${origin}/openapi.json
- x402 resources: ${origin}/.well-known/x402
- MCP endpoint metadata: ${origin}/.well-known/mcp.json
- Agent guide: ${origin}/llms.txt
- Remote MCP server: ${origin}/mcp

SkillVerdict is intentionally absent because this surface covers only the six independently distributed contracts. The canonical OpenAPI and x402 inventory remain the complete seven-product sources.
`;
}
