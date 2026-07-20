import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { CANARY_PRODUCTS, isCanaryProduct, type CanaryProduct } from "../src/canary.ts";

const DEFAULT_API = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const TIMEOUT_MS = 120_000;
const configuredApi = new URL(process.env.PRODUCTION_API_URL || DEFAULT_API);
if (configuredApi.origin !== DEFAULT_API || configuredApi.pathname !== "/" || configuredApi.search || configuredApi.hash) {
  throw new Error("Functional canaries may only send credentials to the exact production Worker origin.");
}
const api = configuredApi.origin;
const tokenFile = process.env.CANARY_TOKEN_FILE;
const token = (process.env.CANARY_TOKEN || (tokenFile ? await readFile(tokenFile, "utf8") : "")).trim();
const stateFile = process.env.CANARY_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/functional-canary.json`;
const requestedProduct = process.env.CANARY_PRODUCT;

if (token.length < 32 || token.length > 256) {
  throw new Error("CANARY_TOKEN must contain between 32 and 256 characters.");
}
if (requestedProduct && requestedProduct !== "all" && !isCanaryProduct(requestedProduct)) {
  throw new Error(`CANARY_PRODUCT must be one of all, ${CANARY_PRODUCTS.join(", ")}.`);
}

const products: readonly CanaryProduct[] = requestedProduct && requestedProduct !== "all"
  ? [requestedProduct as CanaryProduct]
  : CANARY_PRODUCTS;
const checks: Array<Record<string, unknown>> = [];

for (const product of products) {
  const started = Date.now();
  try {
    const response = await fetch(`${api}/_internal/canary/${product}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json() as Record<string, unknown>;
    if (response.status !== 200 || body.ok !== true || body.product !== product) {
      const code = typeof body.error === "string" ? body.error : `HTTP_${response.status}`;
      throw new Error(`${product} canary failed with ${code}.`);
    }
    checks.push({ ...body, http_status: response.status });
  } catch (error) {
    checks.push({
      product,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - started,
    });
  }
}

const report = {
  product: "BountyVerdict functional canaries",
  checked_at: new Date().toISOString(),
  production_api: api,
  healthy: checks.length === products.length && checks.every(({ ok }) => ok === true),
  products_checked: [...products],
  checks,
};

await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
const temporaryStateFile = `${stateFile}.${process.pid}.tmp`;
await writeFile(temporaryStateFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
await rename(temporaryStateFile, stateFile);
console.log(JSON.stringify(report, null, 2));
if (!report.healthy) process.exitCode = 1;
