// src/lib/replicate/block-contract.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBlockContract } from './block-contract.js';

describe('validateBlockContract', () => {
  it('flags an invented core block as unknown-block', () => {
    const markup = `<!-- wp:fancy-hero {"glow":true} -->
<div class="wp-block-fancy-hero">x</div>
<!-- /wp:fancy-hero -->`;
    const issues = validateBlockContract(markup);
    expect(issues).toEqual([
      { code: 'unknown-block', blockName: 'core/fancy-hero', detail: 'not a registered core block' },
    ]);
  });

  it('flags an invented attr on a real block, naming block + attr', () => {
    const markup = `<!-- wp:paragraph {"glow":true,"content":"hi"} -->
<p>hi</p>
<!-- /wp:paragraph -->`;
    const issues = validateBlockContract(markup);
    expect(issues).toEqual([
      { code: 'unknown-attr', blockName: 'core/paragraph', detail: 'attr "glow" not in registered metadata' },
    ]);
  });

  it('flags a core/group tagName outside the WP allowlist', () => {
    const markup = `<!-- wp:group {"tagName":"span"} -->
<span class="wp-block-group">x</span>
<!-- /wp:group -->`;
    const issues = validateBlockContract(markup);
    expect(issues).toEqual([
      { code: 'invalid-tagname', blockName: 'core/group', detail: 'tagName "span" not in [div, header, main, section, article, aside, footer]' },
    ]);
  });

  it('allowlisted dla/* and core/html pass untouched', () => {
    const markup = `<!-- wp:dla/reveal {"madeUp":1} -->
<section data-wp-interactive="dla/reveal">x</section>
<!-- /wp:dla/reveal -->
<!-- wp:html -->
<div onclickish="weird">island</div>
<!-- /wp:html -->`;
    expect(validateBlockContract(markup)).toEqual([]);
  });

  it('clean markup returns no issues', () => {
    const markup = `<!-- wp:group {"tagName":"section","anchor":"hero"} -->
<section id="hero" class="wp-block-group"><!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">T</h3>
<!-- /wp:heading --></section>
<!-- /wp:group -->`;
    expect(validateBlockContract(markup)).toEqual([]);
  });

  it('non-core namespaces are skipped (trust-source posture)', () => {
    const markup = `<!-- wp:acme/widget {"anything":"goes"} -->
<div class="acme-widget">x</div>
<!-- /wp:acme/widget -->`;
    expect(validateBlockContract(markup)).toEqual([]);
  });

  it('walks innerBlocks (nested invented attr still caught)', () => {
    const markup = `<!-- wp:group {"tagName":"section"} -->
<section class="wp-block-group"><!-- wp:paragraph {"sparkle":"yes"} -->
<p>x</p>
<!-- /wp:paragraph --></section>
<!-- /wp:group -->`;
    const issues = validateBlockContract(markup);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unknown-attr', blockName: 'core/paragraph' });
    expect(issues[0].detail).toContain('sparkle');
  });

  it('never throws on unparseable attr JSON (the roundtrip oracle owns that failure)', () => {
    const markup = `<!-- wp:paragraph {"broken": -->
<p>x</p>
<!-- /wp:paragraph -->`;
    expect(() => validateBlockContract(markup)).not.toThrow();
  });
});

describe('core-block-attrs.json snapshot shape', () => {
  it('exists, parses, and carries the contract essentials', () => {
    const snapshot = JSON.parse(
      readFileSync(new URL('./core-block-attrs.json', import.meta.url), 'utf8'),
    ) as { __generated: string; groupTagNames: string[]; blocks: Record<string, string[]> };
    expect(snapshot.__generated).toContain('generate-block-attrs-snapshot');
    expect(snapshot.groupTagNames).toEqual(['div', 'header', 'main', 'section', 'article', 'aside', 'footer']);
    expect(Object.keys(snapshot.blocks).length).toBeGreaterThan(50);
    expect(snapshot.blocks['core/paragraph']).toContain('content');
    expect(snapshot.blocks['core/group']).toContain('tagName');
  });
});
