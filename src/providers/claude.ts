import {
  access,
  chmod,
  constants,
  mkdir,
  readFile,
  readdir,
  stat
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  normalizeClaude,
  normalizeClaudeHistory,
  isClaudeOrgId,
  claudeAccountLabel
} from './normalize.js';
import type { AccountIdentity, Snapshot } from '../model.js';
import type { SignIn } from '../sources.js';
import {
  appDataDirectory,
  currentHost,
  hostPath,
  type Host
} from '../platform.js';

const limit = 8 * 1024 * 1024;
const missingAccount =
  'No reading yet for this Claude account. Use it once in Claude Desktop or Claude Code.';

export const defaultClaudeFile = () =>
  path.join(
    process.env.AI_USAGE_DATA_DIR ||
      path.join(homedir(), '.ai-usage-streamdeck'),
    'claude.json'
  );
export const defaultClaudeDataDir = () =>
  process.env.AI_USAGE_DATA_DIR || path.join(homedir(), '.ai-usage-streamdeck');
export const claudeAccountsDir = (dataDir = defaultClaudeDataDir()) =>
  path.join(dataDir, 'claude-accounts');
export const claudeAccountFile = (
  org: string,
  dataDir = defaultClaudeDataDir()
) => path.join(claudeAccountsDir(dataDir), `${org.toLowerCase()}.json`);

export async function findClaudeHistory(
  host: Host = currentHost()
): Promise<string | undefined> {
  // Desktop discovery is optional when reading explicit files on a build host.
  if (host.platform !== 'darwin' && host.platform !== 'win32') return;
  const p = hostPath(host);
  const candidates = [
    p.join(appDataDirectory('Claude', host), 'plan-usage-history.json')
  ];
  if (host.platform === 'win32')
    try {
      const local =
        host.env.LOCALAPPDATA || p.join(host.home, 'AppData', 'Local');
      const packages = p.join(local, 'Packages');
      for (const entry of await readdir(packages, { withFileTypes: true })) {
        if (entry.isDirectory() && /^Claude_/i.test(entry.name))
          candidates.push(
            p.join(
              packages,
              entry.name,
              'LocalCache',
              'Roaming',
              'Claude',
              'plan-usage-history.json'
            )
          );
      }
    } catch {
      /* Standard installations do not need the Store path. */
    }
  const found: string[] = [];
  for (const file of candidates) {
    try {
      if ((await stat(file)).isFile()) found.push(file);
    } catch {
      /* Not installed here. */
    }
  }
  if (found.length > 1)
    throw new Error(
      'Multiple Claude usage histories found. Choose the active Desktop history in Connection settings.'
    );
  return found[0];
}

