import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { access, chmod, mkdir, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { constants } from 'node:fs';
import type { AccountIdentity } from '../model.js';
import { object } from './normalize.js';
import { macCodexCandidates } from '../platform.js';

export async function isExecutableFile(file: string): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(
      file,
      process.platform === 'win32' ? constants.F_OK : constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

export async function findBundledCodex(
  root: string
): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });
  const candidates: { executable: string; modified: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const executable = path.join(root, entry.name, 'codex.exe');
    try {
      const info = await stat(executable);
      if (info.isFile())
        candidates.push({ executable, modified: info.mtimeMs });
    } catch {
      /* Some desktop bundles contain helpers only. */
    }
  }
  return candidates.sort((a, b) => b.modified - a.modified)[0]?.executable;
}

export async function findCodex(configured?: string): Promise<string> {
  if (configured?.trim()) {
    const executable = configured.trim();
    if (!path.isAbsolute(executable) || /\.(cmd|bat|ps1)$/i.test(executable))
      throw new Error(
        'Choose the full path to the Codex executable, not a shell script.'
      );
    if (!(await isExecutableFile(executable)))
      throw new Error('The Codex path must point to an executable file.');
    return executable;
  }
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  if (process.platform === 'darwin') {
    for (const candidate of macCodexCandidates())
      if (await isExecutableFile(candidate)) return candidate;
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  if (process.platform === 'win32') {
    const root = path.join(
      process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
      'OpenAI',
      'Codex',
      'bin'
    );
    try {
      const executable = await findBundledCodex(root);
      if (executable) return executable;
    } catch {
      /* Fall through to setup instructions. */
    }
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
    const triple =
      architecture === 'arm64'
        ? 'aarch64-pc-windows-msvc'
        : 'x86_64-pc-windows-msvc';
    const npmBinary = path.join(
      process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'),
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'node_modules',
      '@openai',
      `codex-win32-${architecture}`,
      'vendor',
      triple,
      'bin',
      'codex.exe'
    );
    try {
      await access(npmBinary);
      return npmBinary;
    } catch {
      /* No global npm installation. */
    }
  }
  throw new Error(
    'Codex executable not found. Choose its full path in Connection settings.'
  );
}

function spawnCodex(
  executable: string,
  codexHome?: string
): ChildProcessWithoutNullStreams {
  const env =
    codexHome !== undefined
      ? { ...process.env, CODEX_HOME: codexHome }
      : { ...process.env };
  return spawn(executable, ['app-server'], {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env
  });
}

export function codexIdentity(
  account: unknown,
  home?: string
): AccountIdentity {
  const email =
    account && typeof account === 'object' && !Array.isArray(account)
      ? object(account).email
      : undefined;
  if (typeof email === 'string' && email.trim()) {
    const label = email.trim();
    return { key: label.toLowerCase(), label };
  }
  return { key: `codex-home:${home || 'default'}`, label: 'ChatGPT account' };
}

/** Read-only RPC: no conversations, turns, or model requests are created. */
export async function readCodex(
  executable: string,
  timeoutMs = 20_000,
  options?: { codexHome?: string }
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawnCodex(executable, options?.codexHome);
    let settled = false;
    let rateLimits: unknown;
    const lines = createInterface({ input: child.stdout });
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      // Wait for process handles to close before the next poll or caller cleanup.
      child.once('close', () => (error ? reject(error) : resolve(result)));
      child.stdin.end();
      child.kill();
    };
    const timer = setTimeout(() => {
      if (rateLimits !== undefined) finish(undefined, rateLimits);
      else
        finish(
          new Error(
            'Codex usage request timed out. Check your connection and sign-in.'
          )
        );
    }, timeoutMs);
    // Drain stderr without logging auth details or unrelated app-server state.
    child.stderr.resume();
    child.on('error', () =>
      finish(new Error('Could not start Codex. Check the executable path.'))
    );
    child.on('exit', () => {
      if (rateLimits !== undefined) finish(undefined, rateLimits);
      else
        finish(
          new Error(
            'Codex exited before returning usage. Check your Codex sign-in.'
          )
        );
    });
    child.stdin.on('error', () => {
      if (rateLimits !== undefined) finish(undefined, rateLimits);
      else finish(new Error('Codex connection closed.'));
    });
    const send = (message: unknown) =>
      child.stdin.write(JSON.stringify(message) + '\n');
    lines.on('line', (line) => {
      let message;
      try {
        message = object(JSON.parse(line));
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error)
          return finish(
            new Error('Codex initialization failed. Update Codex and retry.')
          );
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'account/rateLimits/read' });
      } else if (message.id === 2) {
        if (message.error)
          return finish(
            new Error(
              'Usage unavailable. Sign in to Codex with your ChatGPT subscription, then retry.'
            )
          );
        rateLimits = message.result;
        send({ id: 3, method: 'account/read' });
      } else if (message.id === 3) {
        if (message.error) return finish(undefined, rateLimits);
        const accountResult = object(message.result);
        if (!Object.hasOwn(accountResult, 'account'))
          return finish(undefined, rateLimits);
        finish(undefined, {
          ...object(rateLimits),
          account: accountResult.account
        });
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'streamdeck_ai_usage',
          title: 'Stream Deck AI Usage',
          version: '0.1.0'
        }
      }
    });
  });
}

