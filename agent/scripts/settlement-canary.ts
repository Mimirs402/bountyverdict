import { CdpClient } from "@coinbase/cdp-sdk";
import {
  applySpendControls,
  fromCdpEvmAccount,
} from "@coinbase/cdp-sdk/x402";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { x402HTTPClient } from "@x402/fetch";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  SETTLEMENT_CANARY_ASSET,
  SETTLEMENT_CANARY_NETWORK,
  SETTLEMENT_CANARY_PAYEE,
  SETTLEMENT_CANARY_PRODUCTS,
  getSettlementCanaryFixture,
  runSettlementCanary,
  selectSettlementCanaryProduct,
  assertSettlementCanarySpacing,
  type SettlementCanaryResult,
} from "../src/settlement-canary.ts";
import { PrivateFileSpendStore } from "../src/file-spend-store.ts";
import {
  SETTLEMENT_BUYER_ACCOUNT_NAME,
  assertStrictSettlementWalletPolicyPair,
} from "../src/settlement-wallet-policy.ts";

const STATE_FILE = `${homedir()}/.local/state/bountyverdict/settlement-canary.json`;
const LEDGER_FILE = `${homedir()}/.local/state/bountyverdict/settlement-spend-ledger.json`;
const LOCK_FILE = `${homedir()}/.local/state/bountyverdict/settlement-canary.lock`;
const MAX_STATE_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readPreviousState(): Promise<SettlementCanaryResult | null> {
  try {
    const text = await readFile(STATE_FILE, "utf8");
    if (Buffer.byteLength(text) > MAX_STATE_BYTES) {
      throw new Error("state too large");
    }
    const parsed: unknown = JSON.parse(text);
    if (
      !isRecord(parsed) ||
      parsed.canary !== "BountyVerdict real x402 settlement" ||
      parsed.version !== "1.0" ||
      typeof parsed.product !== "string" ||
      !SETTLEMENT_CANARY_PRODUCTS.includes(parsed.product as never) ||
      typeof parsed.attempted_at !== "string" ||
      !Number.isFinite(Date.parse(parsed.attempted_at)) ||
      typeof parsed.completed_at !== "string" ||
      !Number.isFinite(Date.parse(parsed.completed_at)) ||
      !["SETTLED", "CONTRACT_FAILED", "FAILED", "AMBIGUOUS"].includes(String(parsed.status)) ||
      typeof parsed.healthy !== "boolean" ||
      typeof parsed.payment_authorized !== "boolean" ||
      typeof parsed.requires_reconciliation !== "boolean"
    ) {
      throw new Error("state invalid");
    }
    const fixture = getSettlementCanaryFixture(parsed.product as never);
    if (
      parsed.service !== fixture.service ||
      parsed.amount_atomic !== fixture.amountAtomic ||
      parsed.resource !== fixture.url ||
      parsed.method !== fixture.method ||
      parsed.network !== SETTLEMENT_CANARY_NETWORK ||
      typeof parsed.asset !== "string" ||
      parsed.asset.toLowerCase() !== SETTLEMENT_CANARY_ASSET.toLowerCase() ||
      typeof parsed.payee !== "string" ||
      parsed.payee.toLowerCase() !== SETTLEMENT_CANARY_PAYEE.toLowerCase() ||
      (parsed.status === "AMBIGUOUS") !== parsed.requires_reconciliation ||
      (parsed.status === "SETTLED") !== parsed.healthy ||
      (["SETTLED", "CONTRACT_FAILED"].includes(String(parsed.status))
        ? typeof parsed.transaction_hash !== "string" ||
          !/^0x[0-9a-fA-F]{64}$/.test(parsed.transaction_hash)
        : parsed.transaction_hash !== null)
    ) {
      throw new Error("state invalid");
    }
    return parsed as unknown as SettlementCanaryResult;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new Error("Settlement canary state could not be read safely.");
  }
}

async function writePrivateAtomicState(result: SettlementCanaryResult): Promise<void> {
  const directory = dirname(STATE_FILE);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${STATE_FILE}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, STATE_FILE);
    await chmod(STATE_FILE, 0o600);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function requireWalletEnvironment(): void {
  if (
    !process.env.CDP_API_KEY_ID ||
    !process.env.CDP_API_KEY_SECRET ||
    !process.env.CDP_WALLET_SECRET ||
    !process.env.CDP_PROJECT_POLICY_ID ||
    !process.env.CDP_ACCOUNT_POLICY_ID ||
    !process.env.SETTLEMENT_BUYER_ADDRESS
  ) {
    throw new Error("Settlement canary wallet or policy configuration is unavailable.");
  }
}

