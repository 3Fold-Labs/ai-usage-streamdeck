import type { Provider, Snapshot, AccountIdentity } from './model.js';
import type { Settings } from './service.js';
import type { AccountRecord } from './accounts.js';
import { openaiSource } from './providers/openai-source.js';
import { anthropicSource } from './providers/anthropic-source.js';
import { grokSource } from './providers/grok-source.js';
import { cursorSource } from './providers/cursor-source.js';
import { superGrokSource } from './providers/supergrok-source.js';

export type Reading = Snapshot & { account?: AccountIdentity };
export type SignIn =
  | {
      kind: 'code';
      url: string;
      code: string;
      done: Promise<AccountIdentity>;
      cancel(): void;
    }
  | { kind: 'app'; message: string; open?: () => Promise<void> }
  | { kind: 'info'; message: string };
export interface AccountSource {
  readActive(settings: Settings): Promise<Reading>; // follow mode: the app's signed-in account
  readAccount(record: AccountRecord, settings: Settings): Promise<Reading>; // chosen account; throw when it cannot be read right now
  discover?(settings: Settings): Promise<AccountIdentity[]>; // accounts the app already knows (optional)
  activeKey?(settings: Settings): Promise<string | undefined>; // key of the signed-in account, for removal guard and "Follow X (now NN)"
  startSignIn?(settings: Settings, home: string): Promise<SignIn>; // Add account
}
export type Sources = Record<Provider, AccountSource>;

export const sources: Sources = {
  openai: openaiSource,
  anthropic: anthropicSource,
  grok: grokSource,
  cursor: cursorSource,
  supergrok: superGrokSource
};
