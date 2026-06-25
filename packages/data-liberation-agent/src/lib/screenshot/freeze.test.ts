import { describe, it, expect } from 'vitest';
import { sanitizeFrozenHtml } from './freeze.js';

describe('sanitizeFrozenHtml', () => {
  it('strips scripts but preserves <style> and inline style=', () => {
    const input = `<style>.h{color:red}</style><div style="color:blue" onclick="x()">hi<script>evil()</script></div>`;
    const out = sanitizeFrozenHtml(input);
    expect(out).toContain('<style>.h{color:red}</style>');   // CSS preserved
    expect(out).toContain('style="color:blue"');             // inline style preserved
    expect(out).not.toContain('<script>');                   // script removed
    expect(out).not.toContain('onclick');                    // handler removed
  });
});
