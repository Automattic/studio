import { describe, it, expect } from 'vitest';
import { parseContent } from '../src/lib/extraction/content-parser.js';

describe('parseContent', () => {
  it('extracts text content stripped of tags', () => {
    const html = '<p>Hello <strong>world</strong></p><p>Second paragraph</p>';
    const result = parseContent(html);
    expect(result.text).toBe('Hello world Second paragraph');
  });

  it('extracts headings with level and text', () => {
    const html = '<h1>Main Title</h1><p>Body</p><h2>Sub Title</h2><h3>Deep</h3>';
    const result = parseContent(html);
    expect(result.headings).toEqual([
      { level: 1, text: 'Main Title' },
      { level: 2, text: 'Sub Title' },
      { level: 3, text: 'Deep' },
    ]);
  });

  it('extracts images with src and alt', () => {
    const html = '<img src="photo.jpg" alt="A photo"><img src="logo.png" alt="">';
    const result = parseContent(html);
    expect(result.images).toEqual([
      { src: 'photo.jpg', alt: 'A photo' },
      { src: 'logo.png', alt: '' },
    ]);
  });

  it('extracts links with href and text', () => {
    const html = '<a href="https://example.com">Example</a> and <a href="/about">About Us</a>';
    const result = parseContent(html);
    expect(result.links).toEqual([
      { href: 'https://example.com', text: 'Example' },
      { href: '/about', text: 'About Us' },
    ]);
  });

  it('handles empty HTML', () => {
    const result = parseContent('');
    expect(result.text).toBe('');
    expect(result.headings).toEqual([]);
    expect(result.images).toEqual([]);
    expect(result.links).toEqual([]);
  });

  it('normalizes whitespace in text', () => {
    const html = '<p>  Hello   world  </p>\n\n<p>  Next   line  </p>';
    const result = parseContent(html);
    expect(result.text).toBe('Hello world Next line');
  });

  it('ignores script and style content', () => {
    const html = '<style>body { color: red; }</style><p>Visible</p><script>alert("hi")</script>';
    const result = parseContent(html);
    expect(result.text).toBe('Visible');
    expect(result.links).toEqual([]);
  });
});
