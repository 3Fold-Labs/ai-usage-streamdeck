import type { Provider } from '../model.js';
import type { Registry, AccountRecord } from '../accounts.js';
import { emptyRegistry, dedupeRegistry } from '../accounts.js';
import { LastReadings, defaultLastReadingsFile } from '../last-readings.js';
import { sendToPi } from './bridge.js';
import { UsageService } from '../service.js';
import streamDeck from '@elgato/streamdeck';
import { isDeepStrictEqual } from 'node:util';

const PROVIDERS: Provider[] = [
  'openai',
  'anthropic',
  'grok',
  'cursor',
  'supergrok'
];

const isProvider = (value: unknown): value is Provider =>
  typeof value === 'string' && (PROVIDERS as string[]).includes(value);

function parseRegistry(value: unknown): Registry {
  if (!value || typeof value !== 'object') return emptyRegistry();
  const data = value as {
    version?: unknown;
    accounts?: unknown;
  };
  if (data.version !== 1 || !Array.isArray(data.accounts))
    return emptyRegistry();
  const accounts: AccountRecord[] = [];
  for (const entry of data.accounts) {
    if (!entry || typeof entry !== 'object') return emptyRegistry();
    const account = entry as Record<string, unknown>;
    if (
      !isProvider(account.provider) ||
      typeof account.id !== 'string' ||
      typeof account.key !== 'string' ||
      typeof account.nick !== 'string' ||
      typeof account.name !== 'string' ||
      typeof account.addedAt !== 'number'
    )
      return emptyRegistry();
    if (account.home !== undefined && typeof account.home !== 'string')
      return emptyRegistry();
    if (
      account.retiredHomes !== undefined &&
      (!Array.isArray(account.retiredHomes) ||
        !account.retiredHomes.every((home) => typeof home === 'string'))
    )
      return emptyRegistry();
    accounts.push({
      id: account.id,
      provider: account.provider,
      key: account.key,
      nick: account.nick,
      name: account.name,
      addedAt: account.addedAt,
      ...(account.home ? { home: account.home } : {}),
      ...(account.retiredHomes
        ? { retiredHomes: account.retiredHomes as string[] }
        : {})
    });
  }
  return dedupeRegistry({ version: 1, accounts });
}

let registryMemory = emptyRegistry();

let resolveRegistryReady: () => void;

export const registryReady = new Promise<void>((resolve) => {
  resolveRegistryReady = resolve;
});

export const lastReadings = new LastReadings(defaultLastReadingsFile());

let globalWrites: Promise<unknown> = Promise.resolve();

let globalWriteInProgress = false;

async function readGlobal() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      streamDeck.settings.getGlobalSettings(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Settings confirmation timed out.')),
          5000
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function updateGlobal(
  change: (current: Record<string, any>) => Record<string, any>,
  commit: () => void
) {
  const run = globalWrites.then(async () => {
    globalWriteInProgress = true;
    try {
      const current = await readGlobal();
      const next = change(current);
      await streamDeck.settings.setGlobalSettings(next);
      // The SDK's write resolves after sending, not after host confirmation.
      if (!isDeepStrictEqual(await readGlobal(), next))
        throw new Error('Settings were not confirmed.');
      commit();
    } finally {
      globalWriteInProgress = false;
    }
  });
  globalWrites = run.catch(() => undefined);
  return run;
}

export type Palettes = {
  bar: string[];
  key: string[];
};

const emptyPalettes = (): Palettes => ({ bar: [], key: [] });

export let palettesMemory: Palettes = emptyPalettes();

function parsePalettes(value: unknown): Palettes {
  const clean = (list: unknown) => {
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const next: string[] = [];
    for (const item of list) {
      if (typeof item !== 'string') continue;
      const color = item.trim().toUpperCase();
      if (!/^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(color) || seen.has(color))
        continue;
      seen.add(color);
      next.push(color);
      if (next.length >= 8) break;
    }
    return next;
  };
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as {
          bar?: unknown;
          key?: unknown;
        })
      : {};
  return { bar: clean(raw.bar), key: clean(raw.key) };
}

export const registryApi = {
  load: async () => {
    await registryReady;
    return registryMemory;
  },
  save: async (next: Registry) => {
    await registryReady;
    const previous = registryMemory;
    await updateGlobal(
      (current) => {
        if (!isDeepStrictEqual(parseRegistry(current.accounts), previous))
          throw new Error('Accounts changed during this edit. Try again.');
        return { ...current, accounts: next };
      },
      () => {
        registryMemory = next;
      }
    );
  }
};

export async function savePalettes(next: Palettes) {
  await registryReady;
  const parsed = parsePalettes(next);
  const previous = palettesMemory;
  await updateGlobal(
    (current) => {
      if (!isDeepStrictEqual(parsePalettes(current.palettes), previous))
        throw new Error(
          'The color palette changed during this edit. Try again.'
        );
      return { ...current, palettes: parsed };
    },
    () => {
      palettesMemory = parsed;
    }
  );
  await sendToPi({ palettes: palettesMemory });
}

export const usage = new UsageService({ registry: registryApi, lastReadings });

streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
  // A read-before-write response contains the previous state, not a new edit.
  if (globalWriteInProgress) return;
  const settings = ev.settings as {
    accounts?: unknown;
    palettes?: unknown;
  };
  registryMemory = parseRegistry(settings.accounts);
  palettesMemory = parsePalettes(settings.palettes);
});

export async function initializeStore() {
  try {
    const global = await readGlobal();
    const parsed = parseRegistry(
      (
        global as {
          accounts?: unknown;
        }
      ).accounts
    );
    palettesMemory = parsePalettes(
      (
        global as {
          palettes?: unknown;
        }
      ).palettes
    );
    registryMemory = dedupeRegistry(parsed);
    if (registryMemory.accounts.length !== parsed.accounts.length) {
      try {
        await updateGlobal(
          (current) => ({ ...current, accounts: registryMemory }),
          () => {}
        );
      } catch {
        /* Best-effort cleanup of duplicate rows. */
      }
    }
  } catch {
    registryMemory = emptyRegistry();
  } finally {
    resolveRegistryReady();
  }
}
