import { CdpClient, type EvmServerAccount, type Policy } from "@coinbase/cdp-sdk";
import { chmod, mkdir, open, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import {
  SETTLEMENT_BUYER_ACCOUNT_NAME,
  SETTLEMENT_POLICY_MAX_ATOMIC,
  SETTLEMENT_POLICY_PAYEE,
  SETTLEMENT_POLICY_USDC,
  SettlementPolicyValidationError,
  assertStrictSettlementWalletPolicy,
  assertStrictSettlementWalletPolicyPair,
  createStrictSettlementPolicyUpdate,
  type SettlementPolicyScope,
} from "../src/settlement-wallet-policy.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const BUYER_ENV_FILE = process.env.SETTLEMENT_BUYER_ENV_FILE ||
  `${homedir()}/.config/bountyverdict/settlement-buyer.env`;

// CDP idempotency keys are UUIDs. These stable per-operation values make a
// rerun safe after an uncertain transport result.
const PROJECT_POLICY_UPDATE_KEY = "ebc75cc7-d7f7-4e09-9ece-f376e35e4830";
const ACCOUNT_POLICY_UPDATE_KEY = "13a1d272-0444-4a4f-ba58-24c92bcef713";
const ACCOUNT_CREATE_KEY = "0a5107f9-a20f-4223-a8e0-af1e312ab6d4";
const ACCOUNT_ATTACH_KEY = "cfa04aec-f71a-4d73-b249-c15a8fa1478e";

const BOOTSTRAP_ADDRESSES = [
  "0xffffffffffffffffffffffffffffffffffffffff",
  "0x1111111111111111111111111111111111111111",
];
const BROAD_TYPED_DATA_CONTRACTS = [
  // The exact portal-created predecessor currently installed in this project.
  // It is intentionally accepted only as a migration source, never as a final state.
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  SETTLEMENT_POLICY_USDC,
];

class ProvisioningError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ProvisioningError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new ProvisioningError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function exactBootstrapCriterion(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["type", "addresses", "operator"])) {
    return false;
  }
  if (
    value.type !== "evmAddress" ||
    value.operator !== "in" ||
    !Array.isArray(value.addresses) ||
    value.addresses.length !== BOOTSTRAP_ADDRESSES.length
  ) {
    return false;
  }
  return value.addresses.every((address, index) =>
    typeof address === "string" &&
    address.toLowerCase() === BOOTSTRAP_ADDRESSES[index]
  );
}

function exactBootstrapRule(value: unknown, operation: string): boolean {
  if (!isRecord(value) || !exactKeys(value, ["action", "operation", "criteria"])) {
    return false;
  }
  return value.action === "accept" &&
    value.operation === operation &&
    Array.isArray(value.criteria) &&
    value.criteria.length === 1 &&
    exactBootstrapCriterion(value.criteria[0]);
}

function exactBroadTypedDataRule(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["action", "operation", "criteria"])) {
    return false;
  }
  if (
    value.action !== "accept" ||
    value.operation !== "signEvmTypedData" ||
    !Array.isArray(value.criteria) ||
    value.criteria.length !== 1
  ) {
    return false;
  }
  const criterion = value.criteria[0];
  if (
    !isRecord(criterion) ||
    !exactKeys(criterion, ["type", "addresses", "operator"]) ||
    criterion.type !== "evmTypedDataVerifyingContract" ||
    criterion.operator !== "in" ||
    !Array.isArray(criterion.addresses) ||
    criterion.addresses.length !== BROAD_TYPED_DATA_CONTRACTS.length
  ) {
    return false;
  }
  const actual = criterion.addresses.map(address =>
    typeof address === "string" ? address.toLowerCase() : ""
  ).sort();
  const expected = BROAD_TYPED_DATA_CONTRACTS.map(address => address.toLowerCase()).sort();
  return actual.every((address, index) => address === expected[index]);
}

/**
 * The portal template used to bootstrap these two policies is the only
 * non-strict state this script will overwrite. This prevents a stale or wrong
 * policy ID from turning a deliberate policy into this buyer policy.
 */
