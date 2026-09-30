import { rename, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Elgato packs as <UUID>.streamDeckPlugin; rename the download to the 3Fold Labs installer name.
const directory = path.resolve('dist');
await rename(
  path.join(directory, 'com.3foldlabs.ai-usage.streamDeckPlugin'),
  path.join(directory, '3FoldLabs-AI-Usage.streamDeckPlugin')
);
console.log('Installer: dist/3FoldLabs-AI-Usage.streamDeckPlugin');

// The CLI strips the manifest's final newline while packing. Keep maintained JSON stable.
const manifest = 'com.3foldlabs.ai-usage.sdPlugin/manifest.json';
await writeFile(manifest, (await readFile(manifest, 'utf8')).trimEnd() + '\n');
