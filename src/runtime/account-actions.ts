import { state, Visible } from './state.js';
import type { Provider } from '../model.js';
import type { Settings } from '../service.js';
import { sources } from '../sources.js';
import { registryApi, lastReadings, usage } from './store.js';
import {
  upsertIdentity,
  dedupeRegistry,
  APP_NAMES,
  CAN_PIN,
  APP_MANAGED,
  renameAccount,
  removeAccount
} from '../accounts.js';
import { mkdir } from 'node:fs/promises';
import {
  managedDataDirectory,
  clearManagedHome,
  validateManagedHome
} from '../managed-homes.js';
import { sendToPi } from './bridge.js';
import { repaintProvider, refresh } from './keys.js';
import { safeError } from '../security.js';
import { randomUUID } from 'node:crypto';
import type { SignIn } from '../sources.js';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import streamDeck from '@elgato/streamdeck';

async function discoverIntoRegistry(
  provider: Provider,
  settings: Settings
): Promise<number> {
  const discover = sources[provider].discover;
  if (!discover) return 0;
  let registry = await registryApi.load();
  let added = 0;
  for (const identity of await discover(settings)) {
    const next = upsertIdentity(registry, provider, identity);
    registry = next.registry;
    if (next.added) added++;
  }
  registry = dedupeRegistry(registry);
  await registryApi.save(registry);
  return added;
}

function keysSetTo(id: string) {
  let count = 0;
  for (const item of state.visible.values())
    if (item.settings.account === id) count++;
  return count;
}

async function accountListFor(provider: Provider, settings: Settings) {
  const registry = await registryApi.load();
  let activeKey: string | undefined;
  try {
    activeKey = await sources[provider].activeKey?.(settings);
  } catch {
    activeKey = undefined;
  }
  const activeNick = activeKey
    ? registry.accounts.find(
        (account) =>
          account.provider === provider &&
          account.key.toLowerCase() === activeKey.toLowerCase()
      )?.nick
    : undefined;
  const followLabel = activeNick
    ? `Follow ${APP_NAMES[provider]} (now ${activeNick})`
    : `Follow ${APP_NAMES[provider]}`;
  const accounts = [];
  for (const account of registry.accounts.filter(
    (entry) => entry.provider === provider
  )) {
    const active =
      !!activeKey && account.key.toLowerCase() === activeKey.toLowerCase();
    const last = await lastReadings.get(provider, account.key);
    accounts.push({
      id: account.id,
      nick: account.nick,
      name: account.name,
      key: account.key,
      active,
      idleSince:
        !active && provider === 'anthropic' ? (last?.observedAt ?? null) : null,
      keysSetTo: keysSetTo(account.id)
    });
  }
  return {
    provider,
    followLabel,
    activeKey: activeKey ?? null,
    canPin: CAN_PIN[provider],
    canAdd: typeof sources[provider].startSignIn === 'function',
    appManaged: !!APP_MANAGED[provider],
    accounts
  };
}

export async function cancelSignIn() {
  const session = state.signInSession;
  state.signInSession = undefined;
  try {
    await session?.cancel?.();
  } catch {
    /* Cancel is best-effort. */
  }
  try {
    await clearManagedHome(session?.home);
  } catch (error) {
    state.signInSession = session;
    throw error;
  }
}

function assertUnsharedHome(
  registry: Awaited<ReturnType<typeof registryApi.load>>,
  id: string,
  home: string
) {
  if (
    registry.accounts.some(
      (account) =>
        account.id !== id &&
        [account.home, ...(account.retiredHomes || [])].some(
          (other) => other && path.resolve(other) === path.resolve(home)
        )
    )
  )
    throw new Error(
      'Account folder cleanup was blocked because another account uses it.'
    );
}

