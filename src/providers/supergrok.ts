import {
  access,
  chmod,
  constants,
  mkdir,
  readFile,
  stat
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { AccountIdentity, Snapshot } from '../model.js';
import type { SignIn } from '../sources.js';
import { object } from './normalize.js';
import { currentHost, hostPath, type Host } from '../platform.js';

// Read-only billing summary the Grok CLI uses for the SuperGrok shared weekly pool (unified billing).
// Only the session key is used. Refresh tokens are never read, and sessions are never renewed here.
const endpoint = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
const signIn =
  'Sign in to the Grok CLI (run grok login) to connect SuperGrok usage.';
const expired = 'SuperGrok sign-in expired. Run grok once to renew it.';
const productLabels = new Map([
  ['GrokBuild', 'Build'],
  ['GrokChat', 'Chat'],
  ['Chat', 'Chat'],
  ['Imagine', 'Imagine'],
  ['Voice', 'Voice'],
  ['GrokImagineVideo', 'Imagine Video']
]);
const productLabel = (product: string) => productLabels.get(product) ?? 'Other';
const expiry = (session: Record<string, unknown>) =>
  typeof session.expires_at === 'string' ? Date.parse(session.expires_at) : NaN;
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
const identityOf = (email: string): AccountIdentity => {
  const label = email.trim();
  return { key: label.toLowerCase(), label };
};

export function normalizeSuperGrokUsage(
  data: unknown,
  now = Date.now()
): Snapshot {
  const config = object(object(data).config);
  const used = config.creditUsagePercent;
  if (
    typeof used !== 'number' ||
    !Number.isFinite(used) ||
    used < 0 ||
    used > 100
  )
    throw new Error('SuperGrok has not reported a valid usage percentage.');
  const period = object(config.currentPeriod);
  const start =
    typeof period.start === 'string' ? Date.parse(period.start) : NaN;
  const end = typeof period.end === 'string' ? Date.parse(period.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error('SuperGrok has not reported a valid usage period.');
  const minutes = Math.round((end - start) / 60000);
  if (minutes !== 10080)
    throw new Error('SuperGrok reported an unsupported usage period.');
  // Included pool only: on-demand, prepaid and top-up fields are ignored.
  const breakdown = (
    Array.isArray(config.productUsage) ? config.productUsage : []
  )
    .map((entry) => object(entry))
    .filter(
      (entry) =>
        typeof entry.product === 'string' &&
        entry.product &&
        typeof entry.usagePercent === 'number' &&
        Number.isFinite(entry.usagePercent) &&
        entry.usagePercent >= 0 &&
        entry.usagePercent <= 100
    )
    .map((entry) => ({
      label: productLabel(entry.product as string),
      used: entry.usagePercent as number
    }));
  return {
    observedAt: now,
    weekly: { used, minutes, resetsAt: end / 1000 },
    source: 'SuperGrok subscription · shared weekly pool',
    ...(breakdown.length ? { breakdown } : {})
  };
}

/** Picks one CLI session, reading only key, email and expires_at. */
export function selectSuperGrokSession(
  data: unknown,
  account?: string
): { key: string; email: string; expiresAt: number } {
  const sessions = Object.values(object(data))
    .map((value) => object(value))
    .filter(
      (session) =>
        typeof session.key === 'string' &&
        session.key &&
        typeof session.email === 'string'
    );
  if (!sessions.length) throw new Error(signIn);
  const wanted = account?.trim().toLowerCase();
  const matches = wanted
    ? sessions.filter(
        (session) => (session.email as string).trim().toLowerCase() === wanted
      )
    : sessions;
  if (wanted && !matches.length)
    throw new Error(
      'No Grok CLI sign-in matches the account email in Connection settings.'
    );
  if (matches.length > 1 && !wanted)
    throw new Error(
      'Several Grok accounts are signed in. Enter the account email under Connection settings.'
    );
  // Several sessions for the same email are interchangeable: use the one that lasts longest.
  const session = matches.reduce((best, next) =>
    expiry(next) > expiry(best) ? next : best
  );
  const key = session.key as string;
  if (/[\r\n]/.test(key))
    throw new Error('Grok CLI sign-in format changed. Run grok login again.');
  return { key, email: session.email as string, expiresAt: expiry(session) };
}

export function superGrokEmails(data: unknown): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const value of Object.values(object(data))) {
    const session = object(value);
    if (
      typeof session.key !== 'string' ||
      !session.key ||
      typeof session.email !== 'string'
    )
      continue;
    const email = session.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export async function readSuperGrokAuth(
  host: Host = currentHost(),
  home?: string
): Promise<unknown> {
  const p = hostPath(host);
  const file = p.join(home ?? p.join(host.home, '.grok'), 'auth.json');
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    throw new Error(signIn);
  }
  if (size > 8 * 1024 * 1024)
    throw new Error('Grok CLI sign-in file is too large.');
  // Drop refresh tokens while parsing; they are never used.
  try {
    return JSON.parse(await readFile(file, 'utf8'), (name, value) =>
      name === 'refresh_token' ? undefined : value
    );
  } catch {
    throw new Error(
      'Grok CLI sign-in file could not be read. Run grok login again.'
    );
  }
}

export async function readSuperGrokUsage(
  account?: string,
  readAuth: () => Promise<unknown> = readSuperGrokAuth,
  request: typeof fetch = fetch
): Promise<Snapshot> {
  const { key, email, expiresAt } = selectSuperGrokSession(
    await readAuth(),
    account
  );
  // CLI sessions last about six hours and only the CLI renews them. Keep the last reading instead of sending an expired key.
  if (expiresAt <= Date.now()) throw new Error(expired);
  let response: Response;
  try {
    response = await request(endpoint, {
      headers: {
        Authorization: `Bearer ${key}`,
        'x-xai-token-auth': 'xai-grok-cli',
        Accept: 'application/json'
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new Error(
      'SuperGrok usage service is unreachable. Retrying shortly.'
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new Error(expired);
  if (!response.ok)
    throw new Error(
      `SuperGrok usage request failed (HTTP ${response.status}).`
    );
  return {
    ...normalizeSuperGrokUsage(await response.json()),
    account: identityOf(email)
  };
}

/** Pulls the device-auth URL and confirm code from Grok CLI output once both are present. */
export function parseSuperGrokSignIn(
  text: string
): { url: string; code: string } | undefined {
  const clean = stripAnsi(text);
  const url = clean.match(/https:\/\/accounts\.x\.ai\/\S+/)?.[0];
  const code = clean.match(/^[ \t]*([A-Z0-9]{4}-[A-Z0-9]{4})[ \t]*$/m)?.[1];
  return url && code ? { url, code } : undefined;
}

const fileExists = async (file: string) => {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export async function findGrokExecutable(
  host: Host = currentHost(),
  exists: (file: string) => Promise<boolean> = fileExists
): Promise<string | undefined> {
  const p = hostPath(host);
  const candidates = [p.join(host.home, '.grok', 'bin', 'grok')];
  for (const dir of (host.env.PATH || '').split(p.delimiter)) {
    if (!dir || !p.isAbsolute(dir)) continue;
    candidates.push(p.join(dir, 'grok'));
  }
  candidates.push('/opt/homebrew/bin/grok', '/usr/local/bin/grok');
  for (const file of candidates) if (await exists(file)) return file;
  return undefined;
}

export type SuperGrokSignInOptions = {
  host?: Host;
  executable?: string;
  timeoutMs?: number;
  startTimeoutMs?: number;
};

export async function startSuperGrokSignIn(
  home: string,
  options: SuperGrokSignInOptions = {}
): Promise<SignIn> {
  const host = options.host ?? currentHost();
  const executable = options.executable ?? (await findGrokExecutable(host));
  if (!executable || !(await fileExists(executable)))
    throw new Error('Grok CLI was not found. Install it, then try again.');
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);

  const child = spawn(executable, ['login', '--device-auth'], {
    env: { ...process.env, GROK_HOME: home },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  let exitCode: number | null | undefined;
  let spawnError: Error | undefined;
  let cancelled = false;
  let timedOut = false;
  const exitWaiters: Array<() => void> = [];
  const notifyExit = () => {
    for (const wait of exitWaiters.splice(0)) wait();
  };

  const stop = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  };

  const waitForExit = () =>
    new Promise<void>((resolve) => {
      if (exitCode !== undefined || spawnError) resolve();
      else exitWaiters.push(resolve);
    });

  child.on('error', (error) => {
    spawnError =
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? new Error('Grok CLI was not found. Install it, then try again.')
        : new Error(`Grok CLI sign-in could not start (${error.message}).`);
    exitCode = 1;
    notifyExit();
  });
  child.on('exit', (code, signal) => {
    exitCode = code ?? (signal ? 1 : 0);
    notifyExit();
  });

  const prompt = await new Promise<{ url: string; code: string }>(
    (resolve, reject) => {
      let settled = false;
      let startTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error, value?: { url: string; code: string }) => {
        if (settled) return;
        settled = true;
        if (startTimer) clearTimeout(startTimer);
        child.stdout?.off('data', onData);
        if (error) reject(error);
        else resolve(value!);
      };
      const onData = (chunk: string) => {
        output += chunk;
        const parsed = parseSuperGrokSignIn(output);
        if (parsed) finish(undefined, parsed);
      };
      const onEarlyExit = () => {
        if (spawnError) finish(spawnError);
        else
          finish(
            new Error(
              `Grok CLI sign-in could not start (exit code ${exitCode ?? 1}).`
            )
          );
      };
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', onData);
      if (exitCode !== undefined || spawnError) onEarlyExit();
      else exitWaiters.push(onEarlyExit);
      if (options.startTimeoutMs !== undefined) {
        startTimer = setTimeout(() => {
          stop();
          finish(
            new Error(
              'The Grok CLI did not show a sign-in code. Update it and try again.'
            )
          );
        }, options.startTimeoutMs);
      }
    }
  ).catch((error) => {
    stop();
    throw error;
  });

  // Prompt is available: from here callers own cancel/done. Drop the early-exit waiter used above.
  exitWaiters.length = 0;

  let doneTimer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  doneTimer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);

  const cancel = () => {
    cancelled = true;
    stop();
  };

  const done = (async (): Promise<AccountIdentity> => {
    try {
      await waitForExit();
      if (doneTimer) clearTimeout(doneTimer);
      if (cancelled) throw new Error('Grok CLI sign-in was cancelled.');
      if (timedOut) throw new Error('Grok CLI sign-in timed out. Try again.');
      if (spawnError) throw spawnError;
      if (exitCode !== 0)
        throw new Error(
          `Grok CLI sign-in did not finish (exit code ${exitCode ?? 1}).`
        );
      try {
        const session = selectSuperGrokSession(
          await readSuperGrokAuth(host, home)
        );
        return identityOf(session.email);
      } catch {
        throw new Error(
          'The Grok CLI finished without saving a sign-in. Try again.'
        );
      }
    } finally {
      if (doneTimer) clearTimeout(doneTimer);
    }
  })();

  return { kind: 'code', url: prompt.url, code: prompt.code, done, cancel };
}
