import { outputSchema, portfolioOutputSchema } from "./discovery.ts";
import { harnessOutputSchema } from "./harness-discovery.ts";
import { runOutputSchema } from "./run-discovery.ts";
import { flakeOutputSchema } from "./flake-discovery.ts";
import { mcpDriftOutputSchema } from "./mcp-drift-discovery.ts";
import type { The402Product } from "./the402.ts";

export const THE402_API = "https://api.the402.ai/v1";
export const THE402_PROVIDER_ID = "p_d4b4ece39162409b";
export const THE402_PROVIDER_CATALOG_URL =
  `${THE402_API}/services/catalog?provider=${THE402_PROVIDER_ID}&limit=100`;

function objectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", ...schema };
}

export const THE402_LISTINGS: ReadonlyArray<{
  product: The402Product;
  service_id: string;
  name: string;
  description: string;
  price: string;
  agent_price: string;
  tags: string[];
  input_schema: Record<string, unknown>;
  deliverable_schema: Record<string, unknown>;
}> = Object.freeze([
  {
    product: "single",
    service_id: "svc_5e36dabc8b434e95",
    name: "BountyVerdict",
    description: "Decide whether one public GitHub bounty is still available and worth pursuing before coding. Returns AVOID, CAUTION, or VIABLE with public evidence and repository AI-policy coverage. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.05",
    agent_price: "$0.053",
    tags: ["github", "bounty", "due-diligence", "agent-decision"],
    input_schema: {
      type: "object",
      required: ["issue_url"],
      additionalProperties: false,
      properties: {
        issue_url: { type: "string", description: "Canonical public GitHub issue URL." },
      },
    },
    deliverable_schema: objectSchema(outputSchema),
  },
  {
    product: "portfolio",
    service_id: "svc_780bf04bd8204b2f",
    name: "BountyVerdict Portfolio",
    description: "Rank two to ten public GitHub bounty candidates using the full evidence-linked due-diligence check, preserving partial failures and selecting the strongest non-AVOID option. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.40",
    agent_price: "$0.42",
    tags: ["github", "bounty", "portfolio", "ranking"],
    input_schema: {
      type: "object",
      required: ["issue_urls"],
      additionalProperties: false,
      properties: {
        issue_urls: {
          type: "array",
          minItems: 2,
          maxItems: 10,
          uniqueItems: true,
          items: { type: "string", description: "Canonical public GitHub issue URL." },
        },
      },
    },
    deliverable_schema: objectSchema(portfolioOutputSchema),
  },
  {
    product: "harness",
    service_id: "svc_df4baf282b7d48d5",
    name: "HarnessVerdict",
    description: "Audit a public GitHub repository's coding-agent instruction stack at an immutable commit. Returns READY, REVIEW, or REPAIR with evidence-linked fixes. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.03",
    agent_price: "$0.032",
    tags: ["github", "agents-md", "agent-harness", "developer-tools"],
    input_schema: {
      type: "object",
      required: ["repo_url"],
      additionalProperties: false,
      properties: {
        repo_url: { type: "string", description: "Canonical public GitHub repository URL." },
      },
    },
    deliverable_schema: objectSchema(harnessOutputSchema),
  },
  {
    product: "run",
    service_id: "svc_cdd16073d02c4429",
    name: "RunVerdict",
    description: "Diagnose why one public GitHub Actions run failed and return a bounded root cause, retryability decision, redacted evidence, and concrete next action without rerunning CI. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.04",
    agent_price: "$0.042",
    tags: ["github-actions", "ci", "root-cause", "developer-tools"],
    input_schema: {
      type: "object",
      required: ["run_url"],
      additionalProperties: false,
      properties: {
        run_url: { type: "string", description: "Canonical public GitHub Actions run URL." },
      },
    },
    deliverable_schema: objectSchema(runOutputSchema),
  },
  {
    product: "flake",
    service_id: "svc_565a2a5c8e154b6e",
    name: "FlakeVerdict",
    description: "Decide whether a completed public GitHub Actions failure is flaky and merits exactly one retry, or is recurring or new and needs a fix. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.07",
    agent_price: "$0.074",
    tags: ["github-actions", "flaky-ci", "retry-or-fix", "developer-tools"],
    input_schema: {
      type: "object",
      required: ["run_url"],
      additionalProperties: false,
      properties: {
        run_url: { type: "string", description: "Canonical public GitHub Actions run URL." },
        attempt: { type: "integer", minimum: 1, description: "Optional exact workflow attempt." },
      },
    },
    deliverable_schema: objectSchema(flakeOutputSchema),
  },
  {
    product: "mcpdrift",
    service_id: "svc_40e97a390c5b4d71",
    name: "MCPDriftVerdict",
    description: "Compare complete baseline and current MCP tools/list snapshots and return an exact-hash compatibility verdict without fetching or invoking tools. Documentation and strict input contract: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.02",
    agent_price: "$0.021",
    tags: ["mcp", "schema-drift", "compatibility", "agent-safety"],
    input_schema: {
      type: "object",
      required: ["contract_version", "subject", "annotation_source_trust", "baseline", "current"],
      additionalProperties: false,
      properties: {
        contract_version: { type: "string", const: "mcp-drift/1" },
        subject: { type: "object", description: "Stable caller-chosen server identity.", additionalProperties: true },
        annotation_source_trust: { type: "string", enum: ["trusted", "untrusted"] },
        baseline: { type: "object", description: "Complete baseline tools/list snapshot.", additionalProperties: true },
        current: { type: "object", description: "Complete current tools/list snapshot.", additionalProperties: true },
      },
    },
    deliverable_schema: objectSchema(mcpDriftOutputSchema),
  },
]);

export function the402MarketplaceManifest(): Record<string, unknown> {
  return {
    provider_id: THE402_PROVIDER_ID,
    public_catalog: THE402_PROVIDER_CATALOG_URL,
    skillverdict_excluded_during_frozen_experiment: true,
    services: THE402_LISTINGS.map((listing) => ({
      name: listing.name,
      service_id: listing.service_id,
      purchase_endpoint: `${THE402_API}/services/${listing.service_id}/purchase`,
      method: "POST",
      agent_price_usdc: listing.agent_price.replace(/^\$/, ""),
      provider_net_usdc: listing.price.replace(/^\$/, ""),
      fulfillment_type: "instant",
    })),
  };
}
