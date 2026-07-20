export interface PaymentRequirement {
  amount: string;
  network: string;
  asset: string;
  payTo: string;
}

const USDC_BY_NETWORK: Record<string, string> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export function validatePaymentChallenge(
  challenge: any,
  options: {
    maximumAtomic: bigint;
    executePayment: boolean;
    allowMainnet: boolean;
  },
): PaymentRequirement {
  if (challenge?.x402Version !== 2) {
    throw new Error("The payment challenge must use x402 version 2.");
  }
  if (!Array.isArray(challenge?.accepts) || challenge.accepts.length !== 1) {
    throw new Error("The payment challenge must contain exactly one accepted payment option.");
  }
  const requirement = challenge?.accepts?.[0] as PaymentRequirement | undefined;
  if (!requirement) throw new Error("The payment challenge has no accepted payment option.");
  const expectedAsset = USDC_BY_NETWORK[requirement.network];
  if (!expectedAsset) throw new Error(`Unsupported payment network: ${requirement.network}.`);
  if (requirement.asset?.toLowerCase() !== expectedAsset.toLowerCase()) {
    throw new Error("The payment challenge does not request canonical USDC.");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(requirement.payTo || "")) {
    throw new Error("The payment challenge contains an invalid recipient address.");
  }

  let amount: bigint;
  try {
    amount = BigInt(requirement.amount);
  } catch {
    throw new Error("The payment challenge contains an invalid amount.");
  }
  if (amount <= 0n) throw new Error("The payment challenge amount must be positive.");
  if (amount > options.maximumAtomic) {
    throw new Error(`Advertised price ${amount} exceeds safety cap ${options.maximumAtomic}.`);
  }
  if (
    options.executePayment &&
    requirement.network === "eip155:8453" &&
    !options.allowMainnet
  ) {
    throw new Error("Mainnet payment refused. Set ALLOW_MAINNET_PAYMENT=YES explicitly.");
  }
  return requirement;
}
