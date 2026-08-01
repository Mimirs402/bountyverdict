import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repository = new URL("..", import.meta.url).pathname;
const installer = join(repository, "ops/install-distribution-monitor-user-unit.sh");
const sourceDirectory = join(repository, "ops/systemd");
const serviceName = "bountyverdict-distribution-monitor.service";
const timerName = "bountyverdict-distribution-monitor.timer";
const retired = [
  "30-experiment-decision-gate.conf",
  "40-agent-question-v7-activation.conf",
  "50-current-monitor.conf",
  "60-free-selector-activation.conf",
  "70-audited-monitor.conf",
  "90-preserve-free-selector-epoch.conf",
];

test("distribution monitor installer removes retired overrides and is idempotent", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "bountyverdict-systemd-install-"));
  try {
    const target = join(temporary, "systemd/user");
    const dropins = join(target, `${serviceName}.d`);
    const fakeSystemctl = join(temporary, "systemctl");
    const log = join(temporary, "systemctl.log");
    await mkdir(dropins, { recursive: true });
    for (const name of retired) {
      await writeFile(join(dropins, name), "[Service]\nExecStart=\nExecStart=/usr/bin/env AUDITED_MONITOR=distribution node --experimental-strip-types scripts/run-audited-monitor.ts\n");
    }
    await writeFile(join(dropins, "50-production-runtime.conf"), "[Service]\nWorkingDirectory=/tmp/runtime/agent\n");
    await writeFile(fakeSystemctl, `#!/bin/sh
printf '%s\\n' "$*" >> "$BOUNTYVERDICT_SYSTEMCTL_LOG"
case "$*" in
  *" show "*)
    printf '%s\\n' \\
      "FragmentPath=$BOUNTYVERDICT_SYSTEMD_USER_DIR/${serviceName}" \\
      "DropInPaths=$BOUNTYVERDICT_SYSTEMD_USER_DIR/${serviceName}.d/50-production-runtime.conf" \\
      "ExecStart={ argv[]=/usr/bin/env node --experimental-strip-types scripts/distribution-monitor.ts ; }" \\
      "ExecStartPre=" \\
      "Environment=REPORT_ONLY=YES" \\
      "NeedDaemonReload=no"
    ;;
esac
`);
    await chmod(fakeSystemctl, 0o700);

    const environment = {
      ...process.env,
      BOUNTYVERDICT_SYSTEMD_USER_DIR: target,
      BOUNTYVERDICT_SYSTEMCTL: fakeSystemctl,
      BOUNTYVERDICT_SYSTEMCTL_LOG: log,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await execFileAsync(installer, [], { env: environment });
      assert.match(result.stdout, /Installed and verified/);
    }

    for (const name of retired) {
      await assert.rejects(stat(join(dropins, name)), { code: "ENOENT" });
    }
    assert.equal(
      await readFile(join(dropins, "50-production-runtime.conf"), "utf8"),
      "[Service]\nWorkingDirectory=/tmp/runtime/agent\n",
    );
    assert.deepEqual(
      await readFile(join(target, serviceName)),
      await readFile(join(sourceDirectory, serviceName)),
    );
    assert.deepEqual(
      await readFile(join(target, timerName)),
      await readFile(join(sourceDirectory, timerName)),
    );
    const calls = await readFile(log, "utf8");
    assert.equal((calls.match(/--user daemon-reload/g) || []).length, 2);
    assert.equal((calls.match(/--user show bountyverdict-distribution-monitor\.service/g) || []).length, 2);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
