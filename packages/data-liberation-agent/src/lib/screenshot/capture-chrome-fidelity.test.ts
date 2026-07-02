import { describe, it, expect } from 'vitest';
import { assembleChromeFidelity } from './capture-chrome-fidelity.js';

describe('assembleChromeFidelity', () => {
  it('keys rows and groups by region', () => {
    const fid = assembleChromeFidelity('https://x/', [
      { region: 'footer', pathIndex: [0, 1], tag: 'a', className: 'link active', props: { 'text-decoration-line': 'none' }, box: { w: 10, h: 25 } },
    ]);
    expect(fid.sourceUrl).toBe('https://x/');
    expect(fid.regions.footer![0].key).toMatch(/^footer>0-1>a/);
    expect(fid.regions.footer![0].key).not.toContain('active'); // volatile stripped
    expect(fid.schema).toBe(1);
  });

  it('groups multiple regions', () => {
    const fid = assembleChromeFidelity('https://x/', [
      { region: 'header', pathIndex: [0], tag: 'nav', className: '', props: {}, box: { w: 1, h: 1 } },
      { region: 'footer', pathIndex: [0], tag: 'div', className: '', props: {}, box: { w: 1, h: 1 } },
    ]);
    expect(fid.regions.header).toHaveLength(1);
    expect(fid.regions.footer).toHaveLength(1);
  });
});
