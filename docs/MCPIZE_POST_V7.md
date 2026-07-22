# MCPize post-v7 release packet

Status: prepared only. Do not submit, test the production endpoint, merge, or deploy this branch before the active `mcp-agent-question-descriptions-v7` experiment freezes its 25-event epoch-55 boundary.

## Why this is the next channel

MCPize accepts an already-running remote MCP endpoint, performs marketplace discovery, supports agent-native per-tool x402 pricing, and exposes install, usage, MRR, churn, and conversion analytics. Its official existing-server wizard calls `Test Connection` and discovers tools before publication, so even onboarding is a production-origin probe and must happen inside an excluded audited drain.

Official references:

- https://docs.mcpize.com/doc/monetize-your-mcp-server
- https://mcpize.com/docs/monetization#x402
- https://mcpize.com/developers

## Exact listing packet

- Server name: `BountyVerdict — GitHub agent decision gates`
- Slug: `bountyverdict-github-agent-decisions`
- Endpoint: `https://bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=mcpize`
- Website and documentation: `https://mimirs402.github.io/bountyverdict/agents.html`
- Primary category: Version Control
- Secondary categories if supported: Security, Monitoring, Automation
- Publisher: `Mimir's Lab`

Description:

> Should I work on this GitHub bounty, trust this repository's agent instructions, retry this failed Actions run, or accept an MCP tool change? BountyVerdict gives agents read-only, evidence-linked decisions for public GitHub work before they spend coding time, retries, or trust. Six bounded MCP tools return typed verdicts and exact reuse guidance; invalid inputs are rejected before payment.

Representative agent questions:

1. `Should I work on this GitHub issue?`
2. `Which of these GitHub bounties should I work on next?`
3. `Are this repository's agent instructions safe to follow?`
4. `Why did this GitHub Actions workflow fail?`
5. `Should I retry this failed workflow or fix it?`
6. `Will this MCP tools/list change break my agent?`

## Economic compatibility gate

The existing origin already issues x402 challenges and settles exact per-tool prices to the revenue wallet. MCPize can also apply its own x402 or subscription billing before invoking an upstream tool. Do not assume those layers compose.

Before publishing:

1. Freeze the v7 N=25 result and begin an excluded distribution drain.
2. Merge and deploy the reviewed quality release, including the `mcpize` telemetry channel.
3. Use MCPize's `Connect Existing URL` flow only during that drain.
4. Start on Base Sepolia as MCPize recommends. Verify one unpaid call, one paid call, the final tool output, the amount charged, the recipient, and the number of signatures and settlements.
5. Reject the channel if the buyer would pay twice, if MCPize cannot forward the origin's x402 challenge, if it requires an unauthenticated free upstream bypass, or if successful calls cannot be distinguished from MCPize's own connection tests.
6. If the layers compose, set the six MCP tool prices to the origin's exact values: BountyVerdict `0.05`, Portfolio `0.40`, HarnessVerdict `0.03`, RunVerdict `0.04`, FlakeVerdict `0.07`, and MCPDriftVerdict `0.02` USDC.
7. Publish once, preserve the receipt and listing URL, then allow the full quiet period to establish a new clean funnel epoch.

## Measurement contract

- `initialize`, `tools/list`, and protocol errors carrying the exact `source=mcpize` marker are marketplace inspection, not buyer demand.
- Unknown-tool, validation, payment-required, payment-present, paid-success, and paid-error stages remain buyer-funnel evidence.
- A customer purchase still requires the existing exact Base USDC settlement accounting; marketplace analytics alone are not revenue proof.
- Owner/test payments remain excluded from genuine purchases and customer revenue.

## Account boundary

The public listing can be prepared autonomously. If MCPize requires an interactive email verification or Stripe Connect onboarding, stop only at that exact screen and request the user's one-time account action. No credential belongs in Git or in this document.
