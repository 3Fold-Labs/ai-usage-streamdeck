import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import {
  appDataDirectory,
  macCodexCandidates,
  type Host
} from '../src/platform.js';
import { findClaudeHistory } from '../src/providers/claude.js';
import { isExecutableFile } from '../src/providers/codex.js';
import {
  decryptMacGrokValue,
  decryptWindowsGrokValue,
  readGrokCredentials,
  GrokKeychainUnavailable
} from '../src/providers/grok-credentials.js';
import { UsageService } from '../src/service.js';
import { emptyRegistry } from '../src/accounts.js';
import { LastReadings } from '../src/last-readings.js';

const macHost = (home: string, arch = 'arm64'): Host => ({
  platform: 'darwin',
  arch,
  home: home.replaceAll('\\', '/'),
  env: {}
});

test('Mac discovery supports GUI PATH omissions and both native architectures', () => {
  for (const [arch, triple] of [
    ['arm64', 'aarch64-apple-darwin'],
    ['x64', 'x86_64-apple-darwin']
  ]) {
    const host = macHost('/Users/example', arch);
    const candidates = macCodexCandidates(host);
    assert.ok(
      candidates.includes('/Applications/Codex.app/Contents/Resources/codex')
    );
    assert.ok(candidates.includes('/Users/example/.local/bin/codex'));
    assert.ok(candidates.some((file) => file.includes(triple)));
    assert.ok(candidates.includes('/opt/homebrew/bin/codex'));
    assert.ok(candidates.includes('/usr/local/bin/codex'));
    assert.equal(
      appDataDirectory('Claude', host),
      '/Users/example/Library/Application Support/Claude'
    );
    assert.ok(
      candidates.every((file) => !file.includes('.exe') && !file.includes('\\'))
    );
  }
});

test('Mac Claude discovery reads its Application Support history with spaces in the path', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-mac-'));
  try {
    const host = macHost(dir);
    const root = appDataDirectory('Claude', host);
    const file = path.posix.join(root, 'plan-usage-history.json');
    assert.equal(await findClaudeHistory(host), undefined);
    await mkdir(root, { recursive: true });
    await writeFile(file, '{"samples":[]}');
    assert.equal(await findClaudeHistory(host), file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Mac Grok reads only the active scoped account, preserves password bytes, and clears the password buffer', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-mac-grok-'));
  const password = Buffer.from('fixture safe-storage password ');
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const encrypt = (value: string) => {
    const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    return (
      'scoped:v1:' +
      'a'.repeat(64) +
      ':' +
      Buffer.concat([
        Buffer.from('v10'),
        cipher.update(value),
        cipher.final()
      ]).toString('base64')
    );
  };
  try {
    const host = macHost(dir);
    const root = appDataDirectory('Grok Bot', host);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.posix.join(root, 'sand-secrets.json'),
      JSON.stringify({
        'cursor-accounts': JSON.stringify({
          active: 'selected',
          accounts: {
            inactive: { 'cursor-access-token': 'not-readable' },
            selected: {
              'cursor-access-token': encrypt('fixture-access-token'),
              'cursor-selected-team-id': encrypt('42'),
              'cursor-refresh-token': 'not-readable'
            }
          }
        })
      })
    );
    const result = await readGrokCredentials(host, async () => password);
    assert.deepEqual(result, { token: 'fixture-access-token', team: '42' });
    assert.ok(password.every((byte) => byte === 0));
    assert.throws(
      () => decryptMacGrokValue('plaintext:v1:secret', key),
      /format changed/
    );
    assert.throws(
      () =>
        decryptMacGrokValue(Buffer.from('v11-invalid').toString('base64'), key),
      /format changed/
    );
  } finally {
    key.fill(0);
    await rm(dir, { recursive: true, force: true });
  }
});

test('Windows Grok decryption still authenticates its original GCM format', () => {
  const key = Buffer.alloc(32, 7);
  const nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([
    Buffer.from('v10'),
    nonce,
    cipher.update('fixture-windows-token'),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  assert.equal(
    decryptWindowsGrokValue(encrypted.toString('base64'), key),
    'fixture-windows-token'
  );
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() =>
    decryptWindowsGrokValue(encrypted.toString('base64'), key)
  );
});

test('Keychain denial pauses automatic retries until an explicit refresh', async () => {
  let calls = 0;
  const service = new UsageService({
    sources: {
      grok: {
        readActive: async () => {
          calls++;
          throw new GrokKeychainUnavailable();
        },
        readAccount: async () => {
          throw new Error('unused');
        }
      }
    },
    registry: { load: async () => emptyRegistry(), save: async () => {} },
    lastReadings: new LastReadings(
      path.join(tmpdir(), 'ai-usage-unused', 'last-readings.json')
    )
  });
  const settings = { grokConnected: true };
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
    await service.get('grok', { grokConnected: false }, true);
    assert.equal(calls, 2);
  } finally {
    Date.now = originalNow;
  }
});

test(
  'native macOS executable discovery rejects directories and non-executable files',
  { skip: process.platform !== 'darwin' },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-executable-'));
    const file = path.join(dir, 'codex');
    try {
      assert.equal(await isExecutableFile(dir), false);
      await writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
      assert.equal(await isExecutableFile(file), false);
      await chmod(file, 0o700);
      assert.equal(await isExecutableFile(file), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test('Claude Desktop discovery is absent on hosts without a supported desktop app', async () => {
  assert.equal(
    await findClaudeHistory({ ...macHost('/home/example'), platform: 'linux' }),
    undefined
  );
});
