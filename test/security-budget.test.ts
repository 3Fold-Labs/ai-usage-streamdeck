import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
test('private CI budget counts retries and fails closed if exhausted or unverifiable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-budget-'));
  try {
    const event = path.join(dir, 'event.json');
    await writeFile(event, JSON.stringify({ repository: { private: true } }));
    for (const [attempts, ok, expected] of [
      [2, true, 0],
      [21, true, 1],
      [1, false, 1]
    ] as const) {
      const code = `process.argv=['node','budget','ci.yml','20'];globalThis.fetch=async()=>({ok:${ok},json:async()=>({total_count:1,workflow_runs:[{run_attempt:${attempts}}]})});await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/check-actions-budget.mjs')).href)});`;
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', code],
        {
          env: {
            ...process.env,
            GITHUB_EVENT_PATH: event,
            GITHUB_REPOSITORY: 'fixture/repo',
            GITHUB_TOKEN: 'synthetic-budget-token'
          },
          encoding: 'utf8'
        }
      );
      assert.equal(result.status, expected, result.stderr);
      assert.ok(
        !(result.stdout + result.stderr).includes('synthetic-budget-token')
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
