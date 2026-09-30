import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { openDeck, appear, openPi, type DeckMessage } from './helpers/deck.js';
import { renderButton } from '../src/render.js';
import { openInspector } from './helpers/inspector.js';
const action = 'com.3foldlabs.ai-usage.anthropic-short';
const svg = (m: DeckMessage) =>
  m.event === 'setImage'
    ? Buffer.from(m.payload.image.split(',')[1], 'base64').toString()
    : '';
test(
  'multiple keys and accounts retain colors, pinning and shared palettes through restart',
  { timeout: 20000 },
  async () => {
    let saved: Record<string, unknown> = {};
    for (const restarted of [false, true]) {
      const d = await openDeck(saved);
      try {
        await d.waitFor((m) => m.event === 'registerPlugin');
        for (const [context, org, used, color] of [
          ['first', '11111111-1111-4111-8111-111111111111', 42, '#123ABC'],
          ['second', '22222222-2222-4222-8222-222222222222', 71, '#456DEF']
        ] as const) {
          const file = path.join(d.dir, context + '.json');
          await writeFile(
            file,
            JSON.stringify({
              observedAt: Date.now(),
              account: { org, name: context },
              rate_limits: { five_hour: { used_percentage: used } }
            })
          );
          await mkdir(path.join(d.dir, 'claude-accounts'), { recursive: true });
          await copyFile(
            file,
            path.join(d.dir, 'claude-accounts', org + '.json')
          );
          const existing = (saved.accounts as any)?.accounts.find(
            (a: any) => a.key === org
          );
          d.send(
            appear(action, context, {
              claudeFile: file,
              barColor: color,
              keyColor: '#202020',
              account: existing?.id || 'follow'
            })
          );
          const rendered = await d.waitFor(
            (m) => m.context === context && svg(m).includes('>' + used + '%<')
          );
          assert.ok(svg(rendered).includes(color));
        }
        d.send(openPi(action, 'first'));
        d.send({
          event: 'sendToPlugin',
          action,
          context: 'first',
          payload: { accounts: true }
        });
        const list = await d.waitFor(
          (m) => m.payload?.accountList?.accounts.length === 2
        );
        assert.equal(list.payload.accountList.canPin, true);
        assert.equal(list.payload.accountList.canAdd, true);
        if (restarted)
          assert.deepEqual((d.global.palettes as any).bar, ['#123ABC']);
        d.send({
          event: 'sendToPlugin',
          action,
          context: 'first',
          payload: { palettes: { bar: ['#123ABC'], key: ['#202020'] } }
        });
        await d.waitFor(
          (m) =>
            m.event === 'setGlobalSettings' &&
            m.payload?.palettes?.bar?.includes('#123ABC')
        );
        saved = JSON.parse(JSON.stringify(d.global));
        assert.equal((saved.accounts as any).accounts.length, 2);
      } finally {
        await d.close();
      }
    }
  }
);
test('Claude is descriptive text on every display palette and state, with no logo or halo', () => {
  for (const keyColor of ['#11171D', '#FFFFFF', '#FF00FF'])
    for (const reset of [false, true]) {
      const text = renderButton('anthropic', 'short', undefined, {
        keyColor,
        reset
      });
      assert.match(
        text,
        /<text[^>]+font-family="Arial, sans-serif"[^>]*>Claude<\/text>/
      );
      assert.doesNotMatch(text, /<image|<path|data:image/);
    }
});
test('the inspector exposes account management and custom colors without an upgrade flow', async () => {
  const pi = await openInspector(action);
  pi.receive({
    accountList: {
      provider: 'anthropic',
      canPin: true,
      canAdd: true,
      accounts: []
    }
  });
  assert.equal(pi.byId('addAccount').hidden, false);
  pi.byId('barWell').fire('click');
  assert.match(pi.byId('sheet').innerHTML, /Custom|color/i);
  assert.doesNotMatch(pi.byId('sheet').innerHTML, /upgrade|\bPro\b|\bLite\b/);
});
