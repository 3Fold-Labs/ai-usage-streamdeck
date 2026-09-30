// Preserve exactly the QA candidate. Refuses overwrites and never builds.
import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  chmodSync,
  existsSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const source = path.resolve(process.argv[2] || 'dist');
const statement = JSON.parse(
  readFileSync(path.join(source, 'security/provenance.statement.json'))
);
const { version, commit, dirty } = statement.predicate;
if (
  statement.subject?.length !== 1 ||
  new Set(statement.subject.map((s) => s.name)).size !== 1
)
  throw new Error('Expected exactly one canonical installer');
if (
  !/^\d+\.\d+\.\d+$/.test(version) ||
  !/^[a-f0-9]{40}$/.test(commit) ||
  dirty !== false
)
  throw new Error(
    'Freeze requires a versioned candidate from a clean committed source'
  );
const target = path.resolve('dist/candidates', 'v' + version);
if (existsSync(target))
  throw new Error(
    'Candidate already frozen. Never overwrite QA files; prepare the next version for code changes.'
  );
const files = [
  {
    name: '3FoldLabs-AI-Usage.streamDeckPlugin',
    source: path.join(source, '3FoldLabs-AI-Usage.streamDeckPlugin')
  }
];
for (const f of files)
  if (
    createHash('sha256').update(readFileSync(f.source)).digest('hex') !==
    statement.subject.find((s) => s.name === f.name)?.digest.sha256
  )
    throw new Error('Candidate hash mismatch');
mkdirSync(target, { recursive: true });
for (const f of files) {
  copyFileSync(f.source, path.join(target, f.name));
  chmodSync(path.join(target, f.name), 0o444);
}
writeFileSync(
  path.join(target, 'SHA256SUMS'),
  statement.subject.map((s) => `${s.digest.sha256}  ${s.name}`).join('\n') +
    '\n'
);
copyFileSync(
  path.join(source, 'security/provenance.statement.json'),
  path.join(target, 'provenance.statement.json')
);
console.log('Frozen candidate:', target);
