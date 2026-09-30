import type { AccountIdentity, Snapshot } from '../model.js';
import type { Host } from '../platform.js';
import { currentHost } from '../platform.js';
import {
  grokBotIdentity,
  listGrokBotAccounts,
  readGrokCredentials
} from './grok-credentials.js';

// Same read-only subscription RPC used by Grok Bot Desktop 0.44.0.
// Credentials remain in memory; no refresh tokens, chat data, or paid API calls are used.
const endpoint =
  'https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus';

export function normalizeGrokUsage(data: any, now = Date.now()): Snapshot {
  if (data?.usesPooledEnterpriseAllowance === true)
    throw new Error(
      'Grok Bot reports a pooled team allowance; individual weekly usage is unavailable.'
    );
  const used = data?.usagePercent;
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0)
    throw new Error(
      'Grok Bot has not reported a valid subscription percentage.'
    );
  const reset =
    typeof data.nextResetTimestampUtc === 'string'
      ? Date.parse(data.nextResetTimestampUtc) / 1000
      : NaN;
  if (!Number.isFinite(reset) || reset <= 0)
    throw new Error('Grok Bot has not reported a valid reset time.');
  return {
    observedAt: now,
    weekly: { used, minutes: 10080, resetsAt: reset },
    source: 'Grok Bot subscription'
  };
}

export async function fetchGrokUsage(
  credentials: { token: string; team?: string },
  request: typeof fetch = fetch
): Promise<Snapshot> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.token}`,
    'Content-Type': 'application/json',
    'Connect-Protocol-Version': '1',
    'x-cursor-client-type': 'sand',
    'x-cursor-client-version': '0.44.0',
    'x-sand-box-namespace': 'prod'
  };
  if (credentials.team && /^\d+$/.test(credentials.team))
    headers['x-cursor-team-id'] = credentials.team;
  let response: Response;
  try {
    response = await request(endpoint, {
      method: 'POST',
      headers,
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new Error('Grok Bot usage service is unreachable. Retrying shortly.');
  }
  if (response.status === 401 || response.status === 403)
    throw new Error(
      'Grok Bot sign-in expired. Open Grok Bot Desktop to refresh it.'
    );
  if (!response.ok)
    throw new Error(`Grok Bot usage request failed (HTTP ${response.status}).`);
  return normalizeGrokUsage(await response.json());
}

export async function readGrokUsage(
  options: {
    host?: Host;
    readMacPassword?: () => Promise<Buffer>;
    readWindowsKey?: () => Promise<Buffer>;
    accountId?: string;
    request?: typeof fetch;
  } = {}
): Promise<Snapshot & { account: AccountIdentity }> {
  const host = options.host ?? currentHost();
  const accounts = await listGrokBotAccounts(
    host,
    options.readMacPassword,
    options.readWindowsKey
  );
  const target = options.accountId
    ? accounts.find((account) => account.id === options.accountId)
    : accounts.find((account) => account.active);
  if (!target)
    throw new Error(
      options.accountId
        ? 'This Grok Bot account is no longer signed in to Grok Bot.'
        : 'No active Grok Bot sign-in found. Open Grok Bot Desktop.'
    );
  const credentials = await readGrokCredentials(
    host,
    options.readMacPassword,
    target.id,
    options.readWindowsKey
  );
  const snapshot = await fetchGrokUsage(credentials, options.request ?? fetch);
  return { ...snapshot, account: grokBotIdentity(target) };
}
