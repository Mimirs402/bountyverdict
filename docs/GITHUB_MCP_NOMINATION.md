# GitHub public MCP Registry nomination

GitHub's official publication route requires one email to `partnerships@github.com` after the server is present in the OSS MCP Registry. `io.github.Mimirs402/bountyverdict@1.1.9` already satisfies that prerequisite.

The nomination sender is deliberately one-shot and fixed to:

- sender: `admin@mimirslab.com`
- recipient: `partnerships@github.com`
- SMTP: Proton `smtp.protonmail.ch:587` with required TLS
- purpose: public MCP Registry nomination only, not the Technology Partner Program

Generate a dedicated SMTP token for `admin@mimirslab.com` in Proton Mail under **Settings → All settings → IMAP/SMTP → SMTP tokens**. Store it outside the repository:

```bash
mkdir -p ~/.config/bountyverdict
cp ops/github-mcp-nomination.env.example ~/.config/bountyverdict/github-nomination.env
chmod 0600 ~/.config/bountyverdict/github-nomination.env
```

Replace only the placeholder token, then run from `agent/`:

```bash
NOMINATION_RELEASE_COMMIT="$(git rev-parse HEAD)" npm run nominate:github-mcp
```

Before SMTP transport, the sender writes a private durable receipt under `~/.local/state/bountyverdict/`. The receipt binds the exact fixed nomination contract and the release commit. A successful SMTP acceptance is recorded exactly once. Any ambiguous transport failure is also terminal and requires manual reconciliation; the script never retries an email that might already have been accepted. The SMTP token travels to `curl` over a private file descriptor and is not stored in the receipt, placed in command arguments, printed, or committed.
