# BountyVerdict

## Tagline
CI root cause, retry-or-fix, bounty claimability, agent instructions, and MCP schema drift.

## Description
BountyVerdict is a remote MCP server for bounded decisions coding agents make before acting. Five tools inspect current public GitHub evidence to diagnose CI failures, decide retry-versus-fix, assess and rank bounty claimability risk, and audit repository agent instructions. A sixth compares caller-supplied MCP tool snapshots within a documented schema subset. GitHub results include cited public evidence; MCP drift returns canonical hashes, coverage, and findings. Successful verdict calls require per-tool x402 payment on Base, with exact prices from $0.02 to $0.40 USDC; an unsigned call returns a free payment quote and selection summary before any payment can settle.

## Setup Requirements
- No service API key or local package is required. Connect an MCP client to the Registry-listed remote endpoint at `https://bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=mcp-registry`.
- Direct automatic settlement inside MCP requires an x402-aware client such as `@x402/mcp` and a separately authorized Base USDC wallet. Standard MCP hosts receive a versioned exact-HTTP payment handoff for a separately authorized x402 wallet. The server never receives a seed phrase or private key.

## Category
Developer Tools

## Features
- Diagnose why one completed public GitHub Actions run failed, with pattern-redacted secret-like excerpts and concrete next actions; arbitrary build output must still be treated as potentially sensitive.
- Decide whether one failed workflow should be retried once or fixed by comparing attempts and historical fingerprints.
- Assess one public GitHub bounty's claimability risk before coding, including reward provenance, authority, competition, and contribution-policy signals.
- Rank 2-10 public GitHub bounty issues and identify the strongest non-AVOID candidate—or recommend starting none.
- Audit a public repository's `AGENTS.md`, `CLAUDE.md`, and related coding-agent instructions at an immutable commit.
- Compare caller-asserted complete MCP tool snapshots for changes in the documented schema and safety-hint subset without invoking either server.
- Reject invalid input before presenting a payment requirement.
- Keep all target-side inspection and analysis read-only and return structured JSON suitable for another agent; an authorized x402 settlement transfers only the exact disclosed USDC amount.

## Getting Started
- "Why did this public GitHub Actions run fail?"
- "Should I retry this failed workflow once or fix the code?"
- "Is this public GitHub bounty worth pursuing, given reward provenance, current claims, competing PRs, and contribution rules?"
- "Which of these GitHub bounty issues should I work on?"
- "Check this repository's agent instructions before I edit it."
- "Does this caller-supplied complete MCP tools/list snapshot introduce a documented breaking schema or safety-hint change?"
- Tool: `diagnose_github_actions_run` — Find the root cause and next actions for one public run URL.
- Tool: `classify_github_actions_flake` — Decide retry once versus fix for one completed failed run.
- Tool: `check_github_bounty` — Return an evidence-linked AVOID, CAUTION, or VIABLE verdict for one issue.
- Tool: `rank_github_bounties` — Rank 2-10 issue URLs with full verdicts and partial-failure handling.
- Tool: `audit_agent_harness` — Audit public coding-agent instructions at an immutable repository commit.
- Tool: `check_mcp_tool_drift` — Compare caller-asserted complete snapshots within the documented compatibility subset.

## Tags
github-actions, ci-failure, root-cause, retry-or-fix, github-bounties, bounty-claimability, agent-instructions, agents-md, claude-md, mcp, tools-list, schema-drift, breaking-change, x402, coding-agents, developer-tools

## Documentation URL
https://mimirs402.github.io/bountyverdict/agents.html#connect-mcp

## Health Check URL
https://bountyverdict-agent-production.mimirslab.workers.dev/
