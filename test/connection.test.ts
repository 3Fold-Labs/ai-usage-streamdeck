import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageService } from '../src/service.js';
import { renderButton } from '../src/render.js';

test('disconnect hides cached usage and reconnect discards the old reading', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'usage-connect-'));
  const file = path.join(dir, 'claude.json');
  const service = new UsageService();
  const settings = { claudeFile: file };
  const save = (used_percentage: number) =>
    writeFile(
      file,
      JSON.stringify({
        observedAt: Date.now(),
        rate_limits: { five_hour: { used_percentage } }
      })
    );
  try {
    await save(42);
    assert.equal((await service.get('anthropic', settings)).short?.used, 42);
    await save(17);
    const disconnected = await service.get(
      'anthropic',
      { ...settings, disconnected: true },
      true
    );
    assert.equal(disconnected.short, undefined);
    assert.equal(disconnected.observedAt, 0);
    service.clear('anthropic', settings);
    assert.equal((await service.get('anthropic', settings)).short?.used, 17);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('logos stay steady as time passes', () => {
  const now = Date.now();
  const snapshot = { observedAt: now, weekly: { used: 17, minutes: 10080 } };
  for (const provider of ['openai', 'anthropic', 'grok'] as const) {
    assert.equal(
      renderButton(provider, 'weekly', snapshot, { now }),
      renderButton(provider, 'weekly', snapshot, { now: now + 2000 })
    );
  }
});
