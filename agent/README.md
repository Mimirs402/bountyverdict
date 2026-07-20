# BountyVerdict Agent API

A paid, deterministic preflight for autonomous coding agents. It checks a public GitHub issue before an agent commits implementation time, API spend, or repository reputation.

## Product contracts

- Single check: `GET /api/verdict?issue_url=<public GitHub issue URL>` for **$0.05 USDC**
- Portfolio ranking: `POST /api/portfolio` with `{"issue_urls":[...]}` for **$0.40 USDC**
- Portfolio size: 2–10 unique public GitHub issue URLs; at 10 candidates the effective price is $0.04 each
- Payment: x402 v2, exact scheme
- Output: structured `AVOID`, `CAUTION`, or `VIABLE` verdicts with scores, signals, repository AI-contribution policy, coverage, limitations, and evidence URLs; the portfolio also ranks results and recommends the strongest candidate
- Discovery: x402 Bazaar extension with a strict input schema and realistic output example
- Failure behavior: invalid inputs, GitHub failures, and handler errors are not settled

`GET /` returns both product contracts without payment. `GET /api/sample` and `GET /api/portfolio/sample` return free representative results.

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

Use `NETWORK=sepolia` for testnet. The report recognizes exact $0.05 and $0.40 product settlements, separates unrelated incoming transfers, and shows purchase counts and progress toward $1,000.

## Continuous distribution monitoring

The credential-free production monitor verifies all free routes, both exact mainnet payment challenges, Coinbase Bazaar merchant and semantic-search visibility, and on-chain Base USDC revenue in one pass:

```bash
npm run distribution:monitor
```

It writes the latest machine-readable snapshot to `~/.local/state/bountyverdict/distribution-status.json`. The versioned user-service templates in `ops/systemd/` run it every 15 minutes; marketplace absence before the first CDP settlement is reported as `indexed: false`, not as a health failure.

## Deployment inputs

Only a **public EVM receiving address** is required from the owner for testnet. Never provide a seed phrase or private key to this service.

For production Bazaar discovery, configure:

- `PAY_TO_ADDRESS`: public Base-compatible wallet address receiving USDC
- `GITHUB_TOKEN`: optional fine-grained read-only token for higher API capacity
- `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`: facilitator credentials stored as Worker secrets
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
npm run deploy -- --env production
```

The receiving address is public on-chain, but storing it as a binding keeps deployment configuration separate from source. The other three values are secrets and must never be committed.

### One-action release

The manual `Deploy paid Worker` GitHub Actions workflow performs the same production deployment, verifies both free routes and both x402 challenges, and activates the public agent manifest only after the live checks pass. Configure these repository Actions secrets before running it:

- `CLOUDFLARE_API_TOKEN`
- `PAY_TO_ADDRESS`
- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`

The Cloudflare token needs permission to deploy Workers. No CDP wallet secret or buyer private key is uploaded to the Worker.
