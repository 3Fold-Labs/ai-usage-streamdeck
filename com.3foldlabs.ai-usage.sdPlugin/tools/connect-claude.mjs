import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory =
  process.env.AI_USAGE_DATA_DIR || path.join(homedir(), '.ai-usage-streamdeck');
const configDir =
  process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
const configFile = path.join(configDir, 'settings.json');
let original = '';
try {
  original = await readFile(configFile, 'utf8');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const config = original ? JSON.parse(original) : {};
if (!config || typeof config !== 'object' || Array.isArray(config))
  throw new Error('Claude settings must be a JSON object.');
const target = path.join(directory, 'claude-statusline.mjs');
// Claude invokes the command through a shell. Forward slashes and quoted paths work in Windows shells and bash.
const quote = (value) =>
  '"' +
  value
    .replaceAll('\\', '/')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`') +
  '"';
const command = `${quote(process.execPath)} ${quote(target)}`;
await mkdir(directory, { recursive: true });
await mkdir(configDir, { recursive: true });
const alreadyConnected = config.statusLine?.command === command;
if (original && !alreadyConnected) {
  const backup = `${configFile}.ai-usage-backup-${Date.now()}`;
  await copyFile(configFile, backup);
  console.log(`Backed up Claude settings: ${backup}`);
}
if (config.statusLine?.command && !alreadyConnected) {
  if (config.statusLine.command.includes('claude-statusline.mjs'))
    throw new Error(
      'A different AI Usage bridge is already configured. Review its path before reconnecting.'
    );
  const previousFile = path.join(directory, 'previous-statusline.json');
  try {
    await access(previousFile);
    throw new Error(
      'A saved status line already exists. Review previous-statusline.json before replacing it.'
    );
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  await writeFile(previousFile, JSON.stringify(config.statusLine, null, 2), {
    mode: 0o600
  });
}
await copyFile(
  fileURLToPath(new URL('./claude-statusline.mjs', import.meta.url)),
  target
);
config.statusLine = { ...(config.statusLine || {}), type: 'command', command };
await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
console.log(
  'Claude Code connected. Restart Claude Code and send a normal message to produce the first usage reading.'
);
console.log(`Usage file: ${path.join(directory, 'claude.json')}`);