async function acquireExclusiveRunLock(): Promise<Awaited<ReturnType<typeof open>>> {
  await mkdir(dirname(LOCK_FILE), { recursive: true, mode: 0o700 });
  try {
    return await open(LOCK_FILE, "wx", 0o600);
  } catch {
    throw new Error("Settlement canary is locked pending completion or reconciliation.");
  }
}

function exactPolicyIds(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const expectedSorted = [...expected].sort();
  return [...actual].sort().every((id, index) => id === expectedSorted[index]);
}

async function createPolicyBoundPaymentClient(): Promise<x402HTTPClient> {
  const projectPolicyId = process.env.CDP_PROJECT_POLICY_ID!;
  const accountPolicyId = process.env.CDP_ACCOUNT_POLICY_ID!;
  const expectedAddress = process.env.SETTLEMENT_BUYER_ADDRESS!;
  if (
    !UUID.test(projectPolicyId) ||
    !UUID.test(accountPolicyId) ||
    projectPolicyId === accountPolicyId ||
    !EVM_ADDRESS.test(expectedAddress)
  ) {
    throw new Error("Settlement canary wallet or policy configuration is invalid.");
  }

  const cdp = new CdpClient();
  const [projectPolicy, accountPolicy, accountPage] = await Promise.all([
    cdp.policies.getPolicyById({ id: projectPolicyId }),
    cdp.policies.getPolicyById({ id: accountPolicyId }),
    cdp.evm.listAccounts({ pageSize: 100 }),
  ]);
  assertStrictSettlementWalletPolicyPair(projectPolicy, accountPolicy, {
    projectPolicyId,
    accountPolicyId,
  });
  if (accountPage.nextPageToken || accountPage.accounts.length !== 1) {
    throw new Error("Settlement canary requires exactly one policy-bound EVM account.");
  }
  const account = accountPage.accounts[0];
  if (
    account.name !== SETTLEMENT_BUYER_ACCOUNT_NAME ||
    account.address.toLowerCase() !== expectedAddress.toLowerCase() ||
    !exactPolicyIds(account.policies, [projectPolicyId, accountPolicyId])
  ) {
    throw new Error("Settlement buyer account identity or policy attachment changed.");
  }

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: fromCdpEvmAccount(account) });
  applySpendControls(client, {
    maxAmountPerPayment: {
      atomic: 400_000n,
      asset: SETTLEMENT_CANARY_ASSET,
    },
    maxCumulativeSpend: {
      atomic: 400_000n,
      asset: SETTLEMENT_CANARY_ASSET,
    },
    maxCumulativeSpendWindow: "7d",
    allowedNetworks: [SETTLEMENT_CANARY_NETWORK],
    allowedAssets: [SETTLEMENT_CANARY_ASSET],
    allowedPayees: [SETTLEMENT_CANARY_PAYEE],
    maxLedgerEntries: 64,
    store: new PrivateFileSpendStore(LEDGER_FILE, 64),
  });
  return new x402HTTPClient(client);
}

async function main(): Promise<void> {
  if (
    process.env.EXECUTE_SETTLEMENT_CANARY !== "YES" ||
    process.env.ALLOW_MAINNET_SETTLEMENT_CANARY !== "YES"
  ) {
    throw new Error("The two explicit settlement execution gates are not enabled.");
  }
  requireWalletEnvironment();
  const lock = await acquireExclusiveRunLock();
  try {
    const selectedAt = new Date();
    const previous = await readPreviousState();
    if (previous?.requires_reconciliation === true) {
      throw new Error(
        "The previous payment result is ambiguous; on-chain reconciliation is required.",
      );
    }
    if (previous) assertSettlementCanarySpacing(previous.attempted_at, selectedAt);

    const product = selectSettlementCanaryProduct(
      process.env.SETTLEMENT_CANARY_PRODUCT,
      selectedAt,
    );
    getSettlementCanaryFixture(product);
    const httpClient = await createPolicyBoundPaymentClient();
    const result = await runSettlementCanary({
      product,
      payment: {
        createPaymentPayload: challenge =>
          httpClient.createPaymentPayload(challenge as unknown as PaymentRequired),
        encodePaymentHeaders: payload =>
          httpClient.encodePaymentSignatureHeader(payload as PaymentPayload),
      },
      onPaymentAuthorized: writePrivateAtomicState,
    });
    await writePrivateAtomicState(result);

    // This report contains only pinned public metadata and the public settlement
    // hash. Payment payloads, the payer address, and credential values are never
    // persisted or printed.
    console.log(JSON.stringify(result, null, 2));
    if (!result.healthy) process.exitCode = 1;
  } finally {
    await lock.close().catch(() => undefined);
    await rm(LOCK_FILE, { force: true });
  }
}

await main().catch(() => {
  console.error("Settlement canary did not run; no automatic retry was attempted.");
  process.exitCode = 1;
});
