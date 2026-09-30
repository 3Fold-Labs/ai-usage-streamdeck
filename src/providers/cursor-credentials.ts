import { stat } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import {
  appDataDirectory,
  currentHost,
  hostPath,
  type Host
} from '../platform.js';

export const cursorStateFile = (host: Host = currentHost()) =>
  hostPath(host).join(
    appDataDirectory('Cursor', host),
    'User',
    'globalStorage',
    'state.vscdb'
  );

/** Cursor keeps its state database open in WAL mode; never write to it. */
export async function openCursorState(file: string): Promise<DatabaseSync> {
  // Load SQLite only when the Cursor connection is enabled.
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(file, { readOnly: true, timeout: 500 });
}

const busy = (error: unknown) => {
  const { errcode, message } = (error ?? {}) as {
    errcode?: unknown;
    message?: unknown;
  };
  // SQLITE_BUSY (5) and SQLITE_LOCKED (6), including extended result codes.
  return typeof errcode === 'number'
    ? [5, 6].includes(errcode & 0xff)
    : /database (table )?is (locked|busy)/i.test(String(message));
};

const asText = (value: unknown) =>
  value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : value;

const decodeToken = (value: unknown) => {
  const token = asText(value);
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token))
    throw new Error('No Cursor sign-in found. Open Cursor and sign in.');
  return token;
};

// Reject empty, multiline, or oversized values; Cursor stores email as text or blob.
const decodeEmail = (value: unknown): string | undefined => {
  const text = asText(value);
  if (typeof text !== 'string') return undefined;
  const email = text.trim();
  if (!email || /[\r\n]/.test(email) || email.length > 300) return undefined;
  return email;
};

async function withCursorState<T>(
  host: Host,
  open: typeof openCursorState,
  read: (db: DatabaseSync) => T
): Promise<T> {
  const file = cursorStateFile(host);
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    throw new Error('Open Cursor and sign in to connect plan usage.');
  }
  let db: DatabaseSync | undefined;
  try {
    db = await open(file);
    return read(db);
  } catch (error) {
    if (busy(error))
      throw new Error('Cursor is updating its sign-in data. Retrying shortly.');
    throw new Error('Could not read Cursor sign-in data. Reopen Cursor.');
  } finally {
    db?.close();
  }
}

export async function readCursorToken(
  host: Host = currentHost(),
  open = openCursorState
): Promise<string> {
  const value = await withCursorState(
    host,
    open,
    (db) =>
      (
        db
          .prepare(
            "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"
          )
          .get() as { value?: unknown } | undefined
      )?.value
  );
  return decodeToken(value);
}

export async function readCursorSignIn(
  host: Host = currentHost(),
  open = openCursorState
): Promise<{ token: string; email?: string }> {
  const { tokenValue, emailValue } = await withCursorState(host, open, (db) => {
    const tokenValue = (
      db
        .prepare(
          "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"
        )
        .get() as { value?: unknown } | undefined
    )?.value;
    const emailValue = (
      db
        .prepare(
          "SELECT value FROM ItemTable WHERE key = 'cursorAuth/cachedEmail'"
        )
        .get() as { value?: unknown } | undefined
    )?.value;
    return { tokenValue, emailValue };
  });
  return { token: decodeToken(tokenValue), email: decodeEmail(emailValue) };
}
