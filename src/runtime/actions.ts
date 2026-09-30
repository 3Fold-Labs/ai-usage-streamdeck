import { state, Visible } from './state.js';
import {
  Palettes,
  usage,
  registryReady,
  palettesMemory,
  savePalettes,
  registryApi
} from './store.js';
import { SingletonAction } from '@elgato/streamdeck';
import type { Settings } from '../service.js';
import type { Provider, WindowKind } from '../model.js';
import type {
  WillAppearEvent,
  WillDisappearEvent,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  PropertyInspectorDidAppearEvent,
  PropertyInspectorDidDisappearEvent,
  SendToPluginEvent
} from '@elgato/streamdeck';
import { paint, refresh, repaintProvider } from './keys.js';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { defaultClaudeFile } from '../service.js';
import { sendToPi } from './bridge.js';
import {
  handleAccounts,
  handleRename,
  handleRemove,
  handleAddAccount,
  cancelSignIn,
  allowedOpenUrl
} from './account-actions.js';
import { sources } from '../sources.js';
import { upsertIdentity, renameAccount } from '../accounts.js';
import { safeError } from '../security.js';
import path from 'node:path';
import streamDeck from '@elgato/streamdeck';

type PiPayload = {
  refresh?: boolean;
  connectClaude?: boolean;
  accounts?: boolean;
  rename?: {
    id: string;
    nick: string;
    name: string;
  };
  nickname?: string;
  remove?: {
    id: string;
  };
  addAccount?: boolean;
  cancelSignIn?: boolean;
  openUrl?: string;
  openApp?: boolean;
  palettes?: Palettes;
};

