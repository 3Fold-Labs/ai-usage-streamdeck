import { readdir, readFile, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const excluded = new Set([
  '.git',
  'node_modules',
  'dist',
  '.cache',
  'coverage'
]);
const findings = [];
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    'github-token',
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/
  ],
  [
    'provider-key',
    /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}|xai-[A-Za-z0-9]{32,})/
  ],
  ['jwt', /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
  ['personal-path', /(?:\/Users\/adam(?:\/|\b)|C:\\Users\\Adam(?:\\|\b))/i],
  ['private-host', /\b[a-z0-9-]+\.internal\b/i]
];
export function inspectText(text, name = 'input') {
  name = name.replaceAll('\\', '/');
  const found = [];
  for (const [rule, pattern] of rules)
    if (pattern.test(text)) found.push({ file: name, rule });
  for (const email of text.matchAll(
    /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi
  )) {
    if (
      (name.endsWith('licenses/ws.txt') ||
        name.endsWith('scripts/security-package.py')) &&
      email[0] === ['einaros', 'gmail.com'].join('@')
    )
      continue;
    if (
      !/^(?:example\.(?:com|org|net|invalid)|invalid|test\.com)$/i.test(
        email[1]
      ) &&
      !['support@3foldlabs.com', 'security@3foldlabs.com'].includes(
        email[0].toLowerCase()
      )
    )
      found.push({ file: name, rule: 'unreviewed-email' });
  }
  return found;
}
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const f = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      findings.push({ file: f, rule: 'symlink' });
      continue;
    }
    if (entry.isDirectory()) {
      await walk(f);
      continue;
    }
    if (
      /^(?:HANDOFF|\.env|auth\.json|credentials|\.DS_Store)/i.test(
        entry.name
      ) ||
      /\.(?:log|map|streamDeckPlugin)$/.test(entry.name)
    )
      findings.push({ file: f, rule: 'forbidden-file' });
    const bytes = await readFile(f);
    if (!bytes.includes(0))
      findings.push(...inspectText(bytes.toString('utf8'), f));
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve('scripts/security-scan.mjs')
) {
  await walk('.');
  // Check every reachable clean-repository commit, not just the working tree.
  try {
    const ids = execFileSync('git', ['rev-list', '--all'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const id of ids) {
      const files = execFileSync('git', ['ls-tree', '-r', '--name-only', id], {
        encoding: 'utf8'
      })
        .trim()
        .split('\n')
        .filter(Boolean);
      for (const file of files) {
        const bytes = execFileSync('git', ['show', `${id}:${file}`], {
          maxBuffer: 32 * 1024 * 1024
        });
        if (!bytes.includes(0))
          findings.push(
            ...inspectText(bytes.toString(), `${id.slice(0, 8)}:${file}`)
          );
      }
    }
  } catch (error) {
    if (await lstat('.git').catch(() => null)) throw error;
  }
  if (findings.length) {
    console.error(JSON.stringify(findings, null, 2));
    process.exitCode = 1;
  } else
    console.log(
      'Source/history policy scan passed. No matching secret or unreviewed PII patterns.'
    );
}
