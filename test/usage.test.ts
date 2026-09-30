import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClaude,
  normalizeCodex,
  normalizeClaudeHistory
} from '../src/providers/normalize.js';
import { renderButton } from '../src/render.js';
import { countdown, stateOf, windowLabel, selectWindow } from '../src/model.js';
const now = 1_800_000_000_000;
const w = (usedPercent: unknown, windowDurationMins = 300) => ({
  usedPercent,
  windowDurationMins,
  resetsAt: now / 1000 + 3600
});

test('selects the requested Codex bucket without mixing model limits', () => {
  const data = {
    rateLimits: { primary: w(99) },
    rateLimitsByLimitId: {
      codex: { primary: w(12), secondary: w(45, 10080) },
      other: { primary: w(88) }
    }
  };
  assert.equal(normalizeCodex(data, 'codex', now).short?.used, 12);
  assert.equal(normalizeCodex(data, 'codex', now).weekly?.used, 45);
  assert.equal(normalizeCodex(data, 'other', now).short?.used, 88);
  assert.equal(normalizeCodex(data, 'missing', now).short, undefined);
});
test('legacy Codex windows are classified by duration, not array position', () => {
  const data = { rateLimits: { primary: w(76, 10080), secondary: w(20, 60) } };
  const result = normalizeCodex(data, 'codex', now);
  assert.equal(result.short?.used, 20);
  assert.equal(windowLabel(result.short), '1H');
  assert.equal(result.weekly?.used, 76);
  assert.equal(
    normalizeCodex({ rateLimits: { primary: w(20, 43200) } }).weekly,
    undefined
  );
});
test('missing or invalid usage never becomes zero', () => {
  for (const value of [null, undefined, '25', NaN, Infinity, -1, 101]) {
    assert.equal(
      normalizeCodex({ rateLimits: { primary: w(value) } }, 'codex', now).short,
      undefined
    );
  }
  assert.equal(
    normalizeCodex({ rateLimits: { primary: w(0) } }, 'codex', now).short?.used,
    0
  );
});
test('Claude uses quota fields and ignores context-window percentage', () => {
  const result = normalizeClaude(
    {
      observedAt: now,
      context_window: { used_percentage: 99 },
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: now / 1000 + 90 }
      }
    },
    now
  );
  assert.equal(result.short?.used, 23.5);
  assert.equal(result.weekly, undefined);
  assert.throws(() => normalizeClaude({ observedAt: 'yesterday' }, now));
});
test('stale readings are marked and expired windows do not reset to an invented zero', () => {
  const snapshot = {
    observedAt: now - 360_000,
    short: { used: 80, minutes: 300, resetsAt: now / 1000 + 60 }
  };
  assert.equal(stateOf(snapshot, 'short', now).stale, true);
  assert.match(renderButton('openai', 'short', snapshot, { now }), /<circle/);
  snapshot.short.resetsAt = now / 1000 - 1;
  const svg = renderButton('openai', 'short', snapshot, { now });
  assert.doesNotMatch(svg, />80%<|>0%</);
  assert.match(svg, />—</);
});
test('compact buttons use only a logo, percentage, window, and bar', () => {
  const snapshot = {
    observedAt: now,
    short: { used: 91, minutes: 300, resetsAt: now / 1000 + 3600 }
  };
  const svg = renderButton('anthropic', 'short', snapshot, { now });
  assert.match(svg, />91%</);
  assert.match(svg, />5H</);
  assert.match(svg, /#FF797D/);
  assert.doesNotMatch(svg, /USED|SETUP|UPDATING/);
  assert.match(
    renderButton('anthropic', 'short', snapshot, { remaining: true, now }),
    />9%</
  );
});
test('countdowns round up and handle reset boundaries', () => {
  assert.equal(countdown(now / 1000 + 1, now), '1m');
  assert.equal(countdown(now / 1000 + 3660, now), '1h 1m');
  assert.equal(countdown(now / 1000 - 1, now), 'SOON');
  assert.equal(countdown(undefined, now), '—');
});

test('Claude Desktop history reads the latest account sample without inventing reset times', () => {
  const snapshot = normalizeClaudeHistory(
    {
      samples: [
        { t: now - 5000, org: 'old', u: { fh: 70, sd: 80 } },
        { t: now, org: 'active', u: { fh: 29, sd: 15 } }
      ]
    },
    now
  );
  assert.equal(snapshot.short?.used, 29);
  assert.equal(snapshot.weekly?.used, 15);
  assert.equal(snapshot.short?.resetsAt, undefined);
  assert.match(
    renderButton('anthropic', 'short', snapshot, { now, reset: true }),
    />N\/A</
  );
  assert.equal(snapshot.observedAt, now);
  assert.throws(() =>
    normalizeClaudeHistory(
      { samples: [{ t: now, u: { fh: null, sd: '15' } }] },
      now
    )
  );
});

test('automatic window uses the reported weekly quota when no short allowance exists', () => {
  const snapshot = { observedAt: now, weekly: { used: 15, minutes: 10080 } };
  assert.equal(selectWindow(snapshot, 'short'), 'weekly');
  assert.equal(selectWindow(snapshot, 'short', 'short'), 'short');
  assert.equal(
    selectWindow({ ...snapshot, short: { used: 20, minutes: 300 } }, 'weekly'),
    'weekly'
  );
});
