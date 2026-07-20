import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { Hono, type MiddlewareHandler } from "hono";
import { CheckError, checkGithubIssue } from "./check";

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

const exampleVerdict = {
  product: "BountyVerdict",
  version: "1.0",
  verdict: "AVOID",
  score: 0,
  summary: "A public hard stop or severe risk signal makes this issue an unsafe bounty target.",
  issue: {
    url: "https://github.com/typeorm/typeorm/issues/3357",
    title: "Example bounty issue",
    state: "open",
    repository: "typeorm/typeorm",
  },
  signals: [
    {
      label: "Reward withdrawal signal",
      impact: -70,
      detail: "The discussion contains language indicating that a bounty or reward was removed, withdrawn, or cancelled.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357",
      hard_stop: true,
    },
  ],
  coverage: {
    comments_scanned: 100,
    timeline_events_scanned: 100,
    linked_pull_requests_found: 12,
    github_rate_limit_remaining: 4994,
  },
  checked_at: "2026-07-20T00:00:00.000Z",
  limitations: [
    "A VIABLE verdict is permission to investigate, not a payout guarantee.",
  ],
};

const outputSchema = {
  properties: {
    product: { type: "string", const: "BountyVerdict" },
    version: { type: "string" },
    verdict: { type: "string", enum: ["AVOID", "CAUTION", "VIABLE"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    issue: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        title: { type: "string" },
        state: { type: "string" },
        repository: { type: "string" },
      },
      required: ["url", "title", "state", "repository"],
    },
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          impact: { type: "integer" },
          detail: { type: "string" },
          evidence_url: { type: ["string", "null"] },
          hard_stop: { type: "boolean" },
        },
        required: ["label", "impact", "detail", "evidence_url", "hard_stop"],
      },
    },
    coverage: { type: "object" },
    checked_at: { type: "string", format: "date-time" },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: [
    "product",
    "version",
    "verdict",
    "score",
    "summary",
    "issue",
    "signals",
    "coverage",
    "checked_at",
    "limitations",
  ],
};

const discoveryExtension = declareDiscoveryExtension({
  input: {
    issue_url: "https://github.com/typeorm/typeorm/issues/3357",
  },
  inputSchema: {
    properties: {
      issue_url: {
        type: "string",
        format: "uri",
        pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+(?:[?#].*)?$",
        description: "Canonical URL of a public GitHub issue to preflight before an agent starts work.",
      },
    },
    required: ["issue_url"],
    additionalProperties: false,
  },
  output: {
    example: exampleVerdict,
    schema: outputSchema,
  },
});

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
    .register(network as `${string}:${string}`, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  const middleware = paymentMiddleware(
    {
      [`GET ${ENDPOINT}`]: {
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
        extensions: discoveryExtension,
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
      },
    },
    resourceServer,
  );
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
