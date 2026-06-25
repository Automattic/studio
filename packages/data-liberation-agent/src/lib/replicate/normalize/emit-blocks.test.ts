// src/lib/replicate/normalize/emit-blocks.test.ts
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { emitSectionBlocks, escapeHtml } from './emit-blocks.js';
import { InstanceStyleSheet } from './instance-styles.js';
import { blockMarkupRoundtrips } from '../../streaming/block-markup-validate.js';

describe('escapeHtml', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(escapeHtml('<script>a & b</script>')).toBe('&lt;script&gt;a &amp; b&lt;/script&gt;');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('a"b')).toBe('a&quot;b');
  });
});

describe('emitSectionBlocks', () => {
  it('emits a group of core blocks that round-trips', () => {
    const section = {
      id: 'hero',
      role: 'body' as const,
      html: '<section><h1>Welcome</h1><p>Hello there</p><a class="button" href="/x.html">Go</a></section>',
    };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('<!-- wp:heading');
    expect(markup).toContain('<h1 class="wp-block-heading">Welcome</h1>');
    expect(markup).toContain('<!-- wp:paragraph');
    expect(markup).toContain('<!-- wp:buttons');
    expect(confidence).toBe(1);
  });

  it('does not inject raw script tags from text content', () => {
    // cheerio .text() on <p><script>x</script></p> returns "x" (strips tags).
    // So no <script> tag survives into output, and escapeHtml has nothing to
    // escape — the paragraph renders as <p>x</p>.
    // DEVIATION from plan: plan asserted toContain('&lt;script&gt;') but
    // cheerio strips the script element, returning only its text child "x".
    // Correct intent: raw <script>x</script> never appears in the markup.
    const section = { id: 's', role: 'body' as const, html: '<section><p><script>x</script></p></section>' };
    const { markup } = emitSectionBlocks(section);
    expect(markup).not.toContain('<script>x</script>');
    expect(markup).toContain('<p>x</p>');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('carries per-instance heading/paragraph inline style as a lib-i class + rule (fixer-safe)', () => {
    // The source authors per-heading size/margin inline (h1.display class is a
    // big default, overridden per instance) — dropping it makes every heading
    // fall back to the class default and reflow (maison h1.display 104 vs 136).
    // The fixer strips inline style= from core blocks, so the style is carried
    // as a lib-i<hash> class + a stylesheet rule instead (editor-valid).
    const sheet = new InstanceStyleSheet();
    const section = {
      id: 'hero',
      role: 'body' as const,
      html:
        '<section><h1 class="display" style="margin:20px 0 0;font-size:clamp(3rem,9vw,6.5rem)">Scent</h1>' +
        '<p class="lead" style="max-width:46ch">Made to order.</p></section>',
    };
    const { markup } = emitSectionBlocks(section, { instanceStyles: sheet });
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    // No inline style attr survives on the elements.
    expect(markup).not.toContain('style="margin');
    expect(markup).not.toContain('style="max-width');
    // The heading carries source class + a lib-i class; the rule holds the decls.
    expect(markup).toMatch(/<h1 class="wp-block-heading display lib-i[0-9a-f]{10}">/);
    expect(markup).toMatch(/<p class="lead lib-i[0-9a-f]{10}">/);
    expect(sheet.toCss()).toContain('margin:20px 0 0;font-size:clamp(3rem,9vw,6.5rem)');
    expect(sheet.toCss()).toContain('max-width:46ch');
  });

  it('preserves inline span class hooks in heading rich text (source styling)', () => {
    // The source styles inline runs via span classes (.it = italic display
    // face); unwrapping them to bare text drops the styling.
    const section = { id: 'h', role: 'body' as const, html: '<section><h1>Scent, <span class="it">poured by hand.</span></h1></section>' };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('<span class="it">poured by hand.</span>');
  });

  it('emits an inline-only wrapper (kicker) as inline content — no inner paragraph, span classes kept', () => {
    // <span class="kicker"><span class="num">01</span> Made</span>: recursing
    // turned the inner span into a classless block <p>01</p> (lost .num color +
    // added UA paragraph margin → vertical reflow). Inline content must survive.
    const section = {
      id: 'k',
      role: 'body' as const,
      html: '<section><div><span class="kicker"><span class="num">01</span> Made here</span><h1>T</h1></div></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('class="wp-block-group kicker"');
    // The inline body rides a core/html inner block (fixer-safe — a core/group
    // strips raw inline content; core/html preserves it and renders inline).
    expect(markup).toContain('<!-- wp:html -->');
    expect(markup).toContain('<span class="num">01</span>');
    // The kicker body is inline — no paragraph block wrapping "01".
    expect(markup).not.toContain('<p>01</p>');
  });

  it('does NOT inline-collapse a wrapper whose inline child contains block descendants (card link)', () => {
    // A block-level <a> wrapping divs (a card link) is inline-tagged but
    // structurally block — collapsing it to inline destroys the inner divs
    // (the .ph image placeholder). It must recurse and keep the structure.
    const section = {
      id: 'card',
      role: 'body' as const,
      html: '<section><div class="wrap"><a href="/x/"><div class="ph ph--t2"><span class="ph__tag">cap</span></div><div><h3>Title</h3></div></a></div></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    // The .ph placeholder div survives (not flattened to its inner span).
    expect(markup).toContain('class="wp-block-group ph ph--t2"');
    expect(markup).toContain('<!-- wp:heading');
  });

  it('flags confidence < 1 when a child loses content (loose text beside elements is dropped)', () => {
    // A wrapper mixing element children with stray loose text drops that text
    // (only a childless wrapper emits its loose text) — a genuine loss the
    // confidence signal surfaces. (A styling-bearing leaf is now preserved
    // losslessly and no longer lowers confidence — see the nested-leaf suite.)
    const section = { id: 's', role: 'body' as const, html: '<section><div><h3>Kept</h3> dropped stray text</div></section>' };
    const { confidence } = emitSectionBlocks(section);
    expect(confidence).toBeLessThan(1);
  });

  it('emits core/image for a bare img child with escaped attributes', () => {
    const section = { id: 's', role: 'body' as const, html: '<section><img src="x.png" alt="A & B"></section>' };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(markup).toContain('<!-- wp:image');
    expect(markup).toContain('src="x.png"');
    expect(markup).toContain('alt="A &amp; B"');
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('prevents attribute breakout when src contains a double quote', () => {
    // Single-quoted source attr smuggles a double quote into the value.
    const section = {
      id: 's',
      role: 'body' as const,
      html: `<section><img src='x" onerror="alert(1)' alt=""></section>`,
    };
    const { markup } = emitSectionBlocks(section);
    expect(markup).toContain('&quot;');
    expect(markup).not.toContain('" onerror="');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('converts a figure (img + figcaption) without loss: image block + preserved caption', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><figure><img src="pic.png"/><figcaption>Cap text</figcaption></figure></section>',
    };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(markup).toContain('<!-- wp:image');
    expect(markup).toContain('pic.png');
    // figcaption is element-targeted CSS (.gallery figcaption{}) — kept verbatim,
    // not flattened to a class-less <p>, so the figure converts losslessly.
    expect(markup).toContain('<figcaption>Cap text</figcaption>');
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('preserves inline links and emphasis in paragraphs', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><p>Contact <a href="/contact.html">us</a> <strong>now</strong></p></section>',
    };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(markup).toContain('<a href="/contact.html">us</a>');
    expect(markup).toContain('<strong>now</strong>');
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('unwraps non-allowlisted inline wrappers, preserving nested links', () => {
    // A non-allowlisted inline tag (here <u>) is transparently unwrapped so its
    // nested link survives. (A classless <span> is now KEPT, not unwrapped — it
    // anchors contextual `.parent span` CSS; see the nested-leaf suite.)
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><p>Visit <u><a href="/shop.html">the shop</a></u> today</p></section>',
    };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(markup).toContain('Visit <a href="/shop.html">the shop</a> today');
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('uses <main> as the container root (segmentPage main-fallback sections)', () => {
    const section = { id: 'm', role: 'body' as const, html: '<main><h1>T</h1><p>Body</p></main>' };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(markup).toContain('<!-- wp:heading');
    expect(markup).toContain('<h1 class="wp-block-heading">T</h1>');
    expect(markup).toContain('<p>Body</p>');
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('emits list shapes for ul and ol', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol></section>',
    };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(markup).toContain('<!-- wp:list -->');
    expect(markup).toContain('<!-- wp:list {"ordered":true} -->');
    expect(markup).toContain('<ul class="wp-block-list">');
    expect(markup).toContain('<ol class="wp-block-list">');
    expect((markup.match(/<!-- wp:list-item -->/g) ?? []).length).toBe(3);
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('emits nested lists inside the parent list item without flattening links', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      html:
        '<section><ul><li>Subjects<ul><li><a href="/community.html">Community</a></li><li><a href="/guides.html">Guides</a></li></ul></li></ul></section>',
    };

    const { markup, confidence } = emitSectionBlocks(section);
    const parentLabelIndex = markup.indexOf('<li>Subjects');
    const nestedListIndex = markup.indexOf('<!-- wp:list -->', parentLabelIndex + 1);
    const nestedListCloseIndex = markup.indexOf('<!-- /wp:list -->', nestedListIndex);
    const parentItemCloseIndex = markup.indexOf('<!-- /wp:list-item -->', nestedListCloseIndex);

    expect(parentLabelIndex).toBeGreaterThanOrEqual(0);
    expect(nestedListIndex).toBeGreaterThan(parentLabelIndex);
    expect(parentItemCloseIndex).toBeGreaterThan(nestedListIndex);
    expect((markup.match(/<!-- wp:list -->/g) ?? []).length).toBe(2);
    expect((markup.match(/<!-- wp:list-item -->/g) ?? []).length).toBe(3);
    expect(markup).toContain('<a href="/community.html">Community</a>');
    expect(markup).toContain('<a href="/guides.html">Guides</a>');
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('keeps a dropdown button label while preserving its nested submenu list', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      html:
        '<section><ul><li><button>Subjects<svg><title>Open submenu</title></svg></button><ul><li><a href="/community.html">Community</a></li></ul></li></ul></section>',
    };

    const { markup, confidence } = emitSectionBlocks(section);
    const parentLabelIndex = markup.indexOf('<li>Subjects');
    const nestedListIndex = markup.indexOf('<!-- wp:list -->', parentLabelIndex + 1);
    const nestedListCloseIndex = markup.indexOf('<!-- /wp:list -->', nestedListIndex);
    const parentItemCloseIndex = markup.indexOf('<!-- /wp:list-item -->', nestedListCloseIndex);

    expect(parentLabelIndex).toBeGreaterThanOrEqual(0);
    expect(nestedListIndex).toBeGreaterThan(parentLabelIndex);
    expect(parentItemCloseIndex).toBeGreaterThan(nestedListIndex);
    expect(markup).toContain('<a href="/community.html">Community</a>');
    expect(markup).not.toContain('Open submenu');
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('keeps flat list emission unchanged when no nested list exists', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><ul><li>One</li><li><a href="/two.html">Two</a></li></ul></section>',
    };

    const { markup, confidence } = emitSectionBlocks(section);

    expect(markup).toBe(
      '<!-- wp:group {"anchor":"s","tagName":"section"} -->\n' +
        '<section id="s" class="wp-block-group"><!-- wp:list -->\n' +
        '<ul class="wp-block-list"><!-- wp:list-item -->\n' +
        '<li>One</li>\n' +
        '<!-- /wp:list-item -->\n' +
        '<!-- wp:list-item -->\n' +
        '<li><a href="/two.html">Two</a></li>\n' +
        '<!-- /wp:list-item --></ul>\n' +
        '<!-- /wp:list --></section>\n' +
        '<!-- /wp:group -->',
    );
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('emits level attr for non-h2 headings only', () => {
    const section = { id: 's', role: 'body' as const, html: '<section><h3>Three</h3><h2>Two</h2></section>' };
    const { markup } = emitSectionBlocks(section);
    expect(markup).toContain('<!-- wp:heading {"level":3} -->');
    expect(markup).toContain('<!-- wp:heading -->');
    expect(markup).toContain('<h3 class="wp-block-heading">Three</h3>');
    expect(markup).toContain('<h2 class="wp-block-heading">Two</h2>');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('preserves loose text nodes at the section root as paragraphs', () => {
    const section = { id: 's', role: 'body' as const, html: '<section>Hello<p>x</p></section>' };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(markup).toContain('<p>Hello</p>');
    expect(markup).toContain('<p>x</p>');
    expect((markup.match(/<!-- wp:paragraph -->/g) ?? []).length).toBe(2);
    expect(confidence).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('preserves section id and classes on the group wrapper', () => {
    const section = {
      id: 'hero',
      role: 'body' as const,
      classes: ['hero', 'splash'],
      html: '<section id="hero" class="hero splash"><h1>Welcome</h1></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('"className":"hero splash"');
    expect(markup).toContain('"anchor":"hero"');
    expect(markup).toContain('class="wp-block-group hero splash"');
    expect(markup).toContain('id="hero"');
  });

  it('preserves child element classes on emitted blocks', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      classes: [],
      html: '<section><h2 class="section-title">T</h2><p class="lede">x</p><img class="pic" src="a.png" alt=""/><ul class="list-x"><li>i</li></ul><a class="button cta" href="/x/">Go</a></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('"className":"section-title"');
    expect(markup).toContain('class="wp-block-heading section-title"');
    expect(markup).toContain('"className":"lede"');
    expect(markup).toContain('"className":"pic"');
    expect(markup).toContain('"className":"list-x"');
    expect(markup).toContain('"className":"button cta lib-cta"'); // wrapper attr + lib-cta marker
    // Source classes ride the INNER anchor too for the pre-fixer sidecar; WP's
    // own classes stay first (serializer shape). Canonicalization later drops
    // the anchor's source class — the surviving styling is the wrapper className
    // above + the lib-cta-scoped inner-anchor reset in WP_COMPAT_CSS.
    expect(markup).toContain('class="wp-block-button__link wp-element-button button cta" href');
  });

  it('emits a native button when a button-anchor is the lone child of a wrapper div', () => {
    // Source wraps each CTA alone in a container (.ticket-footer > a.btn). The
    // wrapper's only child is inline-safe, which short-circuited the whole inner
    // into a verbatim core/html island — bypassing the button converter. A
    // wrapper whose element children are ALL button-anchors must recurse so each
    // anchor reaches the core/button emitter.
    const section = {
      id: 's',
      role: 'body' as const,
      classes: [],
      html: '<section><div class="ticket-footer"><a href="#register" class="btn btn-forest">Register</a></div></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    // The wrapper survives as a group carrying its source class.
    expect(markup).toContain('class="wp-block-group ticket-footer"');
    // The CTA is a native button, not a frozen verbatim html island.
    expect(markup).toContain('<!-- wp:button');
    expect(markup).toContain('class="wp-block-button__link wp-element-button btn btn-forest" href="#register"');
    expect(markup).not.toMatch(/<!-- wp:html -->\s*<a [^>]*class="btn/);
    // The source class + lib-cta marker ride the className ATTRIBUTE so they
    // survive canonicalization on the .wp-block-button wrapper (the fixer keeps
    // className there); lib-cta scopes the WP_COMPAT inner-anchor reset.
    expect(markup).toContain('"className":"btn btn-forest lib-cta"');
    expect(markup).toContain('<div class="wp-block-button btn btn-forest lib-cta">');
  });

  it('emits native buttons for a wrapper holding multiple button-anchors', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      classes: [],
      html: '<section><div class="cta-row"><a class="btn" href="/a/">A</a><a class="btn" href="/b/">B</a></div></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup.match(/<!-- wp:button /g)?.length).toBe(2);
    expect(markup).not.toContain('<!-- wp:html -->');
  });

  it('escapes double quotes in class attrs landing in HTML', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      classes: [],
      html: `<section><p class='a"b'>x</p></section>`,
    };
    const { markup } = emitSectionBlocks(section);
    expect(markup).toContain('class="a&quot;b"');
    expect(markup).not.toContain('class="a"b"');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('keeps class on allowed inline tags', () => {
    const section = {
      id: 's', role: 'body' as const, classes: [],
      html: '<section><p>see <a class="inline-link" href="/a/">it</a> <strong class="hot">now</strong></p></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(markup).toContain('<a class="inline-link" href="/a/">it</a>');
    expect(markup).toContain('<strong class="hot">now</strong>');
  });

  it('escapes -- in class names for block-comment safety', () => {
    const section = { id: 's', role: 'body' as const, classes: ['mod--wide'], html: '<section class="mod--wide"><p>x</p></section>' };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('\\u002d\\u002d');           // attr JSON escaped
    expect(markup).toContain('class="wp-block-group mod--wide"'); // literal in HTML (safe outside comments)
  });
});

it('emits the section wrapper as a semantic <section> with tagName attr (carry parity)', () => {
  const section = { id: 'hero', role: 'body' as const, classes: ['hero'], html: '<section id="hero" class="hero"><h1>Hi</h1></section>' };
  const { markup } = emitSectionBlocks(section);
  expect(markup).toContain('"tagName":"section"');
  expect(markup).toContain('<section id="hero" class="wp-block-group hero">');
  expect(markup).toContain('</section>');
  expect(blockMarkupRoundtrips(markup).ok).toBe(true);
});

it('emits source tables as core/table preserving rows, header, and class', () => {
  const section = {
    id: 'prices', role: 'body' as const, classes: [],
    html: '<section><table class="price-table"><tr><th>Service</th><th>Price</th></tr><tr><td>Quick Splash</td><td>45 clams</td></tr><tr><td>Glacier Glow</td><td>150 clams</td></tr></table></section>',
  };
  const { markup, confidence } = emitSectionBlocks(section);
  expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  expect(markup).toContain('<!-- wp:table');
  expect(markup).toContain('"className":"price-table"');
  expect(markup).toContain('<thead><tr><th>Service</th><th>Price</th></tr></thead>');
  expect(markup).toContain('<td>Quick Splash</td><td>45 clams</td>');
  expect(markup).toContain('<td>Glacier Glow</td>');
  expect(markup).toContain('<figure class="price-table"><table>'); // classless of wp-block-table: block-library td/th rules would out-rank source element rules
  expect(confidence).toBe(1); // native mapping, no downgrade
});

describe('reveal wrapper swap', () => {
  const section = {
    id: 'story',
    role: 'body' as const,
    html: '<section id="story" class="intro"><h2>Tale</h2><p>Once.</p></section>',
    classes: ['intro'],
    behavior: { kind: 'reveal' as const, threshold: 0.25, translateY: '24px', durationMs: 450 },
  };

  it('emits dla/reveal wrapper with context directives + inline animation vars', () => {
    const { markup, confidence } = emitSectionBlocks(section);
    expect(confidence).toBe(1);
    // Comment delimiter: custom block, attrJson-escaped attributes.
    expect(markup).toMatch(/^<!-- wp:dla\/reveal \{/);
    expect(markup).toContain('"threshold":0.25');
    expect(markup).toContain('"anchor":"story"');
    expect(markup).toContain('"className":"intro"');
    // Wrapper element: same semantic <section>, source identity preserved,
    // block class + directives + per-site animation custom properties.
    expect(markup).toContain('<section id="story"');
    expect(markup).toContain('class="wp-block-dla-reveal intro"');
    expect(markup).toContain('data-wp-interactive="dla/reveal"');
    expect(markup).toContain('data-wp-init="callbacks.init"');
    expect(markup).toContain('data-wp-class--is-visible="context.visible"');
    expect(markup).toContain('style="--dla-reveal-y:24px;--dla-reveal-ms:450ms"');
    // data-wp-context JSON must ride attrJson escaping (kses -- trap).
    expect(markup).toContain('data-wp-context=');
    expect(markup).toContain('"threshold":0.25');
    // Children unchanged.
    expect(markup).toContain('<h2 class="wp-block-heading">Tale</h2>');
    expect(markup).toMatch(/<!-- \/wp:dla\/reveal -->$/);
  });

  it('untagged section still emits core/group (regression)', () => {
    const { markup } = emitSectionBlocks({ ...section, behavior: undefined });
    expect(markup).toMatch(/^<!-- wp:group \{/);
    expect(markup).not.toContain('dla/reveal');
  });

  it('reveal markup round-trips through the block balance gate', () => {
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });
});

describe('verbatim behavior wrappers (tabs/slider/modal)', () => {
  const TABS_HTML =
    '<section id="plans" class="pricing"><div role="tablist">' +
    '<button role="tab" aria-selected="true" aria-controls="p-a" class="tab is-active">A</button>' +
    '<button role="tab" aria-selected="false" aria-controls="p-b" class="tab">B</button></div>' +
    '<div role="tabpanel" id="p-a"><p>Alpha</p></div>' +
    '<div role="tabpanel" id="p-b" hidden><p>Beta</p></div></section>';
  const tabsSection = {
    id: 'plans',
    role: 'body' as const,
    classes: ['pricing'],
    html: TABS_HTML,
    behavior: { kind: 'tabs' as const, activeClass: 'is-active' },
  };

  it('tabs: custom wrapper with root directives and VERBATIM inner (no conversion)', () => {
    const { markup, confidence } = emitSectionBlocks(tabsSection);
    expect(confidence).toBe(1);
    expect(markup).toMatch(/^<!-- wp:dla\/tabs \{/);
    expect(markup).toContain('"anchor":"plans"');
    expect(markup).toContain('"activeClass":"is-active"');
    expect(markup).toContain('"className":"pricing"');
    expect(markup).toContain(
      `<section id="plans" class="wp-block-dla-tabs pricing" data-wp-interactive="dla/tabs" data-wp-context='{"activeClass":"is-active"}' data-wp-init="callbacks.init">`,
    );
    // Inner is BYTE-EQUAL to the source section's inner (cheerio-normalized) —
    // the emitChild conversion pipeline is skipped entirely.
    const expectedInner = cheerio.load(TABS_HTML)('section').first().html() ?? '';
    expect(expectedInner.length).toBeGreaterThan(0);
    const m = /data-wp-init="callbacks\.init">([\s\S]*)<\/section>\n<!-- \/wp:dla\/tabs -->$/.exec(markup);
    expect(m?.[1]).toBe(expectedInner);
    expect(markup).toContain('role="tab"');
    expect(markup).not.toContain('wp:heading');
    expect(markup).not.toContain('wp:paragraph');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('strips block-delimiter-shaped inner comments, keeps plain ones (fail-closed insurance)', () => {
    const html =
      '<section id="notes"><p>before</p><!-- wp:fake --><!-- /wp:fake --><!-- note --><p>after</p></section>';
    const section = {
      id: 'notes',
      role: 'body' as const,
      classes: [],
      html,
      behavior: { kind: 'tabs' as const, activeClass: 'is-active' },
    };
    const { markup } = emitSectionBlocks(section);
    expect(markup).not.toContain('wp:fake');
    expect(markup).toContain('<!-- note -->');
    expect(markup).toContain('<p>before</p>');
    expect(markup).toContain('<p>after</p>');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  const SLIDER_HTML =
    '<section id="quotes"><div class="track">' +
    '<figure class="slide is-current"><blockquote>One</blockquote></figure>' +
    '<figure class="slide"><blockquote>Two</blockquote></figure></div>' +
    '<button class="prev">Prev</button><button class="next">Next</button></section>';

  it('slider: context carries intervalMs only when autoplay was detected', () => {
    const base = { id: 'quotes', role: 'body' as const, classes: [], html: SLIDER_HTML };
    const auto = emitSectionBlocks({
      ...base,
      behavior: { kind: 'slider' as const, activeClass: 'is-current', intervalMs: 6000 },
    }).markup;
    expect(auto).toMatch(/^<!-- wp:dla\/slider \{/);
    expect(auto).toContain(`data-wp-context='{"activeClass":"is-current","intervalMs":6000}'`);
    expect(auto).toContain('"intervalMs":6000'); // comment attrs too
    expect(auto).toContain('class="wp-block-dla-slider"');
    expect(auto).toContain('<figure class="slide is-current">'); // verbatim slides
    expect(blockMarkupRoundtrips(auto).ok).toBe(true);
    const manual = emitSectionBlocks({
      ...base,
      behavior: { kind: 'slider' as const, activeClass: 'is-current' },
    }).markup;
    expect(manual).toContain(`data-wp-context='{"activeClass":"is-current"}'`);
    expect(manual).not.toContain('intervalMs');
  });

  const MODAL_HTML =
    '<section id="book"><button class="open-details">Details</button>' +
    '<dialog aria-modal="true"><p>Info</p><button class="close">Close</button></dialog></section>';

  it('modal: empty context emits NO data-wp-context attribute at all (locked)', () => {
    const section = {
      id: 'book',
      role: 'body' as const,
      classes: [],
      html: MODAL_HTML,
      behavior: { kind: 'modal' as const },
    };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(confidence).toBe(1);
    expect(markup).toMatch(/^<!-- wp:dla\/modal \{"anchor":"book"\} -->/);
    expect(markup).toContain(
      '<section id="book" class="wp-block-dla-modal" data-wp-interactive="dla/modal" data-wp-init="callbacks.init">',
    );
    expect(markup).not.toContain('data-wp-context');
    expect(markup).toContain('<dialog aria-modal="true">');
    expect(markup).toContain('</dialog>');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('untagged section with the same markup still emits core/group (regression)', () => {
    const plain = emitSectionBlocks({ id: 'plans', role: 'body' as const, classes: ['pricing'], html: TABS_HTML });
    expect(plain.markup).toMatch(/^<!-- wp:group \{/);
    expect(plain.markup).not.toContain('dla/');
  });
});

describe('verbatim behavior sections on the carry path (behaviorWrapper: group)', () => {
  const TABS_HTML =
    '<section id="plans" class="pricing"><div role="tablist">' +
    '<button role="tab" aria-selected="true" aria-controls="p-a" class="tab is-active">A</button>' +
    '<button role="tab" aria-selected="false" aria-controls="p-b" class="tab">B</button></div>' +
    '<div role="tabpanel" id="p-a"><p>Alpha</p></div>' +
    '<div role="tabpanel" id="p-b" hidden><p>Beta</p></div></section>';
  const tabsSection = {
    id: 'plans',
    role: 'body' as const,
    classes: ['pricing'],
    html: TABS_HTML,
    behavior: { kind: 'tabs' as const, activeClass: 'is-active' },
  };

  it('carry mode: plain group wrapper, VERBATIM inner, no directives, no plugin dependency', () => {
    const { markup, confidence } = emitSectionBlocks(tabsSection, { behaviorWrapper: 'group' });
    expect(confidence).toBe(1);
    expect(markup).toMatch(/^<!-- wp:group \{/);
    expect(markup).toContain('"anchor":"plans"');
    expect(markup).toContain('"tagName":"section"');
    expect(markup).toContain('"className":"pricing"');
    expect(markup).toContain('<section id="plans" class="wp-block-group pricing">');
    // Interactive scaffolding survives byte-true inside a core/html inner block
    // (fixer-safe — a bare core/group would strip the raw scaffolding) — the
    // carried source JS drives this intact DOM (the emitChild path destroyed it:
    // E2E unresolved missing #tab-*/#panel-* structural divergences).
    const expectedInner = cheerio.load(TABS_HTML)('section').first().html() ?? '';
    const m = /class="wp-block-group pricing">\n<!-- wp:html -->\n([\s\S]*)\n<!-- \/wp:html -->\n<\/section>\n<!-- \/wp:group -->$/.exec(
      markup,
    );
    expect(m?.[1]).toBe(expectedInner);
    expect(markup).toContain('role="tab"');
    expect(markup).not.toContain('data-wp-interactive');
    expect(markup).not.toContain('dla/');
    expect(markup).not.toContain('wp:heading');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('carry mode still strips block-delimiter-shaped inner comments', () => {
    const section = {
      id: 'notes',
      role: 'body' as const,
      classes: [],
      html: '<section id="notes"><p>before</p><!-- wp:fake --><!-- /wp:fake --><!-- note --><p>after</p></section>',
      behavior: { kind: 'tabs' as const, activeClass: 'is-active' },
    };
    const { markup } = emitSectionBlocks(section, { behaviorWrapper: 'group' });
    expect(markup).not.toContain('wp:fake');
    expect(markup).toContain('<!-- note -->');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('default mode stays dla (regression)', () => {
    const { markup } = emitSectionBlocks(tabsSection);
    expect(markup).toMatch(/^<!-- wp:dla\/tabs \{/);
    expect(markup).toContain('data-wp-interactive="dla/tabs"');
  });
});

describe('id-preserving unknown wrappers (JS-rendered sites)', () => {
  it('an unknown div WITH id becomes an anchored group div with recursed children', () => {
    const section = {
      id: 'arrivals',
      role: 'body' as const,
      html: '<section id="arrivals"><h2>Just landed</h2><div id="newestGrid" class="obj-grid"><p>One</p><p>Two</p></div></section>',
    };
    const { markup } = emitSectionBlocks(section);
    // The mount wrapper survives with its id (carried JS re-renders into it).
    expect(markup).toContain('"anchor":"newestGrid"');
    expect(markup).toContain('<div id="newestGrid" class="wp-block-group obj-grid">');
    expect(markup).toContain('"tagName":"div"');
    // Children recurse through the normal emitters, not a text downgrade.
    expect(markup).toContain('<!-- wp:paragraph -->');
    expect(markup).toContain('One');
  });

  it('an EMPTY mount div with id is preserved as an empty anchored group', () => {
    const section = {
      id: 'arrivals',
      role: 'body' as const,
      html: '<section id="arrivals"><h2>Just landed</h2><div id="newestGrid" class="obj-grid obj-grid--4"></div></section>',
    };
    const { markup, confidence } = emitSectionBlocks(section);
    expect(markup).toContain('"anchor":"newestGrid"');
    expect(markup).toContain('<div id="newestGrid" class="wp-block-group obj-grid obj-grid--4"></div>');
    expect(confidence).toBe(1); // structural preservation, nothing lost
  });

  it('an unknown classed div WITHOUT id becomes a paragraph that keeps its class (not a group anchor)', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section id="s"><div class="mystery">Loose text</div></section>',
    };
    const { markup, confidence } = emitSectionBlocks(section);
    // Class-bearing leaf → core/paragraph carrying the class (carried CSS keeps
    // matching), NOT a group with an id anchor (no id present).
    expect(markup).toContain('<p class="mystery">Loose text</p>');
    expect(markup).not.toContain('"anchor":"mystery"');
    expect(confidence).toBe(1);
  });
});

describe('slider context intervalMs gate (B2 review residual)', () => {
  it('intervalMs 0 is never emitted into context (editor save omits it too)', () => {
    const section = {
      id: 'quotes',
      role: 'body' as const,
      html: '<section id="quotes"><div class="track"><figure class="slide is-current"><p>A</p></figure><figure class="slide"><p>B</p></figure></div></section>',
      behavior: { kind: 'slider' as const, activeClass: 'is-current', intervalMs: 0 },
    };
    const { markup } = emitSectionBlocks(section);
    expect(markup).toContain('data-wp-interactive="dla/slider"');
    expect(markup).not.toContain('intervalMs');
  });
});

describe('structural wrapper preservation (owned-source bodies)', () => {
  it('a classless wrapper div with element children recurses instead of text-downgrading', () => {
    const section = {
      id: 'story',
      role: 'body' as const,
      html: '<section id="story"><div class="wrap"><h2 class="h-lg">Title</h2><p class="lead">Body copy.</p></div></section>',
    };
    const { markup } = emitSectionBlocks(section);
    // Wrapper survives with its class (source .wrap rules keep matching)…
    expect(markup).toContain('class="wp-block-group wrap"');
    // …and the children emit through their REAL branches, not a text blob.
    expect(markup).toContain('<!-- wp:heading');
    expect(markup).toContain('<h2 class="wp-block-heading h-lg">Title</h2>');
    expect(markup).toContain('<p class="lead">Body copy.</p>');
  });

  it('carries section and wrapper inline styles as lib-i classes + rules (grid/padding, fixer-safe)', () => {
    const sheet = new InstanceStyleSheet();
    const section = {
      id: 'intro',
      role: 'body' as const,
      html: '<section id="intro" style="padding-top:56px"><div class="wrap" style="display:grid;gap:24px"><p>A</p><p>B</p></div></section>',
    };
    const { markup } = emitSectionBlocks(section, { instanceStyles: sheet });
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).not.toContain('style=');
    expect(markup).toMatch(/<section id="intro" class="wp-block-group lib-i[0-9a-f]{10}">/);
    expect(markup).toMatch(/class="wp-block-group wrap lib-i[0-9a-f]{10}"/);
    expect(sheet.toCss()).toContain('padding-top:56px');
    expect(sheet.toCss()).toContain('display:grid;gap:24px');
  });

  it('a true text leaf becomes a paragraph that keeps its class (not a structural group)', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section id="s"><div class="badge">Leaf text only</div></section>',
    };
    const { markup, confidence } = emitSectionBlocks(section);
    // A childless leaf is NOT promoted to a group; it becomes a paragraph that
    // carries its source class (previously dropped to a bare <p>).
    expect(markup).toContain('<p class="badge">Leaf text only</p>');
    expect(markup).not.toContain('wp-block-group badge');
    expect(confidence).toBe(1);
  });
});

describe('emitSectionBlocks jetpackForms', () => {
  const contactFormHtml =
    '<section id="contact"><form class="contact-form" action="/contact" method="post">' +
    '<label>Email</label>' +
    '<input type="email" name="email" required placeholder="you@example.com"/>' +
    '<button type="submit">Send</button>' +
    '</form></section>';

  it('defaults off, so an eligible form still uses the existing verbatimInteractive island', () => {
    const { markup, formsConverted } = emitSectionBlocks(
      { id: 'contact', role: 'body' as const, html: contactFormHtml },
      { verbatimInteractive: true },
    );

    expect(markup).toContain('<!-- wp:html -->');
    expect(markup).toContain('<form class="contact-form"');
    expect(markup).not.toContain('wp:jetpack/contact-form');
    expect(formsConverted).toBe(0);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('on: converts an eligible form before verbatimInteractive can island it', () => {
    const { markup, formsConverted } = emitSectionBlocks(
      { id: 'contact', role: 'body' as const, html: contactFormHtml },
      { jetpackForms: true, verbatimInteractive: true },
    );

    expect(markup).toContain('<!-- wp:jetpack/contact-form');
    expect(markup).toContain('<!-- wp:jetpack/field-email');
    expect(markup).toContain('<!-- wp:jetpack/button');
    expect(markup).not.toContain('<!-- wp:html -->');
    expect(markup).not.toContain('<form class="contact-form"');
    expect(formsConverted).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('on: leaves a search-only form on the verbatimInteractive fallback path', () => {
    const searchFormHtml =
      '<section id="search"><form class="site-search" role="search" action="/">' +
      '<input class="search-field" type="search" name="s" placeholder="Search"/>' +
      '<button type="submit">Search</button>' +
      '</form></section>';
    const { markup, formsConverted } = emitSectionBlocks(
      { id: 'search', role: 'body' as const, html: searchFormHtml },
      { jetpackForms: true, verbatimInteractive: true },
    );

    expect(markup).toContain('<!-- wp:html -->');
    expect(markup).toContain('<form class="site-search"');
    expect(markup).toContain('type="search"');
    expect(markup).not.toContain('wp:jetpack/contact-form');
    expect(formsConverted).toBe(0);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('on: preserves wrapper siblings while converting a nested form', () => {
    const html =
      '<section id="contact"><div class="shell">' +
      '<h2>Talk to us</h2>' +
      '<form class="contact-form"><label>Email</label><input type="email" name="email"/><button>Send</button></form>' +
      '</div></section>';
    const { markup, formsConverted } = emitSectionBlocks(
      { id: 'contact', role: 'body' as const, html },
      { jetpackForms: true, verbatimInteractive: true },
    );

    expect(markup).toContain('Talk to us');
    expect(markup).toContain('class="wp-block-group shell"');
    expect(markup).toContain('wp:jetpack/contact-form');
    expect(markup).not.toContain('<form class="contact-form"');
    expect(formsConverted).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('on: preserves visual wrapper siblings while converting a nested form', () => {
    const html =
      '<section id="contact"><div class="shell">' +
      '<img src="hero.jpg" alt="Hero">' +
      '<form class="contact-form"><label>Email</label><input type="email" name="email"/><button>Send</button></form>' +
      '</div></section>';
    const { markup, formsConverted } = emitSectionBlocks(
      { id: 'contact', role: 'body' as const, html },
      { jetpackForms: true, verbatimInteractive: true },
    );

    expect(markup).toContain('hero.jpg');
    expect(markup).toContain('wp:jetpack/contact-form');
    expect(markup).not.toContain('<form class="contact-form"');
    expect(formsConverted).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('on: preserves empty styling-hook siblings while converting a nested form', () => {
    const html =
      '<section id="contact"><div class="shell">' +
      '<span class="icon"></span>' +
      '<form class="contact-form"><label>Email</label><input type="email" name="email"/><button>Send</button></form>' +
      '</div></section>';
    const { markup, formsConverted } = emitSectionBlocks(
      { id: 'contact', role: 'body' as const, html },
      { jetpackForms: true, verbatimInteractive: true },
    );

    expect(markup).toContain('class="icon"');
    expect(markup).toContain('wp:jetpack/contact-form');
    expect(markup).not.toContain('<form class="contact-form"');
    expect(formsConverted).toBe(1);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });
});

describe('emitSectionBlocks verbatimInteractive (chrome carry)', () => {
  // A button-toggled dropdown nav: the source carries the interactive structure
  // (<button> + inline <svg> chevron + a .menu-item--has-children class) that the
  // carried CSS (:hover/.is-open) and the source JS toggle key off. core/list
  // cannot represent it — listItemBlock strips `button svg`, unwraps the <button>
  // to bare text, and drops the <li> class. verbatimInteractive keeps the whole
  // subtree as a core/html island so the chrome part can emit it verbatim.
  const navHtml =
    '<section id="hdr"><ul class="site-menu">' +
    '<li><a href="/home.html">Home</a></li>' +
    '<li class="menu-item--has-children">' +
    '<button type="button" aria-expanded="false">More ' +
    '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="m1 1 4 4 4-4"/></svg></button>' +
    '<ul class="submenu"><li><a href="/a.html">Docs</a></li></ul>' +
    '</li></ul></section>';

  it('default (off): drops the button + chevron svg, but keeps the list-item class', () => {
    const { markup } = emitSectionBlocks({ id: 'hdr', role: 'body' as const, html: navHtml });
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<svg');
    // The list-item CLASS now survives (a carried-CSS styling hook) even though
    // the interactive button/svg still need verbatimInteractive to be preserved.
    expect(markup).toContain('menu-item--has-children');
  });

  it('on: preserves the button, chevron svg, has-children class, and submenu', () => {
    const { markup } = emitSectionBlocks(
      { id: 'hdr', role: 'body' as const, html: navHtml },
      { verbatimInteractive: true },
    );
    expect(markup).toContain('menu-item--has-children');
    expect(markup).toContain('<button');
    expect(markup).toContain('<svg');
    expect(markup).toContain('submenu');
    // a plain (non-interactive) sibling link still rides through
    expect(markup).toContain('Home');
    // the interactive list rides a core/html island
    expect(markup).toContain('<!-- wp:html -->');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('on: preserves an inline-svg search form verbatim', () => {
    const formHtml =
      '<section id="hero"><form class="site-search" role="search">' +
      '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6"/></svg>' +
      '<input class="search-field" type="search" name="s" placeholder="Search…"/>' +
      '</form></section>';
    const { markup } = emitSectionBlocks(
      { id: 'hero', role: 'body' as const, html: formHtml },
      { verbatimInteractive: true },
    );
    expect(markup).toContain('<form');
    expect(markup).toContain('class="site-search"');
    expect(markup).toContain('<svg');
    expect(markup).toContain('class="search-field"');
  });

  it('on: preserves an EMPTY classed element (CSS-background logo hook)', () => {
    // A logo is often an empty <a class="brand-logo"> filled by CSS
    // background:url(logo.svg). Both paths keep the classed anchor: the body path
    // preserves an empty classed styling hook verbatim, and verbatimInteractive
    // keeps it as part of the byte-true interactive subtree.
    const html =
      '<section id="hdr">' +
      '<a class="brand-logo" href="/" aria-label="Home"></a>' +
      '<ul class="site-menu"><li><a href="/home.html">Home</a></li></ul>' +
      '</section>';
    const off = emitSectionBlocks({ id: 'hdr', role: 'body' as const, html });
    // The body path now ALSO preserves an empty classed styling hook verbatim
    // (the overlay/logo case — see the nested-leaf suite), so the class survives
    // even without the opt. verbatimInteractive additionally keeps interactive
    // subtrees (the nav) byte-true.
    expect(off.markup).toContain('brand-logo');

    const { markup } = emitSectionBlocks(
      { id: 'hdr', role: 'body' as const, html },
      { verbatimInteractive: true },
    );
    expect(markup).toContain('class="brand-logo"');
    expect(markup).toContain('aria-label="Home"');
  });

  it('on: an empty id-bearing MOUNT div stays an anchor-group (not an island)', () => {
    // A query-loop mount is `<div id="latestGrid" class="card-grid"></div>`.
    // injectQueryLoops replaces the empty anchor-group by id — islandifying it
    // would break that splice, so styling-hook preservation must skip ids.
    const html = '<section id="s"><div id="latestGrid" class="card-grid"></div></section>';
    const { markup } = emitSectionBlocks(
      { id: 's', role: 'body' as const, html },
      { verbatimInteractive: true },
    );
    expect(markup).toContain('"anchor":"latestGrid"');
    expect(markup).toContain('<div id="latestGrid"');
    expect(markup).not.toContain('<!-- wp:html -->');
  });

  it('on: does NOT islandify a wrapper holding a mount + an inline-svg sibling (mount stays injectable)', () => {
    // A grid section: an empty id-bearing mount (the query-loop target) next to a
    // pagination nav whose arrows are inline <svg>. Islandifying the wrapper would
    // trap the mount in raw HTML so injectQueryLoops can't replace it. The wrapper
    // must stay structured (mount → anchor-group); the pagination islandifies alone.
    const html =
      '<section id="s"><div class="wide">' +
      '<h2>Latest</h2>' +
      '<div class="card-grid" id="latestGrid"></div>' +
      '<nav class="pager"><a href="#"><svg viewBox="0 0 8 8"><path d="M0 0h8v8H0Z"/></svg></a></nav>' +
      '</div></section>';
    const { markup } = emitSectionBlocks(
      { id: 's', role: 'body' as const, html },
      { verbatimInteractive: true },
    );
    // mount survives as an anchor-group injectQueryLoops can target
    expect(markup).toContain('"anchor":"latestGrid"');
    expect(markup).toContain('<div id="latestGrid"');
    // the pagination svg is still preserved (its own island)
    expect(markup).toContain('<svg');
    expect(markup).toContain('<!-- wp:html -->');
  });

  it('on: a plain link list is unaffected (still core/list, editable)', () => {
    const plain = '<section id="f"><ul class="footer-menu"><li><a href="/a.html">A</a></li><li><a href="/b.html">B</a></li></ul></section>';
    const { markup } = emitSectionBlocks(
      { id: 'f', role: 'body' as const, html: plain },
      { verbatimInteractive: true },
    );
    expect(markup).toContain('<!-- wp:list');
    expect(markup).not.toContain('<!-- wp:html -->');
  });
});

describe('emitSectionBlocks — nested leaf styling preservation', () => {
  it('keeps a nested leaf div class on a core/paragraph (class-targeted CSS)', () => {
    // <div class="stat-num">12k</div> inside a .stat group is class-targeted
    // (.stat .stat-num{}). It must keep its class, not flatten to a bare <p>.
    const section = {
      id: 'stats',
      role: 'body' as const,
      html: '<section><div class="stat"><div class="stat-num">12k</div><div class="stat-label">Members</div></div></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('<p class="stat-num">12k</p>');
    expect(markup).toContain('<p class="stat-label">Members</p>');
  });

  it('keeps a nested leaf span class on a core/paragraph (e.g. a quote attribution)', () => {
    const section = {
      id: 'quote',
      role: 'body' as const,
      html: '<section><blockquote class="quote"><p>A fine review.</p><span class="quote-by">— A Patron</span></blockquote></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('<p class="quote-by">— A Patron</p>');
  });

  it('carries a nested leaf inline style as a lib-i class (not a stripped style= attr)', () => {
    const sheet = new InstanceStyleSheet();
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><div class="badge"><div class="tag" style="color:var(--hot)">New</div></div></section>',
    };
    const { markup } = emitSectionBlocks(section, { instanceStyles: sheet });
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toMatch(/<p class="tag lib-i[0-9a-f]{10}">New<\/p>/);
    expect(markup).not.toContain('style="color');
    expect(sheet.toCss()).toContain('color:var(--hot)');
  });

  it('preserves a nested semantic leaf tag verbatim (element-targeted CSS survives)', () => {
    // .gallery figcaption{} targets the ELEMENT (no class) — flattening to <p>
    // would break it. Keep the figcaption tag via a verbatim html island.
    const section = {
      id: 'gallery',
      role: 'body' as const,
      html: '<section><figure><img src="a.jpg" alt="A"><figcaption>Caption text</figcaption></figure></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('<figcaption>Caption text</figcaption>');
  });

  it('preserves an empty classed styling-hook element (decorative CSS-painted overlay)', () => {
    // <div class="overlay"></div> is painted entirely by CSS — a bare empty <p>
    // drops the class and kills the visual. Keep it verbatim.
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><div class="overlay"></div></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('<div class="overlay"></div>');
  });

  it('keeps a classless <span> inside rich text so contextual ".parent span" CSS survives', () => {
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><p class="pull">We <span>start</span> arguments.</p></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('We <span>start</span> arguments.');
  });

  it('preserves a list-item class on core/list-item (e.g. a reveal hook)', () => {
    // <li class="reveal"> drove a scroll animation; listItemBlock dropped the
    // class, flattening to a bare <li> (the carried .reveal rule stops matching).
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><ol class="manifesto"><li class="reveal">One</li><li class="reveal">Two</li></ol></section>',
    };
    const { markup } = emitSectionBlocks(section);
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toContain('<li class="reveal">One</li>');
    expect(markup).toContain('<li class="reveal">Two</li>');
  });

  it('carries an <img> inline style as a lib-i class + rule (fixer-safe)', () => {
    const sheet = new InstanceStyleSheet();
    const section = {
      id: 's',
      role: 'body' as const,
      html: '<section><img src="a.svg" alt="A" style="background:var(--ink)"></section>',
    };
    const { markup } = emitSectionBlocks(section, { instanceStyles: sheet });
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
    expect(markup).toMatch(/wp-block-image lib-i[0-9a-f]{10}/);
    expect(markup).not.toContain('style="background');
    expect(sheet.toCss()).toContain('background:var(--ink)');
  });
});
