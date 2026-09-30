import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import type { AccountRecord } from '../accounts.js';
import type { Host } from '../platform.js';
import { currentHost, hostPath } from '../platform.js';
import type { AccountSource, Reading, SignIn } from '../sources.js';
import type { Settings } from '../service.js';
import {
  grokBotIdentity,
  listGrokBotAccounts,
  readGrokCredentials
} from './grok-credentials.js';
import { fetchGrokUsage } from './grok.js';

const signInMessage =
  'Open Grok Bot and add or switch the account there. This panel watches for it and adds it to the list.';
const noLonger = 'This Grok Bot account is no longer signed in to Grok Bot.';

export type GrokSourceDeps = {
  host?: Host;
  readMacPassword?: () => Promise<Buffer>;
  readWindowsKey?: () => Promise<Buffer>;
  request?: typeof fetch;
  launch?: (file: string, args: string[]) => Promise<void>;
  exists?: (file: string) => Promise<boolean>;
};

const defaultLaunch = async (file: string, args: string[]) => {
  await promisify(execFile)(file, args, { windowsHide: true });
};

const defaultExists = async (file: string) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

async function readingFor(
  accountId: string,
  identity: ReturnType<typeof grokBotIdentity>,
  deps: GrokSourceDeps
): Promise<Reading> {
  const host = deps.host ?? currentHost();
  const credentials = await readGrokCredentials(
    host,
    deps.readMacPassword,
    accountId,
    deps.readWindowsKey
  );
  const snapshot = await fetchGrokUsage(credentials, deps.request ?? fetch);
  return { ...snapshot, account: identity };
}

export function createGrokSource(deps: GrokSourceDeps = {}): AccountSource {
  const host = () => deps.host ?? currentHost();
  const launch = deps.launch ?? defaultLaunch;
  const exists = deps.exists ?? defaultExists;

  return {
    async readActive(_settings: Settings): Promise<Reading> {
      const accounts = await listGrokBotAccounts(
        host(),
        deps.readMacPassword,
        deps.readWindowsKey
      );
      const active = accounts.find((account) => account.active);
      if (!active)
        throw new Error(
          'No active Grok Bot sign-in found. Open Grok Bot Desktop.'
        );
      return readingFor(active.id, grokBotIdentity(active), deps);
    },

    async readAccount(
      record: AccountRecord,
      _settings: Settings
    ): Promise<Reading> {
      const accounts = await listGrokBotAccounts(
        host(),
        deps.readMacPassword,
        deps.readWindowsKey
      );
      const wanted = record.key.toLowerCase();
      const match = accounts.find(
        (account) => grokBotIdentity(account).key === wanted
      );
      if (!match) throw new Error(noLonger);
      return readingFor(match.id, grokBotIdentity(match), deps);
    },

    async discover(_settings: Settings) {
      const accounts = await listGrokBotAccounts(
        host(),
        deps.readMacPassword,
        deps.readWindowsKey
      );
      return accounts.map(grokBotIdentity);
    },

    async activeKey(_settings: Settings) {
      const accounts = await listGrokBotAccounts(
        host(),
        deps.readMacPassword,
        deps.readWindowsKey
      );
      const active = accounts.find((account) => account.active);
      return active ? grokBotIdentity(active).key : undefined;
    },

    async startSignIn(_settings: Settings, _home: string): Promise<SignIn> {
      const current = host();
      if (current.platform === 'darwin') {
        return {
          kind: 'app',
          message: signInMessage,
          open: async () => {
            try {
              await launch('/usr/bin/open', ['-a', 'Grok Bot']);
            } catch {
              throw new Error('Could not open Grok Bot.');
            }
          }
        };
      }
      if (current.platform === 'win32') {
        const exe = hostPath(current).join(
          current.env.LOCALAPPDATA ||
            path.win32.join(current.home, 'AppData', 'Local'),
          'Programs',
          'Grok Bot',
          'Grok Bot.exe'
        );
        if (!(await exists(exe)))
          return { kind: 'app', message: signInMessage };
        return {
          kind: 'app',
          message: signInMessage,
          open: async () => {
            try {
              await launch(exe, []);
            } catch {
              throw new Error('Could not open Grok Bot.');
            }
          }
        };
      }
      return { kind: 'app', message: signInMessage };
    }
  };
}

// Default source used by the usage service; reads the active Grok Bot account.
export const grokSource: AccountSource = createGrokSource();
