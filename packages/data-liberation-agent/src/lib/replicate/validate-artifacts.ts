// src/lib/replicate/validate-artifacts.ts
//
// The pre-install gate. Pure: takes generated patterns + their specs, returns a
// structured report. FOUR responsibilities:
//   1. drift       — placeholders, remote URLs, decorative comments, bad model
//   2. security    — escaping / injection allowlist (the trust boundary)
//   3. provenance  — emitted text ⊆ spec captured text
//   4. structure   — block markup is well-formed (balanced delimiters, valid
//                    attrs, no freeform leaks), per the official WP parser
//
//   patterns[] ──▶ for each: drift ✓ · security ✓ · provenance ✓ · structure ✓ ──▶ { ok, errors[], warnings[] }
//
import { validateBlockMarkup } from './validate-block-markup.js';
import { validateBlockContract } from './block-contract.js';
const ALLOWED_INTERACTION_MODELS = new Set([
  'static', 'gallery', 'media-text', 'columns', 'cover-with-headline',
  'animated-cover', 'logo-strip', 'testimonial', 'cta', 'blog-card-grid',
  'project-card-grid', 'price-list', 'product-card-row', 'review-grid',
  'app-download', 'color-block-grid', 'marquee-strip',
  'horizontal-showcase', 'footer', 'nav',
]);

