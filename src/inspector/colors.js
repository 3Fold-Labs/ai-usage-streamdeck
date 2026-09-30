import { state as appState } from './state.js';
import {
  hex,
  KEY_DEFAULT,
  byId,
  splitColor,
  hexToHsv,
  joinColor,
  hsvToHex,
  CUSTOM_SLOTS,
  BRAND,
  BAR_PRESETS,
  KEY_PRESETS,
  pickerValue
} from './lib.js';
import { openSheet, closeSheet } from './dialog.js';
import { save, send } from './transport.js';

export function paintWells() {
  const bar = hex(appState.settings.barColor) || barDefault();
  const key = hex(appState.settings.keyColor) || KEY_DEFAULT;
  byId('barWell').style.background =
    bar.length === 9
      ? `linear-gradient(${bar.slice(0, 7)}${bar.slice(7)}, ${bar.slice(0, 7)}${bar.slice(7)}), repeating-linear-gradient(45deg,#555 0 6px,#333 6px 12px)`
      : bar;
  byId('keyWell').style.background =
    key.length === 9
      ? `linear-gradient(${key.slice(0, 7)}${key.slice(7)}, ${key.slice(0, 7)}${key.slice(7)}), repeating-linear-gradient(45deg,#555 0 6px,#333 6px 12px)`
      : key;
}

export function openColorPicker(field) {
  const fallback = field === 'barColor' ? barDefault() : KEY_DEFAULT;
  const start = hex(appState.settings[field]) || hex(fallback) || KEY_DEFAULT;
  const parts = splitColor(start);
  const initialHsv = hexToHsv(parts.rgb);
  const title = field === 'barColor' ? 'Bar color' : 'Key background';
  const state = {
    h: initialHsv.h,
    s: initialHsv.s,
    v: initialHsv.v,
    a: parts.alpha
  };
  openSheet(
    `
    <h2 id="sheetTitle">${title}</h2>
    <p>Starts on this key's current color, including opacity.</p>
    <div class="chart-row">
      <div class="sv" id="svChart"><div class="mark" id="svMark"></div></div>
      <div class="hue" id="hueStrip"><div class="hue-mark" id="hueMark"></div></div>
    </div>
    <div class="alpha-strip" id="alphaStrip"><div class="alpha-mark" id="alphaMark"></div></div>
    <div class="color-preview"><span id="colorPreview"></span></div>
    <label for="colorHex">Hex</label><input id="colorHex" class="plain" spellcheck="false" autocomplete="off">
    <div class="row">
      <button class="primary" type="button" id="applyColor">Use this color</button>
      <button type="button" id="addCustomColor">Add to custom colors</button>
      <button type="button" id="closeSheet">Cancel</button>
    </div>`,
    '#svChart'
  );
  const sv = byId('svChart');
  const hue = byId('hueStrip');
  const alpha = byId('alphaStrip');
  const current = () => joinColor(hsvToHex(state.h, state.s, state.v), state.a);
  const live = () => {
    const color = current();
    const rgb = hsvToHex(state.h, state.s, state.v);
    sv.style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${hsvToHex(state.h, 1, 1)})`;
    alpha.style.backgroundImage = `linear-gradient(to right,${rgb}00,${rgb}ff),linear-gradient(45deg,#555 25%,transparent 25%),linear-gradient(-45deg,#555 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#555 75%),linear-gradient(-45deg,transparent 75%,#555 75%)`;
    alpha.style.backgroundSize = 'auto,10px 10px,10px 10px,10px 10px,10px 10px';
    byId('svMark').style.left = `${state.s * 100}%`;
    byId('svMark').style.top = `${(1 - state.v) * 100}%`;
    byId('hueMark').style.top = `${(state.h / 360) * 100}%`;
    byId('alphaMark').style.left = `${state.a * 100}%`;
    byId('colorPreview').style.background = rgb;
    byId('colorPreview').style.opacity = String(state.a);
    byId('colorHex').value = color;
    return color;
  };
  const pickSv = (event) => {
    const box = sv.getBoundingClientRect();
    state.s = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    state.v =
      1 - Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    live();
  };
  const pickHue = (event) => {
    const box = hue.getBoundingClientRect();
    state.h =
      Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) * 360;
    live();
  };
  const pickAlpha = (event) => {
    const box = alpha.getBoundingClientRect();
    state.a = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    live();
  };
  const drag = (el, fn) => {
    el.addEventListener('pointerdown', (event) => {
      el.setPointerCapture(event.pointerId);
      fn(event);
    });
    el.addEventListener('pointermove', (event) => {
      if (event.buttons) fn(event);
    });
  };
  drag(sv, pickSv);
  drag(hue, pickHue);
  drag(alpha, pickAlpha);
  byId('colorHex').addEventListener('change', () => {
    const color = hex(byId('colorHex').value);
    if (!color) return;
    const next = splitColor(color);
    const hsv = hexToHsv(next.rgb);
    state.h = hsv.h;
    state.s = hsv.s;
    state.v = hsv.v;
    state.a = next.alpha;
    live();
  });
  byId('applyColor').addEventListener('click', () => {
    const color = live();
    byId(field).value = color;
    saveColors({ keepCustom: field });
    closeSheet();
  });
  byId('addCustomColor').addEventListener('click', () => {
    const color = live();
    const before = readCustoms(field).length;
    addCustom(field, color);
    const after = readCustoms(field).length;
    save();
    paintSwatches();
    byId('status').textContent =
      after > before
        ? `Saved ${color} in the next empty custom slot.`
        : after >= CUSTOM_SLOTS
          ? 'Custom colors are full. That slot was not overwritten.'
          : `${color} is already in the list.`;
  });
  byId('closeSheet').addEventListener('click', closeSheet);
  live();
}

