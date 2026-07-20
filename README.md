# BountyVerdict

[![CI](https://github.com/cristianmoroaica/bountyverdict/actions/workflows/ci.yml/badge.svg)](https://github.com/cristianmoroaica/bountyverdict/actions/workflows/ci.yml)

Know before you code.

BountyVerdict checks whether a public GitHub bounty issue is still worth investigating. It catches failure modes that shallow bounty boards miss:

- closed or locked issues;
- archived or stale repositories;
- linked open pull requests;
- closed-PR and attempt swarms;
- explicit maintainer rejection or spam warnings;
- comments indicating a withdrawn or cancelled reward.

Every important result links back to public GitHub evidence. The tool does not guarantee that a reward exists, that work will be merged, or that anyone will pay.

## Use it

Visit [BountyVerdict](https://cristianmoroaica.github.io/bountyverdict/) and paste a public GitHub issue URL.

No account, token, backend, analytics, or data storage is used. Your browser makes read-only requests directly to GitHub's public API.

## Agent API

The `agent/` directory contains the paid, machine-readable product surface. It is a Cloudflare Worker with an x402-protected endpoint that charges **$0.05 USDC per fresh verdict** and declares its input/output schema through the Bazaar discovery extension. The paid check also reads official contribution documents for explicit AI-work bans or disclosure requirements.

Agents can inspect the free `/api/sample`, see the exact price in the HTTP 402 response, and pay only when they call `/api/verdict?issue_url=...`. Invalid inputs and upstream failures return an error without settlement.

See [`agent/README.md`](agent/README.md) for the protocol, local verification, and deployment configuration.

The launch price and differentiation are grounded in a live Bazaar comparison documented in [`docs/MARKET_VALIDATION.md`](docs/MARKET_VALIDATION.md). Agents and crawlers can read [`llms.txt`](llms.txt) before deciding whether the product is relevant.

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
