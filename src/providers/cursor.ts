import type { AccountIdentity, Snapshot } from '../model.js';
import { readCursorToken } from './cursor-credentials.js';

// Read-only dashboard RPC used by Cursor to show included plan usage.
// The sign-in token remains in memory; no refresh tokens, chats, or billing changes are used.
const endpoint =
  'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const planMessage = /used (\d+(?:\.\d+)?)% of your included usage/;
const milliseconds = (value: unknown) =>
  typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : typeof value === 'number'
      ? value
      : NaN;

export function cursorIdentity(email?: string): AccountIdentity {
  const label = typeof email === 'string' ? email.trim() : '';
  if (!label) return { key: 'cursor:desktop', label: 'Your Cursor account' };
  return { key: label.toLowerCase(), label };
}

export type CursorPool = 'cursor-models' | 'other-models';
const poolPercentage = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
  // Match Cursor's display: nonzero usage below 1% is shown as 1%.
  return value > 0 && value < 1 ? 1 : Math.round(Math.min(value, 100));
};

export function normalizeCursorUsage(
  data: any,
  now = Date.now(),
  pool: CursorPool = 'cursor-models'
): Snapshot {
  const plan = data?.planUsage;
  let used: number;
  let source = 'Cursor plan · included usage';
  let breakdown: Snapshot['breakdown'];
  if (
    plan &&
    (Object.hasOwn(plan, 'autoPercentUsed') ||
      Object.hasOwn(plan, 'apiPercentUsed'))
  ) {
    const cursor = poolPercentage(plan.autoPercentUsed);
    const other = poolPercentage(plan.apiPercentUsed);
    const selected = pool === 'other-models' ? other : cursor;
    if (selected === undefined)
      throw new Error('Cursor has not reported the selected usage pool.');
    used = selected;
    source =
      pool === 'other-models'
        ? 'Cursor plan · Other Models'
        : 'Cursor plan · Cursor Models';
    breakdown = [
      ...(cursor !== undefined
        ? [{ label: 'Cursor Models', used: cursor }]
        : []),
      ...(other !== undefined ? [{ label: 'Other Models', used: other }] : [])
    ];
  } else if (pool === 'other-models') {
    throw new Error('Cursor has not reported the selected usage pool.');
  } else if (plan?.includedSpend != null || plan?.limit != null) {
    // Older responses without separate pool fields retain the legacy included-plan reading.
    const { includedSpend, limit } = plan;
    if (
      typeof includedSpend !== 'number' ||
      !Number.isFinite(includedSpend) ||
      includedSpend < 0 ||
      typeof limit !== 'number' ||
      !Number.isFinite(limit) ||
      limit <= 0
    )
      throw new Error('Cursor has not reported included plan usage.');
    used = (100 * includedSpend) / limit;
  } else {
    const match =
      typeof data?.displayMessage === 'string'
        ? planMessage.exec(data.displayMessage)
        : null;
    if (!match) throw new Error('Cursor has not reported included plan usage.');
    used = Number(match[1]);
  }
  const start = milliseconds(data.billingCycleStart);
  const end = milliseconds(data.billingCycleEnd);
  const minutes = Math.round((end - start) / 60000);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start <= 0 ||
    !(minutes > 0)
  )
    throw new Error('Cursor has not reported a valid billing cycle.');
  return {
    observedAt: now,
    monthly: { used: Math.min(100, used), minutes, resetsAt: end / 1000 },
    source,
    ...(breakdown ? { breakdown } : {})
  };
}

type SignInReader = () => Promise<string | { token: string; email?: string }>;

export async function readCursorUsage(
  readSignIn: SignInReader = readCursorToken,
  request: typeof fetch = fetch,
  pool: CursorPool = 'cursor-models'
): Promise<Snapshot & { account: AccountIdentity }> {
  const signIn = await readSignIn();
  const token = typeof signIn === 'string' ? signIn : signIn.token;
  const email = typeof signIn === 'string' ? undefined : signIn.email;
  let response: Response;
  try {
    response = await request(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1'
      },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new Error('Cursor usage service is unreachable. Retrying shortly.');
  }
  if (response.status === 401 || response.status === 403)
    throw new Error('Cursor sign-in expired. Open Cursor to refresh it.');
  if (!response.ok)
    throw new Error(`Cursor usage request failed (HTTP ${response.status}).`);
  return {
    ...normalizeCursorUsage(await response.json(), Date.now(), pool),
    account: cursorIdentity(email)
  };
}
