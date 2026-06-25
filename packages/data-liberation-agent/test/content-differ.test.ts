import { describe, it, expect } from 'vitest';
import { diffContent } from '../src/lib/qa/content-differ.js';
import type { ContentModel } from '../src/lib/extraction/content-parser.js';

function model(overrides: Partial<ContentModel> = {}): ContentModel {
  return {
    text: overrides.text ?? '',
    headings: overrides.headings ?? [],
    images: overrides.images ?? [],
    links: overrides.links ?? [],
  };
}

describe('diffContent', () => {
  it('returns pass for identical content', () => {
    const content = model({
      text: 'Hello world this is a test',
      headings: [{ level: 1, text: 'Title' }],
      images: [{ src: 'https://example.com/photo.jpg', alt: 'Photo' }],
      links: [{ href: 'https://example.com', text: 'Example' }],
    });
    const diff = diffContent(content, content);
    expect(diff.textSimilarity).toBe(1);
    expect(diff.headingsMatch.missing).toBe(0);
    expect(diff.imagesMatch.missing).toBe(0);
    expect(diff.linksMatch.missing).toBe(0);
    expect(diff.grade).toBe('pass');
  });

  it('detects missing images', () => {
    const origin = model({
      text: 'Some text here',
      images: [
        { src: 'https://cdn.example.com/photo.jpg?w=800', alt: 'Photo' },
        { src: 'https://cdn.example.com/logo.png', alt: 'Logo' },
      ],
    });
    const wxr = model({
      text: 'Some text here',
      images: [
        { src: 'https://other.com/photo.jpg', alt: 'Photo' },
      ],
    });
    const diff = diffContent(origin, wxr);
    expect(diff.imagesMatch.origin).toBe(2);
    expect(diff.imagesMatch.wxr).toBe(1);
    expect(diff.imagesMatch.missing).toBe(1);
    expect(diff.missingImages).toEqual([
      { src: 'https://cdn.example.com/logo.png', alt: 'Logo' },
    ]);
  });

  it('detects missing headings', () => {
    const origin = model({
      text: 'Content text',
      headings: [
        { level: 1, text: 'Main Title' },
        { level: 2, text: 'Subtitle' },
      ],
    });
    const wxr = model({
      text: 'Content text',
      headings: [
        { level: 1, text: 'Main Title' },
      ],
    });
    const diff = diffContent(origin, wxr);
    expect(diff.headingsMatch.origin).toBe(2);
    expect(diff.headingsMatch.wxr).toBe(1);
    expect(diff.headingsMatch.missing).toBe(1);
    expect(diff.missingHeadings).toEqual([
      { level: 2, text: 'Subtitle' },
    ]);
  });

  it('detects missing links', () => {
    const origin = model({
      text: 'Some content',
      links: [
        { href: 'https://example.com', text: 'Example' },
        { href: '/about', text: 'About' },
      ],
    });
    const wxr = model({
      text: 'Some content',
      links: [
        { href: 'https://example.com', text: 'Example' },
      ],
    });
    const diff = diffContent(origin, wxr);
    expect(diff.linksMatch.origin).toBe(2);
    expect(diff.linksMatch.wxr).toBe(1);
    expect(diff.linksMatch.missing).toBe(1);
    expect(diff.missingLinks).toEqual([
      { href: '/about', text: 'About' },
    ]);
  });

  it('returns fail grade when text similarity is low', () => {
    const origin = model({
      text: 'The quick brown fox jumps over the lazy dog',
      headings: [{ level: 1, text: 'Original Title' }],
    });
    const wxr = model({
      text: 'Completely different content with no overlap whatsoever here',
      headings: [{ level: 1, text: 'Different Title' }],
    });
    const diff = diffContent(origin, wxr);
    expect(diff.textSimilarity).toBeLessThan(0.5);
    expect(diff.grade).toBe('fail');
  });

  it('returns warn grade for moderate differences', () => {
    const origin = model({
      text: 'The quick brown fox jumps over the lazy dog in the park',
      headings: [
        { level: 1, text: 'Main Title' },
        { level: 2, text: 'Section One' },
      ],
      images: [
        { src: 'https://example.com/photo.jpg', alt: 'Photo' },
      ],
      links: [
        { href: 'https://example.com', text: 'Link' },
      ],
    });
    // Keep most text words, keep heading and image but drop link
    const wxr = model({
      text: 'The quick brown fox jumps over the lazy dog',
      headings: [
        { level: 1, text: 'Main Title' },
        { level: 2, text: 'Section One' },
      ],
      images: [
        { src: 'https://example.com/photo.jpg', alt: 'Photo' },
      ],
      links: [],
    });
    const diff = diffContent(origin, wxr);
    expect(diff.grade).toBe('warn');
  });

  it('handles empty origin gracefully (returns pass)', () => {
    const origin = model();
    const wxr = model({
      text: 'Some WXR content',
      headings: [{ level: 1, text: 'Title' }],
    });
    const diff = diffContent(origin, wxr);
    expect(diff.grade).toBe('pass');
  });
});
