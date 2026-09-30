import { readFile, stat } from 'node:fs/promises';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { appDataDirectory, currentHost, type Host } from '../platform.js';
import type { AccountIdentity } from '../model.js';

export class GrokKeychainUnavailable extends Error {
  constructor() {
    super(
      'Grok Bot Keychain access is unavailable. Open Grok Bot, then select Refresh now to retry. Automatic Keychain retries are paused.'
    );
  }
}

const noLongerSignedIn =
  'This Grok Bot account is no longer signed in to Grok Bot.';

function encryptedValue(stored: string): Buffer {
  const value = stored.startsWith('scoped:v1:')
    ? stored.replace(/^scoped:v1:[a-f0-9]{64}:/, '')
    : stored;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new Error('Grok Bot sign-in format changed.');
  const encrypted = Buffer.from(value, 'base64');
  if (encrypted.subarray(0, 3).toString() !== 'v10')
    throw new Error('Grok Bot sign-in format changed.');
  return encrypted;
}

export function decryptMacGrokValue(stored: string, key: Buffer): string {
  const encrypted = encryptedValue(stored);
  if (
    key.length !== 16 ||
    encrypted.length <= 3 ||
    (encrypted.length - 3) % 16 !== 0
  )
    throw new Error('Grok Bot Mac sign-in format changed.');
  // Chromium's v10 macOS safeStorage format: AES-128-CBC with a 16-space IV.
  const cipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([
    cipher.update(encrypted.subarray(3)),
    cipher.final()
  ]).toString('utf8');
}

export function decryptWindowsGrokValue(stored: string, key: Buffer): string {
  const encrypted = encryptedValue(stored);
  if (key.length !== 32 || encrypted.length < 32)
    throw new Error('Grok Bot Windows sign-in format changed.');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    key,
    encrypted.subarray(3, 15)
  );
  cipher.setAuthTag(encrypted.subarray(-16));
  return Buffer.concat([
    cipher.update(encrypted.subarray(15, -16)),
    cipher.final()
  ]).toString('utf8');
}

async function readMacGrokPassword(): Promise<Buffer> {
  try {
    // Query only Grok Bot's own item (service Grok Bot Safe Storage / account Grok Bot Key). macOS may ask the user to allow access.
    // Never log child output or interpolate secrets into command arguments.
    const result = await promisify(execFile)(
      '/usr/bin/security',
      [
        'find-generic-password',
        '-s',
        'Grok Bot Safe Storage',
        '-a',
        'Grok Bot Key',
        '-w'
      ],
      { encoding: 'buffer', timeout: 60_000, maxBuffer: 4096 }
    );
    const output = result.stdout;
    let end = output.length;
    if (output[end - 1] === 10) end--;
    if (output[end - 1] === 13) end--;
    const password = Buffer.from(output.subarray(0, end));
    output.fill(0);
    if (!password.length) throw new Error();
    return password;
  } catch {
    throw new GrokKeychainUnavailable();
  }
}

async function readWindowsGrokKey(): Promise<Buffer> {
  try {
    const command =
      "Add-Type -AssemblyName System.Security; $grokState = Get-Content -LiteralPath (Join-Path $env:APPDATA 'Grok Bot\\Local State') -Raw | ConvertFrom-Json; $grokWrapped = [Convert]::FromBase64String($grokState.os_crypt.encrypted_key); $grokKey = [Security.Cryptography.ProtectedData]::Unprotect($grokWrapped[5..($grokWrapped.Length-1)], $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($grokKey))";
    const result = await promisify(execFile)(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe'
      ),
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 10_000, maxBuffer: 4096 }
    );
    const key = Buffer.from(result.stdout.trim(), 'base64');
    if (key.length !== 32) {
      key.fill(0);
      throw new Error();
    }
    return key;
  } catch {
    throw new Error(
      'Could not unlock the current Windows user’s Grok Bot sign-in.'
    );
  }
}

export type PickedGrokBotAccount = {
  id: string;
  token?: string;
  team?: string;
  profile?: string;
};

