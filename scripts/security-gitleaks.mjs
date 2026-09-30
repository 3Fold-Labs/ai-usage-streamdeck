import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const version = '8.30.1';
const hashes = {
  darwin_arm64:
    'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  darwin_x64:
    'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  linux_x64: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  linux_arm64:
    'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  windows_x64:
    'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
  windows_arm64:
    'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f'
};
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const key = platform + '_' + process.arch;
if (!hashes[key]) throw new Error('Unsupported scanner platform');
const dir = path.resolve('.cache/gitleaks');
await mkdir(dir, { recursive: true });
const archive = `gitleaks_${version}_${key}.${platform === 'windows' ? 'zip' : 'tar.gz'}`;
const archivePath = path.join(dir, archive);
let bytes = await readFile(archivePath).catch(() => undefined);
if (!bytes) {
  const response = await fetch(
    `https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}`,
    { signal: AbortSignal.timeout(60_000) }
  );
  if (!response.ok) throw new Error('Scanner download failed');
  bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(archivePath, bytes);
}
if (createHash('sha256').update(bytes).digest('hex') !== hashes[key])
  throw new Error('Scanner checksum mismatch');
function run(file, args) {
  const r = spawnSync(file, args, { stdio: 'inherit', timeout: 120_000 });
  if (r.error || r.status !== 0)
    throw new Error('Secret scanning failed; inspect redacted findings');
}
run('tar', [
  '-xf',
  archivePath,
  '-C',
  dir,
  platform === 'windows' ? 'gitleaks.exe' : 'gitleaks'
]);
const exe = path.join(
  dir,
  platform === 'windows' ? 'gitleaks.exe' : 'gitleaks'
);
if (platform !== 'windows') await chmod(exe, 0o755);
run(exe, [
  'dir',
  process.argv[2] || '.',
  '--redact',
  '--no-banner',
  '--max-archive-depth',
  '2',
  '--config',
  '.gitleaks.toml'
]);
// Git resolves both ordinary checkouts and linked worktrees. A release scan
// must fail if history cannot be inspected, rather than silently skipping it.
if (!process.argv[2])
  run(exe, [
    'git',
    '.',
    '--redact',
    '--no-banner',
    '--log-opts=--all',
    '--config',
    '.gitleaks.toml'
  ]);
