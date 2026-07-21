import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/index.ts";

test("production origin exposes the public product favicon", async () => {
  const response = await app.request("/favicon.ico");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://mimirs402.github.io/bountyverdict/favicon.svg");
});
