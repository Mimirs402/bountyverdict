# BountyVerdict Agent API

A paid, deterministic decision suite for autonomous coding agents. It checks public GitHub engineering evidence and MCP tool-catalog changes before an agent commits implementation time, API spend, repository reputation, or new capabilities.

## Product contracts

- Single check: `GET /api/verdict?issue_url=<public GitHub issue URL>` for **$0.05 USDC**
- Portfolio ranking: `POST /api/portfolio` with `{"issue_urls":[...]}` for **$0.40 USDC**
- Harness audit: `GET /api/harness?repo_url=<public GitHub repository URL>` for **$0.03 USDC**
- Skill security audit: `GET /api/skill?repo_url=<public GitHub repository URL>&skill_path=<skill directory>` for **$0.06 USDC**
- CI run diagnosis: `GET /api/run?run_url=<public GitHub Actions run URL>` for **$0.04 USDC**
- CI flake classification: `GET /api/flake?run_url=<public GitHub Actions run URL>&attempt=<optional positive integer>` for **$0.07 Base USDC**
- MCP tool-catalog drift: `POST /api/mcp-drift` with complete baseline/current MCP 2025-11-25 snapshots for **$0.02 Base USDC**
- Portfolio size: 2–10 unique public GitHub issue URLs; at 10 candidates the effective price is $0.04 each
- Payment: x402 v2, exact scheme
- Output: typed GitHub verdicts plus MCP `UNCHANGED`, `SAFE_ADDITIVE`, `REVIEW`, `INCONCLUSIVE`, `BREAKING`, or `SECURITY_REGRESSION`, always with explicit coverage and reuse guidance
- Discovery: x402 Bazaar extension with a strict input schema and realistic output example, plus `/.well-known/x402` with an exact seven-route paid-resource allowlist
- Failure behavior: invalid inputs, GitHub failures, and handler errors are not settled

The same six independently distributed non-SkillVerdict products are executable as paid MCP tools at `POST /mcp` using MCP 2025-11-25 Streamable HTTP. The server is stateless, read-only, publishes exact schemas through `tools/list`, and uses x402 v2 MCP payment metadata with the same prices and Base USDC payee as the REST contracts. Payment authorizes the fixed-price tool resource rather than cryptographically binding its arguments, so each challenge includes an advisory normalized-argument SHA-256 and instructs callers to preserve the exact normalized arguments on retry.

`GET /` returns all product contracts without payment. Free representative results are available from every product sample route, including `/api/mcp-drift/sample`. Every unpaid 402 JSON body also returns the exact method, URL, validated body when applicable, atomic price cap, and a safe Agentic Wallet argument vector. Consumers must execute the vector directly and must not join it into a shell string.

FlakeVerdict is a read-only retry gate for completed public GitHub Actions failures. It compares the selected attempt with other attempts of the same run, same-SHA outcomes, and up to 12 earlier comparable workflow runs, scanning no more than 8 selected failed-job logs or 4 MiB of log data. It never executes repository code and never triggers, reruns, cancels, approves, or otherwise mutates CI. Only a current `CONFIRMED_FLAKE` may recommend one retry; all other failed outcomes require investigation or repair rather than an automatic retry.

Every successful FlakeVerdict result carries the exact reuse contract: "Call FlakeVerdict for every completed public GitHub Actions failure before spending a retry; each successful call re-reads the selected attempt, other attempts of the same run, same-SHA outcomes, and up to 12 earlier comparable runs. Reuse a result only for its exact run ID and attempt, and call again after a new attempt appears." The free [sample](../samples/flake.json) and hosted [classify-github-flakes workflow](../skills/classify-github-flakes/SKILL.md) are inspectable before payment.

MCPDriftVerdict validates, bounds, canonicalizes, hashes, and classifies the exact POST body before the payment middleware runs. Invalid or unsupported catalogs return 400, 413, or 422 without a payment challenge. The paid continuation only returns the precomputed result. It never fetches schema/icon URLs, executes catalog content, connects to an MCP server, or invokes tools. The free [sample](../samples/mcp-drift.json) and hosted [check-mcp-tool-drift workflow](../skills/check-mcp-tool-drift/SKILL.md) are inspectable before payment.

