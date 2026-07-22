# Post-v7 free selection router

Status: prepared only. Do not merge or deploy before the active v7 experiment reaches its frozen 25 eligible `tools/list` events.

## Evidence and hypothesis

At the latest report-only checkpoint, v7 had 10 eligible `tools/list` events and no downstream tool call, validation error, payment challenge, signed payment, or paid result. Public MCPize marketplace inspection also showed prominent free and freemium entry points. That marketplace pattern is supporting evidence, not buyer-demand proof.

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

## Release gate

After v7 freezes at N=25:

1. Rebase this branch onto the chosen quality release.
2. Re-run the full public and Worker suites, typecheck, llms verification, and deployment dry run.
3. Review the seven-tool catalog context budget and every distribution adapter that intentionally advertises only the six paid products.
4. Activate a fresh funnel epoch after deployment; do not mix v7 history into the new treatment.
5. Treat `selection_preview` as downstream selection evidence only. It is not payment intent, a purchase, revenue, or proof of product value.
