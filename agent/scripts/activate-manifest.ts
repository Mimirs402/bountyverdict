import { readFile, writeFile } from "node:fs/promises";
import { activateManifest } from "../src/manifest.ts";

const manifestUrl = new URL("../../agent-manifest.json", import.meta.url);
const productionApi = process.env.PRODUCTION_API_URL || "";
const workerVersionId = process.env.CLOUDFLARE_WORKER_VERSION_OVERRIDE || "";
const current = JSON.parse(await readFile(manifestUrl, "utf8"));
const activated = activateManifest(current, productionApi, workerVersionId);
await writeFile(manifestUrl, `${JSON.stringify(activated, null, 2)}\n`, { mode: 0o644 });

console.log(JSON.stringify({
  status: activated.status,
  production_api: activated.production_api,
  worker_version_id: activated.worker_version_id,
  updated_at: activated.updated_at,
}, null, 2));
