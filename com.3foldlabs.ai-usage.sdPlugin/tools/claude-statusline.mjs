import { mkdir, writeFile, rename, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const ORG_RE = /^[0-9a-f-]{36}$/i;

/** Only percentages and reset timestamps leave stdin. No prompts, tokens, or transcripts are saved. */
export function extractUsage(data, now = Date.now()) {
  const rate_limits = {};
  for (const key of ['five_hour', 'seven_day']) {
    const w = data?.rate_limits?.[key];
    if (
      typeof w?.used_percentage !== 'number' ||
      !Number.isFinite(w.used_percentage) ||
      w.used_percentage < 0 ||
      w.used_percentage > 100
    )
      continue;
    rate_limits[key] = { used_percentage: w.used_percentage };
    if (
      typeof w.resets_at === 'number' &&
      Number.isFinite(w.resets_at) &&
      w.resets_at > 0
    )
      rate_limits[key].resets_at = w.resets_at;
  }
  return { observedAt: now, rate_limits };
}

/** Identity only: organizationUuid, organizationName, emailAddress. Never tokens. */
export function readClaudeIdentity(configFile) {
  return readFile(configFile, 'utf8')
    .then((raw) => {
      const oauth = JSON.parse(raw)?.oauthAccount;
      if (!oauth || typeof oauth !== 'object') return;
      const org =
        typeof oauth.organizationUuid === 'string'
          ? oauth.organizationUuid.trim()
          : '';
      if (!ORG_RE.test(org)) return;
      const name =
        typeof oauth.organizationName === 'string'
          ? oauth.organizationName.trim()
          : '';
      const email =
        typeof oauth.emailAddress === 'string' ? oauth.emailAddress.trim() : '';
      return {
        org: org.toLowerCase(),
        ...(name ? { name } : {}),
        ...(email ? { email } : {})
      };
    })
    .catch(() => undefined);
}

async function writeAtomic(file, data) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function run() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 1024 * 1024) return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  const directory =
    process.env.AI_USAGE_DATA_DIR ||
    path.join(homedir(), '.ai-usage-streamdeck');
  const snapshot = extractUsage(data);
  const configFile = process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(homedir(), '.claude.json');
  const account = await readClaudeIdentity(configFile);
  if (account) snapshot.account = account;
  const file = path.join(directory, 'claude.json');
  try {
    // Empty status-line events before a response do not invalidate another session's valid reading.
    if (Object.keys(snapshot.rate_limits).length) {
      await mkdir(directory, { recursive: true });
      await writeAtomic(file, snapshot);
      if (account?.org) {
        const accountsDir = path.join(directory, 'claude-accounts');
        await mkdir(accountsDir, { recursive: true });
        await writeAtomic(
          path.join(accountsDir, `${account.org}.json`),
          snapshot
        );
      }
    }
  } catch {
    /* Never disrupt Claude Code if the local usage file is unavailable. */
  }

  // Preserve a status line the user had configured before connecting this bridge.
  try {
    const previous = JSON.parse(
      await readFile(path.join(directory, 'previous-statusline.json'), 'utf8')
    );
    if (typeof previous.command === 'string' && previous.command) {
      const child = spawn(previous.command, {
        shell: true,
        windowsHide: true,
        stdio: ['pipe', 'inherit', 'ignore']
      });
      child.on('error', () => {});
      child.stdin.on('error', () => {});
      child.stdin.end(raw);
      const timer = setTimeout(() => child.kill(), 3000);
      child.on('close', () => clearTimeout(timer));
      return;
    }
  } catch {
    /* No previous status line. */
  }
  const short = snapshot.rate_limits.five_hour?.used_percentage;
  const weekly = snapshot.rate_limits.seven_day?.used_percentage;
  process.stdout.write(
    [
      short === undefined ? '' : `5h ${Math.round(short)}%`,
      weekly === undefined ? '' : `7d ${Math.round(weekly)}%`
    ]
      .filter(Boolean)
      .join(' · ') || 'Claude usage: waiting'
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await run();