export const barDefault = () => BRAND[appState.provider] || KEY_DEFAULT;

function readCustoms(field) {
  const raw =
    field === 'barColor'
      ? appState.pluginPalettes.bar
      : appState.pluginPalettes.key;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? String(raw).split(/[\s,]+/)
      : [];
  const seen = new Set();
  const next = [];
  for (const item of list) {
    const color = hex(item);
    if (!color || seen.has(color)) continue;
    seen.add(color);
    next.push(color);
    if (next.length >= CUSTOM_SLOTS) break;
  }
  return next;
}

function addCustom(field, color) {
  const next = hex(color);
  if (!next) return;
  const presets = field === 'barColor' ? BAR_PRESETS : KEY_PRESETS;
  if (presets.includes(next)) return;
  const customs = readCustoms(field);
  if (customs.includes(next) || customs.length >= CUSTOM_SLOTS) return;
  customs.push(next);
  if (field === 'barColor') appState.pluginPalettes.bar = customs;
  else appState.pluginPalettes.key = customs;
  send({
    palettes: {
      bar: appState.pluginPalettes.bar,
      key: appState.pluginPalettes.key
    }
  });
}

function bindSwatches(id, field, tiles, current) {
  byId(id).innerHTML = tiles
    .map((tile) => {
      const selected = !tile.empty && tile.color === current ? ' selected' : '';
      const empty = tile.empty ? ' empty' : '';
      const bg = tile.empty ? '' : `background:${tile.color};`;
      const label = tile.empty ? 'Empty custom color' : tile.color;
      return `<button type="button" class="${(empty + selected).trim()}" data-field="${field}" data-color="${tile.color}" title="${label}" aria-label="${label}" style="${bg}"></button>`;
    })
    .join('');
  byId(id)
    .querySelectorAll('button')
    .forEach((button) =>
      button.addEventListener('click', () => {
        const fieldName = button.getAttribute('data-field');
        const color = hex(button.getAttribute('data-color'));
        if (!color) {
          openColorPicker(fieldName);
          return;
        }
        byId(fieldName).value = pickerValue(color);
        saveColors();
      })
    );
}

export function paintSwatches() {
  const current = {
    barColor: hex(appState.settings.barColor) || barDefault(),
    keyColor: hex(appState.settings.keyColor) || KEY_DEFAULT
  };
  bindSwatches(
    'barPresets',
    'barColor',
    BAR_PRESETS.map((color) => ({ color, empty: false })),
    current.barColor
  );
  bindSwatches(
    'keyPresets',
    'keyColor',
    KEY_PRESETS.map((color) => ({ color, empty: false })),
    current.keyColor
  );
  bindSwatches(
    'barSwatches',
    'barColor',
    Array.from({ length: CUSTOM_SLOTS }, (_, i) => {
      const color = readCustoms('barColor')[i] || '';
      return { color, empty: !color };
    }),
    current.barColor
  );
  bindSwatches(
    'keySwatches',
    'keyColor',
    Array.from({ length: CUSTOM_SLOTS }, (_, i) => {
      const color = readCustoms('keyColor')[i] || '';
      return { color, empty: !color };
    }),
    current.keyColor
  );
}

export function saveColors(opts = {}) {
  appState.settings.barColor = hex(byId('barColor').value);
  appState.settings.keyColor = hex(byId('keyColor').value);
  if (opts.keepCustom === 'barColor')
    addCustom('barColor', appState.settings.barColor);
  if (opts.keepCustom === 'keyColor')
    addCustom('keyColor', appState.settings.keyColor);
  save();
  paintWells();
  paintSwatches();
  byId('status').textContent = 'Key colors saved.';
}

export function resetColors() {
  appState.settings.barColor = '';
  appState.settings.keyColor = '';
  byId('barColor').value = pickerValue('', barDefault());
  byId('keyColor').value = pickerValue('', KEY_DEFAULT);
  save();
  paintWells();
  paintSwatches();
  byId('status').textContent = 'Key colors reset to the defaults.';
}
