import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { appDataDirectory, type Host } from '../src/platform.js';
import {
  GrokKeychainUnavailable,
  grokBotIdentity,
  listGrokBotAccounts,
  pickGrokBotAccounts,
  readGrokCredentials
} from '../src/providers/grok-credentials.js';
import { createGrokSource } from '../src/providers/grok-source.js';
import { UsageService } from '../src/service.js';
import { emptyRegistry, upsertIdentity } from '../src/accounts.js';
import { LastReadings } from '../src/last-readings.js';

const dataDir = await mkdtemp(path.join(tmpdir(), 'ai-usage-grok-accounts-'));
const previousDataDir = process.env.AI_USAGE_DATA_DIR;
process.env.AI_USAGE_DATA_DIR = dataDir;
after(async () => {
  if (previousDataDir === undefined) delete process.env.AI_USAGE_DATA_DIR;
  else process.env.AI_USAGE_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

const noLonger = 'This Grok Bot account is no longer signed in to Grok Bot.';
const signInMessage =
  'Open Grok Bot and add or switch the account there. This panel watches for it and adds it to the list.';
const usage = {
  usagePercent: 31.5,
  nextResetTimestampUtc: '2099-01-01T00:00:00Z'
};
const macPassword = 'fixture safe-storage password ';
const macKey = pbkdf2Sync(
  Buffer.from(macPassword),
  'saltysalt',
  1003,
  16,
  'sha1'
);
const windowsKey = Buffer.alloc(32, 7);

// Same Chromium safeStorage formats the Mac and Windows tests in test/mac.test.ts build.
const encryptMac = (value: string) => {
  const cipher = createCipheriv('aes-128-cbc', macKey, Buffer.alloc(16, 0x20));
  return (
    'scoped:v1:' +
    'b'.repeat(64) +
    ':' +
    Buffer.concat([
      Buffer.from('v10'),
      cipher.update(value),
      cipher.final()
    ]).toString('base64')
  );
};
const encryptWindows = (value: string) => {
  const nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', windowsKey, nonce);
  return Buffer.concat([
    Buffer.from('v10'),
    nonce,
    cipher.update(value),
    cipher.final(),
    cipher.getAuthTag()
  ]).toString('base64');
};

function accounts(encrypt: (value: string) => string) {
  return {
    active: 'home',
    accounts: {
      work: {
        'cursor-access-token': encrypt('work-token'),
        'cursor-account-profile': encrypt(
          JSON.stringify({ email: 'Work@Example.com', name: 'Work' })
        ),
        'cursor-refresh-token': 'not-readable'
      },
      home: {
        'cursor-access-token': encrypt('home-token'),
        'cursor-selected-team-id': encrypt('42'),
        'cursor-account-profile': encrypt(
          JSON.stringify({ email: 'home@example.com' })
        ),
        'cursor-refresh-token': 'not-readable'
      },
      bare: {
        'cursor-access-token': encrypt('bare-token'),
        'cursor-refresh-token': 'not-readable'
      },
      signedOut: {
        'cursor-account-profile': encrypt(
          JSON.stringify({ email: 'gone@example.com' })
        ),
        'cursor-refresh-token': 'not-readable'
      }
    }
  };
}

async function fixture(
  platform: 'darwin' | 'win32',
  options: { asObject?: boolean } = {}
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-grok-bot-'));
  // Keep every fixture path rooted in the temp directory. Joining Windows-style paths on a
  // POSIX host would otherwise write "\var\folders\...\Roaming\Grok Bot" into the repository.
  const host: Host =
    platform === 'darwin'
      ? { platform, arch: 'arm64', home: dir.replaceAll('\\', '/'), env: {} }
      : {
          platform,
          arch: 'x64',
          home: dir,
          env: {
            APPDATA: path.join(dir, 'Roaming'),
            LOCALAPPDATA: path.join(dir, 'Local')
          }
        };
  // Windows joins turn a POSIX temp path into one backslash name, which resolves against the
  // working directory. Run inside the temp directory so nothing is written to the repository.
  const previousCwd =
    platform === 'win32' && process.platform !== 'win32'
      ? process.cwd()
      : undefined;
  if (previousCwd) process.chdir(dir);
  const root = appDataDirectory('Grok Bot', host);
  const data = accounts(platform === 'darwin' ? encryptMac : encryptWindows);
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, 'sand-secrets.json'),
    JSON.stringify({
      'cursor-accounts': options.asObject ? data : JSON.stringify(data)
    })
  );
  const reads = { keychain: 0, passwords: [] as Buffer[] };
  const readMacPassword = async () => {
    reads.keychain++;
    const password = Buffer.from(macPassword);
    reads.passwords.push(password);
    return password;
  };
  const readWindowsKey = async () => {
    reads.keychain++;
    return Buffer.from(windowsKey);
  };
  const cleanup = async () => {
    if (previousCwd) process.chdir(previousCwd);
    await rm(dir, { recursive: true, force: true });
  };
  return { dir, host, reads, readMacPassword, readWindowsKey, cleanup };
}

