import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderButton } from '../src/render.js';
import { stateOf, type Snapshot } from '../src/model.js';

const now = 1_800_000_000_000;
const snap: Snapshot = {
  observedAt: now,
  short: { used: 12, minutes: 300, resetsAt: now / 1000 + 3600 },
  weekly: { used: 64, minutes: 10080, resetsAt: now / 1000 + 86400 },
  monthly: { used: 91, minutes: 43200, resetsAt: now / 1000 + 864000 }
};
// Reviewed no-nickname renders. Claude uses plain text; other provider artwork is unchanged.
const head = {
  openai: 'e6f5f5f1c9c3f0ce80e4b21ad90299e56e479f41dcab437db63a4792118fa390',
  anthropic: '306cc728abd86976bf862939610c98eb47b3b23c47d238cd8ae74c97f7a5daa7',
  grok: '443786fdf398d7f7b240b353641e620ee71e1979f5bbbeb66ff71eec1275f8b6',
  cursor: '3952b909cf664e4a716ae55fdf9b916471b02cfd3ab6c76c5349964e19aaeb7f',
  supergrok: '34c1149fd67289a67cb74ed98a87a5c0984c4d31ea677140f0ed3f30816cd0b2'
};
const kinds = {
  openai: 'short',
  anthropic: 'weekly',
  grok: 'weekly',
  cursor: 'monthly',
  supergrok: 'weekly'
} as const;
const nickText = (nick: string) =>
  `<text x="72" y="134" text-anchor="middle" fill="#AEB8C2" font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="1.5">${nick}</text></svg>`;

test('account nicknames are drawn under the bar in uppercase', () => {
  const svg = renderButton('anthropic', 'weekly', snap, {
    now,
    nickname: 'c2'
  });
  assert.match(svg, />C2<\/text>/);
  assert.ok(svg.endsWith(nickText('C2')));
});

test('nicknames are sanitised to five letters or numbers', () => {
  const injected = renderButton('anthropic', 'weekly', snap, {
    now,
    nickname: '<x>'
  });
  assert.ok(injected.endsWith(nickText('X')));
  assert.doesNotMatch(injected, /<x>/);
  // Five-character nicknames use tighter type so they fit under the bar.
  const longNick =
    '<text x="72" y="134" text-anchor="middle" fill="#AEB8C2" font-family="Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="0.6">TOOLO</text></svg>';
  assert.ok(
    renderButton('openai', 'short', snap, {
      now,
      nickname: 'toolong'
    }).endsWith(longNick)
  );
  for (const nickname of ['', '!!', '<>'])
    assert.equal(
      renderButton('grok', 'weekly', snap, { now, nickname }),
      renderButton('grok', 'weekly', snap, { now })
    );
});

test('keys without a nickname match the reviewed renders', () => {
  for (const [provider, kind] of Object.entries(kinds) as [
    keyof typeof kinds,
    (typeof kinds)[keyof typeof kinds]
  ][]) {
    const all = (nickname?: string) =>
      [
        renderButton(provider, kind, snap, { now, nickname }),
        renderButton(provider, kind, snap, { now, remaining: true, nickname }),
        renderButton(provider, kind, snap, { now, reset: true, nickname }),
        renderButton(provider, kind, undefined, { now, nickname })
      ].join('\n');
    assert.equal(
      createHash('sha256').update(all()).digest('hex'),
      head[provider]
    );
    assert.equal(
      all(undefined),
      [
        renderButton(provider, kind, snap, { now }),
        renderButton(provider, kind, snap, { now, remaining: true }),
        renderButton(provider, kind, snap, { now, reset: true }),
        renderButton(provider, kind, undefined, { now })
      ].join('\n')
    );
    assert.doesNotMatch(all(), /y="134"/);
  }
});

test('idle readings keep their percentage past a reset with the stale dot', () => {
  const idle: Snapshot = {
    observedAt: 1,
    idle: true,
    weekly: { used: 40, minutes: 10080, resetsAt: 10 }
  };
  const state = stateOf(idle, 'weekly', 20_000);
  assert.equal(state.available, true);
  assert.equal(state.stale, true);
  assert.equal(state.expired, false);
  const svg = renderButton('anthropic', 'weekly', idle, {
    now: 20_000,
    nickname: 'C3'
  });
  assert.match(svg, />40%</);
  assert.match(svg, /<circle cx="132" cy="12" r="3" fill="#F3C16E"\/>/);
});

test('expired readings that are not idle stay unavailable', () => {
  const expired: Snapshot = {
    observedAt: 1,
    weekly: { used: 40, minutes: 10080, resetsAt: 10 }
  };
  const state = stateOf(expired, 'weekly', 20_000);
  assert.equal(state.available, false);
  assert.equal(state.expired, true);
  assert.doesNotMatch(
    renderButton('anthropic', 'weekly', expired, { now: 20_000 }),
    />40%</
  );
});
