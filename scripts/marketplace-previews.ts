// Fixture previews exported from the product renderer, not device-acceptance evidence.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { renderButton } from '../src/render.js';
import type { Provider } from '../src/model.js';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const base = `dist/marketplace/v${version}`;
const cream = '#F4F0E8',
  gold = '#D7B778',
  muted = '#B5B0A7';
const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (s: string, x: number, y: number, size = 32, color = cream) =>
  `<text x="${x}" y="${y}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}">${escape(s)}</text>`;
function key(
  provider: Provider,
  x: number,
  y: number,
  size: number,
  used: number,
  nickname = '',
  remaining = false,
  colors = {}
) {
  const kind =
    provider === 'cursor'
      ? 'monthly'
      : provider === 'grok' || provider === 'supergrok'
        ? 'weekly'
        : 'short';
  const snap = {
    observedAt: Date.now(),
    [kind]: {
      used,
      minutes: kind === 'short' ? 300 : kind === 'weekly' ? 10080 : 43200
    }
  };
  const svg = renderButton(provider, kind, snap, {
    nickname,
    remaining,
    ...colors
  });
  return svg.replace(
    /<svg[^>]*>/,
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`
  );
}
async function save(
  name: string,
  title: string,
  subtitle: string,
  body: string
) {
  const root = base;
  await mkdir(root, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="960"><rect width="1920" height="960" fill="#121214"/>${text('3FOLD LABS  /  AI USAGE', 80, 75, 25, gold)}${text(title, 80, 187, 68)}${text(subtitle, 83, 247, 28, muted)}${body}${text('Fixture preview · v' + version + ' candidate · installation acceptance pending', 80, 904, 23, muted)}</svg>`;
  await writeFile(`${root}/${name}.svg`, svg);
  await writeFile(`${root}/${name}.png`, new Resvg(svg).render().asPng());
}
const providers: Provider[] = [
  'openai',
  'anthropic',
  'grok',
  'cursor',
  'supergrok'
];
await save(
  'thumbnail',
  'Your accounts. Within sight.',
  'Five providers. Additional keys and accounts. Your choice of windows.',
  providers
    .map((p, i) =>
      key(p, 95 + i * 350, 400, 305, [24, 42, 18, 35, 61][i], 'WORK')
    )
    .join('')
);
await save(
  'gallery-1',
  'Know which account.',
  'Nicknames make selected accounts recognizable at a glance.',
  [
    ['anthropic', 'WORK', 24],
    ['anthropic', 'HOME', 61],
    ['openai', 'WORK', 32],
    ['openai', 'HOME', 11]
  ]
    .map((r, i) =>
      key(
        r[0] as Provider,
        170 + i * 415,
        370,
        330,
        r[2] as number,
        r[1] as string
      )
    )
    .join('')
);
await save(
  'gallery-2',
  'Used. Or remaining.',
  'Show the view that helps you decide what to do next.',
  key('openai', 450, 340, 370, 32, 'WORK') +
    key('openai', 1090, 340, 370, 32, 'WORK', true)
);
await save(
  'gallery-3',
  'Make each key recognizable.',
  'Choose custom bar and background colors.',
  key('anthropic', 450, 340, 370, 42, 'WORK', false, {
    barColor: '#D7B778',
    keyColor: '#252327'
  }) +
    key('anthropic', 1090, 340, 370, 42, 'HOME', false, {
      barColor: '#287868',
      keyColor: '#EFEDE6'
    })
);
const logo = (await readFile('assets/3fold-labs-logo.png')).toString('base64');
{
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="288" height="288"><rect width="288" height="288" rx="40" fill="#F8F5F0"/><svg x="12" y="12" width="264" height="264" viewBox="104 78 518 510"><image href="data:image/png;base64,${logo}" width="701" height="700"/></svg></svg>`;
  await writeFile(`${base}/app-icon.svg`, icon);
  await writeFile(`${base}/app-icon.png`, new Resvg(icon).render().asPng());
}
const sections = [
  'thumbnail',
  'gallery-1',
  'gallery-2',
  'gallery-3',
  'app-icon'
]
  .map(
    (n) =>
      `<figure><img src="${n}.png" alt="AI Usage ${n}"><figcaption>${n} · <a href="${n}.png" download>PNG</a> · <a href="${n}.svg" download>Editable SVG</a></figcaption></figure>`
  )
  .join('');
await writeFile(
  `${base}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>AI Usage Marketplace previews</title><style>body{background:#121214;color:#f4f0e8;font:18px Arial;margin:40px auto;max-width:1200px}img{max-width:100%;max-height:600px}a{color:#d7b778}figure{margin:24px 0 60px}figcaption{padding-top:12px}</style><h1>AI Usage v${version} · draft media review</h1><p>Fixture previews, not physical-device proof. Installation acceptance remains separate from these renders. No media was uploaded or published.</p>${sections}`
);
console.log('Fixture media prepared:', base);
