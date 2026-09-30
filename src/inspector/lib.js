import { state as appState } from './state.js';

export const byId = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );

export const SERVICE = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  grok: 'Grok Bot',
  cursor: 'Cursor',
  supergrok: 'SuperGrok'
};

export const APP = {
  openai: 'Codex',
  anthropic: 'Claude',
  grok: 'Grok Bot',
  cursor: 'Cursor',
  supergrok: 'The Grok CLI'
};

export const FOLDER = { openai: true, anthropic: true, supergrok: true };

export const BRAND = {
  openai: '#65DFBA',
  anthropic: '#E9AC8B',
  grok: '#D9E5F2',
  cursor: '#EDEDED',
  supergrok: '#8FA8FF'
};

export const KEY_DEFAULT = '#11171D';

export const BAR_PRESETS = [
  '#65DFBA',
  '#E9AC8B',
  '#8FA8FF',
  '#D9E5F2',
  '#7ED4FF',
  '#B692F6',
  '#F3C16E',
  '#FF797D'
];

export const KEY_PRESETS = [
  '#11171D',
  '#000000',
  '#1E2A33',
  '#203040',
  '#2B2136',
  '#1B2E23',
  '#E9EDF0',
  '#FFFFFF'
];

export const CUSTOM_SLOTS = 8;

export const APP_MANAGED = {
  grok: 'Grok Bot manages this account. Remove it inside Grok Bot and it disappears here.',
  cursor: 'Cursor manages its sign-in. Sign out inside Cursor to remove it.'
};

export function providerOfAction() {
  if (appState.actionId?.includes('.openai-')) return 'openai';
  if (appState.actionId?.includes('.grok-')) return 'grok';
  if (appState.actionId?.includes('.cursor-')) return 'cursor';
  if (appState.actionId?.includes('.supergrok-')) return 'supergrok';
  return 'anthropic';
}

export // Anything that is not #RGB or #RRGGBB is treated as unset, exactly like the renderer does.
function hex(value) {
  const text = String(value ?? '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(text))
    return (
      '#' +
      text
        .slice(1)
        .split('')
        .map((part) => part + part)
        .join('')
    ).toUpperCase();
  if (/^#[0-9a-fA-F]{8}$/.test(text)) return text.toUpperCase();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : '';
}

export function splitColor(value) {
  const color = hex(value);
  if (!color) return { rgb: '', alpha: 1 };
  if (color.length === 9)
    return {
      rgb: color.slice(0, 7),
      alpha: parseInt(color.slice(7, 9), 16) / 255
    };
  return { rgb: color, alpha: 1 };
}

export function joinColor(rgb, alpha) {
  const base = hex(rgb).slice(0, 7);
  if (!base) return '';
  if (alpha >= 0.995) return base;
  return (
    base +
    Math.round(Math.min(1, Math.max(0, alpha)) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  );
}

export // Native <input type=color> only accepts lowercase #rrggbb. Uppercase values make the
// wheel open on black / the last OS color instead of the key's current color.
function pickerValue(value, fallback) {
  return (hex(value) || hex(fallback) || KEY_DEFAULT).toLowerCase();
}

export function hexToHsv(value) {
  const text = pickerValue(value, KEY_DEFAULT).slice(1);
  const r = parseInt(text.slice(0, 2), 16) / 255;
  const g = parseInt(text.slice(2, 4), 16) / 255;
  const b = parseInt(text.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  };
  const to = (x) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return ('#' + to(f(5)) + to(f(3)) + to(f(1))).toUpperCase();
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