async function readJsonFile(file: string): Promise<unknown> {
  if ((await stat(file)).size > limit)
    throw new Error('Claude usage file is too large.');
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function readClaudeUsage(
  configuredFile?: string
): Promise<Snapshot> {
  const file =
    configuredFile?.trim() ||
    (await findClaudeHistory()) ||
    defaultClaudeFile();
  if (!path.isAbsolute(file))
    throw new Error('Choose an absolute Claude usage file path.');
  const data = await readJsonFile(file);
  return Array.isArray((data as { samples?: unknown })?.samples)
    ? normalizeClaudeHistory(data)
    : normalizeClaude(data);
}

export function preferClaudeLabel(
  org: string,
  ...identities: Array<AccountIdentity | undefined>
): AccountIdentity {
  const fallback = claudeAccountLabel(org);
  const label =
    identities
      .map((identity) => identity?.label)
      .find((value) => value && value !== fallback) ||
    identities.find((identity) => identity?.label)?.label ||
    fallback;
  return { key: org.toLowerCase(), label };
}

export async function readClaudeExporterFile(
  file = defaultClaudeFile()
): Promise<Snapshot | undefined> {
  try {
    return normalizeClaude(await readJsonFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

export async function readClaudeAccountFile(
  org: string,
  dataDir = defaultClaudeDataDir()
): Promise<Snapshot | undefined> {
  if (!isClaudeOrgId(org)) return;
  try {
    return normalizeClaude(await readJsonFile(claudeAccountFile(org, dataDir)));
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      error instanceof SyntaxError ||
      (error instanceof Error &&
        /Invalid Claude usage timestamp/.test(error.message))
    )
      return;
    throw error;
  }
}

export async function readClaudeHistoryFile(
  file: string,
  org?: string
): Promise<Snapshot | undefined> {
  try {
    const data = await readJsonFile(file);
    if (!Array.isArray((data as { samples?: unknown })?.samples)) return;
    return normalizeClaudeHistory(data, Date.now(), org);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    // Missing org in an otherwise valid history is not a source for that account.
    if (
      org !== undefined &&
      error instanceof Error &&
      /has not saved a usage reading/.test(error.message)
    )
      return;
    throw error;
  }
}

export async function listClaudeAccountFiles(
  dataDir = defaultClaudeDataDir()
): Promise<AccountIdentity[]> {
  const dir = claudeAccountsDir(dataDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const found: AccountIdentity[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const org = name.slice(0, -5);
    if (!isClaudeOrgId(org)) continue;
    const key = org.toLowerCase();
    const reading = await readClaudeAccountFile(key, dataDir);
    found.push(reading?.account ?? { key, label: claudeAccountLabel(key) });
  }
  return found;
}

export async function listClaudeHistoryOrgs(
  file: string
): Promise<AccountIdentity[]> {
  try {
    const data = await readJsonFile(file);
    const samples = (data as { samples?: unknown })?.samples;
    if (!Array.isArray(samples)) return [];
    const seen = new Map<string, AccountIdentity>();
    for (const entry of samples) {
      const org =
        typeof (entry as { org?: unknown })?.org === 'string'
          ? String((entry as { org: string }).org)
              .trim()
              .toLowerCase()
          : '';
      if (!isClaudeOrgId(org) || seen.has(org)) continue;
      seen.set(org, { key: org, label: claudeAccountLabel(org) });
    }
    return [...seen.values()];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export { missingAccount as claudeMissingAccountMessage };

const fileExists = async (file: string) => {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export async function findClaudeExecutable(
  host: Host = currentHost(),
  exists: (file: string) => Promise<boolean> = fileExists
): Promise<string | undefined> {
  const p = hostPath(host);
  const candidates = [p.join(host.home, '.local', 'bin', 'claude')];
  for (const dir of (host.env.PATH || '').split(p.delimiter)) {
    if (!dir || !p.isAbsolute(dir)) continue;
    candidates.push(p.join(dir, 'claude'));
  }
  candidates.push('/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  for (const file of candidates) if (await exists(file)) return file;
  return undefined;
}

export async function identityFromClaudeHome(
  home: string
): Promise<AccountIdentity | undefined> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(home, '.claude.json'), 'utf8')
    );
    const oauth = raw?.oauthAccount;
    const org =
      typeof oauth?.organizationUuid === 'string'
        ? oauth.organizationUuid.trim().toLowerCase()
        : '';
    if (!isClaudeOrgId(org)) return;
    const email =
      typeof oauth.emailAddress === 'string' ? oauth.emailAddress.trim() : '';
    const name =
      typeof oauth.organizationName === 'string'
        ? oauth.organizationName.trim()
        : '';
    return { key: org, label: email || name || claudeAccountLabel(org) };
  } catch {
    return undefined;
  }
}

export function parseClaudeSignIn(text: string): { url: string } | undefined {
  const url = text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .match(/https:\/\/(?:claude\.ai|console\.anthropic\.com)\/\S+/)?.[0];
  return url ? { url } : undefined;
}

export type ClaudeSignInOptions = {
  host?: Host;
  executable?: string;
  timeoutMs?: number;
  startTimeoutMs?: number;
};

export async function startClaudeSignIn(
  home: string,
  options: ClaudeSignInOptions = {}
): Promise<SignIn> {
  const host = options.host ?? currentHost();
  const executable = options.executable ?? (await findClaudeExecutable(host));
  if (!executable || !(await fileExists(executable)))
    throw new Error('Claude Code was not found. Install it, then try again.');
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);

  const child = spawn(executable, ['auth', 'login', '--claudeai'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: home, HOME: home },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  let exitCode: number | null | undefined;
  let spawnError: Error | undefined;
  let cancelled = false;
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
  child.on('error', (error) => {
    spawnError =
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? new Error('Claude Code was not found. Install it, then try again.')
        : new Error(`Claude sign-in could not start (${error.message}).`);
    exitCode = 1;
    notifyExit();
  });
  child.on('exit', (code, signal) => {
    exitCode = code ?? (signal ? 1 : 0);
    notifyExit();
  });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  const onData = (chunk: string) => {
    output += chunk;
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  const prompt = await new Promise<{ url: string }>((resolve, reject) => {
    let settled = false;
    const startTimer = setTimeout(
      () => finish(undefined, { url: 'https://claude.ai/login' }),
      options.startTimeoutMs ?? 4000
    );
    const finish = (error?: Error, value?: { url: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      if (error) reject(error);
      else resolve(value!);
    };
    const check = () => {
      const parsed = parseClaudeSignIn(output);
      if (parsed) finish(undefined, parsed);
    };
    child.stdout?.on('data', check);
    child.stderr?.on('data', check);
    const onEarly = () => {
      if (spawnError) finish(spawnError);
      else if (exitCode !== undefined && exitCode !== 0)
        finish(
          new Error(
            `Claude sign-in could not start (exit code ${exitCode ?? 1}).`
          )
        );
    };
    if (exitCode !== undefined || spawnError) onEarly();
    else exitWaiters.push(onEarly);
  }).catch((error) => {
    stop();
    throw error;
  });

  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const doneTimer = setTimeout(() => {
    cancelled = true;
    stop();
  }, timeoutMs);

  const done = (async () => {
    while (exitCode === undefined && !spawnError && !cancelled) {
      const identity = await identityFromClaudeHome(home);
      if (identity) {
        stop();
        return identity;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    const identity = await identityFromClaudeHome(home);
    if (identity) return identity;
    if (cancelled) throw new Error('Claude sign-in timed out.');
    if (spawnError) throw spawnError;
    throw new Error(
      'Claude sign-in finished without an account. Approve the browser page, then try again.'
    );
  })().finally(() => {
    clearTimeout(doneTimer);
    stop();
  });

  return {
    kind: 'code',
    url: prompt.url,
    code: 'OPEN',
    done,
    cancel() {
      cancelled = true;
      stop();
    }
  };
}
