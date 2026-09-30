# Contributing

Keep provider reads narrow, preserve working sign-in behavior and use synthetic fixtures. Do not commit credentials, account data, local caches, screenshots containing real usage, or internal handoffs.

Run `npm ci --ignore-scripts --no-audit --no-fund` and `npm run security:release` before proposing a change. Dependencies must be exact-version pinned with registry integrity entries. Review dependency changes; never automatically merge them.

Do not log raw exceptions, HTTP requests/responses, headers, subprocess output or account records. User-visible errors pass through the exact application-message catalog. New response fields require an explicit privacy review and canary tests. Unknown provider product names use a fixed fallback.

Public releases require a passing gate, platform acceptance, provider acceptance and source/package integrity evidence. Keep versions consistent across package.json, lockfile and manifest; do not infer versions from this clean repository's commit count.

Maintain one full-featured plugin and one installer. Preserve multi-account, multi-key, nickname, palette and provider regression coverage. Use ordinary text for Claude; do not add Claude or Anthropic logo artwork. Do not publish private development notes or permission correspondence.

## Source layout

Use Node.js 24. Edit maintained files in `src/`, then run `npm run build`. Do not edit the generated runtime or inspector in `com.3foldlabs.ai-usage.sdPlugin/` directly. Its manifest is maintained separately.

- `src/plugin.ts` registers the Stream Deck actions and starts the runtime.
- `src/runtime/` separates global account storage, visible keys and sessions, painting/refresh, account operations and action handlers.
- `src/providers/` contains provider adapters and credential readers. `src/sources.ts` assembles them and `src/service.ts` handles reading, throttling and cache policy.
- `src/accounts.ts`, `model.ts`, `render.ts`, `security.ts`, `platform.ts` and `last-readings.ts` provide the shared domain logic.
- `src/inspector/` contains the browser UI: HTML and CSS, session state, helpers, transport, dialogs, colors, account controls and the entrypoint.
- `scripts/build.mjs` bundles both entrypoints with esbuild, inlines inspector styles and generates packaged artwork and notices.
- `test/` exercises the domain logic and the packaged plugin through synthetic Stream Deck events. No live provider sign-in is needed.

## Dependency boundaries

The runtime imports downward: action handlers → account operations → key refresh → store/service → providers → shared domain helpers. The entrypoint registers actions; nothing imports it. Shared session state and the inspector-message bridge sit below the runtime features. Type-only references do not create runtime dependencies.

The inspector imports downward: main → account/color features → transport/dialogs → helpers → state. It never imports the Node runtime, and the Node runtime never imports the inspector. The store owns its writable bindings. Shared browser/session objects carry state without reassigning another module's imported bindings.

`test/structure.test.ts` rejects upward imports, runtime cycles, unresolved imports and unreachable source modules. Its negative fixtures verify that the guard actually fails. Add new files to the appropriate layer in `scripts/check-structure.mjs`.

## Required checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run format:check
npm run lint
npm run check
npm run build
npm run build:check
npm test
npm run security:release
```

`npm run format` formats maintained sources. Third-party artwork and generated files are excluded. `build:check` compares generated files to the maintained source without replacing them. The release gate also validates the archive, scans source and reachable history, scans the extracted installer, audits dependencies and runs the tests against the packaged runtime. CI runs the gate for pushes to main and pull requests. Never include local credentials or real provider data in fixtures.
