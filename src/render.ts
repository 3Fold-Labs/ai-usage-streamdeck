import {
  logoArt,
  iconImages,
  darkIconImages,
  iconVectors,
  darkIconVectors
} from './generated/logo-art.js';
import {
  countdown,
  stateOf,
  windowLabel,
  type Provider,
  type Snapshot,
  type WindowKind
} from './model.js';

// Placeholder bar colors pending owner review. Keep them in sync with scripts/brand-icons.mjs.
const cursorColor = '#EDEDED';
const superGrokColor = '#8FA8FF';

export const brands = {
  openai: { path: '', color: '#65DFBA', name: 'ChatGPT' },
  anthropic: { path: '', color: '#E9AC8B', name: 'Claude' },
  grok: { path: '', color: '#D9E5F2', name: 'Grok Bot' },
  cursor: { path: '', color: cursorColor, name: 'Cursor' },
  supergrok: { path: '', color: superGrokColor, name: 'SuperGrok' }
};

// Key colors are free text from settings: #RGB, #RRGGBB, or #RRGGBBAA.
export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(text);
  if (short)
    return `#${short[1]
      .split('')
      .map((part) => part + part)
      .join('')}`.toUpperCase();
  if (/^#[0-9a-fA-F]{8}$/.test(text)) return text.toUpperCase();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : undefined;
}

export function rgbAndAlpha(
  value: unknown
): { rgb: string; alpha: number } | undefined {
  const hex = normalizeHex(value);
  if (!hex) return undefined;
  if (hex.length === 9)
    return { rgb: hex.slice(0, 7), alpha: parseInt(hex.slice(7, 9), 16) / 255 };
  return { rgb: hex, alpha: 1 };
}

