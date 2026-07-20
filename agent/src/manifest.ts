import { the402MarketplaceManifest } from "./the402-catalog.ts";

export interface AgentManifest {
  schema_version: string;
  product: string;
  status: "awaiting_production" | "active";
  production_api: string | null;
  updated_at: string;
  [key: string]: unknown;
}

export function activateManifest(
  value: unknown,
  productionApi: string,
  now = new Date(),
): AgentManifest {
  if (!value || typeof value !== "object") throw new Error("Agent manifest must be an object.");
  const manifest = value as AgentManifest;
  if (manifest.schema_version !== "1.0" || manifest.product !== "BountyVerdict") {
    throw new Error("Unexpected agent manifest identity or schema version.");
  }

  let origin: URL;
  try {
    origin = new URL(productionApi);
  } catch {
    throw new Error("PRODUCTION_API_URL must be a valid URL.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("PRODUCTION_API_URL must be a credential-free HTTPS origin.");
  }

  return {
    ...manifest,
    marketplaces: {
      ...(manifest.marketplaces && typeof manifest.marketplaces === "object" && !Array.isArray(manifest.marketplaces)
        ? manifest.marketplaces as Record<string, unknown>
        : {}),
      the402: the402MarketplaceManifest(),
    },
    status: "active",
    production_api: origin.origin,
    updated_at: now.toISOString(),
  };
}
