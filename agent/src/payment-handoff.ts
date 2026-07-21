import { PRODUCT_CATALOG, type ProductKey } from "./product-catalog.ts";
import { PRODUCT_SELECTION_PREVIEWS } from "./selection-preview.ts";

export const MCP_HTTP_PAYMENT_HANDOFF_EXTENSION =
  "io.github.Mimirs402/bountyverdict/http-payment-handoff";
export const LEGACY_MCP_HTTP_PAYMENT_HANDOFF_EXTENSION =
  "io.github.cristianmoroaica/bountyverdict/http-payment-handoff";

export type ExactPaymentRequest = {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
};

export type PaymentHandoff = {
  protocol: "x402 v2";
  network: "Base";
  asset: "USDC";
  max_amount_atomic: string;
  inspect_challenge_before_signing: true;
  request_binding: string;
  exact_request: ExactPaymentRequest & { normalized_body_sha256?: string };
  authorization_scope: "resource_url" | "resource_url_not_post_body";
  agentic_wallet: {
    executable: "npx";
    argv: string[];
    execute_as_argument_vector: true;
    do_not_join_into_shell_string: true;
  };
  retry_semantics: {
    reuse_exact_method_url_and_body: true;
    payment_header: "Payment-Signature";
    expected_success_status: 200;
    never_raise_max_amount_without_new_authorization: true;
  };
  execution_risk: string;
};

const HTTP_HANDOFF_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    version: { type: "string", const: "1" },
    direct_mcp: {
      type: "object",
      properties: {
        automatic_payment_requires: { type: "string", const: "@x402/mcp" },
        payment_meta_key: { type: "string", const: "x402/payment" },
      },
      required: ["automatic_payment_requires", "payment_meta_key"],
      additionalProperties: false,
    },
    wallet_mcp: {
      type: "object",
      properties: {
        capability: { type: "string", const: "make_x402_request" },
        use_exact_request: { type: "boolean", const: true },
      },
      required: ["capability", "use_exact_request"],
      additionalProperties: false,
    },
    selection_preview: {
      type: "object",
      properties: {
        product: { type: "string" },
        price: { type: "string" },
        currency: { type: "string", const: "USDC" },
        use_when: { type: "string" },
        not_for: { type: "string" },
        decision_returned: { type: "array", items: { type: "string" } },
        why_pay: { type: "string" },
        free_sample: { type: "string" },
        unsigned_call_can_charge: { type: "boolean", const: false },
      },
      required: ["product", "price", "currency", "use_when", "not_for", "decision_returned", "why_pay", "free_sample", "unsigned_call_can_charge"],
      additionalProperties: false,
    },
    payment: { type: "object" },
  },
  required: ["version", "direct_mcp", "wallet_mcp", "selection_preview", "payment"],
  additionalProperties: false,
});

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(bytes)]
    .map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function validatedOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("Payment handoff origin must be an http(s) origin without credentials.");
  }
  return url.origin;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`Missing normalized ${key}.`);
  return value;
}

function requiredStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error(`Missing normalized ${key}.`);
  }
  return value as string[];
}