function decodeEntities(v: string): string {
  return v
    .replace(/&#8217;|&#8216;|&#039;|&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#8220;|&#8221;|&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-')
    .replace(/&hellip;|&#8230;/g, '...')
    .replace(/&nbsp;|&#160;/g, ' ');
}
/**
 * Normalize text for provenance comparison. Beyond entity decoding + whitespace
 * collapse + lowercasing, we fold the typographic glyphs that LEGITIMATELY differ
 * between source and emitted markup — smart quotes → straight, en/em dash →
 * hyphen, ellipsis char → `...` — so that genuinely-verbatim copy (which only
 * differs from source by these renderings) compares equal, while reworded copy
 * still differs. This is the line between "legit normalization" and "paraphrase".
 */
function normalizeText(v: string): string {
  return decodeEntities(v.replace(/<[^>]+>/g, ' '))
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—‒]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
/** Visible text content of block markup, stripped of wp comments + php + tags. */
function visibleText(php: string): string {
  return normalizeText(php.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<\?[\s\S]*?\?>/g, ' '));
}

/**
 * "Significant" words for body-copy containment scoring: drop short
 * stop-word-ish tokens and pure punctuation/glyph runs so the ratio reflects
 * meaningful lexical content, not noise. Stars/prices/bullets are handled by the
 * caller (they are not body prose), so here we only strip non-word characters.
 */
function significantWords(norm: string): string[] {
  return norm
    .split(' ')
    .map((w) => w.replace(/[^a-z0-9'$.%-]/g, ''))
    .filter((w) => w.replace(/[^a-z0-9]/g, '').length > 2);
}

/**
 * True when `heading` (normalized) equals the space-joined concatenation of a
 * run of CONSECUTIVE normalized entries. This recognizes a source heading the
 * extractor split across adjacent text nodes (captured as two ordered entries)
 * WITHOUT admitting a sub-phrase that merely spans an entry boundary: the match
 * must align to whole-entry boundaries (start at an entry start, end at an entry
 * end), so "win award" from ["we win", "award every year"] still fails while
 * ["sleep better", "tonight"] reconstructs "sleep better tonight".
 */
function matchesConsecutiveEntries(heading: string, entries: string[]): boolean {
  const norm = entries.map((e) => e.trim()).filter((e) => e.length > 0);
  for (let i = 0; i < norm.length; i++) {
    let joined = norm[i];
    if (joined === heading) return true; // (also covered by single-entry check)
    for (let j = i + 1; j < norm.length; j++) {
      joined = `${joined} ${norm[j]}`;
      if (joined.length > heading.length) break; // can only grow — past the target
      if (joined === heading) return true;
    }
  }
  return false;
}

/**
 * BODY-COPY provenance threshold. A body paragraph passes when it is either a
 * normalized substring of the joined source OR has at least this fraction of its
 * significant words present in the source corpus. Verbatim copy (post entity/
 * whitespace/glyph normalization) scores 1.0; a reworded paraphrase drops well
 * below this. Set high enough to reject paraphrase, with headroom for a stray
 * captured artifact (a trailing word, a split node) so legit copy isn't flagged.
 */
const BODY_COPY_CONTAINMENT_THRESHOLD = 0.8;

/**
 * Shared injection / XSS scan over arbitrary block markup. Returns the list of
 * violation messages (empty = clean). The SAME trust-boundary the pattern
 * validator enforces, extracted so the theme-part builders (header/footer) can
 * gate their output too — nav markup is attacker-controlled (source labels +
 * hrefs) and is written to disk WITHOUT going through `validateArtifacts`.
 *
 * Two PHP forms are sanctioned (theme-asset echo + the pattern-file doc-comment
 * header); ANY other residual `<?`, a `<script>` tag, or an inline `on*=` event
 * handler is treated as injection.
 */
/**
 * Remove `<!-- wp:html -->…<!-- /wp:html -->` fallback islands from markup.
 * Used to exempt verbatim islands from the text-PROVENANCE trace (their content
 * is source-verbatim by construction); injection + structure checks still run
 * on the full markup, so this never weakens the security boundary.
 *
 * The opener may carry attribute JSON — pipeline coverage islands are marked
 * with `{"metadata":{"name":"lib-coverage-island"}}` (see block-policy.ts /
 * html-fallback.ts) — so the opener is matched up to its `-->` rather than
 * requiring the bare legacy form.
 */
function stripHtmlFallbackBlocks(markup: string): string {
  return markup.replace(
    /<!--\s*wp:html(?:\s+\{[\s\S]*?\})?\s*-->[\s\S]*?<!--\s*\/wp:html\s*-->/g,
    '',
  );
}

export function scanForInjection(markup: string): string[] {
  const violations: string[] = [];
  const SANCTIONED_PHP = /<\?php\s+echo\s+esc_url\(\s*get_theme_file_uri\(\s*'[^']+'\s*\)\s*\);\s*\?>/gi;
  // The doc-comment body is matched with a TEMPERED dot — `(?:(?!\*\/)[\s\S])*`
  // stops at the FIRST `*/`, which must then be immediately followed by `?>`.
  // A plain non-greedy `[\s\S]*?` would BACKTRACK past an early `*/` (e.g. a
  // crafted title `*/ system($_GET[0]); /*` closes the comment early, runs PHP,
  // then re-opens `/*` so the block still ends in `*/?>`); the non-greedy form
  // would span the whole block and strip the injected PHP before the residual
  // `<?` check, passing RCE. The tempered form refuses to cross the early `*/`,
  // so such a header is NOT sanctioned and its `<?php` trips the check below.
  const SANCTIONED_HEADER = /<\?php\s*\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*\?>/g;
  const residualPhp = markup.replace(SANCTIONED_PHP, '').replace(SANCTIONED_HEADER, '');
  if (/<\?/.test(residualPhp)) {
    violations.push('raw PHP tag in markup (only the pattern-header doc-comment and esc_url(get_theme_file_uri()) are allowed)');
  }
  if (/<\s*script/i.test(markup)) {
    violations.push('raw <script> tag in markup (not allowed)');
  }
  if (/[\s"'/]on[a-z]+\s*=/i.test(markup)) {
    violations.push('inline event handler attribute (on*=) in markup (not allowed)');
  }
  return violations;
}

/**
 * Throw if `markup` contains any injection pattern (see {@link scanForInjection}).
 * Used by the theme-part builders to fail fast on attacker-controlled nav markup
 * that would otherwise bypass the pattern validator.
 */
export function assertNoInjection(markup: string, context = 'markup'): void {
  const violations = scanForInjection(markup);
  if (violations.length > 0) {
    throw new Error(`injection check failed for ${context}: ${violations.join('; ')}`);
  }
}

export interface PatternSpec {
  interactionModel: string;
  /** Verbatim captured text the pattern is allowed to contain. */
  expectedText: string[];
  /**
   * Source-VERBATIM body copy captured from the section (every `<p>`/`<li>` text
   * node — see `SectionSpec.bodyText`). When present it is folded into the
   * source corpus for the BODY-COPY provenance check. Emitted body paragraphs
   * must be substantially contained in `expectedText` ∪ `bodyText`; reworded
   * prose fails hard. Optional for back-compat — when absent, only `expectedText`
   * forms the corpus.
   */
  bodyText?: string[];
  /** Local asset paths the pattern is expected to reference. */
  expectedAssets: string[];
}
export interface ArtifactPattern { slug: string; php: string; spec: PatternSpec; }
export interface ArtifactInput { patterns: ArtifactPattern[]; }
export interface Finding { slug: string; message: string; }
export interface ValidationReport { ok: boolean; errors: Finding[]; warnings: Finding[]; }

/** True when markup carries an un-migrated remote asset — a remote <img src> or
 *  CSS url() that is NOT a /wp-content/uploads/ media-library URL. Shared with the
 *  blocks reconstructor so it can reject a conversion that would fail this gate. */
export function hasUnmigratedRemoteAsset(markup: string): boolean {
  const isMediaLibraryUrl = (u: string): boolean => /\/wp-content\/uploads\//i.test(u);
  const imgRemote = [...markup.matchAll(/<img\b[^>]*?\bsrc=["']?(https?:\/\/[^"'\s>]+)/gi)].some((m) => !isMediaLibraryUrl(m[1]));
  const cssRemote = [...markup.matchAll(/url\(\s*['"]?(https?:\/\/[^)'"]+)/gi)].some((m) => !isMediaLibraryUrl(m[1]));
  return imgRemote || cssRemote;
}

export function validateArtifacts(input: ArtifactInput): ValidationReport {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];

  for (const p of input.patterns) {
    const fail = (message: string) => errors.push({ slug: p.slug, message });

    // --- drift ---
    if (/\{\{[\w -]+\}\}/.test(p.php)) {
      fail('unresolved template placeholder remains in generated pattern');
    }
    // Remote-asset check. The concern is un-migrated CDN URLs (wixstatic,
    // cdn.shopify, squarespace, etc.) leaking into output. A WordPress
    // media-library URL (`.../wp-content/uploads/...`) is the *migrated* form
    // for content images stored in post_content — not a leak — so it's exempt.
    // Theme-pattern chrome still routes through get_theme_file_uri(); content
    // images legitimately reference the uploaded media library by URL.
    if (hasUnmigratedRemoteAsset(p.php)) {
      fail('remote image URL found; route theme assets through get_theme_file_uri() and content images through the WP media library');
    }
    for (const comment of p.php.matchAll(/<!--([\s\S]*?)-->/g)) {
      const body = comment[1].trim();
      if (body.startsWith('wp:') || body.startsWith('/wp:')) continue;
      fail(`non-WordPress HTML comment found: "${body.slice(0, 80)}"`);
    }
    if (!ALLOWED_INTERACTION_MODELS.has(p.spec.interactionModel)) {
      fail(`invalid or missing interaction model "${p.spec.interactionModel || '(empty)'}"`);
    }

    // --- security: injection / XSS trust boundary ---
    // Two PHP forms are sanctioned; ANY other residual open tag — <?php, <?PHP,
    // <?= or the short <? — plus <script> and inline on*= handlers are treated as
    // injection. Shared with the theme-part builders via scanForInjection().
    for (const violation of scanForInjection(p.php)) fail(violation);

    // --- structure: block markup must be well-formed ---
    // The renderer hand-builds <!-- wp:NAME -->…<!-- /wp:NAME --> strings. Run
    // them through the official WP parser + a delimiter-balance check so an
    // unclosed/mismatched delimiter (which the parser silently re-parents) or a
    // freeform/bad-attrs leak fails the gate instead of shipping broken blocks.
    for (const violation of validateBlockMarkup(p.php)) fail(violation);

    // --- contract: emitted attrs vs registered core metadata (WARNING-level) ---
    // Invented core blocks/attrs and out-of-allowlist group tagNames are OUR
    // emitter bugs, surfaced beside the structural gate but never failing it
    // (trust-source posture; dla/* + core/html allowlisted in the check).
    for (const issue of validateBlockContract(p.php)) {
      warnings.push({ slug: p.slug, message: `block contract: ${issue.code} ${issue.blockName} — ${issue.detail}` });
    }

    // --- provenance: emitted copy must trace to the captured source ---
    //
    // The source corpus is the spec's captured text: headings + button labels +
    // review quotes (expectedText) PLUS captured body copy (bodyText). Body
    // paragraphs are checked against the union; headings against expectedText
    // entries individually.
    // core/html fallback islands are source-verbatim by construction (the
    // structured render dropped content, so we emitted the section's own HTML).
    // Their text legitimately exceeds the captured corpus, so EXEMPT island
    // spans from the provenance trace — they still went through scanForInjection
    // + validateBlockMarkup above on the full `p.php`.
    const provenancePhp = stripHtmlFallbackBlocks(p.php);
    const corpus = normalizeText([...p.spec.expectedText, ...(p.spec.bodyText ?? [])].join('  '));
    const allowedEntries = [...p.spec.expectedText, ...(p.spec.bodyText ?? [])].map((t) =>
      normalizeText(t),
    );
    const emitted = visibleText(provenancePhp);
    for (const word of emitted.split(' ').filter((w) => w.length > 3)) {
      if (!corpus.includes(word)) {
        warnings.push({ slug: p.slug, message: `possible non-source content: "${word}"` });
      }
    }

    // Heading inner-HTML is normalized (tags stripped) so nested <span>/<a> can't
    // hide invented copy. A heading passes when it is contained in a SINGLE spec
    // entry, OR it equals the concatenation of a run of CONSECUTIVE entries (a
    // source heading the extractor split across adjacent text nodes — e.g. a
    // `<span>`/`<br>` split — captured as two ordered entries). Crucially this
    // still REJECTS a heading merely scattered across the joined blob ("win
    // award" from ["we win", "award every year"]): the heading must align to
    // whole-entry boundaries, so a sub-phrase spanning an entry boundary fails.
    for (const heading of provenancePhp.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
      const h = normalizeText(heading[1]);
      if (!h) continue;
      const inSingleEntry = allowedEntries.some((e) => e.includes(h));
      if (inSingleEntry) continue;
      if (matchesConsecutiveEntries(h, allowedEntries)) continue;
      fail(`heading "${h}" not found in source spec (provenance)`);
    }

    // BODY-COPY provenance — the hard gate that stops paraphrase from shipping.
    //
    // Before, body prose only emitted soft per-word warnings, so a fully
    // reworded paragraph ("Real fan-powered sound — no loops…") sailed through
    // while the real source line never made it in. Now every emitted body
    // paragraph (a <p> that is real prose — not a heading, button, star glyph,
    // price, bullet marker, or our own missing-content placeholder) must be
    // SUBSTANTIALLY CONTAINED in the captured source: either a normalized
    // substring of the corpus, or ≥ BODY_COPY_CONTAINMENT_THRESHOLD of its
    // significant words present in the corpus. Verbatim copy (post entity/
    // whitespace/glyph normalization) scores 1.0 and passes; a paraphrase falls
    // below the threshold and HARD-FAILS. Honest gaps use the clearly-marked
    // missing-content placeholder, which is exempt by design.
    //
    // GATING (back-compat): the hard fail only fires when the spec actually
    // carries captured body copy (`spec.bodyText` non-empty). A spec that
    // predates body-text capture has NO source to compare body prose against —
    // so failing would punish legitimately-verbatim copy whose source the spec
    // simply didn't record (the line lives in the captured HTML, not the
    // geometry spec). For those legacy specs we keep the prior soft-warning
    // behavior. New extractions populate `spec.bodyText` (see
    // SectionSpec.bodyText) and get the full hard gate. This is why
    // `liberate_section_extract` now captures body copy — it's what arms the gate.
    const hasBodyCorpus = (p.spec.bodyText ?? []).length > 0;
    const isPlaceholder = (t: string): boolean =>
      /\bnot captured\]?$|\[(review|author|text|content)\b|image unavailable/i.test(t);
    for (const para of (hasBodyCorpus ? provenancePhp.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) : [])) {
      const raw = para[1];
      const t = normalizeText(raw);
      if (!t) continue;
      // Skip non-prose paragraph slots: star runs, price/money, bullet/byline,
      // single-token labels, and the sanctioned missing-content placeholder.
      if (/^[★☆\s]+$/.test(raw)) continue; // star-glyph rating run
      if (isPlaceholder(t)) continue; // honest missing-content marker
      const words = significantWords(t);
      if (words.length < 3) continue; // labels / prices / short bylines — not prose
      if (corpus.includes(t)) continue; // verbatim substring → provenance-clean
      const present = words.filter((w) => corpus.includes(w)).length;
      const ratio = present / words.length;
      if (ratio < BODY_COPY_CONTAINMENT_THRESHOLD) {
        const preview = t.length > 80 ? `${t.slice(0, 80)}…` : t;
        fail(
          `body copy not source-verbatim (provenance): "${preview}" — ` +
            `${present}/${words.length} words trace to captured source ` +
            `(< ${Math.round(BODY_COPY_CONTAINMENT_THRESHOLD * 100)}% threshold). ` +
            `Emit captured text verbatim or use the missing-content placeholder; never paraphrase.`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
