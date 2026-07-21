import { PRODUCT_CATALOG, PRODUCT_KEYS } from "./product-catalog.ts";

const REPOSITORY = "https://github.com/Mimirs402/bountyverdict";
const PRODUCT_SITE = "https://mimirs402.github.io/bountyverdict/";

function numericPrice(price: string): number {
  const value = Number(price.replace(/^\$/, ""));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid product price: ${price}`);
  return value;
}

/**
 * Agent402 and x402scan compatibility manifest. OpenAPI remains the canonical
 * operation-level contract; this surface gives crawlers a one-fetch identity
 * and an exact paid-resource allowlist without exposing credentials or traffic.
 */
export function createX402ServiceManifest(origin: string, network: string, payTo?: string) {
  const canonicalOrigin = new URL(origin).origin;
  const resources = PRODUCT_KEYS.map((product) =>
    new URL(PRODUCT_CATALOG[product].path, canonicalOrigin).href
  );
  const prices = PRODUCT_KEYS.map((product) => numericPrice(PRODUCT_CATALOG[product].priceUsd));

  return {
    spec: "agent402-service-manifest/1",
    version: 1,
    resources,
    about: `${REPOSITORY}#bountyverdict`,
    name: "BountyVerdict Agent Decision APIs",
    summary: "Seven bounded, deterministic decision APIs for coding agents: check GitHub bounty claimability, rank bounty candidates, audit repository agent instructions and third-party SKILL.md bundles, diagnose GitHub Actions failures, gate flaky retries, and detect breaking MCP tools/list schema drift. Every paid route has a free sample and a machine-readable OpenAPI contract.",
    homepage: PRODUCT_SITE,
    repository: REPOSITORY,
    openSource: true,
    selfHostable: true,
    license: "MIT",
    maintainer: {
      name: "Mimir's Lab",
      url: "https://github.com/Mimirs402",
    },
    privacyPolicy: `${PRODUCT_SITE}PRIVACY.md`,
    ecosystem: {
      chains: ["Base"],
      primaryChain: "Base",
      primaryChainId: 8453,
      currency: "USDC",
      protocol: "x402",
    },
    payment: {
      x402: {
        version: 2,
        currency: "USDC",
        networks: [network],
        primaryNetwork: network,
        priceRange: {
          minimumUsd: Math.min(...prices),
          maximumUsd: Math.max(...prices),
        },
        payTo: payTo || null,
        nonCustodial: true,
      },
    },
    discovery: {
      openapi: `${canonicalOrigin}/openapi.json`,
      llms: `${canonicalOrigin}/llms.txt`,
      agentManifest: `${PRODUCT_SITE}agent-manifest.json`,
      agentSkill: `${PRODUCT_SITE}skills/route-github-agent-checks/SKILL.md`,
      mcp: `${canonicalOrigin}/mcp`,
      mcpMetadata: `${canonicalOrigin}/.well-known/mcp.json`,
      aiCatalog: `${canonicalOrigin}/.well-known/ai-catalog.json`,
      mcpRegistryLatest: "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Mimirs402%2Fbountyverdict/versions/latest",
    },
    capabilities: {
      paidTools: resources.length,
      freeSamples: PRODUCT_KEYS.map((product) =>
        new URL(PRODUCT_CATALOG[product].samplePath, canonicalOrigin).href
      ),
      prePaymentValidation: true,
      publicEvidenceOnly: true,
      mutatesExternalSystems: false,
    },
  };
}
