import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired } from "@x402/core/types";
import { CdpX402Client } from "@coinbase/cdp-sdk/x402";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { validatePaymentChallenge } from "../src/payment-safety.ts";
import { PRODUCT_CATALOG, PRODUCT_KEYS, type ProductKey } from "../src/product-catalog.ts";
import { mcpDriftExampleInput } from "../src/mcp-drift-discovery.ts";

const defaultIssue = "https://github.com/typeorm/typeorm/issues/3357";
const defaultRepo = "https://github.com/openai/codex";
const defaultRun = "https://github.com/openai/codex/actions/runs/29728148711";
const defaultFlakeRun = "https://github.com/actions/runner/actions/runs/29423388605";
const defaultPayTo = "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
const defaultPortfolio = [
  "https://github.com/godotengine/godot/issues/70796",
  defaultIssue,
];
const baseUrl = process.env.RESOURCE_SERVER_URL || "http://127.0.0.1:8787";
const issueUrl = process.env.ISSUE_URL || defaultIssue;
const selectedProduct = process.env.PRODUCT || "single";
if (!(PRODUCT_KEYS as readonly string[]).includes(selectedProduct)) {
  throw new Error(`PRODUCT must be one of ${PRODUCT_KEYS.join(", ")}.`);
}
const product = selectedProduct as ProductKey;
const issueUrls = process.env.ISSUE_URLS
  ? process.env.ISSUE_URLS.split(",").map((value) => value.trim()).filter(Boolean)
  : defaultPortfolio;
const contract = PRODUCT_CATALOG[product];
const ownerProbeUserAgent = "bountyverdict-payment-smoke/1.0";
const workerVersionOverride = process.env.CLOUDFLARE_WORKER_VERSION_OVERRIDE;
if (workerVersionOverride && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(workerVersionOverride)) {
  throw new Error("CLOUDFLARE_WORKER_VERSION_OVERRIDE must be a lowercase UUID.");
}
const ownerHeaders = {
  Accept: "application/json",
  "User-Agent": ownerProbeUserAgent,
  ...(workerVersionOverride
    ? { "Cloudflare-Workers-Version-Overrides": `bountyverdict-agent-production="${workerVersionOverride}"` }
    : {}),
};
const url = new URL(contract.path, baseUrl);
const harnessRepo = process.env.REPO_URL || defaultRepo;
if (product === "skill") {
  url.searchParams.set("repo_url", process.env.SKILL_REPO_URL || "https://github.com/coinbase/agentic-wallet-skills");
  url.searchParams.set("skill_path", process.env.SKILL_PATH || "skills/agentic-wallet");
}
const runUrl = process.env.RUN_URL || defaultRun;
const flakeRunUrl = process.env.FLAKE_RUN_URL || defaultFlakeRun;
let flakeAttempt: number | undefined;
if (product === "flake") {
  const attempt = process.env.FLAKE_ATTEMPT || process.env.ATTEMPT;
  if (attempt) {
    if (!/^[1-9][0-9]*$/.test(attempt) || !Number.isSafeInteger(Number(attempt))) {
      throw new Error("FLAKE_ATTEMPT must be a positive safe integer.");
    }
    flakeAttempt = Number(attempt);
  }
}
const postBody: unknown = product === "single"
  ? { issue_url: issueUrl }
  : product === "portfolio"
    ? { issue_urls: issueUrls }
    : product === "harness"
      ? { repo_url: harnessRepo }
      : product === "run"
        ? { run_url: runUrl }
        : product === "flake"
          ? { run_url: flakeRunUrl, ...(flakeAttempt === undefined ? {} : { attempt: flakeAttempt }) }
          : product === "mcpdrift"
            ? mcpDriftExampleInput
            : undefined;
