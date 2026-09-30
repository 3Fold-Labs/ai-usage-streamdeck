import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  normalizeSuperGrokUsage,
  readSuperGrokAuth,
  readSuperGrokUsage,
  selectSuperGrokSession
} from '../src/providers/supergrok.js';
import { stateOf } from '../src/model.js';
import { renderButton } from '../src/render.js';
import { UsageService } from '../src/service.js';
import { emptyRegistry } from '../src/accounts.js';
import { LastReadings } from '../src/last-readings.js';
import type { Host } from '../src/platform.js';

// Live SuperGrok response from the Grok CLI billing endpoint.
const live = {
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-09-07T22:41:14.401374+00:00',
      end: '2026-09-14T22:41:14.401374+00:00'
    },
    creditUsagePercent: 24.0,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    productUsage: [{ product: 'GrokBuild', usagePercent: 24.0 }],
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    topUpMethod: 'TOP_UP_METHOD_SAVED_PAYMENT_METHOD',
    billingPeriodStart: '2026-09-07T22:41:14.401374+00:00',
    billingPeriodEnd: '2026-09-14T22:41:14.401374+00:00'
  }
};
const now = Date.UTC(2026, 8, 11);
const future = '2099-01-01T00:00:00.000000Z';
const withConfig = (config: Record<string, unknown>) => ({
  config: { ...live.config, ...config }
});
const session = (email: string, key: string, expires_at = future) => ({
  key,
  email,
  expires_at,
  auth_mode: 'oidc'
});

test('SuperGrok reads the shared weekly pool percentage and reset', () => {
  const result = normalizeSuperGrokUsage(live, now);
  assert.equal(result.weekly?.used, 24);
  assert.equal(result.weekly?.minutes, 10080);
  // Microsecond timestamps with a +00:00 offset parse to the millisecond.
  assert.equal(
    result.weekly?.resetsAt,
    Date.UTC(2026, 8, 14, 22, 41, 14, 401) / 1000
  );
  assert.equal(result.short, undefined);
  assert.equal(result.monthly, undefined);
  assert.equal(result.source, 'SuperGrok subscription · shared weekly pool');
  assert.equal(stateOf(result, 'weekly', now).available, true);
});

test('SuperGrok product breakdown uses friendly labels and skips invalid entries', () => {
  assert.deepEqual(normalizeSuperGrokUsage(live, now).breakdown, [
    { label: 'Build', used: 24 }
  ]);
  const productUsage = [
    { product: 'GrokChat', usagePercent: 5 },
    { product: 'Chat', usagePercent: 1 },
    { product: 'Imagine', usagePercent: 2 },
    { product: 'Voice', usagePercent: 0 },
    { product: 'GrokImagineVideo', usagePercent: 3 },
    { product: 'constructor', usagePercent: 4 },
    { product: 'Build', usagePercent: '9' },
    { product: '', usagePercent: 1 },
    { usagePercent: 1 },
    { product: 'Voice', usagePercent: 101 },
    null
  ];
  assert.deepEqual(
    normalizeSuperGrokUsage(withConfig({ productUsage }), now).breakdown,
    [
      { label: 'Chat', used: 5 },
      { label: 'Chat', used: 1 },
      { label: 'Imagine', used: 2 },
      { label: 'Voice', used: 0 },
      { label: 'Imagine Video', used: 3 },
      { label: 'Other', used: 4 }
    ]
  );
  assert.equal(
    normalizeSuperGrokUsage(withConfig({ productUsage: undefined }), now)
      .breakdown,
    undefined
  );
});

test('SuperGrok ignores on-demand, prepaid and top-up spending', () => {
  const paid = {
    onDemandCap: { val: 50000 },
    onDemandUsed: { val: 9900 },
    prepaidBalance: { val: 25000 },
    topUpMethod: 'TOP_UP_METHOD_AUTO'
  };
  assert.equal(normalizeSuperGrokUsage(withConfig(paid), now).weekly?.used, 24);
  assert.equal(
    normalizeSuperGrokUsage(withConfig({ ...paid, creditUsagePercent: 0 }), now)
      .weekly?.used,
    0
  );
});

