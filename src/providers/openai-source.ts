import { stat } from 'node:fs/promises';
import type { AccountSource, Reading } from '../sources.js';
import type { AccountRecord } from '../accounts.js';
import type { Settings } from '../service.js';
import {
  codexIdentity,
  findCodex,
  readCodex,
  readCodexAccount,
  startCodexSignIn
} from './codex.js';
import { normalizeCodex, object } from './normalize.js';

const noFolder = 'This ChatGPT account has no sign-in folder. Add it again.';

async function requireHome(home?: string): Promise<string> {
  if (!home) throw new Error(noFolder);
  try {
    if (!(await stat(home)).isDirectory()) throw new Error(noFolder);
  } catch (error) {
    if (error instanceof Error && error.message === noFolder) throw error;
    throw new Error(noFolder);
  }
  return home;
}

async function readingFrom(
  executable: string,
  settings: Settings,
  codexHome?: string
): Promise<Reading> {
  const raw = await readCodex(
    executable,
    20_000,
    codexHome !== undefined ? { codexHome } : undefined
  );
  const snapshot = normalizeCodex(raw, settings.bucket || 'codex');
  return {
    ...snapshot,
    account: codexIdentity(object(raw).account, codexHome)
  };
}

export const openaiSource: AccountSource = {
  readActive: async (settings) =>
    readingFrom(await findCodex(settings.codexPath), settings),

  readAccount: async (record: AccountRecord, settings) => {
    const home = await requireHome(record.home);
    const reading = await readingFrom(
      await findCodex(settings.codexPath),
      settings,
      home
    );
    if (!reading.account || reading.account.key !== record.key) {
      throw new Error(
        'This folder is signed into a different ChatGPT account.'
      );
    }
    return reading;
  },

  discover: async (settings) => {
    try {
      const account = await readCodexAccount(
        await findCodex(settings.codexPath),
        20_000
      );
      return [codexIdentity(account)];
    } catch {
      try {
        const reading = await readingFrom(
          await findCodex(settings.codexPath),
          settings
        );
        return reading.account ? [reading.account] : [];
      } catch {
        return [];
      }
    }
  },

  activeKey: async (settings) => {
    try {
      const account = await readCodexAccount(
        await findCodex(settings.codexPath),
        20_000
      );
      return codexIdentity(account).key;
    } catch {
      return undefined;
    }
  },

  startSignIn: async (settings, home) => {
    const signIn = await startCodexSignIn(
      await findCodex(settings.codexPath),
      home,
      { startTimeoutMs: 20_000, timeoutMs: 10 * 60_000 }
    );
    return {
      kind: 'code',
      url: signIn.url,
      code: signIn.code,
      done: signIn.done,
      cancel: signIn.cancel
    };
  }
};
