import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { safeError, allowSnapshot } from '../src/security.js';
import { LastReadings } from '../src/last-readings.js';
import { UsageService } from '../src/service.js';
import { emptyRegistry } from '../src/accounts.js';
import type { Provider } from '../src/model.js';
import { renderButton } from '../src/render.js';
import {
  normalizeCodex,
  normalizeClaudeHistory
} from '../src/providers/normalize.js';
import { fetchGrokUsage } from '../src/providers/grok.js';
import { readCursorUsage } from '../src/providers/cursor.js';
import { readSuperGrokUsage } from '../src/providers/supergrok.js';
const canary = 'AI_USAGE_TEST_ACCESS_TOKEN_7FA92C';
const privatePrompt = 'AI_USAGE_PRIVATE_PROMPT_91823';
const check = (value: unknown) =>
  assert.doesNotMatch(
    JSON.stringify(value),
    /AI_USAGE_TEST_|AI_USAGE_PRIVATE_/
  );

test('untrusted exceptions, causes, and multiline child output cannot become user messages', () => {
  for (const value of [
    new Error(canary),
    new SyntaxError(privatePrompt),
    { message: canary },
    new Error('network\nAuthorization: Bearer ' + canary)
  ])
    check(safeError(value));
  assert.match(
    safeError(new Error('Cursor sign-in expired. Open Cursor to refresh it.')),
    /sign-in expired/
  );
});
for (const provider of [
  'openai',
  'anthropic',
  'grok',
  'cursor',
  'supergrok'
] as Provider[]) {
  test(`${provider}: service, persisted cache and renderer discard unknown response fields`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ai-usage-security-'));
    try {
      const file = path.join(dir, 'cache.json');
      const cache = new LastReadings(file);
      let failing = false;
      const source = {
        readActive: async () => {
          if (failing) throw new Error(canary);
          return {
            observedAt: Date.now(),
            weekly: { used: 23, minutes: 10080, token: canary },
            account: { key: 'fixture', label: 'Fixture', token: canary },
            raw: { prompt: privatePrompt },
            authorization: canary
          };
        },
        readAccount: async () => {
          throw new Error(canary);
        }
      };
      let registry = emptyRegistry();
      const service = new UsageService({
        sources: { [provider]: source },
        registry: {
          load: async () => registry,
          save: async (r) => {
            registry = r;
          }
        },
        lastReadings: cache
      });
      const settings = {
        grokConnected: true,
        cursorConnected: true,
        superGrokConnected: true
      };
      const result = await service.get(provider, settings);
      assert.equal(result.weekly?.used, 23);
      check(result);
      check(registry);
      check(await readFile(file, 'utf8'));
      check(renderButton(provider, 'weekly', result));
      failing = true;
      service.clear(provider, settings);
      check(await service.get(provider, settings));
      // Direct cache callers receive the same protection as service callers.
      await cache.set(provider, 'direct', {
        observedAt: 1,
        weekly: { used: 2, minutes: 10080, token: canary },
        raw: privatePrompt
      } as any);
      check(await readFile(file, 'utf8'));
      check(await cache.get(provider, 'direct'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
test('all network adapters pin exact destinations and reject redirects without leaking responses', async () => {
  const now = Date.now(),
    end = new Date(now + 7 * 86400000).toISOString(),
    start = new Date(now).toISOString();
  const cases: [string, (request: typeof fetch) => Promise<unknown>, object][] =
    [
      [
        'https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus',
        (r) => fetchGrokUsage({ token: canary }, r),
        { usagePercent: 22, nextResetTimestampUtc: end }
      ],
      [
        'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
        (r) => readCursorUsage(async () => canary, r),
        {
          planUsage: { includedSpend: 2, limit: 10 },
          billingCycleStart: now,
          billingCycleEnd: now + 30 * 86400000
        }
      ],
      [
        'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
        (r) =>
          readSuperGrokUsage(
            undefined,
            async () => ({
              a: {
                key: canary,
                email: 'fixture@example.invalid',
                expires_at: end,
                get refresh_token() {
                  throw Error('refresh access');
                }
              }
            }),
            r
          ),
        {
          config: {
            creditUsagePercent: 22,
            currentPeriod: { start, end },
            productUsage: [{ product: privatePrompt, usagePercent: 1 }]
          }
        }
      ]
    ];
  for (const [url, read, payload] of cases) {
    const response = await read((async (dest, init) => {
      assert.equal(String(dest), url);
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      assert.equal((init?.headers as any).Authorization, 'Bearer ' + canary);
      return new Response(
        JSON.stringify({ ...payload, token: canary, prompt: privatePrompt })
      );
    }) as typeof fetch);
    check(response);
    await assert.rejects(
      read((async () => {
        throw new Error(canary);
      }) as typeof fetch),
      (e) => {
        check(safeError(e));
        return true;
      }
    );
    await assert.rejects(
      read(
        (async () =>
          new Response(canary, {
            status: 302,
            headers: { Location: 'https://example.invalid' }
          })) as typeof fetch
      )
    );
  }
});
test('local provider normalizers retain quotas and drop private canaries', () => {
  const now = Date.now();
  const codex = normalizeCodex({
    rateLimits: {
      primary: { usedPercent: 42, windowDurationMins: 300, token: canary }
    },
    prompt: privatePrompt
  });
  const claude = normalizeClaudeHistory(
    {
      samples: [{ t: now, u: { fh: 42, prompt: privatePrompt }, token: canary }]
    },
    now
  );
  assert.equal(codex.short?.used, 42);
  assert.equal(claude.short?.used, 42);
  check(codex);
  check(claude);
  check(
    allowSnapshot({
      observedAt: now,
      source: canary,
      error: privatePrompt,
      breakdown: [{ label: privatePrompt, used: 1 }]
    })
  );
});

test('production logging remains static and UI error boundaries remain guarded', async () => {
  const { readdir } = await import('node:fs/promises');
  const ts = await import('typescript');
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) =>
          e.isDirectory()
            ? walk(path.join(dir, e.name))
            : Promise.resolve([path.join(dir, e.name)])
        )
      )
    ).flat();
  }
  for (const file of await walk('src')) {
    if (!file.endsWith('.ts')) continue;
    const source = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const visit = (node: import('typescript').Node) => {
      if (
        ts.isCallExpression(node) &&
        /(?:console|logger)\.(?:log|warn|error|info|debug|trace)$/.test(
          node.expression.getText(source)
        )
      ) {
        assert.ok(
          node.arguments.every((arg) => ts.isStringLiteral(arg)),
          file + ' must not log objects or dynamic strings'
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const plugin = await readFile('src/plugin.ts', 'utf8');
  assert.doesNotMatch(plugin, /error\.message/);
});