## Local verification

Use Node 22:

```bash
npm install
npm test
npm run typecheck
npm run deploy:dry
npm run dev -- --var PAY_TO_ADDRESS:0x0000000000000000000000000000000000000001
```

An unpaid request should return HTTP 402 with `PAYMENT-REQUIRED`, including the $0.05 price and `extensions.bazaar` metadata:

```bash
curl -i 'http://127.0.0.1:8787/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Ftypeorm%2Ftypeorm%2Fissues%2F3357'
```

Inspect the portfolio challenge and its POST body schema:

```bash
curl -i -X POST 'http://127.0.0.1:8787/api/portfolio' \
  -H 'Content-Type: application/json' \
  --data '{"issue_urls":["https://github.com/godotengine/godot/issues/70796","https://github.com/typeorm/typeorm/issues/3357"]}'
```

Inspect the remote MCP tool catalog without paying:

```bash
curl -sS 'http://127.0.0.1:8787/mcp' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The buyer harness inspects the challenge without paying by default:

```bash
RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=portfolio RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=harness RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=skill RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=run RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=flake RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=mcpdrift RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
```

To execute a Base Sepolia payment, the preferred buyer is Coinbase Agentic Wallet. It authenticates once through email/OTP, keeps signing keys outside this repository, and supports strict per-request caps:

```bash
npx awal@2.12.0 status
npx awal@2.12.0 balance --chain base-sepolia --json
npx awal@2.12.0 x402 pay https://your-test-worker.workers.dev/api/verdict \
  --query '{"issue_url":"https://github.com/typeorm/typeorm/issues/3357"}' \
  --max-amount 50000 --json
```

Exercise the portfolio contract with its exact 400,000-atomic-unit cap:

```bash
npx awal@2.12.0 x402 pay https://your-test-worker.workers.dev/api/portfolio \
  --method POST \
  --data '{"issue_urls":["https://github.com/godotengine/godot/issues/70796","https://github.com/typeorm/typeorm/issues/3357"]}' \
  --max-amount 400000 --json
