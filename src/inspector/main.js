import { state as appState } from './state.js';
import { byId, pickerValue, KEY_DEFAULT, providerOfAction } from './lib.js';
import {
  barDefault,
  paintWells,
  paintSwatches,
  openColorPicker,
  saveColors,
  resetColors
} from './colors.js';
import {
  populateAccounts,
  manageList,
  manageEdit,
  showSignIn,
  saveNick
} from './accounts.js';
import { flushPending, hasPendingSettings, send, save } from './transport.js';
import { closeSheet } from './dialog.js';

function populate() {
  byId('toggleConnection').textContent = appState.settings.disconnected
    ? 'Reconnect this button'
    : 'Disconnect this button';
  byId('grokConnected').checked = appState.settings.grokConnected === true;
  byId('cursorConnected').checked = appState.settings.cursorConnected === true;
  byId('superGrokConnected').checked =
    appState.settings.superGrokConnected === true;
  byId('cursorPool').value =
    appState.settings.cursorPool === 'other-models'
      ? 'other-models'
      : 'cursor-models';
  byId('display').value = appState.settings.remaining ? 'remaining' : 'used';
  byId('window').value =
    appState.settings.window ||
    (appState.actionId?.endsWith('-weekly')
      ? 'weekly'
      : appState.actionId?.endsWith('-monthly')
        ? 'monthly'
        : 'auto');
  if (document.activeElement !== byId('nick'))
    byId('nick').value = appState.settings.nickname || '';
  for (const key of ['codexPath', 'bucket', 'claudeFile', 'superGrokAccount'])
    byId(key).value = appState.settings[key] || '';
  if (document.activeElement !== byId('barColor'))
    byId('barColor').value = pickerValue(
      appState.settings.barColor,
      barDefault()
    );
  if (document.activeElement !== byId('keyColor'))
    byId('keyColor').value = pickerValue(
      appState.settings.keyColor,
      KEY_DEFAULT
    );
  populateAccounts();
  paintWells();
  paintSwatches();
}

window.connectElgatoStreamDeckSocket = (
  port,
  uuid,
  registerEvent,
  info,
  actionInfo
) => {
  const action = JSON.parse(actionInfo);
  appState.context = uuid;
  appState.actionId = action.action;
  appState.settings = action.payload.settings || {};
  appState.provider = providerOfAction();
  const openai = appState.provider === 'openai';
  const grok = appState.provider === 'grok';
  const cursor = appState.provider === 'cursor';
  const supergrok = appState.provider === 'supergrok';
  byId('cursorPoolRow').hidden = !cursor;
  byId('name').textContent = openai
    ? 'ChatGPT Usage'
    : grok
      ? 'Grok Bot Usage'
      : cursor
        ? 'Cursor Usage'
        : supergrok
          ? 'SuperGrok Usage'
          : 'Claude Usage';
  byId('allowance').textContent = openai
    ? 'Subscription allowance: Codex included with ChatGPT. General ChatGPT message limits are not reported by this connection.'
    : grok
      ? 'Subscription allowance: Grok Bot weekly usage.'
      : cursor
        ? 'Plan allowance: choose Cursor Models or Other Models for the current billing cycle.'
        : supergrok
          ? 'Subscription allowance: SuperGrok shared weekly pool. Chat, Imagine, Voice, Build and the Grok CLI all draw from it. This is not the Grok Bot allowance or API billing.'
          : 'Subscription allowance: Claude usage.';
  byId('openai').hidden = !openai;
  byId('anthropic').hidden = openai || grok || cursor || supergrok;
  byId('grok').hidden = !grok;
  byId('cursor').hidden = !cursor;
  byId('supergrok').hidden = !supergrok;
  if (grok || supergrok) {
    byId('window').querySelector('option[value="short"]').remove();
    appState.settings.window = 'weekly';
  }
  // Cursor reports one billing cycle; it has no 5-hour or weekly window.
  if (cursor) {
    byId('window').replaceChildren(new Option('Billing cycle', 'monthly'));
    appState.settings.window = 'monthly';
  }
  paintSwatches();
  populate();
  appState.socket = new WebSocket(`ws://127.0.0.1:${port}`);
  appState.socket.onopen = () => {
    appState.socket.send(JSON.stringify({ event: registerEvent, uuid }));
    flushPending();
    send({ refresh: true });
    send({ accounts: true });
  };
  appState.socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.event === 'didReceiveSettings') {
      if (hasPendingSettings()) return;
      appState.settings = message.payload.settings || {};
      populate();
    }
    if (message.event !== 'sendToPropertyInspector') return;
    const data = message.payload;
    if (data.setup) {
      byId('setup').textContent = data.setup;
      byId('connectClaude').disabled = false;
      if (data.claudeConnectedFile) {
        appState.settings.claudeFile = data.claudeConnectedFile;
        populate();
      }
      return;
    }
    if (data.palettes) {
      appState.pluginPalettes = {
        bar: Array.isArray(data.palettes.bar) ? data.palettes.bar : [],
        key: Array.isArray(data.palettes.key) ? data.palettes.key : []
      };
      paintSwatches();
      if (data.paletteError) byId('status').textContent = data.paletteError;
      return;
    }
    if (data.accountList) {
      appState.accountList = data.accountList;
      appState.provider = data.accountList.provider || appState.provider;
      populateAccounts();
      if (
        appState.pendingNickname &&
        appState.accountList.accounts.some(
          (account) =>
            account.id === appState.pendingNickname.id &&
            account.nick === appState.pendingNickname.nick
        )
      ) {
        byId('status').textContent = appState.pendingNickname.nick
          ? `Nickname ${appState.pendingNickname.nick} saved for this account.`
          : 'Nickname hidden for this account.';
        appState.pendingNickname = null;
      }
      if (appState.sheetMode === 'list') manageList();
      else if (appState.sheetMode === 'edit' && appState.editingId) {
        if (
          appState.accountList.accounts.some(
            (account) => account.id === appState.editingId
          )
        )
          manageEdit(appState.editingId);
        else manageList();
      } else if (appState.sheetMode === 'confirm' && appState.editingId) {
        if (
          appState.accountList.accounts.some(
            (account) => account.id === appState.editingId
          )
        )
          manageList();
        else manageList();
      }
      return;
    }
    if (data.working) {
      byId('status').textContent = data.working;
      return;
    }
    if (data.signIn) {
      byId('addAccount').disabled = false;
      showSignIn(data.signIn);
      return;
    }
    if (data.signInDone) {
      byId('addAccount').disabled = false;
      closeSheet();
      send({ accounts: true });
      byId('status').textContent =
        `Added ${data.signInDone.nick} (${data.signInDone.name}).`;
      return;
    }
    if (data.signInFailed) {
      byId('addAccount').disabled = false;
      closeSheet();
      byId('status').textContent = data.signInFailed;
      return;
    }
    if (data.accountError) {
      appState.pendingNickname = null;
      byId('addAccount').disabled = false;
      byId('status').textContent = data.accountError;
      return;
    }
    const shortOption = byId('window').querySelector('option[value="short"]');
    if (shortOption) {
      const minutes = data.shortWindowMinutes;
      shortOption.textContent =
        typeof minutes === 'number' && minutes > 0
          ? minutes % 60 === 0
            ? `${minutes / 60}-hour`
            : `${minutes}-minute`
          : '5-hour';
    }
    byId('status').textContent = data.status;
    byId('status').classList.toggle(
      'idle',
      /idle|stale|Last known reading/i.test(String(data.status || ''))
    );
    byId('defaultFile').textContent = data.claudeFile;
    byId('details').textContent = [
      data.source || '',
      typeof data.used === 'number' ? `${data.window}: ${data.used}% used` : '',
      Array.isArray(data.breakdown) && data.breakdown.length
        ? `${appState.provider === 'cursor' ? 'Usage pools' : 'By product'}: ${data.breakdown.map((item) => `${item.label} ${item.used}%`).join(' · ')}`
        : '',
      data.resetsAt
        ? `Resets: ${new Date(data.resetsAt * 1000).toLocaleString()}`
        : data.resetHelp || '',
      data.observedAt
        ? `Last reading: ${new Date(data.observedAt).toLocaleString()}`
        : ''
    ]
      .filter(Boolean)
      .join('\n');
  };
  appState.socket.onclose = () => {
    closeSheet();
    for (const control of document.querySelectorAll('input, select, button'))
      control.disabled = true;
    byId('status').textContent =
      'Plugin disconnected. Editing is disabled. Select the button again to reconnect.';
  };
};

