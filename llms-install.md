# Install BountyVerdict for an agent

Canonical remote MCP endpoint:

`https://bountyverdict-agent-production.mimirslab.workers.dev/mcp`

The connection requires no BountyVerdict account, API key, headers, or repository secrets. Loading the server and listing its six read-only tools are free. A valid tool call returns an x402 v2 Base USDC payment requirement; invalid input is rejected before any payment requirement is created.

## Client-specific connection

### Codex CLI

```bash
codex mcp add bountyverdict --url https://bountyverdict-agent-production.mimirslab.workers.dev/mcp
codex mcp get bountyverdict
```

Equivalent `config.toml`:

```toml
[mcp_servers.bountyverdict]
url = "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp"
```

### Claude Code

```bash
claude mcp add --transport http --scope user bountyverdict https://bountyverdict-agent-production.mimirslab.workers.dev/mcp
claude mcp get bountyverdict
```

Equivalent `.mcp.json` entry:

```json
{
  "mcpServers": {
    "bountyverdict": {
      "type": "http",
      "url": "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp"
    }
  }
}
```

### Gemini CLI

The repository also includes `gemini-extension.json`. To add only the remote server:

```bash
gemini mcp add --transport http --scope user bountyverdict https://bountyverdict-agent-production.mimirslab.workers.dev/mcp
gemini mcp list
```

Equivalent `settings.json` entry:

```json
{
  "mcpServers": {
    "bountyverdict": {
      "httpUrl": "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp"
    }
  }
}
```

### Visual Studio Code

Add this to the user MCP configuration or `.vscode/mcp.json`. VS Code uses the top-level key `servers`, not `mcpServers`.

```json
{
  "servers": {
    "bountyverdict": {
      "type": "http",
      "url": "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp"
    }
  }
}
```

Then run `MCP: List Servers` and inspect BountyVerdict's six tools.

### Cursor

Add this to `.cursor/mcp.json` or the global Cursor MCP configuration:

```json
{
  "mcpServers": {
    "bountyverdict": {
      "type": "http",
      "url": "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp"
    }
  }
}
```

Enable only the tool needed for the current task and retain Cursor's tool approval prompt.

### Cline

Use the BountyVerdict MCP Marketplace Install action after its listing is published. For a manual connection, open Cline's MCP settings and add a remote HTTP server named `bountyverdict` with the canonical endpoint above. No environment variable is required.

### Kilo

Use the BountyVerdict Marketplace Install action after its listing is published, or add the remote server from Kilo CLI:

```bash
kilo mcp add bountyverdict --url https://bountyverdict-agent-production.mimirslab.workers.dev/mcp
kilo mcp list
```

Do not auto-approve the paid tools. Keep the default approval boundary so the exact tool, arguments, recipient, network, asset, and amount can be checked before signing.

## Paid-call handoff

A remote MCP connection does not itself provide a wallet. Direct automatic MCP payment requires an x402-aware MCP client such as `@x402/mcp`, which reads the payment requirement and retries the same tool call with `_meta["x402/payment"]`.

Every unpaid BountyVerdict MCP challenge also declares the versioned extension:

`io.github.Mimirs402/bountyverdict/http-payment-handoff`

Its `info.payment` object contains the equivalent protected HTTP x402 request:

- the exact method and fully encoded URL;
- the validated JSON body and its SHA-256 for POST tools;
- the immutable atomic USDC cap;
- the request-binding limitation and retry rules;
- a safe Coinbase Agentic Wallet CLI argument vector.

This lets a standard MCP host hand the exact HTTP request to a separately installed x402 wallet tool. Coinbase Agentic Wallet MCP provides a “Make an x402 request” capability:

```bash
npx @coinbase/payments-mcp
```

Wallet authentication, funding, and spending limits are buyer-controlled prerequisites for paid calls. An agent may use the handoff only when it is already authorized to spend and every field matches the original selected tool call. Otherwise it must return the payment requirement and stop.

If an authorized runtime uses the CLI fallback, execute `info.payment.agentic_wallet.executable` with `info.payment.agentic_wallet.argv` as an argument vector. Never join the values into a shell string, never raise `max_amount_atomic` silently, and resend the exact normalized POST body.

## Tool selection

- one bounty issue: `check_github_bounty` — $0.05
- two to ten bounty issues: `rank_github_bounties` — $0.40
- repository coding-agent instructions: `audit_agent_harness` — $0.03
- GitHub Actions root cause: `diagnose_github_actions_run` — $0.04
- retry-once versus fix: `classify_github_actions_flake` — $0.07
- MCP tool-catalog compatibility: `check_mcp_tool_drift` — $0.02

SkillVerdict is intentionally not exposed through MCP. Use its dedicated skill or HTTP API when auditing a third-party `SKILL.md` bundle.

## Verification without payment

After connecting, verify server initialization and `tools/list`. Do not treat connection, listing, tool selection, or an unpaid payment requirement as a purchase. A purchase exists only after a non-owner payment is settled and a successful result is returned.

Current primary client references: [Codex MCP configuration](https://developers.openai.com/codex/codex-manual.md), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/), [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration), [Cursor MCP](https://docs.cursor.com/context/model-context-protocol), [Kilo MCP](https://kilo.ai/docs/automate/mcp/overview), and [Coinbase x402 MCP](https://docs.cdp.coinbase.com/x402/bazaar).
