//
// Commercial / uncapturable → free web-font substitution
// ========================================================
// Some source typefaces cannot be self-hosted: they're served CSS-only by a
// foundry CDN that never exposes a reachable woff/woff2 (Adobe Typekit's
// `use.typekit.net`, Monotype, Hoefler&Co Cloud.typography, …), or the family
// name is obfuscated/hashed by the page builder (Wix `wfont_*`). When the
// `font-capture` pipeline can't download a real woff for a family, we DON'T want
// the replica to fall back to a bare `sans-serif` / `serif` — that's the single
// largest body-copy fidelity gap on a Typekit-driven storefront like getsnooz.
//
// Instead we map the unhostable family to the closest FREE web font, download
// that free font's woff2 (from the Google Fonts static host, which DOES expose
// reachable files), self-host it into `assets/fonts/`, and bind it as the
// replica's body / display family. This is the deterministic half of the
// wp-clone "commercial-to-free font substitution table" idea; the skill docs
// (`skills/design-foundations/references/theme-tokens.md`, `skills/creating-themes`)
// carry the human-readable rule + starter table.
//
// Self-hosting (not `@import url(fonts.googleapis.com/...)`) is deliberate: the
// Google Fonts CSS CDN blocks offline rendering, flashes unstyled text on first
// paint, and leaks visitor IPs to a third party. We fetch the static woff2 from
// `fonts.gstatic.com` once and ship it in the theme.
//

/** A free replacement family + the gstatic woff2 files to self-host for it. */
export interface FreeFontReplacement {
  /** Free family name as it should appear in `font-family` (e.g. "Hanken Grotesk"). */
  family: string;
  /**
   * One self-hostable woff2 per weight we want. URLs point at `fonts.gstatic.com`
   * (Google Fonts' static file host) — pinned, reachable, license-free to ship.
   */
  faces: Array<{ weight: string; style: 'normal' | 'italic'; url: string }>;
  /** Short justification — surfaced in run-report / open questions. */
  rationale: string;
}

/**
 * Substitution rule: a case-insensitive family-name substring → a free
 * replacement with self-hostable woff2 files. Matching is by substring so a
 * stack like `"quasimoda, Arial, sans-serif"` or a hashed `wfont_quasimoda`
 * still resolves.
 *
 * The gstatic URLs are stable, content-addressed file paths from Google Fonts'
 * static host. Each carries the family's GPL/OFL license and is safe to ship.
 */
interface SubRule {
  /** Lowercased family-name substring to match. */
  match: string;
  replacement: FreeFontReplacement;
}

// gstatic woff2 (latin subset) for the free replacements. These are the
// VARIABLE-font files Google Fonts serves — one woff2 carries the whole weight
// axis, so a single `@font-face` with a `font-weight` RANGE (e.g. "400 700")
// covers every weight the design uses. URLs are the v-tagged latin-subset paths
// from the Google Fonts CSS API (verified reachable); each ships under OFL.
const HANKEN_GROTESK: FreeFontReplacement = {
  family: 'Hanken Grotesk',
  faces: [
    { weight: '400 700', style: 'normal', url: 'https://fonts.gstatic.com/s/hankengrotesk/v12/ieVn2YZDLWuGJpnzaiwFXS9tYtpd59A.woff2' },
  ],
  // quasimoda is a geometric-humanist sans (generous x-height, slightly rounded
  // terminals, modern grotesque proportions). Hanken Grotesk is the closest free
  // match on those axes — more so than the more-rounded Mulish or the
  // narrower-aperture Figtree — so body copy reads in the same register.
  rationale: 'quasimoda (Adobe Typekit, uncapturable) → Hanken Grotesk: closest free geometric-humanist grotesque (x-height + terminal shape) vs. rounder Mulish / narrower Figtree.',
};

const INTER: FreeFontReplacement = {
  family: 'Inter',
  faces: [
    { weight: '400 700', style: 'normal', url: 'https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2' },
  ],
  rationale: 'Generic neutral sans-serif substitute (Inter).',
};

const EB_GARAMOND: FreeFontReplacement = {
  family: 'EB Garamond',
  faces: [
    { weight: '400 700', style: 'normal', url: 'https://fonts.gstatic.com/s/ebgaramond/v32/SlGUmQSNjdsmc35JDF1K5GR1SDk.woff2' },
  ],
  rationale: 'Generic serif substitute (EB Garamond).',
};

const MONTSERRAT: FreeFontReplacement = {
  family: 'Montserrat',
  faces: [
    { weight: '400 700', style: 'normal', url: 'https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm459Wlhyw.woff2' },
  ],
  rationale: 'Geometric sans substitute (Montserrat) for Proxima/Gotham-class families.',
};

/**
 * Ordered substitution table (most-specific substrings first). A genuinely free
 * Google family (e.g. "playfair display") need not appear here — it would be
 * self-hosted by the normal capture path or already free.
 */
const SUBSTITUTIONS: SubRule[] = [
  { match: 'quasimoda', replacement: HANKEN_GROTESK },
  { match: 'proxima nova', replacement: MONTSERRAT },
  { match: 'proxima-nova', replacement: MONTSERRAT },
  { match: 'gotham', replacement: MONTSERRAT },
  { match: 'avenir', replacement: INTER },
  { match: 'sofia pro', replacement: INTER },
  { match: 'sofia-pro', replacement: INTER },
  { match: 'adobe garamond', replacement: EB_GARAMOND },
  { match: 'adobe-garamond', replacement: EB_GARAMOND },
];

/** Generic CSS keyword families — never substituted (they're real fallbacks). */
const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit', 'initial', 'arial',
  'helvetica', 'helvetica neue', 'times', 'times new roman', 'georgia',
]);

/**
 * Resolve the first family token of a stack (e.g. `"quasimoda, Arial,
 * sans-serif"` → `quasimoda`), unquoted + lowercased. Returns null for empty /
 * generic-only stacks.
 */
export function firstFamilyToken(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const first = stack.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  return first || null;
}

/**
 * Look up a free replacement for an unhostable family stack. Matches the FIRST
 * family token of the stack against the substitution table by substring.
 * Returns null when the family is generic or has no mapping (caller then keeps
 * the declared stack / falls back to a visual-lookalike default).
 */
export function findFreeReplacement(familyStack: string | null | undefined): FreeFontReplacement | null {
  const first = firstFamilyToken(familyStack);
  if (!first || GENERIC.has(first)) return null;
  for (const rule of SUBSTITUTIONS) {
    if (first.includes(rule.match)) return rule.replacement;
  }
  return null;
}

/**
 * Visual-lookalike fallback for an unhostable family with NO table entry. A
 * crude serif-vs-sans heuristic on the family name; used so we still ship a real
 * web font rather than a bare CSS generic when the source font is unknown.
 */
export function fallbackReplacement(familyStack: string | null | undefined): FreeFontReplacement {
  const first = firstFamilyToken(familyStack) ?? '';
  const looksSerif = /(serif|garamond|times|georgia|playfair|baskerville|bodoni|caslon|didot)/i.test(first)
    && !/sans/i.test(first);
  return looksSerif ? EB_GARAMOND : INTER;
}
