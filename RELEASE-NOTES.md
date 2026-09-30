# AI Usage 0.0.75

AI subscription usage on Stream Deck, with all five service integrations in one open-source plugin. This preview includes the account-saving and managed sign-in cleanup fixes, updates vulnerable development dependencies, and strengthens release verification.

- Shortened the product name and Stream Deck category to AI Usage. Removed the settings-panel byline; copyright, author and independence notices remain. Plugin UUID and action IDs are unchanged.
- Refreshed the README preview with varied sample nicknames: BUILD, WRITE, PLAN, CODE and IDEAS.
- Updated the locked `brace-expansion` and `fast-uri` development dependencies to patched versions.
- Git history scanning now runs in linked worktrees as well as ordinary clones and fails if history cannot be inspected.
- Clarified local credential boundaries, Cursor account identification, preview acceptance, and license disclaimers.
- The maintainer reports successful use in the macOS Stream Deck app. Physical hardware and Windows remain unverified.

- Account and palette changes are confirmed by reading settings back from Stream Deck before success is reported. Failed saves preserve the prior in-memory values and show an error. Concurrent conflicting edits are rejected for retry.
- Edits made while the settings connection starts are queued; editing is disabled if the connection closes.
- Account cleanup accepts only managed provider/UUID directories and rejects outside paths, parent directories, symlinked paths, and folders referenced by another account.
- Repeated sign-in preserves the previous credentials until the replacement is saved, then removes the superseded folder. Failed cleanup remains tracked for retry without deleting the new sign-in.
- Regression tests exercise these failure cases in the built plugin and settings panel, plus filesystem and sign-in lifecycle tests.

- Multiple keys, supported accounts, account pinning, nicknames, and custom colors are included. Cursor follows its active app account.
- Used or remaining percentages and reset countdowns reflect the windows supplied by each source.
- Claude is identified by ordinary text. OpenAI, Grok Bot, Cursor, and SuperGrok artwork is preserved.
- The README, settings panel, and packaged notices identify AI Usage as an independent 3Fold Labs product with no provider affiliation, sponsorship, or endorsement.
- Maintained runtime and inspector modules, with checked dependency layers, linting, formatting and generated-output verification.
- Sign-in cancellation waits for acknowledgement with a bounded shutdown deadline. Optional desktop discovery does not block explicit account files on build hosts.
- One installer: `3FoldLabs-AI-Usage.streamDeckPlugin`.

Requires Stream Deck 7.1+, macOS 13+ or Windows 10+, plus the relevant signed-in provider applications. See [connections](docs/CONNECTIONS.md) and [known limitations](docs/KNOWN-LIMITATIONS.md).
