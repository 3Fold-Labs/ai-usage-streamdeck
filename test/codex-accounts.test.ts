import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  codexIdentity,
  readCodex,
  readCodexAccount,
  startCodexSignIn
} from '../src/providers/codex.js';
import { normalizeCodex } from '../src/providers/normalize.js';
import { openaiSource } from '../src/providers/openai-source.js';
import { UsageService } from '../src/service.js';
import { LastReadings } from '../src/last-readings.js';
import type { AccountRecord } from '../src/accounts.js';

const root = process.cwd();
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

// Fake Codex app-server: records each message with the CODEX_HOME it ran under, then defers to handle(m).
const prelude = `const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
fs.writeFileSync(path.join(__dirname,'pid'),String(process.pid));
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const home=process.env.CODEX_HOME??null;
const email=(home||'').endsWith('work')?'Work@Example.com':'One@Example.com';
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(path.join(__dirname,'calls.log'),JSON.stringify({method:m.method,params:m.params??null,home})+'\\n');if(m.method==='initialize')send({id:m.id,result:{}});else if(m.method!=='initialized')handle(m);});
`;
const usage = `if(m.method==='account/rateLimits/read')return send({id:m.id,result:{rateLimits:{primary:{usedPercent:17,windowDurationMins:300},secondary:{usedPercent:41,windowDurationMins:10080}}}});`;
const account = `if(m.method==='account/read')return send({id:m.id,result:{requiresOpenaiAuth:true,account:{type:'chatgpt',email,planType:'pro'}}});`;
const start = (after = '') =>
  `if(m.method==='account/login/start'){send({id:m.id,result:{type:'chatgptDeviceCode',loginId:'login-1',userCode:'ABCD-EFGH',verificationUrl:'https://auth.openai.com/codex/device'}});${after}return;}`;
const cancel = `if(m.method==='account/login/cancel')return send({id:m.id,result:{status:'canceled'}});`;
const completed = (success: boolean) =>
  `setTimeout(()=>send({method:'account/login/completed',params:{loginId:'other-login',success:false}}),10);setTimeout(()=>send({method:'account/login/completed',params:{loginId:'login-1',success:${success},error:${success ? 'null' : "'denied'"}}}),40);`;