function fakeRequest() {
  const calls: Record<string, string>[] = [];
  const request = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init?.headers as Record<string, string>);
    return new Response(JSON.stringify(usage));
  }) as typeof fetch;
  return { calls, request };
}

test('Grok Bot lists every signed-in account with a single Keychain read', async () => {
  for (const asObject of [false, true]) {
    const env = await fixture('darwin', { asObject });
    try {
      const listed = await listGrokBotAccounts(env.host, env.readMacPassword);
      assert.deepEqual(listed, [
        { id: 'work', email: 'Work@Example.com', active: false },
        { id: 'home', email: 'home@example.com', active: true },
        { id: 'bare', active: false }
      ]);
      assert.equal(env.reads.keychain, 1);
      assert.ok(
        env.reads.passwords.every((password) =>
          password.every((byte) => byte === 0)
        )
      );
    } finally {
      await env.cleanup();
    }
  }
});

test('Grok Bot on Windows lists and reads accounts with the DPAPI key', async () => {
  const env = await fixture('win32');
  try {
    assert.deepEqual(
      (
        await listGrokBotAccounts(
          env.host,
          env.readMacPassword,
          env.readWindowsKey
        )
      ).map((account) => account.email),
      ['Work@Example.com', 'home@example.com', undefined]
    );
    assert.deepEqual(
      await readGrokCredentials(
        env.host,
        env.readMacPassword,
        'work',
        env.readWindowsKey
      ),
      { token: 'work-token', team: undefined }
    );
    const { calls, request } = fakeRequest();
    const source = createGrokSource({
      host: env.host,
      readWindowsKey: env.readWindowsKey,
      request
    });
    const reading = await source.readAccount(
      {
        id: 'grok-1',
        provider: 'grok',
        key: 'work@example.com',
        nick: 'WO',
        name: 'Work',
        addedAt: 1
      },
      {}
    );
    assert.deepEqual(reading.account, {
      key: 'work@example.com',
      label: 'Work@Example.com'
    });
    assert.equal(calls[0].Authorization, 'Bearer work-token');
  } finally {
    await env.cleanup();
  }
});

test('Grok Bot reads a chosen account by id and the active account by default', async () => {
  const env = await fixture('darwin');
  try {
    assert.deepEqual(await readGrokCredentials(env.host, env.readMacPassword), {
      token: 'home-token',
      team: '42'
    });
    assert.deepEqual(
      await readGrokCredentials(env.host, env.readMacPassword, 'work'),
      { token: 'work-token', team: undefined }
    );
    const before = env.reads.keychain;
    for (const id of ['missing', 'signedOut'])
      await assert.rejects(
        readGrokCredentials(env.host, env.readMacPassword, id),
        (error: Error) => error.message === noLonger
      );
    assert.equal(env.reads.keychain, before);
  } finally {
    await env.cleanup();
  }
});

test('Grok Bot never reads refresh tokens', async () => {
  const guard = (entry: Record<string, unknown>) =>
    Object.defineProperty(entry, 'cursor-refresh-token', {
      enumerable: true,
      get() {
        throw new Error('cursor-refresh-token was accessed');
      }
    });
  const store = {
    active: 'a',
    accounts: {
      a: guard({
        'cursor-access-token': 'token-a',
        'cursor-account-profile': 'profile-a',
        'cursor-selected-team-id': 'team-a'
      }),
      b: guard({ 'cursor-access-token': 'token-b' })
    }
  };
  const picked = pickGrokBotAccounts({ 'cursor-accounts': store });
  assert.deepEqual(picked, {
    active: 'a',
    accounts: [
      { id: 'a', token: 'token-a', team: 'team-a', profile: 'profile-a' },
      { id: 'b', token: 'token-b', team: undefined, profile: undefined }
    ]
  });
  assert.doesNotMatch(
    JSON.stringify(
      pickGrokBotAccounts({
        'cursor-accounts': JSON.stringify({
          active: 'a',
          accounts: {
            a: {
              'cursor-access-token': 't',
              'cursor-refresh-token': 'SECRET-REFRESH'
            }
          }
        })
      })
    ),
    /SECRET-REFRESH|refresh/
  );
  assert.throws(
    () => pickGrokBotAccounts({ 'cursor-accounts': '{not json' }),
    /account data changed/
  );
  // Fixture refresh tokens are not valid ciphertext, so any attempt to decrypt one would fail the reads below.
  const env = await fixture('darwin');
  try {
    const { request } = fakeRequest();
    const source = createGrokSource({
      host: env.host,
      readMacPassword: env.readMacPassword,
      request
    });
    assert.equal((await source.readActive({})).weekly?.used, 31.5);
    assert.equal((await source.discover!({})).length, 3);
  } finally {
    await env.cleanup();
  }
});

