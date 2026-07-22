import assert from "node:assert/strict";
import test from "node:test";
import {
  GITHUB_MCP_NOMINATION,
  buildNominationMessage,
  nominationChildEnvironment,
  nominationConfiguration,
  nominationContractSha256,
  nominationCurlArguments,
  smtpCredentialConfig,
} from "../src/github-mcp-nomination.ts";

test("GitHub nomination is fixed to the official registry route and business identity", () => {
  assert.equal(GITHUB_MCP_NOMINATION.recipient, "partnerships@github.com");
  assert.equal(GITHUB_MCP_NOMINATION.sender, "admin@mimirslab.com");
  assert.match(GITHUB_MCP_NOMINATION.body, /io\.github\.Mimirs402\/bountyverdict@1\.1\.10/);
  assert.match(GITHUB_MCP_NOMINATION.body, /public GitHub MCP Registry only/);
  assert.match(GITHUB_MCP_NOMINATION.body, /not an application to the Technology Partner Program/);
  assert.match(GITHUB_MCP_NOMINATION.body, /explicit per-call x402 Base USDC authorization/);
});

test("nomination message is deterministic apart from its nonce and date", () => {
  const message = buildNominationMessage(new Date("2026-07-22T04:00:00Z"), "0123456789abcdef0123456789abcdef");
  assert.match(message, /^Date: Wed, 22 Jul 2026 04:00:00 GMT\r\n/);
  assert.match(message, /Message-ID: <bountyverdict-github-registry-0123456789abcdef0123456789abcdef@mimirslab\.com>/);
  assert.match(message, /From: Mimir's Lab <admin@mimirslab\.com>/);
  assert.match(message, /To: partnerships@github\.com/);
  assert.match(message, /Content-Type: text\/plain; charset=UTF-8/);
  assert.ok(message.endsWith("\r\n"));
});

test("SMTP configuration permits only the dedicated Proton business sender", () => {
  assert.deepEqual(nominationConfiguration({
    SMTP_USERNAME: "admin@mimirslab.com",
    SMTP_TOKEN: "safe-dedicated-token",
    NOMINATION_RELEASE_COMMIT: "0706964b41d7b629fa79cb46121ae5446d67276c",
  }), {
    username: "admin@mimirslab.com",
    token: "safe-dedicated-token",
    releaseCommit: "0706964b41d7b629fa79cb46121ae5446d67276c",
  });
  assert.throws(() => nominationConfiguration({ SMTP_USERNAME: "other@example.com", SMTP_TOKEN: "safe-dedicated-token", NOMINATION_RELEASE_COMMIT: "0706964b41d7b629fa79cb46121ae5446d67276c" }), /SMTP_USERNAME/);
  assert.throws(() => nominationConfiguration({ SMTP_USERNAME: "admin@mimirslab.com", SMTP_TOKEN: "short", NOMINATION_RELEASE_COMMIT: "0706964b41d7b629fa79cb46121ae5446d67276c" }), /SMTP_TOKEN/);
  assert.throws(() => nominationConfiguration({ SMTP_USERNAME: "admin@mimirslab.com", SMTP_TOKEN: "safe-dedicated-token" }), /NOMINATION_RELEASE_COMMIT/);
  assert.throws(() => nominationConfiguration({
    SMTP_HOST: "example.com",
    SMTP_USERNAME: "admin@mimirslab.com",
    SMTP_TOKEN: "safe-dedicated-token",
    NOMINATION_RELEASE_COMMIT: "0706964b41d7b629fa79cb46121ae5446d67276c",
  }), /SMTP_HOST/);
});

test("nomination receipt identity is bound to the fixed content contract", () => {
  assert.match(nominationContractSha256(), /^[a-f0-9]{64}$/);
  assert.equal(nominationContractSha256(), "533b6c92407b6c25147b5c54c107842957552c6efd540c09cbe594f58d493cb7");
});

test("SMTP secret travels through a credential pipe rather than argv or message", () => {
  const token = 'secret-with-"quote"-and-\\slash';
  const config = smtpCredentialConfig({ username: "admin@mimirslab.com", token, releaseCommit: "0706964b41d7b629fa79cb46121ae5446d67276c" });
  const args = nominationCurlArguments();
  const message = buildNominationMessage(new Date("2026-07-22T04:00:00Z"), "0123456789abcdef0123456789abcdef");
  assert.match(config, /^user = "/);
  assert.match(config, /\\"quote\\"/);
  assert.match(config, /\\\\slash/);
  assert.ok(!args.join(" ").includes(token));
  assert.ok(!message.includes(token));
  assert.equal(args[0], "--disable");
  assert.deepEqual(args.slice(args.indexOf("--config") + 1, args.indexOf("--config") + 2), ["/dev/fd/3"]);
  assert.ok(args.includes("--ssl-reqd"));
  assert.ok(args.includes("--tlsv1.2"));
});

test("curl receives a minimal child environment without SMTP or proxy secrets", () => {
  const child = nominationChildEnvironment({
    PATH: "/untrusted/bin",
    HOME: "/untrusted/home",
    SMTP_TOKEN: "must-not-be-inherited",
    HTTPS_PROXY: "https://secret-proxy.example",
    CURL_HOME: "/untrusted/curl",
  });
  assert.deepEqual(child, {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
  });
  assert.ok(!("SMTP_TOKEN" in child));
  assert.ok(!("HOME" in child));
  assert.ok(!("HTTPS_PROXY" in child));
  assert.ok(!("CURL_HOME" in child));
});
