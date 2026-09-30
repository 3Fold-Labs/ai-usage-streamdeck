import { readFileSync } from 'node:fs';
const [workflow, capText] = process.argv.slice(2);
const cap = Number(capText);
if (
  !['ci.yml', 'release.yml'].includes(workflow) ||
  !Number.isInteger(cap) ||
  cap < 1
)
  throw new Error('Invalid CI budget policy');
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
if (event.repository.private) {
  const month = new Date().toISOString().slice(0, 7) + '-01';
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs?per_page=100&created=>=${month}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      },
      signal: AbortSignal.timeout(15000)
    }
  );
  if (!response.ok)
    throw new Error('Cannot verify Actions budget; refusing an unbudgeted run');
  const data = await response.json();
  const attempts = data.workflow_runs.reduce(
    (sum, run) => sum + (run.run_attempt || 1),
    0
  );
  if (data.total_count > 100 || attempts > cap)
    throw new Error(
      `Monthly workflow allowance exhausted (${attempts}/${cap}). Review budget before another run.`
    );
  console.log(
    `Monthly workflow attempts: ${attempts}/${cap}. Cancelled and failed attempts count.`
  );
}
