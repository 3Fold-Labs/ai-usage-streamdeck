import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  writeFile,
  stat,
  rm,
  readdir
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  APP_MANAGED,
  APP_NAMES,
  CAN_PIN,
  AccountRemovalBlocked,
  defaultNick,
  emptyRegistry,
  removeAccount,
  renameAccount,
  resolveKeyAccount,
  sanitizeNick,
  upsertIdentity,
  type Registry
} from '../src/accounts.js';
import { LastReadings, defaultLastReadingsFile } from '../src/last-readings.js';
import type { Snapshot } from '../src/model.js';

const valid = /^[A-Z0-9]{1,5}$/;
const registryWith = (
  ...entries: [Parameters<typeof upsertIdentity>[1], string, string][]
) =>
  entries.reduce(
    (reg, [provider, key, label]) =>
      upsertIdentity(reg, provider, { key, label }, undefined, 1000).registry,
    emptyRegistry()
  );

test('nicknames are uppercase letters and numbers, at most five', () => {
  assert.equal(sanitizeNick('c2'), 'C2');
  assert.equal(sanitizeNick(' 3f '), '3F');
  assert.equal(sanitizeNick('<x>'), 'X');
  assert.equal(sanitizeNick('crgpt'), 'CRGPT');
  assert.equal(sanitizeNick('toolong'), 'TOOLO');
  for (const value of ['', '!!', '  ', '<>'])
    assert.equal(sanitizeNick(value), '');
});

test('default nicknames come from the account name and avoid collisions', () => {
  assert.equal(defaultNick('admin@example.invalid', []), 'AD');
  assert.equal(defaultNick('admin@example.invalid', ['AD']), 'AD2');
  assert.equal(defaultNick('admin@example.invalid', ['ad', 'AD2']), 'AD3');
  assert.equal(defaultNick('john.doe@example.com', []), 'JD');
  assert.equal(defaultNick('Claude subscription 2', []), 'CS');
  assert.equal(defaultNick('q', []), 'Q');
  const taken = [
    'AD',
    ...Array.from({ length: 150 }, (_, i) => `AD${i + 2}`.slice(-4))
  ];
  for (const label of ['@@@', '', '...', 'éé', 'admin@example.invalid'])
    assert.match(defaultNick(label, taken), valid);
  assert.ok(!taken.includes(defaultNick('admin@example.invalid', taken)));
});

test('identities are registered once per provider and matched without case', () => {
  const empty = emptyRegistry();
  const first = upsertIdentity(
    empty,
    'supergrok',
    { key: 'admin@example.invalid', label: 'admin@example.invalid' },
    { home: '/data/accounts/supergrok/a1' },
    1234
  );
  assert.equal(first.added, true);
  assert.deepEqual(empty, { version: 1, accounts: [] });
  assert.match(first.record.id, /^supergrok-[0-9a-f]{8}$/);
  assert.deepEqual(
    { ...first.record, id: '' },
    {
      id: '',
      provider: 'supergrok',
      key: 'admin@example.invalid',
      nick: 'AD',
      name: 'admin@example.invalid',
      home: '/data/accounts/supergrok/a1',
      addedAt: 1234
    }
  );
  const again = upsertIdentity(first.registry, 'supergrok', {
    key: 'ADMIN@example.invalid',
    label: 'Someone else'
  });
  assert.equal(again.added, false);
  assert.equal(again.registry.accounts.length, 1);
  assert.deepEqual(again.record, first.record);
  const second = upsertIdentity(again.registry, 'supergrok', {
    key: 'adam@example.com',
    label: 'adam@example.com'
  });
  assert.equal(second.record.nick, 'AD2');
  assert.equal(second.record.home, undefined);
  assert.equal(Object.hasOwn(second.record, 'home'), false);
  assert.notEqual(second.record.id, first.record.id);
  const other = upsertIdentity(second.registry, 'grok', {
    key: 'admin@example.invalid',
    label: 'admin@example.invalid'
  });
  assert.equal(other.added, true);
  assert.equal(other.record.nick, 'AD');
  assert.equal(other.registry.accounts.length, 3);
  assert.equal(second.registry.accounts.length, 2);
});

test('renaming validates the nickname and keeps the old name when blank', () => {
  const reg = registryWith(['anthropic', 'org-1', 'Claude subscription 1']);
  const id = reg.accounts[0].id;
  const renamed = renameAccount(reg, id, 'wk', '  Work  ');
  assert.deepEqual(
    [renamed.accounts[0].nick, renamed.accounts[0].name],
    ['WK', 'Work']
  );
  assert.equal(reg.accounts[0].nick, 'CS');
  assert.equal(
    renameAccount(renamed, id, 'c1', '   ').accounts[0].name,
    'Work'
  );
  for (const nick of ['!!!', undefined, null, 123] as unknown as string[])
    assert.throws(
      () => renameAccount(reg, id, nick, 'Work'),
      /^Error: Nickname must be 1 to 5 letters or numbers\.$/
    );
});

