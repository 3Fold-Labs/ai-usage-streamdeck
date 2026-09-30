import { state as appState } from './state.js';
import { byId, hex } from './lib.js';

const pending = [];
let pendingSettings;

export function hasPendingSettings() {
  return pendingSettings !== undefined;
}

export function send(payload) {
  const message = JSON.stringify({
    event: 'sendToPlugin',
    action: appState.actionId,
    context: appState.context,
    payload
  });
  if (appState.socket?.readyState === WebSocket.OPEN)
    appState.socket.send(message);
  else pending.push(message);
}

export function flushPending() {
  if (appState.socket?.readyState !== WebSocket.OPEN) return;
  if (pendingSettings) {
    appState.socket.send(pendingSettings);
    pendingSettings = undefined;
  }
  while (pending.length) appState.socket.send(pending.shift());
}

export function save() {
  const account = byId('account').disabled ? 'follow' : byId('account').value;
  appState.settings = {
    ...appState.settings,
    account,
    ...(appState.provider === 'cursor'
      ? {
          cursorPool:
            byId('cursorPool').value === 'other-models'
              ? 'other-models'
              : 'cursor-models'
        }
      : {}),
    grokConnected: byId('grokConnected').checked,
    cursorConnected: byId('cursorConnected').checked,
    superGrokConnected: byId('superGrokConnected').checked,
    superGrokAccount: byId('superGrokAccount').value.trim(),
    remaining: byId('display').value === 'remaining',
    window: byId('window').value,
    codexPath: byId('codexPath').value.trim(),
    bucket: byId('bucket').value.trim(),
    claudeFile: byId('claudeFile').value.trim(),
    barColor:
      hex(appState.settings.barColor) || appState.settings.barColor || '',
    keyColor:
      hex(appState.settings.keyColor) || appState.settings.keyColor || ''
  };
  delete appState.settings.layout;
  pendingSettings = JSON.stringify({
    event: 'setSettings',
    context: appState.context,
    payload: appState.settings
  });
  flushPending();
  return !hasPendingSettings();
}
