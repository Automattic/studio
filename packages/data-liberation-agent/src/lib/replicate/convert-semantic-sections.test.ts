import { describe, it, expect } from 'vitest';
import { convertSemanticSections, type RawConverter } from './convert-semantic-sections.js';
import type { SectionSpec } from './section-extract.js';

// Minimal fake client exposing only rawConvert (the function under test depends
// only on that surface).
const fakeClient = (results: { html: string | null; wpHtmlResidue: number }[]) => ({
  rawConvert: async (_items: string[]) => results,
});

const sec = (sectionIndex: number, sectionHtml: string): SectionSpec =>
  ({ sectionIndex, sectionHtml, headings: [], bodyText: [] } as unknown as SectionSpec);

describe('convertSemanticSections', () => {
  it('converts only semantic sections and keys the map by sectionIndex', async () => {
    const sections = [
      sec(0, '<h2>Semantic</h2><p>copy</p>'),                 // semantic → converted
      sec(1, '<div class="c"><div class="d"><span>x</span></div></div>'), // div-soup → skipped
    ];
    const client = fakeClient([{ html: '<!-- wp:heading --><h2>Semantic</h2><!-- /wp:heading -->', wpHtmlResidue: 0 }]);
    const map = await convertSemanticSections(sections, client as RawConverter);
    expect(map.has(0)).toBe(true);
    expect(map.get(0)?.markup).toContain('wp:heading');
    expect(map.has(1)).toBe(false);
  });

  it('returns an empty map when nothing is semantic', async () => {
    const sections = [sec(0, '<div class="c"><span>x</span></div>')];
    const client = fakeClient([]);
    expect((await convertSemanticSections(sections, client as RawConverter)).size).toBe(0);
  });

  it('keeps sentinel/residue results in the map (the reconstructor rejects them)', async () => {
    const sections = [sec(0, '<h2>Semantic</h2>')];
    const client = fakeClient([{ html: null, wpHtmlResidue: Infinity }]);
    const map = await convertSemanticSections(sections, client as RawConverter);
    expect(map.get(0)).toEqual({ markup: null, wpHtmlResidue: Infinity });
  });

  it('fills missing result slots with the sentinel (rawConvert returns fewer than items)', async () => {
    // A semantic section IS sent to rawConvert, but the client returns no result
    // for it (short array) — the orchestrator backfills the sentinel so the slot
    // is never silently dropped; the reconstructor's clean-check then rejects it.
    const sections = [sec(0, '<h2>Semantic</h2>')];
    const client = fakeClient([]);
    const map = await convertSemanticSections(sections, client as RawConverter);
    expect(map.get(0)).toEqual({ markup: null, wpHtmlResidue: Infinity });
  });
});
