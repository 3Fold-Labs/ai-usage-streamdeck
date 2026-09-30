import { readFileSync } from 'node:fs';

// Original PNGs from Grok Bot 0.44.0, Cursor 3.20.10 and grok.com's touch icon; preserve their artwork unchanged.
const appIcon = (file) => ({
  image: `data:image/png;base64,${readFileSync(new URL(`../assets/${file}`, import.meta.url)).toString('base64')}`
});
// Cursor and SuperGrok colors are placeholders pending owner review. Keep them in sync with src/render.ts.
// Official supplied vectors retain their viewBox and clear space; no recoloring.
const vectorIcon = (file) =>
  readFileSync(new URL(`../assets/${file}`, import.meta.url), 'utf8');
const openai = {
  vector: vectorIcon('openai-blossom-white.svg'),
  darkVector: vectorIcon('openai-blossom-black.svg'),
  noGlow: true
};
// Plain descriptive text only. No Claude or Anthropic logo artwork.
const anthropic = { text: 'Claude', noGlow: true };
export const brandIcons = [
  ['openai', openai, '#65DFBA'],
  ['anthropic', anthropic, '#E9AC8B'],
  ['grok', appIcon('grok-bot-app-icon.png'), '#D9E5F2'],
  ['cursor', appIcon('cursor-app-icon.png'), '#EDEDED'],
  ['supergrok', appIcon('grok-web-app-icon.png'), '#8FA8FF']
];

export function iconShape(icon, color, transform, compact = false) {
  if (icon.text)
    return `<g transform="${transform}"><text x="12" y="14" text-anchor="middle" font-family="Arial,sans-serif" font-size="6" fill="${color}">${icon.text}</text></g>`;
  if (icon.vector)
    return `<g transform="${transform}"><g transform="${compact ? 'translate(-12 -12) ' : ''}scale(${(compact ? 48 : 24) / 716})">${icon.vector.replace(/<svg[^>]*>|<\/svg>/g, '').trim()}</g></g>`;
  return icon.image
    ? `<image xmlns:xlink="http://www.w3.org/1999/xlink" transform="${transform}" width="24" height="24" xlink:href="${icon.image}"/>`
    : `<path transform="${transform}" d="${icon.path}" fill="${color}"/>`;
}
