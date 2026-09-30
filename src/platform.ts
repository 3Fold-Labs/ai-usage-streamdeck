import { homedir } from 'node:os';
import path from 'node:path';

export type Host = {
  platform: NodeJS.Platform;
  arch: string;
  home: string;
  env: NodeJS.ProcessEnv;
};
export const currentHost = (): Host => ({
  platform: process.platform,
  arch: process.arch,
  home: homedir(),
  env: process.env
});
export const hostPath = (host: Host) =>
  host.platform === 'win32' ? path.win32 : path.posix;

export function appDataDirectory(app: string, host = currentHost()): string {
  const p = hostPath(host);
  if (host.platform === 'darwin')
    return p.join(host.home, 'Library', 'Application Support', app);
  if (host.platform === 'win32')
    return p.join(
      host.env.APPDATA || p.join(host.home, 'AppData', 'Roaming'),
      app
    );
  throw new Error('AI Usage supports Windows and macOS.');
}

export function macCodexCandidates(host = currentHost()): string[] {
  const p = path.posix;
  const architecture = host.arch === 'arm64' ? 'arm64' : 'x64';
  const triple =
    host.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  const candidates = [
    '/Applications/Codex.app/Contents/Resources/codex',
    p.join(host.home, 'Applications/Codex.app/Contents/Resources/codex'),
    p.join(host.home, '.local/bin/codex')
  ];
  // GUI apps often receive a minimal PATH. Include both Homebrew prefixes and npm's native binaries.
  for (const prefix of ['/opt/homebrew', '/usr/local']) {
    const npm = p.join(prefix, 'lib/node_modules/@openai/codex');
    for (const vendor of [
      p.join(
        npm,
        'node_modules/@openai',
        `codex-darwin-${architecture}`,
        'vendor'
      ),
      p.join(npm, 'vendor')
    ]) {
      for (const directory of ['bin', 'codex'])
        candidates.push(p.join(vendor, triple, directory, 'codex'));
    }
    candidates.push(p.join(prefix, 'bin/codex'));
  }
  return candidates;
}
