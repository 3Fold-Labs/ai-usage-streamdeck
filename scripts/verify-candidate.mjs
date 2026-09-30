// Verify the exact candidate archives on another OS; this command never builds.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'candidate');
function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    stdio: 'inherit',
    timeout: 180000,
    ...options
  });
  if (result.error || result.status !== 0)
    throw new Error('Candidate verification failed');
  return result.stdout;
}
const provenance = JSON.parse(
  readFileSync(path.join(root, 'security/provenance.statement.json'))
);
const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (
  git.status !== 0 ||
  provenance.predicate.commit !== git.stdout.trim() ||
  provenance.predicate.dirty !== false
)
  throw new Error('Candidate source commit must match a clean build');
const version = JSON.parse(readFileSync('package.json')).version;
if (version !== provenance.predicate.version)
  throw new Error('Candidate version mismatch');
const packages = [path.join(root, '3FoldLabs-AI-Usage.streamDeckPlugin')];
if (provenance.subject?.length !== 1)
  throw new Error('Expected exactly one canonical installer');
for (const file of packages) {
  const expected = provenance.subject.find(
    (s) => s.name === path.basename(file)
  )?.digest.sha256;
  if (
    !expected ||
    createHash('sha256').update(readFileSync(file)).digest('hex') !== expected
  )
    throw new Error('Candidate installer checksum mismatch');
}
mkdirSync('dist/security', { recursive: true });
const report = run(
  process.platform === 'win32' ? 'python' : 'python3',
  ['scripts/security-package.py', ...packages],
  { stdio: ['ignore', 'pipe', 'inherit'] }
);
writeFileSync('dist/security/packages.json', report);
run(process.execPath, ['scripts/security-gitleaks.mjs', '.cache/package-scan']);
run(process.execPath, [process.env.npm_execpath, 'test'], {
  env: {
    ...process.env,
    AI_USAGE_TEST_PACKAGE_ROOT: path.resolve('.cache/package-scan')
  }
});
// Recheck archives after QA to detect any accidental modification.
for (const file of packages)
  if (
    createHash('sha256').update(readFileSync(file)).digest('hex') !==
    provenance.subject.find((s) => s.name === path.basename(file)).digest.sha256
  )
    throw new Error('Candidate changed during QA');
writeFileSync(
  'dist/security/platform-acceptance.json',
  JSON.stringify(
    {
      version,
      commit: provenance.predicate.commit,
      platform: process.platform,
      arch: process.arch,
      run: process.env.GITHUB_RUN_ID || null,
      subjects: provenance.subject,
      result:
        'automated packaged-runtime tests passed; physical acceptance still required'
    },
    null,
    2
  ) + '\n'
);
copyFileSync(
  path.join(root, 'security/provenance.statement.json'),
  'dist/security/provenance.statement.json'
);
console.log('Exact candidate verification passed without rebuilding.');