async function fakeCodex(dir: string, ...handlers: string[]) {
  await rm(path.join(dir, 'calls.log'), { force: true });
  await writeFile(
    path.join(dir, 'app-server'),
    `${prelude}function handle(m){${handlers.join('')}process.exit(2);}`
  );
}
const calls = async (
  dir: string
): Promise<{ method: string; params: unknown; home: string | null }[]> =>
  (await readFile(path.join(dir, 'calls.log'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
const pidOf = async (dir: string) =>
  Number(await readFile(path.join(dir, 'pid'), 'utf8'));
async function gone(pid: number) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}
const record = (
  home: string | undefined,
  key = 'work@example.com'
): AccountRecord => ({
  id: 'openai-00000001',
  provider: 'openai',
  key,
  nick: 'WO',
  name: key,
  ...(home ? { home } : {}),
  addedAt: 1
});

async function workspace(name: string) {
  const dir = await mkdtemp(path.join(tmpdir(), `ai-usage-codex-${name}-`));
  const previous = process.env.AI_USAGE_DATA_DIR;
  process.env.AI_USAGE_DATA_DIR = path.join(dir, 'data');
  process.chdir(dir);
  return {
    dir,
    done: async () => {
      process.chdir(root);
      if (previous === undefined) delete process.env.AI_USAGE_DATA_DIR;
      else process.env.AI_USAGE_DATA_DIR = previous;
      await cleanup(dir);
    }
  };
}

test('Codex reads pass the sign-in folder and return the account beside the usage', async () => {
  const env = await workspace('read');
  try {
    await fakeCodex(env.dir, usage, account);
    const work = path.join(env.dir, 'work');
    const result = (await readCodex(process.execPath, 3000, {
      codexHome: work
    })) as {
      rateLimits: { primary: { usedPercent: number } };
      account: { email: string };
    };
    assert.equal(result.rateLimits.primary.usedPercent, 17);
    assert.equal(result.account.email, 'Work@Example.com');
    assert.deepEqual(
      normalizeCodex(result, 'codex', 1),
      normalizeCodex({ rateLimits: result.rateLimits }, 'codex', 1)
    );
    const seen = await calls(env.dir);
    assert.deepEqual(
      seen.map((call) => call.method),
      ['initialize', 'initialized', 'account/rateLimits/read', 'account/read']
    );
    assert.ok(seen.every((call) => call.home === work));
    await fakeCodex(env.dir, usage, account);
    await readCodex(process.execPath, 3000);
    assert.ok(
      (await calls(env.dir)).every(
        (call) => call.home === (process.env.CODEX_HOME ?? null)
      )
    );
  } finally {
    await env.done();
  }
});

test('Codex usage still arrives when the account cannot be reported', async () => {
  const env = await workspace('noaccount');
  try {
    await fakeCodex(
      env.dir,
      usage,
      `if(m.method==='account/read')return send({id:m.id,error:{code:-32601,message:'unknown'}});`
    );
    const result = (await readCodex(process.execPath, 3000)) as Record<
      string,
      unknown
    >;
    assert.equal(Object.hasOwn(result, 'account'), false);
    assert.equal(normalizeCodex(result).short?.used, 17);
    await fakeCodex(env.dir, usage, `if(m.method==='account/read')return;`);
    const slow = (await readCodex(process.execPath, 300)) as Record<
      string,
      unknown
    >;
    assert.equal(Object.hasOwn(slow, 'account'), false);
    assert.equal(normalizeCodex(slow).weekly?.used, 41);
    await fakeCodex(
      env.dir,
      usage,
      `if(m.method==='account/read')return send({id:m.id,result:{requiresOpenaiAuth:true,account:null}});`
    );
    assert.equal(
      ((await readCodex(process.execPath, 3000)) as Record<string, unknown>)
        .account,
      null
    );
  } finally {
    await env.done();
  }
});

test('Codex identities use the email, or the sign-in folder without one', () => {
  assert.deepEqual(
    codexIdentity({
      type: 'chatgpt',
      email: ' One@Example.com ',
      planType: 'pro'
    }),
    { key: 'one@example.com', label: 'One@Example.com' }
  );
  assert.deepEqual(
    codexIdentity({ type: 'apiKey' }, '/data/accounts/openai/a1'),
    { key: 'codex-home:/data/accounts/openai/a1', label: 'ChatGPT account' }
  );
  assert.deepEqual(
    codexIdentity({ type: 'chatgpt', email: null, planType: 'pro' }),
    { key: 'codex-home:default', label: 'ChatGPT account' }
  );
  for (const value of [null, undefined, 'one@example.com', []])
    assert.deepEqual(codexIdentity(value), {
      key: 'codex-home:default',
      label: 'ChatGPT account'
    });
});

test('the ChatGPT source follows the default sign-in and reads chosen accounts from their own folder', async () => {
  const env = await workspace('source');
  try {
    await fakeCodex(env.dir, usage, account);
    const settings = { codexPath: process.execPath };
    const active = await openaiSource.readActive(settings);
    assert.equal(active.short?.used, 17);
    assert.deepEqual(active.account, {
      key: 'one@example.com',
      label: 'One@Example.com'
    });
    assert.equal(await openaiSource.activeKey!(settings), 'one@example.com');
    assert.ok(
      (await calls(env.dir)).every(
        (call) => call.home === (process.env.CODEX_HOME ?? null)
      )
    );

    const noFolder =
      /^Error: This ChatGPT account has no sign-in folder\. Add it again\.$/;
    await assert.rejects(
      openaiSource.readAccount(record(undefined), settings),
      noFolder
    );
    await assert.rejects(
      openaiSource.readAccount(
        record(path.join(env.dir, 'missing-work')),
        settings
      ),
      noFolder
    );
    const work = path.join(env.dir, 'work');
    await mkdir(work);
    await fakeCodex(env.dir, usage, account);
    const chosen = await openaiSource.readAccount(record(work), settings);
    assert.equal(chosen.weekly?.used, 41);
    assert.deepEqual(chosen.account, {
      key: 'work@example.com',
      label: 'Work@Example.com'
    });
    assert.ok((await calls(env.dir)).every((call) => call.home === work));
    await assert.rejects(
      openaiSource.readAccount(record(work, 'someone@example.com'), settings),
      /signed into a different ChatGPT account/
    );

    // The real service registers the signed-in account and keeps its reading in the data folder.
    const service = new UsageService();
    assert.equal((await service.get('openai', settings)).short?.used, 17);
    assert.equal(
      await service.nicknameFor(
        'openai',
        settings,
        await service.get('openai', settings)
      ),
      'ON'
    );
    assert.equal(
      (
        await new LastReadings(
          path.join(env.dir, 'data', 'last-readings.json')
        ).get('openai', 'one@example.com')
      )?.short?.used,
      17
    );
  } finally {
    await env.done();
  }
});

test('adding a ChatGPT account signs in with a device code inside a new private folder', async () => {
  const env = await workspace('signin');
  try {
    await fakeCodex(env.dir, start(completed(true)), account);
    const home = path.join(env.dir, 'accounts', 'openai', 'new');
    const signIn = await openaiSource.startSignIn!(
      { codexPath: process.execPath },
      home
    );
    assert.equal(signIn.kind, 'code');
    if (signIn.kind !== 'code') return;
    assert.equal(signIn.url, 'https://auth.openai.com/codex/device');
    assert.equal(signIn.code, 'ABCD-EFGH');
    assert.deepEqual(await signIn.done, {
      key: 'one@example.com',
      label: 'One@Example.com'
    });
    if (process.platform !== 'win32')
      assert.equal((await stat(home)).mode & 0o777, 0o700);
    const seen = await calls(env.dir);
    assert.ok(seen.every((call) => call.home === home));
    assert.deepEqual(
      seen.find((call) => call.method === 'account/login/start')?.params,
      { type: 'chatgptDeviceCode' }
    );
    assert.ok(
      seen.findIndex((call) => call.method === 'account/read') >
        seen.findIndex((call) => call.method === 'account/login/start')
    );
    assert.ok(await gone(await pidOf(env.dir)));
    signIn.cancel();
    assert.equal(
      (await calls(env.dir)).some(
        (call) => call.method === 'account/login/cancel'
      ),
      false
    );
  } finally {
    await env.done();
  }
});

test('a declined or interrupted ChatGPT sign-in rejects', async () => {
  const env = await workspace('declined');
  const home = path.join(env.dir, 'home');
  try {
    await fakeCodex(env.dir, start(completed(false)), account);
    const declined = await startCodexSignIn(process.execPath, home, {
      timeoutMs: 3000
    });
    await assert.rejects(
      declined.done,
      /^Error: ChatGPT sign-in did not complete\. Try again\.$/
    );
    assert.ok(await gone(await pidOf(env.dir)));

    await fakeCodex(env.dir, start('setTimeout(()=>process.exit(0),30);'));
    await assert.rejects(
      (await startCodexSignIn(process.execPath, home, { timeoutMs: 3000 }))
        .done,
      /Codex closed before the sign-in finished/
    );

    await fakeCodex(
      env.dir,
      `if(m.method==='account/login/start')return send({id:m.id,error:{code:-32600,message:'unsupported'}});`
    );
    await assert.rejects(
      startCodexSignIn(process.execPath, home, { timeoutMs: 3000 }),
      /Codex could not start a ChatGPT sign-in/
    );
    assert.ok(await gone(await pidOf(env.dir)));

    await fakeCodex(
      env.dir,
      `if(m.method==='account/login/start')return send({id:m.id,result:{type:'chatgptDeviceCode',loginId:'login-1',userCode:'ABCD-EFGH',verificationUrl:'http://example.com/device'}});`
    );
    await assert.rejects(
      startCodexSignIn(process.execPath, home, { timeoutMs: 3000 }),
      /unexpected sign-in response/
    );

    await fakeCodex(env.dir, 'return;');
    await assert.rejects(
      startCodexSignIn(process.execPath, home, { startTimeoutMs: 150 }),
      /did not start the sign-in in time/
    );
    assert.ok(await gone(await pidOf(env.dir)));
  } finally {
    await env.done();
  }
});

test('cancelling a ChatGPT sign-in tells Codex and stops it', async () => {
  const env = await workspace('cancel');
  try {
    await fakeCodex(env.dir, start(), cancel);
    const signIn = await startCodexSignIn(
      process.execPath,
      path.join(env.dir, 'home'),
      { timeoutMs: 5000 }
    );
    const pid = await pidOf(env.dir);
    signIn.cancel();
    signIn.cancel();
    await assert.rejects(signIn.done, /^Error: Sign-in cancelled\.$/);
    assert.deepEqual(
      (await calls(env.dir))
        .filter((call) => call.method === 'account/login/cancel')
        .map((call) => call.params),
      [{ loginId: 'login-1' }]
    );
    assert.ok(await gone(pid));
  } finally {
    await env.done();
  }
});

test('a ChatGPT sign-in that is never approved times out and stops Codex', async () => {
  const env = await workspace('timeout');
  try {
    await fakeCodex(env.dir, start(), cancel);
    // Process startup is independent of the short approval deadline under test.
    const signIn = await startCodexSignIn(
      process.execPath,
      path.join(env.dir, 'home'),
      { startTimeoutMs: 3000, timeoutMs: 150 }
    );
    assert.equal(signIn.code, 'ABCD-EFGH');
    const pid = await pidOf(env.dir);
    await assert.rejects(
      signIn.done,
      /^Error: Sign-in timed out\. Start again to get a new code\.$/
    );
    assert.ok(
      (await calls(env.dir)).some(
        (call) => call.method === 'account/login/cancel'
      )
    );
    assert.ok(await gone(pid));
  } finally {
    await env.done();
  }
});

test('the signed-in account is read without asking for usage', async () => {
  const env = await workspace('active');
  try {
    await fakeCodex(env.dir, account);
    assert.deepEqual(
      await readCodexAccount(process.execPath, 3000, {
        codexHome: path.join(env.dir, 'work')
      }),
      { type: 'chatgpt', email: 'Work@Example.com', planType: 'pro' }
    );
    assert.deepEqual(
      (await calls(env.dir)).map((call) => call.method),
      ['initialize', 'initialized', 'account/read']
    );
    await fakeCodex(env.dir, 'return;');
    await assert.rejects(
      readCodexAccount(process.execPath, 150),
      /did not report its account/
    );
  } finally {
    await env.done();
  }
});

test('cancellation waits for a delayed acknowledgement and ignores late login success', async () => {
  const env = await workspace('delayed-cancel');
  try {
    await fakeCodex(
      env.dir,
      start(),
      `if(m.method==='account/login/cancel'){
      send({method:'account/login/completed',params:{loginId:'login-1',success:true}});
      setTimeout(()=>{fs.writeFileSync(path.join(__dirname,'cancelled'),'yes');send({id:m.id,result:{status:'canceled'}})},150);
      return;
    }`
    );
    const signIn = await startCodexSignIn(
      process.execPath,
      path.join(env.dir, 'home')
    );
    const pid = await pidOf(env.dir);
    signIn.cancel();
    await assert.rejects(signIn.done, /^Error: Sign-in cancelled\.$/);
    assert.equal(
      await readFile(path.join(env.dir, 'cancelled'), 'utf8'),
      'yes'
    );
    assert.equal(
      (await calls(env.dir)).some((call) => call.method === 'account/read'),
      false
    );
    assert.ok(await gone(pid));
  } finally {
    await env.done();
  }
});

test(
  'cancellation stops an unresponsive Codex process within a bounded deadline',
  { timeout: 10000 },
  async () => {
    const env = await workspace('silent-cancel');
    try {
      await fakeCodex(
        env.dir,
        start(),
        `if(m.method==='account/login/cancel')return;`
      );
      const signIn = await startCodexSignIn(
        process.execPath,
        path.join(env.dir, 'home')
      );
      const pid = await pidOf(env.dir);
      signIn.cancel();
      await assert.rejects(signIn.done, /^Error: Sign-in cancelled\.$/);
      assert.ok(await gone(pid));
    } finally {
      await env.done();
    }
  }
);
