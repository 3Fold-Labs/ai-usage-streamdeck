# Connections and data flow

Adapters measure specific subscription allowances, not API billing. Only visible keys refresh. Identical source settings share a cache. Missing readings remain missing rather than being estimated.

## ChatGPT / Codex source

- Spawns a native `codex app-server` process without a shell; sends initialization and `account/rateLimits/read` JSON-RPC requests.
- Prefers `rateLimitsByLimitId`; the default bucket is `codex`. Uses legacy data only when its bucket matches.
- Authentication belongs to Codex. The plugin does not read Codex credential files or log its credentials.
- Automatic polling is at most once per minute per source; manual refreshes have a 15-second minimum.
- Short and weekly windows use their reported duration. Some subscriptions expose only weekly data.
- This is the **Codex allowance included with ChatGPT**, not general ChatGPT conversations or API charges.

## Claude

### Desktop history

Reads `%APPDATA%\Claude\plan-usage-history.json` or the corresponding Windows Store package's local cache. If both exist, the inspector requires an explicit selection. A custom absolute path is supported; files are limited to 8 MB.

On Mac, checks `~/Library/Application Support/Claude/plan-usage-history.json`. This is an expected desktop location, with live Mac format verification still pending. The optional Code exporter works with the same home-directory paths on both operating systems.

The last sample supplies `t` (observation time in milliseconds), `u.fh` (five-hour percentage), and `u.sd` (weekly percentage). Organization metadata is not returned to the key. This internal file format may change. Polling reads the file every 15 seconds; it cannot cause Desktop to fetch a new sample. No cookies, credentials, or conversation data are needed.

The history has no reset timestamp. A percentage can be available while its countdown displays **N/A**. The inspector explains which source is missing reset data. Reset times are never inferred from a percentage drop or the history's sample time.

### Optional Claude Code exporter

**Connect Claude reset times** installs `claude-statusline.mjs` under `~/.ai-usage-streamdeck` and updates `statusLine` in `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR/settings.json`). It also saves the exporter path as this button's source, replacing its previous Desktop/custom file selection. A timestamped settings backup is created first. An existing status-line command is preserved and invoked with its original input; that user-configured command retains its own behavior.

The exporter writes `observedAt`, quota percentages, supplied reset timestamps and, when Claude Code's `.claude.json` provides them, the account's organization UUID, organization name and email to `~/.ai-usage-streamdeck/claude.json`, plus a per-organization copy at `~/.ai-usage-streamdeck/claude-accounts/<organization-uuid>.json`. Files are replaced atomically with owner-only file permissions. Prompts, transcripts and tokens are not saved. It ignores empty quota updates. Sign in to Claude Code with the same subscription account as Desktop, restart it after setup, and use it normally to receive the first reading. The plugin does not send a model request to generate usage. The connection uses the exporter for both percentage and reset time; it does not combine accounts or sources. Set up each affected key. Clear the usage file field to return to Desktop history. `AI_USAGE_DATA_DIR` can override the export directory for local development and tests.

To remove the exporter, restore only the original `statusLine` field from the backup, or remove that field if none existed. Preserve other settings changes made since installation. After no settings refer to the exporter, its files in `~/.ai-usage-streamdeck` can be removed. Uninstalling the Stream Deck plugin does not automatically revert Claude Code settings.

## Grok Bot

This adapter is **disabled until enabled in the key's settings**. It supports the desktop interface observed in Grok Bot 0.44.0, not a general Grok quota API. The SuperGrok shared pool has its own adapter below.

1. Reads the active account entry from `%APPDATA%\Grok Bot\sand-secrets.json` on Windows, or `~/Library/Application Support/Grok Bot/sand-secrets.json` on Mac.
2. On Windows, uses DPAPI under the current user to unlock the app's encrypted key from `Local State`. On Mac, invokes `/usr/bin/security find-generic-password` with the fixed service `Grok Bot Safe Storage` and account `Grok Bot Key`; its output is captured privately. No other Keychain items are queried. A macOS access prompt must be handled by the user.
3. Decrypts the active access token and optional selected team ID in memory. It does not read or use a refresh token. The binary encryption key is cleared after decryption; JavaScript token strings remain subject to normal garbage collection.
4. Sends an authenticated read-only usage request with an empty JSON body to this fixed HTTPS endpoint:

   `https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus`

5. Uses `usagePercent` and `nextResetTimestampUtc` for weekly usage. A pooled enterprise allowance is rejected as unsuitable for a personal quota.

The endpoint is internal to the supported desktop app's backend. Redirects are rejected; requests time out after ten seconds. A 401/403 asks the user to reopen and sign into Desktop; no token refresh is attempted. Automatic requests are limited to once per minute per source, with a 15-second manual-refresh minimum.

The Mac implementation supports Chromium's `v10` AES-128-CBC format: PBKDF2-SHA1 with `saltysalt`, 1003 iterations, a 16-byte key, and a 16-space IV. The Keychain read has a 60-second timeout to allow the user to respond. Denial or timeout pauses automatic retries for that source until an explicit refresh or reconnect. Password and key buffers are cleared after use; token strings are garbage-collected. Plaintext and unknown encryption formats are rejected. Live Mac verification (2026-09-08): Keychain service `Grok Bot Safe Storage`, account `Grok Bot Key` (not bare `Grok Bot`), with `~/Library/Application Support/Grok Bot/sand-secrets.json`.

