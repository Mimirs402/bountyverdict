import type { Policy, UpdatePolicyBody } from "@coinbase/cdp-sdk";

export const SETTLEMENT_BUYER_ACCOUNT_NAME = "bountyverdict-test-buyer";
export const SETTLEMENT_POLICY_DESCRIPTION = "BountyVerdict x402 settlement buyer";
export const SETTLEMENT_POLICY_USDC =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const SETTLEMENT_POLICY_PAYEE =
  "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
export const SETTLEMENT_POLICY_MAX_ATOMIC = "400000";

const TRANSFER_WITH_AUTHORIZATION_FIELDS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

/**
 * The only signature this buyer may produce: canonical Base USDC's EIP-3009
 * TransferWithAuthorization, paid to the production seller for at most $0.40.
 * Unmatched operations are rejected by CDP's fail-secure policy evaluation.
 */
export const SETTLEMENT_WALLET_POLICY_RULE = Object.freeze({
  action: "accept" as const,
  operation: "signEvmTypedData" as const,
  criteria: Object.freeze([
    Object.freeze({
      type: "evmTypedDataVerifyingContract" as const,
      addresses: Object.freeze([SETTLEMENT_POLICY_USDC]),
      operator: "in" as const,
    }),
    Object.freeze({
      type: "evmTypedDataField" as const,
      types: Object.freeze({
        types: Object.freeze({
          TransferWithAuthorization: Object.freeze(
            TRANSFER_WITH_AUTHORIZATION_FIELDS.map(field => Object.freeze({ ...field })),
          ),
        }),
        primaryType: "TransferWithAuthorization",
      }),
      conditions: Object.freeze([
        Object.freeze({
          path: "to",
          operator: "in" as const,
          addresses: Object.freeze([SETTLEMENT_POLICY_PAYEE]),
        }),
        Object.freeze({
          path: "value",
          operator: "<=" as const,
          value: SETTLEMENT_POLICY_MAX_ATOMIC,
        }),
      ]),
    }),
  ]),
});

export type SettlementPolicyScope = "project" | "account";

export interface ExpectedSettlementPolicy {
  id: string;
  scope: SettlementPolicyScope;
}

export interface ExpectedSettlementPolicyPair {
  projectPolicyId: string;
  accountPolicyId: string;
}

export class SettlementPolicyValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "SettlementPolicyValidationError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new SettlementPolicyValidationError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value)) fail(code);
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code);
  }
}

function requireExactString(value: unknown, expected: string, code: string): void {
  if (value !== expected) fail(code);
}

function requireExactAddress(value: unknown, expected: string, code: string): void {
  if (
    typeof value !== "string" ||
    value.toLowerCase() !== expected.toLowerCase()
  ) {
    fail(code);
  }
}

function requireSingleAddress(
  value: unknown,
  expected: string,
  code: string,
): void {
  if (!Array.isArray(value) || value.length !== 1) fail(code);
  requireExactAddress(value[0], expected, code);
}

function assertTransferTypeDefinitions(value: unknown): void {
  const wrapper = requireRecord(value, "TYPED_DATA_TYPES_INVALID");
  requireExactKeys(wrapper, ["types", "primaryType"], "TYPED_DATA_TYPES_INVALID");
  requireExactString(
    wrapper.primaryType,
    "TransferWithAuthorization",
    "PRIMARY_TYPE_CHANGED",
  );

  const types = requireRecord(wrapper.types, "TYPED_DATA_TYPES_INVALID");
  requireExactKeys(types, ["TransferWithAuthorization"], "TYPED_DATA_TYPES_CHANGED");
  const fields = types.TransferWithAuthorization;
  if (
    !Array.isArray(fields) ||
    fields.length !== TRANSFER_WITH_AUTHORIZATION_FIELDS.length
  ) {
    fail("TRANSFER_FIELDS_CHANGED");
  }
  for (let index = 0; index < TRANSFER_WITH_AUTHORIZATION_FIELDS.length; index += 1) {
    const field = requireRecord(fields[index], "TRANSFER_FIELDS_CHANGED");
    requireExactKeys(field, ["name", "type"], "TRANSFER_FIELDS_CHANGED");
    requireExactString(
      field.name,
      TRANSFER_WITH_AUTHORIZATION_FIELDS[index].name,
      "TRANSFER_FIELDS_CHANGED",
    );
    requireExactString(
      field.type,
      TRANSFER_WITH_AUTHORIZATION_FIELDS[index].type,
      "TRANSFER_FIELDS_CHANGED",
    );
  }
}

