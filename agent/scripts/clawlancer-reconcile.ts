import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { verifyClawlancerFunding, verifyClawlancerRelease } from "../src/clawlancer-chain.ts";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import { CLAWLANCER_CANARY, clawlancerWorkAction, parseClawlancerTransaction } from "../src/clawlancer-work.ts";

const API = "https://clawlancer.ai";
const CREDENTIAL_PATH = `${homedir()}/.config/clawlancer/credentials.json`;
const CREDENTIAL_SHA256 = "79e6fad0e53780c503d7d75d79baa905c89514bdd034440a9cf28e69f9edeedd";
const STATE_PATH = `${homedir()}/.local/state/bountyverdict/clawlancer-work.json`;
const LOCK_PATH = `${homedir()}/.local/state/bountyverdict/clawlancer-work.lock`;
const ARTIFACT_PATH = "/home/mcr/notes/clawlancer/mimir-reliability-intro.md";
const ARTIFACT_SHA256 = "d212237abd908763276b51baf45efd1421ba9d21eb816ffe7083e60f5432695b";
const timeoutMs = 20_000;
const maximumResponseBytes = 1_000_000;

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function readTransaction(apiKey: string): Promise<unknown> {
  const response = await fetch(new URL(`/api/transactions/${CLAWLANCER_CANARY.transactionId}`, API), {
    method: "GET",
    redirect: "error",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "mimir-clawlancer-read-only-reconciler/1.0",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumResponseBytes) {
    throw new Error("Clawlancer response exceeded the byte cap.");
  }
  if (!response.ok) throw new Error(`Clawlancer returned HTTP ${response.status}: ${body.slice(0, 240)}`);
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error("Clawlancer returned a non-JSON response.");
  }
  return JSON.parse(body) as unknown;
}

const checkedAt = new Date().toISOString();
let releaseLock: (() => Promise<void>) | null = null;
try {
  releaseLock = await acquireExclusiveRun(LOCK_PATH);
  const credentials = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8")) as Record<string, unknown>;
  const apiKey = credentials.api_key;
  if (typeof apiKey !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(apiKey) ||
    createHash("sha256").update(apiKey).digest("hex") !== CREDENTIAL_SHA256) {
    throw new Error("Clawlancer API credential is malformed.");
  }
  if (String(credentials.wallet_address || "").toLowerCase() !== CLAWLANCER_CANARY.sellerAddress.toLowerCase()) {
    throw new Error("Clawlancer credential belongs to another wallet.");
  }

  const transaction = parseClawlancerTransaction(await readTransaction(apiKey));
  if (transaction.id !== CLAWLANCER_CANARY.transactionId ||
    transaction.listingId !== CLAWLANCER_CANARY.listingId ||
    transaction.sellerAddress.toLowerCase() !== CLAWLANCER_CANARY.sellerAddress.toLowerCase() ||
    transaction.buyerAddress.toLowerCase() !== CLAWLANCER_CANARY.buyerAddress.toLowerCase() ||
    transaction.amountAtomic !== CLAWLANCER_CANARY.amountAtomic) {
    throw new Error("Clawlancer transaction contract drifted.");
  }

  const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL) });
  const fundingEvidence = ["FUNDED", "DELIVERED"].includes(transaction.state)
    ? await verifyClawlancerFunding(client, transaction)
    : null;
  const releaseEvidence = transaction.state === "RELEASED"
    ? await verifyClawlancerRelease(client, transaction)
    : null;
  const state = {
    schema_version: 2,
    status: transaction.state.toLowerCase(),
    checked_at: checkedAt,
    action: clawlancerWorkAction(transaction),
    submitted_now: false,
    read_only: true,
    external_actions_enabled: false,
    delivery_disabled: true,
    transaction,
    funding_evidence: fundingEvidence,
    release_evidence: releaseEvidence,
    artifact: { path: ARTIFACT_PATH, sha256: ARTIFACT_SHA256 },
    accounting: transaction.state === "RELEASED"
      ? "release_reported_but_not_onchain_verified_not_revenue"
      : "no_released_payment_not_revenue",
  };
  await atomicWrite(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  console.log(JSON.stringify(state, null, 2));
} catch (error) {
  const state = {
    schema_version: 2,
    status: "unavailable",
    checked_at: checkedAt,
    read_only: true,
    external_actions_enabled: false,
    delivery_disabled: true,
    error: (error instanceof Error ? error.message : "unknown Clawlancer failure").slice(0, 500),
    accounting: "unavailable_not_revenue",
  };
  await atomicWrite(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  console.error(JSON.stringify(state, null, 2));
  process.exitCode = 1;
} finally {
  if (releaseLock) await releaseLock();
}
