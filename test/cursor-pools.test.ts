import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  normalizeCursorUsage,
  readCursorUsage
} from '../src/providers/cursor.js';
import { makeCursorSource } from '../src/providers/cursor-source.js';
import { allowSnapshot, safeError } from '../src/security.js';
import { renderButton } from '../src/render.js';
import { UsageService } from '../src/service.js';
import { emptyRegistry } from '../src/accounts.js';
import { LastReadings } from '../src/last-readings.js';
import { openInspector } from './helpers/inspector.js';

// Only numeric quota fields from the reported 21% versus 1% discrepancy.
const now = 1789325400000;
const response = {
  billingCycleStart: '1788722575000',
  billingCycleEnd: '1791314575000',
  planUsage: {
    includedSpend: 429,
    limit: 2000,
    autoPercentUsed: 0.40857142857142853,
    apiPercentUsed: 0,
    totalPercentUsed: 0.3432
  },
  displayMessage: "You've used 21% of your included usage"
};

test('Cursor uses the same two pool percentages as its current Plan and Usage page', () => {
  const cursor = normalizeCursorUsage(response, now);
  const other = normalizeCursorUsage(response, now, 'other-models');
  assert.equal(cursor.monthly?.used, 1);
  assert.equal(other.monthly?.used, 0);
  assert.equal(cursor.monthly?.resetsAt, 1791314575);
  assert.equal(cursor.source, 'Cursor plan · Cursor Models');
  assert.equal(other.source, 'Cursor plan · Other Models');
  assert.deepEqual(cursor.breakdown, [
    { label: 'Cursor Models', used: 1 },
    { label: 'Other Models', used: 0 }
  ]);
  assert.deepEqual(allowSnapshot(cursor), cursor);
  assert.deepEqual(allowSnapshot(other, true), other);
  assert.match(renderButton('cursor', 'monthly', cursor, { now }), />1%</);
  assert.match(
    renderButton('cursor', 'monthly', cursor, { now }),
    />CM<\/text>/
  );
  assert.match(
    renderButton('cursor', 'monthly', other, { now }),
    />OM<\/text>/
  );
  assert.match(
    renderButton('cursor', 'monthly', cursor, { now, reset: true }),
    />RESET<\/text>/
  );
  assert.match(
    renderButton('cursor', 'monthly', cursor, { now, remaining: true }),
    />99%</
  );
});

test('Cursor pool values are percentages, with the app minimum-1% display rule', () => {
  for (const [raw, shown] of [
    [0, 0],
    [0.01, 1],
    [0.99, 1],
    [1.49, 1],
    [1.5, 2],
    [35.6, 36],
    [100, 100],
    [125, 100]
  ]) {
    const data = {
      ...response,
      planUsage: {
        ...response.planUsage,
        autoPercentUsed: raw,
        apiPercentUsed: raw
      }
    };
    assert.equal(normalizeCursorUsage(data, now).monthly?.used, shown);
    assert.equal(
      normalizeCursorUsage(data, now, 'other-models').monthly?.used,
      shown
    );
  }
});

test('missing or invalid selected pools cannot fall back to an unrelated spend percentage or zero', () => {
  for (const value of [undefined, null, '1', -1, NaN, Infinity]) {
    for (const pool of ['cursor-models', 'other-models'] as const) {
      const key =
        pool === 'cursor-models' ? 'autoPercentUsed' : 'apiPercentUsed';
      assert.throws(
        () =>
          normalizeCursorUsage(
            { ...response, planUsage: { ...response.planUsage, [key]: value } },
            now,
            pool
          ),
        /selected usage pool/
      );
    }
  }
  const legacy = {
    ...response,
    planUsage: { includedSpend: 429, limit: 2000 }
  };
  assert.equal(normalizeCursorUsage(legacy, now).monthly?.used, 21.45);
  assert.equal(
    normalizeCursorUsage(legacy, now).source,
    'Cursor plan · included usage'
  );
  assert.throws(
    () => normalizeCursorUsage(legacy, now, 'other-models'),
    /selected usage pool/
  );
  assert.equal(
    safeError(new Error('Cursor has not reported the selected usage pool.')),
    'Cursor has not reported the selected usage pool.'
  );
  const selectedOnly = normalizeCursorUsage(
    { ...response, planUsage: { autoPercentUsed: 4 } },
    now
  );
  assert.deepEqual(selectedOnly.breakdown, [
    { label: 'Cursor Models', used: 4 }
  ]);
});

test('Cursor pool selection reaches the source adapter and keeps account identity unchanged', async () => {
  const read = () =>
    readCursorUsage(
      async () => ({
        token: 'fixture-cursor-token',
        email: 'same@example.invalid'
      }),
      async () => new Response(JSON.stringify(response)),
      'other-models'
    );
  const result = await read();
  assert.equal(result.monthly?.used, 0);
  assert.equal(result.account.key, 'same@example.invalid');
  // Source wiring can be exercised without a real credential database.
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-pools-'));
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const { mkdir } = await import('node:fs/promises');
    const { cursorStateFile } =
      await import('../src/providers/cursor-credentials.js');
    const host = {
      platform: 'darwin' as const,
      arch: 'arm64',
      home: dir.replaceAll('\\', '/'),
      env: {}
    };
    const file = cursorStateFile(host);
    await mkdir(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE ItemTable (key TEXT, value TEXT)');
    db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(
      'cursorAuth/accessToken',
      'fixture-cursor-token'
    );
    db.close();
    const source = makeCursorSource({
      host: () => host,
      request: async () => new Response(JSON.stringify(response))
    });
    assert.equal(
      (await source.readActive({ cursorPool: 'other-models' })).monthly?.used,
      0
    );
    assert.equal((await source.readActive({})).monthly?.used, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('two Cursor keys cache different pools without mixing readings', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-pool-cache-'));
  try {
    let calls = 0;
    const service = new UsageService({
      sources: {
        cursor: {
          readActive: async (settings) => {
            calls++;
            return normalizeCursorUsage(response, now, settings.cursorPool);
          },
          readAccount: async () => {
            throw new Error('Cursor cannot pin accounts');
          }
        }
      },
      registry: { load: async () => emptyRegistry(), save: async () => {} },
      lastReadings: new LastReadings(path.join(dir, 'readings.json'))
    });
    assert.equal(
      (await service.get('cursor', { cursorConnected: true })).monthly?.used,
      1
    );
    assert.equal(
      (
        await service.get('cursor', {
          cursorConnected: true,
          cursorPool: 'other-models'
        })
      ).monthly?.used,
      0
    );
    assert.equal(
      (
        await service.get('cursor', {
          cursorConnected: true,
          cursorPool: 'cursor-models'
        })
      ).monthly?.used,
      1
    );
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Cursor inspector saves and restores the selected usage pool', async () => {
  const pi = await openInspector('com.3foldlabs.ai-usage.cursor-monthly');
  assert.equal(pi.byId('cursorPoolRow').hidden, false);
  assert.equal(pi.byId('cursorPool').value, 'cursor-models');
  pi.byId('cursorPool').value = 'other-models';
  pi.byId('cursorPool').fire('change');
  assert.equal(pi.saved().at(-1).cursorPool, 'other-models');
  const reopened = await openInspector(
    'com.3foldlabs.ai-usage.cursor-monthly',
    pi.saved().at(-1)
  );
  assert.equal(reopened.byId('cursorPool').value, 'other-models');
  const claude = await openInspector('com.3foldlabs.ai-usage.anthropic-short');
  assert.equal(claude.byId('cursorPoolRow').hidden, true);
});
