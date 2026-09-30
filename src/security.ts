import type { Snapshot, UsageWindow } from './model.js';

// Exact application-authored messages only; never format upstream exceptions.
const publicMessages = new Set<string>([
  'Accounts changed during this edit. Try again.',
  'The color palette changed during this edit. Try again.',
  'Account folder cleanup was blocked because its location is unsafe.',
  'Account folder cleanup was blocked because another account uses it.',
  'Could not remove account sign-in files. Try again.',
  'AI Usage supports Windows and macOS.',
  'ChatGPT sign-in did not complete. Try again.',
  'Choose an absolute Claude usage file path.',
  'Choose the full path to the Codex executable, not a shell script.',
  'Claude Code was not found. Install it, then try again.',
  'Claude Desktop has not reported subscription percentages.',
  'Claude Desktop has not saved a usage reading yet. Open Settings → Usage in Claude.',
  'Claude is signed into this account right now. Switch it to another account first.',
  'Claude sign-in finished without an account. Approve the browser page, then try again.',
  'Claude sign-in timed out.',
  'Claude usage file is too large.',
  'Codex closed before the sign-in finished.',
  'Codex connection closed.',
  'Codex could not start a ChatGPT sign-in.',
  'Codex did not report its account after sign-in.',
  'Codex did not report its account in time.',
  'Codex did not report its account.',
  'Codex did not start the sign-in in time.',
  'Codex executable not found. Choose its full path in Connection settings.',
  'Codex exited before it reported its account.',
  'Codex exited before returning usage. Check your Codex sign-in.',
  'Codex initialization failed. Update Codex and retry.',
  'Codex is signed into this account right now. Switch it to another account first.',
  'Codex returned an unexpected sign-in response.',
  'Codex usage request timed out. Check your connection and sign-in.',
  'Could not open Grok Bot.',
  'Could not open the app.',
  'Could not open the sign-in page.',
  'Could not read Cursor sign-in data. Reopen Cursor.',
  'Could not read the active Grok Bot sign-in. Reopen Grok Bot Desktop.',
  'Could not remove this account.',
  'Could not rename this account.',
  'Could not set the nickname.',
  'Could not start Codex. Check the executable path.',
  'Could not start sign-in.',
  'Could not unlock the current Windows user’s Grok Bot sign-in.',
  'Could not update Claude settings. Run tools/connect-claude.mjs manually to see the reason. Existing settings were preserved or backed up.',
  'Cursor has not reported a valid billing cycle.',
  'Cursor has not reported included plan usage.',
  'Cursor has not reported the selected usage pool.',
  'Cursor is signed into this account right now. Switch it to another account first.',
  'Cursor is updating its sign-in data. Retrying shortly.',
  'Cursor keeps one account at a time, so this key follows the Cursor app.',
  'Cursor manages its sign-in. Sign out inside Cursor to remove it.',
  'Cursor sign-in expired. Open Cursor to refresh it.',
  'Cursor usage service is unreachable. Retrying shortly.',
  'Grok Bot Keychain access is unavailable. Open Grok Bot, then select Refresh now to retry. Automatic Keychain retries are paused.',
  'Grok Bot Mac sign-in format changed.',
  'Grok Bot Windows sign-in format changed.',
  'Grok Bot account data changed. Reopen Grok Bot Desktop.',
  'Grok Bot has not reported a valid reset time.',
  'Grok Bot has not reported a valid subscription percentage.',
  'Grok Bot is signed into this account right now. Switch it to another account first.',
  'Grok Bot manages this account. Remove it inside Grok Bot and it disappears here.',
  'Grok Bot reports a pooled team allowance; individual weekly usage is unavailable.',
  'Grok Bot sign-in expired. Open Grok Bot Desktop to refresh it.',
  'Grok Bot sign-in format changed.',
  'Grok Bot usage service is unreachable. Retrying shortly.',
  'Grok CLI sign-in file could not be read. Run grok login again.',
  'Grok CLI sign-in file is too large.',
  'Grok CLI sign-in format changed. Run grok login again.',
  'Grok CLI sign-in timed out. Try again.',
  'Grok CLI sign-in was cancelled.',
  'Grok CLI was not found. Install it, then try again.',
  'Invalid Claude Desktop usage timestamp.',
  'Invalid Claude usage timestamp. Reconnect the status line.',
  'Invalid provider data. Waiting for a valid reading.',
  'Last known reading. Waiting for an update.',
  'Logo ready. Plan usage connection is off. Enable the Cursor sign-in connection below to read billing-cycle usage.',
  'Logo ready. Subscription connection is off. Enable the Grok CLI sign-in connection below to read the shared weekly pool.',
  'Logo ready. Subscription connection is off. Enable the desktop sign-in connection below to read weekly usage.',
  'Multiple Claude usage histories found. Choose the active Desktop history in Connection settings.',
  'Nickname must be 1 to 5 letters or numbers.',
  'No Claude usage history found. Open Claude Desktop Settings → Usage, or connect Claude Code below.',
  'No Cursor sign-in found. Open Cursor and sign in.',
  'No Grok CLI sign-in matches the account email in Connection settings.',
  'No active Grok Bot sign-in found. Open Grok Bot Desktop.',
  'No limits returned for this bucket. Sign in to Codex with ChatGPT or check the bucket ID.',
  'No reading yet for this Claude account. Use it once in Claude Desktop or Claude Code.',
  'Open Cursor and sign in to connect plan usage.',
  'Open Grok Bot Desktop and sign in to connect subscription usage.',
  'Open Grok Bot and add or switch the account there. This panel watches for it and adds it to the list.',
  'Reset time unavailable: Desktop history saves percentages only. Connect Claude Code below to receive reset timestamps.',
  'Reset-time source selected for this button. Sign in to Claude Code with your Claude subscription, restart it, and use it normally for the first reading.',
  'Several Grok accounts are signed in. Enter the account email under Connection settings.',
  'Sign in to the Grok CLI (run grok login) to connect SuperGrok usage.',
  'Sign-in timed out. Start again to get a new code.',
  'SuperGrok has not reported a valid usage percentage.',
  'SuperGrok has not reported a valid usage period.',
  'SuperGrok reported an unsupported usage period.',
  'SuperGrok sign-in expired. Run grok once to renew it.',
  'SuperGrok usage service is unreachable. Retrying shortly.',
  'That sign-in link is not allowed.',
  'The Codex path must point to an executable file.',
  'The Grok CLI did not show a sign-in code. Update it and try again.',
  'The Grok CLI finished without saving a sign-in. Try again.',
  'The Grok CLI is not signed into this account right now.',
  'The Grok CLI is signed into this account right now. Switch it to another account first.',
  'The source has not supplied a reset time for this window yet.',
  'This ChatGPT account has no sign-in folder. Add it again.',
  'This Grok Bot account is no longer signed in to Grok Bot.',
  'This SuperGrok account is no longer signed in. Add it again.',
  'This account has not reported this usage window.',
  'This account is no longer on the deck.',
  'This button is disconnected. Sign in to the provider app, then reconnect this button.',
  'This folder is signed into a different ChatGPT account.',
  'This service does not support adding accounts here.',
  'Unable to update usage button. It will retry on the next refresh.',
  'Usage unavailable. Sign in to Codex with your ChatGPT subscription, then retry.',
  'Wait for a reading, then set the nickname.',
  'Waiting for Claude Code subscription usage. Sign in with the same Claude account, restart Claude Code, and use it normally to produce a reading.',
  'Waiting for Claude Code to report subscription limits after a response.',
  'Waiting for a new reading after reset.'
]);
export function safeError(
  error: unknown,
  fallback = 'Usage unavailable. Reconnect the provider or try again.'
): string {
  return error instanceof Error && publicMessages.has(error.message)
    ? error.message
    : fallback;
}
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
function window(value: UsageWindow | undefined): UsageWindow | undefined {
  if (
    !value ||
    !finite(value.used) ||
    value.used < 0 ||
    !finite(value.minutes) ||
    value.minutes <= 0
  )
    return;
  return {
    used: value.used,
    minutes: value.minutes,
    ...(finite(value.resetsAt) && value.resetsAt > 0
      ? { resetsAt: value.resetsAt }
      : {})
  };
}
const sources = new Set([
  'Claude Desktop',
  'Cursor plan · included usage',
  'Cursor plan · Cursor Models',
  'Cursor plan · Other Models',
  'Grok Bot subscription',
  'SuperGrok subscription · shared weekly pool'
]);
const labels = new Set([
  'Cursor Models',
  'Other Models',
  'Build',
  'Chat',
  'Imagine',
  'Voice',
  'Imagine Video',
  'Other'
]);
/** Reconstruct values explicitly; structural TypeScript types are not a privacy boundary. */
export function allowSnapshot(input: Snapshot, persistent = false): Snapshot {
  const out: Snapshot = {
    observedAt: finite(input.observedAt) ? input.observedAt : 0
  };
  for (const kind of ['short', 'weekly', 'monthly'] as const) {
    const value = window(input[kind]);
    if (value) out[kind] = value;
  }
  if (input.source && sources.has(input.source)) out.source = input.source;
  if (Array.isArray(input.breakdown))
    out.breakdown = input.breakdown
      .slice(0, 32)
      .filter(
        (v) =>
          labels.has(v.label) && finite(v.used) && v.used >= 0 && v.used <= 100
      )
      .map((v) => ({ label: v.label, used: v.used }));
  // Account identity is required for local multi-account selection, never diagnostic output.
  if (
    !persistent &&
    input.account &&
    typeof input.account.key === 'string' &&
    typeof input.account.label === 'string'
  )
    out.account = { key: input.account.key, label: input.account.label };
  if (!persistent && input.error) out.error = safeError(new Error(input.error));
  if (!persistent && input.idle === true) out.idle = true;
  return out;
}
