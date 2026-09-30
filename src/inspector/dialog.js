import { state as appState } from './state.js';
import { byId } from './lib.js';

export function openSheet(html, focusSelector) {
  const sheet = byId('sheet');
  sheet.innerHTML = html;
  byId('backdrop').classList.add('open');
  byId('backdrop').setAttribute('aria-hidden', 'false');
  const focus = focusSelector
    ? sheet.querySelector(focusSelector)
    : sheet.querySelector('button:not([disabled]), input, select');
  focus?.focus();
}

export function closeSheet() {
  byId('backdrop').classList.remove('open');
  byId('backdrop').setAttribute('aria-hidden', 'true');
  appState.sheetMode = null;
  appState.editingId = null;
  byId('sheet').innerHTML = '';
  if (appState.returnFocus && document.body.contains(appState.returnFocus))
    appState.returnFocus.focus();
  appState.returnFocus = null;
}