export async function cleanupRetiredHomes(id: string) {
  const registry = await registryApi.load();
  const record = registry.accounts.find((account) => account.id === id);
  if (!record?.retiredHomes?.length) return;
  for (const home of record.retiredHomes) {
    if (record.home && path.resolve(home) === path.resolve(record.home))
      throw new Error(
        'Account folder cleanup was blocked because its location is unsafe.'
      );
    assertUnsharedHome(registry, id, home);
    await validateManagedHome(home);
  }
  for (const home of record.retiredHomes) await clearManagedHome(home);
  // Retain the cleanup list until deletion succeeds. A failed save leaves a
  // durable retry record; deleting an already missing directory is safe.
  const current = await registryApi.load();
  await registryApi.save({
    ...current,
    accounts: current.accounts.map((account) =>
      account.id === id
        ? {
            ...account,
            retiredHomes: (account.retiredHomes || []).filter(
              (home) => !record.retiredHomes!.includes(home)
            )
          }
        : account
    )
  });
}

export function allowedOpenUrl(url: string, signInUrl?: string) {
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:') return false;
    if (
      target.hostname === 'accounts.x.ai' ||
      target.hostname === 'auth.openai.com' ||
      target.hostname === 'chatgpt.com' ||
      target.hostname.endsWith('.openai.com')
    )
      return true;
    if (!signInUrl) return false;
    return target.hostname === new URL(signInUrl).hostname;
  } catch {
    return false;
  }
}

export async function handleAccounts(item: Visible) {
  try {
    await discoverIntoRegistry(item.provider, item.settings);
  } catch {
    /* Discovery is best-effort when opening the account list. */
  }
  await sendToPi({
    accountList: await accountListFor(item.provider, item.settings)
  });
}

export async function handleRename(
  item: Visible,
  rename: {
    id: string;
    nick: string;
    name: string;
  }
) {
  try {
    const next = renameAccount(
      await registryApi.load(),
      rename.id,
      rename.nick,
      rename.name
    );
    await registryApi.save(next);
    await repaintProvider(item.provider);
    await handleAccounts(item);
  } catch (error) {
    await sendToPi({
      accountError: safeError(error, 'Could not rename this account.')
    });
  }
}

export async function handleRemove(item: Visible, id: string) {
  try {
    let activeKey: string | undefined;
    try {
      activeKey = await sources[item.provider].activeKey?.(item.settings);
    } catch {
      activeKey = undefined;
    }
    // Removal guards use the account's own provider active key when the id belongs to another provider.
    const registry = await registryApi.load();
    const target = registry.accounts.find((account) => account.id === id);
    if (target && target.provider !== item.provider) {
      try {
        activeKey = await sources[target.provider].activeKey?.({});
      } catch {
        activeKey = undefined;
      }
    }
    const { registry: next, removed } = removeAccount(registry, id, activeKey);
    const homes = [
      ...(removed.retiredHomes || []),
      ...(removed.home ? [removed.home] : [])
    ];
    // Validate all targets before deleting any, retaining the account for retry
    // if cleanup fails rather than forgetting where credentials are stored.
    for (const home of homes) {
      assertUnsharedHome(registry, id, home);
      await validateManagedHome(home);
    }
    for (const home of homes) await clearManagedHome(home);
    await registryApi.save(next);
    try {
      await lastReadings.delete(removed.provider, removed.key);
    } catch {
      /* Cache cleanup is best-effort. */
    }
    for (const other of state.visible.values()) {
      if (other.settings.account !== removed.id) continue;
      const settings = { ...other.settings, account: 'follow' };
      try {
        await other.key.setSettings(settings);
      } catch {
        continue;
      }
      usage.clear(other.provider, other.settings);
      other.settings = settings;
      other.revision++;
      other.snapshot = undefined;
      other.resetUntil = 0;
      void refresh(other, true);
    }
    await handleAccounts(item);
  } catch (error) {
    await sendToPi({
      accountError: safeError(error, 'Could not remove this account.')
    });
  }
}

