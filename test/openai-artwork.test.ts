import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { renderButton } from '../src/render.js';

// Hashes identify the original supplied PNGs, including their built-in clear space.
for (const provider of ['openai'] as const)
  test(`${provider} keys preserve official monochrome assets across custom palettes without logo effects`, () => {
    for (const [keyColor, variant] of [
      ['#11171D', 'dark'],
      ['#FFFFFF', 'light'],
      ['#FF00FF', 'dark']
    ] as const) {
      for (const barColor of [undefined, '#00FF00', '#FF0000']) {
        const svg = renderButton(provider, 'short', undefined, {
          keyColor,
          barColor
        });
        {
          const original = readFileSync(
            new URL(
              `../assets/openai-blossom-${variant === 'dark' ? 'white' : 'black'}.svg`,
              import.meta.url
            ),
            'utf8'
          );
          const expectedHash =
            variant === 'dark'
              ? '01d158767c4eec0e47bd617e67759c33da0accd1438be1a8d29dfdb99ce87285'
              : '75c1e9fffa5e8c437bec1d67197a73992bca45d166c6ff23215185dea8fae92a';
          assert.equal(
            createHash('sha256').update(original).digest('hex'),
            expectedHash
          );
          assert.ok(
            svg.includes(original.replace(/<svg[^>]*>|<\/svg>/g, '').trim()),
            'Original supplied path and fill remain unchanged'
          );
          assert.equal(
            (svg.match(/<svg\b/g) || []).length,
            1,
            'Stream Deck needs a single root SVG; nested viewports can hide the logo'
          );
          assert.doesNotMatch(svg, /<image/);
          continue;
        }
      }
    }
  });

test('the packaged plugin gives the OpenAI sidebar mark at least 17 of 20 pixels without edge clipping', () => {
  for (const uuid of ['com.3foldlabs.ai-usage']) {
    for (const [suffix, size] of [
      ['', 20],
      ['@2x', 40]
    ] as const) {
      const png = readFileSync(
        path.join(
          process.env.AI_USAGE_TEST_PACKAGE_ROOT || '.',
          uuid + '.sdPlugin',
          'imgs/actions/openai' + suffix + '.png'
        )
      );
      const rendered = new Resvg(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}"><image width="${size}" height="${size}" xlink:href="data:image/png;base64,${png.toString('base64')}"/></svg>`
      ).render();
      const pixels = rendered.pixels;
      const xs: number[] = [],
        ys: number[] = [];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          if (pixels[(y * size + x) * 4 + 3] >= 32) {
            xs.push(x);
            ys.push(y);
          }
      assert.ok(xs.length > 0, 'Sidebar logo must be visible');
      const left = Math.min(...xs),
        right = Math.max(...xs),
        top = Math.min(...ys),
        bottom = Math.max(...ys);
      assert.ok(
        right - left + 1 >= size * 0.85 && bottom - top + 1 >= size * 0.85,
        'Logo must fill the small sidebar badge'
      );
      assert.ok(
        left > 0 && top > 0 && right < size - 1 && bottom < size - 1,
        'Keep visible artwork away from clipped edges'
      );
    }
  }
});
