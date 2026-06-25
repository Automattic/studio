// src/lib/replicate/variation-hoist.test.ts
import { describe, it, expect } from 'vitest';
import { applyHoistSwaps, hoistVariations, HOIST_MIN_INSTANCES } from './variation-hoist.js';

const styleA = '{"style":{"color":{"background":"#102030"},"spacing":{"padding":{"top":"24px","bottom":"24px"}}}}';
const groupWith = (attrs: string) =>
  `<!-- wp:group ${attrs} --><div class="wp-block-group"><p>x</p></div><!-- /wp:group -->`;

describe('hoistVariations', () => {
  it('hoists a constellation appearing on >= 3 instances site-wide', () => {
    const pages = [
      { slug: 'a', markup: groupWith(styleA) + groupWith(styleA) },
      { slug: 'b', markup: groupWith(styleA) },
    ];
    const r = hoistVariations(pages);
    expect(r.variations).toHaveLength(1);
    const v = r.variations[0];
    expect(v.slug).toMatch(/^lib-group-/);
    expect(v.blockTypes).toEqual(['core/group']);
    expect(v.styles).toEqual({ color: { background: '#102030' }, spacing: { padding: { top: '24px', bottom: '24px' } } });
    expect(v.count).toBe(3);
    expect(r.pages[0].markup).not.toContain('"background":"#102030"');
    expect(r.pages[0].markup).toContain(`is-style-${v.slug}`);
  });

  it('does NOT hoist below the threshold', () => {
    const pages = [{ slug: 'a', markup: groupWith(styleA) + groupWith(styleA) }];
    const r = hoistVariations(pages);
    expect(r.variations).toHaveLength(0);
    expect(r.pages[0].markup).toBe(pages[0].markup);
  });

  it('constellation key is key-order insensitive', () => {
    const reordered = '{"style":{"spacing":{"padding":{"bottom":"24px","top":"24px"}},"color":{"background":"#102030"}}}';
    const pages = [{ slug: 'a', markup: groupWith(styleA) + groupWith(styleA) + groupWith(reordered) }];
    const r = hoistVariations(pages);
    expect(r.variations).toHaveLength(1);
    expect(r.variations[0].count).toBe(3);
  });

  it('never touches core/html islands, even when their attrs carry a recurring style constellation', () => {
    // The island's `style` attrs recur 3× — above the threshold — alongside 3
    // hoistable groups. The guard must leave every island byte-identical AND
    // create no variation for core/html (a variation would re-render island
    // attrs through createBlock, destroying the verbatim inner HTML).
    const island = `<!-- wp:html {"style":{"color":{"background":"red"}}} --><div style="background:red">raw</div><!-- /wp:html -->`;
    const pages = [
      { slug: 'a', markup: island + island + groupWith(styleA) + groupWith(styleA) },
      { slug: 'b', markup: island + groupWith(styleA) },
    ];
    const r = hoistVariations(pages);
    // Islands byte-identical after hoisting (adjacent pair on page a, one on page b).
    expect(r.pages[0].markup.slice(0, (island + island).length)).toBe(island + island);
    expect(r.pages[1].markup.slice(0, island.length)).toBe(island);
    // The groups still hoisted; NO variation created for core/html.
    expect(r.variations).toHaveLength(1);
    expect(r.variations[0].blockTypes).toEqual(['core/group']);
    expect(r.pages[0].markup).toContain('is-style-lib-group-');
  });

  it('never touches jetpack/* blocks — an unknown is-style-* on the contact form silently changes Jetpack rendering', () => {
    // The wrapper's style.spacing constellation recurs 3× across the page set
    // (one form per contact page is exactly how this happens in the wild).
    // Hoisting would add is-style-lib-* to the jetpack/contact-form block, and
    // Jetpack's get_form_style() regexes `is-style-(\S+)` off that className —
    // an unknown style makes render_label() return '' and every field label
    // vanishes. The guard must leave the form byte-identical and mint no
    // variation, while core blocks alongside still hoist.
    const formAttrs = '{"style":{"spacing":{"padding":{"top":"16px","right":"16px","bottom":"16px","left":"16px"}}}}';
    const jpForm =
      `<!-- wp:jetpack/contact-form ${formAttrs} --><div class="wp-block-jetpack-contact-form">` +
      `<!-- wp:jetpack/field-email {"label":"Email","style":{"spacing":{"padding":{"top":"16px","right":"16px","bottom":"16px","left":"16px"}}}} /-->` +
      `</div><!-- /wp:jetpack/contact-form -->`;
    const pages = [
      { slug: 'a', markup: jpForm + groupWith(styleA) + groupWith(styleA) },
      { slug: 'b', markup: jpForm + groupWith(styleA) },
      { slug: 'c', markup: jpForm },
    ];
    const r = hoistVariations(pages);
    // Every jetpack block byte-identical; no jetpack variation minted.
    for (const p of r.pages) expect(p.markup.slice(0, jpForm.length)).toBe(jpForm);
    expect(r.variations).toHaveLength(1);
    expect(r.variations[0].blockTypes).toEqual(['core/group']);
    // The core groups alongside still hoisted.
    expect(r.pages[0].markup).toContain('is-style-lib-group-');
  });

  it('applyHoistSwaps never touches jetpack/* blocks either (shared scan guard)', () => {
    const pages = [{ slug: 'a', markup: groupWith(styleA) + groupWith(styleA) + groupWith(styleA) }];
    const { variations } = hoistVariations(pages);
    // A jetpack block whose style EXACTLY matches the decided core/group
    // constellation must still not be swapped (blockName is part of the match,
    // and the scan skips jetpack/* entirely).
    const jpWithSameStyle = `<!-- wp:jetpack/contact-form ${styleA} --><div class="wp-block-jetpack-contact-form"></div><!-- /wp:jetpack/contact-form -->`;
    const out = applyHoistSwaps(jpWithSameStyle + groupWith(styleA), variations);
    expect(out.slice(0, jpWithSameStyle.length)).toBe(jpWithSameStyle);
    expect(out).toContain(`is-style-${variations[0].slug}`); // the group still swapped
  });

  it('appends to an existing className instead of replacing it', () => {
    const withClass = `<!-- wp:group {"className":"alignwide","style":{"color":{"background":"#102030"},"spacing":{"padding":{"top":"24px","bottom":"24px"}}}} --><div class="wp-block-group"><p>x</p></div><!-- /wp:group -->`;
    const pages = [{ slug: 'a', markup: withClass + groupWith(styleA) + groupWith(styleA) }];
    const r = hoistVariations(pages);
    expect(r.pages[0].markup).toContain('"className":"alignwide is-style-lib-');
  });

  it('different constellations on the same block type get distinct suffixed slugs', () => {
    const styleB = '{"style":{"color":{"background":"#aabbcc"},"spacing":{"padding":{"top":"8px","bottom":"8px"}}}}';
    const pages = [{ slug: 'a', markup: [styleA, styleA, styleA, styleB, styleB, styleB].map(groupWith).join('') }];
    const r = hoistVariations(pages);
    expect(r.variations).toHaveLength(2);
    const slugs = r.variations.map(v => v.slug).sort();
    expect(new Set(slugs).size).toBe(2);
    expect(slugs[1]).toMatch(/-2$/);
  });

  it('fail-open: malformed attr JSON leaves the block untouched', () => {
    const broken = `<!-- wp:group {"style":{...invalid} --><div></div><!-- /wp:group -->`;
    const pages = [{ slug: 'a', markup: broken + groupWith(styleA) }];
    const r = hoistVariations(pages);
    expect(r.pages[0].markup).toContain(broken);
  });

  it('respects opts.minInstances', () => {
    const pages = [{ slug: 'a', markup: groupWith(styleA) + groupWith(styleA) }];
    const r = hoistVariations(pages, { minInstances: 2 });
    expect(r.variations).toHaveLength(1);
    expect(HOIST_MIN_INSTANCES).toBe(3);
  });
});