```

The lower-level `npm run payment:smoke` harness remains available for a CDP Server Wallet or funded standalone test key. The Agentic Wallet path does not require `CDP_WALLET_SECRET` and is the verified interoperability path for autonomous buyers.

A funded standalone `BUYER_PRIVATE_KEY` remains supported as a test-only fallback. Never use or share a production wallet private key.

## Revenue accounting

Settlements are reconciled from Base USDC `Transfer` logs, so progress does not depend on a private marketplace dashboard. Start at the production deployment block to keep the scan bounded:

```bash
REVENUE_WALLET=0xPUBLIC_RECEIVING_ADDRESS \
START_BLOCK=PRODUCTION_DEPLOYMENT_BLOCK \
npm run revenue
```

Use `NETWORK=sepolia` for testnet. The report recognizes exact $0.02, $0.03, $0.04, $0.05, $0.06, $0.07, and $0.40 product settlements, separates unrelated incoming transfers, and shows purchase counts and progress toward $1,000.

## Continuous distribution monitoring

The production origin publishes a canonical machine-readable router at `/agent-manifest.json` and a compact agent workflow at `/SKILL.md`. They describe the six independently distributed non-SkillVerdict products with exact methods, inputs, prices, samples, task skills, and x402 safety gates. SkillVerdict is deliberately absent while its earned-placement experiment is frozen; the complete seven-route payment inventory remains authoritative at `/.well-known/x402` and `/openapi.json`.

The production monitor verifies all free routes, all seven exact mainnet payment challenges, the six-tool MCP contract, Coinbase Bazaar merchant visibility, Agent402 listing health, Agent Tools Cloud's organically discovered resource/health/payment metadata, disclosed unbranded buyer-query benchmarks, on-chain Base USDC revenue, the402 catalog/jobs/earnings, 402 Index presence, privacy-safe aggregate discovery and paid-route arrivals, and the freshness of the latest authenticated functional-canary pass in one run. Catalog presence and health are never treated as impressions, purchases, or revenue. Benchmarks measure retrieval robustness, not marketplace search volume or impressions. Edge telemetry classifies discovery surface, product, coarse source/channel and client class, input readiness, response preference, payment-header generation, outcome, and hourly/daily trends. MCP telemetry separately counts initialization, tool discovery, unknown tools, invalid inputs, payment requirements, payment presentation, and paid success/failure by product and broad client/referral class. On initialize only, a declared client name is reduced inside the Worker to an allowlisted family such as Codex, Claude, or Gemini; the original name and version are discarded. It also discards raw URLs, query values, tool arguments, request bodies, headers, payment payloads, payer addresses, IP addresses, geolocation, and full user-agent strings:

```bash
systemctl --user start bountyverdict-distribution-monitor.service
```

The monitor refuses to write commerce state unless the receiving wallet, deployment block, tracked costs, owner-canary buyer address, canary mode, and all three marketplace identities are explicitly configured. This fail-closed gate prevents a bare CLI invocation from relabeling an owner proof as customer revenue or silently dropping acquisition costs. Full semantic retrieval audits use the same private service environment with `AUDITED_MONITOR=distribution npm run monitor:audited`; the scheduled report-only service remains the normal refresh path.

Payan's open-request automation is separate from offer fulfillment. It polls the public feed, bids only when the brief itself contains a complete canonical input for one existing non-SkillVerdict product, rechecks authenticated detail for duplicate bids, and refuses accepted hidden inputs that differ from the public SHA-256 contract. The provider then calls the existing bounded production handler and submits the validated JSON output once. Runtime state is private and contains no API key:

```bash
node --env-file="$HOME/.config/bountyverdict/payan.env" --experimental-strip-types scripts/payan-demand.ts
```

`PAYAN_BID=YES` and `PAYAN_FULFILL=YES` enable the two live mutations. The systemd unit sets both only after the dry run and tests pass.

The separate public-demand watcher polls MoltJobs and OpenJobs without credentials and never applies, bids, accepts, pays, or submits work. MoltJobs inventory is counted as funded only when its official funded feed agrees with the open feed, both onchain escrow identifiers are present, no worker is assigned, and the deadline is still in the future. OpenJobs `WAGE` tasks are kept separate from USDC. Only complete inputs that exactly equal an existing product contract are surfaced as candidates:

```bash
npm run demand:watch
```

Its mode-0600 state is written to `~/.local/state/bountyverdict/demand-watch.json`; the distribution monitor rejects stale state or any state that is not explicitly read-only with actions disabled. The ten-minute systemd timer requires no secrets. Market inventory and candidates are acquisition evidence only and never purchases or revenue.

It atomically writes the latest machine-readable snapshot to `~/.local/state/bountyverdict/distribution-status.json` and overwrites the SSH-friendly milestone dashboard at `~/notes/mimirx402.md`, keeping health, next work, customer revenue, tracked costs, and profit at the top. The versioned user-service templates in `ops/systemd/` run it every 15 minutes; per-product merchant indexing and semantic-search rank are tracked without treating normal discovery-cache delay as a health failure. Owner-funded production proofs and marketplace registration costs are retained separately and excluded from customer purchases and earned revenue.

the402 provider credentials are written outside the repository to `~/.config/bountyverdict/the402.env` with mode `0600`, mirrored to encrypted Worker and GitHub Actions secret stores, and loaded by the distribution monitor. The public production service-ID map contains six existing products; SkillVerdict stays excluded until its isolated earned-placement experiment ends. Each listing publishes the canonical typed output schema and is checked for contract drift. The same six services are bundled in the `BountyVerdict Agent Engineering Monthly` plan at $1.05 agent price for up to 20 combined requests; the monitor validates its exact public contract and persists explicitly attributed subscription settlements as one purchase each. The signed `request.created` feed evaluates future buyer postings and bids only when the complete brief and explicit intent match one of those six existing schemas; ambiguous, expired, subcontracted, over-tier, or unrelated work is ignored.

Successful buyer provisioning atomically writes only its public address to `~/.config/bountyverdict/settlement-buyer.env` as `SETTLEMENT_BUYER_ADDRESS=0x...`, with settlement disabled by default. The distribution service reads that file so canary purchases remain excluded from customer revenue. Before enabling a settlement timer, set `SETTLEMENT_CANARY_ENABLED=YES` in that file; accounting then fails closed if the address is absent. Keep policy credentials and wallet secrets out of this file.

The hardened weekly units are in `ops/systemd/bountyverdict-settlement-canary.{service,timer}`. The service loads only the public buyer address from that accounting file; the canary process reads CDP credentials from the ignored `agent/.dev.vars`. Its application controls independently cap one Base-USDC payee and at most 400,000 atomic units per seven-day window, while durable state prevents a second run inside seven days or any retry after an ambiguous paid transport.

The separate six-hour functional canary invokes each real paid handler against a hard-coded fixture without creating a settlement or accepting a customer-controlled target. It validates commit pinning, coverage, structured output, failed-job log retrieval, bounded flake classification, and deterministic MCP hash/proof behavior—not just HTTP availability. Its bearer token lives only in the Worker secret store, the repository Actions secret store, and a mode-0600 local token file:

```bash
CANARY_TOKEN=... npm run canary:production
# Or: CANARY_TOKEN_FILE=~/.config/bountyverdict/canary.token npm run canary:production
```

The latest result is written to `~/.local/state/bountyverdict/functional-canary.json`. The internal endpoint is absent from OpenAPI and Bazaar metadata, returns only a compact fixture summary, responds as not found without the exact secret, and rate-limits each authenticated product canary at the Cloudflare edge.

## Deployment inputs

Only a **public EVM receiving address** is required from the owner for testnet. Never provide a seed phrase or private key to this service.

For production Bazaar discovery, configure:

- `PAY_TO_ADDRESS`: public Base-compatible wallet address receiving USDC
- `GITHUB_TOKEN`: fine-grained read-only token for reliable public GitHub API capacity; private repositories are rejected before file access
- `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`: facilitator credentials stored as Worker secrets
- `CANARY_TOKEN`: at least 32 random characters for hard-coded internal functional checks
- `X402_NETWORK=eip155:8453`
- `X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402`

The no-signup facilitator in the default config is Base Sepolia only. Its test catalog is separate from Coinbase's production Bazaar. A Bazaar-enabled resource is indexed after its first successful settlement through the CDP facilitator.

### Cloudflare compatibility note

The reference Hono integration auto-loads a Bazaar validator that uses runtime code generation, which Cloudflare Workers disallow. This Worker uses the same official `declareDiscoveryExtension()` output, adds the static HTTP method at build time, validates it in the test suite, and then attaches the finished declaration to the retained x402 route configuration after middleware construction. The resulting metadata passes both Bazaar protocol and schema validation tests and is sent unchanged in the x402 payment challenge without runtime eval.

## Production commands

After authenticating Wrangler:

```bash
npx wrangler secret put PAY_TO_ADDRESS --env production
npx wrangler secret put GITHUB_TOKEN --env production
npx wrangler secret put CDP_API_KEY_ID --env production
npx wrangler secret put CDP_API_KEY_SECRET --env production
npx wrangler secret put CANARY_TOKEN --env production
npm run deploy -- --env production
```

The receiving address is public on-chain, but storing it as a binding keeps deployment configuration separate from source. GitHub, CDP, and canary credentials are secrets and must never be committed.

### One-action release

The manual `Deploy paid Worker` GitHub Actions workflow performs the same production deployment, verifies every free route, all seven x402 challenges, and every real handler canary, then activates the public agent manifest only after the live checks pass. Configure these repository Actions secrets before running it:

- `CLOUDFLARE_API_TOKEN`
- `PAY_TO_ADDRESS`
- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- `UPSTREAM_GITHUB_TOKEN` (stored in the Worker as `GITHUB_TOKEN`; use a fine-grained read-only token)
- `CANARY_TOKEN` (a strong random value used only by hard-coded internal checks)

The Cloudflare token needs permission to deploy Workers. No CDP wallet secret or buyer private key is uploaded to the Worker, and no deployment secret is committed to Git.