export async function buildPaymentHandoff(
  exactRequest: ExactPaymentRequest,
  maxAmountAtomic: string,
): Promise<PaymentHandoff> {
  if (!/^\d+$/.test(maxAmountAtomic) || BigInt(maxAmountAtomic) <= 0n) {
    throw new Error("Payment handoff requires a positive atomic amount.");
  }
  const requestUrl = new URL(exactRequest.url);
  if ((requestUrl.protocol !== "https:" && requestUrl.protocol !== "http:") || requestUrl.username || requestUrl.password) {
    throw new Error("Payment handoff request must use http(s) without URL credentials.");
  }
  if (exactRequest.method === "GET" && exactRequest.body !== undefined) {
    throw new Error("GET payment handoffs cannot include a request body.");
  }
  if (exactRequest.method === "POST" && exactRequest.body === undefined) {
    throw new Error("POST payment handoffs require the validated request body.");
  }

  const normalizedBodyJson = exactRequest.body === undefined
    ? undefined
    : JSON.stringify(exactRequest.body);
  if (exactRequest.body !== undefined && normalizedBodyJson === undefined) {
    throw new Error("Payment handoff body is not JSON serializable.");
  }
  const normalizedBodySha256 = normalizedBodyJson === undefined
    ? undefined
    : await sha256(normalizedBodyJson);
  const requestHint = exactRequest.method === "GET"
    ? "Use the exact request URL, including its encoded query string."
    : "Use POST with the intended validated JSON body. Standard x402 authorizes the resource URL, not the POST body; review the normalized body hash and resend the same JSON on the signed retry.";
  const awalArgv = ["awal@2.12.0", "x402", "pay", requestUrl.toString()];
  if (exactRequest.method === "POST") {
    awalArgv.push("-X", "POST", "-d", normalizedBodyJson as string);
  }
  awalArgv.push("--max-amount", maxAmountAtomic, "--json");

  return {
    protocol: "x402 v2",
    network: "Base",
    asset: "USDC",
    max_amount_atomic: maxAmountAtomic,
    inspect_challenge_before_signing: true,
    request_binding: requestHint,
    exact_request: {
      method: exactRequest.method,
      url: requestUrl.toString(),
      ...(exactRequest.body === undefined ? {} : { body: exactRequest.body }),
      ...(normalizedBodySha256 === undefined ? {} : { normalized_body_sha256: normalizedBodySha256 }),
    },
    authorization_scope: exactRequest.method === "POST" ? "resource_url_not_post_body" : "resource_url",
    agentic_wallet: {
      executable: "npx",
      argv: awalArgv,
      execute_as_argument_vector: true,
      do_not_join_into_shell_string: true,
    },
    retry_semantics: {
      reuse_exact_method_url_and_body: true,
      payment_header: "Payment-Signature",
      expected_success_status: 200,
      never_raise_max_amount_without_new_authorization: true,
    },
    execution_risk: "Input shape is validated before payment. Third-party GitHub availability or state can still change after settlement; a payment does not guarantee upstream success.",
  };
}

export function exactRestRequestForProduct(
  origin: string,
  product: ProductKey,
  normalizedArgs: Record<string, unknown>,
): ExactPaymentRequest {
  const catalog = PRODUCT_CATALOG[product];
  const url = new URL(catalog.path, `${validatedOrigin(origin)}/`);
  let body: unknown;
  switch (product) {
    case "single":
      body = { issue_url: requiredString(normalizedArgs, "issue_url") };
      break;
    case "portfolio":
      body = { issue_urls: requiredStringArray(normalizedArgs, "issue_urls") };
      break;
    case "harness":
      body = { repo_url: requiredString(normalizedArgs, "repo_url") };
      break;
    case "skill":
      url.searchParams.set("repo_url", requiredString(normalizedArgs, "repo_url"));
      url.searchParams.set("skill_path", requiredString(normalizedArgs, "skill_path"));
      break;
    case "run":
      body = { run_url: requiredString(normalizedArgs, "run_url") };
      break;
    case "flake": {
      const flakeBody: { run_url: string; attempt?: number } = {
        run_url: requiredString(normalizedArgs, "run_url"),
      };
      const attempt = normalizedArgs.attempt;
      if (attempt !== undefined) {
        if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
          throw new Error("Invalid normalized attempt.");
        }
        flakeBody.attempt = attempt;
      }
      body = flakeBody;
      break;
    }
    case "mcpdrift":
      body = normalizedArgs;
      break;
  }
  return {
    method: catalog.method,
    url: url.toString(),
    ...(body === undefined ? {} : { body }),
  };
}

export async function declareMcpHttpPaymentHandoff(
  origin: string,
  product: ProductKey,
  normalizedArgs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const exactRequest = exactRestRequestForProduct(origin, product, normalizedArgs);
  const payment = await buildPaymentHandoff(
    exactRequest,
    PRODUCT_CATALOG[product].amountAtomic.toString(),
  );
  const preview = PRODUCT_SELECTION_PREVIEWS[product];
  const declaration = {
    info: {
      version: "1",
      direct_mcp: {
        automatic_payment_requires: "@x402/mcp",
        payment_meta_key: "x402/payment",
      },
      wallet_mcp: {
        capability: "make_x402_request",
        use_exact_request: true,
      },
      selection_preview: {
        product: preview.product,
        price: PRODUCT_CATALOG[product].priceUsd,
        currency: "USDC",
        use_when: preview.useWhen,
        not_for: preview.notFor,
        decision_returned: preview.decisionReturned,
        why_pay: preview.whyPay,
        free_sample: new URL(preview.samplePath, `${validatedOrigin(origin)}/`).toString(),
        unsigned_call_can_charge: false,
      },
      payment,
    },
    schema: HTTP_HANDOFF_SCHEMA,
  };
  return {
    [MCP_HTTP_PAYMENT_HANDOFF_EXTENSION]: declaration,
    // Preserve already-installed clients while the canonical registry identity migrates.
    [LEGACY_MCP_HTTP_PAYMENT_HANDOFF_EXTENSION]: declaration,
  };
}
