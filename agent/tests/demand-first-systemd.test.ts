import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ops = new URL("../../ops/systemd/", import.meta.url);

async function unit(relative: string): Promise<string> {
  return readFile(new URL(relative, ops), "utf8");
}

test("daily review cannot reactivate retired low-value mutation lanes", async () => {
  const sources = await unit("bountyverdict-daily-review.service.d/30-current-sources.conf");
  assert.doesNotMatch(sources, /bountyverdict-payan-demand\.service/);
  assert.doesNotMatch(sources, /bountyverdict-clawlancer-work\.service/);
  assert.match(sources, /Wants=bountyverdict-demand-watch\.service/);
});

test("retired Payan and Clawlancer services fail closed even on direct start", async () => {
  for (const relative of [
    "bountyverdict-payan-demand.service.d/99-demand-first-disabled.conf",
    "bountyverdict-clawlancer-work.service.d/99-demand-first-disabled.conf",
  ]) {
    const override = await unit(relative);
    assert.match(override, /^\[Unit\]/m);
    assert.match(override, /^\[Service\]/m);
    assert.match(override, /^ExecCondition=\/usr\/bin\/false$/m);
  }
});
