import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHex, renderButton } from '../src/render.js';
import type { Snapshot } from '../src/model.js';

const now = 1_800_000_000_000;
const snap: Snapshot = {
  observedAt: now,
  short: { used: 12, minutes: 300, resetsAt: now / 1000 + 3600 },
  weekly: { used: 64, minutes: 10080, resetsAt: now / 1000 + 86400 },
  monthly: { used: 91, minutes: 43200, resetsAt: now / 1000 + 864000 }
};
const kinds = {
  openai: 'short',
  anthropic: 'weekly',
  grok: 'weekly',
  cursor: 'monthly',
  supergrok: 'weekly'
} as const;
test('hex colors are accepted, expanded, uppercased, or ignored', () => {
  assert.equal(normalizeHex('#ff0000'), '#FF0000');
  assert.equal(normalizeHex('#FF0000'), '#FF0000');
  assert.equal(normalizeHex('  #0af  '), '#00AAFF');
  assert.equal(normalizeHex('#ABC'), '#AABBCC');
  assert.equal(normalizeHex('#12ab3480'), '#12AB3480');
  for (const bad of [
    '',
    '   ',
    '#',
    'red',
    '#12345',
    '#1234567',
    'ff0000',
    '#GGHHII',
    '#ff00',
    null,
    undefined,
    42,
    {},
    ['#fff']
  ]) {
    assert.equal(normalizeHex(bad as unknown), undefined);
  }
});

test('keys render their own background and bar colors', () => {
  const svg = renderButton('anthropic', 'weekly', snap, {
    now,
    barColor: '#12ab34',
    keyColor: '#203040'
  });
  assert.match(
    svg,
    /<rect width="144" height="144" rx="15" fill="#203040" fill-opacity="1"\/>/
  );
  assert.match(svg, /stroke="#203040"/);
  assert.match(svg, /width="71\.68" height="6" rx="3" fill="#12AB34"/);
  assert.match(svg, /fill="#12AB34" opacity="0\.1"/);
  assert.doesNotMatch(svg, /#11171D/);
  assert.match(svg, /<text[^>]*>Claude<\/text>/);
  assert.doesNotMatch(svg, /<image|<path/);
});

test('short hex values work on both colors', () => {
  const svg = renderButton('grok', 'weekly', snap, {
    now,
    barColor: '#0f0',
    keyColor: '#123'
  });
  assert.match(
    svg,
    /<rect width="144" height="144" rx="15" fill="#112233" fill-opacity="1"\/>/
  );
  assert.match(svg, /rx="3" fill="#00FF00"/);
});

test('invalid or empty colors fall back to the defaults', () => {
  const plain = renderButton('openai', 'short', snap, { now });
  for (const bad of ['', 'blue', '#12', '#nothex', '   ']) {
    assert.equal(
      renderButton('openai', 'short', snap, {
        now,
        barColor: bad,
        keyColor: bad
      }),
      plain
    );
  }
  assert.equal(
    renderButton('openai', 'short', snap, {
      now,
      barColor: undefined,
      keyColor: undefined
    }),
    plain
  );
});

test('bar opacity from an 8-digit hex is painted on the fill', () => {
  const svg = renderButton('openai', 'weekly', snap, {
    now,
    barColor: '#12AB3480'
  });
  assert.match(svg, /fill="#12AB34" fill-opacity="0\.5/);
});

test('a custom bar color is used even when usage is in the warning range', () => {
  const warn: Snapshot = {
    observedAt: now,
    weekly: { used: 76, minutes: 10080, resetsAt: now / 1000 + 3600 }
  };
  const danger: Snapshot = {
    observedAt: now,
    weekly: { used: 93, minutes: 10080, resetsAt: now / 1000 + 3600 }
  };
  const stale: Snapshot = {
    observedAt: now - 600_000,
    weekly: { used: 20, minutes: 10080, resetsAt: now / 1000 + 3600 }
  };
  assert.match(
    renderButton('anthropic', 'weekly', warn, { now, barColor: '#12AB34' }),
    /rx="3" fill="#12AB34"/
  );
  assert.match(
    renderButton('anthropic', 'weekly', danger, { now, barColor: '#12AB34' }),
    /rx="3" fill="#12AB34"/
  );
  assert.match(
    renderButton('anthropic', 'weekly', stale, { now, barColor: '#12AB34' }),
    /rx="3" fill="#12AB34"/
  );
  assert.match(
    renderButton('anthropic', 'weekly', warn, { now }),
    /rx="3" fill="#F3C16E"/
  );
  assert.match(
    renderButton('anthropic', 'weekly', danger, { now }),
    /rx="3" fill="#FF797D"/
  );
});

test('remaining view sizes the bar to the remaining percentage', () => {
  const svg = renderButton(
    'openai',
    'weekly',
    {
      observedAt: now,
      weekly: { used: 89, minutes: 10080, resetsAt: now / 1000 + 3600 }
    },
    { now, remaining: true, barColor: '#00FFF6' }
  );
  assert.match(svg, />11%</);
  assert.match(svg, /width="12(?:\.32)?" height="6" rx="3" fill="#00FFF6"/);
});

test('a light key background switches the text and track to dark ink', () => {
  const svg = renderButton('anthropic', 'weekly', snap, {
    now,
    keyColor: '#F5F5F5',
    nickname: 'C2'
  });
  assert.match(
    svg,
    /<rect x="16" y="108" width="112" height="6" rx="3" fill="#B4BEC6"\/>/
  );
  assert.match(
    svg,
    /font-size="52" font-weight="700" letter-spacing="-1" stroke="#F5F5F5"/
  );
  assert.doesNotMatch(svg, /fill="#F7F9FA"/);
  assert.doesNotMatch(svg, /fill="#FFFFFF" font-family/);
  assert.doesNotMatch(svg, /fill="#AEB8C2"/);
  // Value, window, nickname and Claude label all use dark ink.
  assert.equal(svg.match(/fill="#11171D"/g)?.length, 4);
});

test('a dark key background keeps the light text and track', () => {
  const svg = renderButton('anthropic', 'weekly', snap, {
    now,
    keyColor: '#203040',
    nickname: 'C2'
  });
  assert.match(svg, /rx="3" fill="#2C3740"\/>/);
  assert.match(svg, /fill="#F7F9FA"/);
  assert.match(svg, /fill="#AEB8C2"/);
});

test('keys without color settings keep the default bar and background', () => {
  for (const [provider, kind] of Object.entries(kinds) as [
    keyof typeof kinds,
    (typeof kinds)[keyof typeof kinds]
  ][]) {
    const svg = renderButton(provider, kind, snap, { now });
    assert.match(svg, /<rect width="144" height="144" rx="15" fill="#11171D"/);
    assert.doesNotMatch(svg, /barColor/);
    const remaining = renderButton(provider, kind, snap, {
      now,
      remaining: true
    });
    assert.match(remaining, /height="6" rx="3" fill="/);
  }
});
