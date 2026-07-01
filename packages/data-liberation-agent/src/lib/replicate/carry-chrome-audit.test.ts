import { describe, it, expect } from 'vitest';
import { diffChromeFidelity, emitChromeCorrectionCss, buildBuiltChrome, builtSelectorFor } from './carry-chrome-audit.js';
import type { ChromeFidelity } from './chrome-audit-types.js';

const SRC: ChromeFidelity = { schema: 1, sourceUrl: 'https://x/', regions: { footer: [
  { key: 'footer>0-1>a', props: { 'text-decoration-line': 'none', 'line-height': '25.2px' }, box: { w: 100, h: 25 } },
] } };

describe('diffChromeFidelity', () => {
  it('reports allowlisted divergences with source values to copy', () => {
    const built = { footer: [{ key: 'footer>0-1>a', selector: 'footer .x a', props: { 'text-decoration-line': 'underline', 'line-height': '18.2px' } }] };
    const r = diffChromeFidelity(SRC, built);
    expect(r.corrections).toEqual(expect.arrayContaining([
      { region: 'footer', selector: 'footer .x a', property: 'text-decoration-line', from: 'underline', to: 'none' },
    ]));
    expect(r.corrections.find((c) => c.property === 'line-height')!.to).toBe('25.2px');
  });
  it('respects the length epsilon (<=0.5px is not a divergence)', () => {
    const built = { footer: [{ key: 'footer>0-1>a', selector: 's', props: { 'line-height': '25.4px', 'text-decoration-line': 'none' } }] };
    expect(diffChromeFidelity(SRC, built).corrections).toHaveLength(0);
  });
  it('reports dropped chrome instead of guessing', () => {
    const r = diffChromeFidelity(SRC, { footer: [] });
    expect(r.droppedChrome).toBe(1);
    expect(r.corrections).toHaveLength(0);
  });
  it('non-actionable tiny source entry absent from built does not increment droppedChrome', () => {
    const src: ChromeFidelity = { schema: 1, sourceUrl: 'https://x/', regions: { footer: [
      { key: 'footer>0-1>a', props: { 'text-decoration-line': 'none' }, box: { w: 100, h: 25 } },
      { key: 'footer>0-2>div', props: {}, box: { w: 0, h: 0 } },
    ] } };
    const built = { footer: [{ key: 'footer>0-1>a', selector: 's', props: { 'text-decoration-line': 'none', 'line-height': '25.2px' } }] };
    const r = diffChromeFidelity(src, built);
    expect(r.droppedChrome).toBe(0);
  });
  it('counts unmatched built elements', () => {
    const built = { footer: [
      { key: 'footer>0-1>a', selector: 's', props: { 'text-decoration-line': 'none', 'line-height': '25.2px' } },
      { key: 'footer>9-9>div', selector: 's2', props: {} as Record<string, string> },
    ] };
    expect(diffChromeFidelity(SRC, built).unmatched).toBe(1);
  });
});

describe('emitChromeCorrectionCss', () => {
  it('emits one scoped rule per correction with the source value', () => {
    const css = emitChromeCorrectionCss([{ region: 'footer', selector: 'footer .x a', property: 'text-decoration-line', from: 'underline', to: 'none' }], 'body.lib-carry-site');
    expect(css).toMatch(/footer \.x a\s*\{\s*text-decoration-line:\s*none/);
    expect(css).toMatch(/lib-carry-site/);
  });
  it('returns empty string for no corrections', () => {
    expect(emitChromeCorrectionCss([], 'body.lib-carry-site')).toBe('');
  });
});

describe('buildBuiltChrome', () => {
  it('keys built rows with the same chromeKey used by capture', () => {
    const built = buildBuiltChrome([{ region: 'footer', pathIndex: [0, 1], tag: 'a', className: 'link active', selector: 'footer .x a', props: { 'line-height': '18px' } }]);
    expect(built.footer![0].key).toMatch(/^footer>0-1>a/);
    expect(built.footer![0].key).not.toContain('active');
    expect(built.footer![0].selector).toBe('footer .x a');
  });
});

describe('builtSelectorFor', () => {
  it('returns the region-root anchor unchanged when pathIndex is empty', () => {
    expect(builtSelectorFor('footer.footer', [])).toBe('footer.footer');
  });
  it('appends nth-child steps (1-based) for each pathIndex entry', () => {
    expect(builtSelectorFor('footer.footer', [0, 1])).toBe(
      'footer.footer > *:nth-child(1) > *:nth-child(2)',
    );
  });
  it('handles a single-step pathIndex', () => {
    expect(builtSelectorFor('nav', [2])).toBe('nav > *:nth-child(3)');
  });
});
