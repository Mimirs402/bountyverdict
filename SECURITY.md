# Security policy

## Report a vulnerability privately

Please use [GitHub private vulnerability reporting](https://github.com/Mimirs402/bountyverdict/security/advisories/new). Do not open a public issue for a suspected vulnerability, payment bypass, secret exposure, or exploit.

Include the affected endpoint or skill, reproduction steps, expected impact, and any transaction hash only when it is already public onchain. Never include wallet private keys, seed phrases, API secrets, payment signatures, access tokens, or private repository data.

Reports are reviewed on a best-effort basis. Acknowledgement, remediation, and disclosure timing depend on severity and reproducibility; this project does not promise a fixed response SLA or bounty payment.

## Supported version

Security fixes target the current production Worker and the latest tagged skill release. Older tags remain inspectable but may not receive fixes.

## Security boundaries

- The hosted products accept only documented public GitHub targets, except MCPDriftVerdict, which accepts caller-supplied catalog snapshots and explicitly warns against submitting private or secret-bearing catalogs.
- Repository and catalog content is untrusted data. The service does not execute repository code, invoke MCP tools, follow catalog instructions, or fetch catalog URLs.
- Payment uses x402 v2 on Base USDC. Clients must validate the exact request, recipient, network, asset, and atomic amount before signing.
- Invalid input and upstream failures are designed to fail without settlement. A transaction submitted onchain remains public and cannot be made private by this service.

See [PRIVACY.md](PRIVACY.md) for data handling and service providers.
