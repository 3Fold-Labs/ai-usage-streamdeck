import type { AccountIdentity, Snapshot, UsageWindow } from '../model.js';

type Obj = Record<string, unknown>;
export const object = (value: unknown): Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Obj)
    : {};

export const CLAUDE_ORG_RE = /^[0-9a-f-]{36}$/i;
export const isClaudeOrgId = (value: unknown): value is string =>
  typeof value === 'string' && CLAUDE_ORG_RE.test(value);
export const claudeAccountLabel = (
  org: string,
  email?: string,
  name?: string
) => email?.trim() || name?.trim() || `Claude account ${org.slice(0, 8)}`;

export function claudeAccountFrom(input: unknown): AccountIdentity | undefined {
  const account = object(input);
  const org =
    typeof account.org === 'string' ? account.org.trim().toLowerCase() : '';
  if (!isClaudeOrgId(org)) return;
  const email = typeof account.email === 'string' ? account.email : undefined;
  const name = typeof account.name === 'string' ? account.name : undefined;
  return { key: org, label: claudeAccountLabel(org, email, name) };
}

function normalizeWindow(
  value: unknown,
  percentKey: string,
  minutes: unknown,
  resetKey: string
): UsageWindow | undefined {
  const w = object(value);
  const used = w[percentKey];
  if (
    typeof used !== 'number' ||
    !Number.isFinite(used) ||
    used < 0 ||
    used > 100 ||
    typeof minutes !== 'number' ||
    !Number.isFinite(minutes) ||
    minutes <= 0
  )
    return;
  const reset = w[resetKey];
  return {
    used,
    minutes,
    ...(typeof reset === 'number' && Number.isFinite(reset) && reset > 0
      ? { resetsAt: reset }
      : {})
  };
}

export function normalizeCodex(
  input: unknown,
  bucket = 'codex',
  now = Date.now()
): Snapshot {
  const data = object(input);
  const byId = object(data.rateLimitsByLimitId);
  // Never silently substitute a different model/bucket when the requested bucket is absent.
  const legacy = object(data.rateLimits);
  const raw = Object.keys(byId).length
    ? object(byId[bucket])
    : (!legacy.limitId && bucket === 'codex') || legacy.limitId === bucket
      ? legacy
      : {};
  const windows = [raw.primary, raw.secondary]
    .map((w) =>
      normalizeWindow(
        w,
        'usedPercent',
        object(w).windowDurationMins,
        'resetsAt'
      )
    )
    .filter((w): w is UsageWindow => !!w);
  return {
    observedAt: now,
    short: windows
      .filter((w) => w.minutes < 1440)
      .sort((a, b) => a.minutes - b.minutes)[0],
    weekly: windows.find((w) => w.minutes === 10080),
    ...(!windows.length
      ? {
          error:
            'No limits returned for this bucket. Sign in to Codex with ChatGPT or check the bucket ID.'
        }
      : {})
  };
}

export function normalizeClaude(input: unknown, now = Date.now()): Snapshot {
  const data = object(input);
  const limits = object(data.rate_limits);
  const observedAt = data.observedAt;
  if (
    typeof observedAt !== 'number' ||
    !Number.isFinite(observedAt) ||
    observedAt <= 0 ||
    observedAt > now + 60_000
  )
    throw new Error(
      'Invalid Claude usage timestamp. Reconnect the status line.'
    );
  const short = normalizeWindow(
    limits.five_hour,
    'used_percentage',
    300,
    'resets_at'
  );
  const weekly = normalizeWindow(
    limits.seven_day,
    'used_percentage',
    10080,
    'resets_at'
  );
  const account = claudeAccountFrom(data.account);
  return {
    observedAt,
    short,
    weekly,
    ...(account ? { account } : {}),
    ...(!short && !weekly
      ? {
          error:
            'Waiting for Claude Code to report subscription limits after a response.'
        }
      : {})
  };
}

/** Claude Desktop's usage-only history; never reads cookies or conversation storage. */
export function normalizeClaudeHistory(
  input: unknown,
  now = Date.now(),
  org?: string
): Snapshot {
  const data = object(input);
  const samples = data.samples;
  if (!Array.isArray(samples) || !samples.length)
    throw new Error(
      'Claude Desktop has not saved a usage reading yet. Open Settings → Usage in Claude.'
    );
  const wanted =
    org === undefined ? undefined : String(org).trim().toLowerCase();
  const matched =
    wanted === undefined
      ? samples
      : samples.filter(
          (entry) =>
            isClaudeOrgId(object(entry).org) &&
            String(object(entry).org).toLowerCase() === wanted
        );
  if (!matched.length)
    throw new Error(
      'Claude Desktop has not saved a usage reading yet. Open Settings → Usage in Claude.'
    );
  const sample = object(matched.at(-1));
  const observedAt = sample.t;
  if (
    typeof observedAt !== 'number' ||
    !Number.isFinite(observedAt) ||
    observedAt <= 0 ||
    observedAt > now + 60_000
  )
    throw new Error('Invalid Claude Desktop usage timestamp.');
  const usage = object(sample.u);
  const short = normalizeWindow({ used: usage.fh }, 'used', 300, 'resetsAt');
  const weekly = normalizeWindow({ used: usage.sd }, 'used', 10080, 'resetsAt');
  if (!short && !weekly)
    throw new Error(
      'Claude Desktop has not reported subscription percentages.'
    );
  const sampleOrg =
    typeof sample.org === 'string' ? sample.org.trim().toLowerCase() : '';
  const accountOrg =
    wanted ?? (isClaudeOrgId(sampleOrg) ? sampleOrg : undefined);
  const account = accountOrg
    ? { key: accountOrg, label: claudeAccountLabel(accountOrg) }
    : undefined;
  return {
    observedAt,
    short,
    weekly,
    source: 'Claude Desktop',
    ...(account ? { account } : {})
  };
}
