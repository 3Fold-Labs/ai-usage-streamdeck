import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openInspector } from './helpers/inspector.js';
import { openDeck, appear, openPi, type DeckMessage } from './helpers/deck.js';

const org = '11111111-1111-4111-8111-111111111111';
const id = 'anthropic-nickname1';
const record = {
  id,
  provider: 'anthropic',
  key: org,
  nick: 'OLD',
  name: 'Fixture account',
  addedAt: 1
};
const list = (nick: string) => ({
  provider: 'anthropic',
  canPin: true,
  canAdd: true,
  activeKey: org,
  accounts: [{ ...record, nick }]
});
const svg = (m: DeckMessage) =>
  m.event === 'setImage'
    ? Buffer.from(m.payload.image.split(',')[1], 'base64').toString()
    : '';

for (const mode of ['follow', 'pinned'] as const) {
  const action = `com.3foldlabs.ai-usage.anthropic-weekly`;
  test(`${mode}: Manage Save updates the main nickname despite old key settings, including reopening`, async () => {
    const settings = {
      account: mode === 'follow' ? 'follow' : id,
      nickname: 'STALE'
    };
    const pi = await openInspector(action, settings);
    pi.receive({ accountList: list('OLD') });
    pi.byId('manage').fire('click');
    pi.byId('edit-' + id).fire('click');
    pi.byId('editNick').value = 'NEW';
    pi.byId('editName').value = 'Renamed account';
    pi.byId('saveEdit').fire('click');
    assert.deepEqual(
      pi
        .sent()
        .reverse()
        .find((m) => m.payload?.rename)?.payload.rename,
      { id, nick: 'NEW', name: 'Renamed account' }
    );
    pi.receive({ accountList: list('NEW') });
    assert.equal(pi.byId('nick').value, 'NEW');
    pi.receiveSettings(settings); // Stream Deck can echo old per-key settings after a global rename.
    assert.equal(pi.byId('nick').value, 'NEW');
    const reopened = await openInspector(action, settings);
    reopened.receive({ accountList: list('NEW') });
    assert.equal(reopened.byId('nick').value, 'NEW');
  });

  test(
    `${mode}: built runtime renames the displayed key and survives hide/reappear with legacy nickname`,
    { timeout: 20000 },
    async () => {
      const deck = await openDeck({
        accounts: { version: 1, accounts: [record] }
      });
      try {
        const file = path.join(deck.dir, 'usage.json');
        await writeFile(
          file,
          JSON.stringify({
            observedAt: Date.now(),
            account: { org, name: 'Fixture account' },
            rate_limits: { seven_day: { used_percentage: 42 } }
          })
        );
        const settings = { claudeFile: file, nickname: 'STALE' };
        await deck.waitFor((m) => m.event === 'registerPlugin');
        deck.send(appear(action, 'owner', settings));
        await deck.waitFor(
          (m) => m.context === 'owner' && svg(m).includes('>42%<')
        );
        deck.send(openPi(action, 'owner'));
        const start = deck.messages.length;
        deck.send({
          event: 'sendToPlugin',
          action,
          context: 'owner',
          payload: { rename: { id, nick: 'NEW', name: 'Renamed account' } }
        });
        const image = await deck.waitFor(
          (m) =>
            deck.messages.indexOf(m) >= start &&
            m.context === 'owner' &&
            svg(m).includes('>NEW</text>')
        );
        assert.doesNotMatch(svg(image), />STALE<\/text>/);
        const accounts = await deck.waitFor(
          (m) =>
            deck.messages.indexOf(m) >= start &&
            m.payload?.accountList?.accounts.some(
              (a: any) => a.id === id && a.nick === 'NEW'
            )
        );
        assert.equal(
          accounts.payload.accountList.accounts.find((a: any) => a.id === id)
            .name,
          'Renamed account'
        );
        const clearing = deck.messages.length;
        deck.send({
          event: 'sendToPlugin',
          action,
          context: 'owner',
          payload: { rename: { id, nick: '', name: 'Renamed account' } }
        });
        await deck.waitFor(
          (m) =>
            deck.messages.indexOf(m) >= clearing &&
            m.context === 'owner' &&
            svg(m).includes('>42%<') &&
            !/>NEW<\/text>|>STALE<\/text>/.test(svg(m))
        );
        await deck.waitFor(
          (m) =>
            deck.messages.indexOf(m) >= clearing &&
            m.payload?.accountList?.accounts.some(
              (a: any) => a.id === id && a.nick === ''
            )
        );
        deck.send({
          event: 'willDisappear',
          action,
          context: 'owner',
          device: 'test-device',
          payload: { settings }
        });
        const reappear = deck.messages.length;
        deck.send(appear(action, 'owner', settings));
        await deck.waitFor(
          (m) =>
            deck.messages.indexOf(m) >= reappear &&
            m.context === 'owner' &&
            !/>NEW<\/text>|>STALE<\/text>/.test(svg(m)) &&
            svg(m).includes('>42%<')
        );
      } finally {
        await deck.close();
      }
    }
  );
}