function assertKnownPreUpdateRules(
  policy: Policy,
  id: string,
  scope: SettlementPolicyScope,
): void {
  try {
    assertStrictSettlementWalletPolicy(policy, { id, scope });
    return;
  } catch (error) {
    if (!(error instanceof SettlementPolicyValidationError)) throw error;
  }

  const expectedOperations = scope === "project"
    ? ["signEvmTransaction", "signEndUserEvmTransaction"]
    : ["signEvmTransaction"];
  const bootstrapMismatch =
    policy.id !== id ||
    policy.scope !== scope ||
    policy.rules.length !== expectedOperations.length ||
    !policy.rules.every((rule, index) =>
      exactBootstrapRule(rule, expectedOperations[index])
    );
  const exactBroadTypedData =
    policy.id === id &&
    policy.scope === scope &&
    policy.rules.length === 1 &&
    exactBroadTypedDataRule(policy.rules[0]);
  if (bootstrapMismatch && !exactBroadTypedData) {
    fail("UNEXPECTED_PREUPDATE_POLICY_RULES");
  }
}

function isStrictPolicy(
  policy: Policy,
  id: string,
  scope: SettlementPolicyScope,
): boolean {
  try {
    assertStrictSettlementWalletPolicy(policy, { id, scope });
    return true;
  } catch (error) {
    if (error instanceof SettlementPolicyValidationError) return false;
    throw error;
  }
}

