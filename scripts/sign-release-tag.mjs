// Production tag signing only. No uploads, publication, visibility or key creation.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
const version = JSON.parse(readFileSync('package.json')).version;
const root = path.resolve(process.argv[2] || 'dist/candidates/v' + version);
const p = JSON.parse(
  readFileSync(path.join(root, 'provenance.statement.json'))
);
if (p.subject?.length !== 1 || new Set(p.subject.map((s) => s.name)).size !== 1)
  throw new Error('Expected exactly one canonical installer');
const acceptance = JSON.parse(readFileSync(path.join(root, 'acceptance.json')));
if (p.predicate.version !== version || p.predicate.dirty !== false)
  throw new Error('Candidate version/source mismatch');
if (!/^[a-f0-9]{40}$/.test(p.predicate.commit))
  throw new Error('Invalid source commit');
const sourcePackage = JSON.parse(
  execFileSync('git', ['show', p.predicate.commit + ':package.json'], {
    encoding: 'utf8'
  })
);
if (sourcePackage.version !== version)
  throw new Error('Tagged source has a different version');
for (const s of p.subject) {
  if (!['3FoldLabs-AI-Usage.streamDeckPlugin'].includes(s.name))
    throw new Error('Unexpected subject');
  if (
    createHash('sha256')
      .update(readFileSync(path.join(root, s.name)))
      .digest('hex') !== s.digest.sha256
  )
    throw new Error('Frozen artifact changed');
}
if (
  acceptance.commit !== p.predicate.commit ||
  JSON.stringify(acceptance.subjects) !== JSON.stringify(p.subject)
)
  throw new Error('Acceptance must refer to these exact files');
for (const platform of ['owner-mac', 'external-mac', 'windows']) {
  const row = acceptance.physical?.[platform];
  if (
    row?.passed !== true ||
    !row.os ||
    !row.streamDeckVersion ||
    !row.reviewer ||
    !row.checkedAt
  )
    throw new Error('Physical acceptance is incomplete');
}
if (acceptance.zeroOpenP0 !== true || acceptance.productionTagApproved !== true)
  throw new Error('Launch blockers or owner tag approval remain');
const configured = spawnSync('git', ['config', '--get', 'user.signingkey'], {
  encoding: 'utf8'
});
if (configured.status !== 0 || !configured.stdout.trim())
  throw new Error(
    'Configure the approved production signing key before tagging'
  );
const message =
  `AI Usage v${version}\nSource ${p.predicate.commit}\n\n` +
  p.subject.map((s) => `${s.digest.sha256}  ${s.name}`).join('\n');
execFileSync(
  'git',
  ['tag', '-s', '-m', message, 'v' + version, p.predicate.commit],
  { stdio: 'inherit' }
);
execFileSync('git', ['verify-tag', 'v' + version], { stdio: 'inherit' });
console.log(
  'Signed tag verified locally. Review before explicitly pushing; nothing was published.'
);
