# Post-v7 free selection router

Status: release candidate for `v1.1.11`. Do not merge or deploy until the separate earned-placement experiment freezes after `2026-07-27T16:37:12.796Z`.

## Evidence and hypothesis

V7 froze cleanly at epoch 55 with 25 eligible `tools/list` events and no downstream tool call, validation error, payment challenge, signed payment, or paid result. The measured bottleneck is therefore selection or invocation after catalog discovery, not payment price or delivered-result quality. Public MCPize marketplace inspection also showed prominent free and freemium entry points. That marketplace pattern is supporting evidence, not buyer-demand proof.

The treatment tests one narrow hypothesis: a free callable router can turn catalog exposure into a measurable bounded selection before an agent chooses a paid tool.

## Contract

`choose_github_agent_decision` accepts only one enum value:

- `one_bounty`
- `bounty_portfolio`
- `repository_agent_instructions`
- `github_actions_root_cause`
- `github_actions_retry_decision`
- `mcp_tools_change`

It returns the exact existing product and tool, advertised USDC price, use and exclusion guidance, decision shape, public sample URL, required input, and next step. It sets `payment_required: false` and `verdict_produced: false`.

The router performs no network request, payment initialization, payment challenge, settlement, URL inspection, or paid-tool invocation. An invalid enum is rejected by the MCP SDK before the handler. Funnel logs contain the fixed `selection_preview` stage and selected product only, never arguments or arbitrary task text.

## Release gates

The router is based on the CI-green quality head `c0efe22`. Before production activation:

1. Release and verify the quality-only `v1.1.10` commit after the active earned-placement experiment freezes.
2. Rebase this branch onto the exact post-activation `main` commit.
3. Re-run the full public and Worker suites, typecheck, llms verification, dependency audits, Glama verification, and deployment dry run.
4. Require both supported MCP protocol versions to list the free router first and the six paid tools unchanged.
5. Require a live free call to return structured routing output with no verdict, x402 challenge, handoff extension, or payment metadata.
6. Preserve the existing schema budgets: at most 2,048 bytes per output schema and 12,000 bytes total. The current seven-tool catalog measures 11,731 bytes total with a 2,021-byte maximum.
7. Activate a fresh funnel epoch only after deployment and the release audit drain; do not mix v7 or release traffic into the new treatment.
8. Run `npm run experiment:activate-free-router` only with the exact release commit, production activation commit and timestamp, and completed post-release drain rotation ID. The reconciler writes an owner-private mode-0600 activation record only when those coordinates match the active eligible epoch and its zero-prefix baseline.
9. Freeze experiment `mcp-free-selection-router-v1` at the first monitor report with at least 25 eligible `tools/list` events. Its state is kept separately from all terminal description experiments.
10. Treat `selection_preview` as downstream selection evidence only. It is not payment intent, a purchase, revenue, or proof of product value.
