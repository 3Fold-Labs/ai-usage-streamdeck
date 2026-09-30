import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cursorIdentity, readCursorUsage } from '../src/providers/cursor.js';
import {
  cursorStateFile,
  openCursorState,
  readCursorSignIn,
  readCursorToken
} from '../src/providers/cursor-credentials.js';
import {
  cursorSource,
  makeCursorSource
} from '../src/providers/cursor-source.js';
import { UsageService } from '../src/service.js';
import {
  emptyRegistry,
  type AccountRecord,
  type Registry
} from '../src/accounts.js';
import { LastReadings } from '../src/last-readings.js';
import type { Host } from '../src/platform.js';

const team = {
  billingCycleStart: '1788722575000',
  billingCycleEnd: '1791314575000',
  planUsage: { includedSpend: 390, limit: 2000 },
  displayMessage: "You've used 20% of your included usage"
};
const tokenQuery =
  "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'";
const emailQuery =
  "SELECT value FROM ItemTable WHERE key = 'cursorAuth/cachedEmail'";
const macHost = (home: string): Host => ({
  platform: 'darwin',
  arch: 'arm64',
  home: home.replaceAll('\\', '/'),
  env: {}
});
const usage = async () => new Response(JSON.stringify(team));
const offline = async (): Promise<never> => {
  throw new Error('network is not allowed in this test');
};
const signedIn = {
  'cursorAuth/accessToken': 'fixture-cursor-token',
  'cursorAuth/cachedEmail': 'SMFixture@example.invalid',
  'cursorAuth/refreshToken': 'not-readable'
};

// Each test builds its own Cursor state database and deck data folder; the real Cursor database is never opened.
async function fixture(rows: Record<string, string | Uint8Array>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-cursor-accounts-'));
  const previous = process.env.AI_USAGE_DATA_DIR;
  process.env.AI_USAGE_DATA_DIR = path.join(dir, 'data');
  const host = macHost(dir);
  const file = cursorStateFile(host);
  await mkdir(path.dirname(file), { recursive: true });
  const write = (entries: Record<string, string | Uint8Array>) => {
    const db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)'
    );
    const insert = db.prepare(
      'INSERT INTO ItemTable (key, value) VALUES (?, ?)'
    );
    for (const [key, value] of Object.entries(entries)) insert.run(key, value);
    db.close();
  };
  write(rows);
  const cleanup = async () => {
    if (previous === undefined) delete process.env.AI_USAGE_DATA_DIR;
    else process.env.AI_USAGE_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  };
  return { dir, host, file, write, cleanup };
}

// Records every query and database session while still using the real read-only opener.
function recorder() {
  const queries: string[] = [];
  const sessions: DatabaseSync[] = [];
  const open = async (name: string) => {
    const db = await openCursorState(name);
    sessions.push(db);
    const prepare = db.prepare.bind(db);
    return Object.assign(db, {
      prepare: (sql: string) => {
        queries.push(sql);
        return prepare(sql);
      }
    });
  };
  return { queries, sessions, open };
}

test('Cursor reads the signed-in email in the same read-only session as the token', async () => {
  const env = await fixture(signedIn);
  try {
    const before = await readFile(env.file);
    const spy = recorder();
    assert.deepEqual(await readCursorSignIn(env.host, spy.open), {
      token: 'fixture-cursor-token',
      email: 'SMFixture@example.invalid'
    });
    assert.equal(spy.sessions.length, 1);
    assert.equal(spy.sessions[0].isOpen, false);
    assert.deepEqual(spy.queries, [tokenQuery, emailQuery]);
    assert.ok(spy.queries.every((sql) => !/refresh/i.test(sql)));
    assert.deepEqual(await readFile(env.file), before);
    // The token reader keeps its exact query and result.
    const tokenSpy = recorder();
    assert.equal(
      await readCursorToken(env.host, tokenSpy.open),
      'fixture-cursor-token'
    );
    assert.equal(tokenSpy.queries[0], tokenQuery);
    assert.equal(tokenSpy.sessions.length, 1);
    // Cursor stores values as blobs on some installs.
    env.write({ 'cursorAuth/cachedEmail': Buffer.from('blob@example.com') });
    assert.equal((await readCursorSignIn(env.host)).email, 'blob@example.com');
    await assert.rejects(
      readCursorSignIn(env.host, async () => {
        throw Object.assign(new Error('database is locked'), { errcode: 5 });
      }),
      /Retrying shortly/
    );
  } finally {
    await env.cleanup();
  }
});

test('Cursor readings name the signed-in account by lowercase email and never send it', async () => {
  const env = await fixture(signedIn);
  try {
    const requests: RequestInit[] = [];
    const reading = await readCursorUsage(
      async () => ({
        token: 'fixture-cursor-token',
        email: 'SMFixture@example.invalid'
      }),
      async (_url, init) => {
        requests.push(init!);
        return usage();
      }
    );
    assert.deepEqual(reading.account, {
      key: 'smfixture@example.invalid',
      label: 'SMFixture@example.invalid'
    });
    assert.equal(reading.monthly?.used, 19.5);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body, '{}');
    assert.doesNotMatch(JSON.stringify(requests[0].headers), /smfixture/i);
    assert.doesNotMatch(JSON.stringify(reading), /fixture-cursor-token/);
    const source = makeCursorSource({ host: () => env.host, request: usage });
    const active = await source.readActive({ cursorConnected: true });
    assert.deepEqual(active.account, {
      key: 'smfixture@example.invalid',
      label: 'SMFixture@example.invalid'
    });
    assert.equal(active.monthly?.used, 19.5);
    assert.doesNotMatch(
      JSON.stringify(active),
      /fixture-cursor-token|not-readable/
    );
  } finally {
    await env.cleanup();
  }
});

