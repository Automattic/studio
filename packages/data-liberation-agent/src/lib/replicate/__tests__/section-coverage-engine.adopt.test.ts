import { describe, expect, it } from 'vitest';
import {
  foldText,
  measureConvertedCoverage,
  measureSectionCoverage,
} from '@automattic/blocks-engine/theme';

describe('blocks-engine section coverage adoption', () => {
  it('measures full structured coverage with DLA golden output', () => {
    expect(
      measureSectionCoverage(
        { text: ['Handmade tables', 'Built to last'], images: ['/wp-content/uploads/a.jpg'] },
        '<h2>Handmade tables</h2><p>Built to last</p><img src="/wp-content/uploads/a.jpg">',
      ),
    ).toEqual({
      textCoverage: 1,
      missingImages: [],
      lost: false,
    });
  });

  it('treats escaped entities and glyph variants as covered', () => {
    expect(
      measureSectionCoverage(
        { text: ['Pets & Our Mental Health', 'Don’t worry — be happy'], images: [] },
        '<h3>Pets &amp; Our Mental Health</h3><p>Don&#039;t worry - be happy</p>',
      ),
    ).toEqual({
      textCoverage: 1,
      missingImages: [],
      lost: false,
    });
  });

  it('keeps the conservative text floor for below-floor structured renders', () => {
    expect(
      measureSectionCoverage(
        { text: ['one', 'two', 'three', 'four', 'five'], images: [] },
        '<p>one</p>',
      ),
    ).toEqual({
      textCoverage: 0.2,
      missingImages: [],
      lost: true,
    });
  });

  it('keeps the media-first missing-image rule', () => {
    expect(
      measureSectionCoverage(
        { text: ['Gallery'], images: ['/wp-content/uploads/a.jpg', '/wp-content/uploads/b.jpg'] },
        '<h2>Gallery</h2><img src="/wp-content/uploads/a.jpg">',
      ),
    ).toEqual({
      textCoverage: 1,
      missingImages: ['/wp-content/uploads/b.jpg'],
      lost: true,
    });
  });

  it('matches converted images by basename across CDN and uploads URLs', () => {
    expect(
      measureConvertedCoverage(
        { text: [], images: ['https://cdn.example.test/x/photo.jpg?resize=800%2C600&ssl=1'] },
        '<!-- wp:image --><figure class="wp-block-image"><img src="https://site.test/wp-content/uploads/2024/01/photo.jpg"></figure><!-- /wp:image -->',
      ),
    ).toEqual({
      textCoverage: 1,
      missingImages: [],
      lost: false,
    });
  });

  it('folds promoted-heading echo text with the DLA golden output', () => {
    expect(foldText('Don’t worry — be happy…  NOW')).toBe("don't worry - be happy... now");
  });
});
