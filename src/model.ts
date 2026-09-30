export type Provider = 'openai' | 'anthropic' | 'grok' | 'cursor' | 'supergrok';
export type WindowKind = 'short' | 'weekly' | 'monthly';
export type UsageWindow = { used: number; minutes: number; resetsAt?: number };
// key: stable per provider (lowercase email or org uuid); label: shown to people.
export type AccountIdentity = { key: string; label: string };
export type Snapshot = {
  short?: UsageWindow;
  weekly?: UsageWindow;
  monthly?: UsageWindow;
  observedAt: number;
  error?: string;
  source?: string;
  breakdown?: { label: string; used: number }[];
  idle?: boolean;
  account?: AccountIdentity;
};

export function selectWindow(
  snapshot: Snapshot | undefined,
  kind: WindowKind,
  preference?: 'auto' | WindowKind
): WindowKind {
  // Billing-cycle actions have a single window.
  if (kind === 'monthly') return 'monthly';
  if (preference === 'short' || preference === 'weekly') return preference;
  if (kind === 'weekly' && preference !== 'auto') return 'weekly';
  return snapshot?.short ? 'short' : snapshot?.weekly ? 'weekly' : kind;
}

export function windowLabel(
  window?: UsageWindow,
  kind: WindowKind = 'short'
): string {
  if (!window) return kind === 'weekly' ? 'W' : kind === 'monthly' ? 'M' : '5H';
  const m = window.minutes;
  if (m === 10080) return 'W';
  // Billing cycles span 28 to 31 days.
  if (m >= 40320 && m <= 44640) return 'M';
  return m >= 1440 && m % 1440 === 0
    ? `${m / 1440}D`
    : m >= 60 && m % 60 === 0
      ? `${m / 60}H`
      : `${m}M`;
}

export function countdown(
  resetsAt: number | undefined,
  now = Date.now()
): string {
  if (!resetsAt) return '—';
  const m = Math.max(0, Math.ceil((resetsAt * 1000 - now) / 60000));
  if (m === 0) return 'SOON';
  if (m >= 1440)
    return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function stateOf(
  snapshot: Snapshot | undefined,
  kind: WindowKind,
  now = Date.now()
) {
  const window = snapshot?.[kind];
  // Idle chosen accounts keep their most recent percentage, even past a known reset.
  const expired =
    !!window?.resetsAt && window.resetsAt * 1000 <= now && !snapshot?.idle;
  const stale =
    !!snapshot &&
    (now - snapshot.observedAt > 5 * 60_000 ||
      !!snapshot.error ||
      !!snapshot.idle);
  return { window, expired, stale, available: !!window && !expired };
}
