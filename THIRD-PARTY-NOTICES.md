# Third-party notices

AI Usage is independently developed by 3Fold Labs. It is not affiliated with, sponsored by, endorsed by, or an official product of Elgato, OpenAI, Anthropic, xAI, Anysphere, or their services. Third-party names and artwork identify compatible services only. Their inclusion is not a recommendation or promotion of those brands. All trademarks belong to their respective owners. The project's MIT license does not grant rights to third-party trademarks or artwork.

## Service identifiers

- **Claude / Anthropic:** ordinary descriptive text only. No Claude or Anthropic logo, symbol, or stylized wordmark is included.
- **OpenAI / ChatGPT:** official black and white Blossom artwork from `https://cdn.openai.com/brand/openai-logos.zip`, retrieved September 13, 2026. The supplied SVG paths and fills are retained unchanged. PNG source copies preserve the supplied clear space. OpenAI owns the mark; use is subject to `https://openai.com/brand/`. It is a secondary service identifier, not AI Usage branding. No special permission or endorsement is claimed.
- **Grok Bot:** original icon from Grok Bot 0.44.0 (`dist/renderer/assets/app-icon-C7NKj2u7.png`), stored unchanged as `assets/grok-bot-app-icon.png`. No Grok Bot application code is bundled.
- **Cursor:** original icon from Cursor 3.20.10 (`Cursor.app/Contents/Resources/Cursor.icns`), converted to a 512 px PNG with macOS `sips` without altering the artwork, stored as `assets/cursor-app-icon.png`. Cursor is a product of Anysphere. No Cursor application code is bundled.
- **SuperGrok:** original 180 px apple-touch icon from grok.com, stored unchanged as `assets/grok-web-app-icon.png`. Grok and SuperGrok names and artwork belong to xAI.

No separate redistribution license for the Grok Bot, Cursor, or SuperGrok artwork is asserted by this repository. Retaining those assets does not imply permission or endorsement from their owners.

## Runtime dependencies

`@elgato/streamdeck` and its bundled dependencies are distributed with their license notices in the plugin's `licenses/` directory. The source code for AI Usage is licensed under MIT. Build tooling and asset-library notices are also preserved in the packaged notices.

The development-only ESLint toolchain includes `minimatch` under the [Blue Oak Model License 1.0.0](https://blueoakcouncil.org/license/1.0.0). It is not bundled into the plugin runtime.
