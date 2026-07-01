import { describe, it, expect } from 'vitest';
import { extractContentRegion } from './content-region.js';

describe('extractContentRegion', () => {
  it('returns the inner HTML of <main> when present and non-trivial', () => {
    const html = `
      <html><body>
        <header>Site header</header>
        <main>
          <h1>About us</h1>
          <p>${'Lorem ipsum '.repeat(20)}</p>
          <p>${'Body content '.repeat(20)}</p>
        </main>
        <footer>Site footer</footer>
      </body></html>
    `;
    const r = extractContentRegion(html);
    expect(r.source).toBe('main');
    expect(r.html).toContain('About us');
    expect(r.html).not.toContain('Site header');
    expect(r.html).not.toContain('Site footer');
  });

  it('falls through when <main> exists but is empty / chrome-only', () => {
    const html = `
      <html><body>
        <main><nav></nav></main>
        <article>
          <h2>Real content</h2>
          <p>${'Substantive paragraph '.repeat(30)}</p>
          <p>${'More content '.repeat(40)}</p>
        </article>
      </body></html>
    `;
    const r = extractContentRegion(html);
    // <main> too thin → text-density rule picks article
    expect(r.source).toBe('text-density');
    expect(r.html).toContain('Real content');
  });

  it('text-density picks the prose region over chrome', () => {
    const html = `
      <html><body>
        <div class="navbar">
          <a href="#">Home</a><a href="#">About</a><a href="#">Contact</a>
          <a href="#">Products</a><a href="#">Blog</a><a href="#">FAQ</a>
        </div>
        <div class="content-region">
          <h1>Real headline</h1>
          <p>${'This is real prose content with substantial text. '.repeat(15)}</p>
          <p>${'Multiple paragraphs of body content go here. '.repeat(15)}</p>
        </div>
        <div class="sidebar">
          <a href="#">Link 1</a><a href="#">Link 2</a><a href="#">Link 3</a>
        </div>
      </body></html>
    `;
    const r = extractContentRegion(html);
    expect(r.source).toBe('text-density');
    expect(r.html).toContain('Real headline');
    expect(r.html).not.toContain('Home');
    expect(r.html).not.toContain('Link 1');
  });

  it('body-minus-chrome strips header/nav/footer when no main and no clear density winner', () => {
    const html = `
      <html><body>
        <header><nav><a href="#">Menu</a></nav></header>
        <p>Just one paragraph inline at body level.</p>
        <p>${'Another short paragraph. '.repeat(8)}</p>
        <footer>Copyright 2026</footer>
      </body></html>
    `;
    const r = extractContentRegion(html);
    // No main; text-density may not score the loose body paragraphs as
    // a single container — falls through to body-minus-chrome.
    expect(['body-minus-chrome', 'text-density']).toContain(r.source);
    expect(r.html).not.toContain('Copyright 2026');
    expect(r.html).not.toContain('Menu');
  });

  it('strips common chrome class/id patterns in body-minus-chrome path', () => {
    const html = `
      <html><body>
        <div class="site-header">Header</div>
        <div class="cookie-banner">Cookie consent</div>
        <p>${'Real text '.repeat(8)}</p>
        <div id="footer">Footer</div>
      </body></html>
    `;
    const r = extractContentRegion(html);
    expect(r.html).not.toContain('Header');
    expect(r.html).not.toContain('Cookie consent');
    expect(r.html).not.toContain('Footer');
    expect(r.html).toContain('Real text');
  });

  it('returns whole-body source when nothing else applies', () => {
    const html = '<html><body><p>tiny</p></body></html>';
    const r = extractContentRegion(html);
    // No main, no big text-density winner, body has no chrome to strip.
    // Acceptable sources: whole-body or body-minus-chrome.
    expect(['whole-body', 'body-minus-chrome']).toContain(r.source);
  });

  it('produces a meaningful byte reduction on chrome-heavy input', () => {
    const chrome = '<header>'.padEnd(2000, 'x') + '</header>';
    const main = `<main><h1>Title</h1><p>${'real content '.repeat(50)}</p></main>`;
    const footer = '<footer>'.padEnd(2000, 'x') + '</footer>';
    const r = extractContentRegion(`<html><body>${chrome}${main}${footer}</body></html>`);
    expect(r.source).toBe('main');
    expect(r.outputBytes).toBeLessThan(r.inputBytes / 2);
  });

  it('records diagnostic notes', () => {
    const r = extractContentRegion('<html><body><main><p>' + 'x '.repeat(60) + '</p></main></body></html>');
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.notes[0]).toContain('<main>');
  });
});
