import { describe, it, expect } from 'vitest';
import { parseParityLog, serializeParityLog, upsertEntry, replayableEntries, type ParityLog, type ParityLogEntry } from './parity-log.js';

const entry = (over: Partial<ParityLogEntry> = {}): ParityLogEntry => ({
  band: 'services',
  bandIndex: 1,
  divergence: 'card titles render stacked above the cards; cards show only numbers',
  sourceTarget: 'each card = number + title + description + Read More',
  fix: 'move each heading into its card as the title; drop the orphaned stacked headings',
  axes: ['structure', 'type-size'],
  status: 'applied',
  ...over,
});

describe('parity-log', () => {
  it('round-trips a valid log through serialize → parse', () => {
    const log: ParityLog = { version: 1, page: 'homepage', sourceUrl: 'https://x/', entries: [entry()] };
    const back = parseParityLog(serializeParityLog(log));
    expect(back.page).toBe('homepage');
    expect(back.entries).toHaveLength(1);
    expect(back.entries[0].axes).toEqual(['structure', 'type-size']);
  });

  it('rejects a malformed log (missing version / non-array entries)', () => {
    expect(() => parseParityLog('{"page":"x","entries":[]}')).toThrow();
    expect(() => parseParityLog('{"version":1,"page":"x","entries":{}}')).toThrow();
    expect(() => parseParityLog('not json')).toThrow();
  });

  it('upsert REPLACES an entry with the same band+axes signature (re-polish updates, no dupes)', () => {
    const log: ParityLog = { version: 1, page: 'homepage', entries: [entry({ fix: 'first attempt' })] };
    const updated = upsertEntry(log, entry({ fix: 'second attempt', status: 'applied' }));
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0].fix).toBe('second attempt');
  });

  it('upsert APPENDS a new entry for a different band or different axes', () => {
    const log: ParityLog = { version: 1, page: 'homepage', entries: [entry()] };
    const a = upsertEntry(log, entry({ bandIndex: 4, band: 'journey', axes: ['dim'] }));
    expect(a.entries).toHaveLength(2);
    const b = upsertEntry(a, entry({ axes: ['full-bleed'] })); // same band, different axes
    expect(b.entries).toHaveLength(3);
  });

  it('replayableEntries returns only applied/residual entries (skips pending) in band order', () => {
    const log: ParityLog = {
      version: 1, page: 'homepage',
      entries: [
        entry({ bandIndex: 6, band: 'testimonials', status: 'applied', axes: ['type-size'] }),
        entry({ bandIndex: 1, band: 'services', status: 'pending', axes: ['structure'] }),
        entry({ bandIndex: 4, band: 'journey', status: 'residual', axes: ['dim'] }),
      ],
    };
    const r = replayableEntries(log);
    expect(r.map((e) => e.bandIndex)).toEqual([4, 6]); // pending skipped, sorted by band
  });
});