test('Cursor readings without a usable stored email fall back to the desktop account', async () => {
  const fallback = { key: 'cursor:desktop', label: 'Your Cursor account' };
  assert.deepEqual(cursorIdentity(), fallback);
  assert.deepEqual(cursorIdentity(''), fallback);
  assert.deepEqual(cursorIdentity('   '), fallback);
  assert.deepEqual(cursorIdentity(' Admin@example.invalid '), {
    key: 'admin@example.invalid',
    label: 'Admin@example.invalid'
  });
  // A bare token reader still produces a reading for the one Cursor account.
  assert.deepEqual(
    (await readCursorUsage(async () => 'fixture-cursor-token', usage)).account,
    fallback
  );
  const env = await fixture({
    'cursorAuth/accessToken': 'fixture-cursor-token'
  });
  try {
    const missing = await readCursorSignIn(env.host);
    assert.equal(missing.token, 'fixture-cursor-token');
    assert.equal(missing.email, undefined);
    assert.deepEqual(
      (
        await makeCursorSource({
          host: () => env.host,
          request: usage
        }).readActive({ cursorConnected: true })
      ).account,
      fallback
    );
    for (const value of [
      '',
      '   ',
      'one@example.com\nsecond line',
      'x'.repeat(400)
    ]) {
      env.write({ 'cursorAuth/cachedEmail': value });
      assert.equal((await readCursorSignIn(env.host)).email, undefined);
    }
    env.write({ 'cursorAuth/cachedEmail': '  spaced@example.com  ' });
    assert.equal(
      (await readCursorSignIn(env.host)).email,
      'spaced@example.com'
    );
  } finally {
    await env.cleanup();
  }
});

test('Cursor keys always follow the app and report the signed-in email', async () => {
  const env = await fixture(signedIn);
  const record: AccountRecord = {
    id: 'cursor-00000000',
    provider: 'cursor',
    key: 'other@example.com',
    nick: 'OT',
    name: 'other@example.com',
    addedAt: 1
  };
  try {
    const spy = recorder();
    const source = makeCursorSource({
      host: () => env.host,
      open: spy.open,
      request: offline
    });
    await assert.rejects(
      source.readAccount(record, { cursorConnected: true }),
      /^Error: Cursor keeps one account at a time, so this key follows the Cursor app\.$/
    );
    assert.equal(source.startSignIn, undefined);
    assert.equal(cursorSource.startSignIn, undefined);
    // The signed-in account is another app's data, so it stays unread until the connection is enabled.
    assert.equal(await source.activeKey!({}), undefined);
    assert.equal(
      await source.activeKey!({ cursorConnected: false }),
      undefined
    );
    assert.equal(spy.sessions.length, 0);
    assert.equal(
      await source.activeKey!({ cursorConnected: true }),
      'smfixture@example.invalid'
    );
    assert.deepEqual(spy.queries, [tokenQuery, emailQuery]);
    env.write({ 'cursorAuth/cachedEmail': '' });
    assert.equal(
      await source.activeKey!({ cursorConnected: true }),
      'cursor:desktop'
    );
    await rm(env.file);
    assert.equal(await source.activeKey!({ cursorConnected: true }), undefined);
  } finally {
    await env.cleanup();
  }
});

test('the signed-in Cursor account registers with a nickname and chosen settings still follow it', async () => {
  const env = await fixture(signedIn);
  let current: Registry = emptyRegistry();
  const registry = {
    load: async () => current,
    save: async (next: Registry) => {
      current = next;
    }
  };
  try {
    const lastReadings = new LastReadings(
      path.join(env.dir, 'data', 'last-readings.json')
    );
    const service = new UsageService({
      sources: {
        cursor: makeCursorSource({ host: () => env.host, request: usage })
      },
      registry,
      lastReadings
    });
    const settings = { cursorConnected: true };
    const snapshot = await service.get('cursor', settings);
    assert.equal(snapshot.error, undefined);
    assert.equal(snapshot.monthly?.used, 19.5);
    assert.equal(current.accounts.length, 1);
    const [record] = current.accounts;
    assert.deepEqual(
      [record.provider, record.key, record.nick, record.name],
      ['cursor', 'smfixture@example.invalid', 'SM', 'SMFixture@example.invalid']
    );
    assert.equal(await service.nicknameFor('cursor', settings, snapshot), 'SM');
    assert.equal(
      (await lastReadings.get('cursor', 'smfixture@example.invalid'))?.monthly
        ?.used,
      19.5
    );
    const chosen = await service.get('cursor', {
      ...settings,
      account: record.id
    });
    assert.equal(chosen.error, undefined);
    assert.equal(chosen.account?.key, 'smfixture@example.invalid');
    assert.equal(
      await service.nicknameFor(
        'cursor',
        { ...settings, account: record.id },
        chosen
      ),
      'SM'
    );
    assert.equal(current.accounts.length, 1);
  } finally {
    await env.cleanup();
  }
});