test('selecting newly added accounts populates their own nicknames without copying them into key settings', async () => {
  const pi = await openInspector('com.3foldlabs.ai-usage.anthropic-weekly');
  pi.receive({ accountList: list('FIRST') });
  pi.byId('display').value = 'remaining';
  pi.byId('display').fire('change');
  assert.equal(pi.saved().at(-1).nickname, undefined);
  pi.receive({
    accountList: {
      ...list('FIRST'),
      accounts: [
        { ...record, nick: 'FIRST' },
        { ...record, id: 'anthropic-second', key: 'second', nick: 'NEW2' }
      ]
    }
  });
  pi.byId('account').value = 'anthropic-second';
  pi.byId('account').fire('change');
  assert.equal(pi.byId('nick').value, 'NEW2');
  assert.equal(pi.saved().at(-1).nickname, undefined);
  pi.byId('account').value = 'follow';
  pi.byId('account').fire('change');
  assert.equal(pi.byId('nick').value, 'FIRST');
});

test('main nickname Save renames the account; unregistered keys retain their local nickname', async () => {
  const pi = await openInspector('com.3foldlabs.ai-usage.anthropic-weekly');
  pi.receive({ accountList: list('OLD') });
  pi.byId('nick').value = 'new';
  pi.byId('saveNick').fire('click');
  assert.equal(
    pi
      .sent()
      .reverse()
      .find((m) => m.payload?.rename)?.payload.rename.nick,
    'NEW'
  );
  assert.equal(pi.saved().length, 0);
  pi.receive({ accountList: list('NEW') });
  assert.equal(pi.byId('nick').value, 'NEW');
  assert.match(pi.byId('status').textContent, /saved for this account/);
  pi.byId('nick').value = '';
  pi.byId('saveNick').fire('click');
  assert.equal(
    pi
      .sent()
      .reverse()
      .find((m) => m.payload?.rename)?.payload.rename.nick,
    ''
  );
  pi.receive({ accountList: list('') });
  assert.equal(pi.byId('nick').value, '');
  assert.match(pi.byId('status').textContent, /hidden for this account/);
  const standalone = await openInspector(
    'com.3foldlabs.ai-usage.anthropic-weekly'
  );
  standalone.byId('nick').value = 'local';
  standalone.byId('saveNick').fire('click');
  assert.equal(standalone.saved().at(-1).nickname, 'LOCAL');
});

test('SuperGrok sign-in tells the user to confirm in xAI and closes only after provider completion', async () => {
  const pi = await openInspector('com.3foldlabs.ai-usage.supergrok-weekly');
  pi.receive({
    signIn: {
      kind: 'code',
      url: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH',
      code: 'ABCD-EFGH'
    }
  });
  assert.match(pi.byId('sheet').innerHTML, /code should already be filled in/);
  assert.match(pi.byId('sheet').innerHTML, /click Continue/);
  assert.match(pi.byId('sheet').innerHTML, /nothing to paste into Stream Deck/);
  assert.doesNotMatch(pi.byId('sheet').innerHTML, /<input/);
  assert.equal(
    pi.sent().some((m) => m.payload?.accounts === true),
    true
  );
  const before = pi.sent().length;
  pi.byId('openSignIn').fire('click');
  assert.equal(
    pi
      .sent()
      .slice(before)
      .some(
        (m) =>
          m.payload?.openUrl ===
          'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH'
      ),
    true
  );
  pi.receive({ signInDone: { nick: 'GROK', name: 'Fixture account' } });
  assert.match(pi.byId('status').textContent, /Added GROK/);
  assert.equal(pi.byId('sheet').innerHTML, '');
});

