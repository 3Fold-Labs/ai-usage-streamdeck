import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next || ''))
  throw new Error('Provide a numeric candidate version, for example 0.0.62');
const pkg = JSON.parse(readFileSync('package.json'));
const compare = (a, b) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
if (compare(next, pkg.version) <= 0 || existsSync('dist/candidates/v' + next))
  throw new Error(
    'A new candidate must advance the version and cannot overwrite frozen files'
  );
if (
  execFileSync('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v' + next], {
    encoding: 'utf8'
  }).trim()
)
  throw new Error('That version is already tagged');
const lock = JSON.parse(readFileSync('package-lock.json'));
const manifest = JSON.parse(
  readFileSync('com.3foldlabs.ai-usage.sdPlugin/manifest.json')
);
pkg.version = next;
lock.version = next;
lock.packages[''].version = next;
manifest.Version = next + '.0';
for (const [name, value] of [
  ['package.json', pkg],
  ['package-lock.json', lock],
  ['com.3foldlabs.ai-usage.sdPlugin/manifest.json', manifest]
])
  writeFileSync(name, JSON.stringify(value, null, 2) + '\n');
console.log(
  'Prepared v' +
    next +
    '. Commit and push this version through required checks; no release was published.'
);
