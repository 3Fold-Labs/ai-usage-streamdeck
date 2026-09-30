import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const script = path.resolve('scripts/freeze-candidate.mjs');
test('candidate freeze verifies exact bytes, preserves canonical names and refuses replacing accepted versions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-freeze-'));
  try {
    const source = path.join(dir, 'candidate');
    await mkdir(path.join(source, 'security'), { recursive: true });
    const subject = [];
    {
      const folder = source;
      await mkdir(folder, { recursive: true });
      const name = '3FoldLabs-AI-Usage.streamDeckPlugin',
        bytes = Buffer.from('fixture archive');
      await writeFile(path.join(folder, name), bytes);
      subject.push({
        name,
        digest: { sha256: createHash('sha256').update(bytes).digest('hex') }
      });
    }
    const statement = {
      subject,
      predicate: { version: '0.0.61', commit: '1'.repeat(40), dirty: false }
    };
    await writeFile(
      path.join(source, 'security/provenance.statement.json'),
      JSON.stringify(statement)
    );
    const run = () =>
      spawnSync(process.execPath, [script, source], {
        cwd: dir,
        encoding: 'utf8'
      });
    assert.equal(run().status, 0);
    assert.equal(
      await readFile(
        path.join(dir, 'dist/candidates/v0.0.61', subject[0].name),
        'utf8'
      ),
      'fixture archive'
    );
    assert.notEqual(run().status, 0, 'must not overwrite a frozen version');
    statement.predicate.version = '0.0.62';
    await writeFile(
      path.join(source, 'security/provenance.statement.json'),
      JSON.stringify(statement)
    );
    await writeFile(path.join(source, subject[0].name), 'tampered');
    assert.notEqual(run().status, 0, 'must reject changed bytes');
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    });
  }
});