function assertTypedDataConditions(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 2) fail("TYPED_DATA_CONDITIONS_CHANGED");

  let payeeCondition: Record<string, unknown> | undefined;
  let amountCondition: Record<string, unknown> | undefined;
  for (const candidate of value) {
    const condition = requireRecord(candidate, "TYPED_DATA_CONDITIONS_CHANGED");
    if (condition.path === "to" && payeeCondition === undefined) {
      payeeCondition = condition;
    } else if (condition.path === "value" && amountCondition === undefined) {
      amountCondition = condition;
    } else {
      fail("TYPED_DATA_CONDITIONS_CHANGED");
    }
  }

  if (!payeeCondition || !amountCondition) fail("TYPED_DATA_CONDITIONS_CHANGED");
  requireExactKeys(
    payeeCondition,
    ["path", "operator", "addresses"],
    "PAYEE_CONDITION_CHANGED",
  );
  requireExactString(payeeCondition.operator, "in", "PAYEE_CONDITION_CHANGED");
  requireSingleAddress(
    payeeCondition.addresses,
    SETTLEMENT_POLICY_PAYEE,
    "PAYEE_CONDITION_CHANGED",
  );

  requireExactKeys(
    amountCondition,
    ["path", "operator", "value"],
    "AMOUNT_CONDITION_CHANGED",
  );
  requireExactString(amountCondition.operator, "<=", "AMOUNT_CONDITION_CHANGED");
  requireExactString(
    amountCondition.value,
    SETTLEMENT_POLICY_MAX_ATOMIC,
    "AMOUNT_CONDITION_CHANGED",
  );
}

function assertStrictRule(value: unknown): void {
  const rule = requireRecord(value, "RULE_INVALID");
  requireExactKeys(rule, ["action", "operation", "criteria"], "RULE_SHAPE_CHANGED");
  requireExactString(rule.action, "accept", "RULE_ACTION_CHANGED");
  requireExactString(rule.operation, "signEvmTypedData", "RULE_OPERATION_CHANGED");
  if (!Array.isArray(rule.criteria) || rule.criteria.length !== 2) {
    fail("RULE_CRITERIA_CHANGED");
  }

  let contractCriterion: Record<string, unknown> | undefined;
  let fieldCriterion: Record<string, unknown> | undefined;
  for (const candidate of rule.criteria) {
    const criterion = requireRecord(candidate, "RULE_CRITERIA_CHANGED");
    if (
      criterion.type === "evmTypedDataVerifyingContract" &&
      contractCriterion === undefined
    ) {
      contractCriterion = criterion;
    } else if (
      criterion.type === "evmTypedDataField" &&
      fieldCriterion === undefined
    ) {
      fieldCriterion = criterion;
    } else {
      fail("RULE_CRITERIA_CHANGED");
    }
  }

  if (!contractCriterion || !fieldCriterion) fail("RULE_CRITERIA_CHANGED");
  requireExactKeys(
    contractCriterion,
    ["type", "addresses", "operator"],
    "VERIFYING_CONTRACT_CHANGED",
  );
  requireExactString(contractCriterion.operator, "in", "VERIFYING_CONTRACT_CHANGED");
  requireSingleAddress(
    contractCriterion.addresses,
    SETTLEMENT_POLICY_USDC,
    "VERIFYING_CONTRACT_CHANGED",
  );

  requireExactKeys(
    fieldCriterion,
    ["type", "types", "conditions"],
    "TYPED_DATA_FIELD_CHANGED",
  );
  assertTransferTypeDefinitions(fieldCriterion.types);
  assertTypedDataConditions(fieldCriterion.conditions);
}

/**
 * Validate policy semantics independently of presentation metadata. Criterion
 * and condition order may vary because both are logical ANDs; every semantic
 * element and all nested keys must otherwise match exactly.
 */
export function assertStrictSettlementWalletPolicy(
  policy: unknown,
  expected: ExpectedSettlementPolicy,
): void {
  const value = requireRecord(policy, "POLICY_INVALID");
  requireExactString(value.id, expected.id, "POLICY_ID_CHANGED");
  requireExactString(value.scope, expected.scope, "POLICY_SCOPE_CHANGED");
  if (!Array.isArray(value.rules) || value.rules.length !== 1) {
    fail("POLICY_RULES_CHANGED");
  }
  assertStrictRule(value.rules[0]);
}

export function assertStrictSettlementWalletPolicyPair(
  projectPolicy: unknown,
  accountPolicy: unknown,
  expected: ExpectedSettlementPolicyPair,
): void {
  if (expected.projectPolicyId === expected.accountPolicyId) {
    fail("POLICY_IDS_NOT_DISTINCT");
  }
  assertStrictSettlementWalletPolicy(projectPolicy, {
    id: expected.projectPolicyId,
    scope: "project",
  });
  assertStrictSettlementWalletPolicy(accountPolicy, {
    id: expected.accountPolicyId,
    scope: "account",
  });
}

/** Return a fresh mutable SDK request body so callers cannot alter the constant. */
export function createStrictSettlementPolicyUpdate(): UpdatePolicyBody {
  return {
    description: SETTLEMENT_POLICY_DESCRIPTION,
    rules: [{
      action: "accept",
      operation: "signEvmTypedData",
      criteria: [
        {
          type: "evmTypedDataVerifyingContract",
          addresses: [SETTLEMENT_POLICY_USDC],
          operator: "in",
        },
        {
          type: "evmTypedDataField",
          types: {
            types: {
              TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_FIELDS.map(field => ({
                ...field,
              })),
            },
            primaryType: "TransferWithAuthorization",
          },
          conditions: [
            {
              path: "to",
              operator: "in",
              addresses: [SETTLEMENT_POLICY_PAYEE],
            },
            {
              path: "value",
              operator: "<=",
              value: SETTLEMENT_POLICY_MAX_ATOMIC,
            },
          ],
        },
      ],
    }],
  };
}

// Keep the imported SDK Policy type coupled to the validator's intended API
// without requiring callers to trust an unchecked cast.
export type SettlementWalletPolicy = Policy;
