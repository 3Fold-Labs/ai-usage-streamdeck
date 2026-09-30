import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const version = '1.7.12';
const hashes = {
  darwin_arm64:
    'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  darwin_x64:
    '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  linux_x64: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  linux_arm64:
    '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
  windows_x64:
    '6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9',
  windows_arm64:
    'cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41'
};
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const key = platform + '_' + process.arch;
if (!hashes[key]) throw new Error('Unsupported scanner platform');
const dir = path.resolve('.cache/actionlint');
await mkdir(dir, { recursive: true });
const archive = `actionlint_${version}_${key.replace('_x64', '_amd64')}.${platform === 'windows' ? 'zip' : 'tar.gz'}`;
const archivePath = path.join(dir, archive);
let bytes = await readFile(archivePath).catch(() => undefined);
if (!bytes) {
  const response = await fetch(
    `https://github.com/rhysd/actionlint/releases/download/v${version}/${archive}`,
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
  if (r.error || r.status !== 0) throw new Error('Workflow validation failed');
}
run('tar', [
  '-xf',
  archivePath,
  '-C',
  dir,
  platform === 'windows' ? 'actionlint.exe' : 'actionlint'
]);
const exe = path.join(
  dir,
  platform === 'windows' ? 'actionlint.exe' : 'actionlint'
);
if (platform !== 'windows') await chmod(exe, 0o755);
run(exe, [
  '-shellcheck=',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml'
]);
