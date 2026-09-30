import { findCodex, readCodex } from '../src/providers/codex.js';
import { normalizeCodex } from '../src/providers/normalize.js';
const executable = await findCodex();
const snapshot = normalizeCodex(await readCodex(executable));
console.log(JSON.stringify(snapshot, null, 2));
if (snapshot.error) process.exitCode = 1;
