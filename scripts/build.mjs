import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { brandIcons, iconShape } from './brand-icons.mjs';
import { generateLogoArt } from './logo-art.mjs';

const check = process.argv.includes('--check');
async function emit(file, content) {
  const bytes = Buffer.from(content);
  if (check) {
    const current = await readFile(file).catch(() => undefined);
    if (!current || !current.equals(bytes))
      throw new Error(
        `Generated file is out of date: ${file}. Run npm run build.`
      );
  } else await writeFile(file, bytes);
}
async function copyAsset(source, target) {
  await emit(target, await readFile(source));
}
const root = 'com.3foldlabs.ai-usage.sdPlugin';
await mkdir(`${root}/bin`, { recursive: true });
await mkdir(`${root}/imgs`, { recursive: true });
await mkdir(`${root}/imgs/actions`, { recursive: true });
await mkdir(`${root}/tools`, { recursive: true });
await mkdir(`${root}/licenses`, { recursive: true });
for (const file of ['connect-claude.mjs', 'claude-statusline.mjs'])
  await copyAsset(`scripts/${file}`, `${root}/tools/${file}`);
for (const dependency of [
  '@elgato/streamdeck',
  '@elgato/schemas',
  '@elgato/utils',
  'ws',
  'zod'
]) {
  // Dependency archives can carry CRLF notices; keep generated source identical on every OS.
  const notice = (
    await readFile(`node_modules/${dependency}/LICENSE`, 'utf8')
  ).replaceAll('\r\n', '\n');
  await emit(`${root}/licenses/${dependency.replaceAll('/', '-')}.txt`, notice);
}
await copyAsset(
  'node_modules/simple-icons/LICENSE.md',
  `${root}/licenses/simple-icons.txt`
);
await copyAsset(
  'THIRD-PARTY-NOTICES.md',
  `${root}/licenses/THIRD-PARTY-NOTICES.md`
);
await copyAsset('LICENSE', `${root}/licenses/AI-Usage-MIT.txt`);
await generateLogoArt(emit);
const runtime = await build({
  write: false,
  entryPoints: ['src/plugin.ts'],
  outfile: `${root}/bin/plugin.js`,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: false,
  external: ['node:sqlite']
});
await emit(`${root}/bin/plugin.js`, runtime.outputFiles[0].contents);
const inspector = await build({
  entryPoints: ['src/inspector/main.js'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  write: false,
  banner: { js: '// Generated from src/inspector/. Do not edit directly.' }
});
await emit(`${root}/ui/inspector.js`, inspector.outputFiles[0].contents);
const html = await readFile('src/inspector/index.html', 'utf8');
const css = await readFile('src/inspector/inspector.css', 'utf8');
await emit(
  `${root}/ui/inspector.html`,
  '<!-- Generated from src/inspector/. Do not edit directly. -->\n' +
    html.replace(
      /<link\s+rel="stylesheet"\s+href="inspector.css"\s*\/?>(?:\r?\n)?/,
      `<style>\n${css}</style>\n`
    )
);
// Keep the packaged runtime independent of the repository's ESM package.json.
await emit(`${root}/bin/package.json`, '{"type":"commonjs"}\n');
// Provider logos remain recognizable at the action list's 20/40 px sizes.

for (const [name, icon, color] of brandIcons) {
  // Text identifiers stay as SVG text so builds do not depend on installed fonts.
  if (icon.text) {
    await emit(
      `${root}/imgs/actions/${name}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${iconShape(icon, '#FFFFFF', 'translate(1 1) scale(0.916667)')}</svg>`
    );
    await emit(
      `${root}/imgs/${name}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="15" fill="#11171D"/>${iconShape(icon, color, 'translate(30 30) scale(3.5)')}</svg>`
    );
    continue;
  }

  for (const [suffix, size] of [
    ['', 20],
    ['@2x', 40]
  ]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${iconShape(icon, '#FFFFFF', 'translate(1 1) scale(0.916667)', name === 'openai')}</svg>`;
    await emit(
      `${root}/imgs/actions/${name}${suffix}.png`,
      new Resvg(svg).render().asPng()
    );
  }
  for (const [suffix, size] of [
    ['', 144],
    ['@2x', 288]
  ]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144"><rect width="144" height="144" rx="15" fill="#11171D"/>${iconShape(icon, color, name === 'openai' ? 'scale(6)' : 'translate(30 30) scale(3.5)')}</svg>`;
    await emit(
      `${root}/imgs/${name}${suffix}.png`,
      new Resvg(svg).render().asPng()
    );
  }
}
const logo = (await readFile('assets/3fold-labs-logo.png')).toString('base64');
// Full lockup (hex + 3Fold Labs LLC), cropped to artwork and scaled to fill the tile.
const logoCrop = {
  x: 104,
  y: 78,
  width: 518,
  height: 510,
  imageWidth: 701,
  imageHeight: 700
};
const logoImage = `<image href="data:image/png;base64,${logo}" width="${logoCrop.imageWidth}" height="${logoCrop.imageHeight}"/>`;
function logoTile(size, padRatio, radius) {
  const pad = Math.round(size * padRatio);
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#F8F5F0"/><svg x="${pad}" y="${pad}" width="${inner}" height="${inner}" viewBox="${logoCrop.x} ${logoCrop.y} ${logoCrop.width} ${logoCrop.height}" preserveAspectRatio="xMidYMid meet">${logoImage}</svg></svg>`;
}
for (const [suffix, size] of [
  ['', 256],
  ['@2x', 512]
]) {
  await emit(
    `${root}/imgs/plugin${suffix}.png`,
    new Resvg(logoTile(size, 0.02, Math.round(size * 0.15))).render().asPng()
  );
}
await emit(`${root}/imgs/category.svg`, logoTile(28, 0.02, 6));
console.log(check ? 'Generated plugin files match src/.' : 'Built AI Usage.');
