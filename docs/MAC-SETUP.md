# Mac setup

The same installer contains Windows and Mac support. It targets macOS 13 or newer and both Apple silicon and Intel, using Stream Deck's embedded Node runtime. Validate installation, live readings, and Keychain interaction on your Mac using the checklist below. Automated tests use synthetic data and do not certify a physical device.

## Get the installer onto your Mac

Copy the verified `3FoldLabs-AI-Usage.streamDeckPlugin` installer from `dist/` to your Mac. Copy the installer file itself, not an installed Windows plugin directory or Windows profile with custom paths.

Double-click it with Stream Deck 7.1 or newer installed, complete the installation prompt, and verify **AI Usage** (author 3Fold Labs), the version shown in the release. Expand that category in **Keys** and add the provider actions. Claude uses a plain-text label; the other services use their identifying artwork.

## Connect your apps

1. **ChatGPT Usage:** Open Codex and sign in with ChatGPT. Select the key and use **Refresh now**. Leave the executable field empty initially. Discovery checks `/Applications/Codex.app/Contents/Resources/codex`, the equivalent user Applications folder, `~/.local/bin/codex`, and Homebrew/npm locations. If nothing is found, choose the actual native Codex executable on this Mac. This still measures the included Codex allowance, not general ChatGPT conversation limits.
2. **Claude Usage:** Open Claude Desktop **Settings → Usage**, then refresh the key. The expected history file is `~/Library/Application Support/Claude/plan-usage-history.json`. For reset timestamps, select **Connect Claude reset times** to use the Claude Code exporter for that button. Sign in with the same subscription account, restart Claude Code and use it normally to obtain a reading. Desktop history supplies percentages without reset times.
3. **Grok Bot Usage:** Open and sign into Grok Bot. Select the key and enable its desktop sign-in connection under **Connection settings**. macOS may ask about **Grok Bot Safe Storage** / account **Grok Bot Key** in Keychain. You decide whether to allow the request; the plugin cannot answer it. If denied or timed out, automatic retries pause. Use **Refresh now** to try again. If the item or desktop data format differs, report the inspector message so the adapter can be corrected; do not copy tokens or Keychain secrets.
4. **Cursor Usage:** Open Cursor and sign in. Select the key and enable **Use my Cursor sign-in with api2.cursor.sh for plan usage** under **Connection settings**. The plugin opens `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` read-only; no Keychain prompt is expected. Compare the key with the included usage percentage on Cursor's dashboard. The `M` label is the billing cycle. A busy message clears on a later refresh.
5. **SuperGrok Usage:** Install the Grok CLI and run `grok login` with your SuperGrok account. Select the key and enable **Use my Grok CLI sign-in with cli-chat-proxy.grok.com for weekly usage**. If several accounts are signed in to the CLI, enter the account email. Compare the key with grok.com **Settings → Usage**. CLI sessions expire after about six hours; the key then keeps its last reading with an amber dot until you run `grok` again. This is not the Grok Bot allowance.

## Verify on the Mac

- Check the percentage against each app's own usage display and confirm the key's `5H`, `W`, or `M` label matches the same window.
- Confirm service identifiers stay steady, the white time label is visible, and the usage bar glows below the number.
- Press a key with a known reset timestamp; its countdown should appear for about four seconds, then return to percentage. Claude Desktop history may have no reset timestamp.
- Disconnect and reconnect a key. A disconnected key should show a dash; it should recover on reconnect once the source is available.
- Quit and reopen Stream Deck to verify settings persist. Provider apps may need reopening after app updates or session expiry.

For troubleshooting, share the provider name and the inspector's status text, plus your macOS version and whether the Mac uses Apple silicon or Intel. Avoid sending credential files. The Mac's app versions and architecture remain part of the live verification record.

## Development on Mac

With Node.js 24+ and the source folder available:

```sh
npm ci
npm run build
npm run check
npm test
npm run validate
npm run pack
```

Tests use fake local accounts, a temporary SQLite database, mock password reads, and mocked network responses; they do not access your Keychain or live provider APIs. The native executable-permission test runs only on macOS. See the repository's Actions tab for Windows and Mac CI results. Passing those automated checks does not replace live app and hardware verification on your Mac.