for (const key of [
  'display',
  'window',
  'cursorPool',
  'codexPath',
  'bucket',
  'claudeFile',
  'grokConnected',
  'cursorConnected',
  'superGrokConnected',
  'superGrokAccount',
  'account'
]) {
  byId(key).addEventListener('change', () => {
    save();
    if (key === 'account') populateAccounts();
  });
}

byId('barWell').addEventListener('click', () => {
  openColorPicker('barColor');
});

byId('keyWell').addEventListener('click', () => {
  openColorPicker('keyColor');
});

for (const key of ['barColor', 'keyColor']) {
  byId(key).addEventListener('change', () => saveColors({ keepCustom: key }));
}

byId('resetColors').addEventListener('click', resetColors);

byId('nick').addEventListener('change', saveNick);

byId('nick').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveNick();
  }
});

byId('saveNick').addEventListener('click', saveNick);

byId('toggleConnection').addEventListener('click', () => {
  appState.settings.disconnected = !appState.settings.disconnected;
  populate();
  save();
});

byId('refresh').addEventListener('click', () => send({ refresh: true }));

byId('connectClaude').addEventListener('click', () => {
  byId('connectClaude').disabled = true;
  send({ connectClaude: true });
});

byId('manage').addEventListener('click', (event) => {
  appState.returnFocus = event.currentTarget;
  if (!appState.accountList) send({ accounts: true });
  manageList();
});

byId('addAccount').addEventListener('click', (event) => {
  appState.returnFocus = event.currentTarget;
  byId('status').textContent = 'Starting sign-in…';
  byId('addAccount').disabled = true;
  send({ addAccount: true });
  setTimeout(() => {
    byId('addAccount').disabled = false;
  }, 25000);
});

byId('backdrop').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeSheet();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && byId('backdrop').classList.contains('open')) {
    if (appState.sheetMode === 'signIn') send({ cancelSignIn: true });
    closeSheet();
  }
  if (event.key === 'Tab' && byId('backdrop').classList.contains('open')) {
    const focusable = [
      ...byId('sheet').querySelectorAll('button:not([disabled]), input, select')
    ];
    if (!focusable.length) return;
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