// WCAG relative luminance of an #RRGGBB color.
function luminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function renderButton(
  provider: Provider,
  kind: WindowKind,
  snapshot?: Snapshot,
  options: {
    remaining?: boolean;
    reset?: boolean;
    now?: number;
    nickname?: string;
    barColor?: string;
    keyColor?: string;
  } = {}
): string {
  const now = options.now ?? Date.now();
  const { window, stale, available } = stateOf(snapshot, kind, now);
  const brand = brands[provider];
  const used = window?.used ?? 0;
  const keyParsed = rgbAndAlpha(options.keyColor);
  const keyColor = keyParsed?.rgb ?? '#11171D';
  const keyAlpha = keyParsed?.alpha ?? 1;
  // White text disappears on a light key, so swap to dark ink and a darker empty track.
  const light = luminance(keyColor) > 0.5;
  const ink = '#11171D';
  const valueColor = light ? ink : available ? '#F7F9FA' : '#88939F';
  const labelColor = light ? ink : '#FFFFFF';
  const nickColor = light ? ink : '#AEB8C2';
  const trackColor = light ? '#B4BEC6' : '#2C3740';
  const barParsed = rgbAndAlpha(options.barColor);
  const customBar = barParsed?.rgb;
  const barAlpha = barParsed?.alpha ?? 1;
  const barBase = customBar ?? brand.color;
  // A color the owner picked on this key wins. Warning / stale fills only apply when no custom bar is set.
  const color = !available
    ? '#88939F'
    : customBar
      ? customBar
      : stale
        ? '#88939F'
        : used >= 90
          ? '#FF797D'
          : used >= 75
            ? '#F3C16E'
            : barBase;
  const fillOpacity = !available || !customBar ? 1 : barAlpha;
  const value = options.reset
    ? window && !window.resetsAt
      ? 'N/A'
      : countdown(window?.resetsAt, now)
    : available
      ? `${Math.round(options.remaining ? 100 - used : used)}%`
      : '—';
  const label = options.reset
    ? 'RESET'
    : provider === 'cursor' &&
        snapshot?.source === 'Cursor plan · Cursor Models'
      ? 'CM'
      : provider === 'cursor' &&
          snapshot?.source === 'Cursor plan · Other Models'
        ? 'OM'
        : windowLabel(window, kind);
  const glowOpacity = '0.65';
  const barX = 16;
  const barY = 108;
  const shown = available ? (options.remaining ? 100 - used : used) : 0;
  const barWidth = (112 * Math.min(100, Math.max(0, shown))) / 100;
  // Layered translucent outlines keep the glow reliable in Stream Deck's SVG renderer.
  const barGlow =
    available && barWidth > 0
      ? [6, 5, 4, 3, 2, 1]
          .map(
            (spread) =>
              `<rect x="${barX - spread}" y="${barY - spread}" width="${barWidth + spread * 2}" height="${6 + spread * 2}" rx="${3 + spread}" fill="${color}" opacity="${(spread > 3 ? 0.045 : 0.1) * fillOpacity}"/>`
          )
          .join('')
      : '';
  // Stream Deck's SVG text metrics differ from the preview renderer: keep generous side margins.
  const valueSize = options.reset ? 32 : value.length >= 4 ? 44 : 52;
  // Claude uses plain text; other providers retain their original image or vector artwork.
  const image = (light && darkIconImages[provider]) || iconImages[provider];
  // Flatten the supplied path: Stream Deck does not render nested SVG viewports reliably.
  // Uniform scaling preserves the mark; visible bounds are approximately x16..52, y14..50.
  const vector = (light && darkIconVectors[provider]) || iconVectors[provider];
  const headerIcon =
    provider === 'anthropic'
      ? `<text x="14" y="39" fill="${labelColor}" font-family="Arial, sans-serif" font-size="17">Claude</text>`
      : vector
        ? `<g transform="translate(-2 -4) scale(${72 / 716})">${vector.replace(/<svg[^>]*>|<\/svg>/g, '').trim()}</g>`
        : image
          ? `<image x="16" y="14" width="36" height="36" xlink:href="${image}"/>`
          : `<path transform="translate(16 14) scale(1.5)" d="${brand.path}" fill="${brand.color}"/>`;
  // Only [A-Z0-9]{1,5} reaches the SVG, so nicknames cannot inject markup.
  const nick =
    typeof options.nickname === 'string'
      ? options.nickname
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 5)
      : '';
  const nickSize = nick.length >= 5 ? 13 : 15;
  const nickTracking = nick.length >= 5 ? 0.6 : 1.5;
  const nickText = nick
    ? `<text x="72" y="134" text-anchor="middle" fill="${nickColor}" font-family="Arial, sans-serif" font-size="${nickSize}" font-weight="700" letter-spacing="${nickTracking}">${nick}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="15" fill="${keyColor}" fill-opacity="${keyAlpha}"/>
  ${logoArt[provider].header ? `<image x="2" y="0" width="64" height="64" opacity="${glowOpacity}" xlink:href="${logoArt[provider].header}"/>` : ''}${headerIcon}
  ${stale && available ? '<circle cx="132" cy="12" r="3" fill="#F3C16E"/>' : ''}
  <text x="72" y="94" text-anchor="middle" fill="${valueColor}" font-family="Arial, sans-serif" font-size="${valueSize}" font-weight="700" letter-spacing="-1" stroke="${keyColor}" stroke-width="2" paint-order="stroke fill">${value}</text>
  <text x="128" y="42" text-anchor="end" fill="${labelColor}" font-family="Arial, sans-serif" font-size="${label.length > 3 ? 17 : 28}" font-weight="700" letter-spacing="1">${label}</text>
  <rect x="${barX}" y="${barY}" width="112" height="6" rx="3" fill="${trackColor}"/>
  ${barGlow}
  ${available && barWidth > 0 ? `<rect x="${barX}" y="${barY}" width="${barWidth}" height="6" rx="3" fill="${color}" fill-opacity="${fillOpacity}"/><rect x="${barX}" y="${barY + 2}" width="${barWidth}" height="2" rx="1" fill="#FFFFFF" opacity="${0.65 * fillOpacity}"/>` : ''}
  ${nickText}</svg>`;
}

export function imageData(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
