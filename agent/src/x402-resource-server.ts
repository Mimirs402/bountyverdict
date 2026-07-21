import { createFacilitatorConfig } from "@coinbase/x402";
import {
  HTTPFacilitatorClient,
  type FacilitatorClient,
  x402ResourceServer,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

export const TESTNET_X402_NETWORK = "eip155:84532";
export const TESTNET_X402_FACILITATOR = "https://x402.org/facilitator";
export const CDP_X402_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";
export const CDP_RESOURCE_DESCRIPTION_MAX_LENGTH = 500;

/**
 * CDP's live facilitator rejects v2 payment payloads whose copied resource
 * description exceeds 500 characters. Fail at middleware construction so a
 * marketing-copy change cannot leave discovery working while checkout fails.
 */
export function requireCdpResourceDescription(description: string): string {
  if (
    typeof description !== "string" ||
    description.length === 0 ||
    description.length > CDP_RESOURCE_DESCRIPTION_MAX_LENGTH
  ) {
    throw new Error(
      `x402 resource descriptions must contain 1-${CDP_RESOURCE_DESCRIPTION_MAX_LENGTH} characters for CDP facilitator compatibility.`,
    );
  }
  return description;
}

export interface X402ServerEnvironment {
  PAY_TO_ADDRESS?: string;
  X402_NETWORK?: string;
  X402_FACILITATOR_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}

export interface X402ServerContext {
  payTo: `0x${string}`;
  network: `${string}:${string}`;
  facilitatorUrl: string;
  usingCdp: boolean;
  cacheKey: string;
  resourceServer: x402ResourceServer;
}

function requireAddress(value: string | undefined): `0x${string}` {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error("PAY_TO_ADDRESS must be a public 20-byte EVM address.");
  }
  return value as `0x${string}`;
}

export function createX402ServerContext(env: X402ServerEnvironment): X402ServerContext {
  const payTo = requireAddress(env.PAY_TO_ADDRESS);
  const network = (env.X402_NETWORK || TESTNET_X402_NETWORK) as `${string}:${string}`;
  if (!/^[a-z0-9]+:[A-Za-z0-9]+$/.test(network)) {
    throw new Error("X402_NETWORK must be a CAIP-2 network identifier.");
  }
  const facilitatorUrl = env.X402_FACILITATOR_URL || TESTNET_X402_FACILITATOR;
  const usingCdp = facilitatorUrl === CDP_X402_FACILITATOR;
  if (usingCdp && (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET)) {
    throw new Error("CDP facilitator requires CDP_API_KEY_ID and CDP_API_KEY_SECRET.");
  }

  const facilitatorConfig = usingCdp
    ? createFacilitatorConfig(env.CDP_API_KEY_ID!, env.CDP_API_KEY_SECRET!)
    : { url: facilitatorUrl };
  const httpFacilitator = new HTTPFacilitatorClient(facilitatorConfig);
  const facilitatorClient: FacilitatorClient = {
    // The economic contract is pinned and independently verified in CI and by
    // post-deploy canaries. Returning it locally keeps an unpaid challenge
    // independent from a regionally unreliable /supported request. Paid
    // verification and settlement remain delegated to the configured facilitator.
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network }],
      extensions: ["bazaar"],
      signers: {},
    }),
    verify: (payload, requirements) => httpFacilitator.verify(payload, requirements),
    settle: (payload, requirements) => httpFacilitator.settle(payload, requirements),
  };
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(network, new ExactEvmScheme());

  return {
    payTo,
    network,
    facilitatorUrl,
    usingCdp,
    cacheKey: [payTo.toLowerCase(), network, facilitatorUrl, usingCdp].join("|"),
    resourceServer,
  };
}
