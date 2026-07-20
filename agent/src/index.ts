import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient, type RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { Hono, type MiddlewareHandler } from "hono";
import { CheckError, checkGithubIssue } from "./check";
import { discoveryExtension, exampleVerdict } from "./discovery";

interface Env {
  PAY_TO_ADDRESS?: string;
  GITHUB_TOKEN?: string;
  X402_NETWORK?: string;
  X402_FACILITATOR_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}

type AppBindings = { Bindings: Env };

const PRICE_USD = "$0.25";
const ENDPOINT = "/api/verdict";
const TESTNET_NETWORK = "eip155:84532";
const TESTNET_FACILITATOR = "https://x402.org/facilitator";
const CDP_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";
const PRODUCT_URL = "https://cristianmoroaica.github.io/bountyverdict/";
const ICON_URL = `${PRODUCT_URL}favicon.svg`;

const middlewareCache = new Map<string, MiddlewareHandler>();

function requireAddress(value: string | undefined): `0x${string}` {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error("PAY_TO_ADDRESS must be a public 20-byte EVM address.");
  }
  return value as `0x${string}`;
}

function buildPaymentMiddleware(env: Env): MiddlewareHandler {
  const payTo = requireAddress(env.PAY_TO_ADDRESS);
  const network = env.X402_NETWORK || TESTNET_NETWORK;
  const facilitatorUrl = env.X402_FACILITATOR_URL || TESTNET_FACILITATOR;
  const usingCdp = facilitatorUrl === CDP_FACILITATOR;
  if (usingCdp && (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET)) {
    throw new Error("CDP facilitator requires CDP_API_KEY_ID and CDP_API_KEY_SECRET.");
  }

  const key = [payTo.toLowerCase(), network, facilitatorUrl, usingCdp].join("|");
  const cached = middlewareCache.get(key);
  if (cached) return cached;

  const facilitatorConfig = usingCdp
    ? createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET)
    : { url: facilitatorUrl };
  const resourceServer = new x402ResourceServer(
    new HTTPFacilitatorClient(facilitatorConfig),
  )
    .register(network as `${string}:${string}`, new ExactEvmScheme());

  const routeConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: "Preflight a public GitHub bounty issue before spending agent compute. Returns a deterministic AVOID, CAUTION, or VIABLE verdict with linked evidence for locks, closed state, competing PRs, failed-attempt swarms, maintainer rejection, and withdrawn rewards.",
    mimeType: "application/json",
    serviceName: "BountyVerdict",
    tags: ["github", "bounties", "developer-tools", "risk", "agents"],
    iconUrl: ICON_URL,
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        error: "PAYMENT_REQUIRED",
        product: "BountyVerdict",
        price: PRICE_USD,
        currency: "USDC",
        description: "Pay once to receive a fresh evidence-linked bounty risk verdict.",
        free_sample: "/api/sample",
        documentation: PRODUCT_URL,
      },
    }),
  };
  const middleware = paymentMiddleware(
    { [`GET ${ENDPOINT}`]: routeConfig },
    resourceServer,
  );
  // Attach already-enriched metadata after middleware construction. The Hono
  // adapter otherwise auto-loads the eval-based validator that Workers reject.
  // x402HTTPResourceServer retains this same route object for payment responses.
  routeConfig.extensions = discoveryExtension;
  middlewareCache.set(key, middleware);
  return middleware;
}

const app = new Hono<AppBindings>();

app.get("/", (c) =>
  c.json({
    product: "BountyVerdict",
    status: "available",
    purpose: "Preflight GitHub bounties before an autonomous agent spends compute or reputation.",
    price: PRICE_USD,
    currency: "USDC",
    paid_endpoint: ENDPOINT,
    method: "GET",
    input: { issue_url: "https://github.com/owner/repository/issues/123" },
    sample: "/api/sample",
    human_checker: PRODUCT_URL,
  }),
);

app.get("/api/sample", (c) => c.json(exampleVerdict));

app.use(ENDPOINT, async (c, next) => {
  try {
    return await buildPaymentMiddleware(c.env)(c, next);
  } catch (error) {
    console.error(error);
    return c.json(
      {
        error: "SERVICE_CONFIGURATION_ERROR",
        message: "The payment service is not configured yet.",
      },
      503,
    );
  }
});

app.get(ENDPOINT, async (c) => {
  const issueUrl = c.req.query("issue_url") || "";
  try {
    const verdict = await checkGithubIssue(issueUrl, {
      GITHUB_TOKEN: c.env.GITHUB_TOKEN,
    });
    return c.json(verdict);
  } catch (error) {
    if (error instanceof CheckError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json(
      { error: "INTERNAL_ERROR", message: "The verdict could not be produced." },
      500,
    );
  }
});

app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));

export default app;
