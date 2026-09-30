import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  normalizeCursorUsage,
  readCursorUsage
} from '../src/providers/cursor.js';
import {
  cursorStateFile,
  openCursorState,
  readCursorToken
} from '../src/providers/cursor-credentials.js';
import { selectWindow, stateOf, windowLabel } from '../src/model.js';
import { renderButton } from '../src/render.js';
import { UsageService } from '../src/service.js';
import { emptyRegistry } from '../src/accounts.js';
import { LastReadings } from '../src/last-readings.js';
import type { Host } from '../src/platform.js';

// Legacy response without split-pool fields; included spend remains supported for older plans.
const team = {
  billingCycleStart: '1788722575000',
  billingCycleEnd: '1791314575000',
  planUsage: {
    totalSpend: 390,
    includedSpend: 390,
    remaining: 1610,
    limit: 2000,
    remainingBonus: false,
    bonusTooltip:
      "We work with model providers to give you free usage beyond what you've purchased. Amounts may vary.",
    totalPercentUsed: 0.312
  },
  spendLimitUsage: { pooledUsed: 0, limitType: 'team' },
  displayThreshold: 200,
  enabled: true,
  displayMessage: "You've used 20% of your included usage",
  autoModelSelectedDisplayMessage:
    "You've used 1% of your included total usage",
  namedModelSelectedDisplayMessage: "You've used 0% of your included API usage"
};
const free = {
  billingCycleStart: '1788722575000',
  billingCycleEnd: '1791314575000',
  planUsage: { totalPercentUsed: 0 },
  displayMessage: "You've used 0% of your included usage"
};
const now = 1788722575000 + 10 * 86_400_000;
const macHost = (home: string): Host => ({
  platform: 'darwin',
  arch: 'arm64',
  home: home.replaceAll('\\', '/'),
  env: {}
});
const withPlan = (planUsage: unknown) => ({ ...team, planUsage });

test('Cursor reads included spend against the plan limit for the billing cycle', () => {
  const result = normalizeCursorUsage(team, now);
  assert.equal(result.monthly?.used, 19.5);
  assert.equal(result.monthly?.minutes, 43200);
  assert.equal(result.monthly?.resetsAt, 1791314575);
  assert.equal(result.short, undefined);
  assert.equal(result.weekly, undefined);
  assert.equal(stateOf(result, 'monthly', now).available, true);
  assert.equal(stateOf(result, 'monthly', 1791314575000).available, false);
});

test('legacy Cursor responses ignore totalPercentUsed instead of treating it as an included-spend percentage', () => {
  // Regression: the old key displayed this field and showed 0% while Cursor showed 20%.
  for (const totalPercentUsed of [0, 0.312, 31.2]) {
    assert.equal(
      normalizeCursorUsage(
        withPlan({ ...team.planUsage, totalPercentUsed }),
        now
      ).monthly?.used,
      19.5
    );
  }
  assert.equal(
    normalizeCursorUsage(withPlan({ totalPercentUsed: 0.312 }), now).monthly
      ?.used,
    20
  );
  assert.throws(
    () =>
      normalizeCursorUsage(
        { ...withPlan({ totalPercentUsed: 0.312 }), displayMessage: undefined },
        now
      ),
    /included plan usage/
  );
});

test('Cursor falls back to the dashboard message only when spend fields are absent', () => {
  assert.equal(normalizeCursorUsage(free, now).monthly?.used, 0);
  assert.equal(
    normalizeCursorUsage(
      { ...free, displayMessage: "You've used 42.5% of your included usage" },
      now
    ).monthly?.used,
    42.5
  );
  assert.equal(
    normalizeCursorUsage(
      { ...team, displayMessage: "You've used 90% of your included usage" },
      now
    ).monthly?.used,
    19.5
  );
});

test('Cursor missing or invalid usage never becomes zero', () => {
  for (const includedSpend of [null, '390', -1, NaN, Infinity])
    assert.throws(
      () => normalizeCursorUsage(withPlan({ includedSpend, limit: 2000 }), now),
      /included plan usage/
    );
  for (const limit of [undefined, null, 0, -2000, '2000', NaN, Infinity])
    assert.throws(
      () => normalizeCursorUsage(withPlan({ includedSpend: 390, limit }), now),
      /included plan usage/
    );
  for (const displayMessage of [
    undefined,
    '',
    'Usage is unavailable',
    "You've used 20% of your included API usage"
  ])
    assert.throws(
      () => normalizeCursorUsage({ ...free, displayMessage }, now),
      /included plan usage/
    );
  for (const data of [null, undefined, {}, { planUsage: null }])
    assert.throws(() => normalizeCursorUsage(data, now));
  assert.equal(
    normalizeCursorUsage(withPlan({ includedSpend: 0, limit: 2000 }), now)
      .monthly?.used,
    0
  );
});

test('Cursor caps usage beyond the included allowance at 100%', () => {
  assert.equal(
    normalizeCursorUsage(withPlan({ includedSpend: 2500, limit: 2000 }), now)
      .monthly?.used,
    100
  );
  assert.equal(
    normalizeCursorUsage(
      { ...free, displayMessage: "You've used 150% of your included usage" },
      now
    ).monthly?.used,
    100
  );
});

