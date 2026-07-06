import { describe, expect, it } from 'vitest';
import { prepareInstallContentWithMediaUrls } from './post-content-media-rewrite.js';

describe('prepareInstallContentWithMediaUrls', () => {
  it('rewrites raw extracted post content when there is no composed override', () => {
    const result = prepareInstallContentWithMediaUrls({
      sourceContent: '<p><img src="https://cdn.example.com/hero.jpg"></p>',
      mediaUrlMap: new Map([
        ['https://cdn.example.com/hero.jpg', 'http://playground.test/wp-content/uploads/hero.jpg'],
      ]),
    });

    expect(result.contentOverride).toBe('<p><img src="http://playground.test/wp-content/uploads/hero.jpg"></p>');
    expect(result.rewritten).toBe(true);
    expect(result.usedSourceContent).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('rewrites an existing composed block override', () => {
    const result = prepareInstallContentWithMediaUrls({
      sourceContent: '<p>Raw source</p>',
      contentOverride: '<!-- wp:image {"url":"https://cdn.example.com/hero.jpg"} --><figure><img src="https://cdn.example.com/hero.jpg"></figure><!-- /wp:image -->',
      mediaUrlMap: new Map([
        ['https://cdn.example.com/hero.jpg', 'http://playground.test/wp-content/uploads/hero.jpg'],
      ]),
    });

    expect(result.contentOverride).toContain('"url":"http://playground.test/wp-content/uploads/hero.jpg"');
    expect(result.contentOverride).toContain('src="http://playground.test/wp-content/uploads/hero.jpg"');
    expect(result.contentOverride).not.toContain('https://cdn.example.com/hero.jpg');
    expect(result.rewritten).toBe(true);
    expect(result.usedSourceContent).toBe(false);
  });

  it('preserves the old no-override behavior when there is no media map', () => {
    const result = prepareInstallContentWithMediaUrls({
      sourceContent: '<p><img src="https://cdn.example.com/hero.jpg"></p>',
      mediaUrlMap: new Map(),
    });

    expect(result.contentOverride).toBeUndefined();
    expect(result.rewritten).toBe(false);
    expect(result.usedSourceContent).toBe(false);
    expect(result.missing).toEqual([]);
  });

  it('reports unmapped media URLs from the content being installed', () => {
    const result = prepareInstallContentWithMediaUrls({
      sourceContent: '<img src="https://cdn.example.com/missing.jpg">',
      mediaUrlMap: new Map([
        ['https://cdn.example.com/known.jpg', 'http://playground.test/wp-content/uploads/known.jpg'],
      ]),
    });

    expect(result.contentOverride).toBe('<img src="https://cdn.example.com/missing.jpg">');
    expect(result.rewritten).toBe(false);
    expect(result.usedSourceContent).toBe(true);
    expect(result.missing).toEqual(['https://cdn.example.com/missing.jpg']);
  });
});