Implementation references: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [Electron Keychain naming](https://github.com/electron/electron/blob/main/shell/browser/electron_browser_main_parts.cc), and [Chromium v10 macOS format](https://chromium.googlesource.com/chromium/src/+/refs/tags/111.0.5556.0/components/os_crypt/os_crypt_mac.mm).

No access token is written to settings, previews, or logs. The plugin does not call chat, model-generation, billing-change, or extra-credit endpoints. Desktop login must remain valid. To stop all plugin requests, disable or disconnect every Grok Bot key; this does not log out Desktop.

## Cursor

This adapter is **disabled until enabled in the key's settings**, because it reads another app's sign-in.

1. Opens Cursor's local state database **read-only** with Node's built-in `node:sqlite` module: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` on Mac, or `%APPDATA%\Cursor\User\globalStorage\state.vscdb` on Windows. Nothing is written, and the database is closed after each read.
2. Reads only `cursorAuth/accessToken` and `cursorAuth/cachedEmail` from `ItemTable`. The access token stays in memory; the cached email identifies the active account in the local account selector. The refresh token is not read or used.
3. Cursor keeps this database open in WAL mode. If it is busy or locked, the read waits up to half a second, then reports a retry message and tries again on the next refresh.
4. Sends an authenticated read-only request with an empty JSON body (`Authorization: Bearer`, `Content-Type: application/json`, `Connect-Protocol-Version: 1`) to this fixed HTTPS endpoint:

   `https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`

5. Current Cursor plans expose two monthly pools: `planUsage.autoPercentUsed` supplies **Cursor Models** (Grok and Composer), and `planUsage.apiPercentUsed` supplies **Other Models**. These fields are already percentages; they are not multiplied by 100. **Cursor usage pool** selects which one the key displays, defaulting to Cursor Models. `CM` and `OM` on the key distinguish the pools. The inspector shows both available percentages.
6. Match Cursor's percentage display: zero stays zero, positive usage below 1% displays as 1%, other values round to the nearest whole percent, capped at 100%. `billingCycleStart` and `billingCycleEnd` supply the monthly reset countdown. Missing or invalid selected-pool data remains unavailable and cannot fall back to another pool.
7. Older responses with neither pool field retain the legacy `includedSpend / limit` calculation (or the recognized included-usage message when spend fields are absent), labeled **Cursor plan · included usage** with an `M` key label. Selecting Other Models requires its explicit pool field. On-demand spending is never displayed as subscription allowance.

The old single-meter calculation could show 21% while the same response supplied 1% for Cursor Models and 0% for Other Models. v0.0.65 corrects this mismatch. Cursor's [official usage-pool documentation](https://cursor.com/docs/models-and-pricing) and the current app's percentage formatting were checked when implementing this mapping.

Redirects are rejected; requests time out after ten seconds. A 401/403 asks the user to open Cursor so it can refresh its sign-in; no token refresh is attempted. Automatic requests are limited to once per minute per source, with a 15-second manual-refresh minimum. The endpoint is internal to Cursor's backend and may change.

No access token is written to settings, previews, or logs. The plugin does not call chat, model-generation, or billing-change endpoints. To stop all plugin requests, disable or disconnect every Cursor key; this does not log out Cursor.

## SuperGrok

To add an account, use **Add SuperGrok account**. On the xAI browser page, confirm the prefilled code matches the one in the plugin, click **Continue**, and finish approval. If the browser field is empty, enter the plugin's code on that page. Nothing needs to be pasted into Stream Deck. Keep the plugin panel open while the Grok CLI waits for approval; it closes when sign-in finishes. The new account then appears in the account selector. Choose it for the key and enable its connection. This follows the [official Grok CLI device-code flow](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md).

This adapter is **disabled until enabled in the key's settings**. It measures the SuperGrok subscription's shared weekly usage pool under xAI unified billing. Chat, Imagine, Voice, Build and the Grok CLI all draw from this pool, and it matches grok.com **Settings → Usage**. It is not the Grok Bot allowance above and not xAI API billing.

1. Reads the Grok CLI sign-in file `~/.grok/auth.json` (the same home-directory path on Windows and Mac), limited to 8 MB. The file is a JSON object of CLI sessions. `refresh_token` values are discarded while parsing and never used.
2. Considers only sessions with a string `key` and `email`, reading only `key`, `email`, and `expires_at`. A single session is used. With several, the account email entered under **Connection settings** selects one (case-insensitive). An entered email must match a session, so another account is never substituted.
3. If `expires_at` is in the past, no request is sent. CLI sessions last about six hours and only the Grok CLI renews them. The key keeps its last reading with an amber dot, and the inspector says to run `grok` once.
4. Sends an authenticated read-only request (`Authorization: Bearer`, `x-xai-token-auth: xai-grok-cli`, `Accept: application/json`) to this fixed HTTPS endpoint:

   `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`

5. Uses `config.creditUsagePercent` (0 to 100) for weekly usage and `config.currentPeriod.end` for the reset time. Only a seven-day `currentPeriod` is accepted; other periods are reported as unsupported. Valid `productUsage` entries appear in the inspector as a per-product split, for example "By product: Build 24%". On-demand, prepaid balance, and top-up fields are ignored.

Redirects are rejected; requests time out after ten seconds. A 401/403 is reported as an expired sign-in; no token refresh is attempted. Automatic requests are limited to once per minute per source, with a 15-second manual-refresh minimum. The endpoint belongs to the Grok CLI's backend and may change.

No session key is written to settings, previews, or logs. The plugin does not call chat, model-generation, billing-change, or top-up endpoints. To stop all plugin requests, disable or disconnect every SuperGrok key; this does not sign out the Grok CLI.

## Display and account boundaries

Percentages refer to the source account's allowance, not just the current conversation or app window. Disconnect/reconnect clears the key's cached view, but there is no separate per-key login system. Refresh the source after changing accounts and reconnect all affected keys.

After five minutes, or on a refresh error, a cached reading is marked stale. When a known reset time has passed without a fresh reading, the percentage is hidden. Sources without reset timestamps can only use the stale indicator. The inspector includes errors and timestamps to distinguish these cases.