// Never read cursor-refresh-token; only touch the named fields below.
export function pickGrokBotAccounts(disk: { 'cursor-accounts'?: unknown }): {
  active: string | undefined;
  accounts: PickedGrokBotAccount[];
} {
  let store: any;
  try {
    const raw = disk['cursor-accounts'];
    store = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!store || typeof store !== 'object' || Array.isArray(store))
      throw new Error();
  } catch {
    throw new Error('Grok Bot account data changed. Reopen Grok Bot Desktop.');
  }
  const entries =
    store.accounts &&
    typeof store.accounts === 'object' &&
    !Array.isArray(store.accounts)
      ? store.accounts
      : {};
  const accounts: PickedGrokBotAccount[] = [];
  for (const id of Object.keys(entries)) {
    const entry = entries[id];
    if (!entry || typeof entry !== 'object') continue;
    const token =
      typeof entry['cursor-access-token'] === 'string'
        ? (entry['cursor-access-token'] as string)
        : undefined;
    const team =
      typeof entry['cursor-selected-team-id'] === 'string'
        ? (entry['cursor-selected-team-id'] as string)
        : undefined;
    const profile =
      typeof entry['cursor-account-profile'] === 'string'
        ? (entry['cursor-account-profile'] as string)
        : undefined;
    accounts.push({ id, token, team, profile });
  }
  return {
    active: typeof store.active === 'string' ? store.active : undefined,
    accounts
  };
}

export function grokBotIdentity(account: {
  id: string;
  email?: string;
}): AccountIdentity {
  if (account.email)
    return { key: account.email.toLowerCase(), label: account.email };
  return { key: `grok-bot:${account.id}`, label: 'Grok Bot account' };
}

async function readSecretsFile(host: Host): Promise<any> {
  // Use process path.join so Windows fixtures written on macOS resolve the same way as production paths on each OS.
  const file = path.join(
    appDataDirectory('Grok Bot', host),
    'sand-secrets.json'
  );
  try {
    if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error();
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error(
      'Open Grok Bot Desktop and sign in to connect subscription usage.'
    );
  }
}

async function unlockGrokKey(
  host: Host,
  readMacPassword: () => Promise<Buffer>,
  readWindowsKey: () => Promise<Buffer>
): Promise<Buffer> {
  if (host.platform === 'darwin') {
    const password = await readMacPassword();
    try {
      return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    } finally {
      password.fill(0);
    }
  }
  return readWindowsKey();
}

function profileEmail(
  profile: string,
  decrypt: (stored: string, key: Buffer) => string,
  key: Buffer
): string | undefined {
  try {
    const parsed = JSON.parse(decrypt(profile, key));
    return typeof parsed?.email === 'string' && parsed.email
      ? parsed.email
      : undefined;
  } catch {
    return undefined;
  }
}

export async function listGrokBotAccounts(
  host: Host = currentHost(),
  readMacPassword: () => Promise<Buffer> = readMacGrokPassword,
  readWindowsKey: () => Promise<Buffer> = readWindowsGrokKey
): Promise<{ id: string; email?: string; active: boolean }[]> {
  const picked = pickGrokBotAccounts(await readSecretsFile(host));
  const signedIn = picked.accounts.filter(
    (account) => typeof account.token === 'string'
  );
  const key = await unlockGrokKey(host, readMacPassword, readWindowsKey);
  const decrypt =
    host.platform === 'darwin' ? decryptMacGrokValue : decryptWindowsGrokValue;
  try {
    return signedIn.map((account) => {
      const email = account.profile
        ? profileEmail(account.profile, decrypt, key)
        : undefined;
      return email === undefined
        ? { id: account.id, active: account.id === picked.active }
        : { id: account.id, email, active: account.id === picked.active };
    });
  } finally {
    key.fill(0);
  }
}

export async function readGrokCredentials(
  host: Host = currentHost(),
  readMacPassword: () => Promise<Buffer> = readMacGrokPassword,
  accountId?: string,
  readWindowsKey: () => Promise<Buffer> = readWindowsGrokKey
): Promise<{ token: string; team?: string }> {
  const picked = pickGrokBotAccounts(await readSecretsFile(host));
  const id = accountId ?? picked.active;
  const account =
    typeof id === 'string'
      ? picked.accounts.find((entry) => entry.id === id)
      : undefined;
  if (typeof account?.token !== 'string') {
    if (accountId !== undefined) throw new Error(noLongerSignedIn);
    throw new Error('No active Grok Bot sign-in found. Open Grok Bot Desktop.');
  }
  const key = await unlockGrokKey(host, readMacPassword, readWindowsKey);
  const decrypt =
    host.platform === 'darwin' ? decryptMacGrokValue : decryptWindowsGrokValue;
  try {
    const token = decrypt(account.token, key);
    const team =
      typeof account.team === 'string' ? decrypt(account.team, key) : undefined;
    if (!token || /[\r\n]/.test(token)) throw new Error();
    return { token, team };
  } catch (error) {
    if (error instanceof Error && error.message === noLongerSignedIn)
      throw error;
    throw new Error(
      'Could not read the active Grok Bot sign-in. Reopen Grok Bot Desktop.'
    );
  } finally {
    key.fill(0);
  }
}
