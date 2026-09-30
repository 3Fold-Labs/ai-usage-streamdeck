import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clearManagedHome } from '../src/managed-homes.js';
import { emptyRegistry, upsertIdentity } from '../src/accounts.js';

test('cleanup rejects outside paths, parent directories and symlinked ancestors; nested links never delete their targets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-usage-cleanup-'));
  const base = path.join(root, 'managed');
  const outside = path.join(root, 'outside');
  const home = path.join(
    base,
    'accounts',
    'openai',
    '11111111-1111-4111-8111-111111111111'
  );
  const previous = process.env.AI_USAGE_DATA_DIR;
  process.env.AI_USAGE_DATA_DIR = base;
  try {
    await mkdir(home, { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'keep');
    for (const unsafe of [
      outside,
      base,
      path.dirname(home),
      path.join(base, 'accounts'),
      path.join(home, 'child'),
      'relative/path'
    ])
      await assert.rejects(clearManagedHome(unsafe), /location is unsafe/);
    await symlink(
      outside,
      path.join(home, 'external'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await clearManagedHome(home);
    assert.equal(
      await readFile(path.join(outside, 'keep.txt'), 'utf8'),
      'keep'
    );
    await clearManagedHome(home); // Repeated cleanup after a successful deletion is safe.
    await symlink(
      outside,
      home,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await assert.rejects(clearManagedHome(home), /location is unsafe/);
    await rm(home);
    await rm(path.dirname(home), { recursive: true });
    await symlink(
      outside,
      path.dirname(home),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await assert.rejects(clearManagedHome(home), /location is unsafe/);
    assert.equal(
      await readFile(path.join(outside, 'keep.txt'), 'utf8'),
      'keep'
    );
  } finally {
    if (previous === undefined) delete process.env.AI_USAGE_DATA_DIR;
    else process.env.AI_USAGE_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('repeat sign-in tracks superseded homes durably without retiring the active home', () => {
  const identity = { key: 'fixture', label: 'Fixture' };
  const first = upsertIdentity(emptyRegistry(), 'openai', identity, {
    home: '/synthetic/one'
  });
  const second = upsertIdentity(first.registry, 'openai', identity, {
    home: '/synthetic/two'
  });
  assert.deepEqual(second.record.retiredHomes, ['/synthetic/one']);
  const third = upsertIdentity(second.registry, 'openai', identity, {
    home: '/synthetic/three'
  });
  assert.deepEqual(third.record.retiredHomes, [
    '/synthetic/one',
    '/synthetic/two'
  ]);
  assert.equal(third.record.home, '/synthetic/three');
  const unchanged = upsertIdentity(third.registry, 'openai', identity);
  assert.deepEqual(unchanged.record.retiredHomes, third.record.retiredHomes);
  const reused = upsertIdentity(third.registry, 'openai', identity, {
    home: '/synthetic/one'
  });
  assert.deepEqual(reused.record.retiredHomes, [
    '/synthetic/two',
    '/synthetic/three'
  ]);
});