describe('applyHoistSwaps', () => {
  it('re-applies ONLY already-decided swaps to a sibling markup copy (pattern file)', () => {
    const pages = [
      { slug: 'a', markup: groupWith(styleA) + groupWith(styleA) },
      { slug: 'b', markup: groupWith(styleA) },
    ];
    const { variations } = hoistVariations(pages);
    expect(variations).toHaveLength(1);
    // The pattern-file copy: a PHP header + the same pre-hoist markup, plus a
    // styled block whose constellation was NOT decided (below threshold).
    const undecided = '{"style":{"color":{"background":"#fedcba"}}}';
    const patternBody = `<?php\n/**\n * Title: A\n */\n?>\n` + groupWith(styleA) + groupWith(undecided);
    const out = applyHoistSwaps(patternBody, variations);
    expect(out).toContain(`is-style-${variations[0].slug}`);
    expect(out).not.toContain('"background":"#102030"');
    // Undecided constellation untouched — no re-counting, no new variations.
    expect(out).toContain(undecided);
  });

  it('returns the markup unchanged when no variations were decided', () => {
    const markup = groupWith(styleA);
    expect(applyHoistSwaps(markup, [])).toBe(markup);
  });

  it('matches constellations key-order insensitively', () => {
    const pages = [{ slug: 'a', markup: groupWith(styleA) + groupWith(styleA) + groupWith(styleA) }];
    const { variations } = hoistVariations(pages);
    const reordered = '{"style":{"spacing":{"padding":{"bottom":"24px","top":"24px"}},"color":{"background":"#102030"}}}';
    const out = applyHoistSwaps(groupWith(reordered), variations);
    expect(out).toContain(`is-style-${variations[0].slug}`);
  });
});
