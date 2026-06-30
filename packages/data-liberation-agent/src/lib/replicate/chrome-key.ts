import { canonicalizeInstanceIds } from '@automattic/blocks-engine/theme';

/**
 * Matches a single class TOKEN (the whole token, anchored) when it is volatile
 * — i.e. should be excluded from the structural key because it varies between
 * the source render and the built carry render (active/current nav state, JS
 * reveal gates, builder animation gates).
 *
 * Note: we filter token-by-token (after splitting on whitespace) rather than
 * running a single regex over the joined string. This lets us use simple anchors
 * (`^`/`$`) and correctly handle tokens like standalone `--offscreen` whose
 * leading `-` prevents `\b` from matching against a preceding space.
 */
const VOLATILE_TOKEN =
  /^(active|current|is-active|selected|aria-current|scroll-trigger\S*|animate--\S*)$|--offscreen$|--current$/;

export interface ChromeKeyParts {
  region: 'header' | 'footer' | 'nav';
  /** Child indices from the region root to the element, e.g. [0, 2, 1]. */
  pathIndex: number[];
  tag: string;
  className: string;
}

/**
 * Theme-agnostic structural key for a chrome element.
 *
 * Strips volatile tokens — JS reveal gates, animation gates, active/current
 * nav state, and builder instance ids — so a source element and its built
 * carry counterpart produce the SAME key even when those tokens differ.
 *
 * Key shape:
 *   `<region>><pathIndex joined by '-'>><tag>[.<sorted stable classes>]`
 *
 * Example: `footer>0-2-1>a.link.list-menu__item--link`
 */
export function chromeKey(p: ChromeKeyParts): string {
  const classSig = canonicalizeInstanceIds(p.className)
    .split(/\s+/)
    .filter(Boolean)
    .filter(tok => !VOLATILE_TOKEN.test(tok))
    .sort()
    .join('.');

  return `${p.region}>${p.pathIndex.join('-')}>${p.tag.toLowerCase()}${classSig ? '.' + classSig : ''}`;
}
