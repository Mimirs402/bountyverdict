# BountyVerdict Agent API

A paid, deterministic preflight for autonomous coding agents. It checks a public GitHub issue before an agent commits implementation time, API spend, or repository reputation.

## Product contract

- Endpoint: `GET /api/verdict?issue_url=<public GitHub issue URL>`
- Price: **$0.25 USDC per successful verdict**
- Payment: x402 v2, exact scheme
- Output: structured `AVOID`, `CAUTION`, or `VIABLE` verdict with score, signals, coverage, limitations, and evidence URLs
- Discovery: x402 Bazaar extension with a strict input schema and realistic output example
- Failure behavior: invalid inputs, GitHub failures, and handler errors are not settled

`GET /` returns the product contract without payment. `GET /api/sample` returns a free representative result.

## Local verification

Use Node 22:

```bash
npm install
npm test
npm run typecheck
npm run deploy:dry
npm run dev -- --var PAY_TO_ADDRESS:0x0000000000000000000000000000000000000001
```

An unpaid request should return HTTP 402 with `PAYMENT-REQUIRED`, including the $0.25 price and `extensions.bazaar` metadata:

```bash
curl -i 'http://127.0.0.1:8787/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Ftypeorm%2Ftypeorm%2Fissues%2F3357'
```

## Deployment inputs

Only a **public EVM receiving address** is required from the owner for testnet. Never provide a seed phrase or private key to this service.

For production Bazaar discovery, configure:

- `PAY_TO_ADDRESS`: public Base-compatible wallet address receiving USDC
- `GITHUB_TOKEN`: optional fine-grained read-only token for higher API capacity
- `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`: facilitator credentials stored as Worker secrets
- `X402_NETWORK=eip155:8453`
- `X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402`

The no-signup facilitator in the default config is Base Sepolia only. Its test catalog is separate from Coinbase's production Bazaar. A Bazaar-enabled resource is indexed after its first successful settlement through the CDP facilitator.

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
