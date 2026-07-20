# Repository agent instructions

- Treat customer revenue and genuine purchases as onchain, non-owner settlement facts only. Never infer either from HTTP traffic, directory probes, search ranks, installs, owner canaries, or marketplace auditions.
- Every direct request made by maintainers or automated audits to the production Worker must send `User-Agent: bountyverdict-owner-audit/1.0` unless a more specific existing `bountyverdict-*` owner user agent already applies.
- Directory searches can trigger server-side origin crawls whose user agent cannot be controlled. Before a broad live directory audit, start an explicit trusted-funnel draining rotation; do not describe traffic collected during that window as organic demand.
- Never self-install, self-pay, or fabricate traffic to improve acquisition metrics. Read-only retrieval benchmarks must be labeled owner-run.
- Do not issue a payment challenge for structurally invalid input. Canonical POST routes must validate a complete JSON body before returning HTTP 402; discovery belongs in OpenAPI and `/.well-known/x402`.
- Standard x402 authorization binds a resource URL, not a POST body. Preserve the validated JSON on retry, expose an advisory normalized-body hash, and never claim cryptographic body binding.
- Use `npx awal@2.12.0` for Agentic Wallet commands. Inspect the challenge and enforce the exact atomic cap before any authorized owner canary.
- Keep secrets outside Git. `.dev.vars` and user configuration files are local-only and must remain ignored with mode `0600` where supported.
