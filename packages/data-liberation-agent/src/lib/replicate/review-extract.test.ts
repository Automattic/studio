import { describe, it, expect } from 'vitest';
import { extractReviewsFromHtml } from './review-extract.js';

// A single Replo-style review slide: <h5> category, a run of 5 anonymous star
// <svg>s, the quote in a <p> (opening sentence bolded, as the real getsnooz
// markup does), and an <h6> byline. Mirrors output/getsnooz.com homepage.
function slide(opts: {
  category: string;
  quote: string;
  author: string;
  stars?: number;
  cloned?: boolean;
}): string {
  const n = opts.stars ?? 5;
  const star =
    '<svg fill="#FF6B12FF" class="r-h11qb2" viewBox="0 0 16 16"><path d="M3.612 15.443l4.73"></path></svg>';
  return `
    <div data-slide-source-index="0" data-is-cloned="${opts.cloned ? 'true' : 'false'}">
      <div class="r-slide">
        <div><span><h5>${opts.category}</h5></span></div>
        <div class="r-stars">${star.repeat(n)}</div>
        <div class="r-quote"><span><p>${opts.quote}</p></span></div>
        <div><span><h6>${opts.author}</h6></span></div>
      </div>
    </div>`;
}

describe('extractReviewsFromHtml', () => {
  it('extracts verbatim quote + category + author + stars from a Replo carousel', () => {
    const html = `<section><h2>Why people love us</h2>
      ${slide({
        category: 'TRAVEL',
        quote:
          '"<strong>This drowns out everything</strong> perfect for traveling which is what we use it for."',
        author: '-Kayla',
      })}
      ${slide({
        category: 'TINNITUS',
        quote: '"The machine allows you to adjust the volume. I don\'t wake up as often."',
        author: '-Diane B.',
      })}
    </section>`;
    const reviews = extractReviewsFromHtml(html);
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toEqual({
      category: 'TRAVEL',
      stars: 5,
      quote:
        '"This drowns out everything perfect for traveling which is what we use it for."',
      author: '-Kayla',
    });
    expect(reviews[1].category).toBe('TINNITUS');
    expect(reviews[1].author).toBe('-Diane B.');
    // nested <strong> in the quote is flattened to verbatim text, not dropped
    expect(reviews[0].quote).toContain('This drowns out everything perfect');
  });

  it('de-dupes cloned carousel slides (infinite-scroll renders each review N×)', () => {
    const one = slide({
      category: 'DOGS',
      quote: '"It reduced how often my dog barks at night. A significant decrease."',
      author: '-Jimmy',
    });
    const clone = slide({
      category: 'DOGS',
      quote: '"It reduced how often my dog barks at night. A significant decrease."',
      author: '-Jimmy',
      cloned: true,
    });
    const reviews = extractReviewsFromHtml(`<section>${clone}${one}${clone}</section>`);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].quote).toContain('reduced how often my dog');
  });

  it('returns [] (missing-content fallback) when there are no star-rated quotes', () => {
    // Marketing copy: quote-shaped sentences, product blurbs, hero subheads —
    // but NO star run. These must NOT be mistaken for reviews.
    const html = `<section>
      <h1>Sleep better, wherever summer takes you.</h1>
      <p>Simple, smart products for better nights.</p>
      <p>Independent control of airflow and sound with smart on/off mode.</p>
    </section>`;
    expect(extractReviewsFromHtml(html)).toEqual([]);
  });

  it('ignores a long unquoted sentence even when a star run is nearby', () => {
    // A starred product card whose copy is a long sentence (no quote marks) is
    // a rating, not a testimonial — do not fabricate a "quote" from it.
    const html = `<section>
      <div data-slide-source-index="0" data-is-cloned="false">
        <h5>SNOOZ Pro</h5>
        <div class="r-stars">
          <svg fill="#FF6B12FF"><path d="M3.612 15.443l4.73"></path></svg>
          <svg fill="#FF6B12FF"><path d="M3.612 15.443l4.73"></path></svg>
        </div>
        <p>Perfect white noise from a real fan with adjustable tone and volume.</p>
      </div>
    </section>`;
    expect(extractReviewsFromHtml(html)).toEqual([]);
  });

  it('counts star glyphs (★) and reads a "Verified Buyer" byline', () => {
    const html = `<section>
      <div class="review">
        <p class="stars">★★★★★</p>
        <blockquote>"Best white noise machine we've ever had. Our sleep has never been better."</blockquote>
        <span class="byline">Sam P. — Verified Buyer</span>
      </div>
    </section>`;
    const reviews = extractReviewsFromHtml(html);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].stars).toBe(5);
    expect(reviews[0].quote).toContain("Best white noise machine we've ever had");
    expect(reviews[0].author).toBe('Sam P. — Verified Buyer');
  });

  it('reads star count from an aria-label rating widget', () => {
    const html = `<section>
      <div class="review">
        <div aria-label="4 out of 5 stars"></div>
        <p>"Solid little machine. Works great in our apartment most nights."</p>
        <cite>-Alex</cite>
      </div>
    </section>`;
    const reviews = extractReviewsFromHtml(html);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].stars).toBe(4);
    expect(reviews[0].author).toBe('-Alex');
  });

  it('returns [] for empty / whitespace HTML', () => {
    expect(extractReviewsFromHtml('')).toEqual([]);
    expect(extractReviewsFromHtml('   ')).toEqual([]);
  });
});