test('removal is blocked for app-managed and signed-in accounts', () => {
  const reg = registryWith(
    ['grok', 'smfixture@example.invalid', 'smfixture@example.invalid'],
    ['cursor', 'smfixture@example.invalid', 'smfixture@example.invalid'],
    ['openai', 'one@example.com', 'one@example.com'],
    ['supergrok', 'admin@example.invalid', 'admin@example.invalid'],
    ['anthropic', 'org-2', 'Claude subscription 2']
  );
  const [grok, cursor, openai, supergrok, claude] = reg.accounts;
  const blocked = (id: string, message: string, activeKey?: string) =>
    assert.throws(
      () => removeAccount(reg, id, activeKey),
      (error: unknown) =>
        error instanceof AccountRemovalBlocked && error.message === message
    );
  blocked(
    grok.id,
    'Grok Bot manages this account. Remove it inside Grok Bot and it disappears here.'
  );
  blocked(grok.id, APP_MANAGED.grok!, 'other@example.com');
  blocked(
    cursor.id,
    'Cursor manages its sign-in. Sign out inside Cursor to remove it.'
  );
  blocked(
    openai.id,
    'Codex is signed into this account right now. Switch it to another account first.',
    'ONE@example.com'
  );
  blocked(
    supergrok.id,
    'The Grok CLI is signed into this account right now. Switch it to another account first.',
    'admin@example.invalid'
  );
  blocked(
    claude.id,
    'Claude is signed into this account right now. Switch it to another account first.',
    'org-2'
  );
  const { registry, removed } = removeAccount(
    reg,
    openai.id,
    'two@example.com'
  );
  assert.deepEqual(removed, openai);
  assert.equal(registry.accounts.length, 4);
  assert.ok(!registry.accounts.some((account) => account.id === openai.id));
  assert.equal(reg.accounts.length, 5);
  assert.equal(removeAccount(reg, claude.id).removed.id, claude.id);
  assert.throws(
    () => removeAccount(registry, openai.id),
    (error: unknown) => !(error instanceof AccountRemovalBlocked)
  );
  assert.equal(APP_NAMES.supergrok, 'The Grok CLI');
});

test('keys follow the app unless they name a pinnable account of the same provider', () => {
  const reg = registryWith(
    ['anthropic', 'org-1', 'Claude subscription 1'],
    ['openai', 'one@example.com', 'one@example.com'],
    ['cursor', 'smfixture@example.invalid', 'smfixture@example.invalid']
  );
  const [claude, openai, cursor] = reg.accounts;
  for (const setting of [
    undefined,
    '',
    'follow',
    'anthropic-00000000',
    openai.id
  ])
    assert.deepEqual(resolveKeyAccount(reg, 'anthropic', setting), {
      mode: 'follow'
    });
  assert.deepEqual(resolveKeyAccount(reg, 'anthropic', claude.id), {
    mode: 'pinned',
    record: claude
  });
  assert.equal(CAN_PIN.cursor, false);
  assert.deepEqual(resolveKeyAccount(reg, 'cursor', cursor.id), {
    mode: 'follow'
  });
  assert.deepEqual(resolveKeyAccount(emptyRegistry(), 'openai', openai.id), {
    mode: 'follow'
  });
});