export class UsageAction extends SingletonAction<Settings> {
  constructor(
    private provider: Provider,
    private kind: WindowKind
  ) {
    super();
  }
  override async onWillAppear(ev: WillAppearEvent<Settings>) {
    const old = state.visible.get(ev.action.id);
    if (old?.timer) clearInterval(old.timer);
    const item: Visible = {
      key: ev.action,
      provider: this.provider,
      kind: this.kind,
      settings: ev.payload.settings,
      resetUntil: 0,
      revision: 0
    };
    state.visible.set(ev.action.id, item);
    if (state.visible.get(ev.action.id) !== item) return;
    void ev.action.setTitle('');
    void paint(item);
    item.timer = setInterval(() => {
      void refresh(item);
    }, 15000);
    void refresh(item);
  }
  override onWillDisappear(ev: WillDisappearEvent<Settings>) {
    const old = state.visible.get(ev.action.id);
    if (old?.timer) clearInterval(old.timer);
    state.visible.delete(ev.action.id);
    if (state.inspectorContext === ev.action.id)
      state.inspectorContext = undefined;
  }
  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>) {
    const item = state.visible.get(ev.action.id);
    if (!item) return;
    const previous = item.settings;
    const next = ev.payload.settings;
    const connectionChanged =
      previous.disconnected !== next.disconnected ||
      previous.grokConnected !== next.grokConnected ||
      previous.cursorConnected !== next.cursorConnected ||
      previous.cursorPool !== next.cursorPool ||
      previous.superGrokConnected !== next.superGrokConnected ||
      previous.superGrokAccount !== next.superGrokAccount ||
      previous.codexPath !== next.codexPath ||
      previous.claudeFile !== next.claudeFile ||
      previous.account !== next.account;
    item.settings = next;
    item.revision++;
    if (connectionChanged) {
      usage.clear(this.provider, previous);
      usage.clear(this.provider, next);
      item.snapshot = undefined;
      item.resetUntil = 0;
    }
    void paint(item);
    void refresh(item);
  }
  override onKeyDown(ev: KeyDownEvent<Settings>) {
    const item = state.visible.get(ev.action.id);
    if (!item) return;
    item.resetUntil = Date.now() + 4000;
    // Show the countdown immediately, even when the provider refresh takes longer.
    void paint(item);
    void refresh(item, true);
    setTimeout(() => {
      if (
        state.visible.get(ev.action.id) === item &&
        item.resetUntil <= Date.now()
      )
        void paint(item);
    }, 4100);
  }
  override onPropertyInspectorDidAppear(
    ev: PropertyInspectorDidAppearEvent<Settings>
  ) {
    state.inspectorContext = ev.action.id;
    const item = state.visible.get(ev.action.id);
    if (item) void refresh(item);
  }
  override onPropertyInspectorDidDisappear(
    ev: PropertyInspectorDidDisappearEvent<Settings>
  ) {
    if (state.inspectorContext === ev.action.id)
      state.inspectorContext = undefined;
  }
  override async onSendToPlugin(ev: SendToPluginEvent<PiPayload, Settings>) {
    const item = state.visible.get(ev.action.id);
    const payload = ev.payload || {};
    await registryReady;
    if (!item) return;
    if (
      payload.connectClaude &&
      this.provider === 'anthropic' &&
      !state.connectingClaude
    ) {
      state.connectingClaude = true;
      try {
        await promisify(execFile)(
          process.execPath,
          [path.join(__dirname, '../tools/connect-claude.mjs')],
          { windowsHide: true, timeout: 15000 }
        );
        if (item && state.visible.get(ev.action.id) === item) {
          const settings = {
            ...item.settings,
            claudeFile: defaultClaudeFile()
          };
          await item.key.setSettings(settings);
          usage.clear(this.provider, item.settings);
          item.settings = settings;
          item.revision++;
          item.snapshot = undefined;
          item.resetUntil = 0;
          usage.clear(this.provider, settings);
          await refresh(item);
        }
        await sendToPi({
          setup:
            'Reset-time source selected for this button. Sign in to Claude Code with your Claude subscription, restart it, and use it normally for the first reading.',
          claudeConnectedFile: defaultClaudeFile()
        });
      } catch {
        await sendToPi({
          setup:
            'Could not update Claude settings. Run tools/connect-claude.mjs manually to see the reason. Existing settings were preserved or backed up.'
        });
      } finally {
        state.connectingClaude = false;
      }
      return;
    }
    if (!item) return;
    if (payload.accounts) {
      await handleAccounts(item);
      await sendToPi({ palettes: palettesMemory });
      return;
    }
    if (payload.palettes) {
      try {
        await savePalettes(payload.palettes as Palettes);
      } catch {
        await sendToPi({
          palettes: palettesMemory,
          paletteError: 'Could not save the color palette. Try again.'
        });
      }
      return;
    }
    if (payload.rename) {
      await handleRename(item, payload.rename);
      return;
    }
    if (typeof payload.nickname === 'string') {
      try {
        let identity = item.snapshot?.account;
        if (!identity) {
          const key = await sources[item.provider].activeKey?.(item.settings);
          if (key) identity = { key, label: key };
        }
        if (!identity)
          throw new Error('Wait for a reading, then set the nickname.');
        const current = await registryApi.load();
        const upserted = upsertIdentity(current, item.provider, identity);
        const next = renameAccount(
          upserted.registry,
          upserted.record.id,
          payload.nickname,
          upserted.record.name
        );
        await registryApi.save(next);
        await repaintProvider(item.provider);
        await handleAccounts(item);
      } catch (error) {
        await sendToPi({
          accountError: safeError(error, 'Could not set the nickname.')
        });
      }
      return;
    }
    if (payload.remove?.id) {
      await handleRemove(item, payload.remove.id);
      return;
    }
    if (payload.addAccount) {
      await handleAddAccount(item);
      return;
    }
    if (payload.cancelSignIn) {
      try {
        await cancelSignIn();
      } catch (error) {
        await sendToPi({
          accountError: safeError(
            error,
            'Could not remove account sign-in files. Try again.'
          )
        });
      }
      return;
    }
    if (typeof payload.openUrl === 'string') {
      if (allowedOpenUrl(payload.openUrl, state.signInSession?.url)) {
        try {
          await streamDeck.system.openUrl(payload.openUrl);
        } catch {
          await sendToPi({ accountError: 'Could not open the sign-in page.' });
        }
      } else {
        await sendToPi({ accountError: 'That sign-in link is not allowed.' });
      }
      return;
    }
    if (payload.openApp) {
      try {
        await state.signInSession?.open?.();
      } catch (error) {
        await sendToPi({
          accountError: safeError(error, 'Could not open the app.')
        });
      }
      return;
    }
    void refresh(item, true);
  }
}
