type UnknownRecord = Record<string, unknown>;

const states = ["PENDING", "FUNDED", "DELIVERED", "RELEASED", "REFUNDED", "DISPUTED"] as const;
export type ClawlancerTransactionState = typeof states[number];

export const CLAWLANCER_CANARY = Object.freeze({
  transactionId: "817ed407-c033-4acf-b6f9-7be5b41ec58e",
  listingId: "e2c25cd3-1641-4bd5-951f-ee163c820b5a",
  buyerAddress: "0x6b3b8b8026475890f3c4d153cb712fc83e6b997d",
  sellerAddress: "0xe5E0fe496B7283032d034Dc79C305b384Ad1ee67",
  amountAtomic: "10000",
});

export const CLAWLANCER_CHAIN = Object.freeze({
  network: "eip155:8453",
  escrowAddress: "0xD99dD1d3A28880d8dcf4BAe0Fc2207051726A7d7",
  oracleAddress: "0x4602973aa67b70bfd08d299f2aafc084179a8101",
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  contractVersion: 1,
});

export type ClawlancerTransaction = {
  id: string;
  listingId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountAtomic: string;
  currency: "USDC";
  state: ClawlancerTransactionState;
  fundingTxHash: string | null;
  releaseTxHash: string | null;
  escrowId: string | null;
  oracleFunded: boolean;
  reconciled: boolean;
  contractVersion: 1;
  deadline: string;
};

export type ClawlancerWorkState = {
  schemaVersion: 2;
  status: Lowercase<ClawlancerTransactionState>;
  checkedAt: string;
  action: ClawlancerWorkAction;
  submittedNow: boolean;
  readOnly: true;
  externalActionsEnabled: false;
  deliveryDisabled: true;
  transaction: ClawlancerTransaction;
  artifact: { path: string; sha256: string };
  accounting: "no_released_payment_not_revenue" | "release_reported_but_not_onchain_verified_not_revenue";
};

function object(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as UnknownRecord;
}

function exactString(value: unknown, label: string, pattern: RegExp, maximum = 256): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !pattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function optionalHash(value: unknown, label: string): string | null {
  return value === null ? null : exactString(value, label, /^0x[a-f0-9]{64}$/i, 66);
}

function parseNormalizedTransaction(value: unknown): ClawlancerTransaction {
  const transaction = object(value, "Persisted Clawlancer transaction");
  const amount = transaction.amountAtomic;
  if (typeof amount !== "string" || !/^[1-9][0-9]{0,15}$/.test(amount)) {
    throw new Error("Persisted Clawlancer amount is invalid.");
  }
  const deadline = exactString(transaction.deadline, "Persisted Clawlancer deadline", /^\d{4}-\d{2}-\d{2}T/, 64);
  if (!Number.isFinite(Date.parse(deadline))) throw new Error("Persisted Clawlancer deadline is invalid.");
  if (transaction.currency !== "USDC") throw new Error("Persisted Clawlancer currency is not USDC.");
  if (typeof transaction.oracleFunded !== "boolean" || typeof transaction.reconciled !== "boolean" ||
    transaction.contractVersion !== CLAWLANCER_CHAIN.contractVersion) {
    throw new Error("Persisted Clawlancer funding metadata is invalid.");
  }
  return {
    id: exactString(transaction.id, "Persisted Clawlancer transaction ID", /^[a-f0-9-]{36}$/i, 36),
    listingId: exactString(transaction.listingId, "Persisted Clawlancer listing ID", /^[a-f0-9-]{36}$/i, 36),
    buyerAddress: exactString(transaction.buyerAddress, "Persisted Clawlancer buyer address", /^0x[a-f0-9]{40}$/i, 42),
    sellerAddress: exactString(transaction.sellerAddress, "Persisted Clawlancer seller address", /^0x[a-f0-9]{40}$/i, 42),
    amountAtomic: amount,
    currency: "USDC",
    state: exactString(transaction.state, "Persisted Clawlancer state", /^(?:PENDING|FUNDED|DELIVERED|RELEASED|REFUNDED|DISPUTED)$/) as ClawlancerTransactionState,
    fundingTxHash: optionalHash(transaction.fundingTxHash, "Persisted Clawlancer funding transaction"),
    releaseTxHash: optionalHash(transaction.releaseTxHash, "Persisted Clawlancer release transaction"),
    escrowId: optionalHash(transaction.escrowId, "Persisted Clawlancer escrow ID"),
    oracleFunded: transaction.oracleFunded,
    reconciled: transaction.reconciled,
    contractVersion: 1,
    deadline,
  };
}

