import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageService, type Settings } from '../src/service.js';
import {
  emptyRegistry,
  renameAccount,
  upsertIdentity,
  type AccountRecord,
  type Registry
} from '../src/accounts.js';
import { LastReadings } from '../src/last-readings.js';
import { stateOf, type Provider, type Snapshot } from '../src/model.js';
import type { AccountSource, Sources } from '../src/sources.js';

const reading = (used: number, key?: string): Snapshot => ({
  observedAt: Date.now(),
  weekly: { used, minutes: 10080, resetsAt: Date.now() / 1000 + 86400 },
  ...(key ? { account: { key, label: key } } : {})
});
const unused = async (): Promise<never> => {
  throw new Error('unused');
};
const seed = (...entries: [Provider, string, string][]) =>
  entries.reduce(
    (reg, [provider, key, label]) =>
      upsertIdentity(reg, provider, { key, label }, undefined, 1).registry,
    emptyRegistry()
  );

function memory(initial = emptyRegistry()) {
  const store = {
    current: initial,
    saves: 0,
    loads: 0,
    load: async () => {
      store.loads++;
      return store.current;
    },
    save: async (next: Registry) => {
      store.current = next;
      store.saves++;
    }
  };
  return store;
}

async function setup(
  fakes: Partial<Record<Provider, Partial<AccountSource>>>,
  registry = memory()
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-service-'));
  const lastReadings = new LastReadings(path.join(dir, 'last-readings.json'));
  const sources = Object.fromEntries(
    Object.entries(fakes).map(([provider, fake]) => [
      provider,
      { readActive: unused, readAccount: unused, ...fake }
    ])
  ) as Partial<Sources>;
  const make = () => new UsageService({ sources, registry, lastReadings });
  return {
    dir,
    registry,
    lastReadings,
    make,
    service: make(),
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

test('follow keys read the signed-in account and chosen keys read their own account', async () => {
  const registry = memory(
    seed(['anthropic', 'org-2', 'Claude subscription 2'])
  );
  const [record] = registry.current.accounts;
  const calls: string[] = [];
  const records: AccountRecord[] = [];
  const seen: Settings[] = [];
  const env = await setup(
    {
      anthropic: {
        readActive: async (settings) => {
          calls.push('active');
          seen.push(settings);
          return reading(21, 'org-1');
        },
        readAccount: async (chosen, settings) => {
          calls.push('account');
          records.push(chosen);
          seen.push(settings);
          return reading(64, 'org-2');
        }
      }
    },
    registry
  );
  try {
    assert.equal((await env.service.get('anthropic', {})).weekly?.used, 21);
    assert.equal(
      (await env.service.get('anthropic', { account: 'follow' })).weekly?.used,
      21
    );
    assert.equal(
      (await env.service.get('anthropic', { account: record.id })).weekly?.used,
      64
    );
    assert.deepEqual(calls, ['active', 'account']);
    assert.deepEqual(records, [record]);
    assert.deepEqual(seen, [{}, { account: record.id }]);
    env.service.clear('anthropic', { account: record.id });
    await env.service.get('anthropic', { account: record.id });
    await env.service.get('anthropic', {});
    assert.deepEqual(calls, ['active', 'account', 'account']);
  } finally {
    await env.cleanup();
  }
});

test('a reading that names its account registers it once and keeps it as the last reading', async () => {
  let calls = 0;
  const env = await setup({
    supergrok: {
      readActive: async () => {
        calls++;
        return reading(24, 'admin@example.invalid');
      }
    }
  });
  const originalNow = Date.now;
  let clock = originalNow();
  Date.now = () => clock;
  try {
    const settings = { superGrokConnected: true };
    // Concurrent keys reading the same new account must not register it twice.
    await Promise.all(
      ['supergrok-00000000', 'supergrok-11111111', 'follow'].map((account) =>
        env.service.get('supergrok', { ...settings, account })
      )
    );
    assert.equal(env.registry.saves, 1);
    await env.service.get('supergrok', settings);
    clock += 61_000;
    await env.service.get('supergrok', settings);
    assert.equal(calls, 4);
    assert.equal(env.registry.saves, 1);
    assert.equal(env.registry.current.accounts.length, 1);
    const [record] = env.registry.current.accounts;
    assert.deepEqual(
      [record.provider, record.key, record.nick, record.name],
      ['supergrok', 'admin@example.invalid', 'AD', 'admin@example.invalid']
    );
    assert.equal(
      (await env.lastReadings.get('supergrok', 'admin@example.invalid'))?.weekly
        ?.used,
      24
    );
  } finally {
    Date.now = originalNow;
    await env.cleanup();
  }
});

test('a chosen account that cannot be read keeps its most recent reading as idle', async () => {
  const registry = memory(
    seed(['anthropic', 'org-3', 'Claude subscription 3'])
  );
  const [record] = registry.current.accounts;
  const failure =
    'No reading yet for this Claude account. Use it once in Claude Desktop or Claude Code.';
  let fail = true;
  const env = await setup(
    {
      anthropic: {
        readAccount: async () => {
          if (fail) throw new Error(failure);
          return reading(64, 'org-3');
        }
      }
    },
    registry
  );
  try {
    const settings = { account: record.id };
    assert.deepEqual(await env.service.get('anthropic', settings), {
      observedAt: 0,
      error: failure
    });
    fail = false;
    const live = await env.make().get('anthropic', settings);
    assert.equal(live.weekly?.used, 64);
    assert.equal(live.idle, undefined);
    fail = true;
    const idle = await env.make().get('anthropic', settings);
    assert.equal(idle.idle, true);
    assert.equal(idle.error, failure);
    assert.equal(idle.weekly?.used, 64);
    assert.equal(idle.observedAt, live.observedAt);
    assert.equal(idle.account?.key, 'org-3');
    const past = stateOf(idle, 'weekly', (idle.weekly!.resetsAt! + 60) * 1000);
    assert.equal(past.available, true);
    assert.equal(past.stale, true);
    assert.equal(
      await env.service.nicknameFor('anthropic', settings, idle),
      'CS'
    );
  } finally {
    await env.cleanup();
  }
});

test('a follow key that fails keeps existing error behavior', async () => {
  const env = await setup({
    anthropic: {
      readActive: async () => {
        throw new Error('Claude usage file is too large.');
      }
    }
  });
  try {
    await env.lastReadings.set('anthropic', 'org-1', reading(50, 'org-1'));
    assert.deepEqual(await env.service.get('anthropic', {}), {
      observedAt: 0,
      error: 'Claude usage file is too large.'
    });
  } finally {
    await env.cleanup();
  }
});

test('nicknames come from the chosen account or the account a follow key is showing', async () => {
  let reg = seed(
    ['openai', 'one@example.com', 'one@example.com'],
    ['openai', 'two@example.com', 'Two']
  );
  reg = renameAccount(reg, reg.accounts[1].id, 'gpt2', '');
  const env = await setup({}, memory(reg));
  const [, two] = reg.accounts;
  const showing = (key: string): Snapshot => ({
    observedAt: 1,
    account: { key, label: key }
  });
  try {
    assert.equal(
      await env.service.nicknameFor('openai', {}, showing('ONE@example.com')),
      'ON'
    );
    assert.equal(
      await env.service.nicknameFor(
        'openai',
        { account: 'follow' },
        showing('two@example.com')
      ),
      'GPT2'
    );
    assert.equal(
      await env.service.nicknameFor(
        'openai',
        { account: two.id },
        showing('one@example.com')
      ),
      'GPT2'
    );
    assert.equal(
      await env.service.nicknameFor('openai', { account: two.id }),
      'GPT2'
    );
    assert.equal(
      await env.service.nicknameFor(
        'openai',
        { account: 'openai-missing' },
        showing('two@example.com')
      ),
      'GPT2'
    );
    assert.equal(
      await env.service.nicknameFor('openai', {}, { observedAt: 1 }),
      undefined
    );
    assert.equal(await env.service.nicknameFor('openai', {}), undefined);
    assert.equal(
      await env.service.nicknameFor('openai', {}, showing('three@example.com')),
      undefined
    );
    assert.equal(
      await env.service.nicknameFor(
        'anthropic',
        {},
        showing('one@example.com')
      ),
      undefined
    );
    assert.equal(
      await env.service.nicknameFor('anthropic', { account: two.id }),
      undefined
    );
  } finally {
    await env.cleanup();
  }
});

test('unknown account ids and Cursor choices fall back to following the app', async () => {
  const registry = memory(
    seed(
      ['cursor', 'smfixture@example.invalid', 'smfixture@example.invalid'],
      ['grok', 'smfixture@example.invalid', 'smfixture@example.invalid']
    )
  );
  const [cursor, grok] = registry.current.accounts;
  const calls: string[] = [];
  const env = await setup(
    {
      cursor: {
        readActive: async () => {
          calls.push('cursor active');
          return reading(21, 'smfixture@example.invalid');
        },
        readAccount: async () => {
          calls.push('cursor account');
          return reading(99);
        }
      },
      grok: {
        readActive: async () => {
          calls.push('grok active');
          return reading(25, 'smfixture@example.invalid');
        },
        readAccount: async () => {
          calls.push('grok account');
          return reading(99);
        }
      }
    },
    registry
  );
  try {
    const pinnedCursor = await env.service.get('cursor', {
      cursorConnected: true,
      account: cursor.id
    });
    assert.equal(pinnedCursor.weekly?.used, 21);
    assert.equal(
      await env.service.nicknameFor(
        'cursor',
        { account: cursor.id },
        pinnedCursor
      ),
      'SM'
    );
    assert.equal(
      (
        await env.service.get('grok', {
          grokConnected: true,
          account: 'grok-deadbeef'
        })
      ).weekly?.used,
      25
    );
    assert.equal(
      (
        await env.service.get('grok', {
          grokConnected: true,
          account: cursor.id
        })
      ).weekly?.used,
      25
    );
    assert.equal(
      (await env.service.get('grok', { grokConnected: true, account: grok.id }))
        .weekly?.used,
      99
    );
    assert.deepEqual(calls, [
      'cursor active',
      'grok active',
      'grok active',
      'grok account'
    ]);
    assert.equal(registry.saves, 0);
  } finally {
    await env.cleanup();
  }
});

test('connection opt-ins still short-circuit before any account is resolved', async () => {
  let calls = 0;
  const counted = {
    readActive: async () => {
      calls++;
      return reading(1);
    },
    readAccount: async () => {
      calls++;
      return reading(1);
    }
  };
  const env = await setup({
    grok: counted,
    cursor: counted,
    supergrok: counted,
    openai: counted
  });
  try {
    const cases: [Provider, Settings, RegExp][] = [
      ['grok', {}, /connection is off/],
      ['cursor', { account: 'cursor-00000000' }, /connection is off/],
      ['supergrok', { superGrokConnected: false }, /connection is off/],
      [
        'openai',
        { disconnected: true, account: 'openai-00000000' },
        /disconnected/
      ]
    ];
    for (const [provider, settings, error] of cases) {
      const snapshot = await env.service.get(provider, settings, true);
      assert.equal(snapshot.observedAt, 0);
      assert.match(snapshot.error || '', error);
    }
    assert.equal(calls, 0);
    assert.equal(env.registry.loads, 0);
  } finally {
    await env.cleanup();
  }
});

test('a reading is still shown when its bookkeeping cannot be saved', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-service-'));
  try {
    const blocker = path.join(dir, 'not-a-directory');
    await writeFile(blocker, '');
    const registry = memory();
    registry.save = async () => {
      throw new Error('global settings unavailable');
    };
    const service = new UsageService({
      sources: {
        openai: {
          readActive: async () => reading(81, 'one@example.com'),
          readAccount: unused
        }
      },
      registry,
      lastReadings: new LastReadings(path.join(blocker, 'last-readings.json'))
    });
    const snapshot = await service.get('openai', {});
    assert.equal(snapshot.weekly?.used, 81);
    assert.equal(snapshot.error, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('clearing an in-flight connection prevents its old account from being registered or cached', async () => {
  let finish!: (value: Snapshot) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const env = await setup({
    anthropic: {
      readActive: async () => {
        started();
        return new Promise<Snapshot>((resolve) => {
          finish = resolve;
        });
      }
    }
  });
  try {
    const pending = env.service.get('anthropic', {});
    await ready;
    env.service.clear('anthropic', {});
    finish(reading(99, 'old-account'));
    assert.deepEqual(await pending, { observedAt: 0 });
    assert.equal(env.registry.current.accounts.length, 0);
    assert.equal(
      await env.lastReadings.get('anthropic', 'old-account'),
      undefined
    );
  } finally {
    await env.cleanup();
  }
});
