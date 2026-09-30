import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  stat,
  readFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  findGrokExecutable,
  parseSuperGrokSignIn,
  readSuperGrokAuth,
  readSuperGrokUsage,
  selectSuperGrokSession,
  startSuperGrokSignIn,
  superGrokEmails
} from '../src/providers/supergrok.js';
import { createSuperGrokSource } from '../src/providers/supergrok-source.js';
import type { AccountRecord } from '../src/accounts.js';
import type { Host } from '../src/platform.js';

const live = {
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-09-07T22:41:14.401374+00:00',
      end: '2026-09-14T22:41:14.401374+00:00'
    },
    creditUsagePercent: 24.0,
    productUsage: [{ product: 'GrokBuild', usagePercent: 24.0 }]
  }
};
const future = '2099-01-01T00:00:00.000000Z';
const session = (email: string, key: string) => ({
  key,
  email,
  expires_at: future,
  auth_mode: 'oidc',
  refresh_token: 'not-readable'
});
const verified =
  "To sign in, open this URL in your browser:\n\n  https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH\n\nConfirm this code in your browser:\n\n  ABCD-EFGH\n\n\x1b[90mOnly continue with a code you requested. Don't share it with anyone.\x1b[0m\n\nWaiting for authorization...\n";
const posixOnly = { skip: process.platform === 'win32' };

// Every file these tests touch lives under one temp folder; the real ~/.grok is never read.
const root = await mkdtemp(path.join(tmpdir(), 'ai-usage-'));
const previousDataDir = process.env.AI_USAGE_DATA_DIR;
process.env.AI_USAGE_DATA_DIR = path.join(root, 'data');
after(async () => {
  if (previousDataDir === undefined) delete process.env.AI_USAGE_DATA_DIR;
  else process.env.AI_USAGE_DATA_DIR = previousDataDir;
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
  assert.ok(
    relative &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      path.basename(root).startsWith('ai-usage-')
  );
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
});

let folders = 0;
const folder = async (name: string) => {
  const dir = path.join(root, `${name}-${folders++}`);
  await mkdir(dir, { recursive: true });
  return dir;
};
const hostFor = (home: string, env: NodeJS.ProcessEnv = {}): Host => ({
  platform: 'darwin',
  arch: 'arm64',
  home,
  env
});
const writeAuth = async (dir: string, sessions: Record<string, unknown>) => {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'auth.json'), JSON.stringify(sessions));
};
const record = (key: string, home?: string): AccountRecord => ({
  id: 'supergrok-00000000',
  provider: 'supergrok',
  key,
  nick: 'SG',
  name: key,
  ...(home ? { home } : {}),
  addedAt: 1
});
const fakeRequest = (keys: string[]) =>
  (async (_url: string | URL | Request, init?: RequestInit) => {
    keys.push((init?.headers as Record<string, string>).Authorization);
    return new Response(JSON.stringify(live));
  }) as typeof fetch;

// A stand-in for the Grok CLI that prints the verified device prompt (split across writes, with colour codes).
const prompt = [
  "printf 'To sign in, open this URL in your browser:\\n\\n  \\033[4mhttps://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH\\033[0m\\n\\nConfirm this code in your browser:\\n\\n  \\033[1mAB'",
  'sleep 0.1',
  "printf 'CD-EFGH\\033[0m\\n\\n\\033[90mOnly continue with a code you requested. Do not share it with anyone.\\033[0m\\n\\nWaiting for authorization...\\n'"
].join('\n');
const approveAndSave = `while [ ! -f "$GROK_HOME/approve" ]; do sleep 0.05; done
printf '%s' '{"https://auth.x.ai::fixture":{"key":"fixture-new-key","email":" New.Person@Example.com ","expires_at":"${future}","refresh_token":"not-readable"}}' > "$GROK_HOME/auth.json" || exit 9
exit 0`;
async function fakeGrok(body: string): Promise<string> {
  const file = path.join(await folder('bin'), 'grok');
  await writeFile(
    file,
    `#!/bin/sh\n[ "$#" = 2 ] && [ "$1" = login ] && [ "$2" = --device-auth ] || exit 3\necho $$ > "$GROK_HOME/pid"\n${body}\n`,
    { mode: 0o755 }
  );
  return file;
}
async function stopped(home: string): Promise<boolean> {
  const pid = Number(await readFile(path.join(home, 'pid'), 'utf8'));
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await delay(20);
  }
  return false;
}
const pending = async (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled'
    ),
    delay(150).then(() => 'pending')
  ]);

