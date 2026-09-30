import { allowSnapshot } from './security.js';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Provider, Snapshot } from './model.js';

export const defaultLastReadingsFile = () =>
  path.join(
    process.env.AI_USAGE_DATA_DIR ||
      path.join(homedir(), '.ai-usage-streamdeck'),
    'last-readings.json'
  );

const limit = 8 * 1024 * 1024;
const entry = (provider: Provider, key: string) => `${provider}:${key}`;

/** Most recent reading per provider account, so idle chosen accounts keep their percentage across restarts. */
export class LastReadings {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}

  private async load(): Promise<Record<string, Snapshot>> {
    const readings: Record<string, Snapshot> = Object.create(null);
    try {
      if ((await stat(this.file)).size > limit) return readings;
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        data?.version === 1 &&
        data.readings &&
        typeof data.readings === 'object'
      )
        for (const [key, value] of Object.entries(data.readings)) {
          if (
            value &&
            typeof value === 'object' &&
            typeof (value as Snapshot).observedAt === 'number' &&
            Number.isFinite((value as Snapshot).observedAt)
          )
            readings[key] = allowSnapshot(value as Snapshot);
        }
    } catch {
      /* Missing or corrupt files start empty. */
    }
    return readings;
  }

  // Writes are serialised and atomic so concurrent keys never lose each other's readings.
  private update(
    change: (readings: Record<string, Snapshot>) => void
  ): Promise<void> {
    const run = this.queue.then(async () => {
      const readings = await this.load();
      change(readings);
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, readings }), {
          mode: 0o600
        });
        await rename(temporary, this.file);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async get(provider: Provider, key: string): Promise<Snapshot | undefined> {
    await this.queue;
    const reading = (await this.load())[entry(provider, key)];
    return reading &&
      typeof reading === 'object' &&
      typeof reading.observedAt === 'number' &&
      Number.isFinite(reading.observedAt)
      ? allowSnapshot(reading)
      : undefined;
  }

  set(provider: Provider, key: string, snapshot: Snapshot): Promise<void> {
    const reading = allowSnapshot(snapshot);
    delete reading.error;
    delete reading.idle;
    return this.update((readings) => {
      readings[entry(provider, key)] = reading;
    });
  }

  delete(provider: Provider, key: string): Promise<void> {
    return this.update((readings) => {
      delete readings[entry(provider, key)];
    });
  }
}
