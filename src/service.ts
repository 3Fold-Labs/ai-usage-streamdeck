import { allowSnapshot, safeError } from './security.js';
import type { Provider, Snapshot } from './model.js';
import { defaultClaudeFile } from './providers/claude.js';
import { GrokKeychainUnavailable } from './providers/grok-credentials.js';
import { sources as defaultSources, type Sources } from './sources.js';
import {
  emptyRegistry,
  resolveKeyAccount,
  upsertIdentity,
  type AccountRecord,
  type Registry
} from './accounts.js';
import { LastReadings, defaultLastReadingsFile } from './last-readings.js';

export type Settings = {
  disconnected?: boolean;
  remaining?: boolean;
  window?: 'auto' | 'short' | 'weekly' | 'monthly';
  nickname?: string;
  codexPath?: string;
  bucket?: string;
  claudeFile?: string;
  grokConnected?: boolean;
  cursorConnected?: boolean;
  cursorPool?: 'cursor-models' | 'other-models';
  superGrokConnected?: boolean;
  superGrokAccount?: string;
  account?: string;
  barColor?: string;
  keyColor?: string;
};
export type ServiceDeps = {
  sources?: Partial<Sources>;
  registry: { load(): Promise<Registry>; save(r: Registry): Promise<void> };
  lastReadings: LastReadings;
};
type CacheEntry = {
  snapshot?: Snapshot;
  next: number;
  pending?: Promise<Snapshot>;
  keychainPaused?: boolean;
};

export { defaultClaudeFile };

const memoryRegistry = (): ServiceDeps['registry'] => {
  let registry = emptyRegistry();
  return {
    load: async () => registry,
    save: async (next) => {
      registry = next;
    }
  };
};

export class UsageService {
  private sources: Sources;
  private registry: ServiceDeps['registry'];
  private lastReadings: LastReadings;
  private cache = new Map<string, CacheEntry>();
  private registering: Promise<unknown> = Promise.resolve();

  constructor(deps?: ServiceDeps) {
    this.sources = {
      ...defaultSources,
      ...Object.fromEntries(
        Object.entries(deps?.sources ?? {}).filter(([, source]) => source)
      )
    };
    this.registry = deps?.registry ?? memoryRegistry();
    this.lastReadings =
      deps?.lastReadings ?? new LastReadings(defaultLastReadingsFile());
  }

  private cacheKey(provider: Provider, settings: Settings) {
    return JSON.stringify([
      provider,
      provider === 'openai'
        ? [settings.codexPath, settings.bucket || 'codex']
        : provider === 'grok'
          ? 'desktop-active-account'
          : provider === 'cursor'
            ? [
                'desktop-active-account',
                settings.cursorPool === 'other-models'
                  ? 'other-models'
                  : 'cursor-models'
              ]
            : provider === 'supergrok'
              ? [
                  'grok-cli',
                  settings.superGrokAccount?.trim().toLowerCase() || ''
                ]
              : settings.claudeFile || defaultClaudeFile(),
      settings.account || 'follow'
    ]);
  }

  clear(provider: Provider, settings: Settings) {
    this.cache.delete(this.cacheKey(provider, settings));
  }

