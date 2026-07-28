import { PRODUCT_CATALOG, type ProductKey } from "./product-catalog.ts";
import { PRODUCT_SELECTION_PREVIEWS } from "./selection-preview.ts";

export const FREE_SELECTION_TOOL_NAME = "choose_github_agent_decision" as const;

export const FREE_SELECTION_TASKS = Object.freeze([
  "one_bounty",
  "bounty_portfolio",
  "repository_agent_instructions",
  "github_actions_root_cause",
  "github_actions_retry_decision",
  "mcp_tools_change",
] as const);

export type FreeSelectionTask = typeof FREE_SELECTION_TASKS[number];
export type FreeSelectionProduct = Exclude<ProductKey, "skill">;
export type FreeSelectionRequest =
  | { task: Exclude<FreeSelectionTask, "bounty_portfolio"> }
  | {
    task: "bounty_portfolio";
    candidate_count: number;
    needs_ranked_response: boolean;
  };

type SelectionRoute = {
  product: FreeSelectionProduct;
  toolName: string;
  requiredFields: readonly string[];
  callStrategy: "single_call" | "repeat_for_each_issue";
};

const ROUTES = Object.freeze({
  one_bounty: { product: "single", toolName: "check_github_bounty", requiredFields: ["issue_url"], callStrategy: "single_call" },
  bounty_portfolio: { product: "portfolio", toolName: "rank_github_bounties", requiredFields: ["issue_urls"], callStrategy: "single_call" },
  repository_agent_instructions: { product: "harness", toolName: "audit_agent_harness", requiredFields: ["repo_url"], callStrategy: "single_call" },
  github_actions_root_cause: { product: "run", toolName: "diagnose_github_actions_run", requiredFields: ["run_url"], callStrategy: "single_call" },
  github_actions_retry_decision: { product: "flake", toolName: "classify_github_actions_flake", requiredFields: ["run_url"], callStrategy: "single_call" },
  mcp_tools_change: {
    product: "mcpdrift",
    toolName: "check_mcp_tool_drift",
    requiredFields: ["contract_version", "subject", "annotation_source_trust", "baseline", "current"],
    callStrategy: "single_call",
  },
} as const satisfies Record<FreeSelectionTask, SelectionRoute>);

const NATURAL_TASKS = Object.freeze({
  one_bounty: "Check whether one public GitHub issue bounty is still claimable.",
  bounty_portfolio: "Compare and rank 2-10 public GitHub issue bounties.",
  repository_agent_instructions: "Audit a public repository's coding-agent instructions before editing.",
  github_actions_root_cause: "Diagnose why one public GitHub Actions run failed.",
  github_actions_retry_decision: "Decide whether to retry a failed GitHub Actions run once or fix it.",
  mcp_tools_change: "Compare complete MCP tools/list snapshots for breaking or safety changes.",
} as const satisfies Record<FreeSelectionTask, string>);

function selectedRoute(request: FreeSelectionRequest): SelectionRoute {
  if (
    request.task === "bounty_portfolio" &&
    request.candidate_count <= 7 &&
    !request.needs_ranked_response
  ) {
    return {
      product: "single",
      toolName: "check_github_bounty",
      requiredFields: ["issue_url"],
      callStrategy: "repeat_for_each_issue",
    };
  }
  return ROUTES[request.task];
}

function argumentsTemplate(route: SelectionRoute, request: FreeSelectionRequest): Record<string, unknown> {
  switch (route.toolName) {
    case "check_github_bounty":
      return { issue_url: "<canonical public GitHub issue URL>" };
    case "rank_github_bounties":
      return {
        issue_urls: Array.from(
          { length: request.task === "bounty_portfolio" ? request.candidate_count : 2 },
          (_, index) => `<canonical public GitHub issue URL ${index + 1}>`,
        ),
      };
    case "audit_agent_harness":
      return { repo_url: "<canonical public GitHub repository URL>" };
    case "diagnose_github_actions_run":
      return { run_url: "<canonical public GitHub Actions run URL>" };
    case "classify_github_actions_flake":
      return { run_url: "<canonical public GitHub Actions run URL>" };
    case "check_mcp_tool_drift":
      return {
        contract_version: "mcp-drift/1",
        subject: { server_id: "<stable non-secret server identifier>" },
        annotation_source_trust: "<trusted or untrusted>",
        baseline: {
          protocol_version: "2025-11-25",
          complete: true,
          tools: [{
            name: "<replace_with_tool_name>",
            inputSchema: {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: false,
            },
          }],
        },
        current: {
          protocol_version: "2025-11-25",
          complete: true,
          tools: [{
            name: "<replace_with_tool_name>",
            inputSchema: {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: false,
            },
          }],
        },
      };
    default:
      throw new Error("Unsupported free selection route.");
  }
}

function totalPriceUsd(route: SelectionRoute, request: FreeSelectionRequest): string {
  const perCall = PRODUCT_CATALOG[route.product].priceUsd.slice(1);
  const callCount = route.callStrategy === "repeat_for_each_issue" && request.task === "bounty_portfolio"
    ? request.candidate_count
    : 1;
  const match = /^(\d+)\.(\d{2})$/.exec(perCall);
  if (!match) throw new Error("Unsupported catalog price.");
  const totalCents = (BigInt(match[1]) * 100n + BigInt(match[2])) * BigInt(callCount);
  return `${totalCents / 100n}.${(totalCents % 100n).toString().padStart(2, "0")}`;
}

export function freeSelectionCatalog(origin: string) {
  return {
    selector_call_payment_required: false as const,
    unsigned_quote_cannot_charge: true as const,
    next_action: "Choose one tool, supply its complete real input, and inspect the unsigned quote before authorizing or stopping.",
    tools: FREE_SELECTION_TASKS.map((task) => {
      const route = ROUTES[task];
      return {
        task,
        natural_task: NATURAL_TASKS[task],
        tool_name: route.toolName,
        price_usdc: PRODUCT_CATALOG[route.product].priceUsd.slice(1),
        required_fields: [...route.requiredFields],
        free_sample: `${origin}${PRODUCT_SELECTION_PREVIEWS[route.product].samplePath}`,
      };
    }),
  };
}

export function freeSelectionRoute(request: FreeSelectionRequest, origin: string) {
  const route = selectedRoute(request);
  const preview = PRODUCT_SELECTION_PREVIEWS[route.product];
  return {
    task: request.task,
    product: preview.product,
    product_key: route.product,
    total_price_usdc: totalPriceUsd(route, request),
    use_when: preview.useWhen,
    not_for: preview.notFor,
    decision_returned: [...preview.decisionReturned],
    free_sample: `${origin}${preview.samplePath}`,
    selector_call_payment_required: false as const,
    next_call: {
      tool_name: route.toolName,
      call_strategy: route.callStrategy,
      required_fields: [...route.requiredFields],
      arguments_template: argumentsTemplate(route, request),
      payment_required: true as const,
      authorization_required_before_settlement: true as const,
      unsigned_call_action: "inspect_quote_then_authorize_or_stop" as const,
      preserve_arguments_on_retry: true as const,
    },
  };
}
