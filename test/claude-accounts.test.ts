import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  normalizeClaude,
  normalizeClaudeHistory
} from '../src/providers/normalize.js';
import { createAnthropicSource } from '../src/providers/anthropic-source.js';
import type { AccountRecord } from '../src/accounts.js';

const root = process.cwd();
const A = '1A2B3C4D-0000-4000-8000-00000000000A';
const B = '2b3c4d5e-0000-4000-8000-00000000000b';
const C = '3c4d5e6f-0000-4000-8000-00000000000c';
const D = '4d5e6f70-0000-4000-8000-00000000000d';
const a = A.toLowerCase();
const missing =
  'No reading yet for this Claude account. Use it once in Claude Desktop or Claude Code.';
const record = (key: string): AccountRecord => ({
  id: 'anthropic-00000000',
  provider: 'anthropic',
  key,
  nick: 'C1',
  name: key,
  addedAt: 1
});
const sample = (t: number, org: string | undefined, fh: number, sd = fh) => ({
  t,
  ...(org ? { org } : {}),
  u: { fh, sd }
});
const exported = (
  observedAt: number,
  used: number,
  account?: { org: string; name?: string; email?: string }
) => ({
  observedAt,
  rate_limits: {
    five_hour: {
      used_percentage: used,
      resets_at: Math.floor(observedAt / 1000) + 3600
    },
    seven_day: { used_percentage: used + 1 }
  },
  ...(account ? { account } : {})
});

let scratch = '';
const previous = {
  data: process.env.AI_USAGE_DATA_DIR,
  config: process.env.CLAUDE_CONFIG_DIR
};

async function cleanup(directory: string) {
  const relative = path.relative(
    path.resolve(tmpdir()),
    path.resolve(directory)
  );
  assert.ok(
    relative &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      path.basename(directory).startsWith('ai-usage-')
  );
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

// Nothing in this file may fall back to the real home folders.
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'ai-usage-claude-env-'));
  process.env.AI_USAGE_DATA_DIR = path.join(scratch, 'data');
  process.env.CLAUDE_CONFIG_DIR = path.join(scratch, 'config');
});
after(async () => {
  for (const [name, value] of [
    ['AI_USAGE_DATA_DIR', previous.data],
    ['CLAUDE_CONFIG_DIR', previous.config]
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await cleanup(scratch);
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-claude-'));
  const dataDir = path.join(dir, 'data');
  const history = path.join(dir, 'plan-usage-history.json');
  await mkdir(path.join(dataDir, 'claude-accounts'), { recursive: true });
  let lookups = 0;
  const source = createAnthropicSource({
    dataDir,
    findHistory: async () => {
      lookups++;
      return history;
    }
  });
  const writeHistory = (samples: unknown[]) =>
    writeFile(history, JSON.stringify({ samples }));
  const writeExporter = (data: unknown) =>
    writeFile(path.join(dataDir, 'claude.json'), JSON.stringify(data));
  const writeAccount = (org: string, data: unknown) =>
    writeFile(
      path.join(dataDir, 'claude-accounts', `${org.toLowerCase()}.json`),
      JSON.stringify(data)
    );
  return {
    dir,
    dataDir,
    history,
    source,
    writeHistory,
    writeExporter,
    writeAccount,
    lookups: () => lookups
  };
}

function runExporter(env: NodeJS.ProcessEnv, payload: unknown) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'scripts/claude-statusline.mjs')],
      {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`Exporter exited with ${code}`))
    );
    child.stdin.end(JSON.stringify(payload));
  });
}

