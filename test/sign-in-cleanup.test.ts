import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Registry } from '../src/accounts.js';

async function fixture(
  options: { failSave?: boolean; unsafeOldHome?: boolean } = {}
) {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-usage-sign-in-cleanup-'));
  const home = options.unsafeOldHome
    ? path.join(root, 'unmanaged')
    : path.join(
        root,
        'accounts',
        'openai',
        '11111111-1111-4111-8111-111111111111'
      );
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, 'fixture.txt'), 'old');
  const saved: { registry: Registry; messages: any[]; newHome?: string } = {
    registry: {
      version: 1,
      accounts: [
        {
          id: 'openai-fixture',
          provider: 'openai',
          key: 'fixture',
          name: 'Fixture',
          nick: 'ONE',
          home,
          addedAt: 1
        }
      ]
    },
    messages: []
  };
  const fixture = {
    state: { visible: new Map(), signInSession: undefined },
    registryApi: {
      load: async () => structuredClone(saved.registry),
      save: async (next: Registry) => {
        if (options.failSave) throw new Error('Synthetic storage rejection');
        saved.registry = structuredClone(next);
      }
    },
    sources: {
      openai: {
        activeKey: async () => undefined,
        startSignIn: async (_: unknown, newHome: string) => {
          saved.newHome = newHome;
          await writeFile(path.join(newHome, 'fixture.txt'), 'new');
          return {
            kind: 'code',
            url: 'https://auth.openai.com/',
            code: 'FIXTURE',
            cancel() {},
            done: Promise.resolve({ key: 'fixture', label: 'Fixture' })
          };
        }
      }
    },
    send: async (payload: any) => {
      saved.messages.push(payload);
    }
  };
  const stubs: Record<string, string> = {
    './state.js': 'export const state=globalThis.fixture.state;',
    '../sources.js': 'export const sources=globalThis.fixture.sources;',
    './store.js':
      'export const registryApi=globalThis.fixture.registryApi; export const lastReadings={get:async()=>undefined,delete:async()=>{}}; export const usage={clear(){}};',
    './bridge.js': 'export const sendToPi=globalThis.fixture.send;',
    './keys.js':
      'export async function repaintProvider(){} export async function refresh(){}',
    '@elgato/streamdeck': 'export default {system:{openUrl:async()=>{}}};'
  };
  const bundle = await build({
    entryPoints: ['src/runtime/account-actions.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'synthetic-provider-and-host',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            a.path in stubs ? { path: a.path, namespace: 'fixture' } : undefined
          );
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
            contents: stubs[a.path],
            loader: 'js'
          }));
        }
      }
    ]
  });
  const module = { exports: {} as any };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    fixture,
    process: { env: { AI_USAGE_DATA_DIR: root } },
    setTimeout
  });
  return {
    root,
    home,
    saved,
    add: () =>
      module.exports.handleAddAccount({ provider: 'openai', settings: {} }),
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

test('repeat sign-in deletes the former managed credentials only after storing the replacement', async () => {
  const f = await fixture();
  try {
    await f.add();
    assert.equal(f.saved.registry.accounts.length, 1);
    assert.equal(f.saved.registry.accounts[0].home, f.saved.newHome);
    assert.equal(
      await readFile(path.join(f.saved.newHome!, 'fixture.txt'), 'utf8'),
      'new'
    );
    await assert.rejects(readFile(path.join(f.home, 'fixture.txt')), {
      code: 'ENOENT'
    });
    assert.equal(f.saved.registry.accounts[0].retiredHomes?.length, 0);
    assert.equal(
      f.saved.messages.some((m) => !!m.signInDone),
      true
    );
  } finally {
    await f.cleanup();
  }
});

test('failed replacement save preserves old credentials, removes the failed new home and reports failure', async () => {
  const f = await fixture({ failSave: true });
  try {
    await f.add();
    assert.equal(f.saved.registry.accounts[0].home, f.home);
    assert.equal(
      await readFile(path.join(f.home, 'fixture.txt'), 'utf8'),
      'old'
    );
    await assert.rejects(readFile(path.join(f.saved.newHome!, 'fixture.txt')), {
      code: 'ENOENT'
    });
    assert.equal(
      f.saved.messages.some((m) => !!m.signInDone),
      false
    );
    assert.equal(
      f.saved.messages.some((m) => !!m.signInFailed),
      true
    );
  } finally {
    await f.cleanup();
  }
});

test('unsafe former homes stay untouched and tracked while the successful new sign-in remains usable', async () => {
  const f = await fixture({ unsafeOldHome: true });
  try {
    await f.add();
    assert.equal(
      await readFile(path.join(f.home, 'fixture.txt'), 'utf8'),
      'old'
    );
    assert.equal(
      await readFile(path.join(f.saved.newHome!, 'fixture.txt'), 'utf8'),
      'new'
    );
    assert.equal(f.saved.registry.accounts[0].retiredHomes?.[0], f.home);
    assert.equal(
      f.saved.messages.some((m) =>
        /old sign-in files could not be removed/.test(m.accountError || '')
      ),
      true
    );
    assert.equal(
      (await readdir(path.join(f.root, 'accounts', 'openai'))).length,
      1
    );
  } finally {
    await f.cleanup();
  }
});
