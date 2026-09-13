import { describe, expect, it } from 'vitest';

import { extractNavLinks } from './html-extract.js';

describe('extractNavLinks', () => {
  it('resolves safe navigation URLs and drops unsafe schemes', () => {
    const html = `<header><nav>
      <a href="/about">About</a>
      <a href="mailto:hello@example.com">Email</a>
      <a href="tel:+12024567890">Call</a>
      <a href=" JAVASCRIPT:alert(1)">Script</a>
      <a href="data:text/html,unsafe">Data</a>
      <a href="vbscript:msgbox(1)">VBScript</a>
      <a href="custom:payload">Custom</a>
      <a href="not a valid URL">Relative spaces</a>
      <a href="http://[">Malformed</a>
    </nav></header>`;

    expect(extractNavLinks(html, 'https://example.com/')).toEqual([
      { text: 'About', href: 'https://example.com/about' },
      { text: 'Email', href: 'mailto:hello@example.com' },
      { text: 'Call', href: 'tel:+12024567890' },
      { text: 'Relative spaces', href: 'https://example.com/not%20a%20valid%20URL' },
    ]);
  });
});
