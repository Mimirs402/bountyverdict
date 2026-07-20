import test from "node:test";
import assert from "node:assert/strict";
import { UpdatePolicyBodySchema } from "@coinbase/cdp-sdk";
import {
  SETTLEMENT_POLICY_MAX_ATOMIC,
  SETTLEMENT_POLICY_PAYEE,
  SETTLEMENT_POLICY_USDC,
  SETTLEMENT_WALLET_POLICY_RULE,
  assertStrictSettlementWalletPolicy,
  assertStrictSettlementWalletPolicyPair,
  createStrictSettlementPolicyUpdate,
} from "../src/settlement-wallet-policy.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

function strictPolicy(id: string, scope: "project" | "account"): any {
  return {
    id,
    scope,
    description: "presentation metadata is not security semantics",
    rules: structuredClone(createStrictSettlementPolicyUpdate().rules),
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}

test("strict rule is SDK-valid and pins canonical USDC, seller, and 0.40 USDC", () => {
  const update = createStrictSettlementPolicyUpdate();
  assert.doesNotThrow(() => UpdatePolicyBodySchema.parse(update));
  assert.equal(update.rules.length, 1);
  assert.equal(update.rules[0].operation, "signEvmTypedData");
  assert.equal(SETTLEMENT_POLICY_USDC, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(SETTLEMENT_POLICY_PAYEE, "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614");
  assert.equal(SETTLEMENT_POLICY_MAX_ATOMIC, "400000");
  assert.ok(Object.isFrozen(SETTLEMENT_WALLET_POLICY_RULE));
  assert.ok(Object.isFrozen(SETTLEMENT_WALLET_POLICY_RULE.criteria));
});

test("validator accepts exact project/account policies and AND-order permutations", () => {
  const project = strictPolicy(PROJECT_ID, "project");
  const account = strictPolicy(ACCOUNT_ID, "account");
  project.rules[0].criteria.reverse();
  const field = project.rules[0].criteria.find(
    (criterion: any) => criterion.type === "evmTypedDataField",
  );
  field.conditions.reverse();
  const contract = project.rules[0].criteria.find(
    (criterion: any) => criterion.type === "evmTypedDataVerifyingContract",
  );
  contract.addresses[0] = contract.addresses[0].toLowerCase();
  field.conditions.find((condition: any) => condition.path === "to").addresses[0] =
    SETTLEMENT_POLICY_PAYEE.toLowerCase();

  assert.doesNotThrow(() => assertStrictSettlementWalletPolicyPair(
    project,
    account,
    { projectPolicyId: PROJECT_ID, accountPolicyId: ACCOUNT_ID },
  ));
});

test("validator rejects wrong IDs, scopes, duplicate IDs, and extra rules", () => {
  const policy = strictPolicy(PROJECT_ID, "project");
  assert.throws(
    () => assertStrictSettlementWalletPolicy(policy, {
      id: ACCOUNT_ID,
      scope: "project",
    }),
    /POLICY_ID_CHANGED/,
  );
  assert.throws(
    () => assertStrictSettlementWalletPolicy(policy, {
      id: PROJECT_ID,
      scope: "account",
    }),
    /POLICY_SCOPE_CHANGED/,
  );

  policy.rules.push(structuredClone(policy.rules[0]));
  assert.throws(
    () => assertStrictSettlementWalletPolicy(policy, {
      id: PROJECT_ID,
      scope: "project",
    }),
    /POLICY_RULES_CHANGED/,
  );
  assert.throws(
    () => assertStrictSettlementWalletPolicyPair(
      strictPolicy(PROJECT_ID, "project"),
      strictPolicy(PROJECT_ID, "account"),
      { projectPolicyId: PROJECT_ID, accountPolicyId: PROJECT_ID },
    ),
    /POLICY_IDS_NOT_DISTINCT/,
  );
});

test("validator rejects any broadened operation, criterion, or nested shape", () => {
  const cases: Array<[string, (policy: any) => void, RegExp]> = [
    ["reject action", policy => { policy.rules[0].action = "reject"; }, /RULE_ACTION_CHANGED/],
    ["different operation", policy => { policy.rules[0].operation = "signEvmMessage"; }, /RULE_OPERATION_CHANGED/],
    ["extra rule key", policy => { policy.rules[0].note = "ignored"; }, /RULE_SHAPE_CHANGED/],
    ["extra criterion", policy => { policy.rules[0].criteria.push(structuredClone(policy.rules[0].criteria[0])); }, /RULE_CRITERIA_CHANGED/],
    ["extra criterion key", policy => { policy.rules[0].criteria[0].note = "ignored"; }, /VERIFYING_CONTRACT_CHANGED/],
  ];
  for (const [name, mutate, expected] of cases) {
    const policy = strictPolicy(PROJECT_ID, "project");
    mutate(policy);
    assert.throws(
      () => assertStrictSettlementWalletPolicy(policy, {
        id: PROJECT_ID,
        scope: "project",
      }),
      expected,
      name,
    );
  }
});

test("validator rejects changed USDC contract, seller, amount, and operators", () => {
  const cases: Array<[string, (policy: any) => void, RegExp]> = [
    ["contract", policy => { policy.rules[0].criteria[0].addresses[0] = "0x0000000000000000000000000000000000000001"; }, /VERIFYING_CONTRACT_CHANGED/],
    ["contract list", policy => { policy.rules[0].criteria[0].addresses.push(SETTLEMENT_POLICY_USDC); }, /VERIFYING_CONTRACT_CHANGED/],
    ["seller", policy => { policy.rules[0].criteria[1].conditions[0].addresses[0] = "0x0000000000000000000000000000000000000001"; }, /PAYEE_CONDITION_CHANGED/],
    ["seller operator", policy => { policy.rules[0].criteria[1].conditions[0].operator = "not in"; }, /PAYEE_CONDITION_CHANGED/],
    ["amount", policy => { policy.rules[0].criteria[1].conditions[1].value = "400001"; }, /AMOUNT_CONDITION_CHANGED/],
    ["amount operator", policy => { policy.rules[0].criteria[1].conditions[1].operator = "<"; }, /AMOUNT_CONDITION_CHANGED/],
    ["extra condition", policy => { policy.rules[0].criteria[1].conditions.push({ path: "from", operator: "in", addresses: [SETTLEMENT_POLICY_PAYEE] }); }, /TYPED_DATA_CONDITIONS_CHANGED/],
  ];
  for (const [name, mutate, expected] of cases) {
    const policy = strictPolicy(PROJECT_ID, "project");
    mutate(policy);
    assert.throws(
      () => assertStrictSettlementWalletPolicy(policy, {
        id: PROJECT_ID,
        scope: "project",
      }),
      expected,
      name,
    );
  }
});

test("validator pins the complete ordered TransferWithAuthorization type", () => {
  const cases: Array<[string, (field: any) => void, RegExp]> = [
    ["primary type", field => { field.types.primaryType = "Permit"; }, /PRIMARY_TYPE_CHANGED/],
    ["extra model", field => { field.types.types.Other = []; }, /TYPED_DATA_TYPES_CHANGED/],
    ["field order", field => { field.types.types.TransferWithAuthorization.reverse(); }, /TRANSFER_FIELDS_CHANGED/],
    ["field type", field => { field.types.types.TransferWithAuthorization[2].type = "uint128"; }, /TRANSFER_FIELDS_CHANGED/],
    ["field metadata", field => { field.types.types.TransferWithAuthorization[0].note = "ignored"; }, /TRANSFER_FIELDS_CHANGED/],
  ];
  for (const [name, mutate, expected] of cases) {
    const policy = strictPolicy(PROJECT_ID, "project");
    const field = policy.rules[0].criteria[1];
    mutate(field);
    assert.throws(
      () => assertStrictSettlementWalletPolicy(policy, {
        id: PROJECT_ID,
        scope: "project",
      }),
      expected,
      name,
    );
  }
});

test("policy update factory returns isolated mutable SDK request bodies", () => {
  const first = createStrictSettlementPolicyUpdate();
  const second = createStrictSettlementPolicyUpdate();
  (first.rules[0] as any).criteria[0].addresses[0] =
    "0x0000000000000000000000000000000000000001";
  assert.equal(
    (second.rules[0] as any).criteria[0].addresses[0],
    SETTLEMENT_POLICY_USDC,
  );
  assert.equal(
    (SETTLEMENT_WALLET_POLICY_RULE.criteria[0] as any).addresses[0],
    SETTLEMENT_POLICY_USDC,
  );
});