test('SuperGrok does not fabricate zero usage', () => {
  for (const creditUsagePercent of [
    null,
    undefined,
    '24',
    -1,
    101,
    NaN,
    Infinity
  ])
    assert.throws(
      () => normalizeSuperGrokUsage(withConfig({ creditUsagePercent }), now),
      /valid usage percentage/
    );
  for (const data of [null, undefined, {}, { config: null }])
    assert.throws(() => normalizeSuperGrokUsage(data, now));
  assert.equal(
    normalizeSuperGrokUsage(withConfig({ creditUsagePercent: 0 }), now).weekly
      ?.used,
    0
  );
});

test('SuperGrok rejects periods other than one week', () => {
  const period = (start: unknown, end: unknown) =>
    withConfig({
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start, end }
    });
  assert.throws(
    () =>
      normalizeSuperGrokUsage(
        period('2026-09-14T17:41:14Z', '2026-09-14T22:41:14Z'),
        now
      ),
    /unsupported usage period/
  );
  assert.throws(
    () =>
      normalizeSuperGrokUsage(
        period('2026-08-14T22:41:14Z', '2026-09-14T22:41:14Z'),
        now
      ),
    /unsupported usage period/
  );
  assert.throws(
    () =>
      normalizeSuperGrokUsage(
        period('2026-09-14T22:41:14Z', '2026-09-07T22:41:14Z'),
        now
      ),
    /unsupported usage period/
  );
  for (const [start, end] of [
    ['soon', '2026-09-14T22:41:14Z'],
    ['2026-09-07T22:41:14Z', undefined],
    [1788820874401, 1789425674401]
  ])
    assert.throws(
      () => normalizeSuperGrokUsage(period(start, end), now),
      /valid usage period/
    );
  assert.throws(
    () =>
      normalizeSuperGrokUsage(withConfig({ currentPeriod: undefined }), now),
    /valid usage period/
  );
});

test('SuperGrok selects one Grok CLI session', () => {
  assert.equal(
    selectSuperGrokSession({ a: session('one@example.com', 'key-one') }).key,
    'key-one'
  );
  const several = {
    a: session('one@example.com', 'key-one'),
    b: session('Two@Example.com', 'key-two')
  };
  assert.throws(
    () => selectSuperGrokSession(several),
    /^Error: Several Grok accounts are signed in\. Enter the account email under Connection settings\.$/
  );
  assert.equal(
    selectSuperGrokSession(several, ' two@EXAMPLE.com ').key,
    'key-two'
  );
  assert.throws(
    () => selectSuperGrokSession(several, 'three@example.com'),
    /matches the account email/
  );
  assert.throws(
    () =>
      selectSuperGrokSession(
        { a: session('one@example.com', 'key-one') },
        'two@example.com'
      ),
    /matches the account email/
  );
  for (const data of [
    {},
    null,
    [],
    { a: { email: 'one@example.com' } },
    { a: { key: '', email: 'one@example.com' } },
    { a: { key: 'key-one' } },
    { a: 'key-one' }
  ]) {
    assert.throws(
      () => selectSuperGrokSession(data),
      /^Error: Sign in to the Grok CLI \(run grok login\) to connect SuperGrok usage\.$/
    );
  }
});

