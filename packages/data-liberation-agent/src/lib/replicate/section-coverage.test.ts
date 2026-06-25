import { describe, it, expect } from 'vitest';
import { measureSectionCoverage, measureConvertedCoverage } from './section-coverage.js';

// Fictional content — no real source-site data (project convention).
describe('measureSectionCoverage', () => {
  it('reports full coverage when all captured text and images appear in the markup', () => {
    const cov = measureSectionCoverage(
      { texts: ['Handmade tables', 'Built to last'], imageUrls: ['/wp-content/uploads/a.jpg'] },
      '<h2>Handmade tables</h2><p>Built to last</p><img src="/wp-content/uploads/a.jpg"/>',
    );
    expect(cov.textCoverage).toBe(1);
    expect(cov.missingImages).toEqual([]);
    expect(cov.lost).toBe(false);
  });

  it('counts entity-escaped text as covered (& → &amp;)', () => {
    // The structured renderers emit captured text through escapeHtml, so the
    // markup carries &amp;/&#039;/&quot; where the captured text has &/'/" —
    // a raw substring match reads every such text as MISSING and a section
    // whose texts ALL contain an escapable char measures 0% and islands.
    const cov = measureSectionCoverage(
      { texts: ['Pets & Our Mental Health'], imageUrls: [] },
      '<h3 class="wp-block-heading">Pets &amp; Our Mental Health</h3>',
    );
    expect(cov.textCoverage).toBe(1);
    expect(cov.lost).toBe(false);
  });

  it("counts entity-escaped apostrophes as covered (' → &#039;)", () => {
    const cov = measureSectionCoverage(
      { texts: ["World Men's Day"], imageUrls: [] },
      '<h2>World Men&#039;s Day</h2>',
    );
    expect(cov.textCoverage).toBe(1);
    expect(cov.lost).toBe(false);
  });

  it('folds typographic glyph variants (curly captured vs straight emitted)', () => {
    const cov = measureSectionCoverage(
      { texts: ['Don’t worry — be happy'], imageUrls: [] },
      '<p>Don&#039;t worry - be happy</p>',
    );
    expect(cov.textCoverage).toBe(1);
    expect(cov.lost).toBe(false);
  });

  it('flags lost when a captured image is missing from the render (media-first)', () => {
    const cov = measureSectionCoverage(
      { texts: ['Gallery'], imageUrls: ['/wp-content/uploads/a.jpg', '/wp-content/uploads/b.jpg'] },
      '<h2>Gallery</h2><img src="/wp-content/uploads/a.jpg"/>',
    );
    expect(cov.missingImages).toEqual(['/wp-content/uploads/b.jpg']);
    expect(cov.lost).toBe(true);
  });

  it('flags lost only when text coverage drops below the 0.5 floor (badly broken)', () => {
    const cov = measureSectionCoverage(
      { texts: ['one', 'two', 'three', 'four', 'five'], imageUrls: [] },
      '<p>one</p>', // 1/5 = 0.2 coverage, below the 0.5 floor
    );
    expect(cov.textCoverage).toBeCloseTo(0.2, 5);
    expect(cov.lost).toBe(true);
  });

  it('keeps a section with minor-to-moderate text loss structured (no unstyled island)', () => {
    // 3/5 = 0.6 coverage: above the 0.5 floor. A CSS-styled section that merely
    // missed some copy must stay as structured blocks rather than be downgraded to
    // a CSS-less verbatim island (swiftlumber homepage Advantage cards regression).
    const cov = measureSectionCoverage(
      { texts: ['a', 'b', 'c', 'd', 'e'], imageUrls: [] },
      '<p>a</p><p>b</p><p>c</p>',
    );
    expect(cov.textCoverage).toBeCloseTo(0.6, 5);
    expect(cov.lost).toBe(false);
  });

  it('still flags lost just below the floor (under half the text survived)', () => {
    const cov = measureSectionCoverage(
      { texts: ['a', 'b', 'c', 'd', 'e'], imageUrls: [] },
      '<p>a</p><p>b</p>', // 2/5 = 0.4, below 0.5
    );
    expect(cov.textCoverage).toBeCloseTo(0.4, 5);
    expect(cov.lost).toBe(true);
  });

  it('tolerates minor text loss above the floor when no image is missing', () => {
    const cov = measureSectionCoverage(
      { texts: ['a', 'b', 'c', 'd', 'e'], imageUrls: ['/u/x.jpg'] },
      '<p>a</p><p>b</p><p>c</p><p>d</p><img src="/u/x.jpg"/>', // 4/5 = 0.8, image present
    );
    expect(cov.textCoverage).toBeCloseTo(0.8, 5);
    expect(cov.lost).toBe(false);
  });

  it('matches text case-insensitively and ignores whitespace differences', () => {
    const cov = measureSectionCoverage(
      { texts: ['Hello   World'], imageUrls: [] },
      '<p>hello world</p>',
    );
    expect(cov.textCoverage).toBe(1);
    expect(cov.lost).toBe(false);
  });

  it('treats an empty captured section as not lost (nothing to lose)', () => {
    const cov = measureSectionCoverage({ texts: [], imageUrls: [] }, '<div></div>');
    expect(cov.textCoverage).toBe(1);
    expect(cov.lost).toBe(false);
  });
});

describe('measureConvertedCoverage', () => {
  it('matches captured plain text against markup with inline links (no spurious tag-boundary space)', () => {
    const captured = { texts: ['Visit our shop today.'], imageUrls: [] };
    const markup = '<!-- wp:paragraph --><p>Visit our <a href="/shop">shop</a> today.</p><!-- /wp:paragraph -->';
    expect(measureConvertedCoverage(captured, markup).lost).toBe(false);
  });

  it('matches across smart-quote / entity differences', () => {
    const captured = { texts: ["It's a quiet honor."], imageUrls: [] }; // straight quote
    const markup = '<!-- wp:paragraph --><p>It&#8217;s a quiet honor.</p><!-- /wp:paragraph -->'; // curly entity
    expect(measureConvertedCoverage(captured, markup).lost).toBe(false);
  });

  it('matches an image by basename across CDN vs uploads URL forms', () => {
    const captured = { texts: [], imageUrls: ['https://cdn.example.test/x/photo.jpg?resize=800%2C600&ssl=1'] };
    const markup = '<!-- wp:image --><figure class="wp-block-image"><img src="https://site.test/wp-content/uploads/2024/01/photo.jpg"/></figure><!-- /wp:image -->';
    expect(measureConvertedCoverage(captured, markup).missingImages).toEqual([]);
    expect(measureConvertedCoverage(captured, markup).lost).toBe(false);
  });

  it('still reports loss when captured text is genuinely absent', () => {
    const captured = { texts: ['A sentence that does not appear at all.'], imageUrls: [] };
    const markup = '<!-- wp:paragraph --><p>Completely different content.</p><!-- /wp:paragraph -->';
    expect(measureConvertedCoverage(captured, markup).lost).toBe(true);
  });

  it('still reports loss when a captured image basename is genuinely absent', () => {
    const captured = { texts: [], imageUrls: ['https://x.test/unique-basename-xyz.jpg'] };
    const markup = '<!-- wp:paragraph --><p>No images here.</p><!-- /wp:paragraph -->';
    expect(measureConvertedCoverage(captured, markup).lost).toBe(true);
  });

  it('empty captured content is fully covered', () => {
    expect(measureConvertedCoverage({ texts: [], imageUrls: [] }, '<p>anything</p>').lost).toBe(false);
  });
});
