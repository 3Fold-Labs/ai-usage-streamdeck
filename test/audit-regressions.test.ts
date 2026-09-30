import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDeck, appear, openPi } from './helpers/deck.js';
import { openInspector } from './helpers/inspector.js';

const action = 'com.3foldlabs.ai-usage.openai-short';
const record = {
  id: 'openai-fixture',
  provider: 'openai',
  key: 'fixture',
  nick: 'OLD',
  name: 'Fixture',
  addedAt: 1
};
const settings = {
  disconnected: true,
  codexPath: 'fixture-no-executable',
  account: record.id
};

test(
  'packaged runtime rejects unconfirmed nickname and palette writes, retains the last saved values and can retry',
  { timeout: 20000 },
  async () => {
    const faults = { ignoreGlobalWrites: true };
    const deck = await openDeck(
      {
        accounts: { version: 1, accounts: [record] },
        palettes: { bar: ['#112233'], key: [] }
      },
      undefined,
      faults
    );
    try {
      await deck.waitFor((m) => m.event === 'registerPlugin');
      deck.send(appear(action, 'key', settings));
      await deck.waitFor((m) => m.event === 'setImage');
      deck.send(openPi(action, 'key'));
      deck.send({
        event: 'sendToPlugin',
        action,
        context: 'key',
        payload: { rename: { id: record.id, nick: 'NEW', name: record.name } }
      });
      await deck.waitFor(
        (m) => m.payload?.accountError === 'Could not rename this account.'
      );
      assert.equal((deck.global.accounts as any).accounts[0].nick, 'OLD');
      assert.equal(
        deck.messages.some((m) =>
          m.payload?.accountList?.accounts.some((a: any) => a.nick === 'NEW')
        ),
        false
      );
      deck.send({
        event: 'sendToPlugin',
        action,
        context: 'key',
        payload: { palettes: { bar: ['#AABBCC'], key: [] } }
      });
      const failed = await deck.waitFor((m) => !!m.payload?.paletteError);
      assert.deepEqual(failed.payload.palettes.bar, ['#112233']);
      assert.deepEqual((deck.global.palettes as any).bar, ['#112233']);
      faults.ignoreGlobalWrites = false;
      deck.send({
        event: 'sendToPlugin',
        action,
        context: 'key',
        payload: { rename: { id: record.id, nick: 'NEW', name: record.name } }
      });
      await deck.waitFor((m) =>
        m.payload?.accountList?.accounts.some((a: any) => a.nick === 'NEW')
      );
      assert.equal((deck.global.accounts as any).accounts[0].nick, 'NEW');
      assert.deepEqual((deck.global.palettes as any).bar, ['#112233']);
    } finally {
      await deck.close();
    }
  }
);

test('packaged inspector queues the latest startup settings and does not overwrite them with an older host echo', async () => {
  const pi = await openInspector(action, {}, { deferOpen: true });
  pi.byId('display').value = 'remaining';
  pi.byId('display').fire('change');
  pi.receiveSettings({ remaining: false });
  assert.equal(pi.byId('display').value, 'remaining');
  pi.byId('window').value = 'weekly';
  pi.byId('window').fire('change');
  pi.byId('nick').value = 'new';
  pi.byId('saveNick').fire('click');
  assert.equal(pi.saved().length, 0);
  assert.match(
    pi.byId('status').textContent,
    /Waiting for the plugin connection/
  );
  pi.connect();
  assert.equal(pi.saved().length, 1);
  assert.equal(pi.saved()[0].remaining, true);
  assert.equal(pi.saved()[0].window, 'weekly');
  assert.equal(pi.saved()[0].nickname, 'NEW');
  assert.equal(pi.sent()[0].event, 'registerPropertyInspector');
});

test('packaged inspector disables editing after disconnection and exposes failed palette saves', async () => {
  const pi = await openInspector(action);
  pi.receive({
    palettes: { bar: ['#112233'], key: [] },
    paletteError: 'Could not save the color palette. Try again.'
  });
  assert.match(pi.byId('status').textContent, /Could not save/);
  pi.disconnect();
  for (const id of ['display', 'window', 'nick', 'saveNick', 'addAccount'])
    assert.equal(pi.byId(id).disabled, true, id);
  assert.match(pi.byId('status').textContent, /Editing is disabled/);
});

test(
  'packaged account removal refuses an external folder and retains the account for correction',
  { timeout: 20000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-unsafe-home-'));
    const marker = path.join(dir, 'keep.txt');
    await writeFile(marker, 'keep');
    const deck = await openDeck({
      accounts: { version: 1, accounts: [{ ...record, home: dir }] }
    });
    try {
      await deck.waitFor((m) => m.event === 'registerPlugin');
      deck.send(appear(action, 'key', settings));
      await deck.waitFor((m) => m.event === 'setImage');
      deck.send(openPi(action, 'key'));
      deck.send({
        event: 'sendToPlugin',
        action,
        context: 'key',
        payload: { remove: { id: record.id } }
      });
      await deck.waitFor((m) =>
        /location is unsafe/.test(m.payload?.accountError || '')
      );
      assert.equal(await readFile(marker, 'utf8'), 'keep');
      assert.equal((deck.global.accounts as any).accounts.length, 1);
    } finally {
      await deck.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  'packaged account removal cleans current and retired managed folders after a restart',
  { timeout: 20000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-managed-home-'));
    const home = path.join(
      dir,
      'accounts',
      'openai',
      '11111111-1111-4111-8111-111111111111'
    );
    const retired = path.join(
      dir,
      'accounts',
      'openai',
      '22222222-2222-4222-8222-222222222222'
    );
    for (const folder of [home, retired]) {
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'fixture.txt'), 'synthetic');
    }
    const deck = await openDeck(
      {
        accounts: {
          version: 1,
          accounts: [{ ...record, home, retiredHomes: [retired] }]
        }
      },
      dir
    );
    try {
      await deck.waitFor((m) => m.event === 'registerPlugin');
      deck.send(appear(action, 'key', settings));
      await deck.waitFor((m) => m.event === 'setImage');
      deck.send(openPi(action, 'key'));
      deck.send({
        event: 'sendToPlugin',
        action,
        context: 'key',
        payload: { remove: { id: record.id } }
      });
      await deck.waitFor((m) => m.payload?.accountList?.accounts.length === 0);
      for (const folder of [home, retired])
        await assert.rejects(readFile(path.join(folder, 'fixture.txt')), {
          code: 'ENOENT'
        });
      assert.equal((deck.global.accounts as any).accounts.length, 0);
    } finally {
      await deck.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);