const requestInit: RequestInit = postBody !== undefined
  ? {
      method: "POST",
      headers: { ...ownerHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(postBody),
      redirect: "error",
    }
    : { headers: ownerHeaders, redirect: "error" };

function decodeHeader(value: string): any {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

const unpaid = await fetch(url, requestInit);
if (unpaid.status !== 402) {
  throw new Error(`Expected an unpaid HTTP 402 response, received ${unpaid.status}.`);
}
const paymentHeader = unpaid.headers.get("payment-required");
if (!paymentHeader) throw new Error("The 402 response omitted PAYMENT-REQUIRED.");
const challenge = decodeHeader(paymentHeader);
const expectedService = contract.service;
const expectedMethod = contract.method;
if (challenge.resource?.url !== url.href) throw new Error("The payment challenge resource URL does not match the requested operation.");
if (challenge.resource?.serviceName !== expectedService) throw new Error(`The payment challenge service is not ${expectedService}.`);
if (challenge.extensions?.bazaar?.info?.input?.method !== expectedMethod) throw new Error(`The payment challenge method is not ${expectedMethod}.`);
if (contract.method === "POST" && challenge.extensions?.bazaar?.info?.input?.bodyType !== "json") {
  throw new Error(`${contract.service} payment challenge bodyType is not json.`);
}
if (challenge.accepts?.[0]?.scheme !== "exact") throw new Error("The payment challenge scheme is not exact.");
const expectedAtomic = contract.amountAtomic.toString();
const defaultMaximumAtomic = expectedAtomic;
const maximumAtomic = BigInt(process.env.MAX_PAYMENT_ATOMIC || defaultMaximumAtomic);
const executePayment = process.env.EXECUTE_PAYMENT === "YES";
const expectedPayer = process.env.EXPECTED_PAYER;
if (expectedPayer && !/^0x[a-fA-F0-9]{40}$/.test(expectedPayer)) {
  throw new Error("EXPECTED_PAYER must be a public 20-byte EVM address.");
}
const requirement = validatePaymentChallenge(challenge, {
  maximumAtomic,
  executePayment,
  allowMainnet: process.env.ALLOW_MAINNET_PAYMENT === "YES",
});
if (requirement.amount !== expectedAtomic) {
  throw new Error(`The payment challenge amount is not the exact ${expectedAtomic} atomic-unit product price.`);
}
const expectedNetwork = process.env.EXPECTED_NETWORK;
if (expectedNetwork && requirement.network !== expectedNetwork) {
  throw new Error("The payment challenge network does not match EXPECTED_NETWORK.");
}
const expectedAsset = process.env.EXPECTED_ASSET;
if (expectedAsset && requirement.asset.toLowerCase() !== expectedAsset.toLowerCase()) {
  throw new Error("The payment challenge asset does not match EXPECTED_ASSET.");
}
const expectedPayTo = process.env.EXPECTED_PAY_TO || defaultPayTo;
if (!/^0x[a-fA-F0-9]{40}$/.test(expectedPayTo) || requirement.payTo.toLowerCase() !== expectedPayTo.toLowerCase()) {
  throw new Error("The payment challenge recipient does not match EXPECTED_PAY_TO.");
}

console.log(JSON.stringify({
  phase: "payment_challenge_verified",
  product,
  resource: challenge.resource?.url,
  service: challenge.resource?.serviceName,
  network: requirement.network,
  amount_atomic: requirement.amount,
  asset: requirement.asset,
  pay_to: requirement.payTo,
  bazaar_method: challenge.extensions?.bazaar?.info?.input?.method,
  execute_payment: executePayment,
}, null, 2));

if (!executePayment) process.exit(0);

const hasCdpWallet = Boolean(
  process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && process.env.CDP_WALLET_SECRET,
);
let payer: string;
let client: x402Client;
if (hasCdpWallet) {
  const cdpClient = new CdpX402Client({
    walletConfig: { type: "eoa", accountName: "bountyverdict-test-buyer" },
    spendControls: {
      maxAmountPerPayment: { atomic: maximumAtomic, asset: requirement.asset },
      maxCumulativeSpend: { atomic: maximumAtomic, asset: requirement.asset },
      maxCumulativeSpendWindow: "24h",
      allowedNetworks: [requirement.network as `${string}:${string}`],
      allowedAssets: [requirement.asset],
      allowedPayees: [requirement.payTo],
    },
  });
  payer = (await cdpClient.getAddresses()).evmAddress;
  client = cdpClient;
} else {
  const privateKey = process.env.BUYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error(
      "Set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET, or provide a funded test-only BUYER_PRIVATE_KEY.",
    );
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  payer = account.address;
  client = new x402Client()
    .register(requirement.network as `${string}:${string}`, new ExactEvmScheme(account))
    .registerPolicy((_version, requirements) =>
      requirements.filter((candidate) => BigInt(candidate.amount) <= maximumAtomic),
    );
}
if (expectedPayer && payer.toLowerCase() !== expectedPayer.toLowerCase()) {
  throw new Error("The active payment signer does not match EXPECTED_PAYER.");
}
const httpClient = new x402HTTPClient(client);
const paymentPayload = await httpClient.createPaymentPayload(challenge as PaymentRequired);
const paidHeaders = new Headers(requestInit.headers);
for (const [name, value] of Object.entries(httpClient.encodePaymentSignatureHeader(paymentPayload))) {
  paidHeaders.set(name, value);
}
const paid = await fetch(url, { ...requestInit, headers: paidHeaders, redirect: "error" });
const processed = await httpClient.processPaymentResult(
  paymentPayload,
  name => paid.headers.get(name),
  paid.status,
);
const responseBody = await paid.json() as {
  verdict?: string;
  score?: number;
  risk_score?: number;
  recommendation?: string;
  checked_at?: string;
  service?: string;
  action?: string;
  ruleset_version?: string;
};
if (!paid.ok) {
  throw new Error(`Paid request failed with HTTP ${paid.status}: ${JSON.stringify(responseBody)}`);
}
const settlementHeader = paid.headers.get("payment-response");
if (!settlementHeader) throw new Error("Successful response omitted PAYMENT-RESPONSE.");
const settlement = processed.settleResponse || decodeHeader(settlementHeader);
if (
  settlement.success !== true ||
  settlement.network !== requirement.network ||
  typeof settlement.transaction !== "string" ||
  !/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction)
) {
  throw new Error("PAYMENT-RESPONSE did not prove successful settlement on the requested network.");
}

console.log(JSON.stringify({
  phase: "payment_settled",
  product,
  payer,
  status: paid.status,
  transaction: settlement.transaction,
  network: settlement.network,
  verdict: responseBody.verdict,
  score: responseBody.score,
  risk_score: responseBody.risk_score,
  recommendation: responseBody.recommendation,
  checked_at: responseBody.checked_at,
  service: responseBody.service,
  action: responseBody.action,
  ruleset_version: responseBody.ruleset_version,
}, null, 2));
