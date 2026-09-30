import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectText } from '../scripts/security-scan.mjs';

test('secret and PII policy catches synthetic violations without reporting their values', () => {
  const token = 'ghp_' + 'a'.repeat(36);
  for (const value of [token, 'person' + '@' + 'private-company.test']) {
    const findings = inspectText(value, 'fixture.ts');
    assert.ok(findings.length);
    assert.ok(!JSON.stringify(findings).includes(value));
  }
  assert.deepEqual(
    inspectText(
      'Authorization Bearer access_token refresh_token are field names',
      'fixture.ts'
    ),
    []
  );
  const attribution = ['einaros', 'gmail.com'].join('@');
  assert.deepEqual(
    inspectText(
      attribution,
      'com.3foldlabs.ai-usage.sdPlugin\\licenses\\ws.txt'
    ),
    []
  );
  assert.ok(inspectText(attribution, 'src/unauthorized.ts').length);
});
test('installer gate rejects extra content, traversal and embedded credentials', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-package-test-'));
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const scanner = path.resolve('scripts/security-package.py');
  try {
    for (const kind of ['extra', 'traversal', 'credential']) {
      const file = path.join(dir, kind + '.streamDeckPlugin');
      const code = `import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('fixture.sdPlugin/manifest.json','{}')\n z.writestr(sys.argv[2],sys.argv[3])`;
      const member =
        kind === 'extra'
          ? 'fixture.sdPlugin/debug.txt'
          : kind === 'traversal'
            ? '../escape.txt'
            : 'fixture.sdPlugin/bin/plugin.js';
      const content =
        kind === 'credential' ? 'ghp_' + 'a'.repeat(36) : 'fixture';
      assert.equal(
        spawnSync(python, ['-c', code, file, member, content]).status,
        0
      );
      const result = spawnSync(python, [scanner, file], {
        cwd: dir,
        encoding: 'utf8'
      });
      assert.equal(result.status, 1, result.stderr);
      assert.ok(JSON.parse(result.stdout).findings.length);
      if (kind === 'credential') assert.ok(!result.stdout.includes(content));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