/** Read the signed-in account only; no rate-limit request. */
export async function readCodexAccount(
  executable: string,
  timeoutMs = 20_000,
  options?: { codexHome?: string }
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawnCodex(executable, options?.codexHome);
    let settled = false;
    const lines = createInterface({ input: child.stdout });
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.once('close', () => (error ? reject(error) : resolve(result)));
      child.stdin.end();
      child.kill();
    };
    const timer = setTimeout(
      () => finish(new Error('Codex did not report its account in time.')),
      timeoutMs
    );
    child.stderr.resume();
    child.on('error', () =>
      finish(new Error('Could not start Codex. Check the executable path.'))
    );
    child.on('exit', () =>
      finish(new Error('Codex exited before it reported its account.'))
    );
    child.stdin.on('error', () =>
      finish(new Error('Codex connection closed.'))
    );
    const send = (message: unknown) =>
      child.stdin.write(JSON.stringify(message) + '\n');
    lines.on('line', (line) => {
      let message;
      try {
        message = object(JSON.parse(line));
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error)
          return finish(
            new Error('Codex initialization failed. Update Codex and retry.')
          );
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'account/read' });
      } else if (message.id === 2) {
        if (message.error)
          return finish(new Error('Codex did not report its account.'));
        const account = object(message.result).account;
        if (!account || typeof account !== 'object' || Array.isArray(account))
          return finish(new Error('Codex did not report its account.'));
        finish(undefined, account);
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'streamdeck_ai_usage',
          title: 'Stream Deck AI Usage',
          version: '0.1.0'
        }
      }
    });
  });
}

export type CodexSignIn = {
  url: string;
  code: string;
  done: Promise<AccountIdentity>;
  cancel(): void;
};

function isDeviceCodeUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('https://auth.openai.com/');
}