test('last readings round trip privately and strip errors and idle flags', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-readings-'));
  const file = path.join(dir, 'nested', 'last-readings.json');
  const reading: Snapshot = {
    observedAt: 1000,
    weekly: { used: 64, minutes: 10080, resetsAt: 2000 },
    source: 'Claude Desktop',
    account: { key: 'org-2', label: 'Claude subscription 2' },
    error: 'idle',
    idle: true
  };
  try {
    const store = new LastReadings(file);
    assert.equal(await store.get('anthropic', 'org-2'), undefined);
    await store.set('anthropic', 'org-2', reading);
    await store.set('openai', 'org-2', {
      observedAt: 5,
      short: { used: 1, minutes: 300 }
    });
    await store.set('anthropic', '__proto__', { observedAt: 7 });
    const expected = {
      observedAt: 1000,
      weekly: { used: 64, minutes: 10080, resetsAt: 2000 },
      source: 'Claude Desktop',
      account: { key: 'org-2', label: 'Claude subscription 2' }
    };
    assert.deepEqual(await store.get('anthropic', 'org-2'), expected);
    const reopened = new LastReadings(file);
    assert.deepEqual(await reopened.get('anthropic', 'org-2'), expected);
    assert.equal((await reopened.get('openai', 'org-2'))?.short?.used, 1);
    assert.equal((await reopened.get('anthropic', '__proto__'))?.observedAt, 7);
    assert.equal(await reopened.get('grok', 'org-2'), undefined);
    assert.doesNotMatch(await readFile(file, 'utf8'), /idle|"error"/);
    if (process.platform !== 'win32')
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(
      (await readdir(path.dirname(file))).filter(
        (name) => name !== 'last-readings.json'
      ),
      []
    );
    await reopened.delete('anthropic', 'org-2');
    assert.equal(await store.get('anthropic', 'org-2'), undefined);
    assert.equal((await store.get('openai', 'org-2'))?.observedAt, 5);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.set('grok', `k${i}`, { observedAt: i + 1 })
      )
    );
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await new LastReadings(file).get('grok', `k${i}`))?.observedAt,
        i + 1
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('last readings survive missing, corrupt and oversized files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-readings-'));
  const file = path.join(dir, 'last-readings.json');
  try {
    const store = new LastReadings(file);
    await writeFile(file, '{not json');
    assert.equal(await store.get('anthropic', 'org-1'), undefined);
    await store.set('anthropic', 'org-1', { observedAt: 9 });
    assert.equal((await store.get('anthropic', 'org-1'))?.observedAt, 9);
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        readings: {
          'anthropic:org-1': 'broken',
          'anthropic:org-2': { observedAt: 'soon' }
        }
      })
    );
    assert.equal(await store.get('anthropic', 'org-1'), undefined);
    assert.equal(await store.get('anthropic', 'org-2'), undefined);
    await writeFile(file, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
    assert.equal(await store.get('anthropic', 'org-1'), undefined);
    await assert.doesNotReject(store.delete('anthropic', 'org-1'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('last readings live beside the other deck data', () => {
  const previous = process.env.AI_USAGE_DATA_DIR;
  try {
    process.env.AI_USAGE_DATA_DIR = path.join(tmpdir(), 'ai-usage-data');
    assert.equal(
      defaultLastReadingsFile(),
      path.join(tmpdir(), 'ai-usage-data', 'last-readings.json')
    );
  } finally {
    if (previous === undefined) delete process.env.AI_USAGE_DATA_DIR;
    else process.env.AI_USAGE_DATA_DIR = previous;
  }
});

test('registries are plain data', () => {
  const reg: Registry = registryWith([
    'openai',
    'one@example.com',
    'one@example.com'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(reg)), reg);
});

test('dedupeRegistry keeps one row per provider and key', async () => {
  const { dedupeRegistry } = await import('../src/accounts.js');
  const reg = {
    version: 1 as const,
    accounts: [
      {
        id: 'anthropic-aaaa',
        provider: 'anthropic' as const,
        key: 'ORG-1',
        nick: 'C1',
        name: 'First',
        addedAt: 1
      },
      {
        id: 'anthropic-bbbb',
        provider: 'anthropic' as const,
        key: 'org-1',
        nick: 'C2',
        name: 'Duplicate',
        addedAt: 2
      },
      {
        id: 'anthropic-cccc',
        provider: 'anthropic' as const,
        key: 'ORG-2',
        nick: 'C3',
        name: 'Other',
        addedAt: 3
      }
    ]
  };
  const next = dedupeRegistry(reg);
  assert.equal(next.accounts.length, 2);
  assert.equal(next.accounts[0].id, 'anthropic-aaaa');
  assert.equal(next.accounts[0].nick, 'C1');
  assert.equal(next.accounts[1].key, 'ORG-2');
});

test('an explicitly cleared nickname survives identity refresh and registry serialization', () => {
  for (const provider of [
    'openai',
    'anthropic',
    'grok',
    'supergrok',
    'cursor'
  ] as const) {
    const reg = registryWith([provider, 'fixture-identity', 'Fixture account']);
    for (const nick of ['', '   ']) {
      const cleared = renameAccount(reg, reg.accounts[0].id, nick, '');
      assert.equal(cleared.accounts[0].nick, '');
      assert.equal(cleared.accounts[0].name, 'Fixture account');
      const restored = JSON.parse(JSON.stringify(cleared));
      const refresh = upsertIdentity(
        restored,
        provider,
        { key: 'fixture-identity', label: 'Provider name' },
        { home: '/fixture/new-sign-in' }
      );
      assert.equal(refresh.added, false);
      assert.equal(refresh.record.nick, '');
      assert.equal(refresh.record.name, 'Fixture account');
    }
  }
});
