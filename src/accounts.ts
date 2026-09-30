import { randomUUID } from 'node:crypto';
import type { Provider, AccountIdentity } from './model.js';

// Registry is data only; plugin.ts stores it in Stream Deck global settings.
export type AccountRecord = {
  id: string;
  provider: Provider;
  key: string;
  nick: string;
  name: string;
  home?: string;
  retiredHomes?: string[];
  addedAt: number;
};
export type Registry = { version: 1; accounts: AccountRecord[] };
export const emptyRegistry = (): Registry => ({ version: 1, accounts: [] });
export const APP_MANAGED: Partial<Record<Provider, string>> = {
  grok: 'Grok Bot manages this account. Remove it inside Grok Bot and it disappears here.',
  cursor: 'Cursor manages its sign-in. Sign out inside Cursor to remove it.'
};
export const CAN_PIN: Record<Provider, boolean> = {
  openai: true,
  anthropic: true,
  grok: true,
  supergrok: true,
  cursor: false
};
export const APP_NAMES: Record<Provider, string> = {
  openai: 'Codex',
  anthropic: 'Claude',
  grok: 'Grok Bot',
  supergrok: 'The Grok CLI',
  cursor: 'Cursor'
};
export class AccountRemovalBlocked extends Error {}
export type KeyAccount =
  { mode: 'follow' } | { mode: 'pinned'; record: AccountRecord };

const missing = 'This account is no longer on the deck.';
const sameKey = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function sanitizeNick(value: string): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
}

export function defaultNick(label: string, taken: string[]): string {
  const at = label.indexOf('@');
  const source = at > 0 ? label.slice(0, at) : label;
  const words = source
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const base =
    (words.length >= 2
      ? words[0][0] + words[1][0]
      : sanitizeNick(source).slice(0, 2)) || 'AC';
  const used = new Set(taken.map(sanitizeNick));
  if (!used.has(base)) return base;
  // Numbered variants still fit the four-character limit.
  for (let n = 2; n < 10_000; n++) {
    const suffix = String(n);
    const candidate = base.slice(0, 4 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

export function upsertIdentity(
  reg: Registry,
  provider: Provider,
  identity: AccountIdentity,
  extras?: { home?: string },
  now = Date.now()
): { registry: Registry; record: AccountRecord; added: boolean } {
  const index = reg.accounts.findIndex(
    (account) =>
      account.provider === provider && sameKey(account.key, identity.key)
  );
  if (index >= 0) {
    const existing = reg.accounts[index];
    if (!extras?.home || extras.home === existing.home)
      return { registry: reg, record: existing, added: false };
    // A fresh sign-in for a known account replaces its sign-in folder.
    const retiredHomes = [
      ...new Set([
        ...(existing.retiredHomes || []),
        ...(existing.home ? [existing.home] : [])
      ])
    ].filter((home) => home !== extras.home);
    const record = { ...existing, home: extras.home, retiredHomes };
    return {
      registry: {
        version: 1,
        accounts: reg.accounts.map((account, i) =>
          i === index ? record : account
        )
      },
      record,
      added: false
    };
  }
  let id: string;
  do id = `${provider}-${randomUUID().slice(0, 8)}`;
  while (reg.accounts.some((account) => account.id === id));
  const nick = defaultNick(
    identity.label,
    reg.accounts
      .filter((account) => account.provider === provider)
      .map((account) => account.nick)
  );
  const record: AccountRecord = {
    id,
    provider,
    key: identity.key,
    nick,
    name: identity.label.trim() || identity.key,
    ...(extras?.home ? { home: extras.home } : {}),
    addedAt: now
  };
  return {
    registry: { version: 1, accounts: [...reg.accounts, record] },
    record,
    added: true
  };
}

export function renameAccount(
  reg: Registry,
  id: string,
  nick: string,
  name: string
): Registry {
  const clean = sanitizeNick(nick);
  // An empty string deliberately hides the nickname; missing or invalid input is still rejected.
  if (typeof nick !== 'string' || (!clean && nick.trim()))
    throw new Error('Nickname must be 1 to 5 letters or numbers.');
  if (!reg.accounts.some((account) => account.id === id))
    throw new Error(missing);
  return {
    version: 1,
    accounts: reg.accounts.map((account) =>
      account.id === id
        ? {
            ...account,
            nick: clean,
            name: String(name ?? '').trim() || account.name
          }
        : account
    )
  };
}

export function removeAccount(
  reg: Registry,
  id: string,
  activeKey?: string
): { registry: Registry; removed: AccountRecord } {
  const removed = reg.accounts.find((account) => account.id === id);
  if (!removed) throw new Error(missing);
  const managed = APP_MANAGED[removed.provider];
  if (managed) throw new AccountRemovalBlocked(managed);
  if (activeKey && sameKey(activeKey, removed.key))
    throw new AccountRemovalBlocked(
      `${APP_NAMES[removed.provider]} is signed into this account right now. Switch it to another account first.`
    );
  return {
    registry: {
      version: 1,
      accounts: reg.accounts.filter((account) => account !== removed)
    },
    removed
  };
}

export function resolveKeyAccount(
  reg: Registry,
  provider: Provider,
  setting?: string
): KeyAccount {
  if (!setting || setting === 'follow' || !CAN_PIN[provider])
    return { mode: 'follow' };
  const record = reg.accounts.find(
    (account) => account.id === setting && account.provider === provider
  );
  return record ? { mode: 'pinned', record } : { mode: 'follow' };
}

/** Keep one row per provider + key (case-insensitive). Prefers the oldest addedAt. */
export function dedupeRegistry(reg: Registry): Registry {
  const best = new Map<string, AccountRecord>();
  for (const account of reg.accounts) {
    const key = `${account.provider}:${account.key.toLowerCase()}`;
    const existing = best.get(key);
    if (!existing || account.addedAt < existing.addedAt) best.set(key, account);
  }
  const accounts = [...best.values()].sort((a, b) => a.addedAt - b.addedAt);
  return accounts.length === reg.accounts.length
    ? reg
    : { version: 1, accounts };
}
