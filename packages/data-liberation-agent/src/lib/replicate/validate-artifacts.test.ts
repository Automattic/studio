import { describe, it, expect } from 'vitest';
import { validateArtifacts, type ArtifactInput } from './validate-artifacts.js';

const base = (): ArtifactInput => ({
  patterns: [{
    slug: 'site/section-1',
    php: `<!-- wp:heading --><h2>Our Services</h2><!-- /wp:heading -->`,
    spec: { interactionModel: 'cta', expectedText: ['Our Services'], expectedAssets: [] },
  }],
});

describe('validateArtifacts — drift', () => {
  it('passes a clean pattern', () => {
    expect(validateArtifacts(base()).ok).toBe(true);
  });
  it('rejects an unresolved placeholder', () => {
    const input = base();
    input.patterns[0].php = `<h2>{{HEADLINE}}</h2>`;
    const r = validateArtifacts(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /placeholder/i.test(e.message))).toBe(true);
  });
  it('rejects a remote image URL', () => {
    const input = base();
    input.patterns[0].php = `<img src="https://cdn.example.com/a.jpg" />`;
    const r = validateArtifacts(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /remote/i.test(e.message))).toBe(true);
  });
  it('accepts a WP media-library image URL (migrated content image, not a leak)', () => {
    const input = base();
    input.patterns[0].php = `<!-- wp:image {"id":42} --><figure class="wp-block-image"><img src="http://localhost:8882/wp-content/uploads/2026/05/lumber.jpg" alt="Stacked lumber" class="wp-image-42"/></figure><!-- /wp:image -->`;
    input.patterns[0].spec.interactionModel = 'gallery';
    input.patterns[0].spec.expectedText = ['Stacked lumber'];
    const r = validateArtifacts(input);
    expect(r.errors.some((e) => /remote/i.test(e.message))).toBe(false);
  });
  it('still rejects a remote CDN image even when a media-library image is also present', () => {
    const input = base();
    input.patterns[0].php = `<img src="http://localhost:8882/wp-content/uploads/2026/05/a.jpg" /><img src="https://static.wixstatic.com/media/x~mv2.png" />`;
    input.patterns[0].spec.interactionModel = 'gallery';
    const r = validateArtifacts(input);
    expect(r.errors.some((e) => /remote/i.test(e.message))).toBe(true);
  });
  it('rejects a non-WordPress HTML comment', () => {
    const input = base();
    input.patterns[0].php = `<!-- TODO fix this --><!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /comment/i.test(e.message))).toBe(true);
  });
  it('rejects an invalid interaction model', () => {
    const input = base();
    input.patterns[0].spec.interactionModel = 'bogus-model';
    const r = validateArtifacts(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /interaction model/i.test(e.message))).toBe(true);
  });
});

describe('validateArtifacts — security (injection/XSS)', () => {
  const withPhp = (php: string): ArtifactInput => ({
    patterns: [{ slug: 'site/section-1', php, spec: { interactionModel: 'cta', expectedText: [], expectedAssets: [] } }],
  });
  it('rejects a raw PHP tag in emitted markup', () => {
    const r = validateArtifacts(withPhp(`<h2>Hi</h2><?php system($_GET['x']); ?>`));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /php tag|<\?php/i.test(e.message))).toBe(true);
  });
  it('rejects a raw <script> tag', () => {
    const r = validateArtifacts(withPhp(`<h2>Hi</h2><script>alert(1)</script>`));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /script/i.test(e.message))).toBe(true);
  });
  it('rejects an inline event handler attribute', () => {
    const r = validateArtifacts(withPhp(`<img src="x" onerror="alert(1)" />`));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /event handler|on\w+=/i.test(e.message))).toBe(true);
  });
  it('allows the sanctioned esc_url PHP echo for theme assets', () => {
    const r = validateArtifacts(withPhp(
      `<img src="<?php echo esc_url( get_theme_file_uri('assets/img-01.jpg') ); ?>" alt="x" />`));
    expect(r.errors.some((e) => /php tag/i.test(e.message))).toBe(false);
  });
});

describe('validateArtifacts — provenance', () => {
  it('flags a heading not present in spec.expectedText', () => {
    const r = validateArtifacts({ patterns: [{
      slug: 'site/section-1',
      php: `<!-- wp:heading --><h2>Award-Winning Service Since 1998</h2><!-- /wp:heading -->`,
      spec: { interactionModel: 'cta', expectedText: ['Our Services'], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /not found in source|provenance/i.test(e.message))).toBe(true);
  });
  it('passes when emitted text is a subset of spec text', () => {
    const r = validateArtifacts({ patterns: [{
      slug: 'site/section-1',
      php: `<!-- wp:heading --><h2>Our Services</h2><!-- /wp:heading -->`,
      spec: { interactionModel: 'cta', expectedText: ['Our Services', 'Book now'], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(true);
  });
});

describe('validateArtifacts — security evasions (regression)', () => {
  const withPhp = (php: string): ArtifactInput => ({
    patterns: [{ slug: 'site/section-1', php, spec: { interactionModel: 'cta', expectedText: [], expectedAssets: [] } }],
  });
  it('rejects an UPPERCASE <?PHP tag', () => {
    expect(validateArtifacts(withPhp(`<div><?PHP system($_GET['x']); ?></div>`)).ok).toBe(false);
  });
  it('rejects a short <? tag', () => {
    expect(validateArtifacts(withPhp(`<div><? system($_GET['x']); ?></div>`)).ok).toBe(false);
  });
  it('rejects an event handler with no preceding whitespace', () => {
    expect(validateArtifacts(withPhp(`<a href="x"onclick="alert(1)">y</a>`)).ok).toBe(false);
  });
  it('rejects a <script with a leading space', () => {
    expect(validateArtifacts(withPhp(`<div>< script>alert(1)</script></div>`)).ok).toBe(false);
  });
  it('still allows the sanctioned esc_url echo (case-insensitive strip)', () => {
    const r = validateArtifacts(withPhp(`<img src="<?php echo esc_url( get_theme_file_uri('assets/img-01.jpg') ); ?>" alt="x" />`));
    expect(r.errors.some((e) => /php tag/i.test(e.message))).toBe(false);
  });
});

describe('validateArtifacts — provenance evasions (regression)', () => {
  it('flags an invented heading hidden inside a nested span', () => {
    const r = validateArtifacts({ patterns: [{
      slug: 'site/section-1',
      php: `<!-- wp:heading --><h2><span>Award Winning Since 1998</span></h2><!-- /wp:heading -->`,
      spec: { interactionModel: 'cta', expectedText: ['Our Services'], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /provenance/i.test(e.message))).toBe(true);
  });
  it('flags a heading whose words are only scattered across spec entries', () => {
    const r = validateArtifacts({ patterns: [{
      slug: 'site/section-1',
      php: `<!-- wp:heading --><h2>Win Award</h2><!-- /wp:heading -->`,
      spec: { interactionModel: 'cta', expectedText: ['we win', 'award every year'], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(false);
  });

  it('passes a heading that differs from its source entry only by inter-segment whitespace', () => {
    // The engine's native reconstruction emits adjacent inline nodes (e.g. an
    // email <span> followed by a phone <span>) with a normalized space between
    // them, while the captured spec concatenated the same two nodes with NO
    // separator. Same source text, different whitespace — must NOT fail.
    const r = validateArtifacts({ patterns: [{
      slug: 'site/section-1',
      php: `<!-- wp:heading --><h2>dsm@swiftlumber.com 251-446-4123</h2><!-- /wp:heading -->`,
      spec: { interactionModel: 'cta', expectedText: ['dsm@swiftlumber.com251-446-4123'], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(true);
  });

  it('still rejects scattered words even under whitespace-insensitive matching', () => {
    // Guard: the whitespace fallback must not let "win award" stitch across two
    // separate entries (the cross-entry rejection above must survive).
    const r = validateArtifacts({ patterns: [{
      slug: 'site/section-1',
      php: `<!-- wp:heading --><h2>Win Award</h2><!-- /wp:heading -->`,
      spec: { interactionModel: 'cta', expectedText: ['we win', 'award every year'], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(false);
  });
});

describe('validateArtifacts — body-copy provenance (paraphrase hard-fails)', () => {
  // The captured source line. spec.bodyText carries verbatim body copy.
  const SOURCE_BODY =
    "Recordings loop. Speakers hiss. SNOOZ's natural and seamless sound helps you drift off and stay asleep.";

  const withBody = (php: string, bodyText: string[] = [SOURCE_BODY]): ArtifactInput => ({
    patterns: [{
      slug: 'getsnooz/section-3',
      php,
      spec: { interactionModel: 'media-text', expectedText: [], bodyText, expectedAssets: [] },
    }],
  });

  it('HARD-FAILS a reworded body paragraph (the getsnooz paraphrase class)', () => {
    // The invented copy the earlier agent shipped — fully reworded, not in source.
    const php =
      `<!-- wp:paragraph --><p>Real fan-powered sound — no loops, no digital tracks. Just the deep, soothing rush of moving air that helps you fall asleep faster and stay asleep longer.</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts(withBody(php));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /body copy not source-verbatim/i.test(e.message))).toBe(true);
  });

  it('PASSES verbatim body copy that differs only by entity/whitespace/glyph normalization', () => {
    // Same source line but with HTML entity (&#8217; / &nbsp;), an em-dash, and an
    // ellipsis char — all LEGIT renderings of the captured text. Must NOT fail.
    const php =
      `<!-- wp:paragraph --><p>Recordings&nbsp;loop. Speakers hiss. SNOOZ&#8217;s natural and seamless sound helps you drift off and stay asleep.</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts(withBody(php));
    expect(r.ok).toBe(true);
    expect(r.errors.some((e) => /body copy/i.test(e.message))).toBe(false);
  });

  it('does NOT flag the missing-content placeholder as paraphrase (honest gap is exempt)', () => {
    // bodyText non-empty → the hard gate is ARMED; the placeholder is still exempt.
    const php =
      `<!-- wp:paragraph --><p style="opacity:0.6">[review text not captured]</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts(withBody(php));
    expect(r.errors.some((e) => /body copy/i.test(e.message))).toBe(false);
  });

  it('does NOT treat a star-glyph rating run or a price as body prose (gate armed)', () => {
    const php =
      `<!-- wp:paragraph --><p>★★★★★</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>$199.99</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts(withBody(php));
    expect(r.errors.some((e) => /body copy/i.test(e.message))).toBe(false);
  });

  it('BACK-COMPAT: a legacy spec with no captured bodyText does NOT hard-fail body prose (soft warning only)', () => {
    // Reworded prose, but spec.bodyText is empty (pre-capture spec) → the gate is
    // NOT armed, so this stays a warning, not a failure — no regression for
    // in-flight builds whose source body copy the geometry spec never recorded.
    const php =
      `<!-- wp:paragraph --><p>Some entirely different sentence the geometry spec never captured anywhere at all.</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts(withBody(php, []));
    expect(r.errors.some((e) => /body copy not source-verbatim/i.test(e.message))).toBe(false);
  });

  it('folds bodyText into the corpus so multi-paragraph verbatim copy passes', () => {
    const php =
      `<!-- wp:paragraph --><p>This isn't a speaker - there's a fan inside. Result: a smooth, room-filling hush</p><!-- /wp:paragraph -->` +
      `<!-- wp:paragraph --><p>Recordings loop. Speakers hiss. SNOOZ's natural and seamless sound helps you drift off and stay asleep.</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts(withBody(php, [
      "This isn't a speaker - there's a fan inside. Result: a smooth, room-filling hush",
      SOURCE_BODY,
    ]));
    expect(r.ok).toBe(true);
  });

  it('em-dash heading normalizes to the hyphenated source form (no false heading failure)', () => {
    const php = `<!-- wp:heading --><h2>There's white noise — and there's SNOOZ.</h2><!-- /wp:heading -->`;
    const r = validateArtifacts({ patterns: [{
      slug: 'getsnooz/section-3',
      php,
      spec: { interactionModel: 'media-text', expectedText: ["There's white noise - and there's SNOOZ."], expectedAssets: [] },
    }] });
    expect(r.errors.some((e) => /provenance/i.test(e.message))).toBe(false);
  });

  // FINDING C: provenance gate false-positive on genuinely-verbatim copy.
  // A long (>600 char) source paragraph used to be truncated to 600 chars in
  // capture, so a verbatim emit fell below the containment threshold and
  // HARD-FAILED — blocking a real install. The capture cap is now generous.
  it('PASSES a verbatim paragraph longer than 600 chars (no truncation false-fail)', () => {
    const longPara =
      'SNOOZ is a mechanical white noise machine that uses a real fan to create a natural, ' +
      'non-looping sound that helps you fall asleep and stay asleep through the night. ' +
      'Unlike electronic sound machines that play short digital recordings on a loop, the ' +
      'tone never repeats, so your brain never latches onto a seam in the audio. You can ' +
      'tune both the volume and the timbre by rotating the outer shell, dialing in anything ' +
      'from a soft, distant hush to a deep, room-filling rush of air that masks the snoring ' +
      'partner, the hallway traffic, the early-morning garbage truck, and every other ' +
      'disruption that would otherwise pull you out of deep sleep before you are ready to ' +
      'wake up on your own terms in the morning feeling genuinely rested and recovered.';
    expect(longPara.length).toBeGreaterThan(600);
    const php = `<!-- wp:paragraph --><p>${longPara}</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts({ patterns: [{
      slug: 'getsnooz/section-3',
      php,
      spec: { interactionModel: 'media-text', expectedText: [], bodyText: [longPara], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(true);
    expect(r.errors.some((e) => /body copy/i.test(e.message))).toBe(false);
  });

  it('still HARD-FAILS a reworded long paragraph (paraphrase not source-verbatim)', () => {
    const sourcePara =
      'SNOOZ is a mechanical white noise machine that uses a real fan to create a natural, ' +
      'non-looping sound that helps you fall asleep and stay asleep through the night, with ' +
      'a tone you can tune from a soft hush to a deep, room-filling rush of air across the ' +
      'whole bedroom so nothing disturbs your rest until you are ready to wake on your own.';
    const reworded =
      'Forget cheap digital gadgets and tinny phone apps: our premium engineered acoustic ' +
      'wellness device leverages aerodynamic principles to deliver an immersive, scientifically ' +
      'optimized auditory cocoon that revolutionizes how modern professionals reclaim their ' +
      'circadian rhythm and unlock peak restorative recovery every single evening guaranteed.';
    const php = `<!-- wp:paragraph --><p>${reworded}</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts({ patterns: [{
      slug: 'getsnooz/section-3',
      php,
      spec: { interactionModel: 'media-text', expectedText: [], bodyText: [sourcePara], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /body copy not source-verbatim/i.test(e.message))).toBe(true);
  });

  it('PASSES a heading split across CONSECUTIVE captured entries (legit node split)', () => {
    // The source heading "Sleep better tonight" was captured as two adjacent
    // text nodes; the emitted heading reconstructs the full line.
    const php = `<!-- wp:heading --><h2>Sleep better tonight</h2><!-- /wp:heading -->`;
    const r = validateArtifacts({ patterns: [{
      slug: 'getsnooz/section-3',
      php,
      spec: { interactionModel: 'cover-with-headline', expectedText: ['Sleep better', 'tonight'], expectedAssets: [] },
    }] });
    expect(r.errors.some((e) => /provenance/i.test(e.message))).toBe(false);
  });

  it('still FAILS a heading whose words merely span an entry boundary (not whole-entry aligned)', () => {
    // "win award" spans the end of entry 1 + start of entry 2 but is not a
    // reconstruction of whole consecutive entries → still an evasion.
    const php = `<!-- wp:heading --><h2>Win Award</h2><!-- /wp:heading -->`;
    const r = validateArtifacts({ patterns: [{
      slug: 'getsnooz/section-3',
      php,
      spec: { interactionModel: 'cta', expectedText: ['we win', 'award every year'], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /provenance/i.test(e.message))).toBe(true);
  });
});

describe('validateArtifacts — pattern-file header (regression: real builder output)', () => {
  it('allows the standard WP pattern-file PHP doc-comment header', () => {
    const php = `<?php\n/**\n * Title: Hero\n * Slug: site/section-0\n * Categories: featured\n */\n?>\n<!-- wp:heading --><h2>Our Services</h2><!-- /wp:heading -->`;
    const r = validateArtifacts({ patterns: [{
      slug: 'site/section-0', php,
      spec: { interactionModel: 'cover-with-headline', expectedText: ['Our Services'], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(true);
  });
  it('still rejects executable PHP after a doc-comment in the header block', () => {
    const php = `<?php /** Title: x */ system($_GET['x']); ?>\n<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts({ patterns: [{
      slug: 'site/section-0', php,
      spec: { interactionModel: 'cta', expectedText: [], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /php tag/i.test(e.message))).toBe(true);
  });
  it('rejects comment-breakout RCE smuggled through a crafted Title (balanced re-open)', () => {
    // A title of `*/ system($_GET[0]); /*` closes the doc-comment early, runs
    // PHP, then re-opens `/*` so the block STILL ends in `*/?>`. A non-greedy
    // header match would backtrack past the early `*/`, span the whole block,
    // and strip the injected PHP before the residual `<?` check — passing RCE.
    const php =
      `<?php\n/**\n * Title: */ system($_GET[0]); /*\n * Slug: site/section-0\n * Categories: featured\n * Inserter: false\n */\n?>\n` +
      `<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->`;
    const r = validateArtifacts({ patterns: [{
      slug: 'site/section-0', php,
      spec: { interactionModel: 'cta', expectedText: [], expectedAssets: [] },
    }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /php tag/i.test(e.message))).toBe(true);
  });
});

describe('validateArtifacts — block-markup well-formedness', () => {
  const withPhp = (php: string): ArtifactInput => ({
    patterns: [{ slug: 'site/section-1', php, spec: { interactionModel: 'cta', expectedText: [], expectedAssets: [] } }],
  });

  it('rejects an unclosed block delimiter (the bug the WP parser silently swallows)', () => {
    const r = validateArtifacts(withPhp(
      `<!-- wp:columns --><div class="wp-block-columns">` +
      `<!-- wp:column --><div class="wp-block-column"><!-- wp:paragraph --><p>a</p><!-- /wp:paragraph --></div><!-- /wp:column -->` +
      `</div>`, // missing <!-- /wp:columns -->
    ));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /unclosed.*wp:columns/i.test(e.message))).toBe(true);
  });

  it('rejects a mismatched closing delimiter', () => {
    const r = validateArtifacts(withPhp(`<!-- wp:columns --><div></div><!-- /wp:group -->`));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /mismatch/i.test(e.message))).toBe(true);
  });

  it('still passes well-formed block markup (no false positive)', () => {
    expect(validateArtifacts(base()).ok).toBe(true);
  });
});

describe('validateArtifacts — core/html fallback islands', () => {
  it('exempts text inside a core/html island from the provenance trace', () => {
    // The island deliberately carries content the structured spec never captured
    // (that loss is WHY we fell back). bodyText is non-empty, so the body-copy
    // hard gate is armed — yet the island must still pass.
    const input: ArtifactInput = {
      patterns: [{
        slug: 'site/section-1',
        php:
          `<!-- wp:html -->\n` +
          `<section><h2>An entirely uncaptured headline</h2>` +
          `<p>This paragraph was never recorded in the structured spec corpus.</p></section>\n` +
          `<!-- /wp:html -->`,
        spec: {
          interactionModel: 'static',
          expectedText: ['Some unrelated captured heading'],
          bodyText: ['Some unrelated captured body copy that differs entirely'],
          expectedAssets: [],
        },
      }],
    };
    const r = validateArtifacts(input);
    expect(r.ok).toBe(true);
  });

  it('exempts a MARKED pipeline island (attrs on the opener) from the provenance trace', () => {
    // Coverage islands now carry the lib-coverage-island metadata marker in the
    // opening delimiter — the provenance exemption must match attrs-bearing
    // openers, not just the bare legacy form.
    const input: ArtifactInput = {
      patterns: [{
        slug: 'site/section-1',
        php:
          `<!-- wp:html {"metadata":{"name":"lib-coverage-island"}} -->\n` +
          `<section><h2>An entirely uncaptured headline</h2>` +
          `<p>This paragraph was never recorded in the structured spec corpus.</p></section>\n` +
          `<!-- /wp:html -->`,
        spec: {
          interactionModel: 'static',
          expectedText: ['Some unrelated captured heading'],
          bodyText: ['Some unrelated captured body copy that differs entirely'],
          expectedAssets: [],
        },
      }],
    };
    const r = validateArtifacts(input);
    expect(r.ok).toBe(true);
  });

  it('still rejects a <script> inside a core/html island (injection scan applies)', () => {
    const input: ArtifactInput = {
      patterns: [{
        slug: 'site/section-1',
        php: `<!-- wp:html -->\n<section><script>alert(1)</script></section>\n<!-- /wp:html -->`,
        spec: { interactionModel: 'static', expectedText: [], expectedAssets: [] },
      }],
    };
    const r = validateArtifacts(input);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /script/i.test(e.message))).toBe(true);
  });
});

describe('validateArtifacts — block contract (warning-level)', () => {
  it('flags an invented attr as a warning without failing the gate', () => {
    const input = base();
    input.patterns[0].php = `<!-- wp:heading {"glow":true} --><h2 class="wp-block-heading">Our Services</h2><!-- /wp:heading -->`;
    const r = validateArtifacts(input);
    expect(r.ok).toBe(true); // contract issues are warnings, never gate failures
    expect(r.warnings.some((w) => w.message.includes('block contract') && w.message.includes('glow'))).toBe(true);
  });

  it('a clean pattern emits no contract warnings', () => {
    const r = validateArtifacts(base());
    expect(r.warnings.filter((w) => w.message.includes('block contract'))).toEqual([]);
  });
});
