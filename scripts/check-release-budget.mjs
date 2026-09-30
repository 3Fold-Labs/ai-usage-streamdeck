import { pathToFileURL } from 'node:url';
// Conservative included-minute planning units: Ubuntu 1, Windows 2, macOS 10.
// Reserve full timeouts before starting; retain 100 for PR checks and 50 overhead.
export async function releaseBudget({
  request = fetch,
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  runId = process.env.GITHUB_RUN_ID,
  attempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  now = new Date(),
  limit = 350
} = {}) {
  const reservation = 65; // build Ubuntu 5 + Windows 5*2 + Intel Mac 5*10
  const get = async (suffix) => {
    const r = await request(
      `https://api.github.com/repos/${repository}/actions/${suffix}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json'
        },
        signal: AbortSignal.timeout(15000)
      }
    );
    if (!r.ok)
      throw new Error(
        'Cannot verify release budget; refusing an unbudgeted run'
      );
    return r.json();
  };
  const runs = await get(
    `workflows/release.yml/runs?per_page=100&created=>=${now.toISOString().slice(0, 7)}-01`
  );
  if (!Array.isArray(runs.workflow_runs) || runs.total_count > 100)
    throw new Error('Release budget history is incomplete');
  let spent = 0;
  for (const run of runs.workflow_runs) {
    for (let n = 1; n <= (run.run_attempt || 1); n++) {
      if (String(run.id) === String(runId) && n === attempt) continue;
      if (n === (run.run_attempt || 1) && run.status !== 'completed') {
        spent += reservation;
        continue;
      }
      const jobs = await get(`runs/${run.id}/attempts/${n}/jobs?per_page=100`);
      if (!Array.isArray(jobs.jobs) || jobs.total_count > 100)
        throw new Error('Release job history is incomplete');
      for (const job of jobs.jobs) {
        if (job.conclusion === 'skipped') continue;
        // A cancelled job that never acquired a runner has no execution time.
        if (!job.runner_id && !job.started_at) continue;
        const start = Date.parse(job.started_at),
          end = Date.parse(job.completed_at);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
          throw new Error('Release timing cannot be verified');
        const labels = (job.labels || []).join(' ').toLowerCase();
        const weight = labels.includes('windows')
          ? 2
          : labels.includes('macos')
            ? 10
            : labels.includes('ubuntu')
              ? 1
              : 0;
        if (!weight)
          throw new Error('Unknown runner cost; refusing an unbudgeted run');
        spent += Math.ceil((end - start) / 60000) * weight;
      }
    }
  }
  if (spent + reservation > limit)
    throw new Error(
      `Release allowance exhausted (${spent} used + ${reservation} reserved > ${limit}). Owner budget review required.`
    );
  return { spent, reserved: reservation, limit };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log('Release planning allowance:', await releaseBudget());
