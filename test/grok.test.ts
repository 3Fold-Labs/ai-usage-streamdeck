import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrokUsage } from '../src/providers/grok.js';
import { stateOf } from '../src/model.js';
import { UsageService } from '../src/service.js';

const now = Date.UTC(2026, 8, 8);
const reset = '2026-09-12T12:30:00Z';
test('Grok key stays disconnected until desktop sign-in use is explicitly enabled', async () => {
  const snapshot = await new UsageService().get('grok', {}, true);
  assert.equal(snapshot.weekly, undefined);
  assert.equal(snapshot.observedAt, 0);
  assert.match(snapshot.error || '', /connection is off/);
});
test('Grok Bot reads included weekly percentage and reset, ignoring paid spend', () => {
  const result = normalizeGrokUsage(
    {
      usagePercent: 17.25,
      nextResetTimestampUtc: reset,
      onDemandSettings: { enabled: true },
      currentPeriodUsage: { total: 999 }
    },
    now
  );
  assert.equal(result.weekly?.used, 17.25);
  assert.equal(result.weekly?.minutes, 10080);
  assert.equal(result.weekly?.resetsAt, Date.parse(reset) / 1000);
  assert.equal(result.short, undefined);
  assert.equal(stateOf(result, 'weekly', Date.parse(reset)).available, false);
});
test('Grok Bot does not fabricate zero usage or interpret pooled limits as personal limits', () => {
  for (const usagePercent of [null, undefined, '17', -1, NaN, Infinity])
    assert.throws(() =>
      normalizeGrokUsage({ usagePercent, nextResetTimestampUtc: reset }, now)
    );
  assert.throws(() =>
    normalizeGrokUsage(
      { usagePercent: 17, nextResetTimestampUtc: 'invalid' },
      now
    )
  );
  assert.throws(() =>
    normalizeGrokUsage(
      {
        usagePercent: 17,
        nextResetTimestampUtc: reset,
        usesPooledEnterpriseAllowance: true
      },
      now
    )
  );
  assert.equal(
    normalizeGrokUsage({ usagePercent: 0, nextResetTimestampUtc: reset }, now)
      .weekly?.used,
    0
  );
});
