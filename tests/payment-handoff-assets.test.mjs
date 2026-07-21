import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const endpoint = "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp";

test("client install guide uses each host's actual remote MCP contract", async () => {
  const guide = await readFile(new URL("../llms-install.md", import.meta.url), "utf8");
  assert.match(guide, new RegExp(`codex mcp add bountyverdict --url ${endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(guide, /\[mcp_servers\.bountyverdict\]\nurl = /);
  assert.match(guide, /claude mcp add --transport http --scope user bountyverdict/);
  assert.match(guide, /gemini mcp add --transport http --scope user bountyverdict/);
  assert.match(guide, /"httpUrl": "https:\/\/bountyverdict-agent-production/);
  assert.match(guide, /VS Code uses the top-level key `servers`, not `mcpServers`/);
  assert.match(guide, /\.cursor\/mcp\.json/);
  assert.match(guide, /Cline's MCP settings/);
  assert.match(guide, /kilo mcp add bountyverdict --url/);
  assert.match(guide, /Marketplace Install action after its listing is published/g);
});

test("public guidance states the real wallet boundary and exact handoff contract", async () => {
  const [guide, page, readme, llms, manifestText] = await Promise.all([
    readFile(new URL("../llms-install.md", import.meta.url), "utf8"),
    readFile(new URL("../agents.html", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../llms.txt", import.meta.url), "utf8"),
    readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"),
  ]);
  for (const value of [guide, page, readme, llms]) {
    assert.match(value, /remote MCP connection does not (?:itself )?provide a wallet/i);
    assert.match(value, /x402-aware MCP client/i);
  }
  assert.match(guide, /io\.github\.Mimirs402\/bountyverdict\/http-payment-handoff/);
  assert.match(guide, /exact method and fully encoded URL/);
  assert.match(guide, /validated JSON body and its SHA-256/);
  assert.match(guide, /Never join the values into a shell string/);
  assert.match(guide, /never raise `max_amount_atomic` silently/);
  assert.match(guide, /Wallet authentication, funding, and spending limits are buyer-controlled prerequisites/);
  assert.match(page, /llms-install\.md/);
  assert.doesNotMatch(guide, /(?:PRIVATE_KEY|API_SECRET|WALLET_SECRET|Bearer [A-Za-z0-9])/);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.client_setup, "https://mimirs402.github.io/bountyverdict/llms-install.md");
  assert.equal(manifest.mcp.direct_automatic_payment_requires, "@x402/mcp");
  assert.equal(
    manifest.mcp.http_payment_handoff_extension,
    "io.github.Mimirs402/bountyverdict/http-payment-handoff",
  );
  assert.equal(
    manifest.mcp.legacy_http_payment_handoff_extension,
    "io.github.cristianmoroaica/bountyverdict/http-payment-handoff",
  );
});