for (const mode of ['follow', 'pinned'] as const) {
  for (const view of ['main', 'manage'] as const) {
    test(`${mode}: ChatGPT ${view} saves no nickname and stale settings cannot restore it`, async () => {
      const account = {
        ...record,
        provider: 'openai',
        id: 'openai-fixture',
        key: 'fixture-openai',
        nick: 'GPT'
      };
      const settings = {
        account: mode === 'follow' ? 'follow' : account.id,
        nickname: 'STALE'
      };
      const action = `com.3foldlabs.ai-usage.openai-short`;
      const accounts = (nick: string) => ({
        provider: 'openai',
        canPin: true,
        activeKey: account.key,
        accounts: [{ ...account, nick }]
      });
      const pi = await openInspector(action, settings);
      pi.receive({ accountList: accounts('GPT') });
      if (view === 'manage') {
        pi.byId('manage').fire('click');
        pi.byId('edit-' + account.id).fire('click');
        pi.byId('editNick').value = '';
        pi.byId('editName').value = account.name;
        pi.byId('saveEdit').fire('click');
      } else {
        pi.byId('nick').value = '';
        pi.byId('saveNick').fire('click');
      }
      assert.equal(
        pi
          .sent()
          .reverse()
          .find((m) => m.payload?.rename)?.payload.rename.nick,
        ''
      );
      pi.receive({ accountList: accounts('') });
      assert.equal(pi.byId('nick').value, '');
      pi.receiveSettings(settings);
      assert.equal(pi.byId('nick').value, '');
      const reopened = await openInspector(action, settings);
      reopened.receive({ accountList: accounts('') });
      assert.equal(reopened.byId('nick').value, '');
      assert.match(
        reopened.byId('nickHelp').textContent,
        /Leave blank to hide/
      );
    });
  }
}

test(
  'built ChatGPT runtime retains a cleared nickname after process restart with stale key settings',
  { timeout: 20000 },
  async () => {
    const action = 'com.3foldlabs.ai-usage.openai-short';
    const account = {
      ...record,
      provider: 'openai',
      id: 'openai-fixture',
      key: 'fixture-openai',
      nick: 'GPT'
    };
    const settings = {
      account: account.id,
      nickname: 'STALE',
      disconnected: true,
      codexPath: 'fixture-no-executable'
    };
    const deck = await openDeck({
      accounts: { version: 1, accounts: [account] }
    });
    let saved: Record<string, unknown>;
    try {
      await deck.waitFor((m) => m.event === 'registerPlugin');
      deck.send(appear(action, 'owner', settings));
      await deck.waitFor(
        (m) => m.context === 'owner' && svg(m).includes('>GPT</text>')
      );
      deck.send(openPi(action, 'owner'));
      const start = deck.messages.length;
      deck.send({
        event: 'sendToPlugin',
        action,
        context: 'owner',
        payload: { rename: { id: account.id, nick: '', name: account.name } }
      });
      await deck.waitFor(
        (m) =>
          deck.messages.indexOf(m) >= start &&
          m.payload?.accountList?.accounts.some(
            (a: any) => a.id === account.id && a.nick === ''
          )
      );
      await deck.waitFor(
        (m) =>
          deck.messages.indexOf(m) >= start &&
          m.context === 'owner' &&
          svg(m).length > 0 &&
          !/>GPT<\/text>|>STALE<\/text>/.test(svg(m))
      );
      saved = JSON.parse(JSON.stringify(deck.global));
      assert.equal((saved.accounts as any).accounts[0].nick, '');
    } finally {
      await deck.close();
    }
    const restarted = await openDeck(saved!);
    try {
      await restarted.waitFor((m) => m.event === 'registerPlugin');
      restarted.send(appear(action, 'owner', settings));
      const rendered = await restarted.waitFor(
        (m) => m.context === 'owner' && svg(m).length > 0
      );
      assert.doesNotMatch(svg(rendered), />GPT<\/text>|>STALE<\/text>/);
      restarted.send(openPi(action, 'owner'));
      restarted.send({
        event: 'sendToPlugin',
        action,
        context: 'owner',
        payload: { accounts: true }
      });
      await restarted.waitFor((m) =>
        m.payload?.accountList?.accounts.some(
          (a: any) => a.id === account.id && a.nick === ''
        )
      );
    } finally {
      await restarted.close();
    }
  }
);