export async function handleAddAccount(item: Visible) {
  const start = sources[item.provider].startSignIn;
  if (!start) {
    await sendToPi({
      accountError: 'This service does not support adding accounts here.'
    });
    return;
  }
  await sendToPi({ working: `Starting ${APP_NAMES[item.provider]} sign-in…` });
  const home = path.join(
    managedDataDirectory(),
    'accounts',
    item.provider,
    randomUUID()
  );
  let committed = false;
  try {
    await cancelSignIn();
    await mkdir(home, { recursive: true, mode: 0o700 });
    const signIn: SignIn = await start(item.settings, home);
    if (signIn.kind === 'code') {
      state.signInSession = {
        home,
        cancel: () => signIn.cancel(),
        url: signIn.url
      };
      await sendToPi({
        signIn: { kind: 'code', url: signIn.url, code: signIn.code }
      });
      try {
        await streamDeck.system.openUrl(signIn.url);
      } catch {
        try {
          await promisify(execFile)('/usr/bin/open', [signIn.url], {
            windowsHide: true
          });
        } catch {
          /* Inspector still has the Open sign-in page button. */
        }
      }
      try {
        const identity = await signIn.done;
        if (state.signInSession?.home !== home) return;
        state.signInSession = undefined;
        const current = await registryApi.load();
        const { registry, record } = upsertIdentity(
          current,
          item.provider,
          identity,
          { home }
        );
        await registryApi.save(registry);
        committed = true;
        let cleanupWarning = false;
        try {
          await cleanupRetiredHomes(record.id);
        } catch {
          cleanupWarning = true;
        }
        await repaintProvider(item.provider);
        await sendToPi({
          signInDone: { nick: record.nick, name: record.name }
        });
        await handleAccounts(item);
        if (cleanupWarning)
          await sendToPi({
            accountError:
              'The new sign-in was saved, but old sign-in files could not be removed. Add this account again to retry cleanup.'
          });
      } catch (error) {
        if (state.signInSession?.home === home) state.signInSession = undefined;
        if (!committed) await clearManagedHome(home);
        await sendToPi({ signInFailed: safeError(error, 'Sign-in failed.') });
      }
      return;
    }
    await clearManagedHome(home);
    if (signIn.kind === 'app') {
      const before = new Set(
        (await registryApi.load()).accounts
          .filter((account) => account.provider === item.provider)
          .map((account) => account.key.toLowerCase())
      );
      state.signInSession = { open: signIn.open };
      await sendToPi({ signIn: { kind: 'app', message: signIn.message } });
      try {
        await signIn.open?.();
      } catch (error) {
        await sendToPi({
          accountError: safeError(error, 'Could not open the app.')
        });
      }
      for (let i = 0; i < 60 && state.signInSession; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!state.signInSession) return;
        try {
          await discoverIntoRegistry(item.provider, item.settings);
        } catch {
          /* keep waiting */
        }
        const added = (await registryApi.load()).accounts.find(
          (account) =>
            account.provider === item.provider &&
            !before.has(account.key.toLowerCase())
        );
        if (added) {
          state.signInSession = undefined;
          await repaintProvider(item.provider);
          await sendToPi({
            signInDone: { nick: added.nick, name: added.name }
          });
          await handleAccounts(item);
          return;
        }
      }
      return;
    }
    state.signInSession = undefined;
    let found = 0;
    try {
      found = await discoverIntoRegistry(item.provider, item.settings);
    } catch {
      /* Still show the instructions when discovery fails. */
    }
    await sendToPi({
      signIn: {
        kind: 'info',
        message: found
          ? `${signIn.message} Found ${found} new account${found === 1 ? '' : 's'} and added ${found === 1 ? 'it' : 'them'} to the list.`
          : signIn.message
      }
    });
    await handleAccounts(item);
  } catch (error) {
    state.signInSession = undefined;
    if (!committed) {
      try {
        await clearManagedHome(home);
      } catch {
        await sendToPi({
          accountError: 'Could not remove account sign-in files. Try again.'
        });
      }
    }
    await sendToPi({
      signInFailed: safeError(error, 'Could not start sign-in.')
    });
  }
}