test('the exporter tags readings with the Claude organization and writes one file per organization', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-claude-export-'));
  const dataDir = path.join(dir, 'data');
  const configDir = path.join(dir, 'config');
  try {
    await mkdir(configDir);
    await writeFile(
      path.join(configDir, '.claude.json'),
      JSON.stringify({
        primaryApiKey: 'SECRET-API-KEY',
        projects: {
          '/work': { history: [{ display: 'PRIVATE-CONVERSATION' }] }
        },
        oauthAccount: {
          organizationUuid: A,
          organizationName: ' 3Fold Labs ',
          emailAddress: 'admin@example.invalid',
          accountUuid: 'SECRET-ACCOUNT',
          accessToken: 'SECRET-TOKEN',
          refreshToken: 'SECRET-REFRESH'
        }
      })
    );
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const output = await runExporter(
      {
        AI_USAGE_DATA_DIR: dataDir,
        CLAUDE_CONFIG_DIR: configDir,
        HOME: dir,
        USERPROFILE: dir
      },
      {
        prompt: 'PRIVATE-PROMPT',
        transcript_path: 'SECRET-TRANSCRIPT',
        rate_limits: {
          five_hour: { used_percentage: 27, resets_at: reset },
          seven_day: { used_percentage: 60 }
        }
      }
    );
    assert.match(output, /5h 27%/);
    const raw = await readFile(path.join(dataDir, 'claude.json'), 'utf8');
    const perOrg = await readFile(
      path.join(dataDir, 'claude-accounts', `${a}.json`),
      'utf8'
    );
    for (const text of [raw, perOrg])
      assert.doesNotMatch(
        text,
        /SECRET|PRIVATE|prompt|transcript|token|accountUuid|projects/i
      );
    const data = JSON.parse(raw);
    assert.deepEqual(Object.keys(data).sort(), [
      'account',
      'observedAt',
      'rate_limits'
    ]);
    assert.deepEqual(data.account, {
      org: a,
      name: '3Fold Labs',
      email: 'admin@example.invalid'
    });
    assert.deepEqual(data.rate_limits, {
      five_hour: { used_percentage: 27, resets_at: reset },
      seven_day: { used_percentage: 60 }
    });
    assert.deepEqual(JSON.parse(perOrg), data);
    if (process.platform !== 'win32') {
      assert.equal(
        (await stat(path.join(dataDir, 'claude.json'))).mode & 0o777,
        0o600
      );
      assert.equal(
        (await stat(path.join(dataDir, 'claude-accounts', `${a}.json`))).mode &
          0o777,
        0o600
      );
    }
    assert.deepEqual(await readdir(path.join(dataDir, 'claude-accounts')), [
      `${a}.json`
    ]);
    assert.deepEqual((await readdir(dataDir)).sort(), [
      'claude-accounts',
      'claude.json'
    ]);
    const reading = normalizeClaude(data);
    assert.deepEqual(reading.account, {
      key: a,
      label: 'admin@example.invalid'
    });
  } finally {
    await cleanup(dir);
  }
});

test('the exporter ignores invalid organization ids and missing identities', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-claude-export-'));
  const configDir = path.join(dir, 'config');
  const payload = { rate_limits: { seven_day: { used_percentage: 12 } } };
  try {
    await mkdir(configDir);
    for (const organizationUuid of [
      '../../../escape-attempt-0000000000000',
      'not-a-uuid',
      42,
      `${A}0`
    ]) {
      const dataDir = path.join(
        dir,
        `data-${String(organizationUuid).length}-${typeof organizationUuid}`
      );
      await writeFile(
        path.join(configDir, '.claude.json'),
        JSON.stringify({
          oauthAccount: {
            organizationUuid,
            emailAddress: 'admin@example.invalid'
          }
        })
      );
      await runExporter(
        {
          AI_USAGE_DATA_DIR: dataDir,
          CLAUDE_CONFIG_DIR: configDir,
          HOME: dir,
          USERPROFILE: dir
        },
        payload
      );
      const data = JSON.parse(
        await readFile(path.join(dataDir, 'claude.json'), 'utf8')
      );
      assert.equal(data.account, undefined);
      assert.deepEqual(await readdir(dataDir), ['claude.json']);
    }
    const bare = path.join(dir, 'data-bare');
    await runExporter(
      {
        AI_USAGE_DATA_DIR: bare,
        CLAUDE_CONFIG_DIR: path.join(dir, 'no-config'),
        HOME: dir,
        USERPROFILE: dir
      },
      payload
    );
    assert.equal(
      JSON.parse(await readFile(path.join(bare, 'claude.json'), 'utf8'))
        .account,
      undefined
    );
    assert.deepEqual(await readdir(bare), ['claude.json']);
    assert.equal(
      normalizeClaude({
        ...exported(Date.now(), 5),
        account: { org: '../escape', email: 'x@example.com' }
      }).account,
      undefined
    );
  } finally {
    await cleanup(dir);
  }
});

