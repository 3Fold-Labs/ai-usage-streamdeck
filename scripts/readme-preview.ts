// Documentation artwork from the real key renderer and synthetic usage data.
import { mkdir, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { renderButton } from '../src/render.js';
import type { Provider, WindowKind } from '../src/model.js';

const now = 1_800_000_000_000;
const samples: [Provider, string, WindowKind, number, number, string][] = [
  ['openai', 'ChatGPT / Codex', 'short', 24, 300, 'BUILD'],
  ['anthropic', 'Claude', 'short', 42, 300, 'WRITE'],
  ['grok', 'Grok Bot', 'weekly', 18, 10080, 'PLAN'],
  ['cursor', 'Cursor', 'monthly', 35, 43200, 'CODE'],
  ['supergrok', 'SuperGrok', 'weekly', 61, 10080, 'IDEAS']
];
const keys = samples
  .map(([provider, label, kind, used, minutes, nickname], i) => {
    const x = 56 + i * 222;
    const key = renderButton(
      provider,
      kind,
      {
        observedAt: now,
        [kind]: { used, minutes }
      },
      { now, nickname }
    );
    return `<rect x="${x - 5}" y="199" width="210" height="210" rx="29" fill="#263039"/>
    ${key.replace(/<svg[^>]*>/, `<svg x="${x}" y="204" width="200" height="200" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`)}
    <text x="${x + 100}" y="449" text-anchor="middle" fill="#C0C7CD" font-size="19">${label}</text>`;
  })
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520">
  <rect width="1200" height="520" rx="24" fill="#10151B"/>
  <g font-family="Arial, sans-serif">
    <text x="56" y="56" fill="#D7B778" font-size="17" letter-spacing="2">AI USAGE</text>
    <text x="54" y="115" fill="#F5F6F7" font-size="43" font-weight="700">Your AI usage, on your Stream Deck.</text>
    <text x="56" y="156" fill="#AEB8C2" font-size="20">Usage, allowance windows and account nicknames at a glance.</text>
    ${keys}
    <text x="56" y="493" fill="#8A959F" font-size="15">Actual key rendering · Sample usage data</text>
  </g>
</svg>`;
await mkdir('docs/images', { recursive: true });
await writeFile(
  'docs/images/ai-usage-preview.png',
  new Resvg(svg).render().asPng()
);
console.log('Rendered docs/images/ai-usage-preview.png from synthetic data.');
