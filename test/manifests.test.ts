import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
test('the full plugin preserves its UUID, retains all seven action IDs and five visible services and carries the candidate version and notices', async () => {
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  const uuid = 'com.3foldlabs.ai-usage';
  const root = path.join(
    process.env.AI_USAGE_TEST_PACKAGE_ROOT || '.',
    uuid + '.sdPlugin'
  );
  const m = JSON.parse(
    await readFile(path.join(root, 'manifest.json'), 'utf8')
  );
  assert.equal(m.UUID, uuid);
  assert.equal(m.Version, version + '.0');
  assert.equal(m.SDKVersion, 3);
  assert.equal(m.Software.MinimumVersion, '7.1');
  assert.deepEqual(
    m.Actions.map((a: any) => a.UUID).sort(),
    [
      'openai-short',
      'openai-weekly',
      'anthropic-short',
      'anthropic-weekly',
      'grok-weekly',
      'cursor-monthly',
      'supergrok-weekly'
    ]
      .map((s) => uuid + '.' + s)
      .sort()
  );
  assert.equal(
    m.Actions.filter((a: any) => a.VisibleInActionsList !== false).length,
    5
  );
  for (const name of ['@elgato-streamdeck', '@elgato-utils']) {
    const notice = await readFile(
      path.join(root, 'licenses', name + '.txt'),
      'utf8'
    );
    assert.ok(!notice.includes('\r'));
  }
  const notice = await readFile(
    path.join(root, 'licenses/THIRD-PARTY-NOTICES.md'),
    'utf8'
  );
  assert.match(notice, /not affiliated with, sponsored by, endorsed by/);
  assert.doesNotMatch(JSON.stringify(m), /\b(?:Lite|Pro)\b/);
});

test('packaged Claude identifiers contain only ordinary text and shapes', async () => {
  const root = path.join(
    process.env.AI_USAGE_TEST_PACKAGE_ROOT || '.',
    'com.3foldlabs.ai-usage.sdPlugin/imgs'
  );
  for (const name of ['anthropic.svg', 'actions/anthropic.svg']) {
    const svg = await readFile(path.join(root, name), 'utf8');
    assert.match(svg, />Claude<\/text>/);
    assert.doesNotMatch(svg, /<image|<path|base64/);
  }
});