test('Desktop history picks the latest sample for one organization among interleaved samples', () => {
  const now = 1_800_000_000_000;
  const history = {
    samples: [
      sample(now - 4000, A, 10),
      sample(now - 3000, B, 20),
      sample(now - 2000, A, 30),
      sample(now - 1000, B, 40),
      sample(now - 500, 'active', 50)
    ]
  };
  const forA = normalizeClaudeHistory(history, now, A);
  assert.deepEqual(
    [forA.short?.used, forA.weekly?.used, forA.observedAt],
    [30, 30, now - 2000]
  );
  assert.deepEqual(forA.account, { key: a, label: 'Claude account 1a2b3c4d' });
  assert.equal(normalizeClaudeHistory(history, now, a).observedAt, now - 2000);
  assert.equal(normalizeClaudeHistory(history, now, B).short?.used, 40);
  const latest = normalizeClaudeHistory(
    { samples: history.samples.slice(0, 4) },
    now
  );
  assert.deepEqual([latest.short?.used, latest.account?.key], [40, B]);
  assert.equal(normalizeClaudeHistory(history, now).account, undefined);
  assert.throws(() => normalizeClaudeHistory(history, now, C));
});

test('following Claude shows the freshest of Desktop history and the exporter', async () => {
  const env = await fixture();
  const now = Date.now();
  try {
    await env.writeHistory([
      sample(now - 9000, A, 11),
      sample(now - 1000, B, 22)
    ]);
    await env.writeExporter(
      exported(now - 5000, 33, { org: a, email: 'admin@example.invalid' })
    );
    await env.writeAccount(
      B,
      exported(now - 60_000, 70, { org: B.toLowerCase(), name: 'Second Org' })
    );
    const desktop = await env.source.readActive({});
    assert.deepEqual(
      [
        desktop.short?.used,
        desktop.source,
        desktop.account?.key,
        desktop.account?.label
      ],
      [22, 'Claude Desktop', B, 'Second Org']
    );
    assert.equal(await env.source.activeKey!({}), B);
    await env.writeExporter(
      exported(now, 44, { org: a, email: 'admin@example.invalid' })
    );
    const code = await env.source.readActive({});
    assert.deepEqual(
      [code.short?.used, code.account?.key, code.account?.label],
      [44, a, 'admin@example.invalid']
    );
    assert.ok(code.short?.resetsAt);
    assert.equal(await env.source.activeKey!({}), a);
    // A chosen usage file stays the only source for the key, as before.
    const lookups = env.lookups();
    const chosen = await env.source.readActive({ claudeFile: env.history });
    assert.deepEqual([chosen.short?.used, chosen.account?.key], [22, B]);
    assert.equal(env.lookups(), lookups);
    await rm(path.join(env.dataDir, 'claude.json'));
    assert.equal((await env.source.readActive({})).short?.used, 22);
    await rm(env.history);
    await assert.rejects(
      env.source.readActive({}),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    );
    assert.equal(await env.source.activeKey!({}), undefined);
  } finally {
    await cleanup(env.dir);
  }
});