  async get(
    provider: Provider,
    settings: Settings,
    force = false
  ): Promise<Snapshot> {
    if (settings.disconnected)
      return {
        observedAt: 0,
        error:
          'This button is disconnected. Sign in to the provider app, then reconnect this button.'
      };
    if (provider === 'grok' && settings.grokConnected !== true)
      return {
        observedAt: 0,
        source: 'Grok Bot subscription',
        error:
          'Logo ready. Subscription connection is off. Enable the desktop sign-in connection below to read weekly usage.'
      };
    // Cursor and SuperGrok read another app's sign-in, so both stay off until explicitly enabled.
    if (provider === 'cursor' && settings.cursorConnected !== true)
      return {
        observedAt: 0,
        source: 'Cursor plan',
        error:
          'Logo ready. Plan usage connection is off. Enable the Cursor sign-in connection below to read billing-cycle usage.'
      };
    if (provider === 'supergrok' && settings.superGrokConnected !== true)
      return {
        observedAt: 0,
        source: 'SuperGrok subscription',
        error:
          'Logo ready. Subscription connection is off. Enable the Grok CLI sign-in connection below to read the shared weekly pool.'
      };
    const key = this.cacheKey(provider, settings);
    let entry = this.cache.get(key);
    if (!entry) {
      entry = { next: 0 };
      this.cache.set(key, entry);
    }
    if (entry.pending) return entry.pending;
    if (entry.keychainPaused && !force) return entry.snapshot!;
    const now = Date.now();
    // Forced refresh is throttled to protect providers from repeated key presses.
    if (
      entry.snapshot &&
      now < entry.next &&
      (!force || now < entry.next - (provider !== 'anthropic' ? 45_000 : 0))
    )
      return entry.snapshot;
    const current = entry;
    current.pending = (async () => {
      let pinned: AccountRecord | undefined;
      try {
        const target = resolveKeyAccount(
          await this.registry.load(),
          provider,
          settings.account
        );
        const source = this.sources[provider];
        let snapshot: Snapshot;
        if (target.mode === 'pinned') {
          pinned = target.record;
          snapshot = await source.readAccount(pinned, settings);
        } else {
          snapshot = await source.readActive(settings);
        }
        // Clearing a connection invalidates reads already in flight.
        if (this.cache.get(key) !== current) return { observedAt: 0 };
        snapshot = allowSnapshot(snapshot);
        current.snapshot = snapshot;
        current.keychainPaused = false;
        await this.remember(provider, snapshot, pinned);
      } catch (error) {
        current.keychainPaused = error instanceof GrokKeychainUnavailable;
        const code = (error as NodeJS.ErrnoException).code;
        const message =
          code === 'ENOENT' && provider === 'anthropic'
            ? settings.claudeFile === defaultClaudeFile()
              ? 'Waiting for Claude Code subscription usage. Sign in with the same Claude account, restart Claude Code, and use it normally to produce a reading.'
              : 'No Claude usage history found. Open Claude Desktop Settings → Usage, or connect Claude Code below.'
            : error instanceof SyntaxError
              ? 'Invalid provider data. Waiting for a valid reading.'
              : safeError(error);
        // A chosen account that cannot be read right now keeps its most recent reading, marked idle.
        const last =
          pinned && (await this.lastReadings.get(provider, pinned.key));
        current.snapshot = last
          ? { ...last, idle: true, error: message }
          : { ...(current.snapshot ?? { observedAt: 0 }), error: message };
      } finally {
        current.next =
          Date.now() + (provider !== 'anthropic' ? 60_000 : 15_000);
        current.pending = undefined;
      }
      return current.snapshot!;
    })();
    return current.pending;
  }

  async nicknameFor(
    provider: Provider,
    settings: Settings,
    snapshot?: Snapshot
  ): Promise<string | undefined> {
    try {
      const registry = await this.registry.load();
      const target = resolveKeyAccount(registry, provider, settings.account);
      if (target.mode === 'pinned') return target.record.nick;
      const key = snapshot?.account?.key.toLowerCase();
      return key
        ? registry.accounts.find(
            (account) =>
              account.provider === provider && account.key.toLowerCase() === key
          )?.nick
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async remember(
    provider: Provider,
    snapshot: Snapshot,
    pinned?: AccountRecord
  ) {
    const account = snapshot.account;
    try {
      if (account) {
        // Serialised so keys reading the same new account at once register it only once.
        const run = this.registering.then(async () => {
          const current = await this.registry.load();
          const { registry, added } = upsertIdentity(
            current,
            provider,
            account
          );
          if (added) await this.registry.save(registry);
        });
        this.registering = run.catch(() => undefined);
        await run;
      }
    } catch {
      /* Registry storage problems never hide a good reading. */
    }
    const key = pinned?.key ?? account?.key;
    try {
      if (key) await this.lastReadings.set(provider, key, snapshot);
    } catch {
      /* Nor do cache write failures. */
    }
  }
}
