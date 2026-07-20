export const PRODUCT_CATALOG = Object.freeze({
  single: Object.freeze({
    service: "BountyVerdict",
    path: "/api/verdict",
    samplePath: "/api/sample",
    method: "GET" as const,
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
    path: "/api/harness",
    samplePath: "/api/harness/sample",
    method: "GET" as const,
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
    path: "/api/run",
    samplePath: "/api/run/sample",
    method: "GET" as const,
    priceUsd: "$0.04",
    amountAtomic: 40_000n,
  }),
  flake: Object.freeze({
    service: "FlakeVerdict",
    path: "/api/flake",
    samplePath: "/api/flake/sample",
    method: "GET" as const,
    priceUsd: "$0.07",
    amountAtomic: 70_000n,
  }),
});

export type ProductKey = keyof typeof PRODUCT_CATALOG;
export const PRODUCT_KEYS = Object.freeze(
  Object.keys(PRODUCT_CATALOG) as ProductKey[],
);

export function productForAtomicAmount(amount: bigint): ProductKey | null {
  for (const product of PRODUCT_KEYS) {
    if (PRODUCT_CATALOG[product].amountAtomic === amount) return product;
  }
  return null;
}