test('a chosen Claude organization reads its freshest reading and is idle unless an app is using it', async () => {
  const env = await fixture();
  const now = Date.now();
  try {
    // Desktop is on B, Claude Code is on A, and C was used earlier.
    await env.writeHistory([
      sample(now - 50_000, C, 5),
      sample(now - 9000, A, 11),
      sample(now - 4000, D, 12),
      sample(now - 1000, B, 22)
    ]);
    await env.writeExporter(
      exported(now - 2000, 33, { org: a, email: 'admin@example.invalid' })
    );
    await env.writeAccount(
      A,
      exported(now - 2000, 33, { org: a, email: 'admin@example.invalid' })
    );
    await env.writeAccount(
      C,
      exported(now - 40_000, 66, { org: C, name: 'Old Org' })
    );
    await env.writeAccount(D, exported(now - 30_000, 77, { org: D }));

    const codeOrg = await env.source.readAccount(record(A), {});
    assert.deepEqual(
      [
        codeOrg.short?.used,
        codeOrg.idle,
        codeOrg.account?.key,
        codeOrg.account?.label
      ],
      [33, undefined, a, 'admin@example.invalid']
    );
    assert.ok(codeOrg.short?.resetsAt);
    const desktopOrg = await env.source.readAccount(
      record(B.toUpperCase()),
      {}
    );
    assert.deepEqual(
      [desktopOrg.short?.used, desktopOrg.idle, desktopOrg.source],
      [22, undefined, 'Claude Desktop']
    );
    const earlier = await env.source.readAccount(record(C), {});
    assert.deepEqual(
      [earlier.short?.used, earlier.idle, earlier.account?.label],
      [66, true, 'Old Org']
    );
    const desktopFresher = await env.source.readAccount(record(D), {});
    assert.deepEqual(
      [
        desktopFresher.short?.used,
        desktopFresher.idle,
        desktopFresher.source,
        desktopFresher.observedAt
      ],
      [12, true, 'Claude Desktop', now - 4000]
    );

    const unused = '5e6f7081-0000-4000-8000-00000000000e';
    await assert.rejects(
      env.source.readAccount(record(unused), {}),
      (error: Error) => error.message === missing
    );
    await assert.rejects(
      env.source.readAccount(record('../claude'), {}),
      (error: Error) => error.message === missing
    );
    await rm(env.history);
    await assert.rejects(
      env.source.readAccount(record(B), {}),
      (error: Error) => error.message === missing
    );
    const offline = await env.source.readAccount(record(C), {});
    assert.deepEqual([offline.short?.used, offline.idle], [66, true]);
  } finally {
    await cleanup(env.dir);
  }
});

test('Claude accounts are discovered from Desktop history and exporter files', async () => {
  const env = await fixture();
  const now = Date.now();
  try {
    await env.writeHistory([
      sample(now - 9000, A, 11),
      sample(now - 8000, 'active', 1),
      sample(now - 7000, B, 22),
      sample(now - 6000, A, 12),
      sample(now - 5000, undefined, 3)
    ]);
    await env.writeAccount(
      A,
      exported(now - 20_000, 33, { org: a, email: 'admin@example.invalid' })
    );
    await env.writeAccount(
      C,
      exported(now - 1000, 66, { org: C, name: 'Old Org' })
    );
    await writeFile(
      path.join(env.dataDir, 'claude-accounts', 'not-a-uuid.json'),
      JSON.stringify(exported(now, 1, { org: 'not-a-uuid' }))
    );
    await writeFile(
      path.join(env.dataDir, 'claude-accounts', `${D}.json`),
      '{broken'
    );
    const found = await env.source.discover!({});
    assert.deepEqual(
      found.map((identity) => identity.key).sort(),
      [a, B.toLowerCase(), C, D].sort()
    );
    assert.deepEqual(
      Object.fromEntries(
        found.map((identity) => [identity.key, identity.label])
      ),
      {
        [a]: 'admin@example.invalid',
        [B.toLowerCase()]: 'Claude account 2b3c4d5e',
        [C]: 'Old Org',
        [D]: 'Claude account 4d5e6f70'
      }
    );
    await rm(env.history);
    await rm(path.join(env.dataDir, 'claude-accounts'), { recursive: true });
    assert.deepEqual(await env.source.discover!({}), []);
  } finally {
    await cleanup(env.dir);
  }
});

test('adding a Claude account starts Claude Code login in its own folder', async () => {
  const env = await fixture();
  try {
    const home = path.join(env.dir, 'new-home');
    const source = createAnthropicSource({
      dataDir: env.dataDir,
      findHistory: async () => env.history,
      startSignIn: async (folder) => {
        await mkdir(folder, { recursive: true });
        return {
          kind: 'code' as const,
          url: 'https://claude.ai/login',
          code: 'OPEN',
          done: Promise.resolve({
            key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            label: 'work@example.invalid'
          }),
          cancel() {}
        };
      }
    });
    const signIn = await source.startSignIn!({}, home);
    assert.equal(signIn.kind, 'code');
    if (signIn.kind === 'code') {
      assert.equal(signIn.url, 'https://claude.ai/login');
      assert.deepEqual(await signIn.done, {
        key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        label: 'work@example.invalid'
      });
    }
  } finally {
    await cleanup(env.dir);
  }
});