async function writeBuyerAccountingEnvironment(address: string): Promise<void> {
  await mkdir(dirname(BUYER_ENV_FILE), { recursive: true, mode: 0o700 });
  const temporary = `${BUYER_ENV_FILE}.${process.pid}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(
      `SETTLEMENT_BUYER_ADDRESS=${address}\nSETTLEMENT_CANARY_ENABLED=NO\n`,
      "utf8",
    );
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, BUYER_ENV_FILE);
  await chmod(BUYER_ENV_FILE, 0o600);
}

function assertPolicyIdentity(
  policy: Policy,
  expectedId: string,
  expectedScope: SettlementPolicyScope,
): void {
  if (policy.id !== expectedId) fail("POLICY_ID_CHANGED");
  if (policy.scope !== expectedScope) fail("POLICY_SCOPE_CHANGED");
  if (!Array.isArray(policy.rules) || policy.rules.length === 0) {
    fail("POLICY_RULES_UNAVAILABLE");
  }
}

async function listAllPolicies(
  cdp: CdpClient,
  scope: SettlementPolicyScope,
): Promise<Policy[]> {
  const policies: Policy[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await cdp.policies.listPolicies({
      scope,
      pageSize: PAGE_SIZE,
      pageToken,
    });
    policies.push(...result.policies);
    if (!result.nextPageToken) return policies;
    if (seenTokens.has(result.nextPageToken)) fail("POLICY_PAGINATION_CYCLE");
    seenTokens.add(result.nextPageToken);
    pageToken = result.nextPageToken;
  }
  fail("POLICY_PAGINATION_LIMIT");
}

async function listAllEvmAccounts(cdp: CdpClient): Promise<EvmServerAccount[]> {
  const accounts: EvmServerAccount[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await cdp.evm.listAccounts({ pageSize: PAGE_SIZE, pageToken });
    accounts.push(...result.accounts);
    if (!result.nextPageToken) return accounts;
    if (seenTokens.has(result.nextPageToken)) fail("ACCOUNT_PAGINATION_CYCLE");
    seenTokens.add(result.nextPageToken);
    pageToken = result.nextPageToken;
  }
  fail("ACCOUNT_PAGINATION_LIMIT");
}

function assertExactPolicyInventory(
  policies: readonly Policy[],
  expectedId: string,
  scope: SettlementPolicyScope,
): Policy {
  if (policies.length !== 1) fail("UNEXPECTED_POLICY_INVENTORY");
  const policy = policies[0];
  assertPolicyIdentity(policy, expectedId, scope);
  return policy;
}

function exactPolicyIds(
  actual: readonly string[] | undefined,
  expected: readonly string[],
): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  return actualSorted.every((id, index) => id === expectedSorted[index]);
}

function assertExactAccountInventory(
  accounts: readonly EvmServerAccount[],
  projectPolicyId: string,
  accountPolicyId: string,
): EvmServerAccount | null {
  if (accounts.length > 1) fail("MULTIPLE_EVM_ACCOUNTS");
  if (accounts.length === 0) return null;

  const account = accounts[0];
  if (account.name !== SETTLEMENT_BUYER_ACCOUNT_NAME) {
    fail("UNEXPECTED_EVM_ACCOUNT");
  }
  if (!EVM_ADDRESS.test(account.address)) fail("ACCOUNT_ADDRESS_INVALID");
  const permittedPolicySets = [
    [projectPolicyId],
    [projectPolicyId, accountPolicyId],
  ];
  if (!permittedPolicySets.some(expected => exactPolicyIds(account.policies, expected))) {
    fail("UNEXPECTED_ACCOUNT_POLICY_IDS");
  }
  return account;
}

async function assertConfiguredInventories(
  cdp: CdpClient,
  projectPolicyId: string,
  accountPolicyId: string,
): Promise<{ project: Policy; account: Policy }> {
  const [projectPolicies, accountPolicies] = await Promise.all([
    listAllPolicies(cdp, "project"),
    listAllPolicies(cdp, "account"),
  ]);
  return {
    project: assertExactPolicyInventory(projectPolicies, projectPolicyId, "project"),
    account: assertExactPolicyInventory(accountPolicies, accountPolicyId, "account"),
  };
}

async function updateAndVerifyPolicy(
  cdp: CdpClient,
  id: string,
  scope: SettlementPolicyScope,
  idempotencyKey: string,
): Promise<Policy> {
  const current = await cdp.policies.getPolicyById({ id });
  assertPolicyIdentity(current, id, scope);
  assertKnownPreUpdateRules(current, id, scope);

  try {
    assertStrictSettlementWalletPolicy(current, { id, scope });
    return current;
  } catch (error) {
    if (!(error instanceof SettlementPolicyValidationError)) throw error;
  }

  const updated = await cdp.policies.updatePolicy({
    id,
    policy: createStrictSettlementPolicyUpdate(),
    idempotencyKey,
  });
  assertStrictSettlementWalletPolicy(updated, { id, scope });
  const verified = await cdp.policies.getPolicyById({ id });
  assertStrictSettlementWalletPolicy(verified, { id, scope });
  return verified;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) fail("REQUIRED_ENVIRONMENT_UNAVAILABLE");
  return value;
}

async function main(): Promise<void> {
  if (
    process.env.PROVISION_SETTLEMENT_BUYER !== "YES" ||
    process.env.ACKNOWLEDGE_MAINNET_WALLET_POLICY_REPLACEMENT !== "YES"
  ) {
    fail("EXPLICIT_PROVISIONING_GATES_REQUIRED");
  }

  const apiKeyId = requireEnvironment("CDP_API_KEY_ID");
  const apiKeySecret = requireEnvironment("CDP_API_KEY_SECRET");
  const walletSecret = requireEnvironment("CDP_WALLET_SECRET");
  const projectPolicyId = requireEnvironment("CDP_PROJECT_POLICY_ID");
  const accountPolicyId = requireEnvironment("CDP_ACCOUNT_POLICY_ID");
  if (
    !UUID.test(projectPolicyId) ||
    !UUID.test(accountPolicyId) ||
    projectPolicyId === accountPolicyId
  ) {
    fail("POLICY_IDS_INVALID");
  }

  const cdp = new CdpClient({ apiKeyId, apiKeySecret, walletSecret });

  const initialPolicies = await assertConfiguredInventories(
    cdp,
    projectPolicyId,
    accountPolicyId,
  );
  assertKnownPreUpdateRules(initialPolicies.project, projectPolicyId, "project");
  assertKnownPreUpdateRules(initialPolicies.account, accountPolicyId, "account");
  const initialAccount = assertExactAccountInventory(
    await listAllEvmAccounts(cdp),
    projectPolicyId,
    accountPolicyId,
  );
  if (
    initialAccount &&
    (!isStrictPolicy(initialPolicies.project, projectPolicyId, "project") ||
      !isStrictPolicy(initialPolicies.account, accountPolicyId, "account"))
  ) {
    fail("EXISTING_ACCOUNT_REQUIRES_ALREADY_STRICT_POLICIES");
  }

  const projectPolicy = await updateAndVerifyPolicy(
    cdp,
    projectPolicyId,
    "project",
    PROJECT_POLICY_UPDATE_KEY,
  );
  const accountPolicy = await updateAndVerifyPolicy(
    cdp,
    accountPolicyId,
    "account",
    ACCOUNT_POLICY_UPDATE_KEY,
  );
  assertStrictSettlementWalletPolicyPair(projectPolicy, accountPolicy, {
    projectPolicyId,
    accountPolicyId,
  });

  const verifiedInventory = await assertConfiguredInventories(
    cdp,
    projectPolicyId,
    accountPolicyId,
  );
  assertStrictSettlementWalletPolicyPair(
    verifiedInventory.project,
    verifiedInventory.account,
    { projectPolicyId, accountPolicyId },
  );

  const accountBeforeAttach = assertExactAccountInventory(
    await listAllEvmAccounts(cdp),
    projectPolicyId,
    accountPolicyId,
  );
  if (
    (initialAccount === null) !== (accountBeforeAttach === null) ||
    (initialAccount && accountBeforeAttach &&
      initialAccount.address.toLowerCase() !== accountBeforeAttach.address.toLowerCase())
  ) {
    fail("ACCOUNT_INVENTORY_CHANGED_DURING_PROVISIONING");
  }

  const attached = accountBeforeAttach === null
    ? await cdp.evm.createAccount({
        name: SETTLEMENT_BUYER_ACCOUNT_NAME,
        accountPolicy: accountPolicyId,
        idempotencyKey: ACCOUNT_CREATE_KEY,
      })
    : await cdp.evm.updateAccount({
        address: accountBeforeAttach.address,
        update: { accountPolicy: accountPolicyId },
        idempotencyKey: ACCOUNT_ATTACH_KEY,
      });

  if (
    attached.name !== SETTLEMENT_BUYER_ACCOUNT_NAME ||
    !EVM_ADDRESS.test(attached.address) ||
    !exactPolicyIds(attached.policies, [projectPolicyId, accountPolicyId])
  ) {
    fail("ACCOUNT_POLICY_ATTACHMENT_NOT_VERIFIED");
  }

  const finalAccount = assertExactAccountInventory(
    await listAllEvmAccounts(cdp),
    projectPolicyId,
    accountPolicyId,
  );
  if (
    !finalAccount ||
    finalAccount.address.toLowerCase() !== attached.address.toLowerCase() ||
    !exactPolicyIds(finalAccount.policies, [projectPolicyId, accountPolicyId])
  ) {
    fail("FINAL_ACCOUNT_VERIFICATION_FAILED");
  }

  await writeBuyerAccountingEnvironment(finalAccount.address);

  console.log(JSON.stringify({
    provisioned: true,
    account: {
      name: finalAccount.name,
      address: finalAccount.address,
      policy_ids: [projectPolicyId, accountPolicyId],
    },
    policy: {
      project_policy_id: projectPolicyId,
      account_policy_id: accountPolicyId,
      operation: "signEvmTypedData",
      primary_type: "TransferWithAuthorization",
      asset: SETTLEMENT_POLICY_USDC,
      payee: SETTLEMENT_POLICY_PAYEE,
      max_amount_atomic: SETTLEMENT_POLICY_MAX_ATOMIC,
    },
    accounting_environment_written: BUYER_ENV_FILE,
  }, null, 2));
}

await main().catch(error => {
  const errorCode = error instanceof ProvisioningError ||
      error instanceof SettlementPolicyValidationError
    ? error.code
    : "UNEXPECTED_REMOTE_FAILURE";
  const remote = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    errorType?: unknown;
    response?: { status?: unknown };
  };
  console.error(JSON.stringify({
    provisioned: false,
    error_code: errorCode,
    error_name: typeof remote?.name === "string" ? remote.name : null,
    remote_code: typeof remote?.code === "string" ? remote.code : null,
    remote_type: typeof remote?.errorType === "string" ? remote.errorType : null,
    remote_status: typeof remote?.statusCode === "number"
      ? remote.statusCode
      : typeof remote?.status === "number"
      ? remote.status
      : typeof remote?.response?.status === "number"
        ? remote.response.status
        : null,
  }));
  process.exitCode = 1;
});