test('Cursor rejects invalid billing-cycle timestamps', () => {
  for (const [billingCycleStart, billingCycleEnd] of [
    ['soon', '1791314575000'],
    ['1788722575000', undefined],
    ['1791314575000', '1788722575000'],
    ['1788722575000', '1788722575000'],
    ['0', '1791314575000'],
    ['1788722575000', '1791314575000.5'],
    [null, null]
  ]) {
    assert.throws(
      () =>
        normalizeCursorUsage(
          { ...team, billingCycleStart, billingCycleEnd },
          now
        ),
      /billing cycle/
    );
  }
});

test('Cursor sign-in is read from its state database, opened read-only and closed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-cursor-'));
  try {
    const host = macHost(dir);
    const file = cursorStateFile(host);
    assert.equal(
      file,
      path.posix.join(
        host.home,
        'Library/Application Support/Cursor/User/globalStorage/state.vscdb'
      )
    );
    assert.equal(
      cursorStateFile({
        platform: 'win32',
        arch: 'x64',
        home: 'C:\\Users\\example',
        env: { APPDATA: 'C:\\Users\\example\\AppData\\Roaming' }
      }),
      'C:\\Users\\example\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb'
    );
    await assert.rejects(
      readCursorToken(host),
      /Open Cursor and sign in to connect plan usage/
    );
    await mkdir(path.dirname(file), { recursive: true });
    const setup = new DatabaseSync(file);
    setup.exec(
      'CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value TEXT)'
    );
    setup
      .prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)')
      .run('cursorAuth/refreshToken', 'not-readable');
    setup.close();
    await assert.rejects(readCursorToken(host), /No Cursor sign-in found/);
    const write = new DatabaseSync(file);
    write
      .prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)')
      .run('cursorAuth/accessToken', 'fixture-cursor-token');
    write.close();
    let opened: DatabaseSync | undefined;
    assert.equal(
      await readCursorToken(
        host,
        async (name) => (opened = await openCursorState(name))
      ),
      'fixture-cursor-token'
    );
    assert.equal(opened?.isOpen, false);
    const readOnly = await openCursorState(file);
    try {
      assert.throws(
        () =>
          readOnly.exec("INSERT INTO ItemTable (key, value) VALUES ('x', 'y')"),
        /readonly/i
      );
    } finally {
      readOnly.close();
    }
    await assert.rejects(
      readCursorToken(host, async () => {
        throw Object.assign(new Error('database is locked'), { errcode: 5 });
      }),
      /Retrying shortly/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Cursor requests usage once and maps expired sign-ins', async () => {
  const requests: [string, RequestInit | undefined][] = [];
  const respond =
    (status: number, body = '') =>
    async (url: string | URL | Request, init?: RequestInit) => {
      requests.push([String(url), init]);
      return new Response(body, { status });
    };
  const token = async () => 'fixture-cursor-token';
  const result = await readCursorUsage(
    token,
    respond(200, JSON.stringify(team))
  );
  assert.equal(result.monthly?.used, 19.5);
  const [url, init] = requests[0];
  assert.equal(
    url,
    'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage'
  );
  assert.equal(init?.method, 'POST');
  assert.equal(init?.body, '{}');
  assert.equal(init?.redirect, 'error');
  assert.deepEqual(init?.headers, {
    Authorization: 'Bearer fixture-cursor-token',
    'Content-Type': 'application/json',
    'Connect-Protocol-Version': '1'
  });
  for (const status of [401, 403])
    await assert.rejects(
      readCursorUsage(token, respond(status)),
      /^Error: Cursor sign-in expired\. Open Cursor to refresh it\.$/
    );
  await assert.rejects(
    readCursorUsage(token, respond(500)),
    /Cursor usage request failed \(HTTP 500\)/
  );
  await assert.rejects(
    readCursorUsage(token, async () => {
      throw new TypeError('fetch failed');
    }),
    /Cursor usage service is unreachable/
  );
});

test('Cursor key stays disconnected until its sign-in connection is explicitly enabled', async () => {
  let calls = 0;
  const service = new UsageService({
    sources: {
      cursor: {
        readActive: async () => {
          calls++;
          return normalizeCursorUsage(team);
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
  const off = await service.get('cursor', {}, true);
  assert.equal(off.monthly, undefined);
  assert.equal(off.observedAt, 0);
  assert.match(off.error || '', /connection is off/);
  assert.equal(calls, 0);
  assert.equal(
    (await service.get('cursor', { cursorConnected: true })).monthly?.used,
    19.5
  );
  assert.equal(calls, 1);
});

test('Cursor keys render the billing-cycle label and percentage', () => {
  const snapshot = normalizeCursorUsage(team, now);
  for (const preference of [undefined, 'auto', 'short', 'weekly'] as const)
    assert.equal(selectWindow(snapshot, 'monthly', preference), 'monthly');
  assert.equal(windowLabel(snapshot.monthly, 'monthly'), 'M');
  for (const minutes of [40320, 44640])
    assert.equal(windowLabel({ used: 1, minutes }), 'M');
  assert.equal(windowLabel(undefined, 'monthly'), 'M');
  const svg = renderButton('cursor', 'monthly', snapshot, { now });
  assert.match(svg, />20%</);
  assert.match(svg, />M</);
  assert.match(svg, /<image x="16" y="14" width="36" height="36"/);
  assert.match(
    renderButton('cursor', 'monthly', snapshot, { now, remaining: true }),
    />81%</
  );
  assert.match(
    renderButton('cursor', 'monthly', snapshot, { now, reset: true }),
    />20d 0h</
  );
  assert.match(
    renderButton('cursor', 'monthly', undefined, { now }),
    />\u2014</
  );
});