test('SuperGrok never reads the refresh token', async () => {
  const guarded = {
    key: 'key-one',
    email: 'one@example.com',
    expires_at: future,
    get refresh_token(): string {
      throw new Error('refresh_token was accessed');
    }
  };
  assert.equal(selectSuperGrokSession({ a: guarded }).key, 'key-one');
  const result = await readSuperGrokUsage(
    undefined,
    async () => ({ a: guarded }),
    async () => new Response(JSON.stringify(live))
  );
  assert.equal(result.weekly?.used, 24);
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-supergrok-'));
  try {
    const host: Host = {
      platform: 'darwin',
      arch: 'arm64',
      home: dir,
      env: {}
    };
    await assert.rejects(readSuperGrokAuth(host), /run grok login/);
    await mkdir(path.join(dir, '.grok'));
    const file = path.join(dir, '.grok', 'auth.json');
    await writeFile(
      file,
      JSON.stringify({
        'https://auth.example::1': {
          ...session('one@example.com', 'key-one'),
          refresh_token: 'not-readable'
        }
      })
    );
    const parsed = (await readSuperGrokAuth(host)) as Record<
      string,
      Record<string, unknown>
    >;
    assert.equal(
      Object.hasOwn(parsed['https://auth.example::1'], 'refresh_token'),
      false
    );
    assert.equal(parsed['https://auth.example::1'].key, 'key-one');
    await writeFile(file, '{not json');
    await assert.rejects(readSuperGrokAuth(host), /could not be read/);
    await writeFile(file, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
    await assert.rejects(readSuperGrokAuth(host), /too large/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('SuperGrok does not send an expired session and maps rejected sessions', async () => {
  let calls = 0;
  const expired = async () => ({
    a: session('one@example.com', 'key-one', '2020-01-01T00:00:00.000000Z')
  });
  await assert.rejects(
    readSuperGrokUsage(undefined, expired, async () => {
      calls++;
      return new Response(JSON.stringify(live));
    }),
    /^Error: SuperGrok sign-in expired\. Run grok once to renew it\.$/
  );
  assert.equal(calls, 0);
  const valid = async () => ({ a: session('one@example.com', 'key-one') });
  let request: [string, RequestInit | undefined] | undefined;
  await readSuperGrokUsage(undefined, valid, async (url, init) => {
    request = [String(url), init];
    return new Response(JSON.stringify(live));
  });
  assert.equal(
    request?.[0],
    'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
  );
  assert.equal(request?.[1]?.method, undefined);
  assert.equal(request?.[1]?.redirect, 'error');
  assert.deepEqual(request?.[1]?.headers, {
    Authorization: 'Bearer key-one',
    'x-xai-token-auth': 'xai-grok-cli',
    Accept: 'application/json'
  });
  for (const status of [401, 403])
    await assert.rejects(
      readSuperGrokUsage(
        undefined,
        valid,
        async () => new Response('', { status })
      ),
      /^Error: SuperGrok sign-in expired\. Run grok once to renew it\.$/
    );
  await assert.rejects(
    readSuperGrokUsage(
      undefined,
      valid,
      async () => new Response('', { status: 500 })
    ),
    /SuperGrok usage request failed \(HTTP 500\)/
  );
  await assert.rejects(
    readSuperGrokUsage(undefined, valid, async () => {
      throw new TypeError('fetch failed');
    }),
    /SuperGrok usage service is unreachable/
  );
});

test('SuperGrok key stays disconnected until enabled and keeps its last reading when the session expires', async () => {
  const accounts: (string | undefined)[] = [];
  let fail = false;
  // The fake mirrors the SuperGrok source, which passes the trimmed account email to the reader.
  const service = new UsageService({
    sources: {
      supergrok: {
        readActive: async (settings) => {
          const account = settings.superGrokAccount?.trim() || undefined;
          accounts.push(account);
          if (fail)
            throw new Error(
              'SuperGrok sign-in expired. Run grok once to renew it.'
            );
          return normalizeSuperGrokUsage(live, Date.now());
        },
        readAccount: async () => {
          throw new Error('unused');
        }
      }
    },
    registry: { load: async () => emptyRegistry(), save: async () => {} },
    lastReadings: new LastReadings(
      path.join(tmpdir(), 'ai-usage-unused', 'last-readings.json')
    )
  });
  const off = await service.get('supergrok', {}, true);
  assert.equal(off.weekly, undefined);
  assert.equal(off.observedAt, 0);
  assert.match(off.error || '', /connection is off/);
  assert.equal(accounts.length, 0);
  const originalNow = Date.now;
  let clock = now;
  Date.now = () => clock;
  try {
    const settings = {
      superGrokConnected: true,
      superGrokAccount: ' One@Example.com '
    };
    assert.equal((await service.get('supergrok', settings)).weekly?.used, 24);
    assert.deepEqual(accounts, ['One@Example.com']);
    fail = true;
    clock += 61_000;
    const stale = await service.get('supergrok', settings);
    assert.equal(stale.weekly?.used, 24);
    assert.match(stale.error || '', /sign-in expired/);
    assert.equal(stateOf(stale, 'weekly', clock).stale, true);
    assert.match(
      renderButton('supergrok', 'weekly', stale, { now: clock }),
      /<circle cx="132" cy="12" r="3" fill="#F3C16E"\/>/
    );
  } finally {
    Date.now = originalNow;
  }
});

test('SuperGrok keys render the weekly label and percentage', () => {
  const snapshot = normalizeSuperGrokUsage(live, now);
  const svg = renderButton('supergrok', 'weekly', snapshot, { now });
  assert.match(svg, />24%</);
  assert.match(svg, />W</);
  assert.match(svg, /<image x="16" y="14" width="36" height="36"/);
  assert.match(svg, /#8FA8FF/);
  assert.match(
    renderButton('supergrok', 'weekly', snapshot, { now, remaining: true }),
    />76%</
  );
});
