import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME_FIDELITY_SCHEMA, type ChromeFidelity } from './chrome-audit-types.js';

const FILE = 'chrome-fidelity.json';

export function writeChromeFidelity(dir: string, fid: ChromeFidelity): void {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, FILE);
  const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...fid, schema: CHROME_FIDELITY_SCHEMA }));
  renameSync(tmp, p);
}

export function readChromeFidelity(dir: string): ChromeFidelity | null {
  const p = join(dir, FILE);
  if (!existsSync(p)) return null;
  try {
    const f = JSON.parse(readFileSync(p, 'utf8')) as ChromeFidelity;
    if (f.schema !== CHROME_FIDELITY_SCHEMA) return null;
    return f;
  } catch { return null; }
}
