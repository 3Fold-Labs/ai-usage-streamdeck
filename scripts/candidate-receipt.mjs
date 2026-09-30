import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const version = JSON.parse(readFileSync('package.json')).version;
const packages = JSON.parse(
  readFileSync('dist/security/packages.json')
).packages;
const sourceStatus = git('status', '--porcelain', '--untracked-files=normal');
const receipt = {
  _type: 'https://in-toto.io/Statement/v1',
  subject: packages.map((p) => ({
    name: p.file,
    digest: { sha256: p.sha256 }
  })),
  predicateType: 'https://3foldlabs.com/ai-usage/candidate-verification/v1',
  predicate: {
    version,
    commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    dirty: !!sourceStatus,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    workflowRun: process.env.GITHUB_RUN_ID || null,
    workflowRepository: process.env.GITHUB_REPOSITORY || null,
    verification:
      'security:release passed, including packaged-runtime integration tests',
    signature:
      'unsigned; use the signed production tag and supported release attestation before distribution',
    createdAt: new Date().toISOString()
  }
};
writeFileSync(
  'dist/security/provenance.statement.json',
  JSON.stringify(receipt, null, 2) + '\n'
);

if (sourceStatus) {
  console.error('Candidate source is dirty; changed paths:\n' + sourceStatus);
  if (process.env.GITHUB_ACTIONS === 'true')
    throw new Error(
      'Hosted candidate must come from clean source. Resolve the changed paths before platform verification.'
    );
}
