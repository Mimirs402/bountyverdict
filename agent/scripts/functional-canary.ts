import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { CANARY_PRODUCTS, isCanaryProduct, type CanaryProduct } from "../src/canary.ts";
import { runMcpContractCanary } from "../src/mcp-functional-canary.ts";
import { activeReleaseIdentity } from "../src/functional-canary-release.ts";

const DEFAULT_API = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const TIMEOUT_MS = 120_000;
const WORKER_VERSION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const configuredApi = new URL(process.env.PRODUCTION_API_URL || DEFAULT_API);
if (configuredApi.origin !== DEFAULT_API || configuredApi.pathname !== "/" || configuredApi.search || configuredApi.hash) {
  throw new Error("Functional canaries may only send credentials to the exact production Worker origin.");
}
const api = configuredApi.origin;
const workerVersionOverride = process.env.CLOUDFLARE_WORKER_VERSION_OVERRIDE;
if (workerVersionOverride && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(workerVersionOverride)) {
  throw new Error("CLOUDFLARE_WORKER_VERSION_OVERRIDE must be a lowercase UUID.");
}
const tokenFile = process.env.CANARY_TOKEN_FILE;
const token = (process.env.CANARY_TOKEN || (tokenFile ? await readFile(tokenFile, "utf8") : "")).trim();
const stateFile = process.env.CANARY_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/functional-canary.json`;
const manifestFile = new URL("../../agent-manifest.json", import.meta.url);
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
const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as unknown;
const activeRelease = activeReleaseIdentity(manifest, api);
const checks: Array<Record<string, unknown>> = [];

for (const product of products) {
  const started = Date.now();
  try {
    const response = await fetch(`${api}/_internal/canary/${product}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "bountyverdict-owner-audit/1.0",
        ...(workerVersionOverride
          ? { "Cloudflare-Workers-Version-Overrides": `bountyverdict-agent-production="${workerVersionOverride}"` }
          : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json() as Record<string, unknown>;
    if (response.status !== 200 || body.ok !== true || body.product !== product) {
      const code = typeof body.error === "string" ? body.error : `HTTP_${response.status}`;
      throw new Error(`${product} canary failed with ${code}.`);
    }
    if (typeof body.worker_version_id !== "string" || !WORKER_VERSION_ID.test(body.worker_version_id)) {
      throw new Error(`${product} canary returned no valid Worker version ID.`);
    }
    if (workerVersionOverride && body.worker_version_id !== workerVersionOverride) {
      throw new Error(`${product} canary did not execute on the pinned Worker version.`);
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

const successfulWorkerVersionIds = new Set(checks
  .filter(({ ok }) => ok === true)
  .map(({ worker_version_id }) => worker_version_id)
  .filter((value): value is string => typeof value === "string" && WORKER_VERSION_ID.test(value)));
const workerVersionId = successfulWorkerVersionIds.size === 1
  ? [...successfulWorkerVersionIds][0]
  : null;
const mcpContract = requestedProduct && requestedProduct !== "all"
  ? null
  : await runMcpContractCanary(api, {
      timeoutMs: TIMEOUT_MS,
      ...(workerVersionId ? { workerVersionOverride: workerVersionId } : {}),
    });
const release = {
  verified: mcpContract?.healthy === true && mcpContract.server_version === activeRelease.release_version &&
    workerVersionId === activeRelease.worker_version_id &&
    mcpContract.worker_version_id === activeRelease.worker_version_id,
  release_version: activeRelease.release_version,
  worker_version_id: workerVersionId,
  mcp_server_version: mcpContract?.server_version || null,
  mcp_worker_version_id: mcpContract?.worker_version_id || null,
  manifest_updated_at: activeRelease.updated_at,
};
const report = {
  product: "BountyVerdict functional canaries",
  checked_at: new Date().toISOString(),
  production_api: api,
  healthy: checks.length === products.length && checks.every(({ ok }) => ok === true) &&
    (mcpContract === null || mcpContract.healthy) &&
    (mcpContract === null || release.verified),
  products_checked: [...products],
  checks,
  ...(mcpContract === null ? {} : { release }),
  ...(mcpContract === null ? {} : { mcp_contract: mcpContract }),
};

await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
const temporaryStateFile = `${stateFile}.${process.pid}.tmp`;
await writeFile(temporaryStateFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
await rename(temporaryStateFile, stateFile);
console.log(JSON.stringify(report, null, 2));
if (!report.healthy) process.exitCode = 1;