test('SuperGrok sign-in prompts are read from the Grok CLI output without colour codes', () => {
  assert.deepEqual(parseSuperGrokSignIn(verified), {
    url: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH',
    code: 'ABCD-EFGH'
  });
  const coloured = verified
    .replace('https://', '\x1b[4mhttps://')
    .replace('EFGH\n\nConfirm', 'EFGH\x1b[0m\n\nConfirm')
    .replace('  ABCD-EFGH\n\n', '  \x1b[1mABCD-EFGH\x1b[0m\n\n');
  assert.deepEqual(parseSuperGrokSignIn(coloured), {
    url: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH',
    code: 'ABCD-EFGH'
  });
  // Nothing is returned until both the full link and the code have arrived.
  assert.equal(
    parseSuperGrokSignIn(verified.slice(0, verified.indexOf('Confirm'))),
    undefined
  );
  assert.equal(
    parseSuperGrokSignIn(
      verified.slice(0, verified.indexOf('EFGH\n\n\x1b') + 2)
    ),
    undefined
  );
  assert.equal(
    parseSuperGrokSignIn(
      verified.replaceAll(
        'https://accounts.x.ai/',
        'https://accounts.example.com/'
      )
    ),
    undefined
  );
  assert.equal(parseSuperGrokSignIn(''), undefined);
});

test('SuperGrok readings name their account and sign-ins can come from any folder', async () => {
  const guarded = {
    key: 'key-one',
    email: ' One@Example.com ',
    expires_at: future,
    get refresh_token(): string {
      throw new Error('refresh_token was accessed');
    }
  };
  assert.equal(
    selectSuperGrokSession({ a: guarded }).email,
    ' One@Example.com '
  );
  const keys: string[] = [];
  const reading = await readSuperGrokUsage(
    undefined,
    async () => ({ a: guarded }),
    fakeRequest(keys)
  );
  assert.deepEqual(reading.account, {
    key: 'one@example.com',
    label: 'One@Example.com'
  });
  assert.equal(reading.weekly?.used, 24);
  assert.deepEqual(keys, ['Bearer key-one']);
  assert.deepEqual(
    superGrokEmails({
      a: session('One@Example.com', 'k1'),
      b: session('one@example.com ', 'k2'),
      c: session('two@example.com', 'k3'),
      d: { email: 'nokey@example.com' },
      e: 'x'
    }),
    ['one@example.com', 'two@example.com']
  );
  assert.deepEqual(superGrokEmails(null), []);
  const home = await folder('home');
  const signIn = await folder('signin');
  await writeAuth(path.join(home, '.grok'), {
    a: session('default@example.com', 'default-key')
  });
  await writeAuth(signIn, { a: session('folder@example.com', 'folder-key') });
  const host = hostFor(home);
  assert.equal(
    superGrokEmails(await readSuperGrokAuth(host))[0],
    'default@example.com'
  );
  const parsed = (await readSuperGrokAuth(host, signIn)) as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(parsed.a.email, 'folder@example.com');
  assert.equal(Object.hasOwn(parsed.a, 'refresh_token'), false);
  await assert.rejects(
    readSuperGrokAuth(host, path.join(root, 'missing-folder')),
    /run grok login/
  );
});

