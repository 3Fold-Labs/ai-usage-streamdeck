import { state, Visible } from './state.js';
import type { Provider } from '../model.js';
import { usage, registryReady } from './store.js';
import { imageData, renderButton } from '../render.js';
import { selectWindow, stateOf, windowLabel } from '../model.js';
import { sendToPi } from './bridge.js';
import { defaultClaudeFile } from '../service.js';
import streamDeck from '@elgato/streamdeck';

const sourcesLabel: Record<Provider, string> = {
  openai: 'ChatGPT subscription · Codex allowance',
  anthropic: 'Claude subscription · Claude Code source',
  grok: 'Grok Bot subscription',
  cursor: 'Cursor plan · included usage',
  supergrok: 'SuperGrok subscription · shared weekly pool'
};

export async function paint(item: Visible) {
  if (state.visible.get(item.key.id) !== item) return;
  if (item.painting) {
    item.repaintRequested = true;
    return;
  }
  item.painting = true;
  try {
    const revision = item.revision;
    const snapshot = item.snapshot;
    // Account names are shared; old per-key copies must not mask a later rename.
    const nickname =
      (await usage.nicknameFor(item.provider, item.settings, snapshot)) ??
      item.settings.nickname?.trim();
    if (state.visible.get(item.key.id) !== item) return;
    if (item.revision !== revision) {
      item.repaintRequested = true;
      return;
    }
    await item.key.setImage(
      imageData(
        renderButton(
          item.provider,
          selectWindow(snapshot, item.kind, item.settings.window),
          snapshot,
          {
            remaining: item.settings.remaining,
            reset: item.resetUntil > Date.now(),
            nickname,
            barColor: item.settings.barColor,
            keyColor: item.settings.keyColor
          }
        )
      )
    );
  } catch {
    // The key can disappear while its image is being sent.
  } finally {
    item.painting = false;
    // A refresh can finish while the first nickname lookup is in flight.
    if (item.repaintRequested) {
      item.repaintRequested = false;
      void paint(item);
    }
  }
}

export async function refresh(item: Visible, force = false) {
  await registryReady;
  const revision = item.revision;
  try {
    const snapshot = await usage.get(item.provider, item.settings, force);
    if (state.visible.get(item.key.id) !== item || item.revision !== revision)
      return;
    item.snapshot = snapshot;
    const kind = selectWindow(snapshot, item.kind, item.settings.window);
    const { window, stale, expired } = stateOf(snapshot, kind);
    await paint(item);
    if (state.visible.get(item.key.id) !== item || item.revision !== revision)
      return;
    if (state.inspectorContext === item.key.id) {
      await sendToPi({
        provider: item.provider,
        kind,
        status:
          snapshot.error ||
          (expired
            ? 'Waiting for a new reading after reset.'
            : !window
              ? 'This account has not reported this usage window.'
              : stale
                ? 'Last known reading. Waiting for an update.'
                : 'Connected'),
        observedAt: snapshot.observedAt,
        used: window?.used ?? null,
        window: windowLabel(window, kind),
        resetsAt: window?.resetsAt ?? null,
        shortWindowMinutes: snapshot.short?.minutes ?? null,
        resetHelp:
          window && !window.resetsAt
            ? snapshot.source === 'Claude Desktop'
              ? 'Reset time unavailable: Desktop history saves percentages only. Connect Claude Code below to receive reset timestamps.'
              : 'The source has not supplied a reset time for this window yet.'
            : null,
        source: snapshot.source || sourcesLabel[item.provider],
        breakdown: snapshot.breakdown ?? null,
        claudeFile: defaultClaudeFile()
      });
    }
  } catch {
    streamDeck.logger.warn(
      'Unable to update usage button. It will retry on the next refresh.'
    );
  }
}

export async function repaintProvider(provider: Provider) {
  for (const item of state.visible.values()) {
    if (item.provider !== provider) continue;
    item.revision++;
    usage.clear(provider, item.settings);
    void refresh(item, true);
  }
}