export function parseClawlancerTransaction(value: unknown): ClawlancerTransaction {
  const transaction = object(value, "Clawlancer transaction");
  const buyer = object(transaction.buyer, "Clawlancer buyer");
  const seller = object(transaction.seller, "Clawlancer seller");
  const state = exactString(transaction.state, "Clawlancer state", /^(?:PENDING|FUNDED|DELIVERED|RELEASED|REFUNDED|DISPUTED)$/) as ClawlancerTransactionState;
  const amount = transaction.amount_wei;
  if ((!Number.isSafeInteger(amount) && typeof amount !== "string") || !/^[1-9][0-9]{0,15}$/.test(String(amount))) {
    throw new Error("Clawlancer amount is invalid.");
  }
  const deadline = exactString(transaction.deadline, "Clawlancer deadline", /^\d{4}-\d{2}-\d{2}T/, 64);
  if (!Number.isFinite(Date.parse(deadline))) throw new Error("Clawlancer deadline is invalid.");
  if (transaction.currency !== "USDC") throw new Error("Clawlancer currency is not USDC.");
  if (typeof transaction.oracle_funded !== "boolean" || typeof transaction.reconciled !== "boolean" ||
    transaction.contract_version !== CLAWLANCER_CHAIN.contractVersion) {
    throw new Error("Clawlancer funding metadata is invalid.");
  }
  return {
    id: exactString(transaction.id, "Clawlancer transaction ID", /^[a-f0-9-]{36}$/i, 36),
    listingId: exactString(transaction.listing_id, "Clawlancer listing ID", /^[a-f0-9-]{36}$/i, 36),
    buyerAddress: exactString(buyer.wallet_address, "Clawlancer buyer address", /^0x[a-f0-9]{40}$/i, 42),
    sellerAddress: exactString(seller.wallet_address, "Clawlancer seller address", /^0x[a-f0-9]{40}$/i, 42),
    amountAtomic: String(amount),
    currency: "USDC",
    state,
    fundingTxHash: optionalHash(transaction.tx_hash, "Clawlancer funding transaction"),
    releaseTxHash: optionalHash(transaction.release_tx_hash, "Clawlancer release transaction"),
    escrowId: optionalHash(transaction.escrow_id, "Clawlancer escrow ID"),
    oracleFunded: transaction.oracle_funded,
    reconciled: transaction.reconciled,
    contractVersion: 1,
    deadline,
  };
}

export type ClawlancerWorkAction = "wait_for_funding" | "submit_work" | "wait_for_release" |
  "verify_release" | "terminal";

export function clawlancerWorkAction(transaction: ClawlancerTransaction): ClawlancerWorkAction {
  if (transaction.state === "PENDING") return "wait_for_funding";
  if (transaction.state === "FUNDED") return "submit_work";
  if (transaction.state === "DELIVERED") return "wait_for_release";
  if (transaction.state === "RELEASED") return "verify_release";
  return "terminal";
}

export function parseClawlancerWorkState(value: unknown): ClawlancerWorkState {
  const state = object(value, "Clawlancer work state");
  if (state.schema_version !== 2) throw new Error("Clawlancer work-state schema is unsupported.");
  const checkedAt = exactString(state.checked_at, "Clawlancer work-state timestamp", /^\d{4}-\d{2}-\d{2}T/, 64);
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error("Clawlancer work-state timestamp is invalid.");
  if (typeof state.submitted_now !== "boolean") throw new Error("Clawlancer submitted flag is invalid.");
  if (state.read_only !== true || state.external_actions_enabled !== false || state.delivery_disabled !== true) {
    throw new Error("Clawlancer work-state mutation boundary is invalid.");
  }
  if (state.submitted_now !== false) throw new Error("Read-only Clawlancer reconciliation cannot submit work.");
  const transaction = parseNormalizedTransaction(state.transaction);
  const status = exactString(
    state.status,
    "Clawlancer work-state status",
    /^(?:pending|funded|delivered|released|refunded|disputed)$/,
  ) as Lowercase<ClawlancerTransactionState>;
  const action = exactString(
    state.action,
    "Clawlancer work-state action",
    /^(?:wait_for_funding|submit_work|wait_for_release|verify_release|terminal)$/,
  ) as ClawlancerWorkAction;
  if (status !== transaction.state.toLowerCase() || action !== clawlancerWorkAction(transaction)) {
    throw new Error("Clawlancer work-state status or action does not match its transaction.");
  }
  const artifact = object(state.artifact, "Clawlancer work-state artifact");
  const accounting = exactString(
    state.accounting,
    "Clawlancer work-state accounting",
    /^(?:no_released_payment_not_revenue|release_reported_but_not_onchain_verified_not_revenue)$/,
  ) as ClawlancerWorkState["accounting"];
  const expectedAccounting = transaction.state === "RELEASED"
    ? "release_reported_but_not_onchain_verified_not_revenue"
    : "no_released_payment_not_revenue";
  if (accounting !== expectedAccounting) throw new Error("Clawlancer work-state accounting is inconsistent.");
  return {
    schemaVersion: 2,
    status,
    checkedAt,
    action,
    submittedNow: state.submitted_now,
    readOnly: true,
    externalActionsEnabled: false,
    deliveryDisabled: true,
    transaction,
    artifact: {
      path: exactString(artifact.path, "Clawlancer artifact path", /^\//, 512),
      sha256: exactString(artifact.sha256, "Clawlancer artifact hash", /^[a-f0-9]{64}$/i, 64),
    },
    accounting,
  };
}