/** Device-code ChatGPT sign-in into an isolated CODEX_HOME folder. */
export async function startCodexSignIn(
  executable: string,
  home: string,
  options: { timeoutMs?: number; startTimeoutMs?: number } = {}
): Promise<CodexSignIn> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const startTimeoutMs = options.startTimeoutMs ?? timeoutMs;
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);

  const child = spawnCodex(executable, home);
  let lines: Interface | undefined;
  let nextId = 3;
  let loginId: string | undefined;
  let started = false;
  let finished = false;
  let cancelSent = false;
  let cancelId: number | undefined;
  let cancelError: Error | undefined;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let doneTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveStart!: (value: { url: string; code: string }) => void;
  let rejectStart!: (error: Error) => void;
  let resolveDone!: (value: AccountIdentity) => void;
  let rejectDone!: (error: Error) => void;
  const startPromise = new Promise<{ url: string; code: string }>(
    (resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    }
  );
  const done = new Promise<AccountIdentity>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // Prevent unhandled rejection if the caller never awaits done after a start failure.
  done.catch(() => {});

  const stop = (error?: Error, identity?: AccountIdentity) => {
    if (finished) return;
    finished = true;
    error = cancelError ?? error;
    if (cancelTimer) clearTimeout(cancelTimer);
    if (startTimer) clearTimeout(startTimer);
    if (doneTimer) clearTimeout(doneTimer);
    lines?.close();
    try {
      child.stdin.end();
    } catch {
      /* already closed */
    }
    child.kill();
    if (!started)
      rejectStart(
        error ?? new Error('Codex closed before the sign-in finished.')
      );
    if (identity) resolveDone(identity);
    else
      rejectDone(
        error ?? new Error('Codex closed before the sign-in finished.')
      );
  };

  const send = (message: unknown) => {
    try {
      child.stdin.write(JSON.stringify(message) + '\n');
    } catch {
      /* stdin closed */
    }
  };

  // Wait for the cancellation reply, with bounded teardown if Codex stops responding.
  const cancelAndStop = (error: Error) => {
    if (finished || cancelSent) return;
    cancelSent = true;
    cancelError = error;
    if (startTimer) clearTimeout(startTimer);
    if (doneTimer) clearTimeout(doneTimer);
    if (!loginId) return stop(error);
    cancelId = nextId++;
    cancelTimer = setTimeout(() => stop(error), 1000);
    send({
      id: cancelId,
      method: 'account/login/cancel',
      params: { loginId }
    });
  };

  const cancel = () => cancelAndStop(new Error('Sign-in cancelled.'));

  startTimer = setTimeout(
    () => stop(new Error('Codex did not start the sign-in in time.')),
    startTimeoutMs
  );

  child.stderr.resume();
  child.on('error', () =>
    stop(new Error('Could not start Codex. Check the executable path.'))
  );
  child.on('exit', () =>
    stop(new Error('Codex closed before the sign-in finished.'))
  );
  child.stdin.on('error', () => stop(new Error('Codex connection closed.')));

  lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try {
      message = object(JSON.parse(line));
    } catch {
      return;
    }

    if (cancelSent) {
      if (message.id === cancelId) stop(cancelError);
      return;
    }

    if (message.method === 'account/login/completed') {
      if (!started || finished) return;
      const params = object(message.params);
      if (params.loginId !== loginId) return;
      if (!params.success)
        return stop(new Error('ChatGPT sign-in did not complete. Try again.'));
      const accountId = nextId++;
      send({ id: accountId, method: 'account/read' });
      return;
    }

    if (message.id === 1) {
      if (message.error)
        return stop(
          new Error('Codex initialization failed. Update Codex and retry.')
        );
      send({ method: 'initialized', params: {} });
      send({
        id: 2,
        method: 'account/login/start',
        params: { type: 'chatgptDeviceCode' }
      });
      return;
    }

    if (message.id === 2) {
      if (message.error)
        return stop(new Error('Codex could not start a ChatGPT sign-in.'));
      const result = object(message.result);
      if (
        result.type !== 'chatgptDeviceCode' ||
        typeof result.loginId !== 'string' ||
        typeof result.userCode !== 'string' ||
        !isDeviceCodeUrl(result.verificationUrl)
      ) {
        return stop(
          new Error('Codex returned an unexpected sign-in response.')
        );
      }
      loginId = result.loginId;
      started = true;
      if (startTimer) clearTimeout(startTimer);
      doneTimer = setTimeout(
        () =>
          cancelAndStop(
            new Error('Sign-in timed out. Start again to get a new code.')
          ),
        timeoutMs
      );
      resolveStart({ url: result.verificationUrl, code: result.userCode });
      return;
    }

    if (typeof message.id === 'number' && message.id >= 3) {
      const account = object(message.result).account;
      // login/cancel replies have no account field; ignore them.
      if (!account || typeof account !== 'object' || Array.isArray(account)) {
        if (message.error)
          stop(new Error('Codex did not report its account after sign-in.'));
        return;
      }
      stop(undefined, codexIdentity(account, home));
    }
  });

  send({
    id: 1,
    method: 'initialize',
    params: {
      clientInfo: {
        name: 'streamdeck_ai_usage',
        title: 'Stream Deck AI Usage',
        version: '0.1.0'
      }
    }
  });

  const { url, code } = await startPromise;
  return { url, code, done, cancel };
}