test('the Grok CLI is found in its own folder, then on PATH, then in Homebrew', async () => {
  const tried: string[] = [];
  const find = (available: string[], env: NodeJS.ProcessEnv) =>
    findGrokExecutable(hostFor('/Users/example', env), async (file) => {
      tried.push(file);
      return available.includes(file);
    });
  const env = { PATH: '/first/bin::relative/bin:/second/bin' };
  assert.equal(await find([], env), undefined);
  assert.deepEqual(tried, [
    '/Users/example/.grok/bin/grok',
    '/first/bin/grok',
    '/second/bin/grok',
    '/opt/homebrew/bin/grok',
    '/usr/local/bin/grok'
  ]);
  assert.equal(
    await find(['/Users/example/.grok/bin/grok', '/first/bin/grok'], env),
    '/Users/example/.grok/bin/grok'
  );
  assert.equal(
    await find(['/second/bin/grok', '/opt/homebrew/bin/grok'], env),
    '/second/bin/grok'
  );
  assert.equal(
    await find(['/opt/homebrew/bin/grok', '/usr/local/bin/grok'], {}),
    '/opt/homebrew/bin/grok'
  );
  assert.equal(await find(['/usr/local/bin/grok'], {}), '/usr/local/bin/grok');
});

test('follow keys read the default Grok CLI sign-in and chosen accounts read their own folder', async () => {
  const home = await folder('home');
  await writeAuth(path.join(home, '.grok'), {
    a: session('Default@Example.com', 'default-key'),
    b: session('shared@example.com', 'shared-default-key')
  });
  const signIn = await folder('signin');
  await writeAuth(signIn, { a: session('Folder@Example.com', 'folder-key') });
  const keys: string[] = [];
  const source = createSuperGrokSource({
    host: hostFor(home),
    request: fakeRequest(keys)
  });

  await assert.rejects(
    source.readActive({ superGrokConnected: true }),
    /Several Grok accounts/
  );
  const active = await source.readActive({
    superGrokConnected: true,
    superGrokAccount: ' default@example.com '
  });
  assert.deepEqual(active.account, {
    key: 'default@example.com',
    label: 'Default@Example.com'
  });
  assert.equal(
    await source.activeKey!({ superGrokAccount: 'DEFAULT@example.com' }),
    'default@example.com'
  );
  assert.equal(await source.activeKey!({}), undefined);

  const chosen = await source.readAccount(
    record('folder@example.com', signIn),
    {}
  );
  assert.deepEqual(chosen.account, {
    key: 'folder@example.com',
    label: 'Folder@Example.com'
  });
  assert.equal(chosen.weekly?.used, 24);
  // An account without its own folder is read from the default sign-in by email.
  assert.equal(
    (await source.readAccount(record('SHARED@example.com'), {})).account?.key,
    'shared@example.com'
  );
  assert.deepEqual(keys, [
    'Bearer default-key',
    'Bearer folder-key',
    'Bearer shared-default-key'
  ]);

  await assert.rejects(
    source.readAccount(record('other@example.com', signIn), {}),
    /^Error: This SuperGrok account is no longer signed in\. Add it again\.$/
  );
  await assert.rejects(
    source.readAccount(
      record('folder@example.com', path.join(root, 'removed-folder')),
      {}
    ),
    /^Error: This SuperGrok account is no longer signed in\. Add it again\.$/
  );
  await assert.rejects(
    source.readAccount(record('folder@example.com'), {}),
    /^Error: The Grok CLI is not signed into this account right now\.$/
  );
  assert.equal(keys.length, 3);
  const empty = createSuperGrokSource({
    host: hostFor(await folder('empty-home')),
    request: fakeRequest(keys)
  });
  assert.equal(await empty.activeKey!({}), undefined);
  await assert.rejects(empty.readActive({}), /run grok login/);
});

