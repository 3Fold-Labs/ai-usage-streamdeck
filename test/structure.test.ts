import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGraph, sourceGraph } from '../scripts/check-structure.mjs';

test('runtime and inspector use downward imports, have no import loops, and have no unused modules', async () => {
  assert.deepEqual(inspectGraph(await sourceGraph()), []);
});
test('structure guard rejects an upward import, cycle and an unused module', () => {
  const graph = new Map<string, string[]>([
    ['src/inspector/main.js', ['src/inspector/lib.js']],
    ['src/inspector/lib.js', ['src/inspector/main.js']],
    ['src/inspector/colors.js', []]
  ]);
  const findings = inspectGraph(graph, ['src/inspector/main.js']);
  assert.ok(findings.some((s: string) => s.startsWith('Upward import:')));
  assert.ok(findings.some((s: string) => s.startsWith('Import cycle:')));
  assert.ok(
    findings.some((s: string) => s.startsWith('Unused source module:'))
  );
});
