import type { Host } from '../platform.js';
import { currentHost } from '../platform.js';
import type { AccountSource } from '../sources.js';
import type { Settings } from '../service.js';
import { cursorIdentity, readCursorUsage } from './cursor.js';
import { openCursorState, readCursorSignIn } from './cursor-credentials.js';

export type CursorSourceDeps = {
  host?: () => Host;
  open?: typeof openCursorState;
  request?: typeof fetch;
};

export function makeCursorSource(deps: CursorSourceDeps = {}): AccountSource {
  const host = deps.host ?? currentHost;
  const open = deps.open ?? openCursorState;
  const request = deps.request ?? fetch;
  return {
    readActive: (settings: Settings) =>
      readCursorUsage(
        () => readCursorSignIn(host(), open),
        request,
        settings.cursorPool
      ),
    readAccount: async () => {
      throw new Error(
        'Cursor keeps one account at a time, so this key follows the Cursor app.'
      );
    },
    activeKey: async (settings: Settings) => {
      if (settings.cursorConnected !== true) return undefined;
      try {
        const { email } = await readCursorSignIn(host(), open);
        return cursorIdentity(email).key;
      } catch {
        return undefined;
      }
    }
  };
}

// Reads Cursor's signed-in account; Cursor keeps one account at a time.
export const cursorSource: AccountSource = makeCursorSource();
