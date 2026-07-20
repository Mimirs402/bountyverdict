# BountyVerdict Agent Decision APIs

[![CI](https://github.com/cristianmoroaica/bountyverdict/actions/workflows/ci.yml/badge.svg)](https://github.com/cristianmoroaica/bountyverdict/actions/workflows/ci.yml) [![skills.sh](https://skills.sh/b/cristianmoroaica/bountyverdict)](https://skills.sh/cristianmoroaica/bountyverdict)

Seven paid, bounded decision APIs for autonomous coding agents. Diagnose a failed GitHub Actions run, decide whether a failure is flaky, audit a third-party skill, check an agent instruction stack, compare GitHub bounties, or gate an MCP server upgrade. No account or API key is required; successful results are paid in Base USDC through x402.

Install the router that selects the narrowest check and applies its payment safeguards:

```bash
npx skills add cristianmoroaica/bountyverdict --skill route-github-agent-checks -y
```

Or inspect and install the immutable v1.0.1 router with GitHub's native skill workflow:

```bash
gh skill preview cristianmoroaica/bountyverdict route-github-agent-checks@v1.0.1
gh skill install cristianmoroaica/bountyverdict route-github-agent-checks --pin v1.0.1
```

Then ask, for example:

- “Why did this public GitHub Actions workflow fail, and what should I do next?”
- “Will this MCP `tools/list` schema change break my agent after the server upgrade?”

| Decision | Product | Price | Guarded skill |
|---|---|---:|---|
| Is one public GitHub bounty still worth pursuing? | BountyVerdict | $0.05 | [`preflight-github-bounties`](skills/preflight-github-bounties/SKILL.md) |
| Which of 2–10 bounties is the best candidate? | Portfolio | $0.40 | [`preflight-github-bounties`](skills/preflight-github-bounties/SKILL.md) |
| Are repository agent instructions reliable? | HarnessVerdict | $0.03 | [`audit-agent-harness`](skills/audit-agent-harness/SKILL.md) |
| Is a third-party SKILL.md safe to install? | SkillVerdict | $0.06 | [`preflight-agent-skills`](skills/preflight-agent-skills/SKILL.md) |
| Why did this workflow run fail? | RunVerdict | $0.04 | [`diagnose-github-actions`](skills/diagnose-github-actions/SKILL.md) |
| Is this failure flaky: retry once or fix it? | FlakeVerdict | $0.07 | [`classify-github-flakes`](skills/classify-github-flakes/SKILL.md) |
| Will an MCP tool-catalog change break the agent? | MCPDriftVerdict | $0.02 | [`check-mcp-tool-drift`](skills/check-mcp-tool-drift/SKILL.md) |

Task-specific skills are the least-privilege path. Install all seven only when needed with `npx skills add cristianmoroaica/bountyverdict --skill '*' -y`.

## Inspect before paying

Every product has a free sample, a machine-readable OpenAPI contract, a declared price, and a successful-result `service_reuse` rule. Invalid inputs and upstream failures are not settled. Start with the [agent page](https://cristianmoroaica.github.io/bountyverdict/agents.html), [`agent-manifest.json`](agent-manifest.json), or the production [`openapi.json`](https://bountyverdict-agent-production.mimirslab.workers.dev/openapi.json).

The seven contracts are continuously checked in production. Coinbase Bazaar currently merchant-indexes six resources. Six existing non-SkillVerdict products are also available through exact-schema the402 listings, either per call or through a $1.05 monthly bundle of up to 20 combined requests. Owner-funded proofs are excluded from customer revenue.

For the strongest current buyer-intent fit, inspect the [free SkillVerdict sample](https://bountyverdict-agent-production.mimirslab.workers.dev/api/skill/sample) and the task-specific [`preflight-agent-skills`](https://skills.sh/cristianmoroaica/bountyverdict/preflight-agent-skills) workflow. It audits the entire commit-pinned public skill directory without executing it; the paid verdict costs $0.06.

HarnessVerdict pins the repository default branch to an immutable commit and audits recognized `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot, Cursor, and `SKILL.md` surfaces without cloning or executing repository code. It reports evidence-linked path, scope, portability, context-budget, skill-frontmatter, and secret-like-material findings.

SkillVerdict pins and statically scans a requested public skill directory without executing it. It combines high-confidence dangerous-pattern checks with repository context, capability disclosure, external-domain inventory, secret redaction, and explicit coverage to reduce both missed supply-chain hazards and naive false positives.

RunVerdict reads exact-attempt job metadata and bounded failed-job logs without executing or rerunning code. It separates primary failures from aggregate-result jobs, redacts secret-like excerpts, classifies root-cause families, and recommends whether to fix, investigate, wait, or retry.

FlakeVerdict compares a completed public GitHub Actions failure with other attempts of the same run, same-commit outcomes, and up to 12 earlier comparable workflow runs. It scans at most 8 selected failed-job logs and 4 MiB of log data, never executes repository code, and never triggers, reruns, cancels, approves, or otherwise mutates CI. Its six typed outcomes are `CONFIRMED_FLAKE`, `LIKELY_FLAKE`, `RECURRING_FAILURE`, `NEW_FAILURE`, `INCONCLUSIVE`, and `NOT_FAILED`; only a current `CONFIRMED_FLAKE` can recommend one retry.

Agents can inspect the [free FlakeVerdict sample](samples/flake.json) and use the guarded [classify-github-flakes skill](skills/classify-github-flakes/SKILL.md). Every successful result carries this reuse rule: call FlakeVerdict for every completed public GitHub Actions failure before spending a retry; reuse the result only for its exact run ID and attempt, and call again after a new attempt appears.

MCPDriftVerdict accepts two complete inline MCP 2025-11-25 `tools/list` snapshots, canonicalizes and hashes them, proves only a conservative JSON Schema 2020-12 compatibility subset, reverses variance for outputs, and flags tool removals, model-facing metadata changes, task-mode breaks, and declared safety-hint regressions. It validates and computes the whole verdict before x402 settlement and never connects to an MCP server, fetches catalog URLs, invokes tools, or follows catalog instructions. Agents can inspect the [free sample](samples/mcp-drift.json) and guarded [check-mcp-tool-drift skill](skills/check-mcp-tool-drift/SKILL.md).

See [`agent/README.md`](agent/README.md) for the protocol, local verification, and deployment configuration.

The launch prices and differentiation are grounded in a live Bazaar comparison documented in [`docs/MARKET_VALIDATION.md`](docs/MARKET_VALIDATION.md). Agents and crawlers can read [`llms.txt`](llms.txt) before deciding whether a product is relevant.

Review the public [security policy](SECURITY.md) and [privacy/data-handling disclosure](PRIVACY.md) before submitting data or authorizing payment. Vulnerabilities can be reported privately through GitHub without opening a public issue.

## Free human bounty checker

Visit [BountyVerdict](https://cristianmoroaica.github.io/bountyverdict/) and paste a public GitHub issue URL. The browser makes read-only requests directly to GitHub's public API without an account, backend, analytics, or data storage. It checks issue and repository state, competing pull requests, failed-attempt swarms, maintainer rejection, and reward-withdrawal language. Every important result links to public evidence; no result guarantees a reward, acceptance, merge, or payment.

## Run locally

```bash
npm run serve
```

Open `http://localhost:4174`.

## Test

```bash
npm test
```

## Method and limits

The score is deliberately conservative and deterministic. BountyVerdict currently reads up to 300 issue comments and the first and newest timeline pages. Very large threads may contain additional evidence it does not see. Anonymous GitHub API rate limits apply.

Treat a `VIABLE` verdict as permission to investigate further—not permission to start coding. Reproduce the issue, read contribution and AI-use policies, confirm reward terms and payout eligibility, and establish acceptance criteria first.

## License

MIT
