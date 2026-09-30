import type { AccountRecord } from '../accounts.js';
import type { AccountSource, Reading } from '../sources.js';
import type { Settings } from '../service.js';
import { currentHost, type Host } from '../platform.js';
import {
  readSuperGrokAuth,
  readSuperGrokUsage,
  selectSuperGrokSession,
  startSuperGrokSignIn,
  superGrokEmails
} from './supergrok.js';

export type SuperGrokSourceDeps = {
  host?: Host;
  request?: typeof fetch;
  executable?: string;
};

const gone = 'This SuperGrok account is no longer signed in. Add it again.';
const notSignedIn = 'The Grok CLI is not signed into this account right now.';

export function createSuperGrokSource(
  deps: SuperGrokSourceDeps = {}
): AccountSource {
  const host = deps.host ?? currentHost();
  const request = deps.request ?? fetch;

  const readFrom = (home: string | undefined, account?: string) =>
    readSuperGrokUsage(account, () => readSuperGrokAuth(host, home), request);

  return {
    readActive: async (settings: Settings): Promise<Reading> => {
      const account = settings.superGrokAccount?.trim() || undefined;
      return readFrom(undefined, account);
    },

    readAccount: async (record: AccountRecord): Promise<Reading> => {
      if (record.home) {
        try {
          return await readFrom(record.home, record.key);
        } catch (error) {
          if (
            error instanceof Error &&
            /no longer signed in/.test(error.message)
          )
            throw error;
          throw new Error(gone);
        }
      }
      try {
        return await readFrom(undefined, record.key);
      } catch {
        throw new Error(notSignedIn);
      }
    },

    activeKey: async (settings: Settings) => {
      try {
        const auth = await readSuperGrokAuth(host);
        const wanted = settings.superGrokAccount?.trim();
        if (wanted)
          return selectSuperGrokSession(auth, wanted)
            .email.trim()
            .toLowerCase();
        const emails = superGrokEmails(auth);
        return emails.length === 1 ? emails[0] : undefined;
      } catch {
        return undefined;
      }
    },

    startSignIn: async (_settings: Settings, home: string) =>
      startSuperGrokSignIn(home, { host, executable: deps.executable })
  };
}

export const superGrokSource: AccountSource = createSuperGrokSource();