test(
  'adding an account runs grok login --device-auth in the new folder and returns its identity',
  posixOnly,
  async () => {
    const executable = await fakeGrok(`${prompt}\n${approveAndSave}`);
    const home = path.join(await folder('accounts'), 'new-account');
    const source = createSuperGrokSource({
      host: hostFor(await folder('home')),
      executable
    });
    const signIn = await source.startSignIn!({}, home);
    assert.equal(signIn.kind, 'code');
    if (signIn.kind !== 'code') return;
    assert.equal(
      signIn.url,
      'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH'
    );
    assert.equal(signIn.code, 'ABCD-EFGH');
    assert.equal((await stat(home)).mode & 0o777, 0o700);
    assert.equal(await pending(signIn.done), 'pending');
    await writeFile(path.join(home, 'approve'), '');
    assert.deepEqual(await signIn.done, {
      key: 'new.person@example.com',
      label: 'New.Person@Example.com'
    });
    assert.equal(await stopped(home), true);
    assert.equal(
      superGrokEmails(
        await readSuperGrokAuth(hostFor(await folder('unused')), home)
      )[0],
      'new.person@example.com'
    );
  }
);

test(
  'a sign-in that fails or saves nothing is rejected',
  posixOnly,
  async () => {
    const failing = await startSuperGrokSignIn(
      path.join(await folder('accounts'), 'a'),
      { executable: await fakeGrok(`${prompt}\nexit 7`) }
    );
    await assert.rejects(
      failing.kind === 'code' ? failing.done : Promise.resolve(),
      /^Error: Grok CLI sign-in did not finish \(exit code 7\)\.$/
    );
    const home = path.join(await folder('accounts'), 'b');
    const empty = await startSuperGrokSignIn(home, {
      executable: await fakeGrok(`${prompt}\nexit 0`)
    });
    await assert.rejects(
      empty.kind === 'code' ? empty.done : Promise.resolve(),
      /^Error: The Grok CLI finished without saving a sign-in\. Try again\.$/
    );
  }
);

test(
  'cancelling or waiting too long stops the Grok CLI',
  posixOnly,
  async () => {
    const waiting = `${prompt}\nwhile :; do sleep 0.05; done`;
    const cancelHome = path.join(await folder('accounts'), 'cancel');
    const cancelled = await startSuperGrokSignIn(cancelHome, {
      executable: await fakeGrok(waiting)
    });
    assert.equal(cancelled.kind, 'code');
    if (cancelled.kind !== 'code') return;
    cancelled.cancel();
    cancelled.cancel();
    await assert.rejects(
      cancelled.done,
      /^Error: Grok CLI sign-in was cancelled\.$/
    );
    assert.equal(await stopped(cancelHome), true);
    const slowHome = path.join(await folder('accounts'), 'slow');
    const slow = await startSuperGrokSignIn(slowHome, {
      executable: await fakeGrok(waiting),
      timeoutMs: 400
    });
    await assert.rejects(
      slow.kind === 'code' ? slow.done : Promise.resolve(),
      /^Error: Grok CLI sign-in timed out\. Try again\.$/
    );
    assert.equal(await stopped(slowHome), true);
  }
);

test(
  'a sign-in cannot start without the Grok CLI or its code',
  posixOnly,
  async () => {
    await assert.rejects(
      startSuperGrokSignIn(path.join(await folder('accounts'), 'a'), {
        executable: path.join(root, 'no-such-grok')
      }),
      /^Error: Grok CLI was not found\. Install it, then try again\.$/
    );
    await assert.rejects(
      startSuperGrokSignIn(path.join(await folder('accounts'), 'b'), {
        executable: await fakeGrok('echo "error: unknown flag"; exit 2')
      }),
      /^Error: Grok CLI sign-in could not start \(exit code 2\)\.$/
    );
    const silentHome = path.join(await folder('accounts'), 'c');
    await assert.rejects(
      startSuperGrokSignIn(silentHome, {
        executable: await fakeGrok('while :; do sleep 0.05; done'),
        startTimeoutMs: 300
      }),
      /^Error: The Grok CLI did not show a sign-in code\. Update it and try again\.$/
    );
    assert.equal(await stopped(silentHome), true);
  }
);
