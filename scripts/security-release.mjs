import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(file, args, options = {}) {
  if (file === npm) {
    file = process.execPath;
    args = [process.env.npm_execpath, ...args];
  }
  const result = spawnSync(file, args, {
    stdio: 'inherit',
    timeout: 180_000,
    ...options
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Security gate stopped: ${file} ${args.join(' ')} (${result.status ?? 'execution error'})`
    );
  return result.stdout;
}
mkdirSync('dist/security', { recursive: true });
run(process.execPath, ['scripts/security-workflows.mjs']);
run(process.execPath, ['scripts/security-scan.mjs']);
run(process.execPath, ['scripts/security-gitleaks.mjs']);
const pkg = JSON.parse(readFileSync('package.json'));
const lock = JSON.parse(readFileSync('package-lock.json'));
const licenses = [];
for (const group of ['dependencies', 'devDependencies'])
  for (const [name, version] of Object.entries(pkg[group])) {
    if (
      !/^\d+\.\d+\.\d+/.test(version) ||
      version !== lock.packages['node_modules/' + name]?.version ||
      version !== lock.packages[''][group][name]
    )
      throw new Error('Unpinned or inconsistent dependency: ' + name);
  }
for (const [name, dep] of Object.entries(lock.packages)) {
  if (!name) continue;
  if (
    !dep.integrity?.startsWith('sha512-') ||
    !dep.resolved?.startsWith('https://registry.npmjs.org/')
  )
    throw new Error('Untrusted dependency resolution: ' + name);
  if (
    ![
      'MIT',
      'ISC',
      'Apache-2.0',
      'BSD-2-Clause',
      'BSD-3-Clause',
      '0BSD',
      'CC0-1.0',
      '(MIT AND Zlib)',
      'Python-2.0',
      'MPL-2.0',
      'BlueOak-1.0.0'
    ].includes(dep.license)
  )
    throw new Error(
      'Unreviewed dependency license: ' + name + ' ' + dep.license
    );
  licenses.push({ name, version: dep.version, license: dep.license });
}
writeFileSync('dist/security/licenses.json', JSON.stringify(licenses, null, 2));
writeFileSync(
  'dist/security/dependency-audit.json',
  run(npm, ['audit', '--json'], { stdio: ['ignore', 'pipe', 'inherit'] })
);
writeFileSync(
  'dist/security/sbom.cdx.json',
  run(npm, ['sbom', '--sbom-format=cyclonedx'], {
    stdio: ['ignore', 'pipe', 'inherit']
  })
);
run(npm, ['run', 'lint']);
run(npm, ['run', 'format:check']);
run(npm, ['run', 'check']);
// Clean generated runtime before building, so stale maps/binaries cannot enter packages.
rmSync('com.3foldlabs.ai-usage.sdPlugin/bin', { recursive: true, force: true });
run(npm, ['run', 'pack']);
run(npm, ['run', 'build:check']);
const packages = ['dist/3FoldLabs-AI-Usage.streamDeckPlugin'];
const report = run(
  process.platform === 'win32' ? 'python' : 'python3',
  ['scripts/security-package.py', ...packages],
  { stdio: ['ignore', 'pipe', 'inherit'] }
);
writeFileSync('dist/security/packages.json', report);
run(process.execPath, ['scripts/security-gitleaks.mjs', '.cache/package-scan']);
// Exercise the packaged runtimes after packing. No build runs after this QA.
run(npm, ['test'], {
  env: {
    ...process.env,
    AI_USAGE_TEST_PACKAGE_ROOT: path.resolve('.cache/package-scan')
  }
});
const data = JSON.parse(report);
writeFileSync(
  'dist/security/SHA256SUMS',
  data.packages.map((p) => `${p.sha256}  ${p.file}`).join('\n') + '\n'
);
run(process.execPath, ['scripts/candidate-receipt.mjs']);
console.log(
  'Local security release gate passed. Platform and live-provider acceptance are separate launch requirements.'
);
