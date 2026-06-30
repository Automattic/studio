import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeChromeFidelity, readChromeFidelity } from './chrome-fidelity-store.js';
import { CHROME_FIDELITY_SCHEMA } from './chrome-audit-types.js';

const DIR = join(process.cwd(), '.tmp-test', 'chrome-fid');
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

describe('chrome-fidelity store', () => {
  it('round-trips a fingerprint', () => {
    const fid = { schema: CHROME_FIDELITY_SCHEMA, sourceUrl: 'https://x/', regions: { footer: [{ key: 'footer>0>a', props: { 'text-decoration-line': 'none' }, box: { w: 10, h: 10 } }] } };
    writeChromeFidelity(DIR, fid);
    expect(readChromeFidelity(DIR)).toEqual(fid);
  });
  it('returns null on schema drift', () => {
    writeChromeFidelity(DIR, { schema: CHROME_FIDELITY_SCHEMA, sourceUrl: 'https://x/', regions: {} });
    writeFileSync(join(DIR, 'chrome-fidelity.json'), JSON.stringify({ schema: 0, sourceUrl: 'https://x/', regions: {} }));
    expect(readChromeFidelity(DIR)).toBeNull();
  });
  it('returns null when absent', () => {
    expect(readChromeFidelity(join(process.cwd(), '.tmp-test', 'chrome-fid-absent'))).toBeNull();
  });
});
