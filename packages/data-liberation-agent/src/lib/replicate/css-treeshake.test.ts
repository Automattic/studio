import { describe, it, expect } from 'vitest';
import { treeshakeCss } from './css-treeshake.js';

const HTML = '<div class="hero"><h1 class="title">Hi</h1></div>';

describe('treeshakeCss', () => {
  it('keeps rules whose key compound matches the carried DOM', () => {
    const out = treeshakeCss('.hero{color:red} .title{font-size:2rem}', HTML);
    expect(out).toContain('.hero');
    expect(out).toContain('.title');
  });

  it('drops rules whose key compound matches nothing', () => {
    const out = treeshakeCss('.hero{color:red} .nonexistent{color:blue}', HTML);
    expect(out).toContain('.hero');
    expect(out).not.toContain('.nonexistent');
  });

  it('keeps on doubt: at-rule blocks, :root, body, and unparseable selectors survive', () => {
    const out = treeshakeCss('body{margin:0} :root{--x:1px} @media(max-width:1px){.gone{a:b}}', HTML);
    expect(out).toContain('body');
    expect(out).toContain(':root');
    expect(out).toContain('@media');
    expect(out).toContain('.gone');
  });

  it('keeps interactive-state rules when the base element exists', () => {
    const out = treeshakeCss('.title:hover { color: blue } .nonexistent:hover { color: red }',
      '<div class="hero"><h1 class="title">Hi</h1></div>');
    expect(out).toContain('.title:hover');
    expect(out).not.toContain('.nonexistent');
  });

  it('keys off the rightmost compound for descendant selectors', () => {
    const HTML = '<div class="hero"><h1 class="title">Hi</h1></div>';
    // key is .title (present) even though .wrapper is absent -> KEEP
    expect(treeshakeCss('.wrapper .title { color: red }', HTML)).toContain('.title');
    // key is .nonexistent (absent) even though .hero is present -> DROP
    expect(treeshakeCss('.hero .nonexistent { color: red }', HTML)).not.toContain('.nonexistent');
  });

  it('keeps a comma rule when any selector matches', () => {
    const HTML = '<div class="hero"><h1 class="title">Hi</h1></div>';
    const out = treeshakeCss('.title, .nonexistent { color: red }', HTML);
    expect(out).toContain('.title');
  });

  it('keeps on doubt: pseudo-elements in key compound (cheerio cannot match them)', () => {
    const out = treeshakeCss('.hero::before{content:"x"}', HTML);
    expect(out).toContain('.hero::before');
  });
});
