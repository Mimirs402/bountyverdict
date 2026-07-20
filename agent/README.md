# BountyVerdict Agent API

A paid, deterministic preflight suite for autonomous coding agents. It checks public GitHub bounty issues and repository instruction stacks before an agent commits implementation time, API spend, or repository reputation.

## Product contracts

- Single check: `GET /api/verdict?issue_url=<public GitHub issue URL>` for **$0.05 USDC**
- Portfolio ranking: `POST /api/portfolio` with `{"issue_urls":[...]}` for **$0.40 USDC**
- Harness audit: `GET /api/harness?repo_url=<public GitHub repository URL>` for **$0.03 USDC**
- Skill security audit: `GET /api/skill?repo_url=<public GitHub repository URL>&skill_path=<skill directory>` for **$0.06 USDC**
- CI run diagnosis: `GET /api/run?run_url=<public GitHub Actions run URL>` for **$0.04 USDC**
- Portfolio size: 2–10 unique public GitHub issue URLs; at 10 candidates the effective price is $0.04 each
- Payment: x402 v2, exact scheme
- Output: structured bounty `AVOID`, `CAUTION`, or `VIABLE`; harness `READY`, `REVIEW`, or `REPAIR`; skill-security `LOW_RISK`, `REVIEW`, or `BLOCK`; and CI-run `PASS`, `WAIT`, `RETRY`, `FIX`, or `INVESTIGATE` verdicts with evidence and explicit coverage
- Discovery: x402 Bazaar extension with a strict input schema and realistic output example
- Failure behavior: invalid inputs, GitHub failures, and handler errors are not settled

`GET /` returns all product contracts without payment. Free representative results are available from `/api/sample`, `/api/portfolio/sample`, `/api/harness/sample`, `/api/skill/sample`, and `/api/run/sample`.

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

The buyer harness inspects the challenge without paying by default:

```bash
RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=portfolio RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=harness RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=skill RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
PRODUCT=run RESOURCE_SERVER_URL=http://127.0.0.1:8787 npm run payment:inspect
```

To execute a Base Sepolia payment, the preferred buyer is Coinbase Agentic Wallet. It authenticates once through email/OTP, keeps signing keys outside this repository, and supports strict per-request caps:

```bash
npx awal@2.12.1 status
npx awal@2.12.1 balance --chain base-sepolia --json
npx awal@2.12.1 x402 pay https://your-test-worker.workers.dev/api/verdict \
  --query '{"issue_url":"https://github.com/typeorm/typeorm/issues/3357"}' \
  --max-amount 50000 --json
```

Exercise the portfolio contract with its exact 400,000-atomic-unit cap:

```bash
npx awal@2.12.1 x402 pay https://your-test-worker.workers.dev/api/portfolio \
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

Use `NETWORK=sepolia` for testnet. The report recognizes exact $0.03, $0.04, $0.05, $0.06, and $0.40 product settlements, separates unrelated incoming transfers, and shows purchase counts and progress toward $1,000.

## Continuous distribution monitoring

The credential-free production monitor verifies all free routes, all five exact mainnet payment challenges, Coinbase Bazaar merchant and semantic-search visibility, on-chain Base USDC revenue, and the freshness of the latest authenticated functional-canary pass in one run:

```bash
npm run distribution:monitor
```

It atomically writes the latest machine-readable snapshot to `~/.local/state/bountyverdict/distribution-status.json` and overwrites the SSH-friendly milestone dashboard at `~/notes/mimirx402.md`, keeping health, next work, customer revenue, tracked costs, and profit at the top. The versioned user-service templates in `ops/systemd/` run it every 15 minutes; per-product merchant indexing and semantic-search rank are tracked without treating normal discovery-cache delay as a health failure. Owner-funded production proofs are retained as settlement evidence but explicitly excluded from earned revenue and $1,000 progress.

The separate six-hour functional canary invokes each real paid handler against a hard-coded public fixture without creating a settlement or accepting a customer-controlled target. It validates commit pinning, coverage, structured output, and failed-job log retrieval—not just HTTP availability. Its bearer token lives only in the Worker secret store, the repository Actions secret store, and a mode-0600 local token file:

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

The manual `Deploy paid Worker` GitHub Actions workflow performs the same production deployment, verifies every free route, all five x402 challenges, and every real handler canary, then activates the public agent manifest only after the live checks pass. Configure these repository Actions secrets before running it:

- `CLOUDFLARE_API_TOKEN`
- `PAY_TO_ADDRESS`
- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- `UPSTREAM_GITHUB_TOKEN` (stored in the Worker as `GITHUB_TOKEN`; use a fine-grained read-only token)
- `CANARY_TOKEN` (a strong random value used only by hard-coded internal checks)

The Cloudflare token needs permission to deploy Workers. No CDP wallet secret or buyer private key is uploaded to the Worker, and no deployment secret is committed to Git.
