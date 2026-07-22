# Privacy and data handling

Last updated: 2026-07-22

BountyVerdict is designed for public engineering evidence and machine-to-machine payments. Do not submit personal, private, proprietary, credential-bearing, or secret-bearing material.

## Data the service processes

- Public GitHub issue, repository, skill, workflow, job, and bounded log data requested by the caller.
- For a GitHub issue that already references a specific BountyHub listing, the public repository name and issue number plus bounded public BountyHub listing, pledge, claim, and assignment state.
- For MCPDriftVerdict, the complete baseline and current `tools/list` JSON snapshots supplied in the POST body.
- Standard HTTP metadata required to serve and protect the API.
- x402 payment data, including the public payer and recipient addresses, amount, network, and transaction evidence.

The application does not require a customer account and does not intentionally collect names, email addresses, advertising identifiers, or analytics profiles.

## Use and retention

Input is used only to validate the request, retrieve permitted public evidence, compute the requested result, enforce operational limits, and verify or settle payment.

The application does not write customer request bodies, fetched GitHub content, or verdict bodies to an application database, object store, or durable analytics system. Cloudflare and other infrastructure providers may process and temporarily retain request, security, diagnostic, or transaction metadata under their own policies. Public Base transactions are retained permanently by the network and independent indexers.

Operational monitoring stores aggregate health, public discovery rank, and recognized onchain revenue counts; it is not intended to store customer payloads.

## Service providers and disclosures

- **Cloudflare** hosts the Worker and static Pages site and processes HTTP traffic.
- **GitHub** supplies the public repository and Actions evidence requested by GitHub-facing products.
- **BountyHub** supplies public issue-specific bounty and pledge state only when the checked GitHub issue already contains a specific BountyHub listing URL. Payment-provider identifiers returned by its API are not copied into results, logs, or durable state.
- **Coinbase Developer Platform** facilitates x402 verification and settlement.
- **Base** records successful USDC settlements on a public blockchain.

Data may also be disclosed when required by law or to investigate abuse or a security incident. The service does not sell personal data.

## Product-specific cautions

MCPDriftVerdict transmits the complete submitted catalogs to the hosted Worker. It does not connect to an MCP server, invoke tools, fetch schema or icon URLs, or follow catalog instructions. Remove descriptions, metadata, URLs, or fields that are sensitive before submission, or do not use the hosted endpoint.

GitHub-facing products reject private repositories before returning protected content, but callers remain responsible for choosing appropriate public targets and for handling returned evidence.

## Questions and security reports

For a vulnerability, use [GitHub private vulnerability reporting](https://github.com/Mimirs402/bountyverdict/security/advisories/new). For non-sensitive questions, use the repository's public issue tracker without including secrets or private data.
