export const PRODUCT_CATALOG = Object.freeze({
  single: Object.freeze({
    service: "BountyVerdict",
    path: "/api/bounty-preflight",
    samplePath: "/api/sample",
    method: "POST" as const,
    priceUsd: "$0.05",
    amountAtomic: 50_000n,
  }),
  portfolio: Object.freeze({
    service: "BountyVerdict Portfolio",
    path: "/api/portfolio",
    samplePath: "/api/portfolio/sample",
    method: "POST" as const,
    priceUsd: "$0.40",
    amountAtomic: 400_000n,
  }),
  harness: Object.freeze({
    service: "HarnessVerdict",
    path: "/api/repository-agent-instructions-audit",
    samplePath: "/api/harness/sample",
    method: "POST" as const,
    priceUsd: "$0.03",
    amountAtomic: 30_000n,
  }),
  skill: Object.freeze({
    service: "SkillVerdict",
    path: "/api/skill",
    samplePath: "/api/skill/sample",
    method: "GET" as const,
    priceUsd: "$0.06",
    amountAtomic: 60_000n,
  }),
  run: Object.freeze({
    service: "RunVerdict",
    path: "/api/github-actions-run-diagnosis",
    samplePath: "/api/run/sample",
    method: "POST" as const,
    priceUsd: "$0.04",
    amountAtomic: 40_000n,
  }),
  flake: Object.freeze({
    service: "FlakeVerdict",
    path: "/api/github-actions-flake-retry-gate",
    samplePath: "/api/flake/sample",
    method: "POST" as const,
    priceUsd: "$0.07",
    amountAtomic: 70_000n,
  }),
  mcpdrift: Object.freeze({
    service: "MCPDriftVerdict",
    path: "/api/mcp-drift",
    samplePath: "/api/mcp-drift/sample",
    method: "POST" as const,
    priceUsd: "$0.02",
    amountAtomic: 20_000n,
  }),
});

export type ProductKey = keyof typeof PRODUCT_CATALOG;
export const LEGACY_GET_PATHS = Object.freeze({
  single: "/api/verdict",
  harness: "/api/harness",
  run: "/api/run",
  flake: "/api/flake",
});
export const LEGACY_SINGLE_PATH = LEGACY_GET_PATHS.single;
export const LEGACY_HARNESS_PATH = LEGACY_GET_PATHS.harness;
export const LEGACY_RUN_PATH = LEGACY_GET_PATHS.run;
export const LEGACY_FLAKE_PATH = LEGACY_GET_PATHS.flake;
export const PRODUCT_KEYS = Object.freeze(
  Object.keys(PRODUCT_CATALOG) as ProductKey[],
);

export function productForTransport(path: string, method: string): ProductKey | null {
  const normalizedMethod = method.toUpperCase();
  for (const product of PRODUCT_KEYS) {
    const catalog = PRODUCT_CATALOG[product];
    if (catalog.path === path && catalog.method === normalizedMethod) return product;
  }
  if (
    normalizedMethod === "GET" &&
    path === PRODUCT_CATALOG.single.path
  ) {
    return "single";
  }
  if (normalizedMethod === "GET") {
    for (const [product, legacyPath] of Object.entries(LEGACY_GET_PATHS) as [keyof typeof LEGACY_GET_PATHS, string][]) {
      if (path === legacyPath) return product;
    }
  }
  return null;
}

export function productForAtomicAmount(amount: bigint): ProductKey | null {
  for (const product of PRODUCT_KEYS) {
    if (PRODUCT_CATALOG[product].amountAtomic === amount) return product;
  }
  return null;
}
