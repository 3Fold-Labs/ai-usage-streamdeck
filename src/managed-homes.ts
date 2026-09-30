import { lstat, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const managedDataDirectory = () =>
  process.env.AI_USAGE_DATA_DIR || path.join(homedir(), '.ai-usage-streamdeck');

const unsafe = () =>
  new Error(
    'Account folder cleanup was blocked because its location is unsafe.'
  );

// Only the UUID directories created for this plugin's sign-in sessions may be removed.
// Check both the lexical path and every on-disk component before recursive deletion.
export async function validateManagedHome(home: string): Promise<boolean> {
  const base = path.resolve(managedDataDirectory());
  if (!path.isAbsolute(home)) throw unsafe();
  const relative = path.relative(base, path.resolve(home));
  const parts = relative.split(path.sep);
  if (
    parts.length !== 3 ||
    parts[0] !== 'accounts' ||
    !['openai', 'anthropic', 'grok', 'cursor', 'supergrok'].includes(
      parts[1]
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      parts[2]
    )
  )
    throw unsafe();
  let current = base;
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new Error('Could not remove account sign-in files. Try again.');
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafe();
  }
  if (path.relative(await realpath(base), await realpath(home)) !== relative)
    throw unsafe();
  return true;
}

export async function clearManagedHome(home?: string) {
  if (!home || !(await validateManagedHome(home))) return;
  try {
    // Node removes nested symbolic links themselves, without following their targets.
    await rm(home, { recursive: true, force: true });
  } catch {
    throw new Error('Could not remove account sign-in files. Try again.');
  }
}