test('Grok Bot readings name their account and chosen accounts match by email', async () => {
  const env = await fixture('darwin');
  try {
    const { calls, request } = fakeRequest();
    const source = createGrokSource({
      host: env.host,
      readMacPassword: env.readMacPassword,
      request
    });
    const active = await source.readActive({});
    assert.deepEqual(active.account, {
      key: 'home@example.com',
      label: 'home@example.com'
    });
    assert.equal(active.weekly?.used, 31.5);
    assert.equal(calls[0].Authorization, 'Bearer home-token');
    assert.equal(calls[0]['x-cursor-team-id'], '42');
    const record = (key: string) => ({
      id: 'grok-00000000',
      provider: 'grok' as const,
      key,
      nick: 'WO',
      name: 'Work',
      addedAt: 1
    });
    const work = await source.readAccount(record('WORK@example.com'), {});
    assert.deepEqual(work.account, {
      key: 'work@example.com',
      label: 'Work@Example.com'
    });
    assert.equal(work.idle, undefined);
    assert.equal(calls[1].Authorization, 'Bearer work-token');
    assert.equal(calls[1]['x-cursor-team-id'], undefined);
    assert.deepEqual(
      (await source.readAccount(record('grok-bot:bare'), {})).account,
      { key: 'grok-bot:bare', label: 'Grok Bot account' }
    );
    assert.equal(calls[2].Authorization, 'Bearer bare-token');
    for (const key of ['gone@example.com', 'nobody@example.com'])
      await assert.rejects(
        source.readAccount(record(key), {}),
        (error: Error) => error.message === noLonger
      );
    assert.equal(calls.length, 3);
    assert.deepEqual(await source.discover!({}), [
      { key: 'work@example.com', label: 'Work@Example.com' },
      { key: 'home@example.com', label: 'home@example.com' },
      { key: 'grok-bot:bare', label: 'Grok Bot account' }
    ]);
    assert.equal(await source.activeKey!({}), 'home@example.com');
    assert.deepEqual(grokBotIdentity({ id: 'x', email: 'A@example.invalid' }), {
      key: 'a@example.invalid',
      label: 'A@example.invalid'
    });
  } finally {
    await env.cleanup();
  }
});

test('Grok Bot sign-in opens the Grok Bot app instead of signing in here', async () => {
  const env = await fixture('win32');
  try {
    const launched: [string, string[]][] = [];
    const launch = async (file: string, args: string[]) => {
      launched.push([file, args]);
    };
    const mac = await createGrokSource({
      host: {
        platform: 'darwin',
        arch: 'arm64',
        home: '/Users/example',
        env: {}
      },
      launch
    }).startSignIn!({}, '/unused');
    assert.equal(mac.kind, 'app');
    assert.equal(mac.kind === 'app' && mac.message, signInMessage);
    assert.ok(mac.kind === 'app' && mac.open);
    await mac.open();
    assert.deepEqual(launched, [['/usr/bin/open', ['-a', 'Grok Bot']]]);

    const exe = path.win32.join(
      env.host.env.LOCALAPPDATA!,
      'Programs',
      'Grok Bot',
      'Grok Bot.exe'
    );
    const missing = await createGrokSource({
      host: env.host,
      launch,
      exists: async () => false
    }).startSignIn!({}, '/unused');
    assert.deepEqual(missing, { kind: 'app', message: signInMessage });
    const found = await createGrokSource({
      host: env.host,
      launch,
      exists: async (file) => file === exe
    }).startSignIn!({}, '/unused');
    assert.ok(found.kind === 'app' && found.open);
    await found.open();
    assert.deepEqual(launched[1], [exe, []]);

    const failing = await createGrokSource({
      host: {
        platform: 'darwin',
        arch: 'arm64',
        home: '/Users/example',
        env: {}
      },
      launch: async () => {
        throw new Error('Unable to find application');
      }
    }).startSignIn!({}, '/unused');
    await assert.rejects(
      failing.kind === 'app' ? failing.open!() : Promise.resolve(),
      /^Error: Could not open Grok Bot\./
    );
  } finally {
    await env.cleanup();
  }
});

test('a chosen Grok Bot account keeps pausing Keychain retries until an explicit refresh', async () => {
  const env = await fixture('darwin');
  try {
    let calls = 0;
    const readMacPassword = async (): Promise<Buffer> => {
      calls++;
      throw new GrokKeychainUnavailable();
    };
    const { calls: requests, request } = fakeRequest();
    const source = createGrokSource({
      host: env.host,
      readMacPassword,
      request
    });
    const { registry, record } = upsertIdentity(
      emptyRegistry(),
      'grok',
      { key: 'work@example.com', label: 'Work@Example.com' },
      undefined,
      1
    );
    const service = new UsageService({
      sources: { grok: source },
      registry: { load: async () => registry, save: async () => {} },
      lastReadings: new LastReadings(path.join(dataDir, 'last-readings.json'))
    });
    const settings = { grokConnected: true, account: record.id };
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
      assert.match(
        (await service.get('grok', settings)).error!,
        /Automatic Keychain retries are paused/
      );
      now += 120_000;
      await service.get('grok', settings);
      assert.equal(calls, 1);
      await service.get('grok', settings, true);
      assert.equal(calls, 2);
    } finally {
      Date.now = originalNow;
    }
    await assert.rejects(source.discover!({}), GrokKeychainUnavailable);
    await assert.rejects(source.activeKey!({}), GrokKeychainUnavailable);
    assert.equal(requests.length, 0);
  } finally {
    await env.cleanup();
  }
});
