import path from 'node:path';
import type { AccountRecord } from '../accounts.js';
import type { AccountIdentity } from '../model.js';
import type { AccountSource, Reading, SignIn } from '../sources.js';
import type { Settings } from '../service.js';
import { isClaudeOrgId } from './normalize.js';
import {
  claudeMissingAccountMessage,
  defaultClaudeDataDir,
  findClaudeHistory,
  listClaudeAccountFiles,
  listClaudeHistoryOrgs,
  preferClaudeLabel,
  readClaudeAccountFile,
  readClaudeExporterFile,
  readClaudeHistoryFile,
  readClaudeUsage,
  startClaudeSignIn
} from './claude.js';

export type AnthropicSourceOptions = {
  dataDir?: string;
  findHistory?: () => Promise<string | undefined>;
  startSignIn?: typeof startClaudeSignIn;
};

async function enrich(reading: Reading, dataDir: string): Promise<Reading> {
  const key = reading.account?.key;
  if (!key) return reading;
  const stored = await readClaudeAccountFile(key, dataDir);
  return {
    ...reading,
    account: preferClaudeLabel(key, stored?.account, reading.account)
  };
}

export function createAnthropicSource(
  options: AnthropicSourceOptions = {}
): AccountSource {
  const dataDirOf = () => options.dataDir || defaultClaudeDataDir();
  const historyOf = () =>
    options.findHistory ? options.findHistory() : findClaudeHistory();

  async function readDesktop(org?: string): Promise<Reading | undefined> {
    const history = await historyOf();
    if (!history) return;
    const reading = await readClaudeHistoryFile(history, org);
    return reading ? enrich(reading, dataDirOf()) : undefined;
  }

  async function readCode(): Promise<Reading | undefined> {
    return readClaudeExporterFile(path.join(dataDirOf(), 'claude.json'));
  }

  async function activeOrgKeys(settings: Settings): Promise<Set<string>> {
    const keys = new Set<string>();
    if (settings.claudeFile?.trim()) {
      try {
        const reading = await readClaudeUsage(settings.claudeFile);
        if (reading.account?.key) keys.add(reading.account.key);
      } catch {
        /* Chosen file may be unavailable while discovering active apps. */
      }
      return keys;
    }
    try {
      const desktop = await readDesktop();
      if (desktop?.account?.key) keys.add(desktop.account.key);
    } catch {
      /* Desktop history optional. */
    }
    try {
      const code = await readCode();
      if (code?.account?.key) keys.add(code.account.key);
    } catch {
      /* Exporter optional. */
    }
    return keys;
  }

  async function readActive(settings: Settings): Promise<Reading> {
    const configured = settings.claudeFile?.trim();
    if (configured) {
      if (!path.isAbsolute(configured))
        throw new Error('Choose an absolute Claude usage file path.');
      return enrich(await readClaudeUsage(configured), dataDirOf());
    }

    let desktop: Reading | undefined;
    let code: Reading | undefined;
    let lastError: unknown;
    try {
      desktop = await readDesktop();
    } catch (error) {
      lastError = error;
    }
    try {
      code = await readCode();
    } catch (error) {
      lastError = error;
    }

    if (!desktop && !code) {
      if (lastError) throw lastError;
      // Preserve the historical ENOENT when neither Desktop nor the exporter has a reading.
      return readClaudeUsage(path.join(dataDirOf(), 'claude.json'));
    }
    if (!desktop) return code!;
    if (!code) return desktop;
    return desktop.observedAt >= code.observedAt ? desktop : code;
  }

  async function readAccount(
    record: AccountRecord,
    settings: Settings
  ): Promise<Reading> {
    const key = record.key.trim().toLowerCase();
    if (!isClaudeOrgId(key)) throw new Error(claudeMissingAccountMessage);

    let desktop: Reading | undefined;
    let stored: Reading | undefined;
    try {
      desktop = await readDesktop(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    stored = await readClaudeAccountFile(key, dataDirOf());

    if (!desktop && !stored) throw new Error(claudeMissingAccountMessage);
    const reading = !desktop
      ? stored!
      : !stored
        ? desktop
        : desktop.observedAt >= stored.observedAt
          ? desktop
          : stored;
    const account = preferClaudeLabel(
      key,
      stored?.account,
      desktop?.account,
      reading.account
    );
    const active = await activeOrgKeys(settings);
    return { ...reading, account, ...(active.has(key) ? {} : { idle: true }) };
  }

  async function discover(_settings: Settings): Promise<AccountIdentity[]> {
    const byKey = new Map<string, AccountIdentity>();
    try {
      const history = await historyOf();
      if (history)
        for (const identity of await listClaudeHistoryOrgs(history))
          byKey.set(identity.key, identity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const identity of await listClaudeAccountFiles(dataDirOf())) {
      // Exporter files carry email/name when present.
      byKey.set(
        identity.key,
        preferClaudeLabel(identity.key, identity, byKey.get(identity.key))
      );
    }
    return [...byKey.values()];
  }

  async function activeKey(settings: Settings): Promise<string | undefined> {
    try {
      return (await readActive(settings)).account?.key;
    } catch {
      return undefined;
    }
  }

  async function startSignIn(
    _settings: Settings,
    home: string
  ): Promise<SignIn> {
    return (options.startSignIn ?? startClaudeSignIn)(home);
  }

  return { readActive, readAccount, discover, activeKey, startSignIn };
}

export const anthropicSource: AccountSource = createAnthropicSource();
