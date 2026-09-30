import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseBudget } from '../scripts/check-release-budget.mjs';
const job = (label: string, minutes: number) => ({
  runner_id: 1,
  labels: [label],
  started_at: '2026-09-01T00:00:00Z',
  completed_at: `2026-09-01T00:${String(minutes).padStart(2, '0')}:00Z`,
  conclusion: 'success'
});
test('release budget counts failed/cancelled attempts with platform weights and reserves the complete candidate before starting', async () => {
  const replies: any[] = [
    {
      total_count: 2,
      workflow_runs: [
        { id: 1, run_attempt: 2, status: 'completed' },
        { id: 2, run_attempt: 1, status: 'in_progress' }
      ]
    },
    { total_count: 2, jobs: [job('windows-latest', 3), job('macos-15', 2)] },
    { total_count: 1, jobs: [job('ubuntu-latest', 1)] }
  ];
  const r = await releaseBudget({
    request: (async () =>
      new Response(JSON.stringify(replies.shift()))) as typeof fetch,
    runId: '2'
  });
  assert.deepEqual(r, { spent: 27, reserved: 65, limit: 350 });
});
test('release budget fails closed on unknown costs, exhausted allowance and API failure', async () => {
  for (const mode of ['unknown', 'exhausted', 'api']) {
    let calls = 0;
    const request = (async () => {
      if (mode === 'api')
        return new Response('private error detail', { status: 403 });
      return new Response(
        JSON.stringify(
          calls++ === 0
            ? {
                total_count: 1,
                workflow_runs: [{ id: 1, run_attempt: 1, status: 'completed' }]
              }
            : {
                total_count: 1,
                jobs: [
                  job(mode === 'unknown' ? 'unknown' : 'macos-15-intel', 30)
                ]
              }
        )
      );
    }) as typeof fetch;
    await assert.rejects(
      releaseBudget({ request, token: 'do-not-print-this' }),
      (e) => {
        assert.doesNotMatch(
          String(e),
          /do-not-print-this|private error detail/
        );
        return true;
      }
    );
  }
});
